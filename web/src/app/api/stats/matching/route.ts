import { NextRequest, NextResponse } from 'next/server';
import { readMerchants, MerchantRecord } from '@/lib/parquet';

interface MatchedMerchant {
  name: string;
  platform: string;
  rating: number | null;
  productCount: number | null;
  sourceUrl: string | null;
  address: string | null;
}

interface MatchGroup {
  id: number;
  normalizedName: string;
  regionName: string;
  regionCode: string;
  merchants: MatchedMerchant[];
  similarity: number;
}

/**
 * Normalize a merchant name for comparison:
 * - lowercase
 * - strip common prefixes (PT, CV, UD, Toko)
 * - strip common suffixes (Official Store/Shop, Store, Shop)
 * - collapse whitespace
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*-\s*(official|store|shop)\s*$/gi, '')
    .replace(/\s*(official\s*(store|shop)|store|shop)\s*$/gi, '')
    .replace(/^(pt\.?|cv\.?|ud\.?|toko)\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Jaro-Winkler similarity between two strings (0-1).
 */
function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler bonus for common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const threshold = parseFloat(searchParams.get('threshold') || '0.85');
    const regionFilter = searchParams.get('regionCode') || null;

    const merchants = await readMerchants();
    if (merchants.length === 0) {
      return NextResponse.json({
        totalMerchants: 0,
        totalMatches: 0,
        platformPairs: [],
        matches: [],
        regions: [],
      });
    }

    // Filter by region if specified
    const filtered = regionFilter
      ? merchants.filter((m) => m.regionCode === regionFilter)
      : merchants;

    // Build normalized lookup
    const normalized = filtered.map((m) => ({
      ...m,
      normName: normalizeName(m.name),
    }));

    // Group merchants by regionCode for efficient comparison
    const byRegion = new Map<string, typeof normalized>();
    for (const m of normalized) {
      if (m.normName.length <= 2) continue;
      const arr = byRegion.get(m.regionCode) || [];
      arr.push(m);
      byRegion.set(m.regionCode, arr);
    }

    // Find cross-platform matches within each region
    const groups: MatchGroup[] = [];
    let groupId = 0;
    const platformPairCount = new Map<string, number>();

    for (const [, regionMerchants] of byRegion) {
      // Group by platform
      const byPlatform = new Map<string, typeof normalized>();
      for (const m of regionMerchants) {
        const arr = byPlatform.get(m.platform) || [];
        arr.push(m);
        byPlatform.set(m.platform, arr);
      }

      const platforms = Array.from(byPlatform.keys()).sort();
      if (platforms.length < 2) continue;

      // Compare across platform pairs
      for (let pi = 0; pi < platforms.length; pi++) {
        for (let pj = pi + 1; pj < platforms.length; pj++) {
          const listA = byPlatform.get(platforms[pi])!;
          const listB = byPlatform.get(platforms[pj])!;
          const pairKey = `${platforms[pi]} - ${platforms[pj]}`;

          for (const a of listA) {
            for (const b of listB) {
              // Quick length filter to avoid expensive comparisons
              const lenRatio = Math.min(a.normName.length, b.normName.length) /
                Math.max(a.normName.length, b.normName.length);
              if (lenRatio < 0.6) continue;

              const sim = jaroWinkler(a.normName, b.normName);
              if (sim < threshold) continue;

              platformPairCount.set(pairKey, (platformPairCount.get(pairKey) || 0) + 1);

              // Check if either merchant already belongs to a group
              let existingGroup: MatchGroup | undefined;
              for (const g of groups) {
                const inGroup = g.merchants.some(
                  (m) =>
                    (m.name === a.name && m.platform === a.platform) ||
                    (m.name === b.name && m.platform === b.platform),
                );
                if (inGroup) {
                  existingGroup = g;
                  break;
                }
              }

              if (existingGroup) {
                const addIfMissing = (merchant: typeof a) => {
                  if (
                    !existingGroup!.merchants.some(
                      (m) => m.name === merchant.name && m.platform === merchant.platform,
                    )
                  ) {
                    existingGroup!.merchants.push(toMatchedMerchant(merchant));
                  }
                };
                addIfMissing(a);
                addIfMissing(b);
                existingGroup.similarity = Math.max(existingGroup.similarity, sim);
              } else {
                groupId++;
                groups.push({
                  id: groupId,
                  normalizedName: a.normName,
                  regionName: a.regionName,
                  regionCode: a.regionCode,
                  merchants: [toMatchedMerchant(a), toMatchedMerchant(b)],
                  similarity: sim,
                });
              }
            }
          }
        }
      }
    }

    // Sort by similarity descending
    groups.sort((a, b) => b.similarity - a.similarity);

    // Re-number groups
    groups.forEach((g, i) => (g.id = i + 1));

    // Get unique regions for filter
    const regionSet = new Map<string, string>();
    for (const m of merchants) {
      regionSet.set(m.regionCode, m.regionName);
    }
    const regions = Array.from(regionSet.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      totalMerchants: merchants.length,
      totalMatches: groups.length,
      platformPairs: Array.from(platformPairCount.entries())
        .map(([pair, count]) => ({ pair, count }))
        .sort((a, b) => b.count - a.count),
      matches: groups.slice(0, 500),
      regions,
    });
  } catch (error) {
    console.error('Matching analysis failed:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

function toMatchedMerchant(m: MerchantRecord & { normName: string }): MatchedMerchant {
  return {
    name: m.name,
    platform: m.platform,
    rating: m.rating,
    productCount: m.productCount,
    sourceUrl: m.sourceUrl,
    address: m.address,
  };
}
