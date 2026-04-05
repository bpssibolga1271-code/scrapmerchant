/**
 * Database abstraction layer.
 *
 * Detects the active database engine from the Prisma `DATABASE_URL`
 * environment variable and exposes helpers that return engine-specific
 * SQL fragments. This lets the rest of the codebase write portable
 * queries without scattering provider checks everywhere.
 *
 * Supported engines: sqlite, postgresql, mysql.
 */

export type DbEngine = 'sqlite' | 'postgresql' | 'mysql';

/**
 * Detect the database engine from DATABASE_URL.
 *
 * - `file:` or `sqlite:` → sqlite
 * - `postgresql:` or `postgres:` → postgresql
 * - `mysql:` → mysql
 * - fallback → sqlite
 */
export function detectEngine(): DbEngine {
  const url = process.env.DATABASE_URL ?? '';

  if (url.startsWith('file:') || url.startsWith('sqlite:')) return 'sqlite';
  if (url.startsWith('postgresql:') || url.startsWith('postgres:')) return 'postgresql';
  if (url.startsWith('mysql:')) return 'mysql';

  // Default to sqlite (matches current Prisma schema)
  return 'sqlite';
}

/** Cached engine value so we only detect once per process. */
let _engine: DbEngine | null = null;

export function getEngine(): DbEngine {
  if (!_engine) _engine = detectEngine();
  return _engine;
}

// ── SQL fragment helpers ──────────────────────────────────────

/**
 * String concatenation.
 *
 * - SQLite:      `col1 || ' ' || col2`
 * - PostgreSQL:  `col1 || ' ' || col2`  (same as SQLite)
 * - MySQL:       `CONCAT(col1, ' ', col2)`
 */
export function sqlConcat(...parts: string[]): string {
  const engine = getEngine();
  if (engine === 'mysql') {
    return `CONCAT(${parts.join(', ')})`;
  }
  return parts.join(' || ');
}

/**
 * Current timestamp expression.
 *
 * - SQLite:      `datetime('now')`
 * - PostgreSQL:  `NOW()`
 * - MySQL:       `NOW()`
 */
export function sqlNow(): string {
  const engine = getEngine();
  if (engine === 'sqlite') return "datetime('now')";
  return 'NOW()';
}

/**
 * Boolean literal.
 *
 * SQLite uses 0/1 while PostgreSQL & MySQL support TRUE/FALSE.
 */
export function sqlBool(value: boolean): string {
  const engine = getEngine();
  if (engine === 'sqlite') return value ? '1' : '0';
  return value ? 'TRUE' : 'FALSE';
}

/**
 * LIMIT + OFFSET clause.
 *
 * All three engines support `LIMIT n OFFSET m`, but MySQL
 * also accepts `LIMIT m, n`. We use the standard form.
 */
export function sqlLimitOffset(limit: number, offset = 0): string {
  if (offset > 0) return `LIMIT ${limit} OFFSET ${offset}`;
  return `LIMIT ${limit}`;
}

/**
 * Case-insensitive LIKE operator.
 *
 * - SQLite:      `LIKE` (case-insensitive by default for ASCII)
 * - PostgreSQL:  `ILIKE`
 * - MySQL:       `LIKE` (case-insensitive with default collation)
 */
export function sqlILike(): string {
  const engine = getEngine();
  if (engine === 'postgresql') return 'ILIKE';
  return 'LIKE';
}

/**
 * Auto-increment column type for raw DDL.
 *
 * - SQLite:      `INTEGER PRIMARY KEY AUTOINCREMENT`
 * - PostgreSQL:  `SERIAL PRIMARY KEY`
 * - MySQL:       `INT AUTO_INCREMENT PRIMARY KEY`
 */
export function sqlAutoIncrement(): string {
  const engine = getEngine();
  if (engine === 'postgresql') return 'SERIAL PRIMARY KEY';
  if (engine === 'mysql') return 'INT AUTO_INCREMENT PRIMARY KEY';
  return 'INTEGER PRIMARY KEY AUTOINCREMENT';
}

/**
 * JSON extract helper.
 *
 * - SQLite:      `json_extract(col, '$.key')`
 * - PostgreSQL:  `col->>'key'`
 * - MySQL:       `JSON_UNQUOTE(JSON_EXTRACT(col, '$.key'))`
 */
export function sqlJsonExtract(column: string, key: string): string {
  const engine = getEngine();
  if (engine === 'postgresql') return `${column}->>'${key}'`;
  if (engine === 'mysql') return `JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.${key}'))`;
  return `json_extract(${column}, '$.${key}')`;
}

/**
 * Date formatting.
 *
 * - SQLite:      `strftime(format, col)`
 * - PostgreSQL:  `to_char(col, format)`  (uses PG format tokens)
 * - MySQL:       `DATE_FORMAT(col, format)` (uses MySQL format tokens)
 *
 * For simplicity, accepts a "mode" instead of raw format strings.
 */
export function sqlDateFormat(column: string, mode: 'year' | 'month' | 'date'): string {
  const engine = getEngine();

  const formats: Record<DbEngine, Record<string, string>> = {
    sqlite: { year: `strftime('%Y', ${column})`, month: `strftime('%Y-%m', ${column})`, date: `strftime('%Y-%m-%d', ${column})` },
    postgresql: { year: `to_char(${column}, 'YYYY')`, month: `to_char(${column}, 'YYYY-MM')`, date: `to_char(${column}, 'YYYY-MM-DD')` },
    mysql: { year: `DATE_FORMAT(${column}, '%Y')`, month: `DATE_FORMAT(${column}, '%Y-%m')`, date: `DATE_FORMAT(${column}, '%Y-%m-%d')` },
  };

  return formats[engine][mode];
}

/**
 * GROUP_CONCAT / STRING_AGG equivalent.
 *
 * - SQLite:      `GROUP_CONCAT(col, sep)`
 * - PostgreSQL:  `STRING_AGG(col, sep)`
 * - MySQL:       `GROUP_CONCAT(col SEPARATOR sep)`
 */
export function sqlGroupConcat(column: string, separator = ','): string {
  const engine = getEngine();
  if (engine === 'postgresql') return `STRING_AGG(${column}, '${separator}')`;
  if (engine === 'mysql') return `GROUP_CONCAT(${column} SEPARATOR '${separator}')`;
  return `GROUP_CONCAT(${column}, '${separator}')`;
}
