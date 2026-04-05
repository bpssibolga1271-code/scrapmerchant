/**
 * SE Merchant Scraper — GrabFood Fetch Interceptor
 *
 * Injected in the MAIN world at document_start, BEFORE the page's JS runs.
 * Patches window.fetch to intercept GrabFood API calls and:
 *   1. Replace lat/lng with custom coordinates (from URL hash)
 *   2. Capture response merchant data (with lat/lng) and forward
 *      to the content script via window.postMessage
 *
 * Coordinates are passed via URL hash fragment:
 *   food.grab.com/id/en/restaurants?cityHint=Palu#se_lat=-0.89&se_lng=119.87
 */

(function () {
  'use strict';

  // ── Read custom coordinates from URL hash ──────────────────
  const hash = window.location.hash || '';
  const latMatch = hash.match(/se_lat=([-\d.]+)/);
  const lngMatch = hash.match(/se_lng=([-\d.]+)/);

  if (!latMatch || !lngMatch) {
    // No custom coordinates — don't intercept
    return;
  }

  const customLat = latMatch[1];
  const customLng = lngMatch[1];

  console.log(
    `[SE-GrabFood-Interceptor] Custom coordinates: ${customLat}, ${customLng}`
  );

  // ── Patch window.fetch ─────────────────────────────────────
  const origFetch = window.fetch;

  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    let modifiedInit = init ? { ...init } : {};

    // ── Intercept search POST ────────────────────────────────
    if (url.includes('foodweb/guest/v2/search') && modifiedInit.body) {
      try {
        const body = JSON.parse(modifiedInit.body);
        body.latlng = `${customLat},${customLng}`;
        modifiedInit.body = JSON.stringify(body);
        console.log(
          `[SE-GrabFood-Interceptor] Modified search POST latlng → ${customLat},${customLng} (offset=${body.offset})`
        );
      } catch {
        // Not JSON body, skip
      }
    }

    // ── Intercept recommended merchants GET ──────────────────
    if (url.includes('recommended/merchants')) {
      try {
        const u = new URL(url);
        u.searchParams.set('latitude', customLat);
        u.searchParams.set('longitude', customLng);
        url = u.toString();
        console.log('[SE-GrabFood-Interceptor] Modified recommended/merchants lat/lng');
      } catch {
        // URL parse failed, skip
      }
    }

    // ── Intercept category shortcuts GET ─────────────────────
    if (url.includes('category/shortcuts')) {
      try {
        const u = new URL(url);
        u.searchParams.set('latlng', `${customLat},${customLng}`);
        url = u.toString();
        console.log('[SE-GrabFood-Interceptor] Modified category/shortcuts latlng');
      } catch {
        // URL parse failed, skip
      }
    }

    // ── Make the actual request ──────────────────────────────
    const response = await origFetch.call(
      this,
      typeof input === 'string' || !(input instanceof Request) ? url : input,
      modifiedInit
    );

    // ── Capture search response data ─────────────────────────
    if (url.includes('foodweb/guest/v2/search')) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        const merchants = (data.searchMerchants || []).map((m) => ({
          id: m.id || '',
          name: m.address?.name || '',
          latitude: m.latlng?.latitude || null,
          longitude: m.latlng?.longitude || null,
          cuisine: m.cuisine || '',
          rating: m.rating != null ? parseFloat(m.rating) : null,
          estimatedDeliveryTime: m.estimatedDeliveryTime || null,
          distanceInKm: m.distanceInKm || null,
          promo: m.promo || null,
          merchantBrief: m.merchantBrief || null,
        }));

        window.postMessage(
          {
            type: 'SE_GRABFOOD_SEARCH_DATA',
            merchants,
            offset: (() => {
              try {
                return JSON.parse(modifiedInit.body).offset || 0;
              } catch {
                return 0;
              }
            })(),
          },
          '*'
        );

        console.log(
          `[SE-GrabFood-Interceptor] Captured ${merchants.length} merchants from search response`
        );
      } catch {
        // Response clone/parse failed, non-critical
      }
    }

    // ── Capture recommended merchants response ───────────────
    if (url.includes('recommended/merchants')) {
      try {
        const clone = response.clone();
        const data = await clone.json();
        const groups = data.recommendedMerchantGroups || [];
        const allMerchants = groups.flatMap((g) => g.recommendedMerchants || []);
        const merchants = allMerchants.map((m) => ({
          id: m.id || '',
          name: m.address?.name || '',
          latitude: m.latlng?.latitude || null,
          longitude: m.latlng?.longitude || null,
          cuisine: m.merchantData?.cuisine || '',
          rating: m.merchantData?.rating
            ? parseFloat(m.merchantData.rating)
            : null,
          voteCount: m.merchantData?.vote_count || null,
          serviceHours: m.merchantData?.service_hours?.displayedHours || '',
        }));

        window.postMessage(
          { type: 'SE_GRABFOOD_RECOMMENDED_DATA', merchants },
          '*'
        );

        console.log(
          `[SE-GrabFood-Interceptor] Captured ${merchants.length} merchants from recommended response`
        );
      } catch {
        // Response clone/parse failed, non-critical
      }
    }

    return response;
  };

  // Note: Do NOT clean the hash from the URL here. The service worker
  // may reload the page (geolocation override), and the hash must persist
  // so the interceptor works on the second load too.

  console.log('[SE-GrabFood-Interceptor] Fetch interceptor installed.');
})();
