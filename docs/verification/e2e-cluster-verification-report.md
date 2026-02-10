# E2E 실제 클러스터 검증 리포트
**일시:** 2026-02-09 20:33 KST
**검증자:** Claude (AI Assistant)
**검증 도구:** `scripts/verify-e2e.sh` (자동화 스크립트)

---

## 1. 개요

SentinAI의 전체 AI 기능이 실제 EKS 클러스터 + L2 RPC + Anthropic API 환경에서 정상 동작하는지 E2E 자동 검증을 수행했다.

| 항목 | 결과 |
|------|------|
| **총 테스트** | 29건 |
| **PASSED** | 28건 (96.6%) |
| **SKIPPED** | 1건 (Redis 미설정) |
| **FAILED** | 0건 |
| **소요 시간** | 125초 |

---

## 2. 검증 환경

| 항목 | 값 |
|------|-----|
| L2 RPC | `rpc.titok.tokamak.network` (block: 6,298,891) |
| K8s 클러스터 | EKS (12 pods) |
| AI Provider | Anthropic Direct (`claude-haiku-4-5-20251001` / `claude-opus-4-6`) |
| Redis | 미설정 (인메모리 모드) |
| 서버 | `http://localhost:3002` (dev) |

---

## 3. Phase별 상세 결과

### Phase 0: Prerequisites (5 PASS, 1 SKIP)

| 검증 항목 | 결과 | 비고 |
|-----------|------|------|
| `.env.local` 존재 | ✅ | |
| L2 RPC 연결 | ✅ | block: 6,298,890 |
| K8s 클러스터 접근 | ✅ | 12 pods |
| AI Provider 설정 | ✅ | Anthropic |
| Redis 연결 | ⏭️ SKIP | 미설정 (인메모리 모드) |
| Dev 서버 실행 | ✅ | |

### Phase 1: Data Collection (5 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| `/api/metrics` 응답 | ✅ | HTTP 200 |
| Block Height | ✅ | 6,298,891 |
| CPU Usage | ✅ | 0.15% |
| K8s Components | ✅ | 4개 (L2 Client, Consensus Node, Batcher, Proposer) |
| Current vCPU | ✅ | 1 |

**분석:** 실제 L2 RPC에서 블록 높이와 Gas 사용률을 수집하고, EKS 클러스터에서 4개 Optimism 컴포넌트(op-geth, op-node, op-batcher, op-proposer)의 Pod 정보를 정상적으로 가져온다.

### Phase 2: Anomaly Detection Pipeline (5 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| Spike 데이터 주입 | ✅ | seed scenario=spike |
| Layer 1: Z-Score 탐지 | ✅ | 1건 탐지 |
| Layer 2: AI 시맨틱 분석 | ✅ | severity: **critical** |
| Anomaly Events 기록 | ✅ | 5건 |
| Layer 3: Alert 설정 | ✅ | enabled=false (웹훅 미설정) |

**분석:**
- **Layer 1** — Spike 데이터 주입 후 Z-Score 기반 통계 이상 탐지가 정확하게 동작한다.
- **Layer 2** — Anthropic API를 통한 AI 시맨틱 분석이 3초 이내에 완료되며, severity를 `critical`로 정확히 분류했다.
- **Layer 3** — Alert 설정 로드 정상. 현재 `ALERT_WEBHOOK_URL` 미설정으로 웹훅 발송은 비활성 상태.

### Phase 3: Predictive Scaling (3 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| Rising 트렌드 주입 | ✅ | seed scenario=rising |
| `/api/scaler` 응답 | ✅ | HTTP 200 |
| AI 예측 결과 | ✅ | **4 vCPU** (confidence: 0.92, trend: rising) |

**분석:** Rising 트렌드 데이터 주입 시 AI가 4 vCPU로 스케일업을 권고하며, confidence 0.92로 높은 신뢰도를 보인다. 예측 모델이 상승 추세를 정확히 인식하고 선제적 리소스 확보를 제안한다.

### Phase 4: Cost Optimization (4 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| `/api/cost-report` 응답 | ✅ | HTTP 200 |
| 월간 비용 계산 | ✅ | **$41.45/월** |
| 사용 패턴 분석 | ✅ | 1개 시간 버킷 |
| AI 비용 추천 | ✅ | **4건** |

**분석:** Fargate Seoul 가격($0.04656/vCPU-hour) 기반으로 현재 1 vCPU 운영 비용을 정확히 산출한다. AI가 4건의 비용 최적화 추천을 생성했다.

### Phase 5: Daily Report (3 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| 축적기 상태 | ✅ | 0 snapshots (서버 재시작 후) |
| 보고서 생성 | ✅ | `data/reports/2026-02-09.md` |
| 저장된 보고서 | ✅ | 1건 |

**분석:** `claude-opus-4-6` (best tier)을 사용하여 한국어 일일 운영 보고서를 자동 생성한다. Markdown frontmatter + 5개 섹션(요약, 지표 분석, 스케일링 리뷰, 이상 징후, 권고사항) 구조로 파일시스템에 저장된다.

### Phase 6: RCA Engine (3 PASS)

| 검증 항목 | 결과 | 값 |
|-----------|------|-----|
| RCA 분석 완료 | ✅ | root cause: **op-geth** (confidence: 0.65) |
| 영향 컴포넌트 | ✅ | 2개 |
| 조치 권고 | ✅ | remediation 존재 |

**분석:** Spike 데이터 기반으로 AI가 근본 원인을 `op-geth`로 식별하고, Optimism 의존성 그래프(L1 → op-node → op-geth)를 활용한 영향 범위 분석과 조치 권고를 생성한다.

---

## 4. 기능별 AI Provider 연동 현황

| 기능 | Model Tier | 모델 | 응답 시간 | 상태 |
|------|-----------|------|----------|------|
| 이상 탐지 (Layer 2) | fast | `claude-haiku-4-5-20251001` | ~3초 | ✅ |
| 예측 스케일링 | fast | `claude-haiku-4-5-20251001` | ~5초 | ✅ |
| 비용 최적화 | fast | `claude-haiku-4-5-20251001` | ~8초 | ✅ |
| 일일 보고서 | **best** | `claude-opus-4-6` | ~50초 | ✅ |
| RCA 엔진 | fast | `claude-haiku-4-5-20251001` | ~10초 | ✅ |

모든 AI 호출이 Anthropic Direct API를 통해 정상 동작한다. 이전 LiteLLM Gateway 의존성을 완전히 제거하고 직접 API 연결로 전환한 결과, 400 에러 없이 안정적으로 동작한다.

---

## 5. 검증 스크립트

자동화 검증 스크립트 `scripts/verify-e2e.sh`가 추가되었다.

```bash
npm run verify                       # 전체 검증
bash scripts/verify-e2e.sh --phase 2 # 특정 Phase만 실행
```

- 6단계 순차 검증 (Prerequisites → Data → Anomaly → Prediction → Cost → Report → RCA)
- AI 키 미설정 시 해당 테스트를 SKIP 처리 (FAIL이 아님)
- Dev 서버 미실행 시 자동 시작/종료
- `jq` 기반 JSON 응답 검증

---

## 6. 개선 사항 (이전 대비)

| 항목 | 이전 (2026-02-09 초) | 현재 |
|------|---------------------|------|
| AI 호출 성공률 | 35% (Gateway 400 에러) | **100%** |
| AI Provider | LiteLLM Gateway 의존 | Anthropic Direct API |
| 보고서 생성 | 500 에러 (Fallback 없음) | **성공** |
| 비용 추천 | 0건 (Fallback) | **4건** |
| 전체 성공률 | 65% | **96.6%** (SKIP 제외 100%) |

---

## 7. 잔여 사항

| 항목 | 상태 | 비고 |
|------|------|------|
| Redis 연동 | ⏭️ 미설정 | `REDIS_URL` 설정 시 상태 영속화 가능 |
| Alert 웹훅 | ⏭️ 미설정 | `ALERT_WEBHOOK_URL` 설정 시 Slack 알림 활성화 |
| E2E Playwright 테스트 | 📋 미구현 | UI 렌더링 검증 (Proposal 미구현) |
| Auto-Remediation | 📋 설계 완료 | `docs/todo/proposal-8-auto-remediation.md` |
