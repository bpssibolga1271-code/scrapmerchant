'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts';

interface ComparisonRow {
  regionCode: string;
  regionName: string;
  [platform: string]: string | number;
}

interface PlatformComparisonProps {
  platforms: string[];
  comparisonData: ComparisonRow[];
  levelLabel?: string;
}

const PLATFORM_COLORS: Record<string, string> = {
  tokopedia: '#22c55e',
  shopee: '#f97316',
  grabfood: '#10b981',
  gofood: '#ef4444',
  lazada: '#3b82f6',
  blibli: '#6366f1',
};

const PLATFORM_LABELS: Record<string, string> = {
  tokopedia: 'Tokopedia',
  shopee: 'Shopee',
  grabfood: 'GrabFood',
  gofood: 'GoFood',
  lazada: 'Lazada',
  blibli: 'Blibli',
};

export default function PlatformComparison({
  platforms,
  comparisonData,
  levelLabel = 'Provinsi',
}: PlatformComparisonProps) {
  // Sort by total merchant count descending, show ALL regions
  const chartData = useMemo(() => {
    if (comparisonData.length === 0) return [];
    return comparisonData
      .map((row) => {
        const total = platforms.reduce(
          (sum, p) => sum + (Number(row[p]) || 0),
          0,
        );
        return { ...row, _total: total };
      })
      .sort((a, b) => (b._total as number) - (a._total as number));
  }, [comparisonData, platforms]);

  // Calculate chart width: min 120px per region, at least 100% container width
  const chartWidth = Math.max(chartData.length * 120, 800);

  if (comparisonData.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Perbandingan Merchant per Platform
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Jumlah merchant di setiap platform untuk wilayah yang dipilih
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
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Perbandingan Merchant per Platform
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Jumlah merchant di setiap platform per {levelLabel.toLowerCase()} (diurutkan berdasarkan total merchant)
        </p>
      </div>

      {/* Horizontally scrollable chart */}
      <div className="overflow-x-auto pb-2">
        <div style={{ width: chartWidth, minWidth: '100%', height: 420 }}>
          <BarChart
            width={chartWidth}
            height={420}
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="regionName"
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={80}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
              formatter={(value: number | undefined, name: string | undefined) => [
                (value ?? 0).toLocaleString(),
                PLATFORM_LABELS[name ?? ''] || name || '',
              ]}
            />
            <Legend
              formatter={(value: string) => (
                <span className="text-xs text-gray-600">
                  {PLATFORM_LABELS[value] || value}
                </span>
              )}
            />
            {platforms.map((platform) => (
              <Bar
                key={platform}
                dataKey={platform}
                fill={PLATFORM_COLORS[platform] || '#94a3b8'}
                radius={[2, 2, 0, 0]}
                maxBarSize={24}
              >
                <LabelList
                  dataKey={platform}
                  position="top"
                  style={{ fontSize: 9, fill: '#6b7280' }}
                  formatter={(value: unknown) => {
                    const num = Number(value);
                    return num > 0 ? num.toLocaleString() : '';
                  }}
                />
              </Bar>
            ))}
          </BarChart>
        </div>
      </div>
    </div>
  );
}
