#!/bin/bash

##############################################################################
# SentinAI 5분 데모 자동화 스크립트
# 사용법: bash scripts/demo-5min.sh
#
# 시나리오:
#   0-60s:   Stable (기본 모드)
#   60-120s: Rising (부하 증가)
#   120-180s: Spike (긴급 상황)
#   180-240s: Falling (정상화)
#   240-300s: Live + 마무리
##############################################################################

set -e

# ============================================================================
# 색상 정의
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# ============================================================================
# 설정
# ============================================================================
API_URL="http://localhost:3002"
DASHBOARD_URL="http://localhost:3002"
DEMO_DURATION=300  # 5분 (초)
SCENARIO_DURATION=60  # 각 시나리오 60초

# ============================================================================
# 유틸리티 함수
# ============================================================================

print_header() {
    echo -e "\n${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} $1"
    echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}\n"
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

countdown() {
    local seconds=$1
    local label=$2

    while [ $seconds -gt 0 ]; do
        printf "\r${CYAN}⏱️  $label: %02d초 남음${NC}" $seconds
        sleep 1
        ((seconds--))
    done
    printf "\r${GREEN}✓ $label: 완료!${NC}\n"
}

inject_seed() {
    local scenario=$1
    local start_time=$2

    print_step "Seed 주입: $scenario"

    # curl 요청
    response=$(curl -s -X POST "${API_URL}/api/metrics/seed?scenario=${scenario}")

    # 응답 파싱
    injected=$(echo $response | grep -o '"injectedCount":[0-9]*' | cut -d: -f2)
    ttl=$(echo $response | grep -o '"ttlSeconds":[0-9]*' | cut -d: -f2)

    if [ -z "$injected" ]; then
        print_error "Seed 주입 실패!"
        echo "응답: $response"
        return 1
    fi

    print_success "$injected개 메트릭 주입 (TTL: ${ttl}초)"
    echo "    CPU Range: $(echo $response | grep -o '"cpuRange":"[^"]*' | cut -d'"' -f4)"
    echo "    TxPool Range: $(echo $response | grep -o '"txPoolRange":"[^"]*' | cut -d'"' -f4)"

    return 0
}

# ============================================================================
# 사전 검사
# ============================================================================

check_prerequisites() {
    print_header "사전 검사"

    # Dev 서버 확인
    print_step "Dev 서버 상태 확인..."
    if ! curl -s "${API_URL}/api/health" > /dev/null 2>&1; then
        print_error "Dev 서버가 실행 중이지 않습니다!"
        print_warning "실행: npm run dev"
        return 1
    fi
    print_success "Dev 서버 정상 (${API_URL})"

    # 대시보드 접근성 확인
    print_step "대시보드 접근 확인..."
    if curl -s "${DASHBOARD_URL}" | grep -q "SentinAI" > /dev/null 2>&1; then
        print_success "대시보드 정상"
    else
        print_warning "대시보드 응답 없음 (URL: ${DASHBOARD_URL})"
    fi

    return 0
}

# ============================================================================
# 데모 진행
# ============================================================================

demo_intro() {
    print_header "SentinAI 5분 데모 시작"

    cat << 'EOF'
📊 SentinAI는 L2 네트워크의 자율 운영 시스템입니다

🎯 데모 구성:
   • Stable (0-60s)   : 기본 안정 모드
   • Rising (60-120s) : 부하 점진 증가 & 스케일링
   • Spike (120-180s) : 긴급 상황 & 자동 복구
   • Falling (180-240s): 부하 감소 & 비용 절감
   • Live (240-300s)  : 실제 데이터 & 마무리

💡 관찰 포인트:
   ✓ Activity Log: 30초마다 Agent Loop 사이클 기록
   ✓ System Health: vCPU 변화 (1/8 → 4/8 → 1/8)
   ✓ Monthly Cost: $41 → $165 → $41 (비용 변화)
   ✓ Anomaly Monitor: 이상 감지 및 대응

🌐 대시보드: http://localhost:3002

EOF

    print_step "준비 확인"
    echo "다음 항목이 준비되었는지 확인하세요:"
    echo "  ☐ 대시보드 브라우저 탭 열림"
    echo "  ☐ Dev 서버 실행 중"
    echo "  ☐ 이 터미널 준비"
    echo ""
    read -p "🚀 시작할 준비가 되었습니까? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "데모 취소됨"
        return 1
    fi

    return 0
}

# ============================================================================
# 시나리오별 진행
# ============================================================================

stage_1_stable() {
    print_header "Stage 1: STABLE (0-60초)"

    cat << 'EOF'
📈 상황: 정상 운영 중
   • CPU: ~20%
   • vCPU: 1/8
   • TxPool: 20개
   • Status: IDLE / MONITORING ACTIVE

🎯 포인트:
   1. 대시보드 기본 구성 확인
   2. Activity Log에서 30초마다 IDLE 기록
   3. Network Stats Bar의 L1/L2 블록 진행

⏱️  60초 대기...
EOF

    countdown 60 "Stable 모드"
}

stage_2_rising() {
    print_header "Stage 2: RISING (60-120초)"

    cat << 'EOF'
📊 상황: 부하 점진적 증가
   • CPU: 15% → 50% (증가)
   • TxPool: 10 → 80개 (8배 증가)
   • Trend: 상승 추세 감지

🎯 주요 이벤트:
   ✓ Z-Score 분석: 상승 추세 감지 (slope > 0.5)
   ✓ Hybrid Score: 50점 → HIGH
   ✓ Scaling Decision: 1 → 2 vCPU
   ✓ Expected Action: SCALED (1→2 vCPU)

📍 대시보드 관찰점:
   • System Health: 1/8 → 2/8로 변경 (약 30초 후)
   • Monthly Cost: $41 → $82 (2배)
   • Activity Log: "SCALED 1→2 vCPU"

EOF

    print_step "Seed 주입: rising"
    if ! inject_seed "rising" 60; then
        return 1
    fi

    echo ""
    print_info "40초: Seed 데이터 자동 정리될 때까지 대기..."
    countdown 40 "Rising 시뮬레이션"

    echo ""
    print_info "20초: 실제 메트릭으로 전환 후 안정화..."
    countdown 20 "전환 대기"
}

stage_3_spike() {
    print_header "Stage 3: SPIKE (120-180초) 🚨"

    cat << 'EOF'
🔴 상황: 긴급 상황 발생
   • CPU: 30% → 95% (급증!)
   • TxPool: 50 → 5000개 (100배!)
   • L1 Block Stagnant 감지
   • Status: CRITICAL

⚠️  자동 대응 흐름:
   1️⃣ Anomaly Detection: Z-Score 5.0 (극심한 이상)
   2️⃣ RCA Engine: L1 RPC 연결 끊김 진단
   3️⃣ Auto-Remediation:
      • Playbook 5 (L1 Connectivity) 매칭
      • Failover 실행: PublicNode → DRPC
      • Pods 자동 재시작 (op-node, op-batcher)
   4️⃣ Emergency Scaling: 1 → 4 vCPU (최대)

📍 대시보드 관찰점:
   • Activity Log:
     - "FAILOVER L1 RPC: ... → ..."
     - "HIGH CPU:95% gas:95% tx:5000"
     - "SCALED 1→4 vCPU (score: 95)"
   • System Health: vCPU 4/8 (50%)
   • Monthly Cost: $165 (최고점)
   • Status: 🔴 RED 상태 → 🟢 GREEN으로 복구

🎯 강조 포인트:
   ✓ 시스템이 자동으로 문제를 진단하고 복구
   ✓ 사용자 개입 없이 응급 대응 완료
   ✓ Zero-downtime 유지

EOF

    print_step "Seed 주입: spike"
    if ! inject_seed "spike" 120; then
        return 1
    fi

    echo ""
    print_warning "40초: 긴급 상황 시뮬레이션 진행 (Spike 활성)"
    countdown 40 "Spike 상황"

    echo ""
    print_info "20초: Seed 정리 후 정상화 대기..."
    countdown 20 "정상화 대기"
}

stage_4_falling() {
    print_header "Stage 4: FALLING (180-240초) ⬇️"

    cat << 'EOF'
📉 상황: 부하 점진적 감소
   • CPU: 80% → 50% → 20% (감소)
   • TxPool: 300 → 20개
   • Trend: 하강 추세 감지

💰 비용 최적화 프로세스:
   1️⃣ Detect: CPU 감소 추세
   2️⃣ Predict: 향후 10분 리소스 필요성 예측
   3️⃣ Decide: 2-3 사이클에 걸쳐 scale-down
      • 4 vCPU → 2 vCPU (T≈195s)
      • 2 vCPU → 1 vCPU (T≈215s)
   4️⃣ Result: 초기 상태로 안정화

💡 Predictive Scaling의 위력:
   • 반응형이 아닌 예측형 스케일링
   • 급격한 변화 없음 = 안정적 운영
   • 비용 절감: $165 → $41 (75% 절감!)

📍 대시보드 관찰점:
   • Activity Log: "NORMAL", "SCALED" 반복
   • System Health: 4/8 → 2/8 → 1/8
   • Monthly Cost: $165 → $82 → $41 (급락)
   • Trend: 🔴 → 🟡 → 🟢

EOF

    print_step "Seed 주입: falling"
    if ! inject_seed "falling" 180; then
        return 1
    fi

    echo ""
    print_info "40초: Falling 시뮬레이션 (scale-down 진행)"
    countdown 40 "Falling 진행"

    echo ""
    print_info "20초: Seed 정리 후 최종 안정화..."
    countdown 20 "최종 안정화"
}

stage_5_live() {
    print_header "Stage 5: LIVE (240-300초) - 마무리"

    cat << 'EOF'
🔵 상황: 실제 L1/L2 RPC 메트릭 모니터링
   • Dev 서버에서 실시간 수집
   • 시뮬레이션 종료, 정상 운영 모드
   • Agent Loop: 30초마다 지속 실행

📊 최종 상태:
   ✓ vCPU: 1/8 (초기 상태로 복귀)
   ✓ CPU: ~20% (정상 범위)
   ✓ Monthly Cost: $41 (최저)
   ✓ Status: MONITORING ACTIVE

🎯 데모 요약:
   ✅ Stable   (안정성): 기본 운영
   ✅ Rising   (대응)  : 점진적 증가 대응
   ✅ Spike    (복구)  : 긴급 상황 자동 복구
   ✅ Falling  (최적화): 비용 절감
   ✅ Live     (프로덕션): 실제 환경 모니터링

💡 SentinAI의 핵심 가치:
   🤖 100% 자동화 운영
   🎯 예측 기반 스케일링
   ⚡ 긴급 상황 자동 복구
   💰 비용 75% 절감
   🛡️  Zero-downtime 유지

EOF

    print_info "60초: 라이브 모드 모니터링 및 마무리"
    countdown 60 "라이브 모드"

    echo ""
    print_success "데모 완료!"
}

# ============================================================================
# 메인 실행
# ============================================================================

main() {
    # 사전 검사
    if ! check_prerequisites; then
        exit 1
    fi

    # 데모 소개
    if ! demo_intro; then
        exit 1
    fi

    # Stage별 진행
    stage_1_stable
    stage_2_rising
    stage_3_spike
    stage_4_falling
    stage_5_live

    # 마무리
    print_header "데모 완료 🎉"

    cat << 'EOF'
📊 5분 데모 요약:

Stage별 성과:
  ✅ Stable (0-60s)   : 안정적 기본 운영
  ✅ Rising (60-120s) : 부하 증가 → 2배 스케일링
  ✅ Spike (120-180s) : 긴급 상황 → 자동 복구 & 4배 스케일
  ✅ Falling (180-240s): 부하 감소 → 4배 비용 절감
  ✅ Live (240-300s)  : 프로덕션 모니터링 및 안정화

🎯 주요 지표:
  • Max vCPU: 4 (Spike 대응)
  • Max Cost: $165/월 (Peak)
  • Min Cost: $41/월 (Normal)
  • Cost Saving: 75%
  • Automation: 100%

💡 핵심 메시지:
  "SentinAI는 L2 네트워크를 완벽하게 자동으로 운영합니다"
  - 예측 기반 스케일링
  - 긴급 상황 자동 복구
  - 비용 최적화
  - Zero-downtime 유지

🔗 다음 단계:
  1. 대시보드에서 더 자세한 분석 보기
  2. Activity Log에서 모든 액션 리뷰
  3. Cost 리포트 확인
  4. 실제 환경 배포 검토

감사합니다! 🙏

EOF

    print_info "대시보드: ${DASHBOARD_URL}"
}

# 실행
main "$@"
