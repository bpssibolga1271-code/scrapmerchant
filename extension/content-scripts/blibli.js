/**
 * SE Merchant Scraper — Blibli Content Script
 *
 * Injected on blibli.com pages. Supports two page types:
 *
 *   1. Search/cari pages — extracts merchant data from product cards.
 *      URL pattern: https://www.blibli.com/cari/{keyword}
 *
 *   2. Seller listing pages (`/semua-toko`) — extracts merchant/store
 *      data directly from seller cards with location filtering.
 *      URL pattern: https://www.blibli.com/semua-toko?location=<City>
 *
 * Listens for a `startScrape` message from the service worker and
 * sends results back via the message response callback.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const MAX_PAGES = 5;
  const SCROLL_DELAY_MS = 800;
  const PAGE_LOAD_TIMEOUT_MS = 15000;
  const MAX_SCROLL_ATTEMPTS = 20;
  const NEXT_PAGE_DELAY_MS = 3000;

  // ── Selectors & Patterns ───────────────────────────────────

  /**
   * Blibli uses a mix of data-testid attributes and BEM-style class names.
   * We rely on known selectors for product cards and merchant elements.
   */
  const SELECTORS = {
    /** Main container for search result product cards. */
    productsContainer: 'div.product-list, div[class*="product-list"], div[data-testid="lstProduct"]',
    /** Individual product card wrapper. */
    productCard: 'a.product-card, div[class*="product-card"], div[data-testid="product-card"]',
    /** Fallback: product link items in the search grid. */
    productCardFallback: 'div.product__card, a[class*="single-product"], div[class*="productCard"]',
    /** Pagination next-page button. */
    nextPageButton: 'a[rel="next"], button[aria-label="Next"], a[aria-label="Next"]',
    /** Pagination container. */
    paginationContainer: 'nav[class*="pagination"], div[class*="pagination"], ul[class*="pagination"]',
    /** Merchant/seller name element within a product card. */
    merchantName: 'span[class*="merchant"], div[class*="merchant"], a[class*="merchant"]',
    /** Merchant location within a product card. */
    merchantLocation: 'span[class*="location"], div[class*="location"]',
  };

  /**
   * Regex to detect a Blibli merchant/store URL.
   * Blibli merchant pages follow: blibli.com/merchant/{slug}
   */
  const MERCHANT_URL_PATTERN = /^https?:\/\/(www\.)?blibli\.com\/merchant\/([a-zA-Z0-9_-]+)/;

  /**
   * Selectors for the `/semua-toko` seller listing page.
   * Seller cards on this page show store info directly (name, link, location, badge).
   */
  const SELLER_LISTING_SELECTORS = {
    /** Seller card containers — the listing uses repeating card/item elements. */
    sellerCard: 'div[class*="store-card"], div[class*="seller-card"], div[class*="merchant-card"], div[class*="shop-card"]',
    /** Fallback: any container that holds a merchant link on the listing page. */
    sellerCardFallback: 'div[class*="card"], li[class*="card"], a[class*="card"]',
    /** Seller/store name element. */
    sellerName: 'span[class*="store-name"], div[class*="store-name"], span[class*="seller-name"], div[class*="seller-name"], span[class*="merchant-name"], div[class*="merchant-name"]',
    /** Seller location element. */
    sellerLocation: 'span[class*="location"], div[class*="location"], span[class*="city"], div[class*="city"], span[class*="address"], div[class*="address"]',
    /** Seller badge/type element. */
    sellerBadge: 'span[class*="badge"], div[class*="badge"], img[class*="badge"], span[class*="official"], div[class*="official"]',
    /** Pagination on seller listing pages. */
    paginationNext: 'a[rel="next"], button[aria-label="Next"], a[aria-label="Next"], a[class*="next"], button[class*="next"]',
    paginationContainer: 'nav[class*="pagination"], div[class*="pagination"], ul[class*="pagination"]',
  };

  /**
   * Check if the current page is the `/semua-toko` seller listing page.
   * @returns {boolean}
   */
  function isSellerListingPage() {
    return window.location.pathname.includes('/semua-toko');
  }

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
   * Wait for product cards to appear on the page using flexible detection.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  function waitForProducts(timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const check = () => {
        // Look for product card elements
        const cards = findProductCards();
        if (cards.length > 0) return true;

        // Fallback: look for merchant links on the page
        const merchantLinks = document.querySelectorAll('a[href*="/merchant/"]');
        return merchantLinks.length > 0;
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

  // ── CAPTCHA / Dialog Detection ────────────────────────────

  /**
   * Detect whether a CAPTCHA, verification dialog, or blocking overlay
   * is currently visible on the page.
   * @returns {boolean}
   */
  function detectCaptcha() {
    // Strategy 1: look for elements whose class or id contains CAPTCHA-related keywords
    const keywordSelectors = [
      '[class*="captcha"]', '[id*="captcha"]',
      '[class*="verify"]', '[id*="verify"]',
      '[class*="challenge"]', '[id*="challenge"]',
      '[class*="recaptcha"]', '[id*="recaptcha"]',
    ];

    for (const sel of keywordSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return true;
      }
    }

    // Strategy 2: look for visible modal / dialog overlays that block the page
    const overlaySelectors = [
      'div[class*="modal"][class*="overlay"]',
      'div[class*="dialog"]',
      'div[role="dialog"]',
      'div[class*="overlay"][style*="z-index"]',
    ];

    for (const sel of overlaySelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null) {
          const text = (el.textContent || '').toLowerCase();
          if (
            text.includes('captcha') ||
            text.includes('verify') ||
            text.includes('verifikasi') ||
            text.includes('robot') ||
            text.includes('challenge')
          ) {
            return true;
          }
        }
      }
    }

    // Strategy 3: scan visible elements for tell-tale text content
    const candidates = document.querySelectorAll(
      'div, span, p, h1, h2, h3, h4, label'
    );
    const captchaTextPatterns = /\b(verify|verifikasi|robot|captcha)\b/i;

    for (const el of candidates) {
      if (el.children.length > 0) continue; // only check leaf nodes
      if (el.offsetParent === null) continue; // skip hidden elements
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 200 && captchaTextPatterns.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * If a CAPTCHA / verification dialog is detected, notify the service
   * worker and poll every 3 seconds until the user resolves it.
   * @returns {Promise<void>}
   */
  async function waitForCaptchaResolution() {
    if (!detectCaptcha()) return;

    console.log('[SE-Blibli] CAPTCHA/dialog detected — waiting for user to solve it...');
    chrome.runtime.sendMessage({ action: 'captchaDetected', platform: 'blibli' });

    while (detectCaptcha()) {
      await sleep(3000);
    }

    console.log('[SE-Blibli] CAPTCHA resolved, resuming...');
    chrome.runtime.sendMessage({ action: 'captchaResolved', platform: 'blibli' });
  }

  // ── Extraction Logic ───────────────────────────────────────

  /**
   * Determine whether a URL points to a Blibli merchant page.
   * Merchant URLs follow: blibli.com/merchant/{slug}
   * @param {string} href
   * @returns {boolean}
   */
  function isMerchantUrl(href) {
    if (!href) return false;
    return MERCHANT_URL_PATTERN.test(href);
  }

  /**
   * Extract the merchant slug from a Blibli merchant URL.
   * @param {string} href
   * @returns {string}
   */
  function extractMerchantSlug(href) {
    if (!href) return '';

    const match = href.match(MERCHANT_URL_PATTERN);
    return match ? match[2] : '';
  }

  /**
   * Normalise a merchant URL to its canonical form.
   * @param {string} href
   * @returns {string}
   */
  function normaliseMerchantUrl(href) {
    const slug = extractMerchantSlug(href);
    return slug ? `https://www.blibli.com/merchant/${slug}` : '';
  }

  /**
   * Find product card elements on the current page.
   * @returns {Element[]}
   */
  function findProductCards() {
    // Strategy 1: use known product card selectors
    let cards = document.querySelectorAll(SELECTORS.productCard);
    if (cards.length > 0) return Array.from(cards);

    // Strategy 2: use fallback selectors
    cards = document.querySelectorAll(SELECTORS.productCardFallback);
    if (cards.length > 0) return Array.from(cards);

    // Strategy 3: find elements containing merchant links and walk up
    // to discover the product card boundary
    const merchantLinks = document.querySelectorAll('a[href*="/merchant/"]');
    const cardSet = new Set();

    for (const link of merchantLinks) {
      let el = link.parentElement;
      let depth = 0;

      while (el && depth < 8) {
        if (el.parentElement) {
          const siblings = el.parentElement.children;
          let siblingMerchantLinks = 0;

          for (const sib of siblings) {
            if (sib !== el && sib.querySelector('a[href*="/merchant/"]')) {
              siblingMerchantLinks++;
            }
          }

          // If multiple siblings also have merchant links, this level is the card
          if (siblingMerchantLinks >= 2) {
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
   * Extract the merchant/shop information from a product card.
   * @param {Element} card
   * @returns {{ name: string, url: string } | null}
   */
  function extractMerchantInfo(card) {
    // Strategy 1: find <a> tags linking to /merchant/{slug}
    const links = card.querySelectorAll('a[href*="/merchant/"]');

    for (const link of links) {
      const href = link.href;
      if (isMerchantUrl(href)) {
        const name = link.textContent.trim();
        if (name && name.length > 0 && name.length < 200) {
          return {
            name,
            url: normaliseMerchantUrl(href),
          };
        }
      }
    }

    // Strategy 2: look for merchant name elements by class name patterns
    const merchantEls = card.querySelectorAll(SELECTORS.merchantName);
    for (const el of merchantEls) {
      const anchor = el.closest('a[href*="/merchant/"]') || el.querySelector('a[href*="/merchant/"]');
      const name = el.textContent.trim();

      if (name && name.length > 0 && name.length < 200) {
        const url = anchor ? normaliseMerchantUrl(anchor.href) : '';
        return { name, url };
      }
    }

    // Strategy 3: look for any anchor with /merchant/ in href,
    // then extract text from its children
    const allLinks = card.querySelectorAll('a[href]');
    for (const link of allLinks) {
      if (isMerchantUrl(link.href)) {
        // Try to get the name from inner span/div elements
        const inner = link.querySelector('span, div, p');
        const text = inner ? inner.textContent.trim() : link.textContent.trim();
        if (text && text.length > 0 && text.length < 200) {
          return {
            name: text,
            url: normaliseMerchantUrl(link.href),
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract seller location text from a product card.
   * Blibli shows the merchant location (city) near the merchant name.
   * @param {Element} card
   * @returns {string}
   */
  function extractLocation(card) {
    // Strategy 1: look for location elements by class pattern
    const locEls = card.querySelectorAll(SELECTORS.merchantLocation);
    for (const el of locEls) {
      const text = el.textContent.trim();
      if (text && text.length >= 2 && text.length <= 50) {
        return text;
      }
    }

    // Strategy 2: look for elements with data attributes related to location
    const locByData =
      card.querySelector('[data-testid*="location"]') ||
      card.querySelector('[data-testid*="Location"]') ||
      card.querySelector('[data-testid*="city"]');

    if (locByData) {
      const text = locByData.textContent.trim();
      if (text) return text;
    }

    // Strategy 3: heuristic — look for short text near the merchant name
    // that resembles an Indonesian city name
    const merchantLink = card.querySelector('a[href*="/merchant/"]');
    if (merchantLink) {
      const parent = merchantLink.parentElement;
      if (parent) {
        const siblings = parent.querySelectorAll('span, div, p');
        for (const sib of siblings) {
          if (sib === merchantLink || sib.contains(merchantLink)) continue;

          const text = sib.textContent.trim();
          if (
            text.length >= 2 &&
            text.length <= 40 &&
            !text.includes('Rp') &&
            !text.includes('%') &&
            !text.includes('terjual') &&
            !text.includes('rating') &&
            !text.match(/^\d+$/) &&
            sib.children.length === 0
          ) {
            return text;
          }
        }
      }
    }

    return '';
  }

  /**
   * Detect if a product card indicates the seller is an Official Store
   * or has a verified/preferred badge.
   * @param {Element} card
   * @returns {boolean}
   */
  function isOfficialStore(card) {
    // Check for badge images
    const images = card.querySelectorAll('img');
    for (const img of images) {
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const src = (img.getAttribute('src') || '').toLowerCase();
      if (
        alt.includes('official') ||
        alt.includes('blibli official') ||
        src.includes('official') ||
        src.includes('badge') ||
        src.includes('verified')
      ) {
        return true;
      }
    }

    // Check for textual labels
    const labels = card.querySelectorAll('span, div, p');
    for (const el of labels) {
      const text = el.textContent.trim().toLowerCase();
      if (
        text === 'official store' ||
        text === 'official' ||
        text === 'blibli official' ||
        text.includes('official store')
      ) {
        return true;
      }
    }

    // Check class patterns
    const html = card.innerHTML.toLowerCase();
    if (
      html.includes('official-store') ||
      html.includes('officialstore') ||
      html.includes('badge-official')
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
    // Look for rating containers by class or data-testid
    const ratingEls = card.querySelectorAll(
      '[class*="rating"], [data-testid*="rating"], [aria-label*="rating"]'
    );

    for (const el of ratingEls) {
      const ariaLabel = el.getAttribute('aria-label') || '';
      const match = ariaLabel.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 0 && val <= 5) return val;
      }

      // Try text content
      const text = el.textContent.trim();
      const textMatch = text.match(/^(\d+\.?\d*)$/);
      if (textMatch) {
        const val = parseFloat(textMatch[1]);
        if (val >= 0 && val <= 5) return val;
      }
    }

    // Fallback: look for a number near a star icon
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
              parent.querySelector('img[alt*="star"]') ||
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
   * Extract sold count from a product card if available.
   * Blibli shows "XX terjual" or "Terjual XX" on product cards.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractSoldCount(card) {
    const elements = card.querySelectorAll('span, div, p');
    for (const el of elements) {
      const text = el.textContent.trim().toLowerCase();

      // Pattern: "XX terjual", "1rb+ terjual"
      const match = text.match(/([\d.,]+)\s*(?:rb)?\+?\s*terjual/);
      if (match) {
        let count = parseFloat(match[1].replace(/\./g, '').replace(/,/g, '.'));
        if (text.includes('rb')) count *= 1000;
        return count;
      }

      // Pattern: "Terjual XX"
      const altMatch = text.match(/terjual\s*([\d.,]+)\s*(?:rb)?\+?/);
      if (altMatch) {
        let count = parseFloat(altMatch[1].replace(/\./g, '').replace(/,/g, '.'));
        if (text.includes('rb')) count *= 1000;
        return count;
      }
    }

    return null;
  }

  /**
   * Extract product count from a product card if available.
   * Blibli may show the number of products from a merchant.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractProductCount(card) {
    const elements = card.querySelectorAll('span, div, p');
    for (const el of elements) {
      const text = el.textContent.trim().toLowerCase();

      // Pattern: "XX produk"
      const match = text.match(/([\d.,]+)\s*(?:rb)?\+?\s*produk/);
      if (match) {
        let count = parseFloat(match[1].replace(/\./g, '').replace(/,/g, '.'));
        if (text.includes('rb')) count *= 1000;
        return count;
      }
    }

    return null;
  }

  // ── Seller Listing Extraction ──────────────────────────────

  /**
   * Find seller card elements on the `/semua-toko` listing page.
   * Uses multiple strategies to locate seller/store cards.
   * @returns {Element[]}
   */
  function findSellerCards() {
    // Strategy 1: use known seller card selectors
    let cards = document.querySelectorAll(SELLER_LISTING_SELECTORS.sellerCard);
    if (cards.length > 0) return Array.from(cards);

    // Strategy 2: use fallback card selectors, filtered to those with merchant links
    cards = document.querySelectorAll(SELLER_LISTING_SELECTORS.sellerCardFallback);
    const withMerchantLinks = Array.from(cards).filter(
      (card) => card.querySelector('a[href*="/merchant/"]')
    );
    if (withMerchantLinks.length > 0) return withMerchantLinks;

    // Strategy 3: find merchant links and walk up to discover card boundaries
    const merchantLinks = document.querySelectorAll('a[href*="/merchant/"]');
    const cardSet = new Set();

    for (const link of merchantLinks) {
      let el = link.parentElement;
      let depth = 0;

      while (el && depth < 8) {
        if (el.parentElement) {
          const siblings = el.parentElement.children;
          let siblingMerchantLinks = 0;

          for (const sib of siblings) {
            if (sib !== el && sib.querySelector('a[href*="/merchant/"]')) {
              siblingMerchantLinks++;
            }
          }

          if (siblingMerchantLinks >= 2) {
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
   * Wait for seller cards to appear on the `/semua-toko` page.
   * @param {number} [timeoutMs]
   * @returns {Promise<boolean>}
   */
  function waitForSellerCards(timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      const check = () => {
        const cards = findSellerCards();
        if (cards.length > 0) return true;

        // Fallback: look for any merchant links
        const merchantLinks = document.querySelectorAll('a[href*="/merchant/"]');
        return merchantLinks.length > 0;
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
   * Extract merchant data from a single seller card on the `/semua-toko` page.
   * @param {Element} card
   * @returns {{ name: string, url: string, location: string, isOfficial: boolean } | null}
   */
  function extractSellerCardInfo(card) {
    let name = '';
    let url = '';
    let location = '';
    let isOfficial = false;

    // Extract name and URL from merchant links
    const merchantLinks = card.querySelectorAll('a[href*="/merchant/"]');
    for (const link of merchantLinks) {
      const href = link.href;
      if (isMerchantUrl(href)) {
        url = normaliseMerchantUrl(href);

        // Try seller name selectors first
        const nameEl = card.querySelector(SELLER_LISTING_SELECTORS.sellerName);
        if (nameEl) {
          name = nameEl.textContent.trim();
        }

        // Fall back to the link text itself
        if (!name) {
          const inner = link.querySelector('span, div, p, h3, h4');
          name = inner ? inner.textContent.trim() : link.textContent.trim();
        }

        if (name && name.length > 0 && name.length < 200) break;
      }
    }

    if (!name || !url) return null;

    // Extract location
    const locEls = card.querySelectorAll(SELLER_LISTING_SELECTORS.sellerLocation);
    for (const el of locEls) {
      const text = el.textContent.trim();
      if (text && text.length >= 2 && text.length <= 60) {
        location = text;
        break;
      }
    }

    // Fallback location: look for short text elements near the merchant link
    if (!location) {
      const allText = card.querySelectorAll('span, div, p');
      for (const el of allText) {
        if (el.querySelector('a')) continue; // skip elements containing links
        const text = el.textContent.trim();
        if (
          text.length >= 2 &&
          text.length <= 40 &&
          !text.includes('Rp') &&
          !text.includes('%') &&
          !text.match(/^\d+$/) &&
          text !== name &&
          el.children.length === 0
        ) {
          location = text;
          break;
        }
      }
    }

    // Detect official store badge
    const badgeEls = card.querySelectorAll(SELLER_LISTING_SELECTORS.sellerBadge);
    for (const el of badgeEls) {
      const text = (el.textContent || '').trim().toLowerCase();
      const alt = (el.getAttribute('alt') || '').toLowerCase();
      const src = (el.getAttribute('src') || '').toLowerCase();
      if (
        text.includes('official') ||
        alt.includes('official') ||
        src.includes('official') ||
        src.includes('badge') ||
        src.includes('verified')
      ) {
        isOfficial = true;
        break;
      }
    }

    // Additional official store check via innerHTML patterns
    if (!isOfficial) {
      isOfficial = isOfficialStore(card);
    }

    return { name, url, location, isOfficial };
  }

  /**
   * Collect unique merchants from seller cards on the `/semua-toko`
   * listing page.
   * @param {Map<string, Object>} merchantMap — existing merchants (keyed by URL)
   * @param {string} regionCode
   * @param {string} regionName
   */
  function collectMerchantsFromSellerListing(merchantMap, regionCode, regionName) {
    const cards = findSellerCards();

    for (const card of cards) {
      const info = extractSellerCardInfo(card);
      if (!info || !info.name) continue;

      const urlKey = info.url || info.name.toLowerCase();
      if (merchantMap.has(urlKey)) continue;

      merchantMap.set(urlKey, {
        platform: 'blibli',
        merchantName: info.name,
        merchantUrl: info.url || '',
        merchantId: extractMerchantSlug(info.url || ''),
        address: info.location,
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: info.location || '',
        districtCode: '',
        districtName: '',
        category: '',
        rating: null,
        totalProducts: null,
        totalSold: null,
        joinDate: '',
        isOfficialStore: info.isOfficial,
        phone: '',
        description: '',
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Navigate to the next page on the `/semua-toko` seller listing.
   * @returns {boolean} true if navigation was triggered
   */
  function goToNextSellerListingPage() {
    // Strategy 1: find a "next page" link/button
    const nextBtn = document.querySelector(SELLER_LISTING_SELECTORS.paginationNext);
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

    // Strategy 2: look for numbered pagination links
    const paginationContainer = document.querySelector(SELLER_LISTING_SELECTORS.paginationContainer);
    if (paginationContainer) {
      const currentUrl = new URL(window.location.href);
      const currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);
      const nextPageNum = currentPage + 1;

      const allLinks = paginationContainer.querySelectorAll('a[href], button');
      for (const link of allLinks) {
        const text = link.textContent.trim();
        if (text === String(nextPageNum)) {
          link.click();
          return true;
        }
      }
    }

    // Strategy 3: modify URL page parameter directly
    const currentUrl = new URL(window.location.href);
    const currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);

    if (document.querySelector(SELLER_LISTING_SELECTORS.paginationContainer)) {
      currentUrl.searchParams.set('page', String(currentPage + 1));
      window.location.href = currentUrl.toString();
      return true;
    }

    return false;
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
    const cards = findProductCards();

    for (const card of cards) {
      const merchantInfo = extractMerchantInfo(card);
      if (!merchantInfo || !merchantInfo.name) continue;

      // Build a canonical URL key for deduplication
      const urlKey = merchantInfo.url || merchantInfo.name.toLowerCase();

      if (merchantMap.has(urlKey)) continue;

      const location = extractLocation(card);
      const official = isOfficialStore(card);
      const rating = extractRating(card);
      const totalSold = extractSoldCount(card);
      const totalProducts = extractProductCount(card);

      merchantMap.set(urlKey, {
        platform: 'blibli',
        merchantName: merchantInfo.name,
        merchantUrl: merchantInfo.url || '',
        merchantId: extractMerchantSlug(merchantInfo.url || ''),
        address: location,
        provinceCode: regionCode,
        provinceName: regionName,
        regencyCode: '',
        regencyName: location || '',
        districtCode: '',
        districtName: '',
        category: '',
        rating: rating,
        totalProducts: totalProducts,
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
    // Strategy 1: find a "next page" link/button
    const nextBtn =
      document.querySelector(SELECTORS.nextPageButton) ||
      document.querySelector('a[class*="next"]') ||
      document.querySelector('button[class*="next"]');

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

    // Strategy 2: look for numbered pagination links for the next page
    const paginationContainer = document.querySelector(SELECTORS.paginationContainer);
    if (paginationContainer) {
      const currentUrl = new URL(window.location.href);
      const currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);
      const nextPageNum = currentPage + 1;

      const allLinks = paginationContainer.querySelectorAll('a[href], button');
      for (const link of allLinks) {
        const text = link.textContent.trim();
        if (text === String(nextPageNum)) {
          link.click();
          return true;
        }
      }
    }

    // Strategy 3: modify URL page parameter directly
    const currentUrl = new URL(window.location.href);
    const currentPage = parseInt(currentUrl.searchParams.get('page') || '1', 10);

    // Only navigate if we have evidence that pagination exists
    if (document.querySelector(SELECTORS.paginationContainer)) {
      currentUrl.searchParams.set('page', String(currentPage + 1));
      window.location.href = currentUrl.toString();
      return true;
    }

    return false;
  }

  /**
   * Core scraping loop: scroll to load all content on current page,
   * collect merchants, then paginate up to MAX_PAGES.
   *
   * Automatically detects whether we are on a `/semua-toko` seller
   * listing page or a search/cari product page and uses the
   * appropriate extraction logic.
   *
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  async function scrapeAllPages(regionCode, regionName) {
    const merchantMap = new Map();
    let currentPage = 1;
    const onSellerListing = isSellerListingPage();

    if (onSellerListing) {
      console.log('[SE-Blibli] Detected /semua-toko seller listing page.');
    }

    while (currentPage <= MAX_PAGES) {
      console.log(
        `[SE-Blibli] Scraping page ${currentPage}/${MAX_PAGES}...`
      );

      // Check for CAPTCHA before processing each page
      await waitForCaptchaResolution();

      if (onSellerListing) {
        // ── Seller listing page flow ──────────────────────────
        const hasCards = await waitForSellerCards(PAGE_LOAD_TIMEOUT_MS);

        if (!hasCards) {
          console.warn('[SE-Blibli] No seller cards found on page, stopping.');
          break;
        }

        // Scroll to load lazy content
        await scrollToBottom();
        await sleep(500);

        // Collect merchants from seller cards
        const previousCount = merchantMap.size;
        collectMerchantsFromSellerListing(merchantMap, regionCode, regionName);

        const newCount = merchantMap.size - previousCount;
        console.log(
          `[SE-Blibli] Page ${currentPage}: found ${newCount} new merchants (total: ${merchantMap.size})`
        );

        // Attempt pagination for seller listing
        if (currentPage < MAX_PAGES) {
          const navigated = goToNextSellerListingPage();
          if (!navigated) {
            console.log('[SE-Blibli] No next page available on seller listing, stopping.');
            break;
          }

          await sleep(NEXT_PAGE_DELAY_MS);
          await waitForCaptchaResolution();
          await waitForSellerCards(PAGE_LOAD_TIMEOUT_MS);
        }
      } else {
        // ── Product search page flow (original) ───────────────
        const hasProducts = await waitForProducts(PAGE_LOAD_TIMEOUT_MS);

        if (!hasProducts) {
          console.warn('[SE-Blibli] No products found on page, stopping.');
          break;
        }

        // Scroll to load lazy content
        await scrollToBottom();
        await sleep(500);

        // Collect merchants from product cards
        const previousCount = merchantMap.size;
        collectMerchantsFromPage(merchantMap, regionCode, regionName);

        const newCount = merchantMap.size - previousCount;
        console.log(
          `[SE-Blibli] Page ${currentPage}: found ${newCount} new merchants (total: ${merchantMap.size})`
        );

        // Attempt pagination
        if (currentPage < MAX_PAGES) {
          const navigated = goToNextPage();
          if (!navigated) {
            console.log('[SE-Blibli] No next page available, stopping.');
            break;
          }

          await sleep(NEXT_PAGE_DELAY_MS);
          await waitForCaptchaResolution();
          await waitForProducts(PAGE_LOAD_TIMEOUT_MS);
        }
      }

      currentPage++;
    }

    console.log(
      `[SE-Blibli] Scraping complete. Total unique merchants: ${merchantMap.size}`
    );

    return Array.from(merchantMap.values());
  }

  // ── Message Listener ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'blibli') {
      return false;
    }

    const { regionCode, regionName } = message;

    console.log(
      `[SE-Blibli] Received startScrape for region ${regionCode} (${regionName})`
    );

    scrapeAllPages(regionCode, regionName)
      .then((merchants) => {
        sendResponse({ success: true, merchants });
      })
      .catch((err) => {
        console.error('[SE-Blibli] Scraping error:', err);
        sendResponse({ success: false, merchants: [], error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-Blibli] Content script loaded and ready.');
})();
