# SentinAI — Ubuntu Server Deployment Guide

> Ubuntu server + Caddy (auto HTTPS) + AWS Route 53 (DNS)

## Overview

- Any Ubuntu 22.04/24.04 server with a public IP (cloud VM, bare metal, VPS, etc.)
- Caddy: Automatic HTTPS via Let's Encrypt (zero-config certificate management)
- Route 53: DNS A record pointing to server public IP
- Dashboard URL: `https://sentinai.tokamak.network/thanos-sepolia`

## Prerequisites

- Ubuntu 22.04 or 24.04 server with public IPv4
- Ports 22, 80, 443 open in firewall / security group
- AWS Route 53 hosted zone for your domain
- SSH access
- Required env vars: L2_RPC_URL, AI API key (see .env.local.sample)

## Phase 1: Server Preparation (10 min)

### 1.1 SSH into the server
```bash
ssh -i ~/.ssh/your-key ubuntu@<PUBLIC_IP>
```

### 1.2 Open firewall ports
Ensure ports 80 (HTTP) and 443 (HTTPS) are open. The method depends on your provider:

```bash
# UFW (common on Ubuntu)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# iptables (if UFW is not available)
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Also check your cloud provider's security group / firewall rules in the web console.

### 1.3 Run installer
```bash
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

The installer will prompt for:
1. **L2 RPC URL** (required)
2. **AI Provider + API Key** (required)
3. **AWS EKS Cluster Name** (optional — skip for simulation mode)
4. **Public Domain** (enter: `sentinai.tokamak.network`)
5. **Slack Webhook URL** (optional)

### 1.4 Non-interactive mode (CI/CD, user-data)
```bash
SENTINAI_L2_RPC_URL=https://your-l2-rpc.example.com \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY=sk-ant-... \
SENTINAI_CLUSTER_NAME=your-cluster \
SENTINAI_DOMAIN=sentinai.tokamak.network \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

### 1.5 Verify services are running
```bash
sudo docker compose --profile production ps
# Expected: sentinai (healthy), redis (healthy), caddy (running)

curl http://localhost:3002/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

## Phase 2: Route 53 DNS Configuration (10 min)

### 2.1 Remove old ALB record (if exists)
In Route 53 → Hosted Zones → `tokamak.network`:
- Delete CNAME record `sentinai` → ALB DNS name

### 2.2 Create A record
- **Record name**: `sentinai`
- **Record type**: A
- **Value**: `<Server Public IP>`
- **TTL**: 300

### 2.3 Verify DNS propagation
```bash
dig sentinai.tokamak.network
# Should return the server public IP

nslookup sentinai.tokamak.network
```

> DNS propagation typically takes 1-5 minutes with TTL 300.

## Phase 3: HTTPS Verification (5 min)

### 3.1 Monitor Caddy certificate issuance
```bash
sudo docker logs sentinai-caddy -f
# Wait for: "certificate obtained successfully"
```

Caddy automatically:
1. Detects the domain from Caddyfile
2. Requests a Let's Encrypt certificate via HTTP-01 challenge
3. Installs the certificate
4. Redirects HTTP → HTTPS
5. Renews 30 days before expiry

### 3.2 Test HTTPS access
```bash
curl -v https://sentinai.tokamak.network/api/health
# Expected: HTTP/2 200, valid Let's Encrypt certificate

# Open in browser:
# https://sentinai.tokamak.network/thanos-sepolia
```

## Phase 4: Cleanup Old AWS Infrastructure (Optional)

If migrating from EC2 + ALB:

1. **EC2**: Stop/terminate the sentinai instance
2. **ALB**: Delete Application Load Balancer
3. **Target Group**: Delete associated target group
4. **ACM**: Delete the certificate (auto-renewal stops)
5. **Security Group**: Delete sentinai-sg (if no longer needed)

## AWS Credentials for EKS Monitoring

If monitoring an EKS cluster from a non-AWS server (no IAM Role available):

### Option A: AWS credentials file
```bash
mkdir -p ~/.aws

cat > ~/.aws/credentials << 'EOF'
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
EOF

cat > ~/.aws/config << 'EOF'
[default]
region = ap-northeast-2
output = json
EOF
```

### Option B: Environment variables
Add to `.env.local`:
```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=ap-northeast-2
```

### kubeconfig setup
```bash
aws eks update-kubeconfig --name your-cluster-name --region ap-northeast-2
```

## Troubleshooting

### Let's Encrypt certificate not issued
- **Check DNS**: `dig sentinai.tokamak.network` must return the server IP
- **Check ports**: `sudo ss -tlnp | grep -E ':(80|443)'` — Caddy must be listening
- **Check firewall**: `sudo ufw status` or `sudo iptables -L INPUT -n` — ports 80/443 must be open
- **Rate limits**: Let's Encrypt has a 5 duplicate certificates per week limit
- **Caddy logs**: `sudo docker logs sentinai-caddy --tail=50`

### Health check fails after deployment
```bash
# Check container status
sudo docker compose --profile production ps

# Check sentinai logs
sudo docker logs sentinai --tail=50

# Check if port 8080 is responding inside container
sudo docker exec sentinai curl -f http://localhost:8080/api/health
```

## Maintenance

### Update SentinAI
```bash
cd /opt/sentinai
git pull origin main
sudo docker compose --profile production build
sudo docker compose --profile production up -d
```

### View logs
```bash
sudo docker compose --profile production logs -f           # All services
sudo docker compose --profile production logs -f sentinai  # App only
sudo docker logs sentinai-caddy -f                          # Caddy/HTTPS only
```

### Certificate renewal
Caddy handles certificate renewal automatically. No cron jobs or manual intervention needed. Certificates are renewed 30 days before expiry.

To verify certificate status:
```bash
curl -vI https://sentinai.tokamak.network 2>&1 | grep -A2 "Server certificate"
```

### Restart services
```bash
sudo docker compose --profile production restart
```

### Backup Redis data
```bash
sudo docker exec sentinai-redis redis-cli BGSAVE
sudo docker cp sentinai-redis:/data/dump.rdb ./redis-backup-$(date +%Y%m%d).rdb
```
