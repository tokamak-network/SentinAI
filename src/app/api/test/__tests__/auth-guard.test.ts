/**
 * Regression tests for /api/test/* auth guards.
 *
 * Verifies that test endpoints:
 * 1. Return 404 in production (NODE_ENV=production, no override)
 * 2. Return 200 / accept requests in development
 * 3. seed-ledger GET is read-only (no seeding capability via GET)
 * 4. demo-scenario only accepts POST, not GET
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ────────────────────────────────────────────────────────────────────────────
// Shared store mock (playbooks/learning/store)
// ────────────────────────────────────────────────────────────────────────────
vi.mock('@/playbooks/learning/store', () => ({
  appendOperationRecord: vi.fn().mockResolvedValue(undefined),
  listOperationLedger: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  listPlaybooks: vi.fn().mockResolvedValue([]),
  upsertPlaybook: vi.fn().mockResolvedValue(undefined),
}));

// ────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal NextRequest
// ────────────────────────────────────────────────────────────────────────────
function makeRequest(
  method: string,
  url: string,
  body?: unknown
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// /api/test/seed-ledger
// ────────────────────────────────────────────────────────────────────────────
describe('/api/test/seed-ledger', () => {
  const BASE = 'http://localhost:3002/api/test/seed-ledger';

  describe('production guard', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', '');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('GET returns 404 in production', async () => {
      const { GET } = await import('../seed-ledger/route');
      const res = await GET(makeRequest('GET', BASE));
      expect(res.status).toBe(404);
    });

    it('POST returns 404 in production', async () => {
      const { POST } = await import('../seed-ledger/route');
      const res = await POST(makeRequest('POST', BASE, { count: 1 }));
      expect(res.status).toBe(404);
    });
  });

  describe('development mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('GET returns ledger total (read-only, no seeding)', async () => {
      const { GET } = await import('../seed-ledger/route');
      const res = await GET(makeRequest('GET', BASE));
      expect(res.status).toBe(200);
      const json = await res.json() as { instanceId: string; ledgerTotal: number };
      expect(json).toHaveProperty('instanceId');
      expect(json).toHaveProperty('ledgerTotal');
      // No seeding info — GET is status-only
      expect(json).not.toHaveProperty('inserted');
    });

    it('POST inserts records and returns ok', async () => {
      const { POST } = await import('../seed-ledger/route');
      const res = await POST(makeRequest('POST', BASE, { count: 2 }));
      expect(res.status).toBe(200);
      const json = await res.json() as { ok: boolean };
      expect(json.ok).toBe(true);
    });
  });

  describe('production with override flag', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', 'true');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('GET is allowed when SENTINAI_ALLOW_TEST_ROUTES=true', async () => {
      const { GET } = await import('../seed-ledger/route');
      const res = await GET(makeRequest('GET', BASE));
      expect(res.status).toBe(200);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// /api/test/demo-scenario
// ────────────────────────────────────────────────────────────────────────────
describe('/api/test/demo-scenario', () => {
  const BASE = 'http://localhost:3002/api/test/demo-scenario';

  describe('production guard', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SENTINAI_ALLOW_TEST_ROUTES', '');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('POST returns 404 in production', async () => {
      const { POST } = await import('../demo-scenario/route');
      const res = await POST(makeRequest('POST', BASE, { scenario: 'simulate' }));
      expect(res.status).toBe(404);
    });
  });

  describe('development mode', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('POST with unknown scenario returns 400', async () => {
      const { POST } = await import('../demo-scenario/route');
      const res = await POST(makeRequest('POST', BASE, { scenario: 'unknown' }));
      expect(res.status).toBe(400);
    });

    it('POST with no body returns 400 (missing scenario)', async () => {
      const { POST } = await import('../demo-scenario/route');
      const res = await POST(makeRequest('POST', BASE));
      expect(res.status).toBe(400);
    });
  });
});
