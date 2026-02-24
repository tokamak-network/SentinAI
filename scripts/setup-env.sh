#!/usr/bin/env bash
# ============================================================
# SentinAI Environment Setup (.env.local generator)
# macOS / Linux compatible — no Docker/AWS install steps.
#
# Usage:
#   bash scripts/setup-env.sh            # Interactive wizard
#   INSTALL_MODE=advanced bash scripts/setup-env.sh  # Full optional prompts
#
# Non-interactive mode (CI/CD, scripting):
#   Set L2_RPC_URL + one AI key → runs without prompts.
#   Uses the same variable names as .env.local — no prefix needed.
#
#   Required:
#     L2_RPC_URL=https://rpc.example.com
#     ANTHROPIC_API_KEY=sk-ant-...  # or OPENAI_API_KEY / GEMINI_API_KEY / QWEN_API_KEY
#
#   Optional:
#     CHAIN_TYPE=thanos              # thanos | optimism | my-l2 | op-stack | zkstack | arbitrum | arbitrum-orbit | nitro
#     AWS_CLUSTER_NAME=my-cluster
#     AWS_PROFILE=my-profile
#     AWS_REGION=ap-northeast-2
#     K8S_NAMESPACE=default
#     K8S_APP_PREFIX=op
#     K8S_STATEFULSET_PREFIX=sepolia-thanos-stack
#     ORCHESTRATOR_TYPE=k8s          # k8s | docker
#     DOCKER_COMPOSE_FILE=docker-compose.yml
#     DOCKER_COMPOSE_PROJECT=my-l2
#     L1_RPC_URLS=https://...
#     SENTINAI_L1_RPC_URL=https://...
#     L1_PROXYD_ENABLED=true
#     BATCHER_EOA_ADDRESS=0x...
#     PROPOSER_EOA_ADDRESS=0x...
#     TREASURY_PRIVATE_KEY=0x...
#     EOA_BALANCE_CRITICAL_ETH=0.1
#     SCALING_SIMULATION_MODE=true
#     AUTO_REMEDIATION_ENABLED=true
#     MCP_SERVER_ENABLED=true
#     SENTINAI_API_KEY=your-admin-key
#     AI_ROUTING_ENABLED=true
#     AGENT_MEMORY_ENABLED=true
#     ALERT_WEBHOOK_URL=https://...
#     NEXT_PUBLIC_BASE_PATH=/thanos-sepolia
#     NEXT_PUBLIC_NETWORK_NAME="Thanos Sepolia"
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SentinAI]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
info() { echo -e "${CYAN}[INFO]${NC} $*"; }

append_if_set() {
  local key="$1"
  local value="${!key:-}"
  [ -n "${value}" ] && printf '%s=%s\n' "${key}" "${value}"
}

resolve_default_compose_file() {
  local candidates=(
    "external/docs/create-l2-rollup-example/docker-compose.yml"
    "docker-compose.yml"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

# ============================================================
# Main: setup_env (macOS/Linux compatible)
# ============================================================
setup_env() {
  # Resolve target directory: script arg or current working directory
  local target_dir="${1:-$(pwd)}"
  cd "${target_dir}"

  # --- Detect non-interactive mode ---
  local _ai_key_found="" ai_key_name="" ai_key_value=""
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    ai_key_name="ANTHROPIC_API_KEY"; ai_key_value="${ANTHROPIC_API_KEY}"; _ai_key_found="true"
  elif [ -n "${OPENAI_API_KEY:-}" ]; then
    ai_key_name="OPENAI_API_KEY"; ai_key_value="${OPENAI_API_KEY}"; _ai_key_found="true"
  elif [ -n "${GEMINI_API_KEY:-}" ]; then
    ai_key_name="GEMINI_API_KEY"; ai_key_value="${GEMINI_API_KEY}"; _ai_key_found="true"
  elif [ -n "${QWEN_API_KEY:-}" ]; then
    ai_key_name="QWEN_API_KEY"; ai_key_value="${QWEN_API_KEY}"; _ai_key_found="true"
  fi

  local _noninteractive=""
  if [ -n "${L2_RPC_URL:-}" ] && [ -n "${_ai_key_found}" ]; then
    _noninteractive="true"
  fi

  # --- Handle existing .env.local ---
  if [ -f .env.local ]; then
    log ".env.local file already exists."
    if [ -n "${_noninteractive}" ]; then
      cp .env.local ".env.local.bak.$(date +%s)"
      log "Non-interactive mode: backed up and overwriting."
    else
      read -rp "  Keep existing configuration? (Y/n): " keep_env
      if [[ ! "${keep_env}" =~ ^[Nn]$ ]]; then
        log "Keeping existing .env.local."
        return
      fi
      cp .env.local ".env.local.bak.$(date +%s)"
      log "Backed up existing .env.local."
    fi
  fi

  # ============================================================
  # Non-interactive mode
  # ============================================================
  if [ -n "${_noninteractive}" ]; then
    log "Non-interactive mode detected."
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "L2_RPC_URL must start with http:// or https://."

    CHAIN_TYPE="${CHAIN_TYPE:-thanos}"
    case "${CHAIN_TYPE}" in
      thanos|optimism|my-l2|op-stack|zkstack|arbitrum) ;;
      zksync|zk-stack) CHAIN_TYPE="zkstack" ;;
      arbitrum-orbit|nitro) CHAIN_TYPE="arbitrum" ;;
      *) err "CHAIN_TYPE must be one of: thanos, optimism, my-l2, op-stack, zkstack, arbitrum" ;;
    esac

    AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://api.ai.tokamak.network}"
    ORCHESTRATOR_TYPE="${ORCHESTRATOR_TYPE:-k8s}"
    K8S_NAMESPACE="${K8S_NAMESPACE:-default}"

    if [ -z "${K8S_APP_PREFIX:-}" ]; then
      case "${CHAIN_TYPE}" in
        arbitrum) K8S_APP_PREFIX="arb" ;;
        zkstack)  K8S_APP_PREFIX="zk" ;;
        *)        K8S_APP_PREFIX="op" ;;
      esac
    fi

    K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"
    DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-docker-compose.yml}"
    DOCKER_COMPOSE_PROJECT="${DOCKER_COMPOSE_PROJECT:-}"

  # ============================================================
  # Interactive wizard
  # ============================================================
  else
    echo ""
    echo -e "${BOLD}--- SentinAI Environment Setup ---${NC}"
    echo ""

    # Setup mode
    local setup_mode="${INSTALL_MODE:-}"
    if [ -z "${setup_mode}" ]; then
      echo "  Setup mode:"
      echo "    1) Core (recommended) — Fast setup with safe defaults"
      echo "    2) Advanced — Full optional settings"
      read -rp "  Choose [1]: " setup_mode_choice
      case "${setup_mode_choice:-1}" in
        2) setup_mode="advanced" ;;
        *) setup_mode="core" ;;
      esac
    else
      case "${setup_mode}" in
        core|advanced) info "Setup mode override: ${setup_mode}" ;;
        *) warn "Invalid INSTALL_MODE='${setup_mode}'. Falling back to 'core'."; setup_mode="core" ;;
      esac
    fi

    # L2 RPC URL
    read -rp "  L2 RPC URL (required): " L2_RPC_URL
    [[ -z "${L2_RPC_URL}" ]] && err "L2_RPC_URL is required."
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "L2_RPC_URL must start with http:// or https://."

    # AI Gateway URL
    if [ "${setup_mode}" = "advanced" ]; then
      echo ""
      echo "  AI Gateway URL configuration:"
      read -rp "  AI Gateway URL [https://api.ai.tokamak.network]: " AI_GATEWAY_URL
      AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://api.ai.tokamak.network}"
    else
      AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://api.ai.tokamak.network}"
    fi

    # AI Provider
    echo ""
    echo "  Select AI Provider:"
    echo "    1) Anthropic (recommended)"
    echo "    2) OpenAI"
    echo "    3) Gemini"
    echo "    4) Qwen"
    read -rp "  Choose [1]: " ai_choice
    case "${ai_choice:-1}" in
      2) ai_key_name="OPENAI_API_KEY";    read -rsp "  OpenAI API Key: "    ai_key_value; echo "" ;;
      3) ai_key_name="GEMINI_API_KEY";    read -rsp "  Gemini API Key: "    ai_key_value; echo "" ;;
      4) ai_key_name="QWEN_API_KEY";      read -rsp "  Qwen API Key: "      ai_key_value; echo "" ;;
      *) ai_key_name="ANTHROPIC_API_KEY"; read -rsp "  Anthropic API Key: " ai_key_value; echo "" ;;
    esac
    [[ -z "${ai_key_value}" ]] && err "AI API Key is required."

    local _k8s_deploy="eks"
    local _k8s_prefix_default="op"

    if [ "${setup_mode}" = "core" ]; then
      info "Core mode: auto-configuring chain and orchestrator defaults."
      CHAIN_TYPE="${CHAIN_TYPE:-thanos}"
      case "${CHAIN_TYPE}" in
        thanos|optimism|my-l2|op-stack|zkstack|arbitrum) ;;
        zksync|zk-stack) CHAIN_TYPE="zkstack" ;;
        arbitrum-orbit|nitro) CHAIN_TYPE="arbitrum" ;;
        *) err "Unsupported CHAIN_TYPE='${CHAIN_TYPE}' in core mode." ;;
      esac

      if [ -n "${ORCHESTRATOR_TYPE:-}" ]; then
        case "${ORCHESTRATOR_TYPE}" in
          k8s|docker) ;;
          *) err "ORCHESTRATOR_TYPE must be 'k8s' or 'docker'." ;;
        esac
      elif [ -n "${DOCKER_COMPOSE_FILE:-}" ]; then
        ORCHESTRATOR_TYPE="docker"
      else
        ORCHESTRATOR_TYPE="k8s"
      fi

      [ "${CHAIN_TYPE}" = "arbitrum" ] && _k8s_prefix_default="arb"
      [ "${CHAIN_TYPE}" = "zkstack" ]  && _k8s_prefix_default="zk"
      K8S_APP_PREFIX="${K8S_APP_PREFIX:-${_k8s_prefix_default}}"
      K8S_NAMESPACE="${K8S_NAMESPACE:-default}"

      if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
        if [ -z "${DOCKER_COMPOSE_FILE:-}" ]; then
          if DOCKER_COMPOSE_FILE="$(resolve_default_compose_file)"; then
            info "Docker compose file detected: ${DOCKER_COMPOSE_FILE}"
          else
            err "Docker mode requires DOCKER_COMPOSE_FILE. Tried: external/docs/create-l2-rollup-example/docker-compose.yml, docker-compose.yml"
          fi
        elif [ ! -f "${DOCKER_COMPOSE_FILE}" ]; then
          err "DOCKER_COMPOSE_FILE not found: ${DOCKER_COMPOSE_FILE}"
        fi
      fi

      if [ "${CHAIN_TYPE}" = "optimism" ] && [ -z "${L2_CHAIN_ID:-}" ]; then
        err "L2_CHAIN_ID is required for Optimism. Set L2_CHAIN_ID and rerun."
      fi
    else
      # Chain Plugin
      echo ""
      echo -e "  ${BOLD}Chain Plugin${NC}:"
      echo "    1) Thanos (default)"
      echo "    2) Optimism (OP Stack)"
      echo "    3) ZK Stack"
      echo "    4) Arbitrum Orbit (Nitro)"
      read -rp "  Choose [1]: " chain_choice
      case "${chain_choice:-1}" in
        2) CHAIN_TYPE="optimism" ;;
        3) CHAIN_TYPE="zkstack" ;;
        4) CHAIN_TYPE="arbitrum" ;;
        *) CHAIN_TYPE="thanos" ;;
      esac

      if [ "${CHAIN_TYPE}" = "optimism" ]; then
        echo ""
        echo -e "  ${BOLD}Optimism Chain Metadata${NC} (L2_CHAIN_ID required):"
        read -rp "  L2_CHAIN_ID (required): " L2_CHAIN_ID
        [[ -z "${L2_CHAIN_ID}" ]] && err "L2_CHAIN_ID is required for Optimism."
        [[ ! "${L2_CHAIN_ID}" =~ ^[0-9]+$ ]] && err "L2_CHAIN_ID must be a positive integer."
        read -rp "  L2_CHAIN_NAME [Optimism Tutorial L2]: " L2_CHAIN_NAME
        L2_CHAIN_NAME="${L2_CHAIN_NAME:-Optimism Tutorial L2}"
        read -rp "  L2_NETWORK_SLUG [optimism-tutorial-l2]: " L2_NETWORK_SLUG
        L2_NETWORK_SLUG="${L2_NETWORK_SLUG:-optimism-tutorial-l2}"
        read -rp "  L2_EXPLORER_URL [http://localhost:4000]: " L2_EXPLORER_URL
        L2_EXPLORER_URL="${L2_EXPLORER_URL:-http://localhost:4000}"
        read -rp "  L2_IS_TESTNET [true]: " L2_IS_TESTNET
        L2_IS_TESTNET="${L2_IS_TESTNET:-true}"
        read -rp "  L1_CHAIN (sepolia/mainnet) [sepolia]: " L1_CHAIN
        L1_CHAIN="${L1_CHAIN:-sepolia}"
      elif [ "${CHAIN_TYPE}" = "zkstack" ]; then
        echo ""
        echo -e "  ${BOLD}ZK Stack Metadata${NC} (optional):"
        read -rp "  ZKSTACK_MODE [legacy-era]: " ZKSTACK_MODE
        ZKSTACK_MODE="${ZKSTACK_MODE:-legacy-era}"
        read -rp "  ZKSTACK_COMPONENT_PROFILE [core-only]: " ZKSTACK_COMPONENT_PROFILE
        ZKSTACK_COMPONENT_PROFILE="${ZKSTACK_COMPONENT_PROFILE:-core-only}"
        read -rp "  ZK_BATCHER_STATUS_URL (optional): " ZK_BATCHER_STATUS_URL
        read -rp "  ZK_PROOF_RPC_URL (optional): " ZK_PROOF_RPC_URL
        read -rp "  ZK_SETTLEMENT_LAYER [l1]: " ZK_SETTLEMENT_LAYER
        ZK_SETTLEMENT_LAYER="${ZK_SETTLEMENT_LAYER:-l1}"
        read -rp "  ZK_FINALITY_MODE [confirmed]: " ZK_FINALITY_MODE
        ZK_FINALITY_MODE="${ZK_FINALITY_MODE:-confirmed}"
      elif [ "${CHAIN_TYPE}" = "arbitrum" ]; then
        echo ""
        echo -e "  ${BOLD}Arbitrum Orbit Metadata${NC}:"
        read -rp "  L2_CHAIN_ID [412346]: " L2_CHAIN_ID
        L2_CHAIN_ID="${L2_CHAIN_ID:-412346}"
        read -rp "  L2_CHAIN_NAME [Arbitrum Orbit L2]: " L2_CHAIN_NAME
        L2_CHAIN_NAME="${L2_CHAIN_NAME:-Arbitrum Orbit L2}"
        read -rp "  L2_EXPLORER_URL [http://localhost:4000]: " L2_EXPLORER_URL
        L2_EXPLORER_URL="${L2_EXPLORER_URL:-http://localhost:4000}"
        read -rp "  L2_IS_TESTNET [true]: " L2_IS_TESTNET
        L2_IS_TESTNET="${L2_IS_TESTNET:-true}"
        read -rp "  L1_CHAIN (sepolia/mainnet) [sepolia]: " L1_CHAIN
        L1_CHAIN="${L1_CHAIN:-sepolia}"
      fi

      # Container Orchestrator
      echo ""
      echo -e "  ${BOLD}Container Orchestrator${NC}:"
      echo "    1) Kubernetes — AWS EKS (default)"
      echo "    2) Kubernetes — Local (minikube, kind, k3s, etc.)"
      echo "    3) Docker Compose — local L2 node"
      read -rp "  Choose [1]: " orch_choice
      case "${orch_choice:-1}" in
        2) ORCHESTRATOR_TYPE="k8s"; _k8s_deploy="local" ;;
        3) ORCHESTRATOR_TYPE="docker" ;;
        *) ORCHESTRATOR_TYPE="k8s"; _k8s_deploy="eks" ;;
      esac

      # Chain-aware K8s prefix default
      [ "${CHAIN_TYPE}" = "arbitrum" ] && _k8s_prefix_default="arb"
      [ "${CHAIN_TYPE}" = "zkstack" ]  && _k8s_prefix_default="zk"

      if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
        echo ""
        echo -e "  ${BOLD}Docker Compose L2 Node${NC}:"
        read -rp "  Docker Compose file [docker-compose.yml]: " DOCKER_COMPOSE_FILE
        DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-docker-compose.yml}"
        read -rp "  Docker Compose project name (press Enter for auto-detect): " DOCKER_COMPOSE_PROJECT
        DOCKER_COMPOSE_PROJECT="${DOCKER_COMPOSE_PROJECT:-}"
      elif [ "${_k8s_deploy}" = "local" ]; then
        echo ""
        echo -e "  ${BOLD}Local Kubernetes${NC}:"
        info "Using existing kubeconfig (~/.kube/config)."
        read -rp "  K8S_NAMESPACE [default]: " K8S_NAMESPACE
        K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
        read -rp "  K8S_APP_PREFIX [${_k8s_prefix_default}]: " K8S_APP_PREFIX
        K8S_APP_PREFIX="${K8S_APP_PREFIX:-${_k8s_prefix_default}}"
        read -rp "  K8S_STATEFULSET_PREFIX (press Enter if none): " K8S_STATEFULSET_PREFIX
        K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"
      else
        # AWS EKS
        echo ""
        read -rp "  AWS EKS Cluster Name (press Enter for simulation mode): " AWS_CLUSTER_NAME
        if [ -z "${AWS_CLUSTER_NAME:-}" ]; then
          warn "AWS_CLUSTER_NAME not set. Running in simulation mode."
        else
          read -rp "  K8S_NAMESPACE [${AWS_CLUSTER_NAME}]: " K8S_NAMESPACE
          K8S_NAMESPACE="${K8S_NAMESPACE:-${AWS_CLUSTER_NAME}}"
          read -rp "  K8S_APP_PREFIX [${_k8s_prefix_default}]: " K8S_APP_PREFIX
          K8S_APP_PREFIX="${K8S_APP_PREFIX:-${_k8s_prefix_default}}"
          read -rp "  K8S_STATEFULSET_PREFIX (e.g., sepolia-thanos-stack, press Enter if none): " K8S_STATEFULSET_PREFIX
          K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"

          # AWS Authentication
          echo ""
          echo -e "  ${BOLD}AWS Authentication${NC}"
          if [ -f "$HOME/.aws/credentials" ] && command -v aws &>/dev/null; then
            echo "  Existing AWS profiles:"
            aws configure list-profiles 2>/dev/null | sed 's/^/    /' || true
            read -rp "  AWS Profile [${AWS_CLUSTER_NAME}]: " _profile_input
            AWS_PROFILE="${_profile_input:-${AWS_CLUSTER_NAME}}"
            if ! aws configure list-profiles 2>/dev/null | grep -qx "${AWS_PROFILE}"; then
              warn "Profile '${AWS_PROFILE}' not found. Creating..."
              aws configure --profile "${AWS_PROFILE}"
            fi
          else
            info "No AWS credentials found. Set up via 'aws configure --profile <name>'."
            AWS_PROFILE="${AWS_CLUSTER_NAME}"
          fi

          # Region
          local _profile_region
          _profile_region=$(aws configure get region --profile "${AWS_PROFILE:-default}" 2>/dev/null || echo "")
          if [ -n "${_profile_region}" ]; then
            AWS_REGION="${_profile_region}"
            info "Region: ${AWS_REGION} (from profile)"
          else
            read -rp "  AWS Region [ap-northeast-2]: " AWS_REGION
            AWS_REGION="${AWS_REGION:-ap-northeast-2}"
          fi
        fi
      fi
    fi

    if [ "${setup_mode}" = "advanced" ]; then
      # L1 RPC Failover
      echo ""
      echo -e "  ${BOLD}L1 RPC Failover${NC}:"
      read -rp "  L1_RPC_URLS (comma-separated, press Enter to skip): " L1_RPC_URLS
      read -rp "  SENTINAI_L1_RPC_URL (optional): " SENTINAI_L1_RPC_URL
      if [ -n "${L1_RPC_URLS:-}" ] && [ "${ORCHESTRATOR_TYPE}" != "docker" ]; then
        read -rp "  Enable L1 Proxyd ConfigMap integration? (y/N): " proxyd_choice
        if [[ "${proxyd_choice:-N}" =~ ^[Yy]$ ]]; then
          L1_PROXYD_ENABLED="true"
          read -rp "  L1_PROXYD_CONFIGMAP_NAME [proxyd-config]: " L1_PROXYD_CONFIGMAP_NAME
          L1_PROXYD_CONFIGMAP_NAME="${L1_PROXYD_CONFIGMAP_NAME:-proxyd-config}"
          read -rp "  L1_PROXYD_DATA_KEY [proxyd-config.toml]: " L1_PROXYD_DATA_KEY
          L1_PROXYD_DATA_KEY="${L1_PROXYD_DATA_KEY:-proxyd-config.toml}"
          read -rp "  L1_PROXYD_UPSTREAM_GROUP [main]: " L1_PROXYD_UPSTREAM_GROUP
          L1_PROXYD_UPSTREAM_GROUP="${L1_PROXYD_UPSTREAM_GROUP:-main}"
        fi
      fi

      # EOA Balance Monitoring
      echo ""
      if [ "${CHAIN_TYPE}" = "arbitrum" ]; then
        echo -e "  ${BOLD}EOA Balance Monitoring${NC} (batch-poster/validator):"
      else
        echo -e "  ${BOLD}EOA Balance Monitoring${NC} (batcher/proposer):"
      fi
      read -rp "  Enable EOA monitoring? (y/N): " eoa_choice
      if [[ "${eoa_choice:-N}" =~ ^[Yy]$ ]]; then
        if [ "${CHAIN_TYPE}" = "arbitrum" ]; then
          read -rp "  BATCH_POSTER_EOA_ADDRESS (0x...): " BATCH_POSTER_EOA_ADDRESS
          read -rp "  VALIDATOR_EOA_ADDRESS (0x...): " VALIDATOR_EOA_ADDRESS
          read -rsp "  BATCH_POSTER_PRIVATE_KEY (optional): " BATCH_POSTER_PRIVATE_KEY; echo ""
          read -rsp "  VALIDATOR_PRIVATE_KEY (optional): " VALIDATOR_PRIVATE_KEY; echo ""
        else
          read -rp "  BATCHER_EOA_ADDRESS (0x...): " BATCHER_EOA_ADDRESS
          read -rp "  PROPOSER_EOA_ADDRESS (0x...): " PROPOSER_EOA_ADDRESS
          read -rsp "  BATCHER_PRIVATE_KEY (optional): " BATCHER_PRIVATE_KEY; echo ""
          read -rsp "  PROPOSER_PRIVATE_KEY (optional): " PROPOSER_PRIVATE_KEY; echo ""
        fi
        read -rsp "  TREASURY_PRIVATE_KEY (for auto-refill, press Enter for monitor-only): " TREASURY_PRIVATE_KEY; echo ""
        read -rp "  EOA_BALANCE_CRITICAL_ETH [0.1]: " EOA_BALANCE_CRITICAL_ETH
        EOA_BALANCE_CRITICAL_ETH="${EOA_BALANCE_CRITICAL_ETH:-0.1}"
      fi

      # MCP Control Plane
      echo ""
      echo -e "  ${BOLD}MCP Control Plane${NC}:"
      read -rp "  Enable MCP server? (y/N): " mcp_choice
      if [[ "${mcp_choice:-N}" =~ ^[Yy]$ ]]; then
        MCP_SERVER_ENABLED="true"
        read -rp "  MCP_AUTH_MODE [api-key]: " MCP_AUTH_MODE
        MCP_AUTH_MODE="${MCP_AUTH_MODE:-api-key}"
        read -rp "  MCP_APPROVAL_REQUIRED [true]: " MCP_APPROVAL_REQUIRED
        MCP_APPROVAL_REQUIRED="${MCP_APPROVAL_REQUIRED:-true}"
        read -rp "  MCP_APPROVAL_TTL_SECONDS [300]: " MCP_APPROVAL_TTL_SECONDS
        MCP_APPROVAL_TTL_SECONDS="${MCP_APPROVAL_TTL_SECONDS:-300}"
        read -rsp "  SENTINAI_API_KEY (admin key): " SENTINAI_API_KEY; echo ""
        [[ -z "${SENTINAI_API_KEY}" ]] && err "SENTINAI_API_KEY is required when MCP is enabled."
      fi

      # Adaptive AI Routing
      echo ""
      echo -e "  ${BOLD}Adaptive AI Routing${NC}:"
      read -rp "  Enable AI routing? (y/N): " routing_choice
      if [[ "${routing_choice:-N}" =~ ^[Yy]$ ]]; then
        AI_ROUTING_ENABLED="true"
        read -rp "  AI_ROUTING_POLICY [balanced]: " AI_ROUTING_POLICY
        AI_ROUTING_POLICY="${AI_ROUTING_POLICY:-balanced}"
        read -rp "  AI_ROUTING_AB_PERCENT [10]: " AI_ROUTING_AB_PERCENT
        AI_ROUTING_AB_PERCENT="${AI_ROUTING_AB_PERCENT:-10}"
        read -rp "  AI_ROUTING_BUDGET_USD_DAILY [50]: " AI_ROUTING_BUDGET_USD_DAILY
        AI_ROUTING_BUDGET_USD_DAILY="${AI_ROUTING_BUDGET_USD_DAILY:-50}"
      fi

      # Agent Memory
      echo ""
      echo -e "  ${BOLD}Agent Memory${NC}:"
      read -rp "  Enable agent memory? (y/N): " memory_choice
      if [[ "${memory_choice:-N}" =~ ^[Yy]$ ]]; then
        AGENT_MEMORY_ENABLED="true"
        read -rp "  AGENT_MEMORY_RETENTION_DAYS [30]: " AGENT_MEMORY_RETENTION_DAYS
        AGENT_MEMORY_RETENTION_DAYS="${AGENT_MEMORY_RETENTION_DAYS:-30}"
        read -rp "  AGENT_TRACE_MASK_SECRETS [true]: " AGENT_TRACE_MASK_SECRETS
        AGENT_TRACE_MASK_SECRETS="${AGENT_TRACE_MASK_SECRETS:-true}"
      fi

      # Fault Proof
      echo ""
      echo -e "  ${BOLD}Fault Proof${NC}:"
      read -rp "  Enable fault proof monitoring? (y/N): " fault_proof_choice
      if [[ "${fault_proof_choice:-N}" =~ ^[Yy]$ ]]; then
        FAULT_PROOF_ENABLED="true"
        read -rp "  CHALLENGER_EOA_ADDRESS (0x..., optional): " CHALLENGER_EOA_ADDRESS
        read -rp "  DISPUTE_GAME_FACTORY_ADDRESS (0x..., optional): " DISPUTE_GAME_FACTORY_ADDRESS
      fi

      # Optional overrides
      echo ""
      read -rp "  REDIS_URL (optional): " REDIS_URL
      read -rp "  K8S_API_URL (optional override): " K8S_API_URL
      read -rp "  K8S_INSECURE_TLS (true/false, optional): " K8S_INSECURE_TLS
    else
      info "Core mode: skipping advanced optional prompts."
    fi

    # Scaling Simulation Mode
    if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
      SCALING_SIMULATION_MODE="false"
    elif [ "${setup_mode}" = "advanced" ] && ( [ -n "${AWS_CLUSTER_NAME:-}" ] || [ "${_k8s_deploy:-}" = "local" ] ); then
      echo ""
      echo "  Simulation mode disables real K8s scaling (safe for testing)."
      read -rp "  Enable simulation mode? (y/N): " sim_choice
      SCALING_SIMULATION_MODE=$([[ "${sim_choice:-N}" =~ ^[Yy]$ ]] && echo "true" || echo "false")
    elif [ -n "${AWS_CLUSTER_NAME:-}" ]; then
      SCALING_SIMULATION_MODE="false"
    else
      SCALING_SIMULATION_MODE="true"
    fi

    if [ "${setup_mode}" = "advanced" ]; then
      # Auto-Remediation
      read -rp "  Enable auto-remediation? (y/N): " remediation_choice
      [[ "${remediation_choice:-N}" =~ ^[Yy]$ ]] && AUTO_REMEDIATION_ENABLED="true"

      # Network name
      echo ""
      local network_name_default="Thanos Sepolia"
      [ "${CHAIN_TYPE}" = "optimism" ]  && network_name_default="Optimism Tutorial L2"
      [ "${CHAIN_TYPE}" = "zkstack" ]   && network_name_default="ZK Stack Local"
      [ "${CHAIN_TYPE}" = "arbitrum" ]  && network_name_default="Arbitrum Orbit L2"
      read -rp "  Network Name [${network_name_default}]: " NEXT_PUBLIC_NETWORK_NAME
      NEXT_PUBLIC_NETWORK_NAME="${NEXT_PUBLIC_NETWORK_NAME:-${network_name_default}}"

      # Base path
      echo ""
      read -rp "  URL Base Path (e.g., /thanos-sepolia, press Enter for root /): " NEXT_PUBLIC_BASE_PATH
      NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-}"

      # Slack webhook
      read -rp "  Slack Webhook URL (optional): " ALERT_WEBHOOK_URL
    else
      info "Core mode: skipping network name / base path / alert prompts."
    fi
  fi

  # ============================================================
  # Defaults for unset variables (set -u safety)
  # ============================================================
  : "${ORCHESTRATOR_TYPE:=k8s}"
  : "${CHAIN_TYPE:=thanos}"
  : "${L2_CHAIN_ID:=}"
  : "${L2_CHAIN_NAME:=}"
  : "${L2_NETWORK_SLUG:=}"
  : "${L2_EXPLORER_URL:=}"
  : "${L2_IS_TESTNET:=}"
  : "${L1_CHAIN:=}"
  : "${DOCKER_COMPOSE_FILE:=docker-compose.yml}"
  : "${DOCKER_COMPOSE_PROJECT:=}"
  : "${AWS_CLUSTER_NAME:=}"
  : "${K8S_NAMESPACE:=default}"
  : "${K8S_APP_PREFIX:=op}"
  : "${K8S_STATEFULSET_PREFIX:=}"
  : "${K8S_API_URL:=}"
  : "${K8S_INSECURE_TLS:=}"
  : "${AWS_PROFILE:=}"
  : "${AWS_REGION:=}"
  : "${SENTINAI_L1_RPC_URL:=}"
  : "${L1_RPC_URLS:=}"
  : "${L1_PROXYD_ENABLED:=}"
  : "${L1_PROXYD_CONFIGMAP_NAME:=}"
  : "${L1_PROXYD_DATA_KEY:=}"
  : "${L1_PROXYD_UPSTREAM_GROUP:=}"
  : "${BATCHER_EOA_ADDRESS:=}"
  : "${PROPOSER_EOA_ADDRESS:=}"
  : "${BATCHER_PRIVATE_KEY:=}"
  : "${PROPOSER_PRIVATE_KEY:=}"
  : "${CHALLENGER_EOA_ADDRESS:=}"
  : "${TREASURY_PRIVATE_KEY:=}"
  : "${EOA_BALANCE_CRITICAL_ETH:=0.1}"
  : "${EOA_BALANCE_WARNING_ETH:=}"
  : "${EOA_REFILL_AMOUNT_ETH:=}"
  : "${FAULT_PROOF_ENABLED:=}"
  : "${DISPUTE_GAME_FACTORY_ADDRESS:=}"
  : "${AUTO_REMEDIATION_ENABLED:=}"
  : "${MCP_SERVER_ENABLED:=}"
  : "${MCP_AUTH_MODE:=}"
  : "${MCP_APPROVAL_REQUIRED:=}"
  : "${MCP_APPROVAL_TTL_SECONDS:=}"
  : "${SENTINAI_API_KEY:=}"
  : "${AI_ROUTING_ENABLED:=}"
  : "${AI_ROUTING_POLICY:=}"
  : "${AI_ROUTING_AB_PERCENT:=}"
  : "${AI_ROUTING_BUDGET_USD_DAILY:=}"
  : "${AGENT_MEMORY_ENABLED:=}"
  : "${AGENT_MEMORY_RETENTION_DAYS:=}"
  : "${AGENT_TRACE_MASK_SECRETS:=}"
  : "${REDIS_URL:=}"
  : "${ZKSTACK_MODE:=}"
  : "${ZKSTACK_COMPONENT_PROFILE:=}"
  : "${ZK_BATCHER_STATUS_URL:=}"
  : "${ZK_PROOF_RPC_URL:=}"
  : "${ZK_SETTLEMENT_LAYER:=}"
  : "${ZK_FINALITY_MODE:=}"
  : "${BATCH_POSTER_EOA_ADDRESS:=}"
  : "${VALIDATOR_EOA_ADDRESS:=}"
  : "${BATCH_POSTER_PRIVATE_KEY:=}"
  : "${VALIDATOR_PRIVATE_KEY:=}"
  : "${ALERT_WEBHOOK_URL:=}"
  : "${NEXT_PUBLIC_BASE_PATH:=}"
  : "${NEXT_PUBLIC_NETWORK_NAME:=}"
  : "${AI_GATEWAY_URL:=https://api.ai.tokamak.network}"

  # Chain-specific defaults
  if [ "${CHAIN_TYPE}" = "optimism" ] || [ "${CHAIN_TYPE}" = "my-l2" ] || [ "${CHAIN_TYPE}" = "op-stack" ]; then
    : "${L2_CHAIN_ID:=42069}"
    : "${L2_CHAIN_NAME:=Optimism Tutorial L2}"
    : "${L2_NETWORK_SLUG:=optimism-tutorial-l2}"
    : "${L2_EXPLORER_URL:=http://localhost:4000}"
    : "${L2_IS_TESTNET:=true}"
    : "${L1_CHAIN:=sepolia}"
    : "${NEXT_PUBLIC_NETWORK_NAME:=Optimism Tutorial L2}"
  elif [ "${CHAIN_TYPE}" = "zkstack" ]; then
    : "${NEXT_PUBLIC_NETWORK_NAME:=ZK Stack Local}"
  elif [ "${CHAIN_TYPE}" = "arbitrum" ]; then
    : "${L2_CHAIN_ID:=412346}"
    : "${L2_CHAIN_NAME:=Arbitrum Orbit L2}"
    : "${L2_IS_TESTNET:=true}"
    : "${L1_CHAIN:=sepolia}"
    : "${NEXT_PUBLIC_NETWORK_NAME:=Arbitrum Orbit L2}"
    : "${K8S_APP_PREFIX:=arb}"
  else
    : "${NEXT_PUBLIC_NETWORK_NAME:=Thanos Sepolia}"
  fi

  # Scaling simulation mode default
  : "${SCALING_SIMULATION_MODE:=}"
  if [ -z "${SCALING_SIMULATION_MODE}" ]; then
    if [ -z "${AWS_CLUSTER_NAME}" ]; then
      SCALING_SIMULATION_MODE="true"
      log "EKS cluster not set → simulation mode enabled."
    else
      SCALING_SIMULATION_MODE="false"
    fi
  fi

  # ============================================================
  # Write .env.local
  # ============================================================
  cat > .env.local << 'ENVEOF'
# SentinAI Configuration
# Generated by setup-env.sh
ENVEOF

  {
    printf '\n# === Required ===\n'
    printf 'L2_RPC_URL=%s\n' "${L2_RPC_URL}"
    printf 'AI_GATEWAY_URL=%s\n' "${AI_GATEWAY_URL}"
    printf '%s=%s\n' "${ai_key_name}" "${ai_key_value}"

    printf '\n# === Chain Plugin ===\n'
    printf 'CHAIN_TYPE=%s\n' "${CHAIN_TYPE}"
    [ -n "${L2_CHAIN_ID}" ]       && printf 'L2_CHAIN_ID=%s\n' "${L2_CHAIN_ID}"
    [ -n "${L2_CHAIN_NAME}" ]     && printf 'L2_CHAIN_NAME=%s\n' "${L2_CHAIN_NAME}"
    [ -n "${L2_NETWORK_SLUG}" ]   && printf 'L2_NETWORK_SLUG=%s\n' "${L2_NETWORK_SLUG}"
    [ -n "${L2_EXPLORER_URL}" ]   && printf 'L2_EXPLORER_URL=%s\n' "${L2_EXPLORER_URL}"
    [ -n "${L2_IS_TESTNET}" ]     && printf 'L2_IS_TESTNET=%s\n' "${L2_IS_TESTNET}"
    [ -n "${L1_CHAIN}" ]          && printf 'L1_CHAIN=%s\n' "${L1_CHAIN}"
    [ -n "${ZKSTACK_MODE}" ]      && printf 'ZKSTACK_MODE=%s\n' "${ZKSTACK_MODE}"
    [ -n "${ZKSTACK_COMPONENT_PROFILE}" ] && printf 'ZKSTACK_COMPONENT_PROFILE=%s\n' "${ZKSTACK_COMPONENT_PROFILE}"
    [ -n "${ZK_BATCHER_STATUS_URL}" ]     && printf 'ZK_BATCHER_STATUS_URL=%s\n' "${ZK_BATCHER_STATUS_URL}"
    [ -n "${ZK_PROOF_RPC_URL}" ]          && printf 'ZK_PROOF_RPC_URL=%s\n' "${ZK_PROOF_RPC_URL}"
    [ -n "${ZK_SETTLEMENT_LAYER}" ]       && printf 'ZK_SETTLEMENT_LAYER=%s\n' "${ZK_SETTLEMENT_LAYER}"
    [ -n "${ZK_FINALITY_MODE}" ]          && printf 'ZK_FINALITY_MODE=%s\n' "${ZK_FINALITY_MODE}"

    if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
      printf '\n# === Container Orchestrator ===\n'
      printf 'ORCHESTRATOR_TYPE=docker\n'
      printf 'DOCKER_COMPOSE_FILE=%s\n' "${DOCKER_COMPOSE_FILE}"
      [ -n "${DOCKER_COMPOSE_PROJECT}" ] && printf 'DOCKER_COMPOSE_PROJECT=%s\n' "${DOCKER_COMPOSE_PROJECT}"
    else
      printf '\n# === K8s Monitoring ===\n'
      printf 'AWS_CLUSTER_NAME=%s\n' "${AWS_CLUSTER_NAME:-}"
      [ -n "${AWS_PROFILE}" ]           && printf 'AWS_PROFILE=%s\n' "${AWS_PROFILE}"
      printf 'K8S_NAMESPACE=%s\n' "${K8S_NAMESPACE}"
      printf 'K8S_APP_PREFIX=%s\n' "${K8S_APP_PREFIX}"
      [ -n "${K8S_STATEFULSET_PREFIX}" ] && printf 'K8S_STATEFULSET_PREFIX=%s\n' "${K8S_STATEFULSET_PREFIX}"
      [ -n "${AWS_REGION}" ]             && printf 'AWS_REGION=%s\n' "${AWS_REGION}"
      [ -n "${K8S_API_URL}" ]            && printf 'K8S_API_URL=%s\n' "${K8S_API_URL}"
      [ -n "${K8S_INSECURE_TLS}" ]       && printf 'K8S_INSECURE_TLS=%s\n' "${K8S_INSECURE_TLS}"
    fi

    printf '\n# === Scaling ===\n'
    printf 'SCALING_SIMULATION_MODE=%s\n' "${SCALING_SIMULATION_MODE}"
    printf 'COST_TRACKING_ENABLED=true\n'
    printf 'AGENT_LOOP_ENABLED=true\n'
    [ "${AUTO_REMEDIATION_ENABLED:-}" = "true" ] && printf 'AUTO_REMEDIATION_ENABLED=true\n'

    if [ -n "${SENTINAI_L1_RPC_URL}" ] || [ -n "${L1_RPC_URLS}" ]; then
      printf '\n# === L1 RPC Failover ===\n'
      [ -n "${SENTINAI_L1_RPC_URL}" ] && printf 'SENTINAI_L1_RPC_URL=%s\n' "${SENTINAI_L1_RPC_URL}"
      [ -n "${L1_RPC_URLS}" ]         && printf 'L1_RPC_URLS=%s\n' "${L1_RPC_URLS}"
      if [ "${L1_PROXYD_ENABLED:-}" = "true" ]; then
        printf 'L1_PROXYD_ENABLED=true\n'
        [ -n "${L1_PROXYD_CONFIGMAP_NAME}" ]  && printf 'L1_PROXYD_CONFIGMAP_NAME=%s\n' "${L1_PROXYD_CONFIGMAP_NAME}"
        [ -n "${L1_PROXYD_DATA_KEY}" ]        && printf 'L1_PROXYD_DATA_KEY=%s\n' "${L1_PROXYD_DATA_KEY}"
        [ -n "${L1_PROXYD_UPSTREAM_GROUP}" ]  && printf 'L1_PROXYD_UPSTREAM_GROUP=%s\n' "${L1_PROXYD_UPSTREAM_GROUP}"
      fi
    fi

    local _eoa_set="${BATCHER_EOA_ADDRESS}${PROPOSER_EOA_ADDRESS}${BATCHER_PRIVATE_KEY}${PROPOSER_PRIVATE_KEY}${CHALLENGER_EOA_ADDRESS}${BATCH_POSTER_EOA_ADDRESS}${VALIDATOR_EOA_ADDRESS}${BATCH_POSTER_PRIVATE_KEY}${VALIDATOR_PRIVATE_KEY}"
    if [ -n "${_eoa_set}" ]; then
      printf '\n# === EOA Balance Monitoring ===\n'
      [ -n "${BATCHER_EOA_ADDRESS}" ]       && printf 'BATCHER_EOA_ADDRESS=%s\n' "${BATCHER_EOA_ADDRESS}"
      [ -n "${PROPOSER_EOA_ADDRESS}" ]      && printf 'PROPOSER_EOA_ADDRESS=%s\n' "${PROPOSER_EOA_ADDRESS}"
      [ -n "${BATCHER_PRIVATE_KEY}" ]       && printf 'BATCHER_PRIVATE_KEY=%s\n' "${BATCHER_PRIVATE_KEY}"
      [ -n "${PROPOSER_PRIVATE_KEY}" ]      && printf 'PROPOSER_PRIVATE_KEY=%s\n' "${PROPOSER_PRIVATE_KEY}"
      [ -n "${CHALLENGER_EOA_ADDRESS}" ]    && printf 'CHALLENGER_EOA_ADDRESS=%s\n' "${CHALLENGER_EOA_ADDRESS}"
      [ -n "${BATCH_POSTER_EOA_ADDRESS}" ]  && printf 'BATCH_POSTER_EOA_ADDRESS=%s\n' "${BATCH_POSTER_EOA_ADDRESS}"
      [ -n "${VALIDATOR_EOA_ADDRESS}" ]     && printf 'VALIDATOR_EOA_ADDRESS=%s\n' "${VALIDATOR_EOA_ADDRESS}"
      [ -n "${BATCH_POSTER_PRIVATE_KEY}" ]  && printf 'BATCH_POSTER_PRIVATE_KEY=%s\n' "${BATCH_POSTER_PRIVATE_KEY}"
      [ -n "${VALIDATOR_PRIVATE_KEY}" ]     && printf 'VALIDATOR_PRIVATE_KEY=%s\n' "${VALIDATOR_PRIVATE_KEY}"
      [ -n "${TREASURY_PRIVATE_KEY}" ]      && printf 'TREASURY_PRIVATE_KEY=%s\n' "${TREASURY_PRIVATE_KEY}"
      printf 'EOA_BALANCE_CRITICAL_ETH=%s\n' "${EOA_BALANCE_CRITICAL_ETH:-0.1}"
      [ -n "${EOA_BALANCE_WARNING_ETH}" ]   && printf 'EOA_BALANCE_WARNING_ETH=%s\n' "${EOA_BALANCE_WARNING_ETH}"
      [ -n "${EOA_REFILL_AMOUNT_ETH}" ]     && printf 'EOA_REFILL_AMOUNT_ETH=%s\n' "${EOA_REFILL_AMOUNT_ETH}"
    fi

    if [ "${FAULT_PROOF_ENABLED:-}" = "true" ] || [ -n "${DISPUTE_GAME_FACTORY_ADDRESS:-}${CHALLENGER_EOA_ADDRESS:-}" ]; then
      printf '\n# === Fault Proof ===\n'
      [ "${FAULT_PROOF_ENABLED:-}" = "true" ]       && printf 'FAULT_PROOF_ENABLED=true\n'
      [ -n "${CHALLENGER_EOA_ADDRESS:-}" ]           && printf 'CHALLENGER_EOA_ADDRESS=%s\n' "${CHALLENGER_EOA_ADDRESS}"
      [ -n "${DISPUTE_GAME_FACTORY_ADDRESS:-}" ]     && printf 'DISPUTE_GAME_FACTORY_ADDRESS=%s\n' "${DISPUTE_GAME_FACTORY_ADDRESS}"
    fi

    [ -n "${REDIS_URL:-}" ] && printf 'REDIS_URL=%s\n' "${REDIS_URL}"

    local advanced_optional_keys=(
      MCP_SERVER_ENABLED MCP_AUTH_MODE MCP_APPROVAL_REQUIRED MCP_APPROVAL_TTL_SECONDS
      SENTINAI_API_KEY
      AI_ROUTING_ENABLED AI_ROUTING_POLICY AI_ROUTING_AB_PERCENT AI_ROUTING_BUDGET_USD_DAILY
      AGENT_MEMORY_ENABLED AGENT_MEMORY_RETENTION_DAYS AGENT_TRACE_MASK_SECRETS
    )
    local advanced_optional_written="" advanced_key
    for advanced_key in "${advanced_optional_keys[@]}"; do
      if [ -n "${!advanced_key:-}" ]; then
        if [ -z "${advanced_optional_written}" ]; then
          printf '\n# === Advanced Optional Features ===\n'
          advanced_optional_written="true"
        fi
        append_if_set "${advanced_key}"
      fi
    done

    if [ -n "${NEXT_PUBLIC_BASE_PATH:-}" ] || [ -n "${NEXT_PUBLIC_NETWORK_NAME:-}" ]; then
      printf '\n# === Deployment ===\n'
      [ -n "${NEXT_PUBLIC_BASE_PATH:-}" ]    && printf 'NEXT_PUBLIC_BASE_PATH=%s\n' "${NEXT_PUBLIC_BASE_PATH}"
      [ -n "${NEXT_PUBLIC_NETWORK_NAME:-}" ] && printf 'NEXT_PUBLIC_NETWORK_NAME=%s\n' "${NEXT_PUBLIC_NETWORK_NAME}"
    fi

    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      printf '\n# === Alerts ===\n'
      printf 'ALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL}"
    fi
  } >> .env.local

  chmod 600 .env.local
  log ".env.local created (permissions: 600)."
  echo ""
  log "Next steps:"
  echo "  npm install && npm run dev"
}

# ============================================================
# Entry Point
# ============================================================
echo ""
echo -e "\033[1m=========================================\033[0m"
echo -e "\033[1m  SentinAI — Environment Setup\033[0m"
echo -e "\033[1m=========================================\033[0m"
echo ""

# Default: run in current directory (project root)
TARGET_DIR="${SENTINAI_DIR:-$(pwd)}"
setup_env "${TARGET_DIR}"
