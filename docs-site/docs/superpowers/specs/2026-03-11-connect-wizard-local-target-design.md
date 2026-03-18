# Connect Wizard — Local / Try It Out Target

**Date:** 2026-03-11
**Status:** Approved
**File:** `website/src/app/connect/page.tsx`

## Problem

The connect wizard (`/connect`) blocks `localhost` URLs with a "NOT SUPPORTED" error. Users who want to evaluate SentinAI against a locally-running node have no supported path. Additionally, no `docker-compose.yml` guidance is generated — users are directed to the repo file without knowing what to change.

## Design

### 1. New Deploy Target: "Local / Try It Out"

Add `"local"` to `DeployTarget = "local" | "eks" | "docker"`.

New button prepended to the deployment target list:

| Target | Badge | Description |
|--------|-------|-------------|
| **Local / Try It Out** | QUICKSTART (green) | Quick local eval · no K8s · host.docker.internal |
| AWS EKS / Kubernetes | FULL | Full auto-scaling · pod monitoring · RCA · remediation |
| Docker / VM | MONITORING | Monitoring · anomaly detection · NLOps · alerts |

### 2. localhost URL Handling

When `deployTarget === "local"`:
- Remove the "LOCAL URL NOT SUPPORTED" error banner
- Show a green info tip: `"localhost will be written as host.docker.internal in the generated config"`
- `buildEnvLocal()` replaces `localhost` and `127.0.0.1` with `host.docker.internal` in the URL value

When `deployTarget !== "local"` (Docker/VM, EKS):
- Keep the existing "LOCAL URL NOT SUPPORTED" warning (correct behavior — remote deploys cannot use localhost)

### 3. Setup Steps for Local Target

When Local is selected, the output guide shows 5 steps:

1. **Clone Repository** — `git clone` (existing step, unchanged)
2. **Edit docker-compose.yml** ← _new step_ — diff-style snippet showing exactly what to add
3. **Create .env.local** — generated as usual (URL auto-converted)
4. **Start** — `docker compose up -d`
5. **Open Dashboard** — `http://localhost:3002`

#### Step 2 — docker-compose.yml diff snippet

```
# Under the sentinai: service block, add:
  sentinai:
    image: ghcr.io/tokamak-network/sentinai:latest
+   extra_hosts:
+     - "host.docker.internal:host-gateway"
    env_file: .env.local
```

Footer note: *"Required on Linux. Mac/Windows Docker Desktop handles this automatically — skip if not on Linux."*

### 4. Optional Features Filtering

EKS-only features (`proxyd`, `real-scaling`) are already filtered via `deployTargets: ["eks"]`. No change needed — they will be hidden automatically when `"local"` is selected.

## Code Changes

All changes are in `website/src/app/connect/page.tsx`:

| Location | Change |
|----------|--------|
| `type DeployTarget` | Add `"local"` |
| Deploy target button list | Prepend Local card (green, QUICKSTART badge) |
| `onClick` handler | When `"local"` selected, clear `awsClusterName` |
| `isLocalUrl` warning | Only render when `deployTarget !== "local"` |
| `buildEnvLocal()` | When `deployTarget === "local"`, replace `localhost`/`127.0.0.1` with `host.docker.internal` in URL |
| Setup steps (output section) | When `deployTarget === "local"`, insert Step 2 "Edit docker-compose.yml" with diff snippet |

## Non-Goals

- Not generating a full `docker-compose.yml` (too verbose; repo file is the source of truth)
- Not adding a Caddy section for Local (local access doesn't need a reverse proxy)
- Not changing EKS or Docker/VM flows
