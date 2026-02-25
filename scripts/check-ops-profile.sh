#!/usr/bin/env bash
# Determine SentinAI operations profile from .env.local and environment overrides.

set -euo pipefail

PROFILE_OUTPUT="text"
ENV_FILE=".env.local"

for arg in "$@"; do
  case "$arg" in
    --json) PROFILE_OUTPUT="json" ;;
    --env-file=*) ENV_FILE="${arg#--env-file=}" ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: bash scripts/check-ops-profile.sh [--json] [--env-file=path]" >&2
      exit 1
      ;;
  esac
done

if [ -f "$ENV_FILE" ]; then
  # Load .env.local without overriding already-exported values.
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line%%$'\r'}"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | xargs)"

    # Remove optional wrapping quotes.
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    if [ -n "$key" ] && [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

CHAIN_TYPE_RAW="${CHAIN_TYPE:-thanos}"
CHAIN_TYPE="$(printf '%s' "$CHAIN_TYPE_RAW" | tr '[:upper:]' '[:lower:]')"
case "$CHAIN_TYPE" in
  op-stack|my-l2) CHAIN_TYPE="optimism" ;;
  arbitrum-orbit|nitro) CHAIN_TYPE="arbitrum" ;;
  zksync|zk-stack) CHAIN_TYPE="zkstack" ;;
esac

ORCHESTRATOR_TYPE_RAW="${ORCHESTRATOR_TYPE:-k8s}"
ORCHESTRATOR_TYPE="$(printf '%s' "$ORCHESTRATOR_TYPE_RAW" | tr '[:upper:]' '[:lower:]')"

AWS_CLUSTER_NAME_VALUE="${AWS_CLUSTER_NAME:-}"
SCALING_SIMULATION_MODE_VALUE="$(printf '%s' "${SCALING_SIMULATION_MODE:-}" | tr '[:upper:]' '[:lower:]')"
NODE_ENV_VALUE="$(printf '%s' "${NODE_ENV:-development}" | tr '[:upper:]' '[:lower:]')"
GOAL_AUTONOMY_LEVEL_VALUE="${GOAL_AUTONOMY_LEVEL:-A2}"

SENTINAI_API_KEY_VALUE="${SENTINAI_API_KEY:-}"
NEXT_PUBLIC_SENTINAI_API_KEY_VALUE="${NEXT_PUBLIC_SENTINAI_API_KEY:-}"

if [ "$ORCHESTRATOR_TYPE" = "docker" ]; then
  DEPLOYMENT_ENV="local_docker"
elif [ -n "$AWS_CLUSTER_NAME_VALUE" ]; then
  DEPLOYMENT_ENV="eks"
else
  DEPLOYMENT_ENV="local_k8s"
fi

if [ "$DEPLOYMENT_ENV" = "local_docker" ] && [ "$SCALING_SIMULATION_MODE_VALUE" = "true" ]; then
  PROFILE_NAME="DEV_DOCKER_SAFE"
elif [ "$DEPLOYMENT_ENV" = "local_docker" ]; then
  PROFILE_NAME="DEV_DOCKER_ACTIVE"
elif [ "$DEPLOYMENT_ENV" = "local_k8s" ] && [ "$SCALING_SIMULATION_MODE_VALUE" = "false" ]; then
  PROFILE_NAME="DEV_K8S_ACTIVE"
elif [ "$DEPLOYMENT_ENV" = "local_k8s" ]; then
  PROFILE_NAME="DEV_K8S_SIM"
elif [ "$DEPLOYMENT_ENV" = "eks" ] && [ "$NODE_ENV_VALUE" = "production" ] && [ "$SCALING_SIMULATION_MODE_VALUE" = "false" ]; then
  PROFILE_NAME="PROD_EKS_CONTROLLED"
elif [ "$DEPLOYMENT_ENV" = "eks" ] && [ "$NODE_ENV_VALUE" = "production" ]; then
  PROFILE_NAME="PROD_EKS_OBSERVE_ONLY"
else
  PROFILE_NAME="EKS_NON_PROD"
fi

case "$CHAIN_TYPE" in
  thanos|optimism)
    STACK_ACTION_FAMILY="op_stack_family"
    PRIMARY_ACTIONS="scale_execution,restart_batcher,restart_proposer"
    ;;
  arbitrum)
    STACK_ACTION_FAMILY="orbit_family"
    PRIMARY_ACTIONS="scale_sequencer,restart_batch_poster,restart_validator"
    ;;
  zkstack)
    STACK_ACTION_FAMILY="zk_family"
    PRIMARY_ACTIONS="scale_core_execution,restart_prover,restart_batcher_pipeline"
    ;;
  *)
    STACK_ACTION_FAMILY="unknown"
    PRIMARY_ACTIONS="collect_metrics"
    ;;
esac

HAS_WRITE_AUTH="false"
if [ -n "$SENTINAI_API_KEY_VALUE" ]; then
  HAS_WRITE_AUTH="true"
fi

BROWSER_KEY_MATCH="false"
if [ -n "$SENTINAI_API_KEY_VALUE" ] && [ "$SENTINAI_API_KEY_VALUE" = "$NEXT_PUBLIC_SENTINAI_API_KEY_VALUE" ]; then
  BROWSER_KEY_MATCH="true"
fi

SEED_ALLOWED="true"
if [ "$NODE_ENV_VALUE" = "production" ]; then
  SEED_ALLOWED="false"
fi

WRITE_EXECUTION_EXPECTED="true"
if [ "$SCALING_SIMULATION_MODE_VALUE" = "true" ]; then
  WRITE_EXECUTION_EXPECTED="false"
fi

RECOMMENDED_MODE="A2 + dry-run"
if [ "$PROFILE_NAME" = "PROD_EKS_CONTROLLED" ]; then
  RECOMMENDED_MODE="A2 start -> gated A3+"
fi

if [ "$PROFILE_OUTPUT" = "json" ]; then
  cat <<JSON
{
  "profileName": "${PROFILE_NAME}",
  "deploymentEnv": "${DEPLOYMENT_ENV}",
  "chainType": "${CHAIN_TYPE}",
  "stackActionFamily": "${STACK_ACTION_FAMILY}",
  "primaryActions": "${PRIMARY_ACTIONS}",
  "recommendedMode": "${RECOMMENDED_MODE}",
  "seedAllowed": ${SEED_ALLOWED},
  "writeExecutionExpected": ${WRITE_EXECUTION_EXPECTED},
  "hasWriteAuth": ${HAS_WRITE_AUTH},
  "browserKeyMatch": ${BROWSER_KEY_MATCH},
  "signals": {
    "orchestratorType": "${ORCHESTRATOR_TYPE}",
    "awsClusterName": "${AWS_CLUSTER_NAME_VALUE}",
    "scalingSimulationMode": "${SCALING_SIMULATION_MODE_VALUE}",
    "nodeEnv": "${NODE_ENV_VALUE}",
    "goalAutonomyLevel": "${GOAL_AUTONOMY_LEVEL_VALUE}"
  }
}
JSON
  exit 0
fi

cat <<TEXT
[SentinAI Ops Profile]
profile        : ${PROFILE_NAME}
deploymentEnv  : ${DEPLOYMENT_ENV}
chainType      : ${CHAIN_TYPE}
actionFamily   : ${STACK_ACTION_FAMILY}
primaryActions : ${PRIMARY_ACTIONS}
recommended    : ${RECOMMENDED_MODE}

[Feature Gates]
seedAllowed            : ${SEED_ALLOWED}
writeExecutionExpected : ${WRITE_EXECUTION_EXPECTED}
hasWriteAuth           : ${HAS_WRITE_AUTH}
browserKeyMatch        : ${BROWSER_KEY_MATCH}

[Input Signals]
orchestratorType      : ${ORCHESTRATOR_TYPE}
awsClusterName        : ${AWS_CLUSTER_NAME_VALUE:-<empty>}
scalingSimulationMode : ${SCALING_SIMULATION_MODE_VALUE:-<empty>}
nodeEnv               : ${NODE_ENV_VALUE}
goalAutonomyLevel     : ${GOAL_AUTONOMY_LEVEL_VALUE}

[Immediate Actions]
1) Verify Cockpit flow: plan -> execute(dry-run) -> verify -> rollback.
2) Keep A2 until verification is stable; then consider gated A3+.
3) If write APIs fail, align SENTINAI_API_KEY and NEXT_PUBLIC_SENTINAI_API_KEY.
4) If seed fails, check NODE_ENV (production blocks metrics/seed).
TEXT
