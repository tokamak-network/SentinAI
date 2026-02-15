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
#   SENTINAI_L2_RPC_URL=https://rpc.example.com
#   SENTINAI_AI_GATEWAY_URL=https://...  # Optional (AI Gateway URL, uses official Gateway if not set)
#   SENTINAI_AI_PROVIDER=anthropic     # anthropic (default), openai, gemini
#   SENTINAI_AI_KEY=sk-ant-...
#   SENTINAI_CLUSTER_NAME=my-cluster   # Simulation mode if not set
#   SENTINAI_K8S_NAMESPACE=default     # K8s namespace (default: default)
#   SENTINAI_K8S_APP_PREFIX=op         # K8s pod label prefix (default: op)
#   SENTINAI_AWS_PROFILE=my-profile    # Optional (multi-account AWS)
#   SENTINAI_L1_RPC_URLS=https://...   # Optional (comma-separated spare L1 RPC endpoints)
#   SENTINAI_L1_PROXYD_ENABLED=true    # Optional (L1 Proxyd ConfigMap integration)
#   SENTINAI_L1_PROXYD_CONFIGMAP_NAME=proxyd-config  # Optional
#   SENTINAI_BATCHER_EOA_ADDRESS=0x... # Optional (EOA balance monitoring)
#   SENTINAI_PROPOSER_EOA_ADDRESS=0x...# Optional
#   SENTINAI_TREASURY_PRIVATE_KEY=0x...# Optional (auto-refill)
#   SENTINAI_EOA_BALANCE_CRITICAL_ETH=0.1  # Optional
#   SENTINAI_REDIS_URL=redis://...     # Optional (state persistence)
#   SENTINAI_AUTO_REMEDIATION=true     # Optional
#   SENTINAI_DOMAIN=sentinai.example.com  # Optional (HTTPS domain)
#   SENTINAI_WEBHOOK_URL=https://...   # Optional
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
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
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
# Step 4: Clone / Update Repository
# ============================================================
setup_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Existing installation found: ${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    git fetch origin
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

  if [ -f .env.local ]; then
    log ".env.local file already exists."
    if [ -n "${SENTINAI_L2_RPC_URL:-}" ]; then
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

  local L2_RPC_URL="" ai_key_name="" ai_key_value="" AI_GATEWAY_URL=""
  local AWS_CLUSTER_NAME="" K8S_NAMESPACE="default" K8S_APP_PREFIX="op" AWS_PROFILE=""
  local L1_RPC_URLS="" L1_PROXYD_ENABLED="" L1_PROXYD_CONFIGMAP_NAME=""
  local BATCHER_EOA_ADDRESS="" PROPOSER_EOA_ADDRESS="" TREASURY_PRIVATE_KEY="" EOA_BALANCE_CRITICAL_ETH=""
  local REDIS_URL="" AUTO_REMEDIATION_ENABLED=""
  local DOMAIN_NAME="" ALERT_WEBHOOK_URL=""

  # --- Partial env var detection: error early ---
  if [ -n "${SENTINAI_L2_RPC_URL:-}" ] && [ -z "${SENTINAI_AI_KEY:-}" ]; then
    err "Non-interactive mode: SENTINAI_L2_RPC_URL is set but SENTINAI_AI_KEY is missing."
  fi
  if [ -z "${SENTINAI_L2_RPC_URL:-}" ] && [ -n "${SENTINAI_AI_KEY:-}" ]; then
    err "Non-interactive mode: SENTINAI_AI_KEY is set but SENTINAI_L2_RPC_URL is missing."
  fi

  # --- Non-interactive mode: use SENTINAI_* environment variables ---
  if [ -n "${SENTINAI_L2_RPC_URL:-}" ] && [ -n "${SENTINAI_AI_KEY:-}" ]; then
    log "Non-interactive mode detected."
    L2_RPC_URL="${SENTINAI_L2_RPC_URL}"
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "SENTINAI_L2_RPC_URL must start with http:// or https://."

    ai_key_value="${SENTINAI_AI_KEY}"
    case "${SENTINAI_AI_PROVIDER:-anthropic}" in
      anthropic) ai_key_name="ANTHROPIC_API_KEY" ;;
      openai)    ai_key_name="OPENAI_API_KEY" ;;
      gemini)    ai_key_name="GEMINI_API_KEY" ;;
      *)         err "Unsupported AI Provider: ${SENTINAI_AI_PROVIDER}. (choose from: anthropic, openai, gemini)" ;;
    esac

    AI_GATEWAY_URL="${SENTINAI_AI_GATEWAY_URL:-https://api.ai.tokamak.network}"
    AWS_CLUSTER_NAME="${SENTINAI_CLUSTER_NAME:-}"
    K8S_NAMESPACE="${SENTINAI_K8S_NAMESPACE:-default}"
    K8S_APP_PREFIX="${SENTINAI_K8S_APP_PREFIX:-op}"
    AWS_PROFILE="${SENTINAI_AWS_PROFILE:-}"
    L1_RPC_URLS="${SENTINAI_L1_RPC_URLS:-}"
    L1_PROXYD_ENABLED="${SENTINAI_L1_PROXYD_ENABLED:-}"
    L1_PROXYD_CONFIGMAP_NAME="${SENTINAI_L1_PROXYD_CONFIGMAP_NAME:-}"
    BATCHER_EOA_ADDRESS="${SENTINAI_BATCHER_EOA_ADDRESS:-}"
    PROPOSER_EOA_ADDRESS="${SENTINAI_PROPOSER_EOA_ADDRESS:-}"
    TREASURY_PRIVATE_KEY="${SENTINAI_TREASURY_PRIVATE_KEY:-}"
    EOA_BALANCE_CRITICAL_ETH="${SENTINAI_EOA_BALANCE_CRITICAL_ETH:-}"
    REDIS_URL="${SENTINAI_REDIS_URL:-}"
    AUTO_REMEDIATION_ENABLED="${SENTINAI_AUTO_REMEDIATION:-}"
    DOMAIN_NAME="${SENTINAI_DOMAIN:-}"
    ALERT_WEBHOOK_URL="${SENTINAI_WEBHOOK_URL:-}"

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
      *)
        ai_key_name="ANTHROPIC_API_KEY"
        read -rsp "  Anthropic API Key: " ai_key_value
        echo ""
        ;;
    esac
    [[ -z "${ai_key_value}" ]] && err "AI API Key is required."

    # AWS EKS Cluster Name
    echo ""
    read -rp "  AWS EKS Cluster Name (for K8s monitoring, press Enter to skip): " AWS_CLUSTER_NAME
    if [ -z "${AWS_CLUSTER_NAME}" ]; then
      warn "AWS_CLUSTER_NAME not set. Running in simulation mode without K8s monitoring."
    else
      # K8s namespace and pod prefix (only if cluster is set)
      read -rp "  K8S_NAMESPACE [default]: " K8S_NAMESPACE
      K8S_NAMESPACE="${K8S_NAMESPACE:-default}"
      read -rp "  K8S_APP_PREFIX [op]: " K8S_APP_PREFIX
      K8S_APP_PREFIX="${K8S_APP_PREFIX:-op}"
      read -rp "  AWS_PROFILE (press Enter to skip): " AWS_PROFILE
    fi

    # L1 RPC Failover (optional)
    echo ""
    echo -e "  ${BOLD}L1 RPC Failover${NC} (spare endpoints for 429 auto-failover):"
    read -rp "  L1_RPC_URLS (comma-separated, press Enter to skip): " L1_RPC_URLS
    if [ -n "${L1_RPC_URLS}" ]; then
      read -rp "  Enable L1 Proxyd ConfigMap integration? (y/N): " proxyd_choice
      if [[ "${proxyd_choice}" =~ ^[Yy]$ ]]; then
        L1_PROXYD_ENABLED="true"
        read -rp "  L1_PROXYD_CONFIGMAP_NAME [proxyd-config]: " L1_PROXYD_CONFIGMAP_NAME
        L1_PROXYD_CONFIGMAP_NAME="${L1_PROXYD_CONFIGMAP_NAME:-proxyd-config}"
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

    # Redis (optional)
    echo ""
    read -rp "  Redis URL (for state persistence, press Enter for in-memory): " REDIS_URL

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

    # Slack Webhook (optional)
    read -rp "  Slack Webhook URL (optional, press Enter to skip): " ALERT_WEBHOOK_URL
  fi

  # Determine SCALING_SIMULATION_MODE based on cluster name
  local scaling_mode="false"
  if [ -z "${AWS_CLUSTER_NAME}" ]; then
    scaling_mode="true"
    log "EKS cluster not set -> enabling simulation mode (SCALING_SIMULATION_MODE=true)"
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

    printf '\n# === K8s Monitoring ===\n'
    printf 'AWS_CLUSTER_NAME=%s\n' "${AWS_CLUSTER_NAME:-}"
    printf 'K8S_NAMESPACE=%s\n' "${K8S_NAMESPACE}"
    printf 'K8S_APP_PREFIX=%s\n' "${K8S_APP_PREFIX}"
    [ -n "${AWS_PROFILE}" ] && printf 'AWS_PROFILE=%s\n' "${AWS_PROFILE}"

    printf '\n# === Scaling ===\n'
    printf 'SCALING_SIMULATION_MODE=%s\n' "${scaling_mode}"
    printf 'COST_TRACKING_ENABLED=true\n'
    printf 'AGENT_LOOP_ENABLED=true\n'
    [ "${AUTO_REMEDIATION_ENABLED}" = "true" ] && printf 'AUTO_REMEDIATION_ENABLED=true\n'

    # L1 RPC Failover (optional)
    if [ -n "${L1_RPC_URLS}" ]; then
      printf '\n# === L1 RPC Failover ===\n'
      printf 'L1_RPC_URLS=%s\n' "${L1_RPC_URLS}"
      if [ "${L1_PROXYD_ENABLED}" = "true" ]; then
        printf 'L1_PROXYD_ENABLED=true\n'
        printf 'L1_PROXYD_CONFIGMAP_NAME=%s\n' "${L1_PROXYD_CONFIGMAP_NAME}"
      fi
    fi

    # EOA Balance Monitoring (optional)
    if [ -n "${BATCHER_EOA_ADDRESS}${PROPOSER_EOA_ADDRESS}" ]; then
      printf '\n# === EOA Balance Monitoring ===\n'
      [ -n "${BATCHER_EOA_ADDRESS}" ] && printf 'BATCHER_EOA_ADDRESS=%s\n' "${BATCHER_EOA_ADDRESS}"
      [ -n "${PROPOSER_EOA_ADDRESS}" ] && printf 'PROPOSER_EOA_ADDRESS=%s\n' "${PROPOSER_EOA_ADDRESS}"
      [ -n "${TREASURY_PRIVATE_KEY}" ] && printf 'TREASURY_PRIVATE_KEY=%s\n' "${TREASURY_PRIVATE_KEY}"
      printf 'EOA_BALANCE_CRITICAL_ETH=%s\n' "${EOA_BALANCE_CRITICAL_ETH:-0.1}"
    fi

    # Redis (optional)
    if [ -n "${REDIS_URL}" ]; then
      printf '\n# === State Store ===\n'
      printf 'REDIS_URL=%s\n' "${REDIS_URL}"
    fi

    # Slack webhook (optional)
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
      printf '\n# === Alerts ===\n'
      printf 'ALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL}"
    fi
  } >> .env.local

  chmod 600 .env.local
  log ".env.local created (permissions: 600)."

  # Generate Caddyfile for HTTPS (if domain is set)
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
# Step 6: Build & Start
# ============================================================
start_services() {
  cd "${INSTALL_DIR}"

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
    if curl -sf http://localhost:3002/api/health > /dev/null 2>&1; then
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
        info "Dashboard: https://${caddy_domain}/thanos-sepolia"
        info "Caddy logs: sudo docker logs sentinai-caddy -f"
      elif [ -n "${public_ip}" ]; then
        info "Dashboard: http://${public_ip}:3002/thanos-sepolia"
      else
        info "Dashboard: http://localhost:3002/thanos-sepolia"
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
  check_imds_hint
  setup_repo
  setup_env
  start_services
}

main "$@"
