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

// ── Platform Scraper Stubs ──────────────────────────────────
// Each scraper returns an empty array for now.
// Actual implementations will be added in subsequent tasks.

async function scrapeTokopedia(_regionCode, _regionName) {
  // TODO: Implement Tokopedia scraper
  return [];
}

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
