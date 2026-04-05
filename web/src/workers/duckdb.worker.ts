import * as duckdb from '@duckdb/duckdb-wasm';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;

type WorkerMessage =
  | { type: 'init' }
  | { type: 'loadParquet'; url: string }
  | { type: 'query'; sql: string; id: string }
  | { type: 'getSchema' }
  | { type: 'getSampleQueries' };

async function initDuckDB() {
  if (db) return;

  const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: '/duckdb/duckdb-mvp.wasm',
      mainWorker: '/duckdb/duckdb-browser-mvp.worker.js',
    },
    eh: {
      mainModule: '/duckdb/duckdb-eh.wasm',
      mainWorker: '/duckdb/duckdb-browser-eh.worker.js',
    },
  };

  const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, null);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
}

async function loadParquet(url: string) {
  if (!db || !conn) throw new Error('DuckDB not initialized');

  // Fetch parquet file
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      // No data yet - create empty table
      await conn.query(`
        CREATE OR REPLACE TABLE merchants (
          platform VARCHAR,
          name VARCHAR,
          address VARCHAR,
          category VARCHAR,
          phone VARCHAR,
          rating DOUBLE,
          productCount INTEGER,
          joinDate VARCHAR,
          monthlySales DOUBLE,
          totalTransactions INTEGER,
          operatingHours VARCHAR,
          ownerName VARCHAR,
          sourceUrl VARCHAR,
          regionCode VARCHAR,
          regionName VARCHAR,
          provinceCode VARCHAR,
          provinceName VARCHAR,
          createdAt VARCHAR
        )
      `);
      return 0;
    }
    throw new Error(`Failed to fetch parquet: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  await db.registerFileBuffer('merchants.parquet', new Uint8Array(buffer));
  await conn.query(`
    CREATE OR REPLACE TABLE merchants AS SELECT * FROM read_parquet('merchants.parquet')
  `);

  const result = await conn.query('SELECT COUNT(*) as cnt FROM merchants');
  const count = result.toArray()[0]?.cnt ?? 0;
  return Number(count);
}

async function runQuery(sql: string) {
  if (!conn) throw new Error('DuckDB not initialized');

  const result = await conn.query(sql);
  const columns = result.schema.fields.map((f) => ({
    name: f.name,
    type: f.type.toString(),
  }));

  const rows = result.toArray().map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.name] = row[col.name];
    }
    return obj;
  });

  return { columns, rows, rowCount: rows.length };
}

async function getSchema() {
  if (!conn) throw new Error('DuckDB not initialized');

  const result = await conn.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'merchants'
    ORDER BY ordinal_position
  `);

  return result.toArray().map((row) => ({
    name: row.column_name as string,
    type: row.data_type as string,
  }));
}

function getSampleQueries() {
  return [
    {
      label: 'All merchants',
      sql: 'SELECT * FROM merchants LIMIT 100',
    },
    {
      label: 'Count by platform',
      sql: 'SELECT platform, COUNT(*) as count FROM merchants GROUP BY platform ORDER BY count DESC',
    },
    {
      label: 'Count by province',
      sql: 'SELECT provinceName, provinceCode, COUNT(*) as count FROM merchants GROUP BY provinceName, provinceCode ORDER BY count DESC',
    },
    {
      label: 'Count by region',
      sql: 'SELECT regionName, regionCode, platform, COUNT(*) as count FROM merchants GROUP BY regionName, regionCode, platform ORDER BY count DESC',
    },
    {
      label: 'Top categories',
      sql: "SELECT category, COUNT(*) as count FROM merchants WHERE category IS NOT NULL AND category != '' GROUP BY category ORDER BY count DESC LIMIT 20",
    },
    {
      label: 'Highest rated',
      sql: 'SELECT name, platform, rating, regionName FROM merchants WHERE rating IS NOT NULL ORDER BY rating DESC LIMIT 20',
    },
    {
      label: 'Province merchant density (for map)',
      sql: 'SELECT provinceCode, provinceName, COUNT(*) as merchantCount FROM merchants GROUP BY provinceCode, provinceName',
    },
  ];
}

// Message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'init': {
        await initDuckDB();
        self.postMessage({ type: 'init', success: true });
        break;
      }
      case 'loadParquet': {
        const count = await loadParquet(msg.url);
        self.postMessage({ type: 'loadParquet', success: true, count });
        break;
      }
      case 'query': {
        const result = await runQuery(msg.sql);
        self.postMessage({ type: 'query', success: true, id: msg.id, ...result });
        break;
      }
      case 'getSchema': {
        const schema = await getSchema();
        self.postMessage({ type: 'getSchema', success: true, schema });
        break;
      }
      case 'getSampleQueries': {
        const queries = getSampleQueries();
        self.postMessage({ type: 'getSampleQueries', success: true, queries });
        break;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    self.postMessage({
      type: msg.type,
      success: false,
      error: errorMsg,
      id: 'id' in msg ? msg.id : undefined,
    });
  }
};
