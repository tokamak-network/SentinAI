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
| Cloudflare Account | Required | Required | https://dash.cloudflare.com (free) |
| 1 domain | Required | Required | Available directly from Cloudflare ($2-$10 per year) |

> If you do not have an AI API Key, sign up at https://console.anthropic.com and create one from the API Keys menu.

---

## Entire flow

**Scenario A (EKS Monitoring)**:
```
[1] Create EC2 → [2] IAM settings → [3] Prepare Cloudflare → [4] SSH connection → [5] Execute installation → Complete
(5 minutes) (5 minutes) (10 minutes) (1 minute) (10 minutes)
```

**Scenario B (AI monitoring only)**:
```
[1] Create EC2 → [3] Prepare Cloudflare → [4] SSH connection → [5] Execute installation → Complete
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

> Since we use the Cloudflare Tunnel, there is no need to open the dashboard port (3002).
> Tunnel only uses outbound port 443, and external connection is possible without opening the inbound port.

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

> **Scenario B**: Skip this step and go to [Step 3](#Step 3-cloudflare-settings-https-public-access).

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

## Step 3: Set up Cloudflare (HTTPS public access)

Using Cloudflare Tunnel:
- Access an address such as `https://sentinai.yourdomain.com`
- Automatically apply HTTPS (encryption)
- Email authentication (only authorized people access)
- No need to open inbound ports on EC2

> Copy the **Tunnel token** in this step. Enter during Step 5 installation.

### 3-1. Create a Cloudflare account and add a domain

1. Access https://dash.cloudflare.com → Create account (free)
2. **Add domain** or **Register domain**
- If you do not have a domain: Left menu **Register domain** → Search for desired domain → Purchase (`.xyz` costs ~$2 per year)
- If you already have one: **Add site** → Enter domain → Select Free plan → Follow name server change instructions

### 3-2. Tunnel creation

1. Left menu of Cloudflare dashboard → Click **Zero Trust**
(If this is your first time, you will need to set a Zero Trust team name — enter any name)
2. **Networks** → **Tunnels** → **Create a tunnel** 클릭
3. Select **Cloudflared** → Next
4. Tunnel name: `sentinai` → **Save tunnel**
5. The **Install and run a connector** screen appears.
- Copy the token here
- The long string following `cloudflared service install` is the token.
- Example: `eyJhIjoiYWJjMTIz...` (very long string)
- Copy this token to notepad (used in step 5)
- Click **Next**
6. **Public Hostname** Settings:
- Subdomain: `sentinai` (or desired name)
- Domain: Select domain from dropdown
   - Type: `HTTP`
   - URL: `sentinai:8080`
- Click **Save tunnel**

> Enter `sentinai:8080` exactly in the URL. `http://` is not appended.
> `sentinai` is the Docker container name, and `8080` is the internal port.

### 3-3. Access policy settings (authentication)

1. Zero Trust 좌측 메뉴 → **Access** → **Applications** → **Add an application**
2. Select **Self-hosted**
3. Settings:
   - Application name: `SentinAI Dashboard`
   - Session Duration: `24 hours`
   - Application domain:
     - Subdomain: `sentinai`
- Domain: Select from dropdown
4. Next → **Add a policy**:
   - Policy name: `Allowed Users`
   - Action: **Allow**
- Include rules:
     - Selector: **Emails**
- Value: Enter the email address to allow access (e.g. `admin@company.com`)
- If there are multiple people, add one by one.
5. Next → **Add application**

> Now, when you access `https://sentinai.yourdomain.com`, an email input screen appears,
> You must receive an OTP code to your permitted email address to access the dashboard.

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

**Scenario A (EKS Monitoring)**:
```
--- SentinAI Preferences ---

L2 RPC URL (required): https://rpc.titok.tokamak.network ← Enter L2 chain address

Select AI Provider:
1) Anthropic (recommended)
    2) OpenAI
    3) Gemini
Select [1]: 1 ← Enter or Enter 1

Anthropic API Key: ← Enter API key (not displayed on screen)

AWS EKS Cluster Name (for K8s monitoring, press Enter to skip): my-l2-cluster
← Enter EKS cluster name

Cloudflare Tunnel Token (select, skip to Enter): ← Paste the token copied in step 3

Slack Webhook URL (select, press Enter to skip): ← Enter to skip
```

**Scenario B (AI monitoring only)**:
```
--- SentinAI Preferences ---

L2 RPC URL (required): https://rpc.titok.tokamak.network ← Enter L2 chain address

Select AI Provider:
1) Anthropic (recommended)
Select [1]: 1 ← Enter

Anthropic API Key: ← Enter API key

AWS EKS Cluster Name (for K8s monitoring, press Enter to skip): ← Enter to skip
[WARNING] AWS_CLUSTER_NAME not set. K8s runs in simulation mode without monitoring.
[SentinAI] EKS cluster not set → Simulation mode enabled (SCALING_SIMULATION_MODE=true)

Cloudflare Tunnel Token (select, skip to Enter): ← Paste the token copied in step 3

Slack Webhook URL (select, press Enter to skip): ← Enter to skip
```

### 5-3. Build and run

After entering the settings, the Docker image build will automatically start. Once you have entered the Tunnel token, Cloudflare Tunnel will also be automatically enabled.

```
[SentinAI] Cloudflare Tunnel enabled.
[SentinAI] Building Docker image... (First build takes 5-10 minutes)
[SentinAI] Service starting...
[SentinAI] Waiting for service to start (30 seconds)...
[SentinAI] ============================================
[SentinAI] SentinAI installation complete!
[SentinAI] ============================================
[INFO] Dashboard: Via Cloudflare Tunnel (HTTPS)
```

### 5-4. Check connection

Access `https://sentinai.yourdomain.com` in your browser.

1. Cloudflare Access login screen appears
2. Enter permitted email addresses
3. Enter the 6-digit code received by email
4. Success when SentinAI dashboard is displayed

---

## Automated deployment (optional)

Install silently without interactive input for CI/CD, Terraform user-data, or recurring deployments.

### Non-interactive mode based on environment variables

Once the required environment variables (`SENTINAI_L2_RPC_URL` + `SENTINAI_AI_KEY`) are set, it will skip the interactive prompt and install silently.

```bash
# Non-interactive installation (Scenario A: EKS monitoring)
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_CLUSTER_NAME="my-l2-cluster" \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

```bash
# Non-interactive installation (Scenario B: AI monitoring only)
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

> If you omit `SENTINAI_CLUSTER_NAME`, `SCALING_SIMULATION_MODE=true` will be automatically set.

### List of environment variables

| Environment variables | Required | Description |
|---------|:----:|------|
| `SENTINAI_L2_RPC_URL` | Required | L2 chain RPC address |
| `SENTINAI_AI_KEY` | Required | AI API Key |
| `SENTINAI_AI_PROVIDER` | Select | `anthropic` (default), `openai`, `gemini` |
| `SENTINAI_CLUSTER_NAME` | Select | EKS cluster name (simulation mode if not set) |
| `SENTINAI_TUNNEL_TOKEN` | Select | Cloudflare Tunnel Token |
| `SENTINAI_WEBHOOK_URL` | Select | Slack notification webhook URL |
| `SENTINAI_DIR` | Select | Installation path (default: `/opt/sentinai`) |
| `SENTINAI_BRANCH` | Select | Git branch (default: `main`) |

### EC2 User Data Example

When creating an EC2 instance, enter the script below in **Advanced Details → User Data** and it will be automatically installed when the instance starts:

```bash
#!/bin/bash
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
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
sudo docker compose --profile tunnel ps
```

### View log

```bash
# Full log (real time)
sudo docker compose --profile tunnel logs -f

# SentinAI log only
sudo docker compose logs -f sentinai

# Tunnel log only
sudo docker compose logs -f cloudflared
```

Exit log view with `Ctrl + C`.

### SentinAI updates

When a new version is released:

```bash
cd /opt/sentinai
git pull origin main
sudo docker compose --profile tunnel build
sudo docker compose --profile tunnel up -d
```

### Service stop

```bash
cd /opt/sentinai
sudo docker compose --profile tunnel down
```

### Restart service

```bash
cd /opt/sentinai
sudo docker compose --profile tunnel restart
```

---

## Troubleshooting

### "Can't access Cloudflare Tunnel"

| Checklist | Command or method |
|-----------|---------------|
| Tunnel container running? | `sudo docker compose --profile tunnel ps` → check sentinai-tunnel |
| Is SentinAI healthy? | Check if sentinai is `healthy` with the same command |
| Tunnel error log | `sudo docker compose logs cloudflared` |
| Is the token correct? | `grep CLOUDFLARE_TUNNEL_TOKEN /opt/sentinai/.env.local` |
| DNS setup complete? | Cloudflare Dashboard → Check if CNAME record exists in DNS |

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

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
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
| Cloudflare (Free plan) | Free |
| domain (.xyz) | ~$2/year |
| Anthropic API (mainly Haiku) | ~$5-20 (depending on usage) |
| **Total** | **~$45-65/month** |

> If you stop EC2 when not in use, no instance costs are incurred (only EBS storage costs are charged).
> Stop: EC2 console → Select instance → Instance status → Stop instance
> Restart: Instance status → Start instance → After connecting to SSH, `cd /opt/sentinai && sudo docker compose --profile tunnel up -d`

---

## Summary Checklist

### Scenario A (EKS monitoring)

- [ ] Create EC2 instance (t3.medium, Amazon Linux 2023, 20 GiB, hop limit 2)
- [ ] Create IAM role and connect to EC2
- [ ] Request EKS RBAC mapping from infrastructure team
- [ ] Cloudflare account + domain settings
- [ ] Create Cloudflare Tunnel + Copy Token
- [ ] Cloudflare Access policy settings (allowed emails)
- [ ] Connect to EC2 via SSH
- [ ] Run install.sh (enter L2 RPC URL, AI API Key, EKS cluster name, Tunnel token)
- [ ] Check connection to https://sentinai.domain.com

### Scenario B (AI monitoring only)

- [ ] Create EC2 instance (t3.medium, Amazon Linux 2023, 20 GiB)
- [ ] Cloudflare account + domain settings
- [ ] Create Cloudflare Tunnel + Copy Token
- [ ] Cloudflare Access policy settings (allowed emails)
- [ ] Connect to EC2 via SSH
- [ ] Run install.sh (Enter L2 RPC URL, AI API Key, Tunnel token — Skip EKS cluster name with Enter)
- [ ] Check connection to https://sentinai.domain.com
