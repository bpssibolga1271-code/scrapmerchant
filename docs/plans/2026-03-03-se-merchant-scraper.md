# SE Merchant Scraper — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that scrapes merchant data from 7 Indonesian e-commerce platforms with BPS region filtering, plus a Next.js website for data visualization and reporting.

**Architecture:** Chrome Extension (Manifest V3) with per-platform content scripts scrapes merchant data, stores locally in `chrome.storage.local`, and optionally submits to a Next.js API backend. The Next.js website (App Router) connects to self-hosted MySQL via Prisma ORM, provides auth via NextAuth.js, and visualizes data with Leaflet maps, Recharts charts, and TanStack Table.

**Tech Stack:** Chrome Extension (Manifest V3, Vanilla JS, SheetJS), Next.js 14+ (App Router, Tailwind CSS, Prisma, NextAuth.js, Leaflet, Recharts, TanStack Table, ExcelJS), MySQL 8+

---

## BPS Wilayah API Reference

- **Base URL:** `https://sig.bps.go.id/rest-bridging/getwilayah`
- **No auth required** — public endpoint
- **Provinces:** `GET /rest-bridging/getwilayah` (no params)
- **Regencies:** `GET /rest-bridging/getwilayah?level=kabupaten&parent={kode_bps_provinsi}`
- **Districts:** `GET /rest-bridging/getwilayah?level=kecamatan&parent={kode_bps_kabkota}`
- **Response:** JSON array of `{ kode_bps, nama_bps, kode_dagri, nama_dagri }`
- **Kode format:** Province=2 digits, Regency=4 digits, District=7 digits

## Platform Scraping Strategy

| Platform | Approach | Difficulty |
|---|---|---|
| Tokopedia | GraphQL API interception at `gql.tokopedia.com` | Medium |
| Shopee | DOM scraping + `api/v4` response interception | High |
| GrabFood | `__NEXT_DATA__` JSON + `portal.grab.com/foodweb/v2` API | Medium |
| GoFood | City-based URL navigation + DOM scraping | Medium |
| Lazada | DOM scraping on search/store pages | Medium-High |
| Blibli | DOM scraping on search results | Medium-High |
| Zalora | Simple HTML scraping on `/brands/` page | Low |

---

## Phase 1: Chrome Extension

### Task 1: Scaffold Chrome Extension project

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/popup/popup.html`
- Create: `extension/popup/popup.css`
- Create: `extension/popup/popup.js`
- Create: `extension/background/service-worker.js`
- Create: `extension/options/options.html`
- Create: `extension/options/options.js`
- Create: `extension/options/options.css`
- Create: `extension/lib/constants.js`
- Create: `extension/lib/storage.js`
- Create: `extension/content-scripts/.gitkeep`
- Create: `extension/icons/` (placeholder icons)

**Step 1: Create manifest.json (Manifest V3)**

Permissions: `storage`, `activeTab`, `tabs`, `downloads`. Host permissions for BPS API and all 7 marketplace domains. Service worker as background script. Empty content_scripts array (populated per platform later).

**Step 2: Create `lib/constants.js`**

Define `PLATFORMS` object (key, name, domain, color per platform), `BPS_API_BASE` URL, `MERCHANT_FIELDS` array, `STORAGE_KEYS` enum.

**Step 3: Create `lib/storage.js`**

Helper with `get(key)`, `set(key, value)`, `appendMerchants(platform, regionCode, merchants)`, `getMerchants(platform?, regionCode?)`, `clearMerchants()`. All using `chrome.storage.local`.

**Step 4: Create popup.html**

Sections: header, region filter (3 cascading selects), platform checkboxes, action buttons (start scraping), progress bar, results summary, export buttons (Excel/CSV/JSON), optional submit-to-server button.

**Step 5: Create popup.css**

Clean, compact UI at 400px width. Grid layout for platform checkboxes (2 columns). Progress bar with animation. Export buttons in 3-column grid.

**Step 6: Create popup.js**

- `init()` — render platforms, load provinces, setup listeners, check API URL
- `fetchBpsRegions(level?, parentCode?)` — fetch from BPS API with local cache
- `loadProvinces()` / `loadRegencies(code)` / `loadDistricts(code)` — cascading dropdown loaders
- `startScraping()` — iterate selected platforms, send messages to service worker, show progress
- `showResults(results)` — render summary table
- `exportData(format)` — trigger export via service worker (CSV/JSON) or direct (Excel via SheetJS)
- `submitToApi()` — POST to configured API URL

Use safe DOM methods (createElement, textContent) instead of innerHTML for dynamic content to prevent XSS.

**Step 7: Create service-worker.js**

- Message listener for `scrape` and `export` actions
- `handleScrape({ platform, regionCode, regionName })` — dispatch to per-platform scraper function
- `handleExport({ format, merchants })` — convert to CSV/JSON and trigger download
- `convertToCSV(merchants)` — CSV conversion utility
- Scraper stubs: `scrapers.tokopedia()`, `scrapers.shopee()`, etc. — all return empty arrays initially

**Step 8: Create options page (options.html + options.js + options.css)**

Settings: API URL input, Test Connection button, Save button. Data management: Clear cache, Clear scraped data buttons.

**Step 9: Generate placeholder icons and commit**

```bash
git add extension/
git commit -m "feat: scaffold chrome extension project structure"
```

---

### Task 2: Verify BPS Wilayah API integration

Already implemented in Task 1's popup.js. This task verifies it works end-to-end.

**Step 1:** Load unpacked extension in `chrome://extensions`
**Step 2:** Verify provinces load (38 items), regencies cascade, districts cascade
**Step 3:** Verify caching (second load should be instant from `chrome.storage.local`)
**Step 4:** Fix any issues and commit

```bash
git commit -m "fix: BPS Wilayah API integration adjustments"
```

---

### Task 3: Build Tokopedia scraper

**Files:**
- Create: `extension/content-scripts/tokopedia.js`
- Modify: `extension/manifest.json` (add content_scripts entry)
- Modify: `extension/background/service-worker.js` (update scraper function)

**Approach:** Content script on `tokopedia.com`. The service worker opens a Tokopedia search tab with location filter, the content script extracts seller data from product cards using `data-testid` attributes (more stable than obfuscated CSS classes). Communicates results back via `chrome.runtime.sendMessage`.

**Key selectors:**
- Product cards: `div[data-testid="divSRPContentProducts"]`
- Seller name: `a[data-testid="llbPDPFooterShopName"]`
- Use `data-testid` attributes over CSS classes (Tokopedia obfuscates class names)

```bash
git commit -m "feat: add Tokopedia scraper content script"
```

---

### Task 4: Build Shopee scraper

**Files:**
- Create: `extension/content-scripts/shopee.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** Most aggressive anti-scraping. Leverage Chrome extension's legitimate browser context. Intercept `shopee.co.id/api/v4/search/search_items` responses rather than making independent API calls. Use `locations` query parameter for region filtering.

```bash
git commit -m "feat: add Shopee scraper content script"
```

---

### Task 5: Build GrabFood scraper

**Files:**
- Create: `extension/content-scripts/grabfood.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** Parse `__NEXT_DATA__` JSON from `food.grab.com/id/en/restaurants` for initial 8 restaurants. Intercept `portal.grab.com/foodweb/v2/search` POST responses for pagination. Structured JSON data available directly.

```bash
git commit -m "feat: add GrabFood scraper content script"
```

---

### Task 6: Build GoFood scraper

**Files:**
- Create: `extension/content-scripts/gofood.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** Navigate to `gofood.co.id/{city}/restaurants`. Map BPS region names to GoFood city slugs using `gofood.co.id/en/cities` as reference. Scrape restaurant cards from DOM.

```bash
git commit -m "feat: add GoFood scraper content script"
```

---

### Task 7: Build Lazada scraper

**Files:**
- Create: `extension/content-scripts/lazada.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** DOM scraping on `lazada.co.id/catalog/` search results and `/shop/{name}` store pages. Extract seller info from product listing cards.

```bash
git commit -m "feat: add Lazada scraper content script"
```

---

### Task 8: Build Blibli scraper

**Files:**
- Create: `extension/content-scripts/blibli.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** DOM scraping on `blibli.com/cari/{keyword}` search results. Extract merchant data from product cards. May also check `/pages/merchant-corner`.

```bash
git commit -m "feat: add Blibli scraper content script"
```

---

### Task 9: Build Zalora scraper

**Files:**
- Create: `extension/content-scripts/zalora.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background/service-worker.js`

**Approach:** Simplest platform. Scrape `/brands/` page for brand directory using `<ul>/<li>/<a>` elements. For each brand, navigate to `/c/{brand-slug}/b-{brand-id}` for details. Zalora is fashion-focused so "merchants" are "brands".

```bash
git commit -m "feat: add Zalora scraper content script"
```

---

### Task 10: Implement Excel export with SheetJS

**Files:**
- Create: `extension/lib/xlsx.full.min.js` (download from SheetJS CDN)
- Modify: `extension/popup/popup.html` (add SheetJS script tag)
- Modify: `extension/popup/popup.js` (update exportData for Excel)

**Step 1:** Download SheetJS library to `extension/lib/`

**Step 2:** Implement `exportExcel(merchants)` in popup.js:
- Create workbook with one sheet per platform + combined "Semua Platform" sheet
- Use `XLSX.utils.json_to_sheet()` and `XLSX.writeFile()`

**Step 3:** CSV and JSON export already handled in service-worker.js

```bash
git commit -m "feat: add Excel/CSV/JSON export from extension"
```

---

## Phase 2: Next.js Website

### Task 11: Scaffold Next.js project

**Step 1:** Create Next.js app

```bash
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

**Step 2:** Install dependencies

```bash
npm install prisma @prisma/client next-auth @auth/prisma-adapter
npm install recharts leaflet react-leaflet @types/leaflet
npm install @tanstack/react-table exceljs
npm install bcryptjs @types/bcryptjs
```

**Step 3:** Initialize Prisma

```bash
npx prisma init --datasource-provider mysql
```

```bash
git commit -m "feat: scaffold Next.js website project"
```

---

### Task 12: Design MySQL schema with Prisma

**Files:**
- Modify: `web/prisma/schema.prisma`

**Models:**
- `Region` — id, code (unique, varchar 10), name, level (enum: province/regency/district), parentId (self-relation). Indexes on (code, level) and (parentId).
- `Merchant` — id, regionId (FK), platform (enum), name, address, category, phone, rating, productCount, joinDate, monthlySales, totalTransactions, operatingHours, socialMediaLinks (Json), ownerName, sourceUrl, createdAt, updatedAt. Index on (regionId, platform).
- `ScrapeSession` — id, userId (FK), regionId (FK), platform, totalMerchants, status (enum: running/completed/failed), startedAt, completedAt.
- `User` — id, name, email (unique), passwordHash, role (enum: admin/staff), createdAt.

```bash
npx prisma migrate dev --name init
git commit -m "feat: add Prisma schema for merchants, regions, users"
```

---

### Task 13: Seed regions from BPS Wilayah API

**Files:**
- Create: `web/prisma/seed.ts`
- Modify: `web/package.json` (add prisma.seed config)

Seed script fetches all provinces, then all regencies per province, then all districts per regency from BPS API. Inserts into regions table with parent_id hierarchy. Uses `upsert` for idempotency.

```bash
npx prisma db seed
git commit -m "feat: add BPS region seed script"
```

---

### Task 14: Build API routes

**Files:**
- Create: `web/src/lib/prisma.ts` (singleton Prisma client)
- Create: `web/src/app/api/health/route.ts`
- Create: `web/src/app/api/merchants/route.ts` (GET with filters, POST for ingestion)
- Create: `web/src/app/api/regions/route.ts` (GET hierarchy)
- Create: `web/src/app/api/scrape-sessions/route.ts`

```bash
git commit -m "feat: add API routes for merchants, regions, scrape sessions"
```

---

### Task 15: Build authentication

**Files:**
- Create: `web/src/lib/auth.ts` (NextAuth config)
- Create: `web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `web/src/app/login/page.tsx`
- Create: `web/src/middleware.ts` (protect routes)

NextAuth.js with credentials provider (email/password + bcrypt). Session-based auth. Middleware to protect all routes except `/login` and `/api/health`.

```bash
git commit -m "feat: add NextAuth.js authentication system"
```

---

### Task 16: Build dashboard page

**Files:**
- Create/Modify: `web/src/app/page.tsx` (redirect to dashboard or be dashboard)
- Create: `web/src/app/dashboard/page.tsx`
- Create: `web/src/components/charts/PlatformPieChart.tsx` (Recharts)
- Create: `web/src/components/charts/ProvinceBarChart.tsx` (Recharts)
- Create: `web/src/components/charts/TrendLineChart.tsx` (Recharts)
- Create: `web/src/components/map/IndonesiaMap.tsx` (Leaflet + GeoJSON choropleth)
- Create: `web/src/components/dashboard/StatsCard.tsx`
- Create: `web/src/components/dashboard/RecentSessions.tsx`

Indonesia GeoJSON for province boundaries. Choropleth coloring by merchant density.

```bash
git commit -m "feat: add dashboard with map and charts"
```

---

### Task 17: Build data explorer page

**Files:**
- Create: `web/src/app/explorer/page.tsx`
- Create: `web/src/components/explorer/MerchantTable.tsx` (TanStack Table)
- Create: `web/src/components/explorer/FilterPanel.tsx`
- Create: `web/src/components/explorer/MerchantDetail.tsx`
- Create: `web/src/components/explorer/ExportButton.tsx` (ExcelJS)

Filterable, sortable data table. Filters: province, regency, district, platform, category, date range. Search by merchant name. Bulk export.

```bash
git commit -m "feat: add data explorer page with filterable table"
```

---

### Task 18: Build comparison page

**Files:**
- Create: `web/src/app/comparison/page.tsx`
- Create: `web/src/components/comparison/PlatformComparison.tsx`
- Create: `web/src/components/comparison/CoverageGap.tsx`

Side-by-side charts comparing merchant counts across platforms per region. Platform coverage gap analysis.

```bash
git commit -m "feat: add cross-platform comparison page"
```

---

### Task 19: Build reports page

**Files:**
- Create: `web/src/app/reports/page.tsx`
- Create: `web/src/app/api/reports/route.ts`
- Create: `web/src/components/reports/ReportGenerator.tsx`

Pre-built BPS-compatible report templates. Generate per-region reports. Export as Excel (ExcelJS) or PDF.

```bash
git commit -m "feat: add reports page with BPS-compatible exports"
```

---

### Task 20: Build admin settings page

**Files:**
- Create: `web/src/app/settings/page.tsx`
- Create: `web/src/components/settings/UserManagement.tsx`

User CRUD (admin only), role assignment.

```bash
git commit -m "feat: add admin settings and user management page"
```

---

## Execution Order

**Parallel Track A (Chrome Extension):** Task 1 → Task 2 → Tasks 3-9 (parallel per platform) → Task 10

**Parallel Track B (Website):** Task 11 → Task 12 → Task 13 → Task 14 → Task 15 → Tasks 16-17 (parallel) → Tasks 18-20 (parallel)

Track A and B can be worked on simultaneously. The Chrome extension can be used standalone (offline export) before the website is ready.
