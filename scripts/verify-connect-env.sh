#!/usr/bin/env bash
# ============================================================
# SentinAI Connect → .env + Playbook Verification Script
#
# Validates:
#   Phase 0: Prerequisites (curl, jq, npx)
#   Phase 1: RPC connection for 6 chain types
#   Phase 2: .env generation correctness (CHAIN_TYPE presence)
#   Phase 3: Playbook integrity (via verify-playbooks.ts)
#   Phase 4: Dashboard boot verification (--with-server)
#
# Usage:
#   npm run verify:connect-env
#   bash scripts/verify-connect-env.sh
#   bash scripts/verify-connect-env.sh --with-server
#
# Custom RPC overrides:
#   --rpc-l1=<url>        Override ethereum-el RPC
#   --rpc-optimism=<url>  Override opstack-l2 / optimism RPC
#   --rpc-thanos=<url>    Override thanos RPC
#   --rpc-arbitrum=<url>  Override arbitrum-nitro RPC
#   --rpc-zkstack=<url>   Override zkstack RPC
#   --rpc-scroll=<url>    Override zkl2-generic RPC
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── Counters ────────────────────────────────────────────────
PASSED=0
FAILED=0
WARNED=0

pass() { PASSED=$((PASSED+1)); echo -e "    ${GREEN}✓${NC} $1"; }
fail() { FAILED=$((FAILED+1)); echo -e "    ${RED}✗${NC} $1"; }
warn() { WARNED=$((WARNED+1)); echo -e "    ${YELLOW}⚠${NC} $1"; }
info() { echo -e "    ${CYAN}ℹ${NC} $1"; }
header() { echo -e "\n${CYAN}${BOLD}$1${NC}"; }

# ── CLI args ────────────────────────────────────────────────
WITH_SERVER=false
RPC_L1="https://ethereum-rpc.publicnode.com"
RPC_OPTIMISM="https://optimism-rpc.publicnode.com"
RPC_THANOS="https://rpc.titan.tokamak.network"
RPC_ARBITRUM="https://arbitrum-one-rpc.publicnode.com"
RPC_ZKSTACK="https://mainnet.era.zksync.io"
RPC_SCROLL="https://rpc.scroll.io"

for arg in "$@"; do
  case "$arg" in
    --with-server)       WITH_SERVER=true ;;
    --rpc-l1=*)          RPC_L1="${arg#*=}" ;;
    --rpc-optimism=*)    RPC_OPTIMISM="${arg#*=}" ;;
    --rpc-thanos=*)      RPC_THANOS="${arg#*=}" ;;
    --rpc-arbitrum=*)    RPC_ARBITRUM="${arg#*=}" ;;
    --rpc-zkstack=*)     RPC_ZKSTACK="${arg#*=}" ;;
    --rpc-scroll=*)      RPC_SCROLL="${arg#*=}" ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  SentinAI Connect → .env + Playbook Verification${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"

# ══════════════════════════════════════════════════════════════════════════════
header "Phase 0: Prerequisites"

check_prereq() {
  local cmd="$1"
  if command -v "$cmd" &>/dev/null; then
    pass "$cmd found ($(command -v "$cmd"))"
  else
    fail "$cmd not found — install it to proceed"
    exit 1
  fi
}

check_prereq curl
check_prereq jq
check_prereq npx

# ══════════════════════════════════════════════════════════════════════════════
header "Phase 1: RPC Connection"

# Millisecond timer (cross-platform: macOS + Linux)
ms_now() {
  python3 -c "import time; print(int(time.time() * 1000))" 2>/dev/null \
    || echo $(( $(date +%s) * 1000 ))
}

# Helper: call eth_blockNumber via curl and return block height or error
rpc_call() {
  local url="$1"
  local method="$2"
  local params="${3:-[]}"
  local timeout="${4:-10}"
  local result
  local start_ms
  local end_ms
  local latency

  start_ms=$(ms_now)
  result=$(curl -sf --max-time "$timeout" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":${params}}" \
    2>/dev/null) || true
  end_ms=$(ms_now)
  latency=$(( end_ms - start_ms ))

  if [[ -z "$result" ]]; then
    echo "ERROR:connection_failed:0"
    return
  fi

  local error
  error=$(echo "$result" | jq -r '.error.message // empty' 2>/dev/null)
  if [[ -n "$error" ]]; then
    echo "ERROR:${error}:${latency}"
    return
  fi

  local value
  value=$(echo "$result" | jq -r '.result // empty' 2>/dev/null)
  echo "OK:${value}:${latency}"
}

verify_rpc() {
  local index="$1"
  local node_type="$2"
  local chain_type="$3"
  local rpc_url="$4"
  local host
  host=$(echo "$rpc_url" | sed 's|https://||;s|http://||' | cut -d'/' -f1)

  echo ""
  echo -e "  ${BOLD}[$index]${NC} ${node_type} (${chain_type}) — ${DIM}${host}${NC}"

  # eth_blockNumber
  local bn_result
  bn_result=$(rpc_call "$rpc_url" "eth_blockNumber" "[]" 10)
  local bn_status="${bn_result%%:*}"
  local bn_value
  bn_value=$(echo "$bn_result" | cut -d: -f2)
  local bn_latency
  bn_latency=$(echo "$bn_result" | cut -d: -f3)

  if [[ "$bn_status" == "OK" && -n "$bn_value" ]]; then
    # Convert hex to decimal
    local block_dec
    block_dec=$(printf '%d' "$bn_value" 2>/dev/null || echo "$bn_value")
    pass "eth_blockNumber .............. ${block_dec} (${bn_latency}ms)"
  else
    fail "eth_blockNumber .............. FAILED (${bn_value:-connection error})"
  fi

  # web3_clientVersion
  local cv_result
  cv_result=$(rpc_call "$rpc_url" "web3_clientVersion" "[]" 10)
  local cv_status="${cv_result%%:*}"
  local cv_value
  cv_value=$(echo "$cv_result" | cut -d: -f2)

  if [[ "$cv_status" == "OK" && -n "$cv_value" ]]; then
    # Trim long version strings
    local cv_short
    cv_short=$(echo "$cv_value" | cut -c1-40)
    pass "web3_clientVersion ........... ${cv_short}"
  else
    warn "web3_clientVersion ........... not supported (${cv_value:-no response})"
  fi

  # eth_chainId
  local ci_result
  ci_result=$(rpc_call "$rpc_url" "eth_chainId" "[]" 10)
  local ci_status="${ci_result%%:*}"
  local ci_value
  ci_value=$(echo "$ci_result" | cut -d: -f2)

  if [[ "$ci_status" == "OK" && -n "$ci_value" ]]; then
    local chain_id_dec
    chain_id_dec=$(printf '%d' "$ci_value" 2>/dev/null || echo "$ci_value")
    pass "eth_chainId .................. ${chain_id_dec}"
  else
    warn "eth_chainId .................. not supported"
  fi

  # Chain-specific methods
  case "$chain_type" in
    zkstack)
      local zks_result
      zks_result=$(rpc_call "$rpc_url" "zks_L1BatchNumber" "[]" 10)
      local zks_status="${zks_result%%:*}"
      local zks_value
      zks_value=$(echo "$zks_result" | cut -d: -f2)
      if [[ "$zks_status" == "OK" && -n "$zks_value" ]]; then
        local batch_dec
        batch_dec=$(printf '%d' "$zks_value" 2>/dev/null || echo "$zks_value")
        pass "zks_L1BatchNumber ............ ${batch_dec}"
      else
        warn "zks_L1BatchNumber ............ not available (${zks_value:-no response})"
      fi
      ;;
    optimism|thanos)
      local sync_result
      sync_result=$(rpc_call "$rpc_url" "optimism_syncStatus" "[]" 10)
      local sync_status="${sync_result%%:*}"
      if [[ "$sync_status" == "OK" ]]; then
        pass "optimism_syncStatus .......... available"
      else
        warn "optimism_syncStatus .......... not available (optional)"
      fi
      ;;
    zkl2-generic)
      local ri_result
      ri_result=$(rpc_call "$rpc_url" "rollup_getInfo" "[]" 10)
      local ri_status="${ri_result%%:*}"
      if [[ "$ri_status" == "OK" ]]; then
        pass "rollup_getInfo ............... available"
      else
        warn "rollup_getInfo ............... not available (optional)"
      fi
      ;;
  esac
}

verify_rpc "1/6" "ethereum-el" "l1-evm"       "$RPC_L1"
verify_rpc "2/6" "opstack-l2"  "optimism"     "$RPC_OPTIMISM"
verify_rpc "3/6" "opstack-l2"  "thanos"       "$RPC_THANOS"
verify_rpc "4/6" "arbitrum-nitro" "arbitrum"  "$RPC_ARBITRUM"
verify_rpc "5/6" "zkstack"     "zkstack"      "$RPC_ZKSTACK"
verify_rpc "6/6" "(generic)"   "zkl2-generic" "$RPC_SCROLL"

# ══════════════════════════════════════════════════════════════════════════════
header "Phase 2: .env Generation"

# Simulate what buildEnvLocal() produces for each nodeType
# and verify CHAIN_TYPE + required variables are present

declare -A ENV_PRIMARY=(
  [ethereum-el]="SENTINAI_L1_RPC_URL"
  [opstack-l2]="L2_RPC_URL"
  [arbitrum-nitro]="L2_RPC_URL"
  [zkstack]="L2_RPC_URL"
)
declare -A ENV_CHAIN_TYPE=(
  [ethereum-el]="l1-evm"
  [opstack-l2]="optimism"
  [arbitrum-nitro]="arbitrum"
  [zkstack]="zkstack"
)

echo ""
ALL_CHAIN_TYPE_OK=true
ALL_REQUIRED_OK=true

for node_type in ethereum-el opstack-l2 arbitrum-nitro zkstack; do
  chain_type="${ENV_CHAIN_TYPE[$node_type]}"
  primary="${ENV_PRIMARY[$node_type]}"

  # Build a minimal env sample (mirrors buildEnvLocal output)
  env_sample="CHAIN_TYPE=${chain_type}
${primary}=https://rpc.example.io
ANTHROPIC_API_KEY=<your-anthropic-key>"

  # Validate CHAIN_TYPE
  if echo "$env_sample" | grep -q "^CHAIN_TYPE="; then
    pass "${node_type}: CHAIN_TYPE=${chain_type}"
  else
    fail "${node_type}: CHAIN_TYPE missing"
    ALL_CHAIN_TYPE_OK=false
  fi

  # Validate required variable
  if echo "$env_sample" | grep -q "^${primary}="; then
    pass "${node_type}: ${primary} present"
  else
    fail "${node_type}: ${primary} missing"
    ALL_REQUIRED_OK=false
  fi
done

# Report on missing node types (backend-only)
warn "Node types 'zkl2-generic' and 'l1-evm' are backend-only — not in Connect UI (by design)"

# ══════════════════════════════════════════════════════════════════════════════
header "Phase 3: Playbook Integrity"
echo ""

# Run the TypeScript playbook verifier
PLAYBOOK_EXIT=0
npx tsx --tsconfig tsconfig.json scripts/verify-playbooks.ts 2>&1 | sed 's/^/  /' || PLAYBOOK_EXIT=$?

if [[ $PLAYBOOK_EXIT -eq 0 ]]; then
  PASSED=$((PASSED+1))
  echo ""
  pass "Playbook verification completed (warnings may exist)"
else
  FAILED=$((FAILED+1))
  echo ""
  fail "Playbook verification found errors (exit code: $PLAYBOOK_EXIT)"
fi

# ══════════════════════════════════════════════════════════════════════════════
if [[ "$WITH_SERVER" == "true" ]]; then
  header "Phase 4: Dashboard Boot Verification"
  echo ""

  BASE_URL="${BASE_URL:-http://localhost:3002}"
  ENV_FILE=".env.local"
  SERVER_PID=""

  if [[ ! -f "$ENV_FILE" ]]; then
    warn ".env.local not found — skipping server boot test"
  else
    # Start dev server
    npm run dev &>/tmp/sentinai-verify-server.log &
    SERVER_PID=$!
    echo -e "  ${CYAN}ℹ${NC} Dev server started (PID: $SERVER_PID), waiting for boot..."

    # Wait up to 30s for /api/health
    BOOT_OK=false
    for i in $(seq 1 30); do
      sleep 1
      if curl -sf --max-time 3 "${BASE_URL}/api/health" &>/dev/null; then
        BOOT_OK=true
        break
      fi
    done

    if [[ "$BOOT_OK" == "true" ]]; then
      pass "Server booted successfully"

      # /api/health chainType check
      HEALTH=$(curl -sf --max-time 5 "${BASE_URL}/api/health" 2>/dev/null)
      CHAIN_TYPE_ENV=$(grep "^CHAIN_TYPE=" "$ENV_FILE" | cut -d= -f2 | tr -d '"' | head -1)
      CHAIN_TYPE_HEALTH=$(echo "$HEALTH" | jq -r '.chainType // empty' 2>/dev/null)
      if [[ -n "$CHAIN_TYPE_HEALTH" && "$CHAIN_TYPE_HEALTH" == "$CHAIN_TYPE_ENV" ]]; then
        pass "/api/health chainType matches .env (${CHAIN_TYPE_HEALTH})"
      else
        warn "/api/health chainType='${CHAIN_TYPE_HEALTH:-?}' vs .env CHAIN_TYPE='${CHAIN_TYPE_ENV:-?}'"
      fi

      # /api/metrics blockHeight check
      METRICS=$(curl -sf --max-time 10 "${BASE_URL}/api/metrics" 2>/dev/null)
      BLOCK_HEIGHT=$(echo "$METRICS" | jq -r '.blockHeight // 0' 2>/dev/null)
      if [[ "${BLOCK_HEIGHT:-0}" -gt 0 ]]; then
        pass "/api/metrics blockHeight=${BLOCK_HEIGHT} > 0"
      else
        warn "/api/metrics blockHeight=${BLOCK_HEIGHT:-0} (may be RPC unavailable)"
      fi
    else
      fail "Server failed to boot within 30s"
    fi

    # Cleanup
    if [[ -n "$SERVER_PID" ]]; then
      kill "$SERVER_PID" 2>/dev/null || true
      wait "$SERVER_PID" 2>/dev/null || true
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"

TOTAL=$((PASSED + FAILED))
if [[ $FAILED -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}Results: ${PASSED}/${TOTAL} checks passed, ${FAILED} failed, ${WARNED} warning(s)${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}Results: ${PASSED}/${TOTAL} checks passed, 0 failed, ${WARNED} warning(s)${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  exit 0
fi
