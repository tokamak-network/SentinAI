#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Optimism Metrics API Smoke Test
# - Starts Next.js dev server with CHAIN_TYPE=optimism
# - Calls /api/metrics?stress=true
# - Verifies core response fields
# ============================================================

PORT="${PORT:-3102}"
BASE_URL="http://127.0.0.1:${PORT}"
TMP_LOG="$(mktemp -t sentinai-optimism-smoke.XXXXXX.log)"
DEV_PID=""

cleanup() {
  if [ -n "${DEV_PID}" ] && kill -0 "${DEV_PID}" 2>/dev/null; then
    kill "${DEV_PID}" >/dev/null 2>&1 || true
    wait "${DEV_PID}" 2>/dev/null || true
  fi
  rm -f "${TMP_LOG}"
}
trap cleanup EXIT

if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[smoke] PORT ${PORT} is already in use. Set PORT=<free-port> and retry."
  exit 1
fi

echo "[smoke] Starting Next.js dev server on port ${PORT} (CHAIN_TYPE=optimism)..."
CHAIN_TYPE=optimism npx next dev -p "${PORT}" >"${TMP_LOG}" 2>&1 &
DEV_PID=$!

echo "[smoke] Waiting for server readiness..."
for _ in $(seq 1 60); do
  if curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "${BASE_URL}/api/health" >/dev/null 2>&1; then
  echo "[smoke] Server did not become ready. Recent logs:"
  tail -n 80 "${TMP_LOG}" || true
  exit 1
fi

echo "[smoke] Calling /api/metrics?stress=true ..."
response="$(curl -sf "${BASE_URL}/api/metrics?stress=true")"

RESPONSE_JSON="${response}" node <<'NODE'
const raw = process.env.RESPONSE_JSON;
if (!raw) {
  console.error('[smoke] Empty response');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error('[smoke] Response is not valid JSON:', error);
  process.exit(1);
}

if (parsed?.stressMode !== true) {
  console.error('[smoke] Expected stressMode=true');
  process.exit(1);
}
if (parsed?.status !== 'healthy') {
  console.error('[smoke] Expected status=healthy');
  process.exit(1);
}
if (parsed?.metrics?.source !== 'SIMULATED_FAST_PATH') {
  console.error('[smoke] Expected metrics.source=SIMULATED_FAST_PATH');
  process.exit(1);
}
if (typeof parsed?.metrics?.blockHeight !== 'number') {
  console.error('[smoke] Expected numeric metrics.blockHeight');
  process.exit(1);
}

console.log('[smoke] PASS: /api/metrics returned healthy stress payload in Optimism mode.');
NODE
