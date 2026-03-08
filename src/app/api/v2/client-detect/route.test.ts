import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';

const hoisted = vi.hoisted(() => ({
  detectMock: vi.fn(),
}));

vi.mock('@/lib/client-detector', () => ({
  detectExecutionClient: hoisted.detectMock,
}));

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/v2/client-detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/v2/client-detect', () => {
  it('returns 400 when body is missing', async () => {
    const res = await POST(new Request('http://localhost/api/v2/client-detect', { method: 'POST' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('rpcUrl is required');
  });

  it('returns 400 when rpcUrl is empty string', async () => {
    const res = await POST(makeRequest({ rpcUrl: '' }));
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('rpcUrl is required');
  });

  it('returns 400 when rpcUrl is missing from body', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }));
    expect(res.status).toBe(400);
  });

  it('returns 200 with all fields on successful detection', async () => {
    hoisted.detectMock.mockResolvedValue({
      family: 'geth',
      txpoolNamespace: 'txpool',
      supportsL2SyncStatus: false,
      l2SyncMethod: null,
      version: 'Geth/v1.14.0',
    });

    const res = await POST(makeRequest({ rpcUrl: 'http://localhost:8545' }));
    expect(res.status).toBe(200);
    const json = await res.json() as { data: Record<string, unknown> };
    expect(json.data.family).toBe('geth');
    expect(json.data.txpoolNamespace).toBe('txpool');
    expect(json.data.supportsL2SyncStatus).toBe(false);
    expect(json.data.l2SyncMethod).toBeNull();
    expect(json.data.clientVersion).toBe('Geth/v1.14.0');
  });

  it('returns 500 when detectExecutionClient throws', async () => {
    hoisted.detectMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await POST(makeRequest({ rpcUrl: 'http://unreachable:9999' }));
    expect(res.status).toBe(500);
    const json = await res.json() as { error: string; detail: string };
    expect(json.error).toBeDefined();
    expect(json.detail).toContain('ECONNREFUSED');
  });
});
