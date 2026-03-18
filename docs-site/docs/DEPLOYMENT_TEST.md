# 배포 후 Playwright 기능 테스트

SentinAI SIWE 관리자 인증 시스템을 배포 후 검증하기 위한 가이드입니다.

## 전제 조건

- ✅ 코드 빌드 완료 (npm run build)
- ✅ root app 배포됨 (예: `https://dashboard.sentinai.io`)
- ✅ website app 배포됨 (Vercel: `https://sentinai-xi.vercel.app`)
- ✅ 환경변수 설정:
  - `MARKETPLACE_WALLET_KEY`: 16진수 개인키 (관리자 주소 유도)
  - `SENTINAI_API_KEY`: API 인증용

## 1. 배포 상태 검증 (자동 테스트)

```bash
# root app 배포 환경에서 테스트
DEPLOY_URL=https://dashboard.sentinai.io \
WEBSITE_URL=https://sentinai-xi.vercel.app \
npx playwright test e2e/deploy-test.spec.ts --headed
```

**테스트 항목:**
- ✅ 루트 앱 헬스체크
- ✅ `/v2/marketplace` SIWE 게이트 동작
- ✅ `/login` 페이지 렌더링
- ✅ `/api/auth/siwe/nonce` 엔드포인트 응답
- ✅ 로그아웃 엔드포인트 접근성
- ✅ website 네비게이션에 ADMIN 링크 존재

## 2. 전체 인증 플로우 (수동 테스트)

### A. Website에서 ADMIN 버튼 클릭

```
https://sentinai-xi.vercel.app
  ↓ [ADMIN] 클릭
  ↓
https://dashboard.sentinai.io/login
```

**확인사항:**
- [ ] 페이지 헤더: "SENTINAI Marketplace Admin" 빨간색(#D40000)
- [ ] "Connect your Ethereum wallet" 텍스트 보임
- [ ] [CONNECT WALLET] 버튼 활성화

### B. MetaMask 지갑 연결

1. MetaMask 확장 설치 / 지갑 보유 확인
2. 페이지의 [CONNECT WALLET] 클릭
3. MetaMask 팝업에서 "Accept" → "Sign" 클릭

**확인사항:**
- [ ] 지갑 주소 표시됨
- [ ] 상태 변화: "Connecting" → "Signing" → "Verifying" → "Success ✓"
- [ ] 자동 리다이렉트: `/v2/marketplace` 이동

### C. 마켓플레이스 관리자 페이지 접근

```
https://dashboard.sentinai.io/v2/marketplace
```

**확인사항:**
- [ ] 페이지 로드됨 (인증된 세션)
- [ ] 헤더에 로그아웃 버튼 보임
- [ ] 마켓플레이스 탭 네비게이션 동작:
  - `registry` (에이전트 목록)
  - `instance` (실행 인스턴스)
  - `guide` (가이드)
  - `sandbox` (테스트)

### D. 세션 쿠키 검증

브라우저 DevTools → Application → Cookies에서 확인:

```
Name: sentinai_admin_session
Value: satv2_0x..._{issuedAt}_{expiresAt}_{hmac}
HttpOnly: ✓
Secure: ✓ (HTTPS)
SameSite: Lax
Max-Age: 28800 (8시간)
```

### E. 로그아웃

마켓플레이스 페이지 헤더의 [LOGOUT] 버튼 클릭

**확인사항:**
- [ ] 쿠키 삭제됨 (`sentinai_admin_session` 제거)
- [ ] `/login?callbackUrl=/v2/marketplace` 리다이렉트
- [ ] 페이지 접근 불가 (재인증 필요)

## 3. 에러 시나리오 검증

### A. 잘못된 지갑 서명

1. `/login` 페이지 접근
2. 서명 요청 시 MetaMask에서 "Cancel" 클릭

**확인사항:**
- [ ] 에러 메시지: "User rejected the request" 또는 유사
- [ ] 상태: "error", 버튼 재활성화

### B. MetaMask 미설치

1. 브라우저의 MetaMask 확장 일시 비활성화
2. `/login` 페이지 접근 후 [CONNECT WALLET] 클릭

**확인사항:**
- [ ] 에러 메시지: "MetaMask or compatible wallet not detected"
- [ ] 설치 지침 제시

### C. 잘못된 주소로 접근

```bash
# curl로 nonce 요청 (유효하지 않은 주소)
curl "https://dashboard.sentinai.io/api/auth/siwe/nonce?address=0xinvalid"
```

**확인사항:**
- [ ] HTTP 400 응답
- [ ] 에러 메시지: "Invalid address format"

## 4. 자동화 E2E 테스트 (전체 스위트)

```bash
# 로컬 개발 환경에서 모든 테스트 실행
npm run test:e2e

# 또는 배포 환경에서 특정 테스트만
DEPLOY_URL=https://dashboard.sentinai.io npx playwright test e2e/marketplace-auth.spec.ts
```

## 5. 성능 및 보안 검증

### A. 응답 시간

```bash
# nonce 발급: < 100ms
time curl -s "https://dashboard.sentinai.io/api/auth/siwe/nonce?address=0x..." | jq

# SIWE 검증: < 500ms
time curl -s -X POST https://dashboard.sentinai.io/api/auth/siwe/verify \
  -H "Content-Type: application/json" \
  -d '{"address":"0x...","signature":"0x...","message":"..."}'
```

### B. 보안 헤더 확인

```bash
curl -I https://dashboard.sentinai.io/login | grep -i "set-cookie"
```

**확인사항:**
- [ ] `HttpOnly` 플래그 있음
- [ ] `Secure` 플래그 있음 (HTTPS)
- [ ] `SameSite=Lax` 설정됨

### C. CORS 정책 확인

```bash
# 다른 도메인에서 API 접근 시도 (예상: 차단)
curl -H "Origin: https://attacker.com" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS https://dashboard.sentinai.io/api/auth/siwe/verify
```

## 6. 트러블슈팅

### "MetaMask not detected" 에러가 계속 나타남

- **원인:** `window.ethereum` 미지원
- **해결:**
  1. MetaMask 최신 버전 확인 (확장 재설치)
  2. 다른 EVM 지갑 시도 (Trust Wallet, Rabby 등)
  3. 개인키 입력 방식으로 변경 검토

### "Invalid nonce" 에러

- **원인:** 5분 만료된 nonce로 재시도, 중복 사용
- **해결:** 새로운 로그인 시작 (nonce 재발급)

### "Signature verification failed" 에러

- **원인:** 관리자 주소와 서명 주소 불일치
- **해결:**
  1. `MARKETPLACE_WALLET_KEY` 배포 환경에 설정 확인
  2. 관리자 주소와 서명 주소가 동일한지 확인
  3. 로그: `/api/auth/siwe/verify` 응답 메시지 확인

### "Session token expired" 에러

- **원인:** 8시간 이상 경과
- **해결:** 다시 로그인

## 7. 배포 체크리스트

- [ ] 환경변수 설정
  - `MARKETPLACE_WALLET_KEY` (관리자 개인키)
  - `SENTINAI_API_KEY` (API 인증)
  - `REDIS_URL` (선택사항, 세션 영속성)
- [ ] 자동화 테스트 모두 통과 (로컬)
- [ ] 배포 환경 헬스체크 통과 (deploy-test.spec.ts)
- [ ] 수동 E2E 플로우 검증 완료
- [ ] 에러 시나리오 테스트 완료
- [ ] 성능/보안 점검 완료

## 참고

- **SIWE 표준:** [EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)
- **세션 토큰 형식:** `satv2_{address}_{issuedAt}_{expiresAt}_{hmac}`
- **Nonce TTL:** 5분
- **세션 TTL:** 8시간
