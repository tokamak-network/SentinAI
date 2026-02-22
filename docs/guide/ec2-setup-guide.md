# SentinAI EC2 Installation Guide (for non-developers)

We will guide you through the entire process of installing SentinAI on AWS EC2 and making your dashboard accessible externally via HTTPS.

---

## Scenario selection

Please check your usage environment before installation.

| Scenario | Description | Skipping Steps |
|----------|------|-------------|
| **A. EKS Monitoring** | Monitoring + auto-scaling of L2 nodes in EKS cluster | None (full progress) |
| **B. AI monitoring only** | L2 chain monitoring without EKS + AI analysis only | Step 2 (IAM), set hop limits |

> **When using Scenario B**: K8s Pod status panel shows "Error", but this is normal.
> Core features such as L1/L2 block monitoring, AI anomaly detection, cost tracking, NLOps chat, etc. are all functional.

---

## Preparation before starting

| Item | Scenario A | Scenario B | Where do you get it? |
|------|:---------:|:---------:|--------------|
| AWS Account | Required | Required | https://aws.amazon.com |
| L2 RPC URL | Required | Required | Provided by the infrastructure team (e.g. `https://rpc.titok.tokamak.network`) |
| AI API Key | Required | Required | https://console.anthropic.com (Anthropic recommended) |
| EKS cluster name | Required | Not necessary | Provided by the infrastructure team (e.g. `my-l2-cluster`) |
| DNS provider account (Route 53/Cloudflare/etc.) | Required | Required | Existing DNS service account |
| 1 domain | Required | Required | Existing domain or newly registered domain |

> If you do not have an AI API Key, sign up at https://console.anthropic.com and create one from the API Keys menu.

---

## Entire flow

**Scenario A (EKS Monitoring)**:
```
[1] Create EC2 → [2] IAM settings → [3] DNS setup → [4] SSH connection → [5] Execute installation → Complete
(5 minutes) (5 minutes) (10 minutes) (1 minute) (10 minutes)
```

**Scenario B (AI monitoring only)**:
```
[1] Create EC2 → [3] DNS setup → [4] SSH connection → [5] Execute installation → Complete
(5 minutes) (10 minutes) (1 minute) (10 minutes)
```

---

## Step 1: Create an EC2 instance

### 1-1. EC2 console access

1. Log in to https://console.aws.amazon.com
2. Enter **EC2** in the search box at the top → Click
3. Check region: Select **Seoul (ap-northeast-2)** in the upper right corner
4. Left menu **Instance** → Click **Start Instance** button

### 1-2. Instance Settings

| Item | Setting value | Description |
|------|--------|------|
| Name | `SentinAI` | desired name |
| AMI | **Amazon Linux 2023** | Use default selection |
| instance type | **t3.medium** | 2 vCPU, 4 GiB memory (~$36 per month) |
| key pair | Create new or select existing | Required for SSH connection. When creating a new file, `.pem` file must be downloaded |
| Storage | **20 GiB gp3** | Change default 8 → 20 (Docker image build space) |

### 1-3. network settings

On the **Launch Instance** screen, click the **Edit** button in the **Network Settings** section.

**VPC**: Scenario A selects the same VPC as the EKS cluster. Scenario B uses a default VPC.
> If the EKS API is a Private Endpoint, it must be in the same VPC.
> If you are not sure which VPC you have, contact your infrastructure team.

**Security Group**: Select “Create Security Group” and add the following rules:

| Type | port | Source | Use |
|------|------|------|------|
| SSH | 22 | My IP | EC2 management access |

> SentinAI dashboard traffic is handled by Caddy on ports 80/443.
> You do not need to open port 3002 externally.

**Outbound Rules** keep the default (allow all traffic).

### 1-4. Advanced details

Expand **Advanced Details** at the bottom of the same screen.

**IAM Instance Profile**: Select the role you created in the next step (step 2).
> You can create an instance first, create a role in step 2, and connect it later.
> **Scenario B**: IAM role is not required, so leave blank.

**Metadata version**: V2 only (token required)

**Metadata Response Hop Limit**: **Scenario A only** Changed to `2` (from default 1)
> Must be set to **2** for AWS authentication to work in Docker containers.
> **Scenario B**: Keep default (1).

### 1-5. Instance launch

Click the **Launch Instance** button. After a minute or two, your instance will be running.

Click on your SentinAI instance in the instance list to see its **public IPv4 address** (e.g. `3.35.xxx.xxx`).

---

## Step 2: Create IAM role (EKS access)

> **Scenario B**: Skip this step and go to [Step 3](#step-3-dns-setup-for-caddy-https).

SentinAI requires AWS permissions to monitor your EKS cluster.

### 2-1. Create an IAM role

1. Search box at the top of AWS console → **IAM** → Click
2. Left menu **Role** → **Create role** button
3. Settings:
- Trusted Entity: **AWS Service**
- Use case: Select **EC2** → Next
4. Add permission policy:
- Enter ‘EKS’ in the search box
- Check **AmazonEKSClusterPolicy**
- Enter ‘STS’ in the search box
- **AWSSecurityTokenServiceFullAccess** 체크
- next
5. Role name: `SentinAI-EC2-Role` → **Create role**

### 2-2. Associate role to EC2

1. EC2 Console → Instance List → Select SentinAI instance
2. **Actions** → **Security** → **Edit IAM Role**
3. Select `SentinAI-EC2-Role` → **Update IAM role**

### 2-3. Mapping permissions to EKS clusters (infrastructure team request)

Ask your infrastructure team to add SentinAI access to your EKS cluster by providing the following:

```
Please add SentinAI EC2's IAM role to EKS aws-auth ConfigMap.

Role ARN: arn:aws:iam::<AccountID>:role/SentinAI-EC2-Role
(IAM → Role → SentinAI-EC2-Role → Copy ARN)

Required permissions: Pod query, StatefulSet query/patch
```

> If you skip this step, SentinAI will only be able to use AI analysis features without K8s monitoring.

---

## Step 3: DNS setup for Caddy HTTPS

`install.sh` uses Caddy and auto-issues Let's Encrypt certificates when `DOMAIN` is provided.

### 3-1. Prepare domain

1. Use an existing domain or register a new one.
2. Decide the dashboard hostname (example: `sentinai.yourdomain.com`).

### 3-2. Create DNS A record

In your DNS provider (Route 53, Cloudflare DNS, etc.):

- Record type: `A`
- Name: `sentinai` (or desired subdomain)
- Value: EC2 public IPv4
- TTL: `300`

### 3-3. Verify propagation

```bash
dig sentinai.yourdomain.com
nslookup sentinai.yourdomain.com
```

If the returned IP matches your EC2 public IP, proceed to Step 5 and set `DOMAIN=sentinai.yourdomain.com`.

---

## Step 4: SSH into EC2

### Mac/Linux

Open a terminal and run the following command:

```bash
# Set key file permissions (first time)
chmod 400 ~/Downloads/keyfilename.pem

# SSH connection
ssh -i ~/Downloads/Key file name.pem ec2-user@public IP address
```

example:
```bash
ssh -i ~/Downloads/SentinAI-key.pem ec2-user@3.35.123.456
```

### Windows

1. Download PuTTY: https://www.putty.org
2. Convert `.pem` → `.ppk` with PuTTYgen
3. Host in PuTTY: `ec2-user@publicIP address`, specify `.ppk` file for authentication.

If the connection is successful, the following screen will be displayed:

```
   ,     #_
   ~\_  ####_        Amazon Linux 2023
  ~~  \_#####\          AL2023
  ~~     \###|
  ~~       \#/   https://aws.amazon.com/linux/amazon-linux-2023
   ~~       V~'
    ~~         '
[ec2-user@ip-172-31-xx-xx ~]$
```

---

## Step 5: Install SentinAI

While connected via SSH, run the command below.

### 5-1. Run the installation script

```bash
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

The script automatically installs Docker, Docker Compose, Git, and downloads SentinAI source code.

### 5-2. Enter settings

The script asks for the following information in order:

**Core mode (recommended)**:
- Setup mode: `1) Core`
- Required: `L2_RPC_URL`, `AI Provider + API Key`
- Select: chain plugin (`thanos` / `optimism` / `zkstack`)
- Select: orchestrator (`k8s` / `docker`)
- If EKS monitoring is needed: enter `AWS_CLUSTER_NAME`

**Advanced mode**:
- Setup mode: `2) Advanced`
- Includes all core prompts
- Adds optional prompts for:
  - L1 failover (`SENTINAI_L1_RPC_URL`, `L1_RPC_URLS`, `L1_PROXYD_*`)
  - EOA/Fault proof (`BATCHER_*`, `PROPOSER_*`, `CHALLENGER_*`, `DISPUTE_GAME_FACTORY_ADDRESS`)
  - MCP control plane (`MCP_*`, `SENTINAI_API_KEY`)
  - AI routing / memory (`AI_ROUTING_*`, `AGENT_MEMORY_*`)
  - Deployment/alerts (`DOMAIN`, `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_NETWORK_NAME`, `ALERT_WEBHOOK_URL`)

### 5-3. Build and run

After entering the settings, Docker image build starts automatically.

```
[SentinAI] Building Docker image... (First build takes 5-10 minutes)
[SentinAI] Service starting...
[SentinAI] Waiting for service to start (30 seconds)...
[SentinAI] ============================================
[SentinAI] SentinAI installation complete!
[SentinAI] ============================================
[INFO] Dashboard: https://<your-domain><base-path>   # if DOMAIN was set
[INFO] Dashboard: http://<public-ip>:3002<base-path> # if DOMAIN was not set
```

### 5-4. Check connection

Access the dashboard URL printed at the end of installation.

1. If `DOMAIN` is set: `https://sentinai.yourdomain.com`
2. If no domain: `http://<public-ip>:3002`
3. Success when SentinAI dashboard is displayed

---

## Automated deployment (optional)

Install silently without interactive input for CI/CD, Terraform user-data, or recurring deployments.

### Non-interactive mode based on environment variables

Once required variables (`L2_RPC_URL` + one AI key) are set, it skips interactive prompts.

```bash
# Non-interactive installation (Scenario A: EKS monitoring)
L2_RPC_URL="https://rpc.titok.tokamak.network" \
ANTHROPIC_API_KEY="sk-ant-api03-..." \
CHAIN_TYPE="thanos" \
AWS_CLUSTER_NAME="my-l2-cluster" \
DOMAIN="sentinai.yourdomain.com" \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

```bash
# Non-interactive installation (Scenario B: AI monitoring only)
L2_RPC_URL="https://rpc.titok.tokamak.network" \
QWEN_API_KEY="your-qwen-api-key" \
CHAIN_TYPE="optimism" \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

> If you omit `AWS_CLUSTER_NAME`, `SCALING_SIMULATION_MODE=true` is automatically applied.

### List of environment variables

| Environment variables | Required | Description |
|---------|:----:|------|
| `L2_RPC_URL` | Required | L2 chain RPC address |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `QWEN_API_KEY` | Required (one) | AI API key |
| `CHAIN_TYPE` | Select | `thanos` / `optimism` / `my-l2` / `op-stack` / `zkstack` |
| `AWS_CLUSTER_NAME` | Select | EKS cluster name (simulation mode if not set) |
| `DOMAIN` | Select | HTTPS domain (Caddy auto certificate) |
| `INSTALL_MODE` | Select | `core` (default) / `advanced` |
| `MCP_SERVER_ENABLED`, `MCP_AUTH_MODE`, `MCP_APPROVAL_REQUIRED`, `MCP_APPROVAL_TTL_SECONDS`, `SENTINAI_API_KEY` | Advanced | MCP control plane |
| `AI_ROUTING_ENABLED`, `AI_ROUTING_POLICY`, `AI_ROUTING_AB_PERCENT`, `AI_ROUTING_BUDGET_USD_DAILY` | Advanced | Adaptive model routing |
| `SENTINAI_L1_RPC_URL`, `L1_RPC_URLS`, `L1_PROXYD_*` | Advanced | L1 read/failover/proxyd settings |
| `FAULT_PROOF_ENABLED`, `CHALLENGER_EOA_ADDRESS`, `DISPUTE_GAME_FACTORY_ADDRESS` | Advanced | Fault proof monitoring |
| `SENTINAI_DIR` | Select | Installation path (default: `/opt/sentinai`) |
| `SENTINAI_BRANCH` | Select | Git branch (default: `main`) |

### EC2 User Data Example

When creating an EC2 instance, enter the script below in **Advanced Details → User Data** and it will be automatically installed when the instance starts:

```bash
#!/bin/bash
L2_RPC_URL="https://rpc.titok.tokamak.network" \
ANTHROPIC_API_KEY="sk-ant-api03-..." \
CHAIN_TYPE="thanos" \
DOMAIN="sentinai.yourdomain.com" \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

> If you enter the API key directly in User Data, anyone can check it in the AWS console.
> In production, we recommend using AWS Secrets Manager or SSM Parameter Store.

---

## Daily operations

After connecting to EC2 via SSH, run it from the `/opt/sentinai` directory.

### Check service status

```bash
cd /opt/sentinai
sudo docker compose --profile production ps
```

### View log

```bash
# Full log (real time)
sudo docker compose --profile production logs -f

# SentinAI log only
sudo docker compose --profile production logs -f sentinai

# Caddy log only
sudo docker logs sentinai-caddy -f
```

Exit log view with `Ctrl + C`.

### SentinAI updates

When a new version is released:

```bash
cd /opt/sentinai
git pull origin main
sudo docker compose --profile production build
sudo docker compose --profile production up -d
```

### Service stop

```bash
cd /opt/sentinai
sudo docker compose --profile production down
```

### Restart service

```bash
cd /opt/sentinai
sudo docker compose --profile production restart
```

---

## Troubleshooting

### "Can't access HTTPS dashboard"

| Checklist | Command or method |
|-----------|---------------|
| Caddy container running? | `sudo docker compose --profile production ps` → check `sentinai-caddy` |
| Is SentinAI healthy? | Check if `sentinai` is `healthy` |
| Caddy error log | `sudo docker logs sentinai-caddy --tail=50` |
| Domain set correctly? | `grep DOMAIN /opt/sentinai/.env.local` |
| DNS setup complete? | Check A record points to EC2 public IP |

### "K8s monitoring is not working"

**For Scenario B (Used without EKS)**: It is normal for an "Error" indicator to appear in the Components panel. You cannot query Pod status without a K8s connection, but the remaining functions (block monitoring, AI analysis, cost tracking, etc.) will work normally.

**Scenario A (EKS monitoring)**:

| Checklist | Command or method |
|-----------|---------------|
| IAM role association? | EC2 Console → Instance → Security tab → Check IAM role |
| EKS RBAC mapping? | Verify with your infrastructure team that steps 2-3 have been completed |
| Metadata hop limit? | EC2 Console → Instances → Operations → Instance Settings → Edit Instance Metadata Options → Response Hop Limit = 2 |
| Is it the same VPC? | Verify with your infrastructure team that EC2 and EKS are in the same VPC |

### "Docker build fails"

```bash
# Check disk capacity
df -h

# Remove unused images/cache
sudo docker system prune -af
```

If you run out of storage, you can increase the volume size from the EC2 console:
EC2 → Volume → Modify → Change size → `sudo growpart /dev/xvda 1 && sudo xfs_growfs /`

---

## Cost Note

| Item | Estimated monthly costs |
|------|------------|
| EC2 t3.medium (Seoul) | ~$36 |
| EBS 20 GiB gp3 | ~$2 |
| Data transfer (outbound) | ~$1-5 |
| DNS provider hosted zone | $0-1 (provider-dependent) |
| domain (.xyz) | ~$2/year |
| Anthropic API (mainly Haiku) | ~$5-20 (depending on usage) |
| **Total** | **~$45-65/month** |

> If you stop EC2 when not in use, no instance costs are incurred (only EBS storage costs are charged).
> Stop: EC2 console → Select instance → Instance status → Stop instance
> Restart: Instance status → Start instance → After connecting to SSH, `cd /opt/sentinai && sudo docker compose --profile production up -d`

---

## Summary Checklist

### Scenario A (EKS monitoring)

- [ ] Create EC2 instance (t3.medium, Amazon Linux 2023, 20 GiB, hop limit 2)
- [ ] Create IAM role and connect to EC2
- [ ] Request EKS RBAC mapping from infrastructure team
- [ ] Domain DNS A record settings (Route 53/Cloudflare)
- [ ] Connect to EC2 via SSH
- [ ] Run install.sh (enter L2 RPC URL, AI API Key, EKS cluster name, domain)
- [ ] Check connection to https://sentinai.domain.com

### Scenario B (AI monitoring only)

- [ ] Create EC2 instance (t3.medium, Amazon Linux 2023, 20 GiB)
- [ ] Domain DNS A record settings (Route 53/Cloudflare)
- [ ] Connect to EC2 via SSH
- [ ] Run install.sh (Enter L2 RPC URL, AI API Key, Domain — Skip EKS cluster name with Enter)
- [ ] Check connection to https://sentinai.domain.com
