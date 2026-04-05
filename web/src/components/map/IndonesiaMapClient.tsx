'use client';

import dynamic from 'next/dynamic';

const IndonesiaMap = dynamic(
  () => import('@/components/map/IndonesiaMap'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm">
        <p className="text-sm text-gray-500">Loading map...</p>
      </div>
    ),
  },
);

interface ProvinceMapData {
  provinceCode: string;
  provinceName: string;
  merchantCount: number;
}

export default function IndonesiaMapClient({ data }: { data: ProvinceMapData[] }) {
  return <IndonesiaMap data={data} />;
}
