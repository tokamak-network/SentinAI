# Website Marketplace Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the website marketplace with API endpoints, library helpers, and tests enabling public SentinAI service sales at https://sentinai-xi.vercel.app/marketplace

**Architecture:** Website acts as a stateless public interface to the root app's marketplace data. All data fetches from `http://localhost:3002/api/agent-marketplace/**`. 402 payment simulation allows buyer education without blockchain integration.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Playwright (E2E), x402 payment simulation

---

## Chunk 1: Library & Public API Endpoints

### Task 1: Create `website/src/lib/agent-marketplace.ts`

**Files:**
- Create: `website/src/lib/agent-marketplace.ts`

**Context:** This file provides fetch helpers to communicate with the root app and exports public utilities that `page.tsx` already imports. The page already expects these exports to exist, so we fill them in.

- [ ] **Step 1: Write the library with fetch helper + public utilities**

```typescript
// website/src/lib/agent-marketplace.ts

import { type ReactNode } from 'react';

// ─── Configuration ────────────────────────────────────────────────────────────

export const ROOT_APP_URL = process.env.NEXT_PUBLIC_ROOT_APP_URL
  ?? process.env.ROOT_APP_URL
  ?? 'http://localhost:3002';

// ─── Types (mirror root app types) ────────────────────────────────────────────

export interface ServicePrice {
  network: string;
  asset: string;
  amount: string;
  scheme: 'exact' | 'minimum';
}

export interface Catalog {
  services: Array<{
    key: string;
    displayName: string;
    description: string;
    payment: ServicePrice;
  }>;
  payment: {
    protocol: string;
    network: string;
    asset: string;
  };
}

export interface AgentManifest {
  endpoint: string;
  version: string;
  payment: {
    protocol: string;
    network: string;
    asset: string;
  };
  capabilities: string[];
}

export interface RegistryRow {
  agent: string;
  agentId: string;
  agentUri: string;
  manifest?: {
    name: string;
    version: string;
    paymentNetwork: string;
    capabilities: string[];
    endpoint: string;
  };
  manifestStatus: 'ok' | 'error';
}

// ─── Root App Communication ───────────────────────────────────────────────────

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
      throw new Error(`Root app error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    console.error('[agent-marketplace] fetch error:', error);
    throw error; // Let API route handle retry/fallback
  }
}

// ─── Public Helpers (used by page.tsx) ────────────────────────────────────────

export const websiteAgentMarketplaceCatalog: Catalog = {
  services: [
    {
      key: 'sequencer_health',
      displayName: 'Sequencer Health',
      description: 'Real-time sequencer availability and performance monitoring',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '1000000000', // 1 TON in nano
        scheme: 'exact',
      },
    },
    {
      key: 'incident_summary',
      displayName: 'Incident Summary',
      description: 'Aggregated incident reports with root cause analysis',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '2000000000', // 2 TON
        scheme: 'exact',
      },
    },
    {
      key: 'batch_submission_status',
      displayName: 'Batch Submission Status',
      description: 'Batch processing metrics and submission queue health',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '500000000', // 0.5 TON
        scheme: 'exact',
      },
    },
  ],
  payment: {
    protocol: 'x402',
    network: 'ton',
    asset: 'TON',
  },
};

export type MarketplaceTab = 'instance' | 'registry' | 'guide' | 'sandbox';

export function resolveMarketplaceTab(value: string | undefined): MarketplaceTab {
  if (value === 'instance' || value === 'guide' || value === 'sandbox') {
    return value;
  }
  return 'registry';
}

export function formatTonAmount(amount: string | null | undefined): string {
  if (!amount || !/^\d+$/.test(amount)) {
    return 'N/A';
  }
  const normalized = amount.padStart(19, '0');
  const whole = normalized.slice(0, -18).replace(/^0+/, '') || '0';
  const fraction = normalized.slice(-18).slice(0, 2).replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} TON`;
}

export function toWebsiteAgentMarketplaceManifest(): AgentManifest {
  return {
    endpoint: '/api/agent-marketplace/catalog',
    version: '1.0.0',
    payment: websiteAgentMarketplaceCatalog.payment,
    capabilities: websiteAgentMarketplaceCatalog.services.map(s => s.key),
  };
}

export function toServiceRoutePath(serviceKey: string): string {
  return `/api/agent-marketplace/${serviceKey.replace(/_/g, '-')}`;
}

export function getWebsiteAgentMarketplaceRegistryRows(): RegistryRow[] {
  // Static registry for now. In future, fetch from root app.
  return [
    {
      agent: 'SentinAI',
      agentId: '0x01',
      agentUri: 'sentinai://agent/v1',
      manifest: {
        name: 'SentinAI Marketplace Agent',
        version: '1.0.0',
        paymentNetwork: 'ton',
        capabilities: websiteAgentMarketplaceCatalog.services.map(s => s.key),
        endpoint: '/api/agent-marketplace/agent.json',
      },
      manifestStatus: 'ok',
    },
  ];
}
```

- [ ] **Step 2: Verify imports by checking `website/src/app/marketplace/page.tsx` still builds**

Run:
```bash
cd website
npm run build 2>&1 | head -50
```

Expected: No TypeScript errors related to `agent-marketplace` imports. May have other errors unrelated to this file.

- [ ] **Step 3: Commit**

```bash
git add website/src/lib/agent-marketplace.ts
git commit -m "feat(website): add agent-marketplace library with fetch helpers"
```

---

### Task 2: Create `website/src/app/api/agent-marketplace/catalog/route.ts`

**Files:**
- Create: `website/src/app/api/agent-marketplace/catalog/route.ts`

**Context:** Public endpoint that fetches from root app and proxies the response. No payment required.

- [ ] **Step 1: Write the route handler**

```typescript
// website/src/app/api/agent-marketplace/catalog/route.ts

import { fetchFromRootApp, type Catalog } from '@/lib/agent-marketplace';

export const revalidate = 60; // ISR

export async function GET() {
  try {
    const catalog = await fetchFromRootApp<Catalog>(
      '/api/agent-marketplace/catalog'
    );
    return Response.json(catalog);
  } catch (error) {
    console.error('[catalog] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch catalog from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

- [ ] **Step 2: Test locally by making a request**

Run:
```bash
cd website
curl http://localhost:3000/api/agent-marketplace/catalog
```

Expected: Either a valid JSON response (if root app is running) or `502 upstream_error`. Either is fine at this stage.

- [ ] **Step 3: Commit**

```bash
git add website/src/app/api/agent-marketplace/catalog/route.ts
git commit -m "feat(website): add /api/agent-marketplace/catalog endpoint"
```

---

### Task 3: Create `website/src/app/api/agent-marketplace/agent.json/route.ts`

**Files:**
- Create: `website/src/app/api/agent-marketplace/agent.json/route.ts`

**Context:** Public endpoint for agent manifest. No payment required.

- [ ] **Step 1: Write the route handler**

```typescript
// website/src/app/api/agent-marketplace/agent.json/route.ts

import { fetchFromRootApp, type AgentManifest } from '@/lib/agent-marketplace';

export const revalidate = 60; // ISR

export async function GET() {
  try {
    const manifest = await fetchFromRootApp<AgentManifest>(
      '/api/agent-marketplace/agent.json'
    );
    return Response.json(manifest);
  } catch (error) {
    console.error('[agent.json] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch agent manifest from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

- [ ] **Step 2: Test locally**

```bash
curl http://localhost:3000/api/agent-marketplace/agent.json
```

Expected: 502 or valid JSON depending on root app state.

- [ ] **Step 3: Commit**

```bash
git add website/src/app/api/agent-marketplace/agent.json/route.ts
git commit -m "feat(website): add /api/agent-marketplace/agent.json endpoint"
```

---

### Task 4: Create `website/src/app/api/agent-marketplace/sequencer-health/route.ts`

**Files:**
- Create: `website/src/app/api/agent-marketplace/sequencer-health/route.ts`

**Context:** Paid endpoint with 402 simulation. Validates `X-PAYMENT` header before proxying to root app.

- [ ] **Step 1: Write the route handler with 402 logic**

```typescript
// website/src/app/api/agent-marketplace/sequencer-health/route.ts

import { fetchFromRootApp } from '@/lib/agent-marketplace';

export const revalidate = 0; // No caching for paid endpoints

function validatePaymentEnvelope(envelope: string): boolean {
  try {
    const decoded = Buffer.from(envelope, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return typeof parsed.agentId === 'string';
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const paymentHeader = req.headers.get('X-PAYMENT');

  // Check for payment header
  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Payment required. Send X-PAYMENT header with base64 envelope',
      }),
      {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Validate payment envelope
  if (!validatePaymentEnvelope(paymentHeader)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_payment_envelope',
        message: 'X-PAYMENT must be valid base64-encoded JSON with agentId',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Fetch from root app
  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/sequencer-health'
    );
    return Response.json(data);
  } catch (error) {
    console.error('[sequencer-health] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch from root app',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function OPTIONS() {
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

- [ ] **Step 2: Test 402 response (no header)**

```bash
curl -i http://localhost:3000/api/agent-marketplace/sequencer-health
```

Expected: `402 Payment Required`

- [ ] **Step 3: Test 400 response (invalid header)**

```bash
curl -i http://localhost:3000/api/agent-marketplace/sequencer-health \
  -H "X-PAYMENT: invalid-base64!!!"
```

Expected: `400 invalid_payment_envelope`

- [ ] **Step 4: Test with valid header**

```bash
ENVELOPE=$(echo -n '{"agentId":"test-buyer"}' | base64)
curl -i http://localhost:3000/api/agent-marketplace/sequencer-health \
  -H "X-PAYMENT: $ENVELOPE"
```

Expected: `502` (if root app down) or `200` (if running). Either is expected here.

- [ ] **Step 5: Commit**

```bash
git add website/src/app/api/agent-marketplace/sequencer-health/route.ts
git commit -m "feat(website): add /api/agent-marketplace/sequencer-health with 402 simulation"
```

---

### Task 5: Create `website/src/app/api/agent-marketplace/incident-summary/route.ts`

**Files:**
- Create: `website/src/app/api/agent-marketplace/incident-summary/route.ts`

**Context:** Paid endpoint, mirrors `sequencer-health` logic.

- [ ] **Step 1: Write the route handler (same pattern as sequencer-health)**

```typescript
// website/src/app/api/agent-marketplace/incident-summary/route.ts

import { fetchFromRootApp } from '@/lib/agent-marketplace';

export const revalidate = 0;

function validatePaymentEnvelope(envelope: string): boolean {
  try {
    const decoded = Buffer.from(envelope, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return typeof parsed.agentId === 'string';
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const paymentHeader = req.headers.get('X-PAYMENT');

  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Payment required. Send X-PAYMENT header with base64 envelope',
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!validatePaymentEnvelope(paymentHeader)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_payment_envelope',
        message: 'X-PAYMENT must be valid base64-encoded JSON with agentId',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/incident-summary'
    );
    return Response.json(data);
  } catch (error) {
    console.error('[incident-summary] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
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

- [ ] **Step 2: Quick validation (402 without header)**

```bash
curl -i http://localhost:3000/api/agent-marketplace/incident-summary | grep 402
```

Expected: `402`

- [ ] **Step 3: Commit**

```bash
git add website/src/app/api/agent-marketplace/incident-summary/route.ts
git commit -m "feat(website): add /api/agent-marketplace/incident-summary with 402 simulation"
```

---

### Task 6: Create `website/src/app/api/agent-marketplace/batch-submission-status/route.ts`

**Files:**
- Create: `website/src/app/api/agent-marketplace/batch-submission-status/route.ts`

**Context:** Paid endpoint, same pattern.

- [ ] **Step 1: Write the route handler**

```typescript
// website/src/app/api/agent-marketplace/batch-submission-status/route.ts

import { fetchFromRootApp } from '@/lib/agent-marketplace';

export const revalidate = 0;

function validatePaymentEnvelope(envelope: string): boolean {
  try {
    const decoded = Buffer.from(envelope, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return typeof parsed.agentId === 'string';
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const paymentHeader = req.headers.get('X-PAYMENT');

  if (!paymentHeader) {
    return new Response(
      JSON.stringify({
        error: 'payment_required',
        message: 'Payment required. Send X-PAYMENT header with base64 envelope',
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!validatePaymentEnvelope(paymentHeader)) {
    return new Response(
      JSON.stringify({
        error: 'invalid_payment_envelope',
        message: 'X-PAYMENT must be valid base64-encoded JSON with agentId',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const data = await fetchFromRootApp(
      '/api/agent-marketplace/batch-submission-status'
    );
    return Response.json(data);
  } catch (error) {
    console.error('[batch-submission-status] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
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

- [ ] **Step 2: Quick validation**

```bash
curl -i http://localhost:3000/api/agent-marketplace/batch-submission-status | grep 402
```

Expected: `402`

- [ ] **Step 3: Commit**

```bash
git add website/src/app/api/agent-marketplace/batch-submission-status/route.ts
git commit -m "feat(website): add /api/agent-marketplace/batch-submission-status with 402 simulation"
```

---

## Summary of Chunk 1

✅ Created library with fetch helpers + public utilities
✅ Created 5 API endpoints (2 public, 3 paid with 402)
✅ All endpoints implement CORS OPTIONS
✅ 402 validation logic functional

**Commits made:** 6

**Next:** Chunk 2 will cover UI updates (navigation) and E2E tests.

---

## Chunk 2: UI Navigation & E2E Tests

### Task 7: Update `website/src/app/page.tsx` Navigation

**Files:**
- Modify: `website/src/app/page.tsx:58-74` (Navbar nav links)

**Context:** The navbar already has `{ href: '/marketplace', label: 'MARKETPLACE' }` in the nav links array. We just need to verify it's there and committed properly.

- [ ] **Step 1: Verify current navbar structure**

Read the file:
```bash
grep -A 5 "{ href: '/marketplace'" website/src/app/page.tsx
```

Expected output: Should show MARKETPLACE link is already present in nav array.

- [ ] **Step 2: No changes needed if already present**

If the link is there, skip to Step 3. If not present, add it:

```typescript
// Around line 58-62 in Navbar function
{
  { href: '/docs', label: 'DOCS' },
  { href: '/connect', label: 'DEPLOY' },
  { href: '/marketplace', label: 'MARKETPLACE' },  // ← Ensure this is here
}
```

- [ ] **Step 3: Commit (if modified)**

```bash
git add website/src/app/page.tsx
git commit -m "feat(website): ensure MARKETPLACE link in navbar navigation"
```

If no changes were made, skip this commit.

---

### Task 8: Create `website/e2e/marketplace-page.spec.ts`

**Files:**
- Create: `website/e2e/marketplace-page.spec.ts`

**Context:** Comprehensive E2E + integration tests covering:
1. Navigation from landing page to marketplace
2. All 4 marketplace tabs render
3. Tab switching works
4. 402 simulation (without/with payment header)
5. Root app ↔ website data flow

- [ ] **Step 1: Write the E2E test suite**

```typescript
// website/e2e/marketplace-page.spec.ts

import { test, expect, type Page } from '@playwright/test';

test.describe('Marketplace Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/marketplace');
  });

  test('displays all 4 tabs', async ({ page }) => {
    await expect(page.locator('a:has-text("THIS INSTANCE")')).toBeVisible();
    await expect(page.locator('a:has-text("BROWSE REGISTRY")')).toBeVisible();
    await expect(page.locator('a:has-text("CONNECT GUIDE")')).toBeVisible();
    await expect(page.locator('a:has-text("BUYER SANDBOX")')).toBeVisible();
  });

  test('instance tab shows live services', async ({ page }) => {
    await page.click('a:has-text("THIS INSTANCE")');
    await expect(page.locator('text=LIVE SERVICES')).toBeVisible();
  });

  test('registry tab shows registered instances', async ({ page }) => {
    await page.click('a:has-text("BROWSE REGISTRY")');
    await expect(page.locator('text=REGISTERED')).toBeVisible();
  });

  test('guide tab shows x402 purchase flow', async ({ page }) => {
    await page.click('a:has-text("CONNECT GUIDE")');
    await expect(page.locator('text=HOW TO BUY DATA')).toBeVisible();
    await expect(page.locator('text=/X-PAYMENT/')).toBeVisible();
  });

  test('sandbox tab shows buyer inputs', async ({ page }) => {
    await page.click('a:has-text("BUYER SANDBOX")');
    await expect(page.locator('text=BUYER SANDBOX')).toBeVisible();
    await expect(page.locator('input[type=text]')).toBeVisible();
  });

  test('tab switch persists via query param', async ({ page }) => {
    await page.click('a[href="/marketplace?tab=guide"]');
    expect(page.url()).toContain('tab=guide');
    await expect(page.locator('text=HOW TO BUY DATA')).toBeVisible();
  });
});

test.describe('Marketplace Integration (Root App)', () => {
  test('GET /api/agent-marketplace/catalog returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/catalog');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.services).toBeDefined();
    expect(Array.isArray(body.services)).toBe(true);
  });

  test('GET /api/agent-marketplace/agent.json returns 200', async ({ request }) => {
    const response = await request.get('/api/agent-marketplace/agent.json');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.endpoint).toBeDefined();
    expect(body.version).toBeDefined();
  });

  test('GET /api/agent-marketplace/sequencer-health requires payment (402 without header)', async ({ request }) => {
    const response = await request.get(
      '/api/agent-marketplace/sequencer-health'
    );
    expect(response.status()).toBe(402);
    const body = await response.json();
    expect(body.error).toBe('payment_required');
  });

  test('GET /api/agent-marketplace/sequencer-health returns 400 with invalid X-PAYMENT', async ({ request }) => {
    const response = await request.get(
      '/api/agent-marketplace/sequencer-health',
      {
        headers: {
          'X-PAYMENT': 'invalid-base64!!!',
        },
      }
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_payment_envelope');
  });

  test('GET /api/agent-marketplace/sequencer-health returns 200 with valid X-PAYMENT header', async ({ request }) => {
    const envelope = Buffer.from(
      JSON.stringify({ agentId: 'test-buyer-001' })
    ).toString('base64');

    const response = await request.get(
      '/api/agent-marketplace/sequencer-health',
      {
        headers: {
          'X-PAYMENT': envelope,
        },
      }
    );

    // 200 if root app is running, 502 if not - both are acceptable
    expect([200, 502]).toContain(response.status());
  });

  test('GET /api/agent-marketplace/incident-summary requires payment', async ({ request }) => {
    const response = await request.get(
      '/api/agent-marketplace/incident-summary'
    );
    expect(response.status()).toBe(402);
  });

  test('GET /api/agent-marketplace/batch-submission-status requires payment', async ({ request }) => {
    const response = await request.get(
      '/api/agent-marketplace/batch-submission-status'
    );
    expect(response.status()).toBe(402);
  });

  test('CORS preflight (OPTIONS) succeeds for paid endpoints', async ({ request }) => {
    const response = await request.options(
      '/api/agent-marketplace/sequencer-health'
    );
    expect(response.status()).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['access-control-allow-headers']).toContain(
      'X-PAYMENT'
    );
  });
});
```

- [ ] **Step 2: Run the E2E test to verify it works**

```bash
cd website
npx playwright test e2e/marketplace-page.spec.ts -v
```

Expected: All tests pass or fail for expected reasons (e.g., 502 if root app down, which is acceptable).

- [ ] **Step 3: Commit**

```bash
git add website/e2e/marketplace-page.spec.ts
git commit -m "test(website): add marketplace E2E and integration tests"
```

---

### Task 9: Update `website/e2e/landing-page.spec.ts`

**Files:**
- Modify: `website/e2e/landing-page.spec.ts`

**Context:** Add a test that confirms MARKETPLACE nav link exists and works.

- [ ] **Step 1: Check current content of landing page tests**

```bash
head -50 website/e2e/landing-page.spec.ts
```

- [ ] **Step 2: Add marketplace navigation test**

Add this test to the existing test suite:

```typescript
test('MARKETPLACE nav link navigates to /marketplace', async ({ page }) => {
  await page.goto('/');
  await page.click('a:has-text("MARKETPLACE")');
  expect(page.url()).toContain('/marketplace');
});
```

Or if the file needs complete rewrite:

```typescript
// website/e2e/landing-page.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has SENTINAI branding', async ({ page }) => {
    await expect(page.locator('text=SENTINAI')).toBeVisible();
  });

  test('has MARKETPLACE nav link', async ({ page }) => {
    const marketplaceLink = page.locator('a:has-text("MARKETPLACE")');
    await expect(marketplaceLink).toBeVisible();
  });

  test('MARKETPLACE nav link goes to /marketplace', async ({ page }) => {
    await page.click('a:has-text("MARKETPLACE")');
    expect(page.url()).toContain('/marketplace');
  });

  test('has DOCS nav link', async ({ page }) => {
    await expect(page.locator('a:has-text("DOCS")')).toBeVisible();
  });

  test('has DEPLOY nav link', async ({ page }) => {
    await expect(page.locator('a:has-text("DEPLOY")')).toBeVisible();
  });

  test('has GitHub link', async ({ page }) => {
    await expect(page.locator('a[href*="github.com"]')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the updated tests**

```bash
cd website
npx playwright test e2e/landing-page.spec.ts -v
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add website/e2e/landing-page.spec.ts
git commit -m "test(website): add marketplace nav link test to landing page"
```

---

### Task 10: Build & Verify

**Files:** None (verification only)

**Context:** Final check that everything builds and tests pass.

- [ ] **Step 1: Run website build**

```bash
cd website
npm run build 2>&1
```

Expected: `✓ Built successfully` or similar. No TypeScript errors.

- [ ] **Step 2: Run all E2E tests**

```bash
cd website
npx playwright test e2e/ -v
```

Expected: All tests pass or skip gracefully if root app is unavailable.

- [ ] **Step 3: Final git status**

```bash
git status
```

Expected: No untracked files (all committed).

- [ ] **Step 4: View commit log**

```bash
git log --oneline -n 10
```

Expected: Should see ~8 commits related to marketplace implementation.

---

## Summary of Chunk 2

✅ Navigation link verified/added
✅ Comprehensive E2E + integration test suite created
✅ Landing page nav test added
✅ Full build verification passed
✅ All commits made

**Commits made:** 3-4 (depending on whether page.tsx needed changes)

**Total commits for entire plan:** 9-10

---

## Success Criteria ✅

- [ ] `website/src/lib/agent-marketplace.ts` created with fetch helpers
- [ ] 5 API endpoints implemented (2 public, 3 with 402)
- [ ] 402 validation logic working
- [ ] CORS OPTIONS support on all endpoints
- [ ] Navigation link present in landing page
- [ ] E2E tests: marketplace tabs, navigation, 402 simulation
- [ ] Integration tests: root ↔ website data flow
- [ ] Website build succeeds with no TypeScript errors
- [ ] All tests pass
- [ ] All changes committed

---

## Implementation Order

1. ✅ Task 1: `agent-marketplace.ts`
2. ✅ Task 2: `/api/agent-marketplace/catalog`
3. ✅ Task 3: `/api/agent-marketplace/agent.json`
4. ✅ Task 4: `/api/agent-marketplace/sequencer-health`
5. ✅ Task 5: `/api/agent-marketplace/incident-summary`
6. ✅ Task 6: `/api/agent-marketplace/batch-submission-status`
7. ✅ Task 7: Navigation link (verify/fix)
8. ✅ Task 8: E2E marketplace tests
9. ✅ Task 9: Landing page nav test
10. ✅ Task 10: Build & verify
