import { STORAGE_KEYS } from './constants';
import type { Merchant } from './types';

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const storage = {
  async get<T>(key: StorageKey): Promise<T | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T) ?? null;
  },

  async set<T>(key: StorageKey, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  async getMerchants(platform?: string, regionCode?: string): Promise<Merchant[]> {
    const data =
      (await this.get<Record<string, Record<string, Merchant[]>>>(
        STORAGE_KEYS.scrapedData,
      )) || {};
    const results: Merchant[] = [];
    const platforms = platform ? [platform] : Object.keys(data);

    for (const p of platforms) {
      if (!data[p]) continue;
      const regions = regionCode ? [regionCode] : Object.keys(data[p]);
      for (const r of regions) {
        if (!data[p][r]) continue;
        results.push(...data[p][r]);
      }
    }
    return results;
  },

  async clearMerchants(): Promise<void> {
    await this.set(STORAGE_KEYS.scrapedData, {});
  },
};
