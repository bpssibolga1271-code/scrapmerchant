export interface Platform {
  name: string;
  domain: string;
  color: string;
}

export interface BpsRegion {
  kode_bps: string;
  nama_bps: string;
}

export interface RegionSelection {
  province: { code: string; name: string } | null;
  regency: { code: string; name: string } | null;
  district: { code: string; name: string } | null;
}

export interface Merchant {
  platform: string;
  merchantName: string;
  merchantUrl: string;
  merchantId: string;
  address: string;
  provinceCode: string;
  provinceName: string;
  regencyCode: string;
  regencyName: string;
  districtCode: string;
  districtName: string;
  category: string;
  rating: number | null;
  totalProducts: number | null;
  totalSold: number | null;
  joinDate: string;
  isOfficialStore: boolean;
  phone: string;
  description: string;
  scrapedAt: string;
}

export interface ScrapeState {
  status: 'idle' | 'running' | 'done';
  platforms?: string[];
  currentIndex?: number;
  results?: Record<string, Merchant[]>;
}
