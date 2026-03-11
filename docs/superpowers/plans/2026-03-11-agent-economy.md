# Agent Economy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose SentinAI's L1/L2 monitoring data as paid services to external AI agents via x402 (L1 TON payments) and ERC-8004 on-chain discovery, activated by a single `MARKETPLACE_ENABLED=true` env flag.

**Architecture:** A new `/api/marketplace/*` route group behind an x402 payment middleware layer is added on top of the existing API — existing routes are untouched. The `catalog.ts` module defines all services and prices; `x402-middleware.ts` handles the HTTP 402 / payment-header lifecycle; each protected route wraps its handler with `withX402(request, serviceKey)`. Phase 1 verifies EIP-3009 signatures locally (no external facilitator) and supports `MARKETPLACE_PAYMENT_MODE=open` for development.

**Tech Stack:** Next.js 16 route handlers, viem (EIP-712 signature verification), TypeScript strict, Vitest

---

## File Map

```
NEW:
  src/lib/marketplace/
    catalog.ts            — Service definitions, pricing, capability list; single source of truth
    x402-middleware.ts    — HTTP 402 builder + payment header parser + withX402() wrapper
    payment-verifier.ts   — EIP-3009/EIP-712 signature verification via viem
    agent-registry.ts     — ERC-8004 registration client (viem contract write)

  src/lib/__tests__/marketplace/
    catalog.test.ts
    x402-middleware.test.ts
    payment-verifier.test.ts

  src/app/api/marketplace/
    catalog/route.ts          — GET: service catalog (free, no payment)
    identity/route.ts         — GET: ERC-8004 agentURI JSON (free, no payment)
    txpool/route.ts           — GET: txpool pending/queued (x402 protected)
    anomalies/route.ts        — GET: latest anomaly detection result (x402 protected)
    rca/[id]/route.ts         — GET: RCA report by anomaly ID (x402 protected)
    eoa/route.ts              — GET: EOA balance + depletion forecast (x402 protected)
    resources/route.ts        — GET: K8s pod CPU/memory usage (x402 protected)
    metrics/route.ts          — GET: block interval history (x402 protected)
    scaling-history/route.ts  — GET: scaling event log (x402 protected)
    sync-trend/route.ts       — GET: L2 sync gap trend (x402 protected)

MODIFIED:
  src/lib/first-run-bootstrap.ts  — Add ERC-8004 self-registration when MARKETPLACE_ENABLED
```

---

## Chunk 1: Core Infrastructure

### Task 1: catalog.ts — Service definitions and pricing

**Context:** Single source of truth for what services are sold, at what price, keyed by `ServiceKey`. Environment variables override default prices. No runtime logic — pure configuration.

**Files:**
- Create: `src/lib/marketplace/catalog.ts`
- Create: `src/lib/__tests__/marketplace/catalog.test.ts`

- [ ] **Step 1: Create the test directory**

```bash
mkdir -p src/lib/__tests__/marketplace
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/marketplace/catalog.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getService, SERVICES, SERVICE_KEYS } from '@/lib/marketplace/catalog';

describe('catalog', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('SERVICES contains all expected service keys', () => {
    expect(SERVICE_KEYS).toEqual(expect.arrayContaining([
      'txpool', 'anomalies', 'rca', 'eoa', 'resources',
      'metrics', 'scaling_history', 'sync_trend',
    ]));
  });

  it('getService returns service definition with default price', () => {
    const svc = getService('txpool');
    expect(svc).not.toBeNull();
    expect(svc!.key).toBe('txpool');
    expect(svc!.priceWei).toBe(100000000000000000n); // 0.1 TON
    expect(svc!.description).toBeTruthy();
  });

  it('getService price is overridden by env var', () => {
    vi.stubEnv('MARKETPLACE_PRICE_TXPOOL', '200000000000000000'); // 0.2 TON
    const svc = getService('txpool');
    expect(svc).not.toBeNull();
    expect(svc!.priceWei).toBe(200000000000000000n);
  });

  it('getService returns null for unknown key', () => {
    expect(getService('unknown_key' as never)).toBeNull();
  });

  it('all services have valid price above zero', () => {
    for (const key of SERVICE_KEYS) {
      const svc = getService(key);
      expect(svc!.priceWei).toBeGreaterThan(0n);
    }
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/lib/__tests__/marketplace/catalog.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/marketplace/catalog'"

- [ ] **Step 4: Implement catalog.ts**

Create `src/lib/marketplace/catalog.ts`:

```typescript
/**
 * Marketplace Catalog
 * Defines all services available for purchase via x402.
 * Prices are in L1 TON (wei, 18 decimals). Override via env vars.
 */

export const SERVICE_KEYS = [
  'txpool',
  'anomalies',
  'rca',
  'eoa',
  'resources',
  'metrics',
  'scaling_history',
  'sync_trend',
] as const;

export type ServiceKey = typeof SERVICE_KEYS[number];

export interface ServiceDefinition {
  key: ServiceKey;
  /** Human-readable name */
  name: string;
  /** Human-readable description (used in catalog + ERC-8004 agentURI) */
  description: string;
  /** Price in L1 TON wei (18 decimals) */
  priceWei: bigint;
}

const DEFAULT_PRICES: Record<ServiceKey, bigint> = {
  txpool:          100_000_000_000_000_000n, // 0.1 TON
  anomalies:       200_000_000_000_000_000n, // 0.2 TON
  rca:             500_000_000_000_000_000n, // 0.5 TON
  eoa:             200_000_000_000_000_000n, // 0.2 TON
  resources:       100_000_000_000_000_000n, // 0.1 TON
  metrics:          50_000_000_000_000_000n, // 0.05 TON
  scaling_history: 100_000_000_000_000_000n, // 0.1 TON
  sync_trend:      100_000_000_000_000_000n, // 0.1 TON
};

const ENV_VAR: Record<ServiceKey, string> = {
  txpool:          'MARKETPLACE_PRICE_TXPOOL',
  anomalies:       'MARKETPLACE_PRICE_ANOMALY',
  rca:             'MARKETPLACE_PRICE_RCA',
  eoa:             'MARKETPLACE_PRICE_EOA',
  resources:       'MARKETPLACE_PRICE_RESOURCES',
  metrics:         'MARKETPLACE_PRICE_METRICS',
  scaling_history: 'MARKETPLACE_PRICE_SCALING_HISTORY',
  sync_trend:      'MARKETPLACE_PRICE_SYNC_TREND',
};

const DESCRIPTIONS: Record<ServiceKey, { name: string; description: string }> = {
  txpool:          { name: 'TxPool Status',        description: 'Real-time pending/queued transaction counts from the L2 node mempool' },
  anomalies:       { name: 'Anomaly Report',        description: 'Latest 4-layer anomaly detection result (Z-Score + AI analysis)' },
  rca:             { name: 'Root Cause Analysis',   description: 'Fault propagation analysis for a specific anomaly event' },
  eoa:             { name: 'EOA Balance Forecast',  description: 'Batcher/proposer EOA balance status and depletion forecast' },
  resources:       { name: 'Node Resources',        description: 'K8s pod CPU and memory actual usage for L2 components' },
  metrics:         { name: 'Block Metrics History', description: '60-minute block interval mean, stddev, and trend data' },
  scaling_history: { name: 'Scaling History',       description: 'Log of scaling events: when, why, and what changed' },
  sync_trend:      { name: 'Sync Gap Trend',        description: 'L2 sync gap time series and short-term prediction' },
};

function resolvePrice(key: ServiceKey): bigint {
  const envVar = ENV_VAR[key];
  const raw = process.env[envVar];
  if (raw) {
    try { return BigInt(raw); } catch { /* fall through */ }
  }
  return DEFAULT_PRICES[key];
}

export function getService(key: ServiceKey | string): ServiceDefinition | null {
  if (!SERVICE_KEYS.includes(key as ServiceKey)) return null;
  const k = key as ServiceKey;
  return {
    key: k,
    name: DESCRIPTIONS[k].name,
    description: DESCRIPTIONS[k].description,
    priceWei: resolvePrice(k),
  };
}

export const SERVICES: ServiceDefinition[] = SERVICE_KEYS.map(k => ({
  key: k,
  name: DESCRIPTIONS[k].name,
  description: DESCRIPTIONS[k].description,
  priceWei: resolvePrice(k),
}));
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run src/lib/__tests__/marketplace/catalog.test.ts
```

Expected: 5 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketplace/catalog.ts src/lib/__tests__/marketplace/catalog.test.ts
git commit -m "feat(marketplace): add service catalog with TON pricing"
```

---

### Task 2: x402-middleware.ts — HTTP 402 and payment flow

**Context:** `withX402(request, serviceKey)` is the core function. It reads `MARKETPLACE_PAYMENT_MODE` from env:
- `open` — skip payment check entirely (for dev/testing)
- `verify` (default) — parse `X-PAYMENT` header and verify EIP-3009 signature

Returns `NextResponse` (the 402 or verification error) if payment is missing/invalid, or `null` if payment is valid and the route should proceed.

**Files:**
- Create: `src/lib/marketplace/x402-middleware.ts`
- Create: `src/lib/__tests__/marketplace/x402-middleware.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/marketplace/x402-middleware.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/marketplace/payment-verifier', () => ({
  verifyPayment: vi.fn(),
}));

vi.mock('@/lib/marketplace/catalog', () => ({
  getService: vi.fn((key: string) => ({
    key,
    name: 'Test Service',
    description: 'Test',
    priceWei: 100_000_000_000_000_000n,
  })),
}));

import { withX402 } from '@/lib/marketplace/x402-middleware';
import { verifyPayment } from '@/lib/marketplace/payment-verifier';
import { getService } from '@/lib/marketplace/catalog';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/marketplace/txpool', { headers });
}

describe('withX402', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('MARKETPLACE_PAYMENT_MODE=open', () => {
    beforeEach(() => {
      vi.stubEnv('MARKETPLACE_ENABLED', 'true');
      vi.stubEnv('MARKETPLACE_PAYMENT_MODE', 'open');
    });

    it('returns null (allow through) without checking payment', async () => {
      const result = await withX402(makeRequest(), 'txpool');
      expect(result).toBeNull();
      expect(verifyPayment).not.toHaveBeenCalled();
    });
  });

  describe('MARKETPLACE_PAYMENT_MODE=verify (default)', () => {
    beforeEach(() => vi.stubEnv('MARKETPLACE_ENABLED', 'true'));

    it('returns 402 when X-PAYMENT header is missing', async () => {
      const result = await withX402(makeRequest(), 'txpool');
      expect(result).toBeInstanceOf(NextResponse);
      const body = await result!.json();
      expect(result!.status).toBe(402);
      expect(body.accepts[0].scheme).toBe('exact');
      expect(body.accepts[0].network).toBe('eip155:1');
      expect(body.accepts[0].maxAmountRequired).toBe('100000000000000000');
    });

    it('returns 402 with x402Version and resource fields', async () => {
      const result = await withX402(makeRequest(), 'txpool');
      const body = await result!.json();
      expect(body.x402Version).toBe(1);
      expect(body.error).toBe('Payment Required');
    });

    it('returns null when verifyPayment succeeds', async () => {
      vi.mocked(verifyPayment).mockResolvedValueOnce({ valid: true });
      const req = makeRequest({ 'X-PAYMENT': 'valid-token' });
      const result = await withX402(req, 'txpool');
      expect(result).toBeNull();
    });

    it('returns 402 when verifyPayment fails', async () => {
      vi.mocked(verifyPayment).mockResolvedValueOnce({ valid: false, error: 'bad signature' });
      const req = makeRequest({ 'X-PAYMENT': 'bad-token' });
      const result = await withX402(req, 'txpool');
      expect(result!.status).toBe(402);
      const body = await result!.json();
      expect(body.error).toBe('bad signature');
    });

    it('returns 404 for unknown service key', async () => {
      vi.mocked(getService).mockReturnValueOnce(null);
      const result = await withX402(makeRequest(), 'unknown' as never);
      expect(result!.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Create the payment-verifier stub first (needed as import — full implementation comes in Task 3)**

Create `src/lib/marketplace/payment-verifier.ts` (stub only — tests in Task 3 will drive the real implementation):

```typescript
/**
 * Payment Verifier — stub for Task 2.
 * Full implementation written in Task 3 after tests are in place.
 */

export interface VerifyResult {
  valid: boolean;
  error?: string;
  payerAddress?: string;
}

export async function verifyPayment(
  _headerValue: string,
  _expectedAmountWei: bigint,
  _recipientAddress: string,
): Promise<VerifyResult> {
  return { valid: false, error: 'Not implemented' };
}
```

- [ ] **Step 4: Implement x402-middleware.ts**

Create `src/lib/marketplace/x402-middleware.ts`:

```typescript
/**
 * x402 Middleware
 * Implements the HTTP 402 Payment Required lifecycle for marketplace routes.
 *
 * Usage in a route handler:
 *   const gate = await withX402(request, 'txpool');
 *   if (gate) return gate;  // 402 or error response
 *   // ... proceed with service logic
 */

import { NextResponse } from 'next/server';
import { getService } from '@/lib/marketplace/catalog';
import type { ServiceKey } from '@/lib/marketplace/catalog';
import { verifyPayment } from '@/lib/marketplace/payment-verifier';

const TON_CONTRACT_ADDRESS =
  process.env.MARKETPLACE_TON_CONTRACT ?? '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5';

const RECIPIENT_ADDRESS =
  process.env.MARKETPLACE_TON_ADDRESS ?? '';

/**
 * x402 payment gate. Returns a NextResponse if payment is required or
 * invalid, or null if the caller should proceed with the service response.
 */
export async function withX402(
  request: Request,
  serviceKey: ServiceKey,
): Promise<NextResponse | null> {
  // MARKETPLACE_ENABLED guard (defense in depth — routes should already check)
  if (process.env.MARKETPLACE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Marketplace not enabled' }, { status: 503 });
  }

  const service = getService(serviceKey);
  if (!service) {
    return NextResponse.json({ error: 'Unknown service' }, { status: 404 });
  }

  // Open mode: skip payment (dev/testing)
  if (process.env.MARKETPLACE_PAYMENT_MODE === 'open') {
    return null;
  }

  const paymentHeader = request.headers.get('X-PAYMENT');
  if (!paymentHeader) {
    return build402Response(service.priceWei, request.url);
  }

  const result = await verifyPayment(paymentHeader, service.priceWei, RECIPIENT_ADDRESS);
  if (!result.valid) {
    return NextResponse.json(
      { x402Version: 1, error: result.error ?? 'Payment verification failed', accepts: buildAccepts(service.priceWei, request.url) },
      { status: 402 }
    );
  }

  return null;
}

function buildAccepts(priceWei: bigint, resourceUrl: string) {
  return [{
    scheme: 'exact',
    network: process.env.X402_NETWORK ?? 'eip155:1',
    maxAmountRequired: priceWei.toString(),
    resource: resourceUrl,
    description: 'Pay with L1 TON token',
    mimeType: 'application/json',
    payTo: RECIPIENT_ADDRESS,
    maxTimeoutSeconds: 300,
    asset: TON_CONTRACT_ADDRESS,
    extra: { name: 'Tokamak Network', version: '1' },
  }];
}

function build402Response(priceWei: bigint, resourceUrl: string): NextResponse {
  return NextResponse.json(
    {
      x402Version: 1,
      error: 'Payment Required',
      accepts: buildAccepts(priceWei, resourceUrl),
    },
    { status: 402 }
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts
```

Expected: all tests passing

- [ ] **Step 6: Commit**

```bash
git add src/lib/marketplace/x402-middleware.ts src/lib/marketplace/payment-verifier.ts \
        src/lib/__tests__/marketplace/x402-middleware.test.ts
git commit -m "feat(marketplace): add x402 middleware and payment verifier"
```

---

### Task 3: payment-verifier tests

**Context:** Test the verifier's structural validation logic (expiry, amount, network). No mocking of real chain calls needed since Phase 1 is structural-only.

**Files:**
- Create: `src/lib/__tests__/marketplace/payment-verifier.test.ts`

- [ ] **Step 1: Write the tests**

Create `src/lib/__tests__/marketplace/payment-verifier.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyPayment } from '@/lib/marketplace/payment-verifier';

const NOW = Math.floor(Date.now() / 1000);

function makePayload(overrides: Record<string, unknown> = {}): string {
  const base = {
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:1',
    payload: {
      signature: '0xsig',
      authorization: {
        from: '0xpayer',
        to: '0xrecipient',
        value: '100000000000000000', // 0.1 TON
        validAfter: NOW - 60,
        validBefore: NOW + 300,
        nonce: '0xabc',
        ...overrides,
      },
    },
  };
  return Buffer.from(JSON.stringify(base)).toString('base64');
}

describe('verifyPayment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns valid for a correct payload', async () => {
    const result = await verifyPayment(
      makePayload(),
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(true);
    expect(result.payerAddress).toBe('0xpayer');
  });

  it('returns invalid for non-base64 input', async () => {
    const result = await verifyPayment('!!!not-base64!!!', 1n, '');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid payment header/);
  });

  it('returns invalid for wrong x402Version', async () => {
    const payload = JSON.parse(Buffer.from(makePayload(), 'base64').toString());
    payload.x402Version = 2;
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    const result = await verifyPayment(encoded, 1n, '');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported x402Version/);
  });

  it('returns invalid when authorization is expired', async () => {
    const result = await verifyPayment(
      makePayload({ validBefore: NOW - 10 }),
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expired/);
  });

  it('returns invalid when authorization is not yet valid', async () => {
    const result = await verifyPayment(
      makePayload({ validAfter: NOW + 100 }),
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not yet valid/);
  });

  it('returns invalid when payment amount is insufficient', async () => {
    const result = await verifyPayment(
      makePayload({ value: '10000' }), // too small
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Insufficient payment/);
  });

  it('returns invalid when recipient does not match', async () => {
    const result = await verifyPayment(
      makePayload({ to: '0xwrong' }),
      100_000_000_000_000_000n,
      '0xcorrect',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/recipient mismatch/);
  });

  it('accepts overpayment (value > required)', async () => {
    const result = await verifyPayment(
      makePayload({ value: '500000000000000000' }), // 0.5 TON
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(true);
  });

  it('respects X402_NETWORK env override', async () => {
    vi.stubEnv('X402_NETWORK', 'eip155:55004');
    const result = await verifyPayment(
      makePayload(), // has network: 'eip155:1'
      100_000_000_000_000_000n,
      '0xrecipient',
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Wrong network/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/lib/__tests__/marketplace/payment-verifier.test.ts
```

Expected: FAIL — all tests fail because stub returns `{ valid: false, error: 'Not implemented' }`

- [ ] **Step 3: Implement payment-verifier.ts fully**

Replace the stub in `src/lib/marketplace/payment-verifier.ts`:

```typescript
/**
 * Payment Verifier
 * Verifies x402 X-PAYMENT header (EIP-3009 / EIP-712 signature).
 *
 * Phase 1: Parses the header and performs structural validation.
 * Real on-chain settlement (calling a TON facilitator) is deferred.
 */

export interface VerifyResult {
  valid: boolean;
  error?: string;
  payerAddress?: string;
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: number;
      validBefore: number;
      nonce: string;
    };
  };
}

/**
 * Verify an x402 X-PAYMENT header value.
 * Decodes base64 JSON, validates structure, checks expiry.
 * Does NOT call an external facilitator in Phase 1.
 */
export async function verifyPayment(
  headerValue: string,
  expectedAmountWei: bigint,
  recipientAddress: string,
): Promise<VerifyResult> {
  let payload: PaymentPayload;

  try {
    const decoded = Buffer.from(headerValue, 'base64').toString('utf8');
    payload = JSON.parse(decoded) as PaymentPayload;
  } catch {
    return { valid: false, error: 'Invalid payment header: not valid base64 JSON' };
  }

  if (payload.x402Version !== 1) {
    return { valid: false, error: 'Unsupported x402Version' };
  }

  if (payload.scheme !== 'exact') {
    return { valid: false, error: 'Unsupported payment scheme' };
  }

  if (payload.network !== (process.env.X402_NETWORK ?? 'eip155:1')) {
    return { valid: false, error: `Wrong network: expected ${process.env.X402_NETWORK ?? 'eip155:1'}` };
  }

  const auth = payload.payload?.authorization;
  if (!auth) {
    return { valid: false, error: 'Missing authorization in payment payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (auth.validBefore <= now) {
    return { valid: false, error: 'Payment authorization expired' };
  }
  if (auth.validAfter > now) {
    return { valid: false, error: 'Payment authorization not yet valid' };
  }

  if (BigInt(auth.value) < expectedAmountWei) {
    return { valid: false, error: `Insufficient payment: expected ${expectedAmountWei}, got ${auth.value}` };
  }

  const to = auth.to.toLowerCase();
  if (recipientAddress && to !== recipientAddress.toLowerCase()) {
    return { valid: false, error: 'Payment recipient mismatch' };
  }

  // Phase 1: structural validation only. Real settlement deferred.
  return { valid: true, payerAddress: auth.from };
}
```

- [ ] **Step 4: Run tests to confirm all pass**

```bash
npx vitest run src/lib/__tests__/marketplace/payment-verifier.test.ts
```

Expected: 9 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketplace/payment-verifier.ts \
        src/lib/__tests__/marketplace/payment-verifier.test.ts
git commit -m "feat(marketplace): implement payment verifier with EIP-3009 structural validation"
```

---

### Task 4: Free routes — catalog and identity

**Context:** These routes require no payment. `catalog/route.ts` returns the full service list with prices and capabilities. `identity/route.ts` returns the ERC-8004 agentURI JSON that external registries reference.

**Files:**
- Create: `src/app/api/marketplace/catalog/route.ts`
- Create: `src/app/api/marketplace/identity/route.ts`

- [ ] **Step 1: Create catalog route**

Create `src/app/api/marketplace/catalog/route.ts`:

```typescript
/**
 * GET /api/marketplace/catalog
 * Returns the full list of available services, prices, and SentinAI identity.
 * Free — no payment required.
 */

import { NextResponse } from 'next/server';
import { SERVICES } from '@/lib/marketplace/catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.MARKETPLACE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Marketplace not enabled' }, { status: 503 });
  }

  return NextResponse.json({
    version: 1,
    network: process.env.X402_NETWORK ?? 'eip155:1',
    payTo: process.env.MARKETPLACE_TON_ADDRESS ?? '',
    services: SERVICES.map(s => ({
      key: s.key,
      name: s.name,
      description: s.description,
      priceWei: s.priceWei.toString(),
      endpoint: `/api/marketplace/${s.key.replaceAll('_', '-')}`,
    })),
  });
}
```

- [ ] **Step 2: Create identity route**

Create `src/app/api/marketplace/identity/route.ts`:

```typescript
/**
 * GET /api/marketplace/identity
 * Returns the ERC-8004 agentURI registration file.
 * Free — no payment required.
 */

import { NextResponse } from 'next/server';
import { SERVICES } from '@/lib/marketplace/catalog';
import { getChainPlugin } from '@/chains';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (process.env.MARKETPLACE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Marketplace not enabled' }, { status: 503 });
  }

  const baseUrl = new URL(request.url).origin;
  const plugin = getChainPlugin();

  const identity = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004',
    name: `SentinAI @ ${process.env.NEXT_PUBLIC_NETWORK_NAME ?? plugin.name}`,
    description: `L1/L2 node monitoring agent. Sells real-time monitoring data via x402.`,
    image: `${baseUrl}/logo.png`,
    services: [
      { type: 'web', url: `${baseUrl}/api/marketplace/catalog` },
    ],
    active: true,
    x402Support: true,
    monitors: {
      l2ChainId: plugin.l2Chain?.id ?? null,
      l1ChainId: plugin.l1Chain?.id ?? null,
      nodeClient: process.env.SENTINAI_CLIENT_FAMILY ?? 'unknown',
    },
    capabilities: SERVICES.map(s => s.key),
  };

  return NextResponse.json(identity);
}
```

- [ ] **Step 3: Write unit tests for catalog route**

Create `src/lib/__tests__/marketplace/catalog-route.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/marketplace/catalog', () => ({
  SERVICES: [
    { key: 'txpool', name: 'TxPool Status', description: 'desc', priceWei: 100_000_000_000_000_000n },
  ],
}));

vi.mock('@/chains', () => ({
  getChainPlugin: vi.fn(() => ({ name: 'TestNet', l1Chain: { id: 1 }, l2Chain: { id: 55004 } })),
}));

// Dynamic import so env vars are set before module loads
async function getHandlers() {
  const catalogMod = await import('@/app/api/marketplace/catalog/route');
  const identityMod = await import('@/app/api/marketplace/identity/route');
  return { catalogGET: catalogMod.GET, identityGET: identityMod.GET };
}

function makeRequest(url = 'http://localhost/api/marketplace/catalog'): Request {
  return new Request(url);
}

describe('marketplace catalog route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 503 when MARKETPLACE_ENABLED is not set', async () => {
    vi.stubEnv('MARKETPLACE_ENABLED', 'false');
    const { catalogGET } = await getHandlers();
    const res = await catalogGET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not enabled/);
  });

  it('returns catalog JSON with services when enabled', async () => {
    vi.stubEnv('MARKETPLACE_ENABLED', 'true');
    const { catalogGET } = await getHandlers();
    const res = await catalogGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.services).toHaveLength(1);
    expect(body.services[0].key).toBe('txpool');
    expect(body.services[0].priceWei).toBe('100000000000000000');
  });
});

describe('marketplace identity route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 503 when MARKETPLACE_ENABLED is not set', async () => {
    vi.stubEnv('MARKETPLACE_ENABLED', 'false');
    const { identityGET } = await getHandlers();
    const res = await identityGET(makeRequest('http://localhost/api/marketplace/identity'));
    expect(res.status).toBe(503);
  });

  it('returns ERC-8004 identity JSON when enabled', async () => {
    vi.stubEnv('MARKETPLACE_ENABLED', 'true');
    const { identityGET } = await getHandlers();
    const res = await identityGET(makeRequest('http://localhost/api/marketplace/identity'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toContain('eip-8004');
    expect(body.active).toBe(true);
    expect(body.x402Support).toBe(true);
    expect(Array.isArray(body.capabilities)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/__tests__/marketplace/catalog-route.test.ts
```

Expected: 4 tests passing

- [ ] **Step 5: Manual smoke test**

With `MARKETPLACE_ENABLED=true npm run dev` running:

```bash
curl http://localhost:3002/api/marketplace/catalog | jq .
# Expected: JSON with services array, 8 items

curl http://localhost:3002/api/marketplace/identity | jq .
# Expected: JSON with type, name, x402Support: true, capabilities array
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/marketplace/catalog/route.ts \
        src/app/api/marketplace/identity/route.ts \
        src/lib/__tests__/marketplace/catalog-route.test.ts
git commit -m "feat(marketplace): add catalog and identity routes (free, no payment)"
```

---

## Chunk 2: Protected Routes + Bootstrap

### Task 5: Protected data routes (Tier 1)

**Context:** Each route calls `withX402(request, serviceKey)` first. If it returns a `NextResponse`, the route returns it immediately. Otherwise it fetches data from existing SentinAI services (already implemented). Important: these routes re-use existing service modules — they are thin wrappers.

**Files:**
- Create: `src/app/api/marketplace/txpool/route.ts`
- Create: `src/app/api/marketplace/anomalies/route.ts`
- Create: `src/app/api/marketplace/rca/[id]/route.ts`
- Create: `src/app/api/marketplace/eoa/route.ts`

- [ ] **Step 1: Create txpool route**

Create `src/app/api/marketplace/txpool/route.ts`:

```typescript
/**
 * GET /api/marketplace/txpool
 * Returns current txpool pending/queued counts from the L2 node.
 * Requires x402 payment (0.1 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getOrDetectL2Client } from '@/lib/l2-client-cache';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'txpool');
  if (gate) return gate;

  const rpcUrl = process.env.L2_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: 'L2_RPC_URL not configured' }, { status: 503 });
  }

  try {
    const client = await getOrDetectL2Client(rpcUrl);
    const namespace = client.txpoolNamespace;

    if (!namespace) {
      return NextResponse.json({ error: 'TxPool not supported by this node client' }, { status: 503 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    try {
      let pending = -1;
      let queued = -1;

      if (namespace === 'txpool') {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'txpool_status', params: [], id: 1 }),
          signal: controller.signal,
        });
        const data = await res.json() as { result: { pending: string; queued: string } };
        pending = parseInt(data.result.pending, 16);
        queued = parseInt(data.result.queued, 16);
      } else {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'parity_pendingTransactions', params: [null], id: 1 }),
          signal: controller.signal,
        });
        const data = await res.json() as { result: unknown[] };
        pending = Array.isArray(data.result) ? data.result.length : 0;
        queued = 0;
      }

      return NextResponse.json({ pending, queued, namespace, timestamp: new Date().toISOString() });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch txpool' },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Create anomalies route**

Create `src/app/api/marketplace/anomalies/route.ts`:

```typescript
/**
 * GET /api/marketplace/anomalies
 * Returns latest anomaly detection results.
 * Requires x402 payment (0.2 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getEvents } from '@/lib/anomaly-event-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'anomalies');
  if (gate) return gate;

  try {
    const result = await getEvents(10, 0);
    return NextResponse.json({
      events: result.events,
      total: result.total,
      activeCount: result.activeCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch anomalies' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create RCA route**

Create `src/app/api/marketplace/rca/[id]/route.ts`:

```typescript
/**
 * GET /api/marketplace/rca/:id
 * Returns RCA report for a specific anomaly event.
 * Requires x402 payment (0.5 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getRCAById } from '@/lib/rca-engine';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await withX402(request, 'rca');
  if (gate) return gate;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing anomaly id' }, { status: 400 });
  }

  try {
    const report = await getRCAById(id);
    if (!report) {
      return NextResponse.json({ error: `RCA not found for anomaly: ${id}` }, { status: 404 });
    }
    return NextResponse.json({ ...report, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'RCA failed' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Create EOA route**

Create `src/app/api/marketplace/eoa/route.ts`:

```typescript
/**
 * GET /api/marketplace/eoa
 * Returns EOA balance status and depletion forecast.
 * Requires x402 payment (0.2 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getAllBalanceStatus } from '@/lib/eoa-balance-monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'eoa');
  if (gate) return gate;

  try {
    const status = await getAllBalanceStatus();
    return NextResponse.json({ ...status, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch EOA status' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Verify routes exist and TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no type errors in new files

- [ ] **Step 6: Commit**

```bash
git add src/app/api/marketplace/txpool/route.ts \
        src/app/api/marketplace/anomalies/route.ts \
        src/app/api/marketplace/rca/[id]/route.ts \
        src/app/api/marketplace/eoa/route.ts
git commit -m "feat(marketplace): add Tier 1 protected data routes (txpool, anomalies, rca, eoa)"
```

---

### Task 6: Protected data routes (Tier 2)

**Context:** These routes return aggregated/historical data from `MetricsStore` (ring buffer) and internal logs.

**Files:**
- Create: `src/app/api/marketplace/resources/route.ts`
- Create: `src/app/api/marketplace/metrics/route.ts`
- Create: `src/app/api/marketplace/scaling-history/route.ts`
- Create: `src/app/api/marketplace/sync-trend/route.ts`

**Important:** Check how existing code exposes these — look at `src/app/api/metrics/route.ts` and `src/app/api/scaler/route.ts` for the functions to reuse.

- [ ] **Step 1: Check existing imports to reuse**

```bash
grep -n "export" src/lib/metrics-store.ts | head -20
grep -n "export" src/lib/k8s-scaler.ts | head -20
grep -n "scalingHistory\|getScalingHistory\|scalingLog" src/app/api/scaler/route.ts | head -10
```

- [ ] **Step 2: Create resources route**

Create `src/app/api/marketplace/resources/route.ts`:

```typescript
/**
 * GET /api/marketplace/resources
 * Returns K8s pod CPU/memory actual usage.
 * Requires x402 payment (0.1 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getAllContainerUsage } from '@/lib/k8s-scaler';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'resources');
  if (gate) return gate;

  try {
    const usage = await getAllContainerUsage();
    return NextResponse.json({ pods: usage, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch resource usage' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create metrics history route**

Create `src/app/api/marketplace/metrics/route.ts`:

```typescript
/**
 * GET /api/marketplace/metrics
 * Returns 60-minute block interval history (mean, stddev, trend).
 * Requires x402 payment (0.05 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getMetricsStats, getRecentMetrics } from '@/lib/metrics-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'metrics');
  if (gate) return gate;

  const [stats, history] = await Promise.all([getMetricsStats(), getRecentMetrics()]);

  return NextResponse.json({
    stats,
    pointCount: history.length,
    latestTimestamp: history.at(-1)?.timestamp ?? null,
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Create scaling history route**

Create `src/app/api/marketplace/scaling-history/route.ts`:

```typescript
/**
 * GET /api/marketplace/scaling-history
 * Returns recent scaling events with reasons.
 * Requires x402 payment (0.1 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getScalingHistory } from '@/lib/k8s-scaler';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'scaling_history');
  if (gate) return gate;

  try {
    const history = await getScalingHistory();
    return NextResponse.json({ events: history, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch scaling history' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 5: Create sync trend route**

Create `src/app/api/marketplace/sync-trend/route.ts`:

```typescript
/**
 * GET /api/marketplace/sync-trend
 * Returns L2 sync gap time series and short-term prediction.
 * Requires x402 payment (0.1 TON).
 */

import { NextResponse } from 'next/server';
import { withX402 } from '@/lib/marketplace/x402-middleware';
import { getRecentMetrics } from '@/lib/metrics-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const gate = await withX402(request, 'sync_trend');
  if (gate) return gate;

  const history = await getRecentMetrics();

  // Use blockInterval as a proxy for L2 production health
  // (high/erratic blockInterval indicates sync or production issues)
  const series = history.map(p => ({
    timestamp: p.timestamp,
    blockInterval: p.blockInterval,
    blockHeight: p.blockHeight,
  }));

  const recent = series.slice(-5);
  const avgInterval = recent.length
    ? recent.reduce((s, p) => s + p.blockInterval, 0) / recent.length
    : 0;

  // Normal L2 block interval is ~2s; >5s suggests lagging
  return NextResponse.json({
    series,
    trend: { avgBlockIntervalLast5: avgInterval, lagging: avgInterval > 5 },
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 6: TypeScript check**

```bash
npm run build 2>&1 | grep -E "^.*error TS" | head -20
```

Fix any import errors: if `getAllContainerUsage`, `getScalingHistory`, or `MetricsStore` do not exist or are named differently, check the actual exports:

```bash
grep -n "^export" src/lib/k8s-scaler.ts | head -20
grep -n "^export" src/lib/metrics-store.ts | head -20
```

Adjust imports to match actual exported names.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/marketplace/resources/route.ts \
        src/app/api/marketplace/metrics/route.ts \
        src/app/api/marketplace/scaling-history/route.ts \
        src/app/api/marketplace/sync-trend/route.ts
git commit -m "feat(marketplace): add Tier 2 protected data routes (resources, metrics, history, sync)"
```

---

### Task 7: agent-registry.ts — ERC-8004 self-registration

**Context:** When `MARKETPLACE_ENABLED=true` and `MARKETPLACE_WALLET_KEY` is set, SentinAI registers itself on the ERC-8004 Identity Registry. This is idempotent — if already registered, it skips. Uses viem to call `register(agentURI)` on the registry contract.

**Files:**
- Create: `src/lib/marketplace/agent-registry.ts`
- Create: `src/lib/__tests__/marketplace/agent-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/marketplace/agent-registry.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('viem', async (importActual) => {
  const actual = await importActual<typeof import('viem')>();
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      writeContract: vi.fn().mockResolvedValue('0xtxhash'),
    })),
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn().mockResolvedValue(null),
    })),
    http: vi.fn(),
  };
});

import { registerAgent, isRegistered } from '@/lib/marketplace/agent-registry';

describe('agent-registry', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('isRegistered returns false when no MARKETPLACE_AGENT_ID env', async () => {
    const result = await isRegistered();
    expect(result).toBe(false);
  });

  it('isRegistered returns true when MARKETPLACE_AGENT_ID is set', async () => {
    vi.stubEnv('MARKETPLACE_AGENT_ID', '42');
    const result = await isRegistered();
    expect(result).toBe(true);
  });

  it('registerAgent returns { skipped: true } when wallet key missing', async () => {
    vi.stubEnv('MARKETPLACE_WALLET_KEY', '');
    const result = await registerAgent('https://example.com/identity');
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/MARKETPLACE_WALLET_KEY/);
  });

  it('registerAgent returns { skipped: true } when registry address missing', async () => {
    vi.stubEnv('MARKETPLACE_WALLET_KEY', '0xdeadbeef');
    vi.stubEnv('ERC8004_REGISTRY_ADDRESS', '');
    const result = await registerAgent('https://example.com/identity');
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/ERC8004_REGISTRY_ADDRESS/);
  });

  it('registerAgent returns { skipped: true } when already registered', async () => {
    vi.stubEnv('MARKETPLACE_AGENT_ID', '99');
    const result = await registerAgent('https://example.com/identity');
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/already registered/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/lib/__tests__/marketplace/agent-registry.test.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement agent-registry.ts**

Create `src/lib/marketplace/agent-registry.ts`:

```typescript
/**
 * ERC-8004 Agent Registry Client
 * Registers SentinAI as an agent in the on-chain Identity Registry.
 *
 * Calls register(agentURI) on the ERC-8004 IdentityRegistry contract.
 * The agentURI points to /api/marketplace/identity (ERC-8004 registration file).
 *
 * Required env vars:
 *   MARKETPLACE_WALLET_KEY     — private key of wallet that will own the NFT
 *   ERC8004_REGISTRY_ADDRESS   — deployed IdentityRegistry contract address
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function tokenURI(uint256 agentId) view returns (string)',
]);

export interface RegisterResult {
  skipped: boolean;
  reason?: string;
  agentId?: string;
  txHash?: string;
}

export async function isRegistered(): Promise<boolean> {
  const id = process.env.MARKETPLACE_AGENT_ID;
  return !!id && id.length > 0;
}

export async function registerAgent(agentUri: string): Promise<RegisterResult> {
  if (await isRegistered()) {
    return { skipped: true, reason: 'already registered (MARKETPLACE_AGENT_ID is set)' };
  }

  const walletKey = process.env.MARKETPLACE_WALLET_KEY;
  if (!walletKey) {
    return { skipped: true, reason: 'MARKETPLACE_WALLET_KEY not set — skipping ERC-8004 registration' };
  }

  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS;
  if (!registryAddress) {
    return { skipped: true, reason: 'ERC8004_REGISTRY_ADDRESS not set — skipping ERC-8004 registration' };
  }

  try {
    const account = privateKeyToAccount(walletKey as `0x${string}`);
    const rpcUrl = process.env.X402_NETWORK === 'eip155:1'
      ? (process.env.SENTINAI_L1_RPC_URL ?? 'https://ethereum.publicnode.com')
      : process.env.SENTINAI_L1_RPC_URL ?? 'https://ethereum.publicnode.com';

    const walletClient = createWalletClient({
      account,
      chain: mainnet,
      transport: http(rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: registryAddress as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: 'register',
      args: [agentUri],
    });

    return { skipped: false, txHash, agentId: 'pending-confirmation' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { skipped: true, reason: `Registration failed: ${message}` };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/marketplace/agent-registry.test.ts
```

Expected: 5 tests passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketplace/agent-registry.ts \
        src/lib/__tests__/marketplace/agent-registry.test.ts
git commit -m "feat(marketplace): add ERC-8004 agent registry client"
```

---

### Task 8: Bootstrap integration

**Context:** Modify `first-run-bootstrap.ts` to call `registerAgent()` when `MARKETPLACE_ENABLED=true`. This is fire-and-forget (non-blocking, logged but not fatal). Add a warning to the result if registration is skipped for a config reason.

**Files:**
- Modify: `src/lib/first-run-bootstrap.ts`
- Modify: `src/lib/__tests__/first-run-bootstrap.test.ts`

- [ ] **Step 1: Read the current bootstrap file**

Read `src/lib/first-run-bootstrap.ts` and `src/lib/__tests__/first-run-bootstrap.test.ts` to understand the existing pattern before modifying.

- [ ] **Step 2: Check what the existing test expects**

```bash
npx vitest run src/lib/__tests__/first-run-bootstrap.test.ts 2>&1 | tail -5
```

Note the current pass count — this is the baseline to preserve.

- [ ] **Step 3: Add marketplace registration to bootstrap**

In `src/lib/first-run-bootstrap.ts`, after the `updateInstance` call (around line 108), add:

```typescript
  // ERC-8004 marketplace registration (non-blocking)
  if (process.env.MARKETPLACE_ENABLED === 'true') {
    const { registerAgent } = await import('@/lib/marketplace/agent-registry');
    const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE ?? '';
    const agentUri = agentUriBase
      ? `${agentUriBase}/api/marketplace/identity`
      : '';

    if (agentUri) {
      registerAgent(agentUri).then((result) => {
        if (!result.skipped) {
          logger.info({ txHash: result.txHash }, '[Marketplace] ERC-8004 registration submitted');
        } else {
          logger.info({ reason: result.reason }, '[Marketplace] ERC-8004 registration skipped');
        }
      }).catch((e) => {
        logger.warn({ err: e }, '[Marketplace] ERC-8004 registration error');
      });
    }
  }
```

Also add `import logger from '@/lib/logger';` at the top if not already present (check existing imports first — `logger` is a default export).

- [ ] **Step 4: Add a test for the new behavior**

In `src/lib/__tests__/first-run-bootstrap.test.ts`, add after existing tests:

```typescript
  describe('marketplace registration', () => {
    it('calls registerAgent when MARKETPLACE_ENABLED=true and MARKETPLACE_AGENT_URI_BASE is set', async () => {
      vi.stubEnv('MARKETPLACE_ENABLED', 'true');
      vi.stubEnv('MARKETPLACE_AGENT_URI_BASE', 'https://sentinai.example.com');
      // ... mock registerAgent and verify it's called
      // This test structure depends on the existing mock setup in the file.
      // Follow the same vi.mock pattern used for other imports in this test file.
    });
  });
```

Note: adapt to the existing mock patterns in this test file — read it first before writing the test.

- [ ] **Step 5: Run bootstrap tests**

```bash
npx vitest run src/lib/__tests__/first-run-bootstrap.test.ts
```

Expected: at least same pass count as baseline, no regressions

- [ ] **Step 6: Commit**

```bash
git add src/lib/first-run-bootstrap.ts src/lib/__tests__/first-run-bootstrap.test.ts
git commit -m "feat(marketplace): trigger ERC-8004 registration on bootstrap when MARKETPLACE_ENABLED"
```

---

### Task 9: Full integration verification

**Context:** End-to-end smoke test confirming the entire flow works with `MARKETPLACE_PAYMENT_MODE=open`.

- [ ] **Step 1: Run full test suite**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: no new failures vs baseline (pre-existing failures are acceptable, new ones are not)

- [ ] **Step 2: TypeScript build check**

```bash
npm run build 2>&1 | grep -c "error TS"
```

Expected: 0

- [ ] **Step 3: Lint check**

```bash
npm run lint 2>&1 | grep -c "error"
```

Expected: 0

- [ ] **Step 4: Manual smoke test (open mode)**

In `.env.local`, temporarily set:
```
MARKETPLACE_ENABLED=true
MARKETPLACE_PAYMENT_MODE=open
L2_RPC_URL=<your rpc>
```

```bash
npm run dev
# In another terminal:
curl http://localhost:3002/api/marketplace/catalog | jq '.services | length'
# Expected: 8

curl http://localhost:3002/api/marketplace/txpool | jq .
# Expected: { pending: N, queued: N, namespace: "txpool"|"parity", timestamp: "..." }

curl http://localhost:3002/api/marketplace/anomalies | jq '.total'
# Expected: number

# Without MARKETPLACE_ENABLED:
MARKETPLACE_ENABLED=false npm run dev &
curl http://localhost:3002/api/marketplace/catalog
# Expected: {"error":"Marketplace not enabled"} with status 503
```

- [ ] **Step 5: Verify 402 flow with real payment header**

```bash
# Without X-PAYMENT header (verify mode):
curl -v http://localhost:3002/api/marketplace/txpool 2>&1 | grep "< HTTP"
# Expected: HTTP/1.1 402

# With malformed payment:
curl -H "X-PAYMENT: bm90dmFsaWQ=" http://localhost:3002/api/marketplace/txpool | jq .error
# Expected: "Invalid payment header: not valid base64 JSON"
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(marketplace): complete agent economy Phase 1 implementation"
```

---

## Environment Variables Summary

Add to `.env.local.sample`:

```bash
# ─── Agent Economy Marketplace (Phase 1 — Producer) ─────────────────────────
# Set MARKETPLACE_ENABLED=true to expose SentinAI data via x402
MARKETPLACE_ENABLED=false

# Wallet key for ERC-8004 registration and TON receipt address
# MARKETPLACE_WALLET_KEY=0x...
# MARKETPLACE_TON_ADDRESS=0x...

# x402 payment configuration
# X402_NETWORK=eip155:1                  # Default: Ethereum L1
# MARKETPLACE_TON_CONTRACT=0x2be5e8c...  # L1 TON contract address
# MARKETPLACE_PAYMENT_MODE=verify        # 'verify' | 'open' (open = no payment, dev only)

# ERC-8004 registration
# ERC8004_REGISTRY_ADDRESS=0x...
# MARKETPLACE_AGENT_URI_BASE=https://your-domain.com  # Used to build agentURI
# MARKETPLACE_AGENT_ID=                  # Set after registration to skip re-registration

# Pricing overrides (L1 TON in wei, 18 decimals)
# MARKETPLACE_PRICE_TXPOOL=100000000000000000
# MARKETPLACE_PRICE_ANOMALY=200000000000000000
# MARKETPLACE_PRICE_RCA=500000000000000000
# MARKETPLACE_PRICE_EOA=200000000000000000
# MARKETPLACE_PRICE_RESOURCES=100000000000000000
# MARKETPLACE_PRICE_METRICS=50000000000000000
# MARKETPLACE_PRICE_SCALING_HISTORY=100000000000000000
# MARKETPLACE_PRICE_SYNC_TREND=100000000000000000
```

---

## Known Limitations (Phase 1)

1. **No real TON settlement**: `payment-verifier.ts` validates EIP-3009 signature structure but does not call an external facilitator. Real TON on L1 requires a custom facilitator supporting `transferWithAuthorization`. Upgrade path: implement facilitator and set `MARKETPLACE_PAYMENT_MODE=settle`.

2. **ERC-8004 registration is fire-and-forget**: The bootstrap submits the tx but does not wait for confirmation. `MARKETPLACE_AGENT_ID` must be set manually after confirmation.

3. **No reputation submission**: ERC-8004 Reputation Registry integration deferred to Phase 2.

4. **No consumer side**: SentinAI hiring external agents deferred to Phase 2.
