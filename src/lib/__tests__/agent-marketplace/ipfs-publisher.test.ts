import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadAgentMarketplaceBatchToIpfs } from '@/lib/agent-marketplace/ipfs-publisher';

describe('agent-marketplace ipfs-publisher', () => {
  beforeEach(() => {
    delete process.env.MARKETPLACE_IPFS_UPLOAD_URL;
    delete process.env.MARKETPLACE_IPFS_AUTH_TOKEN;
    delete process.env.MARKETPLACE_IPFS_MODE;
    vi.unstubAllGlobals();
  });

  it('uploads a batch payload to the configured IPFS endpoint and returns the CID', async () => {
    process.env.MARKETPLACE_IPFS_UPLOAD_URL = 'https://pinning.example.com/upload';
    process.env.MARKETPLACE_IPFS_AUTH_TOKEN = 'secret-token';

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body));
      expect(parsed.root).toBe('0xabc');
      return new Response(JSON.stringify({ cid: 'QmBatchCid' }), { status: 200 });
    }));

    const result = await uploadAgentMarketplaceBatchToIpfs({
      root: '0xabc',
      payload: { hello: 'world' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected upload to succeed');
    }
    expect(result.batchHash).toBe('QmBatchCid');
  });

  it('returns a deterministic stub CID in stub mode', async () => {
    process.env.MARKETPLACE_IPFS_MODE = 'stub';

    const result = await uploadAgentMarketplaceBatchToIpfs({
      root: '0xabc',
      payload: { hello: 'world' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected stub upload to succeed');
    }
    expect(result.batchHash.startsWith('stub-')).toBe(true);
  });

  it('fails when no upload configuration is present outside stub mode', async () => {
    const result = await uploadAgentMarketplaceBatchToIpfs({
      root: '0xabc',
      payload: { hello: 'world' },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected missing IPFS config to fail');
    }
    expect(result.error).toContain('IPFS');
  });
});
