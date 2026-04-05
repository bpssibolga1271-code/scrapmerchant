'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PLATFORMS = [
  { value: 'tokopedia', label: 'Tokopedia' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'grabfood', label: 'GrabFood' },
  { value: 'gofood', label: 'GoFood' },
  { value: 'lazada', label: 'Lazada' },
  { value: 'blibli', label: 'Blibli' },
];

interface DeleteButtonProps {
  onDeleteComplete: () => void;
}

export default function DeleteButton({ onDeleteComplete }: DeleteButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [platform, setPlatform] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deleteAll, setDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [result, setResult] = useState('');

  function resetState() {
    setPlatform('');
    setRegionCode('');
    setDateFrom('');
    setDateTo('');
    setDeleteAll(false);
    setResult('');
  }

  function handleClose() {
    setIsOpen(false);
    resetState();
  }

  function getFilterSummary(): string {
    if (deleteAll) return 'ALL merchants (entire database)';
    const parts: string[] = [];
    if (platform) parts.push(`platform: ${platform}`);
    if (regionCode) parts.push(`region: ${regionCode}`);
    if (dateFrom) parts.push(`from: ${dateFrom}`);
    if (dateTo) parts.push(`to: ${dateTo}`);
    return parts.length > 0 ? parts.join(', ') : 'No filters selected';
  }

  function handleDeleteClick() {
    if (!deleteAll && !platform && !regionCode && !dateFrom && !dateTo) {
      setResult('Select at least one filter or use "Delete All".');
      return;
    }
    setResult('');
    setShowConfirm(true);
  }

  async function handleConfirmDelete() {
    setShowConfirm(false);
    setIsDeleting(true);
    setResult('');

    try {
      const params = new URLSearchParams();
      if (deleteAll) params.set('all', 'true');
      if (platform) params.set('platform', platform);
      if (regionCode) params.set('regionCode', regionCode);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`/api/merchants?${params}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (!res.ok) {
        setResult(`Error: ${data.error}`);
        return;
      }

      setResult(`Deleted ${data.deleted} merchants.`);
      onDeleteComplete();
    } catch (err) {
      console.error('Delete error:', err);
      setResult('An error occurred during deletion.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring h-8 px-3 border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          Hapus
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hapus Merchant</DialogTitle>
            <DialogDescription>
              Hapus semua atau filter berdasarkan platform, wilayah, atau rentang tanggal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Delete All toggle */}
            <label className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteAll}
                onChange={(e) => {
                  setDeleteAll(e.target.checked);
                  if (e.target.checked) {
                    setPlatform('');
                    setRegionCode('');
                    setDateFrom('');
                    setDateTo('');
                  }
                }}
                className="h-4 w-4 rounded border-red-300 text-red-600 accent-red-600"
              />
              <div>
                <p className="text-sm font-medium text-red-800">Hapus SEMUA data</p>
                <p className="text-xs text-red-600">Hapus semua merchant dari database</p>
              </div>
            </label>

            {/* Filters (disabled when deleteAll) */}
            <fieldset disabled={deleteAll} className={deleteAll ? 'opacity-40' : ''}>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Platform</label>
                  <Select value={platform} onValueChange={(v) => setPlatform(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Semua platform" />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Kode Wilayah</label>
                  <input
                    type="text"
                    value={regionCode}
                    onChange={(e) => setRegionCode(e.target.value)}
                    placeholder="e.g. 31"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Dari</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Sampai</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Active filters summary */}
            {(deleteAll || platform || regionCode || dateFrom || dateTo) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500">Akan menghapus:</span>
                {deleteAll && <Badge variant="destructive">ALL</Badge>}
                {platform && !deleteAll && <Badge variant="secondary">{platform}</Badge>}
                {regionCode && !deleteAll && <Badge variant="secondary">region: {regionCode}</Badge>}
                {dateFrom && !deleteAll && <Badge variant="secondary">from: {dateFrom}</Badge>}
                {dateTo && !deleteAll && <Badge variant="secondary">to: {dateTo}</Badge>}
              </div>
            )}

            {/* Result message */}
            {result && (
              <p className={`text-sm ${result.startsWith('Error') || result.startsWith('Select') ? 'text-red-600' : 'text-green-600'}`}>
                {result}
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Batal
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteClick}
                disabled={isDeleting}
              >
                {isDeleting ? 'Menghapus...' : 'Hapus'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apakah Anda yakin?</AlertDialogTitle>
            <AlertDialogDescription>
              Ini akan menghapus permanen merchant yang cocok dengan: <strong>{getFilterSummary()}</strong>.
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Ya, hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
