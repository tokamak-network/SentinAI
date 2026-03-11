# Quick Start

Get SentinAI running locally in under 5 minutes.

## Prerequisites

- Node.js 18+ and npm
- An L2 RPC endpoint (e.g. your OP Stack node, or a public testnet URL)
- An AI API key — any one of: Anthropic, OpenAI, Qwen, or Gemini

## 1. Clone & Install

```bash
git clone https://github.com/tokamak-network/SentinAI.git
cd SentinAI
npm install
```

## 2. Configure

```bash
cp .env.optimism.example .env.local
```

Edit `.env.local` with your values:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com   # required
ANTHROPIC_API_KEY=sk-ant-...                    # or OPENAI_API_KEY / QWEN_API_KEY
SCALING_SIMULATION_MODE=true                    # safe default — no real K8s changes
```

> AI features are optional. Monitoring works without an API key.

## 3. Start

```bash
npm run dev
```

Open **http://localhost:3002**. You should see live L2 metrics within a few seconds.

## 4. Verify

```bash
curl http://localhost:3002/api/health
# → {"status":"ok","l2Connected":true, ...}
```

On the dashboard:
- Block height updates in real-time
- Metrics panel shows TxPool, Gas, CPU scoring
- Agent Loop status shows the 60s observe cycle

## What's Next

- **Connect to a real cluster** — set `AWS_CLUSTER_NAME` and `SCALING_SIMULATION_MODE=false` to enable live K8s scaling
- **Production deployment** — [EC2 Setup](ec2-setup-guide.md) for a persistent server install
- **Connect your chain** — [OP Stack](opstack-example-runbook.md) or [Arbitrum Orbit](arbitrum-orbit-local-setup.md)

## Common Issues

| Symptom | Fix |
|---------|-----|
| Dashboard blank / not loading | Check `npm run dev` output for errors. Port conflict: `PORT=3003 npm run dev` |
| L2 not connected | Verify `L2_RPC_URL` is reachable: `curl $L2_RPC_URL` |
| AI features missing | Confirm API key is set and valid |
| Build errors | `rm -rf .next node_modules && npm install` |
