/**
 * Export query results as CSV or Excel (XLSX via HTML table).
 */

interface Column {
  name: string;
  type: string;
}

function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsv(
  columns: Column[],
  rows: Record<string, unknown>[],
  filename = 'query-results.csv',
) {
  const header = columns.map((c) => escapeCsvValue(c.name)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvValue(row[c.name])).join(','),
  );
  const csv = [header, ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function escapeHtml(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function downloadExcel(
  columns: Column[],
  rows: Record<string, unknown>[],
  filename = 'query-results.xlsx',
) {
  const headerCells = columns
    .map((c) => `<th style="background:#f5f5f4;font-weight:bold;border:1px solid #ccc;padding:4px 8px">${escapeHtml(c.name)}</th>`)
    .join('');

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const val = row[c.name];
          const display = typeof val === 'bigint' ? Number(val) : val;
          return `<td style="border:1px solid #ccc;padding:4px 8px">${escapeHtml(display)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"></head>
    <body><table>${headerCells}${bodyRows}</table></body>
    </html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
