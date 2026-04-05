'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDuckDB } from '@/hooks/useDuckDB';
import SqlEditor, { type SqlEditorHandle } from '@/components/explorer/SqlEditor';
import DataTable from '@/components/explorer/DataTable';
function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
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

function downloadCsv(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  filename: string,
) {
  const header = columns.map((c) => escapeCsvValue(c.name)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvValue(row[c.name])).join(','),
  );
  const csv = [header, ...lines].join('\n');
  triggerDownload(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

function escapeHtml(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function downloadExcel(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  filename: string,
) {
  const hdr = columns.map((c) => `<th style="background:#f5f5f4;font-weight:bold;border:1px solid #ccc;padding:4px 8px">${escapeHtml(c.name)}</th>`).join('');
  const body = rows.map((row) => '<tr>' + columns.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px">${escapeHtml(row[c.name])}</td>`).join('') + '</tr>').join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table><tr>${hdr}</tr>${body}</table></body></html>`;
  triggerDownload(new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' }), filename);
}

interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface QueryTab {
  id: string;
  name: string;
  sql: string;
  result: QueryResult | null;
  error: string | null;
  queryTime: number | null;
}

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
}

interface QueryBuilderProps {
  onQueryResult?: (result: QueryResult) => void;
}

const SAVED_QUERIES_KEY = 'se-scraper-saved-queries';
const MAX_TABS = 10;

function loadSavedQueries(): SavedQuery[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_QUERIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSavedQueries(queries: SavedQuery[]) {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries));
}

function formatSql(input: string): string {
  let sql = input.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  sql = sql.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, "'$1'");

  const strings: string[] = [];
  sql = sql.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content) => {
    strings.push(content);
    return `__STR${strings.length - 1}__`;
  });

  const keywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
    'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT',
    'RIGHT', 'INNER', 'OUTER', 'ON', 'AS', 'COUNT', 'SUM', 'AVG', 'MIN',
    'MAX', 'DISTINCT', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'END', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
    'TABLE', 'INTO', 'VALUES', 'SET', 'UNION', 'ALL', 'DESC', 'ASC',
    'REPLACE', 'WITH', 'OVER', 'PARTITION BY', 'CAST',
  ];

  for (const kw of keywords) {
    const parts = kw.split(' ');
    const pattern = parts.length > 1
      ? new RegExp(`\\b${parts.join('\\s+')}\\b`, 'gi')
      : new RegExp(`\\b${kw}\\b`, 'gi');
    sql = sql.replace(pattern, (m) => m.toUpperCase());
  }

  const clauseKeywords = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
    'LIMIT', 'OFFSET', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
    'JOIN', 'UNION ALL', 'UNION',
  ];

  for (const clause of clauseKeywords) {
    const pattern = new RegExp(`(?<!^)\\b(${clause.replace(/ /g, '\\s+')})\\b`, 'gi');
    sql = sql.replace(pattern, '\n$1');
  }

  sql = sql.replace(/__STR(\d+)__/g, (_match, idx) => `'${strings[Number(idx)]}'`);

  return sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

export default function QueryBuilder({ onQueryResult }: QueryBuilderProps) {
  const {
    isReady,
    isLoading,
    recordCount,
    schema,
    sampleQueries,
    error: initError,
    runQuery,
    reload,
  } = useDuckDB();

  const editorRef = useRef<SqlEditorHandle>(null);
  const tabCounter = useRef(1);

  // Tab state
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: '1', name: 'Query 1', sql: 'SELECT * FROM merchants LIMIT 100', result: null, error: null, queryTime: null },
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [isQuerying, setIsQuerying] = useState(false);

  // Save dialog
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);

  // Rename state
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Load saved queries on mount
  useEffect(() => {
    setSavedQueries(loadSavedQueries());
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId)!;

  const updateActiveTab = useCallback((updates: Partial<QueryTab>) => {
    setTabs((prev) => prev.map((t) => t.id === activeTabId ? { ...t, ...updates } : t));
  }, [activeTabId]);

  const addTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) return;
    tabCounter.current += 1;
    const newTab: QueryTab = {
      id: String(Date.now()),
      name: `Query ${tabCounter.current}`,
      sql: 'SELECT * FROM merchants LIMIT 100',
      result: null,
      error: null,
      queryTime: null,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next[next.length - 1].id);
      }
      return next;
    });
  }, [activeTabId]);

  const executeQuery = useCallback(async () => {
    if (!activeTab.sql.trim()) return;

    setIsQuerying(true);
    updateActiveTab({ error: null });
    const start = performance.now();

    try {
      const res = await runQuery(activeTab.sql);
      const elapsed = performance.now() - start;
      updateActiveTab({ result: res, queryTime: elapsed, error: null });
      onQueryResult?.(res);
    } catch (err) {
      updateActiveTab({
        error: err instanceof Error ? err.message : 'Query failed',
        result: null,
      });
    } finally {
      setIsQuerying(false);
    }
  }, [activeTab.sql, runQuery, onQueryResult, updateActiveTab]);

  const handleFormat = useCallback(() => {
    updateActiveTab({ sql: formatSql(activeTab.sql) });
  }, [activeTab.sql, updateActiveTab]);

  const handleSaveQuery = useCallback(() => {
    if (!saveName.trim() || !activeTab.sql.trim()) return;
    const newQuery: SavedQuery = {
      id: String(Date.now()),
      name: saveName.trim(),
      sql: activeTab.sql,
    };
    const updated = [...savedQueries, newQuery];
    setSavedQueries(updated);
    persistSavedQueries(updated);
    setSaveName('');
    setSaveDialogOpen(false);
  }, [saveName, activeTab.sql, savedQueries]);

  const deleteSavedQuery = useCallback((id: string) => {
    const updated = savedQueries.filter((q) => q.id !== id);
    setSavedQueries(updated);
    persistSavedQueries(updated);
  }, [savedQueries]);

  const handleExportCsv = useCallback(() => {
    if (!activeTab.result) return;
    downloadCsv(activeTab.result.columns, activeTab.result.rows, `${activeTab.name}.csv`);
  }, [activeTab]);

  const handleExportExcel = useCallback(async () => {
    if (!activeTab.result) return;
    await downloadExcel(activeTab.result.columns, activeTab.result.rows, `${activeTab.name}.xlsx`);
  }, [activeTab]);

  const handleRenameSubmit = useCallback((tabId: string) => {
    if (renameValue.trim()) {
      setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, name: renameValue.trim() } : t));
    }
    setRenamingTabId(null);
  }, [renameValue]);

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center gap-2">
        {isLoading ? (
          <Badge variant="secondary" className="animate-pulse">Memuat DuckDB...</Badge>
        ) : isReady ? (
          <Badge variant="default" className="bg-green-600">{recordCount.toLocaleString()} data dimuat</Badge>
        ) : (
          <Badge variant="destructive">Tidak terhubung</Badge>
        )}
        {initError && <span className="text-xs text-red-500">{initError}</span>}
        <Button variant="ghost" size="sm" onClick={reload} disabled={isLoading}>
          <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Muat Ulang
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* Sidebar */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardContent className="px-3 py-3 space-y-1">
              {/* SQL Keywords */}
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded px-1 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                  SQL Keywords
                  <ChevronDown className="h-3 w-3 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-wrap gap-1 px-1 pt-1 pb-2">
                    {[
                      'SELECT', '*', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
                      'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
                      'COUNT(*)', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT',
                      'AS', 'LIKE', 'IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL',
                      'ASC', 'DESC', 'JOIN', 'LEFT JOIN', 'CAST',
                      'DELETE', 'INSERT', 'UPDATE',
                    ].map((kw) => (
                      <button
                        key={kw}
                        onClick={() => editorRef.current?.insertAtCursor(kw + ' ')}
                        className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Columns */}
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded px-1 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                  Kolom
                  <ChevronDown className="h-3 w-3 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardDescription className="px-1 text-[10px]">tabel merchants</CardDescription>
                  <div className="space-y-0.5 px-1 pt-1 pb-2 text-xs">
                    {schema.map((col) => (
                      <div key={col.name} className="flex items-center justify-between">
                        <code
                          className="cursor-pointer text-gray-800 hover:text-amber-700"
                          onClick={() => editorRef.current?.insertAtCursor(col.name)}
                        >
                          {col.name}
                        </code>
                        <span className="text-[10px] text-gray-400">{col.type}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Snippets */}
              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded px-1 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                  Snippets
                  <ChevronDown className="h-3 w-3 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5 px-1 pt-1 pb-2">
                    {[
                      { label: 'merchants table', sql: 'merchants' },
                      { label: 'WHERE platform = ...', sql: "WHERE platform = ''" },
                      { label: 'GROUP BY platform', sql: 'GROUP BY platform' },
                      { label: 'ORDER BY ... DESC', sql: 'ORDER BY id DESC' },
                      { label: 'LIMIT 100', sql: 'LIMIT 100' },
                      { label: "LIKE '%keyword%'", sql: "LIKE '%%" },
                    ].map((s) => (
                      <button
                        key={s.label}
                        onClick={() => editorRef.current?.insertAtCursor(s.sql + ' ')}
                        className="block w-full rounded px-2 py-1 text-left text-[11px] text-gray-600 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* Sample Queries */}
          <Card>
            <Collapsible defaultOpen>
              <CardHeader className="py-3 px-4">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <CardTitle className="text-sm">Contoh Kueri</CardTitle>
                  <ChevronDown className="h-3 w-3 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="px-4 pb-3">
                  <div className="space-y-1.5">
                    {sampleQueries.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => updateActiveTab({ sql: q.sql })}
                        className="block w-full rounded px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Saved Queries */}
          <Card>
            <Collapsible defaultOpen={savedQueries.length > 0}>
              <CardHeader className="py-3 px-4">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <CardTitle className="text-sm">
                    Kueri Tersimpan
                    {savedQueries.length > 0 && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">{savedQueries.length}</Badge>
                    )}
                  </CardTitle>
                  <ChevronDown className="h-3 w-3 text-gray-400 transition-transform [[data-state=open]>&]:rotate-180" />
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="px-4 pb-3">
                  {savedQueries.length === 0 ? (
                    <p className="text-xs text-gray-400">Belum ada kueri tersimpan</p>
                  ) : (
                    <div className="space-y-1">
                      {savedQueries.map((q) => (
                        <div key={q.id} className="group flex items-center justify-between rounded px-2 py-1.5 hover:bg-amber-50">
                          <button
                            onClick={() => updateActiveTab({ sql: q.sql })}
                            className="flex-1 text-left text-xs text-gray-700 group-hover:text-amber-800 truncate"
                            title={q.sql}
                          >
                            {q.name}
                          </button>
                          <button
                            onClick={() => deleteSavedQuery(q.id)}
                            className="ml-1 hidden text-gray-400 hover:text-red-500 group-hover:block"
                          >
                            <span className="text-xs">x</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>

        {/* Main: Tab bar + Query editor + Results */}
        <div className="space-y-4 lg:col-span-3">
          {/* Tab Bar */}
          <div className="flex items-center gap-1 border-b border-gray-200 pb-0">
            <div className="flex items-center gap-0.5 overflow-x-auto">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1 rounded-t-md border border-b-0 px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                    tab.id === activeTabId
                      ? 'border-gray-200 bg-white text-gray-900 font-medium'
                      : 'border-transparent bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {renamingTabId === tab.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSubmit(tab.id);
                        if (e.key === 'Escape') setRenamingTabId(null);
                      }}
                      className="w-20 border-b border-amber-400 bg-transparent text-xs outline-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingTabId(tab.id);
                        setRenameValue(tab.name);
                      }}
                    >
                      {tab.name}
                    </span>
                  )}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="ml-1 hidden rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 group-hover:block"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {tabs.length < MAX_TABS && (
              <button
                onClick={addTab}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Tab baru"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              </button>
            )}
          </div>

          {/* SQL Editor */}
          <Card>
            <CardContent className="p-4">
              <SqlEditor
                ref={editorRef}
                value={activeTab.sql}
                onChange={(val) => updateActiveTab({ sql: val })}
                onExecute={executeQuery}
                disabled={!isReady}
                schema={schema}
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter untuk menjalankan
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSaveName(activeTab.name);
                      setSaveDialogOpen(true);
                    }}
                    disabled={!activeTab.sql.trim()}
                    title="Simpan kueri"
                  >
                    <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
                    Simpan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFormat}
                    disabled={!isReady || !activeTab.sql.trim()}
                  >
                    <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    Format
                  </Button>
                  {activeTab.queryTime !== null && (
                    <span className="text-xs text-gray-400">
                      {activeTab.queryTime < 1000
                        ? `${activeTab.queryTime.toFixed(0)}ms`
                        : `${(activeTab.queryTime / 1000).toFixed(2)}s`}
                    </span>
                  )}
                  <Button
                    size="sm"
                    onClick={executeQuery}
                    disabled={!isReady || isQuerying || !activeTab.sql.trim()}
                  >
                    {isQuerying ? (
                      <>
                        <svg className="mr-1 h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Menjalankan...
                      </>
                    ) : (
                      <>
                        <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                        </svg>
                        Jalankan
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {activeTab.error && (
            <div className="animate-in fade-in slide-in-from-top-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 duration-200">
              <strong>Kesalahan:</strong> {activeTab.error}
            </div>
          )}

          {/* Results or Empty State */}
          {activeTab.result ? (
            <Card className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <CardHeader className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">
                    Hasil
                    <Badge variant="secondary" className="ml-2">
                      {activeTab.result.rowCount.toLocaleString()} baris
                    </Badge>
                  </CardTitle>
                  {activeTab.result.rowCount > 0 && (
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={handleExportCsv}>
                        <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        CSV
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleExportExcel}>
                        <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Excel
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {activeTab.result.rowCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <p className="text-sm font-medium">Tidak ada hasil</p>
                    <p className="text-xs">Kueri mengembalikan 0 baris</p>
                  </div>
                ) : (
                  <Tabs defaultValue="table">
                    <div className="border-b px-4">
                      <TabsList className="h-8">
                        <TabsTrigger value="table" className="text-xs">Tabel</TabsTrigger>
                        <TabsTrigger value="json" className="text-xs">JSON</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="table" className="m-0">
                      <DataTable
                        columns={activeTab.result.columns}
                        rows={activeTab.result.rows}
                        rowCount={activeTab.result.rowCount}
                      />
                    </TabsContent>
                    <TabsContent value="json" className="m-0">
                      <pre className="max-h-96 overflow-auto whitespace-pre p-4 text-xs text-gray-700">
                        {JSON.stringify(activeTab.result.rows.slice(0, 50), bigIntReplacer, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          ) : !activeTab.error && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="mb-3 h-12 w-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 18.375c0-.621.504-1.125 1.125-1.125" />
                </svg>
                <p className="text-sm font-medium text-gray-500">Belum ada hasil kueri</p>
                <p className="mt-1 text-xs">Tulis kueri SQL di atas dan tekan Jalankan atau {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Save Query Overlay */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSaveDialogOpen(false)}>
          <div className="w-full max-w-sm rounded-lg border bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold">Simpan Kueri</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Nama</label>
                <input
                  autoFocus
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveQuery();
                    if (e.key === 'Escape') setSaveDialogOpen(false);
                  }}
                  placeholder="Nama kueri..."
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <pre className="max-h-32 overflow-auto rounded-md bg-gray-50 p-2 text-xs text-gray-600">
                {activeTab.sql}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)}>
                  Batal
                </Button>
                <Button size="sm" onClick={handleSaveQuery} disabled={!saveName.trim()}>
                  <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
                  Simpan
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
