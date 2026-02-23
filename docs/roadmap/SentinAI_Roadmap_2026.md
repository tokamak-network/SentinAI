# SentinAI
## 1-Year Strategic Roadmap
### AI-Native Autonomous L2 Guardian

- 기간: 2026년 3월 – 2027년 2월 (4분기)
- 조직: Tokamak Network
- 문서 버전: v1.2 | 2026.02.23

> "AI 에이전트 시대에 L2 인프라 모니터링을 단순 대시보드에서 자율 운영 플랫폼으로 전환한다."

## Executive Summary

SentinAI는 현재 Optimism 기반 L2 네트워크의 모니터링 및 자동 스케일링 대시보드로서 핵심 기능을 갖추고 있습니다. 하이브리드 스케일링(Rule + AI), 예측 스케일링, AI 로그 분석, 자율 에이전트 루프 등 견고한 기반이 마련된 상태입니다.

이 로드맵은 SentinAI를 "모니터링 도구"에서 "AI 에이전트 기반 자율 운영 플랫폼"으로 전환하기 위한 4단계 전략을 제시합니다. 각 분기는 이전 단계의 성과 위에 구축되며, 최종적으로 멀티체인 L2 생태계의 핵심 인프라로 포지셔닝합니다.

SentinAI의 본질은 하나입니다: **L2 체인을 지킨다.** 이 역할을 더 잘할수록, 더 많은 체인에 적용될수록, Tokamak Rollup Hub와 TON 생태계 전체가 함께 성장합니다.

## 전략 방향 개요

| 분기 | 테마 | 핵심 전환 | 산출물 |
|---|---|---|---|
| Q1 (3–5월) | Agentic Foundation | 대시보드 → 자율 에이전트 | MCP 서버, Guardian Agent, Rollup Hub 연동 |
| Q2 (6–8월) | Multi-Agent Ops | 단일 에이전트 → 협업 에이전트 | 전문 에이전트 분화, 멀티에이전트 오케스트레이션 |
| Q3 (9–11월) | Platform & Multi-Chain | 단일 체인 → 멀티체인 플랫폼 | Rollup Hub 네이티브 레이어, SaaS 전환 |
| Q4 (12–2월) | Ecosystem & Autonomy | 도구 → 생태계 인프라 | 에이전트 마켓플레이스, Level 5 자율 운영 |

## 시장 맥락: 왜 지금인가?

AI 에이전트 시장은 2025년 약 $7.4B 규모에 도달했으며, 2032년까지 $103.6B으로 성장할 전망입니다 (CAGR 45.3%). 85%의 기업이 이미 최소 하나의 워크플로에 AI 에이전트를 도입했으며, MCP는 OpenAI, Anthropic, Google DeepMind가 모두 채택한 사실상의 표준이 되었습니다.

블록체인 인프라 영역에서도 Ethereum의 2026년 로드맵은 L2 결산 시간 단축, 크로스-L2 상호운용성, 계정 추상화에 집중하고 있어 L2 운영 복잡도가 급증할 전망입니다. Tokamak Rollup Hub의 Mainnet 출시(2026 Q1)는 결정적인 타이밍입니다. appchain 배포가 늘어날수록 24/7 AI 운영 에이전트의 필요성도 함께 증가합니다.

SentinAI는 이미 AI 기반 로그 분석, 예측 스케일링, 하이브리드 의사결정 구조를 갖추고 있어 이 전환에 가장 유리한 위치에 있습니다.

## TON 토큰 기여 관점

SentinAI는 TON 스테이킹 도구가 아닙니다. 그러나 L2 Guardian으로서의 역할을 잘 수행할수록 TON 생태계에 자연스럽게 기여합니다.

| SentinAI가 잘하면 | 결과 |
|---|---|
| 체인 가동률 극대화 | TX throughput 유지 → TON 수수료 수요 증가 |
| Rollup Hub 운영 장벽 낮춤 | 더 많은 appchain 배포 → TON Chain Staking 수요 증가 |
| 자율 복구로 운영자 부담 감소 | 소규모 팀도 TON 기반 체인 운영 가능 → 생태계 확장 |
| 생태계 건강성 가시화 | 투자자 신뢰 형성 → TON 토큰 수요 증가 |

---

## Phase 1 | 2026년 3–5월
### Agentic Foundation – 구독 서비스 런칭 + 에이전트 기반 완성

> **2/23 업데이트:** Phase 1의 핵심 목표를 재정의합니다. 기술 완성과 함께 **구독 서비스 실제 판매**를 병행합니다. 30일(3/25)까지 인프라 완성, 60–90일까지 첫 유료 전환을 목표로 합니다. 고객 유입은 SLA 페이지 CTA + 블로그를 통한 자연 유입으로 진행합니다.

#### 1.0 구독 서비스 기반 구축

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| General/Premium 티어 Feature Gating | `checkFeatureGate(chainId, feature)` 미들웨어. Premium 전용 기능 코드 레벨 격리 | Critical |
| Chain SLA 공개 상태 페이지 | `/status` — 인증 없는 공개 대시보드 + "무료로 연결하기" CTA. 투자자·운영자 신뢰 지표 | Critical |
| Pricing 페이지 | `/pricing` — General/Premium/Enterprise 비교표. $299/체인/월 근거 문구, TON 할인 배너 | Critical |
| TON 결제 연동 | TON 주소 인보이스 생성 → 온체인 결제 확인 → Premium 자동 활성화. 월간 15% / 연간 25% 할인 | High |
| Aha Moment 자동 메시지 | 첫 자동 스케일링·Failover·주간 리포트 시 "절약된 시간·비용" 포함 알림 자동 발송 | High |
| 전환 트리거 시퀀스 | 체험 60/80/85/90일차 자동 알림. 90일 만료 시 Premium 기능 다운그레이드 | High |
| Thanos 레퍼런스 케이스 | 운영 기간·자동 대응 횟수·절약 시간 정량화. 블로그 포스트 발행 → SLA 페이지 CTA 통해 자연 유입 | High |

#### 1.1 MCP 서버 (기완성 → 고도화)

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| SentinAI MCP 서버 | L2 메트릭을 MCP 리소스로 노출 (**현재 구현 완료**) | Critical |
| K8s MCP 브리지 | EKS 클러스터 상태 MCP 도구 래핑 (**현재 구현 완료**) | Critical |
| MCP OAuth 2.1 인증 | 외부 운영자가 자신의 체인에만 안전하게 접근. chainId scope JWT | High |

#### 1.2 자율 운영 에이전트 v1 (기완성 → 보완)

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Guardian Agent | observe→detect→analyze→plan→act→verify 전체 루프 (**현재 구현 완료**) | Critical |
| 멀티플랫폼 양방향 승인 | Slack/Discord/Telegram 버튼 승인 워크플로. 한 채널 승인 시 나머지 "처리됨" 자동 업데이트 | High |
| 에이전트 메모리 Vector DB | Redis 기반 메모리를 Vector DB로 확장. 과거 인시던트 패턴 의미 기반 검색 | Medium |
| 에이전트 행동 로깅 | reasoning trace 기록, 감사 가능한 의사결정 대시보드 (**현재 구현 완료, 고도화**) | Medium |

#### 1.3 전문 에이전트 조기 개발 (Phase 2 일부 선행) ← 3/25 이후

> Phase 2의 전문 에이전트 중 **기존 인프라 위에 빠르게 올릴 수 있는 것**을 Phase 1 말미에 선행 개발합니다. Security Agent·A2A 프로토콜·Incident Commander는 Phase 2에서 진행합니다.

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Performance Agent | 블록 생산 지연, 배치 제출 실패, 시퀀서 드리프트 전담 분석. `anomaly-detector.ts` + `predictive-scaler.ts` 위에 전문화 레이어 추가 | High |
| Cost Optimizer Agent | L1 가스비 트렌드, 배치 타이밍 최적화. `cost-optimizer.ts` 에이전트화. 비용 절감 액션 자동 제안 | High |

#### 1.4 Rollup Hub 자동 연동

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Rollup Hub Webhook 연동 | Hub 신규 appchain 배포 이벤트 수신 → SentinAI 자동 초기화 | High |
| 체인 자동 프로비저닝 | RPC/로그/메트릭 엔드포인트 자동 발견, ChainPlugin 자동 생성 | High |
| 운영자 온보딩 플로우 | 체인 등록 → SentinAI 연동 → 기본 알림 설정까지 10분 내 완료 | Medium |

#### 1.5 모델 전략 재정립

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| LiteLLM Gateway 고도화 | 모델 라우팅을 비용/레이턴시/정확도 기반으로 자동 최적화 | Medium |
| 로컬 SLM 통합 | Qwen 3B/8B급 소형 모델 엣지 배포. 네트워크 지연 없는 즉시 이상 탐지 | Low |

#### Phase 1 KPI

| KPI | 현재 | 목표 |
|---|---|---|
| 체험 중인 외부 팀 수 | 0 | 3팀 이상 |
| 첫 유료 전환 | 0 | 60–90일 내 1팀 ($299) |
| General/Premium 기능 게이트 | 없음 | 구현 완료 |
| TON 결제 연동 | 없음 | 기본 작동 |
| 보호 중인 L2 체인 수 | 1 (Thanos) | Hub 신규 체인 자동 연동 |
| 활성 전문 에이전트 수 | 0 | 2 (Performance + Cost) |
| 에이전트 자율 처리율 | ~40% | 60% |

---

## Phase 2 | 2026년 6–8월
### Multi-Agent Ops – 협업 에이전트 시스템

> **2/23 업데이트:** Performance Agent·Cost Optimizer Agent는 Phase 1 말미에 조기 개발합니다. Phase 2는 **A2A 프로토콜 기반의 진정한 멀티에이전트 협업**과 **보안 전문 에이전트**에 집중합니다.

#### 2.1 전문 에이전트 분화

| 작업 항목 | 상세 내용 | 우선순위 | 비고 |
|---|---|---|---|
| Security Agent | P2P GossipSub 공격, 비인가 피어링, 비정상 트랜잭션 패턴 전담 모니터링. MITRE ATT&CK 블록체인 매핑 | Critical | Phase 2 신규 |
| Incident Commander Agent | 전문 에이전트들의 보고를 종합, 인시던트 우선순위 결정 및 대응 오케스트레이션 | High | A2A 완성 후 |
| Performance Agent | 블록 생산 지연, 배치 제출 실패, 시퀀서 드리프트 전담. 예측 모델 고도화 | High | **Phase 1 선행 개발** |
| Cost Optimizer Agent | L1 가스비 트렌드, 배치 타이밍 최적화, 인프라 비용 자동 조정 | High | **Phase 1 선행 개발** |

#### 2.2 에이전트 간 통신 및 오케스트레이션

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Agent-to-Agent 프로토콜 | 이벤트 버스 기반 에이전트 간 메시지 교환 (Google A2A 참조). Phase 1 에이전트 2개 검증 후 설계 | Critical |
| 컨센서스 메커니즘 | 중요 결정(스케일 업, 알림 발송)에 대해 복수 에이전트 합의. 의견 충돌 시 에스컬레이션 | High |
| Human-in-the-Loop 고도화 | 위험도별 자동 승인 임계값 설정. Phase 1의 멀티플랫폼 승인 위에 정책 레이어 추가 | Medium |

#### 2.3 Observability 강화

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| OpenTelemetry 통합 | 에이전트 행동 트레이싱. LLM 호출, 도구 사용, 의사결정 추적 | High |
| 에이전트 성능 대시보드 | 각 에이전트의 정확도, 응답시간, 비용 실시간 모니터링 | Medium |

#### Phase 2 KPI

| KPI | 현재 | 목표 |
|---|---|---|
| 활성 에이전트 수 | 2 (Guardian + Phase 1 선행) | 4+ (Security + Commander 추가) |
| 유료 전환 체인 수 | Phase 1 목표 1팀 | 3팀 이상 |
| 에이전트 자율 처리율 | 60% | 75% (프로덕션 자동 실행) |
| 인시던트 MTTR | 기준선 측정 | 50% 단축 |
| 잘못된 스케일링 비율 | 기준선 | < 5% (합의 메커니즘) |

---

## Phase 3 | 2026년 9–11월
### Platform & Multi-Chain – Rollup Hub 네이티브 레이어

SentinAI를 단일 네트워크 도구에서 Rollup Hub 전체 생태계를 지원하는 플랫폼으로 확장합니다. 외부 운영자도 SentinAI를 자신의 체인에 셀프서비스로 적용할 수 있게 됩니다.

#### 3.1 Rollup Hub 전면 통합

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Hub 대시보드 임베드 | rolluphub.tokamak.network에 SentinAI 건강 지표 직접 임베드. 체인 카드마다 AI 상태 표시 | Critical |
| Chain Deployment Health Gate | 신규 appchain 배포 전 SentinAI 헬스 게이트 통과 권장. 안정성 기준 표준화 | High |
| Cross-Chain Health Aggregator | 전체 Rollup Hub 체인 건강성 집계 공개 API. "Rollup Hub 생태계 건강 지수"로 활용 | High |

#### 3.2 멀티체인 아키텍처

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| NetworkScope 기반 멀티테넌트 | 체인/팀별 격리된 상태 저장, 에이전트 구성, 알림 설정. RBAC 기반 접근 제어 | Critical |
| 크로스체인 모니터링 | 복수 L2 간 브리지 상태, 결산 지연, 공유 시퀀서 이슈를 통합 뷰로 제공 | High |
| Superchain 통합 | Optimism Superchain 이벤트 구독. ProtocolVersions 업그레이드, SuperchainConfig 변경 자동 감지 | High |

#### 3.3 SaaS 플랫폼화

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| 셀프서비스 온보딩 | RPC URL + API 키만으로 L2 네트워크 등록. 자동으로 MCP 서버 프로비저닝 및 에이전트 배포 | High |
| 커스텀 에이전트 룰 빌더 | 비개발자도 자연어로 모니터링 룰과 에이전트 행동을 정의할 수 있는 UI | Medium |
| Tokamak DAO 연동 | SentinAI 생성 체인 상태 보고서를 DAO 의사결정 참고 데이터로 제공 | Medium |

#### Phase 3 KPI

| KPI | 현재 | 목표 |
|---|---|---|
| 보호 중인 L2 네트워크 수 | 1 (Thanos) | 5+ OP Stack 체인 |
| 외부 팀 온보딩 | 0 (내부 전용) | 3+ 외부 appchain 운영팀 |
| 체인 등록 → 모니터링 시작 | 수동 (수시간) | < 10분 (셀프서비스) |
| 크로스체인 이슈 탐지 | 불가 | 브리지/결산 이상 자동 감지 |

---

## Phase 4 | 2026년 12월 – 2027년 2월
### Ecosystem & Autonomy – 자율 인프라 레이어

SentinAI를 L2 생태계의 필수 인프라 레이어로 확립합니다. 에이전트 마켓플레이스, 완전 자율 운영 모드, 커뮤니티 기반 확장 생태계를 구축합니다.

#### 4.1 에이전트 마켓플레이스

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| 에이전트 플러그인 SDK | 서드파티가 커스텀 에이전트(MEV 탐지, 거버넌스 감시 등)를 개발하고 배포할 수 있는 SDK + 레지스트리 | Critical |
| MCP 서버 마켓플레이스 | 다양한 데이터 소스(Dune, Etherscan, DeFiLlama 등)를 MCP 서버로 연결하는 커넥터 생태계 | High |
| 에이전트 평가/인증 | 보안 감사, 성능 벤치마크를 통과한 에이전트만 프로덕션 등급으로 인증. Trust Score 시스템 | High |

#### 4.2 완전 자율 운영 모드

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| Level 5 자율성 | 인시던트 탐지 → 분석 → 결정 → 실행 → 검증 → 보고의 전체 루프를 인간 개입 없이 수행. 단, 임계값 이상 시 에스컬레이션 | Critical |
| 자가 치유(Self-Healing) | 알려진 문제 패턴에 대해 자동 복구 Playbook 실행. op-geth 재시작, 배처 재제출, 피어 재연결 등 | High |
| 예방적 유지보수 | 디스크 사용량, 메모리 릭, 인증서 만료 등을 사전 예측하고 선제 조치 | Medium |

#### 4.3 커뮤니티 및 오픈소스 전략

| 작업 항목 | 상세 내용 | 우선순위 |
|---|---|---|
| 오픈 코어 모델 | 코어 모니터링 + MCP 서버 오픈소스. 고급 에이전트 기능 + SaaS는 상용 라이선스 | High |
| 기술 문서 + 튜토리얼 | 커스텀 에이전트 개발, MCP 서버 구축, 멀티체인 설정 가이드. Developer Relations 강화 | High |
| 거버넌스 통합 | Tokamak Network 거버넌스와 연계. 에이전트 정책 변경에 대한 온체인 투표 | Medium |

#### Phase 4 KPI

| KPI | 현재 | 목표 |
|---|---|---|
| 마켓플레이스 에이전트 수 | 0 | 10+ (커뮤니티 포함) |
| 자율 운영 비율 | ~60% | 95% (Level 5) |
| 자가 치유 성공률 | 부분 구현 | > 80% (알려진 문제) |
| GitHub 커뮤니티 | 0 star, 0 fork | 100+ star, 10+ 기여자 |

---

## 리스크 및 대응 전략

| 리스크 | 영향 | 대응 전략 |
|---|---|---|
| Rollup Hub 채택 지연 | Hub 체인 수 적으면 멀티체인 확장 효과 제한 | Thanos 레퍼런스 케이스 적극 홍보. 파트너 appchain 직접 지원 |
| AI 모델 비용 변동 | Qwen/Claude API 비용 예측 불가. 과도한 에이전트 호출 시 비용 폭증 | 로컬 SLM 우선 사용 + LiteLLM 비용 캡 설정. 모델 벤치마크 자동화로 최적 모델 지속 선택 |
| MCP 표준 변경 | MCP V2 → V3 전환 시 서버 재작성 필요 가능 | MCP 어댑터 추상화 레이어로 프로토콜 변경 격리. Anthropic MCP 로드맵 밀착 추적 |
| 에이전트 오작동 | 잘못된 스케일링, 불필요한 재시작 등 프로덕션 장애 유발 | 멀티에이전트 합의 + 시뮬레이션 우선 실행 + 쿨다운 강화. 롤백 자동화 |
| 보안 취약점 | AI 에이전트가 인프라 제어 권한을 가짐으로써 새로운 공격 벡터 생성 | 최소 권한 원칙 + MCP 서버 OAuth 2.1 인증 + 행동 감사 로그 + 이상 행동 차단 |
| 인력/리소스 부족 | 4분기 계획 대비 개발 속도 미달 | Phase별 MVP 우선 접근. 핵심 기능 먼저 출시 후 반복 개선. Claude Code 활용 극대화 |
| OP Stack 업스트림 변경 | Optimism monorepo 업데이트로 모니터링 로직 변경 필요 | OP Stack 릴리스 자동 추적 에이전트 + 추상화 레이어로 변경 영향 최소화 |

---

## 핵심 기술 의존성

| 기술 | 현재 상태 | 로드맵 영향 |
|---|---|---|
| MCP (Anthropic) | V2 스펙 (2025.11), 비동기 태스크 + OAuth 2.1. 28개 도구 구현 완료 | Phase 1 핵심. OAuth 2.1로 외부 운영자 접근 확장 |
| Tokamak Rollup Hub API | Mainnet Q1 2026 예정 | Phase 1 Webhook 연동의 전제 조건 |
| LiteLLM AI Gateway | 프로덕션 운영 중, 12+ LLM 지원 | 멀티모델 전략의 라우팅 레이어 |
| Qwen3 모델 패밀리 | 80B 프로덕션 사용 중 | 비용 효율 분석 + 실시간 처리 주력 |
| OP Stack / Superchain | Glamsterdam 업그레이드 (2026 H1) | Phase 3 멀티체인 지원의 기반 |
| OpenTelemetry | 산업 표준 Observability | Phase 2 에이전트 트레이싱에 활용 |
| Ethereum L2 로드맵 | 크로스-L2 상호운용성, 빠른 결산 | Phase 3–4 크로스체인 모니터링 수요 증대 |

---

## 결론

SentinAI는 L2 모니터링 도구로서 이미 견고한 기술적 기반을 보유하고 있습니다. 이 로드맵은 그 기반 위에 AI 에이전트 시대의 핵심 트렌드인 MCP, 멀티에이전트 협업, 자율 운영을 순차적으로 적용하여, 1년 내에 L2 인프라 운영의 패러다임을 바꾸는 것을 목표로 합니다.

이 과정에서 SentinAI는 Tokamak Rollup Hub의 자연스러운 운영 레이어로 자리잡습니다. 더 많은 appchain을 지킬수록 Rollup Hub 생태계는 더 건강해지고, 더 많은 운영자가 참여하며, TON 토큰 생태계도 함께 성장합니다. TON에 대한 기여는 Guardian으로서의 역할을 잘 수행한 결과이지, 별도로 추가된 기능이 아닙니다.

가장 중요한 원칙은 "안전한 점진적 자율성(Safe Incremental Autonomy)"입니다. 시뮬레이션 모드에서 시작하여 검증된 범위 내에서만 자율성을 확대하고, 모든 단계에서 인간이 개입할 수 있는 메커니즘을 유지합니다. 이는 SentinAI의 현재 설계 철학(시뮬레이션 모드 기본값, 쿨다운, 시드 테스팅)과 완벽히 일치합니다.
