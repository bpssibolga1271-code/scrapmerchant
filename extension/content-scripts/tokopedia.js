/**
 * SE Merchant Scraper — Tokopedia Content Script
 *
 * Injected on tokopedia.com search pages. Listens for a
 * `startScrape` message from the service worker, extracts
 * unique merchant/seller data from product cards, and sends
 * results back via chrome.runtime.sendMessage.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const MAX_PAGES = 5;
  const SCROLL_DELAY_MS = 800;
  const PAGE_LOAD_TIMEOUT_MS = 15000;
  const MAX_SCROLL_ATTEMPTS = 20;
  const NEXT_PAGE_DELAY_MS = 2000;

  // ── Selectors & Patterns ───────────────────────────────────

  const SELECTORS = {
    /** Main container holding all search result product cards. */
    productsContainer: 'div[data-testid="divSRPContentProducts"]',
    /** Individual product card wrapper. */
    productCard: 'div[data-testid="master-product-card"]',
    /** Fallback: any div that looks like a product card grid item. */
    productCardFallback: 'div[data-testid="divSRPContentProducts"] > div',
    /** Pagination next-page button. */
    nextPageButton: 'nav[aria-label="Halaman berikutnya"], button[aria-label="Halaman berikutnya"]',
    /** Alternative pagination: next page link. */
    nextPageLink: 'a[data-testid="btnShopProductPageNext"]',
  };

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

  /**
   * Smooth-scroll to the bottom of the page in steps to
   * trigger lazy-loading of additional product cards.
   * @returns {Promise<void>}
   */
  async function scrollToBottom() {
    let previousHeight = 0;
    let attempts = 0;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
      const currentHeight = document.documentElement.scrollHeight;

      if (currentHeight === previousHeight) {
        // No new content loaded — we are likely at the bottom
        break;
      }

      previousHeight = currentHeight;
      window.scrollTo({ top: currentHeight, behavior: 'smooth' });
      await sleep(SCROLL_DELAY_MS);
      attempts++;
    }
  }

  // ── Extraction Logic ───────────────────────────────────────

  /**
   * Determine whether a URL points to a Tokopedia shop page (not a
   * product page, category page, or internal link).
   * @param {string} href
   * @returns {boolean}
   */
  function isShopUrl(href) {
    if (!href) return false;

    try {
      const url = new URL(href, 'https://www.tokopedia.com');

      // Exclude known non-shop paths
      const nonShopPaths = [
        '/discovery',
        '/search',
        '/p/',
        '/promo',
        '/help',
        '/about',
        '/careers',
        '/blog',
        '/find/',
        '/hot/',
        '/categories',
        '/top-up',
        '/pulsa',
        '/tiket',
        '/saldo',
        '/feed',
        '/tokopoints',
        '/affiliate',
      ];

      const pathname = url.pathname.toLowerCase();

      for (const prefix of nonShopPaths) {
        if (pathname.startsWith(prefix)) return false;
      }

      // A shop URL is tokopedia.com/{shopname} — one path segment, no sub-paths
      // Product URLs look like tokopedia.com/{shopname}/{product-slug}
      const segments = pathname.split('/').filter(Boolean);
      return segments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(segments[0]);
    } catch {
      return false;
    }
  }

  /**
   * Extract the shop name (slug) from a shop URL.
   * @param {string} href
   * @returns {string}
   */
  function extractShopSlug(href) {
    try {
      const url = new URL(href, 'https://www.tokopedia.com');
      const segments = url.pathname.split('/').filter(Boolean);
      return segments[0] || '';
    } catch {
      return '';
    }
  }

  /**
   * Attempt to find the seller/shop link within a product card element.
   * Strategy:
   *   1. Look for an <a> whose href is a shop URL (one-segment path)
   *   2. Fallback: look for the shop name element by data-testid
   * @param {Element} card
   * @returns {{ name: string, url: string } | null}
   */
  function extractShopInfo(card) {
    // Strategy 1: Find <a> tags with shop-level URLs
    const links = card.querySelectorAll('a[href]');

    for (const link of links) {
      const href = link.href;
      if (isShopUrl(href)) {
        const name = link.textContent.trim();
        if (name) {
          return {
            name,
            url: href.split('?')[0], // strip query params
          };
        }
      }
    }

    // Strategy 2: Look for data-testid based shop elements
    const shopEl =
      card.querySelector('[data-testid="linkProductShopName"]') ||
      card.querySelector('[data-testid="shopName"]') ||
      card.querySelector('span[data-testid*="shop"]');

    if (shopEl) {
      const anchor = shopEl.closest('a') || shopEl.querySelector('a');
      const name = shopEl.textContent.trim();
      const url = anchor ? anchor.href.split('?')[0] : '';

      if (name) {
        return { name, url };
      }
    }

    // Strategy 3: Look for links structurally — shop links typically
    // appear after price but before the location element. We look for
    // the shortest non-product link text that looks like a shop name.
    for (const link of links) {
      const href = link.href;
      if (!href || !href.includes('tokopedia.com/')) continue;

      try {
        const url = new URL(href);
        const segments = url.pathname.split('/').filter(Boolean);

        // Product pages have >=2 segments, shops have exactly 1
        if (segments.length === 1) {
          const text = link.textContent.trim();
          if (text && text.length > 0 && text.length < 100) {
            return {
              name: text,
              url: `https://www.tokopedia.com/${segments[0]}`,
            };
          }
        }
      } catch {
        // skip malformed URLs
      }
    }

    return null;
  }

  /**
   * Extract seller location text from a product card.
   * Location is usually a small text element showing a city name.
   * @param {Element} card
   * @returns {string}
   */
  function extractLocation(card) {
    // Strategy 1: data-testid based
    const locEl =
      card.querySelector('[data-testid="linkProductShopLocation"]') ||
      card.querySelector('[data-testid="shopLocation"]') ||
      card.querySelector('span[data-testid*="location"]') ||
      card.querySelector('span[data-testid*="Location"]');

    if (locEl) {
      return locEl.textContent.trim();
    }

    // Strategy 2: Look for small text elements near the bottom of the card
    // Location text is typically short (city name) and appears after shop name
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      // Location text is typically a city name: short, no special chars
      if (
        text.length > 2 &&
        text.length < 40 &&
        !text.includes('Rp') &&
        !text.includes('%') &&
        !text.includes('terjual') &&
        !text.includes('rating') &&
        span.closest('a') === null
      ) {
        // Check if this looks like an Indonesian city — simple heuristic
        const parent = span.parentElement;
        if (parent) {
          const parentText = parent.textContent.trim();
          // Location elements are usually standalone (not wrapped in long text)
          if (parentText === text || parentText.length < text.length + 10) {
            // Additional check: see if sibling or adjacent element is the shop name
            const prevSibling = span.previousElementSibling;
            const parentPrev = parent.previousElementSibling;
            if (prevSibling || parentPrev) {
              return text;
            }
          }
        }
      }
    }

    return '';
  }

  /**
   * Detect if a product card indicates the seller is an Official Store.
   * @param {Element} card
   * @returns {boolean}
   */
  function isOfficialStore(card) {
    // Check for official store badge via data-testid
    const badge =
      card.querySelector('[data-testid="imgProductShopBadge"]') ||
      card.querySelector('[data-testid="shopBadge"]') ||
      card.querySelector('img[alt*="Official"]') ||
      card.querySelector('img[alt*="official"]');

    if (badge) {
      const alt = badge.getAttribute('alt') || '';
      if (alt.toLowerCase().includes('official')) return true;
      // If the badge image source contains "official", it is an official store
      const src = badge.getAttribute('src') || '';
      if (src.toLowerCase().includes('official')) return true;
    }

    // Check for textual "Official Store" labels
    const labels = card.querySelectorAll('span, div, p');
    for (const el of labels) {
      const text = el.textContent.trim().toLowerCase();
      if (text === 'official store' || text === 'os') return true;
    }

    // Check for official store image badges (common Tokopedia pattern)
    const images = card.querySelectorAll('img');
    for (const img of images) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      if (
        alt.includes('official store') ||
        src.includes('official_store') ||
        src.includes('badge-os') ||
        src.includes('officialstore')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract rating value from a product card if available.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractRating(card) {
    const ratingEl =
      card.querySelector('[data-testid="imgProductRating"]') ||
      card.querySelector('img[alt*="rating"]') ||
      card.querySelector('span[aria-label*="rating"]');

    if (ratingEl) {
      const ariaLabel = ratingEl.getAttribute('aria-label') || '';
      const match = ariaLabel.match(/([\d.]+)/);
      if (match) return parseFloat(match[1]);
    }

    // Try to find a rating number near a star icon
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      const ratingMatch = text.match(/^(\d+\.?\d*)$/);
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val >= 1 && val <= 5) {
          // Confirm it is near a star icon (sibling or parent has star)
          const parent = span.parentElement;
          if (parent) {
            const hasStar =
              parent.querySelector('img[alt*="star"]') ||
              parent.querySelector('img[src*="star"]') ||
              parent.querySelector('svg');
            if (hasStar) return val;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract the product category text from a product card if present.
   * @param {Element} card
   * @returns {string}
   */
  function extractCategory(card) {
    const catEl =
      card.querySelector('[data-testid="lblProductCategory"]') ||
      card.querySelector('[data-testid="productCategory"]');

    if (catEl) {
      return catEl.textContent.trim();
    }

    return '';
  }

  /**
   * Extract sold count from a product card if available.
   * Tokopedia shows "XX terjual" on product cards.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractSoldCount(card) {
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim().toLowerCase();
      const match = text.match(/([\d.]+)\+?\s*(?:rb\+?\s*)?terjual/);
      if (match) {
        let count = parseFloat(match[1].replace(/\./g, ''));
        // "rb" means ribu (thousand)
        if (text.includes('rb')) count *= 1000;
        return count;
      }
    }
    return null;
  }

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Collect unique merchants from all product cards currently
   * visible on the page.
   * @param {Map<string, Object>} merchantMap — existing merchants (keyed by URL)
   * @param {string} regionCode
   * @param {string} regionName
   */
  function collectMerchantsFromPage(merchantMap, regionCode, regionName) {
    const cards =
      document.querySelectorAll(SELECTORS.productCard).length > 0
        ? document.querySelectorAll(SELECTORS.productCard)
        : document.querySelectorAll(SELECTORS.productCardFallback);

    for (const card of cards) {
      const shopInfo = extractShopInfo(card);
      if (!shopInfo || !shopInfo.name) continue;

      // Build a canonical URL key for deduplication
      const urlKey = shopInfo.url || shopInfo.name.toLowerCase();

      if (merchantMap.has(urlKey)) continue;

      const location = extractLocation(card);
      const official = isOfficialStore(card);
      const rating = extractRating(card);
      const category = extractCategory(card);
      const totalSold = extractSoldCount(card);

      merchantMap.set(urlKey, {
        platform: 'tokopedia',
        merchantName: shopInfo.name,
        merchantUrl: shopInfo.url || '',
        merchantId: extractShopSlug(shopInfo.url || ''),
        address: location,
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: '',
        districtCode: '',
        districtName: '',
        category: category,
        rating: rating,
        totalProducts: null,
        totalSold: totalSold,
        joinDate: '',
        isOfficialStore: official,
        phone: '',
        description: '',
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Navigate to the next search results page if a pagination
   * control exists.
   * @returns {boolean} true if navigation was triggered
   */
  function goToNextPage() {
    // Strategy 1: find a "next page" navigation button
    const nextBtn =
      document.querySelector('button[aria-label="Laman berikutnya"]') ||
      document.querySelector('button[aria-label="Halaman berikutnya"]') ||
      document.querySelector(SELECTORS.nextPageLink) ||
      document.querySelector('nav[role="navigation"] a:last-child');

    if (nextBtn) {
      // Verify the button is not disabled
      if (
        nextBtn.disabled ||
        nextBtn.getAttribute('aria-disabled') === 'true' ||
        nextBtn.classList.contains('disabled')
      ) {
        return false;
      }

      nextBtn.click();
      return true;
    }

    // Strategy 2: look for a numbered pagination link for the next page
    const currentUrl = new URL(window.location.href);
    const currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);
    const nextPageNum = currentPage + 1;

    const allPageLinks = document.querySelectorAll('nav a[href], nav button');
    for (const link of allPageLinks) {
      const text = link.textContent.trim();
      if (text === String(nextPageNum)) {
        link.click();
        return true;
      }
    }

    return false;
  }

  /**
   * Core scraping loop: scroll to load all products on current page,
   * collect merchants, then paginate up to MAX_PAGES.
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  async function scrapeAllPages(regionCode, regionName) {
    const merchantMap = new Map();
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      console.log(
        `[SE-Tokopedia] Scraping page ${currentPage}/${MAX_PAGES}...`
      );

      // Wait for the product container to appear
      const container = await waitForElement(
        SELECTORS.productsContainer,
        PAGE_LOAD_TIMEOUT_MS
      );

      if (!container) {
        console.warn('[SE-Tokopedia] Product container not found, stopping.');
        break;
      }

      // Scroll to load lazy content
      await scrollToBottom();

      // Small extra wait for any remaining lazy renders
      await sleep(500);

      // Collect merchants from current page
      const previousCount = merchantMap.size;
      collectMerchantsFromPage(merchantMap, regionCode, regionName);

      const newCount = merchantMap.size - previousCount;
      console.log(
        `[SE-Tokopedia] Page ${currentPage}: found ${newCount} new merchants (total: ${merchantMap.size})`
      );

      // Attempt pagination
      if (currentPage < MAX_PAGES) {
        const navigated = goToNextPage();
        if (!navigated) {
          console.log('[SE-Tokopedia] No next page available, stopping.');
          break;
        }

        // Wait for navigation / new page to load
        await sleep(NEXT_PAGE_DELAY_MS);

        // Wait for the new page's product container
        await waitForElement(SELECTORS.productsContainer, PAGE_LOAD_TIMEOUT_MS);
      }

      currentPage++;
    }

    console.log(
      `[SE-Tokopedia] Scraping complete. Total unique merchants: ${merchantMap.size}`
    );

    return Array.from(merchantMap.values());
  }

  // ── Message Listener ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'tokopedia') {
      return false;
    }

    const { regionCode, regionName } = message;

    console.log(
      `[SE-Tokopedia] Received startScrape for region ${regionCode} (${regionName})`
    );

    scrapeAllPages(regionCode, regionName)
      .then((merchants) => {
        sendResponse({ success: true, merchants });
      })
      .catch((err) => {
        console.error('[SE-Tokopedia] Scraping error:', err);
        sendResponse({ success: false, merchants: [], error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-Tokopedia] Content script loaded and ready.');
})();
