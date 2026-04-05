import { useState, useCallback } from 'react';
import { BPS_API_BASE, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import type { BpsRegion } from '@/lib/types';

export function useBpsRegions() {
  const [provinces, setProvinces] = useState<BpsRegion[]>([]);
  const [regencies, setRegencies] = useState<BpsRegion[]>([]);
  const [districts, setDistricts] = useState<BpsRegion[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRegions = useCallback(
    async (level?: string, parentCode?: string): Promise<BpsRegion[]> => {
      const cacheKey = level ? `${level}_${parentCode}` : 'provinsi';
      const cache =
        (await storage.get<Record<string, BpsRegion[]>>(
          STORAGE_KEYS.regionsCache,
        )) || {};

      if (cache[cacheKey]) return cache[cacheKey]!;

      const params = new URLSearchParams();
      if (level) params.set('level', level);
      if (parentCode) params.set('parent', parentCode);
      const url = level ? `${BPS_API_BASE}?${params}` : BPS_API_BASE;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: BpsRegion[] = await response.json();

      cache[cacheKey] = data;
      await storage.set(STORAGE_KEYS.regionsCache, cache);
      return data;
    },
    [],
  );

  const loadProvinces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRegions();
      setProvinces(data);
    } catch {
      setProvinces([]);
    }
    setLoading(false);
  }, [fetchRegions]);

  const loadRegencies = useCallback(
    async (provinceCode: string) => {
      setRegencies([]);
      setDistricts([]);
      if (!provinceCode) return;
      setLoading(true);
      try {
        const data = await fetchRegions('kabupaten', provinceCode);
        setRegencies(data);
      } catch {
        setRegencies([]);
      }
      setLoading(false);
    },
    [fetchRegions],
  );

  const loadDistricts = useCallback(
    async (regencyCode: string) => {
      setDistricts([]);
      if (!regencyCode) return;
      setLoading(true);
      try {
        const data = await fetchRegions('kecamatan', regencyCode);
        setDistricts(data);
      } catch {
        setDistricts([]);
      }
      setLoading(false);
    },
    [fetchRegions],
  );

  return {
    provinces,
    regencies,
    districts,
    loading,
    loadProvinces,
    loadRegencies,
    loadDistricts,
  };
}
