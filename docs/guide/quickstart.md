# Quick Start (5 Minutes)

Get SentinAI running locally in under 5 minutes.

---

## Prerequisites

- Node.js 18+ and npm
- (Optional) An Anthropic API key for AI features

---

## Step 1: Clone & Install

```bash
git clone https://github.com/tokamak-network/SentinAI.git
cd SentinAI
npm install
```

*Expected: ~1-2 minutes*

---

## Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.thanos.example .env.local
```

**Minimum required for demo mode:**

```bash
# .env.local
L2_RPC_URL=https://rpc.thanos-sepolia.tokamak.network
ANTHROPIC_API_KEY=sk-ant-...  # Optional for AI features
SCALING_SIMULATION_MODE=true   # Already set in template
```

> **Note**: Without `ANTHROPIC_API_KEY`, AI features will be disabled but monitoring will still work.

*Expected: 30 seconds*

---

## Step 3: Start the Dashboard

```bash
npm run dev
```

Open your browser: **http://localhost:3002**

*Expected: 30 seconds*

---

## Step 4: Verify It Works

### Option A: Dashboard UI

You should see:
- ✅ L1/L2 block heights updating
- ✅ Real-time metrics (CPU, TxPool, Gas)
- ✅ Component status indicators (green = healthy)

### Option B: API Health Check

```bash
curl http://localhost:3002/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-02-23T...",
  "l2Connected": true
}
```

---

## Step 5: Try a Demo (Optional)

Run a stress test simulation:

```bash
# Inject spike scenario
curl -X POST http://localhost:3002/api/metrics/seed?scenario=spike

# Check anomaly detection
curl http://localhost:3002/api/metrics | jq '.anomalies'
```

Refresh the dashboard — you should see **anomaly alerts** and **AI analysis** (if API key configured).

*Expected: 1 minute*

---

## What's Next?

### Production Setup
- [Deploy to EC2](ec2-setup-guide.md) for production use
- [Configure AWS EKS](setup.md#environment-variables) for real cluster scaling
- [Set up L1 RPC failover](../guide/proxyd-failover-setup.md)

### Learn More
- [Run full demo scenarios](demo-scenarios.md)
- [Understand the autonomy cockpit](autonomy-cockpit-user-guide.md)
- [Daily operations runbook](agentic-q1-operations-runbook.md)

### Troubleshooting
- **Dashboard not loading?** Check `npm run dev` output for errors
- **No L2 connection?** Verify `L2_RPC_URL` is accessible: `curl $L2_RPC_URL`
- **AI features not working?** Confirm `ANTHROPIC_API_KEY` is valid

---

## Common Issues

### Port already in use
```bash
# If port 3002 is taken, use a different port:
PORT=3003 npm run dev
```

### Build errors
```bash
# Clear cache and reinstall
rm -rf .next node_modules
npm install
npm run dev
```

### API key invalid
```bash
# Test your Anthropic API key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4.5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

---

**🎉 Congratulations!** You're now running SentinAI. Explore the dashboard or dive into [demo scenarios](demo-scenarios.md).
