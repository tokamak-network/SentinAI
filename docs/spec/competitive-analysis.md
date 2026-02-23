# SentinAI vs Datadog vs Grafana

> 작성일: 2026-02-23 | 대상: 가격 페이지·투자자 자료·영업 자료

---

## 핵심 포지셔닝

| | **SentinAI** | **Datadog** | **Grafana** |
|--|:--:|:--:|:--:|
| **주요 대상** | L2 체인 운영자 | 일반 서버 운영자 | 전체 엔지니어링 팀 |
| **핵심 가치** | 자율 운영 | 통합 관측성 | 오픈소스 시각화 |
| **요금 (월)** | **무료** (General) / **$299/체인** (Premium) | ~$15–23/host | 무료 (셀프 호스팅) / $8/user (Cloud) |
| **L2 체인 네이티브** | ✅ 전용 설계 | ❌ 커스텀 설정 필요 | ❌ 커스텀 설정 필요 |

---

## 기능 상세 비교

### 모니터링

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| 실시간 L2 블록 높이·간격 | ✅ 네이티브 | ⚠️ 커스텀 메트릭 | ⚠️ 커스텀 데이터소스 |
| L1 블록 모니터링 | ✅ | ⚠️ | ⚠️ |
| TxPool 모니터링 | ✅ | ⚠️ | ⚠️ |
| EOA 잔액 모니터링 | ✅ | ❌ | ❌ |
| Dispute Game / Fault Proof | ✅ | ❌ | ❌ |
| 다중 컴포넌트 상관관계 | ✅ (op-geth·op-node·batcher·proposer) | ⚠️ 수동 구성 | ⚠️ 수동 구성 |

### 이상 탐지

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| 통계 기반 이상 탐지 (Z-Score) | ✅ | ✅ Watchdog | ⚠️ ML 플러그인 (유료) |
| AI 의미 분석 (Layer 2) | ✅ Premium | ✅ Watchdog | ❌ |
| 블록체인 특화 탐지 규칙 | ✅ (L2 컨센서스·라이브니스) | ❌ | ❌ |
| 실시간 로그 AI 분석 | ✅ Premium | ✅ (Log Management 별도) | ❌ |

### 자동화 (핵심 차별화)

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| 자동 스케일링 (규칙 기반) | ✅ | ❌ 알림만 | ❌ |
| AI 예측 스케일링 | ✅ Premium | ❌ | ❌ |
| Emergency 8 vCPU 자동 확장 | ✅ Premium | ❌ | ❌ |
| Auto-Remediation Playbook | ✅ Premium | ⚠️ Workflow (제한적) | ❌ |
| 실행 결과 검증 + 자동 Rollback | ✅ Premium | ❌ | ❌ |
| L1 RPC 자동 Failover | ✅ Premium | ❌ | ❌ |
| EOA 자동 충전 | ✅ Premium | ❌ | ❌ |

### AI 에이전트

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| 자율 에이전트 루프 (30초 주기) | ✅ | ❌ | ❌ |
| AI RCA 엔진 (의존성 추적) | ✅ Premium | ⚠️ Error Tracking (기본) | ❌ |
| NLOps 채팅 (자연어 운영) | ✅ | ❌ | ❌ |
| Goal Manager (목표 기반 자율 실행) | ✅ Premium | ❌ | ❌ |
| AI 일간 운영 리포트 | ✅ Premium | ⚠️ 대시보드 수동 | ❌ |
| MCP 서버 (Claude Code 연동) | ✅ Premium | ❌ | ❌ |
| Agent Memory (영구 학습) | ✅ Premium | ❌ | ❌ |

### 인프라 & 설치

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| 설치 방식 | Docker 단일 컨테이너 | Agent 전 서버 설치 | 서버 설치 or Cloud |
| L2 체인 플러그인 시스템 | ✅ (Thanos·Optimism·ZK Stack) | ❌ | ❌ |
| K8s 네이티브 스케일링 | ✅ (EKS·kubectl) | ⚠️ 외부 연동 필요 | ❌ |
| Redis 상태 영구 저장 | ✅ (선택적) | 자체 저장소 | 자체 저장소 |
| 공개 SLA 상태 페이지 | ✅ (/status) | ⚠️ 별도 구성 필요 | ⚠️ 별도 구성 필요 |

### 알림 & 승인

| 기능 | SentinAI | Datadog | Grafana |
|------|:--------:|:-------:|:-------:|
| Slack 알림 | ✅ | ✅ | ✅ |
| Discord 알림 | ✅ (예정) | ✅ | ✅ |
| Telegram 알림 | ✅ (예정) | ⚠️ 써드파티 | ⚠️ 써드파티 |
| 양방향 승인 (버튼 클릭) | ✅ (예정) | ⚠️ 제한적 | ❌ |
| 승인 타임아웃·자동 취소 | ✅ (예정) | ❌ | ❌ |

---

## 가격 비교

| | SentinAI General | SentinAI Premium | Datadog Pro | Grafana Cloud Pro |
|--|:--:|:--:|:--:|:--:|
| **기본료** | **무료** | **$299/체인/월** | $23/host/월 | $8/user/월 |
| **L2 체인 기준 총비용** | 무료 | $299 | $100–500+ (커스텀 구성) | $50–200+ (커스텀 구성) |
| **AI 기능 포함** | ❌ | ✅ | ✅ Watchdog 포함 | ❌ (별도 플러그인) |
| **자동화 기능 포함** | ❌ | ✅ | ❌ | ❌ |
| **L2 네이티브** | ✅ | ✅ | ❌ | ❌ |

> **$299 근거:** 시니어 DevOps 월급 $8,000 ÷ 27일 ≈ 하루 $296.
> 체인 1개를 수동 운영하는 **하루 비용**이 SentinAI **한 달** 보호 비용과 같습니다.

---

## 시나리오별 비교

| 상황 | SentinAI Premium | Datadog | Grafana |
|------|:----------------:|:-------:|:-------:|
| 새벽 3시 TxPool 급증 | AI 원인 분석 → 자동 스케일링 → Slack 보고 | 알림 수신 → 담당자 수동 대응 | 알림 수신 → 담당자 수동 대응 |
| L1 RPC 429 에러 | 감지 즉시 자동 페일오버, L2 중단 없음 | 알림만, 수동 endpoint 교체 | 알림만, 수동 설정 변경 |
| Batcher EOA 잔액 부족 | 임계치 전 자동 충전 | 모니터링 불가 | 모니터링 불가 |
| 원인 불명 성능 저하 | RCA 엔진이 의존성 경로 자동 추적 | 로그·APM 수동 분석 | 대시보드 수동 확인 |
| 새벽 장애 | 즉시 감지 + 자동 복구 + 아침 리포트 | 다음날 아침 알림 확인 | 다음날 아침 대시보드 확인 |

---

## 결론: 왜 SentinAI인가?

Datadog·Grafana는 **"무슨 일이 일어났는가"를 알려주는** 도구입니다.
SentinAI는 **"알아서 해결하는"** 도구입니다.

```
Datadog/Grafana: 감지 → 알림 → 사람이 판단 → 사람이 실행
SentinAI:        감지 → AI 분석 → 자동 실행 → 결과 보고
```

L2 체인 운영자에게 Datadog·Grafana는 **필요조건**이지만 **충분조건이 아닙니다**.
SentinAI는 그 위에서 **자율 운영 레이어**로 동작합니다.

> 도입 패턴: 기존 Datadog/Grafana 스택 유지 + SentinAI 추가 → 새벽 온콜 제거
