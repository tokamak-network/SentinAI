# SentinAI 테스트 가이드

**Version:** 1.0  
**Date:** 2026-02-09  
**Status:** Ready for Use

---

## 개요

SentinAI 대시보드를 테스트하는 3가지 방법을 설명합니다.

| 방법 | 난이도 | 소요시간 | Public URL | 프로덕션 환경 |
|------|--------|----------|------------|--------------|
| 로컬 개발 서버 | ⭐ 쉬움 | 1분 | ❌ | ❌ |
| Docker 로컬 빌드 | ⭐⭐ 보통 | 10분 | ❌ | ✅ |
| Cloud Run 배포 | ⭐⭐⭐ 어려움 | 20분 | ✅ | ✅ |

---

## 환경변수 요구사항

### 필수 환경변수

```env
# L2 네트워크 연결
L2_RPC_URL=https://mainnet.optimism.io

# AI 분석 (Claude)
ANTHROPIC_API_KEY=sk-ant-api03-...

# AI Gateway (선택적)
AI_GATEWAY_URL=https://api.ai.tokamak.network
```

### 선택적 환경변수 (K8s 연동)

```env
# AWS EKS 연동 (스케일링 기능용)
AWS_REGION=ap-northeast-2
EKS_CLUSTER_NAME=your-cluster-name
EKS_NAMESPACE=default
APP_PREFIX=op
```

### 테스트 가능한 기능

| 기능 | 필수 환경변수 | K8s 필요 |
|------|--------------|----------|
| L2 블록 높이 조회 | L2_RPC_URL | ❌ |
| L1 블록 높이 조회 | L1_RPC_URL (기본값 있음) | ❌ |
| TxPool/Gas 상태 | L2_RPC_URL | ❌ |
| AI 이상 탐지 분석 | ANTHROPIC_API_KEY | ❌ |
| Cost Analysis | - (시뮬레이션 모드) | ❌ |
| K8s Pod 메트릭 | EKS_* | ✅ |
| 리소스 스케일링 | EKS_* | ✅ |
| Stress Test 시뮬레이션 | - | ❌ |

---

## 방법 1: 로컬 개발 서버

### 사전 요구사항

- Node.js 18+ 설치
- npm 설치

### 단계별 가이드

```bash
# 1. 프로젝트 디렉토리 이동
cd /home/theo/SentinAI

# 2. 의존성 설치 (최초 1회)
npm install

# 3. 환경변수 파일 확인
cat .env.local

# 4. 개발 서버 실행
npm run dev
```

### 접속 URL

```
http://localhost:3000
```

### 환경변수 적용

- `.env.local` 파일이 **자동으로** 적용됨
- 수정 후 서버 재시작 필요 없음 (Hot Reload)

### 장점

- ✅ 가장 빠른 시작 (1분 이내)
- ✅ Hot Reload 지원 (코드 수정 즉시 반영)
- ✅ 상세 에러 메시지

### 단점

- ❌ Public URL 없음 (localhost만 접근 가능)
- ❌ 프로덕션 환경과 다를 수 있음

### 종료 방법

```bash
# 터미널에서 Ctrl+C
```

---

## 방법 2: Docker 로컬 빌드

### 사전 요구사항

- Docker 설치 및 실행 중

#### Docker 설치 (Ubuntu/WSL2)

```bash
# Docker 설치
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 현재 사용자를 docker 그룹에 추가
sudo usermod -aG docker $USER

# 재로그인 (WSL2의 경우 터미널 재시작)
exit
# 다시 로그인

# 설치 확인
docker --version
```

### 단계별 가이드

```bash
# 1. 프로젝트 디렉토리 이동
cd /home/theo/SentinAI

# 2. Docker 이미지 빌드 (2-3분 소요)
docker build -t sentinai:test .

# 3. 컨테이너 실행 (환경변수 파일 사용)
docker run -p 8080:8080 --env-file .env.local sentinai:test

# 또는 환경변수 개별 지정
docker run -p 8080:8080 \
  -e L2_RPC_URL="https://mainnet.optimism.io" \
  -e ANTHROPIC_API_KEY="sk-ant-api03-..." \
  -e AI_GATEWAY_URL="https://api.ai.tokamak.network" \
  sentinai:test
```

### 접속 URL

```
http://localhost:8080
```

### 환경변수 적용

- `--env-file .env.local`: 파일에서 환경변수 로드
- `-e KEY=VALUE`: 개별 환경변수 지정
- 환경변수 변경 시 컨테이너 재시작 필요

### 장점

- ✅ 프로덕션 환경과 동일
- ✅ 빌드 결과물 검증 가능
- ✅ 이미지 재사용 가능

### 단점

- ❌ Docker 설치 필요
- ❌ 빌드 시간 소요 (2-3분)
- ❌ 코드 변경 시 재빌드 필요

### 유용한 Docker 명령어

```bash
# 실행 중인 컨테이너 확인
docker ps

# 컨테이너 로그 확인
docker logs <container_id>

# 컨테이너 중지
docker stop <container_id>

# 이미지 삭제 (재빌드 필요 시)
docker rmi sentinai:test
```

---

## 방법 3: Cloud Run 배포

### 사전 요구사항

- Google Cloud 계정
- GCP 프로젝트 생성
- gcloud CLI 설치 및 인증
- Docker 설치

#### gcloud CLI 설치

```bash
# Ubuntu/Debian
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
sudo apt-get update && sudo apt-get install google-cloud-cli

# 인증
gcloud auth login
gcloud auth configure-docker
```

### 단계별 가이드

#### Step 1: GCP 프로젝트 설정

```bash
# 프로젝트 ID 설정
gcloud config set project YOUR_PROJECT_ID

# 필요한 API 활성화
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

#### Step 2: 배포 스크립트 수정

```bash
cd /home/theo/SentinAI

# deploy-cloudrun.sh에서 PROJECT_ID 수정
nano deploy-cloudrun.sh
```

수정할 내용:
```bash
PROJECT_ID="your-actual-gcp-project-id"  # 실제 프로젝트 ID로 변경
```

#### Step 3: 배포 실행

```bash
# 실행 권한 확인
chmod +x deploy-cloudrun.sh

# 배포 (5-10분 소요)
./deploy-cloudrun.sh
```

#### Step 4: 환경변수 주입

```bash
# 방법 A: CLI로 개별 설정
gcloud run services update sentinai \
  --region asia-northeast3 \
  --set-env-vars "L2_RPC_URL=https://mainnet.optimism.io" \
  --set-env-vars "ANTHROPIC_API_KEY=sk-ant-api03-..." \
  --set-env-vars "AI_GATEWAY_URL=https://api.ai.tokamak.network"

# 방법 B: 파일로 일괄 설정
# env-vars.yaml 생성
cat > env-vars.yaml << EOF
L2_RPC_URL: "https://mainnet.optimism.io"
ANTHROPIC_API_KEY: "sk-ant-api03-..."
AI_GATEWAY_URL: "https://api.ai.tokamak.network"
EOF

gcloud run services update sentinai \
  --region asia-northeast3 \
  --env-vars-file env-vars.yaml
```

### 접속 URL

배포 완료 후 제공되는 URL:
```
https://sentinai-<random-hash>-an.a.run.app
```

URL 확인 명령어:
```bash
gcloud run services describe sentinai \
  --region asia-northeast3 \
  --format "value(status.url)"
```

### 환경변수 적용

- 배포 후 `gcloud run services update`로 주입
- 민감 정보는 Secret Manager 사용 권장

#### Secret Manager 사용 (선택적)

```bash
# Secret 생성
echo -n "sk-ant-api03-..." | gcloud secrets create anthropic-api-key --data-file=-

# Cloud Run에 Secret 연결
gcloud run services update sentinai \
  --region asia-northeast3 \
  --update-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest
```

### 장점

- ✅ Public URL 제공 (외부 접근 가능)
- ✅ 자동 HTTPS
- ✅ 자동 스케일링
- ✅ 실제 프로덕션 환경

### 단점

- ❌ GCP 계정/프로젝트 필요
- ❌ 배포 시간 소요 (5-10분)
- ❌ 비용 발생 가능 (무료 티어 초과 시)

### 모니터링 명령어

```bash
# 서비스 상태 확인
gcloud run services describe sentinai --region asia-northeast3

# 로그 확인
gcloud run services logs read sentinai --region asia-northeast3

# 환경변수 확인
gcloud run services describe sentinai \
  --region asia-northeast3 \
  --format "yaml(spec.template.spec.containers[0].env)"
```

### 서비스 삭제

```bash
gcloud run services delete sentinai --region asia-northeast3
```

---

## 테스트 검증 체크리스트

### 기본 기능 (K8s 불필요)

- [ ] 대시보드 메인 페이지 로딩
- [ ] L2 Block Height 표시
- [ ] L1 Block Height 표시
- [ ] Health Score 표시
- [ ] Stress Test 시뮬레이션 버튼 동작
- [ ] Cost Analysis 버튼 동작
- [ ] 자동 새로고침 (5초 간격)

### API 엔드포인트 테스트

```bash
# Health 체크
curl http://localhost:3000/api/health

# Metrics 조회
curl http://localhost:3000/api/metrics

# Anomalies 조회
curl http://localhost:3000/api/anomalies

# Cost Report
curl http://localhost:3000/api/cost-report
```

### AI 분석 기능

- [ ] Anomaly Detection 작동
- [ ] AI Analysis 결과 표시
- [ ] Severity 레벨 구분 (info/warning/critical)

### K8s 연동 기능 (EKS 설정 시)

- [ ] Pod 메트릭 조회
- [ ] CPU/Memory 사용률 표시
- [ ] 스케일링 요청 동작

---

## 문제 해결

### 포트 충돌

```bash
# 사용 중인 포트 확인
lsof -i :3000
lsof -i :8080

# 프로세스 종료
kill -9 <PID>
```

### 환경변수 미적용

```bash
# .env.local 파일 확인
cat .env.local

# 환경변수 로드 확인 (개발 서버)
npm run dev 2>&1 | grep -i "env\|error"
```

### Docker 빌드 실패

```bash
# 캐시 없이 재빌드
docker build --no-cache -t sentinai:test .

# 로그 확인
docker logs <container_id>
```

### Cloud Run 배포 실패

```bash
# 배포 로그 확인
gcloud builds log <build_id>

# 서비스 로그 확인
gcloud run services logs read sentinai --region asia-northeast3
```

---

## 권장 테스트 순서

1. **로컬 개발 서버**로 기본 기능 검증
2. **Docker 빌드**로 프로덕션 환경 테스트
3. **Cloud Run 배포**로 실제 서비스 검증

이 순서로 진행하면 문제 발생 시 빠르게 원인을 파악할 수 있습니다.
