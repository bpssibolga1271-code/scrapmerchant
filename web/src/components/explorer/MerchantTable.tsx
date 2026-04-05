'use client';

import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type PaginationState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface MerchantRow {
  id: number;
  name: string;
  platform: string;
  category: string | null;
  rating: number | null;
  productCount: number | null;
  monthlySales: number | null;
  createdAt: string;
  region: {
    id: number;
    code: string;
    name: string;
    level: string;
  } | null;
}

interface MerchantTableProps {
  data: MerchantRow[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onSortChange: (sortField: string, sortOrder: 'asc' | 'desc') => void;
  onRowClick: (merchant: MerchantRow) => void;
  isLoading: boolean;
}

const columnHelper = createColumnHelper<MerchantRow>();

export default function MerchantTable({
  data,
  total,
  page,
  limit,
  onPageChange,
  onLimitChange,
  onSortChange,
  onRowClick,
  isLoading,
}: MerchantTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Nama',
        cell: (info) => (
          <span className="font-medium text-gray-900">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('platform', {
        header: 'Platform',
        cell: (info) => (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium capitalize text-amber-700">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.region?.name ?? '-', {
        id: 'region',
        header: 'Wilayah',
        cell: (info) => (
          <span className="text-gray-600">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('category', {
        header: 'Kategori',
        cell: (info) => (
          <span className="text-gray-600">{info.getValue() ?? '-'}</span>
        ),
      }),
      columnHelper.accessor('rating', {
        header: 'Rating',
        cell: (info) => {
          const val = info.getValue();
          if (val == null) return <span className="text-gray-400">-</span>;
          return (
            <span className="text-gray-900">
              {val.toFixed(1)}
            </span>
          );
        },
      }),
      columnHelper.accessor('productCount', {
        header: 'Produk',
        cell: (info) => {
          const val = info.getValue();
          if (val == null) return <span className="text-gray-400">-</span>;
          return <span className="text-gray-900">{val.toLocaleString()}</span>;
        },
      }),
      columnHelper.accessor('monthlySales', {
        header: 'Penjualan',
        cell: (info) => {
          const val = info.getValue();
          if (val == null) return <span className="text-gray-400">-</span>;
          return <span className="text-gray-900">{val.toLocaleString()}</span>;
        },
      }),
      columnHelper.accessor('createdAt', {
        header: 'Waktu Scraping',
        cell: (info) => {
          const date = new Date(info.getValue());
          return (
            <span className="text-gray-600 tabular-nums">
              {date.toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          );
        },
      }),
    ],
    [],
  );

  const pagination: PaginationState = useMemo(
    () => ({
      pageIndex: page - 1,
      pageSize: limit,
    }),
    [page, limit],
  );

  const pageCount = Math.ceil(total / limit);

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(newSorting);
      if (newSorting.length > 0) {
        onSortChange(
          newSorting[0].id,
          newSorting[0].desc ? 'desc' : 'asc',
        );
      }
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  const totalPages = Math.max(1, pageCount);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className="cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      <span className="text-gray-400">
                        {{
                          asc: ' \u2191',
                          desc: ' \u2193',
                        }[header.column.getIsSorted() as string] ?? ''}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-gray-100 bg-white">
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="h-5 w-5 animate-spin text-amber-600"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Memuat merchant...
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-gray-500"
                >
                  Data tidak ditemukan. Coba sesuaikan filter Anda.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                  onClick={() => onRowClick(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-4 py-3 text-sm"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>
            Showing {data.length === 0 ? 0 : (page - 1) * limit + 1} -{' '}
            {Math.min(page * limit, total)} of {total.toLocaleString()}{' '}
            merchant
          </span>
          <Select value={String(limit)} onValueChange={(val) => { if (val) { onLimitChange(Number(val)); onPageChange(1); } }}>
            <SelectTrigger className="w-30">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}/halaman
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Awal
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sblm
          </button>
          <span className="px-3 py-1 text-sm text-gray-700">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Brkt
          </button>
          <button
            type="button"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Akhir
          </button>
        </div>
      </div>
    </div>
  );
}
