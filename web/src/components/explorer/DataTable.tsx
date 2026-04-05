'use client';

import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';

interface DataTableProps {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'bigint') return val.toLocaleString();
  return String(val);
}

export default function DataTable({ columns: rawColumns, rows, rowCount }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns: ColumnDef<Record<string, unknown>>[] = rawColumns.map((col) => ({
    accessorKey: col.name,
    header: ({ column }) => (
      <button
        className="flex items-center gap-1 font-semibold hover:text-amber-700"
        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      >
        {col.name}
        <span className="text-gray-400">
          {column.getIsSorted() === 'asc' ? '↑' : column.getIsSorted() === 'desc' ? '↓' : '↕'}
        </span>
      </button>
    ),
    cell: ({ getValue }) => (
      <span className="max-w-60 truncate block">{formatValue(getValue())}</span>
    ),
  }));

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 50 },
    },
  });

  return (
    <div>
      <div>
        <Table containerClassName="max-h-[500px]">
          <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e5e7eb]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-xs border-x border-gray-200 first:border-l-0 last:border-r-0">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-gray-400">
                  Tidak ada hasil
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-xs border-x border-gray-200 first:border-l-0 last:border-r-0">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t bg-gray-50/50 px-4 py-2">
        <span className="text-xs text-gray-500">
          {rowCount.toLocaleString()} total baris
          {table.getPageCount() > 1 && ` · Halaman ${table.getState().pagination.pageIndex + 1} of ${table.getPageCount()}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Berikutnya
          </Button>
        </div>
      </div>
    </div>
  );
}
