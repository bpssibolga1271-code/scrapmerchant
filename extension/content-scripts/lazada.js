/**
 * SE Merchant Scraper — Lazada Content Script
 *
 * Injected on lazada.co.id search/catalog pages. Listens for a
 * `startScrape` message from the service worker, extracts
 * unique merchant/seller data from product cards, and sends
 * results back via chrome.runtime.sendMessage.
 *
 * Lazada (Alibaba Group) uses JavaScript-rendered content with
 * React-based components. Product cards in search results contain
 * seller shop links following the pattern /shop/{shopName}.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const MAX_PAGES = 5;
  const SCROLL_DELAY_MS = 1000;
  const PAGE_LOAD_TIMEOUT_MS = 20000;
  const MAX_SCROLL_ATTEMPTS = 25;
  const NEXT_PAGE_DELAY_MS = 3000;

  // ── Selectors & Patterns ───────────────────────────────────

  /**
   * Lazada uses data-qa-locator attributes and structured class names
   * for its search result pages. The catalog/search page renders a
   * grid of product cards, each containing seller/shop information.
   */
  const SELECTORS = {
    /** Main grid container for search result items. */
    productsGrid: '[data-qa-locator="general-products"], div[data-tracking="product-card"]',
    /** Individual product card wrappers. */
    productCard: '[data-qa-locator="product-item"], div[data-tracking="product-card"]',
    /** Fallback: grid item containers in the search results. */
    productCardFallback: '.gridItem, [class*="GridItem"], [class*="grid-item"]',
    /** Pagination next-page button. */
    nextPageButton: 'li.ant-pagination-next:not(.ant-pagination-disabled) > a, button[aria-label="Next Page"]',
    /** Alternative: pagination items as links. */
    paginationItem: 'li.ant-pagination-item a, ul[class*="pagination"] li a',
  };

  /**
   * Regex patterns to detect a Lazada shop URL from an anchor href.
   * Shop pages follow the pattern: lazada.co.id/shop/{shopName}
   */
  const SHOP_URL_PATTERN = /^https?:\/\/(?:www\.)?lazada\.co\.id\/shop\/([a-zA-Z0-9_-]+)/;

  // ── Utility Helpers ────────────────────────────────────────

  /**
   * Wait for a DOM element to appear, resolved via MutationObserver.
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
   * Wait for product cards to appear on the page using flexible
   * detection since Lazada's DOM structure may vary.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  function waitForProducts(timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const check = () => {
        // Look for product cards via known selectors
        const cards = findProductCards();
        if (cards.length > 0) return true;

        // Fallback: look for any shop links on the page
        const shopLinks = findShopLinks();
        return shopLinks.length > 0;
      };

      if (check()) {
        resolve(true);
        return;
      }

      const observer = new MutationObserver(() => {
        if (check()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(check());
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

  // ── CAPTCHA / Verification Detection ──────────────────────

  /**
   * Detect whether a CAPTCHA, verification challenge, or blocking
   * dialog is currently visible on the page.  Lazada (Alibaba Group)
   * commonly uses "baxia" slider-verify challenges.
   *
   * @returns {boolean} true when a CAPTCHA/challenge element is found
   */
  function detectCaptcha() {
    // 1. Elements whose class or id contains known captcha keywords
    const captchaKeywords = ['captcha', 'baxia', 'slide-verify', 'slide_verify'];
    for (const keyword of captchaKeywords) {
      const byClass = document.querySelector(
        `[class*="${keyword}" i], [id*="${keyword}" i]`
      );
      if (byClass) return true;
    }

    // 2. Modal / dialog overlays that may block the page
    const overlaySelectors = [
      '.modal-mask',
      '.ant-modal-mask',
      '[class*="overlay"][class*="verify"]',
      '[class*="dialog"][class*="verify"]',
      '[role="dialog"]',
    ];
    for (const sel of overlaySelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          // Only flag if the overlay text / children hint at verification
          const text = el.textContent.toLowerCase();
          if (
            text.includes('verify') ||
            text.includes('verifikasi') ||
            text.includes('captcha') ||
            text.includes('slide')
          ) {
            return true;
          }
        }
      }
    }

    // 3. Iframes with captcha-related sources
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.getAttribute('src') || '').toLowerCase();
      if (
        src.includes('captcha') ||
        src.includes('baxia') ||
        src.includes('verify') ||
        src.includes('slider') ||
        src.includes('challenge')
      ) {
        return true;
      }
    }

    // 4. Slide-to-verify type challenges (text-based detection)
    const verifyPhrases = ['slide to verify', 'verify', 'verifikasi'];
    const candidates = document.querySelectorAll(
      'h1, h2, h3, h4, p, span, div, label'
    );
    for (const el of candidates) {
      // Only check direct (shallow) text to avoid scanning entire subtrees
      if (el.children.length > 10) continue;
      const text = el.textContent.trim().toLowerCase();
      if (text.length > 200) continue;

      for (const phrase of verifyPhrases) {
        if (text === phrase || text.startsWith(phrase)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Wait for the user to manually solve a CAPTCHA / verification
   * challenge.  Notifies the service worker so the popup can
   * display an appropriate status, then polls every 3 seconds
   * until the challenge element disappears.
   *
   * @returns {Promise<void>}
   */
  async function waitForCaptchaResolution() {
    console.log(
      '[SE-Lazada] CAPTCHA/verification detected — waiting for user to solve it...'
    );

    chrome.runtime.sendMessage({
      action: 'captchaDetected',
      platform: 'lazada',
    });

    // Poll until the CAPTCHA is no longer present
    while (detectCaptcha()) {
      await sleep(3000);
    }

    console.log('[SE-Lazada] CAPTCHA resolved, resuming...');

    chrome.runtime.sendMessage({
      action: 'captchaResolved',
      platform: 'lazada',
    });
  }

  // ── Extraction Logic ───────────────────────────────────────

  /**
   * Find all anchor elements on the page that link to a Lazada shop.
   * @returns {HTMLAnchorElement[]}
   */
  function findShopLinks() {
    const allLinks = document.querySelectorAll('a[href]');
    const shopLinks = [];

    for (const link of allLinks) {
      if (isShopUrl(link.href)) {
        shopLinks.push(link);
      }
    }

    return shopLinks;
  }

  /**
   * Determine whether a URL points to a Lazada shop page.
   * Shop URLs follow: lazada.co.id/shop/{shopName}
   * @param {string} href
   * @returns {boolean}
   */
  function isShopUrl(href) {
    if (!href) return false;

    try {
      const url = new URL(href, 'https://www.lazada.co.id');

      // Must be on lazada.co.id
      if (!url.hostname.endsWith('lazada.co.id')) return false;

      const pathname = url.pathname;

      // Shop URL pattern: /shop/{shopName}
      if (/^\/shop\/[a-zA-Z0-9_-]+/.test(pathname)) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extract the shop slug/name from a Lazada shop URL.
   * @param {string} href
   * @returns {string}
   */
  function extractShopSlug(href) {
    try {
      const match = href.match(SHOP_URL_PATTERN);
      if (match) return match[1];

      const url = new URL(href, 'https://www.lazada.co.id');
      const segments = url.pathname.split('/').filter(Boolean);

      // /shop/{shopName}
      if (segments.length >= 2 && segments[0] === 'shop') {
        return segments[1];
      }

      return '';
    } catch {
      return '';
    }
  }

  /**
   * Find product card elements on the current page.
   * @returns {Element[]}
   */
  function findProductCards() {
    // Strategy 1: use known selectors
    let cards = document.querySelectorAll(SELECTORS.productCard);
    if (cards.length > 0) return Array.from(cards);

    // Strategy 2: fallback selectors
    cards = document.querySelectorAll(SELECTORS.productCardFallback);
    if (cards.length > 0) return Array.from(cards);

    // Strategy 3: bottom-up from shop links — find the card boundary
    const shopLinks = findShopLinks();
    const cardSet = new Set();

    for (const link of shopLinks) {
      let el = link.parentElement;
      let depth = 0;

      while (el && depth < 10) {
        if (el.parentElement) {
          const siblings = el.parentElement.children;
          let siblingShopLinks = 0;

          for (const sib of siblings) {
            if (sib !== el) {
              const sibLinks = sib.querySelectorAll('a[href]');
              for (const l of sibLinks) {
                if (isShopUrl(l.href)) {
                  siblingShopLinks++;
                  break;
                }
              }
            }
          }

          // If multiple siblings also have shop links, this level is the card
          if (siblingShopLinks >= 2) {
            cardSet.add(el);
            break;
          }
        }

        el = el.parentElement;
        depth++;
      }
    }

    return Array.from(cardSet);
  }

  /**
   * Given a product card element, try to find the shop/seller information.
   * Lazada product cards contain a link to the seller's shop page
   * following the pattern /shop/{shopName}.
   *
   * @param {Element} card
   * @returns {{ name: string, url: string } | null}
   */
  function extractShopInfo(card) {
    const links = card.querySelectorAll('a[href]');

    // Strategy 1: find <a> tags that link to /shop/{name}
    for (const link of links) {
      const href = link.href;
      if (isShopUrl(href)) {
        const name = link.textContent.trim();
        if (name && name.length > 0 && name.length < 200) {
          return {
            name,
            url: href.split('?')[0],
          };
        }
      }
    }

    // Strategy 2: look for shop name text elements near shop links
    const allText = card.querySelectorAll('span, div, a');
    for (const el of allText) {
      const anchor = el.closest('a[href]');
      if (anchor && isShopUrl(anchor.href)) {
        const text = el.textContent.trim();
        if (text && text.length > 0 && text.length < 200) {
          return {
            name: text,
            url: anchor.href.split('?')[0],
          };
        }
      }
    }

    // Strategy 3: look for seller name by data attributes or class patterns
    const sellerEl =
      card.querySelector('[class*="seller"], [class*="Seller"]') ||
      card.querySelector('[class*="shop-name"], [class*="shopName"]') ||
      card.querySelector('[data-seller-name]');

    if (sellerEl) {
      const name =
        sellerEl.getAttribute('data-seller-name') ||
        sellerEl.textContent.trim();
      const anchor = sellerEl.closest('a[href]') || sellerEl.querySelector('a[href]');
      const url = anchor ? anchor.href.split('?')[0] : '';

      if (name) {
        return { name, url };
      }
    }

    return null;
  }

  /**
   * Extract seller location text from a product card.
   * Lazada shows location badges on product cards, usually as
   * a small text element indicating the seller's city/region.
   * @param {Element} card
   * @returns {string}
   */
  function extractLocation(card) {
    // Strategy 1: look for location-specific elements
    const locEl =
      card.querySelector('[class*="location"], [class*="Location"]') ||
      card.querySelector('[data-qa-locator="product-location"]') ||
      card.querySelector('[class*="city"], [class*="City"]');

    if (locEl) {
      const text = locEl.textContent.trim();
      if (text && text.length > 0 && text.length < 80) {
        return text;
      }
    }

    // Strategy 2: look for small text elements that appear to be location
    const spans = card.querySelectorAll('span, div');
    for (const span of spans) {
      const text = span.textContent.trim();

      if (
        text.length >= 2 &&
        text.length <= 50 &&
        !text.includes('Rp') &&
        !text.includes('%') &&
        !text.includes('terjual') &&
        !text.includes('sold') &&
        !text.includes('rating') &&
        !text.match(/^\d/) &&
        !text.includes('OFF') &&
        !text.includes('Diskon')
      ) {
        // Check for location-related class names on element or parent
        const className = (span.className || '').toLowerCase();
        const parentClassName = (span.parentElement?.className || '').toLowerCase();

        if (
          className.includes('location') ||
          className.includes('city') ||
          parentClassName.includes('location') ||
          parentClassName.includes('city')
        ) {
          return text;
        }
      }
    }

    return '';
  }

  /**
   * Detect if a product card indicates the seller is a LazMall
   * (official store) or has a trusted seller badge.
   * @param {Element} card
   * @returns {boolean}
   */
  function isOfficialStore(card) {
    // Check for LazMall badge images
    const images = card.querySelectorAll('img');
    for (const img of images) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      if (
        alt.includes('lazmall') ||
        alt.includes('laz mall') ||
        alt.includes('official') ||
        src.includes('lazmall') ||
        src.includes('laz-mall') ||
        src.includes('official')
      ) {
        return true;
      }
    }

    // Check for textual "LazMall" or "Official Store" labels
    const labels = card.querySelectorAll('span, div, i');
    for (const el of labels) {
      const text = el.textContent.trim().toLowerCase();
      if (
        text === 'lazmall' ||
        text === 'laz mall' ||
        text === 'official store' ||
        text === 'official'
      ) {
        return true;
      }
    }

    // Check class-based patterns
    const html = card.innerHTML.toLowerCase();
    if (
      html.includes('lazmall') ||
      html.includes('laz-mall') ||
      html.includes('official-store') ||
      html.includes('ic-dynamic-badge-lazmall')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extract rating value from a product card if available.
   * Lazada shows star ratings on product cards.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractRating(card) {
    // Look for rating containers with data attributes or aria labels
    const ratingContainers = card.querySelectorAll(
      '[class*="rating"], [class*="Rating"], [class*="star"], [aria-label*="rating"]'
    );

    for (const container of ratingContainers) {
      // Check aria-label
      const ariaLabel = container.getAttribute('aria-label') || '';
      const ariaMatch = ariaLabel.match(/([\d.]+)/);
      if (ariaMatch) {
        const val = parseFloat(ariaMatch[1]);
        if (val >= 0 && val <= 5) return val;
      }

      // Check text content
      const text = container.textContent.trim();
      const textMatch = text.match(/^([\d.]+)$/);
      if (textMatch) {
        const val = parseFloat(textMatch[1]);
        if (val >= 0 && val <= 5) return val;
      }
    }

    // Fallback: look for a number near star icons/SVGs
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      const ratingMatch = text.match(/^(\d+\.?\d*)$/);
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val >= 1 && val <= 5) {
          const parent = span.parentElement;
          if (parent) {
            const hasStar =
              parent.querySelector('svg') ||
              parent.querySelector('img[src*="star"]') ||
              parent.querySelector('[class*="star"]') ||
              parent.querySelector('[class*="rating"]');
            if (hasStar) return val;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract sold count from a product card.
   * Lazada shows sold count like "123 sold" or "1rb terjual".
   * @param {Element} card
   * @returns {number|null}
   */
  function extractSoldCount(card) {
    const elements = card.querySelectorAll('span, div');
    for (const el of elements) {
      const text = el.textContent.trim().toLowerCase();

      // Pattern: "123 sold", "1.2k sold"
      const soldMatch = text.match(/([\d.,]+)\s*(?:k)?\+?\s*sold/);
      if (soldMatch) {
        let count = parseFloat(soldMatch[1].replace(/,/g, ''));
        if (text.includes('k sold') || text.includes('k+ sold')) count *= 1000;
        return count;
      }

      // Indonesian pattern: "123 terjual", "1rb terjual"
      const terjualMatch = text.match(/([\d.,]+)\s*(?:rb)?\+?\s*terjual/);
      if (terjualMatch) {
        let count = parseFloat(terjualMatch[1].replace(/\./g, '').replace(/,/g, '.'));
        if (text.includes('rb')) count *= 1000;
        return count;
      }

      // Pattern: "1,2rb terjual"
      const altMatch = text.match(/([\d,]+)\s*rb\+?\s*terjual/);
      if (altMatch) {
        const num = parseFloat(altMatch[1].replace(/,/g, '.'));
        return num * 1000;
      }
    }
    return null;
  }

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Check if a seller location text matches the target province/region.
   * Lazada only filters at island level, so we need to verify the seller
   * location against the province by checking if the location text
   * contains the province name or known regency names.
   * @param {string} locationText — seller location from the card (e.g. "Kota Gorontalo")
   * @param {string} provinceName — target province (e.g. "SULAWESI TENGAH")
   * @param {Object} region — region hierarchy with regency list
   * @returns {boolean}
   */
  function locationMatchesProvince(locationText, provinceName, region) {
    if (!locationText || !provinceName) return true; // no filter if missing data

    const locLower = locationText.toLowerCase().trim();
    const provLower = provinceName.toLowerCase().trim();

    // Direct province name match
    if (locLower.includes(provLower) || provLower.includes(locLower)) return true;

    // Check against regency names from the region object
    if (region?.regency?.name) {
      const regencyLower = region.regency.name.toLowerCase();
      if (locLower.includes(regencyLower) || regencyLower.includes(locLower)) return true;
    }

    // Check known regency/city names for common provinces
    // Strip "Kota ", "Kab. ", "Kabupaten " prefixes for matching
    const cleanLoc = locLower
      .replace(/^kota\s+/i, '')
      .replace(/^kab\.\s*/i, '')
      .replace(/^kabupaten\s+/i, '')
      .trim();

    // Check if the province name (without "SULAWESI", "JAWA", etc.) appears
    const provParts = provLower.split(/\s+/);
    for (const part of provParts) {
      if (part.length > 3 && cleanLoc.includes(part)) return true;
    }

    return false;
  }

  /**
   * Collect unique merchants from all product cards currently
   * visible on the page. Filters sellers by location if provinceName is provided.
   * @param {Map<string, Object>} merchantMap — existing merchants (keyed by shop URL)
   * @param {string} regionCode
   * @param {string} regionName
   * @param {string} provinceName — province name for location filtering
   * @param {Object} region — full region hierarchy
   */
  function collectMerchantsFromPage(merchantMap, regionCode, regionName, provinceName, region) {
    const cards = findProductCards();

    for (const card of cards) {
      const shopInfo = extractShopInfo(card);
      if (!shopInfo || !shopInfo.name) continue;

      // Build a canonical URL key for deduplication
      const urlKey = shopInfo.url || shopInfo.name.toLowerCase();

      if (merchantMap.has(urlKey)) continue;

      const location = extractLocation(card);

      // Filter: if location is detected, check if it matches the target province
      if (location && provinceName && !locationMatchesProvince(location, provinceName, region)) {
        console.log(`[SE-Lazada] Filtered out "${shopInfo.name}" — location "${location}" not in "${provinceName}"`);
        continue;
      }

      const official = isOfficialStore(card);
      const rating = extractRating(card);
      const totalSold = extractSoldCount(card);

      // Use location text as regencyName since Lazada shows city-level location
      merchantMap.set(urlKey, {
        platform: 'lazada',
        merchantName: shopInfo.name,
        merchantUrl: shopInfo.url || '',
        merchantId: extractShopSlug(shopInfo.url || ''),
        address: location,
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: location || '',
        districtCode: '',
        districtName: '',
        category: '',
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
    // Strategy 1: find the "next page" button (Lazada uses ant-design pagination)
    const nextBtn = document.querySelector(SELECTORS.nextPageButton);

    if (nextBtn) {
      if (
        nextBtn.disabled ||
        nextBtn.getAttribute('aria-disabled') === 'true' ||
        nextBtn.closest('.ant-pagination-disabled')
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

    const allPageLinks = document.querySelectorAll(SELECTORS.paginationItem);
    for (const link of allPageLinks) {
      const text = link.textContent.trim();
      if (text === String(nextPageNum)) {
        link.click();
        return true;
      }
    }

    // Strategy 3: modify the URL page parameter directly
    currentUrl.searchParams.set('page', String(nextPageNum));
    window.location.href = currentUrl.toString();
    return true;
  }

  /**
   * Core scraping loop: scroll to load all products on current page,
   * collect merchants, then paginate up to MAX_PAGES.
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  async function scrapeAllPages(regionCode, regionName, provinceName, region) {
    const merchantMap = new Map();
    let currentPage = 1;

    // Check for CAPTCHA before starting the scrape
    if (detectCaptcha()) {
      await waitForCaptchaResolution();
    }

    while (currentPage <= MAX_PAGES) {
      console.log(
        `[SE-Lazada] Scraping page ${currentPage}/${MAX_PAGES}...`
      );

      // Wait for product cards to appear on the page
      const hasProducts = await waitForProducts(PAGE_LOAD_TIMEOUT_MS);

      if (!hasProducts) {
        console.warn('[SE-Lazada] No products found on page, stopping.');
        break;
      }

      // Scroll to load lazy content
      await scrollToBottom();

      // Extra wait for lazy renders
      await sleep(1000);

      // Collect merchants from current page (with province filtering)
      const previousCount = merchantMap.size;
      collectMerchantsFromPage(merchantMap, regionCode, regionName, provinceName, region);

      const newCount = merchantMap.size - previousCount;
      console.log(
        `[SE-Lazada] Page ${currentPage}: found ${newCount} new merchants (total: ${merchantMap.size})`
      );

      // Attempt pagination
      if (currentPage < MAX_PAGES) {
        const navigated = goToNextPage();
        if (!navigated) {
          console.log('[SE-Lazada] No next page available, stopping.');
          break;
        }

        // Wait for navigation / new page to load
        await sleep(NEXT_PAGE_DELAY_MS);

        // Check for CAPTCHA after page navigation
        if (detectCaptcha()) {
          await waitForCaptchaResolution();
        }

        // Wait for new products to appear
        await waitForProducts(PAGE_LOAD_TIMEOUT_MS);
      }

      currentPage++;
    }

    console.log(
      `[SE-Lazada] Scraping complete. Total unique merchants: ${merchantMap.size}`
    );

    return Array.from(merchantMap.values());
  }

  // ── Message Listener ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'lazada') {
      return false;
    }

    const { regionCode, regionName, provinceName, region } = message;

    console.log(
      `[SE-Lazada] Received startScrape for region ${regionCode} (${regionName}), province: ${provinceName}`
    );

    scrapeAllPages(regionCode, regionName, provinceName, region)
      .then((merchants) => {
        sendResponse({ success: true, merchants });
      })
      .catch((err) => {
        console.error('[SE-Lazada] Scraping error:', err);
        sendResponse({ success: false, merchants: [], error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-Lazada] Content script loaded and ready.');
})();
