# Agent-for-Hire Revenue Model

> Date: 2026-03-03
> Status: Design — pending validation
> Context: 30-day plan v2 evaluation, strategic revenue model exploration

---

## 1. Problem Statement

### Why Traditional SaaS Fails for SentinAI

Traditional SaaS sells "access to hosted software" via subscription. This model is collapsing because:

1. **AI generates equivalent software** — Code is no longer a defensible moat
2. **Self-hosted = no lock-in** — Operators own the code and their AI API keys
3. **Feature gates are unenforceable** — Open-source, self-hosted software can't technically restrict features
4. **The "convenience premium" shrinks** — AI agents can set up and operate self-hosted software

### What Remains Valuable in an AI World

| Replicable by AI | NOT Replicable by AI |
|-------------------|----------------------|
| Code generation | Accumulated operational data |
| Infrastructure setup | Cross-chain pattern recognition |
| Dashboard creation | Battle-tested playbook success rates |
| Alert rule writing | Real-world failure mode catalog |
| Documentation | Verified track record |

**Core insight**: Software is commoditized. Operational experience is the new moat.

---

## 2. The Agent-for-Hire Model

### Paradigm Shift

```
SaaS:  "Buy our tool"      → Tool value    → AI destroys this
AaaS:  "Hire our agent"    → Experience value → AI amplifies this
```

An operator doesn't buy SentinAI software. They **hire a SentinAI agent** — an autonomous entity with verifiable experience, a track record, and accumulated operational knowledge.

### Agent Identity and Resume

Each agent has a **verifiable resume**:

```
SentinAI Agent #thanos-guardian
  Experience:  Thanos Sepolia, 6 months continuous operation
  Track record: 4,656 cycles, 47 incidents auto-resolved, 0 critical false positives
  Skills:      OP Stack operations, L1 RPC failover, predictive scaling
  Specialties: TxPool spike classification, L1 rate-limit pre-detection
  Monthly rate: $499

SentinAI Agent #new-hire
  Experience:  Newly deployed (learning period)
  Track record: None yet (first 30 days free)
  Skills:      Basic EVM monitoring, standard playbooks
  Monthly rate: $199 (increases with experience)
```

### Why Hire Instead of Build?

**Code is replicable. Experience is not.**

A competent team can build an equivalent monitoring agent in 1-2 days with AI assistance. But that agent has:

- Zero operational memory (hasn't seen real incidents)
- Untested playbooks (theoretical, not battle-proven)
- No cross-chain knowledge (only sees one chain)
- No pattern catalog (starts from scratch)

Reaching SentinAI's operational maturity requires:

| Capability | Time to Build from Scratch |
|------------|--------------------------|
| Code + infrastructure | 1-2 days (AI-assisted) |
| First real incident patterns | 1-3 months |
| Reliable anomaly detection tuning | 3-6 months |
| Cross-chain pattern library | Never (requires multi-chain data) |
| Verified playbook success rates | 6+ months |

**The hiring analogy**: "Why hire a senior SRE? A junior can learn Kubernetes." — True, but the learning period's incident cost, misjudgment risk, and time opportunity cost make hiring the rational choice.

---

## 3. What the Agent Accumulates

### 3.1 Operational Memory (Data Moat)

Concrete examples from Thanos Sepolia operation:

**Pattern #47: L1 RPC 429 Pre-detection**
```
Observation: L1 response time > 800ms sustained for 5 minutes
Prediction:  87% probability of 429 rate limit within 3 minutes
Action:      Preemptive RPC endpoint switch
Result:      Zero downtime (vs. 30-60 seconds without pre-detection)
Applicable:  Alchemy/Infura endpoints only (publicnode not affected)
```

**Pattern #23: TxPool Spike Classification**
```
Type A: Gas price drop → natural TxPool increase → no scaling needed (self-resolves in 30 min)
Type B: External bot attack → TxPool + CPU simultaneous spike → immediate 4 vCPU scaling
Discriminator: CPU-TxPool correlation coefficient > 0.8 → Type B
```

**Pattern #12: Time-of-Day False Positive Suppression**
```
Observation: UTC 18:00 (KST 03:00) L1 block production delays are frequent
Rule:        5-second delays at this time are normal → suppress alert
Threshold:   Only alert if delay exceeds 15 seconds
```

A DIY agent learns these only by experiencing them over 6+ months of production operation.

### 3.2 Cross-Chain Transfer Learning

```
Agent operates Thanos (OP Stack):
  Learns: "batcher balance < 0.15 ETH → batch submission failure within 12 hours"

Agent deployed to new OP Stack chain:
  Immediately applies: "batcher balance at 0.18 ETH → preemptive refill recommended"
  DIY agent on chain B: no such knowledge → waits until 0.15 ETH → incident occurs

With 50 chains running SentinAI:
  Collective learning rate: ~50 real incidents/week
  Single DIY agent:         ~1 incident/week
```

This is a **data network effect** — more operators → better detection → more value per operator.

### 3.3 Battle-Tested Playbooks

```
DIY Playbook:                     SentinAI Playbook:
─────────────                     ─────────────────
"CPU > 80% → scale up"            "CPU > 80% → scale up"
Success rate: unknown              Success rate: 94.2% (127 executions)
Rollback: none                     Rollback: verified, 30-second recovery
Side effects: unknown              Side effects: causes prover OOM on ZK Stack
                                              → memory check required first
```

---

## 4. Value Proposition by Client Type

### L1 Execution Client (Geth / Reth / Nethermind)

**Operator pain points:**
- "Geth sync suddenly slowed — is it my problem or the network?"
- "Peer count is dropping — network issue or local issue?"
- "Block import time increased after client update — is this normal?"

**Agent value:**
- Knows normal ranges per client version (e.g., Geth v1.14.x block import: 50-120ms)
- Detects client-specific known issues (e.g., Geth v1.14.3 72-hour memory leak → preemptive restart)
- Immediate anomaly judgment from day 1 (zero learning period)

### L2 Sequencer (OP Stack: Optimism, Base, Thanos)

**Operator pain points:**
- "Sequencer stopped producing blocks — L1 problem or sequencer problem?"
- "Batcher is failing — gas issue or nonce issue?"
- "L1 RPC returning 429 — when should I failover?"

**Agent value:**
- 5-component dependency graph RCA (L1 → op-node → op-geth chain tracing)
- Preemptive L1 RPC switching (recognizes 429 precursor patterns)
- Batcher/proposer EOA balance monitoring + auto-refill
- Root cause identification in 2 seconds (vs. 30 minutes for human)

### Arbitrum Orbit / Nitro

**Operator pain points:**
- "Batch posting is delayed — L1 gas or sequencer issue?"
- "Challenge received — normal challenge or attack?"

**Agent value:**
- Sequencer Inbox + L1 gas correlation analysis
- OP Stack experience transfer (batcher patterns are similar)
- L1 gas prediction-based batch timing optimization

### ZK Stack

**Operator pain points:**
- "Proof generation is slowing down — GPU issue or circuit issue?"
- "Batch sealing intervals are irregular — is this normal?"

**Agent value:**
- Prover GPU utilization + proof time correlation
- Batch sealing pattern normal-range learning
- ZK-specific anomaly detection (different metric schema from other chains)

---

## 5. Pricing Structure

### Experience-Based Pricing

Agent price increases with proven experience:

| Agent Level | Experience | Monthly Rate | Included |
|-------------|-----------|-------------|----------|
| **Trainee** | 0-30 days | Free | Basic monitoring, standard playbooks |
| **Junior** | 1-3 months | $199/chain | Anomaly detection, auto-scaling, alerts |
| **Senior** | 3-6 months | $499/chain | Full autonomy, predictive actions, RCA |
| **Expert** | 6+ months, multi-chain | $799/chain | Cross-chain intelligence, custom playbooks |

### Outcome-Based Add-on

On top of the base rate, charge for verified outcomes:

| Outcome | Bonus |
|---------|-------|
| Auto-resolved incident (verified by VerifierAgent) | $50-200/incident |
| Month with 99.9%+ uptime SLA met | $500 bonus |
| Cost savings identified and executed | 10% of savings |

### Revenue Projection (Revised)

| Stage | Timeline | Agents Deployed | Monthly Revenue |
|-------|---------|----------------|----------------|
| Seed | Month 1-6 | 5-10 agents | $1,000-5,000 |
| Growth | Month 6-12 | 20-40 agents | $8,000-20,000 |
| Scale | Month 12-24 | 50-100 agents | $25,000-80,000 |

At scale: $300K-960K/year — viable for a small team.

---

## 6. Technical Requirements

### What Already Exists

| Component | Status | Purpose |
|-----------|--------|---------|
| AgentOrchestrator | ✅ Implemented | Manages parallel agent lifecycle |
| VerifierAgent | ✅ Implemented | Post-execution verification (proof of outcome) |
| OperationLedger (v2 API) | ✅ Implemented | Records execution history |
| InstanceMetricsStore | ✅ Implemented | Per-instance metrics ring buffer |
| Protocol Descriptors (5 chains) | ✅ Implemented | Chain-specific metric schemas |
| GenericDetector | ✅ Implemented | Parameterized anomaly detection |
| Playbook System | ✅ Implemented | Automated remediation |

### What Needs to Be Built

#### P0: Experience Persistence (Required for Launch)

**6.1 OperationLedger Enrichment**

Current state: OperationLedger records execution results but does not extract reusable patterns.

Required additions:
```
src/lib/experience-store.ts
  - Persistent storage of operational patterns (Redis, 90-day TTL)
  - Pattern schema: { trigger, action, outcome, confidence, executionCount, successRate }
  - Query: "What worked for TxPool spikes on OP Stack chains?"

src/lib/pattern-extractor.ts
  - Post-execution analysis: VerifierAgent result → pattern extraction
  - Incremental update: if existing pattern, update successRate and executionCount
  - New pattern detection: if novel incident/resolution, create new pattern entry
```

Estimated effort: 2-3 days

**6.2 Agent Resume Generator**

```
src/lib/agent-resume.ts
  - Aggregates OperationLedger data into a verifiable agent profile
  - Metrics: total cycles, incidents handled, success rates, uptime achieved
  - Exportable as JSON (for public dashboard / marketing)
  - Updates daily via scheduler

src/app/api/v2/instances/[id]/resume/route.ts
  GET → Agent resume with verified statistics
```

Estimated effort: 1-2 days

**6.3 Outcome Verification and Billing Events**

```
src/lib/outcome-tracker.ts
  - Listens to VerifierAgent 'execution-complete' events
  - Classifies outcomes: auto-resolved, escalated, false-positive, failed
  - Emits billing events for outcome-based pricing
  - Stores in Redis with 30-day retention

src/types/billing.ts
  BillingEvent: { instanceId, eventType, outcomeType, value, timestamp }
```

Estimated effort: 1-2 days

#### P1: Cross-Chain Intelligence (Required for Scale)

**6.4 Experience Transfer Protocol**

```
src/lib/experience-transfer.ts
  - When new instance bootstraps, inject relevant patterns from same protocol type
  - Pattern matching: "OP Stack patterns" → new OP Stack instance
  - Confidence discount: transferred patterns start at 50% confidence
    (must be validated on new chain before reaching full confidence)
  - Privacy: only pattern schemas transfer, not raw metrics

Transfer flow:
  Agent(Thanos) accumulated 47 patterns
    → New OP Stack chain onboards
    → Agent(new) receives 47 patterns at 50% confidence
    → As patterns are validated on new chain, confidence → 100%
    → Novel patterns on new chain feed back to collective pool
```

Estimated effort: 3-4 days

**6.5 Collective Pattern Aggregator**

```
src/lib/collective-intelligence.ts
  - Opt-in telemetry: instances share anonymized pattern data
  - Aggregation: merge patterns across chains by protocol type
  - Scoring: patterns validated on more chains → higher confidence
  - Distribution: high-confidence patterns pushed to all agents

Privacy model:
  Shared:     pattern schema + success rate + protocol type
  NOT shared: raw metrics, RPC URLs, operator identity, financial data
```

Estimated effort: 4-5 days

#### P2: Public Proof and Marketing

**6.6 Public Agent Dashboard**

```
website/src/app/agents/page.tsx
  - Public page showing deployed agent profiles
  - Real-time stats from agent resume API
  - "Hire this agent" CTA → Connect wizard

website/src/app/agents/[id]/page.tsx
  - Individual agent resume page
  - Incident timeline, success rates, specialties
  - "Agents like this one protect $X TVL across Y chains"
```

Estimated effort: 2-3 days

**6.7 Experience-Based Pricing Engine**

```
src/lib/pricing-engine.ts
  - Calculates agent rate based on experience level
  - Trainee (0-30d): free
  - Junior (1-3mo): $199
  - Senior (3-6mo): $499
  - Expert (6mo+, multi-chain): $799
  - Outcome-based add-on calculation

src/app/api/v2/instances/[id]/pricing/route.ts
  GET → Current pricing tier + earned outcome bonuses
```

Estimated effort: 1-2 days

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

| Task | Priority | Effort | Dependency |
|------|----------|--------|------------|
| Experience Store | P0 | 2-3d | VerifierAgent (exists) |
| Pattern Extractor | P0 | 2-3d | Experience Store |
| Agent Resume Generator | P0 | 1-2d | OperationLedger (exists) |
| Outcome Tracker | P0 | 1-2d | VerifierAgent (exists) |

Deliverable: Agents accumulate and display verifiable experience.

### Phase 2: Intelligence (Week 3-4)

| Task | Priority | Effort | Dependency |
|------|----------|--------|------------|
| Experience Transfer Protocol | P1 | 3-4d | Experience Store |
| Collective Pattern Aggregator | P1 | 4-5d | Pattern Extractor |
| Pricing Engine | P2 | 1-2d | Agent Resume |

Deliverable: New agents bootstrap with transferred experience. Pricing reflects experience.

### Phase 3: Go-to-Market (Week 5-6)

| Task | Priority | Effort | Dependency |
|------|----------|--------|------------|
| Public Agent Dashboard | P2 | 2-3d | Agent Resume API |
| Landing page integration | P2 | 1-2d | Public Dashboard |
| First external agent deployment | P0 | 2-3d | All Phase 1 |

Deliverable: Public-facing agent profiles. First external operator onboarded.

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| "Operators won't pay for an AI agent" | Model fails | Free trainee tier proves value before asking for payment. Outcome-based pricing = pay only for results. |
| Experience data is insufficient for cross-chain transfer | Reduced value proposition | Start with same-protocol transfer (OP Stack → OP Stack) where patterns are most transferable. |
| Privacy concerns with collective intelligence | Operators opt out | Strict privacy model — only pattern schemas shared, never raw data. Opt-in only. |
| Cold start: first agents have no experience | Low initial value | Thanos Sepolia agent already has 6 months of real data — it IS the first senior agent. |
| Pricing too low for sustainability | Revenue insufficient | Outcome-based add-on provides upside when agents perform well. Expert tier ($799) targets high-TVL chains. |
| Competitors copy the model | Differentiation erodes | Data moat: operational experience from real deployments cannot be replicated without actual operation time. |

---

## 9. Success Criteria

| Metric | 3-Month Target | 6-Month Target |
|--------|---------------|---------------|
| Agents deployed (external) | 3-5 | 15-25 |
| Patterns in collective library | 50+ | 200+ |
| Average agent success rate | >85% | >92% |
| Monthly revenue | $1,000-2,000 | $5,000-15,000 |
| Cross-chain pattern transfers | 10+ | 100+ |

---

## 10. Relationship to Existing Plans

### What This Replaces

- **30-day plan v2 subscription model**: General/Premium/Enterprise tier with honor-system Feature Gate
- Replaced by: Experience-based agent pricing with verifiable outcomes

### What This Preserves

- **Self-hosted architecture**: Unchanged. Agent runs on operator's infrastructure.
- **Open-source code**: Unchanged. Code is free. Experience is the product.
- **Technical implementation**: All existing code (AgentOrchestrator, VerifierAgent, v2 API, collectors, etc.) is directly reused.

### What This Adds

- Experience Store + Pattern Extractor (proposal-32 OperationLedger evolution)
- Agent Resume system (new)
- Outcome Tracker + Billing Events (new)
- Experience Transfer Protocol (new)
- Collective Intelligence aggregation (new)
- Public Agent Dashboard (new, website/)
- Experience-based Pricing Engine (new)

---

## 11. Long-term Vision: Agent Marketplace

### Evolution Path

```
Phase 1 (Now → 6mo):    SentinAI creates and deploys agents
                         → "Agent Manufacturer"
                         Revenue: 100% agent hire fees

Phase 2 (6-12mo):        External specialists register agents
                         → "Agent Staffing Agency"
                         Revenue: 30% platform commission

Phase 3 (12-24mo):       Agents autonomously collaborate and compete
                         → "Agent Economy Platform"
                         Revenue: platform fees + data access + premium placement
```

### Why This Evolution Is Natural

SentinAI already has 90% of the marketplace infrastructure:

| Existing Infrastructure | Marketplace Role |
|------------------------|-----------------|
| AgentOrchestrator | Agent execution runtime |
| EventBus | Inter-agent communication protocol |
| VerifierAgent | **Trust verification layer** (the core moat) |
| OperationLedger | Agent performance record book |
| Protocol Descriptors | Environment definitions agents can operate in |
| v2 Instance API | Agent deployment/management interface |
| Collective Intelligence | Shared knowledge base across all agents |

The only missing pieces are: agent registration, third-party verification, and revenue sharing.

### Marketplace Structure

```
Agent Creators                SentinAI Platform               L2 Operators
(Specialists)                 (Marketplace)                   (Customers)

OP Stack expert ──┐           ┌─ Agent Registry               ┌─ "Need OP Stack agent"
Arbitrum expert ──┤  Register │  (resume, track record, tier)  │
Security auditor ──┤ ───────→ ├─ Trust Verification Layer     ├─ Compare agents
Cost optimizer ───┤           │  (VerifierAgent-based)         │
Community dev ────┘           ├─ Execution Runtime             ├─ Hire (auto-deploy)
                              │  (AgentOrchestrator)           │
                              ├─ Revenue Distribution          └─ Pay for outcomes
                              │  (70% creator / 30% platform)
                              └─ Reputation System
                                 (performance-based auto-rating)
```

### Agent Diversity

Current state: one agent type (Guardian) built by SentinAI.

Marketplace enables an ecosystem of specialized agents:

**Function-specific agents:**

| Agent | Specialty | Creator |
|-------|-----------|---------|
| Guardian Agent | Anomaly detection + auto-remediation | SentinAI (first-party) |
| Cost Optimizer | Infrastructure cost reduction | Third-party infra specialist |
| Security Auditor | P2P attack detection, abnormal TX patterns | Security firm |
| Compliance Agent | Regulatory monitoring, audit logging | Consulting firm |
| Performance Agent | Latency optimization, cache strategies | Infra specialist |

**Chain-specific agents:**

| Agent | Specialty | Creator |
|-------|-----------|---------|
| OP Stack Specialist | op-node/batcher/proposer deep ops | SentinAI |
| Arbitrum Nitro Expert | Sequencer inbox + challenge handling | Third-party |
| ZK Stack Prover Agent | GPU prover optimization | ZK specialist |
| Starknet Agent | Cairo VM monitoring | Community |

**Infrastructure-specific agents:**

| Agent | Specialty | Creator |
|-------|-----------|---------|
| AWS Agent | EKS/Fargate optimization | AWS specialist |
| GCP Agent | GKE cost optimization | GCP specialist |
| Bare Metal Agent | Physical server monitoring | Hosting specialist |

### Revenue Model at Each Phase

**Phase 1: Manufacturer** (current plan)
```
Revenue = Agent hire fees (100%)
Example: 20 agents × $400 avg = $8,000/month
```

**Phase 2: Marketplace**
```
Revenue sources:
  1. Commission (30%)              — on every agent hire
  2. Verification fee ($99)        — per agent registration/certification
  3. Premium placement ($49/mo)    — marketplace top listing
  4. Runtime fee                   — AgentOrchestrator usage
  5. Data access ($199/mo)         — Collective Intelligence subscription

Example: 100 agents on platform
  Commission: 100 × $400 avg × 30% = $12,000/month
  Verification: 20 new agents/mo × $99 = $1,980/month
  Data access: 50 subscribers × $199 = $9,950/month
  Total: ~$24,000/month
```

**Phase 3: Platform Economy**
```
Revenue follows platform dynamics:
  More agents → more choice → more operators → more agents
  Network effects compound — platform value grows exponentially

  Target: 500+ agents, 200+ operators
  Revenue: $100K-300K/month (platform + data + premium services)
```

### The Platform Moat: Trust Verification

**Why operators go through the marketplace instead of installing agents directly:**

```
Direct install (no platform):
  → Download agent code from GitHub
  → "Does this agent actually work well?" → Unknown
  → Run on my infra, incident happens → Who is responsible?
  → No verified track record, no quality guarantee

Via marketplace:
  → VerifierAgent independently verifies agent performance
  → "This agent has 93.7% success rate across 12 chains"
  → Falsified records → agent removed from platform
  → Platform guarantees quality through verification
```

This is the **App Store model**: code is available anywhere, but verified quality assurance is only available through the platform. The VerifierAgent — already built — is the trust infrastructure that makes this marketplace possible.

### Agent Protocol Standard

For third-party agents to integrate, SentinAI defines a standard agent interface:

```
Agent Protocol v1 (built on existing interfaces):

Required implementations:
  MetricsCollector    — how the agent collects data
  AnomalyDetector     — how the agent detects issues
  PlaybookExecutor    — how the agent takes action
  VerificationHook    — how the agent reports outcomes

Required metadata:
  AgentManifest {
    id: string
    name: string
    version: string
    creator: string
    supportedProtocols: ProtocolId[]     // which chains it works with
    requiredCapabilities: Capability[]   // what permissions it needs
    pricingModel: PricingConfig          // hire rate structure
  }

Lifecycle (managed by AgentOrchestrator):
  register → verify → deploy → monitor → rate → compensate
```

All of these interfaces already exist in the codebase (MetricsCollector in `src/core/collectors/types.ts`, anomaly detection in `src/core/anomaly/`, playbooks in the remediation engine). The Agent Protocol standard is a formalization of existing patterns.

### Technical Requirements for Marketplace (Phase 2)

| Component | Description | Effort |
|-----------|------------|--------|
| `src/core/agent-registry.ts` | Third-party agent CRUD, manifest validation, version management | 3-4d |
| `src/lib/agent-verifier.ts` | Sandbox testing of registered agents, automated quality checks | 4-5d |
| `src/lib/revenue-distributor.ts` | Track agent earnings, calculate splits, emit payout events | 2-3d |
| `src/lib/reputation-engine.ts` | Performance-based scoring, automatic tier promotion/demotion | 2-3d |
| `src/app/api/v2/marketplace/` | Agent browsing, comparison, hiring API routes | 3-4d |
| `website/src/app/marketplace/` | Public marketplace UI with search, filtering, agent profiles | 4-5d |
| Agent Protocol SDK | npm package for third-party agent developers | 3-4d |

Total estimated effort: 4-5 weeks (Phase 2, after Agent-for-Hire model is validated)

### Marketplace Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Low-quality agents damage platform reputation | Operator trust erodes | Mandatory sandbox verification before listing. VerifierAgent monitors live performance. Auto-delist below 70% success rate. |
| Malicious agents (data exfiltration, sabotage) | Security breach | Capability-based permissions (agent declares what it needs). Sandbox execution. Code review for Premium-listed agents. |
| Creator churn (agents abandoned) | Stale marketplace | Auto-archive agents with no updates for 90 days. Community fork mechanism for abandoned popular agents. |
| Platform vs. creator conflict | Creators leave | Transparent 70/30 split. Creator retains IP. Open protocol means creators can self-host (but lose verification benefits). |

---

## 12. Summary: The Three Horizons

```
Horizon 1 (Now → 6 months)
  Model:    Agent-for-Hire
  Product:  SentinAI agents with verifiable experience
  Revenue:  Direct hire fees ($199-$799/agent/month)
  Moat:     Operational experience data
  Target:   $5K-15K/month

Horizon 2 (6-12 months)
  Model:    Agent Marketplace
  Product:  Platform for third-party agent creators
  Revenue:  30% commission + verification fees + data access
  Moat:     Trust verification infrastructure + network effects
  Target:   $20K-50K/month

Horizon 3 (12-24 months)
  Model:    Agent Economy Platform
  Product:  Self-sustaining ecosystem of specialized agents
  Revenue:  Platform fees + data + premium services
  Moat:     Network effects (more agents ↔ more operators)
  Target:   $100K-300K/month
```

Each horizon builds on the previous one. No horizon requires discarding prior work — only extending it.

---

*Generated from SentinAI 30-day plan v2 evaluation session, 2026-03-03*
