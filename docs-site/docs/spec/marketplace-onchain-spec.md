# SentinAI Agent Marketplace: On-Chain Specification

> Date: 2026-03-05
> Status: Design — pending implementation
> Prerequisite: [Agent-for-Hire Revenue Model](../plans/2026-03-03-agent-for-hire-revenue-model.md)

---

## 1. Overview

SentinAI Agent-for-Hire 모델을 Ethereum L1에 앵커링하여 신뢰할 수 없는 환경에서도 검증 가능한
에이전트 마켓플레이스를 구축한다.

- **배포 체인**: Ethereum L1 (Sepolia → Mainnet)
- **결제 토큰**: USDC (Phase 1) + SNTAI 토큰 (Phase 2, 거버넌스/스테이킹)
- **참여자**: Trainer (에이전트 육성자), Buyer (L2 운영자), Verifier (검증자)

---

## 2. Smart Contract Architecture

### 2.1 Contract Overview

```
Ethereum L1
┌──────────────────────────────────────────────────────┐
│                                                      │
│  AgentRegistry         ServiceEscrow                 │
│  (증명 레이어)          (결제 레이어)                  │
│  - Resume 해시          - USDC 에스크로               │
│  - Operations Merkle    - 월정산 (70/30)              │
│  - Tier 승급 이력       - Outcome 보너스               │
│  - Pattern 등록         - 분쟁 동결                    │
│                                                      │
│  MarketplaceRouter                                   │
│  (조정 레이어)                                        │
│  - Agent 리스팅          - 고용 플로우                 │
│  - 분쟁 해결             - Verifier 배정              │
└──────────────────────────────────────────────────────┘
```

### 2.2 AgentRegistry — Attestation Contract

**목적**: Resume + Operations를 L1에 앵커링하여 검증 가능한 경력 증명

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentRegistry {

    struct AgentAttestation {
        address trainer;           // trainer wallet
        bytes32 instanceId;        // keccak256(instanceId)
        bytes32 protocolId;        // keccak256("opstack"), keccak256("arbitrum-orbit")
        uint8 tier;                // 0=trainee, 1=junior, 2=senior, 3=expert
        uint32 totalOps;           // total operations completed
        uint16 successRateBps;     // success rate in basis points (9500 = 95.00%)
        uint32 operatingDays;      // days since first operation
        bytes32 resumeHash;        // keccak256(JSON.stringify(fullResume))
        bytes32 operationsMerkle;  // merkle root of ExperienceEntry[]
        bytes32 patternsMerkle;    // merkle root of OperationalPattern[]
        uint64 attestedAt;         // block.timestamp
        uint64 lastVerifiedAt;     // last independent verification
        address lastVerifier;      // who last verified
    }

    struct TierPromotion {
        bytes32 instanceId;
        uint8 fromTier;
        uint8 toTier;
        uint32 totalOpsAtPromotion;
        uint32 operatingDaysAtPromotion;
        bytes32 resumeHashAtPromotion;
        uint64 promotedAt;
    }

    // === State ===

    mapping(bytes32 => AgentAttestation) public attestations;
    mapping(bytes32 => TierPromotion[]) public promotionHistory;
    mapping(bytes32 => bool) public registeredPatterns;
    mapping(address => bool) public authorizedVerifiers;

    address public owner;
    uint256 public attestationFee;
    uint256 public verificationFee;

    // === Events ===

    event AgentAttested(
        bytes32 indexed instanceId,
        address indexed trainer,
        uint8 tier,
        uint32 totalOps,
        bytes32 resumeHash,
        bytes32 operationsMerkle
    );

    event TierPromoted(
        bytes32 indexed instanceId,
        uint8 fromTier,
        uint8 toTier,
        uint32 operatingDays,
        uint64 promotedAt
    );

    event AgentVerified(
        bytes32 indexed instanceId,
        address indexed verifier,
        bool passed,
        bytes32 resumeHash
    );

    event PatternRegistered(
        bytes32 indexed patternId,
        bytes32 indexed instanceId,
        bytes32 protocolId,
        uint8 confidence
    );

    // === Functions ===

    /// Trainer attests agent resume + operations merkle root (monthly)
    function attestAgent(
        bytes32 instanceId,
        bytes32 protocolId,
        uint8 tier,
        uint32 totalOps,
        uint16 successRateBps,
        uint32 operatingDays,
        bytes32 resumeHash,
        bytes32 operationsMerkle,
        uint8 patternCount,
        bytes32 patternsMerkle
    ) external payable;

    /// Verifier confirms attestation accuracy
    function verifyAgent(
        bytes32 instanceId,
        bool passed,
        bytes32 resumeHash
    ) external;

    /// Register a high-confidence pattern for cross-chain discovery
    function registerPattern(
        bytes32 patternId,
        bytes32 instanceId,
        bytes32 protocolId,
        uint8 confidence
    ) external;

    // === Views ===

    function getAttestation(bytes32 instanceId)
        external view returns (AgentAttestation memory);

    function getPromotionHistory(bytes32 instanceId)
        external view returns (TierPromotion[] memory);

    function isPatternRegistered(bytes32 patternId)
        external view returns (bool);
}
```

**Gas Costs** (at 30 gwei):

| Operation | Gas | Cost (ETH=$2000) |
|-----------|-----|-------------------|
| attestAgent (new) | ~120,000 | $7.20 |
| attestAgent (update) | ~45,000 | $2.70 |
| verifyAgent | ~55,000 | $3.30 |
| registerPattern | ~50,000 | $3.00 |

**Batching Strategy**: Monthly attestation — thousands of operations compress to 1 merkle root.

### 2.3 ServiceEscrow — Payment Contract

**목적**: Buyer ↔ Trainer 간 USDC 결제를 에스크로로 보호

```solidity
contract ServiceEscrow {

    struct Subscription {
        bytes32 instanceId;        // which agent
        address buyer;             // L2 operator
        address trainer;           // agent trainer
        uint256 monthlyRate;       // in USDC (6 decimals)
        uint256 escrowBalance;     // buyer's deposited funds
        uint256 trainerClaimable;  // accumulated trainer earnings
        uint256 platformClaimable; // accumulated platform earnings
        uint64 startedAt;
        uint64 lastSettledAt;
        uint64 expiresAt;          // when escrow runs out
        bool active;
    }

    struct BonusClaim {
        bytes32 instanceId;
        bytes32 operationsMerkle;  // proof of operations
        uint256 amount;
        uint64 claimedAt;
        bool disputed;
    }

    // === Constants ===

    uint16 public constant TRAINER_SHARE_BPS = 7000;   // 70%
    uint16 public constant PLATFORM_SHARE_BPS = 3000;  // 30%
    uint256 public constant DISPUTE_WINDOW = 7 days;
    uint256 public constant MAX_MONTHLY_BONUS_CLAIMS = 10;

    // === State ===

    IERC20 public paymentToken;  // USDC
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(bytes32 => BonusClaim[]) public bonusClaims;
    address public platform;

    // === Events ===

    event SubscriptionCreated(
        bytes32 indexed instanceId,
        address indexed buyer,
        address indexed trainer,
        uint256 monthlyRate,
        uint256 escrowDeposited
    );

    event MonthlySettled(
        bytes32 indexed instanceId,
        uint256 trainerAmount,
        uint256 platformAmount,
        uint64 settledAt
    );

    event BonusClaimed(
        bytes32 indexed instanceId,
        uint256 amount,
        bytes32 operationsMerkle
    );

    event EscrowRefunded(
        bytes32 indexed instanceId,
        address indexed buyer,
        uint256 amount
    );

    // === Functions ===

    /// Buyer deposits USDC to hire an agent
    function createSubscription(
        bytes32 instanceId,
        address trainer,
        uint256 monthlyRate,
        uint256 depositMonths
    ) external;

    /// Monthly settlement — permissionless, callable by anyone
    function settleMonth(bytes32 instanceId) external;

    /// Trainer claims outcome bonus with merkle proof
    function claimBonus(
        bytes32 instanceId,
        uint256 amount,
        bytes32 operationsMerkle,
        bytes32[] calldata proof
    ) external;

    /// Buyer tops up escrow
    function topUpEscrow(bytes32 instanceId, uint256 amount) external;

    /// Buyer cancels — refund remaining escrow after notice period
    function cancelSubscription(bytes32 instanceId) external;

    /// Trainer withdraws claimable earnings
    function trainerWithdraw(bytes32 instanceId) external;

    /// Platform withdraws fees
    function platformWithdraw(bytes32 instanceId) external;
}
```

**Gas Costs** (at 30 gwei):

| Operation | Gas | Cost (ETH=$2000) |
|-----------|-----|-------------------|
| createSubscription | ~150,000 | $9.00 |
| settleMonth | ~65,000 | $3.90 |
| claimBonus | ~80,000 | $4.80 |
| cancelSubscription | ~55,000 | $3.30 |

### 2.4 MarketplaceRouter — Coordination Contract

**목적**: Agent 리스팅, 고용, 분쟁 처리

```solidity
contract MarketplaceRouter {
    AgentRegistry public registry;
    ServiceEscrow public escrow;

    struct Listing {
        bytes32 instanceId;
        address trainer;
        bytes32 protocolId;
        uint256 monthlyRate;
        bool available;
        uint64 listedAt;
    }

    struct Dispute {
        bytes32 instanceId;
        address initiator;
        string reason;
        uint64 initiatedAt;
        uint64 resolvedAt;
        bool resolved;
        bool inFavorOfBuyer;
    }

    // === State ===

    mapping(bytes32 => Listing) public listings;
    mapping(bytes32 => Dispute[]) public disputes;

    // === Events ===

    event AgentListed(bytes32 indexed instanceId, address indexed trainer, uint256 monthlyRate);
    event AgentHired(bytes32 indexed instanceId, address indexed buyer);
    event DisputeOpened(bytes32 indexed instanceId, address indexed initiator);
    event DisputeResolved(bytes32 indexed instanceId, bool inFavorOfBuyer);

    // === Functions ===

    /// List an attested agent for hire
    function listAgent(bytes32 instanceId, uint256 monthlyRate) external;

    /// Buyer hires a listed agent (creates subscription + initiates deployment)
    function hireAgent(bytes32 instanceId, uint256 depositMonths) external;

    /// Open a dispute (buyer only, within dispute window)
    function openDispute(bytes32 instanceId, string calldata reason) external;

    /// Resolve dispute (Phase 1: owner only; Phase 3: DAO vote)
    function resolveDispute(
        bytes32 instanceId,
        uint256 disputeIndex,
        bool inFavorOfBuyer
    ) external;

    // === Views ===

    /// Compute agent score: tier * 1000 + successRateBps + operatingDays + verifications
    function getAgentScore(bytes32 instanceId) external view returns (uint256);
}
```

---

## 3. Participant Economy

### 3.1 Three Roles

```
TRAINER (에이전트 육성자)         BUYER (L2 운영자)              VERIFIER (검증자)
─────────────────────           ─────────────────             ──────────────────
수익:                            지출:                          수익:
  70% 월 구독료                    월 구독료 (USDC)               검증 수수료 ($5-20)
  70% 성과 보너스                  성과 보너스 (좋은 결과만)       (Phase 2: SNTAI yield)
  패턴 라이선스 (Phase 2+)

비용:                            혜택:                          비용:
  훈련 인프라 (~$50/mo)            24/7 자율 모니터링             L2 RPC 검증 (~$10/mo)
  Attestation 가스 (~$3/mo)       검증된 에이전트 이력            Verify 가스 (~$3.30/건)
                                 분쟁 보호                      (Phase 2: SNTAI 본드)
```

### 3.2 Revenue Simulation

**Trainer** (Senior Agent, 3 Buyers):
```
Revenue = ($499 × 70% + $300 bonus × 70%) × 3 = $1,678/mo
Costs   = $50 infra + $10 gas = $60/mo
Net     = $1,618/mo per agent

Scale: 5 expert agents × 3 buyers each = $7,500/mo
```

**Buyer** (Senior Agent):
```
Cost      = $499 subscription + ~$300 bonuses = $799/mo
Benchmark = DevOps engineer $8,000-15,000/mo
ROI       = ~10-18x
```

**Verifier** (50 verifications/month):
```
Revenue = 50 × $10 = $500
Costs   = $10 infra + 50 × $3.30 gas = $175
Net     = $325/mo
```

### 3.3 Incentive Alignment

| Behavior | Incentive | Penalty |
|----------|-----------|---------|
| Trainer: train good agents | Higher tier = higher price, more buyers | Low success rate → disputes → delisting |
| Trainer: operate long-term | Expert tier ($799) + pattern reuse | Tier is monotonic (can't skip/go back) |
| Buyer: fair usage | Escrow protection, dispute rights | False disputes → dispute cost |
| Verifier: honest verification | Fees + reputation | False verification → slashing (Phase 2) |

---

## 4. Token Economy

### 4.1 Phase 1: USDC Only

| Item | Value |
|------|-------|
| Payment token | USDC (ERC20) |
| Pricing | trainee=$0, junior=$199, senior=$499, expert=$799 |
| Bonuses | Auto-resolved $100/incident, Perfect month $500 |
| Split | Trainer 70% / Platform 30% |

**Rationale**: L2 operators are businesses — price-stable USDC is appropriate.
No token launch risk. Focus on first revenue.

### 4.2 Phase 2: SNTAI Token (after market traction)

```
Token: SNTAI (ERC20, fixed supply)
Total Supply: 100,000,000 SNTAI

Distribution:
  40% — Community/Ecosystem (4-year vesting)
  25% — Team (1-year cliff + 3-year linear)
  15% — Verifier staking rewards
  10% — Treasury
  10% — Early participant airdrop
```

**SNTAI Utility (NOT for payment — USDC remains for payments)**:

| Use | Requirement | Effect |
|-----|-------------|--------|
| Verifier bond | 1,000 SNTAI | Verifier qualification + slashing target |
| Governance vote | 1+ SNTAI | Dispute resolution, fee changes |
| Fee discount | Stake 500+ SNTAI | Platform fee 30% → 20% |
| Pattern registry access | Stake 100+ SNTAI | Cross-chain pattern browsing |

### 4.3 Phase 3: Full Hybrid

```
Payments:   USDC (unchanged)
Staking:    SNTAI (Verifier bonds, governance)
Rewards:    SNTAI (verification rewards, ecosystem contributions)
Discounts:  SNTAI staking → fee reduction

Pay with USDC. Participate with SNTAI.
```

---

## 5. Data Flows

### 5.1 Attestation Flow

```
Agent Instance (off-chain)              Ethereum L1
──────────────────────                  ──────────────

ExperienceStore (Redis)
    │
    ▼
generateResume()                        (existing: agent-resume.ts)
    │
    ▼
attestation-builder.ts (NEW)
    ├── Build operations merkle tree
    │   └── leaf = keccak256(ExperienceEntry key fields)
    ├── Build patterns merkle tree
    │   └── leaf = keccak256(OperationalPattern)
    ├── Hash full resume JSON
    └── Detect tier change
    │
    ▼
onchain-submitter.ts (NEW)
    │ (viem walletClient — reuses eoa-balance-monitor.ts pattern)
    ▼
───── AgentRegistry.attestAgent() ────► L1 stored
                                        ├── TierPromoted event (if changed)
                                        └── PatternRegistered (high confidence)
```

**Merkle Tree Construction** (uses viem keccak256, no new deps):
```typescript
import { keccak256, encodePacked } from 'viem';

function operationLeaf(entry: ExperienceEntry): `0x${string}` {
  return keccak256(encodePacked(
    ['bytes32', 'string', 'string', 'uint256', 'string'],
    [keccak256(encodePacked(['string'], [entry.id])),
     entry.category, entry.action,
     BigInt(entry.resolutionMs), entry.outcome]
  ));
}
```

### 5.2 Hiring Flow

```
Buyer                 MarketplaceRouter    ServiceEscrow     Deployment
─────                 ────────────────     ─────────────     ──────────

Browse listings ────► getListingsByProtocol()
                      getAgentScore()

Select agent ───────► hireAgent()
  │ USDC approve        │
  │ deposit N months     ├──────────────► createSubscription()
  │                      │                 │ USDC locked
  │                      │
  │                      ├─────────────────────────────────► Deploy agent
  │                      │                                    bootstrapNewAgent()
  │                      │                                    (existing: experience-transfer.ts)
  │                      │                                    AgentOrchestrator.start()
  │                      │
Monthly ◄───────────────────────────────── settleMonth()
  │                                        70% → trainer
  │                                        30% → platform
```

### 5.3 Verification Flow

```
Verifier                  Agent API                 AgentRegistry (L1)
────────                  ─────────                 ─────────────────

Request ─────────────────► GET /api/agent-resume
                           │ Full resume JSON
                           │ Operations sample
                           │ Merkle proofs

Verify off-chain:
  ├── Hash resume ↔ on-chain resumeHash
  ├── Verify merkle proofs for sampled operations
  ├── Spot-check operations via L2 RPC
  │   (cross-reference gasUsedRatio, blockHeight with on-chain data)
  └── Verify operatingDays consistency

Submit verdict ─────────────────────────► verifyAgent()
                                          │ lastVerifiedAt updated
                                          │ AgentVerified event emitted

Receive fee ◄─────────────────────────── verificationFee transferred
```

---

## 6. Anti-Gaming Mechanisms

| Threat | Actor | Defense |
|--------|-------|---------|
| **Fake operations** | Trainer | Merkle proof spot-check: Verifier requests random leaf → cross-reference with L2 on-chain data (gasUsed is public) |
| **Sybil verifiers** | Trainer | Phase 1: Whitelisted 5-10 verifiers. Phase 2: 1000 SNTAI bond + slashing |
| **Tier rushing** | Trainer | `firstSeenAt` is immutable (Redis HSETNX). First on-chain attestation establishes baseline |
| **Bonus farming** | Trainer | Max 10 bonus claims/month ($1,000 cap). Buyer 7-day dispute window |
| **Collusion** | Trainer+Verifier | Random verifier assignment. Senior+ agents require 2 independent verifications |
| **Reputation laundering** | Trainer | instanceId is immutable on-chain. New ID = restart from trainee |

### Statistical Anomaly Detection

Flag agents with:
- Suspiciously uniform operation timing or resolution times
- Success rate exactly 100% over 100+ operations
- Operations clustered in short time windows (bulk injection)
- No correlation between metric values and actions taken

---

## 7. Deployment Infrastructure

### 7.1 Buyer Onboarding

| Mode | Description | Managed By |
|------|-------------|------------|
| **Managed** | SentinAI deploys on its EC2/EKS | Platform |
| **Self-hosted** | Buyer runs Docker container | Buyer |
| **Hybrid** | SentinAI container in buyer's cluster | Shared |

Existing Docker 3-stage build + docker-compose supports all modes.

**Onboarding steps** (post-hireAgent):
1. Provision infrastructure (Docker on buyer's EKS or SentinAI EC2)
2. Configure: `L2_RPC_URL`, `CHAIN_TYPE`, `REDIS_URL`, instance ID
3. Bootstrap experience via `bootstrapNewAgent()` (50% confidence discount)
4. Start `AgentOrchestrator.startInstance()` (10 agents)
5. Health verification: `GET /api/health` returns 200

### 7.2 Trainer Training Environment

```
1. Fork SentinAI → deploy on testnet (L2_RPC_URL=sepolia RPC)
2. SCALING_SIMULATION_MODE=true (safe training)
3. POST /api/metrics/seed with scenarios (stable/rising/spike/falling/live)
4. Experience accumulates → Patterns emerge → Tier threshold met
5. attestAgent() on L1 → listAgent() → marketplace listing
```

### 7.3 Agent Migration

When buyer cancels or agent is reassigned:
- Export: ExperienceLog + LifetimeStats + Patterns (encrypted JSON, AES-256-GCM)
- Import: Restore to target environment (confidence 50% discount — existing logic)
- On-chain: Same instanceId, updated operationsMerkle

---

## 8. Existing Code Integration

### Reused Modules

| Module | File | Marketplace Role |
|--------|------|-----------------|
| Agent Resume | `src/lib/agent-resume.ts` | Resume generation + deterministic hash |
| Experience Store | `src/lib/experience-store.ts` | Merkle tree source data |
| Pattern Extractor | `src/lib/pattern-extractor.ts` | Pattern registration candidates |
| Experience Transfer | `src/lib/experience-transfer.ts` | Bootstrap on hire |
| Pricing Engine | `src/lib/pricing-engine.ts` | USDC price calculation |
| Billing Types | `src/types/billing.ts` | BillingEvent, OutcomeBonus |
| viem | `package.json` (v2.45.1) | L1 contract interaction |
| EOA Balance Monitor | `src/lib/eoa-balance-monitor.ts` | viem walletClient pattern reference |

### New Files (Future Implementation)

| File | Purpose |
|------|---------|
| `contracts/AgentRegistry.sol` | Attestation contract |
| `contracts/ServiceEscrow.sol` | Payment contract |
| `contracts/MarketplaceRouter.sol` | Coordination contract |
| `contracts/test/*.test.ts` | Contract tests (Hardhat/Foundry) |
| `src/lib/attestation-builder.ts` | Merkle tree builder |
| `src/lib/onchain-submitter.ts` | L1 submission client |
| `src/lib/marketplace-client.ts` | Marketplace client |
| `src/lib/escrow-client.ts` | Escrow interaction client |
| `src/lib/verification-client.ts` | Verifier spot-check tools |
| `src/types/marketplace.ts` | Marketplace TypeScript types |
| `src/types/attestation.ts` | Attestation TypeScript types |
| `src/app/api/marketplace/route.ts` | Marketplace API endpoints |
| `src/app/api/attestation/route.ts` | Attestation API endpoints |

### Modifications to Existing Files

| File | Change |
|------|--------|
| `src/lib/agent-resume.ts` | Add `generateResumeHash()` for deterministic hashing |
| `src/lib/experience-store.ts` | Add `getExperienceRange(from, to)` for date-range queries |
| `src/lib/pricing-engine.ts` | Add `getSubscriptionRate()` bridging USD → USDC amounts |
| `src/types/redis.ts` | Add marketplace state methods to IStateStore |
| `src/lib/redis-store.ts` | Implement marketplace state persistence |
| `package.json` | Add `@openzeppelin/contracts` (dev dependency) |

---

## 9. Phased Rollout

| Phase | Timeline | Goal | Deliverables |
|-------|----------|------|-------------|
| **1. Foundation** | Weeks 1-6 | Sepolia attestation + mock payments | AgentRegistry deploy, attestation-builder, monthly auto-attest |
| **2. Marketplace MVP** | Weeks 7-12 | Full Sepolia flow | ServiceEscrow + MarketplaceRouter, E2E hire test |
| **3. Production** | Weeks 13-20 | Mainnet deployment | Security audit, gas optimization, marketplace UI, whitelisted verifiers |
| **4. Decentralization** | Week 21+ | SNTAI token + DAO | Verifier staking, governance votes, cross-chain pattern marketplace |

---

## 10. Gas Cost Summary

**Monthly L1 gas per agent** (at 30 gwei, ETH=$2000):

| Operation | Frequency | Cost |
|-----------|-----------|------|
| attestAgent (update) | 1/month | $2.70 |
| registerPattern | 0-2/month | $0-6.00 |
| settleMonth | 1/month | $3.90 |
| claimBonus | 0-3/month | $0-14.40 |
| verifyAgent | 1/month | $3.30 |
| **Total** | | **$10-30/month** |

As % of revenue: Expert ($799/mo) = 1.3-3.8%, Junior ($199/mo) = 5-15%.

---

*Generated 2026-03-05 — SentinAI Agent Marketplace On-Chain Specification*
