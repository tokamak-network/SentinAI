# 마켓플레이스 아키텍처 및 동작 흐름

## 시스템 구조

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Website (Vercel)                               │
│  https://sentinai-xi.vercel.app                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 랜딩 페이지 (Public)                                          │   │
│  │ - 프로젝트 정보, 기술 스택, CTA                               │   │
│  │ - Navbar: DOCS, DEPLOY, [ADMIN] ← 관리자 진입점              │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                           ↓
                    [ADMIN] 클릭
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│         Root App (Docker / 배포 환경)                               │
│  https://dashboard.sentinai.io  (또는 배포 URL)                     │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 1. 로그인 페이지 (/login)                                     │   │
│  │    └─ SIWE 인증 (Sign-In with Ethereum)                      │   │
│  │       - MetaMask 지갑 연결                                    │   │
│  │       - 메시지 서명                                           │   │
│  │       - 세션 토큰 발급                                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                           ↓                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ 2. 마켓플레이스 관리자 페이지 (/v2/marketplace)              │   │
│  │    (세션 기반 보호)                                            │   │
│  │    - 에이전트 레지스트리                                      │   │
│  │    - 실행 인스턴스 관리                                       │   │
│  │    - 가격 정책 편집                                           │   │
│  │    - 로그아웃                                                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ API Layer (Node.js)                                          │   │
│  │ /api/auth/siwe/*  (nonce, verify, logout)                    │   │
│  │ /api/agent-marketplace/*  (ops, disputes, etc)               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 핵심 동작 흐름

### 1. 진입점: Website → Root App

```
운영자가 website 방문
      ↓
  [ADMIN] 클릭
      ↓
NEXT_PUBLIC_ADMIN_URL 환경변수 참조
      ↓
Root App의 /login 페이지로 이동
```

**Website 설정:**
```env
# Vercel > Settings > Environment Variables
NEXT_PUBLIC_ADMIN_URL=https://dashboard.sentinai.io/login
```

**Fallback (설정 없을 때):**
```javascript
// website/src/app/page.tsx line 61
process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3002/login'
```

---

### 2. SIWE 인증 흐름 (5분 TTL)

```
1️⃣  /login 페이지 로드
    └─ [CONNECT WALLET] 버튼 표시

2️⃣  [CONNECT WALLET] 클릭
    └─ window.ethereum.request('eth_requestAccounts')
       └─ MetaMask 팝업 (사용자가 지갑 선택)

3️⃣  지갑 연결 성공
    └─ GET /api/auth/siwe/nonce?address=0x...
       └─ 서버: 32자 hex nonce 생성 (5분 유효)
       └─ 응답: { nonce: "abc123..." }

4️⃣  SIWE 메시지 구성
    메시지 포맷:
    ┌──────────────────────────────────────────────────┐
    │ SentinAI wants you to sign in with your...      │
    │                                                   │
    │ {address}                                        │
    │                                                   │
    │ Sign in to SentinAI Marketplace Admin             │
    │                                                   │
    │ URI: https://dashboard.sentinai.io/login         │
    │ Version: 1                                        │
    │ Chain ID: 1                                       │
    │ Nonce: abc123...                                  │
    │ Issued At: 2026-03-14T10:00:00Z                 │
    │ Expiration Time: 2026-03-14T10:05:00Z           │
    └──────────────────────────────────────────────────┘

5️⃣  메시지 서명
    └─ window.ethereum.request('personal_sign', [message, address])
       └─ MetaMask 서명 대화상자
       └─ 사용자가 지갑으로 서명 (비밀키 노출 X)

6️⃣  SIWE 검증
    └─ POST /api/auth/siwe/verify
       {
         address: "0x...",
         signature: "0x...",
         message: "SentinAI wants you to sign..."
       }

       서버 검증:
       ├─ nonce 존재하고 미만료 확인
       ├─ viem verifyMessage()로 서명 검증
       ├─ 서명 주소 === MARKETPLACE_WALLET_KEY 주소 확인
       └─ 모두 성공 → 세션 토큰 발급

7️⃣  세션 토큰 발급
    └─ 형식: satv2_{address}_{issuedAt}_{expiresAt}_{hmac}
    └─ HMAC 키: SENTINAI_API_KEY
    └─ 예: satv2_0x1234...abcd_1710417600_1710446400_7f8e9d...

8️⃣  쿠키 설정 (HTTP 응답)
    └─ Set-Cookie: sentinai_admin_session=satv2_...
       ├─ HttpOnly (JavaScript로 접근 불가)
       ├─ Secure (HTTPS만)
       ├─ SameSite=Lax (CSRF 방지)
       ├─ Max-Age=28800 (8시간)
       └─ Path=/

9️⃣  리다이렉트
    └─ /v2/marketplace?callbackUrl=/v2/marketplace
       또는 사용자가 지정한 callbackUrl로 이동
```

---

### 3. 마켓플레이스 접근 (세션 기반)

```
/v2/marketplace 또는 하위 경로 접근
      ↓
Middleware 검증 (Edge Runtime)
├─ 요청의 sentinai_admin_session 쿠키 확인
├─ 토큰 형식 파싱 (satv2_*_*_*_*)
├─ expiresAt 타임스탐프 비교 (만료 검사)
└─ 유효하면: 페이지 렌더링
   무효하면: /login?callbackUrl={원래URL} 리다이렉트

로그인 성공 후:
  ↓
/v2/marketplace 페이지 렌더링
  ├─ 헤더: "SentinAI Marketplace Admin" + [LOGOUT]
  ├─ 4개 탭:
  │  ├─ registry: 등록된 에이전트 목록
  │  ├─ instance: 실행 중인 인스턴스
  │  ├─ guide: 사용 가이드
  │  └─ sandbox: 테스트 환경
  └─ 관리 기능
```

---

### 4. 로그아웃

```
[LOGOUT] 버튼 클릭
      ↓
POST /api/auth/siwe/logout
      ↓
서버:
├─ sentinai_admin_session 쿠키 삭제
├─ HTTP 303 See Other
└─ Location: /login

브라우저:
└─ /login으로 리다이렉트
   └─ 쿠키 삭제됨 → 재인증 필요
```

---

## 배포 체크리스트

### Root App 배포

```bash
# 1. 환경변수 설정 (배포 환경)
MARKETPLACE_WALLET_KEY=0x... # 관리자 개인키
SENTINAI_API_KEY=sentinai... # 세션 HMAC 키
L2_RPC_URL=https://...       # 체인 RPC
REDIS_URL=redis://...        # (선택) 세션 영속성

# 2. Docker 빌드 & 배포
docker build -t sentinai-dashboard .
docker run -p 3002:3002 \
  -e MARKETPLACE_WALLET_KEY=$MARKETPLACE_WALLET_KEY \
  -e SENTINAI_API_KEY=$SENTINAI_API_KEY \
  -e L2_RPC_URL=$L2_RPC_URL \
  sentinai-dashboard

# 3. 배포 URL 기록
# 예: https://dashboard.sentinai.io
```

### Website 배포 (Vercel)

```bash
# 1. Vercel 환경변수 설정
NEXT_PUBLIC_ADMIN_URL=https://dashboard.sentinai.io/login

# 2. Git에 푸시
git push origin main
# → Vercel이 자동으로 배포

# 3. 배포 완료 확인
# Vercel Dashboard → Deployments
# Production URL: https://sentinai-xi.vercel.app
```

---

## 보안 모델

| 계층 | 메커니즘 | 목적 |
|------|---------|------|
| **전송** | HTTPS (Secure 쿠키) | 중간자 공격 방지 |
| **인증** | SIWE + 개인키 서명 | 중앙 인증 서버 불필요 |
| **재생 공격** | Nonce (5분 TTL, 1회 사용) | 재생 공격 방지 |
| **세션** | HMAC-SHA256 토큰 | 토큰 위조 방지 |
| **쿠키** | HttpOnly + SameSite | XSS/CSRF 방지 |
| **관리자 검증** | 서명 주소 === MARKETPLACE_WALLET_KEY | 무단 접근 방지 |

---

## 트러블슈팅

### "Invalid address format" 에러

```bash
# nonce 요청 시 주소 형식 확인
curl "https://dashboard.sentinai.io/api/auth/siwe/nonce?address=0x1234...abcd"
#                                                       ↑─────────────────
#                                                       0x + 40개 16진수
```

### "Signature verification failed"

```
원인:
1. 서명을 생성한 주소 ≠ MARKETPLACE_WALLET_KEY에서 유도된 주소
2. 메시지가 변조됨 (Nonce, URI, Chain ID 등)
3. 지갑이 다른 체인에서 서명함

해결:
- MARKETPLACE_WALLET_KEY 배포 환경에 설정 확인
- 서명할 메시지가 정확한지 확인
- MetaMask Chain ID: Ethereum Mainnet (1)
```

### "Session token expired"

```
원인: 8시간 이상 경과

해결: 다시 로그인 (/login 접근)
```

---

## 테스트

```bash
# 로컬 개발 (전체 테스트)
npm run test:e2e

# 배포 환경 테스트
DEPLOY_URL=https://dashboard.sentinai.io \
WEBSITE_URL=https://sentinai-xi.vercel.app \
npx playwright test e2e/deploy-test.spec.ts --headed
```
