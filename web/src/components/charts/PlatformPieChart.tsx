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
  '#ec4899', // zalora - pink
];

const MOCK_DATA: PlatformData[] = [
  { name: 'Tokopedia', value: 4200 },
  { name: 'Shopee', value: 3800 },
  { name: 'GrabFood', value: 2100 },
  { name: 'GoFood', value: 1900 },
  { name: 'Lazada', value: 1200 },
  { name: 'Blibli', value: 800 },
  { name: 'Zalora', value: 400 },
];

export default function PlatformPieChart({ data }: PlatformPieChartProps) {
  const chartData = data.length > 0 ? data : MOCK_DATA;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Merchants by Platform</h3>
      <p className="mt-1 text-sm text-gray-500">Distribution across e-commerce platforms</p>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
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
    </div>
  );
}
