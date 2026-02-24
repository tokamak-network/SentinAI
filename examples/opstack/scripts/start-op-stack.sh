#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FETCH_SCRIPT="${SCRIPT_DIR}/fetch-opstack.sh"

FORCE_SETUP=0
FORCE_FETCH=0
SKIP_L1_TEST=0
SETUP_EXECUTED=0
DOCKER_RESET_REQUIRED=0
CURRENT_L2_GENESIS_HASH=''
FORK_COMPAT_CHANGED=0

OPSTACK_DOCKER_PROJECT_DEFAULT="create-l2-rollup-example"
OPSTACK_OP_DEPLOYER_REF_DEFAULT="op-deployer/v0.6.0-rc.3"

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

print_help() {
  cat <<'EOF_HELP'
Start local OP Stack L2 using upstream example fetched on demand.

Usage:
  ./scripts/start-op-stack.sh [options]

Options:
  --force-fetch   Re-download upstream example even when cache exists
  --force-setup   Force full setup (re-deploy contracts/configs)
  --skip-l1-test  Skip L1 RPC smoke test
  -h, --help      Show help
EOF_HELP
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
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

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force-fetch)
        FORCE_FETCH=1
        ;;
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

ensure_host_execution() {
  if [ -f "/.dockerenv" ]; then
    fail 'Run this script on the host machine, not inside a container.'
  fi
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
  local runtime_dir="$1"

  [ -f "$runtime_dir/deployer/.deployer/state.json" ] &&
  [ -f "$runtime_dir/sequencer/genesis.json" ] &&
  [ -f "$runtime_dir/sequencer/rollup.json" ] &&
  [ -f "$runtime_dir/batcher/.env" ] &&
  [ -f "$runtime_dir/proposer/.env" ] &&
  [ -f "$runtime_dir/challenger/.env" ] &&
  compgen -G "$runtime_dir/challenger/*.bin.gz" >/dev/null
}

sync_runtime_env() {
  local runtime_dir="$1"

  rm -f "$runtime_dir/.env"
  if ! ln -s "$WORK_DIR/.env" "$runtime_dir/.env"; then
    fail "Failed to synchronize .env into upstream runtime directory: ${runtime_dir}"
  fi
}

ensure_op_deployer() {
  local runtime_dir="$1"
  local expected_ref="${OPSTACK_OP_DEPLOYER_REF:-$OPSTACK_OP_DEPLOYER_REF_DEFAULT}"
  local marker_file="${runtime_dir}/.op-deployer-ref"

  if [ "$expected_ref" = "main" ] || [ "$expected_ref" = "latest" ]; then
    fail "OPSTACK_OP_DEPLOYER_REF='${expected_ref}' is not allowed. Use a pinned release tag."
  fi

  if [ -x "$runtime_dir/op-deployer" ] && [ -f "$marker_file" ]; then
    local current_ref
    current_ref="$(cat "$marker_file" 2>/dev/null || true)"
    if [ "$current_ref" = "$expected_ref" ]; then
      return 0
    fi

    log_info "op-deployer ref changed (${current_ref:-unknown} -> ${expected_ref}). Re-downloading..."
  elif [ -x "$runtime_dir/op-deployer" ]; then
    log_info 'op-deployer ref marker not found. Re-downloading pinned op-deployer...'
  else
    log_info 'op-deployer not found in runtime cache. Downloading...'
  fi

  if ! (cd "$runtime_dir" && OPSTACK_OP_DEPLOYER_REF="$expected_ref" ./scripts/download-op-deployer.sh); then
    fail "Failed to download pinned op-deployer '${expected_ref}'. Check network access and OPSTACK_OP_DEPLOYER_REF."
  fi

  if ! printf '%s\n' "$expected_ref" > "$marker_file"; then
    fail "Failed to write op-deployer marker file: ${marker_file}"
  fi

  if [ ! -x "$runtime_dir/op-deployer" ]; then
    fail 'op-deployer binary is missing after download. Check download logs and retry.'
  fi
}

run_setup_if_needed() {
  local runtime_dir="$1"

  if [ "$FORCE_SETUP" -eq 1 ]; then
    log_info 'Running full setup (forced)...'
    if ! (cd "$runtime_dir" && ./scripts/setup-rollup.sh); then
      fail 'Forced setup failed. Check L1 RPC/private key balance/logs and retry.'
    fi
    SETUP_EXECUTED=1
    return 0
  fi

  if is_setup_ready "$runtime_dir"; then
    log_info 'Existing deployment artifacts found. Skipping setup.'
    return 0
  fi

  log_info 'Deployment artifacts not found. Running setup...'
  if ! (cd "$runtime_dir" && ./scripts/setup-rollup.sh); then
    fail 'Setup failed. Check L1 RPC/private key balance/logs and retry.'
  fi
  SETUP_EXECUTED=1
}

normalize_runtime_rollup_configs() {
  local runtime_dir="$1"
  local files=(
    "$runtime_dir/sequencer/rollup.json"
    "$runtime_dir/challenger/rollup.json"
  )
  local file
  local tmp_file
  local changed=0

  for file in "${files[@]}"; do
    [ -f "$file" ] || fail "Missing rollup config file: ${file}. Run with --force-setup and retry."

    if jq -e '.minBaseFee? != null or .genesis.system_config.minBaseFee? != null or .genesis.system_config.daFootprintGasScalar? != null or .genesis.system_config.operatorFeeParams? != null' "$file" >/dev/null 2>&1; then
      tmp_file="${file}.tmp"
      if ! jq 'del(.minBaseFee, .genesis.system_config.minBaseFee, .genesis.system_config.daFootprintGasScalar, .genesis.system_config.operatorFeeParams)' "$file" > "$tmp_file"; then
        rm -f "$tmp_file" || true
        fail "Failed to normalize rollup config: ${file}. Check file format and retry."
      fi

      mv "$tmp_file" "$file" || fail "Failed to replace normalized rollup config: ${file}"
      log_info "Normalized rollup config for op-node compatibility: ${file}"
      changed=1
    fi

    if ! jq -e '(.minBaseFee? == null) and (.genesis.system_config.minBaseFee? == null) and (.genesis.system_config.daFootprintGasScalar? == null) and (.genesis.system_config.operatorFeeParams? == null)' "$file" >/dev/null 2>&1; then
      fail "Rollup config still contains unsupported op-node fields: ${file}. Run with --force-setup and retry."
    fi
  done

  if [ "$changed" -eq 0 ]; then
    log_info 'Rollup config compatibility check passed.'
  fi
}

apply_runtime_fork_compatibility() {
  local runtime_dir="$1"
  local rollup_files=(
    "$runtime_dir/sequencer/rollup.json"
    "$runtime_dir/challenger/rollup.json"
  )
  local genesis_files=(
    "$runtime_dir/sequencer/genesis.json"
    "$runtime_dir/challenger/genesis.json"
  )
  local file
  local tmp_file
  local changed=0

  for file in "${rollup_files[@]}"; do
    [ -f "$file" ] || fail "Missing rollup config file: ${file}. Run with --force-setup and retry."

    if jq -e '.holocene_time != null or .isthmus_time != null or .jovian_time != null' "$file" >/dev/null 2>&1; then
      tmp_file="${file}.tmp"
      if ! jq '.holocene_time = null | .isthmus_time = null | .jovian_time = null' "$file" > "$tmp_file"; then
        rm -f "$tmp_file" || true
        fail "Failed to patch fork schedule in rollup config: ${file}"
      fi
      mv "$tmp_file" "$file" || fail "Failed to replace patched rollup config: ${file}"
      changed=1
    fi

    if ! jq -e '.holocene_time == null and .isthmus_time == null and .jovian_time == null' "$file" >/dev/null 2>&1; then
      fail "Fork compatibility patch verification failed for rollup config: ${file}"
    fi
  done

  for file in "${genesis_files[@]}"; do
    [ -f "$file" ] || fail "Missing genesis config file: ${file}. Run with --force-setup and retry."

    if jq -e '.config.holoceneTime != null or .config.isthmusTime != null or .config.jovianTime != null or .config.pragueTime != null' "$file" >/dev/null 2>&1; then
      tmp_file="${file}.tmp"
      if ! jq '.config.holoceneTime = null | .config.isthmusTime = null | .config.jovianTime = null | .config.pragueTime = null' "$file" > "$tmp_file"; then
        rm -f "$tmp_file" || true
        fail "Failed to patch fork schedule in genesis config: ${file}"
      fi
      mv "$tmp_file" "$file" || fail "Failed to replace patched genesis config: ${file}"
      changed=1
    fi

    if ! jq -e '.config.holoceneTime == null and .config.isthmusTime == null and .config.jovianTime == null and .config.pragueTime == null' "$file" >/dev/null 2>&1; then
      fail "Fork compatibility patch verification failed for genesis config: ${file}"
    fi
  done

  if [ "$changed" -eq 1 ]; then
    FORK_COMPAT_CHANGED=1
    log_info 'Applied legacy fork compatibility patch (Holocene/Isthmus/Jovian/Prague disabled).'
  else
    FORK_COMPAT_CHANGED=0
    log_info 'Fork compatibility check passed.'
  fi
}

sync_rollup_l2_hash_from_logs() {
  local runtime_dir="$1"
  local op_node_logs="$2"
  local detected_hash=''
  local previous_hash=''
  local file
  local tmp_file

  detected_hash="$(printf '%s\n' "$op_node_logs" | sed -n 's/.*genesis block number 0: \(0x[0-9a-fA-F]\{64\}\) <> \(0x[0-9a-fA-F]\{64\}\).*/\1/p' | tail -n 1)"
  previous_hash="$(printf '%s\n' "$op_node_logs" | sed -n 's/.*genesis block number 0: \(0x[0-9a-fA-F]\{64\}\) <> \(0x[0-9a-fA-F]\{64\}\).*/\2/p' | tail -n 1)"

  if [ -z "$detected_hash" ] || [ "$detected_hash" = "$previous_hash" ]; then
    return 1
  fi

  for file in "$runtime_dir/sequencer/rollup.json" "$runtime_dir/challenger/rollup.json"; do
    [ -f "$file" ] || fail "Missing rollup config file for hash sync: ${file}"
    tmp_file="${file}.tmp"
    if ! jq --arg hash "$detected_hash" '.genesis.l2.hash = $hash' "$file" > "$tmp_file"; then
      rm -f "$tmp_file" || true
      fail "Failed to synchronize rollup genesis hash in ${file}"
    fi
    mv "$tmp_file" "$file" || fail "Failed to update rollup genesis hash in ${file}"
  done

  CURRENT_L2_GENESIS_HASH="$detected_hash"
  log_warn "Detected rollup/genesis hash mismatch (${previous_hash} -> ${detected_hash}). Updated rollup configs and will retry startup once."
  return 0
}

resolve_docker_reset_requirement() {
  local runtime_dir="$1"
  local hash_marker="${runtime_dir}/.last-l2-genesis-hash"
  local previous_hash=''

  CURRENT_L2_GENESIS_HASH="$(jq -r '.genesis.l2.hash // empty' "$runtime_dir/sequencer/rollup.json")"
  [ -n "$CURRENT_L2_GENESIS_HASH" ] || fail 'Could not read genesis L2 hash from sequencer/rollup.json.'

  if [ "$SETUP_EXECUTED" -eq 1 ] || [ "$FORK_COMPAT_CHANGED" -eq 1 ]; then
    DOCKER_RESET_REQUIRED=1
    return 0
  fi

  if [ ! -f "$hash_marker" ]; then
    DOCKER_RESET_REQUIRED=1
    return 0
  fi

  previous_hash="$(cat "$hash_marker" 2>/dev/null || true)"
  if [ "$previous_hash" != "$CURRENT_L2_GENESIS_HASH" ]; then
    DOCKER_RESET_REQUIRED=1
    return 0
  fi

  DOCKER_RESET_REQUIRED=0
}

start_services() {
  local runtime_dir="$1"
  local compose_project="${OPSTACK_DOCKER_PROJECT:-$OPSTACK_DOCKER_PROJECT_DEFAULT}"
  local hash_marker="${runtime_dir}/.last-l2-genesis-hash"
  local op_node_logs=''

  if [ "$DOCKER_RESET_REQUIRED" -eq 1 ]; then
    log_info 'Resetting Docker Compose stack and volumes to match current genesis configuration...'
    "${DOCKER_COMPOSE_CMD[@]}" -f "$runtime_dir/docker-compose.yml" -p "$compose_project" down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  log_info "Starting OP Stack services with Docker Compose project '${compose_project}'"
  if ! "${DOCKER_COMPOSE_CMD[@]}" -f "$runtime_dir/docker-compose.yml" -p "$compose_project" up -d --wait; then
    op_node_logs="$(docker logs op-node --tail 200 2>&1 || true)"
    if sync_rollup_l2_hash_from_logs "$runtime_dir" "$op_node_logs"; then
      log_info 'Retrying Docker Compose startup after rollup hash synchronization...'
      "${DOCKER_COMPOSE_CMD[@]}" -f "$runtime_dir/docker-compose.yml" -p "$compose_project" down -v --remove-orphans >/dev/null 2>&1 || true
      if ! "${DOCKER_COMPOSE_CMD[@]}" -f "$runtime_dir/docker-compose.yml" -p "$compose_project" up -d --wait; then
        fail 'Docker Compose startup failed after rollup hash synchronization. Check op-node/op-geth logs and retry.'
      fi
    else
      fail 'Docker Compose startup failed. Check Docker daemon status and service logs.'
    fi
  fi

  CURRENT_L2_GENESIS_HASH="$(jq -r '.genesis.l2.hash // empty' "$runtime_dir/sequencer/rollup.json")"
  [ -n "$CURRENT_L2_GENESIS_HASH" ] || fail 'Could not read final genesis L2 hash after startup.'

  if ! printf '%s\n' "$CURRENT_L2_GENESIS_HASH" > "$hash_marker"; then
    fail "Failed to write genesis hash marker: ${hash_marker}"
  fi
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
  local runtime_dir="$1"
  local compose_project="${OPSTACK_DOCKER_PROJECT:-$OPSTACK_DOCKER_PROJECT_DEFAULT}"

  cat <<EOF

OP Stack L2 testnet is running.

Upstream runtime directory:
  ${runtime_dir}

Compose file:
  ${runtime_dir}/docker-compose.yml

Endpoints:
  L2 RPC:            http://localhost:8545
  Rollup RPC:        http://localhost:8547
  Dispute Metrics:   http://localhost:7300/metrics

Next:
  1) Configure SentinAI .env.local with:
     - ORCHESTRATOR_TYPE=docker
     - DOCKER_COMPOSE_FILE=${runtime_dir}/docker-compose.yml
     - DOCKER_COMPOSE_PROJECT=${compose_project}
     - CHAIN_TYPE=optimism
     - L2_RPC_URL=http://localhost:8545
  2) Start SentinAI: npm run dev
EOF
}

main() {
  parse_args "$@"
  ensure_host_execution

  require_cmd curl
  require_cmd jq
  require_cmd docker
  detect_docker_compose

  [ -x "$FETCH_SCRIPT" ] || fail "Fetch script not found: ${FETCH_SCRIPT}"

  load_env
  validate_required_env

  local fetch_args=()
  if [ "$FORCE_FETCH" -eq 1 ]; then
    fetch_args+=(--force)
  fi

  local runtime_dir
  runtime_dir="$($FETCH_SCRIPT "${fetch_args[@]}")"
  [ -d "$runtime_dir" ] || fail "Fetched runtime directory does not exist: ${runtime_dir}"

  sync_runtime_env "$runtime_dir"
  ensure_op_deployer "$runtime_dir"
  run_setup_if_needed "$runtime_dir"
  normalize_runtime_rollup_configs "$runtime_dir"
  apply_runtime_fork_compatibility "$runtime_dir"
  resolve_docker_reset_requirement "$runtime_dir"
  start_services "$runtime_dir"
  test_l2_connectivity

  if [ "$SKIP_L1_TEST" -eq 0 ]; then
    test_l1_connectivity
  else
    log_warn 'Skipping L1 connectivity check (--skip-l1-test).'
  fi

  print_summary "$runtime_dir"
}

main "$@"
