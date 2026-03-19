# SentinAI 알고리즘 효율성 평가

> **작성일:** 2026-02-25
> **관점:** 20년 경력의 L1/L2 DevOps 전문가
> **범위:** 전체 코드베이스 알고리즘 감사 — 5개 하위 시스템의 23개 핵심 알고리즘
> **종합 점수:** 7.4/10

---

## I. 알고리즘 인벤토리 (5개 하위 시스템, 23개 핵심 알고리즘)

| # | Subsystem | Algorithm | Key Parameters |
|---|-----------|-----------|----------------|
| 1 | Scaling Engine | Hybrid Scoring (weighted average) | CPU 30% + Gas 30% + TxPool 20% + AI 20% |
| 2 | | 4-Tier vCPU Mapping | Idle(\< 30)→1, Normal(30-70)→2, High(70-77)→4, Emergency(≥77)→8 |
| 3 | | Predictive Override | AI prediction confidence ≥ 0.65 + scale_up only |
| 4 | | Zero-Downtime Pod Swap | 7-phase state machine (idle→completed), rollback included |
| 5 | | Cooldown Enforcement | 5min(prod)/10s(dev), time-based |
| 6 | Anomaly Detection | Z-Score statistical detection | Z > 3.0 (99.7% confidence), min StdDev filter |
| 7 | | Rule-Based detection (3 types) | CPU 0% drop, block plateau(120s), TxPool monotonic increase(300s) |
| 8 | | AI Semantic Analysis | Fast-tier LLM, 1min rate limit, 5min cache |
| 9 | | 4-Layer Pipeline | Statistical→AI→Alert→Remediation, async background |
| 10 | RCA + Remediation | BFS dependency graph traversal | O(V+E), chain plugin based |
| 11 | | Playbook Matching | Component→metric condition→log pattern matching |
| 12 | | Safety Gate (5-layer) | Kill switch, Circuit breaker(3x), Cooldown(5min), hourly/daily limits |
| 13 | | Circuit Breaker | 3 consecutive failures→24h block, reset on success |
| 14 | Agent Loop | 6-Phase Cycle | Observe→Detect→Analyze→Plan→Act→Verify (60s) |
| 15 | Goal Manager | Signal→Candidate→Priority→Queue→Dispatch | 6 signal types, SHA256 dedup, 0-100 priority |
| 16 | | Autonomy Policy (A0-A5) | A0=manual, A2=dry-run(default), A3-A5=auto(risk-based) |
| 17 | | Approval Engine | SHA256 hash one-time tokens, TTL expiry |
| 18 | | Lease-Based Execution | PID-based lease, 120s TTL, idempotency key(1h) |
| 19 | Cost & Reporting | Fargate cost model | vCPU×$0.04656/h + GB×$0.00511/h |
| 20 | | Usage Pattern Analysis | 7d×24h buckets, percentiles(p10/p50/p90) |
| 21 | | Savings Plans Simulation | Conservative/Recommended/Aggressive 3 strategies |
| 22 | L1 RPC Failover | Consecutive failure switching | Normal 3x/429 10x, 5min cooldown, health check |
| 23 | | L1 RPC Cache | Block height 6s TTL, EOA balance 5min TTL (95% reduction) |

---

## II. 유스 케이스 효율성 평가

### UC-1: CPU 스파이크 자동 대응 (가장 빈번한 시나리오)

**시나리오:** L2에서 갑작스런 트랜잭션 급증 → op-geth CPU 95%

**알고리즘 체인:** `Metrics Collection → Z-Score Detection → Hybrid Scoring → Tier Mapping → K8s Scaling → Verification`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Detection | Z-Score > 3.0 | **적절함.** 60포인트 ring buffer에서의 통계 이상 탐지는 EVM 노드 특성에 정확함. Min StdDev 필터(CPU 2%)는 유휴 체인에서의 거짓 양성을 방지 | 9/10 |
| Scoring | Hybrid Scoring | **효과적이지만 가중치 분배 논쟁의 여지 있음.** OP Stack에서는 Gas 30%가 과도함 — sequencer가 거의 일정한 gasUsedRatio를 생성하므로 CPU와 동일 가중치 비효율 | 7/10 |
| Tier mapping | 4-Tier Mapping | **검증된 패턴.** 1→2→4→8 배수 스케일링은 Fargate/EKS 리소스 단위와 일치. 다만 High→Emergency 격차(70-77)가 너무 좁음 — 7포인트 차이가 100% 리소스 증가 트리거 | 7/10 |
| Execution | Zero-Downtime Swap | **우수함.** 블록체인 노드는 재시작 시 상태 동기화가 필요하므로 pod swap 필수. Service selector 레이블 기반 트래픽 전환이 깔끔 | 9/10 |
| Verification | Post-Scaling Verify | **중요하고 잘 구현됨.** vCPU 불일치 시 자동 롤백. 블록체인 노드에서 스케일링 실패가 치명적이므로 중요 | 9/10 |

**종합: 8.2/10** — CPU 스파이크 대응은 SentinAI의 가장 성숙한 파이프라인. Gas 가중치 조정과 High tier 확장 필요.

---

### UC-2: L1 RPC 장애 처리 (주요 OP Stack 장애 시나리오)

**시나리오:** L1 RPC 공급자(Infura/Alchemy) 429 rate limit → op-node derivation 정체 → 블록 생성 중단

**알고리즘 체인:** `L1 Failure Detection → Failover Execution → K8s Env Update → Health Check → Proxyd Backend Replacement`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Detection | 연속 실패 카운터 (3/10) | **현실적인 임계값.** 429는 일시적일 수 있으므로 10은 합리적. 일반 에러 3은 적절. 다만 **부분적 성능 저하**(느린 응답)는 감지 불가 | 7/10 |
| Switching | Round-robin + health check | **견고한 기초.** eth_blockNumber L7 health check는 정확. 다만 **가중치 기반 라우팅**(응답시간 선호도) 없음 — 최적 끝점 선택 불가 | 6/10 |
| K8s update | kubectl set env | **실용적이지만 위험.** 컨테이너 재시작 필요 가능 — 다운타임 발생. Proxyd 모드가 보상 | 7/10 |
| Proxyd | ConfigMap patch + Pod restart | **OP Stack 운영 best practice.** L2 노드가 Proxyd를 통해 L1 접근은 프로덕션 표준. Spare URL 풀 관리는 견고 | 8/10 |
| Cache | Block 6s, EOA 5min | **95% RPC 감소는 실제 가치.** 12s 블록 시간에 대해 6s TTL은 최적. EOA 5min은 낮은 잔액 변화 빈도와 일치 | 9/10 |

**종합: 7.4/10** — L1 RPC 장애는 가장 빈번한 OP Stack 인시던트(프로덕션에서 주당 3-4회). 탐지와 전환은 작동하지만 지연시간 기반 가중치 라우팅과 부분 성능 저하 탐지 없음.

**프로덕션 인사이트:** 이 모듈의 존재 자체가 높은 운영 이해도를 반영. L1 RPC는 OP Stack의 단일 장애점(SPoF).

---

### UC-3: Sequencer 정체 탐지 + RCA (블록체인 특화 시나리오)

**시나리오:** op-node derivation 파이프라인 정체 → L2 블록 생성 중단 → 사용자 트랜잭션 불가 처리

**알고리즘 체인:** `Block Plateau Detection (120s) → AI Semantic Analysis → BFS Fault Propagation → RCA Engine → Playbook Matching → Remediation`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Detection | Block plateau rule (120s) | **정확하고 실용적.** 2s L2 블록 시간에서 120s(60 블록) 변화 없음은 명백한 장애. 거짓 양성 거의 없음 | 9/10 |
| Correlation | AI semantic + dependency graph | **핵심 차별화 요소.** BFS 추적 `l1 → op-node → op-geth` 체인과 AI 로그 상관 관계 분석 결합은 매우 효과적 | 8/10 |
| RCA | AI-enhanced + heuristic fallback | **프로덕션에서 가장 유용한 기능.** SRE 질문 "어떤 컴포넌트가 근본 원인인가?"를 자동화. Fallback은 AI 실패 시 운영 보장 | 8/10 |
| Remediation | Playbook + Safety Gate | **보수적이지만 올바른 접근.** L1 장애는 자동 복구 불가(maxAttempts: 0), op-geth OOM은 scale_up 사용. 3중 rate limit은 복구 폭주 방지 | 8/10 |

**종합: 8.3/10** — Sequencer 정체는 L2 운영의 **Sev-1 인시던트**. SentinAI의 감지→분석→복구 파이프라인은 MTTD를 120s, MTTR을 분 단위로 단축.

---

### UC-4: EOA 잔액 고갈 방지 (OP Stack 비용 관리)

**시나리오:** Batcher EOA가 0.05 ETH로 감소 → batch 제출 실패 → 트랜잭션 최종성 지연

**알고리즘 체인:** `Balance Monitoring → Threshold Detection → Playbook Match → Treasury Check → Auto-Refill → Balance Verification`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Detection | 고정 임계값 (0.1 ETH) | **단순하지만 효과적.** EOA 잔액은 선형 감소하므로 고정 임계값이 Z-Score보다 적절. 다만 **예측 고갈 경고** 없음(burn-rate 기반 "N시간 후 소진") | 7/10 |
| Remediation | 자동 충전(보안됨) | **핵심 자동화.** 금고에서 0.5 ETH 충전은 가스 가격 변동성을 고려할 때 적절. tx 확인 대기는 올바름 | 8/10 |
| Verification | 잔액 재확인 | **필수이고 잘 구현됨** | 8/10 |

**종합: 7.7/10** — EOA 고갈은 **주간** 정기 운영 문제. 자동 충전은 온콜 부담을 크게 감소. Burn-rate 예측 추가 시 9+ 가능.

---

### UC-5: 비용 최적화 (장기 운영 시나리오)

**시나리오:** 3개월 운영 데이터 기반 Savings Plans 구매 결정

**알고리즘 체인:** `Usage Tracking → Pattern Analysis (168 buckets) → Percentile Calculation → Savings Plans Simulation → ROI Comparison`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Collection | 30s 간격 사용량 | **과도한 세분화.** Fargate는 시간 단위 청구하므로 5분 집계면 충분 | 7/10 |
| Analysis | 7d×24h buckets | **적절한 패턴 분석.** 요일 + 시간대 분석은 L2 트래픽 패턴을 잘 포착 | 8/10 |
| Simulation | 3개 Savings Plans 전략 | **매우 실용적.** Conservative(p10)/Recommended(avg)/Aggressive(p50) 비교는 CFO/CTO 결정에 직접 활용 가능 | 9/10 |
| Accuracy | 월간 외삽 | **주의 필요.** 7일 데이터를 월간으로 외삽하면 특수 이벤트(airdrop, 업그레이드 등) 미반영 | 6/10 |

**종합: 7.5/10** — 비용 분석 도구로는 실용적이지만 OP Stack 총 OpEx를 지배하는 **블록체인 특화 비용 요소**(L1 가스비, blob 비용) 누락.

---

### UC-6: 자율 목표 생성 및 실행 (가장 야심찬 기능)

**시나리오:** 오전 3시, 온콜 없음 — 시스템이 자율적으로 결정 "CPU가 상승 중, 미리 확장하자"

**알고리즘 체인:** `Signal Collection → Candidate Generation → Priority Scoring → Suppression → Queue → Lease Acquisition → Policy Check → LLM Planning → Step Execution → Verification`

| Step | Algorithm | Assessment | Score |
|------|-----------|------------|-------|
| Signals | 6가지 타입(metric/anomaly/failover/cost/memory/policy) | **포괄적이고 잘 설계됨.** SHA256 snapshot hash로 결정론적 상태 추적 | 9/10 |
| Candidate gen | 규칙 기반 + LLM 강화 | **현실적 하이브리드.** 안전성은 규칙, 개선는 LLM. LLM 실패 시에도 작동 | 8/10 |
| Priority | Impact(40)+Urgency(25)+Confidence(20)+PolicyFit(15) | **잘 설계된 점수.** 가중치 분배는 합리적. 다만 **학습 기반 가중치 조정** 없음 | 7/10 |
| Suppression | 5가지 규칙(stale/confidence/cooldown/policy/duplicate) | **과도 억제 위험.** Confidence < 0.5 억제는 유효한 목표 폐기 가능. 하지만 안전 우선은 올바름 | 7/10 |
| Execution | Lease + Idempotency + Retry | **분산 시스템 패턴 잘 적용됨.** 다만 단일 프로세스 실행은 현재 과도 엔지니어링 | 6/10 |
| Policy | A0-A5 자율성 수준 | **매우 세분화된 제어.** 단계적 자율성 확장 가능. 기본값 A2(dry-run)는 보수적이지만 올바른 시작점 | 9/10 |

**종합: 7.7/10** — 가장 야심찬 기능으로 우수한 아키텍처이지만 **프로덕션 검증 부족.** 단일 프로세스의 Lease/Idempotency는 과도 엔지니어링. 후보 품질은 규칙 기반 로직에 크게 의존.

---

## III. 프로덕션 DevOps 관점 요약

### 강점 (프로덕션에서의 실제 가치)

1. **L1 RPC Failover + Cache (95% 호출 감소)**
   - OP Stack 운영의 #1 장애 원인 직접 해결
   - Proxyd 통합은 프로덕션 급

2. **4계층 이상 탐지**
   - Z-Score + 도메인 규칙(block plateau, TxPool 단조 증가) 조합은 블록체인 최적화
   - 통계 탐지는 AI 실패 시에도 작동(우아한 성능 저하)

3. **무중단 스케일링**
   - 블록체인 노드는 상태 동기화 필수 — pod swap이 유일한 정답
   - Service selector 레이블 기반 전환은 깔끔하고 검증됨

4. **Chain Plugin 아키텍처**
   - 단일 인터페이스로 4개 체인 지원(Thanos, Optimism, ZK Stack, Arbitrum)
   - 새로운 체인 = 4개 파일. 탁월한 확장성

5. **다층 안전 방어**
   - Kill switch → Circuit breaker → Cooldown → Rate limit → Autonomy level
   - 자동화 시스템이 폭주할 수 없음을 보장

### 약점 (잠재 프로덕션 문제)

1. **경직된 스케일링 가중치**
   - CPU:Gas:TxPool:AI = 30:30:20:20은 모든 상황에서 최적이 아님
   - OP Stack gas ratio는 거의 일정(sequencer 설정) → 30%는 낭비
   - **수정:** Chain plugin별 가중치 또는 학습 기반 동적 조정

2. **좁은 High→Emergency 대역(70-77)**
   - 7포인트 차이가 4vCPU→8vCPU(100% 증가) 트리거
   - 실제로 점수 70 vs 77 차이는 미미
   - **수정:** 70-85로 확장 또는 히스터리시스 확인 대역 추가

3. **지연시간 기반 L1 RPC 라우팅 부재**
   - 이진 healthy/unhealthy만, 응답시간 선호도 없음
   - 느리지만 살아있는 끝점이 빠른 끝점보다 선호될 수 있음
   - **수정:** 응답시간 추적으로 가중치 라우팅 추가

4. **Goal Manager 과도 복잡성**
   - Lease, Idempotency, DLQ, Checkpoint가 단일 프로세스에서 실행
   - 분산 환경 없이 분산 시스템 패턴 사용
   - **수정:** 단순화 또는 다중 인스턴스 배포 시 활성화

5. **EOA 잔액 고갈 예측 부재**
   - 반응형만(임계값 0.1 ETH 초과)
   - 가스가격 + burn-rate 기반 "N시간 후 고갈" 예측 없음

6. **메모리 기반 상태 취약성**
   - Redis 없으면 모든 상태(이상 이벤트, 스케일링 히스토리, 메트릭) 재시작 시 손실
   - Redis는 선택이 아닌 프로덕션 필수

---

## IV. 알고리즘 성숙도 매트릭스

| 하위 시스템 | 설계 | 구현 | 테스팅 | 프로덕션 검증 | 종합 |
|-----------|--------|----------------|---------|----------------------|---------|
| Scaling Engine | 9 | 9 | 8 | 7 | **8.3** |
| Anomaly Detection | 9 | 8 | 7 | 7 | **7.8** |
| RCA + Remediation | 8 | 8 | 6 | 5 | **6.8** |
| Agent Loop | 8 | 9 | 7 | 7 | **7.8** |
| Goal Manager | 9 | 8 | 5 | 3 | **6.3** |
| L1 RPC Failover | 8 | 9 | 7 | 8 | **8.0** |
| Cost Optimizer | 7 | 8 | 6 | 5 | **6.5** |
| **종합 평균** | | | | | **7.4** |

---

## V. 결론

### 한 줄 평가

> **"설계에서 L2 운영 고통점을 정확히 파악; 핵심 알고리즘은 프로덕션 급이지만 Goal Manager와 일부 가중치 튜닝 필요."**

### 프로덕션 배포 권장사항 (우선순위 순서)

1. **즉시 사용 가능:** L1 RPC Failover + Cache, Z-Score 이상 탐지, Agent Loop(기본 스케일링)
2. **조정 후 사용:** 스케일링 가중치(chain별 커스터마이징), High→Emergency tier 확장
3. **단계적 도입:** 자율성 수준 A2(dry-run) 먼저 → A3 → A4 단계적 확장
4. **추가 개발 필요:** EOA 고갈 예측, 지연시간 기반 RPC 라우팅, 학습 기반 가중치 조정

### 설계 철학 평가

SentinAI의 가장 인상적인 측면은 설계 철학입니다: **"시스템은 AI가 실패해도 작동한다."** 모든 AI 기능에는 non-AI fallback이 있고, 5계층 Safety Gate는 자동화 폭주를 방지합니다. 이는 프로덕션 인시던트를 경험한 엔지니어가 설계한 시스템의 특징입니다.

---

## VI. 하위 시스템별 상세 알고리즘 분석

### A. Scaling Engine

**파일:** `scaling-decision.ts`, `predictive-scaler.ts`, `k8s-scaler.ts`, `zero-downtime-scaler.ts`

#### 하이브리드 스코링 공식

```
Final Score = (CPU × 0.3) + (Gas × 0.3) + (TxPool × 0.2) + (AI × 0.2)
```

| 구성 요소 | 입력 | 정규화 | 가중치 |
|-----------|-------|---------------|--------|
| CPU | Container CPU %(kubectl top / docker stats) | min(cpuUsage, 100) | 30% |
| Gas | 최신 L2 블록의 gasUsed / gasLimit | min(gasUsedRatio, 1.0) × 100 | 30% |
| TxPool | txpool_status RPC pending count | min(pending / 200, 1.0) × 100 | 20% |
| AI Severity | Anomaly AI analyzer output | low=0, medium=33, high=66, critical=100 | 20% |

#### Tier 경계값

| Tier | Score 범위 | vCPU | Memory | 프로덕션 노트 |
|------|------------|------|--------|-----------------|
| IDLE | \< 30 | 1 | 2 GiB | 저트래픽 체인(야간, 주말) |
| NORMAL | 30–69 | 2 | 4 GiB | 정상 상태 운영 |
| HIGH | 70–76 | 4 | 8 GiB | **경고: 7pt 범위만** |
| EMERGENCY | ≥ 77 | 8 | 16 GiB | 스트레스 상황 |

#### 예측 스케일링 파이프라인

```
Ring buffer (60 데이터 포인트, ~60분)
  → 통계 분석 (mean, stdDev, trend, slope)
  → 시계열 컨텍스트 포함 AI prompt
  → Fast-tier LLM (1.8s 응답)
  → JSON 검증 + confidence 점수 매김
  → confidence ≥ 0.65이고 scale_up만인 경우 override
  → AI 실패 시 규칙 기반 예측 fallback
```

핵심 제약:
- 최소 10 데이터 포인트 필요
- UP만 스케일링, 다운은 없음(안전 우선)
- 5분 예측 cooldown

#### 무중단 Pod Swap 상태 머신

```
idle → creating_standby (5-30s) → waiting_ready (10s-5min)
  → switching_traffic (5-10s) → cleanup (30-90s)
  → syncing_statefulset (5-10s) → completed

어느 단계든 실패 → rolling_back → failed
```

트래픽 전환은 K8s Service selector 레이블(`slot=active` / `slot=draining`)을 사용하여 DNS TTL 지연 없이 즉시 라우팅 변경 제공.

---

### B. 이상 탐지 파이프라인

**파일:** `anomaly-detector.ts`, `anomaly-ai-analyzer.ts`, `detection-pipeline.ts`, `alert-dispatcher.ts`

#### Layer 1: 통계 탐지

**Z-Score 계산:**
```
Z = (현재값 - 평균) / 표준편차
이상: |Z| > 3.0 (99.7% 신뢰도)
```

**Min StdDev 필터 (거짓 양성 방지):**

| 메트릭 | Min StdDev | 목적 |
|--------|-----------|---------|
| cpuUsage | 0.02 (2%) | 유휴 체인 진동 필터(0.15-0.18%) |
| gasUsedRatio | 0.01 (1%) | 저사용 체인 미시 변화 필터 |
| txPoolPending | 5 tx | 소규모 풀 변화 무시 |
| l2BlockInterval | 0.3s | 자연스러운 블록 타이밍 지터 필터 |

**도메인 특화 규칙:**

| 규칙 | 트리거 | 탐지 시간 | 거짓 양성률 |
|------|---------|---------------|-------------------|
| CPU 0% drop | CPU < 1% AND recent avg ≥ 10% | 즉시 | 거의 없음 |
| Block plateau | 120s 동안 블록 높이 변화 없음 | 120s | 거의 없음 |
| TxPool monotonic | 300s 연속 증가, ≥5 포인트 | 300s | 낮음 |
| EOA threshold | Balance < 0.1 ETH (설정 가능) | Per-cycle | 거의 없음 |

#### Layer 2: AI 의미론적 분석

- **모델:** Fast tier (qwen3-80b-next, ~1.8s)
- **Rate limit:** 60초당 1회 호출
- **캐시:** 5분 TTL, 이상 패턴 hash로 키 생성
- **출력:** severity(low/medium/high/critical), anomalyType(performance/security/consensus/liveness), correlations, suggested actions

#### Layer 3: 알림 발송

- **채널:** Slack(Block Kit), Webhook, Dashboard
- **Cooldown:** 이상 타입당 10분
- **필터:** Severity는 `notifyOn` 목록에 있어야 함(기본: high, critical)

#### Layer 4: 자동 복구 (선택사항)

- `AUTO_REMEDIATION_ENABLED=true`일 때만 트리거
- RCA Engine → Playbook Matching → Action Execution로 연결

---

### C. RCA + Remediation Engine

**파일:** `rca-engine.ts`, `remediation-engine.ts`, `playbook-matcher.ts`, `action-executor.ts`

#### 의존성 그래프 (Thanos/OP Stack)

```
l1 → op-node → op-geth (primary execution)
           ├→ op-batcher → l1
           ├→ op-proposer → l1
           └→ op-challenger → l1
```

루트 컴포넌트에서 BFS 순회로 모든 다운스트림 영향 컴포넌트 식별. O(V+E) 복잡도.

#### Playbook 매칭

| Playbook | 컴포넌트 | 트리거 | 액션 |
|----------|-----------|---------|---------|
| op-geth resource exhaustion | op-geth | CPU > 90% OR OOM | scale_up → health_check |
| op-node derivation stall | op-node | Block plateau | check_l1 → restart_node → health_check |
| op-batcher stuck | op-batcher | TxPool monotonic | restart_batcher → verify |
| L1 connectivity failure | l1 | L1 block stagnant | check_l1 → collect_logs (escalate only) |
| Batcher EOA critical | op-batcher | Balance < threshold | check_treasury → refill_eoa → verify_balance |

#### Safety Gate (5 계층)

```
1. Kill Switch    (AUTO_REMEDIATION_ENABLED=true)
2. Circuit Breaker (≥3 연속 실패 → 24h 차단)
3. Cooldown       (실행 간 5분)
4. Hourly Limit   (최대 3/시간)
5. Daily Limit    (최대 10/일)
```

#### 액션 안전 수준

| 수준 | 액션 | 자동 실행 |
|-------|---------|-------------|
| safe | collect_logs, health_check, verify_balance | 항상 |
| guarded | restart_pod, scale_up, refill_eoa | allowGuardedActions=true인 경우만 |
| manual | config_change, rollback_deployment | 절대 불가(운영자만) |

---

### D. Agent Loop + Goal Manager

**파일:** `agent-loop.ts`, `goal-manager.ts`, `goal-orchestrator.ts`, `approval-engine.ts`

#### Agent Loop (60초 주기)

```
Phase 1: OBSERVE  — RPC + 컨테이너 통계에서 L1/L2 메트릭 수집
Phase 2: DETECT   — 4계층 이상 탐지 파이프라인 실행
Phase 3: ANALYZE  — 로그에서 AI severity 추출 (non-blocking)
Phase 3.5: GOAL   — goal manager tick (signal→generate→prioritize→queue)
Phase 4: PLAN     — 스케일링 계획 구성 (hybrid score + predictive override)
Phase 5: ACT      — 조건 충족 시 스케일링 실행
Phase 6: VERIFY   — 스케일링 결과 확인, 불일치 시 자동 롤백
```

#### Goal Manager 파이프라인

```
Signal Collection (6가지 타입: metrics, anomaly, failover, cost, memory, policy)
  → Candidate Generation (규칙 기반 + 선택적 LLM 개선)
  → Priority Scoring (0-100: impact 40 + urgency 25 + confidence 20 + policyFit 15)
  → Suppression (duplicate, low confidence, cooldown, policy blocked, stale signal)
  → Queue (score DESC로 정렬 → risk DESC → time ASC)
  → Dispatch (활성화되면 top goal)
  → Orchestration (lease → policy check → plan → execute → verify)
```

#### 자율성 수준 (A0-A5)

| 수준 | 자동 실행 | 승인 없이 쓰기 | 노트 |
|-------|-------------|----------------------|-------|
| A0 | 아니오 | 아니오 | 모든 항목에 수동 승인 |
| A1 | 아니오 | 아니오 | 모든 항목에 수동 승인 |
| A2 | 예 (dry-run) | 아니오 | **기본값.** Dry-run만, 쓰기 없음 |
| A3 | 예 | 낮은 위험만 | 중간 이상은 승인 필요 |
| A4 | 예 | 중간 이하 | 높은 이상은 승인 필요 |
| A5 | 예 | 높은 이하 | 치명적만 승인 필요 |

#### Approval Engine

- (toolName + sorted params)의 SHA256 hash — 결정론적
- 일회용 소비(검증 후 삭제)
- TTL 기반 만료
- hash 불일치로 파라미터 변조 탐지

---

### E. 비용 최적화 + L1 Failover

**파일:** `cost-optimizer.ts`, `usage-tracker.ts`, `l1-rpc-failover.ts`, `l1-rpc-cache.ts`, `metrics-store.ts`

#### 비용 모델 (AWS Fargate Seoul)

```
월간 비용 = (평균Vcpu × $0.04656/h + memGB × $0.00511/h) × 730h
Memory = vCPU × 2 GiB (고정 비율)
```

#### 사용 패턴 분석

- 168개 버킷: 7일 × 24시간
- 증분 평균 계산(전체 히스토리 저장 불필요)
- Savings Plans 시뮬레이션: p10(보수적), avg(권장), p50(공격적)

#### L1 RPC Failover

| 파라미터 | 값 | 근거 |
|-----------|-------|-----------|
| 일반 실패 임계값 | 3 연속 | 하드 장애에 빠른 failover |
| 429 실패 임계값 | 10 연속 | 429는 일시적일 수 있음 |
| Cooldown | 5분 | failover 폭주 방지 |
| Health check | eth_blockNumber, 10s timeout | L7 RPC 건강 검증 |
| Event history | 최대 20개 이벤트 | Ring buffer |

#### L1 RPC 캐시

| 캐시 | TTL | 영향 |
|-------|-----|--------|
| L1 block number | 6s (12s 블록 시간의 절반) | 최적의 신선도/비용 균형 |
| EOA balance | 5분 | 낮은 잔액 변화 빈도와 일치 |
| **총 감소** | | **95% RPC 호출 감소** (120→6 호출/30s) |

#### MetricsStore Ring Buffer

- 용량: 60 데이터 포인트
- 통계: mean, stdDev, min, max, trend(rising/falling/stable), slope
- Trend 임계값: slope > 0.5 → rising, < -0.5 → falling
- 기울기 계산을 위한 선형 회귀

---

## VII. 개선 로드맵

### 긴급 (P0)

| 항목 | 현재 | 대상 | 영향 |
|------|---------|--------|--------|
| Chain별 스케일링 가중치 | 고정 30/30/20/20 | ChainPlugin override 가능 | OP Stack의 Gas 가중치 낭비 제거 |
| High→Emergency 격차 | 70-77 (7pts) | 70-85 (15pts) with hysteresis | 4→8 vCPU 과도 급증 방지 |

### 단기 (P1)

| 항목 | 현재 | 대상 | 영향 |
|------|---------|--------|--------|
| L1 RPC 라우팅 | 이진 healthy/unhealthy | 지연시간 가중치 선택 | 각 호출의 최적 끝점 |
| EOA 고갈 예측 | 임계값만 (0.1 ETH) | Burn-rate 기반 "N시간" 예보 | 고갈 전 사전 알림 |
| L1 부분 성능 저하 | 감지 불가 | 느린 응답 탐지 (>2s) | 성능 저하 끝점 포착 |

### 중기 (P2)

| 항목 | 현재 | 대상 | 영향 |
|------|---------|--------|--------|
| Goal Manager 단순화 | 전체 분산 패턴 | 단일 프로세스 최적화 | 복잡성과 유지보수 감소 |
| L1 gas + blob 비용 추적 | Fargate vCPU만 | L1 gas, blob, sequencer 비용 포함 | 완전한 OP Stack OpEx 가시성 |
| 학습 기반 가중치 튜닝 | 정적 설정 | 에피소드 기반 동적 조정 | 자기 개선 점수 정확도 |
