/// <reference types="vite/client" />

declare const XLSX: {
  utils: {
    book_new: () => unknown;
    json_to_sheet: (data: Record<string, unknown>[], opts?: { header: readonly string[] }) => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  writeFile: (wb: unknown, filename: string) => void;
};
