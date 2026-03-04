'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface TrendData {
  date: string;
  merchants: number;
}

interface TrendLineChartProps {
  data: TrendData[];
}

const MOCK_DATA: TrendData[] = [
  { date: 'Jan 2026', merchants: 1200 },
  { date: 'Feb 2026', merchants: 2400 },
  { date: 'Mar 2026', merchants: 3100 },
  { date: 'Apr 2026', merchants: 4800 },
  { date: 'May 2026', merchants: 5600 },
  { date: 'Jun 2026', merchants: 7200 },
  { date: 'Jul 2026', merchants: 8900 },
  { date: 'Aug 2026', merchants: 10500 },
  { date: 'Sep 2026', merchants: 11800 },
  { date: 'Oct 2026', merchants: 13200 },
  { date: 'Nov 2026', merchants: 14100 },
  { date: 'Dec 2026', merchants: 14400 },
];

export default function TrendLineChart({ data }: TrendLineChartProps) {
  const chartData = data.length > 0 ? data : MOCK_DATA;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Merchant Scraping Trend</h3>
      <p className="mt-1 text-sm text-gray-500">
        Total merchants scraped over time
      </p>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12 }}
              tickMargin={8}
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value: number) =>
                value >= 1000 ? `${(value / 1000).toFixed(0)}k` : `${value}`
              }
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
            <Legend />
            <Line
              type="monotone"
              dataKey="merchants"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
              name="Merchants Scraped"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
