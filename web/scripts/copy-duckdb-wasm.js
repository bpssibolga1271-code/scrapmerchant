const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const destDir = path.join(__dirname, '..', 'public', 'duckdb');

const files = [
  'duckdb-browser-eh.worker.js',
  'duckdb-browser-mvp.worker.js',
  'duckdb-eh.wasm',
  'duckdb-mvp.wasm',
];

if (!fs.existsSync(srcDir)) {
  console.warn('[postinstall] @duckdb/duckdb-wasm not found, skipping WASM copy.');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    copied++;
  } else {
    console.warn(`[postinstall] Missing: ${file}`);
  }
}

console.log(`[postinstall] Copied ${copied}/${files.length} DuckDB WASM files to public/duckdb/`);
