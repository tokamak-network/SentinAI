#!/usr/bin/env bash
# ============================================================
# SentinAI Server Prerequisites
# Prepares a fresh Ubuntu server for SentinAI deployment.
# Run this BEFORE install.sh.
#
# Supports: Ubuntu 22.04/24.04, Amazon Linux 2023
#
# Usage:
#   bash scripts/setup-server.sh            # Interactive
#   curl -sSL <raw-url> | bash              # Remote
#
# What this script does:
#   1. System update
#   2. Essential packages (curl, jq, unzip)
#   3. Firewall (ufw): ports 22, 80, 443
#   4. AWS CLI v2 (for EKS kubeconfig)
#   5. kubectl (for EKS kubeconfig)
#   6. Swap file (if RAM < 4GB)
#
# Skip options (environment variables):
#   SKIP_FIREWALL=true    # Skip firewall setup
#   SKIP_AWS_CLI=true     # Skip AWS CLI installation
#   SKIP_KUBECTL=true     # Skip kubectl installation
#   SKIP_SWAP=true        # Skip swap file creation
# ============================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[setup]${NC} $*"; }
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
    err "Unsupported OS. Requires Ubuntu 22.04+ or Amazon Linux 2023."
  fi
  log "OS: ${PRETTY_NAME:-${OS_ID} ${OS_VERSION}}"
  ARCH=$(uname -m)
  log "Architecture: ${ARCH}"
}

# ============================================================
# Step 1: System Update & Essential Packages
# ============================================================
update_system() {
  log "Updating system packages..."
  case "${OS_ID}" in
    ubuntu|debian)
      sudo apt-get update -qq
      sudo apt-get upgrade -y -qq
      sudo apt-get install -y curl jq unzip ca-certificates gnupg lsb-release
      ;;
    amzn)
      sudo dnf update -y -q
      sudo dnf install -y curl jq unzip ca-certificates
      ;;
    *)
      warn "Unsupported OS for auto-update: ${OS_ID}. Skipping."
      return
      ;;
  esac
  log "System update complete."
}

# ============================================================
# Step 2: Firewall (UFW)
# ============================================================
setup_firewall() {
  if [ "${SKIP_FIREWALL:-false}" = "true" ]; then
    info "Firewall setup skipped (SKIP_FIREWALL=true)."
    return
  fi

  # Amazon Linux uses security groups, not ufw
  if [ "${OS_ID}" = "amzn" ]; then
    info "Amazon Linux detected. Use AWS Security Group for firewall rules:"
    info "  - SSH (22), HTTP (80), HTTPS (443) inbound from 0.0.0.0/0"
    return
  fi

  if ! command -v ufw &>/dev/null; then
    log "Installing ufw..."
    sudo apt-get install -y ufw
  fi

  log "Configuring firewall (ufw)..."
  sudo ufw --force reset > /dev/null 2>&1
  sudo ufw default deny incoming > /dev/null
  sudo ufw default allow outgoing > /dev/null
  sudo ufw allow 22/tcp comment "SSH" > /dev/null
  sudo ufw allow 80/tcp comment "HTTP (Caddy)" > /dev/null
  sudo ufw allow 443/tcp comment "HTTPS (Caddy)" > /dev/null
  sudo ufw --force enable > /dev/null

  log "Firewall configured:"
  sudo ufw status numbered
}

# ============================================================
# Step 3: AWS CLI v2
# ============================================================
install_aws_cli() {
  if [ "${SKIP_AWS_CLI:-false}" = "true" ]; then
    info "AWS CLI installation skipped (SKIP_AWS_CLI=true)."
    return
  fi

  if command -v aws &>/dev/null; then
    log "AWS CLI already installed: $(aws --version 2>&1 | head -1)"
    return
  fi

  log "Installing AWS CLI v2..."

  local aws_arch
  case "${ARCH}" in
    x86_64)  aws_arch="x86_64" ;;
    aarch64) aws_arch="aarch64" ;;
    *)       warn "Unsupported architecture for AWS CLI: ${ARCH}. Skipping."; return ;;
  esac

  local tmp_dir
  tmp_dir=$(mktemp -d)
  curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o "${tmp_dir}/awscliv2.zip"
  unzip -q "${tmp_dir}/awscliv2.zip" -d "${tmp_dir}"
  sudo "${tmp_dir}/aws/install" --update
  rm -rf "${tmp_dir}"

  log "AWS CLI installed: $(aws --version 2>&1 | head -1)"
}

# ============================================================
# Step 4: kubectl
# ============================================================
install_kubectl() {
  if [ "${SKIP_KUBECTL:-false}" = "true" ]; then
    info "kubectl installation skipped (SKIP_KUBECTL=true)."
    return
  fi

  if command -v kubectl &>/dev/null; then
    log "kubectl already installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client 2>&1 | head -1)"
    return
  fi

  log "Installing kubectl..."

  local kubectl_arch
  case "${ARCH}" in
    x86_64)  kubectl_arch="amd64" ;;
    aarch64) kubectl_arch="arm64" ;;
    *)       warn "Unsupported architecture for kubectl: ${ARCH}. Skipping."; return ;;
  esac

  local kubectl_version
  kubectl_version=$(curl -sL https://dl.k8s.io/release/stable.txt)

  curl -sLO "https://dl.k8s.io/release/${kubectl_version}/bin/linux/${kubectl_arch}/kubectl"
  curl -sLO "https://dl.k8s.io/release/${kubectl_version}/bin/linux/${kubectl_arch}/kubectl.sha256"
  echo "$(cat kubectl.sha256)  kubectl" | sha256sum -c - > /dev/null 2>&1
  sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
  rm -f kubectl kubectl.sha256

  log "kubectl installed: $(kubectl version --client 2>&1 | head -1)"
}

# ============================================================
# Step 5: Swap File
# ============================================================
setup_swap() {
  if [ "${SKIP_SWAP:-false}" = "true" ]; then
    info "Swap setup skipped (SKIP_SWAP=true)."
    return
  fi

  # Check if swap already exists
  local swap_total
  swap_total=$(free -m | awk '/Swap:/ {print $2}')
  if [ "${swap_total}" -gt 0 ]; then
    log "Swap already configured: ${swap_total}MB."
    return
  fi

  # Check RAM — only create swap if < 4GB
  local ram_mb
  ram_mb=$(free -m | awk '/Mem:/ {print $2}')
  if [ "${ram_mb}" -ge 4096 ]; then
    info "RAM: ${ram_mb}MB (>= 4GB). Swap not needed."
    return
  fi

  log "RAM: ${ram_mb}MB (< 4GB). Creating 2GB swap file..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile > /dev/null
  sudo swapon /swapfile

  # Persist across reboots
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  fi

  log "Swap configured: 2GB."
}

# ============================================================
# Summary
# ============================================================
print_summary() {
  echo ""
  log "============================================"
  log "  Server prerequisites complete!"
  log "============================================"
  echo ""
  info "Installed:"
  command -v curl   &>/dev/null && info "  curl   $(curl --version 2>/dev/null | head -1 | awk '{print $2}')"
  command -v jq     &>/dev/null && info "  jq     $(jq --version 2>/dev/null)"
  command -v docker &>/dev/null && info "  docker $(docker --version 2>/dev/null | head -1)" || info "  docker — not yet (install.sh will handle)"
  command -v aws    &>/dev/null && info "  aws    $(aws --version 2>&1 | awk '{print $1}')"
  command -v kubectl &>/dev/null && info "  kubectl $(kubectl version --client 2>&1 | head -1)"
  echo ""
  info "Next step:"
  info "  bash scripts/install.sh"
  echo ""
}

# ============================================================
# Main
# ============================================================
main() {
  echo ""
  echo -e "${BOLD}=========================================${NC}"
  echo -e "${BOLD}  SentinAI Server Prerequisites${NC}"
  echo -e "${BOLD}=========================================${NC}"
  echo ""

  detect_os
  update_system
  setup_firewall
  install_aws_cli
  install_kubectl
  setup_swap
  print_summary
}

main "$@"
