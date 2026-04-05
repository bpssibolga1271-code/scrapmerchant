/**
 * SE Merchant Scraper — Background Service Worker
 *
 * Handles scraping orchestration and data export via
 * message passing from the popup.
 */

importScripts('../lib/constants.js', '../lib/storage.js', '../lib/tokopedia-cities.js', '../lib/gofood-cities.js');

let scrapeAborted = false;

// ── Open popup as tab on extension icon click ───────────────

chrome.action.onClicked.addListener(async () => {
  const popupUrl = chrome.runtime.getURL('popup/index.html');

  // Check if a tab with the popup is already open
  const tabs = await chrome.tabs.query({ url: popupUrl });
  if (tabs.length > 0 && tabs[0].id) {
    // Focus the existing tab
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    // Open a new tab
    await chrome.tabs.create({ url: popupUrl });
  }
});

// ── Message Router ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (action === 'scrape') {
    handleScrape(message).then(sendResponse);
    return true; // keep channel open for async response
  }

  if (action === 'scrapeAll') {
    handleScrapeAll(message).then(sendResponse);
    return true;
  }

  if (action === 'getScrapeState') {
    StorageHelper.get(STORAGE_KEYS.scrapeState).then(state => sendResponse(state || { status: 'idle' }));
    return true;
  }

  if (action === 'resetScrapeState') {
    StorageHelper.set(STORAGE_KEYS.scrapeState, { status: 'idle' }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (action === 'stopScrape') {
    scrapeAborted = true;
    StorageHelper.get(STORAGE_KEYS.scrapeState).then(async (state) => {
      if (state && state.status === 'running') {
        state.status = 'done';
        await StorageHelper.set(STORAGE_KEYS.scrapeState, state);
        broadcastProgress(state);
      }
      sendResponse({ success: true });
    });
    return true;
  }

  if (action === 'export') {
    handleExport(message).then(sendResponse);
    return true;
  }

  if (action === 'captchaDetected') {
    const platform = message.platform || 'unknown';
    console.warn(`[SE] CAPTCHA detected on ${platform} — waiting for user to solve it`);

    // Focus the tab with CAPTCHA so the user can solve it
    if (sender.tab?.id) {
      chrome.tabs.update(sender.tab.id, { active: true }).catch(() => {});
      if (sender.tab.windowId) {
        chrome.windows.update(sender.tab.windowId, { focused: true }).catch(() => {});
      }
    }

    chrome.runtime.sendMessage({
      type: 'captcha',
      platform,
      message: `CAPTCHA terdeteksi di ${platform}. Silakan selesaikan CAPTCHA di tab browser, scraping akan lanjut otomatis.`,
    }).catch(() => {});
    return false;
  }

  if (action === 'captchaResolved') {
    const platform = message.platform || 'unknown';
    console.log(`[SE] CAPTCHA resolved on ${platform} — resuming`);
    chrome.runtime.sendMessage({
      type: 'captchaResolved',
      platform,
      message: `CAPTCHA resolved on ${platform}. Resuming scrape...`,
    }).catch(() => {});
    return false;
  }

  return false;
});

// ── Scrape Handler ──────────────────────────────────────────

/**
 * Dispatch a scrape request to the appropriate platform scraper.
 * @param {{ platform: string, region: { province: {code,name}, regency: {code,name}, district: {code,name} } }} params
 * @returns {Promise<{ merchants: Array<Object> }>}
 */
async function handleScrape({ platform, region }) {
  // region = { province: {code, name}, regency: {code, name}, district: {code, name} }
  const regionCode = region.district?.code || region.regency?.code || region.province?.code;
  const regionName = region.district?.name || region.regency?.name || region.province?.name;
  const provinceName = region.province?.name || '';

  console.log(`[SE] Scraping ${platform} for region ${regionCode} (${regionName}), province: ${provinceName}`);

  let merchants = [];

  try {
    switch (platform) {
      case 'tokopedia':
        merchants = await scrapeTokopedia(regionCode, regionName, provinceName, region);
        break;
      case 'shopee':
        merchants = await scrapeShopee(regionCode, regionName, provinceName, region);
        break;
      case 'grabfood':
        merchants = await scrapeGrabFood(regionCode, regionName, provinceName, region);
        break;
      case 'gofood':
        merchants = await scrapeGoFood(regionCode, regionName, provinceName, region);
        break;
      case 'lazada':
        merchants = await scrapeLazada(regionCode, regionName, provinceName, region);
        break;
      case 'blibli':
        merchants = await scrapeBlibli(regionCode, regionName, provinceName, region);
        break;
      default:
        console.warn(`[SE] Unknown platform: ${platform}`);
    }

    // Resolve regency codes for any merchants missing them
    if (merchants.length > 0) {
      const provCode = region.province?.code || '';
      if (provCode) {
        const hasUnresolved = merchants.some(m => !m.regencyCode || m.regencyCode.length <= 2);
        if (hasUnresolved) {
          await resolveRegencyCodes(merchants, provCode);
        }
      }
      await StorageHelper.appendMerchants(platform, regionCode, merchants);
    }
  } catch (err) {
    console.error(`[SE] Scrape failed for ${platform}:`, err);
  }

  return { merchants };
}

// ── Scrape All Handler ─────────────────────────────────────

/**
 * Orchestrate scraping across multiple platforms. Stores state
 * in chrome.storage so the popup can reconnect if closed/reopened.
 * @param {{ platforms: string[], region: Object }} params
 * @returns {Promise<Object>}
 */
async function handleScrapeAll({ platforms, region }) {
  scrapeAborted = false;
  const state = {
    status: 'running',
    platforms,
    region,
    currentIndex: 0,
    results: {},
    error: null,
  };
  await StorageHelper.set(STORAGE_KEYS.scrapeState, state);
  broadcastProgress(state);

  for (let i = 0; i < platforms.length; i++) {
    if (scrapeAborted) {
      console.log('[SE] Scrape aborted by user');
      break;
    }

    state.currentIndex = i;
    await StorageHelper.set(STORAGE_KEYS.scrapeState, state);
    broadcastProgress(state);

    try {
      const { merchants } = await handleScrape({ platform: platforms[i], region });
      state.results[platforms[i]] = merchants;
    } catch (err) {
      state.results[platforms[i]] = [];
      console.error(`[SE] scrapeAll error for ${platforms[i]}:`, err);
    }
  }

  state.status = 'done';
  state.currentIndex = platforms.length;
  scrapeAborted = false;
  await StorageHelper.set(STORAGE_KEYS.scrapeState, state);
  broadcastProgress(state);
  return state;
}

// ── BPS Region Resolution ──────────────────────────────────

/**
 * Fetch regencies for a province from BPS API (with cache).
 * @param {string} provinceCode — BPS province code (e.g. "72")
 * @returns {Promise<Array<{kode_bps: string, nama_bps: string}>>}
 */
async function getRegenciesForProvince(provinceCode) {
  if (!provinceCode) return [];

  const cacheKey = `kabupaten_${provinceCode}`;
  const cache = await StorageHelper.get(STORAGE_KEYS.regionsCache) || {};

  if (cache[cacheKey] && cache[cacheKey].length > 0) {
    return cache[cacheKey];
  }

  try {
    const url = `${BPS_API_BASE}?level=kabupaten&parent=${provinceCode}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    cache[cacheKey] = data;
    await StorageHelper.set(STORAGE_KEYS.regionsCache, cache);
    return data;
  } catch (err) {
    console.warn(`[SE] Failed to fetch regencies for province ${provinceCode}:`, err);
    return [];
  }
}

/**
 * Normalize a location string for fuzzy matching.
 * Strips prefixes: "Kab.", "Kabupaten", "Kota".
 * @param {string} text
 * @returns {string}
 */
function normalizeLocationName(text) {
  return (text || '')
    .toLowerCase()
    .replace(/^(kab\.|kabupaten|kota)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve card location text to actual BPS regency codes.
 * Tokopedia shows "Kab. Banggai", "Palu", etc. under each shop card.
 *
 * @param {Array<Object>} merchants
 * @param {string} provinceCode
 * @returns {Promise<Array<Object>>}
 */
async function resolveRegencyCodes(merchants, provinceCode) {
  if (!merchants.length || !provinceCode) return merchants;

  const regencies = await getRegenciesForProvince(provinceCode);
  if (!regencies.length) {
    console.warn('[SE] No regency data available for resolution');
    return merchants;
  }

  // Build lookup: normalized name → { code, name }
  const lookup = new Map();
  for (const reg of regencies) {
    const normalized = normalizeLocationName(reg.nama_bps);
    lookup.set(normalized, { code: reg.kode_bps, name: reg.nama_bps });

    // Also index without "Kota " for BPS names like "KOTA PALU"
    const withoutKota = reg.nama_bps.toLowerCase().replace(/^kota\s+/, '').trim();
    if (withoutKota !== normalized) {
      lookup.set(withoutKota, { code: reg.kode_bps, name: reg.nama_bps });
    }
  }

  let resolved = 0;
  let unresolved = 0;

  for (const m of merchants) {
    // Skip if already has a valid regency code (longer than province code)
    if (m.regencyCode && m.regencyCode.length > 2) continue;

    const cardLocation = m.regencyName || m.address || '';
    if (!cardLocation) { unresolved++; continue; }

    const normalized = normalizeLocationName(cardLocation);
    if (!normalized) { unresolved++; continue; }

    // Exact match
    let match = lookup.get(normalized);

    // Partial match
    if (!match) {
      for (const [key, val] of lookup.entries()) {
        if (key.includes(normalized) || normalized.includes(key)) {
          match = val;
          break;
        }
      }
    }

    if (match) {
      m.regencyCode = match.code;
      m.regencyName = match.name;
      resolved++;
    } else {
      unresolved++;
    }
  }

  console.log(`[SE] Regency resolution: ${resolved} resolved, ${unresolved} unresolved out of ${merchants.length}`);
  return merchants;
}

/**
 * Broadcast scrape progress to any listening popup.
 * @param {Object} state
 */
function broadcastProgress(state) {
  chrome.runtime.sendMessage({ action: 'scrapeProgress', state }).catch(() => {});
}

// ── Export Handler ───────────────────────────────────────────

/**
 * Convert merchants to the requested format and trigger download.
 * @param {{ format: 'csv'|'json'|'excel', merchants: Array<Object> }} params
 * @returns {Promise<{ success: boolean }>}
 */
async function handleExport({ format, merchants }) {
  if (!merchants || !merchants.length) {
    return { success: false, error: 'No data to export' };
  }

  try {
    let blob;
    let filename;
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csvContent = convertToCSV(merchants);
      blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      filename = `se-merchants-${timestamp}.csv`;
    } else if (format === 'json') {
      const jsonContent = JSON.stringify(merchants, null, 2);
      blob = new Blob([jsonContent], { type: 'application/json' });
      filename = `se-merchants-${timestamp}.json`;
    } else if (format === 'excel') {
      // For Excel, export as CSV (Excel can open CSV).
      // A full .xlsx export would require a library like SheetJS.
      const csvContent = convertToCSV(merchants);
      blob = new Blob(['\ufeff' + csvContent], {
        type: 'text/csv;charset=utf-8;',
      });
      filename = `se-merchants-${timestamp}.csv`;
    } else {
      return { success: false, error: `Unknown format: ${format}` };
    }

    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });

    URL.revokeObjectURL(url);

    return { success: true };
  } catch (err) {
    console.error(`[SE] Export failed (${format}):`, err);
    return { success: false, error: err.message };
  }
}

// ── CSV Converter ───────────────────────────────────────────

/**
 * Convert an array of merchant objects to CSV string with proper quoting.
 * @param {Array<Object>} merchants
 * @returns {string}
 */
function convertToCSV(merchants) {
  if (!merchants.length) return '';

  const headers = MERCHANT_FIELDS;

  const escapeField = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [headers.join(',')];

  for (const merchant of merchants) {
    const row = headers.map((field) => escapeField(merchant[field]));
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

// ── Tokopedia Scraper ───────────────────────────────────────

/**
 * Build a Tokopedia shop search URL filtered by region.
 * Uses `st=shop` for shop search mode and `q=regionName` as keyword.
 * Looks up fcity from TOKOPEDIA_FCITY_MAP (569 locations in tokopedia-cities.js).
 * @param {string} regionName — human-readable region name
 * @param {string} provinceName — province name for fallback lookup
 * @returns {string}
 */
function buildTokopediaSearchUrl(regionName, provinceName, keyword) {
  const base = 'https://www.tokopedia.com/search';
  const params = new URLSearchParams({ st: 'shop', q: keyword });
  const fcity = lookupTokopediaFcity(regionName, provinceName);
  if (fcity) params.set('fcity', fcity);
  return `${base}?${params.toString()}`;
}

/**
 * Scrape Tokopedia merchants for a given region.
 *
 * Flow:
 *   1. Open a new tab to the Tokopedia search page filtered by region
 *   2. Wait for the content script to be ready
 *   3. Send a `startScrape` message to the content script
 *   4. Await the response containing merchant data
 *   5. Close the tab
 *   6. Return the merchants array
 *
 * @param {string} regionCode
 * @param {string} regionName
 * @returns {Promise<Array<Object>>}
 */
async function scrapeTokopedia(regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 120000; // 2 minutes max per keyword

  // Load configured keywords (fall back to defaults)
  let keywords;
  try {
    const saved = await StorageHelper.get(STORAGE_KEYS.searchKeywords);
    keywords = Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SEARCH_KEYWORDS;
  } catch {
    keywords = DEFAULT_SEARCH_KEYWORDS;
  }

  console.log(`[SE] Tokopedia: scraping with ${keywords.length} keywords: ${keywords.join(', ')}`);

  const merchantMap = new Map(); // deduplicate by merchantUrl

  for (const keyword of keywords) {
    const searchUrl = buildTokopediaSearchUrl(regionName, provinceName, keyword);
    console.log(`[SE] Tokopedia keyword "${keyword}": ${searchUrl}`);

    let tab;

    try {
      tab = await chrome.tabs.create({ url: searchUrl, active: true });
      await waitForTabLoad(tab.id);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const response = await sendMessageWithTimeout(
        tab.id,
        {
          action: 'startScrape',
          platform: 'tokopedia',
          regionCode,
          regionName,
          provinceName,
          region,
        },
        SCRAPE_TIMEOUT_MS
      );

      if (response && response.success && Array.isArray(response.merchants)) {
        let newCount = 0;
        for (const m of response.merchants) {
          const key = m.merchantUrl || m.merchantId || m.merchantName;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, m);
            newCount++;
          }
        }
        console.log(
          `[SE] Tokopedia keyword "${keyword}": ${response.merchants.length} found, ${newCount} new (total: ${merchantMap.size})`
        );
      } else {
        console.warn(`[SE] Tokopedia keyword "${keyword}": no data returned`);
      }
    } catch (err) {
      console.error(`[SE] Tokopedia keyword "${keyword}" failed:`, err);
    } finally {
      if (tab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {
          // Tab may already be closed
        }
      }
    }

    // Brief pause between keywords to avoid rate limiting
    if (keyword !== keywords[keywords.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(`[SE] Tokopedia scrape complete: ${merchantMap.size} unique merchants across ${keywords.length} keywords`);
  return Array.from(merchantMap.values());
}

/**
 * Wait for a tab to reach the "complete" loading status.
 * @param {number} tabId
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check immediately in case it is already loaded
    chrome.tabs.get(tabId).then((tabInfo) => {
      if (tabInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab not found'));
    });
  });
}

/**
 * Send a message to a specific tab with a timeout.
 * Retries a few times in case the content script is not yet ready.
 * @param {number} tabId
 * @param {Object} message
 * @param {number} timeoutMs
 * @returns {Promise<Object>}
 */
function sendMessageWithTimeout(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Message response timed out'));
    }, timeoutMs);

    let attempts = 0;
    const maxAttempts = 6;
    const retryDelay = 3000;

    function trySend() {
      attempts++;
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            `[SE] sendMessage attempt ${attempts} failed:`,
            chrome.runtime.lastError.message
          );

          if (attempts < maxAttempts) {
            setTimeout(trySend, retryDelay);
            return;
          }

          clearTimeout(timer);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        clearTimeout(timer);
        resolve(response);
      });
    }

    trySend();
  });
}

// ── Platform Scraper Stubs ──────────────────────────────────
// Remaining scrapers return empty arrays for now.
// Actual implementations will be added in subsequent tasks.

// ── Shopee Scraper ──────────────────────────────────────────

/**
 * Shopee location mapping. Maps BPS province names to Shopee's
 * `locations` search filter values. Shopee uses title-case
 * province/region names in the search URL parameter.
 *
 * WARNING: Shopee has anti-bot protection (CAPTCHA) and requires
 * an authenticated session. Automated scraping may be blocked.
 * These mappings are unverified — Shopee redirects to CAPTCHA
 * for non-authenticated requests.
 */
const SHOPEE_LOCATION_MAP = {
  'ACEH': 'Aceh',
  'SUMATERA UTARA': 'Sumatera Utara',
  'SUMATERA BARAT': 'Sumatera Barat',
  'RIAU': 'Riau',
  'JAMBI': 'Jambi',
  'SUMATERA SELATAN': 'Sumatera Selatan',
  'BENGKULU': 'Bengkulu',
  'LAMPUNG': 'Lampung',
  'KEPULAUAN BANGKA BELITUNG': 'Kepulauan Bangka Belitung',
  'KEPULAUAN RIAU': 'Kepulauan Riau',
  'DKI JAKARTA': 'DKI Jakarta',
  'JAWA BARAT': 'Jawa Barat',
  'JAWA TENGAH': 'Jawa Tengah',
  'DI YOGYAKARTA': 'DI Yogyakarta',
  'JAWA TIMUR': 'Jawa Timur',
  'BANTEN': 'Banten',
  'BALI': 'Bali',
  'NUSA TENGGARA BARAT': 'Nusa Tenggara Barat',
  'NUSA TENGGARA TIMUR': 'Nusa Tenggara Timur',
  'KALIMANTAN BARAT': 'Kalimantan Barat',
  'KALIMANTAN TENGAH': 'Kalimantan Tengah',
  'KALIMANTAN SELATAN': 'Kalimantan Selatan',
  'KALIMANTAN TIMUR': 'Kalimantan Timur',
  'KALIMANTAN UTARA': 'Kalimantan Utara',
  'SULAWESI UTARA': 'Sulawesi Utara',
  'SULAWESI TENGAH': 'Sulawesi Tengah',
  'SULAWESI SELATAN': 'Sulawesi Selatan',
  'SULAWESI TENGGARA': 'Sulawesi Tenggara',
  'GORONTALO': 'Gorontalo',
  'SULAWESI BARAT': 'Sulawesi Barat',
  'MALUKU': 'Maluku',
  'MALUKU UTARA': 'Maluku Utara',
  'PAPUA': 'Papua',
  'PAPUA BARAT': 'Papua Barat',
  'PAPUA BARAT DAYA': 'Papua Barat Daya',
  'PAPUA TENGAH': 'Papua Tengah',
  'PAPUA PEGUNUNGAN': 'Papua Pegunungan',
  'PAPUA SELATAN': 'Papua Selatan',
};

/**
 * Build a Shopee search URL filtered by region/location.
 * Shopee filters at province level, so we use provinceName for location lookup.
 * @param {string} regionName — human-readable region name (typically uppercase BPS name)
 * @param {string} provinceName — province name for province-level location lookup
 * @returns {string}
 */
function buildShopeeSearchUrl(regionName, provinceName, keyword) {
  const base = 'https://shopee.co.id/search';
  const params = new URLSearchParams({
    keyword: keyword,
  });

  // Use provinceName for location lookup (Shopee filters at province level)
  const lookupName = provinceName || regionName;
  const upperName = lookupName.toUpperCase().trim();
  if (SHOPEE_LOCATION_MAP[upperName]) {
    params.set('locations', SHOPEE_LOCATION_MAP[upperName]);
  } else {
    // Fuzzy match: find the first location key that contains the lookup name
    for (const [key, locationName] of Object.entries(SHOPEE_LOCATION_MAP)) {
      if (
        key.includes(upperName) ||
        upperName.includes(key) ||
        locationName.toLowerCase().includes(lookupName.toLowerCase())
      ) {
        params.set('locations', locationName);
        break;
      }
    }
  }

  return `${base}?${params.toString()}`;
}

/**
 * Scrape Shopee merchants for a given region.
 *
 * Flow:
 *   1. Map regionName to Shopee location name
 *   2. Open a new tab to the Shopee search page filtered by location
 *   3. Wait for the content script to be ready
 *   4. Send a `startScrape` message to the content script
 *   5. Await the response containing merchant data
 *   6. Close the tab
 *   7. Return the merchants array
 *
 * @param {string} regionCode
 * @param {string} regionName
 * @returns {Promise<Array<Object>>}
 */
async function scrapeShopee(regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 180000; // 3 minutes per keyword

  // Load configured keywords (fall back to defaults)
  let keywords;
  try {
    const saved = await StorageHelper.get(STORAGE_KEYS.searchKeywords);
    keywords = Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SEARCH_KEYWORDS;
  } catch {
    keywords = DEFAULT_SEARCH_KEYWORDS;
  }

  console.log(`[SE] Shopee: scraping with ${keywords.length} keywords: ${keywords.join(', ')}`);

  const merchantMap = new Map();

  for (const keyword of keywords) {
    const searchUrl = buildShopeeSearchUrl(regionName, provinceName, keyword);
    console.log(`[SE] Shopee keyword "${keyword}": ${searchUrl}`);

    let tab;

    try {
      tab = await chrome.tabs.create({ url: searchUrl, active: true });
      await waitForTabLoad(tab.id);
      // Wait for Shopee SPA to hydrate and render products
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // ── Phase 1: Scrape product links across pages to collect shop IDs ──

      // Shared scrape function injected into each page via executeScript
      async function scrapePageShops(tabId) {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => {
            const PRODUCT_RE = /-i\.(\d+)\.(\d+)/;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            // Wait for products (up to 20s)
            let hasProducts = false;
            for (let i = 0; i < 20; i++) {
              if ([...document.querySelectorAll('a[href]')].some(a => PRODUCT_RE.test(a.href))) {
                hasProducts = true;
                break;
              }
              await sleep(1000);
            }

            if (!hasProducts) return { shops: [], totalPages: 1 };

            // Scroll to load lazy content
            let prev = 0;
            for (let i = 0; i < 15; i++) {
              const h = document.documentElement.scrollHeight;
              if (h === prev) break;
              prev = h;
              window.scrollTo({ top: h, behavior: 'smooth' });
              await sleep(800);
            }
            await sleep(1000);

            // Detect total pages from pagination UI (e.g., "1/5" shown in sort bar)
            // Search ALL elements for the "currentPage/totalPages" pattern
            let totalPages = 1;
            const allEls = document.querySelectorAll('span, div, button, a');
            for (const el of allEls) {
              // Only check leaf-level or small elements to avoid matching containers
              if (el.children.length > 2) continue;
              const t = el.textContent.trim();
              const m = t.match(/^(\d+)\/(\d+)$/);
              if (m) {
                const detected = parseInt(m[2], 10);
                if (detected > 1 && detected <= 100) {
                  totalPages = Math.max(totalPages, detected);
}
              }
            }

            // Extract location from a card
            function getLocation(card) {
              if (!card) return '';
              const imgs = card.querySelectorAll('img[alt*="location"]');
              for (const img of imgs) {
                const p = img.parentElement;
                if (!p) continue;
                for (const sib of p.children) {
                  if (sib === img) continue;
                  const t = sib.textContent.trim();
                  if (t.length >= 2 && t.length <= 50 && !t.includes('Rp') && !t.includes('%') && !/^\d/.test(t)) return t;
                }
                const pt = p.textContent.replace(img.textContent || '', '').trim();
                if (pt.length >= 2 && pt.length <= 50 && !pt.includes('Rp')) return pt;
              }
              return '';
            }

            // Extract sold count from card
            function getSoldCount(card) {
              if (!card) return null;
              const els = card.querySelectorAll('span, div');
              for (const el of els) {
                const t = el.textContent.trim().toLowerCase();
                const m = t.match(/([\d.,]+)\s*(?:rb)?\+?\s*terjual/);
                if (m) {
                  let c = parseFloat(m[1].replace(/\./g, '').replace(/,/g, '.'));
                  if (t.includes('rb')) c *= 1000;
                  return c;
                }
              }
              return null;
            }

            // Collect shop IDs + card data from product links
            const shops = new Map();
            const allLinks = document.querySelectorAll('a[href]');
            for (const link of allLinks) {
              const match = (link.href || '').match(PRODUCT_RE);
              if (!match) continue;
              const shopId = match[1];
              if (shops.has(shopId)) continue;

              const card = link.closest('li') || link.parentElement?.parentElement?.parentElement;
              shops.set(shopId, {
                shopId,
                location: getLocation(card),
                totalSold: getSoldCount(card),
              });
            }

            return { shops: Array.from(shops.values()), totalPages };
          },
        });
        return result?.result || { shops: [], totalPages: 1 };
      }

      // Scrape page 1 to get shops + detect total pages
      const firstPage = await scrapePageShops(tab.id);

      if (firstPage.shops.length === 0) {
        console.warn(`[SE] Shopee keyword "${keyword}": no products found, skipping`);
        continue;
      }

      // Cap at 20 pages max
      const totalPages = Math.min(firstPage.totalPages, 20);
      console.log(`[SE] Shopee keyword "${keyword}": detected ${firstPage.totalPages} pages, scraping up to ${totalPages}`);

      // Process page 1 results
      let firstNewCount = 0;
      for (const shop of firstPage.shops) {
        const key = `https://shopee.co.id/shop/${shop.shopId}`;
        if (!merchantMap.has(key)) {
          merchantMap.set(key, {
            platform: 'shopee',
            merchantName: '',
            merchantUrl: key,
            merchantId: shop.shopId,
            address: shop.location,
            provinceCode: regionCode,
            provinceName: regionName,
            regencyCode: '',
            regencyName: shop.location || '',
            districtCode: '',
            districtName: '',
            category: '',
            rating: null,
            totalProducts: null,
            totalSold: shop.totalSold,
            joinDate: '',
            isOfficialStore: false,
            phone: '',
            description: '',
            scrapedAt: new Date().toISOString(),
          });
          firstNewCount++;
        }
      }
      console.log(`[SE] Shopee keyword "${keyword}" page 1/${totalPages}: ${firstPage.shops.length} shops, ${firstNewCount} new (total: ${merchantMap.size})`);

      // Scrape remaining pages (page=1 is the 2nd page in Shopee's 0-indexed param)
      for (let page = 1; page < totalPages; page++) {
        const pageUrl = `${searchUrl}&page=${page}`;
        console.log(`[SE] Shopee keyword "${keyword}" navigating to page ${page + 1}/${totalPages}: ${pageUrl}`);

        await chrome.tabs.update(tab.id, { url: pageUrl });
        await waitForTabLoad(tab.id);
        await new Promise((resolve) => setTimeout(resolve, 8000));

        const pageData = await scrapePageShops(tab.id);
        const pageShops = pageData.shops;

        if (pageShops.length === 0) {
          console.log(`[SE] Shopee keyword "${keyword}" page ${page + 1}: no products, stopping`);
          break;
        }

        let newCount = 0;
        for (const shop of pageShops) {
          const key = `https://shopee.co.id/shop/${shop.shopId}`;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, {
              platform: 'shopee',
              merchantName: '',
              merchantUrl: key,
              merchantId: shop.shopId,
              address: shop.location,
              provinceCode: regionCode,
              provinceName: regionName,
              regencyCode: '',
              regencyName: shop.location || '',
              districtCode: '',
              districtName: '',
              category: '',
              rating: null,
              totalProducts: null,
              totalSold: shop.totalSold,
              joinDate: '',
              isOfficialStore: false,
              phone: '',
              description: '',
              scrapedAt: new Date().toISOString(),
            });
            newCount++;
          }
        }

        console.log(`[SE] Shopee keyword "${keyword}" page ${page + 1}/${totalPages}: ${pageShops.length} shops, ${newCount} new (total: ${merchantMap.size})`);

        if (newCount === 0) {
          console.log(`[SE] Shopee keyword "${keyword}": no new shops on page ${page + 1}, stopping`);
          break;
        }
      }

      // ── Phase 2: Get shop names by visiting each shop page ──
      const shopsToEnrich = Array.from(merchantMap.entries())
        .filter(([, m]) => !m.merchantName)
        .map(([url, m]) => ({ url, id: m.merchantId }));

      if (shopsToEnrich.length > 0) {
        console.log(`[SE] Shopee: enriching ${shopsToEnrich.length} shops by visiting shop pages...`);
        let enriched = 0;

        // Check if current page is a CAPTCHA page and wait for user to solve it
        async function waitForCaptchaSolve(tabId) {
          const [check] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => document.URL.includes('/verify/captcha') || document.URL.includes('/verify/traffic'),
          });
          if (!check?.result) return false;

          // Notify user via extension badge
          chrome.action.setBadgeText({ text: '!' });
          chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
          console.log('[SE] Shopee: CAPTCHA detected! Waiting for user to solve it...');

          // Poll every 3s until the CAPTCHA page is gone (max 5 min)
          const maxWait = 5 * 60 * 1000;
          const start = Date.now();
          while (Date.now() - start < maxWait) {
            await new Promise((r) => setTimeout(r, 3000));
            const [recheck] = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.URL.includes('/verify/captcha') || document.URL.includes('/verify/traffic'),
            });
            if (!recheck?.result) {
              console.log('[SE] Shopee: CAPTCHA solved! Resuming...');
              chrome.action.setBadgeText({ text: '' });
              await new Promise((r) => setTimeout(r, 2000));
              return true;
            }
          }
          console.error('[SE] Shopee: CAPTCHA timeout (5 min). Skipping remaining shops.');
          chrome.action.setBadgeText({ text: '' });
          throw new Error('CAPTCHA timeout');
        }

        for (let i = 0; i < shopsToEnrich.length; i++) {
          const shop = shopsToEnrich[i];
          try {
            // Random delay between 2-5s to avoid triggering CAPTCHA
            const delay = 2000 + Math.floor(Math.random() * 3000);
            await new Promise((r) => setTimeout(r, delay));

            await chrome.tabs.update(tab.id, { url: `https://shopee.co.id/shop/${shop.id}` });
            await waitForTabLoad(tab.id);
            await new Promise((r) => setTimeout(r, 3000));

            // Check for CAPTCHA redirect
            const wasCaptcha = await waitForCaptchaSolve(tab.id);
            if (wasCaptcha) {
              // After CAPTCHA solve, re-navigate to the shop page
              await chrome.tabs.update(tab.id, { url: `https://shopee.co.id/shop/${shop.id}` });
              await waitForTabLoad(tab.id);
              await new Promise((r) => setTimeout(r, 3000));
            }

            const [result] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const h1 = document.querySelector('h1');
                const shopName = h1 ? h1.textContent.trim() : '';

                // Shop stats are structured as: container > [icon, textWrap > [label, value]]
                // Labels: "produk:", "pengikut:", "penilaian:", "bergabung:"
                let productCount = null;
                let followers = null;
                let rating = null;
                let joinDate = '';

                // Find all small text elements that act as labels
                const labels = document.querySelectorAll('div, span');
                for (const el of labels) {
                  if (el.children.length > 0) continue; // leaf text nodes only
                  const t = el.textContent.trim().toLowerCase();

                  if (t === 'produk:') {
                    const val = el.nextElementSibling;
                    if (val) {
                      const n = parseInt(val.textContent.trim().replace(/[,.]/g, ''), 10);
                      if (!isNaN(n)) productCount = n;
                    }
                  } else if (t === 'pengikut:') {
                    const val = el.nextElementSibling;
                    if (val) {
                      const n = parseInt(val.textContent.trim().replace(/[,.]/g, ''), 10);
                      if (!isNaN(n)) followers = n;
                    }
                  } else if (t === 'penilaian:') {
                    const val = el.nextElementSibling;
                    if (val) {
                      const m = val.textContent.trim().match(/([\d.,]+)/);
                      if (m) rating = parseFloat(m[1].replace(/,/g, '.'));
                    }
                  } else if (t === 'bergabung:') {
                    const val = el.nextElementSibling;
                    if (val) joinDate = val.textContent.trim();
                  }
                }

                return { shopName, productCount, followers, rating, joinDate };
              },
            });

            const data = result?.result;
            if (data?.shopName) {
              const merchant = merchantMap.get(shop.url);
              if (merchant) {
                merchant.merchantName = data.shopName;
                if (data.productCount != null) merchant.totalProducts = data.productCount;
                if (data.followers != null) merchant.followers = data.followers;
                if (data.rating != null) merchant.rating = data.rating;
                if (data.joinDate) merchant.joinDate = data.joinDate;
                enriched++;
              }
            }

            if ((i + 1) % 10 === 0) {
              console.log(`[SE] Shopee: enriched ${enriched}/${i + 1} shops processed (${shopsToEnrich.length} total)...`);
            }
          } catch (e) {
            if (e.message === 'CAPTCHA timeout') break;
            console.warn(`[SE] Shopee: failed to enrich shop ${shop.id}:`, e.message);
          }
        }

        // Set fallback names for shops that couldn't be enriched
        for (const [, merchant] of merchantMap.entries()) {
          if (!merchant.merchantName) {
            merchant.merchantName = `Shop ${merchant.merchantId}`;
          }
        }

        console.log(`[SE] Shopee: enriched ${enriched}/${shopsToEnrich.length} shops from shop pages`);
      }
    } catch (err) {
      console.error(`[SE] Shopee keyword "${keyword}" failed:`, err);
    } finally {
      if (tab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {
          // Tab may already be closed
        }
      }
    }

    // Brief pause between keywords to avoid rate limiting
    if (keyword !== keywords[keywords.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(`[SE] Shopee scrape complete: ${merchantMap.size} unique merchants across ${keywords.length} keywords`);
  return Array.from(merchantMap.values());
}

// ── GrabFood Scraper ────────────────────────────────────────

/**
 * Approximate GPS coordinates for major Indonesian cities.
 * Used to override browser geolocation for GrabFood scraping.
 */
const INDONESIA_CITY_COORDS = {
  'JAKARTA': { lat: -6.2088, lng: 106.8456 },
  'DKI JAKARTA': { lat: -6.2088, lng: 106.8456 },
  'SURABAYA': { lat: -7.2575, lng: 112.7521 },
  'BANDUNG': { lat: -6.9175, lng: 107.6191 },
  'MEDAN': { lat: 3.5952, lng: 98.6722 },
  'SEMARANG': { lat: -6.9666, lng: 110.4196 },
  'MAKASSAR': { lat: -5.1477, lng: 119.4327 },
  'PALEMBANG': { lat: -2.9761, lng: 104.7754 },
  'TANGERANG': { lat: -6.1702, lng: 106.6403 },
  'DEPOK': { lat: -6.4025, lng: 106.7942 },
  'BEKASI': { lat: -6.2383, lng: 106.9756 },
  'BOGOR': { lat: -6.5971, lng: 106.8060 },
  'DENPASAR': { lat: -8.6500, lng: 115.2167 },
  'BALI': { lat: -8.6500, lng: 115.2167 },
  'YOGYAKARTA': { lat: -7.7956, lng: 110.3695 },
  'MALANG': { lat: -7.9666, lng: 112.6326 },
  'SOLO': { lat: -7.5755, lng: 110.8243 },
  'SURAKARTA': { lat: -7.5755, lng: 110.8243 },
  'BALIKPAPAN': { lat: -1.2379, lng: 116.8529 },
  'PEKANBARU': { lat: 0.5071, lng: 101.4478 },
  'MANADO': { lat: 1.4748, lng: 124.8421 },
  'PONTIANAK': { lat: -0.0263, lng: 109.3425 },
  'BANJARMASIN': { lat: -3.3186, lng: 114.5944 },
  'PADANG': { lat: -0.9471, lng: 100.4172 },
  'LAMPUNG': { lat: -5.4500, lng: 105.2667 },
  'BANDAR LAMPUNG': { lat: -5.4500, lng: 105.2667 },
  'PALU': { lat: -0.8917, lng: 119.8707 },
  'SULAWESI TENGAH': { lat: -0.8917, lng: 119.8707 },
  'KOTA PALU': { lat: -0.8917, lng: 119.8707 },
  'DONGGALA': { lat: -0.6802, lng: 119.7427 },
  'SIGI': { lat: -1.1500, lng: 119.9833 },
  'PARIGI MOUTONG': { lat: -0.5060, lng: 120.3240 },
  'POSO': { lat: -1.3837, lng: 120.7547 },
  'TOJO UNA-UNA': { lat: -1.0000, lng: 121.5000 },
  'TOLI-TOLI': { lat: 1.0514, lng: 120.7939 },
  'BUOL': { lat: 1.2000, lng: 121.4167 },
  'MOROWALI': { lat: -2.3333, lng: 121.5833 },
  'MOROWALI UTARA': { lat: -1.8333, lng: 121.5000 },
  'BANGGAI': { lat: -1.5833, lng: 122.7500 },
  'BANGGAI KEPULAUAN': { lat: -1.5167, lng: 123.4833 },
  'BANGGAI LAUT': { lat: -1.6167, lng: 123.4667 },
  // Sulawesi Selatan regencies
  'KOTA MAKASSAR': { lat: -5.1477, lng: 119.4327 },
  'GOWA': { lat: -5.3118, lng: 119.4512 },
  'MAROS': { lat: -4.9877, lng: 119.5723 },
  'BONE': { lat: -4.5386, lng: 120.1726 },
  'BULUKUMBA': { lat: -5.5528, lng: 120.1959 },
  'PINRANG': { lat: -3.7860, lng: 119.6521 },
  'PALOPO': { lat: -2.9926, lng: 120.1967 },
  'PAREPARE': { lat: -4.0135, lng: 119.6254 },
  // Sulawesi Utara regencies
  'KOTA MANADO': { lat: 1.4748, lng: 124.8421 },
  'MINAHASA': { lat: 1.2833, lng: 124.8333 },
  'TOMOHON': { lat: 1.3247, lng: 124.8278 },
  'BITUNG': { lat: 1.4403, lng: 125.1916 },
  'KOTAMOBAGU': { lat: 0.7242, lng: 124.3218 },
  // Sulawesi Tenggara regencies
  'KOTA KENDARI': { lat: -3.9675, lng: 122.5150 },
  'KOLAKA': { lat: -4.0753, lng: 121.5903 },
  'BAUBAU': { lat: -5.4733, lng: 122.6366 },
  // Gorontalo regencies
  'KOTA GORONTALO': { lat: 0.5433, lng: 123.0594 },
  'GORONTALO UTARA': { lat: 0.7000, lng: 122.4667 },
  'BONE BOLANGO': { lat: 0.5333, lng: 123.1833 },
  // Sulawesi Barat regencies
  'KOTA MAMUJU': { lat: -2.6678, lng: 118.8913 },
  'MAJENE': { lat: -3.5367, lng: 118.9697 },
  'POLEWALI MANDAR': { lat: -3.4117, lng: 119.3269 },
  'JAMBI': { lat: -1.6101, lng: 103.6131 },
  'MATARAM': { lat: -8.5833, lng: 116.1167 },
  'KUPANG': { lat: -10.1772, lng: 123.6070 },
  'AMBON': { lat: -3.6553, lng: 128.1908 },
  'JAYAPURA': { lat: -2.5333, lng: 140.7167 },
  'SORONG': { lat: -0.8614, lng: 131.2550 },
  'BENGKULU': { lat: -3.8004, lng: 102.2655 },
  'KENDARI': { lat: -3.9675, lng: 122.5150 },
  'GORONTALO': { lat: 0.5433, lng: 123.0594 },
  'TERNATE': { lat: 0.7961, lng: 127.3766 },
  'MAMUJU': { lat: -2.6678, lng: 118.8913 },
  'PANGKAL PINANG': { lat: -2.1309, lng: 106.1149 },
  'TANJUNG PINANG': { lat: 0.9189, lng: 104.4516 },
  'SERANG': { lat: -6.1103, lng: 106.1503 },
  'BANTEN': { lat: -6.1103, lng: 106.1503 },
  'CIREBON': { lat: -6.7320, lng: 108.5523 },
  'TASIKMALAYA': { lat: -7.3274, lng: 108.2207 },
  'SUKABUMI': { lat: -6.9277, lng: 106.9300 },
  'BATAM': { lat: 1.0456, lng: 104.0305 },
  'SAMARINDA': { lat: -0.4948, lng: 117.1436 },
  'JAWA BARAT': { lat: -6.9175, lng: 107.6191 },
  'JAWA TENGAH': { lat: -6.9666, lng: 110.4196 },
  'JAWA TIMUR': { lat: -7.2575, lng: 112.7521 },
  'SULAWESI SELATAN': { lat: -5.1477, lng: 119.4327 },
  'SUMATERA UTARA': { lat: 3.5952, lng: 98.6722 },
  'SUMATERA SELATAN': { lat: -2.9761, lng: 104.7754 },
  'SUMATERA BARAT': { lat: -0.9471, lng: 100.4172 },
  'KALIMANTAN TIMUR': { lat: -0.4948, lng: 117.1436 },
  'KALIMANTAN SELATAN': { lat: -3.3186, lng: 114.5944 },
  'KALIMANTAN BARAT': { lat: -0.0263, lng: 109.3425 },
  'NUSA TENGGARA BARAT': { lat: -8.5833, lng: 116.1167 },
  'NUSA TENGGARA TIMUR': { lat: -10.1772, lng: 123.6070 },
  'RIAU': { lat: 0.5071, lng: 101.4478 },
  'SULAWESI UTARA': { lat: 1.4748, lng: 124.8421 },
};

/**
 * Look up GPS coordinates for a region name.
 * @param {string} regionName
 * @returns {{ lat: number, lng: number } | null}
 */
function lookupCityCoords(regionName) {
  const upper = regionName.toUpperCase().trim();

  // Exact match
  if (INDONESIA_CITY_COORDS[upper]) return INDONESIA_CITY_COORDS[upper];

  // Partial match
  for (const [key, coords] of Object.entries(INDONESIA_CITY_COORDS)) {
    if (upper.includes(key) || key.includes(upper)) return coords;
  }

  return null;
}

/**
 * Override geolocation for a tab using Chrome DevTools Protocol.
 * This works at the browser level before any page JS reads location.
 * @param {number} tabId
 * @param {{ lat: number, lng: number }} coords
 * @returns {Promise<boolean>} true if override was applied
 */
async function overrideGeolocation(tabId, coords) {
  const debuggee = { tabId };
  try {
    await chrome.debugger.attach(debuggee, '1.3');
    await chrome.debugger.sendCommand(debuggee, 'Emulation.setGeolocationOverride', {
      latitude: coords.lat,
      longitude: coords.lng,
      accuracy: 100,
    });
    console.log(`[SE] Geolocation overridden via DevTools Protocol: ${coords.lat}, ${coords.lng}`);
    return true;
  } catch (err) {
    console.warn('[SE] Failed to override geolocation via debugger:', err.message);
    // Fallback: try JS-level override
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (lat, lng) => {
          const mockPosition = {
            coords: {
              latitude: lat, longitude: lng, accuracy: 100,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          };
          navigator.geolocation.getCurrentPosition = (success) => success(mockPosition);
          navigator.geolocation.watchPosition = (success) => { success(mockPosition); return 0; };
        },
        args: [coords.lat, coords.lng],
      });
      console.log(`[SE] JS-level geolocation fallback applied: ${coords.lat}, ${coords.lng}`);
      return true;
    } catch (err2) {
      console.warn('[SE] JS geolocation fallback also failed:', err2.message);
      return false;
    }
  }
}

/**
 * Detach debugger from a tab (cleanup after geolocation override).
 * @param {number} tabId
 */
async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached or tab closed
  }
}

/**
 * Build a GrabFood restaurants URL for a given region.
 *
 * NOTE: GrabFood determines location via GPS/geolocation only —
 * there is no URL-based city filter parameter. The `?cityHint=`
 * query parameter is NOT used by GrabFood itself; it is passed
 * as metadata for the content script to tag scraped results with
 * the intended city name.
 *
 * @param {string} regionName — human-readable region name
 * @returns {string}
 */
function buildGrabFoodUrl(regionName, coords) {
  const base = 'https://food.grab.com/id/en/restaurants';

  // GrabFood is GPS-based only. We append a cityHint param so the
  // content script knows which city/region was intended, but this
  // does NOT filter results on GrabFood's side.
  // We also pass custom coordinates via URL hash for the fetch interceptor.
  const hint = regionName.trim();
  const hashFragment = coords ? `#se_lat=${coords.lat}&se_lng=${coords.lng}` : '';
  if (hint) {
    return `${base}?cityHint=${encodeURIComponent(hint)}${hashFragment}`;
  }

  return `${base}${hashFragment}`;
}

/**
 * Scrape GrabFood merchants/restaurants for a given region.
 *
 * LIMITATION: GrabFood determines location via GPS/geolocation
 * only — there is no URL-based city or region filter. The scraper
 * opens the restaurants page and relies on the browser's geolocation
 * to show nearby restaurants. Results may not match the intended
 * region unless the browser's location is set accordingly.
 *
 * Flow:
 *   1. Open a new tab to the GrabFood restaurants page
 *   2. Wait for the tab to finish loading
 *   3. Send a `startScrape` message to the content script
 *   4. Content script detects the ACTUAL delivery city from the page DOM
 *      (GrabFood is GPS-based — results depend on browser geolocation,
 *       NOT the requested region)
 *   5. Collect results from the content script response, including
 *      `detectedCity` metadata indicating where results are actually from
 *   6. Log a warning if detectedCity does not match the requested region
 *   7. Close the tab
 *   8. Return the merchants array
 *
 * @param {string} regionCode
 * @param {string} regionName
 * @returns {Promise<Array<Object>>}
 */
async function scrapeGrabFood(regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 180000; // 3 minutes — GrabFood loads more data via clicks

  // Try regency name first, then region name, then province name for coords
  const regencyName = region?.regency?.name || '';
  const coords =
    (regencyName && lookupCityCoords(regencyName)) ||
    lookupCityCoords(regionName) ||
    lookupCityCoords(provinceName);

  if (!coords) {
    console.warn(
      `[SE] GrabFood: No coordinates found for "${regencyName || regionName}". ` +
      `Skipping GrabFood to avoid getting data from wrong location.`
    );
    return [];
  }

  const searchUrl = buildGrabFoodUrl(regionName, coords);
  console.log(`[SE] Opening GrabFood restaurants: ${searchUrl}`);
  console.log(
    `[SE] GrabFood: Will override geolocation to ${coords.lat}, ${coords.lng} for "${regencyName || regionName}"`
  );

  let tab;
  let debuggerAttached = false;

  try {
    // 1. Open a new tab (about:blank first so we can override before navigation)
    tab = await chrome.tabs.create({ url: 'about:blank', active: true });

    // 2. Override geolocation via DevTools Protocol BEFORE navigating
    debuggerAttached = await overrideGeolocation(tab.id, coords);

    // 3. Now navigate to GrabFood
    await chrome.tabs.update(tab.id, { url: searchUrl });
    await waitForTabLoad(tab.id);

    // 4. Set geolocation via JS in MAIN world so GrabFood's JS picks it up
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (lat, lng) => {
          const mockPosition = {
            coords: {
              latitude: lat, longitude: lng, accuracy: 50,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          };
          const origGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
          navigator.geolocation.getCurrentPosition = (success, error, options) => {
            success(mockPosition);
          };
          navigator.geolocation.watchPosition = (success, error, options) => {
            success(mockPosition);
            return 0;
          };
        },
        args: [coords.lat, coords.lng],
      });
      console.log(`[SE] GrabFood: JS geolocation override injected`);

      // Reload the page so GrabFood re-requests location with our override
      await chrome.tabs.reload(tab.id);
      await waitForTabLoad(tab.id);

      // Re-inject after reload
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: (lat, lng) => {
          const mockPosition = {
            coords: {
              latitude: lat, longitude: lng, accuracy: 50,
              altitude: null, altitudeAccuracy: null, heading: null, speed: null,
            },
            timestamp: Date.now(),
          };
          navigator.geolocation.getCurrentPosition = (success) => success(mockPosition);
          navigator.geolocation.watchPosition = (success) => { success(mockPosition); return 0; };
        },
        args: [coords.lat, coords.lng],
      });
    } catch (jsErr) {
      console.warn('[SE] GrabFood: JS geolocation injection failed:', jsErr.message);
    }

    // 5. Extra delay for NextJS hydration and SSR rendering
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // 5. Send the startScrape message and await response
    const response = await sendMessageWithTimeout(
      tab.id,
      {
        action: 'startScrape',
        platform: 'grabfood',
        regionCode,
        regionName,
        provinceName,
        region,
        coords: { lat: coords.lat, lng: coords.lng },
      },
      SCRAPE_TIMEOUT_MS
    );

    if (response && response.success && Array.isArray(response.merchants)) {
      const lookupName = regencyName || regionName;

      if (response.detectedCity) {
        console.log(
          `[SE] GrabFood detected delivery city: "${response.detectedCity}"`
        );

        const lookupLower = lookupName.toLowerCase();
        const detectedLower = response.detectedCity.toLowerCase();

        // Also check province name for broader matching
        const provLower = (provinceName || '').toLowerCase();

        const locationMatches =
          detectedLower.includes(lookupLower) ||
          lookupLower.includes(detectedLower) ||
          (provLower && detectedLower.includes(provLower)) ||
          (provLower && provLower.includes(detectedLower));

        if (!locationMatches) {
          console.warn(
            `[SE] GrabFood LOCATION MISMATCH: Requested "${lookupName}" ` +
            `(province: "${provinceName}") but results are from "${response.detectedCity}". ` +
            `Discarding results to avoid wrong data.`
          );
          return [];
        }
      } else {
        // Could not detect city — geolocation override may have failed.
        // Discard results to avoid returning data from wrong location.
        console.warn(
          `[SE] GrabFood: Could not detect delivery city. ` +
          `Geolocation override to "${lookupName}" may have failed. ` +
          `Discarding ${response.merchants.length} results to avoid wrong data.`
        );
        return [];
      }

      console.log(
        `[SE] GrabFood scrape complete: ${response.merchants.length} merchants`
      );
      return response.merchants;
    }

    console.warn('[SE] GrabFood scrape returned no data:', response);
    return [];
  } catch (err) {
    console.error('[SE] GrabFood scrape failed:', err);
    return [];
  } finally {
    if (tab && tab.id) {
      if (debuggerAttached) {
        await detachDebugger(tab.id);
      }
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // Tab may already be closed
      }
    }
  }
}

// ── GoFood Scraper ──────────────────────────────────────────

// GoFood city mapping now in extension/lib/gofood-cities.js (loaded via importScripts)

/**
 * Build a GoFood restaurants URL.
 *
 * GoFood URL pattern: https://gofood.co.id/en/{parentCity}/{region}-restaurants/most_loved
 * - When parentCity === region: top-level city page (e.g., /en/palu/palu-restaurants/most_loved)
 * - When different: sub-region under a parent city (e.g., /en/parepare/pangkep-restaurants/most_loved)
 *
 * @param {string} regionName — human-readable region/regency name
 * @param {string} [parentCitySlug] — GoFood parent city slug (if known)
 * @returns {{ url: string, citySlug: string, regionSlug: string }}
 */
function buildGoFoodUrl(regionName, parentCitySlug) {
  const baseUrl = 'https://gofood.co.id/en';

  // Slugify region name: strip BPS prefixes, lowercase, hyphenate
  const regionSlug = regionName
    .toLowerCase()
    .trim()
    .replace(/^(kota|kabupaten|kab\.)\s*/i, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9%-]/g, '');

  // If parentCitySlug is explicitly provided, use parent + region pattern
  if (parentCitySlug) {
    return {
      url: `${baseUrl}/${parentCitySlug}/${regionSlug}-restaurants/most_loved`,
      citySlug: parentCitySlug,
      regionSlug,
    };
  }

  // Try matching via GOFOOD_CITIES (from gofood-cities.js)
  const citySlug = lookupGoFoodCitySlug(regionName);
  if (citySlug) {
    return {
      url: `${baseUrl}/${citySlug}/${citySlug}-restaurants/most_loved`,
      citySlug,
      regionSlug: citySlug,
    };
  }

  // Fallback: try using the region name directly as both parent and region
  return {
    url: `${baseUrl}/${regionSlug}/${regionSlug}-restaurants/most_loved`,
    citySlug: regionSlug,
    regionSlug,
  };
}

/**
 * Scrape a single GoFood city page.
 * @param {string} lookupName — city/regency name for URL lookup
 * @param {string} regionCode
 * @param {string} regionName
 * @param {string} provinceName
 * @param {Object} region
 * @returns {Promise<Array<Object>>}
 */
async function scrapeGoFoodCity(lookupName, regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 180000;
  const { url: searchUrl, citySlug } = buildGoFoodUrl(lookupName);
  console.log(`[SE] GoFood city "${lookupName}": ${searchUrl} (slug: ${citySlug})`);

  // Look up coordinates for the city/region
  const coords = lookupCityCoords(lookupName) || lookupCityCoords(regionName) || lookupCityCoords(provinceName);
  if (coords) {
    console.log(`[SE] GoFood: Passing coords ${coords.lat}, ${coords.lng} for "${lookupName}"`);
  }

  let tab;

  try {
    tab = await chrome.tabs.create({ url: searchUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await sendMessageWithTimeout(
      tab.id,
      {
        action: 'startScrape',
        platform: 'gofood',
        regionCode,
        regionName,
        provinceName,
        region,
        coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      },
      SCRAPE_TIMEOUT_MS
    );

    if (response && response.success && Array.isArray(response.merchants)) {
      console.log(`[SE] GoFood city "${lookupName}": ${response.merchants.length} merchants`);
      return response.merchants;
    }

    console.warn(`[SE] GoFood city "${lookupName}": no data returned`);
    return [];
  } catch (err) {
    console.error(`[SE] GoFood city "${lookupName}" failed:`, err);
    return [];
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }
}

/**
 * Fetch and cache districts (kecamatan) for a regency.
 * @param {string} regencyCode — BPS regency code
 * @returns {Promise<Array<{kode_bps: string, nama_bps: string}>>}
 */
async function getDistrictsForRegency(regencyCode) {
  if (!regencyCode) return [];

  const cacheKey = `kecamatan_${regencyCode}`;
  const cache = await StorageHelper.get(STORAGE_KEYS.regionsCache) || {};

  if (cache[cacheKey] && cache[cacheKey].length > 0) {
    return cache[cacheKey];
  }

  try {
    const url = `${BPS_API_BASE}?level=kecamatan&parent=${regencyCode}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    cache[cacheKey] = data;
    await StorageHelper.set(STORAGE_KEYS.regionsCache, cache);
    return data;
  } catch (err) {
    console.warn(`[SE] Failed to fetch districts for regency ${regencyCode}:`, err);
    return [];
  }
}

/**
 * Match a GoFood city name to a BPS regency using the cached regions data.
 * GoFood cities are often BPS cities (KOTA) or regency capitals (kecamatan names).
 *
 * Strategy:
 *   1. Exact match on regency name (strip KOTA/KAB. prefix)
 *   2. Fuzzy match on regency name
 *   3. Search kecamatan (district) level — e.g., "Luwuk" is a kecamatan in KAB. BANGGAI
 *
 * @param {string} goFoodCityName — e.g., "Palu", "Luwuk", "Kisaran"
 * @param {string} provinceCode — BPS province code
 * @returns {Promise<{ regencyCode: string, regencyName: string } | null>}
 */
async function matchGoFoodCityToBpsRegency(goFoodCityName, provinceCode) {
  if (!goFoodCityName || !provinceCode) return null;

  const cityLower = goFoodCityName.toLowerCase().trim();

  try {
    const regencies = await getRegenciesForProvince(provinceCode);
    if (regencies.length === 0) return null;

    // Strategy 1: Exact match on regency name (e.g., "Palu" → "KOTA PALU")
    for (const reg of regencies) {
      const bpsName = (reg.nama_bps || reg.nama || '').toUpperCase();
      const stripped = bpsName.replace(/^(KOTA|KAB\.|KABUPATEN)\s*/i, '').trim().toLowerCase();
      if (stripped === cityLower) {
        return {
          regencyCode: reg.kode_bps || reg.id || '',
          regencyName: reg.nama_bps || reg.nama || '',
        };
      }
    }

    // Strategy 2: Fuzzy match on regency name
    for (const reg of regencies) {
      const bpsName = (reg.nama_bps || reg.nama || '').toLowerCase();
      const stripped = bpsName.replace(/^(kota|kab\.)\s*/i, '').trim();
      if (stripped.includes(cityLower) || cityLower.includes(stripped)) {
        return {
          regencyCode: reg.kode_bps || reg.id || '',
          regencyName: reg.nama_bps || reg.nama || '',
        };
      }
    }

    // Strategy 3: Search kecamatan level — GoFood city might be a regency capital
    // e.g., "Luwuk" is kecamatan in KAB. BANGGAI, "Kisaran" in KAB. ASAHAN
    for (const reg of regencies) {
      const regCode = reg.kode_bps || reg.id || '';
      if (!regCode) continue;

      const districts = await getDistrictsForRegency(regCode);
      for (const dist of districts) {
        const distName = (dist.nama_bps || dist.nama || '').toLowerCase()
          .replace(/^(kec\.|kecamatan)\s*/i, '').trim();
        if (distName === cityLower || distName.includes(cityLower) || cityLower.includes(distName)) {
          console.log(`[SE] GoFood: "${goFoodCityName}" found as kecamatan in ${reg.nama_bps || reg.nama} (${regCode})`);
          return {
            regencyCode: regCode,
            regencyName: reg.nama_bps || reg.nama || '',
          };
        }
      }
    }
  } catch {
    // Cache unavailable
  }

  return null;
}

async function scrapeGoFood(regionCode, regionName, provinceName, region) {
  const merchantMap = new Map();
  const provinceCode = region?.province?.code || regionCode?.substring(0, 2) || '';

  // Check if province has any GoFood coverage at all
  if (provinceCode && !hasGoFoodCoverage(provinceCode)) {
    console.log(`[SE] GoFood: skipping province ${provinceName} (${provinceCode}) — no GoFood coverage`);
    return [];
  }

  // If a specific regency is selected, try multiple strategies to find the right URL
  if (region?.regency?.name) {
    const regencyName = region.regency.name;

    // Strategy 1: Regency itself IS a GoFood city (e.g., "Kota Palu" → palu)
    const directSlug = lookupGoFoodCitySlug(regencyName);
    if (directSlug) {
      // Enrich with BPS regency data
      const bpsMatch = await matchGoFoodCityToBpsRegency(regencyName, provinceCode);
      if (bpsMatch) {
        console.log(`[SE] GoFood: regency "${regencyName}" = GoFood city "${directSlug}" = BPS ${bpsMatch.regencyCode} (${bpsMatch.regencyName})`);
      }
      return await scrapeGoFoodCity(
        regencyName, regionCode, regionName, provinceName, region
      );
    }

    // Strategy 2: Check known sub-region mappings (from gofood-cities.js subRegions arrays)
    const parentMatch = findGoFoodParentCity(regencyName, provinceCode);
    if (parentMatch) {
      console.log(`[SE] GoFood: regency "${regencyName}" mapped to sub-region "${parentMatch.regionSlug}" under "${parentMatch.parentCitySlug}"`);
      const merchants = await scrapeGoFoodCityWithParent(
        regencyName, parentMatch.parentCitySlug, regionCode, regionName, provinceName, region
      );
      if (merchants.length > 0) return merchants;
    }

    // Strategy 3: Try regency as sub-region under each GoFood city in the province (URL probing)
    const provinceCities = getGoFoodCitiesForProvince(provinceCode);
    if (provinceCities.length > 0) {
      console.log(`[SE] GoFood: probing "${regencyName}" as sub-region under ${provinceCities.length} cities`);

      for (const city of provinceCities) {
        if (parentMatch && city.slug === parentMatch.parentCitySlug) continue;

        const merchants = await scrapeGoFoodCityWithParent(
          regencyName, city.slug, regionCode, regionName, provinceName, region
        );
        if (merchants.length > 0) {
          console.log(`[SE] GoFood: found ${merchants.length} merchants for "${regencyName}" under "${city.slug}"`);
          return merchants;
        }
      }

      // Strategy 4: Fall back to scraping each GoFood city in the province directly
      console.log(`[SE] GoFood: no sub-region match for "${regencyName}", trying parent cities directly`);
      for (const city of provinceCities) {
        const merchants = await scrapeGoFoodCity(
          city.name, regionCode, regionName, provinceName, region
        );
        for (const m of merchants) {
          const key = m.merchantUrl || `${m.merchantName}|${m.merchantId}`;
          if (!merchantMap.has(key)) merchantMap.set(key, m);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      return Array.from(merchantMap.values());
    }

    // No GoFood cities in province — try regency name directly as fallback
    return await scrapeGoFoodCity(
      regencyName, regionCode, regionName, provinceName, region
    );
  }

  // Province-level: scrape ALL GoFood cities in this province
  const provinceCities = getGoFoodCitiesForProvince(provinceCode);

  if (provinceCities.length > 0) {
    console.log(`[SE] GoFood: scraping ${provinceCities.length} cities in ${provinceName}`);

    for (const city of provinceCities) {
      // Match this GoFood city to its BPS regency using cached data
      const bpsMatch = await matchGoFoodCityToBpsRegency(city.name, provinceCode);
      const regencyCode = bpsMatch?.regencyCode || '';
      const regencyNameResolved = bpsMatch?.regencyName || city.name;

      const cityRegion = {
        ...region,
        regency: { code: regencyCode, name: regencyNameResolved },
      };

      console.log(`[SE] GoFood: city "${city.name}" → BPS ${regencyCode || '(no match)'} (${regencyNameResolved})`);

      const merchants = await scrapeGoFoodCity(
        city.name, regionCode, regionName, provinceName, cityRegion
      );

      for (const m of merchants) {
        // Enrich merchant with resolved regency data
        if (bpsMatch && !m.regencyCode) {
          m.regencyCode = bpsMatch.regencyCode;
        }
        const key = m.merchantUrl || `${m.merchantName}|${m.merchantId}`;
        if (!merchantMap.has(key)) merchantMap.set(key, m);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } else {
    // Fallback: try the province/region name directly
    const merchants = await scrapeGoFoodCity(
      regionName, regionCode, regionName, provinceName, region
    );
    for (const m of merchants) {
      const key = m.merchantUrl || `${m.merchantName}|${m.merchantId}`;
      if (!merchantMap.has(key)) merchantMap.set(key, m);
    }
  }

  console.log(`[SE] GoFood scrape complete: ${merchantMap.size} unique merchants`);
  return Array.from(merchantMap.values());
}

/**
 * Scrape a GoFood sub-region page under a parent city.
 * URL: /en/{parentCitySlug}/{regionSlug}-restaurants/most_loved
 */
async function scrapeGoFoodCityWithParent(regencyName, parentCitySlug, regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 180000;
  const { url: searchUrl, regionSlug } = buildGoFoodUrl(regencyName, parentCitySlug);
  console.log(`[SE] GoFood sub-region "${regencyName}" under "${parentCitySlug}": ${searchUrl}`);

  const coords = lookupCityCoords(regencyName) || lookupCityCoords(regionName) || lookupCityCoords(provinceName);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: searchUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check if page is a 404 by looking at the title
    const tabInfo = await chrome.tabs.get(tab.id);
    if (tabInfo.title && tabInfo.title.includes('Page not found')) {
      console.log(`[SE] GoFood sub-region "${regencyName}" under "${parentCitySlug}": 404`);
      return [];
    }

    const response = await sendMessageWithTimeout(
      tab.id,
      {
        action: 'startScrape',
        platform: 'gofood',
        regionCode,
        regionName,
        provinceName,
        region,
        coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      },
      SCRAPE_TIMEOUT_MS
    );

    if (response && response.success && Array.isArray(response.merchants)) {
      console.log(`[SE] GoFood sub-region "${regencyName}" under "${parentCitySlug}": ${response.merchants.length} merchants`);
      return response.merchants;
    }

    return [];
  } catch (err) {
    console.error(`[SE] GoFood sub-region "${regencyName}" under "${parentCitySlug}" failed:`, err);
    return [];
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }
}

// ── Lazada Scraper ──────────────────────────────────────────

/**
 * Lazada location mapping. Maps BPS province names to Lazada's
 * A-ID region codes used for location filtering. Lazada Indonesia
 * uses 10 region-level codes (not individual provinces).
 * Provinces not covered by any Lazada region are omitted.
 */
const LAZADA_LOCATION_MAP = {
  // A-ID-1: Jabodetabek
  'DKI JAKARTA': 'A-ID-1',
  'BANTEN': 'A-ID-1',
  // A-ID-2: West Java
  'JAWA BARAT': 'A-ID-2',
  // A-ID-3: Central Java
  'JAWA TENGAH': 'A-ID-3',
  'DI YOGYAKARTA': 'A-ID-3',
  // A-ID-4: East Java
  'JAWA TIMUR': 'A-ID-4',
  // A-ID-6: North Sumatera
  'SUMATERA UTARA': 'A-ID-6',
  // A-ID-7: Riau
  'RIAU': 'A-ID-7',
  // A-ID-8: Sumatera Selatan
  'SUMATERA SELATAN': 'A-ID-8',
  // A-ID-13: Borneo (all Kalimantan provinces)
  'KALIMANTAN BARAT': 'A-ID-13',
  'KALIMANTAN TENGAH': 'A-ID-13',
  'KALIMANTAN SELATAN': 'A-ID-13',
  'KALIMANTAN TIMUR': 'A-ID-13',
  'KALIMANTAN UTARA': 'A-ID-13',
  // A-ID-14: Sulawesi (all Sulawesi provinces)
  'SULAWESI UTARA': 'A-ID-14',
  'SULAWESI TENGAH': 'A-ID-14',
  'SULAWESI SELATAN': 'A-ID-14',
  'SULAWESI TENGGARA': 'A-ID-14',
  'GORONTALO': 'A-ID-14',
  'SULAWESI BARAT': 'A-ID-14',
  // A-ID-15: Nusa Tenggara (NTB, NTT, Bali)
  'BALI': 'A-ID-15',
  'NUSA TENGGARA BARAT': 'A-ID-15',
  'NUSA TENGGARA TIMUR': 'A-ID-15',
};

/**
 * Build a Lazada search URL filtered by region and keyword.
 * Lazada uses the `/tag/{keyword}/` URL pattern with location filter.
 * Location is an A-ID region code (e.g. 'A-ID-14' for Sulawesi).
 * @param {string} regionName — human-readable region name (typically uppercase BPS name)
 * @param {string} provinceName — province name for A-ID region code lookup
 * @param {string} keyword — search keyword
 * @returns {string}
 */
function buildLazadaSearchUrl(regionName, provinceName, keyword) {
  const encodedKeyword = encodeURIComponent(keyword);
  const base = `https://www.lazada.co.id/tag/${encodedKeyword}/`;
  const params = new URLSearchParams({
    catalog_redirect_tag: 'true',
    q: keyword,
  });

  // Use provinceName for location lookup (Lazada filters at island/region level)
  const lookupName = provinceName || regionName;
  const upperName = lookupName.toUpperCase().trim();
  if (LAZADA_LOCATION_MAP[upperName]) {
    params.set('location', LAZADA_LOCATION_MAP[upperName]);
  } else {
    // Fuzzy match: find the first location key that contains the lookup name
    for (const [key, locationCode] of Object.entries(LAZADA_LOCATION_MAP)) {
      if (
        key.includes(upperName) ||
        upperName.includes(key)
      ) {
        params.set('location', locationCode);
        break;
      }
    }
  }

  return `${base}?${params.toString()}`;
}

/**
 * Scrape Lazada merchants for a given region.
 *
 * Flow:
 *   1. Map regionName to a Lazada location filter
 *   2. Open a new tab to the Lazada catalog/search page
 *   3. Wait for the tab to finish loading
 *   4. Send a `startScrape` message to the content script
 *   5. Collect results from the content script response
 *   6. Close the tab
 *   7. Return the merchants array
 *
 * @param {string} regionCode
 * @param {string} regionName
 * @returns {Promise<Array<Object>>}
 */
async function scrapeLazada(regionCode, regionName, provinceName, region) {
  const SCRAPE_TIMEOUT_MS = 180000; // 3 minutes per keyword

  // Load configured keywords (fall back to defaults)
  let keywords;
  try {
    const saved = await StorageHelper.get(STORAGE_KEYS.searchKeywords);
    keywords = Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SEARCH_KEYWORDS;
  } catch {
    keywords = DEFAULT_SEARCH_KEYWORDS;
  }

  console.log(`[SE] Lazada: scraping with ${keywords.length} keywords: ${keywords.join(', ')}`);

  const merchantMap = new Map();

  for (const keyword of keywords) {
    const searchUrl = buildLazadaSearchUrl(regionName, provinceName, keyword);
    console.log(`[SE] Lazada keyword "${keyword}": ${searchUrl}`);

    let tab;

    try {
      tab = await chrome.tabs.create({ url: searchUrl, active: true });
      await waitForTabLoad(tab.id);
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const response = await sendMessageWithTimeout(
        tab.id,
        {
          action: 'startScrape',
          platform: 'lazada',
          regionCode,
          regionName,
          provinceName,
          region,
        },
        SCRAPE_TIMEOUT_MS
      );

      if (response && response.success && Array.isArray(response.merchants)) {
        let newCount = 0;
        for (const m of response.merchants) {
          const key = m.merchantUrl || m.merchantId || m.merchantName;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, m);
            newCount++;
          }
        }
        console.log(
          `[SE] Lazada keyword "${keyword}": ${response.merchants.length} found, ${newCount} new (total: ${merchantMap.size})`
        );
      } else {
        console.warn(`[SE] Lazada keyword "${keyword}": no data returned`);
      }
    } catch (err) {
      console.error(`[SE] Lazada keyword "${keyword}" failed:`, err);
    } finally {
      if (tab && tab.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {
          // Tab may already be closed
        }
      }
    }

    // Brief pause between keywords to avoid rate limiting
    if (keyword !== keywords[keywords.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log(`[SE] Lazada scrape complete: ${merchantMap.size} unique merchants across ${keywords.length} keywords`);
  return Array.from(merchantMap.values());
}

// ── Blibli Scraper ──────────────────────────────────────────

/**
 * Mapping from BPS region/province names (uppercase) to Blibli
 * location filter values used on the `/semua-toko` seller listing page.
 *
 * Province-level entries map to a representative city. Direct city/regency
 * name entries are also included for finer-grained lookups.
 *
 * @type {Record<string, string>}
 */
const BLIBLI_LOCATION_MAP = {
  // ── Province-level mappings (BPS uppercase → Blibli filter value) ──
  'ACEH': 'Nanggroe Aceh Darussalam (NAD)',
  'SUMATERA UTARA': 'Sumatera Utara',
  'SUMATERA BARAT': 'Sumatera Barat',
  'RIAU': 'Riau',
  'JAMBI': 'Jambi',
  'SUMATERA SELATAN': 'Sumatera Selatan',
  'BENGKULU': 'Bengkulu',
  'LAMPUNG': 'Lampung',
  'KEPULAUAN BANGKA BELITUNG': 'Bangka Belitung',
  'KEPULAUAN RIAU': 'Kepulauan Riau',
  'DKI JAKARTA': 'DKI Jakarta',
  'JAWA BARAT': 'Jawa Barat',
  'JAWA TENGAH': 'Jawa Tengah',
  'DI YOGYAKARTA': 'DI Yogyakarta',
  'JAWA TIMUR': 'Jawa Timur',
  'BANTEN': 'Banten',
  'BALI': 'Bali',
  'NUSA TENGGARA BARAT': 'Nusa Tenggara Barat (NTB)',
  'NUSA TENGGARA TIMUR': 'Nusa Tenggara Timur (NTT)',
  'KALIMANTAN BARAT': 'Kalimantan Barat',
  'KALIMANTAN TENGAH': 'Kalimantan Tengah',
  'KALIMANTAN SELATAN': 'Kalimantan Selatan',
  'KALIMANTAN TIMUR': 'Kalimantan Timur',
  'KALIMANTAN UTARA': 'Kalimantan Utara',
  'SULAWESI UTARA': 'Sulawesi Utara',
  'SULAWESI TENGAH': 'Sulawesi Tengah',
  'SULAWESI SELATAN': 'Sulawesi Selatan',
  'SULAWESI TENGGARA': 'Sulawesi Tenggara',
  'GORONTALO': 'Gorontalo',
  'SULAWESI BARAT': 'Sulawesi Barat',
  'MALUKU': 'Maluku',
  'MALUKU UTARA': 'Maluku Utara',
  'PAPUA': 'Papua',
  'PAPUA BARAT': 'Papua Barat',

  // ── City / regency-level mappings (BPS uppercase) ────────
  'KOTA BANDUNG': 'Kota Bandung',
  'KOTA SURABAYA': 'Kota Surabaya',
  'KOTA SEMARANG': 'Kota Semarang',
  'KOTA MEDAN': 'Kota Medan',
  'KOTA PADANG': 'Kota Padang',
  'KOTA PALEMBANG': 'Kota Palembang',
  'KOTA PEKANBARU': 'Kota Pekanbaru',
  'KOTA MAKASSAR': 'Kota Makassar',
  'KOTA MANADO': 'Kota Manado',
  'KOTA TANGERANG': 'Kota Tangerang',
  'KOTA BALIKPAPAN': 'Kota Balikpapan',
  'KOTA BANJARMASIN': 'Kota Banjarmasin',
  'KOTA PONTIANAK': 'Kota Pontianak',
  'KOTA BANDAR LAMPUNG': 'Kota Bandar Lampung',
  'KOTA YOGYAKARTA': 'Kota Yogyakarta',
  'KOTA JAKARTA PUSAT': 'Kota Jakarta Pusat',
  'KOTA JAKARTA SELATAN': 'Kota Jakarta Selatan',
  'KOTA JAKARTA BARAT': 'Kota Jakarta Barat',
  'KOTA JAKARTA TIMUR': 'Kota Jakarta Timur',
  'KOTA JAKARTA UTARA': 'Kota Jakarta Utara',
  'KOTA DENPASAR': 'Kota Denpasar',
  'KOTA PALU': 'Kota Palu',
  'KOTA KENDARI': 'Kota Kendari',
  'KOTA GORONTALO': 'Kota Gorontalo',
  'KOTA AMBON': 'Kota Ambon',
  'KOTA JAYAPURA': 'Kota Jayapura',
  'KOTA KUPANG': 'Kota Kupang',
  'KOTA MATARAM': 'Kota Mataram',
  'KOTA BENGKULU': 'Kota Bengkulu',
  'KOTA JAMBI': 'Kota Jambi',
  'KOTA BANDA ACEH': 'Kota Banda Aceh',
  'KOTA PANGKAL PINANG': 'Kota Pangkal Pinang',
  'KOTA BATAM': 'Kota Batam',
  'KOTA PALANGKA RAYA': 'Kota Palangka Raya',
  'KOTA SAMARINDA': 'Kota Samarinda',
  'KOTA TARAKAN': 'Kota Tarakan',
  'KOTA SORONG': 'Kota Sorong',
  'KOTA TERNATE': 'Kota Ternate',
  'KOTA BONTANG': 'Kota Bontang',
  'KOTA BANJARBARU': 'Kota Banjarbaru',
  'KOTA DUMAI': 'Kota Dumai',
  'KOTA DEPOK': 'Kota Depok',
  'KOTA BEKASI': 'Kota Bekasi',
  'KOTA BOGOR': 'Kota Bogor',
  'KOTA CIMAHI': 'Kota Cimahi',
  'KOTA CIREBON': 'Kota Cirebon',
  'KOTA SUKABUMI': 'Kota Sukabumi',
  'KOTA TASIKMALAYA': 'Kota Tasikmalaya',
  'KOTA TANGERANG SELATAN': 'Kota Tangerang Selatan',
  'KOTA SERANG': 'Kota Serang',
  'KOTA MALANG': 'Kota Malang',
  'KOTA KEDIRI': 'Kota Kediri',
  'KOTA BATU': 'Kota Batu',
  'KOTA MOJOKERTO': 'Kota Mojokerto',
  'KOTA MADIUN': 'Kota Madiun',
  'KOTA BLITAR': 'Kota Blitar',
  'KOTA PASURUAN': 'Kota Pasuruan',
  'KOTA PROBOLINGGO': 'Kota Probolinggo',
  'KOTA SURAKARTA': 'Kota Surakarta (Solo)',
  'KOTA TEGAL': 'Kota Tegal',
  'KOTA PEKALONGAN': 'Kota Pekalongan',
  'KOTA SALATIGA': 'Kota Salatiga',
  'KOTA MAGELANG': 'Kota Magelang',
};

/**
 * Build a Blibli seller listing URL for a given region.
 *
 * Blibli exposes a dedicated seller directory at `/semua-toko` that accepts
 * a `location` query parameter for city/region filtering.
 * URL format: https://www.blibli.com/semua-toko?location=<City+Name>&sort=
 *
 * The function resolves the BPS region name to a Blibli-compatible location
 * value using {@link BLIBLI_LOCATION_MAP}. It tries the region name first
 * (most specific), then falls back to the province name, and ultimately
 * to a generic unfiltered listing if neither matches.
 *
 * @param {string} regionName  — BPS region/regency name (e.g. 'KOTA BANDUNG')
 * @param {string} provinceName — BPS province name (e.g. 'JAWA BARAT')
 * @returns {string} fully-qualified Blibli seller listing URL
 */
function buildBlibliSellerUrl(regionName, provinceName) {
  const upperRegion = (regionName || '').toUpperCase().trim();
  const upperProvince = (provinceName || '').toUpperCase().trim();

  // Try region name first (most specific), then province name
  const location =
    BLIBLI_LOCATION_MAP[upperRegion] ||
    BLIBLI_LOCATION_MAP[regionName] ||
    BLIBLI_LOCATION_MAP[upperProvince] ||
    BLIBLI_LOCATION_MAP[provinceName] ||
    '';

  const url = new URL('https://www.blibli.com/semua-toko');
  if (location) {
    url.searchParams.set('location', location);
  }
  url.searchParams.set('sort', '');

  return url.toString();
}

/**
 * Build a Blibli product search URL with keyword.
 * URL format: https://www.blibli.com/cari/{keyword}
 * @param {string} keyword — search keyword
 * @returns {string}
 */
function buildBlibliSearchUrl(keyword) {
  return `https://www.blibli.com/cari/${encodeURIComponent(keyword)}`;
}

/**
 * Scrape Blibli merchants for a given region using keyword search
 * on the `/cari/{keyword}` pages and `/semua-toko` seller listing.
 *
 * @param {string} regionCode  — BPS region code
 * @param {string} regionName  — BPS region/regency name
 * @param {string} provinceName — BPS province name (used for location mapping)
 * @param {Object} region      — full region descriptor object
 * @returns {Promise<Array<Object>>}
 */
async function scrapeBlibli(regionCode, regionName, provinceName, region) {
  const merchantMap = new Map();

  const sellerUrl = buildBlibliSellerUrl(regionName, provinceName);
  console.log(`[SE] Blibli seller listing: ${sellerUrl}`);

  let tab;
  try {
    tab = await chrome.tabs.create({ url: sellerUrl, active: true });
    await waitForTabLoad(tab.id);
    await new Promise((r) => setTimeout(r, 5000));

    // Extract seller data directly via executeScript — Blibli's /semua-toko
    // uses plain divs (no <a href="/merchant/..."> links), so content script
    // selectors don't match. We scrape the DOM directly instead.
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sellers = [];

        // Seller cards are clickable divs containing: logo img, name container, rating, location
        // Structure: card > [logo, infoWrap > [nameContainer, statsRow]]
        // nameContainer has aria-label or text with store name + optional badge img
        // statsRow has rating + location separated by "."

        // Find all img elements with alt="seller card header logo" — each marks a seller card
        const logos = document.querySelectorAll('img[alt="seller card header logo"]');

        for (const logo of logos) {
          const card = logo.parentElement;
          if (!card) continue;

          // The info wrapper is the sibling of the logo image
          const infoWrap = logo.nextElementSibling;
          if (!infoWrap) continue;

          // First child of infoWrap: name container (has store name text + optional badge)
          const nameContainer = infoWrap.firstElementChild;
          if (!nameContainer) continue;

          // Get the store name — it's the last text element in the name container
          let storeName = '';
          const nameChildren = nameContainer.querySelectorAll('*');
          for (const child of nameChildren) {
            if (child.children.length === 0 && child.tagName !== 'IMG') {
              const t = child.textContent.trim();
              if (t) storeName = t;
            }
          }
          if (!storeName) continue;

          // Check for badge (official/flagship)
          const hasBadge = !!nameContainer.querySelector('img[alt="badge"]');

          // Second child of infoWrap: stats row (rating + location)
          const statsRow = infoWrap.children[1];
          let rating = null;
          let location = '';

          if (statsRow) {
            // Rating is in the first sub-container
            const ratingContainer = statsRow.firstElementChild;
            if (ratingContainer) {
              const ratingText = ratingContainer.textContent.trim();
              const ratingMatch = ratingText.match(/([\d,]+)/);
              if (ratingMatch && !ratingText.includes('Belum')) {
                rating = parseFloat(ratingMatch[1].replace(',', '.'));
              }
            }

            // Location is in the second sub-container (after the "." separator)
            const locContainer = statsRow.children[1];
            if (locContainer) {
              // Find the deepest text node that isn't just "."
              const allEls = locContainer.querySelectorAll('*');
              for (const el of allEls) {
                if (el.children.length === 0 && el.tagName !== 'IMG') {
                  const t = el.textContent.trim();
                  if (t && t !== '.') location = t;
                }
              }
            }
          }

          sellers.push({ storeName, location, rating, hasBadge });
        }

        // Also get the total count shown at the bottom (e.g., "15 seller")
        const countEl = document.body.innerText.match(/(\d+)\s*seller/i);
        const totalCount = countEl ? parseInt(countEl[1], 10) : sellers.length;

        return { sellers, totalCount };
      },
    });

    const data = result?.result || { sellers: [], totalCount: 0 };
    console.log(`[SE] Blibli: found ${data.sellers.length} sellers on page (total: ${data.totalCount})`);

    for (const seller of data.sellers) {
      const slug = seller.storeName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const key = slug || seller.storeName;
      if (merchantMap.has(key)) continue;

      merchantMap.set(key, {
        platform: 'blibli',
        merchantName: seller.storeName,
        merchantUrl: `https://www.blibli.com/merchant/${slug}`,
        merchantId: slug,
        address: seller.location,
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: seller.location || '',
        districtCode: '',
        districtName: '',
        category: '',
        rating: seller.rating,
        totalProducts: null,
        totalSold: null,
        joinDate: '',
        isOfficialStore: seller.hasBadge,
        phone: '',
        description: '',
        scrapedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[SE] Blibli scrape failed:', err);
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
    }
  }

  // Filter merchants by location
  const allMerchants = Array.from(merchantMap.values());
  const filtered = await filterBlibliByLocation(allMerchants, region);
  console.log(`[SE] Blibli after location filter: ${filtered.length} of ${allMerchants.length} merchants`);
  return filtered;
}

/**
 * Filter Blibli merchants to only include those whose location text
 * matches the target region.
 *
 * - If a specific regency is selected (e.g. "Kota Palu"), only keep
 *   merchants whose location matches that regency.
 * - If a province is selected, keep merchants whose location matches
 *   any regency within that province (via BPS data).
 *
 * @param {Array<Object>} merchants
 * @param {Object} region
 * @returns {Promise<Array<Object>>}
 */
async function filterBlibliByLocation(merchants, region) {
  if (!merchants.length) return merchants;

  const provinceCode = region?.province?.code || '';
  const provinceName = region?.province?.name || '';
  const targetRegencyName = region?.regency?.name || '';

  // If a specific regency is selected, filter by that regency name
  if (targetRegencyName) {
    const normalizedTarget = normalizeLocationName(targetRegencyName);
    return merchants.filter(m => {
      const loc = normalizeLocationName(m.address || m.regencyName || '');
      return loc === normalizedTarget || loc.includes(normalizedTarget) || normalizedTarget.includes(loc);
    });
  }

  // Province-level: get all regencies and filter by any match
  if (provinceCode) {
    const regencies = await getRegenciesForProvince(provinceCode);
    if (regencies.length > 0) {
      // Build a set of normalized regency names for this province
      const validNames = new Set();
      for (const reg of regencies) {
        validNames.add(normalizeLocationName(reg.nama_bps));
      }
      // Also add the province name itself
      validNames.add(normalizeLocationName(provinceName));

      return merchants.filter(m => {
        const loc = normalizeLocationName(m.address || m.regencyName || '');
        if (!loc) return false;
        // Check if location matches any regency in the province
        for (const name of validNames) {
          if (loc === name || loc.includes(name) || name.includes(loc)) return true;
        }
        return false;
      });
    }
  }

  // No filter data available — return all
  return merchants;
}

