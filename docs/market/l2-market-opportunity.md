# SentinAI 시장 기회 분석
## L2 체인 운영 자동화 TAM

> 작성일: 2026-02-23 | 데이터 기준: 2025년 하반기 ~ 2026년 2월

---

## 핵심 요약

| 항목 | 수치 |
|------|------|
| **현재 지원 (OP Stack)** | 활성 메인넷 ~40개 체인 |
| **지원 확장 시 (+ Orbit + ZK Stack + CDK)** | **121개+ 체인** |
| **전체 L2 TVL** | $47B (2025년 10월 기준) |
| **SentinAI 타깃 (DevOps 없는 체인)** | 약 80–90개 |
| **타깃 100% 전환 시 연 ARR** | **$287K (현재) → $860K (확장 후)** |

---

## 1. 현재 지원: OP Stack / Optimism Superchain

### 시장 규모

| 지표 | 수치 | 출처 |
|------|------|------|
| Superchain Registry 등록 체인 | **73개** | ethereum-optimism/superchain-registry |
| 활성 메인넷 체인 (추정) | **~40개** | Messari H2 2025 |
| Superchain 전체 TVL | **$16.3B** | Messari H2 2025 |
| 전체 L2 거래 수수료 점유율 | **69.9%** | Messari H2 2025 |
| 전체 crypto 트랜잭션 점유율 | **12.7%** | Messari H2 2025 |
| 2025년 하반기 트랜잭션 성장 | **+44% (36억 건)** | Messari H2 2025 |

### 주요 체인 TVL (L2Beat 기준)

| 체인 | TVL | SentinAI 타깃 여부 |
|------|-----|-------------------|
| Base | $10.5B | ❌ 자체 인프라팀 |
| OP Mainnet | $1.78B | ❌ 자체 인프라팀 |
| Ink | $485M | ✅ **소규모 팀** |
| Unichain | $359M | ✅ **소규모 팀** |
| Mode, Lisk, Soneium, Redstone... | $1M–100M | ✅ **핵심 타깃** |
| 나머지 ~30개 체인 | $1M 미만 | 🟡 중장기 |

> Base와 OP Mainnet은 Coinbase, OP Labs 소속으로 자체 인프라팀 보유.
> **SentinAI의 실제 타깃은 TVL $1M–$500M 구간의 약 28개 체인.**

### 현재 TAM 계산

```
타깃 체인: 28개
100% 전환: 28 × $299/월 = $8,372/월 = 연 $100,464
25% 전환:   7 × $299/월 = $2,093/월 = 연 $25,116
```

---

## 2. 단기 확장: Arbitrum Orbit

### 시장 규모

| 지표 | 수치 | 출처 |
|------|------|------|
| 활성 메인넷 Orbit 체인 | **47개** | CoinLaw Arbitrum Statistics 2025 |
| 테스트넷 체인 | 14개 | CoinLaw |
| 개발/계획 중 | 12개 | CoinLaw |
| 전체 Orbit TVL | **$16.63B** | CoinLaw |
| L2 트랜잭션 점유율 | **34%** | CoinLaw |
| 주간 활성 주소 | 140만+ | CoinLaw |

### 주요 Orbit 체인

| 체인 | 특징 | TVL 규모 |
|------|------|----------|
| Xai | 게임 전용 L3 | 소형 |
| Degen | 섹터 특화 | 소형 |
| Treasure | Web3 게임 퍼블리셔 | 중형 |
| Arbitrum One L3들 | DeFi 특화 | 다양 |

### 기술 고려사항

Arbitrum Orbit은 OP Stack과 **다른 구성 요소를 사용**합니다:

```
OP Stack:      op-geth, op-node, op-batcher, op-proposer
Arbitrum Orbit: nitro (execution), sequencer, batch-poster, validator, staker
```

SentinAI ChainPlugin 시스템이 이 추상화를 처리합니다:
```
src/chains/arbitrum/
  ├── components.ts   (nitro, sequencer, batch-poster, validator)
  ├── prompts.ts      (Arbitrum 특화 AI 프롬프트)
  ├── playbooks.ts    (Orbit 특화 복구 플레이북)
  └── index.ts        (ArbitrumPlugin implements ChainPlugin)
```

구현 난이도: **중간** (인터페이스 동일, K8s 컴포넌트 이름 및 헬스체크 엔드포인트 상이)

### Orbit 추가 시 TAM

```
타깃 Orbit 체인: 40개 (전담 DevOps 없는 체인 추정)
추가 TAM: 40 × $299/월 = $11,960/월 = 연 $143,520
```

---

## 3. 중기 확장: ZK Stack (zkSync Elastic Network)

### 시장 규모

| 지표 | 수치 | 출처 |
|------|------|------|
| ZK Stack 체인 수 | **18개** | AInvest 2025 |
| ZK 생태계 총 가치 | **$4B+** | AInvest 2025 |
| ZK Stack dApp 수 | **291개+** | BingX 2026 |
| zkSync Era 일일 트랜잭션 | 162,000+ | BingX 2026 |
| 전체 경제적 가치 | **$1.19B** | BingX 2026 |

> ZKsync Lite는 2026년 종료 예정. 전체 전략이 ZK Stack(Elastic Chain) 중심으로 재편됨.

### 기술 고려사항

ZK Stack은 ZK proof 기반으로 구성 요소가 OP Stack과 **근본적으로 다릅니다**:

```
ZK Stack:  zksync-server (monolithic), proof-gen, eth-tx-manager
OP Stack:  op-geth + op-node + op-batcher + op-proposer (분리 아키텍처)
```

구현 난이도: **높음** (proof 생성 시간, 배치 크기 모니터링 등 ZK 특화 지표 필요)
구현 예상: Q2 2026

### ZK Stack 추가 시 TAM

```
타깃 ZK Stack 체인: 15개
추가 TAM: 15 × $299/월 = $4,485/월 = 연 $53,820
```

---

## 4. 중기 확장: Polygon CDK

### 시장 규모

| 지표 | 수치 | 출처 |
|------|------|------|
| AggLayer 연결 체인 | **16개+** | CoinLaw Polygon Statistics 2025 |
| CDK 활용 dApp | **190개+** | CoinLaw |
| CDK 체인 TVL (2025 Q1) | $420M | CoinLaw |
| CDK 체인 TVL (2026 초) | **$1.2B** | CoinLaw |
| TVL 성장 (9개월) | **+185%** | 계산값 |

구현 난이도: **중간** (EVM 호환, Polygon zkEVM 특화 지표)

---

## 5. 전체 L2 생태계 (장기 비전)

| 지표 | 수치 | 출처 |
|------|------|------|
| 전체 L2 TVL (2025년 10월) | **$47B** | Cryptopolitan |
| 전망 L2 TVL (2026년 말) | **$50B+** | Cryptopolitan |
| L2 일일 트랜잭션 | **2,500만+** | L2Beat Activity |
| L2 일일 활성 주소 (2026 예상) | **600만+** | Cryptopolitan |

---

## 6. 지원 확장 시 TAM 통합

```
                     체인 수   타깃   $299 × 100%    연 ARR
─────────────────────────────────────────────────────────
현재: OP Stack          ~40      28    $8,372/월    $100K
+ Arbitrum Orbit        +47      40   $11,960/월    $144K
+ ZK Stack              +18      15    $4,485/월     $54K
+ Polygon CDK           +16      13    $3,887/월     $47K
─────────────────────────────────────────────────────────
합계                   121+      96   $28,704/월    $344K  ← 100% 전환
25% 전환 시             121+      24    $7,176/월     $86K  ← 현실적 목표
```

> **100% 전환은 비현실적.** 25% 전환 기준 **연 $86K ARR**이 Phase 1 목표.
> 체인 수가 매달 3–5개 증가 중 → TAM 자체가 계속 커지고 있음.

---

## 7. 왜 지금 진입해야 하는가

```
2023–2024   OP Stack 초기 성장. 체인 5–10개.
2025        Superchain 폭발. 40→73개. Orbit도 급증.
2026 →      표준화된 L2 운영 도구 수요 임계점 도달.
            ← SentinAI가 진입해야 할 타이밍
```

Datadog·Grafana는 L2를 모릅니다. AWS CloudWatch도 마찬가지입니다.
**L2 운영 자동화 도구의 사실상 표준(de facto standard)이 될 기회가 지금 열려 있습니다.**

---

## 8. 구현 우선순위 로드맵

| 단계 | 대상 | 시점 | 추가 TAM |
|------|------|------|----------|
| **Phase 1 (현재)** | OP Stack (Thanos, Optimism) | 완료 | $100K ARR |
| **Phase 2 (Q2 2026)** | Arbitrum Orbit | Q2 | +$144K ARR |
| **Phase 3 (Q3 2026)** | ZK Stack | Q3 | +$54K ARR |
| **Phase 4 (Q4 2026)** | Polygon CDK | Q4 | +$47K ARR |
| **Phase 5 (2027)** | 기타 EVM L2 | 2027 | TBD |

ChainPlugin 아키텍처 덕분에 각 Phase는 **4개 파일 추가**만으로 구현 가능합니다:
```
src/chains/<ecosystem>/
  ├── components.ts
  ├── prompts.ts
  ├── playbooks.ts
  └── index.ts
```

---

## 출처

| 데이터 | 출처 |
|--------|------|
| Superchain chain count | [ethereum-optimism/superchain-registry](https://github.com/ethereum-optimism/superchain-registry) |
| Superchain TVL, 트랜잭션 | [Messari: State of the Superchain H2 2025](https://messari.io/report/state-of-the-superchain-h2-2025) |
| L2Beat TVL | [l2beat.com/scaling/summary](https://l2beat.com/scaling/summary) |
| Arbitrum Orbit 체인 수 | [CoinLaw: Arbitrum Statistics 2025](https://coinlaw.io/arbitrum-statistics/) |
| ZK Stack 체인 수 | [AInvest: ZKsync Strategic Shift](https://www.ainvest.com/news/zksync-strategic-shift-legacy-rollup-future-ready-zk-stack-ecosystem-2512/) |
| Polygon CDK 체인 수 | [CoinLaw: Polygon Statistics 2025](https://coinlaw.io/polygon-statistics/) |
| 전체 L2 TVL | [Cryptopolitan: L2 Adoption 2026](https://www.cryptopolitan.com/layer-2-adoption-2026-predictions/) |
| L2 일일 트랜잭션 | [L2Beat Activity](https://l2beat.com/scaling/activity) |
| 2026 L2 전망 | [The Block: 2026 Layer 2 Outlook](https://www.theblock.co/post/383329/2026-layer-2-outlook) |
