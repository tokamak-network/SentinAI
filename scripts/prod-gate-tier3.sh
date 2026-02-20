#!/usr/bin/env bash
set -euo pipefail

echo "[Tier3] 12) Coverage >= 50%"
npm run test:coverage >/tmp/prod_gate_tier3_coverage.log 2>&1 || {
  cat /tmp/prod_gate_tier3_coverage.log
  echo "[Tier3][FAIL] coverage command failed"
  exit 1
}
node scripts/check-coverage.mjs

echo "[Tier3] 14) Bundle size (First Load JS <= 200KB)"
npm run build >/tmp/prod_gate_tier3_build.log 2>&1 || {
  cat /tmp/prod_gate_tier3_build.log
  echo "[Tier3][FAIL] build failed"
  exit 1
}
node scripts/check-bundle-size.mjs

echo "[Tier3] 13) E2E core flows (3+)"
npx playwright install --with-deps chromium >/tmp/prod_gate_tier3_pw_install.log 2>&1 || {
  cat /tmp/prod_gate_tier3_pw_install.log
  echo "[Tier3][FAIL] playwright browser install failed"
  exit 1
}
npm run test:e2e

echo "[Tier3] 15) Core Web Vitals (LCP/FID/CLS)"
npx @lhci/cli@0.15.x autorun --config=.lighthouserc.cwv.json

echo "[Tier3] ALL PASS"

