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

describe('/api/marketplace/sequencer-health', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_AMOUNT;
    delete process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_MERCHANT;

    hoisted.loadFacilitatorConfig.mockReturnValue({
      redisPrefix: 'sentinai:test',
      internalAuthSecret: 'internal-secret',
      receiptSigningKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      merchantAllowlist: [
        {
          merchantId: 'sequencer-health',
          address: '0x4444444444444444444444444444444444444444',
          resources: ['/api/marketplace/sequencer-health'],
          networks: ['eip155:11155111'],
        },
      ],
      reconciler: {
        enabled: true,
        cron: '*/15 * * * * *',
      },
      profiles: {
        mainnet: {
          id: 'mainnet',
          enabled: false,
          chainId: 1,
          network: 'eip155:1',
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          facilitatorAddress: '0x2222222222222222222222222222222222222222',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          id: 'sepolia',
          enabled: true,
          chainId: 11155111,
          network: 'eip155:11155111',
          rpcUrl: 'https://sepolia.example',
          relayerPrivateKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
          facilitatorAddress: '0x4444444444444444444444444444444444444444',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });
  });

  it('returns 402 payment requirements when the buyer has not attached X-PAYMENT', async () => {
    const { GET } = await import('@/app/api/marketplace/sequencer-health/route');

    const request = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toEqual({
      error: 'payment_required',
      scheme: 'exact',
      x402Version: 2,
      paymentRequirements: {
        network: 'eip155:11155111',
        asset: '0xa30fe40285B8f5c0457DbC3B7C8A280373c40044',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
        merchant: '0x4444444444444444444444444444444444444444',
        facilitator: {
          mode: 'same-app',
          settleUrl: 'https://sentinai.example.com/api/facilitator/v1/settle',
          receiptUrl: 'https://sentinai.example.com/api/facilitator/v1/settlements/{settlementId}',
          spender: '0x4444444444444444444444444444444444444444',
        },
        authorization: {
          type: 'eip712',
          domain: {
            name: 'SentinAI x402 TON Facilitator',
            version: '1',
            chainId: 11155111,
            verifyingContract: '0x4444444444444444444444444444444444444444',
          },
          primaryType: 'PaymentAuthorization',
          types: {
            PaymentAuthorization: [
              { name: 'buyer', type: 'address' },
              { name: 'merchant', type: 'address' },
              { name: 'asset', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'resource', type: 'string' },
              { name: 'nonce', type: 'bytes32' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
            ],
          },
        },
        receipt: {
          type: 'detached-signature',
          fields: [
            'success',
            'settlementId',
            'chainId',
            'asset',
            'amount',
            'buyer',
            'merchant',
            'resource',
            'txHash',
            'blockNumber',
            'status',
          ],
        },
      },
    });
  });

  it('verifies X-PAYMENT and returns the paid resource when payment is valid', async () => {
    hoisted.verifyX402Payment.mockResolvedValueOnce({
      success: true,
      settlementId: 'stl_123',
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      status: 'submitted',
    });

    const { GET } = await import('@/app/api/marketplace/sequencer-health/route');

    const request = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health', {
      headers: {
        'x-payment': 'base64-payment-header',
      },
    });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.verifyX402Payment).toHaveBeenCalledWith(
      'base64-payment-header',
      expect.objectContaining({
        merchantId: 'sequencer-health',
        chainId: 11155111,
        merchant: '0x4444444444444444444444444444444444444444',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
      })
    );
    expect(body.data).toEqual({
      service: 'sequencer-health',
      network: 'eip155:11155111',
      status: 'healthy',
      latestIncident: null,
      settlement: {
        settlementId: 'stl_123',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        status: 'submitted',
      },
    });
  });

  it('uses runtime product overrides in payment requirements and payment verification', async () => {
    process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_AMOUNT = '250000000000000000';
    process.env.MARKETPLACE_PRODUCT_SEQUENCER_HEALTH_MERCHANT = '0x8888888888888888888888888888888888888888';
    hoisted.loadFacilitatorConfig.mockReturnValue({
      redisPrefix: 'sentinai:test',
      internalAuthSecret: 'internal-secret',
      receiptSigningKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      merchantAllowlist: [
        {
          merchantId: 'sequencer-health',
          address: '0x8888888888888888888888888888888888888888',
          resources: ['/api/marketplace/sequencer-health'],
          networks: ['eip155:11155111'],
        },
      ],
      reconciler: {
        enabled: true,
        cron: '*/15 * * * * *',
      },
      profiles: {
        mainnet: {
          id: 'mainnet',
          enabled: false,
          chainId: 1,
          network: 'eip155:1',
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          facilitatorAddress: '0x2222222222222222222222222222222222222222',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          id: 'sepolia',
          enabled: true,
          chainId: 11155111,
          network: 'eip155:11155111',
          rpcUrl: 'https://sepolia.example',
          relayerPrivateKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
          facilitatorAddress: '0x8888888888888888888888888888888888888888',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });
    hoisted.verifyX402Payment.mockResolvedValueOnce({
      success: true,
      settlementId: 'stl_override',
      txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      status: 'submitted',
    });

    const { GET } = await import('@/app/api/marketplace/sequencer-health/route');

    const noPaymentRequest = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health');
    const noPaymentResponse = await GET(noPaymentRequest);
    const noPaymentBody = await noPaymentResponse.json();

    expect(noPaymentResponse.status).toBe(402);
    expect(noPaymentBody.paymentRequirements.amount).toBe('250000000000000000');
    expect(noPaymentBody.paymentRequirements.merchant).toBe('0x8888888888888888888888888888888888888888');
    expect(noPaymentBody.paymentRequirements.facilitator.spender).toBe('0x8888888888888888888888888888888888888888');

    const paidRequest = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health', {
      headers: {
        'x-payment': 'base64-payment-header',
      },
    });
    const paidResponse = await GET(paidRequest);

    expect(paidResponse.status).toBe(200);
    expect(hoisted.verifyX402Payment).toHaveBeenCalledWith(
      'base64-payment-header',
      expect.objectContaining({
        merchant: '0x8888888888888888888888888888888888888888',
        amount: '250000000000000000',
      })
    );
  });

  it('fails closed when the merchant allowlist no longer matches the product registry', async () => {
    hoisted.loadFacilitatorConfig.mockReturnValueOnce({
      redisPrefix: 'sentinai:test',
      internalAuthSecret: 'internal-secret',
      receiptSigningKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      merchantAllowlist: [
        {
          merchantId: 'sequencer-health',
          address: '0x9999999999999999999999999999999999999999',
          resources: ['/api/marketplace/sequencer-health'],
          networks: ['eip155:11155111'],
        },
      ],
      reconciler: {
        enabled: true,
        cron: '*/15 * * * * *',
      },
      profiles: {
        mainnet: {
          id: 'mainnet',
          enabled: false,
          chainId: 1,
          network: 'eip155:1',
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          facilitatorAddress: '0x2222222222222222222222222222222222222222',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          id: 'sepolia',
          enabled: true,
          chainId: 11155111,
          network: 'eip155:11155111',
          rpcUrl: 'https://sepolia.example',
          relayerPrivateKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
          facilitatorAddress: '0x7777777777777777777777777777777777777777',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });

    const { GET } = await import('@/app/api/marketplace/sequencer-health/route');

    const request = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/registry/i);
  });

  it('fails closed when the product merchant does not equal the facilitator spender', async () => {
    hoisted.loadFacilitatorConfig.mockReturnValueOnce({
      redisPrefix: 'sentinai:test',
      internalAuthSecret: 'internal-secret',
      receiptSigningKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      merchantAllowlist: [
        {
          merchantId: 'sequencer-health',
          address: '0x4444444444444444444444444444444444444444',
          resources: ['/api/marketplace/sequencer-health'],
          networks: ['eip155:11155111'],
        },
      ],
      reconciler: {
        enabled: true,
        cron: '*/15 * * * * *',
      },
      profiles: {
        mainnet: {
          id: 'mainnet',
          enabled: false,
          chainId: 1,
          network: 'eip155:1',
          rpcUrl: 'https://mainnet.example',
          relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
          facilitatorAddress: '0x2222222222222222222222222222222222222222',
          tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        },
        sepolia: {
          id: 'sepolia',
          enabled: true,
          chainId: 11155111,
          network: 'eip155:11155111',
          rpcUrl: 'https://sepolia.example',
          relayerPrivateKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
          facilitatorAddress: '0x7777777777777777777777777777777777777777',
          tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
        },
      },
    });

    const { GET } = await import('@/app/api/marketplace/sequencer-health/route');

    const request = new NextRequest('https://sentinai.example.com/api/marketplace/sequencer-health');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/facilitator spender/i);
  });
});
