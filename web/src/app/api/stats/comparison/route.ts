import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

import { prisma } from '@/lib/prisma';
import { readMerchants } from '@/lib/parquet';

const PLATFORMS = [
  'tokopedia',
  'shopee',
  'grabfood',
  'gofood',
  'lazada',
  'blibli',
];

/**
 * Normalize region name: uppercase, remove "KAB.", "KABUPATEN", "KOTA" prefixes.
 */
function normalizeRegionName(name: string): string {
  let n = name.toUpperCase().trim();
  n = n.replace(/^KAB\.\s*/i, '');
  n = n.replace(/^KABUPATEN\s+/i, '');
  n = n.replace(/^KOTA\s+/i, '');
  return n.trim();
}

/**
 * Read regencies from a geojson file.
 */
async function readRegenciesFromGeoJson(filePath: string): Promise<{ code: string; name: string }[]> {
  if (!existsSync(filePath)) return [];
  const raw = await fs.readFile(filePath, 'utf-8');
  const geojson = JSON.parse(raw);
  const results: { code: string; name: string }[] = [];
  for (const feature of geojson.features || []) {
    const props = feature.properties || {};
    const code = props.KODE_KAB || props.kode_kab;
    const name = props.KABUPATEN || props.kabupaten || props.NAMA || props.nama;
    if (code && name) {
      results.push({ code: String(code), name: normalizeRegionName(name) });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// Map province codes to their geojson file names (if available)
const GEOJSON_DIR = path.join(process.cwd(), 'public', 'geojson');
const PROVINCE_GEOJSON: Record<string, string> = {
  '72': 'sulteng-regencies.geojson',
};

/**
 * Get all regencies for a province. Tries DB first, falls back to geojson, then merchant data.
 */
async function getAllRegencies(
  provinceCode: string,
  merchantRegions: Map<string, string>,
): Promise<{ code: string; name: string }[]> {
  // Try DB first
  const province = await prisma.region.findFirst({
    where: { code: provinceCode, level: 'province' },
    select: { id: true },
  });

  if (province) {
    const dbRegencies = await prisma.region.findMany({
      where: { parentId: province.id, level: 'regency' },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    });

    if (dbRegencies.length > 0) {
      return dbRegencies.map((r) => ({
        code: r.code,
        name: normalizeRegionName(r.name),
      }));
    }
  }

  // Fallback: geojson file
  const geojsonFile = PROVINCE_GEOJSON[provinceCode];
  if (geojsonFile) {
    const filePath = path.join(GEOJSON_DIR, geojsonFile);
    const regions = await readRegenciesFromGeoJson(filePath);
    if (regions.length > 0) return regions;
  }

  // Final fallback: use merchant data
  return Array.from(merchantRegions.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level') || 'regency';
    const provinceCode = searchParams.get('provinceCode') || '72'; // Default Sulawesi Tengah

    const merchants = await readMerchants();

    // Get all provinces from DB
    const dbProvinces = await prisma.region.findMany({
      where: { level: 'province' },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    });
    const allProvinces = dbProvinces.map((p) => ({
      code: p.code,
      name: normalizeRegionName(p.name),
    }));

    let regions: { code: string; name: string }[];
    let filteredMerchants = merchants;

    if (level === 'regency') {
      filteredMerchants = merchants.filter(
        (m) => m.provinceCode === provinceCode,
      );

      // Collect merchant region data as fallback
      const merchantRegionMap = new Map<string, string>();
      for (const m of filteredMerchants) {
        if (m.regionCode && m.regionName) {
          merchantRegionMap.set(m.regionCode, normalizeRegionName(m.regionName));
        }
      }

      regions = await getAllRegencies(provinceCode, merchantRegionMap);
    } else {
      filteredMerchants = merchants;
      regions = allProvinces;
    }

    // Count merchants per platform per region
    const counts = new Map<string, number>();
    for (const m of filteredMerchants) {
      const regionCode = level === 'regency' ? m.regionCode : m.provinceCode;
      const key = `${m.platform}|${regionCode}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    // Build comparison data
    const comparisonData = regions.map((region) => {
      const entry: Record<string, string | number> = {
        regionCode: region.code,
        regionName: region.name,
      };
      for (const platform of PLATFORMS) {
        entry[platform] = counts.get(`${platform}|${region.code}`) || 0;
      }
      return entry;
    });

    // Build coverage matrix
    const coverageMatrix = regions.map((region) => {
      const entry: Record<string, string | boolean> = {
        regionCode: region.code,
        regionName: region.name,
      };
      for (const platform of PLATFORMS) {
        entry[platform] = (counts.get(`${platform}|${region.code}`) || 0) > 0;
      }
      return entry;
    });

    // Coverage summary
    const totalRegions = regions.length;
    const coverageSummary: Record<string, number> = {};
    for (const platform of PLATFORMS) {
      const coveredCount = regions.filter(
        (r) => (counts.get(`${platform}|${r.code}`) || 0) > 0,
      ).length;
      coverageSummary[platform] =
        totalRegions > 0
          ? Math.round((coveredCount / totalRegions) * 100)
          : 0;
    }

    return NextResponse.json({
      platforms: PLATFORMS,
      provinces: allProvinces,
      regions,
      comparisonData,
      coverageMatrix,
      coverageSummary,
      level,
      selectedProvince: level === 'regency' ? provinceCode : null,
    });
  } catch (error) {
    console.error('Error fetching comparison stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comparison statistics' },
      { status: 500 },
    );
  }
}
