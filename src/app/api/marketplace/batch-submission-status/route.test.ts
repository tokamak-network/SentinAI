import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  loadFacilitatorConfig: vi.fn(),
  verifyX402Payment: vi.fn(),
}));

vi.mock('@/lib/marketplace/facilitator/config', () => ({
  loadFacilitatorConfig: hoisted.loadFacilitatorConfig,
}));

vi.mock('@/lib/marketplace/x402-middleware', () => ({
  verifyX402Payment: hoisted.verifyX402Payment,
}));

describe('/api/marketplace/batch-submission-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadFacilitatorConfig.mockReturnValue({
      redisPrefix: 'sentinai:test',
      internalAuthSecret: 'internal-secret',
      receiptSigningKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      merchantAllowlist: [
        {
          merchantId: 'batch-submission-status',
          address: '0x6666666666666666666666666666666666666666',
          resources: ['/api/marketplace/batch-submission-status'],
          networks: ['eip155:11155111'],
        },
      ],
      reconciler: { enabled: true, cron: '*/15 * * * * *' },
      profiles: {
        mainnet: {
          id: 'mainnet', enabled: false, chainId: 1, network: 'eip155:1', rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          facilitatorAddress: '0x2222222222222222222222222222222222222222',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          id: 'sepolia', enabled: true, chainId: 11155111, network: 'eip155:11155111', rpcUrl: 'https://sepolia.example',
          relayerPrivateKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
          facilitatorAddress: '0x6666666666666666666666666666666666666666',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });
  });

  it('returns 402 requirements for batch-submission-status', async () => {
    const { GET } = await import('@/app/api/marketplace/batch-submission-status/route');
    const response = await GET(new NextRequest('https://sentinai.example.com/api/marketplace/batch-submission-status'));
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.paymentRequirements.amount).toBe('150000000000000000');
    expect(body.paymentRequirements.resource).toBe('/api/marketplace/batch-submission-status');
    expect(body.paymentRequirements.merchant).toBe('0x6666666666666666666666666666666666666666');
  });
});
