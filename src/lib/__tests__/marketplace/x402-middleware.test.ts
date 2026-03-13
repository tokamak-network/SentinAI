import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  settleThroughFacilitator: vi.fn(),
}));

vi.mock('@/lib/marketplace/facilitator-client', () => ({
  settleThroughFacilitator: hoisted.settleThroughFacilitator,
}));

describe('x402 middleware', () => {
  it('uses the configured merchant and chain expectations instead of trusting the payment header', async () => {
    hoisted.settleThroughFacilitator.mockResolvedValueOnce({ success: true });

    const { verifyX402Payment } = await import('@/lib/marketplace/x402-middleware');

    await verifyX402Payment(
      Buffer.from(
        JSON.stringify({
          x402Version: 2,
          scheme: 'exact',
          network: 'eip155:1',
          payload: {
            authorization: {
              buyer: '0x1111111111111111111111111111111111111111',
              merchant: '0x9999999999999999999999999999999999999999',
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
      {
        facilitatorPath: '/api/facilitator/v1/settle',
        merchantId: 'sequencer-health',
        chainId: 1,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        merchant: '0x4444444444444444444444444444444444444444',
        resource: '/api/marketplace/sequencer-health',
      }
    );

    expect(hoisted.settleThroughFacilitator).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: {
          chainId: 1,
          asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
          amount: '100000000000000000',
          merchant: '0x4444444444444444444444444444444444444444',
          resource: '/api/marketplace/sequencer-health',
        },
      })
    );
  });
});
