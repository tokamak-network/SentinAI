# Agent Reputation System & Data Quality SLA Framework

**Date**: 2026-03-11
**Status**: Design Approved
**Phase**: 1 (Trust Infrastructure)

---

## Executive Summary

SentinAI's Agent Economy marketplace requires a **trust foundation** before buyers will commit to purchasing data. This design introduces two interconnected systems:

1. **Agent Reputation System** — On-chain reputation scores (0–100) that track agent reliability
2. **Data Quality SLA Framework** — Off-chain SLA tracking with on-chain enforcement via Merkle proofs

The design uses a **hybrid approach**: computation happens off-chain (cost-efficient), while results are recorded on-chain (tamper-proof), with a **7-day dispute window** for transparency and correctness.

---

## Architecture Overview

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    Ethereum L1 (Trust Layer)                │
│  ReputationRegistry Smart Contract                          │
│  • Reputation scores (0–100 per agent)                      │
│  • Merkle root batch submissions                            │
│  • Dispute resolution (7-day window)                        │
└─────────────────────────────────────────────────────────────┘
                              ↑
                  submitMerkleRoot() — 1x/day
                              │
┌─────────────────────────────────────────────────────────────┐
│                  SentinAI Instance (Off-Chain)              │
│                                                              │
│  1. x402 Middleware                                        │
│     • Every request/response → RequestRecord                │
│     • Captures: agentId, timestamp, latency, success       │
│                                                              │
│  2. Daily Batch Process                                     │
│     • Aggregate 24h logs by agentId                        │
│     • Calculate SLA compliance (SR%, latency)              │
│     • Compute reputation delta (-5, +2, +5 points)         │
│     • Generate Merkle tree + proof                         │
│     • Upload full batch data to IPFS                       │
│     • Submit root + batch hash to smart contract           │
│                                                              │
│  3. Dispute Resolution (Passive)                            │
│     • Agents can dispute within 7 days                     │
│     • Merkle tree is public → agents verify own data       │
│     • Admin resolves disputes off-chain                    │
└─────────────────────────────────────────────────────────────┘
                              ↑
                  HTTP requests + x402 payments
                              │
┌─────────────────────────────────────────────────────────────┐
│                   External AI Agents                        │
│  (0xDeFi...A21, 0xMEV...B44, etc.)                         │
│                                                              │
│  • Daily marketplace API calls                             │
│  • Results: reputation scores, SLA metrics                 │
│  • Dashboard: view reputation, choose providers            │
└─────────────────────────────────────────────────────────────┘
```

---

## System Components

### 1. Reputation Smart Contract (Ethereum L1)

**Location**: `contracts/ReputationRegistry.sol` (to be created)

**Core Data Structures**:

```solidity
struct RepRecord {
  uint8 score;              // 0–100
  uint256 lastUpdate;       // batch submission time
  bytes32 merkleRoot;       // current batch root
  string batchHash;         // IPFS CID for full data
}

mapping(address => RepRecord) public reputations;
mapping(address => DisputeRecord[]) public disputes;
```

**Key Functions**:

| Function | Caller | Purpose |
|----------|--------|---------|
| `submitMerkleRoot(agentIds, newScores, root, hash)` | SentinAI Admin | Submit daily batch |
| `initiateDispute(agentId, proof)` | Agent (only their own) | Challenge score within 7 days |
| `resolveDispute(agentId, index, correctedScore)` | Admin | Settle dispute |
| `getReputation(agentId)` | Public | Read reputation (for catalog) |

**Access Control & Rate Limiting**:
- `submitMerkleRoot`:
  - Caller: `msg.sender == SENTINAI_ADMIN` (set via constructor/role)
  - Validation: `agentIds.length == newScores.length`
  - Rate limit: Only 1 submission per day (enforced via `lastBatchTimestamp`)

- `initiateDispute`:
  - Caller: **Only `msg.sender == agentId`** (agent can only dispute their own score)
  - Validation:
    - Batch submission ≤ 7 days ago: `now <= lastBatchTimestamp + 7 days`
    - Proof format: `proof` is IPFS CID string (format: `Qm...`)
    - No duplicate: Agent has ≤ 1 active dispute per batch
  - Dispute Cost: 0.01 ETH (refunded if resolved in agent's favor)
  - Rate limit: Max 1 dispute per agent per batch

- `resolveDispute`:
  - Caller: `msg.sender == SENTINAI_ADMIN`
  - Validation:
    - Merkle proof verification (off-chain computed root must match submitted root)
    - Corrected score must be 0–100
  - Effect: Updates agent's score, marks dispute as resolved, refunds dispute cost if applicable

**Smart Contract Verification**:
```solidity
// Pseudo-code for initiateDispute validation
require(msg.sender == agentId, "Only own agent can dispute");
require(block.timestamp <= lastBatchTimestamp[agentId] + 7 days, "Dispute window closed");
require(disputes[agentId][currentBatch].status == NONE, "Only 1 dispute per batch");
require(msg.value == DISPUTE_COST, "Must send 0.01 ETH");

// For resolveDispute: Merkle proof validation
bytes32 leaf = keccak256(abi.encodePacked(agentId, correctedScore, batchTimestamp));
require(verifyMerkleProof(leaf, proof, merkleRoot), "Invalid proof");
```

---

### 2. SLA Tracking System (Off-Chain)

**Location**: `src/lib/sla-tracker.ts` (to be created)

**Core Responsibility**: Record every marketplace API request and compute daily SLA compliance.

#### Request Recording

Every x402-validated request is recorded:

```typescript
interface RequestRecord {
  agentId: string;        // buyer's agent address
  serviceKey: string;     // "anomalies", "rca", etc.
  timestamp: number;      // milliseconds since epoch
  latencyMs: number;      // response time
  success: boolean;       // payment + response OK
}
```

**Recording Point**: x402 middleware, after successful payment verification.

#### Daily Batch Computation

**Trigger**: UTC 00:00 every day (configurable via cron)

**Process**:

```
1. Collect all RequestRecords from past 24 hours
2. Group by agentId
3. For each agent:
   a. Calculate Success Rate = (success count / total count) * 100

   b. Calculate Avg Latency (ONLY for successful requests):
      - Filter: only records where success == true
      - If no successful requests: latency = ∞ (automatic -5 penalty)
      - Otherwise: latency = sum(latencyMs for successful requests) / count(successful)
      - Max latency clamp: if latencyMs > 30000ms, record as 30000 (prevent outliers)

   c. Determine SLA violation:
      - if SR < 95% → apply -5 penalty
      - if latency > 2000ms (and there are successful requests) → apply -5 penalty
      - (can apply both independently)
      - if latency == ∞ (no successful requests) → -5 penalty applied

   d. Check recovery conditions:
      - if all records success (SR == 100%) AND latency ≤ 2000ms → +2 points
      - (monthly: if SR === 100% for entire month → +5 points)

   e. newScore = clamp(oldScore + delta, 0, 100)
4. Build Merkle tree of (agentId, newScore) pairs
5. Upload full batch data to IPFS → get batchHash (CID)
6. Call smart contract:
   submitMerkleRoot(
     [0xDeFi...A21, 0xMEV...B44, ...],
     [100, 95, ...],
     merkleRoot,
     "Qm..."  // IPFS CID
   )
```

#### Merkle Tree Structure

**Why Merkle tree?**
- Compact on-chain proof (32 bytes per batch)
- Agents can verify their own data without trusting operator
- Enables fraud detection

**Hash Algorithm & Leaf Format**:
- **Hash Function**: `keccak256` (Solidity standard)
- **Leaf Format**: `keccak256(abi.encodePacked(agentId, score, batchTimestamp))`
  - `agentId`: bytes20 (Ethereum address)
  - `score`: uint8 (0–100)
  - `batchTimestamp`: uint256 (seconds since epoch, batch submission time)
- **Byte Order**: Little-endian for uints; addresses in canonical form

**Tree Construction**:
```
1. Create leaves: [leaf0, leaf1, leaf2, leaf3, ...]
2. Build layers bottom-up:
   - If layer has odd count, duplicate last leaf (leaf[n-1])
   - For each pair (left, right): hash = keccak256(left || right)
   - Continue until single root remains
3. Example (4 agents):
         Root (64 bytes keccak256)
        /                        \
    Hash(L01)              Hash(R23)
    /      \                /      \
   Leaf0  Leaf1         Leaf2   Leaf3
```

**Merkle Proof Format**:
- Proof is an array of hashes (32 bytes each) representing siblings along the path
- Verification: Start with leaf, apply each sibling hash in order (left-to-right in tree)
- Path example for Leaf0: `[Leaf1, Hash(R23)]`

**Verification (by agent)**:
```typescript
const leaf = keccak256(abi.encodePacked(agentId, score, batchTimestamp));
const path = [sibling0, sibling1, ...];  // siblings from leaf to root

let computed = leaf;
for (const sibling of path) {
  computed = keccak256(abi.encodePacked(computed, sibling));
  // Note: order depends on position in tree; implementation uses index tracking
}
assert(computed === submittedRoot);  // ✓ trusted
```

**Important**: The exact byte concatenation order (left||right vs right||left) is determined by leaf position in tree. This MUST match between off-chain tree generation and on-chain verification. See Smart Contract Verification section below.

---

### 3. Data Quality SLA Metrics

**Tracked per service**: All marketplace services inherit the same SLA framework.

| Metric | Threshold | Penalty |
|--------|-----------|---------|
| Success Rate | ≥ 95% | -5 if SR < 95% |
| Avg Latency | ≤ 2000ms | -5 if latency > 2000ms |
| Recovery: Consecutive Success | 100 consecutive requests, 0 failures | +2 points (reset daily) |
| Recovery: Monthly Excellence | 100% SR for entire calendar month | +5 points (checked day 1 of next month) |

**Example**:
```
Agent 0xDeFi...A21 on 2026-03-11:
  • 95 successful requests out of 100 → SR = 95% ✓ (at threshold)
  • Average latency: 1234ms ✓ (below 2000ms)
  • Score change: 0
  • New score: 100 (maintained)
```

---

## Reputation Score System

### Score Range: 0–100

| Range | Meaning | Market Signal |
|-------|---------|---------------|
| 90–100 | Excellent | Preferred provider |
| 75–89 | Good | Acceptable, slight discount risk |
| 50–74 | Fair | Risky, lower prices expected |
| 0–49 | Poor | Avoid unless price is very low |

### Initial Score: 100

Every new agent in the registry starts at score 100. This incentivizes good behavior early.

### Score Changes (Penalties & Recovery)

**Penalties** (per-day, cumulative):
- SLA violation (SR or latency): -5 points
- Multiple violations: -10 total per day max

**Recovery** (explicit achievement-based):

1. **Consecutive Success Bonus** (+2 points):
   - Trigger: Agent reaches exactly 100 consecutive successful requests (success == true)
   - Window: Consecutive counter resets on **any single failure** (success == false)
   - Reset: Counter starts at 0 each day at UTC 00:00
   - Bonus applied: Once per daily batch (even if agent hits 100, 200, 300 consecutive; only +2 per day)
   - Example:
     ```
     Day 1: 95 successes → counter = 95, no bonus
     Day 2: 5 successes + 1 failure → counter resets to 0, no bonus
     Day 3: 100 successes → counter = 100, +2 bonus
     Day 4: 50 successes → counter = 50 (carrying forward), no bonus yet
     ```

2. **Monthly Excellence Bonus** (+5 points):
   - Trigger: Agent maintains 100% Success Rate (SR === 100%) for entire calendar month
   - Window: Month = calendar month (e.g., 2026-03-01 to 2026-03-31)
   - Checked: On the 1st of following month (e.g., 2026-04-01 batch check calculates 2026-03 bonus)
   - Bonus applied: Once at start of next month (even if SR stays at 100% for multiple months, +5 per month)
   - Requirements: ALL days in month must have ≥1 request AND SR = 100%
   - Example:
     ```
     March 2026: Every day, all requests succeed
     April 1st batch: Check if March SR == 100% → YES → +5 bonus applied
     April 2026: 1 failure on April 15th
     May 1st batch: Check if April SR == 100% → NO → no bonus
     ```

**Important**:
- Scores do NOT auto-recover over time. Recovery requires demonstrated good behavior.
- Both recovery bonuses can be applied in the same day (max +7 per day if both conditions met)
- Consecutive counter is per-agent, not per-service (counts all request types combined)

---

## Dispute Resolution (7-Day Window)

### Why Disputes?

SentinAI operator submits the Merkle root. To prevent fraud (false data submission), agents can challenge within 7 days.

### Dispute Timeline (Strict & Unambiguous)

All times are **UTC**.

**T = 0 (Batch Submission, e.g., 2026-03-11 09:00 UTC)**:
SentinAI submits batch via `submitMerkleRoot()`:
```solidity
submitMerkleRoot(
  agentIds: [0xDeFi...A21, ...],
  newScores: [95, ...],
  merkleRoot: 0xabc...,
  batchHash: "QmXyz..."
)
// Smart contract records: lastBatchTimestamp = now
```

**T ∈ [0, 604800) seconds (Submission Deadline = 7 days)**:
Agents can `initiateDispute()`:
- Earliest: T=0 (immediately after batch submission)
- Latest: T=604799 (just before 7-day window closes)
- Smart contract enforces: `require(block.timestamp < lastBatchTimestamp + 7 days)`

```solidity
initiateDispute(
  agentId: 0xDeFi...A21,
  proof: "QmMyData..."  // IPFS CID with agent's transaction records
)
// Smart contract records: disputeTimestamp = now
```

**T ∈ [0, 864000) seconds (Investigation Window = 12 days)**:
Admin investigates and resolves disputes:
- Investigate period: 5 days after dispute window closes (T=604800 to T=864000)
- Fetch both:
  - Full batch: `QmXyz...` (submitted by SentinAI)
  - Agent claim: `QmMyData...` (submitted by agent)
- Verify: Does agent's data hash to submitted Merkle root?
- Resolve via `resolveDispute(agentId, index, correctedScore)`

**T ≥ 864000 seconds (Auto-Closure = 10 days after submission)**:
- Any unresolved disputes are **automatically closed**
- Submitted score stands (protects agents from indefinite limbo)
- Smart contract enforces auto-closure via `getDisputeStatus(agentId)`:
  ```solidity
  if (dispute.status == PENDING && now >= lastBatchTimestamp + 10 days) {
    dispute.status = AUTO_CLOSED;
    dispute.finalScore = submittedScore;
  }
  ```

**Visual Timeline**:
```
T=0              T=604800 (7d)    T=864000 (12d)   T=1209600 (14d)
|__________________|______________|__________________|
    Dispute Submission Window      Investigation    Record Frozen
    (agents can dispute)            Window            (no further action)
                                    (admin resolves)
```

**Key Guarantees**:
1. Agent has exactly 7 days to dispute
2. Admin has exactly 5 days to investigate (after dispute window)
3. No dispute remains unresolved after 10 days
4. Score history immutable after 14 days

### Transparency via Public Merkle Tree

**Key Feature**: The full batch data (IPFS CID stored on-chain) is public.

Agents can voluntarily verify:
```typescript
// Agent downloads batch from IPFS
const batch = await ipfs.get("QmXyz...");

// Finds their records
const myRecords = batch.records.filter(r => r.agentId === "0xDeFi...A21");

// Recalculates their own score
const recalcScore = calculateScore(myRecords);

// Verifies Merkle inclusion
const myLeaf = hash(agentId || recalcScore || timestamp);
const proof = batch.merkleProof[myIndex];
assert(merkleProof.verify(myLeaf, proof, submittedRoot));

// ✓ Verified: score is correct
```

This provides **cryptographic transparency** without requiring on-chain computation.

---

## Integration with Existing Marketplace

### Affected Components

**1. x402 Middleware** (`src/lib/x402-middleware.ts`)
- Add: Record every validated request → RequestRecord
- Storage: In-memory buffer, flushed to persistent store (Redis) every N requests

**2. Daily Cron** (`src/lib/scheduler.ts`)
- Add: New cron job at UTC 00:00
- Task: Run SLA batch process → submit to smart contract

**3. Marketplace Catalog API** (`GET /api/marketplace/catalog`)
- Add reputation field to service response:
  ```json
  {
    "services": [
      {
        "key": "anomalies",
        "priceWei": "200000000000000000",
        "reputation": {
          "score": 95,
          "lastUpdate": "2026-03-11T09:00:00Z",
          "successRate": 97.5,
          "avgLatencyMs": 1234
        }
      }
    ]
  }
  ```

**4. Marketplace Dashboard** (`src/app/marketplace/page.tsx`)
- Add: Reputation tab showing daily scores, SLA metrics, dispute history

### No Changes Required

- Pricing engine (`pricing-engine.ts`) — unchanged
- x402 payment flow — unchanged (only add recording)
- Service endpoints — unchanged (only add middleware)

---

## IPFS Durability & Pinning Strategy

### Why IPFS?

Full batch data (all agent records, SLA calculations) is stored on IPFS with the CID recorded on-chain. This enables agents to:
- Download batch data (`QmXyz...`)
- Verify their records match the on-chain Merkle root
- Detect fraudulent submissions

### Pinning Responsibility

**Primary**: SentinAI operator pins all batch CIDs indefinitely
- Storage location: Pinata or self-hosted IPFS node
- Lifespan: Permanent (batch CIDs never expire)
- Backup: At least 2 independent pinning services

**Secondary**: Public IPFS network (best-effort)
- Any IPFS node can fetch and re-pin data
- No guarantee of persistence

### Fallback for Data Loss

If IPFS CID becomes unreachable (both pinning services down, data deleted):

1. **Within 7 days (dispute window)**:
   - Admin stores batch data on-chain via `submitBatchDataOnChain(batchHash, compressedData)`
   - Cost: ~500k-2M gas per batch (expensive but acceptable during disputes)

2. **After 7 days (dispute window closed)**:
   - Batch CID frozen at last known state
   - Disputes cannot reference deleted data (risk accepted)
   - Future batches use same pinning strategy

### Monitoring & Alerts

Daily health check:
```typescript
async function checkIPFSAvailability() {
  const cids = await getLastNBatchCIDs(90);  // Last 90 days
  for (const cid of cids) {
    try {
      await ipfs.stat(cid, { timeout: 5000 });
      // ✓ CID reachable
    } catch (e) {
      sendAlert(`IPFS CID unreachable: ${cid}`);
      // Trigger fallback: re-pin or store on-chain
    }
  }
}
```

---

## Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| Request succeeds but response crashes before return | Record as `success: false` (SLA violation) |
| Network timeout mid-request | Record as `success: false` + `latencyMs: ∞` clamped to max |
| Agent submits >10k requests/day | Merkle tree partitioning (not in Phase 1) |
| IPFS upload fails | Fallback: store batch data on-chain (high gas, reserved for critical disputes) |
| Dispute submitted after 7 days | Rejected by smart contract |
| Admin never resolves dispute | After 7 days, submitted score stands (protects agents) |
| New agent, no transactions | score = 100 (initial value) |
| Floating-point latency rounding | Record only integer milliseconds; aggregate as floats but submit as uint256 (wei) |

---

## Testing Strategy

### Unit Tests

**SLA Calculator** (`src/lib/__tests__/sla-tracker.test.ts`)
- Test score calculation: SR violations, latency violations
- Test recovery conditions: consecutive success, monthly excellence
- Test edge cases: empty logs, single request, mixed success/failure
- Target: 15 tests, >95% coverage

**Merkle Tree Utilities** (`src/lib/__tests__/merkle-tree.test.ts`)
- Test tree generation from score arrays
- Test proof generation and verification
- Test invalid proofs rejected
- Target: 10 tests, 100% coverage

### Integration Tests

**Batch Processor** (`src/lib/__tests__/batch-processor.test.ts`)
- Simulate 24h of requests → run batch → verify scores
- Test IPFS upload (mock)
- Test transaction construction
- Target: 5 tests

### Smart Contract Tests

**ReputationRegistry** (`contracts/test/ReputationRegistry.test.ts`)
- Test `submitMerkleRoot` access control and state update
- Test `initiateDispute` within/after 7-day window
- Test `resolveDispute` and score correction
- Target: 14 tests

### E2E Tests

**Full Integration** (1 journey test)
- Agent makes request → recorded
- Daily batch runs → Merkle root submitted
- Agent verifies reputation in catalog
- Agent disputes → admin resolves
- Target: 1 test, covers happy path + dispute

---

## Future Extensions (Phase 2+)

1. **Dynamic SLA Tiers**: Different services (RCA = stricter than metrics)
2. **Chainlink Automation**: Third-party batch submission
3. **Reputation Slashing**: Escrow-based penalties (currently reputation-only)
4. **Appeals Process**: Multi-level dispute resolution
5. **Reputation Decay**: Scores degrade over months of inactivity

---

## Definitions

| Term | Definition |
|------|-----------|
| **SLA** | Service Level Agreement; commitment to response quality (SR%, latency) |
| **SR** | Success Rate (successful requests / total requests) |
| **Merkle Root** | 32-byte hash summarizing all agent scores for a batch |
| **Batch** | One day's worth of processed scores and agent data |
| **Dispute Window** | 7 days after batch submission; agents can challenge scores |
| **IPFS** | InterPlanetary File System; decentralized storage (batchHash stored on-chain) |

---

## Security Considerations

### Trust Model

- **Level 1 (Off-chain)**: SentinAI computes SLA; agents can verify via Merkle tree
- **Level 2 (On-chain)**: Smart contract enforces final scores; disputes settled by admin
- **Level 3 (Economics)**: False submission is economically irrational (ruins reputation)

### Threat Scenarios

| Threat | Mitigation |
|--------|-----------|
| SentinAI submits false scores | Merkle tree public → agents detect fraud → initiate disputes → admin corrects |
| Admin ignores valid disputes | Off-chain monitoring required; can upgrade contract to auto-resolve |
| Agents collude to spam disputes | Each dispute requires proof data; frivolous disputes ignored by admin |
| IPFS data deleted | Pinning strategy (see IPFS Durability section below) |

---

## Success Criteria

Phase 1 is successful when:

1. ✓ Reputation scores are recorded on-chain daily
2. ✓ Agents can verify their own data via Merkle proofs
3. ✓ At least 1 dispute is resolved correctly
4. ✓ Marketplace catalog displays reputation alongside pricing
5. ✓ No external oracles required (operator cost <$100/month)

---

## Appendix: Code Examples

### Example: Daily Batch Run

```typescript
// Cron job at UTC 00:00
async function dailyBatchJob() {
  const slaTracker = new SLATracker();

  // Compute scores
  const batch = await slaTracker.generateDailyBatch();
  // batch = { scores: Map<agentId, score>, merkleRoot, batchHash }

  // Prepare contract call
  const agentIds = Array.from(batch.scores.keys());
  const newScores = Array.from(batch.scores.values());

  // Submit to Ethereum
  const tx = await reputationRegistry.submitMerkleRoot(
    agentIds,
    newScores,
    batch.merkleRoot,
    batch.batchHash
  );

  console.log(`Batch submitted: tx=${tx.hash}, root=${batch.merkleRoot}`);
}
```

### Example: Agent Verifying Score

```typescript
// Agent's off-chain verification
async function verifyMyScore(agentId, expectedScore) {
  const ipfsData = await ipfs.cat(reputationRecord.batchHash);
  const batch = JSON.parse(ipfsData);

  // Extract agent's records
  const myRecords = batch.records.filter(r => r.agentId === agentId);

  // Recalculate score
  const calculated = calculateScore(myRecords);

  if (calculated !== expectedScore) {
    console.warn(`Score mismatch: expected ${expectedScore}, calculated ${calculated}`);
    // Initiate dispute
    await initiateDispute(agentId, ipfsHash);
  } else {
    console.log(`✓ Score verified: ${expectedScore}`);
  }
}
```

---

**Document Status**: Ready for implementation planning
**Next Step**: Invoke `superpowers:writing-plans` to create detailed implementation plan
