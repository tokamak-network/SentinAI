#!/usr/bin/env bash
set -euo pipefail

echo "[Tier1] 1) Build check"
npm run build >/tmp/prod_gate_build.log 2>&1 || {
  cat /tmp/prod_gate_build.log
  echo "[Tier1][FAIL] build failed"
  exit 1
}
echo "[Tier1][PASS] build"

echo "[Tier1] 2) TypeScript check"
npx tsc --noEmit >/tmp/prod_gate_tsc.log 2>&1 || {
  cat /tmp/prod_gate_tsc.log
  echo "[Tier1][FAIL] typecheck failed"
  exit 1
}
echo "[Tier1][PASS] typecheck"

echo "[Tier1] 3) Lint check (error=0, warning<=5)"
npx eslint . -f json -o /tmp/prod_gate_eslint.json >/tmp/prod_gate_lint.log 2>&1 || true
LINT_SUMMARY=$(node -e "
const fs=require('fs');
const data=JSON.parse(fs.readFileSync('/tmp/prod_gate_eslint.json','utf8'));
let errors=0,warnings=0;
for(const file of data){errors+=file.errorCount||0;warnings+=file.warningCount||0;}
process.stdout.write(JSON.stringify({errors,warnings}));
")
LINT_ERRORS=$(echo "$LINT_SUMMARY" | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(s.errors));")
LINT_WARNINGS=$(echo "$LINT_SUMMARY" | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(s.warnings));")
if [ "$LINT_ERRORS" -ne 0 ] || [ "$LINT_WARNINGS" -gt 5 ]; then
  cat /tmp/prod_gate_lint.log
  echo "[Tier1][FAIL] lint failed (errors=${LINT_ERRORS}, warnings=${LINT_WARNINGS})"
  exit 1
fi
echo "[Tier1][PASS] lint (errors=${LINT_ERRORS}, warnings=${LINT_WARNINGS})"

echo "[Tier1] 4) Hardcoded secret pattern check (src/)"
if rg -n --pcre2 "(sk-[A-Za-z0-9_-]{8,}|api[_-]?key\\s*[:=]\\s*['\\\"][^'\\\"]+['\\\"]|Bearer\\s+(?!\\$\\{)[A-Za-z0-9._-]{10,})" src/ --glob '!src/**/__tests__/**' >/tmp/prod_gate_secret.log; then
  cat /tmp/prod_gate_secret.log
  echo "[Tier1][FAIL] hardcoded secret pattern found"
  exit 1
fi
echo "[Tier1][PASS] hardcoded secret pattern"

echo "[Tier1] 5) console.log check (src/)"
if rg -n "console\\.log" src/ >/tmp/prod_gate_console.log; then
  cat /tmp/prod_gate_console.log
  echo "[Tier1][FAIL] console.log found in src/"
  exit 1
fi
echo "[Tier1][PASS] console.log"

echo "[Tier1] ALL PASS"
