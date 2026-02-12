# L1 Proxyd Failover Setup Guide

This guide explains how to configure SentinAI's L1 RPC failover system to work with **Proxyd** (eth-optimism/infra load balancer).

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│ SentinAI (L1 Failover Module)               │
│                                             │
│  1. Detects L1 RPC failure (3x consecutive) │
│  2. Finds healthy backup endpoint           │
│  3. Updates Proxyd ConfigMap ──┐            │
│  4. Updates op-* StatefulSets   │            │
└─────────────────────────────────┼────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ proxyd-config ConfigMap  │
                    │                          │
                    │ [[upstreams]]            │
                    │ name = "main"            │
                    │ rpc_url = "https://..."  │ ◄─── Updated by SentinAI
                    └──────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ Proxyd Service           │
                    │ http://proxyd:8080       │
                    └──────────────────────────┘
                      │       │        │
        ┌─────────────┼───────┼────────┼─────────────┐
        ▼             ▼       ▼        ▼             ▼
    op-node    op-batcher  op-proposer  ...
    (via Proxyd endpoint)
```

## Prerequisites

1. **Proxyd Deployment**: Proxyd must be running in your K8s cluster
2. **ConfigMap**: `proxyd-config` ConfigMap with `proxyd.toml` data key
3. **RBAC**: SentinAI service account needs `get` + `patch` permissions on ConfigMaps

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
# Enable Proxyd mode
L1_PROXYD_ENABLED=true

# ConfigMap details (use defaults if standard)
L1_PROXYD_CONFIGMAP_NAME=proxyd-config
L1_PROXYD_DATA_KEY=proxyd.toml
L1_PROXYD_UPSTREAM_GROUP=main

# L1 RPC failover pool
L1_RPC_URLS=https://paid-rpc1.io,https://paid-rpc2.io,https://publicnode.com

# StatefulSet prefix (for component env var updates)
K8S_STATEFULSET_PREFIX=sepolia-thanos-stack
```

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
[L1 Failover] Updated sepolia-thanos-stack-op-node OP_NODE_L1_ETH_RPC
[L1 Failover] Updated sepolia-thanos-stack-op-batcher OP_BATCHER_L1_ETH_RPC
[L1 Failover] Updated sepolia-thanos-stack-op-proposer OP_PROPOSER_L1_ETH_RPC
```

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

### Timeline

1. **L1 RPC Call Fails** (e.g., rate limit exceeded)
   ```
   op-node → Proxyd → Primary L1 RPC [FAIL] ❌
   ```

2. **3 Consecutive Failures Detected**
   - SentinAI's agent loop counts failures
   - After 3rd failure, triggers failover

3. **Backup Endpoint Found**
   - Round-robin search through backup endpoints
   - Health check via `eth_blockNumber`

4. **Proxyd ConfigMap Updated** (Priority 1)
   ```
   kubectl get configmap proxyd-config
   kubectl patch configmap proxyd-config --type=json -p='[{"op":"replace","path":"/data/proxyd.toml",...}]'
   ```

5. **StatefulSet Env Vars Updated** (Priority 2-4)
   ```
   kubectl set env statefulset/sepolia-thanos-stack-op-node OP_NODE_L1_ETH_RPC=https://backup-rpc.io
   kubectl set env statefulset/sepolia-thanos-stack-op-batcher OP_BATCHER_L1_ETH_RPC=https://backup-rpc.io
   kubectl set env statefulset/sepolia-thanos-stack-op-proposer OP_PROPOSER_L1_ETH_RPC=https://backup-rpc.io
   ```

6. **Proxyd Reloads Config**
   - Proxyd watches ConfigMap for changes
   - On TOML update, reloads upstream configuration
   - New L1 RPC connections use backup endpoint

### Failover Cooldown

- **5-minute cooldown** between failovers
- Prevents flapping between endpoints
- Can be adjusted by modifying constants in `src/lib/l1-rpc-failover.ts`

## Rollback

If Proxyd mode causes issues, disable it:

```bash
# .env.local
L1_PROXYD_ENABLED=false
```

Restart SentinAI. Failover will revert to StatefulSet-only updates.

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
[L1 Failover] Updated sepolia-thanos-stack-op-node OP_NODE_L1_ETH_RPC
[L1 Failover] Updated sepolia-thanos-stack-op-batcher OP_BATCHER_L1_ETH_RPC
[L1 Failover] Updated sepolia-thanos-stack-op-proposer OP_PROPOSER_L1_ETH_RPC
```

## Performance Impact

- **ConfigMap Update Time**: ~560ms (read + parse + patch)
- **Total Failover Time**: ~2.1s (ConfigMap + 3 StatefulSets)
- **Memory**: TOML parsing library adds ~50KB

## Related Documentation

- **CLAUDE.md**: L1 Proxyd environment variables
- **.env.local.sample**: Configuration template
- **ARCHITECTURE.md**: L1 Failover architecture
