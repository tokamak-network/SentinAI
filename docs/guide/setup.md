# SentinAI Setup Guide

## Quick Start (Local Development)

```bash
npm install

# Copy environment template
cp .env.optimism.example .env.local  # Optimism / OP Stack

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

### Template Example

The repository includes a `.env` template:

- `.env.optimism.example` — Optimism / OP Stack

Copy the template to `.env.local` and customize.

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

1. **Production deployment**: [EC2 Setup Guide](ec2-setup-guide.md)
2. **Connect your chain**: [OP Stack](opstack-example-runbook.md) or [Arbitrum Orbit](arbitrum-orbit-local-setup.md)

---

## Simulation Mode

By default, SentinAI runs in **simulation mode** (dry-run). Scaling decisions are logged but not executed on the cluster.

To enable live execution:
1. Set `SCALING_SIMULATION_MODE=false` in `.env.local`
2. Ensure AWS credentials have EKS write permissions
3. Set `SCALING_SIMULATION_MODE=false` and verify no unexpected scaling events

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
- See [Troubleshooting](troubleshooting.md) for common issues
