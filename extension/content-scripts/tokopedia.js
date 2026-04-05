/**
 * SE Merchant Scraper — Tokopedia Content Script
 *
 * Injected on tokopedia.com search pages. Listens for a
 * `startScrape` message from the service worker, extracts
 * unique shop/merchant data from shop search cards (st=shop),
 * and sends results back via chrome.runtime.sendMessage.
 */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────

  const MAX_PAGES = 5;
  const SCROLL_DELAY_MS = 800;
  const PAGE_LOAD_TIMEOUT_MS = 15000;
  const MAX_SCROLL_ATTEMPTS = 20;
  const NEXT_PAGE_DELAY_MS = 2000;

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
   * trigger lazy-loading of additional shop cards.
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
   * Detect whether a CAPTCHA, verification dialog, or challenge
   * overlay is currently visible on the page.
   * @returns {boolean}
   */
  function detectCaptcha() {
    // 1. Elements whose class or id contain CAPTCHA-related keywords
    const keywordSelectors = [
      '[class*="captcha"]', '[id*="captcha"]',
      '[class*="Captcha"]', '[id*="Captcha"]',
      '[class*="verify"]',  '[id*="verify"]',
      '[class*="Verify"]',  '[id*="Verify"]',
      '[class*="challenge"]', '[id*="challenge"]',
      '[class*="Challenge"]', '[id*="Challenge"]',
      '[class*="recaptcha"]', '[id*="recaptcha"]',
      '[class*="reCAPTCHA"]', '[id*="reCAPTCHA"]',
    ];

    for (const sel of keywordSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return true;
    }

    // 2. Modal / dialog overlays — divs with very high z-index covering the viewport
    const allDivs = document.querySelectorAll('div');
    for (const div of allDivs) {
      const style = window.getComputedStyle(div);
      const zIndex = parseInt(style.zIndex, 10);
      if (
        zIndex >= 9999 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        div.offsetWidth >= window.innerWidth * 0.5 &&
        div.offsetHeight >= window.innerHeight * 0.5
      ) {
        return true;
      }
    }

    // 3. Iframes containing captcha sources
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.getAttribute('src') || '').toLowerCase();
      if (
        src.includes('captcha') ||
        src.includes('recaptcha') ||
        src.includes('challenge') ||
        src.includes('verify')
      ) {
        return true;
      }
    }

    // 4. Any visible element whose text matches verification keywords
    const textKeywords = /\b(verify|verifikasi|robot|captcha)\b/i;
    const candidates = document.querySelectorAll(
      'h1, h2, h3, h4, h5, p, span, label, div[role="dialog"], div[role="alertdialog"]'
    );
    for (const el of candidates) {
      if (
        el.offsetParent !== null &&
        textKeywords.test(el.textContent)
      ) {
        // Avoid false positives from very large containers whose
        // descendants happen to include the keyword
        if (el.textContent.length < 300) return true;
      }
    }

    return false;
  }

  /**
   * If a CAPTCHA / verification dialog is on screen, notify the
   * service worker, then poll every 3 seconds until it is gone.
   * Resolves once the CAPTCHA has been cleared.
   * @returns {Promise<void>}
   */
  async function waitForCaptchaResolution() {
    if (!detectCaptcha()) return;

    console.log('[SE-Tokopedia] CAPTCHA/dialog detected — waiting for user to solve it...');
    chrome.runtime.sendMessage({ action: 'captchaDetected', platform: 'tokopedia' });

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!detectCaptcha()) {
          clearInterval(interval);
          console.log('[SE-Tokopedia] CAPTCHA resolved, resuming...');
          chrome.runtime.sendMessage({ action: 'captchaResolved', platform: 'tokopedia' });
          resolve();
        }
      }, 3000);
    });
  }

  // ── Shop Card Extraction ───────────────────────────────────

  /**
   * Extract the shop slug from a Tokopedia shop URL.
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
   * Find the shop search results container on the page.
   * Tries multiple selectors since Tokopedia may change structure.
   * @returns {Element|null}
   */
  function findSearchContainer() {
    // Primary: the shop search results container
    return (
      document.querySelector('div[data-testid="divSRPContentProducts"]') ||
      document.querySelector('div[data-testid="shopSRPContent"]') ||
      document.querySelector('#srp_component_content') ||
      document.querySelector('.search-container') ||
      // Fallback: main content area
      document.querySelector('main') ||
      document.querySelector('#zeus-root')
    );
  }

  /**
   * Extract shop cards from the current page.
   * On the shop search page (st=shop), each result is a shop card
   * containing the shop name, location, URL, and reputation badge.
   * @returns {Array<{name: string, url: string, location: string, isOfficial: boolean, reputationImg: string}>}
   */
  function extractShopCards() {
    const shops = [];

    // Strategy 1: Look for shop card links with data-testid
    const shopCards = document.querySelectorAll(
      'div[data-testid="divShopCard"], div[data-testid="master-product-card"], div[data-testid="divSRPContentProducts"] > div'
    );

    if (shopCards.length > 0) {
      for (const card of shopCards) {
        const shopInfo = extractShopInfoFromCard(card);
        if (shopInfo) shops.push(shopInfo);
      }
    }

    // Strategy 2: If no cards found via data-testid, look for shop links structurally
    if (shops.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="tokopedia.com/"]');
      const seen = new Set();

      for (const link of allLinks) {
        const href = link.href || '';
        if (!href) continue;

        try {
          const url = new URL(href);
          if (url.hostname !== 'www.tokopedia.com') continue;

          const segments = url.pathname.split('/').filter(Boolean);
          // Shop URLs have exactly 1 segment (the shop slug)
          if (segments.length !== 1) continue;

          const slug = segments[0];
          // Skip known non-shop paths
          const skipPaths = [
            'search', 'discovery', 'promo', 'help', 'about', 'careers',
            'blog', 'categories', 'feed', 'tokopoints', 'affiliate',
            'hot', 'top-up', 'pulsa', 'tiket', 'saldo', 'p', 'find',
            'terms', 'privacy', 'cod', 'partner', 'daftar-halaman',
            'mobile-apps', 'perlindungan-kekayaan-intelektual',
            'register', 'login', 'settings', 'cart', 'wishlist',
            'order-list', 'people', 'review', 'shop', 'seller', 'ta',
            'events', 'seru', 'play', 'official-store', 'bebas-ongkir',
            'kejar-diskon', 'now', 'gopay', 'plus', 'mitra', 'b2b',
            'affiliate-program',
          ];
          if (skipPaths.includes(slug.toLowerCase())) continue;
          if (seen.has(slug)) continue;
          seen.add(slug);

          // Filter out links inside footer, header, nav, or sidebar regions
          if (link.closest('footer, header, nav, [class*="footer"], [class*="Footer"], [class*="header"], [class*="Header"], [class*="nav" i], [class*="sidebar"], [class*="bottomNav"]')) continue;

          // Get the closest container that might be a card
          const container = link.closest('div[class]') || link.parentElement;

          // Try structural extraction first (name/location as separate child divs)
          let name = '';
          let location = '';
          const wrapper = findContentWrapper(link);
          if (wrapper) {
            const childDivs = Array.from(wrapper.children).filter(
              el => el.tagName === 'DIV'
            );
            if (childDivs.length >= 1) name = childDivs[0].textContent.trim();
            if (childDivs.length >= 2) location = childDivs[1].textContent.trim();
          }

          // Fallback to old extraction
          if (!name) name = extractShopNameFromLink(link, container);
          if (!name || name.length < 2) continue;
          if (!location) location = extractLocationFromContainer(container);

          const isOfficial = checkOfficialBadge(container);

          shops.push({
            name,
            url: `https://www.tokopedia.com/${slug}`,
            location,
            isOfficial,
            reputationImg: '',
          });
        } catch {
          // skip malformed URLs
        }
      }
    }

    return shops;
  }

  /**
   * Extract shop info from a single card element.
   * @param {Element} card
   * @returns {{name: string, url: string, location: string, isOfficial: boolean, reputationImg: string}|null}
   */
  function extractShopInfoFromCard(card) {
    // Find shop link — look for anchor with shop-level URL
    const links = card.querySelectorAll('a[href]');
    let shopLink = null;
    let shopUrl = '';

    for (const link of links) {
      const href = link.href || '';
      try {
        const url = new URL(href);
        if (url.hostname !== 'www.tokopedia.com') continue;
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(segments[0])) {
          const slug = segments[0].toLowerCase();
          const skipPaths = [
            'search', 'discovery', 'promo', 'help', 'about', 'careers',
            'blog', 'categories', 'feed', 'tokopoints', 'affiliate',
            'hot', 'top-up', 'pulsa', 'tiket', 'saldo', 'p', 'find',
            'terms', 'privacy', 'cod', 'partner', 'daftar-halaman',
            'mobile-apps', 'perlindungan-kekayaan-intelektual',
            'register', 'login', 'settings', 'cart', 'wishlist',
            'order-list', 'people', 'review', 'shop', 'seller', 'ta',
            'events', 'seru', 'play', 'official-store', 'bebas-ongkir',
            'kejar-diskon', 'now', 'gopay', 'plus', 'mitra', 'b2b',
            'affiliate-program',
          ];
          if (!skipPaths.includes(slug)) {
            shopLink = link;
            shopUrl = `https://www.tokopedia.com/${segments[0]}`;
            break;
          }
        }
      } catch {
        // skip
      }
    }

    if (!shopLink && !shopUrl) return null;

    // ── Structural extraction (verified via Playwright 2026-03-08) ──
    // Tokopedia shop card link structure:
    //   <a href="/shop-slug">
    //     <img/>                   ← shop avatar
    //     <div>                    ← content wrapper
    //       <div>Shop Name</div>  ← first child div = name
    //       <div>Location</div>   ← second child div = location
    //       <img/>                ← reputation badge
    //     </div>
    //     <button>Lihat Toko</button>
    //   </a>
    let name = '';
    let location = '';

    const contentWrapper = findContentWrapper(shopLink);
    if (contentWrapper) {
      const childDivs = Array.from(contentWrapper.children).filter(
        el => el.tagName === 'DIV'
      );
      if (childDivs.length >= 1) name = childDivs[0].textContent.trim();
      if (childDivs.length >= 2) location = childDivs[1].textContent.trim();
    }

    // Fallback: use old extraction if structural approach fails
    if (!name) {
      location = extractLocationFromContainer(card);
      name = extractShopNameFromLink(shopLink, card, location);
    }

    if (!name || name.length < 2) return null;

    const isOfficial = checkOfficialBadge(card);

    let reputationImg = '';
    const badgeImgs = card.querySelectorAll('img');
    for (const img of badgeImgs) {
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (
        src.includes('badge') ||
        src.includes('reputation') ||
        alt.includes('badge') ||
        alt.includes('reputation')
      ) {
        reputationImg = img.getAttribute('src') || '';
        break;
      }
    }

    return { name, url: shopUrl, location, isOfficial, reputationImg };
  }

  /**
   * Find the content wrapper div inside a shop card link.
   * The verified DOM structure (Playwright 2026-03-08):
   *   <a> → <img>(avatar) + <div>(wrapper) + <button>(Lihat Toko)
   * The wrapper contains: <div>(name) + <div>(location) + <img>(reputation)
   */
  function findContentWrapper(link) {
    if (!link) return null;
    for (const child of link.children) {
      if (child.tagName === 'DIV') {
        const hasChildDivs = Array.from(child.children).some(
          el => el.tagName === 'DIV'
        );
        if (hasChildDivs) return child;
      }
    }
    return null;
  }

  /**
   * Clean a raw shop name string by removing garbage suffixes and text.
   * @param {string} raw
   * @returns {string}
   */
  function cleanShopName(raw, locationText) {
    if (!raw) return '';

    let name = raw.trim();

    // Remove trailing "Lihat Toko" and variations
    name = name.replace(/\s*Lihat Toko\s*/gi, '');

    // Remove common garbage phrases
    const garbagePhrases = [
      'Promo khusus aplikasi',
      'Gratis Ongkir',
      'Bebas Ongkir',
      'Top Up',
      'Banyak Promo',
      'belanja di aplikasi',
    ];
    for (const phrase of garbagePhrases) {
      name = name.replace(new RegExp(`\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*`, 'gi'), '');
    }

    // If we know the location text from the card, strip it from the name
    // This is the primary fix: location text (e.g. "Kab. Morowali", "Palu")
    // often gets concatenated with the shop name during DOM text extraction.
    if (locationText && locationText.length > 1) {
      const escaped = locationText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Strip if it appears at the end of the name
      name = name.replace(new RegExp(`\\s*${escaped}\\s*$`, 'i'), '');
      // Also strip with common prefixes
      name = name.replace(new RegExp(`\\s+(Kota|Kab\\.|Kabupaten)\\s+${escaped}\\s*$`, 'i'), '');
    }

    // Remove location text that gets appended to shop names
    // Common patterns: "ShopName Kota Palu", "ShopName Kab. Morowali"
    name = name.replace(/\s+(Kota|Kab\.|Kabupaten)\s+[A-Z][a-zA-Z\s.-]*$/g, '');

    // If the name is still too long (>80 chars), it likely has concatenated
    // card text — try to cut before a city name pattern
    if (name.length > 80) {
      const cityPattern = /([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)*)\s*$/;
      const match = name.match(cityPattern);
      if (match && match.index && match.index > 5) {
        name = name.substring(0, match.index).trim();
      }
    }

    // Final length guard
    if (name.length > 80) {
      name = name.substring(0, 80).trim();
    }

    return name.trim();
  }

  function extractShopNameFromLink(link, container, locationText) {
    if (!link && !container) return '';

    // Try data-testid based shop name elements first (most reliable)
    if (container) {
      const shopNameEl =
        container.querySelector('[data-testid="linkProductShopName"]') ||
        container.querySelector('[data-testid="shopName"]') ||
        container.querySelector('[data-testid="spnShopName"]') ||
        container.querySelector('span[data-testid*="shop"]');

      if (shopNameEl) {
        // Use only the direct text of the element, not children's text
        // to avoid picking up location text from sibling elements
        let text = '';
        for (const node of shopNameEl.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
          }
        }
        text = text.trim();
        // If direct text is empty, use textContent but clean it
        if (!text) text = shopNameEl.textContent.trim();
        text = cleanShopName(text, locationText);
        if (text && text.length > 1) return text;
      }
    }

    // Try the link text — but only use direct text content to avoid
    // concatenating location/badge text that are children of the link
    if (link) {
      // First try: only direct text nodes of the link
      let directText = '';
      for (const node of link.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          directText += node.textContent;
        }
      }
      directText = directText.trim();

      if (directText && directText.length > 1 && directText.length <= 80) {
        return cleanShopName(directText, locationText);
      }

      // Second try: look for a child span/div that holds just the shop name
      const nameChild = link.querySelector('span, div, b, strong');
      if (nameChild) {
        const childText = cleanShopName(nameChild.textContent, locationText);
        if (childText && childText.length > 1 && childText.length <= 80) {
          return childText;
        }
      }

      // Last resort: full link text
      const text = cleanShopName(link.textContent, locationText);
      if (text && text.length > 1 && text.length <= 80) {
        return text;
      }
    }

    return link ? cleanShopName(link.textContent, locationText) : '';
  }

  /**
   * Extract location text from a container element.
   * @param {Element} container
   * @returns {string}
   */
  function extractLocationFromContainer(container) {
    if (!container) return '';

    // Strategy 1: data-testid based location elements
    const locEl =
      container.querySelector('[data-testid="linkProductShopLocation"]') ||
      container.querySelector('[data-testid="shopLocation"]') ||
      container.querySelector('[data-testid="spnShopLocation"]') ||
      container.querySelector('span[data-testid*="location"]') ||
      container.querySelector('span[data-testid*="Location"]');

    if (locEl) {
      return locEl.textContent.trim();
    }

    // Strategy 2: Look for small text elements that look like city names
    const spans = container.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent.trim();
      if (
        text.length > 2 &&
        text.length < 40 &&
        !text.includes('Rp') &&
        !text.includes('%') &&
        !text.includes('terjual') &&
        !text.includes('rating') &&
        !text.includes('produk') &&
        !text.includes('Produk') &&
        span.closest('a') === null
      ) {
        const parent = span.parentElement;
        if (parent) {
          const parentText = parent.textContent.trim();
          if (parentText === text || parentText.length < text.length + 10) {
            return text;
          }
        }
      }
    }

    return '';
  }

  /**
   * Check if a container has an official store badge.
   * @param {Element} container
   * @returns {boolean}
   */
  function checkOfficialBadge(container) {
    if (!container) return false;

    // Check for official store badge via data-testid
    const badge =
      container.querySelector('[data-testid="imgProductShopBadge"]') ||
      container.querySelector('[data-testid="shopBadge"]') ||
      container.querySelector('img[alt*="Official"]') ||
      container.querySelector('img[alt*="official"]');

    if (badge) {
      const alt = (badge.getAttribute('alt') || '').toLowerCase();
      if (alt.includes('official')) return true;
      const src = (badge.getAttribute('src') || '').toLowerCase();
      if (src.includes('official')) return true;
    }

    // Check for textual labels
    const labels = container.querySelectorAll('span, div, p');
    for (const el of labels) {
      const text = el.textContent.trim().toLowerCase();
      if (text === 'official store' || text === 'os') return true;
    }

    // Check badge images
    const images = container.querySelectorAll('img');
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

  // ── Main Scraping Routine ──────────────────────────────────

  /**
   * Collect unique merchants from all shop cards currently
   * visible on the page.
   * @param {Map<string, Object>} merchantMap — existing merchants (keyed by URL)
   * @param {string} regionCode
   * @param {string} regionName
   * @param {Object} region — full region hierarchy
   */
  function collectMerchantsFromPage(merchantMap, regionCode, regionName, region) {
    const shopCards = extractShopCards();

    // Blacklisted terms that indicate a non-shop link was picked up
    const blacklistedTerms = [
      'syarat', 'ketentuan', 'kebijakan', 'privasi', 'tokopedia',
      'gratis ongkir', 'promo', 'top up', 'tagihan', 'hak kekayaan',
    ];

    // Expanded skip slugs for URL re-validation
    const skipSlugs = new Set([
      'search', 'discovery', 'promo', 'help', 'about', 'careers',
      'blog', 'categories', 'feed', 'tokopoints', 'affiliate',
      'hot', 'top-up', 'pulsa', 'tiket', 'saldo', 'p', 'find',
      'terms', 'privacy', 'cod', 'partner', 'daftar-halaman',
      'mobile-apps', 'perlindungan-kekayaan-intelektual',
      'register', 'login', 'settings', 'cart', 'wishlist',
      'order-list', 'people', 'review', 'shop', 'seller', 'ta',
      'events', 'seru', 'play', 'official-store', 'bebas-ongkir',
      'kejar-diskon', 'now', 'gopay', 'plus', 'mitra', 'b2b',
      'affiliate-program',
    ]);

    for (const shop of shopCards) {
      if (!shop.name) continue;

      // Validate merchant name — reject if it contains blacklisted terms
      const nameLower = shop.name.toLowerCase();
      if (blacklistedTerms.some((term) => nameLower.includes(term))) continue;

      // Reject names that are still too long after cleaning
      if (shop.name.length > 80) continue;

      // Re-validate the URL slug against known non-shop paths
      if (shop.url) {
        const slug = extractShopSlug(shop.url).toLowerCase();
        if (skipSlugs.has(slug)) continue;
      }

      // Build a canonical URL key for deduplication
      const urlKey = shop.url || shop.name.toLowerCase();
      if (merchantMap.has(urlKey)) continue;

      // Use the location text from the card as regencyName when no
      // specific regency was selected in the popup. Tokopedia shows
      // regency/city names (e.g. "Parigi", "Sigi", "Palu") under
      // each shop card — this is more accurate than leaving it blank.
      const cardLocation = (shop.location || '').trim();
      const regencyName = region?.regency?.name || cardLocation;
      const regencyCode = region?.regency?.code || '';

      merchantMap.set(urlKey, {
        platform: 'tokopedia',
        merchantName: shop.name,
        merchantUrl: shop.url || '',
        merchantId: extractShopSlug(shop.url || ''),
        address: shop.location,
        provinceCode: region?.province?.code || regionCode,
        provinceName: region?.province?.name || regionName,
        regencyCode: regencyCode,
        regencyName: regencyName,
        districtCode: region?.district?.code || '',
        districtName: region?.district?.name || '',
        category: '',
        rating: null,
        totalProducts: null,
        totalSold: null,
        joinDate: '',
        isOfficialStore: shop.isOfficial,
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
      document.querySelector('a[data-testid="btnShopProductPageNext"]') ||
      document.querySelector('nav[role="navigation"] a:last-child');

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
   * Core scraping loop: scroll to load all shops on current page,
   * collect merchants, then paginate up to MAX_PAGES.
   * @param {string} regionCode
   * @param {string} regionName
   * @param {Object} region — full region hierarchy
   * @returns {Promise<Object[]>}
   */
  async function scrapeAllPages(regionCode, regionName, region) {
    const merchantMap = new Map();
    let currentPage = 1;

    // Wait for initial content to render
    const container = await waitForElement(
      'div[data-testid="divSRPContentProducts"], div[data-testid="shopSRPContent"], #srp_component_content, main',
      PAGE_LOAD_TIMEOUT_MS
    );

    if (!container) {
      console.warn('[SE-Tokopedia] Search container not found, trying to scrape anyway.');
    }

    // Check for CAPTCHA before starting the scrape
    await waitForCaptchaResolution();

    while (currentPage <= MAX_PAGES) {
      console.log(
        `[SE-Tokopedia] Scraping page ${currentPage}/${MAX_PAGES}...`
      );

      // Scroll to load lazy content
      await scrollToBottom();

      // Small extra wait for any remaining lazy renders
      await sleep(1000);

      // Collect merchants from current page
      const previousCount = merchantMap.size;
      collectMerchantsFromPage(merchantMap, regionCode, regionName, region);

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

        // Check for CAPTCHA after page navigation
        await waitForCaptchaResolution();

        // Wait for new content to appear
        await waitForElement(
          'div[data-testid="divSRPContentProducts"], div[data-testid="shopSRPContent"], #srp_component_content, main',
          PAGE_LOAD_TIMEOUT_MS
        );
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

    const { regionCode, regionName, region } = message;

    console.log(
      `[SE-Tokopedia] Received startScrape for region ${regionCode} (${regionName})`
    );

    scrapeAllPages(regionCode, regionName, region)
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
