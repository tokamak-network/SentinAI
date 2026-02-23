# Troubleshooting Guide

Common issues and solutions when running SentinAI.

---

## Installation & Build Issues

### npm install fails

**Symptom**: Package installation errors during `npm install`

**Solutions**:
```bash
# Clear npm cache
npm cache clean --force

# Delete lock file and reinstall
rm package-lock.json
rm -rf node_modules
npm install

# Use specific Node version (18.x or 20.x recommended)
nvm use 20
npm install
```

---

### Build fails with "Module not found"

**Symptom**: `npm run build` errors with missing modules

**Solutions**:
```bash
# Ensure all dependencies are installed
npm install

# Clear Next.js cache
rm -rf .next
npm run build

# Check for TypeScript errors
npx tsc --noEmit
```

---

## Connection Issues

### L2 RPC not responding

**Symptom**: Dashboard shows "L2 disconnected" or API returns connection errors

**Diagnosis**:
```bash
# Test RPC directly
curl -X POST $L2_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Solutions**:
- Verify `L2_RPC_URL` in `.env.local` is correct and accessible
- Check if RPC endpoint requires authentication
- Try alternative RPC endpoints (see chain-specific `.env` examples)
- Check firewall/network restrictions

---

### AWS EKS connection fails

**Symptom**: "Failed to connect to Kubernetes cluster" errors

**Diagnosis**:
```bash
# Verify AWS credentials
aws sts get-caller-identity

# Test cluster access
aws eks describe-cluster --name $AWS_CLUSTER_NAME --region $AWS_REGION

# Check kubectl access
kubectl cluster-info
```

**Solutions**:
- Ensure `AWS_CLUSTER_NAME` in `.env.local` matches actual cluster
- Verify IAM permissions (need `eks:DescribeCluster` at minimum)
- Check if AWS credentials are configured (`~/.aws/credentials` or env vars)
- Confirm region is correct in `.env.local` or auto-detected properly

---

## AI Features Issues

### Anthropic API errors

**Symptom**: AI analysis not working, API key errors in logs

**Solutions**:
```bash
# Validate API key format
echo $ANTHROPIC_API_KEY | grep -E '^sk-ant-'

# Test API key directly
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4.5","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'
```

**Common causes**:
- API key invalid or expired
- Rate limit exceeded (wait and retry)
- Billing issue on Anthropic account
- Wrong model ID in code (should be `claude-haiku-4.5`)

---

### AI Gateway routing issues

**Symptom**: Model selection errors or "No available provider" messages

**Check**:
```bash
# Verify AI routing config
curl http://localhost:3002/api/ai-routing/status
```

**Solutions**:
- Ensure at least one provider is configured with valid API key
- Check `AI_GATEWAY_*` environment variables if using custom gateway
- Review logs for provider-specific errors

---

## Scaling & Operations Issues

### Simulation mode not working

**Symptom**: Scaling decisions not executing even with `SCALING_SIMULATION_MODE=false`

**Diagnosis**:
```bash
# Check current scaling state
curl http://localhost:3002/api/scaler | jq

# Review recent scaling decisions
curl http://localhost:3002/api/agent-decisions | jq
```

**Solutions**:
- Verify `SCALING_SIMULATION_MODE=false` in `.env.local`
- Ensure AWS EKS connection is working (see above)
- Check IAM permissions include write access to EKS
- Confirm cooldown period hasn't blocked scaling (default 5 minutes)

---

### Metrics not updating

**Symptom**: Dashboard shows stale data or no data

**Check**:
```bash
# Test metrics API directly
curl http://localhost:3002/api/metrics

# Check health endpoint
curl http://localhost:3002/api/health
```

**Solutions**:
- Verify L2 RPC connection (see L2 RPC troubleshooting above)
- Check if metric polling is enabled in code
- Review server logs for metric collection errors
- Ensure sufficient RPC rate limits

---

## Performance Issues

### Dashboard slow or unresponsive

**Symptoms**: High CPU usage, slow page loads

**Solutions**:
```bash
# Check build optimization
npm run build
npm start  # Use production build instead of dev

# Reduce polling frequency (edit intervals in code)
# Disable unnecessary features in .env.local
```

**Resource recommendations**:
- Minimum: 2 CPU cores, 4GB RAM
- Recommended: 4 CPU cores, 8GB RAM

---

### High memory usage

**Diagnosis**:
```bash
# Monitor Node process
node --max-old-space-size=4096 $(which next) dev
```

**Solutions**:
- Use production build (`npm start` instead of `npm run dev`)
- Reduce in-memory metric buffer size in code
- Clear logs and old data periodically

---

## Data & State Issues

### Redis connection fails

**Symptom**: Errors mentioning Redis or state store

**Check**:
```bash
# If using Redis
redis-cli ping

# Check environment config
grep REDIS .env.local
```

**Solutions**:
- See detailed [Redis Setup Guide](redis-setup.md)
- Falls back to in-memory store if Redis unavailable
- Verify `REDIS_URL` and credentials if configured

---

### Anomaly detection not triggering

**Symptom**: No anomalies detected even during stress scenarios

**Diagnosis**:
```bash
# Inject test scenario
curl -X POST http://localhost:3002/api/metrics/seed?scenario=spike

# Check anomaly API
curl http://localhost:3002/api/anomalies
```

**Solutions**:
- Ensure sufficient metric history (need baseline data)
- Check if anomaly thresholds are configured
- Verify z-score calculation in logs
- Review [demo scenarios](demo-scenarios.md) for expected results

---

## Environment & Configuration

### Environment variables not loading

**Symptom**: Features not working despite correct `.env.local` config

**Check**:
```bash
# Verify .env.local is in project root
ls -la .env.local

# Restart dev server (env loaded at startup)
# Kill and restart npm run dev
```

**Solutions**:
- Ensure `.env.local` is in root directory (same level as `package.json`)
- Restart dev server after changing `.env.local`
- Check for typos in variable names (case-sensitive)
- Don't commit `.env.local` — use `.env.*.example` as templates

---

### Port conflicts

**Symptom**: `EADDRINUSE` or "port already in use" errors

**Solutions**:
```bash
# Find process using port 3002
lsof -i :3002
# or
netstat -an | grep 3002

# Kill the process
kill -9 <PID>

# Or use different port
PORT=3003 npm run dev
```

---

## Getting Help

### Enable debug logging

```bash
# In .env.local
DEBUG=sentinai:*
NODE_ENV=development

# Restart and check logs
npm run dev 2>&1 | tee debug.log
```

### Collect diagnostic info

```bash
# System info
node --version
npm --version
docker --version

# SentinAI status
curl http://localhost:3002/api/health | jq
curl http://localhost:3002/api/metrics | jq '. | keys'

# Check recent logs
tail -100 ~/.pm2/logs/*  # if using PM2
# or check terminal output
```

### Report issues

If problems persist:
1. Check [existing issues](https://github.com/tokamak-network/SentinAI/issues)
2. Provide:
   - Error messages (full stack trace)
   - Environment (OS, Node version, deployment type)
   - Configuration (sanitized `.env` — remove secrets)
   - Steps to reproduce

---

## Still stuck?

- Review [Setup Guide](setup.md) for correct configuration
- Try [Demo Scenarios](demo-scenarios.md) in simulation mode first
- Check [EC2 Setup Guide](ec2-setup-guide.md) for production deployment
- See [Operations Runbook](agentic-q1-operations-runbook.md) for operational procedures
