#!/usr/bin/env bash
set -euo pipefail

echo "[Tier2] Build"
npm run build >/tmp/prod_gate_tier2_build.log 2>&1 || {
  cat /tmp/prod_gate_tier2_build.log
  echo "[Tier2][FAIL] build failed"
  exit 1
}

echo "[Tier2] Lighthouse Mobile (360px baseline)"
npx @lhci/cli@0.15.x autorun --config=.lighthouserc.mobile.json

echo "[Tier2] Lighthouse Desktop (1920px baseline)"
npx @lhci/cli@0.15.x autorun --config=.lighthouserc.desktop.json

echo "[Tier2] ALL PASS"

