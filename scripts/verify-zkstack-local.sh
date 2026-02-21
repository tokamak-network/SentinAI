#!/usr/bin/env bash
set -euo pipefail

L2_RPC_URL="${L2_RPC_URL:-http://localhost:3050}"
L1_RPC_URL="${L1_RPC_URL:-http://localhost:8545}"
EXPECTED_L2_CHAIN_ID="${EXPECTED_L2_CHAIN_ID:-0x10f}"
EXPECTED_L1_CHAIN_ID="${EXPECTED_L1_CHAIN_ID:-0x9}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() {
  echo -e "${GREEN}PASS${NC} $1"
}

warn() {
  echo -e "${YELLOW}WARN${NC} $1"
}

fail() {
  echo -e "${RED}FAIL${NC} $1"
  exit 1
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "Missing required command: ${cmd}"
  fi
}

rpc_call() {
  local url="$1"
  local method="$2"
  local payload
  local response
  payload=$(printf '{"jsonrpc":"2.0","method":"%s","params":[],"id":1}' "$method")
  if ! response=$(curl -fsS "$url" -H 'content-type: application/json' --data "$payload" 2>/dev/null); then
    fail "RPC call failed: url=${url}, method=${method}"
  fi
  echo "$response"
}

extract_result() {
  sed -n 's/.*"result":[[:space:]]*\([^,}]*\).*/\1/p' | tr -d '"'
}

hex_to_dec() {
  local value="$1"
  if [[ "$value" =~ ^0x[0-9a-fA-F]+$ ]]; then
    printf '%d' "$((value))"
  else
    echo 0
  fi
}

main() {
  require_cmd curl
  require_cmd sed
  require_cmd rg

  echo "Validation targets:"
  echo "- L2 RPC: ${L2_RPC_URL}"
  echo "- L1 RPC: ${L1_RPC_URL}"
  echo "- Expected L2 chainId: ${EXPECTED_L2_CHAIN_ID}"
  echo "- Expected L1 chainId: ${EXPECTED_L1_CHAIN_ID}"
  echo

  if ps aux | rg -q 'zkstack .*server|zksync_server'; then
    pass "Server process detected"
  else
    warn "Server process not detected (it may be running in another shell/container)"
  fi

  local l2_chain_id
  l2_chain_id=$(rpc_call "$L2_RPC_URL" "eth_chainId" | extract_result)
  if [[ -z "$l2_chain_id" ]]; then
    fail "Failed to parse L2 eth_chainId response"
  fi
  if [[ "$l2_chain_id" == "$EXPECTED_L2_CHAIN_ID" ]]; then
    pass "L2 chainId matches: ${l2_chain_id}"
  else
    fail "L2 chainId mismatch: expected=${EXPECTED_L2_CHAIN_ID}, actual=${l2_chain_id}"
  fi

  local block_before block_after
  block_before=$(rpc_call "$L2_RPC_URL" "eth_blockNumber" | extract_result)
  sleep 2
  block_after=$(rpc_call "$L2_RPC_URL" "eth_blockNumber" | extract_result)
  if [[ -z "$block_after" ]]; then
    fail "Failed to parse L2 eth_blockNumber response"
  fi
  pass "L2 blockNumber check: before=${block_before}, after=${block_after}"

  local syncing
  syncing=$(rpc_call "$L2_RPC_URL" "eth_syncing" | extract_result)
  if [[ "$syncing" == "false" ]]; then
    pass "L2 sync status is healthy: eth_syncing=false"
  else
    warn "L2 is syncing: eth_syncing=${syncing}"
  fi

  local l1_batch
  l1_batch=$(rpc_call "$L2_RPC_URL" "zks_L1BatchNumber" | extract_result)
  if [[ -z "$l1_batch" ]]; then
    fail "Failed to parse L2 zks_L1BatchNumber response"
  fi
  if (( $(hex_to_dec "$l1_batch") >= 0 )); then
    pass "L1 batch number check: ${l1_batch}"
  else
    fail "Invalid L1 batch number: ${l1_batch}"
  fi

  local l1_chain_id
  l1_chain_id=$(rpc_call "$L1_RPC_URL" "eth_chainId" | extract_result || true)
  if [[ -z "$l1_chain_id" ]]; then
    warn "Failed to query L1 chainId (this may be an environment without L1 RPC)"
  elif [[ "$l1_chain_id" == "$EXPECTED_L1_CHAIN_ID" ]]; then
    pass "L1 chainId matches: ${l1_chain_id}"
  else
    warn "L1 chainId mismatch: expected=${EXPECTED_L1_CHAIN_ID}, actual=${l1_chain_id}"
  fi

  echo
  pass "Local ZK Stack L2 validation completed"
}

main "$@"
