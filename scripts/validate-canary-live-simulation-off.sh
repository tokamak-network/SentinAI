#!/usr/bin/env bash
set -euo pipefail

# Validates canary readiness when switching SCALING_SIMULATION_MODE=false.
# Default mode performs read-only checks. Use --apply-writes to run live write validations.

BASE_URL=""
API_KEY=""
APPLY_WRITES="false"
VERIFY_ZERO_DOWNTIME="false"
TIMEOUT_SECONDS="30"
POLL_INTERVAL_SECONDS="2"
READ_ONLY_MODE="false"
HEALTH_PATH="/api/health"
HEALTH_PROBE_INTERVAL_SECONDS="1"
MAX_HEALTH_FAIL_RATE_PERCENT="2"
MAX_CONSECUTIVE_HEALTH_FAILS="3"

HEALTH_PROBE_LOG_FILE=""
HEALTH_PROBE_PID=""

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

usage() {
  cat << USAGE
Usage:
  $0 --base-url <url> --api-key <key> [--apply-writes] [--verify-zero-downtime] [--health-path <path>] [--timeout <seconds>] [--poll-interval <seconds>]

Examples:
  $0 --base-url https://sentinai.tokamak.network/thanos-sepolia --api-key '***'
  $0 --base-url https://sentinai.tokamak.network/thanos-sepolia --api-key '***' --apply-writes
  $0 --base-url https://sentinai.tokamak.network/thanos-sepolia --api-key '***' --apply-writes --verify-zero-downtime --health-path /api/health
USAGE
}

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  log "PASS: $*"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  log "FAIL: $*"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  log "WARN: $*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

api_get() {
  local path="$1"
  curl -fsS "${BASE_URL}${path}" -H 'accept: application/json'
}

api_post() {
  local path="$1"
  local body="$2"
  curl -sS -X POST "${BASE_URL}${path}" \
    -H 'content-type: application/json' \
    -H "x-api-key: ${API_KEY}" \
    -d "${body}"
}

api_patch() {
  local path="$1"
  local body="$2"
  curl -sS -X PATCH "${BASE_URL}${path}" \
    -H 'content-type: application/json' \
    -H "x-api-key: ${API_KEY}" \
    -d "${body}"
}

next_vcpu() {
  local current="$1"
  case "$current" in
    1) echo 2 ;;
    2) echo 4 ;;
    4) echo 8 ;;
    8) echo 4 ;;
    *) echo 2 ;;
  esac
}

wait_for_vcpu() {
  local expected="$1"
  local elapsed=0
  while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
    local state
    state="$(api_get '/api/scaler' | jq -r '.currentVcpu')"
    if [ "$state" = "$expected" ]; then
      return 0
    fi
    sleep "$POLL_INTERVAL_SECONDS"
    elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
  done
  return 1
}

start_health_probe() {
  HEALTH_PROBE_LOG_FILE="$(mktemp /tmp/sentinai-health-probe.XXXXXX.log)"
  local url="${BASE_URL}${HEALTH_PATH}"

  (
    while true; do
      local code
      code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "$url" || echo "000")"
      printf '%s\n' "$code" >> "$HEALTH_PROBE_LOG_FILE"
      sleep "$HEALTH_PROBE_INTERVAL_SECONDS"
    done
  ) &

  HEALTH_PROBE_PID="$!"
  log "Started health probe: url=${url}, interval=${HEALTH_PROBE_INTERVAL_SECONDS}s, pid=${HEALTH_PROBE_PID}"
}

stop_health_probe() {
  if [ -n "$HEALTH_PROBE_PID" ]; then
    kill "$HEALTH_PROBE_PID" >/dev/null 2>&1 || true
    wait "$HEALTH_PROBE_PID" >/dev/null 2>&1 || true
    HEALTH_PROBE_PID=""
  fi
}

evaluate_health_probe() {
  if [ -z "$HEALTH_PROBE_LOG_FILE" ] || [ ! -f "$HEALTH_PROBE_LOG_FILE" ]; then
    fail 'Health probe log file is missing.'
    return
  fi

  local total
  total="$(wc -l < "$HEALTH_PROBE_LOG_FILE" | tr -d ' ')"
  if [ "${total:-0}" -eq 0 ]; then
    fail 'Health probe captured no samples.'
    return
  fi

  local failed
  failed="$(awk '$1 !~ /^2[0-9][0-9]$/ {c++} END {print c+0}' "$HEALTH_PROBE_LOG_FILE")"
  local fail_rate
  fail_rate="$(awk -v f="$failed" -v t="$total" 'BEGIN { if (t==0) { print "100.00" } else { printf "%.2f", (f*100)/t } }')"
  local max_consecutive
  max_consecutive="$(awk '
    $1 ~ /^2[0-9][0-9]$/ { current=0; next }
    { current++; if (current > max) max=current }
    END { print max+0 }
  ' "$HEALTH_PROBE_LOG_FILE")"

  log "Health probe summary: total=${total}, failed=${failed}, failRate=${fail_rate}%, maxConsecutiveFails=${max_consecutive}"

  if awk -v x="$fail_rate" -v y="$MAX_HEALTH_FAIL_RATE_PERCENT" 'BEGIN { exit !(x <= y) }'; then
    pass "Health fail rate is within threshold (${fail_rate}% <= ${MAX_HEALTH_FAIL_RATE_PERCENT}%)."
  else
    fail "Health fail rate exceeded threshold (${fail_rate}% > ${MAX_HEALTH_FAIL_RATE_PERCENT}%)."
  fi

  if [ "$max_consecutive" -le "$MAX_CONSECUTIVE_HEALTH_FAILS" ]; then
    pass "Consecutive health failures are within threshold (${max_consecutive} <= ${MAX_CONSECUTIVE_HEALTH_FAILS})."
  else
    fail "Consecutive health failures exceeded threshold (${max_consecutive} > ${MAX_CONSECUTIVE_HEALTH_FAILS})."
  fi
}

check_json_field_equals() {
  local json="$1"
  local jq_expr="$2"
  local expected="$3"
  local actual
  actual="$(echo "$json" | jq -r "$jq_expr")"
  if [ "$actual" = "$expected" ]; then
    return 0
  fi
  log "Expected ${jq_expr}=${expected}, actual=${actual}"
  return 1
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --base-url)
        BASE_URL="$2"
        shift 2
        ;;
      --api-key)
        API_KEY="$2"
        shift 2
        ;;
      --apply-writes)
        APPLY_WRITES="true"
        shift
        ;;
      --verify-zero-downtime)
        VERIFY_ZERO_DOWNTIME="true"
        shift
        ;;
      --health-path)
        HEALTH_PATH="$2"
        shift 2
        ;;
      --timeout)
        TIMEOUT_SECONDS="$2"
        shift 2
        ;;
      --poll-interval)
        POLL_INTERVAL_SECONDS="$2"
        shift 2
        ;;
      --health-interval)
        HEALTH_PROBE_INTERVAL_SECONDS="$2"
        shift 2
        ;;
      --max-health-fail-rate)
        MAX_HEALTH_FAIL_RATE_PERCENT="$2"
        shift 2
        ;;
      --max-consecutive-health-fails)
        MAX_CONSECUTIVE_HEALTH_FAILS="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [ -z "$BASE_URL" ] || [ -z "$API_KEY" ]; then
    usage
    exit 1
  fi

  BASE_URL="${BASE_URL%/}"
}

main() {
  require_cmd curl
  require_cmd jq

  parse_args "$@"
  trap 'stop_health_probe' EXIT

  log "Starting canary validation against ${BASE_URL}"
  log "Mode: APPLY_WRITES=${APPLY_WRITES}, VERIFY_ZERO_DOWNTIME=${VERIFY_ZERO_DOWNTIME}"

  # 1) Auth/read-only checks
  local auth
  auth="$(api_get '/api/auth/config')"
  if check_json_field_equals "$auth" '.authRequired' 'true'; then
    pass 'Auth requirement is enabled on server.'
  else
    fail 'Server is not enforcing authRequired=true.'
  fi

  if check_json_field_equals "$auth" '.readOnly' 'false'; then
    pass 'Read-only mode is disabled for live operations.'
  else
    fail 'Read-only mode is enabled. Live write validation is blocked.'
    READ_ONLY_MODE="true"
  fi

  # 2) Goal Manager baseline availability
  local gm
  gm="$(api_get '/api/goal-manager?limit=20')"
  if check_json_field_equals "$gm" '.config.enabled' 'true'; then
    pass 'Goal Manager is enabled.'
  else
    fail 'Goal Manager is disabled.'
  fi

  if check_json_field_equals "$gm" '.config.dispatchEnabled' 'true'; then
    pass 'Goal Manager dispatch is enabled.'
  else
    fail 'Goal Manager dispatch is disabled.'
  fi

  # 3) Runtime simulation mode must be false (authoritative store value)
  local scaler_before
  scaler_before="$(api_get '/api/scaler')"
  local sim_before
  sim_before="$(echo "$scaler_before" | jq -r '.simulationMode')"
  local auto_before
  auto_before="$(echo "$scaler_before" | jq -r '.autoScalingEnabled')"
  local original_vcpu
  original_vcpu="$(echo "$scaler_before" | jq -r '.currentVcpu')"

  log "Initial scaler state: vcpu=${original_vcpu}, simulation=${sim_before}, autoScaling=${auto_before}"

  # Auth preflight: verify the provided API key can call protected POST endpoints.
  local auth_probe_status
  set +e
  auth_probe_status="$(curl -sS -o /tmp/sentinai_auth_probe.json -w '%{http_code}' -X POST \"${BASE_URL}/api/goal-manager/tick\" -H 'content-type: application/json' -H \"x-api-key: ${API_KEY}\" -d '{}')"
  set -e
  if [ "$auth_probe_status" = "401" ]; then
    fail 'API key authentication failed (401) on protected POST endpoint. Check --api-key value.'
    log "Validation summary: PASS=${PASS_COUNT}, WARN=${WARN_COUNT}, FAIL=${FAIL_COUNT}"
    exit 1
  fi

  if [ "$READ_ONLY_MODE" = "true" ]; then
    warn 'Skipping simulationMode=false switch check because read-only mode is enabled.'
  else
    local patch_state
    patch_state="$(api_patch '/api/scaler' '{"simulationMode":false,"autoScalingEnabled":true}')"
    if check_json_field_equals "$patch_state" '.simulationMode' 'false'; then
      pass 'simulationMode switched to false via API.'
    else
      fail 'Failed to switch simulationMode=false via API.'
    fi
  fi

  # 4) Failure path check: invalid target
  local invalid_resp
  set +e
  invalid_resp="$(curl -sS -o /tmp/sentinai_invalid_target.json -w '%{http_code}' -X POST "${BASE_URL}/api/scaler" -H 'content-type: application/json' -H "x-api-key: ${API_KEY}" -d '{"targetVcpu":3,"reason":"canary-invalid-target"}')"
  set -e
  if [ "$invalid_resp" = "400" ]; then
    pass 'Invalid scaling target is rejected with 400.'
  elif [ "$READ_ONLY_MODE" = "true" ] && [ "$invalid_resp" = "403" ]; then
    warn 'Invalid target check returned 403 due to read-only mode.'
  else
    fail "Invalid scaling target did not return 400 (got ${invalid_resp})."
  fi

  # 5) Goal Manager tick + dispatch dry-run path
  local tick
  tick="$(api_post '/api/goal-manager/tick' '{}')"
  if check_json_field_equals "$tick" '.enabled' 'true'; then
    pass 'Goal tick API works with auth.'
  else
    fail 'Goal tick did not return enabled=true.'
  fi

  local dispatch
  dispatch="$(api_post '/api/goal-manager/dispatch' '{"dryRun":true,"allowWrites":false}')"
  if echo "$dispatch" | jq -e '.enabled == true' >/dev/null 2>&1; then
    pass 'Goal dispatch dry-run API works.'
  else
    fail 'Goal dispatch dry-run failed.'
  fi

  # 6) Autonomous Ops dry-run chain: plan -> execute -> verify -> rollback
  local plan
  plan="$(api_post '/api/autonomous/plan' '{"intent":"recover_sequencer_path","dryRun":true,"allowWrites":false}')"
  local plan_id
  plan_id="$(echo "$plan" | jq -r '.plan.planId // empty')"
  if [ -n "$plan_id" ]; then
    pass "Autonomous plan created (${plan_id})."
  else
    fail 'Autonomous planId is missing.'
  fi

  local execute
  execute="$(api_post '/api/autonomous/execute' "{\"planId\":\"${plan_id}\",\"dryRun\":true,\"allowWrites\":false}")"
  local operation_id
  operation_id="$(echo "$execute" | jq -r '.result.operationId // empty')"
  if [ -n "$operation_id" ]; then
    pass "Autonomous execute created operation (${operation_id})."
  else
    fail 'Autonomous execute operationId is missing.'
  fi

  local verify
  verify="$(api_post '/api/autonomous/verify' "{\"operationId\":\"${operation_id}\"}")"
  if echo "$verify" | jq -e '.success == true and .result.operationId != null' >/dev/null 2>&1; then
    pass 'Autonomous verify API works.'
  else
    fail 'Autonomous verify API failed.'
  fi

  local rollback
  rollback="$(api_post '/api/autonomous/rollback' "{\"operationId\":\"${operation_id}\",\"dryRun\":true}")"
  if echo "$rollback" | jq -e '.success == true and .result.success != null' >/dev/null 2>&1; then
    pass 'Autonomous rollback API works.'
  else
    fail 'Autonomous rollback API failed.'
  fi

  # 7) Optional live-write scaling verification (actual canary resource mutation)
  if [ "$APPLY_WRITES" = "true" ]; then
    if [ "$READ_ONLY_MODE" = "true" ]; then
      fail 'Cannot run --apply-writes while read-only mode is enabled.'
      log "Validation summary: PASS=${PASS_COUNT}, WARN=${WARN_COUNT}, FAIL=${FAIL_COUNT}"
      exit 1
    fi

    local up_target
    up_target="$(next_vcpu "$original_vcpu")"
    if [ "$up_target" = "$original_vcpu" ]; then
      up_target="2"
    fi

    log "Live write test: scale ${original_vcpu} -> ${up_target}"

    if [ "$VERIFY_ZERO_DOWNTIME" = "true" ]; then
      local zd_patch
      zd_patch="$(api_patch '/api/scaler' '{"zeroDowntimeEnabled":true}')"
      if check_json_field_equals "$zd_patch" '.zeroDowntimeEnabled' 'true'; then
        pass 'Zero-downtime mode enabled for live validation.'
      else
        fail 'Failed to enable zero-downtime mode before live validation.'
      fi

      start_health_probe
    fi

    local up_resp
    up_resp="$(api_post '/api/scaler' "{\"targetVcpu\":${up_target},\"reason\":\"canary-live-validation-up\"}")"
    if echo "$up_resp" | jq -e '.success == true' >/dev/null 2>&1; then
      pass 'Manual live scaling request accepted.'
    else
      fail 'Manual live scaling request failed.'
    fi

    if wait_for_vcpu "$up_target"; then
      pass "vCPU reached target ${up_target}."
    else
      fail "vCPU did not reach target ${up_target} within timeout."
    fi

    # Cooldown behavior test: immediately request another target
    local cool_target
    cool_target="$(next_vcpu "$up_target")"
    if [ "$cool_target" = "$up_target" ]; then
      cool_target="$original_vcpu"
    fi

    set +e
    local cooldown_body
    cooldown_body="$(curl -sS -X POST "${BASE_URL}/api/scaler" -H 'content-type: application/json' -H "x-api-key: ${API_KEY}" -d "{\"targetVcpu\":${cool_target},\"reason\":\"canary-cooldown-check\"}")"
    set -e
    if echo "$cooldown_body" | jq -e '.success == false and (.error == "COOLDOWN" or (.message | test("Cooldown"; "i")))' >/dev/null 2>&1; then
      pass 'Cooldown protection blocks immediate repeated scaling.'
    else
      warn 'Cooldown block was not observed (cooldown may be disabled/zero).'
    fi

    # Wait for cooldown expiry if needed
    local state_after_up
    state_after_up="$(api_get '/api/scaler')"
    local remaining
    remaining="$(echo "$state_after_up" | jq -r '.cooldownRemaining // 0')"
    if [ "$remaining" != "0" ]; then
      log "Waiting for cooldown expiry (${remaining}s)..."
      sleep "$((remaining + 2))"
    fi

    # No-op test: request same vCPU
    local noop_resp
    noop_resp="$(api_post '/api/scaler' "{\"targetVcpu\":${up_target},\"reason\":\"canary-noop-check\"}")"
    if echo "$noop_resp" | jq -e '.success == true' >/dev/null 2>&1; then
      pass 'No-op scaling request handled successfully.'
    else
      fail 'No-op scaling request failed.'
    fi

    # Restore original vCPU
    log "Restoring original vCPU ${original_vcpu}"
    local restore_resp
    restore_resp="$(api_post '/api/scaler' "{\"targetVcpu\":${original_vcpu},\"reason\":\"canary-restore-original\"}")"
    if echo "$restore_resp" | jq -e '.success == true' >/dev/null 2>&1; then
      pass 'Restore scaling request accepted.'
    else
      fail 'Restore scaling request failed.'
    fi

    if wait_for_vcpu "$original_vcpu"; then
      pass "Original vCPU restored to ${original_vcpu}."
    else
      fail "Original vCPU was not restored to ${original_vcpu} within timeout."
    fi

    if [ "$VERIFY_ZERO_DOWNTIME" = "true" ]; then
      stop_health_probe
      evaluate_health_probe
    fi
  else
    warn 'Live write scaling tests were skipped. Use --apply-writes to validate actual resource mutation.'
    if [ "$VERIFY_ZERO_DOWNTIME" = "true" ]; then
      warn 'Zero-downtime validation requires --apply-writes; skipping.'
    fi
  fi

  # Summary
  log "----------------------------------------"
  log "Validation summary: PASS=${PASS_COUNT}, WARN=${WARN_COUNT}, FAIL=${FAIL_COUNT}"

  if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
  fi
}

main "$@"
