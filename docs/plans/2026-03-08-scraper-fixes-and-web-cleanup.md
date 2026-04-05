# Scraper Fixes & Web Cleanup Implementation Plan

**Goal:** Fix broken Tokopedia and Shopee scrapers using verified DOM structures, remove Zalora, and replace native selects with shadcn Select.

**Architecture:** Content scripts extract merchant data from DOM using verified element selectors (confirmed via Playwright). Service worker orchestrates scraping and resolves BPS regency codes from card location text.

**Tech Stack:** Chrome Extension (Manifest V3), vanilla JS content scripts, Next.js + shadcn/ui web dashboard, BPS API for region data.

---

## Task 1: Fix Tokopedia Content Script — Name/Location Extraction

**Problem:** Shop names have location text concatenated (e.g., "Cek'out shopKab. Donggala"). Region codes show province-level (72) instead of regency.

**Root Cause:** `extractShopCards()` Strategy 2 uses `link.textContent` which concatenates all child text (name + location + "Lihat Toko"). The `extractShopInfoFromCard()` Strategy 1 uses `data-testid` selectors that don't exist in current Tokopedia DOM.

**Verified DOM Structure (Playwright, 2026-03-08):**
```
<a href="/shop-slug">              ← shop card link
  <img alt="shop"/>                ← shop avatar
  <div>                            ← content wrapper (ref=e153)
    <div>TokoneAan</div>           ← SHOP NAME (first child div, ref=e155)
    <div>Palu</div>                ← LOCATION (second child div, ref=e156)
    <img alt="reputation"/>        ← reputation badge
  </div>
  <button>Lihat Toko</button>     ← view store button
</a>
```

**Key Insight:** The `<a>` link has 3 direct children: `<img>` (avatar), `<div>` (content wrapper), `<button>` (Lihat Toko). The content wrapper has children: `<div>` (name), `<div>` (location), `<img>` (reputation).

**Files:**
- Modify: `extension/content-scripts/tokopedia.js` (functions: `extractShopInfoFromCard`, `extractShopNameFromLink`, `extractLocationFromContainer`)

**Changes:**

### Step 1: Rewrite `extractShopInfoFromCard()` (line 307)

Replace the current data-testid approach with structural DOM traversal:

```javascript
function extractShopInfoFromCard(card) {
  // Find shop link — look for anchor with shop-level URL
  const links = card.querySelectorAll('a[href]');
  let shopLink = null;
  let shopUrl = '';

  for (const link of links) {
    const href = link.href || '';
    try {
      const url = new URL(href);
      if (url.hostname !== 'www.tokopedia.com') continue;
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(segments[0])) {
        const slug = segments[0].toLowerCase();
        const skipPaths = [/* existing skip list */];
        if (!skipPaths.includes(slug)) {
          shopLink = link;
          shopUrl = `https://www.tokopedia.com/${segments[0]}`;
          break;
        }
      }
    } catch { /* skip */ }
  }

  if (!shopLink && !shopUrl) return null;

  // NEW: Structural extraction from verified DOM layout
  // Find the content wrapper div inside the link (not img, not button)
  let name = '';
  let location = '';

  const contentWrapper = findContentWrapper(shopLink);
  if (contentWrapper) {
    const childDivs = Array.from(contentWrapper.children).filter(
      el => el.tagName === 'DIV'
    );
    // First div = shop name, second div = location
    if (childDivs.length >= 1) name = childDivs[0].textContent.trim();
    if (childDivs.length >= 2) location = childDivs[1].textContent.trim();
  }

  // Fallback to existing extraction if structural approach fails
  if (!name) {
    location = extractLocationFromContainer(card);
    name = extractShopNameFromLink(shopLink, card, location);
  }

  if (!name || name.length < 2) return null;

  const isOfficial = checkOfficialBadge(card);
  let reputationImg = '';
  const badgeImgs = card.querySelectorAll('img');
  for (const img of badgeImgs) {
    const src = (img.getAttribute('src') || '').toLowerCase();
    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (src.includes('badge') || src.includes('reputation') ||
        alt.includes('badge') || alt.includes('reputation')) {
      reputationImg = img.getAttribute('src') || '';
      break;
    }
  }

  return { name, url: shopUrl, location, isOfficial, reputationImg };
}

/**
 * Find the content wrapper div inside a shop card link.
 * The link structure: <a> → <img>(avatar) + <div>(wrapper) + <button>(Lihat Toko)
 * The wrapper contains: <div>(name) + <div>(location) + <img>(reputation)
 */
function findContentWrapper(link) {
  if (!link) return null;
  // Look for a direct child div that itself has child divs (the content wrapper)
  for (const child of link.children) {
    if (child.tagName === 'DIV') {
      const hasChildDivs = Array.from(child.children).some(el => el.tagName === 'DIV');
      if (hasChildDivs) return child;
    }
  }
  return null;
}
```

### Step 2: Update Strategy 2 fallback in `extractShopCards()` (line 240-297)

In the structural link detection fallback, apply the same content wrapper approach:

```javascript
// line ~280: Replace name/location extraction
const contentWrapper = findContentWrapper(link);
let name = '';
let location = '';

if (contentWrapper) {
  const childDivs = Array.from(contentWrapper.children).filter(
    el => el.tagName === 'DIV'
  );
  if (childDivs.length >= 1) name = childDivs[0].textContent.trim();
  if (childDivs.length >= 2) location = childDivs[1].textContent.trim();
}

if (!name) {
  name = extractShopNameFromLink(link, container);
}
if (!location) {
  location = extractLocationFromContainer(container);
}
```

### Step 3: Verify `resolveRegencyCodes()` in service-worker.js

The existing `resolveRegencyCodes()` (line 268) should work once location text is properly extracted. It takes the card location (e.g., "Palu", "Kab. Donggala") and matches against BPS regency names. It's already called at line 155 after scraping completes. No changes needed here — just verify it works with clean location text.

---

## Task 2: Fix Shopee Content Script — Card Detection & Location Extraction

**Problem:** Shopee scraper returns 0 merchants because `findShopLinks()` can't find any shop URLs on the search results page. Cards only have product links, not shop links.

**Root Cause:**
1. `findShopLinks()` looks for `shopee.co.id/{username}` or `shopee.co.id/shop/{id}` — but search results only have PRODUCT links
2. `findProductCards()` Strategy 1 uses outdated selectors (`div.shopee-search-item-result__items`)
3. Shop ID must be extracted from product URL pattern: `-i.{shopId}.{itemId}`

**Verified DOM Structure (Playwright, 2026-03-08):**
```
list [ref=e417]:                           ← results container
  listitem [ref=e418]:                     ← PRODUCT CARD
    generic [ref=e420]:
      link [ref=e421]:                     ← product link
        /url: /Product-Title-i.{shopId}.{itemId}?...
        generic [ref=e422]:
          generic [ref=e423]:              ← image section
            ...
          generic [ref=e425]:              ← info section
            generic [ref=e426]:
              img [ref=e427]               ← Star/Mall badge (optional)
              text: "Product Title"        ← PRODUCT NAME
            generic [ref=e431]:            ← price section
              ...
            generic [ref=e439]:            ← LOCATION
              img                          ← pin icon
              text: Palu                   ← LOCATION TEXT
      link [ref=e440]:                     ← "Produk Serupa" link
        /url: /find_similar_products?catid=...&itemid=...&shopid={SHOP_ID}
        text: Produk Serupa
```

**Key Insights:**
- Product URL pattern: `/{Title}-i.{shopId}.{itemId}` → shop URL = `shopee.co.id/shop/{shopId}`
- "Produk Serupa" link has explicit `shopid` query param
- Location element: a `<div>` with `<img>` (pin icon) + text (city name)
- Cards are `<li>` (listitem) elements inside a `<ul>` (list)
- No `data-testid` or stable classes — must use structural patterns

**Files:**
- Modify: `extension/content-scripts/shopee.js` (functions: `findProductCards`, `extractShopInfo`, `extractLocation`, `isShopUrl`, `extractShopId`)

**Changes:**

### Step 1: Add product URL helpers

```javascript
/**
 * Extract shopId from a Shopee product URL.
 * Pattern: /{Title}-i.{shopId}.{itemId}
 */
function extractShopIdFromProductUrl(href) {
  if (!href) return null;
  // Match -i.{digits}.{digits}
  const match = href.match(/-i\.(\d+)\.\d+/);
  return match ? match[1] : null;
}

/**
 * Check if a URL is a Shopee product URL.
 */
function isProductUrl(href) {
  if (!href) return false;
  return /-i\.\d+\.\d+/.test(href);
}
```

### Step 2: Rewrite `findProductCards()`

Replace Strategy 1's outdated selectors with `listitem` detection:

```javascript
function findProductCards() {
  // Strategy 1: Find list items that contain product links
  // Shopee renders search results as <li> inside a <ul>
  const allListItems = document.querySelectorAll('li');
  const cards = [];

  for (const li of allListItems) {
    const productLink = li.querySelector('a[href]');
    if (!productLink) continue;
    const href = productLink.href || productLink.getAttribute('href') || '';
    if (isProductUrl(href) || isShopUrl(href)) {
      cards.push(li);
    }
  }

  if (cards.length > 0) return cards;

  // Strategy 2 (existing): walk up from shop/product links to card boundary
  // ... keep existing Strategy 2 code but also check isProductUrl ...
}
```

### Step 3: Rewrite `extractShopInfo()` to use product URLs

```javascript
function extractShopInfo(card) {
  // Strategy 1: Find product link and extract shopId from URL
  const links = card.querySelectorAll('a[href]');
  let shopId = null;
  let shopName = '';

  for (const link of links) {
    const href = link.href || link.getAttribute('href') || '';

    // Check "Produk Serupa" / find_similar_products link for explicit shopid
    if (href.includes('find_similar_products') || href.includes('shopid=')) {
      try {
        const url = new URL(href, 'https://shopee.co.id');
        const sid = url.searchParams.get('shopid');
        if (sid) shopId = sid;
      } catch { /* skip */ }
    }

    // Check product URL for shopId
    if (!shopId) {
      const sid = extractShopIdFromProductUrl(href);
      if (sid) shopId = sid;
    }
  }

  if (!shopId) {
    // Fallback: try existing isShopUrl approach
    for (const link of links) {
      if (isShopUrl(link.href)) {
        return {
          name: link.textContent.trim().substring(0, 100),
          url: link.href.split('?')[0],
        };
      }
    }
    return null;
  }

  // Extract shop name from product title text
  // Product titles often start with "ShopName - ProductTitle"
  const productLink = Array.from(links).find(l => isProductUrl(l.href || ''));
  if (productLink) {
    // Get the product title text
    const allText = productLink.querySelectorAll('*');
    for (const el of allText) {
      if (el.children.length > 0) continue; // skip non-leaf nodes
      const text = el.textContent.trim();
      // Product title is the longest meaningful text (not price, not badge)
      if (text.length > 10 && !text.startsWith('Rp') && !text.includes('Produk Serupa')) {
        shopName = text;
        break;
      }
    }
  }

  return {
    name: shopName || `Shop ${shopId}`,
    url: `https://shopee.co.id/shop/${shopId}`,
  };
}
```

### Step 4: Rewrite `extractLocation()` for verified DOM

```javascript
function extractLocation(card) {
  // Strategy 1: Find element with pin icon (img) followed by short text
  // The location element contains: <img> (pin icon) + text (city name)
  const allElements = card.querySelectorAll('div, span');

  for (const el of allElements) {
    // Check if element has exactly one img child and text content
    const imgs = el.querySelectorAll(':scope > img');
    if (imgs.length !== 1) continue;

    // Get only direct text content (not from child elements)
    let directText = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        directText += node.textContent;
      }
    }
    directText = directText.trim();

    if (directText.length >= 2 && directText.length <= 50 &&
        !directText.includes('Rp') && !directText.includes('%') &&
        !directText.includes('terjual') && !directText.match(/^\d/)) {
      return directText;
    }
  }

  // Strategy 2: Fallback — existing heuristic (position-based)
  // ... keep existing code as fallback ...
}
```

### Step 5: Update `collectMerchantsFromPage()` to handle product-derived shop info

The current function at line 675 already handles the data correctly. Just ensure `extractShopId()` works for the new `shopee.co.id/shop/{id}` URLs.

---

## Task 3: Remove Zalora from Web Files

**Problem:** Zalora is still referenced in web UI dropdowns, charts, and Prisma schema even though the platform is no longer supported.

**Files to modify:**
1. `web/src/components/dashboard/RecentSessions.tsx:40` — remove `zalora` color mapping
2. `web/src/components/reports/ReportGenerator.tsx:41` — remove from platform options
3. `web/src/components/charts/PlatformPieChart.tsx:21` — remove zalora pink color
4. `web/src/app/api/stats/comparison/route.ts:52` — remove from platforms array
5. `web/src/app/dashboard/comparison/page.tsx:26` — remove from platforms array
6. `web/src/components/comparison/CoverageGap.tsx:24` — remove mapping
7. `web/src/components/comparison/PlatformComparison.tsx:40,50` — remove color + label
8. `web/src/components/explorer/FilterPanel.tsx:20` — remove from platform filter
9. `web/prisma/schema.prisma:23` — remove from Platform enum

**Approach:** Simple search-and-remove in each file. Remove the `zalora` entries from arrays, objects, and enums. Leave no empty trailing commas.

---

## Task 4: Replace Native `<select>` with shadcn Select

**Problem:** Several web components still use native `<select>` HTML elements instead of the shadcn Select component.

**shadcn Select usage pattern:**
```tsx
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Choose..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

**Files to modify:**

1. **`web/src/components/settings/UserManagement.tsx`** — 1 select (role selector)
2. **`web/src/components/explorer/MerchantTable.tsx`** — 1 select (pagination page size)
3. **`web/src/components/explorer/ImportButton.tsx`** — 1 select (platform selector)
4. **`web/src/components/explorer/FilterPanel.tsx`** — 3 selects (province, regency, district)
5. **`web/src/components/reports/ReportGenerator.tsx`** — 5 selects (template, province, regency, district, platform)

**Approach:** For each file:
1. Add shadcn Select imports
2. Replace `<select>` + `<option>` with `<Select>` + `<SelectTrigger>` + `<SelectContent>` + `<SelectItem>`
3. Replace `onChange={(e) => setter(e.target.value)}` with `onValueChange={setter}`
4. Handle the "all" / empty value case (shadcn Select doesn't support empty string values — use `"all"` as the value)

---

## Task 5: Fix GoFood Scraper — URL Pattern & City-to-Regency Mapping

**Problem:** GoFood scraper builds incorrect URLs and doesn't know which GoFood city covers which BPS regency/district. Some regencies (like Pangkep, Banggai) are sub-regions of a parent GoFood city, not top-level cities themselves.

**Verified Findings (Playwright, 2026-03-08):**

### GoFood URL Pattern
```
https://gofood.co.id/en/{parentCity}/{region}-restaurants/most_loved
```
- **Top-level city:** parentCity = region (e.g., `/en/palu/palu-restaurants/most_loved`)
- **Sub-region:** parentCity ≠ region (e.g., `/en/parepare/pangkep-restaurants/most_loved`)
- The old code always used the same slug twice — WRONG for sub-regions

### GoFood City Sub-Regions (from "Places to check out" section)

**Palu (parent city):**
- `donggala` → Kab. Donggala (a separate BPS regency under palu's GoFood coverage!)
- `palu` → Kota Palu
- `palu-barat`, `palu-selatan`, `palu-timur`, `palu-utara` → Districts of Kota Palu

**Parepare (parent city):**
- `bacukiki`, `bacukiki-barat`, `soreang`, `ujung` → Districts of Kota Parepare
- `central-bantaeng`, `bissappu`, `eremerasa`, `gantarangkeke`, `pajukukang`, `sinoa`, `tompobulu` → Districts of Kab. Bantaeng
- `pangkep` → Kab. Pangkajene dan Kepulauan (Pangkep)
- More visible after clicking "Show more cities"

### Key Insights
1. **GoFood cities cover MULTIPLE BPS regencies.** E.g., Palu covers both Kota Palu AND Kab. Donggala
2. **GoFood cities are often regency capitals.** E.g., Luwuk is capital of Kab. Banggai
3. **Not all listed cities are active.** Luwuk returns 404 for both `/en/luwuk/restaurants` and `/en/luwuk/luwuk-restaurants` (confirmed 2026-03-08)
4. **Sub-regions can be kecamatan (districts) or kabupaten (regencies)** — GoFood doesn't distinguish
5. **GoFood uses abbreviated names** — "Pangkep" not "Pangkajene dan Kepulauan"

### Changes Already Implemented
- `extension/lib/gofood-cities.js` — Created with 106 cities mapped to BPS province codes
- `extension/background/service-worker.js`:
  - Added `importScripts('../lib/gofood-cities.js')`
  - Rewrote `buildGoFoodUrl(regionName, parentCitySlug)` to support parent + region pattern
  - Rewrote `scrapeGoFood()` with 3-strategy approach:
    1. Try regency as top-level GoFood city
    2. Try regency as sub-region under each province's GoFood city
    3. Fall back to scraping parent cities directly
  - Added `scrapeGoFoodCityWithParent()` for sub-region scraping with 404 detection
  - Removed old `GOFOOD_CITY_MAP` (replaced by `gofood-cities.js`)

### Dynamic BPS Regency Resolution (Implemented)

Instead of hardcoding BPS regency codes, the service worker now resolves GoFood cities to BPS regencies **dynamically** using the cached BPS API data at runtime:

1. **Regency-level match**: Strip "KOTA"/"KAB." prefix, match GoFood city name → BPS regency name (e.g., "Palu" → "KOTA PALU")
2. **Fuzzy regency match**: Contains-based matching for partial names
3. **Kecamatan-level search**: Fetch districts for each regency in the province, find the GoFood city as a kecamatan (e.g., "Luwuk" → kecamatan in "KAB. BANGGAI", "Kisaran" → kecamatan in "KAB. ASAHAN")

This approach:
- Uses `getDistrictsForRegency()` to fetch and cache kecamatan data (`kecamatan_{regencyCode}`)
- Works for ALL GoFood cities without manual mapping
- Same pattern reusable for other e-commerce platforms (Tokopedia, Shopee) that use city names instead of BPS codes

**Key function**: `matchGoFoodCityToBpsRegency(cityName, provinceCode)` in service-worker.js

---

## Execution Order

1. **Task 1** (Tokopedia) — DONE ✓
2. **Task 5** (GoFood URL + mapping) — DONE (basic), regency-level mapping TODO
3. **Task 2** (Shopee) — next priority
4. **Task 3** (Remove Zalora) — quick cleanup
5. **Task 4** (shadcn Select) — UI improvement, can be parallelized with Task 3
