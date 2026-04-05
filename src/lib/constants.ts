import type { Platform } from './types';

export const PLATFORMS: Record<string, Platform> = {
  tokopedia: { name: 'Tokopedia', domain: 'tokopedia.com', color: '#42b549' },
  shopee: { name: 'Shopee', domain: 'shopee.co.id', color: '#ee4d2d' },
  grabfood: { name: 'GrabFood', domain: 'food.grab.com', color: '#00b14f' },
  gofood: { name: 'GoFood', domain: 'gofood.co.id', color: '#00aa13' },
  lazada: { name: 'Lazada', domain: 'lazada.co.id', color: '#0f146d' },
  blibli: { name: 'Blibli', domain: 'blibli.com', color: '#0095da' },
};

export const BPS_API_BASE = 'https://sig.bps.go.id/rest-bridging/getwilayah';

export const MERCHANT_FIELDS = [
  'platform', 'merchantName', 'merchantUrl', 'merchantId', 'address',
  'provinceCode', 'provinceName', 'regencyCode', 'regencyName',
  'districtCode', 'districtName', 'category', 'rating', 'totalProducts',
  'totalSold', 'joinDate', 'isOfficialStore', 'phone', 'description', 'scrapedAt',
] as const;

export const DEFAULT_SEARCH_KEYWORDS = ['shop', 'store', 'toko', 'olshop', 'grosir'];

export const STORAGE_KEYS = {
  regionsCache: 'regions_cache',
  scrapedData: 'scraped_data',
  apiUrl: 'api_url',
  scrapeSessions: 'scrape_sessions',
  scrapeState: 'scrape_state',
  searchKeywords: 'search_keywords',
} as const;
