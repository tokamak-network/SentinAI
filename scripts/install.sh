#!/usr/bin/env bash
# ============================================================
# SentinAI Installer
# Supports: Amazon Linux 2023, Ubuntu 22.04/24.04
#
# Usage:
#   bash scripts/install.sh            # 로컬 실행
#   curl -sSL <raw-url> | bash         # 원격 실행
#
# Environment overrides:
#   SENTINAI_DIR=/opt/sentinai         # 설치 경로 (기본: /opt/sentinai)
#   SENTINAI_BRANCH=main               # Git 브랜치 (기본: main)
#
# Non-interactive mode (CI/CD, user-data):
#   SENTINAI_L2_RPC_URL=https://rpc.example.com
#   SENTINAI_AI_PROVIDER=anthropic     # anthropic(기본), openai, gemini
#   SENTINAI_AI_KEY=sk-ant-...
#   SENTINAI_CLUSTER_NAME=my-cluster   # 미설정 시 시뮬레이션 모드
#   SENTINAI_DOMAIN=sentinai.example.com  # 선택 (HTTPS 도메인)
#   SENTINAI_WEBHOOK_URL=https://...   # 선택
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
    err "지원하지 않는 OS입니다. Amazon Linux 2023 또는 Ubuntu 22.04+ 필요."
  fi
  log "OS: ${PRETTY_NAME:-${OS_ID} ${OS_VERSION}}"
}

# ============================================================
# Step 1: Docker
# ============================================================
install_docker() {
  if command -v docker &>/dev/null; then
    log "Docker 이미 설치됨: $(docker --version | head -1)"
    return
  fi

  log "Docker 설치 중..."
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
      err "Docker 자동 설치 미지원: ${OS_ID}. 수동으로 Docker를 설치한 후 다시 실행하세요."
      ;;
  esac

  sudo usermod -aG docker "${USER}" 2>/dev/null || true
  log "Docker 설치 완료."
}

# ============================================================
# Step 2: Docker Compose
# ============================================================
install_compose() {
  if docker compose version &>/dev/null 2>&1; then
    log "Docker Compose 이미 설치됨: $(docker compose version 2>/dev/null | head -1)"
    return
  fi

  log "Docker Compose plugin 설치 중..."
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
      # docker-compose-plugin은 Docker 패키지와 함께 설치됨
      log "Docker Compose는 Docker 패키지에 포함되어 있습니다."
      ;;
  esac
  log "Docker Compose 설치 완료."
}

# ============================================================
# Step 3: Git
# ============================================================
install_git() {
  if command -v git &>/dev/null; then
    log "Git 이미 설치됨: $(git --version)"
    return
  fi

  log "Git 설치 중..."
  case "${OS_ID}" in
    amzn)     sudo dnf install -y git ;;
    ubuntu|debian) sudo apt-get install -y git ;;
  esac
  log "Git 설치 완료."
}

# ============================================================
# Step 4: Clone / Update Repository
# ============================================================
setup_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log "기존 설치 발견: ${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    git fetch origin
    git checkout "${BRANCH}"
    git pull origin "${BRANCH}"
    log "소스 코드 업데이트 완료."
  else
    log "저장소 클론 중... (branch: ${BRANCH})"
    sudo mkdir -p "$(dirname "${INSTALL_DIR}")"
    sudo chown "${USER}":"$(id -gn)" "$(dirname "${INSTALL_DIR}")"
    git clone -b "${BRANCH}" "${SENTINAI_REPO}" "${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    log "클론 완료: ${INSTALL_DIR}"
  fi
}

# ============================================================
# Step 5: Configure .env.local
# ============================================================
setup_env() {
  cd "${INSTALL_DIR}"

  if [ -f .env.local ]; then
    log ".env.local 파일이 이미 존재합니다."
    if [ -n "${SENTINAI_L2_RPC_URL:-}" ]; then
      cp .env.local ".env.local.bak.$(date +%s)"
      log "비대화형 모드: 기존 .env.local을 백업 후 덮어씁니다."
    else
      read -rp "  기존 설정을 유지하시겠습니까? (Y/n): " keep_env
      if [[ ! "${keep_env}" =~ ^[Nn]$ ]]; then
        log "기존 .env.local 유지."
        return
      fi
    fi
  fi

  local L2_RPC_URL="" ai_key_name="" ai_key_value=""
  local AWS_CLUSTER_NAME="" DOMAIN_NAME="" ALERT_WEBHOOK_URL=""

  # --- Partial env var detection: error early ---
  if [ -n "${SENTINAI_L2_RPC_URL:-}" ] && [ -z "${SENTINAI_AI_KEY:-}" ]; then
    err "비대화형 모드: SENTINAI_L2_RPC_URL이 설정되었지만 SENTINAI_AI_KEY가 누락되었습니다."
  fi
  if [ -z "${SENTINAI_L2_RPC_URL:-}" ] && [ -n "${SENTINAI_AI_KEY:-}" ]; then
    err "비대화형 모드: SENTINAI_AI_KEY가 설정되었지만 SENTINAI_L2_RPC_URL이 누락되었습니다."
  fi

  # --- Non-interactive mode: use SENTINAI_* environment variables ---
  if [ -n "${SENTINAI_L2_RPC_URL:-}" ] && [ -n "${SENTINAI_AI_KEY:-}" ]; then
    log "비대화형 모드 감지됨."
    L2_RPC_URL="${SENTINAI_L2_RPC_URL}"
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "SENTINAI_L2_RPC_URL은 http:// 또는 https://로 시작해야 합니다."

    ai_key_value="${SENTINAI_AI_KEY}"
    case "${SENTINAI_AI_PROVIDER:-anthropic}" in
      anthropic) ai_key_name="ANTHROPIC_API_KEY" ;;
      openai)    ai_key_name="OPENAI_API_KEY" ;;
      gemini)    ai_key_name="GEMINI_API_KEY" ;;
      *)         err "지원하지 않는 AI Provider: ${SENTINAI_AI_PROVIDER}. (anthropic, openai, gemini 중 선택)" ;;
    esac

    AWS_CLUSTER_NAME="${SENTINAI_CLUSTER_NAME:-}"
    DOMAIN_NAME="${SENTINAI_DOMAIN:-}"
    ALERT_WEBHOOK_URL="${SENTINAI_WEBHOOK_URL:-}"

  # --- Interactive mode ---
  else
    echo ""
    echo -e "${BOLD}--- SentinAI 환경 설정 ---${NC}"
    echo ""

    # L2 RPC URL (필수)
    read -rp "  L2 RPC URL (필수): " L2_RPC_URL
    [[ -z "${L2_RPC_URL}" ]] && err "L2_RPC_URL은 필수입니다."
    [[ ! "${L2_RPC_URL}" =~ ^https?:// ]] && err "L2_RPC_URL은 http:// 또는 https://로 시작해야 합니다."

    # AI Provider (필수)
    echo ""
    echo "  AI Provider 선택:"
    echo "    1) Anthropic (권장)"
    echo "    2) OpenAI"
    echo "    3) Gemini"
    read -rp "  선택 [1]: " ai_choice
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
    [[ -z "${ai_key_value}" ]] && err "AI API Key는 필수입니다."

    # AWS EKS Cluster Name
    echo ""
    read -rp "  AWS EKS Cluster Name (K8s 모니터링용, Enter로 건너뛰기): " AWS_CLUSTER_NAME
    if [ -z "${AWS_CLUSTER_NAME}" ]; then
      warn "AWS_CLUSTER_NAME 미설정. K8s 모니터링 없이 시뮬레이션 모드로 실행됩니다."
    fi

    # HTTPS Domain (선택 — Caddy auto-certificate)
    echo ""
    echo "  HTTPS 도메인 설정 (Caddy가 Let's Encrypt 인증서를 자동 발급합니다):"
    echo "  서버의 Public IP가 DNS에 등록되어 있어야 합니다."
    read -rp "  Public Domain (e.g., sentinai.tokamak.network, Enter로 건너뛰기): " DOMAIN_NAME
    if [ -z "${DOMAIN_NAME}" ]; then
      info "도메인 미설정. HTTP 전용 모드 (localhost:3002)."
    else
      info "포트 80(HTTP), 443(HTTPS)이 방화벽/Security List에서 열려 있어야 합니다."
    fi

    # Slack Webhook (선택)
    read -rp "  Slack Webhook URL (선택, Enter로 건너뛰기): " ALERT_WEBHOOK_URL
  fi

  # Determine SCALING_SIMULATION_MODE based on cluster name
  local scaling_mode="false"
  if [ -z "${AWS_CLUSTER_NAME}" ]; then
    scaling_mode="true"
    log "EKS 클러스터 미설정 → 시뮬레이션 모드 활성화 (SCALING_SIMULATION_MODE=true)"
  fi

  # Write .env.local (printf로 안전하게 기록, 변수 확장 방지)
  cat > .env.local << 'ENVEOF'
# SentinAI Configuration
# L2 Chain RPC (필수)
# AI Provider (필수)
# Kubernetes Monitoring
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
# Scaling
COST_TRACKING_ENABLED=true
ENVEOF

  # 사용자 입력값을 안전하게 기록 (셸 확장 없음)
  {
    printf 'L2_RPC_URL=%s\n' "${L2_RPC_URL}"
    printf '%s=%s\n' "${ai_key_name}" "${ai_key_value}"
    printf 'AWS_CLUSTER_NAME=%s\n' "${AWS_CLUSTER_NAME:-}"
    printf 'SCALING_SIMULATION_MODE=%s\n' "${scaling_mode}"
  } >> .env.local

  # Slack webhook (선택)
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    printf '\n# Alert\nALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL}" >> .env.local
  fi

  chmod 600 .env.local
  log ".env.local 생성 완료 (권한: 600)."

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
    log "Caddyfile 생성 완료 (도메인: ${DOMAIN_NAME})."
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
    log "Caddy HTTPS 활성화됨."
  fi

  log "Docker 이미지 빌드 중... (첫 빌드 시 5-10분 소요)"
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" build

  log "서비스 시작 중..."
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" up -d

  log "서비스 시작 대기 (30초)..."
  sleep 30

  # Health check with retries
  local retries=5
  local i
  for i in $(seq 1 ${retries}); do
    if curl -sf http://localhost:3002/api/health > /dev/null 2>&1; then
      echo ""
      log "============================================"
      log "  SentinAI 설치 완료!"
      log "============================================"
      echo ""
      # EC2 Public IP 조회 시도 (IMDSv2)
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
        info "대시보드: https://${caddy_domain}/thanos-sepolia"
        info "Caddy 로그: sudo docker logs sentinai-caddy -f"
      elif [ -n "${public_ip}" ]; then
        info "대시보드: http://${public_ip}:3002/thanos-sepolia"
      else
        info "대시보드: http://localhost:3002/thanos-sepolia"
      fi
      info "로그 확인: cd ${INSTALL_DIR} && sudo docker compose${profile_flag} logs -f"
      info "서비스 중지: cd ${INSTALL_DIR} && sudo docker compose${profile_flag} down"
      info "업데이트:   cd ${INSTALL_DIR} && git pull && sudo docker compose${profile_flag} build && sudo docker compose${profile_flag} up -d"
      echo ""
      return
    fi
    warn "헬스체크 시도 ${i}/${retries}... 10초 후 재시도"
    sleep 10
  done

  warn "헬스체크에 실패했습니다. 로그를 확인하세요:"
  sudo docker compose "${compose_args[@]+"${compose_args[@]}"}" logs --tail=30 sentinai
}

# ============================================================
# Pre-flight: IMDSv2 Hop Limit 안내
# ============================================================
check_imds_hint() {
  # EC2 인스턴스인지 확인 (IMDSv2 방식)
  local imds_token
  imds_token=$(curl -sf -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 30" \
    --connect-timeout 1 http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
  if [ -n "${imds_token}" ]; then
    info "EC2 인스턴스 감지됨."
    info "Docker 컨테이너에서 IAM Role을 사용하려면 IMDSv2 hop-limit이 2 이상이어야 합니다."
    info "설정 명령: aws ec2 modify-instance-metadata-options --instance-id <ID> --http-put-response-hop-limit 2 --http-tokens required"
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
