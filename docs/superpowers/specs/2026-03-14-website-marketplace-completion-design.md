# Website Marketplace Completion Design

**Date**: 2026-03-14
**Project**: SentinAI Website Marketplace
**Objective**: Complete the website marketplace implementation to enable public SentinAI service sales at https://sentinai-xi.vercel.app/marketplace

---

## 1. Overview

### Goal
Finish the website marketplace surface with API endpoints, library helpers, and comprehensive tests. The website serves as a public, read-only interface to the root app's marketplace data, with x402 payment simulation for buyer education.

### Scope
- Implement 5 API endpoints (`/api/agent-marketplace/*`)
- Create `website/src/lib/agent-marketplace.ts` (fetch + type utilities)
- Update landing page navigation
- Add E2E + integration tests
- Verify root ↔ website data flow

### Non-Scope
- Actual blockchain payment processing (simulation only)
- Multi-agent registry (SentinAI services only; extensible for future)
- Backend marketplace modifications (read root app data as-is)

---

## 2. Architecture

### Data Flow
```
User → website/marketplace → page.tsx (SSR)
                           ↓
                    website/lib/agent-marketplace.ts
                           ↓
                   website/api/agent-marketplace/*
                           ↓
                  (validate 402) → (fetch from root app)
                           ↓
           root app: /api/agent-marketplace/**
```

### Key Principles
1. **Root app is source of truth**: All data originates from `http://localhost:3002/api/agent-marketplace/**`
2. **Website is stateless**: No database, only fetch + serve + simulate payments
3. **Separation of concerns**:
   - UI logic: `page.tsx` (unchanged)
   - Communication: `lib/agent-marketplace.ts` (fetch helpers)
   - HTTP handling: `api/agent-marketplace/**/route.ts` (402 validation + proxy)

---

## 3. File Structure

### New Files
```
website/src/
├── lib/
│   └── agent-marketplace.ts
│       ├── export const ROOT_APP_URL
│       ├── export async function fetchFromRootApp<T>(path)
│       ├── export async function getWebsiteAgentMarketplaceCatalog()
│       ├── export async function getWebsiteAgentManifest()
│       ├── export { resolveMarketplaceTab, formatTonAmount, ... }
│       └── (and other public utilities)
│
├── app/
│   └── api/
│       └── agent-marketplace/
│           ├── catalog/route.ts                    (GET, no auth)
│           ├── agent.json/route.ts                 (GET, no auth)
│           ├── sequencer-health/route.ts           (GET, 402 simulation)
│           ├── incident-summary/route.ts           (GET, 402 simulation)
│           └── batch-submission-status/route.ts    (GET, 402 simulation)

website/e2e/
├── marketplace-page.spec.ts                  (E2E + integration)
└── landing-page.spec.ts                      (modified, add nav test)
```

### Modified Files
```
website/src/app/page.tsx
  - Ensure MARKETPLACE link points to /marketplace
  - Navbar already has the link, confirm it's correct
```

---

## 4. API Endpoints

### Public Endpoints (no auth)

#### GET `/api/agent-marketplace/catalog`
```
Request:  GET /api/agent-marketplace/catalog
Response: 200 OK
Body: {
  services: [
    {
      key: string,
      displayName: string,
      description: string,
      payment: { network, asset, amount, scheme }
    },
    ...
  ],
  payment: { protocol, network, asset }
}

Behavior:
  1. Fetch from root app: GET http://localhost:3002/api/agent-marketplace/catalog
  2. Transform response to website types if needed
  3. Return 200 with data
  4. On root app error: return 500 or fallback data
```

#### GET `/api/agent-marketplace/agent.json`
```
Request:  GET /api/agent-marketplace/agent.json
Response: 200 OK
Body: {
  endpoint: string,
  version: string,
  payment: { protocol, network, asset },
  capabilities: string[]
}

Behavior:
  1. Fetch from root app: GET http://localhost:3002/api/agent-marketplace/agent.json
  2. Return 200 with data
  3. On error: return 500
```

### Paid Endpoints (402 simulation)

#### GET `/api/agent-marketplace/sequencer-health`
#### GET `/api/agent-marketplace/incident-summary`
#### GET `/api/agent-marketplace/batch-submission-status`

```
Request (without payment):
  GET /api/agent-marketplace/sequencer-health

Response: 402 Payment Required
Headers:
  X-Required-Payment: "x402 v1"
Body: {
  error: "payment_required",
  message: "Payment required. Send X-PAYMENT header with base64 envelope"
}

---

Request (with payment):
  GET /api/agent-marketplace/sequencer-health
  Headers:
    X-PAYMENT: "eyJhZ2VudElkIjoiYnV5ZXItYWdlbnQtMDAxIiwiYW1vdW50IjoiMTAwMDAwMDAwMCJ9"

Response: 200 OK
Body: {
  health: "ok" | "degraded" | "critical",
  status: string,
  timestamp: number,
  ...
}

Validation Logic:
  1. Check if X-PAYMENT header exists
  2. If missing: return 402
  3. If present: validate base64 + JSON structure
  4. If invalid: return 400 with error
  5. If valid: fetch from root app, return 200
```

---

## 5. Implementation Details

### `website/src/lib/agent-marketplace.ts`

```typescript
// Configuration
export const ROOT_APP_URL = process.env.NEXT_PUBLIC_ROOT_APP_URL
  ?? process.env.ROOT_APP_URL
  ?? 'http://localhost:3002';

// Root app communication
export async function fetchFromRootApp<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  try {
    const url = new URL(path, ROOT_APP_URL).toString();
    const res = await fetch(url, {
      ...init,
      next: { revalidate: 60 }, // ISR: revalidate every 60s
    });
    if (!res.ok) {
      throw new Error(`Root app error: ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    // Log error, return fallback or throw
    console.error('[agent-marketplace] fetch error:', error);
    throw error; // API route handles retry/fallback
  }
}

// Public helpers (existing, unchanged)
export function resolveMarketplaceTab(value?: string) { ... }
export function formatTonAmount(amount?: string) { ... }
export async function getWebsiteAgentMarketplaceRegistryRows() { ... }
// ... etc
```

### API Route Pattern (each `/api/agent-marketplace/*/route.ts`)

```typescript
// Example: sequencer-health/route.ts

export async function GET(req: Request) {
  // 1. Check payment header
  const paymentHeader = req.headers.get('X-PAYMENT');

  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Send X-PAYMENT header with base64 envelope',
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Validate base64 + JSON
  try {
    const envelope = JSON.parse(
      Buffer.from(paymentHeader, 'base64').toString()
    );
    if (!envelope.agentId) throw new Error('Invalid envelope');
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'invalid_payment_envelope' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Fetch from root app
  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/sequencer-health'
    );
    return Response.json(data);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'upstream_error' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// OPTIONS for CORS
export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-PAYMENT, Content-Type',
    },
  });
}
```

---

## 6. Error Handling

### Root App Unavailable
- **Scenario**: `http://localhost:3002` is down
- **Website behavior**: Return 502 Bad Gateway (or 500 if in prod)
- **User impact**: Marketplace page shows error, no data
- **Recovery**: Root app restarts, website auto-recovers (no state to clean)

### Invalid Payment Envelope
- **Scenario**: `X-PAYMENT` header is malformed base64 or invalid JSON
- **Response**: 400 Bad Request + error message
- **No retry**: Client should fix envelope

### Network Timeout
- **Root app fetch timeout**: Treat as 502
- **Timeout threshold**: 5 seconds (configurable via env)

---

## 7. Testing Strategy

### E2E Tests (`website/e2e/marketplace-page.spec.ts`)

**1. Navigation from landing page**
```
Given: User is on sentinai-xi.vercel.app/
When: User clicks MARKETPLACE nav link
Then: User is redirected to /marketplace
```

**2. Marketplace tabs render**
```
Given: User is on /marketplace
Then: All 4 tabs are visible:
  - THIS INSTANCE
  - BROWSE REGISTRY
  - CONNECT GUIDE
  - BUYER SANDBOX
```

**3. Tab switching**
```
Given: User is on /marketplace
When: User clicks each tab
Then: Correct content displays for each tab
```

### Integration Tests (root app ↔ website)

**4. Catalog API fetch from root**
```
Given: Root app is running with /api/agent-marketplace/catalog endpoint
When: Website calls GET /api/agent-marketplace/catalog
Then: Response is 200 with { services: [...], payment: {...} }
```

**5. 402 without payment header**
```
When: GET /api/agent-marketplace/sequencer-health (no X-PAYMENT)
Then: Response is 402 Payment Required
```

**6. 200 with payment header**
```
When: GET /api/agent-marketplace/sequencer-health
  + X-PAYMENT: base64(valid envelope)
Then: Response is 200 with payload
```

**7. Invalid payment envelope**
```
When: X-PAYMENT header is malformed base64
Then: Response is 400 Bad Request
```

---

## 8. Environment Variables

```bash
# .env.local (website)
NEXT_PUBLIC_ROOT_APP_URL=http://localhost:3002
# or
ROOT_APP_URL=http://localhost:3002

# Production (website on Vercel)
NEXT_PUBLIC_ROOT_APP_URL=https://sentinai.tokamak.network
# (adjust to actual root app deployment URL)
```

---

## 9. Deployment Notes

### Vercel (website)
- Vercel build: `npm run build` → statically generate + ISR
- Root app URL must be reachable from Vercel edge (or via CORS proxy)
- If root app is internal-only: add CORS proxy or use server-side fetch in API routes

### Docker (root app)
- Already running, no changes needed
- Ensure `/api/agent-marketplace/**` endpoints are stable

### Local Development
- Root app: `npm run dev` (localhost:3002)
- Website: `cd website && npm run dev` (localhost:3000)
- Both running simultaneously

---

## 10. Success Criteria

✅ All 5 API endpoints respond correctly
✅ 402 simulation works (with/without X-PAYMENT)
✅ Catalog/agent.json fetch from root app and display in page.tsx
✅ E2E tests pass (navigation + tabs)
✅ Integration tests pass (root ↔ website data flow)
✅ website build succeeds
✅ No TypeScript errors
✅ Lint passes

---

## 11. Implementation Order

1. Create `website/src/lib/agent-marketplace.ts` (fetch helpers)
2. Create 5 API endpoints (catalog, agent.json, 3 paid services)
3. Update `website/src/app/page.tsx` navigation
4. Create E2E test file with all scenarios
5. Run tests locally, fix failures
6. Build verification
7. Commit & ready for implementation plan
