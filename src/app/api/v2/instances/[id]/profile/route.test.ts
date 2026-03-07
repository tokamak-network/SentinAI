import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mocks must be declared before imports
vi.mock('@/core/instance-registry', () => ({
  getInstance: vi.fn(),
}));

vi.mock('@/core/redis', () => ({
  getCoreRedis: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { GET } from './route';
import { getInstance } from '@/core/instance-registry';
import { getCoreRedis } from '@/core/redis';

function makeRequest(id: string): [NextRequest, { params: Promise<{ id: string }> }] {
  const req = new NextRequest(`http://localhost/api/v2/instances/${id}/profile`);
  const ctx = { params: Promise.resolve({ id }) };
  return [req, ctx];
}

describe('GET /api/v2/instances/[id]/profile', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getInstance).mockReset();
    vi.mocked(getCoreRedis).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 404 when instance not found', async () => {
    vi.mocked(getInstance).mockResolvedValue(null);
    vi.mocked(getCoreRedis).mockReturnValue(null);

    const [req, ctx] = makeRequest('missing-id');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('source=env when SENTINAI_CLIENT_FAMILY is set', async () => {
    vi.mocked(getInstance).mockResolvedValue({ id: 'inst1' } as never);
    vi.mocked(getCoreRedis).mockReturnValue(null);
    vi.stubEnv('SENTINAI_CLIENT_FAMILY', 'nethermind');

    const [req, ctx] = makeRequest('inst1');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { source: string; clientProfile: { methods: { txPool: { method: string } } } } };
    expect(body.data.source).toBe('env');
    expect(body.data.clientProfile.methods.txPool?.method).toBe('parity_pendingTransactions');
  });

  it('source=detected when Redis has detectedClient.family', async () => {
    vi.mocked(getInstance).mockResolvedValue({ id: 'inst2' } as never);
    const mockRedis = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({ detectedClient: { family: 'op-geth' } })
      ),
    };
    vi.mocked(getCoreRedis).mockReturnValue(mockRedis as never);

    const [req, ctx] = makeRequest('inst2');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { source: string; clientProfile: { methods: { l2SyncStatus: { method: string } } } } };
    expect(body.data.source).toBe('detected');
    expect(body.data.clientProfile.methods.l2SyncStatus?.method).toBe('optimism_syncStatus');
  });

  it('source=unknown when no env and no Redis data', async () => {
    vi.mocked(getInstance).mockResolvedValue({ id: 'inst3' } as never);
    const mockRedis = { get: vi.fn().mockResolvedValue(null) };
    vi.mocked(getCoreRedis).mockReturnValue(mockRedis as never);

    const [req, ctx] = makeRequest('inst3');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { source: string } };
    expect(body.data.source).toBe('unknown');
  });

  it('source=unknown when Redis is unavailable', async () => {
    vi.mocked(getInstance).mockResolvedValue({ id: 'inst4' } as never);
    vi.mocked(getCoreRedis).mockReturnValue(null);

    const [req, ctx] = makeRequest('inst4');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { source: string } };
    expect(body.data.source).toBe('unknown');
  });
});
