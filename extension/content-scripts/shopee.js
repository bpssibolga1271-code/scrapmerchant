/**
 * SE Merchant Scraper — Shopee Content Script
 *
 * Injected on shopee.co.id search pages. Listens for a
 * `startScrape` message from the service worker, extracts
 * unique merchant/seller data from product cards, and sends
 * results back via chrome.runtime.sendMessage.
 *
 * Shopee uses heavily obfuscated class names, so extraction
 * relies on structural selectors, link patterns, and data
 * attributes rather than class names.
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
   * Shopee uses obfuscated class names that change frequently.
   * We rely on structural patterns and link hrefs instead.
   * The search results page renders product cards inside a
   * grid-like container. Each card contains links to the
   * product and to the shop.
   */
  const SELECTORS = {
    /** Main search results container. */
    resultsContainer: 'div.shopee-search-item-result__items, div[class*="search-item-result"]',
    /** Fallback: the page content area that holds search results. */
    resultsContainerFallback: 'div.row.shopee-search-item-result__items, main',
    /** Pagination next-page button. */
    nextPageButton: 'button.shopee-icon-button--right, button[class*="icon-button--right"]',
    /** Alternative: pagination links. */
    paginationLinks: 'a.shopee-mini-page-controller__page, span.shopee-mini-page-controller__current',
  };

  /**
   * Regex to detect a Shopee shop URL from an anchor href.
   * Shop pages follow the pattern: shopee.co.id/{shop-username}
   * or shopee.co.id/shop/{shopId}
   */
  const SHOP_URL_PATTERNS = [
    /^https?:\/\/shopee\.co\.id\/([a-zA-Z0-9_.]+)$/,
    /^https?:\/\/shopee\.co\.id\/shop\/(\d+)/,
  ];

  /**
   * Regex to detect a Shopee product URL.
   * Product URLs follow: /{Title}-i.{shopId}.{itemId}
   */
  const PRODUCT_URL_PATTERN = /-i\.(\d+)\.(\d+)/;

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
   * Wait for product cards to appear on the page using a flexible
   * detection approach since Shopee's DOM structure changes often.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  function waitForProducts(timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const check = () => {
        // Look for product links with the -i.{shopId}.{itemId} pattern
        const allLinks = document.querySelectorAll('a[href]');
        let productLinkCount = 0;
        for (const link of allLinks) {
          if (isProductUrl(link.href || link.getAttribute('href') || '')) {
            productLinkCount++;
          }
        }

        // Fallback: look for list items (product cards are <li> elements)
        const listItems = document.querySelectorAll('li a[href]');

        // Fallback: look for the results container
        const container =
          document.querySelector(SELECTORS.resultsContainer) ||
          document.querySelector(SELECTORS.resultsContainerFallback);

        if (productLinkCount > 0) return true;
        if (listItems.length > 5) return true;
        if (container && container.children.length > 0) return true;

        return false;
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

  // ── Product URL Helpers ───────────────────────────────────

  /**
   * Check if a URL is a Shopee product URL.
   * Pattern: /{Title}-i.{shopId}.{itemId}
   * @param {string} href
   * @returns {boolean}
   */
  function isProductUrl(href) {
    if (!href) return false;
    return PRODUCT_URL_PATTERN.test(href);
  }

  /**
   * Extract shopId from a Shopee product URL.
   * Pattern: /{Title}-i.{shopId}.{itemId}
   * @param {string} href
   * @returns {string|null}
   */
  function extractShopIdFromProductUrl(href) {
    if (!href) return null;
    const match = href.match(PRODUCT_URL_PATTERN);
    return match ? match[1] : null;
  }

  // ── Extraction Logic ───────────────────────────────────────

  /**
   * Find all anchor elements on the page that link to a Shopee shop.
   * @returns {HTMLAnchorElement[]}
   */
  function findShopLinks() {
    const allLinks = document.querySelectorAll('a[href]');
    const shopLinks = [];

    for (const link of allLinks) {
      const href = link.href;
      if (isShopUrl(href)) {
        shopLinks.push(link);
      }
    }

    return shopLinks;
  }

  /**
   * Determine whether a URL points to a Shopee shop page.
   * Shop URLs are either: shopee.co.id/{username} or shopee.co.id/shop/{id}
   * @param {string} href
   * @returns {boolean}
   */
  function isShopUrl(href) {
    if (!href) return false;

    try {
      const url = new URL(href, 'https://shopee.co.id');

      // Must be on shopee.co.id
      if (!url.hostname.endsWith('shopee.co.id')) return false;

      const pathname = url.pathname;

      // Exclude known non-shop paths
      const nonShopPaths = [
        '/search',
        '/daily_discover',
        '/mall/',
        '/flash_sale',
        '/cart',
        '/user/',
        '/buyer/',
        '/order/',
        '/coins',
        '/feed',
        '/live',
        '/product/',
        '/m/',
        '/web/',
        '/api/',
      ];

      for (const prefix of nonShopPaths) {
        if (pathname.startsWith(prefix)) return false;
      }

      // Pattern 1: /shop/{shopId}
      if (/^\/shop\/\d+/.test(pathname)) return true;

      // Pattern 2: /{shop-username} — one path segment, alphanumeric with dots/underscores
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length === 1 && /^[a-zA-Z0-9_.]+$/.test(segments[0])) {
        // Exclude common non-shop single-segment paths
        const excluded = [
          'search', 'daily_discover', 'flash_sale', 'cart', 'coins',
          'feed', 'live', 'verify', 'seller', 'buyer', 'order',
        ];
        if (!excluded.includes(segments[0].toLowerCase())) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Extract the shop username/ID from a Shopee shop URL.
   * @param {string} href
   * @returns {string}
   */
  function extractShopId(href) {
    try {
      const url = new URL(href, 'https://shopee.co.id');
      const pathname = url.pathname;

      // /shop/{shopId}
      const shopIdMatch = pathname.match(/^\/shop\/(\d+)/);
      if (shopIdMatch) return shopIdMatch[1];

      // /{username}
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 1) return segments[0];

      return '';
    } catch {
      return '';
    }
  }

  /**
   * Given a product card element, try to find the shop/seller information.
   * On search results, cards only have product links (not shop links).
   * Shop ID is extracted from product URL (-i.{shopId}.{itemId}) or
   * from the "Produk Serupa" link (?shopid={shopId}).
   *
   * @param {Element} card
   * @returns {{ name: string, url: string } | null}
   */
  function extractShopInfo(card) {
    const links = card.querySelectorAll('a[href]');
    let shopId = null;

    // Priority 1: "Produk Serupa" / find_similar_products link has explicit shopid
    for (const link of links) {
      const href = link.href || link.getAttribute('href') || '';
      if (href.includes('find_similar_products') || href.includes('shopid=')) {
        try {
          const url = new URL(href, 'https://shopee.co.id');
          const sid = url.searchParams.get('shopid');
          if (sid) {
            shopId = sid;
            break;
          }
        } catch { /* skip */ }
      }
    }

    // Priority 2: Extract from product URL pattern -i.{shopId}.{itemId}
    if (!shopId) {
      for (const link of links) {
        const href = link.href || link.getAttribute('href') || '';
        const sid = extractShopIdFromProductUrl(href);
        if (sid) {
          shopId = sid;
          break;
        }
      }
    }

    // Priority 3: Fallback to direct shop links (if any exist)
    if (!shopId) {
      for (const link of links) {
        if (isShopUrl(link.href)) {
          return {
            name: link.textContent.trim().substring(0, 100) || 'Unknown Shop',
            url: link.href.split('?')[0],
          };
        }
      }
      return null;
    }

    // Build shop URL from extracted shopId
    const shopUrl = `https://shopee.co.id/shop/${shopId}`;

    // Use shopId as the name — we don't have the shop name on search results
    return {
      name: `Shop ${shopId}`,
      url: shopUrl,
    };
  }

  /**
   * Extract seller location text from a product card.
   * The location element is a div/span containing a pin icon <img>
   * followed by the city name text (e.g., "Palu", "Jakarta Selatan").
   * @param {Element} card
   * @returns {string}
   */
  function extractLocation(card) {
    // Strategy 1: Find img with alt containing "location", then read sibling spans
    // Verified DOM: <div><img alt="location-icon"><span data-testid="a11y-label"><span class="ml-[3px]">Palu</span></span></div>
    const locationImgs = card.querySelectorAll('img[alt*="location"]');

    for (const img of locationImgs) {
      const parent = img.parentElement;
      if (!parent) continue;

      // Get text from sibling elements after the img
      const siblings = parent.children;
      for (const sib of siblings) {
        if (sib === img) continue;
        const text = sib.textContent.trim();
        if (
          text.length >= 2 &&
          text.length <= 50 &&
          !text.includes('Rp') &&
          !text.includes('%') &&
          !text.includes('terjual') &&
          !text.match(/^\d/)
        ) {
          return text;
        }
      }

      // Also check parent's direct text and all descendant text
      const parentText = parent.textContent.replace(img.textContent || '', '').trim();
      if (
        parentText.length >= 2 &&
        parentText.length <= 50 &&
        !parentText.includes('Rp') &&
        !parentText.includes('%') &&
        !parentText.includes('terjual') &&
        !parentText.match(/^\d/)
      ) {
        return parentText;
      }
    }

    // Strategy 2: Fallback — look for short text near card bottom
    const allSpans = card.querySelectorAll('span, div');

    for (const el of allSpans) {
      const text = el.textContent.trim();

      if (
        text.length >= 2 &&
        text.length <= 50 &&
        el.children.length === 0 &&
        !text.includes('Rp') &&
        !text.includes('%') &&
        !text.includes('terjual') &&
        !text.includes('Terjual') &&
        !text.includes('rating') &&
        !text.match(/^\d/) &&
        !text.includes('OFF') &&
        !text.includes('Produk Serupa')
      ) {
        const rect = el.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        if (rect.top > cardRect.top + cardRect.height * 0.5) {
          return text;
        }
      }
    }

    return '';
  }

  /**
   * Detect if a product card indicates the seller is a Shopee Mall
   * (official store) or has a "Star Seller" / preferred badge.
   * @param {Element} card
   * @returns {boolean}
   */
  function isOfficialStore(card) {
    // Check for Shopee Mall badge images
    const images = card.querySelectorAll('img');
    for (const img of images) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      if (
        alt.includes('mall') ||
        alt.includes('official') ||
        alt.includes('preferred') ||
        src.includes('mall') ||
        src.includes('official') ||
        src.includes('preferred')
      ) {
        return true;
      }
    }

    // Check for textual "Mall" or "Official" labels
    const labels = card.querySelectorAll('span, div');
    for (const el of labels) {
      const text = el.textContent.trim().toLowerCase();
      if (
        text === 'mall' ||
        text === 'official store' ||
        text === 'shopee mall' ||
        text === 'star seller' ||
        text === 'star+'
      ) {
        return true;
      }
    }

    // Check for mall/official class patterns (even if obfuscated, some patterns persist)
    const html = card.innerHTML.toLowerCase();
    if (
      html.includes('shopee-mall') ||
      html.includes('official-shop') ||
      html.includes('preferred-seller')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Extract rating value from a product card if available.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractRating(card) {
    // Look for SVG stars or rating containers
    const ratingContainers = card.querySelectorAll(
      '[class*="rating"], [class*="star"], [aria-label*="rating"]'
    );

    for (const container of ratingContainers) {
      const ariaLabel = container.getAttribute('aria-label') || '';
      const match = ariaLabel.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
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
          // Check if near a star-like element
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
   * Shopee shows sold count like "1rb+ terjual" or "500 terjual".
   * @param {Element} card
   * @returns {number|null}
   */
  function extractSoldCount(card) {
    const spans = card.querySelectorAll('span, div');
    for (const el of spans) {
      const text = el.textContent.trim().toLowerCase();

      // Pattern: "1rb+ terjual", "500 terjual", "10rb terjual"
      const match = text.match(/([\d.,]+)\s*(?:rb)?\+?\s*terjual/);
      if (match) {
        let count = parseFloat(match[1].replace(/\./g, '').replace(/,/g, '.'));
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

  // ── Product Card Discovery ─────────────────────────────────

  /**
   * Find product card elements on the current page.
   * Shopee renders search results as <li> items inside a <ul>.
   * Each <li> contains product links with the pattern -i.{shopId}.{itemId}.
   * @returns {Element[]}
   */
  function findProductCards() {
    // Strategy 1: Find <li> elements containing product links
    const allListItems = document.querySelectorAll('li');
    const cards = [];

    for (const li of allListItems) {
      const links = li.querySelectorAll('a[href]');
      let hasProduct = false;

      for (const link of links) {
        const href = link.href || link.getAttribute('href') || '';
        if (isProductUrl(href)) {
          hasProduct = true;
          break;
        }
      }

      if (hasProduct) {
        cards.push(li);
      }
    }

    if (cards.length > 0) return cards;

    // Strategy 2: Bottom-up from product links — walk up to card boundary
    const allLinks = document.querySelectorAll('a[href]');
    const cardSet = new Set();

    for (const link of allLinks) {
      const href = link.href || link.getAttribute('href') || '';
      if (!isProductUrl(href)) continue;

      // Walk up from the product link to find the card boundary
      let el = link.parentElement;
      let depth = 0;

      while (el && depth < 8) {
        if (el.parentElement) {
          const siblings = el.parentElement.children;
          let siblingProductLinks = 0;

          for (const sib of siblings) {
            if (sib === el) continue;
            const sibLinks = sib.querySelectorAll('a[href]');
            for (const l of sibLinks) {
              const h = l.href || l.getAttribute('href') || '';
              if (isProductUrl(h)) {
                siblingProductLinks++;
                break;
              }
            }
          }

          // If multiple siblings also have product links, this level is the card
          if (siblingProductLinks >= 2) {
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

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Collect unique merchants from all product cards currently
   * visible on the page. Uses DOM-only extraction to avoid
   * triggering Shopee's anti-bot CAPTCHA (API calls to
   * /api/v4/product/get_shop_info redirect to /verify/captcha).
   * @param {Map<string, Object>} merchantMap — existing merchants (keyed by URL)
   * @param {string} regionCode
   * @param {string} regionName
   */
  function collectMerchantsFromPage(merchantMap, regionCode, regionName) {
    const cards = findProductCards();
    let skippedNoShop = 0;
    let skippedDuplicate = 0;
    let added = 0;

    for (const card of cards) {
      const shopInfo = extractShopInfo(card);
      if (!shopInfo || !shopInfo.name) {
        skippedNoShop++;
        continue;
      }

      const urlKey = shopInfo.url || shopInfo.name.toLowerCase();
      if (merchantMap.has(urlKey)) {
        skippedDuplicate++;
        continue;
      }

      const location = extractLocation(card);
      const official = isOfficialStore(card);
      const rating = extractRating(card);
      const totalSold = extractSoldCount(card);

      const merchantId = extractShopId(shopInfo.url || '') ||
        extractShopIdFromProductUrl(shopInfo.url || '') || '';

      merchantMap.set(urlKey, {
        platform: 'shopee',
        merchantName: shopInfo.name,
        merchantUrl: shopInfo.url || '',
        merchantId: merchantId,
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
      added++;
    }

  }

  /**
   * Navigate to the next search results page if a pagination
   * control exists.
   * @returns {boolean} true if navigation was triggered
   */
  function goToNextPage() {
    // Strategy 1: find the "next page" arrow button
    const nextBtn =
      document.querySelector(SELECTORS.nextPageButton) ||
      document.querySelector('button[class*="next"]') ||
      document.querySelector('button[class*="icon-button--right"]');

    if (nextBtn) {
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

    // Strategy 2: modify the URL page parameter
    const currentUrl = new URL(window.location.href);
    const currentPage = parseInt(currentUrl.searchParams.get('page') || '0', 10);
    const nextPageNum = currentPage + 1;

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
  async function scrapeAllPages(regionCode, regionName) {
    const merchantMap = new Map();
    let currentPage = 1;

    while (currentPage <= MAX_PAGES) {
      console.log(
        `[SE-Shopee] Scraping page ${currentPage}/${MAX_PAGES}...`
      );

      // Wait for product cards to appear on the page
      const hasProducts = await waitForProducts(PAGE_LOAD_TIMEOUT_MS);

      if (!hasProducts) {
        console.warn('[SE-Shopee] No products found on page, stopping.');
        break;
      }

      // Scroll to load lazy content
      await scrollToBottom();

      // Extra wait for lazy renders
      await sleep(1000);

      // Collect merchants from current page (DOM-only, no API calls)
      const previousCount = merchantMap.size;
      collectMerchantsFromPage(merchantMap, regionCode, regionName);

      const newCount = merchantMap.size - previousCount;
      console.log(
        `[SE-Shopee] Page ${currentPage}: found ${newCount} new merchants (total: ${merchantMap.size})`
      );

      // Attempt pagination
      if (currentPage < MAX_PAGES) {
        const navigated = goToNextPage();
        if (!navigated) {
          console.log('[SE-Shopee] No next page available, stopping.');
          break;
        }

        // Wait for navigation / new page to load
        await sleep(NEXT_PAGE_DELAY_MS);

        // Wait for new products to appear
        await waitForProducts(PAGE_LOAD_TIMEOUT_MS);
      }

      currentPage++;
    }

    console.log(
      `[SE-Shopee] Scraping complete. Total unique merchants: ${merchantMap.size}`
    );

    return Array.from(merchantMap.values());
  }

  // ── Message Listener ───────────────────────────────────────

  // Note: Shopee scraping is now handled via chrome.scripting.executeScript
  // in service-worker.js. This content script is kept for legacy compatibility
  // but is no longer the primary scraping mechanism.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'shopee') {
      return false;
    }

    const { regionCode, regionName, keyword } = message;

    sendResponse({ received: true });

    scrapeAllPages(regionCode, regionName)
      .then((merchants) => {
        chrome.runtime.sendMessage({
          action: 'shopeeResults',
          keyword: keyword || '',
          success: true,
          merchants,
        });
      })
      .catch((err) => {
        console.error('[SE-Shopee] Scraping error:', err);
        chrome.runtime.sendMessage({
          action: 'shopeeResults',
          keyword: keyword || '',
          success: false,
          merchants: [],
          error: err.message,
        });
      });

    return false;
  });
})();
