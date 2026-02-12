# 🎬 SentinAI 5분 데모 가이드

**5분 안에 SentinAI의 모든 핵심 기능을 시연하는 자동화 데모입니다.**

## 🚀 빠른 시작

### 1단계: 준비

```bash
# Terminal 1: Dev 서버 시작
npm run dev
# 대기: "Ready in XXXms" 메시지 확인
```

### 2단계: 데모 실행

```bash
# Terminal 2: 데모 스크립트 실행
bash scripts/demo-5min.sh
```

### 3단계: 대시보드 모니터링

```
브라우저: http://localhost:3002 열기
```

---

## 📋 시간표

| 시간 | 시나리오 | 설명 | 주요 이벤트 |
|------|--------|------|----------|
| **0-60s** | Stable | 안정적 기본 운영 | IDLE, 모니터링 활성 |
| **60-120s** | Rising | 부하 점진 증가 | 1→2 vCPU 스케일업 |
| **120-180s** | Spike | 🚨 긴급 상황 | Failover + 1→4 vCPU |
| **180-240s** | Falling | 부하 감소 | 4→2→1 vCPU 스케일다운 |
| **240-300s** | Live | 실제 데이터 | 정상화 + 마무리 |

---

## 📊 대시보드 관찰 포인트

### System Health 카드
```
vCPU 변화:
  T=0s:   1/8 (12%)   ← 초기
  T=90s:  2/8 (25%)   ← Rising 후
  T=140s: 4/8 (50%)   ← Spike 최고점
  T=220s: 1/8 (12%)   ← Falling 정상화
```

### Monthly Cost
```
비용 변화:
  T=0s:   $41/월      ← 기본
  T=90s:  $82/월      ← 2배
  T=140s: $165/월     ← 4배 (Peak)
  T=220s: $41/월      ← 원상복귀 (75% 절감!)
```

### Activity Log
```
각 30초마다 Agent Loop 사이클 기록:
  [15:30:45] IDLE        (대기)
  [15:31:15] HIGH        (부하 증가 감지)
  [15:31:45] SCALED 1→2  (스케일업 실행)
  [15:32:15] FAILOVER    (L1 RPC 전환)
  [15:32:45] SCALED 1→4  (긴급 스케일)
```

### Anomaly Monitor
```
이상 감지 기록:
  • Spike 시점에 Z-Score: 5.0 표시
  • RCA: L1 RPC 연결 끊김 진단
  • Auto-Remediation: 자동 복구 실행
```

---

## 🎯 스크립트 기능

### 자동 기능
✅ **사전 검사**: Dev 서버, 대시보드 상태 확인
✅ **대기 관리**: 각 시나리오별 정확한 시간 카운트다운
✅ **Seed 주입**: 자동 메트릭 시뮬레이션
✅ **응답 파싱**: 주입 결과 실시간 표시
✅ **진행 표시**: 진행도 시각화 (컬러 + 타이머)

### 대화형 기능
📝 **사용자 확인**: "시작할 준비 됐나요?" 메시지
⏱️ **카운트다운**: 남은 시간 시각화
💬 **설명**: 각 단계별 상황 설명

---

## 🎨 출력 형식

### 컬러 코드
```
🔵 BLUE   : 헤더 / 구조
🟢 GREEN  : 성공 / 완료
🟡 YELLOW : 경고 / 주의
🔴 RED    : 에러 / 실패
🔷 CYAN   : 정보 / 카운트다운
```

### 예시
```
╔════════════════════════════════════════════╗
║ Stage 1: STABLE (0-60초)
╚════════════════════════════════════════════╝

📈 상황: 정상 운영 중
   • CPU: ~20%
   • vCPU: 1/8
   ...

[STEP] 준비 확인
[INFO] 60초 대기...
⏱️  Stable 모드: 45초 남음
✓ Stable 모드: 완료!
```

---

## 🔧 커스터마이징

### API URL 변경
```bash
# 스크립트 상단 수정
API_URL="http://다른주소:3002"
DASHBOARD_URL="http://다른주소:3002"
```

### 타이밍 조정
```bash
# 각 시나리오 시간 조정
SCENARIO_DURATION=60  # 초 단위
```

### 색상 비활성화
```bash
# 색상 코드 제거 (CI/CD 환경)
sed 's/\x1b\[[0-9;]*m//g' output.txt
```

---

## 🛠️ 트러블슈팅

### Q: "Dev 서버가 실행 중이지 않습니다" 에러

```bash
# Terminal 1에서 실행
npm run dev
```

### Q: Seed 주입 실패

```bash
# API 응답 확인
curl -s http://localhost:3002/api/metrics/seed?scenario=falling | jq .

# 에러 메시지 확인
```

### Q: 카운트다운이 표시 안 됨

```bash
# 터미널이 색상을 지원하지 않음
# 수동으로 진행하거나 터미널 변경
```

---

## 📸 스크린샷 포인트

### 캡처 권장 시점

```
T=60s:  Stable 기본 상태 (초기)
T=100s: Rising 중 2vCPU 스케일링
T=140s: Spike 최고점 4vCPU + Failover 로그
T=200s: Falling 중 scale-down
T=300s: 최종 정상 상태 + 비용 대비
```

---

## 📝 발표 스크립트 예시

### 오프닝 (0-10초)
```
"SentinAI는 L2 네트워크의 자율 운영 시스템입니다.
이제 5분 안에 모든 핵심 기능을 보여드리겠습니다."
```

### Rising (60-90초)
```
"CPU 부하가 15%에서 50%로 증가했습니다.
시스템이 자동으로 이를 감지하고,
예측 스케일링을 통해 vCPU를 1에서 2로 증가시켰습니다.
비용은 $41에서 $82로 증가했지만, 서비스 안정성을 보장합니다."
```

### Spike (120-140초)
```
"갑작스런 부하 급증! CPU가 95%까지 치솟았습니다.
동시에 L1 RPC 연결이 끊겼습니다.
SentinAI는:
1. 자동으로 근본 원인을 분석하고
2. L1 RPC를 PublicNode에서 DRPC로 자동 전환하고
3. 비상 대응으로 vCPU를 4개로 증가시켰습니다.
모든 과정이 자동으로 5초 안에 완료됩니다!"
```

### Falling (180-220초)
```
"부하가 정상화되고 있습니다.
시스템은 향후 부하를 예측하여 천천히 리소스를 축소합니다.
vCPU는 4 → 2 → 1로 단계적으로 감소하고,
월 비용도 $165에서 $41로 75% 절감됩니다."
```

### 클로징 (240-300초)
```
"이제 시스템이 실제 L1/L2 RPC 메트릭을 수집하는
프로덕션 모드로 돌아갔습니다.

SentinAI의 가치:
✅ 100% 자동화 운영
✅ 예측 기반 스케일링
✅ 긴급 상황 자동 복구
✅ 비용 75% 절감
✅ Zero-downtime 유지

이 모든 것이 추가 인력 없이 자동으로 작동합니다."
```

---

## 🎓 추가 리소스

### 더 알아보기
- `docs/README.md`: 전체 문서
- `ARCHITECTURE.md`: 시스템 아키텍처
- `FEATURES.md`: 전체 기능 목록

### 실제 배포
- `docs/guide/ec2-setup-guide.md`: AWS EC2 배포
- `docs/guide/production-load-testing-guide.md`: 프로덕션 테스트

---

## ✅ 데모 체크리스트

```
준비 단계:
☐ npm run dev 실행
☐ http://localhost:3002 열기
☐ bash scripts/demo-5min.sh 준비

진행 중:
☐ System Health 카드 모니터링
☐ Activity Log 변화 관찰
☐ Monthly Cost 비용 변화 확인
☐ Anomaly Monitor 이상 감지 보기

마무리:
☐ 최종 상태 스크린샷 캡처
☐ 질문 대비 (FAQ 참고)
☐ 팔로우업 논의
```

---

## 📞 FAQ

**Q: 스크립트를 중단하고 싶어요**
```bash
Ctrl+C 누르기
```

**Q: 특정 시나리오만 테스트하고 싶어요**
```bash
# 스크립트 수정하여 특정 stage_X 함수만 호출
# 또는 수동으로 curl 실행:
curl -X POST http://localhost:3002/api/metrics/seed?scenario=rising
```

**Q: 데모를 반복하고 싶어요**
```bash
# 스크립트 재실행 (Seed TTL 40초이므로 대기 후)
bash scripts/demo-5min.sh
```

**Q: 다른 시나리오로 커스터마이징 할 수 있나요?**
```
네! 스크립트를 수정하여:
- 시나리오 순서 변경
- 시간 조정
- 설명 커스터마이징
가능합니다.
```

---

## 🎬 시작하기

```bash
# 1. Dev 서버 시작
npm run dev

# 2. 새 터미널에서
bash scripts/demo-5min.sh

# 3. 브라우저에서 대시보드 모니터링
http://localhost:3002
```

**준비 완료! 5분 후 완벽한 데모가 끝납니다.** 🎉
