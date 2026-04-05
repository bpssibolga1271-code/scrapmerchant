/**
 * SE Merchant Scraper — Storage Helper
 *
 * Async wrapper around chrome.storage.local for managing
 * regions cache, scraped merchant data, and settings.
 */

const StorageHelper = {
  /**
   * Get a value from chrome.storage.local.
   * @param {string} key
   * @returns {Promise<*>}
   */
  async get(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },

  /**
   * Set a value in chrome.storage.local.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },

  /**
   * Store merchants for a given platform and region code.
   * Replaces any existing data for the same platform+regionCode
   * combination to prevent duplicates on re-scrape.
   * Data is stored as: { scraped_data: { [platform]: { [regionCode]: [...merchants] } } }
   * @param {string} platform
   * @param {string} regionCode
   * @param {Array<Object>} merchants
   * @returns {Promise<void>}
   */
  async appendMerchants(platform, regionCode, merchants) {
    const data = (await this.get(STORAGE_KEYS.scrapedData)) || {};

    if (!data[platform]) {
      data[platform] = {};
    }

    data[platform][regionCode] = merchants;

    await this.set(STORAGE_KEYS.scrapedData, data);
  },

  /**
   * Get merchants, optionally filtered by platform and region code.
   * @param {string} [platform] — filter by platform key
   * @param {string} [regionCode] — filter by region code
   * @returns {Promise<Array<Object>>}
   */
  async getMerchants(platform, regionCode) {
    const data = (await this.get(STORAGE_KEYS.scrapedData)) || {};
    const results = [];

    const platforms = platform ? [platform] : Object.keys(data);

    for (const p of platforms) {
      if (!data[p]) continue;

      const regions = regionCode ? [regionCode] : Object.keys(data[p]);

      for (const r of regions) {
        if (!data[p][r]) continue;
        results.push(...data[p][r]);
      }
    }

    return results;
  },

  /**
   * Clear all scraped merchant data.
   * @returns {Promise<void>}
   */
  async clearMerchants() {
    await this.set(STORAGE_KEYS.scrapedData, {});
  },
};
