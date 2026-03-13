import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  verifySettlementReceipt: vi.fn(),
  ensureFacilitatorReconcilerStarted: vi.fn(),
}));

vi.mock('@/lib/marketplace/facilitator/receipt-signing', () => ({
  verifySettlementReceipt: hoisted.verifySettlementReceipt,
}));
vi.mock('@/lib/marketplace/facilitator/reconcile-runner', () => ({
  ensureFacilitatorReconcilerStarted: hoisted.ensureFacilitatorReconcilerStarted,
}));

describe('facilitator client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', hoisted.fetchMock);
    process.env.TON_FACILITATOR_INTERNAL_AUTH_SECRET = 'internal-secret';
  });

  it('forwards the TON payment payload to the facilitator and accepts a valid signed receipt', async () => {
    hoisted.fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        settlementId: 'stl_123',
        chainId: 1,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        resource: '/api/marketplace/sequencer-health',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        blockNumber: null,
        status: 'submitted',
        signature:
          '0x1111111111111111111111111111111111111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    });
    hoisted.verifySettlementReceipt.mockResolvedValueOnce({
      isValid: true,
      signer: '0x1111111111111111111111111111111111111111',
    });
    hoisted.ensureFacilitatorReconcilerStarted.mockResolvedValue(undefined);

    const { settleThroughFacilitator } = await import('@/lib/marketplace/facilitator-client');

    const result = await settleThroughFacilitator({
      facilitatorPath: '/api/facilitator/v1/settle',
      merchantId: 'sequencer-health',
      paymentHeader: Buffer.from(
        JSON.stringify({
          x402Version: 2,
          scheme: 'exact',
          network: 'eip155:1',
          payload: {
            authorization: {
              buyer: '0x1111111111111111111111111111111111111111',
              merchant: '0x4444444444444444444444444444444444444444',
              asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
              amount: '100000000000000000',
              resource: '/api/marketplace/sequencer-health',
              nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              validAfter: 1741680000,
              validBefore: 1741680300,
            },
            signature:
              '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
        })
      ).toString('base64'),
      expected: {
        chainId: 1,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        merchant: '0x4444444444444444444444444444444444444444',
        resource: '/api/marketplace/sequencer-health',
      },
    });

    expect(result.success).toBe(true);
    expect(hoisted.fetchMock).toHaveBeenCalledWith(
      '/api/facilitator/v1/settle',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-sentinai-internal-auth': 'internal-secret',
          'x-sentinai-merchant-id': 'sequencer-health',
        }),
      })
    );
    expect(hoisted.ensureFacilitatorReconcilerStarted).toHaveBeenCalledTimes(1);
  });

  it('rejects a receipt whose fields do not match the expected payment', async () => {
    hoisted.fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        settlementId: 'stl_123',
        chainId: 1,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '200000000000000000',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        resource: '/api/marketplace/sequencer-health',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        blockNumber: null,
        status: 'submitted',
        signature:
          '0x1111111111111111111111111111111111111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    });
    hoisted.verifySettlementReceipt.mockResolvedValueOnce({
      isValid: true,
      signer: '0x1111111111111111111111111111111111111111',
    });

    const { settleThroughFacilitator } = await import('@/lib/marketplace/facilitator-client');

    await expect(
      settleThroughFacilitator({
        facilitatorPath: '/api/facilitator/v1/settle',
        merchantId: 'sequencer-health',
        paymentHeader: Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:1',
            payload: {
              authorization: {
                buyer: '0x1111111111111111111111111111111111111111',
                merchant: '0x4444444444444444444444444444444444444444',
                asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
                amount: '100000000000000000',
                resource: '/api/marketplace/sequencer-health',
                nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                validAfter: 1741680000,
                validBefore: 1741680300,
              },
              signature:
                '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            },
          })
        ).toString('base64'),
        expected: {
          chainId: 1,
          asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
          amount: '100000000000000000',
          merchant: '0x4444444444444444444444444444444444444444',
          resource: '/api/marketplace/sequencer-health',
        },
      })
    ).rejects.toThrow(/amount/i);
  });

  it('rejects a receipt whose chain id does not match the expected network', async () => {
    hoisted.fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        settlementId: 'stl_123',
        chainId: 11155111,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        resource: '/api/marketplace/sequencer-health',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        blockNumber: null,
        status: 'submitted',
        signature:
          '0x1111111111111111111111111111111111111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    });
    hoisted.verifySettlementReceipt.mockResolvedValueOnce({
      isValid: true,
      signer: '0x1111111111111111111111111111111111111111',
    });

    const { settleThroughFacilitator } = await import('@/lib/marketplace/facilitator-client');

    await expect(
      settleThroughFacilitator({
        facilitatorPath: '/api/facilitator/v1/settle',
        merchantId: 'sequencer-health',
        paymentHeader: Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: 'exact',
            network: 'eip155:1',
            payload: {
              authorization: {
                buyer: '0x1111111111111111111111111111111111111111',
                merchant: '0x4444444444444444444444444444444444444444',
                asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
                amount: '100000000000000000',
                resource: '/api/marketplace/sequencer-health',
                nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                validAfter: 1741680000,
                validBefore: 1741680300,
              },
              signature:
                '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            },
          })
        ).toString('base64'),
        expected: {
          chainId: 1,
          asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
          amount: '100000000000000000',
          merchant: '0x4444444444444444444444444444444444444444',
          resource: '/api/marketplace/sequencer-health',
        },
      })
    ).rejects.toThrow(/chain/i);
  });
});
