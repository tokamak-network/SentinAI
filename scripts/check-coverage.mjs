import fs from 'node:fs';

const minPct = Number(process.env.TIER3_MIN_COVERAGE_PCT || 50);
const summaryPath = 'coverage/coverage-summary.json';

if (!fs.existsSync(summaryPath)) {
  console.error(`[Tier3][FAIL] Missing ${summaryPath}. Run coverage first.`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = summary.total;
if (!total || !total.lines || typeof total.lines.pct !== 'number') {
  console.error('[Tier3][FAIL] Invalid coverage summary format.');
  process.exit(1);
}

const linePct = Number(total.lines.pct);
const branchPct = Number(total.branches?.pct ?? 0);
const fnPct = Number(total.functions?.pct ?? 0);
const stmtPct = Number(total.statements?.pct ?? 0);

console.info(`[Tier3] Coverage lines=${linePct}% branches=${branchPct}% functions=${fnPct}% statements=${stmtPct}%`);

if (linePct < minPct) {
  console.error(`[Tier3][FAIL] Coverage lines ${linePct}% < ${minPct}%`);
  process.exit(1);
}

console.info(`[Tier3][PASS] Coverage lines ${linePct}% >= ${minPct}%`);

