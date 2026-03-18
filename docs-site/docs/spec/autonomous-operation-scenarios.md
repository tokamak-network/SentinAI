# SentinAI 자율 운영 시나리오

> 상태: 명세 | 작성일: 2026-02-27
> 전제: `docs/roadmap/30day-plan-2026-02-v2.md` 완료 후 활성화되는 시나리오

이 문서는 30일 계획 완료 시점의 SentinAI가 실제 운영 환경에서 어떻게 자율 대응하는지를 구체적인 시나리오로 기술한다. AI 에이전트 구현 참조용으로 작성되었다.

---

## 시스템 구성 전제

```
AgentOrchestrator
  ├── AgentInstance[l2-sequencer]   — Guardian + Performance + Cost + Security
  ├── AgentInstance[l1-execution]   — Security + Performance (EVM Execution Collector)
  └── AgentInstance[l1-consensus]   — Security (Beacon API Collector)
            ↓ AgentBus (A2A)
  Incident Commander               — 우선순위 결정 + 컨센서스 + 에스컬레이션
            ↓
  NotificationRouter               — Slack / Discord / Telegram 동시 발송

구독: General (무료) / Premium ($299/체인/월, TON 결제 15% 할인)
Feature Gate: assertGate(chainId, feature) — 미통과 시 즉시 차단
```

---

## A. L2 자율 스케일링

### A1. TxPool 급증 → 멀티 에이전트 합의 → 자동 스케일 업

**상황**: L2 시퀀서 TxPool이 급증하여 처리 지연 발생

**트리거**: `txPoolPending` Z-Score > 3.0 (847개 감지, 7일 이평 대비 4.2σ)

**자율 대응 흐름**:
```
[0s]  Performance Agent: TxPool 847개 → "scale-up" 신호 AgentBus 발행
[1s]  Cost Agent: 현재 L1 가스비 7일 이평의 58% → "scale-up 적기" A2A 응답
[2s]  Guardian Agent: gasUsedRatio 87% 확인 → "scale-up" 찬성
[3s]  Consensus: 3/3 찬성 (threshold 2/3 충족) → 자동 실행 승인
[4s]  K8sScaler: op-geth 2 vCPU → 4 vCPU 패치 실행
[8s]  ZeroDowntimeScaler: Parallel Pod Swap 완료 (다운타임 0초)
[35s] Guardian Agent: TxPool 124개 → 정상화 확인
[36s] NotificationRouter: Slack + Discord + Telegram 동시 발송
```

**운영자 수신**:
```
[Slack] 🚀 SentinAI가 자동으로 대응했습니다.
        TxPool이 847개까지 올라가 op-geth를 2→4 vCPU로 확장했습니다.
        현재 TxPool: 124개. 정상입니다.
        에이전트 합의: 3/3 (Performance ✅ Cost ✅ Guardian ✅)
```

**결과**: 처리 용량 2배 증가, TxPool 정상화 8분 내, 다운타임 0초

---

### A2. 스케일 업 합의 부결 → 과잉 대응 방지

**상황**: TxPool 일시 스파이크이나 블록 생산은 정상, 가스비는 고점

**트리거**: `txPoolPending` Z-Score > 3.0 (780개) — 단, 다른 지표는 정상

**자율 대응 흐름**:
```
[0s]  Guardian Agent: TxPool 780개 → "scale-up" 찬성
[1s]  Performance Agent: blockInterval 2.1s (정상), batchFailureRate 0% → "scale-up" 반대
[2s]  Cost Agent: L1 가스비 7일 이평의 140% → "scale-up 비효율" 반대
[3s]  Consensus: 1/3 찬성 (threshold 2/3 미달) → 현상 유지
[4s]  Incident Commander: "5분 후 재관측" 예약
[9m]  TxPool 520개 → 자연 감소, 스케일 불필요 확인
```

**운영자 수신**:
```
[Slack] ⚠️ 스케일 보류: 에이전트 의견 불일치
        TxPool 780개이나 블록 생산 정상, 가스비 고점.
        5분 후 재관측 예정. (Performance ❌ Cost ❌ Guardian ✅)
```

**결과**: 불필요한 스케일링 방지, 비용 절감

---

### A3. 배치 제출 실패 → 과거 인시던트 참조 → 승인 기반 복구

**상황**: op-batcher 배치 제출 실패율 급등

**트리거**: Performance Agent: `batchSubmitFailureRate` > 20% (현재 23%)

**자율 대응 흐름**:
```
[0s]  Performance Agent: batchSubmitFailureRate 23% 감지 → AgentBus 발행
[1s]  Vector DB: semanticSearch("batcher submission failure") 실행
      결과: "2026-01-15 유사 인시던트 — op-batcher 재시작으로 45초 내 해결"
[2s]  Incident Commander: P1 선언, Playbook 후보 = [restart-op-batcher]
[3s]  riskLevel: 'high' → 자동 실행 불가, 인간 승인 필요
[4s]  NotificationRouter: Telegram + Slack 동시 발송 (5분 타임아웃)
[67s] 운영자 Telegram 승인 버튼 클릭
[68s] ActionExecutor: op-batcher 재시작 Playbook 실행
[90s] Performance Agent: batchSubmitFailureRate 0% → 정상화 확인
[91s] NotificationRouter: 전 채널 "✅ 처리됨" 메시지 자동 편집
```

**운영자 수신**:
```
[Telegram] ⚠️ op-batcher 배치 실패율 23%
           과거 유사 인시던트: 재시작으로 해결됨 (2026-01-15)
           [✅ 재시작 승인]  [❌ 거부]  [🔍 RCA 보기]
           (5분 후 자동 취소)

[Slack] (67초 후 자동 업데이트)
✅ Telegram에서 승인됨 — op-batcher 재시작 실행 중
```

**결과**: 배치 재개 45초 내, 운영자 승인 대기 포함 전체 복구 2분 이내

---

### A4. 고부하 종료 → 자동 다운스케일

**상황**: Emergency 스케일 업(8 vCPU) 이후 부하 정상화

**트리거**: Cost Agent: 8 vCPU 30분 경과 + TxPool < 50개 + gasUsedRatio < 40%

**자율 대응 흐름**:
```
[0s]   Cost Agent: "고비용 상태 지속, 부하 정상화 확인 → downscale 제안" 신호
[1s]   Guardian Agent: TxPool 38개, gasUsedRatio 34% → 동의
[2s]   Consensus: 2/2 찬성 → 쿨다운 5분 후 자동 실행 예약
[5m]   K8sScaler: 8 → 2 vCPU 복귀
[5m2s] 비용 절약 계산: 8 vCPU 35분 → 예정보다 25분 단축 → $0.29 절약 기록
```

**운영자 수신**:
```
[Slack] 📉 op-geth 8→2 vCPU 자동 복귀
        고부하 종료 확인 (TxPool 38개, 쿨다운 후 실행)
        절약: 약 $0.29 / 이번 달 누적 절약: $8.40
```

---

## B. L1 클라이언트 자율 대응

### B1. L1 EL RPC 할당량 소진 → 자동 Failover

**상황**: 기본 L1 RPC 엔드포인트 할당량 초과

**트리거**: Guardian Agent: L1 `eth_blockNumber` 연속 실패 3회

**자율 대응 흐름**:
```
[0s]  Guardian: L1 RPC 실패 3회 연속 감지 → Security Agent에 A2A 쿼리
[1s]  Security: "비정상 트래픽 패턴 없음, 할당량 소진으로 판단" 응답
[2s]  L1Failover: L1_RPC_URLS 리스트에서 다음 healthy 엔드포인트 선택
[3s]  K8s: op-node, op-batcher, op-proposer 환경변수 자동 갱신
[4s]  Guardian: 새 엔드포인트로 eth_blockNumber 성공 확인
[5s]  NotificationRouter: 전 채널 동시 발송 (URL 마스킹)
```

**운영자 수신**:
```
[Slack + Discord + Telegram] 🔄 L1 RPC 장애 감지, 자동 전환 완료
                              이전: https://rpc1.example*** (할당량 초과)
                              현재: https://rpc2.example*** (정상)
                              L2 블록 생산 중단 없음 (다운타임: 0초)
```

**결과**: L2 블록 생산 중단 없이 전환, 5초 내 완료

---

### B2. L1 EL 피어 수 급감 → 네트워크 격리 위험 대응

**상황**: Geth 노드 피어 수 급감 (네트워크 격리 또는 P2P 공격 가능성)

**트리거**: EVM Execution Collector: `peerCount` 25 → 3 (threshold breach: < 5)

**자율 대응 흐름**:
```
[0s]  AgentInstance[l1-execution]: peerCount 3 감지
[1s]  Security Agent: "P2P 피어 급감, GossipSub 공격 가능성 분류"
[2s]  Commander: 단독 판단 보류, 10분 연속 관찰 지시
[12m] 3회 연속 peerCount < 5 확인 → P1 에스컬레이션
[13m] riskLevel: 'high' → 승인 요청 (5분 타임아웃)
[14m] 운영자 승인 → 피어리스트 갱신 + 재연결 Playbook
[18m] peerCount 18 → 정상화 확인
```

**운영자 수신**:
```
[Telegram] 🚨 L1 Geth 피어 수 3개 (정상: 25개 이상)
           GossipSub 공격 또는 네트워크 분리 가능성
           10분 연속 확인 완료 → 피어 재연결 필요
           [✅ 피어리스트 갱신 + 재연결 승인]  [❌ 거부]
```

---

### B3. L1 CL 파이널리티 지연 → P0 에스컬레이션

**상황**: Lighthouse 파이널리티가 2 epoch 이상 진행되지 않음 (심각한 네트워크 문제)

**트리거**: Beacon API Collector: `finalizedEpoch` 2 epoch 이상 plateau

**자율 대응 흐름**:
```
[0s]  AgentInstance[l1-consensus]: finalizedEpoch plateau 탐지
[1s]  Security: "외부 공격 패턴 없음, CL 내부 문제로 판단"
[2s]  Commander: P0 선언 (파이널리티 지연 = 생태계 전체 영향)
      자동 실행 불가, riskLevel: 'critical'
[3s]  NotificationRouter: 전 채널 30분 타임아웃 승인 요청
[4s]  L2 AgentInstance에도 "L1 파이널리티 이슈" A2A 알림 발송
      → L2 스케일링 결정 일시 중단 (보수적 모드)
[8m]  운영자 승인 → CL 클라이언트 안전 재시작
[12m] finalizedEpoch 재진행 확인
```

**운영자 수신**:
```
[전 채널] 🚨 [P0] L1 파이널리티 지연 — 2 epoch 이상 정체
          Lighthouse finalized epoch: 244,918 (34분째 정지)
          L2 에이전트 보수적 모드 전환됨
          [✅ CL 재시작 승인]  [❌ 거부]  (30분 타임아웃)
```

---

### B4. 밸리데이터 잔액 감소 → 슬래싱 위험 경보

**상황**: 밸리데이터 클라이언트 잔액이 슬래싱 위험 임계값 이하로 감소

**트리거**: Beacon API: `validatorBalance` < 31.5 ETH (현재 31.4 ETH), `missedAttestations` 급증

**자율 대응 흐름**:
```
[0s]  AgentInstance[l1-consensus]: validatorBalance 31.4 ETH 감지
[1s]  Security: "missedAttestations 15회/epoch → 정상 2회 대비 비정상, 슬래싱 조건 진입"
[2s]  Commander: P0, 자동 조치 없음 (밸리데이터 조작은 인간 전담)
[3s]  EOA Monitor: 밸리데이터 주소 잔액 재확인
[4s]  NotificationRouter: 전 채널 즉시 알림 (타임아웃 없음, 인지 확인만)
```

**운영자 수신**:
```
[전 채널] 🚨 [P0] 밸리데이터 슬래싱 위험
          잔액: 31.4 ETH (임계값: 31.5 ETH)
          missedAttestations: 15회/epoch (정상: 2회)
          즉각 확인 필요 — 자동 조치 없음 (인간 결정 필수)
```

---

## C. 비용 자율 최적화

### C1. L1 가스비 저점 → 배치 타이밍 최적화

**상황**: L1 가스비가 7일 이평의 60% 수준 (배치 제출 최적 타이밍)

**트리거**: Cost Agent: 현재 가스비 < 7d average × 0.65 지속 15분

**자율 대응 흐름**:
```
[0s]  Cost Agent: 가스비 저점 감지 → "배치 타이밍 최적화" 신호 발행
[1s]  A2A: Performance Agent에게 "즉시 배치 권고" 쿼리
[2s]  Performance: "현재 배치 큐 340개, 제출 가능" 응답
[3s]  Cost: 배치 제출 스케줄 즉시 트리거
[10s] 배치 제출 완료, 가스비 절약 = $42.30 기록
[4h]  일간 리포트에 "배치 타이밍 최적화: $42.30 절약" 항목 포함
```

**운영자 수신 (일간 리포트 발췌)**:
```
💰 오늘 비용 최적화 요약
  가스비 저점 포착 (2회): $42.30 절약
  스케일 조기 복귀 (1회): $0.29 절약
  이번 달 누적 절약: $387.40
  Premium 구독료 대비 절약율: 129%
```

---

## D. 멀티 인스턴스 + 크로스 스택 분석

### D1. Rollup Hub 신규 appchain 자동 프로비저닝

**상황**: Rollup Hub에서 새 appchain 배포 완료, SentinAI에 자동 통보

**트리거**: `POST /api/webhooks/rollup-hub { event: 'chain.deployed', chainId: '17001', rpcUrl, chainType: 'op-stack' }`

**자율 대응 흐름**:
```
[0s]   Webhook 수신
[1s]   connection-validator: RPC 접속 확인 + "op-geth/v1.101.0" 자동 감지
[2s]   ProtocolDescriptor 매핑: opstack-l2 선택
[3s]   InstanceRegistry: NodeInstance 생성 + Redis 저장
[4s]   AgentOrchestrator.startAgent(instance, descriptor) 호출
[5s]   AgentInstance[17001] 루프 시작 (30초 후 첫 사이클)
[35s]  첫 에이전트 사이클 완료: 메트릭 수집 성공
[36s]  운영자 Slack 알림 발송
```

**운영자 수신**:
```
[Slack] ✅ PartnerChain A 모니터링 시작됨
        프로토콜: OP Stack L2 시퀀서
        감지된 클라이언트: op-geth/v1.101.0
        첫 에이전트 사이클: 완료 (이상 없음)
        대시보드: sentinai.tokamak.network/dashboard
```

**결과**: 수동 개입 0, Webhook 수신 후 40초 내 완전 모니터링 시작

---

### D2. L1 EL + L2 동시 이상 → 크로스 스택 RCA

**상황**: L1 Geth 피어 급감과 L2 블록 생산 지연이 동시에 발생

**트리거**:
- `AgentInstance[l1-execution]` Security: peerCount 25 → 3
- `AgentInstance[l2-sequencer]` Performance: blockInterval 2.1s → 15s

**자율 대응 흐름**:
```
[0s]  Security(L1): peerCount 3 → AgentBus 발행
[0s]  Performance(L2): blockInterval 15s → AgentBus 발행
[1s]  Incident Commander: 두 신호 동시 수신
      → L1-L2 의존성 그래프 참조:
        L1-execution → op-node → op-geth (L2)
      → 상관관계 분석: "L1 EL 피어 부족 → op-node L1 데이터 수신 지연 → L2 블록 생산 저하"
[2s]  RCA 자동 완성: 근본 원인 = L1 Geth 피어 부족
[3s]  우선순위: L1 Playbook 먼저 (근본 원인), L2는 대기
[4s]  승인 요청: "L1 Geth 피어 재연결"
[67s] 운영자 승인
[72s] L1 피어 재연결 완료, peerCount 18 회복
[85s] L2 blockInterval 2.3s 자동 정상화 (L1 복구 연동)
```

**운영자 수신**:
```
[Discord] 🔍 크로스 스택 RCA 완료
          근본 원인: L1 Geth 피어 부족 (3개)
          영향 경로: Geth(L1 EL) → op-node → op-geth(L2 시퀀서)
          L2 블록 지연 15s는 L1 복구 시 자동 해소됩니다.
          [✅ L1 Geth 피어 재연결 승인]
```

**결과**: 두 인시던트의 연관성을 AI가 자동 추적, 단일 승인으로 두 문제 동시 해결

---

## E. 구독 + 체험팀 전환 자동화

### E1. 첫 자동 대응 → Aha Moment 메시지

**상황**: 체험팀의 체인에서 첫 자동 스케일링 이벤트 발생

**트리거**: 첫 자동 스케일링 실행 완료 + trial-nudge.ts: `firstAutoScalingDone === false`

**자율 대응 흐름**:
```
[0s]  자동 스케일링 완료 (A1 시나리오와 동일)
[1s]  trial-nudge: firstAutoScalingDone 플래그 확인 → 미전송 확인
[2s]  Aha Moment 메시지 생성 (AI 응답 생성, 절약 시간 추산 포함)
[3s]  운영자 Slack 발송
[4s]  firstAutoScalingDone = true 플래그 저장
```

**운영자 수신**:
```
[Slack] 🚀 SentinAI가 자동으로 대응했습니다.

        TxPool이 847개까지 올라가 op-geth를 2→4 vCPU로 확장했습니다.
        현재 TxPool: 38개. 정상입니다.

        수동 대응이 필요했다면: 이상 감지 → 원인 분석 → 스케일링 실행까지
        평균 23분 소요됩니다. SentinAI는 8초에 처리했습니다.

        체험 기간: D+3 / 90일 남음
```

---

### E2. 체험 80일차 → 유료 전환 넛지 시퀀스

**상황**: 체험팀 체험 시작 80일 경과

**트리거**: scheduler 일간 실행 → `trialEndsAt - now() = 10일`

**자율 대응 흐름**:
```
[daily cron]  trial-nudge: trialEndsAt 확인 → 80일차 해당
              통계 집계:
                - 총 자동 대응 횟수: 38회
                - 자동 스케일링: 12회
                - L1 Failover: 3회
                - 배치 복구: 2회
                - 절약 시간 추산: 12.5시간
                - 비용 절약: $387.40
              넛지 메시지 생성 → Slack + 이메일 동시 발송
```

**운영자 수신**:
```
[Slack + Email]
  SentinAI가 80일 동안 38회 자동 대응했습니다.

  📊 절약 요약:
    엔지니어링 시간: 12.5시간 ($1,250 상당, @$100/h 기준)
    인프라 비용: $387.40

  💳 Premium 구독: 월 $299 / 체인
  (TON 결제 시 $254.15 — 15% 할인)

  10일 후 체험이 종료됩니다.
  [지금 구독하기 →]  [담당자와 상담하기 →]
```

---

### E3. General 사용자 Premium 기능 차단 + 업그레이드 유도

**상황**: General 티어 사용자가 AI RCA API 호출 시도

**트리거**: `POST /api/rca` — `chainSubscription.tier === 'general'`

**자율 대응 흐름**:
```
[0s]  API 수신
[1ms] Feature Gate: checkGate(chainId, 'aiRca')
      → tier = 'general', allowed = false
[2ms] 즉시 응답 반환 (AI 호출 없음, 비용 발생 없음)
```

**API 응답**:
```json
{
  "allowed": false,
  "feature": "aiRca",
  "reason": "AI RCA 엔진은 Premium 기능입니다.",
  "currentTier": "general",
  "_upgrade": {
    "message": "스케일링은 됐지만 원인을 알 수 없나요?",
    "ctaUrl": "/pricing#premium",
    "ctaLabel": "AI RCA 무료 체험 시작"
  }
}
```

**대시보드 표시**: RCA 패널에 반투명 오버레이 + "Premium에서 사용 가능" 툴팁

---

## F. NLOps 자연어 운영

### F1. 인시던트 중 상황 쿼리

**상황**: B3(파이널리티 지연) 인시던트 진행 중 운영자 질의

**트리거**: 운영자 NLOps 채팅: "지금 상황이 어때?"

**자율 대응 흐름**:
```
[0s]  NLOps Engine: Feature Gate 확인 (Premium ✅)
[1s]  Intent 분류: 'query'
[2s]  현재 인스턴스 상태 수집:
        AgentInstance[l2]: TxPool 정상, blockInterval 23s (L1 이슈로 영향)
        AgentInstance[l1-consensus]: finalizedEpoch 정체 2 epoch
        Incident Commander: P0 인시던트 활성 (승인 대기 중)
[3s]  AI 응답 생성
```

**운영자 수신**:
```
[NLOps] 현재 P0 인시던트 진행 중입니다.

        🚨 L1 Lighthouse 파이널리티 34분째 정지 (2 epoch)
        ⚠️  L2 블록 간격 23s (정상: 2s) — L1 영향으로 추정
        ✅ L2 TxPool 정상 (38개)

        Telegram에 재시작 승인 요청이 발송되어 있습니다.
        승인하시면 CL을 안전하게 재시작합니다.
```

---

## G. OpenTelemetry 관찰성 시나리오

### G1. 에이전트 사이클 병목 분석

**상황**: 에이전트 사이클 시간이 평소 6s → 28s로 증가

**트리거**: OTel 스팬 기록 → 이상 감지

**OTel 스팬 데이터 (Grafana Tempo)**:
```
agent-instance[thanos-sepolia] cycle [28.1s] ← 이상
  ├── observe                   [0.5s]  정상
  ├── anomaly-detector          [0.2s]  정상
  ├── anomaly-ai-analyzer       [1.8s]  정상
  │     └── llm.call[qwen3-80b] [1.75s, in=1024tok, out=512tok]
  ├── rca-engine                [24.1s] ← 병목!
  │     └── llm.call[qwen3-80b] [23.9s, in=8192tok, out=2048tok]
  │           → 원인: 컨텍스트 토큰 초과로 재시도 발생
  └── scaling-decision          [0.05s] 정상
```

**인사이트**: RCA 프롬프트 최적화 필요 (8192 → 4096토큰으로 압축)

---

## 시나리오 커버리지 요약

| 구성 요소 | 활용 시나리오 |
|----------|-------------|
| AgentOrchestrator | A1, A2, A3, B1, B2, D1, D2 |
| A2A 프로토콜 | A1, A2, B1, C1, D2 |
| 컨센서스 메커니즘 | A1 (3/3 가결), A2 (1/3 부결), C2 |
| Incident Commander | A3, B2, B3, B4, D2 |
| L1 EL 수집기 | B1, B2, D2 |
| L1 CL 수집기 | B3, B4 |
| 멀티플랫폼 양방향 승인 | A3, B2, B3, D2 |
| Vector DB 시맨틱 검색 | A3 (과거 인시던트 참조) |
| Feature Gate | E3, F1 |
| TON 결제 → Premium | E2 전환 이후 |
| Rollup Hub Webhook | D1 |
| Cross-stack RCA (L1+L2) | D2 |
| Cost Agent + 배치 타이밍 | C1, A4 |
| Aha Moment + 전환 넛지 | E1, E2 |
| NLOps (Premium) | F1 |
| OpenTelemetry | G1 |
