# L1 Proxyd Failover Setup Guide

This guide explains how to configure SentinAI's L1 RPC failover system to work with **Proxyd** (eth-optimism/infra load balancer) for **L2 node protection**.

## When Failover is Needed

### ✅ Failover Required
- **L2 Nodes** (op-node, op-batcher, op-proposer)
  - Use **Paid L1 RPC endpoints** with limited monthly quotas
  - Low call frequency → quota may reach free tier boundary
  - **Critical**: Quota exceeded (429) → block production stops
  - **Solution**: Configure multiple endpoints with automatic failover

- **L1 Proxyd** (L2 nodes' L1 RPC router)
  - Routes all L2 node L1 calls through Proxyd
  - Proxyd's upstream config must match active L1 RPC
  - **SentinAI failover updates Proxyd ConfigMap automatically**

### ❌ Failover Not Required
- **SentinAI Service** (monitoring & AI analysis)
  - Uses **Public L1 RPC** (publicnode.com)
  - High call volume (~24/7) → quota easily covered
  - Designed for monitoring, not block production
  - Temporary unavailability is acceptable

## Architecture Overview

```
┌──────────────────────────────────────┐
│  SentinAI Monitoring Service         │
│  (AI, anomaly detection, etc.)       │
├──────────────────────────────────────┤
│  L1 RPC: publicnode.com (public)     │
│  Role: Read-only monitoring          │
│  Failover: Not required              │
└──────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  L2 Block Production (op-node)                   │
│  + L2 Batch Submission (op-batcher)              │
│  + L2 Output Submission (op-proposer)            │
│  + L1 Proxyd (L1 RPC router)                     │
├──────────────────────────────────────────────────┤
│  L1 RPC: Paid endpoints (limited quota)          │
│  Role: Block generation (CRITICAL)               │
│  Failover: REQUIRED (quota exhaustion handling) │
│                                                  │
│  ┌──────────────────────────────────────────┐  │
│  │ L1 Proxyd ConfigMap (TOML)               │  │
│  │ [[upstreams]]                            │  │
│  │ name = "main"                            │  │
│  │ rpc_url = "https://paid-rpc1.io"         │  │
│  │                                          │  │
│  │ Updated by SentinAI on L1 RPC failure ◄───┤─ Failover trigger
│  └──────────────────────────────────────────┘  │
│          │                                      │
│          ▼                                      │
│  op-node ─────────────────────────────────────┤
│  op-batcher ──── via Proxyd :8080 ────────────┤
│  op-proposer ────────────────────────────────┤
└──────────────────────────────────────────────────┘
```

## Prerequisites

### Required Infrastructure

1. **Proxyd Deployment**: Proxyd must be running in your K8s cluster
   - Used by op-node, op-batcher, op-proposer as L1 RPC router
   - Example: `http://proxyd-service:8080`

2. **ConfigMap**: `proxyd-config` ConfigMap with `proxyd.toml` data key
   - Contains upstream L1 RPC URLs
   - Must be in same namespace as L2 nodes

3. **RBAC**: SentinAI service account needs permissions
   ```yaml
   - get + patch permissions: ConfigMaps (proxyd-config)
   - get + patch permissions: StatefulSets (op-node, op-batcher, op-proposer)
   ```

### RPC Endpoint Strategy

**SentinAI Service**:
- Uses `publicnode.com` (public, unlimited)
- No configuration needed
- `getActiveL1RpcUrl()` returns publicnode

**L2 Nodes** (op-node, op-batcher, op-proposer):
- Use Paid endpoints (Alchemy, Infura, Ankr, etc.)
- Limited monthly quota
- **Must configure**: `L1_RPC_URLS` with 2+ endpoints
- Failover detects quota exhaustion → switches endpoints

## Step 1: Verify Proxyd ConfigMap

Check your Proxyd configuration:

```bash
kubectl get configmap proxyd-config -o yaml
```

Expected structure:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: proxyd-config
  namespace: default
data:
  proxyd.toml: |
    [[upstreams]]
    name = "main"
    rpc_url = "https://ethereum-sepolia-rpc.publicnode.com"

    [[upstreams]]
    name = "fallback"
    rpc_url = "https://rpc.ankr.com/eth_sepolia"

    [[backends]]
    rpc_url = "main"
    ws_url = "main"
```

## Step 2: Configure RBAC Permissions

Add ConfigMap permissions to SentinAI's service account:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sentinai-proxyd-manager
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["proxyd-config"]
    verbs: ["get", "patch"]
  - apiGroups: ["apps"]
    resources: ["statefulsets"]
    verbs: ["get", "patch"]
```

Apply:

```bash
kubectl apply -f sentinai-rbac.yaml
kubectl create rolebinding sentinai-proxyd --role=sentinai-proxyd-manager --serviceaccount=default:sentinai
```

## Step 3: Update SentinAI Environment Variables

Edit `.env.local`:

```bash
# ========================================
# SentinAI Monitoring (public RPC OK)
# ========================================
# Not configured → uses publicnode.com automatically
# No failover needed for SentinAI itself

# ========================================
# L2 Node Protection (paid RPC + failover)
# ========================================

# Enable Proxyd failover mode
L1_PROXYD_ENABLED=true

# Proxyd ConfigMap details
L1_PROXYD_CONFIGMAP_NAME=proxyd-config      # K8s ConfigMap name
L1_PROXYD_DATA_KEY=proxyd.toml               # Key in ConfigMap
L1_PROXYD_UPSTREAM_GROUP=main                # Upstream group in TOML

# L1 RPC endpoints for L2 node failover (CRITICAL)
# Use 2+ paid endpoints with independent quotas
L1_RPC_URLS=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY,https://mainnet.infura.io/v3/YOUR_INFURA_KEY

# K8s StatefulSet prefix (for kubectl updates)
K8S_STATEFULSET_PREFIX=sepolia-thanos-stack
```

**Important Notes**:
- `L1_RPC_URLS`: Configure for **L2 nodes** (paid endpoints)
  - Alchemy quota exhaustion → switch to Infura
  - Infura quota exhaustion → switch to Ankr
  - All exhausted → fall back to publicnode (slow, but blocks don't stop)

- `L1_PROXYD_ENABLED=true`: Updates Proxyd ConfigMap on failover
  - Proxyd routes all L2 node traffic through updated upstream
  - Automatic ConfigMap watch reloads config

- SentinAI monitoring: No configuration needed
  - Automatically uses publicnode.com
  - No risk of quota exhaustion
  - Failover only protects L2 nodes

## Step 4: Test Failover

Trigger a manual failover test:

```bash
# Method 1: Simulate failure (set primary RPC to invalid URL)
L1_RPC_URLS=https://dead-rpc.invalid npm run dev

# Wait for 3 consecutive L1 failures

# Check logs
npm run dev 2>&1 | grep "L1 Failover"
```

Expected output:

```
[L1 Failover] Switched: https://dead-rpc.invalid → https://paid-rpc1.io (reason: 3 consecutive failures)
[L1 Failover] Updated Proxyd ConfigMap proxyd-config/proxyd.toml: https://publicnode.com → https://paid-rpc1.io
```

**Note**: ConfigMap update is sufficient. All L2 nodes (op-node, op-batcher, op-proposer) immediately route through Proxyd with the new RPC endpoint. Optional pod env var updates are only logged if not using Proxyd.

## Step 5: Verify ConfigMap Update

Check that the ConfigMap was updated:

```bash
kubectl get configmap proxyd-config -o jsonpath='{.data.proxyd\.toml}' | grep rpc_url
```

Expected:

```toml
rpc_url = "https://paid-rpc1.io"  # <-- Updated to new URL
```

## How Failover Works

### Failure Scenario

```
Time: t0 → Block production: NORMAL
    op-node → Proxyd → Paid L1 RPC (Alchemy) [OK]
    └─ Blocks: 1000, 1001, 1002, ... ✅

Time: t1 → Quota exhausted (429 Too Many Requests)
    op-node → Proxyd → Paid L1 RPC (Alchemy) [FAIL] ❌
    └─ Cannot get L1 block number
    └─ Block production: STALLED

Time: t2 → 3 consecutive failures detected
    SentinAI agent loop: failure_count = 3
    └─ Triggers L1 RPC failover
    └─ Action: Find healthy backup endpoint
```

### Failover Execution (ConfigMap-Centric)

**Primary: Proxyd ConfigMap Update** (sufficient for all L2 nodes)
```bash
# Current
kubectl get configmap proxyd-config
# proxyd.toml:
# [[upstreams]]
# name = "main"
# rpc_url = "https://alchemy.io/v2/key1"  ← Quota exhausted

# Update
kubectl patch configmap proxyd-config --type=json \
  -p='[{"op":"replace","path":"/data/proxyd.toml","value":"[[upstreams]]...rpc_url=\"https://infura.io/v3/key2\""}]'

# Result: Proxyd auto-watches ConfigMap
# → Proxyd reloads TOML (automatic)
# → All L2 nodes route through Proxyd with new Infura endpoint
# → op-node, op-batcher, op-proposer all get fresh quota ✅
# → NO pod restarts needed (instant effect)
```

**Key Point**: ConfigMap update applies to ALL L2 nodes regardless of their deployment type:
- ✅ op-node (may be StatefulSet or Pod)
- ✅ op-batcher (Pod - NOT StatefulSet)
- ✅ op-proposer (Pod - NOT StatefulSet)

**Optional: Individual Pod Env Vars** (backup, only if not using Proxyd)
```bash
# Only if L2 nodes configured for DIRECT L1 RPC (bypassing Proxyd)
# This is NOT the recommended approach when Proxyd is available

# Environment variables to set (if needed):
# OP_NODE_L1_ETH_RPC=https://infura.io/v3/key2
# OP_BATCHER_L1_ETH_RPC=https://infura.io/v3/key2
# OP_PROPOSER_L1_ETH_RPC=https://infura.io/v3/key2

kubectl set env pod/op-node-0 OP_NODE_L1_ETH_RPC=https://infura.io/v3/key2
# (Note: op-batcher and op-proposer are Pods, not StatefulSets)
```

### Recovery Timeline

```
t0: Block production running
    └─ 3 failures detected ❌

t0+100ms: Proxyd ConfigMap updated
          └─ Proxyd auto-reloads TOML (watches ConfigMap)
          └─ New L1 RPC: Infura ✅
          └─ op-node, op-batcher, op-proposer immediately route through new endpoint
          └─ Block production resumes ✅
```

### ConfigMap-First Approach

| Aspect | Details |
|--------|---------|
| **What to Update** | Proxyd ConfigMap only |
| **Effect** | Instant (~100ms) |
| **Coverage** | All L2 nodes (op-node, op-batcher, op-proposer) |
| **Pod Restarts** | None required |
| **Dependency on Deployment Type** | None (works for StatefulSet, Pod, or mixed) |

**Recommendation**: Update ONLY Proxyd ConfigMap. This is:
- ✅ Simplest (no per-node updates)
- ✅ Fastest (instant, no pod restarts)
- ✅ Most Reliable (central RPC router)
- ✅ Independent of L2 node deployment type

### Failover Cooldown

- **5-minute cooldown** between failovers
- Prevents flapping between endpoints
- Example: If Infura also fails after 1 minute, failover is blocked until 4 minutes pass
- Can be adjusted: `MAX_FAILOVER_COOLDOWN_MS` in `src/lib/l1-rpc-failover.ts`

## Rollback

If Proxyd mode causes issues, disable it:

```bash
# .env.local
L1_PROXYD_ENABLED=false
```

Restart SentinAI. Failover will revert to updating individual pod environment variables (OP_NODE_L1_ETH_RPC, OP_BATCHER_L1_ETH_RPC, OP_PROPOSER_L1_ETH_RPC).

## Advanced: Append Mode

Instead of replacing the upstream URL, you can **append** new upstreams:

```bash
L1_PROXYD_UPDATE_MODE=append
```

This creates a new upstream entry and renames the old one to `main-backup-<timestamp>`.

**Example**:
```toml
# Before
[[upstreams]]
name = "main"
rpc_url = "https://old-rpc.io"

# After (append mode)
[[upstreams]]
name = "main"
rpc_url = "https://new-rpc.io"

[[upstreams]]
name = "main-backup-1707000000000"
rpc_url = "https://old-rpc.io"
```

## Troubleshooting

### Issue: "ConfigMap proxyd-config not found"

```bash
kubectl get configmap proxyd-config -n default
```

**Solutions**:
- Verify Proxyd is deployed: `kubectl get deployment proxyd`
- Check ConfigMap name matches `L1_PROXYD_CONFIGMAP_NAME`
- Verify namespace: `kubectl get configmap -n <namespace>`

### Issue: "Permission denied" when patching ConfigMap

Check RBAC:

```bash
kubectl auth can-i patch configmap/proxyd-config --as=system:serviceaccount:default:sentinai
```

**Solutions**:
- Apply RBAC Role and RoleBinding from Step 2
- Verify service account: `kubectl get serviceaccount -n default`

### Issue: "TOML parse failed"

Validate TOML syntax:

```bash
kubectl get configmap proxyd-config -o jsonpath='{.data.proxyd\.toml}' > /tmp/proxyd.toml
cat /tmp/proxyd.toml

# Use online TOML validator or toml-cli
npm install -g toml-cli
toml-cli /tmp/proxyd.toml
```

**Common TOML issues**:
- Unmatched quotes: `rpc_url = "https://...` (missing closing quote)
- Missing section headers: `[[upstreams]]` (must start with `[[`)
- Indentation errors (TOML doesn't require indentation, but keep it consistent)

### Issue: Failover doesn't trigger (L1 RPC still works)

**Debug**:
- Check L1 RPC health: `curl https://your-rpc.io -X POST -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}'`
- Monitor logs for consecutive failures
- Manually inject failures for testing: `L1_RPC_URL=https://invalid-rpc.invalid npm run dev`

### Issue: ConfigMap updated but Proxyd still using old endpoint

**Solutions**:
- Proxyd needs to **watch** ConfigMap for changes (should be automatic)
- If using custom Proxyd, ensure ConfigMap watch is enabled
- Manual reload: Restart Proxyd pods
  ```bash
  kubectl rollout restart deployment/proxyd
  ```

## Monitoring

### Check Failover Events

Via API (if exposed):

```bash
curl http://localhost:3002/api/l1-failover/events | jq
```

### View Recent Logs

```bash
# Docker
docker logs sentinai -f | grep "L1 Failover"

# K8s
kubectl logs -f deployment/sentinai -c sentinai | grep "L1 Failover"
```

### Expected Log Pattern

```
[L1 Failover] L1 RPC failed, attempting failover...
[L1 Failover] Checking candidate: https://rpc1.io
[L1 Failover] Checking candidate: https://rpc2.io
[L1 Failover] Switched: https://old.io → https://rpc2.io (reason: 3 consecutive failures)
[L1 Failover] Updated Proxyd ConfigMap proxyd-config/proxyd.toml: https://old.io → https://rpc2.io
```

**Result**: Proxyd ConfigMap updated instantly (~100ms)
- ✅ op-node, op-batcher, op-proposer all route through new endpoint
- ✅ Block production resumes immediately
- ✅ No pod restarts needed

## Performance Impact

- **ConfigMap Update Time**: ~560ms (read + parse + patch)
- **Total Failover Time**: ~2.1s (ConfigMap + 3 StatefulSets)
- **Memory**: TOML parsing library adds ~50KB

## Key Takeaways

### ✅ What Failover Protects

| Component | RPC Type | Status | Failover |
|-----------|----------|--------|----------|
| SentinAI Service | public (publicnode) | ✅ OK | ❌ Not needed |
| op-node | paid (quota-limited) | ⚠️ At risk | ✅ Protected |
| op-batcher | paid (quota-limited) | ⚠️ At risk | ✅ Protected |
| op-proposer | paid (quota-limited) | ⚠️ At risk | ✅ Protected |
| L1 Proxyd | routes via ConfigMap | ⚠️ At risk | ✅ Protected |

### 🚨 Without Failover: What Happens?

```
Month 1-2: Normal operation
  └─ Paid RPC used occasionally
  └─ Quota cost: $0.05/day (free tier reached)

Month 3: Quota exhaustion
  ├─ RPC returns 429 (rate limited)
  ├─ op-node cannot fetch L1 blocks
  ├─ Block production: STALLED ❌
  └─ L2 network DOWN

Cost to fix: Manual intervention, lost blocks, reputation damage
```

### ✅ With Failover: What Happens?

```
Month 1-2: Normal operation
  └─ Paid RPC used occasionally
  └─ Quota cost: $0.05/day (free tier reached)

Month 3: Quota exhaustion
  ├─ SentinAI detects 3 consecutive L1 RPC failures
  ├─ Automatically switches to backup paid RPC
  ├─ Updates Proxyd ConfigMap (100ms)
  ├─ Updates StatefulSet env vars (5s rolling restart)
  ├─ Block production: RESUMED ✅
  └─ Cost: $0.10/day split between 2 providers

Cost to fix: Zero (automatic), no downtime, no manual intervention
```

## Related Documentation

- **CLAUDE.md**: L1 Proxyd environment variables
- **.env.local.sample**: Configuration template
- **ARCHITECTURE.md**: L1 Failover architecture
- **src/lib/l1-rpc-failover.ts**: Implementation details
