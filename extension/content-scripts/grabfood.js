/**
 * SE Merchant Scraper — GrabFood Content Script
 *
 * Injected on food.grab.com restaurant listing pages. Listens for a
 * `startScrape` message from the service worker, extracts restaurant/
 * merchant data from __NEXT_DATA__ hydration payload and DOM elements,
 * and sends results back via chrome.runtime.sendMessage.
 *
 * GrabFood uses NextJS with SSR — initial data is embedded in the
 * `<script id="__NEXT_DATA__">` tag. Additional results loaded via
 * "Load More" clicks are captured from DOM mutations.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const MAX_LOAD_MORE_CLICKS = 10;
  const LOAD_MORE_DELAY_MS = 2000;
  const SCROLL_DELAY_MS = 800;
  const MAX_SCROLL_ATTEMPTS = 15;
  const PAGE_LOAD_TIMEOUT_MS = 15000;

  // ── Intercepted API Data Store ─────────────────────────────
  // Collects merchant data from the MAIN-world fetch interceptor
  // (grabfood-interceptor.js) which captures search/recommended
  // API responses with lat/lng for each merchant.
  const interceptedMerchants = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (
      event.data?.type === 'SE_GRABFOOD_SEARCH_DATA' ||
      event.data?.type === 'SE_GRABFOOD_RECOMMENDED_DATA'
    ) {
      const merchants = event.data.merchants || [];
      for (const m of merchants) {
        if (m.id) {
          interceptedMerchants.set(String(m.id), m);
        }
      }
      console.log(
        `[SE-GrabFood] Received ${merchants.length} merchants from interceptor ` +
        `(total cached: ${interceptedMerchants.size})`
      );
    }
  });

  // ── Selectors & Patterns ───────────────────────────────────

  const SELECTORS = {
    /** NextJS hydration data script tag. */
    nextData: 'script#__NEXT_DATA__',
    /** Restaurant listing card container. */
    restaurantCard: '[class*="RestaurantListCol"], [class*="restaurant-card"], [class*="RestaurantCard"]',
    /** Fallback: anchor links pointing to restaurant detail pages. */
    restaurantLink: 'a[href*="/restaurant/"]',
    /** "Load More" button to fetch additional restaurants. */
    loadMoreButton: 'button[class*="loadMore"], button[class*="LoadMore"], [class*="ant-btn"][class*="load-more"]',
    /** Fallback load more: any button with "Muat" or "Load" text. */
    loadMoreFallback: 'button',
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
   * trigger lazy-loading of additional content.
   * @returns {Promise<void>}
   */
  async function scrollToBottom() {
    let previousHeight = 0;
    let attempts = 0;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
      const currentHeight = document.documentElement.scrollHeight;

      if (currentHeight === previousHeight) {
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
   * Detect whether a CAPTCHA, verification dialog, or challenge overlay
   * is currently visible on the page.
   * @returns {boolean} true if a CAPTCHA or blocking dialog is detected
   */
  function detectCaptcha() {
    // Strategy 1: Elements with CAPTCHA-related class or id attributes
    const captchaSelectors = [
      '[class*="captcha" i]',
      '[id*="captcha" i]',
      '[class*="verify" i]',
      '[id*="verify" i]',
      '[class*="challenge" i]',
      '[id*="challenge" i]',
      '[class*="recaptcha" i]',
      '[id*="recaptcha" i]',
    ];

    for (const selector of captchaSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el && isElementVisible(el)) {
          console.log(`[SE-GrabFood] CAPTCHA element detected via selector: ${selector}`);
          return true;
        }
      } catch {
        // Selector may be invalid, skip
      }
    }

    // Strategy 2: Modal/dialog overlays blocking the page
    const overlaySelectors = [
      '[class*="modal" i][class*="overlay" i]',
      '[class*="dialog" i]',
      '[role="dialog"]',
      '[class*="overlay" i][style*="z-index"]',
      '[class*="backdrop" i]',
    ];

    for (const selector of overlaySelectors) {
      try {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          if (!isElementVisible(el)) continue;
          const text = el.textContent.toLowerCase();
          if (
            text.includes('verify') ||
            text.includes('verifikasi') ||
            text.includes('robot') ||
            text.includes('captcha')
          ) {
            console.log(`[SE-GrabFood] CAPTCHA overlay detected via selector: ${selector}`);
            return true;
          }
        }
      } catch {
        // Skip invalid selectors
      }
    }

    // Strategy 3: Any visible element whose text matches verification keywords
    const allElements = document.querySelectorAll('h1, h2, h3, h4, p, span, div, label');
    for (const el of allElements) {
      if (el.children.length > 0) continue; // leaf nodes only
      if (!isElementVisible(el)) continue;

      const text = el.textContent.trim().toLowerCase();
      if (
        text.length > 2 &&
        text.length < 200 &&
        (text.includes('verify') ||
          text.includes('verifikasi') ||
          text.includes('robot') ||
          text.includes('captcha'))
      ) {
        console.log(`[SE-GrabFood] CAPTCHA text detected: "${el.textContent.trim()}"`);
        return true;
      }
    }

    return false;
  }

  /**
   * If a CAPTCHA is detected, notify the extension and poll until
   * the user resolves it before continuing.
   * @returns {Promise<void>}
   */
  async function waitForCaptchaResolution() {
    if (!detectCaptcha()) return;

    console.log('[SE-GrabFood] CAPTCHA/dialog detected — waiting for user to solve it...');

    try {
      chrome.runtime.sendMessage({ action: 'captchaDetected', platform: 'grabfood' });
    } catch {
      // Message sending may fail if service worker is inactive, continue anyway
    }

    // Poll every 3 seconds until the CAPTCHA is gone
    while (detectCaptcha()) {
      await sleep(3000);
    }

    console.log('[SE-GrabFood] CAPTCHA resolved, resuming...');

    try {
      chrome.runtime.sendMessage({ action: 'captchaResolved', platform: 'grabfood' });
    } catch {
      // Ignore send errors
    }
  }

  // ── __NEXT_DATA__ Extraction ───────────────────────────────

  /**
   * Parse the __NEXT_DATA__ script tag and extract restaurant data
   * from the NextJS hydration payload.
   * @returns {Array<Object>} raw restaurant objects from __NEXT_DATA__
   */
  function extractFromNextData() {
    const scriptTag = document.querySelector(SELECTORS.nextData);
    if (!scriptTag) {
      console.warn('[SE-GrabFood] __NEXT_DATA__ script tag not found.');
      return [];
    }

    try {
      const nextData = JSON.parse(scriptTag.textContent);
      const pageProps = nextData?.props?.pageProps;

      if (!pageProps) {
        console.warn('[SE-GrabFood] pageProps not found in __NEXT_DATA__.');
        return [];
      }

      // GrabFood typically stores restaurant list under various paths
      // depending on the page version. Try several known structures.
      const restaurants =
        pageProps.searchResult?.searchMerchants ||
        pageProps.searchResult?.searchResult?.searchMerchants ||
        pageProps.restaurants ||
        pageProps.initialState?.restaurantList ||
        pageProps.merchantBriefs ||
        [];

      // If restaurants is an object (keyed by ID), convert to array
      if (restaurants && !Array.isArray(restaurants)) {
        if (typeof restaurants === 'object') {
          return Object.values(restaurants);
        }
      }

      console.log(
        `[SE-GrabFood] Extracted ${restaurants.length} restaurants from __NEXT_DATA__.`
      );

      return restaurants;
    } catch (err) {
      console.error('[SE-GrabFood] Failed to parse __NEXT_DATA__:', err);
      return [];
    }
  }

  /**
   * Normalize a raw restaurant object from __NEXT_DATA__ into our
   * standard merchant data structure.
   * @param {Object} raw — raw restaurant data from __NEXT_DATA__
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Object} normalized merchant
   */
  function normalizeNextDataRestaurant(raw, regionCode, regionName) {
    const id =
      raw.id ||
      raw.restaurantID ||
      raw.merchantID ||
      raw.merchantBrief?.id ||
      '';

    const name =
      raw.name ||
      raw.restaurantName ||
      raw.merchantBrief?.displayInfo?.primaryText ||
      raw.address?.name ||
      '';

    const address =
      raw.address?.address ||
      raw.merchantBrief?.address ||
      raw.addressLine ||
      raw.fullAddress ||
      '';

    const lat =
      raw.latitude ||
      raw.latlng?.latitude ||
      raw.address?.latitude ||
      null;

    const lng =
      raw.longitude ||
      raw.latlng?.longitude ||
      raw.address?.longitude ||
      null;

    const cuisine =
      raw.cuisine ||
      raw.merchantBrief?.cuisine ||
      (Array.isArray(raw.cuisines) ? raw.cuisines.join(', ') : '') ||
      raw.categoryName ||
      '';

    const rating =
      raw.rating ||
      raw.merchantBrief?.rating ||
      raw.averageRating ||
      null;

    const merchantUrl = id
      ? `https://food.grab.com/id/en/restaurant/${encodeURIComponent(name.replace(/\s+/g, '-').toLowerCase())}-${id}`
      : '';

    return {
      platform: 'grabfood',
      merchantName: name,
      merchantUrl,
      merchantId: String(id),
      address: address,
      latitude: lat ? parseFloat(lat) : null,
      longitude: lng ? parseFloat(lng) : null,
      provinceCode: regionCode,
      provinceName: regionName,
      regencyCode: '',
      regencyName: '',
      districtCode: '',
      districtName: '',
      category: cuisine,
      rating: rating ? parseFloat(rating) : null,
      totalProducts: null,
      totalSold: null,
      joinDate: '',
      isOfficialStore: false,
      phone: '',
      description: '',
      scrapedAt: new Date().toISOString(),
    };
  }

  // ── DOM Extraction ─────────────────────────────────────────

  /**
   * Extract restaurant data directly from DOM elements (cards/links).
   * This captures restaurants loaded dynamically via "Load More" clicks
   * that are not in the initial __NEXT_DATA__ payload.
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Array<Object>}
   */
  function extractFromDOM(regionCode, regionName) {
    const merchants = [];

    // Strategy 1: Restaurant card components
    const cards = document.querySelectorAll(SELECTORS.restaurantCard);

    for (const card of cards) {
      const merchant = extractRestaurantFromCard(card, regionCode, regionName);
      if (merchant) {
        merchants.push(merchant);
      }
    }

    // Strategy 2: If no cards found, look for restaurant links
    if (merchants.length === 0) {
      const links = document.querySelectorAll(SELECTORS.restaurantLink);

      for (const link of links) {
        const merchant = extractRestaurantFromLink(link, regionCode, regionName);
        if (merchant) {
          merchants.push(merchant);
        }
      }
    }

    return merchants;
  }

  /**
   * Extract restaurant data from a single restaurant card element.
   * @param {Element} card
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Object|null}
   */
  function extractRestaurantFromCard(card, regionCode, regionName) {
    // Find the restaurant link
    const link = card.querySelector('a[href*="/restaurant/"]');
    const href = link ? link.href : '';

    // Extract name — try heading elements first, then prominent text
    const nameEl =
      card.querySelector('h3, h4, h2, [class*="name" i], [class*="Name"]') ||
      card.querySelector('p:first-of-type');

    const name = nameEl ? nameEl.textContent.trim() : '';

    if (!name) return null;

    // Extract cuisine/category
    const cuisineEl =
      card.querySelector('[class*="cuisine" i], [class*="Cuisine"], [class*="category" i]') ||
      card.querySelector('p:nth-of-type(2)');

    const cuisine = cuisineEl ? cuisineEl.textContent.trim() : '';

    // Extract rating
    const ratingEl =
      card.querySelector('[class*="rating" i], [class*="Rating"]');

    let rating = null;
    if (ratingEl) {
      const ratingMatch = ratingEl.textContent.match(/([\d.]+)/);
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val >= 0 && val <= 5) rating = val;
      }
    }

    // Extract address if visible
    const addressEl =
      card.querySelector('[class*="address" i], [class*="Address"]');

    const address = addressEl ? addressEl.textContent.trim() : '';

    // Extract merchant ID from URL
    const merchantId = extractMerchantIdFromUrl(href);

    return {
      platform: 'grabfood',
      merchantName: name,
      merchantUrl: href ? href.split('?')[0] : '',
      merchantId: merchantId,
      address,
      latitude: null,
      longitude: null,
      provinceCode: regionCode,
      provinceName: regionName,
      regencyCode: '',
      regencyName: '',
      districtCode: '',
      districtName: '',
      category: cuisine,
      rating,
      totalProducts: null,
      totalSold: null,
      joinDate: '',
      isOfficialStore: false,
      phone: '',
      description: '',
      scrapedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract restaurant data from a restaurant detail link.
   * @param {Element} link
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Object|null}
   */
  function extractRestaurantFromLink(link, regionCode, regionName) {
    const href = link.href || '';
    if (!href.includes('/restaurant/')) return null;

    // Extract name from link text or child elements
    const name =
      link.textContent.trim() ||
      link.getAttribute('title') ||
      link.getAttribute('aria-label') ||
      '';

    if (!name || name.length > 200) return null;

    const merchantId = extractMerchantIdFromUrl(href);

    return {
      platform: 'grabfood',
      merchantName: name,
      merchantUrl: href.split('?')[0],
      merchantId: merchantId,
      address: '',
      latitude: null,
      longitude: null,
      provinceCode: regionCode,
      provinceName: regionName,
      regencyCode: '',
      regencyName: '',
      districtCode: '',
      districtName: '',
      category: '',
      rating: null,
      totalProducts: null,
      totalSold: null,
      joinDate: '',
      isOfficialStore: false,
      phone: '',
      description: '',
      scrapedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract the merchant/restaurant ID from a GrabFood restaurant URL.
   * GrabFood URLs typically end with the restaurant slug containing an ID,
   * e.g. /restaurant/restaurant-name-IDDD01234
   * @param {string} url
   * @returns {string}
   */
  function extractMerchantIdFromUrl(url) {
    if (!url) return '';

    try {
      const urlObj = new URL(url, 'https://food.grab.com');
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(Boolean);

      // The restaurant slug is the last segment
      const slug = segments[segments.length - 1] || '';

      // GrabFood IDs are typically at the end of the slug after the last hyphen
      // Pattern: restaurant-name-IDDD01234
      const idMatch = slug.match(/[A-Z]{2,}[\dA-Z]+$/);
      if (idMatch) return idMatch[0];

      // Fallback: use the entire slug
      return slug;
    } catch {
      return '';
    }
  }

  // ── Load More Handling ─────────────────────────────────────

  /**
   * Find and click the "Load More" button if it exists.
   * @returns {boolean} true if a load-more button was clicked
   */
  function clickLoadMore() {
    // Strategy 1: look for buttons with load-more related classes
    const loadMoreBtn = document.querySelector(SELECTORS.loadMoreButton);
    if (loadMoreBtn && isElementVisible(loadMoreBtn)) {
      loadMoreBtn.click();
      return true;
    }

    // Strategy 2: find any button containing "Load More" or "Muat Lebih"
    const allButtons = document.querySelectorAll(SELECTORS.loadMoreFallback);
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (
        text.includes('load more') ||
        text.includes('muat lebih') ||
        text.includes('lihat lebih') ||
        text.includes('more restaurants') ||
        text.includes('show more')
      ) {
        if (isElementVisible(btn)) {
          btn.click();
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if an element is visible on the page.
   * @param {Element} el
   * @returns {boolean}
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      el.offsetParent !== null
    );
  }

  // ── Geolocation Detection ─────────────────────────────────

  /**
   * Detect the city/address GrabFood is currently showing results for.
   *
   * GrabFood is GPS/geolocation-based only — there is no URL parameter
   * to control the delivery location. The page header typically shows
   * a delivery address or city name. This function attempts to extract
   * that text so we can report WHERE the results are actually from,
   * regardless of which region was requested.
   *
   * @returns {string} detected city/address text, or empty string if not found
   */
  function detectCurrentCity() {
    // Strategy 1: Look for elements with address-related class names in
    // the header/nav area (GrabFood shows "Delivering to: [address]")
    const addressSelectors = [
      'header [class*="address" i]',
      'nav [class*="address" i]',
      'header [class*="location" i]',
      'nav [class*="location" i]',
      '[class*="navbar" i] [class*="address" i]',
      '[class*="navbar" i] [class*="location" i]',
      '[class*="topBar" i] [class*="address" i]',
      '[class*="topBar" i] [class*="location" i]',
      '[data-testid*="address"]',
      '[data-testid*="location"]',
      '[class*="deliverTo" i]',
      '[class*="deliver-to" i]',
      '[class*="DeliveryAddress" i]',
      '[class*="delivery-address" i]',
      '[class*="LocationDisplay" i]',
      '[class*="location-display" i]',
    ];

    for (const selector of addressSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          if (text && text.length > 2 && text.length < 300) {
            console.log(`[SE-GrabFood] Detected delivery location via "${selector}": "${text}"`);
            return text;
          }
        }
      } catch {
        // Selector may be invalid in some environments, skip
      }
    }

    // Strategy 2: Look for any element in the top 200px of the page
    // that contains location-related keywords
    try {
      const topElements = document.querySelectorAll(
        'header *, nav *, [class*="navbar" i] *, [class*="topBar" i] *'
      );

      for (const el of topElements) {
        const text = el.textContent.trim();
        // Look for text that looks like an address (contains common address keywords)
        if (
          text &&
          text.length > 5 &&
          text.length < 200 &&
          el.children.length === 0 && // leaf node only
          (text.includes('Deliver') ||
            text.includes('deliver') ||
            text.includes('Jl.') ||
            text.includes('Jalan') ||
            text.includes('Kota') ||
            text.includes('Kec.') ||
            text.includes('Kel.'))
        ) {
          console.log(`[SE-GrabFood] Detected delivery location from header text: "${text}"`);
          return text;
        }
      }
    } catch {
      // Ignore errors during broad search
    }

    // Strategy 3: Check __NEXT_DATA__ for location/city info
    try {
      const scriptTag = document.querySelector('script#__NEXT_DATA__');
      if (scriptTag) {
        const nextData = JSON.parse(scriptTag.textContent);
        const pageProps = nextData?.props?.pageProps;

        const cityName =
          pageProps?.city?.name ||
          pageProps?.cityName ||
          pageProps?.location?.city ||
          pageProps?.location?.address ||
          pageProps?.userLocation?.city ||
          pageProps?.userLocation?.address ||
          pageProps?.initialState?.location?.city ||
          '';

        if (cityName) {
          console.log(`[SE-GrabFood] Detected city from __NEXT_DATA__: "${cityName}"`);
          return cityName;
        }
      }
    } catch {
      // Ignore JSON parse errors
    }

    console.warn('[SE-GrabFood] Could not detect current delivery city from page.');
    return '';
  }

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Core scraping logic: extract from __NEXT_DATA__, then scroll/load-more
   * to capture additional restaurants from the DOM.
   * @param {string} regionCode
   * @param {string} regionName
   * @returns {Promise<Object[]>}
   */
  async function scrapeRestaurants(regionCode, regionName) {
    const merchantMap = new Map();

    // ── Phase 0: Detect actual delivery city ─────────────────
    // GrabFood is GPS/geolocation-based only. The results shown depend
    // on the browser's geolocation, NOT the requested region. We detect
    // the actual city being shown so the caller knows where results are from.
    console.log('[SE-GrabFood] Phase 0: Detecting actual delivery city...');
    const detectedCity = detectCurrentCity();

    if (detectedCity) {
      console.log(`[SE-GrabFood] GrabFood is showing results for: "${detectedCity}"`);

      // Warn if the detected location doesn't seem to match the requested region
      const regionLower = regionName.toLowerCase();
      const detectedLower = detectedCity.toLowerCase();
      if (
        !detectedLower.includes(regionLower) &&
        !regionLower.includes(detectedLower)
      ) {
        console.warn(
          `[SE-GrabFood] LOCATION MISMATCH: Requested region "${regionName}" ` +
          `but GrabFood is showing results for "${detectedCity}". ` +
          `GrabFood uses browser geolocation — results are from the browser's ` +
          `current location, not the requested region.`
        );
      }
    } else {
      console.warn(
        '[SE-GrabFood] Could not detect current delivery city. ' +
        'Results may not be from the requested region. GrabFood is GPS-based only.'
      );
    }

    // ── CAPTCHA check before scraping begins ─────────────────
    await waitForCaptchaResolution();

    // ── Phase 1: Extract from __NEXT_DATA__ ──────────────────
    console.log('[SE-GrabFood] Phase 1: Extracting from __NEXT_DATA__...');
    const nextDataRestaurants = extractFromNextData();

    for (const raw of nextDataRestaurants) {
      const merchant = normalizeNextDataRestaurant(raw, regionCode, regionName);
      if (merchant.merchantName) {
        const key = `${merchant.merchantName.toLowerCase()}|${merchant.address.toLowerCase()}`;
        if (!merchantMap.has(key)) {
          merchantMap.set(key, merchant);
        }
      }
    }

    console.log(
      `[SE-GrabFood] Phase 1 complete: ${merchantMap.size} merchants from __NEXT_DATA__.`
    );

    // ── Phase 2: Scroll and extract from DOM ─────────────────
    console.log('[SE-GrabFood] Phase 2: Scrolling and extracting from DOM...');

    // Initial scroll to load lazy content
    await scrollToBottom();
    await sleep(1000);

    // Collect initial DOM restaurants
    const domRestaurants = extractFromDOM(regionCode, regionName);
    for (const merchant of domRestaurants) {
      if (merchant.merchantName) {
        const key = `${merchant.merchantName.toLowerCase()}|${merchant.address.toLowerCase()}`;
        if (!merchantMap.has(key)) {
          merchantMap.set(key, merchant);
        }
      }
    }

    console.log(
      `[SE-GrabFood] After DOM extraction: ${merchantMap.size} total merchants.`
    );

    // ── Phase 3: Click "Load More" to get additional restaurants ─
    console.log('[SE-GrabFood] Phase 3: Clicking "Load More" for additional data...');

    let loadMoreClicks = 0;

    while (loadMoreClicks < MAX_LOAD_MORE_CLICKS) {
      const clicked = clickLoadMore();
      if (!clicked) {
        console.log('[SE-GrabFood] No "Load More" button found or visible, stopping.');
        break;
      }

      loadMoreClicks++;
      console.log(
        `[SE-GrabFood] Load More click #${loadMoreClicks}/${MAX_LOAD_MORE_CLICKS}`
      );

      // Check for CAPTCHA after each load-more click
      await waitForCaptchaResolution();

      // Wait for new content to load
      await sleep(LOAD_MORE_DELAY_MS);

      // Scroll to trigger lazy-loading of new cards
      await scrollToBottom();
      await sleep(500);

      // Collect newly loaded restaurants
      const previousCount = merchantMap.size;
      const newRestaurants = extractFromDOM(regionCode, regionName);

      for (const merchant of newRestaurants) {
        if (merchant.merchantName) {
          const key = `${merchant.merchantName.toLowerCase()}|${merchant.address.toLowerCase()}`;
          if (!merchantMap.has(key)) {
            merchantMap.set(key, merchant);
          }
        }
      }

      const added = merchantMap.size - previousCount;
      console.log(
        `[SE-GrabFood] Load More #${loadMoreClicks}: ${added} new merchants (total: ${merchantMap.size})`
      );

      // If no new merchants were found, further clicks are unlikely to help
      if (added === 0) {
        console.log('[SE-GrabFood] No new merchants from last load more, stopping.');
        break;
      }
    }

    console.log(
      `[SE-GrabFood] Scraping complete. Total unique merchants: ${merchantMap.size}`
    );

    // ── Phase 4: Enrich with intercepted API data ────────────
    // The MAIN-world interceptor captures search/recommended API
    // responses which contain lat/lng, cuisine, and rating data.
    console.log(
      `[SE-GrabFood] Phase 4: Enriching with ${interceptedMerchants.size} intercepted API merchants...`
    );

    const merchants = Array.from(merchantMap.values());

    for (const merchant of merchants) {
      const apiData = interceptedMerchants.get(merchant.merchantId);
      if (apiData) {
        // Enrich with lat/lng from API
        if (apiData.latitude != null && apiData.longitude != null) {
          merchant.latitude = apiData.latitude;
          merchant.longitude = apiData.longitude;
        }
        // Enrich cuisine if missing
        if (!merchant.category && apiData.cuisine) {
          merchant.category = apiData.cuisine;
        }
        // Enrich rating if missing
        if (merchant.rating == null && apiData.rating != null) {
          merchant.rating = apiData.rating;
        }
      }

      // Backfill address with detected city
      if (detectedCity) {
        merchant.description = merchant.description
          ? `${merchant.description} | GrabFood location: ${detectedCity}`
          : `GrabFood location: ${detectedCity}`;

        if (!merchant.address || merchant.address.trim() === '') {
          merchant.address = detectedCity;
        }
      }
    }

    // Also add any intercepted merchants not found via DOM scraping
    let apiOnlyCount = 0;
    for (const [id, apiData] of interceptedMerchants) {
      const alreadyExists = merchants.some((m) => m.merchantId === id);
      if (!alreadyExists && apiData.name) {
        merchants.push({
          platform: 'grabfood',
          merchantName: apiData.name,
          merchantUrl: `https://food.grab.com/id/en/restaurant/${encodeURIComponent(apiData.name.replace(/\s+/g, '-').toLowerCase())}-${id}`,
          merchantId: String(id),
          address: detectedCity || '',
          latitude: apiData.latitude,
          longitude: apiData.longitude,
          provinceCode: regionCode,
          provinceName: regionName,
          regencyCode: '',
          regencyName: '',
          districtCode: '',
          districtName: '',
          category: apiData.cuisine || '',
          rating: apiData.rating,
          totalProducts: null,
          totalSold: null,
          joinDate: '',
          isOfficialStore: false,
          phone: '',
          description: detectedCity ? `GrabFood location: ${detectedCity}` : '',
          scrapedAt: new Date().toISOString(),
        });
        apiOnlyCount++;
      }
    }

    if (apiOnlyCount > 0) {
      console.log(
        `[SE-GrabFood] Added ${apiOnlyCount} API-only merchants not found in DOM.`
      );
    }

    console.log(
      `[SE-GrabFood] Final count: ${merchants.length} merchants ` +
      `(${merchants.filter((m) => m.latitude != null).length} with lat/lng)`
    );

    return {
      merchants,
      detectedCity: detectedCity || null,
    };
  }

  // ── Message Listener ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action !== 'startScrape' || message.platform !== 'grabfood') {
      return false;
    }

    const { regionCode, regionName } = message;

    console.log(
      `[SE-GrabFood] Received startScrape for region ${regionCode} (${regionName})`
    );

    scrapeRestaurants(regionCode, regionName)
      .then((result) => {
        // scrapeRestaurants now returns { merchants, detectedCity }
        sendResponse({
          success: true,
          merchants: result.merchants,
          detectedCity: result.detectedCity,
        });
      })
      .catch((err) => {
        console.error('[SE-GrabFood] Scraping error:', err);
        sendResponse({ success: false, merchants: [], detectedCity: null, error: err.message });
      });

    // Return true to keep the message channel open for the async response
    return true;
  });

  console.log('[SE-GrabFood] Content script loaded and ready.');
})();
