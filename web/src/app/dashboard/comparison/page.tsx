'use client';

import { useCallback, useEffect, useState } from 'react';
import PlatformComparison from '@/components/comparison/PlatformComparison';
import CoverageGap from '@/components/comparison/CoverageGap';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Province {
  code: string;
  name: string;
}

interface ComparisonRow {
  regionCode: string;
  regionName: string;
  [platform: string]: string | number;
}

interface CoverageRow {
  regionCode: string;
  regionName: string;
  [platform: string]: string | boolean;
}

interface ComparisonData {
  platforms: string[];
  provinces: Province[];
  regions: Province[];
  comparisonData: ComparisonRow[];
  coverageMatrix: CoverageRow[];
  coverageSummary: Record<string, number>;
  level: string;
  selectedProvince: string | null;
}

export default function ComparisonPage() {
  const [level, setLevel] = useState<'regency' | 'province'>('regency');
  const [provinceCode, setProvinceCode] = useState('72'); // Default Sulawesi Tengah
  const [data, setData] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ level });
      if (level === 'regency') params.set('provinceCode', provinceCode);
      const res = await fetch(`/api/stats/comparison?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch comparison data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [level, provinceCode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedProvinceName = data?.provinces.find((p) => p.code === provinceCode)?.name || '';

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Perbandingan Platform
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {level === 'regency'
              ? `Perbandingan merchant per kabupaten/kota di ${selectedProvinceName}`
              : 'Analisis perbandingan data merchant lintas platform per provinsi'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Level toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setLevel('regency')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                level === 'regency'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Kab/Kota
            </button>
            <button
              onClick={() => setLevel('province')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                level === 'province'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Provinsi
            </button>
          </div>

          {/* Province selector (only in regency mode) */}
          {level === 'regency' && data?.provinces && (
            <Select value={provinceCode} onValueChange={setProvinceCode}>
              <SelectTrigger className="w-55">
                <SelectValue placeholder="Pilih provinsi" />
              </SelectTrigger>
              <SelectContent>
                {data.provinces.map((p) => (
                  <SelectItem key={p.code} value={p.code}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="h-96 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
          <div className="h-64 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
        </div>
      ) : data ? (
        <>
          {/* Platform comparison chart */}
          <PlatformComparison
            platforms={data.platforms}
            comparisonData={data.comparisonData}
            levelLabel={level === 'regency' ? 'Kab/Kota' : 'Provinsi'}
          />

          {/* Coverage gap matrix */}
          <CoverageGap
            platforms={data.platforms}
            coverageMatrix={data.coverageMatrix}
            coverageSummary={data.coverageSummary}
            levelLabel={level === 'regency' ? 'Kab/Kota' : 'Provinsi'}
          />
        </>
      ) : null}
    </div>
  );
}
