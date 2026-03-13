import { describe, expect, it } from 'vitest';

describe('receipt signing', () => {
  it('signs and verifies a settlement receipt and rejects tampering', async () => {
    const { signSettlementReceipt, verifySettlementReceipt } = await import(
      '@/lib/marketplace/facilitator/receipt-signing'
    );

    const receipt = {
      success: true,
      settlementId: 'stl_123',
      chainId: 1,
      asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      amount: '100000000000000000',
      buyer: '0x1111111111111111111111111111111111111111',
      merchant: '0x4444444444444444444444444444444444444444',
      resource: '/api/marketplace/sequencer-health',
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      blockNumber: 12345678,
      status: 'submitted',
    } as const;
    const signingKey =
      '0x3333333333333333333333333333333333333333333333333333333333333333' as const;

    const signed = await signSettlementReceipt(receipt, signingKey);
    const verified = await verifySettlementReceipt(signed.payload, signed.signature);

    expect(verified.isValid).toBe(true);
    expect(verified.signer).toBe(signed.signer);

    const tampered = {
      ...signed.payload,
      amount: '200000000000000000',
    };
    const tamperedResult = await verifySettlementReceipt(tampered, signed.signature);

    expect(tamperedResult.isValid).toBe(false);
    expect(tamperedResult.reason).toMatch(/signature/i);
  });
});
