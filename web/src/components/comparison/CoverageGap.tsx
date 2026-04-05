'use client';

import { useMemo, useState } from 'react';

interface CoverageRow {
  regionCode: string;
  regionName: string;
  [platform: string]: string | boolean;
}

interface CoverageGapProps {
  platforms: string[];
  coverageMatrix: CoverageRow[];
  coverageSummary: Record<string, number>;
  levelLabel?: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  tokopedia: 'Tokopedia',
  shopee: 'Shopee',
  grabfood: 'GrabFood',
  gofood: 'GoFood',
  lazada: 'Lazada',
  blibli: 'Blibli',
};

function getCoverageColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-700 bg-green-50';
  if (percentage >= 50) return 'text-yellow-700 bg-yellow-50';
  return 'text-red-700 bg-red-50';
}

export default function CoverageGap({
  platforms,
  coverageMatrix,
  coverageSummary,
  levelLabel = 'Provinsi',
}: CoverageGapProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMatrix = useMemo(() => {
    if (!searchQuery.trim()) return coverageMatrix;
    const query = searchQuery.toLowerCase();
    return coverageMatrix.filter((row) =>
      (row.regionName as string).toLowerCase().includes(query),
    );
  }, [coverageMatrix, searchQuery]);

  // Calculate total covered provinces per platform for the filtered view
  const totalProvinces = coverageMatrix.length;

  if (coverageMatrix.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Gap Cakupan Platform
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Matriks ketersediaan data per platform di setiap {levelLabel.toLowerCase()}
          </p>
        </div>
        <div className="flex h-72 items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-400">Belum ada data</p>
            <p className="mt-1 text-xs text-gray-300">Data akan muncul setelah scraping dilakukan</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Gap Cakupan Platform
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Matriks ketersediaan data per platform di setiap {levelLabel.toLowerCase()}
          </p>
        </div>
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            placeholder="Cari wilayah..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 sm:w-56"
          />
        </div>
      </div>

      {/* Coverage summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {platforms.map((platform) => {
          const pct = coverageSummary[platform] ?? 0;
          return (
            <div
              key={platform}
              className={`rounded-lg p-3 text-center ${getCoverageColor(pct)}`}
            >
              <p className="text-xs font-medium opacity-75">
                {PLATFORM_LABELS[platform] || platform}
              </p>
              <p className="mt-1 text-xl font-bold">{pct}%</p>
              <p className="text-xs opacity-60">cakupan</p>
            </div>
          );
        })}
      </div>

      {/* Coverage matrix table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                {levelLabel}
              </th>
              {platforms.map((platform) => (
                <th
                  key={platform}
                  className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  {PLATFORM_LABELS[platform] || platform}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredMatrix.map((row) => (
              <tr
                key={row.regionCode as string}
                className="hover:bg-gray-50"
              >
                <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-sm font-medium text-gray-900">
                  {row.regionName as string}
                </td>
                {platforms.map((platform) => {
                  const hasData = row[platform] === true;
                  return (
                    <td
                      key={platform}
                      className="px-3 py-2.5 text-center"
                    >
                      {hasData ? (
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600"
                          title="Data tersedia"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m4.5 12.75 6 6 9-13.5"
                            />
                          </svg>
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-500"
                          title="Data tidak tersedia"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2.5}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18 18 6M6 6l12 12"
                            />
                          </svg>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredMatrix.length === 0 && (
              <tr>
                <td
                  colSpan={platforms.length + 1}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  Tidak ada wilayah ditemukan.
                </td>
              </tr>
            )}
          </tbody>
          {/* Summary footer row */}
          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
              <td className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-xs uppercase tracking-wider text-gray-600">
                Cakupan Total ({totalProvinces} {levelLabel.toLowerCase()})
              </td>
              {platforms.map((platform) => {
                const pct = coverageSummary[platform] ?? 0;
                return (
                  <td
                    key={platform}
                    className="px-3 py-3 text-center"
                  >
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${getCoverageColor(pct)}`}
                    >
                      {pct}%
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
