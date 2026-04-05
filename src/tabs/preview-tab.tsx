import { useState, useEffect, useMemo } from 'react';
import { Search, Database, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, FileJson, Upload, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { PLATFORMS, MERCHANT_FIELDS, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { sendMessage } from '@/hooks/use-chrome-message';
import type { Merchant } from '@/lib/types';

const PAGE_SIZE = 50;

export function PreviewTab() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [platform, setPlatform] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const data = await storage.getMerchants();
    setMerchants(data);
  }

  function exportExcel(data: Merchant[]) {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `se-merchants-${timestamp}.xlsx`;
    const wb = XLSX.utils.book_new();
    const byPlatform: Record<string, Merchant[]> = {};

    for (const m of data) {
      const key = m.platform || 'unknown';
      if (!byPlatform[key]) byPlatform[key] = [];
      byPlatform[key]!.push(m);
    }

    for (const [p, items] of Object.entries(byPlatform)) {
      const sheetData = items.map((m) => {
        const row: Record<string, unknown> = {};
        for (const field of MERCHANT_FIELDS) row[field] = (m as Record<string, unknown>)[field] ?? '';
        return row;
      });
      const ws = XLSX.utils.json_to_sheet(sheetData, { header: MERCHANT_FIELDS });
      XLSX.utils.book_append_sheet(wb, ws, (PLATFORMS[p]?.name || p).slice(0, 31));
    }

    const allData = data.map((m) => {
      const row: Record<string, unknown> = {};
      for (const field of MERCHANT_FIELDS) row[field] = (m as Record<string, unknown>)[field] ?? '';
      return row;
    });
    const wsAll = XLSX.utils.json_to_sheet(allData, { header: MERCHANT_FIELDS });
    XLSX.utils.book_append_sheet(wb, wsAll, 'Semua Platform');
    XLSX.writeFile(wb, filename);
  }

  async function exportData(format: string) {
    const data = await storage.getMerchants();
    if (!data.length) { alert('Tidak ada data untuk diekspor.'); return; }
    if (format === 'excel') { exportExcel(data); return; }
    await sendMessage({ action: 'export', format, merchants: data });
  }

  async function submitToApi() {
    const apiUrl = await storage.get<string>(STORAGE_KEYS.apiUrl);
    if (!apiUrl) { alert('API URL belum dikonfigurasi. Buka tab Pengaturan.'); return; }
    const data = await storage.getMerchants();
    if (!data.length) { alert('Tidak ada data untuk dikirim.'); return; }

    setSyncing(true);

    const groups: Record<string, { platform: string; regionCode: string; regionName: string; provinceCode: string; provinceName: string; merchants: Record<string, unknown>[] }> = {};
    for (const m of data) {
      const p = m.platform || 'unknown';
      // Group by regency when available, otherwise by province
      const regionCode = m.regencyCode || m.provinceCode || '';
      const regionName = m.regencyName || m.provinceName || '';
      // Use regencyName in key to separate merchants from different regencies
      // even when regencyCode is missing (e.g. province-level scrape)
      const key = `${p}||${regionCode}||${m.regencyName || ''}`;
      if (!groups[key]) {
        groups[key] = { platform: p, regionCode, regionName, provinceCode: m.provinceCode || '', provinceName: m.provinceName || '', merchants: [] as Record<string, unknown>[] };
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

    setSyncing(false);

    if (errors.length > 0) {
      alert(`Sebagian gagal:\n${errors.join('\n')}\n\nBerhasil: ${totalAdded}`);
    } else {
      alert(`Berhasil dikirim! Ditambahkan: ${totalAdded}${totalSkipped > 0 ? `\nDuplikat: ${totalSkipped}` : ''}`);
    }
  }

  const platformSet = useMemo(
    () => [...new Set(merchants.map((m) => m.platform))],
    [merchants],
  );

  const filtered = useMemo(() => {
    let data = merchants;
    if (platform !== 'all') {
      data = data.filter((m) => m.platform === platform);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(
        (m) =>
          (m.merchantName || '').toLowerCase().includes(q) ||
          (m.address || '').toLowerCase().includes(q) ||
          (m.category || '').toLowerCase().includes(q) ||
          (m.provinceName || '').toLowerCase().includes(q) ||
          (m.regencyName || '').toLowerCase().includes(q),
      );
    }
    return data;
  }, [merchants, platform, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = filtered.slice(start, start + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [platform, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Preview Data</h1>
        <p className="text-sm text-gray-500">
          Lihat data merchant yang sudah di-scrape
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-se-orange-100">
              <Database className="h-4 w-4 text-se-orange-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total Merchant</p>
              <p className="text-lg font-bold text-gray-900">
                {merchants.length.toLocaleString('id-ID')}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-se-gold-100">
              <Database className="h-4 w-4 text-se-gold-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Platform</p>
              <p className="text-lg font-bold text-gray-900">
                {platformSet.length}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Export & Sync */}
      {merchants.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
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
            <Button
              onClick={submitToApi}
              disabled={syncing}
              className="w-full bg-se-orange-500 hover:bg-se-orange-600 text-white"
              size="sm"
            >
              {syncing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-1.5" />
              )}
              {syncing ? 'Mengirim...' : 'Kirim ke Server'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-[180px] h-9 bg-white">
            <SelectValue placeholder="Semua Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Platform</SelectItem>
            {platformSet.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORMS[p]?.name ?? p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari merchant..."
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Database className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-500">
              {merchants.length === 0
                ? 'Belum ada data merchant'
                : 'Tidak ada hasil untuk filter ini'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {merchants.length === 0
                ? 'Mulai scraping untuk mengumpulkan data.'
                : 'Coba ubah kata kunci atau filter platform.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-24">Platform</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Wilayah</TableHead>
                    <TableHead className="w-28">Kategori</TableHead>
                    <TableHead className="w-16 text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageData.map((m, i) => {
                    const region = [m.regencyName, m.provinceName]
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <TableRow key={`${m.platform}-${m.merchantId}-${i}`}>
                        <TableCell className="text-xs text-gray-400">
                          {start + i + 1}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  PLATFORMS[m.platform]?.color ?? '#888',
                              }}
                            />
                            {PLATFORMS[m.platform]?.name ?? m.platform}
                          </span>
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate text-sm"
                          title={m.merchantName}
                        >
                          {m.merchantName || '-'}
                        </TableCell>
                        <TableCell
                          className="max-w-[160px] truncate text-sm text-gray-500"
                          title={region || m.address}
                        >
                          {region || m.address || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 truncate">
                          {m.category || '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {m.rating ?? '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-xs text-gray-500">
              {filtered.length.toLocaleString('id-ID')} merchant
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-600">
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
