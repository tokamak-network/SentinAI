import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const limitBytes = Number(process.env.TIER3_FIRST_LOAD_JS_MAX_BYTES || 200 * 1024);
const manifestPath = '.next/build-manifest.json';

if (!fs.existsSync(manifestPath)) {
  console.error(`[Tier3][FAIL] Missing ${manifestPath}. Run build first.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = [
  ...(manifest.polyfillFiles || []),
  ...(manifest.rootMainFiles || []),
].filter((file) => typeof file === 'string' && file.endsWith('.js'));

const uniqueFiles = [...new Set(files)];
let total = 0;
let totalGzip = 0;

for (const rel of uniqueFiles) {
  const filePath = path.join('.next', rel);
  if (!fs.existsSync(filePath)) {
    console.error(`[Tier3][FAIL] Missing bundle file: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath);
  total += raw.length;
  totalGzip += zlib.gzipSync(raw).length;
}

const kb = Math.round((total / 1024) * 100) / 100;
const gzipKb = Math.round((totalGzip / 1024) * 100) / 100;
const limitKb = Math.round((limitBytes / 1024) * 100) / 100;
console.info(`[Tier3] First Load JS raw: ${kb} KB`);
console.info(`[Tier3] First Load JS gzip: ${gzipKb} KB`);

if (totalGzip > limitBytes) {
  console.error(`[Tier3][FAIL] First Load JS(gzip) ${gzipKb} KB exceeds ${limitKb} KB`);
  process.exit(1);
}

console.info(`[Tier3][PASS] First Load JS(gzip) ${gzipKb} KB <= ${limitKb} KB`);
