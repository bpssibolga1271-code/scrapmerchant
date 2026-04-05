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

export default function ProvinceBarChart({ data }: ProvinceBarChartProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Provinsi Teratas</h3>
      <p className="mt-1 text-sm text-gray-500">10 provinsi teratas berdasarkan jumlah merchant</p>
      {data.length === 0 ? (
        <div className="flex h-72 items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-400">Belum ada data</p>
            <p className="mt-1 text-xs text-gray-300">Data akan muncul setelah scraping dilakukan</p>
          </div>
        </div>
      ) : (
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
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
                  'Merchant',
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
      )}
    </div>
  );
}
