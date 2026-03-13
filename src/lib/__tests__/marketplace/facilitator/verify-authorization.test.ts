import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

describe('payment authorization verification', () => {
  it('accepts a valid signature and rejects mismatched fields or invalid timing', async () => {
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044976f6b5e6f4bdf9b4f7f2d9965e5a33aea61d6a6c7d'
    );
    const { getPaymentAuthorizationDomain, getPaymentAuthorizationTypes } = await import(
      '@/lib/marketplace/facilitator/typed-data'
    );
    const { verifyPaymentAuthorization } = await import('@/lib/marketplace/facilitator/verify-authorization');

    const authorization = {
      buyer: account.address,
      merchant: '0x4444444444444444444444444444444444444444',
      asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
      amount: 100000000000000000n,
      resource: '/api/marketplace/sequencer-health',
      nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      validAfter: 1_741_680_000n,
      validBefore: 1_741_680_300n,
    };
    const profile = {
      chainId: 1,
      network: 'eip155:1' as const,
      facilitatorAddress: '0x1111111111111111111111111111111111111111',
      tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
    };
    const signature = await account.signTypedData({
      domain: getPaymentAuthorizationDomain(profile),
      primaryType: 'PaymentAuthorization',
      types: getPaymentAuthorizationTypes(),
      message: authorization,
    });

    const validResult = await verifyPaymentAuthorization({
      profile,
      network: 'eip155:1',
      authorization,
      signature,
      expected: {
        merchant: authorization.merchant,
        asset: authorization.asset,
        amount: authorization.amount,
        resource: authorization.resource,
      },
      now: 1_741_680_100n,
    });

    expect(validResult.isValid).toBe(true);
    expect(validResult.signer).toBe(account.address);

    const wrongMerchantResult = await verifyPaymentAuthorization({
      profile,
      network: 'eip155:1',
      authorization,
      signature,
      expected: {
        merchant: '0x5555555555555555555555555555555555555555',
        asset: authorization.asset,
        amount: authorization.amount,
        resource: authorization.resource,
      },
      now: 1_741_680_100n,
    });

    expect(wrongMerchantResult.isValid).toBe(false);
    expect(wrongMerchantResult.reason).toMatch(/merchant/i);

    const expiredResult = await verifyPaymentAuthorization({
      profile,
      network: 'eip155:1',
      authorization,
      signature,
      expected: {
        merchant: authorization.merchant,
        asset: authorization.asset,
        amount: authorization.amount,
        resource: authorization.resource,
      },
      now: 1_741_680_301n,
    });

    expect(expiredResult.isValid).toBe(false);
    expect(expiredResult.reason).toMatch(/expired|validBefore/i);

    const wrongNetworkResult = await verifyPaymentAuthorization({
      profile,
      network: 'eip155:11155111',
      authorization,
      signature,
      expected: {
        merchant: authorization.merchant,
        asset: authorization.asset,
        amount: authorization.amount,
        resource: authorization.resource,
      },
      now: 1_741_680_100n,
    });

    expect(wrongNetworkResult.isValid).toBe(false);
    expect(wrongNetworkResult.reason).toMatch(/network|profile/i);
  });
});
