import { useState, useEffect, useCallback } from 'react';
import { Play, Square, FileSpreadsheet, FileText, FileJson, Upload, RotateCcw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RegionCombobox } from '@/components/region-combobox';
import { PlatformGrid } from '@/components/platform-grid';
import { ScrapeProgress } from '@/components/scrape-progress';
import { useBpsRegions } from '@/hooks/use-bps-regions';
import { useChromeMessage, sendMessage } from '@/hooks/use-chrome-message';
import { storage } from '@/lib/storage';
import { PLATFORMS, MERCHANT_FIELDS, STORAGE_KEYS } from '@/lib/constants';
import type { Merchant, ScrapeState, RegionSelection } from '@/lib/types';

interface ScraperTabProps {
  onStatusChange: (status: 'idle' | 'processing' | 'done') => void;
  onDataChange: () => void;
}

export function ScraperTab({ onStatusChange, onDataChange }: ScraperTabProps) {
  const { provinces, regencies, districts, loadProvinces, loadRegencies, loadDistricts } = useBpsRegions();

  const [region, setRegion] = useState<RegionSelection>({ province: null, regency: null, district: null });
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [uiState, setUiState] = useState<'idle' | 'processing' | 'done'>('idle');
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPlatforms, setProgressPlatforms] = useState<string[]>([]);
  const [progressIndex, setProgressIndex] = useState(0);
  const [captcha, setCaptcha] = useState(false);
  const [results, setResults] = useState<Record<string, Merchant[]>>({});

  useEffect(() => {
    loadProvinces();
    restoreScrapeState();
  }, [loadProvinces]);

  async function restoreScrapeState() {
    try {
      const state = await sendMessage<ScrapeState>({ action: 'getScrapeState' });
      if (!state || state.status === 'idle') return;
      if (state.status === 'running') {
        setUiState('processing');
        onStatusChange('processing');
        handleProgress(state);
      } else if (state.status === 'done') {
        setUiState('done');
        onStatusChange('done');
        setProgressPlatforms(state.platforms || []);
        setResults(state.results || {});
        await sendMessage({ action: 'resetScrapeState' });
      }
    } catch {}
  }

  function handleProgress(state: ScrapeState) {
    if (!state.platforms) return;
    const total = state.platforms.length;
    const idx = state.currentIndex || 0;

    if (state.status === 'running') {
      setUiState('processing');
      onStatusChange('processing');
      const current = state.platforms[idx];
      if (current) {
        setProgressLabel(`Scraping ${PLATFORMS[current]?.name ?? current}... (${idx + 1}/${total})`);
      }
      setProgressPlatforms(state.platforms);
      setProgressIndex(idx);
    } else if (state.status === 'done') {
      setUiState('done');
      onStatusChange('done');
      setProgressPlatforms(state.platforms);
      setProgressIndex(total);
      setResults(state.results || {});
      onDataChange();
    }
  }

  const messageHandler = useCallback((message: Record<string, unknown>) => {
    if (message.action === 'scrapeProgress') {
      handleProgress(message.state as ScrapeState);
    }
    if (message.type === 'captcha') {
      setCaptcha(true);
      setProgressLabel(
        (message.message as string) || 'CAPTCHA terdeteksi',
      );
    }
    if (message.type === 'captchaResolved') {
      setCaptcha(false);
    }
  }, []);

  useChromeMessage(messageHandler);

  async function startScraping() {
    if (!selectedPlatforms.length || !region.province) return;

    setUiState('processing');
    onStatusChange('processing');
    setProgressLabel(`Scraping ${PLATFORMS[selectedPlatforms[0]!]?.name ?? selectedPlatforms[0]}...`);
    setProgressPlatforms(selectedPlatforms);
    setProgressIndex(0);

    try {
      const state = await sendMessage<ScrapeState>({
        action: 'scrapeAll',
        platforms: selectedPlatforms,
        region,
      });

      if (state?.status === 'done') {
        setUiState('done');
        onStatusChange('done');
        setProgressPlatforms(state.platforms || []);
        setResults(state.results || {});
        onDataChange();
      }
    } catch (err) {
      console.error('scrapeAll error:', err);
      setProgressLabel('Terjadi kesalahan.');
      setUiState('idle');
      onStatusChange('idle');
    }
  }

  function resetToIdle() {
    setUiState('idle');
    onStatusChange('idle');
    setResults({});
    setCaptcha(false);
  }

  function exportExcel(merchants: Merchant[]) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `se-merchants-${timestamp}.xlsx`;
    const wb = XLSX.utils.book_new();
    const byPlatform: Record<string, Merchant[]> = {};

    for (const m of merchants) {
      const key = m.platform || 'unknown';
      if (!byPlatform[key]) byPlatform[key] = [];
      byPlatform[key]!.push(m);
    }

    for (const [platform, items] of Object.entries(byPlatform)) {
      const sheetData = items.map((m) => {
        const row: Record<string, unknown> = {};
        for (const field of MERCHANT_FIELDS) row[field] = (m as Record<string, unknown>)[field] ?? '';
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(sheetData, { header: MERCHANT_FIELDS });
      XLSX.utils.book_append_sheet(wb, ws, (PLATFORMS[platform]?.name || platform).slice(0, 31));
    }

    const allData = merchants.map((m) => {
      const row: Record<string, unknown> = {};
      for (const field of MERCHANT_FIELDS) row[field] = (m as Record<string, unknown>)[field] ?? '';
      return row;
    });
    const wsAll = XLSX.utils.json_to_sheet(allData, { header: MERCHANT_FIELDS });
    XLSX.utils.book_append_sheet(wb, wsAll, 'Semua Platform');
    XLSX.writeFile(wb, filename);
  }

  async function exportData(format: string) {
    const merchants = await storage.getMerchants();
    if (!merchants.length) { alert('Tidak ada data untuk diekspor.'); return; }
    if (format === 'excel') { exportExcel(merchants); return; }
    await sendMessage({ action: 'export', format, merchants });
  }

  async function submitToApi() {
    const apiUrl = await storage.get<string>(STORAGE_KEYS.apiUrl);
    if (!apiUrl) { alert('API URL belum dikonfigurasi. Buka tab Pengaturan.'); return; }
    const merchants = await storage.getMerchants();
    if (!merchants.length) { alert('Tidak ada data untuk dikirim.'); return; }

    const groups: Record<string, { platform: string; regionCode: string; regionName: string; provinceCode: string; provinceName: string; merchants: Record<string, unknown>[] }> = {};
    for (const m of merchants) {
      const platform = m.platform || 'unknown';
      const regionCode = m.regencyCode || m.provinceCode || '';
      const regionName = m.regencyName || m.provinceName || '';
      const key = `${platform}||${regionCode}||${m.regencyName || ''}`;
      if (!groups[key]) {
        groups[key] = { platform, regionCode, regionName, provinceCode: m.provinceCode || '', provinceName: m.provinceName || '', merchants: [] };
      }
      groups[key]!.merchants.push({
        name: m.merchantName || '', address: m.address || undefined,
        category: m.category || undefined, phone: m.phone || undefined,
        rating: m.rating ? parseFloat(String(m.rating)) : undefined,
        productCount: m.totalProducts ? parseInt(String(m.totalProducts), 10) : undefined,
        joinDate: m.joinDate || undefined, sourceUrl: m.merchantUrl || undefined,
      });
    }

    let totalAdded = 0, totalSkipped = 0;
    const errors: string[] = [];

    for (const group of Object.values(groups)) {
      if (!group.regionCode) { errors.push(`${group.platform}: regionCode kosong`); continue; }
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Extension-Source': 'se-merchant-scraper' },
          body: JSON.stringify(group),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          errors.push(`${group.platform}: ${result.error || `HTTP ${response.status}`}`);
        } else {
          const result = await response.json();
          totalAdded += result.count || 0;
          totalSkipped += result.skipped || 0;
        }
      } catch (err) { errors.push(`${group.platform}: ${err}`); }
    }

    if (errors.length > 0) {
      alert(`Sebagian gagal:\n${errors.join('\n')}\n\nBerhasil: ${totalAdded}`);
    } else {
      alert(`Berhasil dikirim! Ditambahkan: ${totalAdded}${totalSkipped > 0 ? `\nDuplikat: ${totalSkipped}` : ''}`);
    }
  }

  const canStart = selectedPlatforms.length > 0 && region.province !== null && uiState === 'idle';
  const grandTotal = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Merchant Scraper</h1>
        <p className="text-sm text-gray-500">Kumpulkan data merchant dari platform e-commerce Indonesia</p>
      </div>

      {/* Region Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Wilayah</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <RegionCombobox
            label="Provinsi"
            placeholder="Pilih Provinsi"
            regions={provinces}
            value={region.province?.code || ''}
            onChange={(code, name) => {
              setRegion({ province: { code, name }, regency: null, district: null });
              loadRegencies(code);
            }}
            disabled={uiState !== 'idle'}
          />
          <RegionCombobox
            label="Kabupaten / Kota"
            placeholder="Pilih Kab/Kota"
            regions={regencies}
            value={region.regency?.code || ''}
            onChange={(code, name) => {
              setRegion((prev) => ({ ...prev, regency: { code, name }, district: null }));
              loadDistricts(code);
            }}
            disabled={uiState !== 'idle'}
          />
          <RegionCombobox
            label="Kecamatan"
            placeholder="Pilih Kecamatan"
            regions={districts}
            value={region.district?.code || ''}
            onChange={(code, name) => {
              setRegion((prev) => ({ ...prev, district: { code, name } }));
            }}
            disabled={uiState !== 'idle'}
          />
        </CardContent>
      </Card>

      {/* Platform Selection */}
      <Card>
        <CardContent className="pt-4">
          <PlatformGrid
            selected={selectedPlatforms}
            onChange={setSelectedPlatforms}
            disabled={uiState !== 'idle'}
          />
        </CardContent>
      </Card>

      {/* Start Button */}
      {uiState === 'idle' && (
        <Button
          onClick={startScraping}
          disabled={!canStart}
          className="w-full bg-se-orange-500 hover:bg-se-orange-600 text-white"
          size="lg"
        >
          <Play className="w-4 h-4 mr-2" />
          Mulai Scraping
        </Button>
      )}

      {/* Progress */}
      {uiState === 'processing' && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <ScrapeProgress
              platforms={progressPlatforms}
              currentIndex={progressIndex}
              label={progressLabel}
              done={false}
              captcha={captcha}
            />
            <Button
              onClick={async () => {
                await sendMessage({ action: 'stopScrape' });
                setUiState('done');
                onStatusChange('done');
              }}
              variant="destructive"
              className="w-full"
              size="sm"
            >
              <Square className="w-4 h-4 mr-2" />
              Hentikan Scraping
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {uiState === 'done' && (
        <>
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="text-sm font-semibold">Scraping selesai! Data siap diekspor.</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1.5 font-medium text-gray-500">Platform</th>
                    <th className="text-right py-1.5 font-medium text-gray-500">Merchant</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(results).map(([platform, merchants]) => (
                    <tr key={platform} className="border-b border-gray-100">
                      <td className="py-1.5">{PLATFORMS[platform]?.name ?? platform}</td>
                      <td className="text-right py-1.5 font-medium">{merchants.length.toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-sm font-semibold text-right">
                Total: {grandTotal.toLocaleString('id-ID')} merchant
              </div>
            </CardContent>
          </Card>

          {/* Export */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Ekspor Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={() => exportData('excel')}>
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportData('csv')}>
                  <FileText className="w-4 h-4 mr-1.5" /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => exportData('json')}>
                  <FileJson className="w-4 h-4 mr-1.5" /> JSON
                </Button>
              </div>
              <Button onClick={submitToApi} className="w-full bg-se-orange-500 hover:bg-se-orange-600 text-white" size="sm">
                <Upload className="w-4 h-4 mr-1.5" /> Kirim ke Server
              </Button>
              <Button onClick={resetToIdle} variant="ghost" className="w-full" size="sm">
                <RotateCcw className="w-4 h-4 mr-1.5" /> Scraping Baru
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
