'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface ProvinceData {
  name: string;
  count: number;
}

interface ProvinceBarChartProps {
  data: ProvinceData[];
}

const MOCK_DATA: ProvinceData[] = [
  { name: 'DKI Jakarta', count: 3200 },
  { name: 'Jawa Barat', count: 2800 },
  { name: 'Jawa Timur', count: 2400 },
  { name: 'Jawa Tengah', count: 2100 },
  { name: 'Banten', count: 1600 },
  { name: 'Sumatera Utara', count: 1200 },
  { name: 'Sulawesi Selatan', count: 950 },
  { name: 'Bali', count: 870 },
  { name: 'Kalimantan Timur', count: 650 },
  { name: 'DI Yogyakarta', count: 580 },
];

export default function ProvinceBarChart({ data }: ProvinceBarChartProps) {
  const chartData = data.length > 0 ? data : MOCK_DATA;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Top Provinces</h3>
      <p className="mt-1 text-sm text-gray-500">Top 10 provinces by merchant count</p>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              formatter={(value: number | undefined) => [
                (value ?? 0).toLocaleString(),
                'Merchants',
              ]}
              contentStyle={{
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
