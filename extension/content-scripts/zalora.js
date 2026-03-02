/**
 * SE Merchant Scraper — Zalora Content Script
 *
 * Injected on zalora.co.id pages. Listens for a `startScrape`
 * message from the service worker, parses the brands directory
 * page to extract brand/merchant data, and sends results back.
 *
 * Zalora is fashion-focused so "merchants" are "brands". The
 * brands directory at /brands/ contains an alphabetical A-Z
 * listing with simple <ul>/<li>/<a> elements.
 *
 * Individual brand URLs follow the pattern:
 *   https://www.zalora.co.id/c/{brand-slug}/b-{brand-id}
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const PAGE_LOAD_TIMEOUT_MS = 15000;

  // ── Selectors & Patterns ───────────────────────────────────

  /**
   * Regex to extract the brand ID from a brand URL.
   * Pattern: /c/{slug}/b-{numericId} or similar patterns.
   */
  const BRAND_ID_REGEX = /\/b-(\d+)/;

  /**
   * Regex to extract the brand slug from a brand URL.
   * Pattern: /c/{brand-slug}/
   */
  const BRAND_SLUG_REGEX = /\/c\/([^/]+)/;

  // ── Utility Helpers ────────────────────────────────────────

  /**
   * Wait for a DOM element to appear, resolved via polling.
   * @param {string} selector
   * @param {number} [timeoutMs]
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selector, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeoutMs);
    });
  }

  /**
   * Sleep for a given number of milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Extraction Logic ───────────────────────────────────────

  /**
   * Determine whether a URL points to a Zalora brand page.
   * @param {string} href
   * @returns {boolean}
   */
  function isBrandUrl(href) {
    if (!href) return false;

    try {
      const url = new URL(href, 'https://www.zalora.co.id');

      // Brand URLs typically contain /c/{slug} or /b-{id}
      const pathname = url.pathname;
      return BRAND_SLUG_REGEX.test(pathname) || BRAND_ID_REGEX.test(pathname);
    } catch {
      return false;
    }
  }

  /**
   * Extract the brand ID from a brand URL.
   * @param {string} href
   * @returns {string}
   */
  function extractBrandId(href) {
    if (!href) return '';

    const match = href.match(BRAND_ID_REGEX);
    return match ? match[1] : '';
  }

  /**
   * Extract the brand slug from a brand URL.
   * @param {string} href
   * @returns {string}
   */
  function extractBrandSlug(href) {
    if (!href) return '';

    const match = href.match(BRAND_SLUG_REGEX);
    return match ? match[1] : '';
  }

  /**
   * Normalize a brand URL to a canonical form.
   * @param {string} href
   * @returns {string}
   */
  function normalizeBrandUrl(href) {
    if (!href) return '';

    try {
      const url = new URL(href, 'https://www.zalora.co.id');
      // Strip query params and hash for deduplication
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
      return href;
    }
  }

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Collect all brand entries from the brands directory page.
   * The brands page has an alphabetical A-Z listing with simple
   * <ul>/<li>/<a> elements.
   *
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  async function scrapeBrandsPage(regionCode, regionName) {
    const merchantMap = new Map();

    console.log('[SE-Zalora] Starting brand extraction from brands page...');

    // Wait for the page content to be present
    await waitForElement('body', PAGE_LOAD_TIMEOUT_MS);

    // Give extra time for any dynamic rendering
    await sleep(2000);

    // Strategy 1: Find all links on the brands page that match brand URL patterns
    const allLinks = document.querySelectorAll('a[href]');
    let brandLinksFound = 0;

    for (const link of allLinks) {
      const href = link.href || link.getAttribute('href') || '';
      const fullUrl = normalizeBrandUrl(href);

      if (!fullUrl) continue;

      // Check if this is a brand URL
      if (!isBrandUrl(fullUrl)) continue;

      const brandName = link.textContent.trim();
      if (!brandName) continue;

      // Skip navigation/header/footer links that happen to match
      if (brandName.length > 200) continue;
      if (brandName.length < 1) continue;

      brandLinksFound++;

      // Use the normalized URL as the deduplication key
      if (merchantMap.has(fullUrl)) continue;

      const brandId = extractBrandId(fullUrl);
      const brandSlug = extractBrandSlug(fullUrl);

      merchantMap.set(fullUrl, {
        platform: 'zalora',
        merchantName: brandName,
        merchantUrl: fullUrl,
        merchantId: brandId || brandSlug || '',
        address: '',
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: '',
        districtCode: '',
        districtName: '',
        category: 'Fashion',
        rating: null,
        totalProducts: null,
        totalSold: null,
        joinDate: '',
        isOfficialStore: true,
        phone: '',
        description: '',
        scrapedAt: new Date().toISOString(),
      });
    }

    console.log(
      `[SE-Zalora] Found ${brandLinksFound} brand links, ${merchantMap.size} unique brands.`
    );

    // Strategy 2: If Strategy 1 found nothing, try looking for
    // list elements that contain brand links (more structured approach)
    if (merchantMap.size === 0) {
      console.log('[SE-Zalora] Trying alternative extraction via list elements...');

      const listItems = document.querySelectorAll('ul li a[href]');

      for (const link of listItems) {
        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = normalizeBrandUrl(href);

        if (!fullUrl) continue;

        // On the brands page, most list links point to brand pages
        // Accept links that contain zalora.co.id in them
        const isZaloraLink = fullUrl.includes('zalora.co.id');
        if (!isZaloraLink) continue;

        // Exclude obviously non-brand links
        const pathname = new URL(fullUrl).pathname;
        const excludePaths = [
          '/brands/',
          '/faq',
          '/help',
          '/about',
          '/contact',
          '/terms',
          '/privacy',
          '/careers',
          '/press',
        ];

        const isExcluded = excludePaths.some(
          (p) => pathname === p || pathname === p + '/'
        );
        if (isExcluded) continue;

        // Must have at least one path segment
        const segments = pathname.split('/').filter(Boolean);
        if (segments.length === 0) continue;

        const brandName = link.textContent.trim();
        if (!brandName || brandName.length > 200) continue;

        if (merchantMap.has(fullUrl)) continue;

        const brandId = extractBrandId(fullUrl);
        const brandSlug = extractBrandSlug(fullUrl) || segments[segments.length - 1];

        merchantMap.set(fullUrl, {
          platform: 'zalora',
          merchantName: brandName,
          merchantUrl: fullUrl,
          merchantId: brandId || brandSlug || '',
          address: '',
          provinceCode: regionCode,
          provinceName: regionName,
          regencyCode: '',
          regencyName: '',
          districtCode: '',
          districtName: '',
          category: 'Fashion',
          rating: null,
          totalProducts: null,
          totalSold: null,
          joinDate: '',
          isOfficialStore: true,
          phone: '',
          description: '',
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(
        `[SE-Zalora] Alternative extraction found ${merchantMap.size} brands.`
      );
    }

    // Strategy 3: If still nothing, try to extract from any structured
    // container that looks like a brand listing
    if (merchantMap.size === 0) {
      console.log('[SE-Zalora] Trying fallback extraction from all text links...');

      // Look for containers that might hold brand lists
      const containers = document.querySelectorAll(
        '[class*="brand"], [class*="Brand"], [id*="brand"], [id*="Brand"], ' +
        '[data-testid*="brand"], [data-qa*="brand"]'
      );

      for (const container of containers) {
        const links = container.querySelectorAll('a[href]');

        for (const link of links) {
          const href = link.href || link.getAttribute('href') || '';
          const fullUrl = normalizeBrandUrl(href);

          if (!fullUrl || !fullUrl.includes('zalora.co.id')) continue;
          if (merchantMap.has(fullUrl)) continue;

          const brandName = link.textContent.trim();
          if (!brandName || brandName.length > 200) continue;

          const brandId = extractBrandId(fullUrl);
          const brandSlug = extractBrandSlug(fullUrl);
          const pathname = new URL(fullUrl).pathname;
          const segments = pathname.split('/').filter(Boolean);

          merchantMap.set(fullUrl, {
            platform: 'zalora',
            merchantName: brandName,
            merchantUrl: fullUrl,
            merchantId: brandId || brandSlug || segments[segments.length - 1] || '',
            address: '',
            provinceCode: regionCode,
            provinceName: regionName,
            regencyCode: '',
            regencyName: '',
            districtCode: '',
            districtName: '',
            category: 'Fashion',
            rating: null,
            totalProducts: null,
            totalSold: null,
            joinDate: '',
            isOfficialStore: true,
            phone: '',
            description: '',
            scrapedAt: new Date().toISOString(),
          });
        }
      }

      console.log(
        `[SE-Zalora] Fallback extraction found ${merchantMap.size} brands.`
      );
    }

    console.log(
      `[SE-Zalora] Scraping complete. Total unique brands: ${merchantMap.size}`
    );

    return Array.from(merchantMap.values());
  }

  // ── Message Listener ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'zalora') {
      return false;
    }

    const { regionCode, regionName } = message;

    console.log(
      `[SE-Zalora] Received startScrape for region ${regionCode} (${regionName})`
    );

    scrapeBrandsPage(regionCode, regionName)
      .then((merchants) => {
        sendResponse({ success: true, merchants });
      })
      .catch((err) => {
        console.error('[SE-Zalora] Scraping error:', err);
        sendResponse({ success: false, merchants: [], error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-Zalora] Content script loaded and ready.');
})();
