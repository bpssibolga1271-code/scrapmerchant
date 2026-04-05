/**
 * SE Merchant Scraper — GoFood Content Script
 *
 * Injected on gofood.co.id restaurant listing pages. Listens for a
 * `startScrape` message from the service worker, extracts restaurant
 * data from the DOM, auto-scrolls to load more, deduplicates, and
 * sends results back via chrome.runtime.sendMessage.
 */

(function () {
  'use strict';

  // -- Configuration --------------------------------------------------------

  const SCROLL_DELAY_MS = 1200;
  const PAGE_LOAD_TIMEOUT_MS = 15000;
  const MAX_SCROLL_ATTEMPTS = 40;
  const SCROLL_IDLE_WAIT_MS = 2000;
  const MAX_LOAD_MORE_CLICKS = 50;

  // -- Selectors & Patterns -------------------------------------------------

  /**
   * GoFood uses a React/Next.js-based SPA. Restaurant cards are rendered
   * as anchor-wrapped card components inside a listing grid. The selectors
   * below target common structural patterns observed on the site.
   */
  const SELECTORS = {
    /** Restaurant card link — each card is typically an <a> to the restaurant page. */
    restaurantCard: [
      'a[href*="/restaurant/"]',
      '[class*="restaurant"] a',
      '[class*="merchant"] a',
      '[data-testid*="restaurant"]',
      '[data-testid*="merchant"]',
    ],
    /** Wrapper / container that holds the list of restaurant cards. */
    listingContainer: [
      '[class*="restaurant-list"]',
      '[class*="merchant-list"]',
      '[class*="outlet-list"]',
      'main',
      '#__next',
    ],
  };

  // -- Utility Helpers ------------------------------------------------------

  /**
   * Wait for at least one element matching any of the given selectors.
   * @param {string[]} selectors
   * @param {number} [timeoutMs]
   * @returns {Promise<Element|null>}
   */
  function waitForAnyElement(selectors, timeoutMs = PAGE_LOAD_TIMEOUT_MS) {
    return new Promise((resolve) => {
      // Check immediately
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          resolve(el);
          return;
        }
      }

      const observer = new MutationObserver(() => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            observer.disconnect();
            resolve(el);
            return;
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            resolve(el);
            return;
          }
        }
        resolve(null);
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

  // -- GoFood Outlets API ---------------------------------------------------

  /**
   * Map province codes to Indonesian timezone identifiers.
   * WIB (UTC+7): Sumatra, Java, West/Central Kalimantan
   * WITA (UTC+8): East/South/North Kalimantan, Bali, NTB, NTT, Sulawesi
   * WIT (UTC+9): Papua, Maluku
   */
  function getTimezoneForProvince(provinceCode) {
    const code = String(provinceCode).substring(0, 2);
    const WITA = ['63', '64', '65', '51', '52', '53', '71', '72', '73', '74', '75', '76'];
    const WIT = ['81', '82', '91', '92', '93', '94'];
    if (WIT.includes(code)) return 'Asia/Jayapura';
    if (WITA.includes(code)) return 'Asia/Makassar';
    return 'Asia/Jakarta';
  }

  /**
   * Fetch restaurant outlets from GoFood's /api/outlets endpoint.
   * Paginates through all results using pageToken.
   *
   * @param {number} latitude
   * @param {number} longitude
   * @param {string} regionCode
   * @param {string} regionName
   * @param {Object} region - Full region object with province data
   * @returns {Promise<Map<string, Object>>} merchantUrl → merchant data
   */
  async function fetchOutletsFromAPI(latitude, longitude, regionCode, regionName, region) {
    const merchantMap = new Map();
    const timezone = getTimezoneForProvince(region?.province?.code || regionCode);
    let pageToken = '';
    let totalFetched = 0;
    const MAX_PAGES = 50;

    console.log(
      `[SE-GoFood] Fetching outlets API: lat=${latitude}, lng=${longitude}, tz=${timezone}`
    );

    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const payload = {
          code: 'MOST_LOVED',
          location: { latitude, longitude },
          pageSize: 12,
          language: 'en',
          timezone,
          country_code: 'ID',
        };

        if (pageToken) {
          payload.pageToken = pageToken;
        }

        const resp = await fetch('https://gofood.co.id/api/outlets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          console.warn(`[SE-GoFood] API returned ${resp.status} on page ${page}`);
          break;
        }

        const data = await resp.json();
        const outlets = data.outlets || data.data?.outlets || [];

        if (outlets.length === 0) {
          console.log(`[SE-GoFood] No more outlets on page ${page}, stopping.`);
          break;
        }

        for (const outlet of outlets) {
          // GoFood API nests data under outlet.core, outlet.ratings, etc.
          const core = outlet.core || {};
          const ratingsData = outlet.ratings || {};

          const name = core.displayName || '';
          const id = outlet.uid || core.uid || '';
          const lat = core.location?.latitude || null;
          const lng = core.location?.longitude || null;

          // Extract cuisines from core.tags (taxonomy=2 is cuisine)
          const tags = core.tags || [];
          const cuisines = tags
            .filter((t) => t.taxonomy === 2)
            .map((t) => t.displayName)
            .filter(Boolean);

          const rating = ratingsData.average || null;
          const totalReviews = ratingsData.total || null;

          // Build URL from name + id (GoFood slug format)
          const slugName = name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-');
          const merchantUrl = id
            ? `https://gofood.co.id/en/restaurant/${slugName}-${id}`
            : '';

          if (!name || !id) continue;

          const key = merchantUrl || `${name}|${id}`;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, {
              platform: 'gofood',
              merchantName: name,
              merchantUrl,
              merchantId: String(id),
              address: '',
              latitude: lat,
              longitude: lng,
              provinceCode: regionCode,
              provinceName: regionName,
              regencyCode: region?.regency?.code || '',
              regencyName: region?.regency?.name || '',
              districtCode: region?.district?.code || '',
              districtName: region?.district?.name || '',
              category: cuisines.join(', '),
              rating: rating ? parseFloat(rating) : null,
              totalProducts: null,
              totalSold: totalReviews,
              joinDate: core.createTime || '',
              isOfficialStore: false,
              phone: '',
              description: '',
              scrapedAt: new Date().toISOString(),
            });
          }
        }

        totalFetched += outlets.length;
        console.log(
          `[SE-GoFood] API page ${page}: ${outlets.length} outlets (total: ${merchantMap.size})`
        );

        // Get next page token
        pageToken = data.next_page_token || data.nextPageToken || '';
        if (!pageToken) {
          console.log('[SE-GoFood] No more pages (no next_page_token).');
          break;
        }

        // Rate limit
        await sleep(300);
      } catch (err) {
        console.warn(`[SE-GoFood] API fetch error on page ${page}:`, err.message);
        break;
      }
    }

    console.log(
      `[SE-GoFood] API complete: ${merchantMap.size} unique outlets from ${totalFetched} total.`
    );
    return merchantMap;
  }

  /**
   * Detect if a CAPTCHA, verification dialog, or blocking overlay is present.
   * @returns {boolean}
   */
  function detectCaptcha() {
    // Check URL for captcha/verify paths
    const url = window.location.href.toLowerCase();
    if (url.includes('/verify') || url.includes('/captcha')) return true;

    // Check for captcha-related elements
    const captchaSelectors = [
      '[class*="captcha"]', '[id*="captcha"]',
      '[class*="verify"]', '[id*="verify"]',
      '[class*="challenge"]', '[id*="challenge"]',
      '[class*="recaptcha"]', '[id*="recaptcha"]',
      'iframe[src*="captcha"]', 'iframe[src*="recaptcha"]',
    ];
    for (const sel of captchaSelectors) {
      if (document.querySelector(sel)) return true;
    }

    // Check for text indicators in modals/dialogs
    const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="overlay"]');
    for (const modal of modals) {
      const text = modal.textContent.toLowerCase();
      if (text.includes('captcha') || text.includes('verifikasi') || text.includes('robot')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Wait for the user to solve a CAPTCHA. Polls every 3 seconds until resolved.
   * @returns {Promise<void>}
   */
  async function waitForCaptchaResolution() {
    console.log('[SE-GoFood] CAPTCHA/dialog detected — waiting for user to solve it...');
    try {
      chrome.runtime.sendMessage({ action: 'captchaDetected', platform: 'gofood' });
    } catch (e) { /* ignore */ }

    while (detectCaptcha()) {
      await sleep(3000);
    }

    console.log('[SE-GoFood] CAPTCHA resolved, resuming...');
    try {
      chrome.runtime.sendMessage({ action: 'captchaResolved', platform: 'gofood' });
    } catch (e) { /* ignore */ }
    await sleep(1000);
  }

  /**
   * Auto-scroll to the bottom of the page in steps to trigger
   * infinite-scroll / lazy-loading of additional restaurant cards.
   * Returns when no new content has been loaded after consecutive attempts.
   * @returns {Promise<void>}
   */
  async function autoScroll() {
    let previousHeight = 0;
    let idleCount = 0;
    let attempts = 0;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
      const currentHeight = document.documentElement.scrollHeight;

      if (currentHeight === previousHeight) {
        idleCount++;
        // If height unchanged for 3 consecutive checks, assume all loaded
        if (idleCount >= 3) break;
      } else {
        idleCount = 0;
      }

      previousHeight = currentHeight;
      window.scrollTo({ top: currentHeight, behavior: 'smooth' });
      await sleep(SCROLL_DELAY_MS);
      attempts++;
    }

    // Final wait for any trailing lazy renders
    await sleep(SCROLL_IDLE_WAIT_MS);
  }

  /**
   * Find and click "Load More" / "See More" / "Lihat Lebih Banyak" buttons
   * on the /most_loved listing page to load additional restaurants.
   * @returns {Promise<number>} Number of buttons clicked
   */
  async function clickLoadMoreButtons() {
    const loadMorePatterns = [
      /load\s*more/i,
      /see\s*more/i,
      /view\s*more/i,
      /lihat\s*lebih/i,
      /lihat\s*semua/i,
      /muat\s*lebih/i,
      /selengkapnya/i,
      /show\s*more/i,
    ];

    const classPatterns = [
      '[class*="load-more"]',
      '[class*="loadMore"]',
      '[class*="see-more"]',
      '[class*="seeMore"]',
      '[class*="view-more"]',
      '[class*="viewMore"]',
      '[class*="show-more"]',
      '[class*="showMore"]',
    ];

    let clickedCount = 0;

    // Strategy 1: Find buttons/links by text content
    const clickables = document.querySelectorAll('button, a, [role="button"], span[tabindex], div[tabindex], div[onclick]');
    for (const el of clickables) {
      const text = el.textContent.trim();
      if (!text || text.length > 60) continue;
      // Skip if not visible
      if (el.offsetParent === null && el.offsetHeight === 0) continue;
      for (const pattern of loadMorePatterns) {
        if (pattern.test(text)) {
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);
            el.click();
            clickedCount++;
            console.log(`[SE-GoFood] Clicked load-more button: "${text}"`);
            await sleep(2000); // Wait for content to load
          } catch (e) {
            console.warn('[SE-GoFood] Failed to click load-more button:', e);
          }
          break;
        }
      }
    }

    // Strategy 2: Find elements by class patterns
    if (clickedCount === 0) {
      for (const selector of classPatterns) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          if (el.offsetParent === null && el.offsetHeight === 0) continue;
          try {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);
            el.click();
            clickedCount++;
            console.log(`[SE-GoFood] Clicked load-more element: ${selector}`);
            await sleep(2000);
          } catch (e) {
            console.warn('[SE-GoFood] Failed to click load-more element:', e);
          }
        }
        if (clickedCount > 0) break;
      }
    }

    return clickedCount;
  }

  // -- Extraction Logic -----------------------------------------------------

  /**
   * Query all restaurant card elements on the page using multiple
   * selector strategies.
   * @returns {Element[]}
   */
  function findRestaurantCards() {
    // Strategy 1: links that contain "/restaurant/" in href
    const restaurantLinks = document.querySelectorAll('a[href*="/restaurant/"]');
    if (restaurantLinks.length > 0) return Array.from(restaurantLinks);

    // Strategy 2: try each known selector
    for (const sel of SELECTORS.restaurantCard) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length > 0) return Array.from(nodes);
    }

    // Strategy 3: broad heuristic — look for cards containing restaurant-like content
    const allLinks = document.querySelectorAll('a[href]');
    const candidates = [];
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      if (
        href.includes('/restaurant/') ||
        href.includes('/merchant/') ||
        href.includes('/outlet/')
      ) {
        candidates.push(link);
      }
    }
    return candidates;
  }

  /**
   * Extract the restaurant name from a card element.
   * GoFood card structure: first <p> is the restaurant name.
   * @param {Element} card
   * @returns {string}
   */
  function extractName(card) {
    // Primary: first <p> element is the restaurant name in GoFood cards
    const firstP = card.querySelector('p');
    if (firstP) {
      const text = firstP.textContent.trim();
      if (text && text.length > 1 && text.length < 150) return text;
    }

    // Try heading elements
    const heading =
      card.querySelector('h3') ||
      card.querySelector('h2') ||
      card.querySelector('h4') ||
      card.querySelector('[class*="name"]') ||
      card.querySelector('[class*="title"]');

    if (heading) {
      const text = heading.textContent.trim();
      if (text) return text;
    }

    // Last resort: aria-label or title attribute
    return (
      card.getAttribute('aria-label') ||
      card.getAttribute('title') ||
      ''
    );
  }

  /**
   * Extract the restaurant URL from a card element.
   * @param {Element} card
   * @returns {string}
   */
  function extractUrl(card) {
    // If the card itself is an <a>, use its href
    if (card.tagName === 'A' && card.href) {
      return normalizeUrl(card.href);
    }

    // Otherwise look for the first relevant link
    const link = card.querySelector('a[href*="/restaurant/"]') ||
      card.querySelector('a[href]');

    if (link) {
      return normalizeUrl(link.href);
    }

    return '';
  }

  /**
   * Normalize a GoFood URL to a canonical form.
   * @param {string} href
   * @returns {string}
   */
  function normalizeUrl(href) {
    try {
      const url = new URL(href, 'https://gofood.co.id');
      // Strip query params and hash for cleaner dedup
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
      return href || '';
    }
  }

  /**
   * Extract a merchant ID (slug) from the restaurant URL.
   * GoFood URLs look like: /city/restaurant/slug-uuid
   * @param {string} url
   * @returns {string}
   */
  function extractMerchantId(url) {
    try {
      const parsed = new URL(url, 'https://gofood.co.id');
      const segments = parsed.pathname.split('/').filter(Boolean);
      // The restaurant slug is typically the last segment
      return segments[segments.length - 1] || '';
    } catch {
      return '';
    }
  }

  /**
   * Extract cuisine / category info from a card.
   * GoFood card structure: second <p> is the category/cuisine.
   * @param {Element} card
   * @returns {string}
   */
  function extractCuisine(card) {
    // Primary: second <p> element is the category in GoFood cards
    const allPs = card.querySelectorAll('p');
    if (allPs.length >= 2) {
      const text = allPs[1].textContent.trim();
      if (text && text.length > 1 && text.length < 100) return text;
    }

    // Fallback: look for elements with cuisine/category-related classes
    const cuisineEl =
      card.querySelector('[class*="cuisine"]') ||
      card.querySelector('[class*="category"]') ||
      card.querySelector('[class*="tag"]');

    if (cuisineEl) {
      return cuisineEl.textContent.trim();
    }

    return '';
  }

  /**
   * Extract rating from a restaurant card.
   * @param {Element} card
   * @returns {number|null}
   */
  function extractRating(card) {
    // Look for rating-specific elements
    const ratingEl =
      card.querySelector('[class*="rating"]') ||
      card.querySelector('[aria-label*="rating"]') ||
      card.querySelector('[class*="star"]');

    if (ratingEl) {
      const text = ratingEl.textContent.trim();
      const match = text.match(/([\d.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 0 && val <= 5) return val;
      }
    }

    // Heuristic: find a standalone decimal number near a star icon
    const allEls = card.querySelectorAll('span, div, p');
    for (const el of allEls) {
      const text = el.textContent.trim();
      const ratingMatch = text.match(/^([\d.]+)$/);
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val >= 1 && val <= 5) {
          // Confirm proximity to a star icon
          const parent = el.parentElement;
          if (parent) {
            const hasStar =
              parent.querySelector('svg') ||
              parent.querySelector('img[src*="star"]') ||
              parent.querySelector('img[alt*="star"]') ||
              parent.querySelector('[class*="star"]');
            if (hasStar) return val;
          }
        }
      }
    }

    // Broader search: "4.5 / 5" or "4.5" near star elements
    const starEls = card.querySelectorAll('svg, img[src*="star"], [class*="star"]');
    for (const star of starEls) {
      const sibling = star.nextElementSibling || star.previousElementSibling;
      if (sibling) {
        const match = sibling.textContent.trim().match(/([\d.]+)/);
        if (match) {
          const val = parseFloat(match[1]);
          if (val >= 1 && val <= 5) return val;
        }
      }
      // Check parent text
      const parent = star.parentElement;
      if (parent) {
        const match = parent.textContent.trim().match(/([\d.]+)/);
        if (match) {
          const val = parseFloat(match[1]);
          if (val >= 1 && val <= 5) return val;
        }
      }
    }

    return null;
  }

  /**
   * Extract address / location text from a card.
   * GoFood listing cards do NOT have street addresses — only distance.
   * We only capture actual address text (Jl./Jalan), never distance.
   * @param {Element} card
   * @returns {string}
   */
  function extractAddress(card) {
    const name = extractName(card);

    // Only look for actual street address text (Jl. / Jalan)
    const allEls = card.querySelectorAll('span, p, div');
    for (const el of allEls) {
      if (el.children.length > 0) continue;
      const text = el.textContent.trim();
      if (
        text.length < 150 &&
        (text.match(/\bJl\b\.?/i) || text.match(/\bJalan\b/i)) &&
        (!name || !text.includes(name))
      ) {
        return text;
      }
    }

    // GoFood listing pages only show distance, NOT address — return empty
    return '';
  }

  /**
   * Extract image URL from a restaurant card.
   * @param {Element} card
   * @returns {string}
   */
  function extractImageUrl(card) {
    const img = card.querySelector('img[src]');
    if (img) {
      return img.getAttribute('src') || '';
    }

    // Check for background-image style
    const bgEls = card.querySelectorAll('[style*="background-image"]');
    for (const el of bgEls) {
      const style = el.getAttribute('style') || '';
      const match = style.match(/url\(["']?([^"')]+)["']?\)/);
      if (match) return match[1];
    }

    return '';
  }

  // -- Main Scraping Routine ------------------------------------------------

  /**
   * Collect unique restaurants from all cards visible on the page.
   * @param {Map<string, Object>} merchantMap
   * @param {string} regionCode
   * @param {string} regionName
   * @param {Object} region — full region hierarchy from popup
   */
  /**
   * Parse a GoFood restaurant name into name + address parts.
   * GoFood names often follow "Name, Location" format, e.g.:
   *   "CFC, RSUD Undata Palu" → name: "CFC", address: "RSUD Undata Palu"
   *   "Rm Padang Cabe Hijau, Tondo" → name: "Rm Padang Cabe Hijau", address: "Tondo"
   * @param {string} fullName
   * @returns {{ name: string, locationHint: string }}
   */
  function parseGoFoodName(fullName) {
    const lastComma = fullName.lastIndexOf(',');
    if (lastComma > 0 && lastComma < fullName.length - 1) {
      const name = fullName.substring(0, lastComma).trim();
      const locationHint = fullName.substring(lastComma + 1).trim();
      // Only split if the part after comma looks like a location (not a number/price)
      if (locationHint.length > 1 && !/^\d/.test(locationHint)) {
        return { name, locationHint };
      }
    }
    return { name: fullName, locationHint: '' };
  }

  function collectRestaurants(merchantMap, regionCode, regionName, region) {
    const cards = findRestaurantCards();

    for (const card of cards) {
      const rawName = extractName(card);
      if (!rawName) continue;

      const url = extractUrl(card);
      // Deduplicate by name + URL composite key
      const dedupKey = `${rawName.toLowerCase()}|${url}`;

      if (merchantMap.has(dedupKey)) continue;

      const merchantId = extractMerchantId(url);
      const cuisine = extractCuisine(card);
      const rating = extractRating(card);
      const streetAddress = extractAddress(card);
      const imageUrl = extractImageUrl(card);

      // Parse "Name, Location" format from GoFood names
      const parsed = parseGoFoodName(rawName);
      // Use street address if found, otherwise use location hint from name
      const address = streetAddress || parsed.locationHint;

      // Check if API already has this merchant (merge lat/lng)
      const existing = merchantMap.get(dedupKey);
      merchantMap.set(dedupKey, {
        platform: 'gofood',
        merchantName: parsed.name,
        merchantUrl: url,
        merchantId: merchantId,
        address: address,
        latitude: existing?.latitude || null,
        longitude: existing?.longitude || null,
        provinceCode: region?.province?.code || regionCode,
        provinceName: region?.province?.name || regionName,
        regencyCode: region?.regency?.code || '',
        regencyName: region?.regency?.name || '',
        districtCode: region?.district?.code || '',
        districtName: region?.district?.name || '',
        category: cuisine || existing?.category || '',
        rating: rating || existing?.rating || null,
        totalProducts: null,
        totalSold: existing?.totalSold || null,
        joinDate: '',
        isOfficialStore: false,
        phone: '',
        description: '',
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Core scraping routine: wait for listings, auto-scroll to load all,
   * collect restaurant data, and return results.
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  /**
   * Dismiss cookie consent banners or overlays that may block interaction.
   */
  async function dismissCookieBanner() {
    const bannerSelectors = [
      '[class*="cookie"] button',
      '[class*="Cookie"] button',
      '[class*="consent"] button',
      '[id*="cookie"] button',
      '[id*="consent"] button',
      'button[class*="accept"]',
      'button[class*="Accept"]',
      '[class*="banner"] button[class*="close"]',
      '[class*="overlay"] button[class*="close"]',
    ];

    const acceptPatterns = [/accept/i, /terima/i, /ok/i, /got\s*it/i, /agree/i, /setuju/i];

    for (const sel of bannerSelectors) {
      const buttons = document.querySelectorAll(sel);
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        for (const pattern of acceptPatterns) {
          if (pattern.test(text) || text.length < 4) {
            try {
              btn.click();
              console.log(`[SE-GoFood] Dismissed cookie banner: "${text}"`);
              await sleep(500);
              return;
            } catch (e) { /* ignore */ }
          }
        }
      }
    }
  }

  async function scrapeRestaurants(regionCode, regionName, region, coords) {
    const merchantMap = new Map();

    // ── Phase 0: API-based collection ───────────────────────
    // If coordinates are available, fetch outlets directly from the API.
    // This provides lat/lng, rating, and address for each outlet.
    if (coords && coords.lat && coords.lng) {
      console.log('[SE-GoFood] Phase 0: Fetching outlets from API...');
      const apiMerchants = await fetchOutletsFromAPI(
        coords.lat, coords.lng, regionCode, regionName, region
      );
      for (const [key, merchant] of apiMerchants) {
        merchantMap.set(key, merchant);
      }
      console.log(
        `[SE-GoFood] Phase 0 complete: ${merchantMap.size} outlets from API.`
      );
    }

    console.log('[SE-GoFood] Waiting for restaurant listings to load...');

    // Wait for the listing container or restaurant cards to appear
    const container = await waitForAnyElement(SELECTORS.listingContainer);

    if (!container) {
      // If we got API results, return those even without DOM
      if (merchantMap.size > 0) {
        console.log('[SE-GoFood] No DOM container but have API data, returning API results.');
        return Array.from(merchantMap.values());
      }
      console.warn('[SE-GoFood] Listing container not found.');
      return [];
    }

    // Give the page extra time to render initial cards
    await sleep(2000);

    // Dismiss cookie consent banner if present
    await dismissCookieBanner();

    // Check for CAPTCHA before starting
    if (detectCaptcha()) {
      await waitForCaptchaResolution();
    }

    // Collect initial restaurants before scrolling
    collectRestaurants(merchantMap, regionCode, regionName, region);
    console.log(
      `[SE-GoFood] Initial collection: ${merchantMap.size} restaurants`
    );

    // Phase 1: Scroll down and click load-more buttons
    console.log('[SE-GoFood] Phase 1: Scrolling and clicking load-more...');
    let loadMoreClicks = 0;
    let consecutiveNoButton = 0;

    while (loadMoreClicks < MAX_LOAD_MORE_CLICKS && consecutiveNoButton < 5) {
      if (detectCaptcha()) await waitForCaptchaResolution();

      // Scroll to bottom first — button only appears after scrolling down
      await autoScroll();
      await sleep(2000);

      // Extra scroll to ensure the load-more button is in viewport
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await sleep(1500);

      // Collect any newly visible restaurants
      collectRestaurants(merchantMap, regionCode, regionName, region);

      const clicked = await clickLoadMoreButtons();
      if (clicked > 0) {
        loadMoreClicks += clicked;
        consecutiveNoButton = 0;
        console.log(`[SE-GoFood] Load-more click #${loadMoreClicks}, waiting for content...`);
        await sleep(3000);
        collectRestaurants(merchantMap, regionCode, regionName, region);
        console.log(`[SE-GoFood] After load-more: ${merchantMap.size} restaurants`);
      } else {
        consecutiveNoButton++;
        await sleep(1500);
      }
    }

    console.log(`[SE-GoFood] Phase 1 done: ${loadMoreClicks} load-more clicks, ${merchantMap.size} restaurants`);

    // Phase 2: Auto-scroll for infinite scroll pages
    console.log('[SE-GoFood] Phase 2: Auto-scrolling for infinite scroll...');
    let previousCount = merchantMap.size;
    let scrollRounds = 0;
    const MAX_SCROLL_ROUNDS = 20;
    let consecutiveNoChange = 0;

    while (scrollRounds < MAX_SCROLL_ROUNDS) {
      if (detectCaptcha()) await waitForCaptchaResolution();

      await autoScroll();
      await sleep(1000);

      // Try clicking load-more again in case new ones appeared
      await clickLoadMoreButtons();
      await sleep(1000);

      collectRestaurants(merchantMap, regionCode, regionName, region);

      const newCount = merchantMap.size;
      console.log(
        `[SE-GoFood] Scroll round ${scrollRounds + 1}: ${newCount} restaurants (${newCount - previousCount} new)`
      );

      if (newCount === previousCount) {
        consecutiveNoChange++;
        if (consecutiveNoChange >= 3) {
          console.log('[SE-GoFood] No new restaurants after 3 rounds, stopping.');
          break;
        }
      } else {
        consecutiveNoChange = 0;
      }

      previousCount = newCount;
      scrollRounds++;
    }

    const allMerchants = Array.from(merchantMap.values());
    const withCoords = allMerchants.filter((m) => m.latitude != null);
    console.log(
      `[SE-GoFood] Scraping complete. Total: ${allMerchants.length} restaurants ` +
      `(${withCoords.length} with lat/lng)`
    );

    return Array.from(merchantMap.values());
  }

  // -- Message Listener -----------------------------------------------------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'gofood') {
      return false;
    }

    const { regionCode, regionName, region, coords } = message;

    console.log(
      `[SE-GoFood] Received startScrape for region ${regionCode} (${regionName})` +
      (coords ? ` with coords (${coords.lat}, ${coords.lng})` : '')
    );

    scrapeRestaurants(regionCode, regionName, region, coords)
      .then((merchants) => {
        sendResponse({ success: true, merchants });
      })
      .catch((err) => {
        console.error('[SE-GoFood] Scraping error:', err);
        sendResponse({ success: false, merchants: [], error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-GoFood] Content script loaded and ready.');
})();
