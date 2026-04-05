'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';

interface Column {
  name: string;
  type: string;
}

interface QueryResult {
  columns: Column[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface SampleQuery {
  label: string;
  sql: string;
}

const SAMPLE_QUERIES: SampleQuery[] = [
  { label: 'All merchants', sql: 'SELECT * FROM merchants LIMIT 100' },
  { label: 'Count by platform', sql: 'SELECT platform, COUNT(*) as count FROM merchants GROUP BY platform ORDER BY count DESC' },
  { label: 'Count by province', sql: 'SELECT provinceName, provinceCode, COUNT(*) as count FROM merchants GROUP BY provinceName, provinceCode ORDER BY count DESC' },
  { label: 'Count by region', sql: 'SELECT regionName, regionCode, platform, COUNT(*) as count FROM merchants GROUP BY regionName, regionCode, platform ORDER BY count DESC' },
  { label: 'Top categories', sql: "SELECT category, COUNT(*) as count FROM merchants WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC LIMIT 20" },
  { label: 'Highest rated', sql: 'SELECT name, platform, rating, regionName FROM merchants WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 20' },
  { label: 'Province merchant density (for map)', sql: 'SELECT provinceCode, provinceName, COUNT(*) as merchantCount FROM merchants GROUP BY provinceCode, provinceName' },
  { label: 'Regency merchant density (for map)', sql: 'SELECT regionCode, regionName, COUNT(*) as merchantCount FROM merchants GROUP BY regionCode, regionName ORDER BY merchantCount DESC' },
];

export function useDuckDB() {
  const dbRef = useRef<duckdb.AsyncDuckDB | null>(null);
  const connRef = useRef<duckdb.AsyncDuckDBConnection | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [recordCount, setRecordCount] = useState(0);
  const [schema, setSchema] = useState<Column[]>([]);
  const [sampleQueries] = useState<SampleQuery[]>(SAMPLE_QUERIES);
  const [error, setError] = useState<string | null>(null);

  const initAndLoad = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Initialize DuckDB if not already done
      if (!dbRef.current) {
        const BUNDLES: duckdb.DuckDBBundles = {
          mvp: {
            mainModule: '/duckdb/duckdb-mvp.wasm',
            mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
          },
          eh: {
            mainModule: '/duckdb/duckdb-eh.wasm',
            mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
          },
        };

        const bundle = await duckdb.selectBundle(BUNDLES);
        const worker = new Worker(bundle.mainWorker!);
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule);
        dbRef.current = db;
      }

      // Close existing connection safely
      if (connRef.current) {
        try {
          await connRef.current.close();
        } catch {
          // Connection may already be closed
        }
        connRef.current = null;
      }

      const conn = await dbRef.current.connect();
      connRef.current = conn;

      // Fix "Max expression depth limit of 0 exceeded" error
      // DuckDB-WASM defaults to 0 in some versions
      try {
        await conn.query('SET max_expression_depth TO 500');
      } catch (e) {
        console.warn('[useDuckDB] Failed to set max_expression_depth:', e);
      }

      // Fetch and load parquet data
      const response = await fetch('/api/merchants/parquet');

      const createEmptyTable = async () => {
        await conn.query(`
          CREATE OR REPLACE TABLE merchants (
            platform VARCHAR, name VARCHAR, address VARCHAR, category VARCHAR,
            phone VARCHAR, rating DOUBLE, productCount INTEGER, joinDate VARCHAR,
            monthlySales DOUBLE, totalTransactions INTEGER, operatingHours VARCHAR,
            ownerName VARCHAR, sourceUrl VARCHAR, regionCode VARCHAR, regionName VARCHAR,
            provinceCode VARCHAR, provinceName VARCHAR, createdAt VARCHAR
          )
        `);
        setRecordCount(0);
      };

      if (!response.ok) {
        // No data available or server error — create empty table
        await createEmptyTable();
      } else {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 4) {
          // Empty or invalid parquet — create empty table
          await createEmptyTable();
        } else {
          try {
            await dbRef.current.registerFileBuffer('merchants.parquet', new Uint8Array(buffer));
            await conn.query(`CREATE OR REPLACE TABLE merchants AS SELECT * FROM read_parquet('merchants.parquet')`);

            const countResult = await conn.query('SELECT COUNT(*) as cnt FROM merchants');
            const count = countResult.toArray()[0]?.cnt ?? 0;
            setRecordCount(Number(count));
          } catch (parquetErr) {
            console.warn('Failed to load parquet data, creating empty table:', parquetErr);
            await createEmptyTable();
          }
        }
      }

      // Get schema
      const schemaResult = await conn.query(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'merchants' ORDER BY ordinal_position
      `);
      setSchema(
        schemaResult.toArray().map((row) => ({
          name: row.column_name as string,
          type: row.data_type as string,
        })),
      );

      setIsReady(true);
    } catch (err) {
      console.error('DuckDB init error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize DuckDB');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    initAndLoad();

    return () => {
      connRef.current?.close();
      dbRef.current?.terminate();
      dbRef.current = null;
      connRef.current = null;
    };
  }, [initAndLoad]);

  const runQuery = useCallback(
    async (sql: string): Promise<QueryResult> => {
      if (!connRef.current || !isReady) {
        throw new Error('DuckDB not ready');
      }

      // Re-apply expression depth before every query —
      // DuckDB-WASM (dev builds) defaults to 0 and may reset it
      try {
        await connRef.current.query('SET max_expression_depth TO 500');
      } catch {
        // Setting might already be applied
      }

      const result = await connRef.current.query(sql);
      const columns = result.schema.fields.map((f) => ({
        name: f.name,
        type: f.type.toString(),
      }));

      const rows = result.toArray().map((row) => {
        const obj: Record<string, unknown> = {};
        for (const col of columns) {
          const val = row[col.name];
          // Convert BigInt to Number for JSON serialization
          obj[col.name] = typeof val === 'bigint' ? Number(val) : val;
        }
        return obj;
      });

      return { columns, rows, rowCount: rows.length };
    },
    [isReady],
  );

  const reload = useCallback(() => {
    setIsReady(false);
    initAndLoad();
  }, [initAndLoad]);

  return {
    isReady,
    isLoading,
    recordCount,
    schema,
    sampleQueries,
    error,
    runQuery,
    reload,
  };
}
