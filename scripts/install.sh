#!/usr/bin/env bash
# ============================================================
# SentinAI Installer
# Supports: Amazon Linux 2023, Ubuntu 22.04/24.04
#
# Usage:
#   bash scripts/install.sh            # Run locally
#   curl -sSL <raw-url> | bash         # Run remotely
#
# Environment overrides:
#   SENTINAI_DIR=/opt/sentinai         # Install path (default: /opt/sentinai)
#   SENTINAI_BRANCH=main               # Git branch (default: main)
#
# Non-interactive mode (CI/CD, user-data):
#   Uses the same variable names as .env.local — no prefix needed.
#   Required:
#     L2_RPC_URL=https://rpc.example.com
#     ANTHROPIC_API_KEY=sk-ant-...       # or OPENAI_API_KEY / GEMINI_API_KEY / QWEN_API_KEY
#   Optional:
#     CHAIN_TYPE=thanos                  # thanos | optimism | my-l2 | op-stack
#     AI_GATEWAY_URL=https://...         # AI Gateway (default: official gateway)
#     AWS_CLUSTER_NAME=my-cluster        # EKS cluster (simulation mode if not set)
#     AWS_PROFILE=my-cluster             # AWS CLI profile (default: same as AWS_CLUSTER_NAME)
#     AWS_ACCESS_KEY_ID=AKIAxxxx         # AWS keys → stored in ~/.aws/credentials, not .env.local
#     AWS_SECRET_ACCESS_KEY=xxxx         # (only needed if ~/.aws/credentials doesn't exist yet)
#     AWS_REGION=ap-northeast-2          # AWS region (auto-detect from profile or EC2 IMDS)
#     K8S_NAMESPACE=default              # K8s namespace
#     K8S_APP_PREFIX=op                  # K8s pod label prefix
#     K8S_STATEFULSET_PREFIX=            # StatefulSet name prefix (e.g., sepolia-thanos-stack)
#     L1_RPC_URLS=https://...            # Comma-separated spare L1 RPC endpoints
#     L1_PROXYD_ENABLED=true             # L1 Proxyd ConfigMap integration
#     BATCHER_EOA_ADDRESS=0x...          # EOA balance monitoring
#     PROPOSER_EOA_ADDRESS=0x...
#     TREASURY_PRIVATE_KEY=0x...         # Auto-refill
#     EOA_BALANCE_CRITICAL_ETH=0.1
#     ORCHESTRATOR_TYPE=docker            # 'k8s' (default) or 'docker' for Docker Compose L2
#     DOCKER_COMPOSE_FILE=docker-compose.yml  # L2 Docker Compose file (docker mode only)
#     DOCKER_COMPOSE_PROJECT=my-l2        # Docker Compose project name (docker mode only)
#     SCALING_SIMULATION_MODE=false      # true = no real K8s scaling (default: auto)
#     AUTO_REMEDIATION_ENABLED=true
#     ALERT_WEBHOOK_URL=https://...      # Slack webhook
#     NEXT_PUBLIC_BASE_PATH=/thanos-sepolia  # URL base path (e.g., /thanos-sepolia)
#     NEXT_PUBLIC_NETWORK_NAME="Thanos Sepolia"  # Network name in dashboard header
#     DOMAIN=sentinai.example.com        # HTTPS domain (Caddy)
# ============================================================

set -euo pipefail

# --- Configuration ---
SENTINAI_REPO="https://github.com/tokamak-network/SentinAI.git"
INSTALL_DIR="${SENTINAI_DIR:-/opt/sentinai}"
BRANCH="${SENTINAI_BRANCH:-main}"

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

# Store AWS credentials in ~/.aws/credentials using aws CLI (standard location)
store_aws_credentials() {
  local profile="$1" key_id="$2" secret="$3" region="${4:-}"
  aws configure set aws_access_key_id "${key_id}" --profile "${profile}"
  aws configure set aws_secret_access_key "${secret}" --profile "${profile}"
  [ -n "${region}" ] && aws configure set region "${region}" --profile "${profile}"
  aws configure set output json --profile "${profile}"
  log "AWS credentials saved to ~/.aws/credentials (profile: ${profile})"
}

# ============================================================
# OS Detection
# ============================================================
detect_os() {
  if [ -f /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    OS_ID="${ID}"
    OS_VERSION="${VERSION_ID:-unknown}"
  else
    err "Unsupported OS. Amazon Linux 2023 or Ubuntu 22.04+ required."
  fi
  log "OS: ${PRETTY_NAME:-${OS_ID} ${OS_VERSION}}"
}

# ============================================================
# Step 1: Docker
# ============================================================
install_docker() {
  if command -v docker &>/dev/null; then
    log "Docker already installed: $(docker --version | head -1)"
    return
  fi

  log "Installing Docker..."
  case "${OS_ID}" in
    amzn)
      sudo dnf install -y docker
      sudo systemctl enable --now docker
      ;;
    ubuntu|debian)
      sudo apt-get update -qq
      sudo apt-get install -y ca-certificates curl
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
        | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
      # shellcheck source=/dev/null
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS_ID} \
        $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
        | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      sudo apt-get update -qq
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    *)
      err "Automatic Docker installation not supported for: ${OS_ID}. Please install Docker manually and re-run."
      ;;
  esac

  sudo usermod -aG docker "${USER}" 2>/dev/null || true
  log "Docker installation complete."
}

# ============================================================
# Step 2: Docker Compose
# ============================================================
install_compose() {
  if docker compose version &>/dev/null 2>&1; then
    log "Docker Compose already installed: $(docker compose version 2>/dev/null | head -1)"
    return
  fi

  log "Installing Docker Compose plugin..."
  case "${OS_ID}" in
    amzn)
      sudo mkdir -p /usr/local/lib/docker/cli-plugins
      local compose_version
      compose_version=$(curl -sL https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4)
      sudo curl -SL \
        "https://github.com/docker/compose/releases/download/${compose_version}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
      sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
      ;;
    ubuntu|debian)
      # docker-compose-plugin is installed with the Docker package
      log "Docker Compose is included in the Docker package."
      ;;
  esac
  log "Docker Compose installation complete."
}

# ============================================================
# Step 3: Git
# ============================================================
install_git() {
  if command -v git &>/dev/null; then
    log "Git already installed: $(git --version)"
    return
  fi

  log "Installing Git..."
  case "${OS_ID}" in
    amzn)     sudo dnf install -y git ;;
    ubuntu|debian) sudo apt-get install -y git ;;
  esac
  log "Git installation complete."
}

# ============================================================
# Step 4: AWS CLI
# ============================================================
install_aws_cli() {
  if command -v aws &>/dev/null; then
    log "AWS CLI already installed: $(aws --version 2>&1 | head -1)"
    return
  fi

  log "Installing AWS CLI..."
  case "${OS_ID}" in
    amzn)
      sudo dnf install -y awscli
      ;;
    ubuntu|debian)
      sudo apt-get install -y unzip curl
      local arch
      arch=$(uname -m)
      curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-${arch}.zip" -o /tmp/awscliv2.zip
      unzip -qo /tmp/awscliv2.zip -d /tmp
      sudo /tmp/aws/install
      rm -rf /tmp/awscliv2.zip /tmp/aws
      ;;
    *)
      warn "Automatic AWS CLI installation not supported for: ${OS_ID}. Please install manually."
      return
      ;;
  esac
  log "AWS CLI installation complete."
}

# ============================================================
# Step 5: Clone / Update Repository
# ============================================================
setup_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Existing installation found: ${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    git fetch origin
    git stash --include-untracked 2>/dev/null || true
    git checkout "${BRANCH}"
    git pull origin "${BRANCH}"
    log "Source code update complete."
  else
    log "Cloning repository... (branch: ${BRANCH})"
    sudo mkdir -p "$(dirname "${INSTALL_DIR}")"
    sudo chown "${USER}":"$(id -gn)" "$(dirname "${INSTALL_DIR}")"
    git clone -b "${BRANCH}" "${SENTINAI_REPO}" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    log "Clone complete: ${INSTALL_DIR}"
  fi
}

# ============================================================
# Step 5: Configure .env.local
# ============================================================
setup_env() {
  cd "${INSTALL_DIR}"

  # --- Detect non-interactive mode BEFORE local declarations ---
  # (local would shadow environment variables with the same names)
  local _ai_key_found=""
  local ai_key_name="" ai_key_value=""
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

  if [ -f .env.local ]; then
    log ".env.local file already exists."
    if [ -n "${_noninteractive}" ]; then
      cp .env.local ".env.local.bak.$(date +%s)"
      log "Non-interactive mode: backing up existing .env.local and overwriting."
    else
      read -rp "  Keep existing configuration? (Y/n): " keep_env
      if [[ ! "${keep_env}" =~ ^[Nn]$ ]]; then
        log "Keeping existing .env.local."
        return
      fi
      cp .env.local ".env.local.bak.$(date +%s)"
      log "Backed up existing .env.local before overwriting."
    fi
  fi

  # --- Non-interactive mode: read directly from env vars ---
  if [ -n "${_noninteractive}" ]; then
    log "Non-interactive mode detected."
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "L2_RPC_URL must start with http:// or https://."

    CHAIN_TYPE="${CHAIN_TYPE:-thanos}"
    case "${CHAIN_TYPE}" in
      thanos|optimism|my-l2|op-stack) ;;
      *) err "CHAIN_TYPE must be one of: thanos, optimism, my-l2, op-stack" ;;
    esac

    AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://api.ai.tokamak.network}"
    ORCHESTRATOR_TYPE="${ORCHESTRATOR_TYPE:-k8s}"
    K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
    K8S_APP_PREFIX="${K8S_APP_PREFIX:-op}"
    K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"
    DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-docker-compose.yml}"
    DOCKER_COMPOSE_PROJECT="${DOCKER_COMPOSE_PROJECT:-}"
    # All other vars (AWS_CLUSTER_NAME, L1_RPC_URLS, EOA, etc.)
    # are read directly from the environment — no mapping needed.

    # Store AWS keys in ~/.aws/credentials (standard location, mounted by Docker)
    if [ -n "${AWS_CLUSTER_NAME:-}" ] && [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
      AWS_PROFILE="${AWS_PROFILE:-${AWS_CLUSTER_NAME}}"
      store_aws_credentials "${AWS_PROFILE}" "${AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY}" "${AWS_REGION:-}"
    elif [ -n "${AWS_CLUSTER_NAME:-}" ]; then
      AWS_PROFILE="${AWS_PROFILE:-${AWS_CLUSTER_NAME}}"
    fi

  # --- Interactive mode ---
  else
    echo ""
    echo -e "${BOLD}--- SentinAI Environment Setup ---${NC}"
    echo ""

    # L2 RPC URL (required)
    read -rp "  L2 RPC URL (required): " L2_RPC_URL
    [[ -z "${L2_RPC_URL}" ]] && err "L2_RPC_URL is required."
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "L2_RPC_URL must start with http:// or https://."

    # AI Gateway URL (optional -- uses official Gateway if not entered)
    echo ""
    echo "  AI Gateway URL configuration:"
    echo "  All AI requests will be routed through the Gateway server."
    read -rp "  AI Gateway URL [https://api.ai.tokamak.network]: " AI_GATEWAY_URL
    AI_GATEWAY_URL="${AI_GATEWAY_URL:-https://api.ai.tokamak.network}"

    # AI Provider (required)
    echo ""
    echo "  Select AI Provider:"
    echo "    1) Anthropic (recommended)"
    echo "    2) OpenAI"
    echo "    3) Gemini"
    echo "    4) Qwen"
    read -rp "  Choose [1]: " ai_choice
    ai_choice="${ai_choice:-1}"

    case "${ai_choice}" in
      2)
        ai_key_name="OPENAI_API_KEY"
        read -rsp "  OpenAI API Key: " ai_key_value
        echo ""
        ;;
      3)
        ai_key_name="GEMINI_API_KEY"
        read -rsp "  Gemini API Key: " ai_key_value
        echo ""
        ;;
      4)
        ai_key_name="QWEN_API_KEY"
        read -rsp "  Qwen API Key: " ai_key_value
        echo ""
        ;;
      *)
        ai_key_name="ANTHROPIC_API_KEY"
        read -rsp "  Anthropic API Key: " ai_key_value
        echo ""
        ;;
    esac
    [[ -z "${ai_key_value}" ]] && err "AI API Key is required."

    # Chain plugin
    echo ""
    echo -e "  ${BOLD}Chain Plugin${NC}:"
    echo "    1) Thanos (default)"
    echo "    2) Optimism Tutorial (OP Stack)"
    read -rp "  Choose [1]: " chain_choice
    case "${chain_choice}" in
      2) CHAIN_TYPE="optimism" ;;
      *) CHAIN_TYPE="thanos" ;;
    esac

    if [ "${CHAIN_TYPE}" = "optimism" ]; then
      echo ""
      echo -e "  ${BOLD}Optimism Tutorial Chain Metadata${NC} (optional):"
      read -rp "  L2_CHAIN_ID [42069]: " L2_CHAIN_ID
      L2_CHAIN_ID="${L2_CHAIN_ID:-42069}"
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
    fi

    # Container Orchestrator
    echo ""
    echo -e "  ${BOLD}Container Orchestrator${NC}:"
    echo "    1) Kubernetes — AWS EKS (default)"
    echo "    2) Kubernetes — Local (minikube, kind, k3s, etc.)"
    echo "    3) Docker Compose — local L2 node"
    read -rp "  Choose [1]: " orch_choice
    case "${orch_choice}" in
      2) ORCHESTRATOR_TYPE="k8s"; _k8s_deploy="local" ;;
      3) ORCHESTRATOR_TYPE="docker" ;;
      *) ORCHESTRATOR_TYPE="k8s"; _k8s_deploy="eks" ;;
    esac

    if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
      # Docker Compose L2 node settings
      echo ""
      echo -e "  ${BOLD}Docker Compose L2 Node${NC}:"
      echo "  Path to the L2 node's docker-compose.yml file."
      read -rp "  Docker Compose file [docker-compose.yml]: " DOCKER_COMPOSE_FILE
      DOCKER_COMPOSE_FILE="${DOCKER_COMPOSE_FILE:-docker-compose.yml}"
      read -rp "  Docker Compose project name (press Enter for auto-detect): " DOCKER_COMPOSE_PROJECT
      DOCKER_COMPOSE_PROJECT="${DOCKER_COMPOSE_PROJECT:-}"
    elif [ "${_k8s_deploy}" = "local" ]; then
      # Local K8s — uses existing kubeconfig, no AWS setup needed
      echo ""
      echo -e "  ${BOLD}Local Kubernetes${NC}:"
      info "Using existing kubeconfig (~/.kube/config)."
      read -rp "  K8S_NAMESPACE [default]: " K8S_NAMESPACE
      K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
      read -rp "  K8S_APP_PREFIX [op]: " K8S_APP_PREFIX
      K8S_APP_PREFIX="${K8S_APP_PREFIX:-op}"
      read -rp "  K8S_STATEFULSET_PREFIX (press Enter if none): " K8S_STATEFULSET_PREFIX
      K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"
    else

    # AWS EKS Cluster Name
    echo ""
    read -rp "  AWS EKS Cluster Name (for K8s monitoring, press Enter to skip): " AWS_CLUSTER_NAME
    if [ -z "${AWS_CLUSTER_NAME}" ]; then
      warn "AWS_CLUSTER_NAME not set. Running in simulation mode without K8s monitoring."
    else
      # K8s namespace and pod prefix (only if cluster is set)
      read -rp "  K8S_NAMESPACE [${AWS_CLUSTER_NAME}]: " K8S_NAMESPACE
      K8S_NAMESPACE="${K8S_NAMESPACE:-${AWS_CLUSTER_NAME}}"
      read -rp "  K8S_APP_PREFIX [op]: " K8S_APP_PREFIX
      K8S_APP_PREFIX="${K8S_APP_PREFIX:-op}"
      read -rp "  K8S_STATEFULSET_PREFIX (e.g., sepolia-thanos-stack, press Enter if none): " K8S_STATEFULSET_PREFIX
      K8S_STATEFULSET_PREFIX="${K8S_STATEFULSET_PREFIX:-}"

      # AWS Authentication — credentials stored in ~/.aws/ (standard, mounted by Docker)
      echo ""
      echo -e "  ${BOLD}AWS Authentication${NC}"
      if [ -f "$HOME/.aws/credentials" ] && command -v aws &>/dev/null; then
        echo "  Existing AWS profiles found:"
        aws configure list-profiles 2>/dev/null | sed 's/^/    /'
        read -rp "  AWS Profile [${AWS_CLUSTER_NAME}]: " _profile_input
        AWS_PROFILE="${_profile_input:-${AWS_CLUSTER_NAME}}"
        # Create profile if it doesn't exist
        if ! aws configure list-profiles 2>/dev/null | grep -qx "${AWS_PROFILE}"; then
          warn "Profile '${AWS_PROFILE}' not found. Creating with 'aws configure'..."
          aws configure --profile "${AWS_PROFILE}"
        fi
      else
        echo "  No AWS credentials found (~/.aws/credentials)."
        echo "  Setting up AWS CLI profile: ${AWS_CLUSTER_NAME}"
        echo ""
        AWS_PROFILE="${AWS_CLUSTER_NAME}"
        aws configure --profile "${AWS_PROFILE}"
      fi

      # Region auto-detect from profile
      local _profile_region
      _profile_region=$(aws configure get region --profile "${AWS_PROFILE}" 2>/dev/null || echo "")
      if [ -n "${_profile_region}" ]; then
        AWS_REGION="${_profile_region}"
        info "Region: ${AWS_REGION} (from profile: ${AWS_PROFILE})"
      else
        # Fallback to EC2 IMDS
        local _imds_region="" _imds_tok
        _imds_tok=$(curl -sf -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 30" \
          --connect-timeout 1 http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
        if [ -n "${_imds_tok}" ]; then
          _imds_region=$(curl -sf -H "X-aws-ec2-metadata-token: ${_imds_tok}" \
            --connect-timeout 2 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo "")
        fi
        local region_default="${_imds_region:-ap-northeast-2}"
        read -rp "  AWS Region [${region_default}]: " AWS_REGION
        AWS_REGION="${AWS_REGION:-${region_default}}"
      fi
    fi
    fi  # end orchestrator type branch

    # L1 RPC Failover (optional)
    echo ""
    echo -e "  ${BOLD}L1 RPC Failover${NC} (spare endpoints for 429 auto-failover):"
    read -rp "  L1_RPC_URLS (comma-separated, press Enter to skip): " L1_RPC_URLS
    if [ -n "${L1_RPC_URLS}" ] && [ "${ORCHESTRATOR_TYPE}" != "docker" ]; then
      read -rp "  Enable L1 Proxyd ConfigMap integration? (y/N): " proxyd_choice
      if [[ "${proxyd_choice}" =~ ^[Yy]$ ]]; then
        L1_PROXYD_ENABLED="true"
        info "Proxyd ConfigMap name will be auto-detected at runtime."
      fi
    fi

    # EOA Balance Monitoring (optional)
    echo ""
    echo -e "  ${BOLD}EOA Balance Monitoring${NC} (batcher/proposer L1 ETH balance):"
    read -rp "  Enable EOA monitoring? (y/N): " eoa_choice
    if [[ "${eoa_choice}" =~ ^[Yy]$ ]]; then
      read -rp "  BATCHER_EOA_ADDRESS (0x..., press Enter to skip): " BATCHER_EOA_ADDRESS
      read -rp "  PROPOSER_EOA_ADDRESS (0x..., press Enter to skip): " PROPOSER_EOA_ADDRESS
      read -rsp "  TREASURY_PRIVATE_KEY (for auto-refill, press Enter for monitor-only): " TREASURY_PRIVATE_KEY
      echo ""
      read -rp "  EOA_BALANCE_CRITICAL_ETH [0.1]: " EOA_BALANCE_CRITICAL_ETH
      EOA_BALANCE_CRITICAL_ETH="${EOA_BALANCE_CRITICAL_ETH:-0.1}"
    fi

    # Scaling Simulation Mode
    if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
      SCALING_SIMULATION_MODE="false"
    elif [ -n "${AWS_CLUSTER_NAME}" ] || [ "${_k8s_deploy:-}" = "local" ]; then
      echo ""
      echo "  Simulation mode disables real K8s scaling (safe for testing)."
      read -rp "  Enable simulation mode? (y/N): " sim_choice
      if [[ "${sim_choice}" =~ ^[Yy]$ ]]; then
        SCALING_SIMULATION_MODE="true"
      else
        SCALING_SIMULATION_MODE="false"
      fi
    else
      SCALING_SIMULATION_MODE="true"
    fi

    # Auto-Remediation (optional)
    read -rp "  Enable auto-remediation? (y/N): " remediation_choice
    if [[ "${remediation_choice}" =~ ^[Yy]$ ]]; then
      AUTO_REMEDIATION_ENABLED="true"
    fi

    # HTTPS Domain (optional -- Caddy auto-certificate)
    echo ""
    echo "  HTTPS domain setup (Caddy will automatically issue Let's Encrypt certificates):"
    echo "  The server's public IP must be registered in DNS."
    read -rp "  Public Domain (e.g., sentinai.tokamak.network, press Enter to skip): " DOMAIN_NAME
    if [ -z "${DOMAIN_NAME}" ]; then
      info "Domain not set. HTTP-only mode (localhost:3002)."
    else
      info "Ports 80 (HTTP) and 443 (HTTPS) must be open in the firewall/Security List."
    fi

    # Base path (for multi-chain deployments under a subpath)
    echo ""
    echo "  URL base path for the dashboard (e.g., /thanos-sepolia, /titan-mainnet)."
    echo "  This serves the app at https://domain/<base-path>."
    read -rp "  Base Path (press Enter for root /): " NEXT_PUBLIC_BASE_PATH
    NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-}"

    # Network name (shown in dashboard header)
    echo ""
    echo "  Network name displayed in the dashboard header (e.g., Thanos Sepolia, Titan Mainnet)."
    local network_name_default="Thanos Sepolia"
    if [ "${CHAIN_TYPE:-thanos}" = "optimism" ]; then
      network_name_default="Optimism Tutorial L2"
    fi
    read -rp "  Network Name (press Enter for '${network_name_default}'): " NEXT_PUBLIC_NETWORK_NAME
    NEXT_PUBLIC_NETWORK_NAME="${NEXT_PUBLIC_NETWORK_NAME:-${network_name_default}}"

    # Slack Webhook (optional)
    read -rp "  Slack Webhook URL (optional, press Enter to skip): " ALERT_WEBHOOK_URL
  fi

  # --- Defaults for unset optional variables (set -u safety) ---
  # In non-interactive mode, env vars are preserved (:= only sets if unset/empty).
  # In interactive mode, read results are preserved. Vars skipped by user get safe defaults.
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
  : "${AWS_PROFILE:=}"
  : "${AWS_REGION:=}"
  : "${L1_RPC_URLS:=}"
  : "${L1_PROXYD_ENABLED:=}"
  : "${BATCHER_EOA_ADDRESS:=}"
  : "${PROPOSER_EOA_ADDRESS:=}"
  : "${TREASURY_PRIVATE_KEY:=}"
  : "${EOA_BALANCE_CRITICAL_ETH:=0.1}"
  : "${EOA_BALANCE_WARNING_ETH:=}"
  : "${EOA_REFILL_AMOUNT_ETH:=}"
  : "${EOA_REFILL_MAX_DAILY_ETH:=}"
  : "${EOA_REFILL_COOLDOWN_MIN:=}"
  : "${EOA_GAS_GUARD_GWEI:=}"
  : "${EOA_TREASURY_MIN_ETH:=}"
  : "${AUTO_REMEDIATION_ENABLED:=}"
  : "${ALERT_WEBHOOK_URL:=}"
  : "${DOMAIN_NAME:=${DOMAIN:-}}"
  : "${NEXT_PUBLIC_BASE_PATH:=}"
  : "${NEXT_PUBLIC_NETWORK_NAME:=}"

  # Chain-specific defaults
  if [ "${CHAIN_TYPE}" = "optimism" ] || [ "${CHAIN_TYPE}" = "my-l2" ] || [ "${CHAIN_TYPE}" = "op-stack" ]; then
    : "${L2_CHAIN_ID:=42069}"
    : "${L2_CHAIN_NAME:=Optimism Tutorial L2}"
    : "${L2_NETWORK_SLUG:=optimism-tutorial-l2}"
    : "${L2_EXPLORER_URL:=http://localhost:4000}"
    : "${L2_IS_TESTNET:=true}"
    : "${L1_CHAIN:=sepolia}"
    : "${NEXT_PUBLIC_NETWORK_NAME:=Optimism Tutorial L2}"
  else
    : "${NEXT_PUBLIC_NETWORK_NAME:=Thanos Sepolia}"
  fi

  # Determine SCALING_SIMULATION_MODE (interactive sets it above; non-interactive reads env)
  : "${SCALING_SIMULATION_MODE:=}"
  if [ -z "${SCALING_SIMULATION_MODE}" ]; then
    if [ -z "${AWS_CLUSTER_NAME}" ]; then
      SCALING_SIMULATION_MODE="true"
      log "EKS cluster not set -> enabling simulation mode (SCALING_SIMULATION_MODE=true)"
    else
      SCALING_SIMULATION_MODE="false"
    fi
  fi

  # Write .env.local (safely using printf, prevents variable expansion)
  cat > .env.local << 'ENVEOF'
# SentinAI Configuration
# Generated by install.sh
ENVEOF

  # Safely write user input values (no shell expansion)
  {
    printf '\n# === Required ===\n'
    printf 'L2_RPC_URL=%s\n' "${L2_RPC_URL}"
    printf 'AI_GATEWAY_URL=%s\n' "${AI_GATEWAY_URL}"
    printf '%s=%s\n' "${ai_key_name}" "${ai_key_value}"

    printf '\n# === Chain Plugin ===\n'
    printf 'CHAIN_TYPE=%s\n' "${CHAIN_TYPE}"
    [ -n "${L2_CHAIN_ID}" ] && printf 'L2_CHAIN_ID=%s\n' "${L2_CHAIN_ID}"
    [ -n "${L2_CHAIN_NAME}" ] && printf 'L2_CHAIN_NAME=%s\n' "${L2_CHAIN_NAME}"
    [ -n "${L2_NETWORK_SLUG}" ] && printf 'L2_NETWORK_SLUG=%s\n' "${L2_NETWORK_SLUG}"
    [ -n "${L2_EXPLORER_URL}" ] && printf 'L2_EXPLORER_URL=%s\n' "${L2_EXPLORER_URL}"
    [ -n "${L2_IS_TESTNET}" ] && printf 'L2_IS_TESTNET=%s\n' "${L2_IS_TESTNET}"
    [ -n "${L1_CHAIN}" ] && printf 'L1_CHAIN=%s\n' "${L1_CHAIN}"

    if [ "${ORCHESTRATOR_TYPE}" = "docker" ]; then
      printf '\n# === Container Orchestrator ===\n'
      printf 'ORCHESTRATOR_TYPE=docker\n'
      printf 'DOCKER_COMPOSE_FILE=%s\n' "${DOCKER_COMPOSE_FILE}"
      [ -n "${DOCKER_COMPOSE_PROJECT}" ] && printf 'DOCKER_COMPOSE_PROJECT=%s\n' "${DOCKER_COMPOSE_PROJECT}"
    else
      printf '\n# === K8s Monitoring ===\n'
      printf 'AWS_CLUSTER_NAME=%s\n' "${AWS_CLUSTER_NAME:-}"
      [ -n "${AWS_PROFILE}" ] && printf 'AWS_PROFILE=%s\n' "${AWS_PROFILE}"
      printf 'K8S_NAMESPACE=%s\n' "${K8S_NAMESPACE}"
      printf 'K8S_APP_PREFIX=%s\n' "${K8S_APP_PREFIX}"
      [ -n "${K8S_STATEFULSET_PREFIX}" ] && printf 'K8S_STATEFULSET_PREFIX=%s\n' "${K8S_STATEFULSET_PREFIX}"
      [ -n "${AWS_REGION}" ] && printf 'AWS_REGION=%s\n' "${AWS_REGION}"
      # AWS credentials: stored in ~/.aws/credentials (mounted by Docker)
    fi

    printf '\n# === Scaling ===\n'
    printf 'SCALING_SIMULATION_MODE=%s\n' "${SCALING_SIMULATION_MODE}"
    printf 'COST_TRACKING_ENABLED=true\n'
    printf 'AGENT_LOOP_ENABLED=true\n'
    [ "${AUTO_REMEDIATION_ENABLED}" = "true" ] && printf 'AUTO_REMEDIATION_ENABLED=true\n'

    # L1 RPC Failover (optional)
    if [ -n "${L1_RPC_URLS}" ]; then
      printf '\n# === L1 RPC Failover ===\n'
      printf 'L1_RPC_URLS=%s\n' "${L1_RPC_URLS}"
      if [ "${L1_PROXYD_ENABLED}" = "true" ]; then
        printf 'L1_PROXYD_ENABLED=true\n'
      fi
    fi

    # EOA Balance Monitoring (optional)
    if [ -n "${BATCHER_EOA_ADDRESS}${PROPOSER_EOA_ADDRESS}" ]; then
      printf '\n# === EOA Balance Monitoring ===\n'
      [ -n "${BATCHER_EOA_ADDRESS}" ] && printf 'BATCHER_EOA_ADDRESS=%s\n' "${BATCHER_EOA_ADDRESS}"
      [ -n "${PROPOSER_EOA_ADDRESS}" ] && printf 'PROPOSER_EOA_ADDRESS=%s\n' "${PROPOSER_EOA_ADDRESS}"
      [ -n "${TREASURY_PRIVATE_KEY}" ] && printf 'TREASURY_PRIVATE_KEY=%s\n' "${TREASURY_PRIVATE_KEY}"
      printf 'EOA_BALANCE_CRITICAL_ETH=%s\n' "${EOA_BALANCE_CRITICAL_ETH:-0.1}"
      [ -n "${EOA_BALANCE_WARNING_ETH}" ] && printf 'EOA_BALANCE_WARNING_ETH=%s\n' "${EOA_BALANCE_WARNING_ETH}"
      [ -n "${EOA_REFILL_AMOUNT_ETH}" ] && printf 'EOA_REFILL_AMOUNT_ETH=%s\n' "${EOA_REFILL_AMOUNT_ETH}"
      [ -n "${EOA_REFILL_MAX_DAILY_ETH}" ] && printf 'EOA_REFILL_MAX_DAILY_ETH=%s\n' "${EOA_REFILL_MAX_DAILY_ETH}"
      [ -n "${EOA_REFILL_COOLDOWN_MIN}" ] && printf 'EOA_REFILL_COOLDOWN_MIN=%s\n' "${EOA_REFILL_COOLDOWN_MIN}"
      [ -n "${EOA_GAS_GUARD_GWEI}" ] && printf 'EOA_GAS_GUARD_GWEI=%s\n' "${EOA_GAS_GUARD_GWEI}"
      [ -n "${EOA_TREASURY_MIN_ETH}" ] && printf 'EOA_TREASURY_MIN_ETH=%s\n' "${EOA_TREASURY_MIN_ETH}"
    fi

    # Note: REDIS_URL is set by docker-compose.yml (redis://redis:6379)

    # Deployment (optional)
    if [ -n "${NEXT_PUBLIC_BASE_PATH}" ] || [ -n "${NEXT_PUBLIC_NETWORK_NAME}" ]; then
      printf '\n# === Deployment ===\n'
      [ -n "${NEXT_PUBLIC_BASE_PATH}" ] && printf 'NEXT_PUBLIC_BASE_PATH=%s\n' "${NEXT_PUBLIC_BASE_PATH}"
      [ -n "${NEXT_PUBLIC_NETWORK_NAME}" ] && printf 'NEXT_PUBLIC_NETWORK_NAME=%s\n' "${NEXT_PUBLIC_NETWORK_NAME}"
    fi

    # Slack webhook (optional)
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      printf '\n# === Alerts ===\n'
      printf 'ALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL}"
    fi
  } >> .env.local

  chmod 600 .env.local
  log ".env.local created (permissions: 600)."

  # Generate .env for Docker Compose variable interpolation (build args + healthcheck)
  # Note: .env is read by docker-compose.yml for ${VARIABLE} substitution.
  # This is separate from .env.local which is loaded at runtime via env_file.
  printf 'NEXT_PUBLIC_BASE_PATH=%s\n' "${NEXT_PUBLIC_BASE_PATH}" > .env
  printf 'NEXT_PUBLIC_NETWORK_NAME=%s\n' "${NEXT_PUBLIC_NETWORK_NAME}" >> .env
  log ".env created (Docker Compose build args)."

  # Generate Caddyfile and update docker-compose.yml for HTTPS (if domain is set)
  if [ -n "${DOMAIN_NAME:-}" ]; then
    cat > Caddyfile << CADDYEOF
${DOMAIN_NAME} {
    reverse_proxy sentinai:8080
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
CADDYEOF
    log "Caddyfile created (domain: ${DOMAIN_NAME})."
  fi
}

# ============================================================
# Step 7: Configure K8s Cluster Access
# ============================================================
setup_k8s() {
  [ "${ORCHESTRATOR_TYPE:-}" = "docker" ] && return
  [ -z "${AWS_CLUSTER_NAME:-}" ] && { info "Skipping EKS kubeconfig (local K8s or no cluster)."; return; }
  [ -z "${AWS_PROFILE:-}" ] && {
    warn "AWS_PROFILE not set. Skipping K8s cluster setup."
    return
  }

  log "Setting up K8s cluster access (profile: ${AWS_PROFILE})..."

  # Auto-detect region from profile, then EC2 IMDS
  if [ -z "${AWS_REGION:-}" ]; then
    AWS_REGION=$(aws configure get region --profile "${AWS_PROFILE}" 2>/dev/null || echo "")
  fi
  if [ -z "${AWS_REGION:-}" ]; then
    local imds_token
    imds_token=$(curl -sf -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 30" \
      --connect-timeout 1 http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
    if [ -n "${imds_token}" ]; then
      AWS_REGION=$(curl -sf -H "X-aws-ec2-metadata-token: ${imds_token}" \
        --connect-timeout 2 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo "")
    fi
  fi

  if [ -z "${AWS_REGION:-}" ]; then
    warn "AWS_REGION could not be detected. Set AWS_REGION manually."
    warn "Skipping kubeconfig generation."
    return
  fi

  log "Region: ${AWS_REGION}, Cluster: ${AWS_CLUSTER_NAME}, Profile: ${AWS_PROFILE}"

  # Generate kubeconfig using named profile
  if aws eks update-kubeconfig \
       --name "${AWS_CLUSTER_NAME}" \
       --region "${AWS_REGION}" \
       --profile "${AWS_PROFILE}" 2>&1; then
    log "kubeconfig generated: ~/.kube/config"
  else
    warn "Failed to generate kubeconfig. Check credentials and cluster name."
    return
  fi

  # Fix permissions so Docker container (uid 1001 = nextjs) can read
  chmod 644 ~/.kube/config

  # Copy to /root/ since "sudo docker compose" resolves ~ as /root/
  if [ "$HOME" != "/root" ]; then
    sudo mkdir -p /root/.kube
    sudo cp ~/.kube/config /root/.kube/config
    sudo chmod 644 /root/.kube/config
  fi

  # Verify cluster access
  if kubectl get nodes --no-headers 2>/dev/null | head -3; then
    log "K8s cluster access verified."
  else
    warn "K8s cluster verification failed. Container may still work with mounted credentials."
  fi
}

# ============================================================
# Step 8: Build & Start
# ============================================================
start_services() {
  cd "${INSTALL_DIR}"

  # docker-compose.yml mounts ~/.kube/config and ~/.aws as bind mounts.
  # "sudo docker compose" resolves ~ to /root/, not the current user's home.
  # If /root/.kube/config doesn't exist, Docker creates it as a DIRECTORY,
  # causing: "error loading config file: read ~/.kube/config: is a directory"
  #
  # Fix: ensure both user and root paths have valid files.
  local _kube_paths=("$HOME/.kube" "/root/.kube")
  local _kp
  for _kp in "${_kube_paths[@]}"; do
    sudo mkdir -p "${_kp}"
    if sudo test -d "${_kp}/config"; then
      sudo rm -rf "${_kp}/config"
      warn "Removed invalid ${_kp}/config directory (was created by Docker)."
    fi
    if ! sudo test -f "${_kp}/config"; then
      sudo tee "${_kp}/config" > /dev/null << 'KUBEEOF'
apiVersion: v1
kind: Config
clusters: []
contexts: []
users: []
KUBEEOF
      sudo chmod 644 "${_kp}/config"
      info "Created placeholder kubeconfig: ${_kp}/config"
    fi
  done

  # Copy real kubeconfig to /root/ if user has one (sudo docker compose reads /root/)
  if [ -f "$HOME/.kube/config" ] && [ "$HOME" != "/root" ]; then
    sudo cp "$HOME/.kube/config" /root/.kube/config
    sudo chmod 644 /root/.kube/config
  fi

  # Copy AWS credentials to /root/ if user has them
  if [ -d "$HOME/.aws" ] && [ "$HOME" != "/root" ]; then
    sudo mkdir -p /root/.aws
    sudo cp -r "$HOME/.aws/." /root/.aws/ 2>/dev/null || true
  fi

  # Caddy HTTPS (production profile) if Caddyfile exists
  local -a compose_args=()
  local has_caddy="false"
  if [ -f Caddyfile ]; then
    compose_args=(--profile production)
    has_caddy="true"
    log "Caddy HTTPS enabled."
  fi

  log "Building Docker image... (first build may take 5-10 minutes)"
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" build

  log "Starting services..."
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" up -d

  log "Waiting for services to start (30 seconds)..."
  sleep 30

  # Health check with retries
  local retries=5
  local i
  for i in $(seq 1 ${retries}); do
    if curl -sf "http://localhost:3002${NEXT_PUBLIC_BASE_PATH}/api/health" > /dev/null 2>&1; then
      echo ""
      log "============================================"
      log "  SentinAI installation complete!"
      log "============================================"
      echo ""
      # Attempt to retrieve EC2 Public IP (IMDSv2)
      local public_ip imds_tok
      imds_tok=$(curl -sf -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 30" \
        --connect-timeout 1 http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
      if [ -n "${imds_tok}" ]; then
        public_ip=$(curl -sf -H "X-aws-ec2-metadata-token: ${imds_tok}" \
          --connect-timeout 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
      else
        public_ip=""
      fi
      local profile_flag=""
      if [ "${has_caddy}" = "true" ]; then
        profile_flag=" --profile production"
        # Extract domain from Caddyfile (first word of first non-comment, non-empty line)
        local caddy_domain
        caddy_domain=$(grep -v '^#' Caddyfile 2>/dev/null | grep -v '^\s*$' | head -1 | awk '{print $1}' || echo "")
        info "Dashboard: https://${caddy_domain}${NEXT_PUBLIC_BASE_PATH}"
        info "Caddy logs: sudo docker logs sentinai-caddy -f"
      elif [ -n "${public_ip}" ]; then
        info "Dashboard: http://${public_ip}:3002${NEXT_PUBLIC_BASE_PATH}"
      else
        info "Dashboard: http://localhost:3002${NEXT_PUBLIC_BASE_PATH}"
      fi
      info "View logs: cd ${INSTALL_DIR} && sudo docker compose${profile_flag} logs -f"
      info "Stop services: cd ${INSTALL_DIR} && sudo docker compose${profile_flag} down"
      info "Update:   cd ${INSTALL_DIR} && git pull && sudo docker compose${profile_flag} build && sudo docker compose${profile_flag} up -d"
      echo ""
      return
    fi
    warn "Health check attempt ${i}/${retries}... retrying in 10 seconds"
    sleep 10
  done

  warn "Health check failed. Check the logs:"
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" logs --tail=30 sentinai
}

# ============================================================
# Pre-flight: IMDSv2 Hop Limit guidance
# ============================================================
check_imds_hint() {
  # Check if running on EC2 instance (IMDSv2 method)
  local imds_token
  imds_token=$(curl -sf -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 30" \
    --connect-timeout 1 http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
  if [ -n "${imds_token}" ]; then
    info "EC2 instance detected."
    info "To use IAM Role from Docker containers, IMDSv2 hop-limit must be 2 or higher."
    info "Command: aws ec2 modify-instance-metadata-options --instance-id <ID> --http-put-response-hop-limit 2 --http-tokens required"
    echo ""
  fi
}

# ============================================================
# Main
# ============================================================
main() {
  echo ""
  echo -e "${BOLD}=========================================${NC}"
  echo -e "${BOLD}  SentinAI Installer${NC}"
  echo -e "${BOLD}=========================================${NC}"
  echo ""

  detect_os
  install_docker
  install_compose
  install_git
  install_aws_cli
  check_imds_hint
  setup_repo
  setup_env
  setup_k8s
  start_services
}

main "$@"
