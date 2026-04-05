import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const parquet = require('parquetjs-lite');

const DATA_DIR = path.join(process.cwd(), 'data');
const MERCHANTS_FILE = path.join(DATA_DIR, 'merchants.parquet');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export interface MerchantRecord {
  platform: string;
  name: string;
  address: string | null;
  category: string | null;
  phone: string | null;
  rating: number | null;
  productCount: number | null;
  joinDate: string | null;
  monthlySales: number | null;
  totalTransactions: number | null;
  operatingHours: string | null;
  ownerName: string | null;
  sourceUrl: string | null;
  regionCode: string;
  regionName: string;
  provinceCode: string;
  provinceName: string;
  createdAt: string;
}

const MERCHANT_SCHEMA = new parquet.ParquetSchema({
  platform: { type: 'UTF8' },
  name: { type: 'UTF8' },
  address: { type: 'UTF8', optional: true },
  category: { type: 'UTF8', optional: true },
  phone: { type: 'UTF8', optional: true },
  rating: { type: 'DOUBLE', optional: true },
  productCount: { type: 'INT32', optional: true },
  joinDate: { type: 'UTF8', optional: true },
  monthlySales: { type: 'DOUBLE', optional: true },
  totalTransactions: { type: 'INT32', optional: true },
  operatingHours: { type: 'UTF8', optional: true },
  ownerName: { type: 'UTF8', optional: true },
  sourceUrl: { type: 'UTF8', optional: true },
  regionCode: { type: 'UTF8' },
  regionName: { type: 'UTF8' },
  provinceCode: { type: 'UTF8' },
  provinceName: { type: 'UTF8' },
  createdAt: { type: 'UTF8' },
});

/**
 * Read all merchants from parquet file.
 */
export async function readMerchants(): Promise<MerchantRecord[]> {
  if (!existsSync(MERCHANTS_FILE)) return [];

  const reader = await parquet.ParquetReader.openFile(MERCHANTS_FILE);
  const cursor = reader.getCursor();
  const records: MerchantRecord[] = [];

  let record = await cursor.next();
  while (record) {
    records.push(record as MerchantRecord);
    record = await cursor.next();
  }

  await reader.close();
  return records;
}

/**
 * Write merchants to parquet file (overwrites existing file).
 */
export async function writeMerchants(merchants: MerchantRecord[]): Promise<void> {
  const writer = await parquet.ParquetWriter.openFile(MERCHANT_SCHEMA, MERCHANTS_FILE);

  for (const m of merchants) {
    await writer.appendRow({
      platform: m.platform,
      name: m.name,
      address: m.address ?? undefined,
      category: m.category ?? undefined,
      phone: m.phone ?? undefined,
      rating: m.rating ?? undefined,
      productCount: m.productCount ?? undefined,
      joinDate: m.joinDate ?? undefined,
      monthlySales: m.monthlySales ?? undefined,
      totalTransactions: m.totalTransactions ?? undefined,
      operatingHours: m.operatingHours ?? undefined,
      ownerName: m.ownerName ?? undefined,
      sourceUrl: m.sourceUrl ?? undefined,
      regionCode: m.regionCode,
      regionName: m.regionName,
      provinceCode: m.provinceCode,
      provinceName: m.provinceName,
      createdAt: m.createdAt,
    });
  }

  await writer.close();
}

/**
 * Append new merchants to existing parquet file.
 * Returns { added, skipped } counts.
 */
export async function appendMerchants(
  newMerchants: MerchantRecord[],
): Promise<{ added: number; skipped: number }> {
  const existing = await readMerchants();

  // Build dedup sets — use name+address so same merchant at different addresses is kept
  const existingKeys = new Set(
    existing.map((m) => `${m.platform}|${m.name}|${m.address || ''}`),
  );
  const existingUrls = new Set(
    existing.filter((m) => m.sourceUrl).map((m) => `${m.platform}|${m.sourceUrl}`),
  );

  const toAdd: MerchantRecord[] = [];
  for (const m of newMerchants) {
    const key = `${m.platform}|${m.name}|${m.address || ''}`;
    const urlKey = m.sourceUrl ? `${m.platform}|${m.sourceUrl}` : null;

    if (existingKeys.has(key)) continue;
    if (urlKey && existingUrls.has(urlKey)) continue;

    toAdd.push(m);
    existingKeys.add(key);
    if (urlKey) existingUrls.add(urlKey);
  }

  if (toAdd.length === 0) {
    return { added: 0, skipped: newMerchants.length };
  }

  const all = [...existing, ...toAdd];
  await writeMerchants(all);

  return { added: toAdd.length, skipped: newMerchants.length - toAdd.length };
}

/**
 * Delete merchants matching filter criteria.
 * Returns number of deleted records.
 */
export async function deleteMerchants(filter: {
  platform?: string;
  regionCode?: string;
  dateFrom?: string;
  dateTo?: string;
  all?: boolean;
}): Promise<number> {
  if (filter.all) {
    if (existsSync(MERCHANTS_FILE)) {
      await fs.unlink(MERCHANTS_FILE);
    }
    return -1; // indicates all deleted
  }

  const existing = await readMerchants();
  const remaining = existing.filter((m) => {
    if (filter.platform && m.platform !== filter.platform) return true;
    if (filter.regionCode && m.regionCode !== filter.regionCode && m.provinceCode !== filter.regionCode) return true;
    if (filter.dateFrom && m.createdAt < filter.dateFrom) return true;
    if (filter.dateTo && m.createdAt > filter.dateTo) return true;
    return false;
  });

  const deleted = existing.length - remaining.length;

  if (remaining.length === 0) {
    if (existsSync(MERCHANTS_FILE)) {
      await fs.unlink(MERCHANTS_FILE);
    }
  } else {
    await writeMerchants(remaining);
  }

  return deleted;
}

/**
 * Get the parquet file path for serving to clients.
 */
export function getParquetFilePath(): string {
  return MERCHANTS_FILE;
}

/**
 * Check if parquet file exists.
 */
export function parquetFileExists(): boolean {
  return existsSync(MERCHANTS_FILE);
}

/**
 * Get basic stats from parquet without reading all data.
 */
export async function getMerchantStats(): Promise<{
  total: number;
  platforms: Record<string, number>;
  regions: Record<string, number>;
}> {
  const merchants = await readMerchants();

  const platforms: Record<string, number> = {};
  const regions: Record<string, number> = {};

  for (const m of merchants) {
    platforms[m.platform] = (platforms[m.platform] || 0) + 1;
    regions[m.provinceName || m.provinceCode] = (regions[m.provinceName || m.provinceCode] || 0) + 1;
  }

  return { total: merchants.length, platforms, regions };
}
