# React Popup Conversion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the Chrome extension popup from vanilla HTML/CSS/JS to React + TypeScript + Tailwind CSS + shadcn/ui while keeping content scripts and service worker untouched.

**Architecture:** Vite builds React app into `extension/popup/` (popup.html + assets). Chrome APIs are accessed via custom hooks that wrap `chrome.storage` and `chrome.runtime`. The service worker and content scripts remain vanilla JS — only the popup UI is React.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react (icons)

**Beads Issue:** se-4r8

---

### Task 1: Initialize Vite + React + TypeScript Project

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/vite-env.d.ts`
- Create: `src/chrome.d.ts`
- Create: `index.html` (Vite entry, builds to `extension/popup/popup.html`)

**Step 1: Initialize project and install dependencies**

```bash
cd /Users/ryanaidilp/Documents/Projects/VsCode/se-merchant-scraper
npm init -y
npm install react react-dom
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/chrome
```

**Step 2: Create vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'extension/popup',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'popup.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'popup.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
```

**Step 3: Create tsconfig files**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

**Step 4: Create entry files**

`index.html` (project root — Vite entry):
```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SE Merchant Scraper</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```

`src/chrome.d.ts`:
```ts
// Chrome extension types — @types/chrome provides these globally
export {};
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`:
```tsx
export default function App() {
  return <div>SE Merchant Scraper</div>;
}
```

**Step 5: Update .gitignore**

Append to existing `.gitignore`:
```
node_modules/
dist/
```

**Step 6: Verify build works**

```bash
npx vite build
```
Expected: Build succeeds, outputs to `extension/popup/`

**Step 7: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json index.html src/ .gitignore
git commit -m "feat: initialize Vite + React + TypeScript project"
```

---

### Task 2: Set Up Tailwind CSS v4 + shadcn/ui

**Files:**
- Create: `src/index.css`
- Create: `components.json`
- Modify: `src/main.tsx` (add CSS import)
- Modify: `package.json` (new deps)

**Step 1: Install Tailwind CSS v4 + shadcn deps**

```bash
npm install tailwindcss @tailwindcss/vite
npm install class-variance-authority clsx tailwind-merge lucide-react
```

**Step 2: Update vite.config.ts to add Tailwind plugin**

Add `tailwindcss` to plugins in `vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ... rest stays same
});
```

**Step 3: Create src/index.css with Tailwind + custom theme**

```css
@import "tailwindcss";

@theme {
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;

  --color-navy-950: #0C2340;
  --color-navy-900: #0f2d52;
  --color-navy-800: #163a5f;
  --color-navy-700: #1e4d7b;
  --color-navy-600: #2a6199;
  --color-navy-50: #eef3f9;

  --color-amber-600: #d97706;
  --color-amber-500: #f59e0b;
  --color-amber-400: #fbbf24;
  --color-amber-100: #fef3c7;
  --color-amber-50: #fffbeb;
}
```

**Step 4: Create src/lib/utils.ts**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 5: Import CSS in main.tsx**

Add `import './index.css';` at top of `src/main.tsx`.

**Step 6: Initialize shadcn**

```bash
npx shadcn@latest init
```

When prompted:
- Style: New York
- Base color: Neutral
- CSS variables: Yes

This creates `components.json` and updates `src/index.css`.

**Step 7: Install core shadcn components**

```bash
npx shadcn@latest add button card input label tabs badge table select separator command popover dialog progress textarea
```

**Step 8: Verify build**

```bash
npx vite build
```

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: set up Tailwind CSS v4 + shadcn/ui components"
```

---

### Task 3: Create Types + Constants Module

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/lib/types.ts`

**Step 1: Create src/lib/types.ts**

Port the types from `extension/lib/constants.js`:

```ts
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
```

**Step 2: Create src/lib/constants.ts**

```ts
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
```

**Step 3: Commit**

```bash
git add src/lib/types.ts src/lib/constants.ts
git commit -m "feat: add TypeScript types and constants"
```

---

### Task 4: Create Chrome API Wrapper Hooks

**Files:**
- Create: `src/hooks/use-storage.ts`
- Create: `src/hooks/use-chrome-message.ts`
- Create: `src/hooks/use-bps-regions.ts`
- Create: `src/lib/storage.ts`

**Step 1: Create src/lib/storage.ts**

Typed wrapper around `chrome.storage.local`:

```ts
import { STORAGE_KEYS } from './constants';
import type { Merchant, ScrapeState } from './types';

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

export const storage = {
  async get<T>(key: StorageKey): Promise<T | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T) ?? null;
  },

  async set<T>(key: StorageKey, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },

  async getMerchants(platform?: string, regionCode?: string): Promise<Merchant[]> {
    const data = (await this.get<Record<string, Record<string, Merchant[]>>>(STORAGE_KEYS.scrapedData)) || {};
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
```

**Step 2: Create src/hooks/use-storage.ts**

```ts
import { useState, useEffect, useCallback } from 'react';
import { storage } from '@/lib/storage';
import type { STORAGE_KEYS } from '@/lib/constants';

type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

export function useStorage<T>(key: StorageKey, defaultValue: T) {
  const [value, setValue] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storage.get<T>(key).then((stored) => {
      if (stored !== null) setValue(stored);
      setLoading(false);
    });
  }, [key]);

  const update = useCallback(async (newValue: T) => {
    setValue(newValue);
    await storage.set(key, newValue);
  }, [key]);

  return [value, update, loading] as const;
}
```

**Step 3: Create src/hooks/use-chrome-message.ts**

```ts
import { useEffect } from 'react';

type MessageHandler = (message: Record<string, unknown>) => void;

export function useChromeMessage(handler: MessageHandler) {
  useEffect(() => {
    const listener = (message: Record<string, unknown>) => {
      handler(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [handler]);
}

export async function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
```

**Step 4: Create src/hooks/use-bps-regions.ts**

```ts
import { useState, useCallback } from 'react';
import { BPS_API_BASE, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import type { BpsRegion } from '@/lib/types';

export function useBpsRegions() {
  const [provinces, setProvinces] = useState<BpsRegion[]>([]);
  const [regencies, setRegencies] = useState<BpsRegion[]>([]);
  const [districts, setDistricts] = useState<BpsRegion[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRegions = useCallback(async (level?: string, parentCode?: string): Promise<BpsRegion[]> => {
    const cacheKey = level ? `${level}_${parentCode}` : 'provinsi';
    const cache = (await storage.get<Record<string, BpsRegion[]>>(STORAGE_KEYS.regionsCache)) || {};

    if (cache[cacheKey]) return cache[cacheKey];

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
  }, []);

  const loadProvinces = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRegions();
      setProvinces(data);
    } catch { setProvinces([]); }
    setLoading(false);
  }, [fetchRegions]);

  const loadRegencies = useCallback(async (provinceCode: string) => {
    setRegencies([]);
    setDistricts([]);
    if (!provinceCode) return;
    setLoading(true);
    try {
      const data = await fetchRegions('kabupaten', provinceCode);
      setRegencies(data);
    } catch { setRegencies([]); }
    setLoading(false);
  }, [fetchRegions]);

  const loadDistricts = useCallback(async (regencyCode: string) => {
    setDistricts([]);
    if (!regencyCode) return;
    setLoading(true);
    try {
      const data = await fetchRegions('kecamatan', regencyCode);
      setDistricts(data);
    } catch { setDistricts([]); }
    setLoading(false);
  }, [fetchRegions]);

  return { provinces, regencies, districts, loading, loadProvinces, loadRegencies, loadDistricts };
}
```

**Step 5: Commit**

```bash
git add src/lib/storage.ts src/hooks/
git commit -m "feat: add Chrome API wrapper hooks"
```

---

### Task 5: Build App Layout + Tab Navigation

**Files:**
- Create: `src/components/sidebar.tsx`
- Create: `src/tabs/scraper-tab.tsx` (placeholder)
- Create: `src/tabs/preview-tab.tsx` (placeholder)
- Create: `src/tabs/settings-tab.tsx` (placeholder)
- Modify: `src/App.tsx`

**Step 1: Create sidebar component**

`src/components/sidebar.tsx`:
```tsx
import { Layers, Search, Table2, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  status: 'idle' | 'processing' | 'done';
  badgeCount: number;
}

const NAV_ITEMS = [
  { id: 'scraper', label: 'Scraper', icon: Search },
  { id: 'preview', label: 'Data', icon: Table2 },
  { id: 'settings', label: 'Pengaturan', icon: Settings },
] as const;

export function Sidebar({ activeTab, onTabChange, status, badgeCount }: SidebarProps) {
  return (
    <aside className="flex flex-col w-[200px] bg-navy-950 text-white border-r border-navy-800">
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-navy-800">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400">
          <Layers className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold tracking-wide text-white/90">Sensus Ekonomi</span>
          <span className="text-[10px] font-bold text-amber-400">2026</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-2 py-3 flex-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              activeTab === id
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:bg-white/5 hover:text-white/80'
            )}
          >
            <Icon className="w-[18px] h-[18px]" />
            <span>{label}</span>
            {id === 'preview' && badgeCount > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-amber-500 text-navy-950 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {badgeCount > 999 ? '999+' : badgeCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-navy-800">
        <div className="flex items-center gap-2">
          <span className={cn(
            'w-2 h-2 rounded-full',
            status === 'idle' && 'bg-gray-400',
            status === 'processing' && 'bg-amber-400 animate-pulse',
            status === 'done' && 'bg-green-400',
          )} />
          <span className="text-xs text-white/50">
            {status === 'idle' ? 'Siap' : status === 'processing' ? 'Memproses...' : 'Selesai'}
          </span>
        </div>
      </div>
    </aside>
  );
}
```

**Step 2: Create tab placeholders**

`src/tabs/scraper-tab.tsx`:
```tsx
export function ScraperTab() {
  return <div>Scraper Tab (WIP)</div>;
}
```

`src/tabs/preview-tab.tsx`:
```tsx
export function PreviewTab() {
  return <div>Preview Tab (WIP)</div>;
}
```

`src/tabs/settings-tab.tsx`:
```tsx
export function SettingsTab() {
  return <div>Settings Tab (WIP)</div>;
}
```

**Step 3: Wire up App.tsx**

```tsx
import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/sidebar';
import { ScraperTab } from '@/tabs/scraper-tab';
import { PreviewTab } from '@/tabs/preview-tab';
import { SettingsTab } from '@/tabs/settings-tab';
import { storage } from '@/lib/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('scraper');
  const [status, setStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [badgeCount, setBadgeCount] = useState(0);

  useEffect(() => {
    storage.getMerchants().then((m) => setBadgeCount(m.length));
  }, [activeTab]);

  return (
    <div className="flex h-screen w-[780px] bg-navy-50 font-sans text-gray-900">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
        badgeCount={badgeCount}
      />
      <main className="flex-1 overflow-y-auto p-5">
        {activeTab === 'scraper' && <ScraperTab onStatusChange={setStatus} onDataChange={() => storage.getMerchants().then((m) => setBadgeCount(m.length))} />}
        {activeTab === 'preview' && <PreviewTab />}
        {activeTab === 'settings' && <SettingsTab onDataChange={() => storage.getMerchants().then((m) => setBadgeCount(m.length))} />}
      </main>
    </div>
  );
}
```

**Step 4: Verify build**

```bash
npx vite build
```

**Step 5: Commit**

```bash
git add src/
git commit -m "feat: add app layout with sidebar and tab navigation"
```

---

### Task 6: Build ScraperTab with Combobox Dropdowns

**Files:**
- Create: `src/components/region-combobox.tsx`
- Create: `src/components/platform-grid.tsx`
- Create: `src/components/scrape-progress.tsx`
- Create: `src/components/scrape-results.tsx`
- Modify: `src/tabs/scraper-tab.tsx`

**Step 1: Create region-combobox.tsx**

A searchable combobox using shadcn's Command + Popover:

```tsx
import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { BpsRegion } from '@/lib/types';

interface RegionComboboxProps {
  label: string;
  placeholder: string;
  regions: BpsRegion[];
  value: string;
  onChange: (code: string, name: string) => void;
  disabled?: boolean;
}

function titleCase(str: string) {
  return str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function RegionCombobox({ label, placeholder, regions, value, onChange, disabled }: RegionComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = regions.find((r) => r.kode_bps === value);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || regions.length === 0}
            className="w-full justify-between font-normal bg-white border-gray-200 text-left"
          >
            {selected ? titleCase(selected.nama_bps) : placeholder}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Cari ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>Tidak ditemukan.</CommandEmpty>
              <CommandGroup>
                {regions.map((region) => (
                  <CommandItem
                    key={region.kode_bps}
                    value={region.nama_bps}
                    onSelect={() => {
                      onChange(region.kode_bps, titleCase(region.nama_bps));
                      setOpen(false);
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === region.kode_bps ? 'opacity-100' : 'opacity-0')} />
                    {titleCase(region.nama_bps)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

**Step 2: Create platform-grid.tsx**

```tsx
import { cn } from '@/lib/utils';
import { PLATFORMS } from '@/lib/constants';

interface PlatformGridProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
  disabled?: boolean;
}

export function PlatformGrid({ selected, onChange, disabled }: PlatformGridProps) {
  const allKeys = Object.keys(PLATFORMS);
  const allSelected = allKeys.every((k) => selected.includes(k));

  function toggle(key: string) {
    if (disabled) return;
    onChange(
      selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key]
    );
  }

  function toggleAll() {
    if (disabled) return;
    onChange(allSelected ? [] : [...allKeys]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Platform</h2>
        <button
          onClick={toggleAll}
          disabled={disabled}
          className="text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
        >
          {allSelected ? 'Batal Semua' : 'Pilih Semua'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {allKeys.map((key) => {
          const platform = PLATFORMS[key];
          const isChecked = selected.includes(key);
          return (
            <label
              key={key}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm',
                isChecked
                  ? 'border-amber-400 bg-amber-50 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(key)}
                disabled={disabled}
                className="sr-only"
              />
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: platform.color }}
              />
              <span className="font-medium">{platform.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 3: Create scrape-progress.tsx**

```tsx
import { cn } from '@/lib/utils';
import { PLATFORMS } from '@/lib/constants';
import { Progress } from '@/components/ui/progress';

interface ScrapeProgressProps {
  platforms: string[];
  currentIndex: number;
  label: string;
  done: boolean;
  captcha: boolean;
}

export function ScrapeProgress({ platforms, currentIndex, label, done, captcha }: ScrapeProgressProps) {
  const pct = done ? 100 : Math.round((currentIndex / platforms.length) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-sm font-medium',
          captcha ? 'text-amber-600' : 'text-gray-700'
        )}>
          {label}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn('h-2', captcha && '[&>div]:bg-amber-500 [&>div]:animate-pulse')}
      />
      <div className="flex flex-wrap gap-1.5">
        {platforms.map((key, i) => (
          <span
            key={key}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full font-medium',
              done || i < currentIndex
                ? 'bg-green-100 text-green-700'
                : i === currentIndex && !done
                ? 'bg-amber-100 text-amber-700 animate-pulse'
                : 'bg-gray-100 text-gray-500'
            )}
          >
            {PLATFORMS[key]?.name ?? key}
          </span>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Create scrape-results.tsx**

```tsx
import { PLATFORMS } from '@/lib/constants';
import type { Merchant } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

interface ScrapeResultsProps {
  results: Record<string, Merchant[]>;
}

export function ScrapeResults({ results }: ScrapeResultsProps) {
  const grandTotal = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-semibold">Scraping selesai! Data siap diekspor.</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1.5 font-medium text-gray-500">Platform</th>
              <th className="text-right py-1.5 font-medium text-gray-500">Merchant</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(results).map(([platform, merchants]) => (
              <tr key={platform} className="border-b border-gray-100">
                <td className="py-1.5">{PLATFORMS[platform]?.name ?? platform}</td>
                <td className="text-right py-1.5 font-medium">{merchants.length.toLocaleString('id-ID')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm font-semibold text-right">
          Total: {grandTotal.toLocaleString('id-ID')} merchant
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 5: Build the full ScraperTab**

`src/tabs/scraper-tab.tsx` — wires together all the above components with the region combobox, platform grid, scraping logic, progress, results, and export buttons. Ports the logic from the existing `popup.js` `startScraping()`, `handleScrapeProgress()`, `restoreScrapeState()`, `exportData()`, and `submitToApi()` functions.

This is the largest component. Key behaviors:
- `useEffect` calls `loadProvinces()` on mount
- Province change triggers `loadRegencies()`
- Regency change triggers `loadDistricts()`
- Start button sends `scrapeAll` message
- Listens for `scrapeProgress` and `captcha` messages via `useChromeMessage`
- Results show export buttons (Excel/CSV/JSON) and submit-to-server
- "Scraping Baru" resets to idle and calls `resetScrapeState`

**Step 6: Verify build**

```bash
npx vite build
```

**Step 7: Commit**

```bash
git add src/
git commit -m "feat: build ScraperTab with combobox dropdowns and progress"
```

---

### Task 7: Build SettingsTab with Tag Multi-Input

**Files:**
- Create: `src/components/keyword-tags.tsx`
- Modify: `src/tabs/settings-tab.tsx`

**Step 1: Create keyword-tags.tsx**

A multi-input tag component — type a keyword, press Enter to add as tag, click X to remove:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface KeywordTagsProps {
  value: string[];
  onChange: (keywords: string[]) => void;
}

export function KeywordTags({ value, onChange }: KeywordTagsProps) {
  const [input, setInput] = useState('');

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      const keyword = input.trim().toLowerCase();
      if (!value.includes(keyword)) {
        onChange([...value, keyword]);
      }
      setInput('');
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(keyword: string) {
    onChange(value.filter((k) => k !== keyword));
  }

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-600">Kata Kunci Pencarian</label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-lg bg-white min-h-[80px] focus-within:ring-2 focus-within:ring-amber-400/50 focus-within:border-amber-400">
        {value.map((keyword) => (
          <Badge key={keyword} variant="secondary" className="gap-1 text-xs">
            {keyword}
            <button onClick={() => remove(keyword)} className="hover:text-red-500">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Ketik kata kunci, tekan Enter...' : 'Tambah...'}
          className="flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 p-0 h-7 text-sm"
        />
      </div>
      <p className="text-xs text-gray-400">Tekan Enter untuk menambah. Backspace untuk menghapus terakhir.</p>
    </div>
  );
}
```

**Step 2: Build full SettingsTab**

`src/tabs/settings-tab.tsx` — ports from existing popup.js settings logic:
- API URL input with Test Connection and Save buttons
- `KeywordTags` component for search keywords with Save and Reset Default
- Data management section with Clear Cache and Clear Data buttons
- Clear Data calls `clearMerchants()` + `resetScrapeState` + notifies parent via `onDataChange`
- Toast notifications using shadcn's approach (simple state-driven div)

**Step 3: Commit**

```bash
git add src/
git commit -m "feat: build SettingsTab with tag multi-input for keywords"
```

---

### Task 8: Build PreviewTab with DataTable

**Files:**
- Modify: `src/tabs/preview-tab.tsx`

**Step 1: Build PreviewTab**

Ports from existing popup.js preview logic:
- Stats row showing total merchants and platform count
- Platform filter (shadcn Select) and search input
- shadcn Table with columns: #, Platform, Nama, Wilayah, Kategori, Rating
- Pagination (prev/next buttons with page info)
- Empty state when no data
- Loads data from `storage.getMerchants()` on mount

**Step 2: Commit**

```bash
git add src/
git commit -m "feat: build PreviewTab with data table and pagination"
```

---

### Task 9: Configure Vite Build Output + Update Manifest

**Files:**
- Modify: `vite.config.ts` (finalize build config)
- Modify: `extension/manifest.json` (no popup default, opened via service worker)
- Modify: `index.html` (include xlsx.full.min.js script tag)

**Step 1: Finalize vite.config.ts**

Ensure the build output places `popup.html` correctly. The existing service worker opens `popup/popup.html` via `chrome.runtime.getURL()` — the built HTML must be at that path.

Key config: Set `build.outDir` to `extension/popup`, configure rollup to output `popup.js` and `popup.css`. Copy the Google Fonts link into the built HTML template.

**Step 2: Update index.html**

Add the xlsx script tag and Google Fonts link to `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="../lib/xlsx.full.min.js"></script>
```

Note: The XLSX lib must be loaded as a script tag (not imported) since it's a pre-bundled UMD file in `extension/lib/`. Add a global type declaration for it.

**Step 3: Build and verify**

```bash
npx vite build
```

Verify `extension/popup/popup.html` exists and contains the React app.

**Step 4: Test in Chrome**

Load the unpacked extension in Chrome, click the icon, verify the popup opens with the React UI.

**Step 5: Add build script to package.json**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: configure Vite build output for Chrome extension popup"
```

---

### Task 10: Final Integration Test

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Load extension in Chrome**

- Go to `chrome://extensions`
- Enable Developer mode
- Load unpacked from `extension/` folder
- Click extension icon — popup should open as tab

**Step 3: Verify all features**

- [ ] Province/Regency/District comboboxes load and filter
- [ ] Platform checkboxes toggle correctly
- [ ] Start scraping sends message to service worker
- [ ] Progress bar updates during scraping
- [ ] CAPTCHA detection focuses tab and shows warning
- [ ] Results display with merchant counts
- [ ] Export buttons (Excel/CSV/JSON) work
- [ ] Submit to server works
- [ ] Data preview tab shows merchants with pagination
- [ ] Settings: API URL save/test
- [ ] Settings: Keyword tags add/remove/save/reset
- [ ] Settings: Clear data resets UI to idle

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete React + TypeScript popup conversion"
```

**Step 5: Update Beads issue**

```bash
bd update se-4r8 --status closed
bd comment se-4r8 "Popup converted to React + TypeScript + Tailwind + shadcn/ui. All features ported."
```
