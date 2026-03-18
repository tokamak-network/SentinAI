# PRD: Setup Wizard v2

## Problem

The current `npm run setup` (`scripts/setup.mjs`, 668 lines) has issues:

1. **Too many questions** — asks about AI provider details, K8s config, Proxyd, EOA, LLM test all at once
2. **No progressive disclosure** — beginners see the same 30+ questions as power users
3. **No validation feedback** — user enters an API key but doesn't know if it works until they run the app
4. **No resume** — if you quit halfway, you start over
5. **Outdated variables** — still references deprecated vars (`L1_RPC_URL`, `K8S_STATEFULSET_PREFIX`, `EOA_BALANCE_EMERGENCY_ETH`)

## Goal

A step-by-step CLI wizard that:
- Gets users running in **under 60 seconds** (Quick mode: 3 questions)
- Validates inputs in real-time (RPC connectivity, API key validity, K8s access)
- Generates a clean `.env.local` with only what's needed
- Can be re-run safely to add/modify specific sections

## Environment Variables — Completeness Audit

### Covered by Wizard (user-facing)

| Category | Variables | Wizard Step |
|---|---|---|
| **Required** | `L2_RPC_URL` | Step 1 |
| **AI Provider** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `QWEN_API_KEY`, `AI_GATEWAY_URL` | Step 2 |
| **K8s** | `AWS_CLUSTER_NAME`, `K8S_NAMESPACE`, `K8S_APP_PREFIX`, `AWS_REGION` | Step 3 |
| **L1 RPC** | `L1_RPC_URLS` (spare URLs for L2 node 429 failover) | Step 4 |
| **L1 Proxyd** | `L1_PROXYD_ENABLED`, `L1_PROXYD_CONFIGMAP_NAME`, `L1_PROXYD_DATA_KEY`, `L1_PROXYD_UPSTREAM_GROUP`, `L1_PROXYD_UPDATE_MODE` | Step 4 (sub-section) |
| **EOA** | `BATCHER_EOA_ADDRESS`, `PROPOSER_EOA_ADDRESS`, `BATCHER_PRIVATE_KEY`, `PROPOSER_PRIVATE_KEY`, `TREASURY_PRIVATE_KEY`, `EOA_BALANCE_WARNING_ETH`, `EOA_BALANCE_CRITICAL_ETH` | Step 5 |
| **Alerts** | `ALERT_WEBHOOK_URL` | Step 6 |
| **Advanced** | `REDIS_URL`, `COST_TRACKING_ENABLED`, `CLOUDFLARE_TUNNEL_TOKEN`, `AGENT_LOOP_ENABLED`, `AUTO_REMEDIATION_ENABLED`, `ANOMALY_DETECTION_ENABLED`, `SCALING_SIMULATION_MODE` | Step 7 (Advanced) |

### Auto-detected (no user input needed)

| Variable | Detection Method |
|---|---|
| `K8S_API_URL` | `aws eks describe-cluster` |
| `K8S_TOKEN` | `aws eks get-token` |
| `AWS_PROFILE` | Standard AWS credential chain |

### Hidden (defaults are fine, docs only)

| Variable | Default | Reason |
|---|---|---|
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | Fine-tuning, docs reference |
| `EOA_REFILL_MAX_DAILY_ETH` | `5.0` | Fine-tuning, docs reference |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | Fine-tuning, docs reference |
| `EOA_GAS_GUARD_GWEI` | `100` | Fine-tuning, docs reference |
| `EOA_TREASURY_MIN_ETH` | `1.0` | Fine-tuning, docs reference |
| `REMEDIATION_ALLOW_GUARDED` | — | Advanced remediation |
| `REMEDIATION_COOLDOWN_MIN` | — | Advanced remediation |
| `REMEDIATION_MAX_VCPU` | — | Advanced remediation |
| `K8S_INSECURE_TLS` | `false` | Dev only |
| `KUBECONFIG` | — | Alternative to EKS |

### Excluded (internal / test only)

| Variable | Reason |
|---|---|
| `LLM_TEST_*` (6 vars) | Moved to `.env.test.sample` |
| `NEXT_RUNTIME`, `NODE_ENV` | Next.js internal |
| `NLOPS_ENABLED` | Legacy / unimplemented |
| `REPORTS_DIR` | Internal path |

## Design

### Flow

```
npm run setup

┌─────────────────────────────────────┐
│  SentinAI Setup Wizard              │
│  ─────────────────────              │
│  Existing .env.local detected.      │
│  • Reconfigure from scratch         │
│  • Modify specific section          │
│  • Validate current config          │
└─────────────────────────────────────┘
```

### Steps (Progressive)

```
Step 1: L2 RPC          (required)
  → Enter URL → validate connection → show chain ID & block height

Step 2: AI Provider      (required for AI features)
  → Pick provider (Anthropic/OpenAI/Gemini/Qwen)
  → Enter API key → test with a simple completion → show ✓
  → "Route through an AI gateway/proxy? (y/N)"
    → If yes: enter AI_GATEWAY_URL

Step 3: K8s Monitoring   (optional, skip by default)
  → "Do you have a K8s cluster to monitor? (y/N)"
  → If yes: enter cluster name → validate with aws eks describe-cluster
  → Show: region, endpoint, namespace
  → Optional: K8S_NAMESPACE, K8S_APP_PREFIX

Step 4: L1 RPC           (optional, skip by default)
  → "Configure spare L1 RPC endpoints for 429 failover? (y/N)"
  → If yes: enter comma-separated URLs → test each → show latency
  → Note: Used as spare URLs when L2 nodes hit 429 errors 10x consecutively
  → Default: publicnode.com fallback (no config needed)
  → "Enable L1 Proxyd integration? (y/N)"
    → If yes: ConfigMap name, data key, upstream group

Step 5: EOA Monitoring   (optional, skip by default)
  → "Monitor batcher/proposer ETH balances? (y/N)"
  → If yes: enter addresses or private keys
  → Optional: treasury key for auto-refill

Step 6: Alerts           (optional, skip by default)
  → "Set up webhook alerts? (y/N)"
  → If yes: enter webhook URL → send test message → confirm delivery

Step 7: Summary & Write
  → Show all configured values (masked secrets)
  → "Configure advanced settings? (y/N)"
    → Redis, Cost Tracking, Cloudflare Tunnel, Simulation Mode, etc.
  → Write .env.local
  → "Run `npm run dev` to start SentinAI"
```

### Modify Mode

When `.env.local` already exists, allow modifying a specific section:

```
What would you like to configure?
  1. L2 RPC
  2. AI Provider
  3. K8s Monitoring
  4. L1 RPC & Proxyd
  5. EOA Monitoring
  6. Alerts
  7. Advanced (Redis, Cost Tracking, Cloudflare, etc.)
```

### Validate Mode

Run all validation checks on existing `.env.local`:

```
Validating .env.local...
  ✓ L2_RPC_URL          connected (chain 111551119090, block #4,521,003)
  ✓ ANTHROPIC_API_KEY    valid (claude-haiku-4.5 responding)
  ✓ AI_GATEWAY_URL       reachable (https://your-gateway.com)
  ✓ AWS_CLUSTER_NAME     found (us-east-1, endpoint reachable)
  ✓ L1_RPC_URLS          3 spare endpoints configured (all reachable, avg 120ms)
  ○ EOA addresses        not configured (optional)
  ○ ALERT_WEBHOOK_URL    not configured (optional)
```

## Key Design Decision: L1_RPC_URLS

`L1_RPC_URLS` serves as the **single** L1 RPC variable:
- **Primary use**: Spare URL pool for L2 node 429 failover
- **Trigger**: When an L2 node (op-node, op-batcher, op-proposer) hits **10 consecutive 429 errors**, SentinAI swaps to the next URL from this list
- **Replaces**: `L1_PROXYD_SPARE_URLS` (deprecated, merged into `L1_RPC_URLS`)
- **Fallback**: If not set, uses publicnode.com as last resort

This means:
- `L1_RPC_URLS` = spare/failover URLs (not the primary L1 RPC used by L2 nodes)
- L2 nodes get their primary L1 RPC from K8s ConfigMap / Proxyd config
- SentinAI only intervenes when 429 threshold is breached

## Technical Spec

### Stack
- **Runtime**: Node.js (ESM, `scripts/setup.mjs`)
- **No dependencies**: Use only `node:readline`, `node:fs`, `node:child_process`, `node:https`
- **Validation**: Direct HTTP requests for RPC/API testing (no SDK needed)

### Validation Methods

| Check | Method |
|---|---|
| L2 RPC | `POST` with `eth_chainId` + `eth_blockNumber` JSON-RPC |
| AI key (Anthropic) | `POST /v1/messages` with minimal prompt, check 200 |
| AI key (OpenAI) | `POST /v1/chat/completions` with minimal prompt, check 200 |
| AI key (Gemini) | `POST /v1beta/models/gemini-2.5-flash-lite:generateContent` |
| AI key (Qwen) | `POST /v1/chat/completions` to DashScope endpoint |
| AI Gateway | `HEAD` or `GET /health` to gateway URL, check reachable |
| K8s cluster | `aws eks describe-cluster --name <name>` via execFileSync |
| L1 RPC | `POST` with `eth_blockNumber`, measure latency per endpoint |
| Webhook | `POST` with test payload, check 2xx response |

### .env.local Generation

- Only write variables the user explicitly configured
- Comment out optional sections with descriptive headers
- Preserve any existing variables not covered by the wizard (don't clobber custom vars)

### Output Format

```bash
# ==========================================
# SentinAI Configuration
# Generated by setup wizard on 2026-02-14
# Docs: docs/guide/ENV_GUIDE.md
# ==========================================

# === Required ===
L2_RPC_URL=https://rpc.titok.tokamak.network

# === AI Provider ===
ANTHROPIC_API_KEY=sk-ant-xxx
# AI_GATEWAY_URL=https://your-gateway.com   # (optional) Route AI requests through proxy

# === K8s Monitoring ===
# Not configured. Run `npm run setup` to add.

# === L1 RPC (Spare URLs for 429 Failover) ===
# L1_RPC_URLS=https://rpc1.example.com,https://rpc2.example.com
# Used when L2 nodes hit 429 errors 10x consecutively

# === EOA Monitoring ===
# Not configured. Run `npm run setup` to add.

# === Alerts ===
# Not configured. Run `npm run setup` to add.
```

## UX Guidelines

1. **Color output**: Green ✓ for success, Red ✗ for failure, Yellow ○ for skipped
2. **Smart defaults**: Pre-fill with detected values (e.g., AWS region from `aws configure`)
3. **Masked secrets**: Show `sk-ant-...BcFg` format for API keys in summary
4. **Non-destructive**: Always back up existing `.env.local` before overwriting
5. **Exit gracefully**: Ctrl+C shows "Setup cancelled. No changes made."

## Scope

### In Scope
- Replace current `scripts/setup.mjs` entirely
- All validation checks listed above
- Fresh / Modify / Validate modes
- `.env.local` backup before overwrite

### Out of Scope
- Web UI (future: Telegram Mini App onboarding)
- LLM stress test config (moved to `.env.test.sample`)
- EOA auto-refill fine-tuning params (use defaults, point to ENV_GUIDE.md)
- Remediation fine-tuning params (use defaults, point to ENV_GUIDE.md)

## Code Changes Required (Pre-Wizard)

Before building the wizard, these code changes are needed:

1. **Merge `L1_PROXYD_SPARE_URLS` into `L1_RPC_URLS`** in `src/lib/l1-rpc-failover.ts`
   - Remove `L1_PROXYD_SPARE_URLS` references
   - Use `L1_RPC_URLS` as the spare URL pool for 429 backend replacement
   - Update 429 threshold to 10 consecutive errors

2. **Deprecate `L1_RPC_URL`** (already done — prints warning, falls back)

3. **Update `.env.local.sample`** to reflect merged L1_RPC_URLS usage

## Success Criteria

- [ ] New user can go from `git clone` to running dashboard in < 60 seconds
- [ ] Re-running setup preserves existing config unless explicitly changed
- [ ] All validation checks pass/fail with clear feedback
- [ ] Zero external dependencies (pure Node.js)
- [ ] Deprecated env vars not shown in wizard
- [ ] Every `process.env.*` in production code is either in wizard, auto-detected, or documented as hidden/internal
