#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FORCE_SETUP=0
SKIP_L1_TEST=0

print_help() {
  cat <<'EOF'
One-click launcher for OP Stack local L2 testnet.

Usage:
  ./scripts/start-op-stack.sh [options]

Options:
  --force-setup  Force full setup (re-deploy contracts/configs) even if artifacts exist
  --skip-l1-test Skip L1 RPC smoke test after startup
  -h, --help     Show this help
EOF
}

log_info() {
  printf '[INFO] %s\n' "$1"
}

log_warn() {
  printf '[WARN] %s\n' "$1"
}

log_error() {
  printf '[ERROR] %s\n' "$1" >&2
}

fail() {
  log_error "$1"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
}

detect_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD=(docker-compose)
    return 0
  fi

  fail 'Docker Compose is not available. Install Docker Compose plugin or docker-compose.'
}

ensure_host_execution() {
  if [ -f "/.dockerenv" ]; then
    fail 'Run this script on the host machine, not inside a container.'
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force-setup)
        FORCE_SETUP=1
        ;;
      --skip-l1-test)
        SKIP_L1_TEST=1
        ;;
      -h|--help)
        print_help
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

load_env() {
  if [ ! -f "$WORK_DIR/.env" ]; then
    fail ".env not found at $WORK_DIR/.env. Copy .env.example to .env and fill required values first."
  fi

  # shellcheck disable=SC1090
  set -a
  source "$WORK_DIR/.env"
  set +a
}

validate_required_env() {
  local required_vars=(L1_RPC_URL L1_BEACON_URL PRIVATE_KEY L2_CHAIN_ID)
  local key

  for key in "${required_vars[@]}"; do
    if [ -z "${!key:-}" ]; then
      fail "Missing required .env variable: $key"
    fi
  done

  if [[ "$PRIVATE_KEY" == 0x* ]]; then
    log_warn 'PRIVATE_KEY should not include 0x prefix.'
  fi
}

is_setup_ready() {
  [ -f "$WORK_DIR/deployer/.deployer/state.json" ] &&
  [ -f "$WORK_DIR/sequencer/genesis.json" ] &&
  [ -f "$WORK_DIR/sequencer/rollup.json" ] &&
  [ -f "$WORK_DIR/batcher/.env" ] &&
  [ -f "$WORK_DIR/proposer/.env" ] &&
  [ -f "$WORK_DIR/challenger/.env" ] &&
  compgen -G "$WORK_DIR/challenger/*.bin.gz" >/dev/null
}

ensure_prerequisites() {
  require_cmd docker
  require_cmd git
  require_cmd jq
  require_cmd curl
  require_cmd openssl

  docker info >/dev/null 2>&1 || fail 'Docker daemon is not running.'
  detect_docker_compose
}

ensure_op_deployer() {
  if [ -x "$WORK_DIR/op-deployer" ]; then
    return 0
  fi

  log_info 'op-deployer not found. Downloading...'
  "$WORK_DIR/scripts/download-op-deployer.sh"
}

run_setup_if_needed() {
  if [ "$FORCE_SETUP" -eq 1 ]; then
    log_info 'Running full setup (forced)...'
    "$WORK_DIR/scripts/setup-rollup.sh"
    return 0
  fi

  if is_setup_ready; then
    log_info 'Existing deployment artifacts found. Skipping setup.'
    return 0
  fi

  log_info 'Deployment artifacts not found. Running setup...'
  "$WORK_DIR/scripts/setup-rollup.sh"
}

start_services() {
  log_info 'Starting OP Stack services with Docker Compose...'
  "${DOCKER_COMPOSE_CMD[@]}" -f "$WORK_DIR/docker-compose.yml" up -d --wait
}

test_l2_connectivity() {
  local block_number

  block_number=$(curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://localhost:8545 | jq -r '.result // empty')

  [ -n "$block_number" ] || fail 'L2 RPC check failed (eth_blockNumber returned empty result).'
  log_info "L2 RPC ready: eth_blockNumber=${block_number}"
}

test_l1_connectivity() {
  local l1_head

  l1_head=$(curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "$L1_RPC_URL" | jq -r '.result // empty')

  [ -n "$l1_head" ] || fail 'L1 RPC check failed (eth_blockNumber returned empty result).'
  log_info "L1 RPC ready: eth_blockNumber=${l1_head}"
}

print_summary() {
  cat <<EOF

OP Stack L2 testnet is running.

Compose file:
  $WORK_DIR/docker-compose.yml

Endpoints:
  L2 RPC:            http://localhost:8545
  Rollup RPC:        http://localhost:8547
  Dispute Metrics:   http://localhost:7300/metrics

Next:
  1) Configure SentinAI .env.local with:
     - ORCHESTRATOR_TYPE=docker
     - DOCKER_COMPOSE_FILE=$WORK_DIR/docker-compose.yml
     - DOCKER_COMPOSE_PROJECT=create-l2-rollup-example
     - CHAIN_TYPE=optimism
     - L2_RPC_URL=http://localhost:8545
  2) Start SentinAI: npm run dev
EOF
}

main() {
  parse_args "$@"
  ensure_host_execution
  ensure_prerequisites
  load_env
  validate_required_env

  cd "$WORK_DIR"
  ensure_op_deployer
  run_setup_if_needed
  start_services
  test_l2_connectivity

  if [ "$SKIP_L1_TEST" -eq 0 ]; then
    test_l1_connectivity
  else
    log_warn 'Skipping L1 connectivity check (--skip-l1-test).'
  fi

  print_summary
}

main "$@"
