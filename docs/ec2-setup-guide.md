# SentinAI EC2 설치 가이드 (비개발자용)

AWS EC2에 SentinAI를 설치하고, 외부에서 HTTPS로 대시보드에 접근할 수 있도록 하는 전체 과정을 안내합니다.

---

## 시나리오 선택

설치 전에 사용 환경을 확인하세요.

| 시나리오 | 설명 | 건너뛰는 단계 |
|----------|------|-------------|
| **A. EKS 모니터링** | EKS 클러스터의 L2 노드를 모니터링 + 자동 스케일링 | 없음 (전체 진행) |
| **B. AI 모니터링 전용** | EKS 없이 L2 체인 모니터링 + AI 분석만 사용 | 2단계 (IAM), 홉 제한 설정 |

> **시나리오 B 사용 시**: K8s Pod 상태 패널에 "Error" 표시가 나타나지만 정상입니다.
> L1/L2 블록 모니터링, AI 이상 탐지, 비용 추적, NLOps 채팅 등 핵심 기능은 모두 작동합니다.

---

## 시작 전 준비물

| 항목 | 시나리오 A | 시나리오 B | 어디서 얻나요? |
|------|:---------:|:---------:|--------------|
| AWS 계정 | 필수 | 필수 | https://aws.amazon.com |
| L2 RPC URL | 필수 | 필수 | 인프라 팀에서 제공 (예: `https://rpc.titok.tokamak.network`) |
| AI API Key | 필수 | 필수 | https://console.anthropic.com (Anthropic 권장) |
| EKS 클러스터 이름 | 필수 | 불필요 | 인프라 팀에서 제공 (예: `my-l2-cluster`) |
| Cloudflare 계정 | 필수 | 필수 | https://dash.cloudflare.com (무료) |
| 도메인 1개 | 필수 | 필수 | Cloudflare에서 직접 구매 가능 (연 $2~$10) |

> AI API Key가 없다면 https://console.anthropic.com 에서 회원가입 후 API Keys 메뉴에서 생성합니다.

---

## 전체 흐름

**시나리오 A (EKS 모니터링)**:
```
[1] EC2 생성 → [2] IAM 설정 → [3] Cloudflare 준비 → [4] SSH 접속 → [5] 설치 실행 → 완료
    (5분)         (5분)          (10분)              (1분)           (10분)
```

**시나리오 B (AI 모니터링 전용)**:
```
[1] EC2 생성 → [3] Cloudflare 준비 → [4] SSH 접속 → [5] 설치 실행 → 완료
    (5분)         (10분)              (1분)           (10분)
```

---

## 1단계: EC2 인스턴스 생성

### 1-1. EC2 콘솔 접속

1. https://console.aws.amazon.com 로그인
2. 상단 검색창에 **EC2** 입력 → 클릭
3. 리전 확인: 우측 상단에서 **서울 (ap-northeast-2)** 선택
4. 좌측 메뉴 **인스턴스** → **인스턴스 시작** 버튼 클릭

### 1-2. 인스턴스 설정

| 항목 | 설정값 | 설명 |
|------|--------|------|
| 이름 | `SentinAI` | 원하는 이름 |
| AMI | **Amazon Linux 2023** | 기본 선택된 것 사용 |
| 인스턴스 유형 | **t3.medium** | 2 vCPU, 4 GiB 메모리 (월 ~$36) |
| 키 페어 | 새로 생성 또는 기존 선택 | SSH 접속에 필요. 새로 생성 시 `.pem` 파일 다운로드 필수 |
| 스토리지 | **20 GiB gp3** | 기본 8 → 20으로 변경 (Docker 이미지 빌드 공간) |

### 1-3. 네트워크 설정

**인스턴스 시작** 화면에서 **네트워크 설정** 섹션의 **편집** 버튼을 클릭합니다.

**VPC**: 시나리오 A는 EKS 클러스터와 같은 VPC를 선택합니다. 시나리오 B는 기본 VPC를 사용합니다.
> EKS API가 Private Endpoint인 경우 반드시 같은 VPC에 있어야 합니다.
> 어떤 VPC인지 모르겠으면 인프라 팀에 문의하세요.

**보안 그룹**: "보안 그룹 생성"을 선택하고 다음 규칙을 추가합니다:

| 유형 | 포트 | 소스 | 용도 |
|------|------|------|------|
| SSH | 22 | 내 IP | EC2 관리용 접속 |

> Cloudflare Tunnel을 사용하므로 대시보드 포트(3002)를 열 필요가 없습니다.
> Tunnel은 아웃바운드 443 포트만 사용하며, 인바운드 포트를 열지 않아도 외부 접속이 가능합니다.

**아웃바운드 규칙**은 기본값(모든 트래픽 허용)을 유지합니다.

### 1-4. 고급 세부 정보

같은 화면 하단의 **고급 세부 정보**를 펼칩니다.

**IAM 인스턴스 프로파일**: 다음 단계(2단계)에서 생성한 역할을 선택합니다.
> 먼저 인스턴스를 생성하고, 2단계에서 역할을 만든 뒤 나중에 연결해도 됩니다.
> **시나리오 B**: IAM 역할이 필요 없으므로 비워둡니다.

**메타데이터 버전**: V2만 (토큰 필요)

**메타데이터 응답 홉 제한**: **시나리오 A만** `2`로 변경 (기본값 1에서 변경)
> Docker 컨테이너에서 AWS 인증이 작동하려면 반드시 **2**로 설정해야 합니다.
> **시나리오 B**: 기본값(1)을 유지합니다.

### 1-5. 인스턴스 시작

**인스턴스 시작** 버튼을 클릭합니다. 1~2분 후 인스턴스가 실행됩니다.

인스턴스 목록에서 SentinAI 인스턴스를 클릭하면 **퍼블릭 IPv4 주소**를 확인할 수 있습니다 (예: `3.35.xxx.xxx`).

---

## 2단계: IAM 역할 생성 (EKS 접근 권한)

> **시나리오 B**: 이 단계를 건너뛰고 [3단계](#3단계-cloudflare-설정-https-공개-접근)로 이동합니다.

SentinAI가 EKS 클러스터를 모니터링하려면 AWS 권한이 필요합니다.

### 2-1. IAM 역할 만들기

1. AWS 콘솔 상단 검색창 → **IAM** → 클릭
2. 좌측 메뉴 **역할** → **역할 생성** 버튼
3. 설정:
   - 신뢰할 수 있는 엔터티: **AWS 서비스**
   - 사용 사례: **EC2** 선택 → 다음
4. 권한 정책 추가:
   - 검색창에 `EKS` 입력
   - **AmazonEKSClusterPolicy** 체크
   - 검색창에 `STS` 입력
   - **AWSSecurityTokenServiceFullAccess** 체크
   - 다음
5. 역할 이름: `SentinAI-EC2-Role` → **역할 생성**

### 2-2. EC2에 역할 연결

1. EC2 콘솔 → 인스턴스 목록 → SentinAI 인스턴스 선택
2. **작업** → **보안** → **IAM 역할 수정**
3. `SentinAI-EC2-Role` 선택 → **IAM 역할 업데이트**

### 2-3. EKS 클러스터에 권한 매핑 (인프라 팀 요청)

인프라 팀에게 다음 내용을 전달하여 EKS 클러스터에 SentinAI의 접근 권한을 추가해달라고 요청합니다:

```
SentinAI EC2의 IAM 역할을 EKS aws-auth ConfigMap에 추가해주세요.

역할 ARN: arn:aws:iam::<계정ID>:role/SentinAI-EC2-Role
(IAM → 역할 → SentinAI-EC2-Role → ARN 복사)

필요 권한: Pod 조회, StatefulSet 조회/패치
```

> 이 단계를 건너뛰면 SentinAI는 K8s 모니터링 없이 AI 분석 기능만 사용할 수 있습니다.

---

## 3단계: Cloudflare 설정 (HTTPS 공개 접근)

Cloudflare Tunnel을 사용하면:
- `https://sentinai.yourdomain.com` 같은 주소로 접근
- HTTPS 자동 적용 (암호화)
- 이메일 인증 (허가된 사람만 접근)
- EC2의 인바운드 포트를 열지 않아도 됨

> 이 단계에서 **Tunnel 토큰**을 복사해둡니다. 5단계 설치 시 입력합니다.

### 3-1. Cloudflare 계정 생성 및 도메인 추가

1. https://dash.cloudflare.com 접속 → 계정 생성 (무료)
2. **도메인 추가** 또는 **도메인 등록**
   - 도메인이 없으면: 좌측 메뉴 **도메인 등록** → 원하는 도메인 검색 → 구매 (`.xyz`는 연 ~$2)
   - 이미 있으면: **사이트 추가** → 도메인 입력 → Free 플랜 선택 → 네임서버 변경 안내 따르기

### 3-2. Tunnel 생성

1. Cloudflare 대시보드 좌측 메뉴 → **Zero Trust** 클릭
   (처음이면 Zero Trust 팀 이름 설정 필요 — 아무 이름이나 입력)
2. **Networks** → **Tunnels** → **Create a tunnel** 클릭
3. **Cloudflared** 선택 → 다음
4. Tunnel 이름: `sentinai` → **Save tunnel**
5. **Install and run a connector** 화면이 나타남
   - 여기서 토큰을 복사합니다
   - `cloudflared service install` 뒤에 나오는 긴 문자열이 토큰입니다
   - 예: `eyJhIjoiYWJjMTIz...` (매우 긴 문자열)
   - 이 토큰을 메모장에 복사해둡니다 (5단계에서 사용)
   - **다음** 클릭
6. **Public Hostname** 설정:
   - Subdomain: `sentinai` (또는 원하는 이름)
   - Domain: 드롭다운에서 도메인 선택
   - Type: `HTTP`
   - URL: `sentinai:8080`
   - **Save tunnel** 클릭

> URL에 `sentinai:8080`을 정확히 입력하세요. `http://`는 붙이지 않습니다.
> `sentinai`는 Docker 컨테이너 이름이고, `8080`은 내부 포트입니다.

### 3-3. Access 정책 설정 (인증)

1. Zero Trust 좌측 메뉴 → **Access** → **Applications** → **Add an application**
2. **Self-hosted** 선택
3. 설정:
   - Application name: `SentinAI Dashboard`
   - Session Duration: `24 hours`
   - Application domain:
     - Subdomain: `sentinai`
     - Domain: 드롭다운에서 선택
4. 다음 → **Add a policy**:
   - Policy name: `Allowed Users`
   - Action: **Allow**
   - Include 규칙:
     - Selector: **Emails**
     - Value: 접근을 허용할 이메일 주소 입력 (예: `admin@company.com`)
     - 여러 명이면 하나씩 추가
5. 다음 → **Add application**

> 이제 `https://sentinai.yourdomain.com` 접속 시 이메일 입력 화면이 나타나고,
> 허용된 이메일로 OTP 코드를 받아야만 대시보드에 접근할 수 있습니다.

---

## 4단계: EC2에 SSH 접속

### Mac/Linux

터미널을 열고 다음 명령어를 실행합니다:

```bash
# 키 파일 권한 설정 (최초 1회)
chmod 400 ~/Downloads/키파일이름.pem

# SSH 접속
ssh -i ~/Downloads/키파일이름.pem ec2-user@퍼블릭IP주소
```

예시:
```bash
ssh -i ~/Downloads/SentinAI-key.pem ec2-user@3.35.123.456
```

### Windows

1. PuTTY 다운로드: https://www.putty.org
2. PuTTYgen으로 `.pem` → `.ppk` 변환
3. PuTTY에서 호스트: `ec2-user@퍼블릭IP주소`, 인증에 `.ppk` 파일 지정

접속에 성공하면 다음과 같은 화면이 표시됩니다:

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

## 5단계: SentinAI 설치

SSH로 접속한 상태에서 아래 명령어를 실행합니다.

### 5-1. 설치 스크립트 실행

```bash
curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh | bash
```

스크립트가 자동으로 Docker, Docker Compose, Git을 설치하고, SentinAI 소스 코드를 다운로드합니다.

### 5-2. 설정 입력

스크립트가 다음 정보를 순서대로 물어봅니다.

**시나리오 A (EKS 모니터링)**:
```
--- SentinAI 환경 설정 ---

  L2 RPC URL (필수): https://rpc.titok.tokamak.network    ← L2 체인 주소 입력

  AI Provider 선택:
    1) Anthropic (권장)
    2) OpenAI
    3) Gemini
  선택 [1]: 1                                               ← Enter 또는 1 입력

  Anthropic API Key:                                        ← API 키 입력 (화면에 표시되지 않음)

  AWS EKS Cluster Name (K8s 모니터링용, Enter로 건너뛰기): my-l2-cluster
                                                            ← EKS 클러스터 이름 입력

  Cloudflare Tunnel Token (선택, Enter로 건너뛰기):          ← 3단계에서 복사한 토큰 붙여넣기

  Slack Webhook URL (선택, Enter로 건너뛰기):                ← Enter로 건너뛰기
```

**시나리오 B (AI 모니터링 전용)**:
```
--- SentinAI 환경 설정 ---

  L2 RPC URL (필수): https://rpc.titok.tokamak.network    ← L2 체인 주소 입력

  AI Provider 선택:
    1) Anthropic (권장)
  선택 [1]: 1                                               ← Enter

  Anthropic API Key:                                        ← API 키 입력

  AWS EKS Cluster Name (K8s 모니터링용, Enter로 건너뛰기):   ← Enter로 건너뛰기
  [WARNING] AWS_CLUSTER_NAME 미설정. K8s 모니터링 없이 시뮬레이션 모드로 실행됩니다.
  [SentinAI] EKS 클러스터 미설정 → 시뮬레이션 모드 활성화 (SCALING_SIMULATION_MODE=true)

  Cloudflare Tunnel Token (선택, Enter로 건너뛰기):          ← 3단계에서 복사한 토큰 붙여넣기

  Slack Webhook URL (선택, Enter로 건너뛰기):                ← Enter로 건너뛰기
```

### 5-3. 빌드 및 실행

설정 입력이 끝나면 자동으로 Docker 이미지 빌드가 시작됩니다. Tunnel 토큰을 입력했으면 Cloudflare Tunnel도 자동으로 활성화됩니다.

```
[SentinAI] Cloudflare Tunnel 활성화됨.
[SentinAI] Docker 이미지 빌드 중... (첫 빌드 시 5-10분 소요)
[SentinAI] 서비스 시작 중...
[SentinAI] 서비스 시작 대기 (30초)...
[SentinAI] ============================================
[SentinAI]   SentinAI 설치 완료!
[SentinAI] ============================================
[INFO] 대시보드: Cloudflare Tunnel 경유 (HTTPS)
```

### 5-4. 접속 확인

브라우저에서 `https://sentinai.yourdomain.com` 에 접속합니다.

1. Cloudflare Access 로그인 화면이 나타남
2. 허용된 이메일 주소 입력
3. 이메일로 받은 6자리 코드 입력
4. SentinAI 대시보드가 표시되면 성공

---

## 자동화 배포 (선택)

CI/CD, Terraform user-data, 또는 반복 배포 시 대화형 입력 없이 자동 설치할 수 있습니다.

### 환경변수 기반 비대화형 모드

필수 환경변수(`SENTINAI_L2_RPC_URL` + `SENTINAI_AI_KEY`)가 설정되면 대화형 프롬프트를 건너뛰고 자동으로 설치합니다.

```bash
# 비대화형 설치 (시나리오 A: EKS 모니터링)
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_CLUSTER_NAME="my-l2-cluster" \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

```bash
# 비대화형 설치 (시나리오 B: AI 모니터링 전용)
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

> `SENTINAI_CLUSTER_NAME`을 생략하면 자동으로 `SCALING_SIMULATION_MODE=true`가 설정됩니다.

### 환경변수 목록

| 환경변수 | 필수 | 설명 |
|---------|:----:|------|
| `SENTINAI_L2_RPC_URL` | 필수 | L2 체인 RPC 주소 |
| `SENTINAI_AI_KEY` | 필수 | AI API 키 |
| `SENTINAI_AI_PROVIDER` | 선택 | `anthropic`(기본), `openai`, `gemini` |
| `SENTINAI_CLUSTER_NAME` | 선택 | EKS 클러스터 이름 (미설정 시 시뮬레이션 모드) |
| `SENTINAI_TUNNEL_TOKEN` | 선택 | Cloudflare Tunnel 토큰 |
| `SENTINAI_WEBHOOK_URL` | 선택 | Slack 알림 웹훅 URL |
| `SENTINAI_DIR` | 선택 | 설치 경로 (기본: `/opt/sentinai`) |
| `SENTINAI_BRANCH` | 선택 | Git 브랜치 (기본: `main`) |

### EC2 User Data 예시

EC2 인스턴스 생성 시 **고급 세부 정보 → 사용자 데이터**에 아래 스크립트를 입력하면 인스턴스 시작 시 자동 설치됩니다:

```bash
#!/bin/bash
SENTINAI_L2_RPC_URL="https://rpc.titok.tokamak.network" \
SENTINAI_AI_PROVIDER=anthropic \
SENTINAI_AI_KEY="sk-ant-api03-..." \
SENTINAI_TUNNEL_TOKEN="eyJhIjoiYWJj..." \
bash <(curl -sSL https://raw.githubusercontent.com/tokamak-network/SentinAI/main/scripts/install.sh)
```

> User Data에 API 키를 직접 입력하면 AWS 콘솔에서 누구나 확인할 수 있습니다.
> 프로덕션에서는 AWS Secrets Manager 또는 SSM Parameter Store 사용을 권장합니다.

---

## 일상 운영

SSH로 EC2에 접속한 후 `/opt/sentinai` 디렉토리에서 실행합니다.

### 서비스 상태 확인

```bash
cd /opt/sentinai
sudo docker compose --profile tunnel ps
```

### 로그 보기

```bash
# 전체 로그 (실시간)
sudo docker compose --profile tunnel logs -f

# SentinAI 로그만
sudo docker compose logs -f sentinai

# Tunnel 로그만
sudo docker compose logs -f cloudflared
```

`Ctrl + C`로 로그 보기를 종료합니다.

### SentinAI 업데이트

새 버전이 배포되었을 때:

```bash
cd /opt/sentinai
git pull origin main
sudo docker compose --profile tunnel build
sudo docker compose --profile tunnel up -d
```

### 서비스 중지

```bash
cd /opt/sentinai
sudo docker compose --profile tunnel down
```

### 서비스 재시작

```bash
cd /opt/sentinai
sudo docker compose --profile tunnel restart
```

---

## 문제 해결

### "Cloudflare Tunnel 접속이 안 됩니다"

| 확인 사항 | 명령어 또는 방법 |
|-----------|---------------|
| Tunnel 컨테이너 실행 중? | `sudo docker compose --profile tunnel ps` → sentinai-tunnel 확인 |
| SentinAI healthy? | 같은 명령으로 sentinai가 `healthy`인지 확인 |
| Tunnel 에러 로그 | `sudo docker compose logs cloudflared` |
| 토큰이 올바른가? | `grep CLOUDFLARE_TUNNEL_TOKEN /opt/sentinai/.env.local` |
| DNS 설정 완료? | Cloudflare 대시보드 → DNS에 CNAME 레코드가 있는지 확인 |

### "K8s 모니터링이 작동하지 않습니다"

**시나리오 B (EKS 없이 사용) 시**: Components 패널에 "Error" 표시가 나타나는 것은 정상입니다. K8s 연결 없이는 Pod 상태를 조회할 수 없지만, 나머지 기능(블록 모니터링, AI 분석, 비용 추적 등)은 정상 작동합니다.

**시나리오 A (EKS 모니터링) 시**:

| 확인 사항 | 명령어 또는 방법 |
|-----------|---------------|
| IAM 역할 연결? | EC2 콘솔 → 인스턴스 → 보안 탭 → IAM 역할 확인 |
| EKS RBAC 매핑? | 인프라 팀에 2-3단계 완료 여부 확인 |
| 메타데이터 홉 제한? | EC2 콘솔 → 인스턴스 → 작업 → 인스턴스 설정 → 인스턴스 메타데이터 옵션 수정 → 응답 홉 제한 = 2 |
| 같은 VPC인가? | EC2와 EKS가 같은 VPC에 있는지 인프라 팀에 확인 |

### "Docker 빌드가 실패합니다"

```bash
# 디스크 용량 확인
df -h

# 용량 부족 시 Docker 캐시 정리
sudo docker system prune -af
```

스토리지가 부족하면 EC2 콘솔에서 볼륨 크기를 늘릴 수 있습니다:
EC2 → 볼륨 → 수정 → 크기 변경 → `sudo growpart /dev/xvda 1 && sudo xfs_growfs /`

---

## 비용 참고

| 항목 | 월 예상 비용 |
|------|------------|
| EC2 t3.medium (서울) | ~$36 |
| EBS 20 GiB gp3 | ~$2 |
| 데이터 전송 (아웃바운드) | ~$1-5 |
| Cloudflare (Free 플랜) | 무료 |
| 도메인 (.xyz) | ~$2/년 |
| Anthropic API (Haiku 위주) | ~$5-20 (사용량에 따라) |
| **합계** | **~$45-65/월** |

> EC2를 사용하지 않을 때 중지(Stop)하면 인스턴스 비용이 발생하지 않습니다 (EBS 스토리지 비용만 과금).
> 중지: EC2 콘솔 → 인스턴스 선택 → 인스턴스 상태 → 인스턴스 중지
> 재시작: 인스턴스 상태 → 인스턴스 시작 → SSH 접속 후 `cd /opt/sentinai && sudo docker compose --profile tunnel up -d`

---

## 요약 체크리스트

### 시나리오 A (EKS 모니터링)

- [ ] EC2 인스턴스 생성 (t3.medium, Amazon Linux 2023, 20 GiB, 홉 제한 2)
- [ ] IAM 역할 생성 및 EC2에 연결
- [ ] 인프라 팀에 EKS RBAC 매핑 요청
- [ ] Cloudflare 계정 + 도메인 설정
- [ ] Cloudflare Tunnel 생성 + 토큰 복사
- [ ] Cloudflare Access 정책 설정 (허용 이메일)
- [ ] SSH로 EC2 접속
- [ ] install.sh 실행 (L2 RPC URL, AI API Key, EKS 클러스터 이름, Tunnel 토큰 입력)
- [ ] https://sentinai.도메인.com 접속 확인

### 시나리오 B (AI 모니터링 전용)

- [ ] EC2 인스턴스 생성 (t3.medium, Amazon Linux 2023, 20 GiB)
- [ ] Cloudflare 계정 + 도메인 설정
- [ ] Cloudflare Tunnel 생성 + 토큰 복사
- [ ] Cloudflare Access 정책 설정 (허용 이메일)
- [ ] SSH로 EC2 접속
- [ ] install.sh 실행 (L2 RPC URL, AI API Key, Tunnel 토큰 입력 — EKS 클러스터 이름은 Enter로 건너뛰기)
- [ ] https://sentinai.도메인.com 접속 확인
