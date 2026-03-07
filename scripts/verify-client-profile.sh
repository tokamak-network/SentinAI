#!/usr/bin/env bash
# ============================================================
# Proposal 31 — ClientProfile E2E Verification Script
#
# Tests the EVM client auto-customization framework:
#   Phase 1: Built-in profiles integrity
#   Phase 2: Env var override logic
#   Phase 3: Sync parser normalization
#   Phase 4: Live RPC detection (Anvil)
#   Phase 5: API endpoint (dev server)
#
# Usage:
#   bash scripts/verify-client-profile.sh            # All phases
#   bash scripts/verify-client-profile.sh --phase 4  # Single phase
#
# Prerequisites:
#   - npm dependencies installed (npm install)
#   - anvil (Foundry) for Phase 4
#   - Dev server on port 3002 for Phase 5
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BASE_URL="${BASE_URL:-http://localhost:3002}"
ANVIL_PORT="${ANVIL_PORT:-18545}"
ANVIL_URL="http://127.0.0.1:${ANVIL_PORT}"

# ── CLI args ─────────────────────────────────────────────────
PHASE_FILTER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --phase) PHASE_FILTER="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Counters ─────────────────────────────────────────────────
PASSED=0; FAILED=0; SKIPPED=0; TOTAL=0
START_TIME=$(date +%s)

# ── State ────────────────────────────────────────────────────
ANVIL_PID=""
TMPFILE=$(mktemp)

cleanup() {
  rm -f "$TMPFILE"
  if [[ -n "$ANVIL_PID" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Output helpers ───────────────────────────────────────────
header() {
  echo ""
  echo -e "${CYAN}${BOLD}═══ Phase $1: $2 ═══${NC}"
}

pass() {
  PASSED=$((PASSED+1)); TOTAL=$((TOTAL+1))
  echo -e "  ${GREEN}✓${NC} $1"
}

fail() {
  FAILED=$((FAILED+1)); TOTAL=$((TOTAL+1))
  echo -e "  ${RED}✗${NC} $1"
  [[ -n "${2:-}" ]] && echo -e "    ${DIM}  → $2${NC}"
}

skip() {
  SKIPPED=$((SKIPPED+1)); TOTAL=$((TOTAL+1))
  echo -e "  ${YELLOW}○${NC} $1 ${DIM}(skipped: ${2:-})${NC}"
}

info() {
  echo -e "  ${CYAN}ℹ${NC}  $1"
}

# ── tsx helper (runs inline TypeScript) ──────────────────────
tsx_check() {
  local desc="$1"; shift
  local code="$*"
  local out
  if out=$(cd "$PROJECT_DIR" && npx tsx -e "$code" 2>&1); then
    if echo "$out" | grep -q "^FAIL:"; then
      local reason
      reason=$(echo "$out" | grep "^FAIL:" | head -1 | sed 's/^FAIL: //')
      fail "$desc" "$reason"
    else
      pass "$desc"
    fi
  else
    fail "$desc" "$(echo "$out" | tail -3)"
  fi
}

# ── jq-based API assertion ───────────────────────────────────
api_get() {
  local url="$1"
  local extra_headers="${2:-}"
  local http_code
  http_code=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 15 \
    ${extra_headers:+-H "$extra_headers"} "$url" 2>/dev/null) || http_code=0
  echo "$http_code"
}

api_assert() {
  local desc="$1"
  local url="$2"
  local expect_code="${3:-200}"
  local jq_expr="${4:-true}"
  local extra_header="${5:-}"

  local http_code
  http_code=$(api_get "$url" "$extra_header")

  if [[ "$http_code" != "$expect_code" ]]; then
    fail "$desc" "HTTP $http_code (expected $expect_code)"
    return
  fi

  if [[ "$jq_expr" != "true" ]]; then
    local result
    result=$(jq -r "$jq_expr" < "$TMPFILE" 2>/dev/null) || result=""
    if [[ "$result" == "true" ]] || [[ "$result" == "null" && "$jq_expr" == *"not"* ]]; then
      pass "$desc"
    elif [[ "$result" == "true" ]]; then
      pass "$desc"
    else
      local actual
      actual=$(cat "$TMPFILE" 2>/dev/null | head -c 200) || actual="(empty)"
      fail "$desc" "jq '${jq_expr}' → '${result}'"
    fi
  else
    pass "$desc"
  fi
}

should_run() {
  [[ -z "$PHASE_FILTER" ]] || [[ "$PHASE_FILTER" == "$1" ]]
}

# ============================================================
# Phase 1: Built-in Profiles Integrity
# ============================================================
if should_run 1; then
  header 1 "Built-in Profiles Integrity"

  tsx_check "BUILTIN_PROFILES exports 7 known families" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const keys = Object.keys(BUILTIN_PROFILES);
    const required = ['geth','reth','nethermind','besu','erigon','op-geth','nitro-node'];
    const missing = required.filter(k => !keys.includes(k));
    if (missing.length) { console.log('FAIL: missing profiles: ' + missing.join(', ')); process.exit(0); }
    console.log('ok: ' + keys.join(', '));
  "

  tsx_check "geth uses txpool_status" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const m = BUILTIN_PROFILES['geth'].methods.txPool?.method;
    if (m !== 'txpool_status') { console.log('FAIL: got ' + m); process.exit(0); }
    console.log('ok');
  "

  tsx_check "nethermind uses parity_pendingTransactions" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const m = BUILTIN_PROFILES['nethermind'].methods.txPool?.method;
    if (m !== 'parity_pendingTransactions') { console.log('FAIL: got ' + m); process.exit(0); }
    console.log('ok');
  "

  tsx_check "op-geth l2SyncStatus = optimism_syncStatus" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const m = BUILTIN_PROFILES['op-geth'].methods.l2SyncStatus?.method;
    if (m !== 'optimism_syncStatus') { console.log('FAIL: got ' + m); process.exit(0); }
    console.log('ok');
  "

  tsx_check "nitro-node l2SyncStatus = arb_getL1BlockNumber" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const m = BUILTIN_PROFILES['nitro-node'].methods.l2SyncStatus?.method;
    if (m !== 'arb_getL1BlockNumber') { console.log('FAIL: got ' + m); process.exit(0); }
    console.log('ok');
  "

  tsx_check "L1 clients have supportsL2SyncStatus=false" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    for (const f of ['geth','reth','nethermind','besu','erigon']) {
      if (BUILTIN_PROFILES[f].capabilities.supportsL2SyncStatus) {
        console.log('FAIL: ' + f + ' has supportsL2SyncStatus=true'); process.exit(0);
      }
    }
    console.log('ok');
  "

  tsx_check "L2 clients have supportsL2SyncStatus=true" "
    import { BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    for (const f of ['op-geth','nitro-node']) {
      if (!BUILTIN_PROFILES[f].capabilities.supportsL2SyncStatus) {
        console.log('FAIL: ' + f + ' has supportsL2SyncStatus=false'); process.exit(0);
      }
    }
    console.log('ok');
  "
fi

# ============================================================
# Phase 2: Env Var Override Logic
# ============================================================
if should_run 2; then
  header 2 "Env Var Override Logic"

  tsx_check "getClientFamilyFromEnv returns null when unset" "
    import { getClientFamilyFromEnv } from './src/lib/client-profile/index.js';
    const v = getClientFamilyFromEnv();
    if (v !== null) { console.log('FAIL: got ' + v); process.exit(0); }
    console.log('ok');
  "

  tsx_check "SENTINAI_CLIENT_FAMILY=nethermind → getClientFamilyFromEnv returns nethermind" "
    process.env.SENTINAI_CLIENT_FAMILY = 'nethermind';
    import { getClientFamilyFromEnv } from './src/lib/client-profile/index.js';
    const v = getClientFamilyFromEnv();
    if (v !== 'nethermind') { console.log('FAIL: got ' + v); process.exit(0); }
    console.log('ok');
  "

  tsx_check "SENTINAI_OVERRIDE_TXPOOL_METHOD overrides txPool.method" "
    process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'parity_pendingTransactions';
    import { buildClientProfileFromEnv, BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const p = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    const m = p.methods.txPool?.method;
    if (m !== 'parity_pendingTransactions') { console.log('FAIL: got ' + m); process.exit(0); }
    console.log('ok');
  "

  tsx_check "SENTINAI_CAPABILITY_TXPOOL=false disables txPool" "
    process.env.SENTINAI_CAPABILITY_TXPOOL = 'false';
    import { buildClientProfileFromEnv, BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const p = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    if (p.capabilities.supportsTxPool !== false) { console.log('FAIL: supportsTxPool=' + p.capabilities.supportsTxPool); process.exit(0); }
    console.log('ok');
  "

  tsx_check "SENTINAI_CAPABILITY_L2_SYNC=true enables L2 sync on L1 profile" "
    process.env.SENTINAI_CAPABILITY_L2_SYNC = 'true';
    import { buildClientProfileFromEnv, BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    const p = buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    if (p.capabilities.supportsL2SyncStatus !== true) { console.log('FAIL: supportsL2SyncStatus=' + p.capabilities.supportsL2SyncStatus); process.exit(0); }
    console.log('ok');
  "

  tsx_check "Override does not mutate built-in profile" "
    process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'my_custom_txpool';
    import { buildClientProfileFromEnv, BUILTIN_PROFILES } from './src/lib/client-profile/index.js';
    buildClientProfileFromEnv(BUILTIN_PROFILES['geth']);
    const original = BUILTIN_PROFILES['geth'].methods.txPool?.method;
    if (original !== 'txpool_status') { console.log('FAIL: original mutated to ' + original); process.exit(0); }
    console.log('ok');
  "

  tsx_check "2 custom metrics parsed from env" "
    process.env.SENTINAI_CUSTOM_METRIC_1_NAME = 'queueDepth';
    process.env.SENTINAI_CUSTOM_METRIC_1_METHOD = 'seq_queueDepth';
    process.env.SENTINAI_CUSTOM_METRIC_1_PATH = 'result.depth';
    process.env.SENTINAI_CUSTOM_METRIC_1_UNIT = 'txs';
    process.env.SENTINAI_CUSTOM_METRIC_2_NAME = 'latency';
    process.env.SENTINAI_CUSTOM_METRIC_2_METHOD = 'batch_latency';
    process.env.SENTINAI_CUSTOM_METRIC_2_PATH = 'result.ms';
    import { parseCustomMetricsFromEnv } from './src/lib/client-profile/index.js';
    const metrics = parseCustomMetricsFromEnv();
    if (metrics.length !== 2) { console.log('FAIL: got ' + metrics.length + ' metrics'); process.exit(0); }
    if (metrics[0].unit !== 'txs') { console.log('FAIL: unit=' + metrics[0].unit); process.exit(0); }
    console.log('ok');
  "

  tsx_check "Topology parsed from SENTINAI_COMPONENTS + SENTINAI_COMPONENT_DEPS" "
    process.env.SENTINAI_COMPONENTS = 'execution,batcher,proposer';
    process.env.SENTINAI_COMPONENT_DEPS = JSON.stringify({
      execution: { dependsOn: ['l1'], feeds: ['batcher','proposer'] },
      batcher: { dependsOn: ['execution'], feeds: ['l1'] },
      proposer: { dependsOn: ['execution'], feeds: ['l1'] },
    });
    import { parseTopologyFromEnv } from './src/lib/client-profile/index.js';
    const topo = parseTopologyFromEnv();
    if (!topo || topo.components.length !== 3) { console.log('FAIL: components=' + JSON.stringify(topo?.components)); process.exit(0); }
    if (!topo.dependencyGraph.batcher) { console.log('FAIL: missing batcher in graph'); process.exit(0); }
    console.log('ok');
  "

  tsx_check "Invalid SENTINAI_COMPONENT_DEPS JSON returns null gracefully" "
    process.env.SENTINAI_COMPONENT_DEPS = '{broken json}';
    import { parseTopologyFromEnv } from './src/lib/client-profile/index.js';
    const result = parseTopologyFromEnv();
    if (result !== null) { console.log('FAIL: expected null, got ' + JSON.stringify(result)); process.exit(0); }
    console.log('ok');
  "
fi

# ============================================================
# Phase 3: Sync Parser Normalization
# ============================================================
if should_run 3; then
  header 3 "Sync Parser Normalization"

  tsx_check "standard: false → isSyncing=false" "
    import { parseSyncStatus } from './src/lib/client-profile/index.js';
    const r = parseSyncStatus(false, 'standard');
    if (r.isSyncing !== false) { console.log('FAIL: isSyncing=' + r.isSyncing); process.exit(0); }
    if (r.currentBlock !== null) { console.log('FAIL: currentBlock=' + r.currentBlock); process.exit(0); }
    console.log('ok');
  "

  tsx_check "standard: syncing object → extracts hex block numbers" "
    import { parseSyncStatus } from './src/lib/client-profile/index.js';
    const r = parseSyncStatus({ currentBlock: '0x64', highestBlock: '0xc8' }, 'standard');
    if (!r.isSyncing) { console.log('FAIL: isSyncing=false'); process.exit(0); }
    if (r.currentBlock !== 100) { console.log('FAIL: currentBlock=' + r.currentBlock); process.exit(0); }
    if (r.highestBlock !== 200) { console.log('FAIL: highestBlock=' + r.highestBlock); process.exit(0); }
    console.log('ok');
  "

  tsx_check "nethermind: extracts currentBlockNumber + isSyncing fields" "
    import { parseSyncStatus } from './src/lib/client-profile/index.js';
    const r = parseSyncStatus({ currentBlockNumber: 1500, highestBlockNumber: 2000, isSyncing: true }, 'nethermind');
    if (!r.isSyncing) { console.log('FAIL: isSyncing=false'); process.exit(0); }
    if (r.currentBlock !== 1500) { console.log('FAIL: currentBlock=' + r.currentBlock); process.exit(0); }
    console.log('ok');
  "

  tsx_check "custom: dot-notation path extraction" "
    import { parseSyncStatus } from './src/lib/client-profile/index.js';
    const raw = { sync: { current: 999, target: 1000, active: true } };
    const r = parseSyncStatus(raw, 'custom', {
      currentBlockPath: 'sync.current',
      highestBlockPath: 'sync.target',
      isSyncingPath: 'sync.active',
    });
    if (r.currentBlock !== 999) { console.log('FAIL: currentBlock=' + r.currentBlock); process.exit(0); }
    if (r.highestBlock !== 1000) { console.log('FAIL: highestBlock=' + r.highestBlock); process.exit(0); }
    console.log('ok');
  "

  tsx_check "getValueByPath: handles deep nested paths" "
    import { getValueByPath } from './src/lib/client-profile/index.js';
    const obj = { a: { b: { c: 42 } } };
    const v = getValueByPath(obj, 'a.b.c');
    if (v !== 42) { console.log('FAIL: got ' + v); process.exit(0); }
    console.log('ok');
  "
fi

# ============================================================
# Phase 4: Live RPC Detection (Anvil)
# ============================================================
if should_run 4; then
  header 4 "Live RPC Detection (Anvil)"

  if ! command -v anvil &>/dev/null; then
    skip "All Anvil tests" "anvil not found (install Foundry: https://getfoundry.sh)"
  else
    info "Starting Anvil on port $ANVIL_PORT..."
    anvil --port "$ANVIL_PORT" --silent &
    ANVIL_PID=$!

    # Wait for Anvil to be ready
    local_tries=0
    until curl -sf -X POST "$ANVIL_URL" \
      -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
      -o /dev/null 2>/dev/null; do
      local_tries=$((local_tries+1))
      if [[ $local_tries -gt 20 ]]; then
        fail "Anvil startup" "Timed out waiting for Anvil on $ANVIL_URL"
        ANVIL_PID=""
        break
      fi
      sleep 0.3
    done

    if [[ -n "$ANVIL_PID" ]]; then
      info "Anvil ready at $ANVIL_URL (PID $ANVIL_PID)"
      echo ""

      # Delegate to standalone tsx file (avoids bash special-char escaping issues)
      live_output=$(cd "$PROJECT_DIR" && \
        npx tsx scripts/verify-client-profile-live.ts --rpc-url "$ANVIL_URL" 2>&1) || true

      # Parse PASS:/FAIL:/INFO: lines and relay to our counters
      while IFS= read -r line; do
        if [[ "$line" == PASS:* ]]; then
          desc="${line#PASS: }"
          pass "$desc"
        elif [[ "$line" == FAIL:* ]]; then
          raw="${line#FAIL: }"
          desc="${raw%% -- *}"
          reason="${raw#* -- }"
          fail "$desc" "$reason"
        elif [[ "$line" == INFO:* ]]; then
          info "${line#INFO: }"
        fi
      done <<< "$live_output"

      # Stop Anvil
      kill "$ANVIL_PID" 2>/dev/null || true
      wait "$ANVIL_PID" 2>/dev/null || true
      ANVIL_PID=""
      info "Anvil stopped"
    fi
  fi
fi

# ============================================================
# Phase 5: API Endpoint (dev server)
# ============================================================
if should_run 5; then
  header 5 "API Endpoint: GET /api/v2/instances/{id}/profile"

  # Check if dev server is running
  if ! curl -sf --max-time 3 "$BASE_URL/api/health" -o /dev/null 2>/dev/null; then
    skip "All API tests" "Dev server not running at $BASE_URL (run: npm run dev)"
  else
    info "Dev server detected at $BASE_URL"

    # Register a test instance
    info "Registering test instance..."
    REGISTER_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" --max-time 10 \
      -X POST "$BASE_URL/api/v2/instances" \
      -H "Content-Type: application/json" \
      -d '{
        "protocolId": "ethereum-el",
        "displayName": "verify-client-profile-test",
        "connectionConfig": { "rpcUrl": "http://127.0.0.1:18545" }
      }' 2>/dev/null) || REGISTER_CODE=0

    if [[ "$REGISTER_CODE" == "201" ]]; then
      INSTANCE_ID=$(jq -r '.data.id' < "$TMPFILE" 2>/dev/null)
      info "Registered instance: $INSTANCE_ID"

      api_assert \
        "GET /profile returns 200 with clientProfile and source" \
        "$BASE_URL/api/v2/instances/$INSTANCE_ID/profile" \
        "200" \
        '(.data.clientProfile != null) and (.data.source != null) and (.data.instanceId != null)'

      api_assert \
        "GET /profile source is 'unknown' without env override" \
        "$BASE_URL/api/v2/instances/$INSTANCE_ID/profile" \
        "200" \
        '.data.source == "unknown"'

      api_assert \
        "GET /profile clientProfile has required method fields" \
        "$BASE_URL/api/v2/instances/$INSTANCE_ID/profile" \
        "200" \
        '(.data.clientProfile.methods.blockNumber.method != null) and (.data.clientProfile.methods.syncStatus.method != null)'

      api_assert \
        "GET /profile has meta.version = v2" \
        "$BASE_URL/api/v2/instances/$INSTANCE_ID/profile" \
        "200" \
        '.meta.version == "v2"'

    else
      fail "Instance registration" "HTTP $REGISTER_CODE (check SENTINAI_API_KEY env or server logs)"
    fi

    # Test 404 for non-existent instance
    api_assert \
      "GET /profile returns 404 for unknown instance" \
      "$BASE_URL/api/v2/instances/non-existent-id-000/profile" \
      "404" \
      '.code == "NOT_FOUND"'

    info "Note: To test source='env', set SENTINAI_CLIENT_FAMILY=nethermind in .env.local and restart dev server"
    info "      Then GET /profile should return source='env' with parity_pendingTransactions txPool method"
  fi
fi

# ============================================================
# Summary
# ============================================================
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  Proposal 31 Verification Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}✓ Passed:${NC}  $PASSED"
echo -e "  ${RED}✗ Failed:${NC}  $FAILED"
echo -e "  ${YELLOW}○ Skipped:${NC} $SKIPPED"
echo -e "  ${DIM}Total:    $TOTAL (${ELAPSED}s)${NC}"
echo ""

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}${BOLD}FAILED${NC} — $FAILED check(s) did not pass."
  exit 1
else
  echo -e "${GREEN}${BOLD}PASSED${NC} — All checks succeeded."
  exit 0
fi
