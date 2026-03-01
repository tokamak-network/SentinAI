import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchZkstackMetricFields } from '@/app/api/metrics/zkstack';

describe('fetchZkstackMetricFields', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('returns empty object for non-zkstack chain', async () => {
    const result = await fetchZkstackMetricFields('optimism', 'http://localhost:8545', 1000);
    expect(result).toEqual({});
  });

  it('returns parsed zkstack fields from zks_* rpc payload', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method: string };
      if (body.method === 'zks_L1BatchNumber') {
        return {
          ok: true,
          json: async () => ({ result: '0x20' }),
        };
      }
      if (body.method === 'zks_getL1BatchDetails') {
        return {
          ok: true,
          json: async () => ({ result: { timestamp: '0x10', l1TxCount: '0x2' } }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchZkstackMetricFields('zkstack', 'http://localhost:3050', 1000);

    expect(result.l1BatchNumber).toBe(32);
    expect(result.l1BatchTimestamp).toBe(16);
    expect(result.l1TxCount).toBe(2);
  });

  it('remains null-safe when zks methods fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network-error')));

    const result = await fetchZkstackMetricFields('zkstack', 'http://localhost:3050', 1000);

    expect(result.l1BatchNumber).toBeNull();
    expect(result.l1BatchTimestamp).toBeNull();
    expect(result.l1TxCount).toBeNull();
  });
});
