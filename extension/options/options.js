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
   * Load saved settings into the form.
   */
  async function loadSettings() {
    const apiUrl = await StorageHelper.get(STORAGE_KEYS.apiUrl);
    if (apiUrl) {
      inputApiUrl.value = apiUrl;
    }
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

  // ── Event Listeners ─────────────────────────────────────────

  btnSave.addEventListener('click', saveSettings);
  btnTestConnection.addEventListener('click', testConnection);
  btnClearRegions.addEventListener('click', clearRegionsCache);
  btnClearData.addEventListener('click', clearScrapedData);

  // ── Init ────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', loadSettings);
})();
