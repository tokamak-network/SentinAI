import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => {
  const loadFacilitatorConfig = vi.fn();
  const verifyPaymentAuthorization = vi.fn();
  const consumeNonce = vi.fn();
  const checkFunds = vi.fn();
  const settleTransfer = vi.fn();
  const signSettlementReceipt = vi.fn();
  const createSettlement = vi.fn();
  const getSettlement = vi.fn();
  const ensureFacilitatorReconcilerStarted = vi.fn();

  return {
    loadFacilitatorConfig,
    verifyPaymentAuthorization,
    consumeNonce,
    checkFunds,
    settleTransfer,
    signSettlementReceipt,
    createSettlement,
    getSettlement,
    ensureFacilitatorReconcilerStarted,
  };
});

vi.mock('@/lib/marketplace/facilitator/config', () => ({
  loadFacilitatorConfig: hoisted.loadFacilitatorConfig,
}));
vi.mock('@/lib/marketplace/facilitator/verify-authorization', () => ({
  verifyPaymentAuthorization: hoisted.verifyPaymentAuthorization,
}));
vi.mock('@/lib/marketplace/facilitator/nonce-store', () => ({
  consumeNonce: hoisted.consumeNonce,
}));
vi.mock('@/lib/marketplace/facilitator/check-funds', () => ({
  checkFunds: hoisted.checkFunds,
}));
vi.mock('@/lib/marketplace/facilitator/settle-transfer', () => ({
  settleTransfer: hoisted.settleTransfer,
}));
vi.mock('@/lib/marketplace/facilitator/receipt-signing', () => ({
  signSettlementReceipt: hoisted.signSettlementReceipt,
}));
vi.mock('@/lib/marketplace/facilitator/settlement-store', () => ({
  createSettlement: hoisted.createSettlement,
  getSettlement: hoisted.getSettlement,
}));
vi.mock('@/lib/marketplace/facilitator/reconcile-runner', () => ({
  ensureFacilitatorReconcilerStarted: hoisted.ensureFacilitatorReconcilerStarted,
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { POST } = await import('@/app/api/facilitator/v1/settle/route');
const { GET } = await import('@/app/api/facilitator/v1/settlements/[id]/route');

const BASE_CONFIG = {
  redisPrefix: 'sentinai:test',
  internalAuthSecret: 'internal-secret',
  receiptSigningKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
  merchantAllowlist: [
    {
      merchantId: 'sequencer-health',
      address: '0x2222222222222222222222222222222222222222',
      resources: ['/api/marketplace/sequencer-health'],
      networks: ['eip155:1'],
    },
  ],
  reconciler: { enabled: true, cron: '*/15 * * * * *' },
  profiles: {
    mainnet: {
      id: 'mainnet',
      enabled: true,
      chainId: 1,
      network: 'eip155:1',
      rpcUrl: 'https://mainnet.example',
      relayerPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      facilitatorAddress: '0x2222222222222222222222222222222222222222',
      tonAssetAddress: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
    },
    sepolia: {
      id: 'sepolia',
      enabled: false,
      chainId: 11155111,
      network: 'eip155:11155111',
      rpcUrl: 'https://sepolia.example',
      relayerPrivateKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      facilitatorAddress: '0x3333333333333333333333333333333333333333',
      tonAssetAddress: '0xa30fe40285b8f5c0457dbc3b7c8a280373c40044',
    },
  },
};

function createSettleRequest(overrides?: Record<string, unknown>, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/facilitator/v1/settle', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sentinai-internal-auth': 'internal-secret',
      'x-sentinai-merchant-id': 'sequencer-health',
      ...headers,
    },
    body: JSON.stringify({
      network: 'eip155:1',
      authorization: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x2222222222222222222222222222222222222222',
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validAfter: '1741680000',
        validBefore: '1741680300',
      },
      signature: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ...overrides,
    }),
  });
}

describe('/api/facilitator/v1/settle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadFacilitatorConfig.mockReturnValue(BASE_CONFIG);
    hoisted.verifyPaymentAuthorization.mockResolvedValue({
      isValid: true,
      signer: '0x1111111111111111111111111111111111111111',
    });
    hoisted.consumeNonce.mockResolvedValue(undefined);
    hoisted.checkFunds.mockResolvedValue({
      balance: 200000000000000000n,
      allowance: 150000000000000000n,
    });
    hoisted.settleTransfer.mockResolvedValue({
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      status: 'submitted',
    });
    hoisted.signSettlementReceipt.mockResolvedValue({
      payload: {
        success: true,
        settlementId: 'stl_123',
        chainId: 1,
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x2222222222222222222222222222222222222222',
        resource: '/api/marketplace/sequencer-health',
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        blockNumber: null,
        status: 'submitted',
      },
      signature:
        '0x1111111111111111111111111111111111111111bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      signer: '0x1111111111111111111111111111111111111111',
    });
    hoisted.createSettlement.mockResolvedValue(undefined);
    hoisted.ensureFacilitatorReconcilerStarted.mockResolvedValue(undefined);
    hoisted.getSettlement.mockResolvedValue({
      settlementId: 'stl_123',
      status: 'submitted',
      txStatus: 'submitted',
    });
  });

  it('accepts a valid settle request', async () => {
    const response = await POST(createSettleRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(hoisted.verifyPaymentAuthorization).toHaveBeenCalledTimes(1);
    expect(hoisted.consumeNonce).toHaveBeenCalledTimes(1);
    expect(hoisted.checkFunds).toHaveBeenCalledTimes(1);
    expect(hoisted.settleTransfer).toHaveBeenCalledTimes(1);
    expect(hoisted.createSettlement).toHaveBeenCalledTimes(1);
    expect(hoisted.ensureFacilitatorReconcilerStarted).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid signatures', async () => {
    hoisted.verifyPaymentAuthorization.mockResolvedValueOnce({
      isValid: false,
      reason: 'invalid signature',
    });

    const response = await POST(createSettleRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('invalid signature');
    expect(hoisted.consumeNonce).not.toHaveBeenCalled();
  });

  it('rejects nonce replay', async () => {
    hoisted.consumeNonce.mockRejectedValueOnce(new Error('nonce already used'));

    const response = await POST(createSettleRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('nonce');
  });

  it('rejects insufficient allowance', async () => {
    hoisted.checkFunds.mockRejectedValueOnce(new Error('Insufficient facilitator allowance for settlement'));

    const response = await POST(createSettleRequest());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toContain('allowance');
  });

  it('rejects missing internal auth', async () => {
    const response = await POST(
      createSettleRequest({}, { 'x-sentinai-internal-auth': '' })
    );

    expect(response.status).toBe(401);
    expect(hoisted.verifyPaymentAuthorization).not.toHaveBeenCalled();
  });

  it('rejects merchant allowlist mismatches', async () => {
    const response = await POST(
      createSettleRequest({}, { 'x-sentinai-merchant-id': 'unknown-merchant' })
    );

    expect(response.status).toBe(403);
    expect(hoisted.verifyPaymentAuthorization).not.toHaveBeenCalled();
  });

  it('rejects configs where the allowlisted merchant does not equal the facilitator spender', async () => {
    hoisted.loadFacilitatorConfig.mockReturnValueOnce({
      ...BASE_CONFIG,
      merchantAllowlist: [
        {
          merchantId: 'sequencer-health',
          address: '0x4444444444444444444444444444444444444444',
          resources: ['/api/marketplace/sequencer-health'],
          networks: ['eip155:1'],
        },
      ],
    });

    const response = await POST(createSettleRequest({
      authorization: {
        buyer: '0x1111111111111111111111111111111111111111',
        merchant: '0x4444444444444444444444444444444444444444',
        asset: '0x2be5e8c109e2197D077D13A82dAead6a9b3433C5',
        amount: '100000000000000000',
        resource: '/api/marketplace/sequencer-health',
        nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        validAfter: '1741680000',
        validBefore: '1741680300',
      },
    }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('Merchant must equal facilitator spender');
    expect(hoisted.verifyPaymentAuthorization).not.toHaveBeenCalled();
  });

  it('returns settlement status on lookup', async () => {
    const request = new NextRequest('http://localhost/api/facilitator/v1/settlements/stl_123', {
      method: 'GET',
      headers: {
        'x-sentinai-internal-auth': 'internal-secret',
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: 'stl_123' }) } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settlementId).toBe('stl_123');
    expect(body.status).toBe('submitted');
    expect(hoisted.getSettlement).toHaveBeenCalledWith('sentinai:test', 1, 'stl_123');
  });
});
