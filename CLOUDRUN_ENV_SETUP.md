# Cloud Run 환경 변수 설정 가이드

## 1. 환경 변수 파일 준비

`.env.local` 파일의 내용을 Cloud Run에 주입해야 합니다.

## 2. 환경 변수 설정 방법 (3가지 옵션)

### Option A: gcloud CLI (추천)

```bash
# 개별 변수 설정
gcloud run services update sentinai \
  --region asia-northeast3 \
  --set-env-vars "L2_RPC_URL=https://your-l2-rpc.com" \
  --set-env-vars "L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com" \
  --set-env-vars "AWS_REGION=ap-northeast-2" \
  --set-env-vars "EKS_CLUSTER_NAME=your-cluster"

# 또는 한 번에 여러 개 설정
gcloud run services update sentinai \
  --region asia-northeast3 \
  --set-env-vars "L2_RPC_URL=https://...,L1_RPC_URL=https://...,AWS_REGION=ap-northeast-2"
```

### Option B: YAML 파일로 관리

`env-vars.yaml` 생성:
```yaml
L2_RPC_URL: "https://your-l2-rpc.com"
L1_RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com"
AWS_REGION: "ap-northeast-2"
EKS_CLUSTER_NAME: "your-cluster-name"
EKS_NAMESPACE: "default"
APP_PREFIX: "op"
CLAUDE_API_KEY: "sk-ant-..."
```

적용:
```bash
gcloud run services update sentinai \
  --region asia-northeast3 \
  --env-vars-file env-vars.yaml
```

### Option C: Secret Manager 연동 (민감 정보용)

```bash
# Secret 생성
echo -n "sk-ant-api03-..." | gcloud secrets create claude-api-key --data-file=-

# Cloud Run에 Secret 연결
gcloud run services update sentinai \
  --region asia-northeast3 \
  --update-secrets CLAUDE_API_KEY=claude-api-key:latest
```

## 3. 필수 환경 변수 체크리스트

- [ ] `L2_RPC_URL` - L2 네트워크 RPC 엔드포인트
- [ ] `L1_RPC_URL` - L1 네트워크 RPC (default: Sepolia)
- [ ] `AWS_REGION` - AWS 리전 (default: ap-northeast-2)
- [ ] `EKS_CLUSTER_NAME` - EKS 클러스터 이름
- [ ] `EKS_NAMESPACE` - K8s 네임스페이스 (default: default)
- [ ] `APP_PREFIX` - 앱 접두사 (default: op)
- [ ] `CLAUDE_API_KEY` - Claude API 키 (AI 분석용)

## 4. 환경 변수 확인

```bash
# 현재 설정된 환경 변수 확인
gcloud run services describe sentinai \
  --region asia-northeast3 \
  --format "value(spec.template.spec.containers[0].env)"
```

## 5. 로컬 개발 vs 프로덕션

- **로컬**: `.env.local` 사용 (Git에 포함 안 됨)
- **Cloud Run**: gcloud CLI 또는 Secret Manager로 주입
- ⚠️ **절대 `.env.local`을 Git에 커밋하지 마세요!**

## 6. 보안 권장사항

1. **민감 정보는 Secret Manager 사용**
   - API 키, 인증 토큰, 비밀번호

2. **일반 설정은 환경 변수 사용**
   - RPC URL, 리전, 네임스페이스

3. **IAM 권한 최소화**
   - Cloud Run 서비스 계정에 필요한 권한만 부여
