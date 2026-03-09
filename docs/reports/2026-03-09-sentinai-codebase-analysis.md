# SentinAI 코드베이스 상세 분석 리포트

작성일: 2026-03-09

## 1. 요약

현재 SentinAI는 단일 기능 애플리케이션이라기보다, 다음 네 축이 동시에 공존하는 전환기 코드베이스다.

1. 운영 관제 대시보드와 상태 페이지
2. 메트릭 수집, 이상 탐지, RCA, 스케일링, 롤백을 수행하는 기존 런타임
3. Goal Manager, 정책 엔진, MCP를 포함한 자율 운영 계층
4. 인스턴스 중심 Agent V2와 플레이북 학습 계층

전체적으로 보면 "데모 사용자 인터페이스"보다 "운영 자동화 엔진" 쪽이 더 성숙하다. 특히 `src/lib`의 탐지, 검증, 롤백, 정책, 스케일링 로직은 단순 프로토타입 수준을 넘는다. 반면 사용자 표면은 두 갈래다. 현재 실동작 중심 화면은 `/`이고, `/v2`는 차세대 사용자 인터페이스 프로토타입이지만 아직 목업 데이터 기반이다. 따라서 제품 서사는 V2처럼 보이지만 실제 운영 중심축은 여전히 레거시 `agent-loop`와 대형 API route들에 남아 있다.

핵심 진단은 다음과 같다.

- 강점: 운영 자동화 범위가 넓고, 핵심 백엔드 로직에 대한 테스트 밀도가 높다.
- 구조적 현실: `agent-loop`와 Agent V2가 병존하며, 저장소/이벤트/메트릭 경로가 이중화되어 있다.
- 제품 표면의 간극: 메인 대시보드는 실제 데이터 기반이지만, `/v2`와 문서 검색은 아직 프로토타입 성격이 강하다.
- 다음 단계의 핵심 과제: "기존 런타임 유지"와 "V2 수렴" 중 어느 쪽을 기준선으로 삼을지 명확히 해야 한다.

## 2. 분석 범위와 방법

이번 분석은 문서가 아니라 코드 기준으로 수행했다. 주요 검토 범위는 다음과 같다.

- 앱 라우터 표면: `src/app/page.tsx`, `src/app/v2/page.tsx`, `src/app/status/page.tsx`, `src/app/connect/page.tsx`, `src/app/docs/[[...slug]]/page.tsx`
- 사용자 인터페이스 컴포넌트: `src/components/*`
- 운영 API: `src/app/api/**`
- 기존 런타임: `src/lib/agent-loop.ts`, `src/lib/detection-pipeline.ts`, `src/lib/anomaly-detector.ts`, `src/lib/goal-manager.ts` 등
- Agent V2: `src/core/**`
- 체인/프로토콜 추상화: `src/chains/**`, `src/protocols/**`
- 테스트와 검증 상태: `npm run test:run`

## 3. 저장소 개요

2026-03-09 기준 코드베이스 스냅샷은 아래와 같다.

| 항목 | 수량 |
| --- | ---: |
| `src/app` 내 `page.tsx` | 5 |
| `src/app/api/**/route.ts` | 71 |
| `src/app/v1` 내 파일 | 16 |
| `src/app/api/v2/**/route.ts` | 27 |
| `src/components/*.tsx` | 18 |
| `src/lib` 루트 TypeScript 파일 | 90 |
| `src/core` TypeScript 파일 | 57 |
| `src/lib/__tests__/*.test.ts` | 76 |
| `src/core/__tests__/*.test.ts` | 22 |
| `src/app/api` 관련 테스트 | 25 |

이 수치가 의미하는 바는 명확하다. SentinAI는 단순한 Next.js 대시보드가 아니라, Next.js를 셸로 사용하면서 그 안에 상당한 운영 엔진을 넣은 구조다. 파일 수와 테스트 수 모두 사용자 인터페이스보다 런타임 로직 쪽에 무게가 실려 있다.

## 4. 제품 표면 분석

### 4.1 메인 `/`: 사실상 운영 관제 대시보드

`src/app/page.tsx`는 일반적인 마케팅 랜딩 페이지가 아니다. 이 화면은 현재 SentinAI의 실질적인 메인 운영 콘솔이다.

- `/api/metrics`, `/api/scaler`, `/api/l1-failover`, `/api/agent-loop`, `/api/agent-fleet`, `/api/anomalies`, `/api/experience`, `/api/nlops`, `/api/rca` 등을 지속적으로 폴링한다.
- `AgentRosterPanel`, `AgentInteractionGraph`, `OperationsPanel`, `NLOpsBar`를 조합해 에이전트 상태, 그래프, 운영 액션, 자연어 오퍼레이션 입력을 한 화면에 모은다.
- 사용자 인터페이스는 글로벌 디자인 시스템보다는 터미널형 운영 콘솔을 우선시한다. `globals.css`보다 인라인 스타일이 실제 표현을 지배한다.
- "seed metrics", "stress mode", "fallback" 흐름이 화면 레벨에 직접 녹아 있어 데모와 운영 시뮬레이션을 함께 지원한다.

중요한 해석은 다음과 같다. 현재 저장소에는 별도의 퍼블릭 랜딩 페이지가 존재하지 않는다. 사용자가 접속하는 첫 표면인 `/`는 브랜드 소개 페이지가 아니라 운영자용 실시간 콘솔이다.

### 4.2 `/v2`: 차세대 대시보드 프로토타입

`src/app/v2/page.tsx`는 시각적으로 가장 현대적인 화면이지만, 현재 기준 실데이터 연결보다는 프로토타입 성격이 강하다.

- `COST_DATA`, `PERFORMANCE_DATA`, `LOGS`가 파일 내부 상수로 하드코딩되어 있다.
- 검색창, 사이드바, 차트, 로그 패널이 모두 정적 데이터를 사용한다.
- 운영 API와의 연결이 거의 없다.

즉, `/v2`는 "가고 싶은 방향"을 보여 주는 사용자 인터페이스이고, "현재 실제 운영 중인 표면"은 아니다.

### 4.3 `/status`: 공개용 상태 페이지

`src/app/status/page.tsx`는 `/api/public/status`를 30초마다 폴링하는 공개 상태 페이지다.

- 내부 incident 정보를 그대로 노출하지 않고 public-safe summary만 표시한다.
- anomaly history를 이용해 24시간/7일 uptime을 계산한다.
- 운영자 화면과 달리 외부 공개 관점에 맞춰 민감한 디테일을 걸러낸다.

이 표면은 실제 서비스 가능성이 높다. 공개 제품 표면 중에서는 가장 정리된 축에 속한다.

### 4.4 `/connect`: V2 온보딩 시작점

`src/app/connect/page.tsx`는 온보딩 테스트/연결 확인 화면이다.

- `/api/v2/onboarding/complete`를 호출한다.
- 성공 시 `dashboardUrl`로 이동한다.
- 즉시 실운영용 화면이라기보다 V2 인스턴스 등록 플로우의 입구에 가깝다.

### 4.5 `/docs`: 파일 시스템 기반 문서 브라우저

`src/app/docs/[[...slug]]/page.tsx`는 `docs/` 디렉터리를 그대로 브라우징하는 내부 문서 시스템이다.

- `safeResolveDocPath`로 path traversal을 방지한다.
- `DocsSidebar`는 하드코딩된 정보 구조를 사용한다.
- `TableOfContents`는 markdown 내 `h2`, `h3`를 정규식으로 추출한다.
- `DocSearch`는 실제 색인이 아니라 목업 결과 목록만 필터링한다.
- `MarkdownRenderer`는 `rehypeRaw`를 사용하므로 raw HTML 렌더링이 허용된다.

평가하면, 문서 뷰어 자체는 실용적이지만 "검색"은 아직 기능적으로 완성되지 않았다.

## 5. 런타임 아키텍처 분석

### 5.1 현재 운영 백본은 `agent-loop` + 대형 API route

현재 실동작 중심축은 Agent V2보다 `src/lib/agent-loop.ts`와 `src/app/api/metrics/route.ts`에 더 가깝다.

`src/app/api/metrics/route.ts`는 메트릭 조회 엔드포인트를 넘어 사실상 통합 운영 상태 집계기 역할을 한다.

- Kubernetes / Docker 컴포넌트 상태를 수집한다.
- L1/L2 RPC 상태, txpool, derivation lag, dispute game, 체인별 확장 메트릭을 병합한다.
- CPU 계산도 컨테이너 사용량 우선, 없으면 EVM load fallback 등 다단계다.
- cost 추정, anomaly detection pipeline 연결, metric store 적재를 동시에 수행한다.
- `L2_RPC_URL`이 없더라도 K8s 기반 fallback 응답을 만들도록 설계되어 있다.

`src/lib/agent-loop.ts`는 관측부터 검증까지의 직렬 오케스트레이션을 담당한다.

- observe
- detect
- analyze
- goal manager tick/dispatch
- plan
- act
- verify

여기에는 스케일링 의사결정, 예측 스케일러 보정, cooldown 관리, 작업 결과 검증, 롤백 계획 실행까지 포함된다. 즉 "루프"라는 이름보다 실제 역할은 운영 제어면에 가깝다.

### 5.2 탐지 파이프라인은 생각보다 성숙하다

`src/lib/detection-pipeline.ts`는 탐지를 4계층으로 나눈다.

1. 통계적 이상 탐지
2. AI 심화 분석
3. 알림 디스패치
4. 자동 대응

중요한 설계 포인트는 1단계만 동기 처리하고, 2단계 이후는 백그라운드로 넘긴다는 점이다. 즉, API 지연 시간과 진단 깊이를 분리했다.

`src/lib/anomaly-detector.ts`는 단순 z-score 탐지기가 아니다.

- sustained streak
- minimum standard deviation threshold
- plateau detection
- txpool monotonic increase 감지
- CPU zero-drop 같은 룰 기반 보조 탐지

이 조합은 false positive를 줄이려는 의도가 분명하다. 코드 전반에서 "운영자에게 쓸모없는 경보를 줄이겠다"는 방향이 읽힌다.

### 5.3 AI 계층은 다중 프로바이더 운영을 전제로 설계돼 있다

`src/lib/ai-routing.ts`와 `src/lib/ai-client.ts`는 단순 SDK wrapper가 아니다.

- 라우팅 정책: `latency-first`, `balanced`, `quality-first`, `cost-first`
- 프로바이더 회로 차단
- 예산 추적
- 프로바이더 우선순위
- A/B sampling
- 비용 추정과 의사결정 로그 기록

특히 `chatCompletion({ modelTier })` 인터페이스를 통해 상위 호출부가 모델명을 몰라도 되도록 만든 점은 운영 코드에 적합하다.

다만 문서 일관성 이슈는 존재한다.

- `src/lib/ai-client.ts`의 `MODEL_MAP`에서 `qwen` 프로바이더의 `fast`와 `best`는 모두 `qwen3-80b-next`다.
- 반면 저장소의 `AGENTS.md` 설명은 `best` tier가 `qwen3-235b`라고 적고 있다.

현재 코드 기준 진실은 `ai-client.ts`다. 따라서 문서보다 런타임 구현을 신뢰해야 한다.

## 6. Goal Manager / 자율 운영 / MCP 분석

### 6.1 Goal Manager는 별도 운영 계층으로 분리돼 있다

`src/lib/goal-manager.ts`는 단순 작업 대기열이 아니다.

- 신호 스냅샷 수집
- 후보 생성
- 우선순위화
- 억제 규칙 적용
- 대기열 upsert
- 만료 처리
- DLQ 재처리
- dispatch 연계

즉, 시스템 신호를 goal로 승격하고, 그것을 처리 가능한 작업으로 관리하는 자율 운영 엔진의 초입부다.

### 6.2 실행 계층은 정책, 검증, 롤백을 갖춘다

`src/lib/goal-orchestrator.ts`, `src/lib/goal-planner.ts`, `src/lib/policy-engine.ts`, `src/lib/operation-verifier.ts`, `src/lib/rollback-runner.ts`를 보면 자율 운영 경로가 다음 순서로 분리되어 있다.

1. goal을 intent/step plan으로 변환
2. 정책 엔진으로 실행 허용 범위 판정
3. 실제 작업 수행
4. 사후 검증
5. 실패 시 rollback

특히 `policy-engine.ts`의 A0~A5 autonomy level, risk/confidence/read-only 기반 허용 모델은 "무조건 자동화"가 아니라 "가드레일이 있는 자동화"를 지향한다.

### 6.3 `autonomous/service.ts`는 상대적으로 약한 고리다

`src/lib/autonomous/service.ts`는 autonomous intent의 plan/execute/verify/rollback 흐름을 제공하지만, 작업 기록을 전역 in-memory map에 저장한다. 이는 `goal-manager` 계열의 Redis 기반 내구성과 대비된다.

정리하면 SentinAI에는 두 종류의 자율 운영 경로가 있다.

- 비교적 성숙한 경로: goal manager + orchestrator + verifier + rollback
- 상대적으로 가벼운 경로: 메모리 기반 autonomous service

둘 사이의 내구성 수준이 다르므로 운영 기준선은 전자에 맞추는 편이 안전하다.

### 6.4 MCP는 기능 범위를 넓히는 외부 인터페이스다

`src/app/api/mcp/route.ts`와 `src/lib/mcp-server.ts`는 SentinAI 기능을 MCP 스타일 인터페이스로 노출한다. 이는 단순 사용자 인터페이스 제품을 넘어, 외부 에이전트나 도구가 SentinAI의 관제/조치 기능을 호출할 수 있도록 확장하는 방향성이다.

## 7. Agent V2 / 코어 분석

### 7.1 Agent V2는 명시적으로 더 나은 구조다

`src/core/agent-orchestrator.ts`는 인스턴스별 병렬 에이전트 세트를 구성한다.

- CollectorAgent
- DetectorAgent
- AnalyzerAgent
- ExecutorAgent
- VerifierAgent
- ScalingAgent
- SecurityAgent
- ReliabilityAgent
- RCADomainAgent
- CostAgent
- RemediationAgent
- NotifierAgent

이 구조의 장점은 분명하다.

- 역할이 명확히 분리된다.
- anomaly-detected 이후 AI 분석과 실행이 병렬화된다.
- 도메인별 전문 에이전트 개념이 코드에 드러난다.
- 운영 이벤트가 이벤트 버스를 통해 흐르므로 기존 직렬 루프보다 확장성이 좋다.

### 7.2 하지만 아직 완전한 기준선은 아니다

Agent V2는 더 좋은 구조이지만, 코드베이스 전체가 아직 그 기준선으로 정리되지는 않았다.

- 메인 `/` 대시보드는 여전히 기존 API와 store에 더 강하게 연결돼 있다.
- `CollectorAgent`는 기존 대시보드 호환을 위해 전역 `metrics-store`로 브리지를 수행한다.
- 브리지 과정에 `cpuUsage: 0` TODO가 남아 있다.
- 기존 `src/chains/**` 추상화와 신규 `src/core/protocol-registry.ts` 기반 계층이 함께 존재한다.

즉, V2는 "대체 완료된 시스템"이 아니라 "현재 시스템과 병존하는 차세대 구조"다.

### 7.3 이벤트 버스는 현재 단일 프로세스 범위에 묶여 있다

`src/core/agent-event-bus.ts`는 process-local `EventEmitter` singleton을 사용한다. 이 설계는 단일 프로세스 개발 환경에는 충분하지만, multi-worker나 수평 확장 환경에서는 이벤트 전파가 프로세스 경계를 넘지 못한다.

따라서 Agent V2를 진짜 운영 기준선으로 끌어올리려면, 결국 Redis streams, NATS, Kafka 같은 외부 이벤트 계층 또는 내구성 있는 대기열이 필요해진다.

## 8. 인스턴스 플랫폼, 온보딩, 플레이북 학습

### 8.1 V2 온보딩은 실체가 있다

`src/app/api/v2/onboarding/complete/route.ts`는 다음 단계를 수행한다.

1. 연결 검증
2. 인스턴스 생성 또는 재사용
3. 클라이언트 자동 감지
4. capability 정보 저장
5. bootstrap 실행

이 플로우는 단순 폼 제출이 아니라, 실제 노드 특성을 파악해 인스턴스를 등록하는 프로비저닝 루틴에 가깝다.

### 8.2 클라이언트 감지 로직은 깊이가 있다

`src/lib/client-detector.ts`는 `web3_clientVersion`, `eth_chainId`, `eth_syncing`, `net_peerCount`, `admin_peers`, `txpool_status`, beacon endpoints, `arb_blockNumber`, `optimism_syncStatus` 등 여러 RPC/관리 API를 조합해 execution client, consensus client, protocol 특성을 감지한다.

이는 "지갑 연결" 수준이 아니라 "노드 프로파일링" 수준의 온보딩이다.

### 8.3 플레이북 시스템은 자기개선형 운영을 지향한다

`src/core/playbook-system/*`과 `/api/v2/instances/[id]/pattern-miner/run`를 보면, 작업 원장을 분석해 incident pattern을 찾고, 그 패턴에서 playbook을 생성하거나 병합하도록 설계되어 있다.

이 방향은 매우 좋다. 다만 이 기능은 충분한 ledger volume이 쌓여야 가치가 커지므로, 현재 단계에서는 "잠재력이 큰 후행 기능"에 가깝다.

## 9. 체인/프로토콜 추상화 분석

SentinAI에는 두 종류의 추상화 계층이 공존한다.

- `src/chains/**`: 레거시 체인 플러그인 계층
- `src/core/protocol-registry.ts`, `src/protocols/**`: 신규 프로토콜 디스크립터 계층

장점은 분명하다.

- Optimism, ZK Stack, Arbitrum, generic zkL2, Thanos 등 여러 프로토콜 특성을 수용할 수 있다.
- topology, EOA role, K8s mapping, AI prompt, autonomous action, verification/rollback까지 플러그인으로 분리하려는 의도가 명확하다.

하지만 현재 시점의 비용도 있다.

- 개념 중복이 생긴다.
- 신규 기능이 어느 계층에 들어가야 하는지 판단 비용이 높다.
- 레거시와 신규 구조가 함께 존재하면서 온보딩 비용이 커진다.

즉, 확장성은 높지만 아키텍처 집중도는 아직 낮다.

## 10. 품질과 검증 상태

### 10.1 테스트 밀도는 강점이다

`npm run test:run` 실행 결과는 다음과 같았다.

- 테스트 파일: 1 failed, 123 passed, 1 skipped
- 테스트 케이스: 1420 passed, 1 skipped
- 수행 시간: 5.64s

즉, 저장소는 광범위한 테스트 스위트를 보유하고 있고, 대부분은 빠르게 통과한다. 이는 이 코드베이스의 실질적인 강점이다.

### 10.2 현재 깨지는 테스트 1건은 구조적 결합 신호다

실패한 스위트는 `src/app/api/health/route.test.ts`다.

에러는 다음 흐름에서 발생한다.

1. `health` route가 `isAgentV2Enabled`를 import한다.
2. 이 import가 `src/core/agent-orchestrator.ts`를 로드한다.
3. `agent-orchestrator.ts`는 `RCADomainAgent`를 import한다.
4. `RCADomainAgent`는 `src/lib/rca-engine.ts`를 import한다.
5. `rca-engine.ts`는 모듈 로드 시점에 `DEPENDENCY_GRAPH = getDependencyGraph()`를 즉시 평가한다.
6. 테스트의 mocked `getChainPlugin()`은 `dependencyGraph`를 제공하지 않아 `undefined.dependencyGraph` 예외가 발생한다.

즉, 문제는 `/api/health` 자체보다 "RCA 엔진이 체인 플러그인에 eager하게 결합되어 있는 모듈 초기화 부작용"에 가깝다. 이 현상은 테스트 실패일 뿐 아니라, 모듈 의존성이 과도하게 넓어졌다는 신호이기도 하다.

## 11. 종합 평가

### 11.1 강점

- 운영 자동화 범위가 넓다. 메트릭 수집, 이상 탐지, RCA, 스케일링, failover, rollback, approval, goal orchestration, MCP, playbook까지 이어진다.
- 핵심 로직이 `src/lib`와 `src/core`에 비교적 잘 분리되어 있다.
- 테스트 커버리지가 높고, 운영 로직 단위 테스트가 다수 존재한다.
- anomaly detection, verification, rollback, autonomy policy는 실제 운영 문제를 의식한 설계다.
- 다중 프로토콜 대응을 위한 플러그인/디스크립터 기반 확장 방향이 명확하다.

### 11.2 약점과 리스크

- `agent-loop`와 Agent V2가 병존하면서 시스템 기준선이 분산돼 있다.
- `/v2` 사용자 인터페이스는 제품 인상을 주지만 현재는 목업 기반이라 실제 기능과 기대가 어긋날 수 있다.
- 문서 검색은 목업이며, 문서 정보 구조도 정적 정의에 의존한다.
- 이벤트 버스가 process-local이라 Agent V2를 다중 프로세스 운영으로 확장하기 어렵다.
- 일부 autonomous state는 in-memory인데, 다른 경로는 Redis 기반이라 내구성 모델이 일관되지 않다.
- 체인/플러그인 추상화가 이중화되어 개념 복잡도가 높다.
- 테스트 실패 1건이 보여주듯, 특정 모듈은 import 시점 결합이 지나치게 강하다.

## 12. 추천 우선순위

### 12.1 가장 먼저 할 일

1. 기준 런타임을 명시하라.
   `agent-loop`를 유지할지, Agent V2를 기준선으로 전환할지 결정해야 한다. 지금은 둘 다 살아 있어 이해 비용이 높다.

2. `/v2`를 실데이터와 연결하거나, 명확히 실험용 표면으로 분리하라.
   현재 상태는 "새 제품처럼 보이지만 실제 운영 화면은 아님"이라는 혼선을 만든다.

3. RCA/chain plugin 초기화 결합을 느슨하게 하라.
   `DEPENDENCY_GRAPH` 같은 즉시 평가 상수는 지연 조회 방식으로 바꾸는 편이 안전하다.

### 12.2 결정된 후속 방향

1. EventBus는 Redis Streams 기반으로 설계한다.
   Agent V2를 진짜 운영 축으로 만들려면 process-local bus 한계를 넘겨야 한다. 단순 pub/sub가 아니라 stream + consumer group + ack/retry + `correlationId` 기반 중복 방지까지 포함한 전달 보장 계층으로 보는 편이 맞다.

2. docs search는 제거한다.
   현재 검색창은 기대를 만들지만 실제 검색 기능이 아니다. 당분간은 파일 시스템 기반 문서 뷰어, 정적 사이드바, 목차만 유지하고, 실제 인덱싱 검색을 만들기 전까지는 검색 UI를 노출하지 않는 편이 제품적으로 더 정직하다.

3. legacy chain plugin과 new protocol descriptor의 정리는 보류한다.
   이중 추상화가 복잡도를 만들고 있는 것은 맞지만, 지금 바로 수렴 작업에 들어가면 범위가 커진다. 우선 EventBus 전달 보장과 문서 표면 정리를 먼저 처리하고, 기준 런타임이 더 명확해진 뒤 체계적으로 정리하는 편이 안전하다.

## 13. 최종 판단

SentinAI는 "사용자 인터페이스 데모가 조금 있는 모니터링 앱"이 아니다. 현재 코드는 이미 관측, 판단, 조치, 검증, 학습까지 포함한 운영 자동화 플랫폼의 형태를 갖추고 있다. 다만 그 플랫폼이 하나의 일관된 제품 축으로 정리된 상태는 아니다.

정리하면 현재의 SentinAI는 다음 문장으로 요약할 수 있다.

> 백엔드 운영 자동화 엔진은 예상보다 성숙하고, 프론트엔드와 차세대 아키텍처는 아직 수렴 중인 상태다.

향후 제품 완성도를 좌우할 변수는 "새 기능 추가"보다 "현재 존재하는 두세 개의 축을 어떤 기준선으로 통합할 것인가"에 더 가깝다.
