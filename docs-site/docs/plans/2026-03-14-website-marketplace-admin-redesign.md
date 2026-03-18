# Website 마켓플레이스 관리자 페이지 재설계

> **핵심 원칙**: Website는 Root App과 완전히 독립적으로 동작. Vercel에 배포된 website에서만 마켓플레이스 관리 가능.

## 현재 문제점

| 항목 | 현재 (❌) | 올바른 것 (✓) |
|------|---------|------------|
| 관리자 진입점 | Website → Root App /login | Website /admin/login |
| SIWE 인증 | Root App에서 처리 | Website에서 처리 |
| 관리자 페이지 | Root App /v2/marketplace | Website /admin |
| 데이터 관리 | Root App API | Website 자체 API |
| 배포 의존성 | Root App 배포 필수 | Root App 불필요 |

## 아키텍처 재설계

```
┌────────────────────────────────────────────────┐
│         Website (Vercel)                       │
│  sentinai-xi.vercel.app                       │
├────────────────────────────────────────────────┤
│                                                │
│  PUBLIC PAGES                                  │
│  ├─ /                (랜딩 페이지)            │
│  ├─ /docs            (문서)                    │
│  ├─ /connect         (연결)                    │
│  └─ Header: [ADMIN]  (관리자 진입)            │
│                                                │
│  ADMIN SECTION                                 │
│  ├─ /admin/login     (SIWE 인증 페이지)      │
│  │  ├─ MetaMask 연결                          │
│  │  ├─ SIWE 메시지 서명                       │
│  │  └─ 세션 쿠키 발급                         │
│  │     (sentinai_admin_session)               │
│  │                                             │
│  ├─ /admin           (관리자 대시보드, 보호됨) │
│  │  ├─ /admin/dashboard      (개요)          │
│  │  ├─ /admin/catalog        (카탈로그)      │
│  │  ├─ /admin/pricing        (가격 관리)     │
│  │  ├─ /admin/orders         (주문 관리)     │
│  │  ├─ /admin/analytics      (분석)          │
│  │  ├─ /admin/payments       (결제 관리)     │
│  │  └─ [LOGOUT]              (로그아웃)      │
│  │                                             │
│  └─ API LAYER (세션 기반)                     │
│     ├─ /api/admin/auth/*        (인증)       │
│     ├─ /api/admin/catalog/*     (상품)       │
│     ├─ /api/admin/pricing/*     (가격)       │
│     ├─ /api/admin/orders/*      (주문)       │
│     └─ /api/admin/payments/*    (결제)       │
│                                                │
│  STORAGE                                       │
│  ├─ 마켓플레이스 데이터 (JSON/DB)            │
│  ├─ 운영 정보                                  │
│  └─ 가격 정책                                  │
│                                                │
└────────────────────────────────────────────────┘
              (Root App 완전 독립)
```

## 구현 순서

### Phase 1: 인증 계층 (Website 내)

#### 1.1 `website/src/lib/admin-session.ts`
- SIWE 인증 로직 (Root App의 siwe-session.ts 참조)
- 관리자 주소 관리
- 세션 토큰 생성/검증

#### 1.2 `website/src/lib/admin-nonce-store.ts`
- Nonce 저장소 (5분 TTL)
- InMemory 스토어

#### 1.3 API Routes: 인증
```
POST /api/admin/auth/nonce           (nonce 발급)
POST /api/admin/auth/verify          (SIWE 검증 + 쿠키 발급)
POST /api/admin/auth/logout          (로그아웃)
```

#### 1.4 `/admin/login` 페이지
- website 스타일의 SIWE 로그인 UI
- 기존 Root App /login과 동일 UX

### Phase 2: 관리자 대시보드

#### 2.1 `/admin` 페이지 (보호됨)
- Middleware로 세션 검증
- 로그아웃 버튼
- 서브페이지 네비게이션

#### 2.2 `/admin/catalog`
- 에이전트 카탈로그 관리
- 에이전트 등록/수정/삭제

#### 2.3 `/admin/pricing`
- 가격 정책 관리 (trainee, junior, senior, expert)
- 아웃컴 보너스 설정
- 실시간 가격 업데이트

#### 2.4 `/admin/orders`
- 주문 목록 조회
- 주문 상태 관리
- 주문 상세 정보

#### 2.5 `/admin/payments`
- 결제 정보 관리
- 미결제 주문 추적
- 결제 수수료 설정

#### 2.6 `/admin/analytics`
- 판매 통계
- 인기 에이전트
- 수익 분석

### Phase 3: 데이터 저장소

#### 3.1 `website/src/lib/admin-marketplace-store.ts`
- 마켓플레이스 데이터 저장소 인터페이스
- InMemory 구현 (개발용)
- (선택) Supabase / Firestore (배포용)

#### 3.2 저장 데이터
```typescript
interface AdminMarketplaceData {
  // 카탈로그
  agents: {
    id: string;
    name: string;
    description: string;
    imageUrl?: string;
    price: number; // USD cents
    status: 'active' | 'inactive';
  }[];

  // 가격 정책
  pricing: {
    trainee: number;
    junior: number;
    senior: number;
    expert: number;
  };

  // 주문
  orders: {
    id: string;
    agentId: string;
    buyerAddress: string;
    amount: number;
    status: 'pending' | 'completed' | 'failed';
    createdAt: string;
  }[];

  // 운영 정보
  adminAddress: string;
  updatedAt: string;
}
```

### Phase 4: API 엔드포인트

#### 4.1 Auth API
```
POST /api/admin/auth/nonce
  Query: address=0x...
  Response: { nonce: string }

POST /api/admin/auth/verify
  Body: { address, signature, message }
  Response: { ok: true }
  Cookie: sentinai_admin_session

POST /api/admin/auth/logout
  Response: 303 → /admin/login
  Cookie: sentinai_admin_session (deleted)
```

#### 4.2 Catalog API
```
GET /api/admin/catalog
  Response: { agents: Agent[] }

POST /api/admin/catalog
  Auth: 세션 쿠키 필수
  Body: { name, description, price, imageUrl }
  Response: { id, ...agent }

PUT /api/admin/catalog/:id
  Auth: 세션 쿠키 필수
  Body: { name, description, price, status }
  Response: { id, ...agent }

DELETE /api/admin/catalog/:id
  Auth: 세션 쿠키 필수
  Response: { ok: true }
```

#### 4.3 Pricing API
```
GET /api/admin/pricing
  Response: { trainee, junior, senior, expert }

PUT /api/admin/pricing
  Auth: 세션 쿠키 필수
  Body: { trainee, junior, senior, expert }
  Response: { trainee, junior, senior, expert }
```

#### 4.4 Orders API
```
GET /api/admin/orders
  Auth: 세션 쿠키 필수
  Query: ?status=pending&limit=50
  Response: { orders: Order[], total: number }

GET /api/admin/orders/:id
  Auth: 세션 쿠키 필수
  Response: { id, agentId, buyerAddress, ... }

PUT /api/admin/orders/:id/status
  Auth: 세션 쿠키 필수
  Body: { status: 'completed' | 'failed' }
  Response: { id, status, ... }
```

#### 4.5 Analytics API
```
GET /api/admin/analytics
  Auth: 세션 쿠키 필수
  Query: ?period=day|week|month
  Response: {
    totalSales: number,
    totalRevenue: number,
    topAgents: Agent[],
    revenueChart: { date, amount }[]
  }
```

### Phase 5: Middleware & 보호

#### 5.1 `website/src/middleware.ts`
```typescript
export const config = {
  matcher: ['/admin/:path*'],
};

// Admin 경로 보호
// - /admin/login은 보호 제외 (이미 로그인이 아닌 사용자)
// - /admin/* 나머지는 세션 검증
// - /api/admin/* 는 세션 필수
```

#### 5.2 세션 검증 함수
```typescript
export function isValidAdminSession(token: string): boolean {
  // satv2 토큰 포맷 검증
  // expiresAt 타임스탐프 확인
  // HMAC 검증
}
```

## 환경변수 (Website)

```env
# Vercel > Settings > Environment Variables

# 관리자 주소 (개인키에서 유도)
NEXT_PUBLIC_MARKETPLACE_ADMIN_KEY=0x...

# 세션 HMAC 키
MARKETPLACE_SESSION_KEY=your-secret-key-...

# 데이터 저장소 (선택)
SUPABASE_URL=https://...
SUPABASE_KEY=...

# 또는 Firebase
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
```

## 네비게이션 변경

### website/src/app/page.tsx

**변경 전:**
```typescript
{ href: process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3002/login', label: 'ADMIN' }
```

**변경 후:**
```typescript
{ href: '/admin/login', label: 'ADMIN' }
```

## 데이터 흐름

```
1. 사용자가 Website 방문
   └─ 공개 콘텐츠 열람 (Root App 불필요)

2. [ADMIN] 클릭 → /admin/login
   └─ SIWE 인증 (Website 자체에서 처리)
   └─ 세션 쿠키: sentinai_admin_session

3. /admin 접근 (Middleware 세션 검증)
   └─ 유효한 세션 → 관리자 페이지 렌더링
   └─ 유효하지 않은 세션 → /admin/login 리다이렉트

4. 관리자 기능 (API 호출)
   └─ /api/admin/catalog (상품 관리)
   └─ /api/admin/pricing (가격 관리)
   └─ /api/admin/orders (주문 관리)
   └─ 모두 세션 검증 필수

5. 로그아웃
   └─ /api/admin/auth/logout
   └─ 쿠키 삭제
   └─ /admin/login 리다이렉트
```

## 검증 기준

- ✅ Website는 Vercel에만 배포
- ✅ Root App 배포 여부와 무관하게 Website 동작
- ✅ 관리자 진입: Website [ADMIN] → /admin/login → SIWE → /admin
- ✅ 마켓플레이스 데이터 관리: Website 자체에서 처리
- ✅ API: Website /api/admin/* (Root App과 분리)
- ✅ 세션: Website 쿠키 기반 (Root App과 별도)

## 파일 목록

### 생성할 파일
```
website/src/lib/
  ├─ admin-session.ts          # SIWE 인증
  ├─ admin-nonce-store.ts      # Nonce 저장소
  ├─ admin-marketplace-store.ts # 데이터 저장소
  └─ admin-auth-utils.ts       # 유틸리티

website/src/app/
  ├─ admin/
  │  ├─ layout.tsx             # 관리자 레이아웃
  │  ├─ login/
  │  │  └─ page.tsx            # SIWE 로그인
  │  ├─ page.tsx               # 대시보드 (보호됨)
  │  ├─ catalog/
  │  │  └─ page.tsx            # 카탈로그 관리
  │  ├─ pricing/
  │  │  └─ page.tsx            # 가격 관리
  │  ├─ orders/
  │  │  └─ page.tsx            # 주문 관리
  │  ├─ payments/
  │  │  └─ page.tsx            # 결제 관리
  │  └─ analytics/
  │     └─ page.tsx            # 분석
  │
  └─ api/admin/
     ├─ auth/
     │  ├─ nonce/route.ts
     │  ├─ verify/route.ts
     │  └─ logout/route.ts
     ├─ catalog/route.ts
     ├─ pricing/route.ts
     ├─ orders/route.ts
     └─ analytics/route.ts

website/src/middleware.ts       # 관리자 경로 보호
```

### 수정할 파일
```
website/src/app/page.tsx        # ADMIN 링크 변경: /admin/login
website/e2e/landing-page.spec.ts # 테스트 업데이트
website/e2e/admin-auth.spec.ts   # 관리자 E2E 테스트 추가
```

## 구현 일정

1. Phase 1 (인증): 2-3일
2. Phase 2 (대시보드): 2-3일
3. Phase 3 (데이터 저장소): 1-2일
4. Phase 4 (API): 2-3일
5. Phase 5 (Middleware + 테스트): 1-2일

**총 소요 시간: 1-2주**

## 주의사항

- Root App과 분리된 SIWE 인증 구현
- 관리자 주소는 environment variable에서 읽기
- Nonce 저장소는 InMemory로 간단하게 (Vercel은 무상태)
- 데이터 저장소는 처음엔 JSON 파일 또는 Supabase
- 테스트는 Website 자체 E2E 테스트 작성
