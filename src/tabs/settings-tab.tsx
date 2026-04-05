import { useState, useEffect } from 'react';
import { Trash2, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeywordTags } from '@/components/keyword-tags';
import { storage } from '@/lib/storage';
import { STORAGE_KEYS, DEFAULT_SEARCH_KEYWORDS } from '@/lib/constants';
import { sendMessage } from '@/hooks/use-chrome-message';
import { cn } from '@/lib/utils';

interface SettingsTabProps {
  onDataChange: () => void;
}

type ToastType = 'success' | 'error' | 'info';

function Toast({ message, type }: { message: string; type: ToastType }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs px-3 py-2 rounded-lg mt-2',
        type === 'success' && 'bg-green-50 text-green-700',
        type === 'error' && 'bg-red-50 text-red-700',
        type === 'info' && 'bg-blue-50 text-blue-700',
      )}
    >
      {type === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
      {type === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
      {type === 'info' && <Info className="w-3.5 h-3.5" />}
      {message}
    </div>
  );
}

export function SettingsTab({ onDataChange }: SettingsTabProps) {
  const [apiUrl, setApiUrl] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [apiToast, setApiToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [kwToast, setKwToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [dataToast, setDataToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const url = await storage.get<string>(STORAGE_KEYS.apiUrl);
    if (url) setApiUrl(url);
    const kw = await storage.get<string[]>(STORAGE_KEYS.searchKeywords);
    setKeywords(Array.isArray(kw) && kw.length > 0 ? kw : [...DEFAULT_SEARCH_KEYWORDS]);
  }

  function showToast(setter: typeof setApiToast, message: string, type: ToastType) {
    setter({ message, type });
    setTimeout(() => setter(null), 4000);
  }

  function isValidUrl(str: string) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch { return false; }
  }

  async function saveApiUrl() {
    if (apiUrl && !isValidUrl(apiUrl)) {
      showToast(setApiToast, 'URL tidak valid.', 'error');
      return;
    }
    await storage.set(STORAGE_KEYS.apiUrl, apiUrl.trim());
    showToast(setApiToast, 'Pengaturan berhasil disimpan.', 'success');
  }

  async function testConnection() {
    if (!apiUrl) { showToast(setApiToast, 'Masukkan API URL terlebih dahulu.', 'error'); return; }
    if (!isValidUrl(apiUrl)) { showToast(setApiToast, 'URL tidak valid.', 'error'); return; }

    setTestingConnection(true);
    try {
      const response = await fetch(apiUrl, { method: 'HEAD', headers: { 'X-Extension-Source': 'se-merchant-scraper' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showToast(setApiToast, 'Koneksi berhasil! Server dapat dijangkau.', 'success');
    } catch (err) {
      showToast(setApiToast, `Koneksi gagal: ${err}`, 'error');
    } finally {
      setTestingConnection(false);
    }
  }

  async function saveKeywords() {
    if (keywords.length === 0) {
      showToast(setKwToast, 'Masukkan minimal satu kata kunci.', 'error');
      return;
    }
    await storage.set(STORAGE_KEYS.searchKeywords, keywords);
    showToast(setKwToast, `${keywords.length} kata kunci berhasil disimpan.`, 'success');
  }

  async function resetKeywords() {
    setKeywords([...DEFAULT_SEARCH_KEYWORDS]);
    await storage.set(STORAGE_KEYS.searchKeywords, DEFAULT_SEARCH_KEYWORDS);
    showToast(setKwToast, 'Kata kunci direset ke default.', 'info');
  }

  async function clearRegions() {
    if (!confirm('Hapus semua cache data wilayah?')) return;
    await storage.set(STORAGE_KEYS.regionsCache, {});
    showToast(setDataToast, 'Cache wilayah berhasil dihapus.', 'success');
  }

  async function clearData() {
    if (!confirm('Hapus semua data merchant yang sudah di-scrape?')) return;
    await storage.clearMerchants();
    await sendMessage({ action: 'resetScrapeState' });
    onDataChange();
    showToast(setDataToast, 'Data scraping berhasil dihapus.', 'success');
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Pengaturan</h1>
        <p className="text-sm text-gray-500">Konfigurasi API dan manajemen data</p>
      </div>

      {/* API Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Konfigurasi API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="api-url" className="text-xs">API URL</Label>
            <Input
              id="api-url"
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://example.com/api/merchants"
              className="h-9"
            />
            <p className="text-xs text-gray-400">URL endpoint untuk mengirim data merchant.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={testConnection} disabled={testingConnection}>
              {testingConnection ? 'Testing...' : 'Test Koneksi'}
            </Button>
            <Button size="sm" onClick={saveApiUrl} className="bg-se-orange-500 hover:bg-se-orange-600 text-white">
              Simpan
            </Button>
          </div>
          {apiToast && <Toast {...apiToast} />}
        </CardContent>
      </Card>

      {/* Keywords */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Kata Kunci Pencarian</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeywordTags value={keywords} onChange={setKeywords} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetKeywords}>Reset Default</Button>
            <Button size="sm" onClick={saveKeywords} className="bg-se-orange-500 hover:bg-se-orange-600 text-white">
              Simpan
            </Button>
          </div>
          {kwToast && <Toast {...kwToast} />}
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Manajemen Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-400">Hapus data cache untuk mengosongkan penyimpanan lokal.</p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={clearRegions}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Cache Wilayah
            </Button>
            <Button variant="destructive" size="sm" onClick={clearData}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Data Scraping
            </Button>
          </div>
          {dataToast && <Toast {...dataToast} />}
        </CardContent>
      </Card>
    </div>
  );
}
