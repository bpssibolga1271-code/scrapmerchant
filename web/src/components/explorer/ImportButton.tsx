'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const VALID_PLATFORMS = [
  'tokopedia',
  'shopee',
  'grabfood',
  'gofood',
  'lazada',
  'blibli',
] as const;

interface ParsedRow {
  name: string;
  platform?: string;
  regionCode?: string;
  address?: string;
  category?: string;
  phone?: string;
  rating?: number;
  productCount?: number;
  joinDate?: string;
  monthlySales?: number;
  totalTransactions?: number;
  operatingHours?: string;
  ownerName?: string;
  sourceUrl?: string;
}

interface ImportButtonProps {
  onImportComplete: () => void;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function mapRowToMerchant(
  headers: string[],
  values: string[],
): ParsedRow | null {
  const obj: Record<string, string> = {};
  headers.forEach((h, i) => {
    obj[h.toLowerCase().trim()] = values[i] ?? '';
  });

  // Support both dashboard column names and extension export column names (camelCase)
  const name =
    obj['name'] ||
    obj['merchantname'] ||
    obj['merchant name'] ||
    obj['merchant'] ||
    '';
  if (!name) return null;

  const parseNum = (v: string | undefined) => {
    if (!v) return undefined;
    const n = parseFloat(v);
    return isNaN(n) ? undefined : n;
  };

  // Extract platform from row data
  const rawPlatform = (obj['platform'] || '').toLowerCase().trim();
  const platform = VALID_PLATFORMS.includes(rawPlatform as (typeof VALID_PLATFORMS)[number])
    ? rawPlatform
    : undefined;

  // Extract region code from row data
  const regionCode =
    obj['regencycode'] || obj['regency_code'] ||
    obj['provincecode'] || obj['province_code'] ||
    undefined;

  return {
    name,
    platform,
    regionCode,
    address: obj['address'] || undefined,
    category: obj['category'] || undefined,
    phone: obj['phone'] || undefined,
    rating: parseNum(obj['rating']),
    productCount: parseNum(
      obj['productcount'] ||
        obj['product_count'] ||
        obj['products'] ||
        obj['totalproducts'],
    ),
    joinDate: obj['joindate'] || obj['join_date'] || undefined,
    monthlySales: parseNum(
      obj['monthlysales'] || obj['monthly_sales'] || obj['totalsold'],
    ),
    totalTransactions: parseNum(
      obj['totaltransactions'] || obj['total_transactions'],
    ),
    operatingHours:
      obj['operatinghours'] || obj['operating_hours'] || undefined,
    ownerName:
      obj['ownername'] || obj['owner_name'] || obj['owner'] || undefined,
    sourceUrl:
      obj['sourceurl'] ||
      obj['source_url'] ||
      obj['url'] ||
      obj['merchanturl'] ||
      undefined,
  };
}

interface ParseResult {
  rows: ParsedRow[];
  detectedPlatforms: string[];
  detectedRegionCode?: string;
  hasPerRowPlatform: boolean;
}

async function parseExcelFile(file: File): Promise<ParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const rows: ParsedRow[] = [];
  const detectedPlatforms = new Set<string>();
  let detectedRegionCode: string | undefined;

  // Read all sheets and combine rows (the extension exports one sheet per platform
  // plus a "Semua Platform" sheet with all data)
  for (const sheet of workbook.worksheets) {
    if (!sheet || sheet.rowCount < 2) continue;

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? '');
    });

    // If this is the "Semua Platform" sheet, use it exclusively since it has everything
    const isAllPlatformSheet = sheet.name === 'Semua Platform';

    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = String(cell.value ?? '');
      });
      if (values.some((v) => v)) {
        const mapped = mapRowToMerchant(headers, values);
        if (mapped) {
          rows.push(mapped);
          if (mapped.platform) detectedPlatforms.add(mapped.platform);
          if (!detectedRegionCode && mapped.regionCode) {
            detectedRegionCode = mapped.regionCode;
          }
        }
      }
    }

    // If we found the "Semua Platform" sheet, use only that to avoid duplicates
    if (isAllPlatformSheet && rows.length > 0) break;
  }

  return {
    rows,
    detectedPlatforms: Array.from(detectedPlatforms),
    detectedRegionCode,
    hasPerRowPlatform: detectedPlatforms.size > 0,
  };
}

function parseCSVContent(content: string): ParsedRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const mapped = mapRowToMerchant(headers, values);
    if (mapped) rows.push(mapped);
  }

  return rows;
}

function parseJSONContent(content: string): ParsedRow[] {
  const data = JSON.parse(content);
  const arr = Array.isArray(data) ? data : data.merchants ?? [];

  return arr
    .map((item: Record<string, unknown>) => {
      const name = String(item.name ?? item.merchantName ?? item.merchant ?? '');
      if (!name) return null;

      const rawPlatform = String(item.platform ?? '').toLowerCase().trim();
      const platform = VALID_PLATFORMS.includes(rawPlatform as (typeof VALID_PLATFORMS)[number])
        ? rawPlatform
        : undefined;

      return {
        name,
        platform,
        regionCode: item.regencyCode ? String(item.regencyCode) : item.provinceCode ? String(item.provinceCode) : undefined,
        address: item.address ? String(item.address) : undefined,
        category: item.category ? String(item.category) : undefined,
        phone: item.phone ? String(item.phone) : undefined,
        rating: typeof item.rating === 'number' ? item.rating : undefined,
        productCount:
          typeof item.productCount === 'number' ? item.productCount : undefined,
        joinDate: item.joinDate ? String(item.joinDate) : undefined,
        monthlySales:
          typeof item.monthlySales === 'number' ? item.monthlySales : undefined,
        totalTransactions:
          typeof item.totalTransactions === 'number'
            ? item.totalTransactions
            : undefined,
        operatingHours: item.operatingHours
          ? String(item.operatingHours)
          : undefined,
        ownerName: item.ownerName ? String(item.ownerName) : undefined,
        sourceUrl: item.sourceUrl
          ? String(item.sourceUrl)
          : item.merchantUrl
            ? String(item.merchantUrl)
            : undefined,
      } as ParsedRow;
    })
    .filter(Boolean) as ParsedRow[];
}

export default function ImportButton({ onImportComplete }: ImportButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [platform, setPlatform] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [hasPerRowPlatform, setHasPerRowPlatform] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setParsedData([]);
    setFileName('');
    setPlatform('');
    setRegionCode('');
    setHasPerRowPlatform(false);
    setError('');
    setSuccess('');
    setIsSubmitting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleClose = useCallback(() => {
    setIsModalOpen(false);
    resetState();
  }, [resetState]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setSuccess('');
    setFileName(file.name);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();

      let rows: ParsedRow[] = [];

      if (ext === 'xlsx' || ext === 'xls') {
        const result = await parseExcelFile(file);
        rows = result.rows;
        setHasPerRowPlatform(result.hasPerRowPlatform);
        if (result.detectedPlatforms.length === 1) {
          setPlatform(result.detectedPlatforms[0]);
        }
        if (result.detectedRegionCode) setRegionCode(result.detectedRegionCode);
      } else if (ext === 'csv') {
        const text = await file.text();
        rows = parseCSVContent(text);
        const platforms = new Set(rows.map((r) => r.platform).filter(Boolean));
        setHasPerRowPlatform(platforms.size > 0);
        if (platforms.size === 1) setPlatform(Array.from(platforms)[0]!);
      } else if (ext === 'json') {
        const text = await file.text();
        rows = parseJSONContent(text);
        const platforms = new Set(rows.map((r) => r.platform).filter(Boolean));
        setHasPerRowPlatform(platforms.size > 0);
        if (platforms.size === 1) setPlatform(Array.from(platforms)[0]!);
      } else {
        setError('Format file tidak didukung. Gunakan .xlsx, .csv, atau .json');
        return;
      }

      if (rows.length === 0) {
        setError(
          'Tidak ada data valid ditemukan. Pastikan file memiliki kolom "name" atau "merchantName".',
        );
        return;
      }

      setParsedData(rows);
    } catch (err) {
      console.error('File parse error:', err);
      setError('Gagal membaca file. Periksa formatnya.');
    }
  }

  async function handleSubmit() {
    if (!hasPerRowPlatform && !platform) {
      setError('Pilih platform terlebih dahulu.');
      return;
    }
    if (!regionCode) {
      setError('Masukkan kode wilayah terlebih dahulu.');
      return;
    }
    if (parsedData.length === 0) {
      setError('Tidak ada data untuk diimpor.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Group merchants by platform
      const groups: Record<string, ParsedRow[]> = {};
      for (const row of parsedData) {
        const p = row.platform || platform;
        if (!p) continue;
        if (!groups[p]) groups[p] = [];
        groups[p].push(row);
      }

      const platformKeys = Object.keys(groups);
      if (platformKeys.length === 0) {
        setError('Tidak ditemukan baris dengan platform yang valid.');
        return;
      }

      let totalImported = 0;
      let totalSkipped = 0;
      const errors: string[] = [];

      for (const [plat, rows] of Object.entries(groups)) {
        // Strip platform/regionCode from the payload (API doesn't expect these per-merchant)
        const merchants = rows.map(({ platform: _p, regionCode: _r, ...rest }) => rest);

        const res = await fetch('/api/merchants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchants,
            regionCode: rows[0]?.regionCode || regionCode,
            platform: plat,
          }),
        });

        const result = await res.json();

        if (!res.ok) {
          errors.push(`${plat}: ${result.error || 'failed'}`);
        } else {
          totalImported += result.count ?? 0;
          totalSkipped += result.skipped ?? 0;
        }
      }

      if (errors.length > 0) {
        setError(`Beberapa impor gagal:\n${errors.join('\n')}`);
      }

      const parts = [`Successfully imported ${totalImported} merchants`];
      if (totalSkipped > 0) parts.push(`(${totalSkipped} duplikat dilewati)`);
      if (platformKeys.length > 1) parts.push(`dari ${platformKeys.length} platform`);
      setSuccess(parts.join(' ') + '.');

      onImportComplete();
    } catch (err) {
      console.error('Import error:', err);
      setError('An error occurred during import.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Count platforms in parsed data for display
  const platformCounts = parsedData.reduce<Record<string, number>>((acc, r) => {
    const p = r.platform || 'unknown';
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        Impor
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Impor Merchant
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* File input */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Pilih File (.xlsx, .csv, .json)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.json"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-md file:border-0 file:bg-amber-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-amber-700 hover:file:bg-amber-100"
              />
              {fileName && (
                <p className="mt-1 text-xs text-gray-500">
                  Selected: {fileName}
                </p>
              )}
            </div>

            {/* Preview */}
            {parsedData.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-gray-700">
                  Pratinjau ({parsedData.length} total baris, menampilkan 5 pertama):
                </p>
                {/* Platform breakdown */}
                {hasPerRowPlatform && Object.keys(platformCounts).length > 1 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {Object.entries(platformCounts).map(([p, count]) => (
                      <span
                        key={p}
                        className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
                      >
                        {p}: {count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="max-h-48 overflow-auto rounded border border-gray-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {hasPerRowPlatform && (
                          <th className="px-3 py-1 text-left font-medium text-gray-600">
                            Platform
                          </th>
                        )}
                        <th className="px-3 py-1 text-left font-medium text-gray-600">
                          Nama
                        </th>
                        <th className="px-3 py-1 text-left font-medium text-gray-600">
                          Alamat
                        </th>
                        <th className="px-3 py-1 text-left font-medium text-gray-600">
                          Kategori
                        </th>
                        <th className="px-3 py-1 text-left font-medium text-gray-600">
                          Rating
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          {hasPerRowPlatform && (
                            <td className="px-3 py-1 text-gray-600">
                              {row.platform ?? '-'}
                            </td>
                          )}
                          <td className="px-3 py-1 text-gray-800">
                            {row.name}
                          </td>
                          <td className="max-w-50 truncate px-3 py-1 text-gray-600">
                            {row.address ?? '-'}
                          </td>
                          <td className="px-3 py-1 text-gray-600">
                            {row.category ?? '-'}
                          </td>
                          <td className="px-3 py-1 text-gray-600">
                            {row.rating ?? '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Platform & Region */}
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Platform
                  {hasPerRowPlatform && Object.keys(platformCounts).length > 1 && (
                    <span className="ml-1 text-xs font-normal text-gray-400">(auto-detected per row)</span>
                  )}
                </label>
                <Select
                  value={platform || '__none__'}
                  onValueChange={(val) => setPlatform(!val || val === '__none__' ? '' : val)}
                  disabled={hasPerRowPlatform && Object.keys(platformCounts).length > 1}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      hasPerRowPlatform && Object.keys(platformCounts).length > 1
                        ? `${Object.keys(platformCounts).length} platform terdeteksi`
                        : 'Select platform...'
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      {hasPerRowPlatform && Object.keys(platformCounts).length > 1
                        ? `${Object.keys(platformCounts).length} platform terdeteksi`
                        : 'Select platform...'}
                    </SelectItem>
                    {VALID_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Kode Wilayah
                </label>
                <input
                  type="text"
                  value={regionCode}
                  onChange={(e) => setRegionCode(e.target.value)}
                  placeholder="e.g. 31"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Error / Success */}
            {error && (
              <div className="mb-4 whitespace-pre-line rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                {success}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  parsedData.length === 0 ||
                  (!hasPerRowPlatform && !platform) ||
                  !regionCode ||
                  !!success
                }
                className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                {isSubmitting ? 'Mengimpor...' : 'Impor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
