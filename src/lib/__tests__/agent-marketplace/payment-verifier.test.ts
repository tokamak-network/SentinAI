import { beforeEach, describe, expect, it } from 'vitest';
import {
  parsePaymentHeader,
  verifyAgentMarketplacePayment,
} from '@/lib/agent-marketplace/payment-verifier';
import { getAgentMarketplaceCatalog } from '@/lib/agent-marketplace/catalog';

describe('agent-marketplace payment-verifier', () => {
  beforeEach(() => {
    delete process.env.MARKETPLACE_PAYMENT_MODE;
  });

  it('parses a base64 encoded payment header into a payment envelope', () => {
    const encoded = Buffer.from(JSON.stringify({
      buyer: 'agent-123',
      scheme: 'exact',
      network: 'eip155:1',
      amount: '100000000000000000',
      signature: '0xdeadbeef',
    })).toString('base64');

    const result = parsePaymentHeader(encoded);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected payment header parse to succeed');
    }

    expect(result.envelope.agentId).toBe('agent-123');
    expect(result.envelope.amount).toBe('100000000000000000');
  });

  it('rejects malformed payment headers', () => {
    const result = parsePaymentHeader('not-base64');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected malformed payment header parse to fail');
    }

    expect(result.error.code).toBe('invalid_payment_header');
  });

  it('bypasses settlement in open mode while preserving service amount validation', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';

    const service = getAgentMarketplaceCatalog().services[0];
    const result = await verifyAgentMarketplacePayment({
      service,
      envelope: {
        agentId: 'agent-123',
        scheme: 'exact',
        network: 'eip155:1',
        token: 'ton',
        amount: service.payment!.amount,
        authorization: 'signed-payload',
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected open mode verification to succeed');
    }

    expect(result.mode).toBe('open');
    expect(result.agentId).toBe('agent-123');
  });

  it('rejects a payment when the amount does not match the service price', async () => {
    process.env.MARKETPLACE_PAYMENT_MODE = 'open';

    const service = getAgentMarketplaceCatalog().services[0];
    const result = await verifyAgentMarketplacePayment({
      service,
      envelope: {
        agentId: 'agent-123',
        scheme: 'exact',
        network: 'eip155:1',
        token: 'ton',
        amount: '1',
        authorization: 'signed-payload',
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected amount mismatch to fail verification');
    }

    expect(result.error.code).toBe('payment_amount_mismatch');
  });
});
