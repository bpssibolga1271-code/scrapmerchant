'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import DeleteButton from '@/components/explorer/DeleteButton';
import ImportButton from '@/components/explorer/ImportButton';
import QueryBuilder from '@/components/explorer/QueryBuilder';

const ChoroplethMap = dynamic(
  () => import('@/components/explorer/ChoroplethMap'),
  { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-lg bg-gray-100" /> },
);

interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface RegionData {
  code: string;
  name: string;
  merchantCount: number;
}

interface MerchantPoint {
  name: string;
  platform: string;
  regionCode: string;
  regionName: string;
  rating?: number | null;
  productCount?: number | null;
  category?: string | null;
}

/** Case-insensitive row field access */
function getField(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (name in row) return row[name];
    // Try exact match first, then case-insensitive
    const lower = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower) return row[key];
    }
  }
  return undefined;
}

/** Check if a column name looks like an aggregate count (not a raw field like productCount) */
function isAggregateCountCol(name: string): boolean {
  const n = name.toLowerCase();
  // Exact matches for common aggregate aliases
  if (['count', 'cnt', 'total', 'merchants', 'merchantcount', 'merchant_count'].includes(n)) return true;
  // Matches "count(*)" or "count(1)" etc
  if (n.startsWith('count(')) return true;
  // Matches names ending with _count or _total (e.g. "region_count") but NOT camelCase fields like "productCount"
  if (/^[a-z_]+_count$/.test(n) || /^[a-z_]+_total$/.test(n)) return true;
  return false;
}

function extractMapData(result: QueryResult): RegionData[] | null {
  const cols = result.columns.map((c) => c.name.toLowerCase());

  const countCol = result.columns.find((c) => isAggregateCountCol(c.name));
  if (!countCol) return null;

  const hasRegionCode = cols.includes('regioncode');
  const hasProvinceCode = cols.includes('provincecode');

  if (hasRegionCode) {
    return result.rows.map((row) => ({
      code: String(getField(row, 'regionCode', 'regioncode') ?? ''),
      name: String(getField(row, 'regionName', 'regionname') ?? ''),
      merchantCount: Number(getField(row, countCol.name) ?? 0),
    }));
  }

  if (hasProvinceCode) {
    return result.rows.map((row) => ({
      code: String(getField(row, 'provinceCode', 'provincecode') ?? ''),
      name: String(getField(row, 'provinceName', 'provincename') ?? ''),
      merchantCount: Number(getField(row, countCol.name) ?? 0),
    }));
  }

  return null;
}

export default function ExplorerPage() {
  const [mapData, setMapData] = useState<RegionData[]>([]);
  const [merchantPoints, setMerchantPoints] = useState<MerchantPoint[]>([]);

  // Auto-load data from server on mount
  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/merchants?limit=10000');
      if (!res.ok) return;
      const data = await res.json();
      const allMerchants = data.merchants;
      if (!Array.isArray(allMerchants) || allMerchants.length === 0) return;

      // Build region density
      const regionMap = new Map<string, { name: string; count: number }>();
      for (const m of allMerchants) {
        const code = m.regionCode;
        if (!code) continue;
        const existing = regionMap.get(code);
        if (existing) {
          existing.count++;
        } else {
          regionMap.set(code, { name: m.regionName || code, count: 1 });
        }
      }

      const regions: RegionData[] = Array.from(regionMap.entries()).map(
        ([code, info]) => ({
          code,
          name: info.name,
          merchantCount: info.count,
        }),
      );
      if (regions.length > 0) setMapData(regions);

      // Store merchant points for map
      setMerchantPoints(
        allMerchants.map((m: Record<string, unknown>) => ({
          name: String(m.name || ''),
          platform: String(m.platform || ''),
          regionCode: String(m.regionCode || ''),
          regionName: String(m.regionName || ''),
          rating: m.rating as number | null,
          productCount: m.productCount as number | null,
          category: m.category as string | null,
        })),
      );
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleQueryResult(result: QueryResult) {
    // Try to extract aggregate map data (density queries)
    const extracted = extractMapData(result);
    if (extracted) {
      setMapData(extracted);
      return;
    }

    // If query returns merchant-level rows (has name + platform + regionCode), update points
    const cols = result.columns.map((c) => c.name.toLowerCase());
    const hasMerchantCols = cols.includes('name') && cols.includes('platform') && cols.includes('regioncode');
    if (hasMerchantCols) {
      const points: MerchantPoint[] = result.rows.map((row) => ({
        name: String(getField(row, 'name') ?? ''),
        platform: String(getField(row, 'platform') ?? ''),
        regionCode: String(getField(row, 'regionCode', 'regioncode') ?? ''),
        regionName: String(getField(row, 'regionName', 'regionname') ?? ''),
        rating: (getField(row, 'rating') as number | null) ?? null,
        productCount: (getField(row, 'productCount', 'productcount') as number | null) ?? null,
        category: (getField(row, 'category') as string | null) ?? null,
      }));
      setMerchantPoints(points);

      // Also rebuild density from these results
      const regionMap = new Map<string, { name: string; count: number }>();
      for (const m of points) {
        if (!m.regionCode) continue;
        const existing = regionMap.get(m.regionCode);
        if (existing) existing.count++;
        else regionMap.set(m.regionCode, { name: m.regionName || m.regionCode, count: 1 });
      }
      const regions: RegionData[] = Array.from(regionMap.entries()).map(
        ([code, info]) => ({ code, name: info.name, merchantCount: info.count }),
      );
      if (regions.length > 0) setMapData(regions);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Eksplorasi Data</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kueri data merchant dengan SQL, visualisasi di peta
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DeleteButton onDeleteComplete={() => window.location.reload()} />
          <ImportButton onImportComplete={() => window.location.reload()} />
        </div>
      </div>

      {/* Map */}
      <ChoroplethMap data={mapData} merchants={merchantPoints} />

      {/* Query Builder */}
      <QueryBuilder onQueryResult={handleQueryResult} />
    </div>
  );
}
