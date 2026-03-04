#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3002}"
TIMEOUT="${TIMEOUT:-15}"

TMPFILE=$(mktemp)
HTTP_CODE=0
PASS=0
FAIL=0

cleanup() {
  rm -f "$TMPFILE"
}
trap cleanup EXIT

api_get() {
  local url="$1"
  HTTP_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null) || HTTP_CODE=0
}

check_json() {
  local jq_expr="$1"
  jq -e "$jq_expr" < "$TMPFILE" >/dev/null 2>&1
}

pass() {
  PASS=$((PASS + 1))
  echo "[PASS] $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo "[FAIL] $1"
}

run_check() {
  local name="$1"
  local path="$2"
  local expr="$3"

  api_get "${BASE_URL}${path}"
  if [ "$HTTP_CODE" != "200" ]; then
    fail "$name (HTTP: $HTTP_CODE)"
    return
  fi

  if check_json "$expr"; then
    pass "$name"
  else
    fail "$name (payload mismatch)"
  fi
}

echo "Runtime core smoke against ${BASE_URL}"
run_check "/api/health" "/api/health" '.status != null and .agentLoop != null'
run_check "/api/agent-loop" "/api/agent-loop?limit=5" '.scheduler != null and (.recentCycles | type == "array")'
run_check "/api/goal-manager" "/api/goal-manager?limit=5" '.queueDepth != null and (.queue | type == "array")'
run_check "/api/agent-fleet" "/api/agent-fleet?limit=30" '.summary != null and .kpi != null and (.agents | type == "array")'

echo "Summary: pass=${PASS}, fail=${FAIL}"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
