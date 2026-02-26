#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3002}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-25}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"
SENTINAI_API_KEY="${SENTINAI_API_KEY:-}"
SEED_SCENARIO="${SEED_SCENARIO:-spike}"
FORCE_ANOMALY="${FORCE_ANOMALY:-true}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

require_command curl
require_command jq
require_command node

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fetch_json() {
  local url="$1"
  local output="$2"
  if [[ -n "$SENTINAI_API_KEY" ]]; then
    curl -fsS -H "x-api-key: $SENTINAI_API_KEY" "$url" -o "$output"
  else
    curl -fsS "$url" -o "$output"
  fi
}

post_seed() {
  local scenario="$1"
  local status_code
  local response_file="$TMP_DIR/seed-response.json"
  local seed_url="${BASE_URL}/api/metrics/seed?scenario=${scenario}"

  if [[ "$FORCE_ANOMALY" == "true" && "$scenario" == "spike" ]]; then
    seed_url="${seed_url}&forceAnomaly=true"
  fi

  if [[ -n "$SENTINAI_API_KEY" ]]; then
    status_code="$(curl -sS -o "$response_file" -w "%{http_code}" -X POST -H "x-api-key: $SENTINAI_API_KEY" "$seed_url")"
  else
    status_code="$(curl -sS -o "$response_file" -w "%{http_code}" -X POST "$seed_url")"
  fi

  if [[ "$status_code" == "200" ]]; then
    return 0
  fi

  if [[ "$status_code" == "401" ]]; then
    echo "error: seed API returned 401 Unauthorized." >&2
    echo "hint: set SENTINAI_API_KEY and retry." >&2
    return 11
  fi

  if [[ "$status_code" == "403" ]]; then
    echo "error: seed API returned 403 Forbidden." >&2
    echo "hint: production/profile policy may block seed injection (SENTINAI_SEED_DISABLED / read-only / env policy)." >&2
    return 12
  fi

  if [[ "$status_code" == "405" ]]; then
    echo "error: seed API returned 405 Method Not Allowed." >&2
    echo "hint: production mode may block seed endpoint." >&2
    return 13
  fi

  echo "error: seed API failed with status ${status_code}" >&2
  if [[ -s "$response_file" ]]; then
    echo "response: $(cat "$response_file")" >&2
  fi
  return 14
}

echo "[1/6] Fetch baseline agent-loop status..."
fetch_json "$BASE_URL/api/agent-loop?limit=5" "$TMP_DIR/before-loop.json"

BEFORE_TOTAL_CYCLES="$(jq -r '.totalCycles // 0' "$TMP_DIR/before-loop.json")"
BEFORE_LAST_CYCLE_TS="$(jq -r '.lastCycle.timestamp // ""' "$TMP_DIR/before-loop.json")"

echo "  baseline totalCycles: $BEFORE_TOTAL_CYCLES"
echo "  baseline lastCycle: ${BEFORE_LAST_CYCLE_TS:-<none>}"

echo "[2/6] Inject spike scenario via seed API..."
post_seed "$SEED_SCENARIO"

echo "[3/6] Trigger metrics fetch and wait for seed/anomaly reflection..."
START_METRICS_EPOCH="$(date +%s)"
ACTIVE_EVENT_ID=""
ANOMALY_COUNT="0"
SEED_SOURCE_SEEN="false"
LAST_METRICS_SOURCE=""

while true; do
  fetch_json "$BASE_URL/api/metrics?t=$(date +%s)" "$TMP_DIR/metrics.json"
  LAST_METRICS_SOURCE="$(jq -r '.metrics.source // "unknown"' "$TMP_DIR/metrics.json")"
  ACTIVE_EVENT_ID="$(jq -r '.activeAnomalyEventId // ""' "$TMP_DIR/metrics.json")"
  ANOMALY_COUNT="$(jq '[.anomalies[]? | select(.isAnomaly == true)] | length' "$TMP_DIR/metrics.json")"

  if [[ "$LAST_METRICS_SOURCE" == "SEED_SCENARIO" ]]; then
    SEED_SOURCE_SEEN="true"
  fi

  if [[ "$SEED_SOURCE_SEEN" == "true" && "$ANOMALY_COUNT" -gt 0 && -n "$ACTIVE_EVENT_ID" ]]; then
    break
  fi

  NOW_METRICS_EPOCH="$(date +%s)"
  METRICS_ELAPSED="$((NOW_METRICS_EPOCH - START_METRICS_EPOCH))"
  if [[ "$METRICS_ELAPSED" -ge "$TIMEOUT_SECONDS" ]]; then
    break
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

echo "  metrics.source: $LAST_METRICS_SOURCE"
echo "  anomaly count: $ANOMALY_COUNT"
echo "  activeAnomalyEventId: ${ACTIVE_EVENT_ID:-<none>}"

if [[ "$SEED_SOURCE_SEEN" != "true" ]]; then
  echo "error: seed scenario was not reflected in /api/metrics (source != SEED_SCENARIO)." >&2
  echo "hint: multi-instance/load-balanced deployment may route seed and metrics to different instances." >&2
  echo "hint: run on single instance dev/staging or use shared Redis + sticky routing." >&2
  exit 21
fi

if [[ -z "$ACTIVE_EVENT_ID" || "$ANOMALY_COUNT" -eq 0 ]]; then
  echo "error: anomaly event was not created even after seed reflection." >&2
  echo "hint: check ANOMALY_DETECTION_ENABLED and threshold/pipeline settings. (FORCE_ANOMALY=${FORCE_ANOMALY})" >&2
  exit 22
fi

echo "[4/6] Wait for immediate agent-loop cycle..."
START_EPOCH="$(date +%s)"
DETECTED_TOTAL_CYCLES=""
DETECTED_LAST_CYCLE_TS=""

while true; do
  fetch_json "$BASE_URL/api/agent-loop?limit=5" "$TMP_DIR/after-loop.json"
  AFTER_TOTAL_CYCLES="$(jq -r '.totalCycles // 0' "$TMP_DIR/after-loop.json")"
  AFTER_LAST_CYCLE_TS="$(jq -r '.lastCycle.timestamp // ""' "$TMP_DIR/after-loop.json")"

  if [[ "$AFTER_TOTAL_CYCLES" -gt "$BEFORE_TOTAL_CYCLES" ]]; then
    DETECTED_TOTAL_CYCLES="$AFTER_TOTAL_CYCLES"
    DETECTED_LAST_CYCLE_TS="$AFTER_LAST_CYCLE_TS"
    break
  fi

  NOW_EPOCH="$(date +%s)"
  ELAPSED="$((NOW_EPOCH - START_EPOCH))"
  if [[ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]]; then
    break
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

echo "[5/6] Restore stable scenario..."
post_seed "stable" >/dev/null 2>&1 || true

echo "[6/6] Result"
if [[ -z "$DETECTED_TOTAL_CYCLES" ]]; then
  echo "FAIL: no new cycle detected within ${TIMEOUT_SECONDS}s"
  exit 3
fi

LATENCY_SECONDS="$(node -e "const a=process.argv[1]; const b=process.argv[2]; if(!a||!b){console.log('n/a'); process.exit(0);} const d=(new Date(b).getTime()-new Date(a).getTime())/1000; console.log(Number.isFinite(d)?d.toFixed(1):'n/a');" "$BEFORE_LAST_CYCLE_TS" "$DETECTED_LAST_CYCLE_TS")"

echo "PASS: immediate cycle detected"
echo "  totalCycles: ${BEFORE_TOTAL_CYCLES} -> ${DETECTED_TOTAL_CYCLES}"
echo "  lastCycle: ${BEFORE_LAST_CYCLE_TS:-<none>} -> ${DETECTED_LAST_CYCLE_TS:-<none>}"
echo "  approx lastCycle delta: ${LATENCY_SECONDS}s"
echo "  activeAnomalyEventId: $ACTIVE_EVENT_ID"
