# Vercel 배포 및 배포 후 기능 테스트 가이드

## 📋 배포 구조

```
Website (Vercel) ────────────→ Root App (Docker/Custom)
sentinai-xi.vercel.app        dashboard.sentinai.io
- 랜딩 페이지 (공개)           - 마켓플레이스 관리자 (SIWE 보호)
- ADMIN 버튼                   - SIWE 인증 엔드포인트
  └─ NEXT_PUBLIC_ADMIN_URL    - API 레이어
```

---

## 1️⃣ 배포 준비 (사전 확인)

### Root App 배포 위치 결정

배포하려는 Root App의 최종 URL을 결정합니다:

| 환경 | URL | 설정 방법 |
|------|-----|---------|
| AWS EC2 | `https://dashboard.sentinai.io` | DNS + SSL |
| Digital Ocean | `https://sentinai.app` | App Platform |
| Heroku | `https://sentinai-app.herokuapp.com` | (deprecated) |
| 로컬 테스트 | `http://localhost:3002` | 개발 머신 |
| Vercel (Node) | `https://dashboard-api.vercel.app` | Vercel Edge Functions |

**선택 예시:**
```
Root App URL: https://dashboard.sentinai.io
```

---

## 2️⃣ Root App 배포 (Docker)

### 2-1. Docker 이미지 빌드

```bash
cd /Users/theo/workspace_tokamak/SentinAI

# 빌드
docker build -t sentinai-dashboard:latest .

# 이미지 확인
docker images | grep sentinai-dashboard
# REPOSITORY            TAG       IMAGE ID       CREATED
# sentinai-dashboard    latest    abc123...      2 minutes ago
```

### 2-2. 배포 환경변수 설정

**필수 변수:**

```env
# 마켓플레이스 관리자 주소 유도
MARKETPLACE_WALLET_KEY=0x... # 16진수 개인키 (64자)

# 세션 토큰 HMAC 키
SENTINAI_API_KEY=sentinai-key-...

# L2 RPC 엔드포인트
L2_RPC_URL=https://rpc.example.com

# (선택) 세션 영속성
REDIS_URL=redis://your-redis-url:6379
```

**예시:**
```bash
export MARKETPLACE_WALLET_KEY="0x1234567890abcdef..."
export SENTINAI_API_KEY="sentinai-prod-key-xyz"
export L2_RPC_URL="https://optimism-rpc.example.com"
```

### 2-3. 배포 실행

**옵션 A: Docker 직접 실행**
```bash
docker run -d \
  --name sentinai-dashboard \
  -p 3002:3002 \
  -e MARKETPLACE_WALLET_KEY=$MARKETPLACE_WALLET_KEY \
  -e SENTINAI_API_KEY=$SENTINAI_API_KEY \
  -e L2_RPC_URL=$L2_RPC_URL \
  sentinai-dashboard:latest

# 로그 확인
docker logs -f sentinai-dashboard
# 예상 출력: "▲ Next.js 16 server started on 0.0.0.0:3002"
```

**옵션 B: Docker Compose**
```yaml
# docker-compose.yml
version: '3.8'
services:
  sentinai-dashboard:
    image: sentinai-dashboard:latest
    ports:
      - "3002:3002"
    environment:
      MARKETPLACE_WALLET_KEY: ${MARKETPLACE_WALLET_KEY}
      SENTINAI_API_KEY: ${SENTINAI_API_KEY}
      L2_RPC_URL: ${L2_RPC_URL}
    restart: always

# 실행
docker-compose up -d
```

**옵션 C: AWS / Digital Ocean / Heroku 등**

배포 서비스의 가이드를 따르고, 환경변수를 설정하면 됩니다.

### 2-4. 배포 확인

```bash
# 헬스체크
curl http://localhost:3002/api/health
# 응답: 200 또는 404

# SIWE nonce 엔드포인트 확인
curl "http://localhost:3002/api/auth/siwe/nonce?address=0x1234567890123456789012345678901234567890"
# 응답: { "nonce": "abc123..." }

# 로그인 페이지 확인
curl -I http://localhost:3002/login
# HTTP/1.1 200 OK
```

---

## 3️⃣ Website Vercel 배포

### 3-1. Vercel에 연결

```bash
cd website

# (처음 한 번만) Vercel 프로젝트 연결
vercel link

# 또는 GitHub 자동 배포 설정
# Vercel Dashboard → Project Settings → GitHub App → Connect
```

### 3-2. 환경변수 설정 (Vercel)

Vercel Dashboard에서 설정:

```
Project: sentinai-xi
Settings → Environment Variables
```

**추가할 변수:**

| 변수 | 값 | 환경 |
|------|-----|------|
| `NEXT_PUBLIC_ADMIN_URL` | `https://dashboard.sentinai.io/login` | Production, Preview |

```
Production: https://dashboard.sentinai.io/login
Preview: http://localhost:3002/login (또는 배포 URL)
Development: http://localhost:3002/login
```

### 3-3. 배포 실행

```bash
# 옵션 A: Git 푸시 (자동 배포)
git push origin main
# → Vercel이 자동으로 감지해서 배포 시작
# → Vercel Dashboard에서 진행 상황 확인

# 옵션 B: 수동 배포
vercel --prod
# → 로컬에서 배포
# → 완료 후 URL 출력

# 배포 완료 확인
# Vercel Dashboard → Deployments → Production
# URL: https://sentinai-xi.vercel.app
```

### 3-4. 배포 확인

```bash
# Website 접근
curl -I https://sentinai-xi.vercel.app
# HTTP/2 200

# ADMIN 링크 확인
curl https://sentinai-xi.vercel.app | grep "ADMIN"
```

---

## 4️⃣ 배포 후 기능 테스트

### 테스트 환경 설정

```bash
cd /Users/theo/workspace_tokamak/SentinAI

# 테스트에 사용할 URL 설정
export DEPLOY_URL="https://dashboard.sentinai.io"
export WEBSITE_URL="https://sentinai-xi.vercel.app"
```

### 테스트 A: 자동화 E2E 테스트

```bash
# 배포된 환경의 헬스체크 및 기본 기능 검증
npx playwright test e2e/deploy-test.spec.ts --headed

# 테스트 항목:
# ✓ Root app 헬스체크
# ✓ /v2/marketplace SIWE 게이트
# ✓ /login 페이지 렌더링
# ✓ nonce API 엔드포인트
# ✓ 로그아웃 엔드포인트
# ✓ website 네비게이션 ADMIN 링크
```

### 테스트 B: 수동 SIWE 인증 플로우

#### 단계 1: Website 접근

```
URL: https://sentinai-xi.vercel.app

✓ 페이지 로드 확인
✓ Navbar에 [ADMIN] 버튼 보임
```

#### 단계 2: [ADMIN] 클릭

```
자동으로 /login 페이지로 이동
URL: https://dashboard.sentinai.io/login

✓ 헤더: "SENTINAI Marketplace Admin" (빨간색 #D40000)
✓ 텍스트: "Connect your Ethereum wallet"
✓ 버튼: "🔗 CONNECT WALLET" (활성화)
```

#### 단계 3: MetaMask 지갑 연결

```
1. [CONNECT WALLET] 클릭
2. MetaMask 팝업 나타남
3. 지갑 선택 (기본값 사용)
4. [Accept] 클릭

✓ 페이지 상태 변화: "Connecting wallet..."
✓ 주소 표시 (예: 0x742d35...)
```

#### 단계 4: 메시지 서명

```
1. 페이지가 자동으로 서명 요청
   상태: "Sign the message in your wallet..."
2. MetaMask 서명 대화상자 나타남
3. [Sign] 클릭

✓ 상태: "Verifying signature..."
✓ 잠시 후: "✓ Signed in successfully. Redirecting..."
```

#### 단계 5: 마켓플레이스 접근

```
자동 리다이렉트: https://dashboard.sentinai.io/v2/marketplace

✓ 페이지 로드됨 (인증 성공)
✓ 헤더: "SentinAI Marketplace Admin"
✓ [LOGOUT] 버튼 보임
✓ 4개 탭 렌더링:
  - registry (에이전트 목록)
  - instance (실행 인스턴스)
  - guide (사용 가이드)
  - sandbox (테스트)
```

#### 단계 6: 세션 확인

브라우저 DevTools → Application → Cookies

```
Name: sentinai_admin_session
Value: satv2_0x..._{timestamp}_{timestamp}_{hmac}
HttpOnly: ✓
Secure: ✓
SameSite: Lax
Max-Age: 28800
```

#### 단계 7: 로그아웃

```
1. [LOGOUT] 버튼 클릭
2. 자동 리다이렉트: /login?callbackUrl=/v2/marketplace

✓ 쿠키 'sentinai_admin_session' 삭제됨
✓ 로그인 페이지로 돌아옴
✓ 다시 /v2/marketplace 접근 불가 (재인증 필요)
```

### 테스트 C: 에러 시나리오

#### C-1: MetaMask 미설치

```
1. MetaMask 확장 비활성화 (또는 설치 안 함)
2. /login 접근
3. [CONNECT WALLET] 클릭

✓ 에러 메시지: "MetaMask or compatible wallet not detected"
✓ 버튼 재활성화 (다시 시도 가능)
```

#### C-2: 잘못된 주소 포맷

```bash
curl "https://dashboard.sentinai.io/api/auth/siwe/nonce?address=0xinvalid"

✓ HTTP 400
✓ 응답: { "error": "Invalid address format" }
```

#### C-3: 만료된 Nonce

```
1. nonce 발급 (5분 유효)
2. 5분 이상 경과
3. 같은 nonce로 verify 시도

✓ HTTP 401
✓ 응답: { "error": "Nonce expired or not found" }
해결: 새로운 로그인 시작 (nonce 재발급)
```

#### C-4: 잘못된 서명

```
1. 정상적으로 nonce 발급
2. MetaMask 팝업에서 [Cancel] 클릭

✓ 페이지 상태: "error"
✓ 에러 메시지: "User rejected the request"
✓ 버튼 재활성화
```

---

## 5️⃣ 성능 및 보안 검증

### 성능 테스트

```bash
# nonce API 응답 시간 측정
time curl "https://dashboard.sentinai.io/api/auth/siwe/nonce?address=0x..."
# 목표: < 100ms

# SIWE 검증 응답 시간
time curl -X POST https://dashboard.sentinai.io/api/auth/siwe/verify \
  -H "Content-Type: application/json" \
  -d '{...}'
# 목표: < 500ms

# /v2/marketplace 페이지 로드 시간
# Chrome DevTools → Network → Document 탭
# 목표: < 3초
```

### 보안 검증

```bash
# HTTPS 강제
curl -I https://dashboard.sentinai.io
# Strict-Transport-Security 헤더 확인

# 쿠키 보안 플래그
curl -I https://dashboard.sentinai.io/login | grep "Set-Cookie"
# HttpOnly; Secure; SameSite=Lax 확인

# CORS 정책
curl -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS https://dashboard.sentinai.io/api/auth/siwe/verify
# Access-Control-Allow-Origin 없음 (좋음)
```

---

## 6️⃣ 배포 체크리스트

- [ ] Root App 배포됨 (Docker / 클라우드)
- [ ] 환경변수 설정됨:
  - [ ] MARKETPLACE_WALLET_KEY
  - [ ] SENTINAI_API_KEY
  - [ ] L2_RPC_URL
  - [ ] (선택) REDIS_URL
- [ ] Root App 헬스체크 통과 (`/api/health`)
- [ ] Root App SIWE 엔드포인트 응답 (`/api/auth/siwe/nonce`)
- [ ] Website Vercel 배포됨
- [ ] Website 환경변수 설정됨:
  - [ ] NEXT_PUBLIC_ADMIN_URL = Root App /login URL
- [ ] Website ADMIN 링크 클릭 → Root App /login으로 이동
- [ ] 자동화 E2E 테스트 통과 (`deploy-test.spec.ts`)
- [ ] 수동 SIWE 인증 플로우 확인
- [ ] 성능 테스트 (응답 시간 확인)
- [ ] 보안 테스트 (쿠키, HTTPS, CORS)
- [ ] 에러 시나리오 검증

---

## 7️⃣ 문제 해결

### Root App에 연결할 수 없음

```
현상: https://dashboard.sentinai.io 접근 불가

해결:
1. 배포 서버 상태 확인
   - 서버 실행 중인지 확인
   - 포트 3002 오픈 확인

2. 방화벽 / 보안 그룹 확인
   - AWS: Security Group 포트 443(HTTPS), 80(HTTP) 오픈
   - 방화벽: 인바운드 규칙 확인

3. DNS 확인
   - nslookup dashboard.sentinai.io
   - 올바른 IP로 리소스되는지 확인
```

### NEXT_PUBLIC_ADMIN_URL이 반영되지 않음

```
현상: Website의 ADMIN 링크가 여전히 localhost:3002 가리킴

해결:
1. Vercel 환경변수 설정 확인
   - Vercel Dashboard → Settings → Environment Variables
   - NEXT_PUBLIC_ADMIN_URL이 있는지 확인

2. 배포 재실행
   - git push origin main (자동 배포)
   또는
   - vercel --prod (수동 배포)

3. 캐시 초기화
   - 브라우저 개발자 도구: Network 탭 "Disable cache" 활성화
   - 또는 Ctrl+Shift+Delete (전체 캐시 삭제)

4. Vercel 배포 로그 확인
   - Vercel Dashboard → Deployments → 최신 배포
   - Build Output에서 환경변수 확인
```

### "Signature verification failed"

```
현상: SIWE 서명 후 "Signature verification failed" 에러

원인:
1. 관리자 주소 불일치
   - MARKETPLACE_WALLET_KEY가 배포 환경에 설정 안 됨
   - 잘못된 개인키가 설정됨

2. 메시지 변조
   - Nonce 변경됨
   - Chain ID, URI 변경됨

해결:
1. MARKETPLACE_WALLET_KEY 확인
   docker exec sentinai-dashboard env | grep MARKETPLACE_WALLET_KEY

2. 관리자 주소 확인
   - viem에서 MARKETPLACE_WALLET_KEY → 주소 유도
   - MetaMask에서 서명할 때 사용한 주소와 비교

3. 로그 확인
   docker logs sentinai-dashboard | grep "verification\|signature"
```

---

## 참고

- **마켓플레이스 아키텍처**: `docs/MARKETPLACE_ARCHITECTURE.md`
- **배포 후 테스트**: `docs/DEPLOYMENT_TEST.md`
- **E2E 테스트 스크립트**: `e2e/deploy-test.spec.ts`
