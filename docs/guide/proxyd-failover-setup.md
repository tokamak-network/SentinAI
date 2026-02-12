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

**Step 1: Update Proxyd ConfigMap** (both upstreams AND backends)

```bash
# Current state
kubectl get configmap proxyd-config -o yaml
# data:
#   proxyd.toml: |
#     [[upstreams]]
#     name = "main"
#     rpc_url = "https://alchemy.io/v2/key1"  ← Quota exhausted
#     ws_url = "wss://alchemy.io/v2/key1"
#
#     [[backends]]
#     rpc_url = "main"
#     ws_url = "main"

# SentinAI updates via kubectl patch:
# 1. Changes upstreams[name="main"].rpc_url → https://infura.io/v3/key2
# 2. Changes upstreams[name="main"].ws_url → wss://infura.io/v3/key2
# 3. Ensures backends[].rpc_url still references "main" (no change needed)
# 4. Ensures backends[].ws_url still references "main" (no change needed)

kubectl patch configmap proxyd-config --type=json \
  -p='[{"op":"replace","path":"/data/proxyd.toml","value":"[[upstreams]]..."}]'

echo "[L1 Failover] Updated Proxyd ConfigMap: https://alchemy.io → https://infura.io"
```

**Step 2: Restart Proxyd Pod** (CRITICAL - ConfigMap watcher alone is NOT sufficient)

```bash
# SentinAI automatically triggers pod restart:
kubectl delete pod -l app=proxyd

# Kubernetes deployment/statefulset respawns new Proxyd pod
# → New pod reads updated ConfigMap
# → New pod loads new L1 RPC endpoint (Infura)
# → All L2 nodes now route through Proxyd with fresh quota ✅
```

**Timeline with ConfigMap + Pod Restart**:
```
t=0ms:   ConfigMap updated (upstreams + backends changes applied)
t=10ms:  Proxyd pod deletion triggered
t=50ms:  Proxyd pod respawning
t=500ms: Proxyd pod ready and running
         → Reads updated ConfigMap
         → Loads new upstream (Infura)
         → All L2 node requests now route through Infura ✅

Total downtime: ~500ms (acceptable for L1 RPC router)
```

**Key Points**:
- ✅ ConfigMap update changes **both upstreams AND backends** rpc_url/ws_url
- ✅ Proxyd pod **MUST restart** to load ConfigMap changes
- ✅ All L2 nodes (op-node, op-batcher, op-proposer) benefit from single update
- ✅ Independent of L2 deployment type (StatefulSet, Pod, etc.)

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

**For HTTP 429 (quota exhaustion)**:
```
t=0s:       Block production running
            └─ 10 consecutive 429 failures detected (≥5 minutes)

t=300s+:    Failover triggered
            └─ ConfigMap updated (upstreams + backends changed)
            └─ Proxyd pod restart initiated

t=300s+50ms: Proxyd pod terminating
            └─ Old Proxyd still routing to exhausted Alchemy
            └─ Brief ~50ms window of failure

t=300s+200ms: Proxyd pod respawning
             └─ Reading new ConfigMap

t=300s+500ms: Proxyd pod READY
             └─ Loaded new upstream: Infura ✅
             └─ op-node, op-batcher, op-proposer routing through Infura
             └─ Block production resumes ✅
             └─ Fresh quota available

Total downtime: ~500ms + pod startup time (usually <1s total)
```

**For other errors (timeout, 5xx)**:
```
t=0s:       Block production running
            └─ 3 consecutive failures detected (~90 seconds)

t=90s+:     Failover triggered
            └─ ConfigMap updated
            └─ Proxyd pod restart

t=90s+500ms: New Proxyd pod active
            └─ Backup endpoint available
            └─ Block production resumes ✅

Total downtime: ~500ms
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

## Technical Details: Quota Exhaustion Detection

### Detection Mechanism

SentinAI detects L1 RPC quota exhaustion through **consecutive failure tracking with error-specific thresholds**:

```
Agent Loop (every 30s)
    ↓
    Calls: getBlockNumber() on active L1 RPC endpoint
    ↓
    Failure? (Check error type)
    ↓
    HTTP 429? (quota exhaustion)
    │   YES → Increment 429-counter
    │        └─ Is counter >= 10?
    │           YES → executeFailover() ← Tolerates 10x failures
    │           NO → Continue with same endpoint
    │
    NO (other errors: timeout, 5xx, etc.)
        └─ Increment error-counter
           └─ Is counter >= 3?
              YES → executeFailover() ← Faster failover
              NO → Continue with same endpoint

    SUCCESS → reportL1Success()
             └─ Reset ALL counters to 0
             └─ Mark endpoint as healthy
```

### Error Types and Thresholds

**Different error types have different failover thresholds**:

| Error Type | Threshold | Timeout | Reasoning |
|-----------|-----------|---------|-----------|
| **HTTP 429** (Too Many Requests) | 10 failures | 5+ minutes | Quota exhaustion is often temporary; wait longer before failover |
| **HTTP 5xx** | 3 failures | ~90 seconds | RPC server error; failover quickly |
| **Connection timeout** (>10s) | 3 failures | ~90 seconds | Network issue; failover quickly |
| **ECONNREFUSED** | 3 failures | ~90 seconds | Endpoint offline; failover immediately |
| **RPC Error** | 3 failures | ~90 seconds | Other errors; failover quickly |

**Key Point**: HTTP 429 (quota exhaustion) uses a **higher threshold (10)** to tolerate temporary quota limits. Other errors trigger failover at **3 consecutive failures**:

```javascript
// From l1-rpc-failover.ts
export async function reportL1Failure(error: Error): Promise<string | null> {
  const endpoint = state.endpoints[state.activeIndex];
  if (endpoint) {
    endpoint.consecutiveFailures++;
  }

  // Determine threshold based on error type
  const is429Error = error.message.includes('429') || error.message.includes('quota');
  const threshold = is429Error ? 10 : 3;  // ← Different thresholds

  if (endpoint.consecutiveFailures >= threshold) {
    // Execute failover...
  }
}
```

### Failure Detection Timeline

**Scenario: HTTP 429 (quota exhaustion) - uses 10-failure threshold**

```
t=0s:   L1 RPC call fails: HTTP 429 ← Failure #1
        └─ Quota exhaustion suspected
        └─ Continue with same endpoint (429 is more tolerant)

t=30s:  L1 RPC call fails: HTTP 429 ← Failure #2
        └─ Quota still exhausted
        └─ Continue (7 failures remaining before failover)

t=60s:  L1 RPC call fails: HTTP 429 ← Failure #3
        ...
        └─ Continue (6 failures remaining)

t=270s: L1 RPC call fails: HTTP 429 ← Failure #9
        └─ Continue (1 failure remaining before failover)

t=300s: L1 RPC call fails: HTTP 429 ← Failure #10
        └─ THRESHOLD REACHED (10)
        └─ Failover triggered ← ~100ms
        └─ New endpoint active ✅

t=301s: L1 RPC call succeeds on new endpoint
        └─ Failure counter reset to 0
        └─ New endpoint marked healthy
```

**Scenario: Other errors (timeout, 5xx, etc.) - uses 3-failure threshold**

```
t=0s:   L1 RPC call fails: timeout ← Failure #1
        └─ Continue with same endpoint

t=30s:  L1 RPC call fails: timeout ← Failure #2
        └─ Continue (1 failure remaining)

t=60s:  L1 RPC call fails: timeout ← Failure #3
        └─ THRESHOLD REACHED (3)
        └─ Failover triggered ← ~100ms
        └─ New endpoint active ✅
```

### When Quota Exhaustion Happens

**Paid Alchemy RPC**: 300,000 calls/month quota
```
Scenario 1: Normal L2 block production
- op-node: ~2 calls/block * 60 blocks/hour = 120 calls/hour
- op-batcher: ~0.5 calls/transaction
- op-proposer: ~1 call/output
- Total: ~200-300 calls/hour
- 300,000 / 300 = 1,000 hours ✅ Plenty of quota

Scenario 2: High L2 activity or multiple endpoints
- Same nodes making calls via Proxyd
- Proxyd itself may cache/reuse responses → fewer upstream calls
- Quota still should last 30+ days

Scenario 3: When quota exhaustion actually occurs
- Endpoint downtime forcing retries
- Multiple L2 chains on same paid endpoint
- Unexpected traffic spikes
- → 429 Too Many Requests response
- → Failover to backup endpoint (Infura, Ankr, etc.)
```

---

## Proxyd vs Direct RPC Path

### Path 1: **Proxyd Mode** (Recommended)

**Configuration**:
```bash
L1_PROXYD_ENABLED=true
L1_RPC_URLS=https://alchemy.io/v2/key1,https://infura.io/v3/key2
```

**Request Flow**:
```
SentinAI Agent Loop (every 30s)
    ↓
    getBlockNumber() via current L1_RPC_URL (= Proxyd service URL)
    ↓
    HTTP → Proxyd Service (http://proxyd-service:8080)
    │
    └─ Proxyd reads ConfigMap upstreams: name="main" rpc_url="alchemy.io..."
    │  └─ Proxyd forwards to Alchemy
    │  └─ Alchemy 429 (quota exhausted) → Proxyd returns 429
    │
    └─ SentinAI detects: "429" error
       ├─ Increments 429-counter
       ├─ 429-counter >= 10?
       │  YES → executeFailover() triggered ✅
       │  NO  → Continue with same endpoint
       │
       └─ executeFailover() actions:
          1. Updates ConfigMap:
             - OLD: upstreams[main].rpc_url = "alchemy.io..."
             - NEW: upstreams[main].rpc_url = "infura.io..."
             - ALSO updates: backends[].rpc_url references

          2. Restarts Proxyd pod:
             - kubectl delete pod -l app=proxyd
             - Pod respawns with new ConfigMap

          3. Result:
             - All L2 nodes now route through Proxyd → Infura ✅
             - Fresh quota available
             - Block production resumes
```

**Advantages**:
- ✅ Single ConfigMap update + pod restart → affects ALL L2 nodes
- ✅ Recovery time: ~500ms (ConfigMap patch + pod restart)
- ✅ Independent of L2 deployment type (StatefulSet, Pod, etc.)
- ✅ Tolerates quota exhaustion better (10 failures vs 3)
- ✅ **Recommended for production**

---

### Path 2: **Direct RPC Mode** (Legacy)

**Configuration**:
```bash
L1_PROXYD_ENABLED=false
L1_RPC_URLS=https://alchemy.io/v2/key1,https://infura.io/v3/key2
```

**Request Flow**:
```
SentinAI Agent Loop (every 30s)
    ↓
    getBlockNumber() via current L1_RPC_URL
    ↓
    If NOT using Proxyd (L1_RPC_URL is direct endpoint):
    ├─ HTTP/gRPC → Alchemy RPC directly
    │  ├─ Alchemy OK → returns block number ✅
    │  └─ Alchemy 429 → Alchemy returns 429 to SentinAI
    │     └─ SentinAI sees: 429 error
    │     └─ reportL1Failure() triggered
    │     └─ After 3 failures: executeFailover()
    │
    └─ SentinAI Updates L2 Pod Env Vars
       └─ kubectl set env pod/op-node-0 OP_NODE_L1_ETH_RPC=infura.io...
       └─ kubectl set env pod/op-batcher-0 OP_BATCHER_L1_ETH_RPC=infura.io...
       └─ Pods must **restart** to pick up new env var (requires restart or hot-reload support)
       └─ **SLOW RECOVERY**: 30-60 seconds for pods to restart
```

**Disadvantages**:
- ❌ Requires updating EACH L2 pod individually
- ❌ Pods must restart (30-60s downtime)
- ❌ op-batcher and op-proposer restarts may break ongoing operations
- ❌ NOT recommended (legacy only)

---

### Comparison Table

| Aspect | Proxyd Mode | Direct RPC Mode |
|--------|-------------|-----------------|
| **HTTP 429 Detection** | 10-failure threshold | 3-failure threshold |
| **Other Errors** | 3-failure threshold | 3-failure threshold |
| **429 Tolerance** | ✅ 5+ minutes before failover | ❌ ~90 seconds |
| **Update Method** | ConfigMap patch + pod restart | kubectl set env per pod |
| **ConfigMap Changes** | Upstreams + Backends | N/A |
| **Recovery Time** | ~500ms (ConfigMap + pod restart) | 30-60s (multiple pod restarts) |
| **L2 Nodes Affected** | All (single update) | Each pod individually |
| **Pod Restarts** | 1 (Proxyd only) | 3 (op-node, op-batcher, op-proposer) |
| **Dependency on Pod Type** | ❌ None | ✅ StatefulSet vs Pod differences |
| **Block Production Impact** | Minimal (~500ms) | Significant (30-60s+ per pod) |
| **Production Ready** | ✅ Yes (Recommended) | ❌ Legacy |

---

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
