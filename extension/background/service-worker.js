/**
 * SE Merchant Scraper — Background Service Worker
 *
 * Handles scraping orchestration and data export via
 * message passing from the popup.
 */

importScripts('../lib/constants.js', '../lib/storage.js');

// ── Message Router ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { action } = message;

  if (action === 'scrape') {
    handleScrape(message).then(sendResponse);
    return true; // keep channel open for async response
  }

  if (action === 'export') {
    handleExport(message).then(sendResponse);
    return true;
  }

  return false;
});

// ── Scrape Handler ──────────────────────────────────────────

/**
 * Dispatch a scrape request to the appropriate platform scraper.
 * @param {{ platform: string, regionCode: string, regionName: string }} params
 * @returns {Promise<{ merchants: Array<Object> }>}
 */
async function handleScrape({ platform, regionCode, regionName }) {
  console.log(`[SE] Scraping ${platform} for region ${regionCode} (${regionName})`);

  let merchants = [];

  try {
    switch (platform) {
      case 'tokopedia':
        merchants = await scrapeTokopedia(regionCode, regionName);
        break;
      case 'shopee':
        merchants = await scrapeShopee(regionCode, regionName);
        break;
      case 'grabfood':
        merchants = await scrapeGrabFood(regionCode, regionName);
        break;
      case 'gofood':
        merchants = await scrapeGoFood(regionCode, regionName);
        break;
      case 'lazada':
        merchants = await scrapeLazada(regionCode, regionName);
        break;
      case 'blibli':
        merchants = await scrapeBlibli(regionCode, regionName);
        break;
      case 'zalora':
        merchants = await scrapeZalora(regionCode, regionName);
        break;
      default:
        console.warn(`[SE] Unknown platform: ${platform}`);
    }

    // Persist scraped merchants
    if (merchants.length > 0) {
      await StorageHelper.appendMerchants(platform, regionCode, merchants);
    }
  } catch (err) {
    console.error(`[SE] Scrape failed for ${platform}:`, err);
  }

  return { merchants };
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
 * Tokopedia city-code mapping for the `fcity` search filter.
 * Tokopedia uses its own internal city IDs, not BPS codes. This map
 * covers major Indonesian cities/regions. When an exact match is not
 * found the scraper falls back to a text-based search without the
 * fcity filter.
 */
const TOKOPEDIA_CITY_MAP = {
  'Jakarta': '174,175,176,177,178,179',
  'DKI Jakarta': '174,175,176,177,178,179',
  'Bandung': '170',
  'Surabaya': '267',
  'Semarang': '224',
  'Yogyakarta': '327',
  'Medan': '246',
  'Makassar': '262',
  'Palembang': '251',
  'Denpasar': '204',
  'Bali': '204',
  'Malang': '231',
  'Bekasi': '171',
  'Tangerang': '166',
  'Depok': '172',
  'Bogor': '169',
};

/**
 * Build a Tokopedia search URL filtered by region.
 * @param {string} regionName — human-readable region name
 * @returns {string}
 */
function buildTokopediaSearchUrl(regionName) {
  const base = 'https://www.tokopedia.com/search';
  const params = new URLSearchParams({
    q: '',
    ob: '5',       // sort by newest
    navsource: 'home',
  });

  // Try to find a matching fcity code
  for (const [key, cityIds] of Object.entries(TOKOPEDIA_CITY_MAP)) {
    if (regionName.toLowerCase().includes(key.toLowerCase())) {
      params.set('fcity', cityIds);
      break;
    }
  }

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
async function scrapeTokopedia(regionCode, regionName) {
  const SCRAPE_TIMEOUT_MS = 120000; // 2 minutes max per scrape

  const searchUrl = buildTokopediaSearchUrl(regionName);
  console.log(`[SE] Opening Tokopedia search: ${searchUrl}`);

  let tab;

  try {
    // 1. Open a new tab
    tab = await chrome.tabs.create({ url: searchUrl, active: false });

    // 2. Wait for the tab to finish loading
    await waitForTabLoad(tab.id);

    // 3. Small delay to let the SPA finish rendering
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 4. Send the startScrape message and await response
    const response = await sendMessageWithTimeout(
      tab.id,
      {
        action: 'startScrape',
        platform: 'tokopedia',
        regionCode,
        regionName,
      },
      SCRAPE_TIMEOUT_MS
    );

    if (response && response.success && Array.isArray(response.merchants)) {
      console.log(
        `[SE] Tokopedia scrape complete: ${response.merchants.length} merchants`
      );
      return response.merchants;
    }

    console.warn('[SE] Tokopedia scrape returned no data:', response);
    return [];
  } catch (err) {
    console.error('[SE] Tokopedia scrape failed:', err);
    return [];
  } finally {
    // 5. Close the tab regardless of outcome
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // Tab may already be closed
      }
    }
  }
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
    const maxAttempts = 3;
    const retryDelay = 2000;

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

async function scrapeShopee(_regionCode, _regionName) {
  // TODO: Implement Shopee scraper
  return [];
}

async function scrapeGrabFood(_regionCode, _regionName) {
  // TODO: Implement GrabFood scraper
  return [];
}

async function scrapeGoFood(_regionCode, _regionName) {
  // TODO: Implement GoFood scraper
  return [];
}

async function scrapeLazada(_regionCode, _regionName) {
  // TODO: Implement Lazada scraper
  return [];
}

async function scrapeBlibli(_regionCode, _regionName) {
  // TODO: Implement Blibli scraper
  return [];
}

async function scrapeZalora(_regionCode, _regionName) {
  // TODO: Implement Zalora scraper
  return [];
}
