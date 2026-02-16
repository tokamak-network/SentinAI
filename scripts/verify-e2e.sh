#!/usr/bin/env bash
# ============================================================
# SentinAI E2E Verification Script
# Tests all features against a running dev server.
# Usage:
#   npm run verify              # Run all phases
#   bash scripts/verify-e2e.sh --phase 2   # Run specific phase
# ============================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:3002}"
ENV_FILE=".env.local"
TIMEOUT_DEFAULT=30   # seconds
TIMEOUT_AI=90        # seconds for AI-dependent phases
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ── Counters ────────────────────────────────────────────────
PASSED=0
FAILED=0
SKIPPED=0
TOTAL=0
START_TIME=$(date +%s)

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── CLI args ────────────────────────────────────────────────
PHASE_FILTER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --phase) PHASE_FILTER="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── State flags ─────────────────────────────────────────────
HAS_AI_KEY=false
HAS_K8S=false
HAS_REDIS=false
SERVER_STARTED_BY_US=false

# ── Helpers ─────────────────────────────────────────────────

header() {
  echo ""
  echo -e "${CYAN}${BOLD}[$1]${NC} ${BOLD}$2${NC}"
}

pass() {
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${GREEN}✓${NC} $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${RED}✗${NC} $1"
}

skip() {
  SKIPPED=$((SKIPPED + 1))
  TOTAL=$((TOTAL + 1))
  echo -e "  ${YELLOW}○${NC} $1 ${YELLOW}(SKIP)${NC}"
}

info() {
  echo -e "  ${CYAN}ℹ${NC} $1"
}

# Temp file for API response body
TMPFILE=$(mktemp)
HTTP_CODE=0

# Call api_get/api_post directly (NOT in $(...) subshell).
# Body is written to $TMPFILE; read with: BODY=$(cat "$TMPFILE")
api_get() {
  local url="$1"
  local timeout="${2:-$TIMEOUT_DEFAULT}"
  HTTP_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time "$timeout" "$url" 2>/dev/null) || HTTP_CODE=0
}

api_post() {
  local url="$1"
  local data="${2:-{}}"
  local timeout="${3:-$TIMEOUT_DEFAULT}"
  HTTP_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time "$timeout" -X POST \
    -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null) || HTTP_CODE=0
}

# Read response body from temp file
body() {
  cat "$TMPFILE"
}

# jq shorthand on response body
jq_body() {
  jq "$@" < "$TMPFILE" 2>/dev/null
}

# Check if jq is available
check_jq() {
  if ! command -v jq &>/dev/null; then
    echo -e "${RED}Error: jq is required. Install with: brew install jq${NC}"
    exit 1
  fi
}

# Cleanup function
cleanup() {
  rm -f "$TMPFILE"
  if [ "$SERVER_STARTED_BY_US" = true ]; then
    info "Stopping dev server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

should_run() {
  [ -z "$PHASE_FILTER" ] || [ "$PHASE_FILTER" = "$1" ]
}

# ============================================================
# Banner
# ============================================================

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  SentinAI E2E Verification${NC}"
echo -e "  Date: $(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S') KST"
echo -e "${BOLD}========================================${NC}"

check_jq

# ============================================================
# Phase 0: Prerequisites
# ============================================================

if should_run 0; then
  header "Phase 0" "Prerequisites"

  # .env.local
  if [ -f "$PROJECT_DIR/$ENV_FILE" ]; then
    pass ".env.local exists"
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/$ENV_FILE" 2>/dev/null || true
    set +a
  else
    fail ".env.local not found"
    echo -e "  ${RED}  Copy .env.local.sample to .env.local and configure.${NC}"
    exit 1
  fi

  # L2 RPC
  if [ -n "${L2_RPC_URL:-}" ]; then
    RPC_RESP=$(curl -s --max-time 10 -X POST "$L2_RPC_URL" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' 2>/dev/null) || RPC_RESP=""
    BLOCK_HEX=$(echo "$RPC_RESP" | jq -r '.result // empty' 2>/dev/null)
    if [ -n "$BLOCK_HEX" ]; then
      BLOCK_DEC=$((16#${BLOCK_HEX#0x}))
      pass "L2 RPC connected (block: $BLOCK_DEC)"
    else
      fail "L2 RPC not responding ($L2_RPC_URL)"
    fi
  else
    fail "L2_RPC_URL not set"
  fi

  # K8s cluster
  if [ -n "${AWS_CLUSTER_NAME:-}" ] || [ -n "${K8S_API_URL:-}" ]; then
    K8S_CHECK=$(kubectl get pods --no-headers 2>/dev/null | wc -l | tr -d ' ') || K8S_CHECK="0"
    if [ "$K8S_CHECK" -gt 0 ]; then
      pass "K8s cluster accessible ($K8S_CHECK pods)"
      HAS_K8S=true
    else
      skip "K8s cluster configured but not accessible"
    fi
  else
    skip "K8s cluster not configured (AWS_CLUSTER_NAME)"
  fi

  # AI Provider
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    pass "AI provider: Anthropic"
    HAS_AI_KEY=true
  elif [ -n "${OPENAI_API_KEY:-}" ]; then
    pass "AI provider: OpenAI"
    HAS_AI_KEY=true
  elif [ -n "${GEMINI_API_KEY:-}" ]; then
    pass "AI provider: Gemini"
    HAS_AI_KEY=true
  elif [ -n "${AI_GATEWAY_URL:-}" ]; then
    pass "AI provider: LiteLLM Gateway"
    HAS_AI_KEY=true
  else
    skip "No AI provider configured"
  fi

  # Redis
  if [ -n "${REDIS_URL:-}" ]; then
    REDIS_PONG=$(redis-cli -u "$REDIS_URL" ping 2>/dev/null) || REDIS_PONG=""
    if [ "$REDIS_PONG" = "PONG" ]; then
      pass "Redis connected ($REDIS_URL)"
      HAS_REDIS=true
    else
      skip "Redis configured but not responding"
    fi
  else
    skip "Redis not configured (in-memory mode)"
  fi

  # Dev server
  SERVER_RESP=$(curl -s --max-time 5 "$BASE_URL/api/health" 2>/dev/null) || SERVER_RESP=""
  if echo "$SERVER_RESP" | jq -e '.status' &>/dev/null; then
    pass "Dev server running at $BASE_URL"
  else
    info "Dev server not running. Starting..."
    cd "$PROJECT_DIR"
    npm run dev &>/dev/null &
    SERVER_PID=$!
    SERVER_STARTED_BY_US=true

    for i in $(seq 1 30); do
      if curl -s --max-time 2 "$BASE_URL/api/health" &>/dev/null; then
        pass "Dev server started at $BASE_URL (${i}s)"
        break
      fi
      if [ "$i" -eq 30 ]; then
        fail "Dev server failed to start within 30s"
        exit 1
      fi
      sleep 1
    done
  fi
fi

# ============================================================
# Phase 1: Data Collection
# ============================================================

if should_run 1; then
  header "Phase 1" "Data Collection"

  # Seed stable data first
  api_post "$BASE_URL/api/metrics/seed?scenario=stable" '{}'

  api_get "$BASE_URL/api/metrics" "$TIMEOUT_DEFAULT"

  if [ "$HTTP_CODE" = "200" ]; then
    pass "/api/metrics returns 200"

    BLOCK=$(jq_body -r '.metrics.blockHeight // 0')
    if [ "$BLOCK" != "0" ] && [ "$BLOCK" != "null" ]; then
      pass "Block height: $BLOCK"
    else
      fail "Block height is 0 or missing"
    fi

    CPU=$(jq_body -r '.metrics.cpuUsage // -1')
    if [ "$CPU" != "-1" ] && [ "$CPU" != "null" ]; then
      pass "CPU usage reported: ${CPU}%"
    else
      fail "CPU usage missing"
    fi

    COMP_COUNT=$(jq_body '[.components[] | select(.name != null)] | length') || COMP_COUNT=0
    if [ "$COMP_COUNT" -gt 0 ]; then
      COMP_NAMES=$(jq_body -r '[.components[].name] | join(", ")')
      pass "Components: $COMP_COUNT found ($COMP_NAMES)"
    else
      skip "No K8s components (mock mode)"
    fi

    VCPU=$(jq_body -r '.metrics.gethVcpu // 0')
    if [ "$VCPU" != "0" ] && [ "$VCPU" != "null" ]; then
      pass "Current vCPU: $VCPU"
    else
      skip "vCPU info not available"
    fi
  else
    fail "/api/metrics failed (HTTP: $HTTP_CODE)"
  fi
fi

# ============================================================
# Phase 2: Anomaly Detection Pipeline
# ============================================================

if should_run 2; then
  header "Phase 2" "Anomaly Detection Pipeline"

  # Inject spike data
  api_post "$BASE_URL/api/metrics/seed?scenario=spike" '{}'
  if [ "$HTTP_CODE" = "200" ]; then
    pass "Spike data injected"
  else
    fail "Seed injection failed (HTTP: $HTTP_CODE)"
  fi

  # Layer 1: statistical anomalies
  api_get "$BASE_URL/api/metrics" "$TIMEOUT_DEFAULT"
  ANOMALY_COUNT=$(jq_body '[.anomalies[]? | select(.isAnomaly == true)] | length') || ANOMALY_COUNT=0
  if [ "$ANOMALY_COUNT" -gt 0 ]; then
    pass "Layer 1: $ANOMALY_COUNT anomalies detected (Z-Score)"
  else
    fail "Layer 1: No anomalies detected after spike injection"
  fi

  # Layer 2: AI analysis
  if [ "$HAS_AI_KEY" = true ]; then
    sleep 3
    api_get "$BASE_URL/api/anomalies?limit=5" "$TIMEOUT_AI"
    EVENT_COUNT=$(jq_body '.events | length') || EVENT_COUNT=0
    if [ "$EVENT_COUNT" -gt 0 ]; then
      pass "Anomaly events recorded: $EVENT_COUNT"

      HAS_DEEP=$(jq_body '[.events[] | select(.deepAnalysis != null)] | length') || HAS_DEEP=0
      if [ "$HAS_DEEP" -gt 0 ]; then
        SEVERITY=$(jq_body -r '.events[0].deepAnalysis.severity // "unknown"')
        pass "Layer 2: AI analysis present (severity: $SEVERITY)"
      else
        skip "Layer 2: AI analysis pending or failed (fallback active)"
      fi
    else
      skip "No anomaly events yet"
    fi
  else
    skip "Layer 2: AI analysis (no API key)"
  fi

  # Layer 3: alert config
  api_get "$BASE_URL/api/anomalies/config"
  ALERT_ENABLED=$(jq_body -r '.enabled // false')
  if [ "$ALERT_ENABLED" = "true" ]; then
    COOLDOWN=$(jq_body -r '.cooldownMinutes // 0')
    pass "Layer 3: Alert config enabled (cooldown: ${COOLDOWN}m)"
  else
    pass "Layer 3: Alert config loaded (enabled=$ALERT_ENABLED)"
  fi

  # Restore
  api_post "$BASE_URL/api/metrics/seed?scenario=stable" '{}'
  info "Restored stable data after spike test"
fi

# ============================================================
# Phase 3: Predictive Scaling
# ============================================================

if should_run 3; then
  header "Phase 3" "Predictive Scaling"

  if [ "$HAS_AI_KEY" = true ]; then
    api_post "$BASE_URL/api/metrics/seed?scenario=rising" '{}'
    if [ "$HTTP_CODE" = "200" ]; then
      pass "Rising trend data injected"
    else
      fail "Seed injection failed (HTTP: $HTTP_CODE)"
    fi

    api_get "$BASE_URL/api/scaler" "$TIMEOUT_AI"
    if [ "$HTTP_CODE" = "200" ]; then
      pass "/api/scaler returns 200"

      PRED_VCPU=$(jq_body -r '.prediction.predictedVcpu // "none"')
      if [ "$PRED_VCPU" != "none" ] && [ "$PRED_VCPU" != "null" ]; then
        CONFIDENCE=$(jq_body -r '.prediction.confidence // 0')
        TREND=$(jq_body -r '.prediction.trend // "unknown"')
        pass "Prediction: ${PRED_VCPU} vCPU (confidence: $CONFIDENCE, trend: $TREND)"
      else
        skip "Prediction not available (cooldown or insufficient data)"
      fi
    else
      fail "/api/scaler failed (HTTP: $HTTP_CODE)"
    fi

    api_post "$BASE_URL/api/metrics/seed?scenario=stable" '{}'
  else
    skip "Predictive scaling (no AI key)"
    skip "Prediction result (no AI key)"
  fi
fi

# ============================================================
# Phase 4: Cost Optimization
# ============================================================

if should_run 4; then
  header "Phase 4" "Cost Optimization"

  api_get "$BASE_URL/api/cost-report?days=7" "$TIMEOUT_AI"
  if [ "$HTTP_CODE" = "200" ]; then
    pass "/api/cost-report returns 200"

    MONTHLY=$(jq_body -r '.currentMonthly // 0')
    if [ "$MONTHLY" != "0" ] && [ "$MONTHLY" != "null" ]; then
      pass "Current monthly cost: \$$MONTHLY"
    else
      skip "Monthly cost not calculated (no usage data)"
    fi

    PATTERNS=$(jq_body '.usagePatterns | length') || PATTERNS=0
    if [ "$PATTERNS" -gt 0 ]; then
      pass "Usage patterns: $PATTERNS time buckets"
    else
      skip "No usage patterns yet"
    fi

    if [ "$HAS_AI_KEY" = true ]; then
      REC_COUNT=$(jq_body '.recommendations | length') || REC_COUNT=0
      pass "AI recommendations: $REC_COUNT"
    else
      skip "Cost recommendations (no AI key)"
    fi
  else
    fail "/api/cost-report failed (HTTP: $HTTP_CODE)"
  fi
fi

# ============================================================
# Phase 5: Daily Report
# ============================================================

if should_run 5; then
  header "Phase 5" "Daily Report"

  # Accumulator status
  api_get "$BASE_URL/api/reports/daily?status=true"
  if [ "$HTTP_CODE" = "200" ]; then
    SNAP_COUNT=$(jq_body -r '.data.snapshotCount // 0')
    COMPLETENESS=$(jq_body -r '.data.dataCompleteness // 0')
    pass "Accumulator: $SNAP_COUNT snapshots (completeness: $COMPLETENESS)"
  else
    fail "Accumulator status failed (HTTP: $HTTP_CODE)"
  fi

  # Generate report (delete existing to avoid conflict)
  if [ "$HAS_AI_KEY" = true ]; then
    TODAY=$(TZ=Asia/Seoul date '+%Y-%m-%d')
    rm -f "$PROJECT_DIR/data/reports/${TODAY}.md"

    api_post "$BASE_URL/api/reports/daily" '{}' "$TIMEOUT_AI"
    if [ "$HTTP_CODE" = "200" ]; then
      REPORT_PATH=$(jq_body -r '.reportPath // "unknown"')
      pass "Report generated: $REPORT_PATH"
    elif [ "$HTTP_CODE" = "503" ]; then
      ERROR_MSG=$(jq_body -r '.error // "unknown"')
      fail "Report generation failed: $ERROR_MSG"
    else
      fail "Report API failed (HTTP: $HTTP_CODE)"
    fi
  else
    skip "Report generation (no AI key)"
  fi

  # List reports
  api_get "$BASE_URL/api/reports/daily?list=true"
  if [ "$HTTP_CODE" = "200" ]; then
    REPORT_COUNT=$(jq_body '.data.reports | length') || REPORT_COUNT=0
    pass "Stored reports: $REPORT_COUNT"
  else
    skip "Report listing failed"
  fi
fi

# ============================================================
# Phase 6: RCA Engine
# ============================================================

if should_run 6; then
  header "Phase 6" "RCA Engine"

  if [ "$HAS_AI_KEY" = true ]; then
    api_post "$BASE_URL/api/metrics/seed?scenario=spike" '{}'

    api_post "$BASE_URL/api/rca" '{}' "$TIMEOUT_AI"
    if [ "$HTTP_CODE" = "200" ]; then
      RCA_SUCCESS=$(jq_body -r '.success // false')
      if [ "$RCA_SUCCESS" = "true" ]; then
        ROOT_COMP=$(jq_body -r '.result.rootCause.component // "unknown"')
        ROOT_CONF=$(jq_body -r '.result.rootCause.confidence // 0')
        pass "RCA completed: root cause = $ROOT_COMP (confidence: $ROOT_CONF)"

        AFFECTED=$(jq_body '.result.affectedComponents | length') || AFFECTED=0
        pass "Affected components: $AFFECTED"

        HAS_REMEDIATION=$(jq_body 'if .result.remediation then true else false end')
        if [ "$HAS_REMEDIATION" = "true" ]; then
          pass "Remediation advice present"
        else
          fail "Remediation advice missing"
        fi
      else
        ERROR_MSG=$(jq_body -r '.message // "unknown"')
        fail "RCA failed: $ERROR_MSG"
      fi
    else
      fail "RCA API failed (HTTP: $HTTP_CODE)"
    fi

    api_post "$BASE_URL/api/metrics/seed?scenario=stable" '{}'
  else
    skip "RCA engine (no AI key)"
    skip "RCA result (no AI key)"
    skip "Remediation advice (no AI key)"
  fi
fi

# ============================================================
# Summary
# ============================================================

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${BOLD}========================================${NC}"
if [ "$FAILED" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}Results: $PASSED/$TOTAL PASSED${NC}, ${YELLOW}$SKIPPED SKIPPED${NC}"
else
  echo -e "  ${RED}${BOLD}Results: $PASSED/$TOTAL PASSED, $FAILED FAILED${NC}, ${YELLOW}$SKIPPED SKIPPED${NC}"
fi
echo -e "  Duration: ${DURATION}s"
echo -e "${BOLD}========================================${NC}"
echo ""

# Exit with error if any test failed
[ "$FAILED" -eq 0 ]
