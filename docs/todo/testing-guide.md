# SentinAI 테스트 가이드

**Version:** 1.1
**Date:** 2026-02-10

---

## 1. 프로젝트 개요

SentinAI는 Optimism L2 노드를 위한 AI 기반 모니터링 및 자동 스케일링 대시보드입니다.

### 1.1 현재 구현 상태

| Phase | 기능 | 상태 | 파일 위치 |
|-------|------|------|----------|
| P1 | Predictive Scaling | ✅ 완료 | `src/lib/predictive-scaler.ts` |
| P2 | Anomaly Detection | ✅ 완료 | `src/lib/anomaly-detector.ts` |
| P3 | RCA Engine | ✅ 완료 | `src/lib/rca-engine.ts` |
| P4 | Cost Optimizer | ✅ 완료 | `src/lib/cost-optimizer.ts` |
| P5 | NLOps | 📋 계획 | `docs/todo/proposal-5-nlops.md` |
| P6 | Zero-Downtime | 📋 계획 | `docs/todo/proposal-6-zero-downtime-scaling.md` |
| P7 | Redis State | 📋 계획 | `docs/todo/proposal-7-redis-state-store.md` |
| P8 | Auto-Remediation | 📋 계획 | `docs/todo/proposal-8-auto-remediation.md` |

---

## 2. 환경 설정

### 2.1 필수 환경 변수

```bash
# .env.local
L2_RPC_URL=https://mainnet.optimism.io
L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# AI Gateway (Tokamak)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=sk-xxx

# 선택적
EKS_CLUSTER_NAME=op-celestia-dev
EKS_NAMESPACE=optimism
```

### 2.2 의존성 설치

```bash
cd /home/theo/SentinAI
npm install
```

---

## 3. 로컬 테스트

### 3.1 개발 서버 실행

```bash
npm run dev
# http://localhost:3000 에서 대시보드 확인
```

### 3.2 단위 테스트

```bash
# 전체 테스트
npm test

# 특정 파일만
npm test -- src/lib/__tests__/ai-client.test.ts
npm test -- src/lib/__tests__/k8s-scaler.test.ts
npm test -- src/lib/__tests__/zero-downtime-scaler.test.ts
```

### 3.3 E2E 테스트

```bash
# Playwright 설치 (최초 1회)
npx playwright install

# E2E 테스트 실행
npm run test:e2e

# UI 모드로 실행
npm run test:e2e:ui
```

---

## 4. API 테스트

### 4.1 핵심 API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/health` | GET | 시스템 상태 |
| `/api/metrics` | GET | L2 메트릭 조회 |
| `/api/metrics?stress=true` | GET | 스트레스 모드 메트릭 |
| `/api/metrics/seed?scenario=rising` | POST | 테스트 데이터 시드 |
| `/api/anomalies` | GET | 이상 탐지 결과 |
| `/api/rca` | POST | 근본 원인 분석 |
| `/api/cost-report?days=7` | GET | 비용 분석 리포트 |
| `/api/scaler` | GET | 스케일러 상태 |
| `/api/scaler` | POST | 스케일링 실행 |

### 4.2 curl 테스트 예시

```bash
# 헬스 체크
curl http://localhost:3000/api/health | jq

# 메트릭 조회
curl http://localhost:3000/api/metrics | jq

# 스트레스 모드 메트릭
curl "http://localhost:3000/api/metrics?stress=true" | jq

# 이상 탐지
curl http://localhost:3000/api/anomalies | jq

# RCA 분석 (AI 호출)
curl -X POST http://localhost:3000/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}' | jq

# 비용 리포트 (AI 호출)
curl "http://localhost:3000/api/cost-report?days=7" | jq

# 예측 데이터 시드
curl -X POST "http://localhost:3000/api/metrics/seed?scenario=rising" | jq
```

---

## 5. 대시보드 기능 테스트

### 5.1 메인 대시보드 (page.tsx)

| 기능 | 테스트 방법 | 예상 결과 |
|------|------------|----------|
| 네트워크 상태 | 상단 바 확인 | L1/L2 블록 높이, TxPool, Sync 상태 |
| 스트레스 모드 | "Simulate Load" 버튼 클릭 | CPU 급증, 비용 증가 |
| 예측 스케일링 | Resource Center 확인 | 현재 → 예측 vCPU 표시 |
| 이상 탐지 | Anomaly Banner | CPU spike 등 감지 시 빨간 배너 |
| RCA 분석 | "CHECK HEALTH" 버튼 | AI 분석 결과 표시 |
| 비용 분석 | "COST ANALYSIS" 버튼 | 사용 패턴 히트맵, 추천 표시 |

### 5.2 테스트 시나리오

#### 시나리오 1: 정상 상태 확인
1. 대시보드 접속
2. 네트워크 상태 바에서 L2 Block 증가 확인
3. Health Score 90+ 확인
4. "CHECK HEALTH" 클릭 → "System Healthy" 메시지

#### 시나리오 2: 스트레스 모드
1. "Simulate Load" 버튼 클릭
2. CPU Usage 급증 (50% → 80%+) 확인
3. Anomaly Banner 표시 확인
4. vCPU 스케일업 (1 → 2 또는 4) 확인

#### 시나리오 3: RCA 분석
1. 스트레스 모드 활성화
2. "CHECK HEALTH" 또는 Anomaly Banner의 "Analyze Now" 클릭
3. AI 분석 결과 확인:
   - Root Cause (component, description, confidence)
   - Causal Chain (이벤트 시퀀스)
   - Remediation (즉각 조치, 예방 조치)

#### 시나리오 4: 비용 분석
1. "COST ANALYSIS" 버튼 클릭
2. 사용 패턴 히트맵 확인 (7일 x 24시간)
3. AI 추천 사항 확인 (downscale, schedule 등)
4. 예상 절감액 확인

---

## 6. 코드 구조

### 6.1 핵심 라이브러리

```
src/lib/
├── ai-client.ts           # Claude API 통합
├── anomaly-detector.ts    # 이상 탐지 (Z-Score, Rules)
├── anomaly-event-store.ts # 이상 이벤트 저장소
├── cost-optimizer.ts      # AI 비용 최적화
├── k8s-scaler.ts          # K8s 스케일링
├── metrics-store.ts       # 메트릭 시계열 저장
├── prediction-tracker.ts  # 예측 추적
├── predictive-scaler.ts   # AI 예측 스케일링
├── rca-engine.ts          # 근본 원인 분석
├── usage-tracker.ts       # 사용량 패턴 추적
└── zero-downtime-scaler.ts# 무중단 스케일링
```

### 6.2 타입 정의

```
src/types/
├── anomaly.ts      # AnomalyResult, AnomalyMetric
├── cost.ts         # CostReport, CostRecommendation, UsagePattern
├── daily-report.ts # DailyReport
├── prediction.ts   # MetricDataPoint, PredictionResult
├── rca.ts          # RCAResult, RCAEvent, RCAComponent
├── redis.ts        # Redis 상태 타입
├── scaling.ts      # ScalingDecision, AISeverity
└── zero-downtime.ts# ZeroDowntimeConfig
```

### 6.3 API 라우트

```
src/app/api/
├── anomalies/
│   ├── config/route.ts   # 이상 탐지 설정
│   └── route.ts          # 이상 탐지 조회
├── cost-report/route.ts  # 비용 분석 리포트
├── health/route.ts       # 헬스 체크
├── metrics/
│   ├── route.ts          # 메트릭 조회
│   └── seed/route.ts     # 테스트 데이터 시드
├── rca/route.ts          # 근본 원인 분석
├── reports/daily/route.ts# 일간 리포트
└── scaler/route.ts       # 스케일러 상태/실행
```

---

## 7. AI 테스트

### 7.1 AI Gateway 연동 확인

```bash
# AI Gateway 연결 테스트 (RCA)
curl -X POST http://localhost:3000/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}'

# 응답 예시
{
  "success": true,
  "result": {
    "id": "rca-xxx",
    "rootCause": {
      "component": "op-geth",
      "description": "CPU usage spike...",
      "confidence": 0.85
    },
    ...
  }
}
```

### 7.2 AI 실패 시 Fallback 확인

AI Gateway 연결 실패 시에도 fallback 로직이 동작하는지 확인:

```bash
# 임시로 ANTHROPIC_API_KEY를 잘못된 값으로 설정
export ANTHROPIC_API_KEY=invalid

# RCA 요청 → fallback 응답 확인
curl -X POST http://localhost:3000/api/rca -H "Content-Type: application/json" -d '{}'
# confidence: 0.3 (fallback 표시)
```

---

## 8. 빌드 및 배포

### 8.1 프로덕션 빌드

```bash
npm run build
npm run start
```

### 8.2 Cloud Run 배포

```bash
# 배포 스크립트 실행
./deploy-cloudrun.sh

# 또는 수동 배포
gcloud run deploy sentinai \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```

---

## 9. 문제 해결

### 9.1 일반적인 이슈

| 증상 | 원인 | 해결 |
|------|------|------|
| API 응답 없음 | 개발 서버 미실행 | `npm run dev` 실행 |
| AI 분석 실패 | API 키 미설정 | `.env.local` 확인 |
| 메트릭 0 표시 | RPC 연결 실패 | L2_RPC_URL 확인 |
| 빌드 실패 | 타입 오류 | `npm run type-check` |

### 9.2 로그 확인

```bash
# 개발 서버 로그
npm run dev 2>&1 | tee dev.log

# 특정 모듈 로그 필터
grep "\[RCA Engine\]" dev.log
grep "\[Cost Optimizer\]" dev.log
grep "\[AI Client\]" dev.log
```

---

## 10. 다음 단계

### 10.1 구현 대기 중

- **P5 NLOps**: 자연어 명령으로 시스템 제어
- **P6 Zero-Downtime**: 무중단 스케일링 전략
- **P7 Redis State**: 분산 상태 저장소
- **P8 Auto-Remediation**: 자동 복구 시스템
- **Telegram Bot**: 모바일 모니터링
- **Universal Platform**: 멀티 블록체인 지원

### 10.2 문서 위치

```
docs/
├── done/                    # 구현 완료된 제안서
│   ├── proposal-1-predictive-scaling.md
│   ├── proposal-2-anomaly-detection.md
│   ├── proposal-3-rca-engine.md
│   └── proposal-4-cost-optimizer.md
├── todo/                    # 구현 대기 중
│   ├── proposal-5-nlops.md
│   ├── proposal-6-zero-downtime-scaling.md
│   ├── proposal-7-redis-state-store.md
│   ├── proposal-8-auto-remediation.md
│   ├── telegram-bot-integration.md
│   ├── universal-blockchain-platform.md
│   └── testing-guide.md    # 이 문서
├── spec/                    # 기술 명세
└── verification/            # 검증 리포트
```
