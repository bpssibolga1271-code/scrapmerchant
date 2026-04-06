'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface PlatformData {
  name: string;
  value: number;
}

interface PlatformPieChartProps {
  data: PlatformData[];
}

const COLORS = [
  '#22c55e', // tokopedia - green
  '#f97316', // shopee - orange
  '#10b981', // grabfood - emerald
  '#ef4444', // gofood - red
  '#3b82f6', // lazada - blue
  '#6366f1', // blibli - indigo
];

export default function PlatformPieChart({ data }: PlatformPieChartProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Merchant per Platform</h3>
      <p className="mt-1 text-sm text-gray-500">Distribusi lintas platform e-commerce</p>
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
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  Number(value ?? 0).toLocaleString(),
                  'Merchant',
                ]}
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value: string) => (
                  <span className="text-sm text-gray-600">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
