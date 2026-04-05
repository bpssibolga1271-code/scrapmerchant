/**
 * SE Merchant Scraper — Options Page
 *
 * Settings management: API URL configuration and data cleanup.
 */

(function () {
  'use strict';

  const inputApiUrl = document.getElementById('input-api-url');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnSave = document.getElementById('btn-save');
  const statusMessage = document.getElementById('status-message');
  const btnClearRegions = document.getElementById('btn-clear-regions');
  const btnClearData = document.getElementById('btn-clear-data');
  const inputKeywords = document.getElementById('input-keywords');
  const btnSaveKeywords = document.getElementById('btn-save-keywords');
  const btnResetKeywords = document.getElementById('btn-reset-keywords');
  const keywordsStatusMessage = document.getElementById('keywords-status-message');

  /**
   * Show a status message with the given type.
   * @param {string} text
   * @param {'success'|'error'|'info'} type
   */
  function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-message status-message--${type}`;
    statusMessage.classList.remove('hidden');

    setTimeout(() => {
      statusMessage.classList.add('hidden');
    }, 4000);
  }

  /**
   * Show a status message on a specific element.
   * @param {HTMLElement} el
   * @param {string} text
   * @param {'success'|'error'|'info'} type
   */
  function showStatusOn(el, text, type) {
    el.textContent = text;
    el.className = `status-message status-message--${type}`;
    el.classList.remove('hidden');

    setTimeout(() => {
      el.classList.add('hidden');
    }, 4000);
  }

  /**
   * Load saved settings into the form.
   */
  async function loadSettings() {
    const apiUrl = await StorageHelper.get(STORAGE_KEYS.apiUrl);
    if (apiUrl) {
      inputApiUrl.value = apiUrl;
    }

    const keywords = await StorageHelper.get(STORAGE_KEYS.searchKeywords);
    const list = Array.isArray(keywords) && keywords.length > 0
      ? keywords
      : DEFAULT_SEARCH_KEYWORDS;
    inputKeywords.value = list.join('\n');
  }

  /**
   * Save the API URL to storage.
   */
  async function saveSettings() {
    const apiUrl = inputApiUrl.value.trim();

    if (apiUrl && !isValidUrl(apiUrl)) {
      showStatus('URL tidak valid.', 'error');
      return;
    }

    await StorageHelper.set(STORAGE_KEYS.apiUrl, apiUrl);
    showStatus('Pengaturan berhasil disimpan.', 'success');
  }

  /**
   * Test connection to the configured API URL.
   */
  async function testConnection() {
    const apiUrl = inputApiUrl.value.trim();

    if (!apiUrl) {
      showStatus('Masukkan API URL terlebih dahulu.', 'error');
      return;
    }

    if (!isValidUrl(apiUrl)) {
      showStatus('URL tidak valid.', 'error');
      return;
    }

    btnTestConnection.disabled = true;
    btnTestConnection.textContent = 'Testing...';

    try {
      const response = await fetch(apiUrl, {
        method: 'HEAD',
        headers: { 'X-Extension-Source': 'se-merchant-scraper' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      showStatus('Koneksi berhasil! Server dapat dijangkau.', 'success');
    } catch (err) {
      showStatus(`Koneksi gagal: ${err.message}`, 'error');
    } finally {
      btnTestConnection.disabled = false;
      btnTestConnection.textContent = 'Test Connection';
    }
  }

  /**
   * Clear the cached region data.
   */
  async function clearRegionsCache() {
    if (!confirm('Hapus semua cache data wilayah?')) return;

    await StorageHelper.set(STORAGE_KEYS.regionsCache, {});
    showStatus('Cache wilayah berhasil dihapus.', 'success');
  }

  /**
   * Clear all scraped merchant data.
   */
  async function clearScrapedData() {
    if (!confirm('Hapus semua data merchant yang sudah di-scrape?')) return;

    await StorageHelper.clearMerchants();
    showStatus('Data scraping berhasil dihapus.', 'success');
  }

  /**
   * Simple URL validation.
   * @param {string} str
   * @returns {boolean}
   */
  function isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Save the search keywords to storage.
   */
  async function saveKeywords() {
    const raw = inputKeywords.value.trim();
    const keywords = raw
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);

    if (keywords.length === 0) {
      showStatusOn(keywordsStatusMessage, 'Masukkan minimal satu kata kunci.', 'error');
      return;
    }

    await StorageHelper.set(STORAGE_KEYS.searchKeywords, keywords);
    showStatusOn(keywordsStatusMessage, `${keywords.length} kata kunci berhasil disimpan.`, 'success');
  }

  /**
   * Reset search keywords to default values.
   */
  async function resetKeywords() {
    inputKeywords.value = DEFAULT_SEARCH_KEYWORDS.join('\n');
    await StorageHelper.set(STORAGE_KEYS.searchKeywords, DEFAULT_SEARCH_KEYWORDS);
    showStatusOn(keywordsStatusMessage, 'Kata kunci direset ke default.', 'info');
  }

  // ── Event Listeners ─────────────────────────────────────────

  btnSave.addEventListener('click', saveSettings);
  btnTestConnection.addEventListener('click', testConnection);
  btnClearRegions.addEventListener('click', clearRegionsCache);
  btnClearData.addEventListener('click', clearScrapedData);
  btnSaveKeywords.addEventListener('click', saveKeywords);
  btnResetKeywords.addEventListener('click', resetKeywords);

  // ── Init ────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', loadSettings);
})();
