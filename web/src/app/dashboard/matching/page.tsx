'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

interface MatchingResponse {
  totalMerchants: number;
  totalMatches: number;
  platformPairs: { pair: string; count: number }[];
  matches: MatchGroup[];
  regions: { code: string; name: string }[];
}

const PLATFORM_COLORS: Record<string, string> = {
  tokopedia: 'bg-green-100 text-green-800',
  shopee: 'bg-orange-100 text-orange-800',
  blibli: 'bg-blue-100 text-blue-800',
  lazada: 'bg-purple-100 text-purple-800',
  grabfood: 'bg-emerald-100 text-emerald-800',
  gofood: 'bg-red-100 text-red-800',
};

const THRESHOLD_OPTIONS = [
  { value: '0.95', label: 'Sangat tinggi (95%)' },
  { value: '0.90', label: 'Tinggi (90%)' },
  { value: '0.85', label: 'Sedang (85%)' },
  { value: '0.80', label: 'Rendah (80%)' },
];

export default function MatchingPage() {
  const [data, setData] = useState<MatchingResponse | null>(null);
  const [threshold, setThreshold] = useState('0.85');
  const [regionFilter, setRegionFilter] = useState('all');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const analyze = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);
    setPage(0);

    try {
      const params = new URLSearchParams({ threshold });
      if (regionFilter !== 'all') params.set('regionCode', regionFilter);

      const res = await fetch(`/api/stats/matching?${params}`);
      if (!res.ok) throw new Error('Analysis failed');

      const result: MatchingResponse = await res.json();
      setData(result);
    } catch (err) {
      console.error('Matching analysis failed:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  }, [threshold, regionFilter]);

  // Run analysis on mount
  useEffect(() => {
    analyze();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = data?.matches || [];
  const pagedMatches = matches.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(matches.length / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Deteksi Merchant Lintas Platform
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Identifikasi merchant yang kemungkinan sama di platform berbeda
            berdasarkan kesamaan nama dan wilayah
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Select value={threshold} onValueChange={setThreshold}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Threshold" />
            </SelectTrigger>
            <SelectContent>
              {THRESHOLD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Semua wilayah" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua wilayah</SelectItem>
              {(data?.regions || []).map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={analyze} disabled={isAnalyzing}>
            {isAnalyzing ? 'Menganalisis...' : 'Analisis'}
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {isAnalyzing && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
              />
            ))}
          </div>
          <div className="h-96 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
        </div>
      )}

      {/* Error state */}
      {error && !isAnalyzing && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats cards */}
      {data && !isAnalyzing && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-medium text-gray-500">Total Merchant</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {data.totalMerchants.toLocaleString('id-ID')}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-medium text-gray-500">
              Potensi Duplikat
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {data.totalMatches.toLocaleString('id-ID')}
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              grup merchant yang cocok
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm font-medium text-gray-500">
              Pasangan Platform Teratas
            </p>
            <div className="mt-1.5 space-y-1">
              {data.platformPairs.slice(0, 3).map((pp) => (
                <div
                  key={pp.pair}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-700">{pp.pair}</span>
                  <span className="font-medium text-gray-900">{pp.count}</span>
                </div>
              ))}
              {data.platformPairs.length === 0 && (
                <p className="text-xs text-gray-400">Tidak ada pasangan</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Match results table */}
      {!isAnalyzing && matches.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">
              Hasil Pencocokan
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {matches.length} grup merchant yang terdeteksi serupa (threshold{' '}
              {Math.round(parseFloat(threshold) * 100)}%)
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Wilayah</TableHead>
                <TableHead className="text-right">Kesamaan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedMatches.map((group) => (
                <TableRow key={group.id} className="align-top">
                  <TableCell className="font-mono text-xs text-gray-400">
                    {group.id}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {group.merchants.map((m, i) => (
                        <div key={i} className="text-sm">
                          <span className="font-medium text-gray-900">
                            {m.name}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            {m.rating != null && (
                              <span>
                                {'★'} {m.rating.toFixed(1)}
                              </span>
                            )}
                            {m.productCount != null && (
                              <span>{m.productCount} produk</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      {group.merchants.map((m, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className={
                            PLATFORM_COLORS[m.platform] ||
                            'bg-gray-100 text-gray-800'
                          }
                        >
                          {m.platform}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {group.regionName}
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        group.similarity >= 0.95
                          ? 'bg-green-100 text-green-800'
                          : group.similarity >= 0.9
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-orange-100 text-orange-800'
                      }`}
                    >
                      {Math.round(group.similarity * 100)}%
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
              <p className="text-sm text-gray-500">
                Halaman {page + 1} dari {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
                >
                  Selanjutnya
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isAnalyzing && data && matches.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 15.75l-2.489-2.489m0 0a3.375 3.375 0 10-4.773-4.773 3.375 3.375 0 004.773 4.773zM21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-3 text-sm font-semibold text-gray-900">
            Tidak ada kecocokan ditemukan
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            {data.totalMerchants === 0
              ? 'Belum ada data merchant. Upload data terlebih dahulu.'
              : 'Coba turunkan threshold kesamaan atau pilih wilayah lain.'}
          </p>
        </div>
      )}
    </div>
  );
}
