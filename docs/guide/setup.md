# SentinAI Setup Guide

## Quick Start (Local Development)

```bash
npm install

# Select chain-specific template
cp .env.thanos.example .env.local     # Thanos (Tokamak)
# cp .env.optimism.example .env.local  # Optimism / OP Stack
# cp .env.zkstack.example .env.local   # ZK Stack

npm run dev
```

Visit `http://localhost:3002` (or port shown in terminal).

---

## Environment Variables

### Minimum Required (3 variables for full functionality)

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com    # L2 Chain RPC
ANTHROPIC_API_KEY=your-api-key-here             # AI features
AWS_CLUSTER_NAME=my-cluster-name                # K8s (auto-detects K8S_API_URL & region)
```

> **Note**: `K8S_API_URL` and `AWS_REGION` are auto-detected at runtime from `AWS_CLUSTER_NAME`.  
> AWS credentials use the standard chain: env vars, `~/.aws/credentials`, or IAM Role.

### L1 RPC Configuration (Architecture Note)

SentinAI separates monitoring RPC from L2 node failover pool:

- **SentinAI monitoring path**: Set via `SENTINAI_L1_RPC_URL` (optional, has default fallback)
- **L2 node failover pool**: Set via `L1_RPC_URLS` (comma-separated)
- **Proxyd mode** (optional): controlled with `L1_PROXYD_*` variables

See [Proxyd Failover Setup](proxyd-failover-setup.md) for details.

### Template Examples

The repository includes chain-specific `.env` templates:

- `.env.thanos.example` — Thanos (Tokamak Network)
- `.env.optimism.example` — Optimism / OP Stack
- `.env.zkstack.example` — ZK Stack

Copy the relevant template to `.env.local` and customize.

---

## EC2 Deployment (Automated)

For production deployment on AWS EC2:

```bash
bash scripts/install.sh
```

This script handles:
- Dependency installation
- Environment setup
- Service configuration
- Firewall rules

See [EC2 Setup Guide](ec2-setup-guide.md) for detailed instructions.

---

## Next Steps

After setup:

1. **Run a demo**: [Demo Scenarios](demo-scenarios.md)
2. **Configure scaling**: [Autonomy Cockpit User Guide](autonomy-cockpit-user-guide.md)
3. **Production operations**: [Daily Operations Runbook](agentic-q1-operations-runbook.md)
4. **L1 client setup**: [L1 Client Operations Automation](l1-client-operations-automation-guide.md)

---

## Simulation Mode

By default, SentinAI runs in **simulation mode** (dry-run). Scaling decisions are logged but not executed on the cluster.

To enable live execution:
1. Set `SCALING_SIMULATION_MODE=false` in `.env.local`
2. Ensure AWS credentials have EKS write permissions
3. Review [Autonomy Cockpit User Guide](autonomy-cockpit-user-guide.md) for safety controls

---

## Troubleshooting

### Connection Issues
- Verify `L2_RPC_URL` is accessible
- Check AWS credentials: `aws sts get-caller-identity`
- Confirm EKS cluster name matches `AWS_CLUSTER_NAME`

### AI Features Not Working
- Verify `ANTHROPIC_API_KEY` is valid
- Check API key permissions (Claude Haiku 4.5 required)
- Review logs for rate limit errors

### Scaling Not Triggered
- Confirm `SCALING_SIMULATION_MODE=false` for live execution
- Check cooldown period (5 minutes by default)
- Review [Testing Guide](../verification/testing-guide.md)

For more issues, see [Redis Setup](redis-setup.md) and component-specific guides.
