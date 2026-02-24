#!/usr/bin/env bash
# ============================================================
# start-arbitrum-orbit.sh
# Start Arbitrum Orbit L2 (nitro-testnode) for SentinAI monitoring.
# SentinAI itself is started separately.
#
# Usage:
#   bash scripts/start-arbitrum-orbit.sh
#
# Optional env vars:
#   NITRO_TESTNODE_DIR   clone destination  (default: ../nitro-testnode)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINAI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Configuration ────────────────────────────────────────────
NITRO_DIR="${NITRO_TESTNODE_DIR:-${SENTINAI_DIR}/../nitro-testnode}"
NITRO_DIR="$(cd "${NITRO_DIR}" 2>/dev/null && pwd || echo "${NITRO_DIR}")"
if [[ ! -d "${NITRO_DIR}" ]]; then
  _parent="$(cd "$(dirname "${NITRO_DIR}")" 2>/dev/null && pwd || dirname "${NITRO_DIR}")"
  NITRO_DIR="${_parent}/$(basename "${NITRO_DIR}")"
fi

L2_RPC="http://localhost:8547"
L2_CHAIN_ID=412346

# ── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

step() { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}!${NC}  $*"; }
err()  { echo -e "  ${RED}✗${NC}  $*" >&2; }
info() { echo -e "     $*"; }
die()  { err "$*"; exit 1; }

# ── Helpers ──────────────────────────────────────────────────
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

rpc_chain_id() {
  curl -fsS "$1" \
    -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true
}

NITRO_COMPOSE_FILE=""
resolve_compose_file() {
  for f in "${NITRO_DIR}/docker-compose.yaml" "${NITRO_DIR}/docker-compose.yml"; do
    [[ -f "$f" ]] && { NITRO_COMPOSE_FILE="$f"; return; }
  done
  die "docker-compose file not found in ${NITRO_DIR}"
}

dc() { docker compose -f "${NITRO_COMPOSE_FILE}" -p nitro-testnode "$@"; }

# ── Phase 1: Prerequisites ───────────────────────────────────
check_prereqs() {
  step "Checking prerequisites"
  for cmd in docker git jq curl; do
    require_cmd "$cmd"; ok "$cmd"
  done
  docker compose version >/dev/null 2>&1 \
    || die "docker compose plugin not found (need Docker Desktop 20+ or compose v2)"
  ok "docker compose"
}

# ── Phase 2: Clone ───────────────────────────────────────────
setup_repo() {
  step "Setting up nitro-testnode"
  if [[ -d "${NITRO_DIR}/.git" ]]; then
    ok "Already cloned at ${NITRO_DIR}"
    return
  fi
  info "Cloning → ${NITRO_DIR}"
  info "(submodules included — this may take a minute)"
  git clone --recurse-submodules \
    https://github.com/OffchainLabs/nitro-testnode.git \
    "${NITRO_DIR}"
  ok "Cloned"
}

# ── Phase 3: Start L2 ────────────────────────────────────────
start_l2() {
  step "Starting Arbitrum Orbit L2"

  local status
  status=$(dc ps --format json 2>/dev/null \
    | jq -r 'if type=="array" then .[] else . end | select(.Service=="sequencer") | .Health // .State' \
    2>/dev/null | head -1 || echo "")

  if [[ "$status" == "healthy" ]]; then
    ok "Sequencer already healthy — skipping init"
    return
  fi

  if [[ -n "$status" ]]; then
    warn "Sequencer not healthy (status: ${status}) — reinitializing"
    dc down -v 2>/dev/null || true
  fi

  info "First run: contract deployment + genesis (~3–5 min)..."
  (cd "${NITRO_DIR}" && ./test-node.bash --init --detach)
  ok "nitro-testnode started"
}

# ── Phase 4: Wait for RPC ────────────────────────────────────
wait_for_l2() {
  step "Waiting for L2 RPC"

  local max=180 interval=2 elapsed=0

  while true; do
    local result
    result=$(rpc_chain_id "${L2_RPC}")

    if [[ "${result}" == "0x66eee" ]]; then
      echo ""
      ok "L2 RPC ready — chainId=0x66eee (${L2_CHAIN_ID})"
      return 0
    fi

    elapsed=$((elapsed + interval))
    if [[ $elapsed -ge $max ]]; then
      echo ""
      err "Timeout after ${max}s — L2 RPC not responding"
      dc logs sequencer --tail=30 2>/dev/null || true
      die "L2 startup failed"
    fi

    printf "\r     Waiting for sequencer... %ds / %ds" "$elapsed" "$max"
    sleep "$interval"
  done
}

# ── Phase 5: Print SentinAI config ───────────────────────────
print_config() {
  step "Arbitrum Orbit L2 is ready"

  # Try to parse EOA addresses from logs
  local batch_poster validator
  batch_poster=$(dc logs poster 2>/dev/null \
    | grep -i "address\|account" | grep -oE '0x[0-9a-fA-F]{40}' | head -1 || echo "")
  validator=$(dc logs staker-unsafe 2>/dev/null \
    | grep -i "address\|account\|staker" | grep -oE '0x[0-9a-fA-F]{40}' | head -1 || echo "")

  echo ""
  echo -e "  ${BOLD}Running containers:${NC}"
  dc ps --format "table {{.Service}}\t{{.Status}}" 2>/dev/null | sed 's/^/     /' || true

  echo ""
  echo -e "  ${BOLD}${GREEN}Copy these values into your .env.local:${NC}"
  echo ""
  cat <<EOF
     L2_RPC_URL=http://localhost:8547
     CHAIN_TYPE=arbitrum
     L2_CHAIN_ID=${L2_CHAIN_ID}
     L2_IS_TESTNET=true
     L1_CHAIN=sepolia
     ORCHESTRATOR_TYPE=docker
     DOCKER_COMPOSE_FILE=${NITRO_COMPOSE_FILE}
     DOCKER_COMPOSE_PROJECT=nitro-testnode
     ARB_NODE_SERVICE=sequencer
     ARB_BATCHPOSTER_SERVICE=poster
     ARB_VALIDATOR_SERVICE=staker-unsafe
EOF

  if [[ -n "$batch_poster" ]]; then
    echo "     BATCH_POSTER_EOA_ADDRESS=${batch_poster}"
  else
    echo "     # BATCH_POSTER_EOA_ADDRESS=  (not detected — check: dc logs poster)"
  fi
  if [[ -n "$validator" ]]; then
    echo "     VALIDATOR_EOA_ADDRESS=${validator}"
  else
    echo "     # VALIDATOR_EOA_ADDRESS=     (not detected — check: dc logs staker-unsafe)"
  fi

  echo ""
  echo -e "  ${BOLD}Stop L2:${NC}       docker compose -f ${NITRO_COMPOSE_FILE} down"
  echo -e "  ${BOLD}Full reset:${NC}    docker compose -f ${NITRO_COMPOSE_FILE} down -v"
  echo -e "  ${BOLD}Live logs:${NC}     docker compose -f ${NITRO_COMPOSE_FILE} logs -f sequencer"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  Arbitrum Orbit L2  —  nitro-testnode        ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo -e "  nitro-testnode: ${NITRO_DIR}"
  echo ""

  check_prereqs
  setup_repo
  resolve_compose_file
  start_l2
  wait_for_l2
  print_config
}

main
