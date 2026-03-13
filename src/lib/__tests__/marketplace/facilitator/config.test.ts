import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('facilitator config', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.TON_FACILITATOR_MAINNET_ENABLED = 'true';
    process.env.TON_FACILITATOR_MAINNET_RPC_URL = 'https://mainnet.example';
    process.env.TON_FACILITATOR_MAINNET_RELAYER_KEY =
      '0x1111111111111111111111111111111111111111111111111111111111111111';
    process.env.TON_FACILITATOR_MAINNET_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.TON_FACILITATOR_SEPOLIA_ENABLED = 'true';
    process.env.TON_FACILITATOR_SEPOLIA_RPC_URL = 'https://sepolia.example';
    process.env.TON_FACILITATOR_SEPOLIA_RELAYER_KEY =
      '0x2222222222222222222222222222222222222222222222222222222222222222';
    process.env.TON_FACILITATOR_SEPOLIA_ADDRESS = '0x2222222222222222222222222222222222222222';
    process.env.TON_FACILITATOR_RECEIPT_SIGNING_KEY =
      '0x3333333333333333333333333333333333333333333333333333333333333333';
    process.env.TON_FACILITATOR_REDIS_PREFIX = 'sentinai:test';
    process.env.TON_FACILITATOR_INTERNAL_AUTH_SECRET = 'internal-secret';
    process.env.TON_FACILITATOR_MERCHANT_ALLOWLIST = JSON.stringify([
      {
        merchantId: 'sequencer-health',
        address: '0x2222222222222222222222222222222222222222',
        resources: ['/api/marketplace/sequencer-health'],
        networks: ['eip155:11155111'],
      },
    ]);
    process.env.TON_FACILITATOR_RECONCILER_ENABLED = 'true';
    process.env.TON_FACILITATOR_RECONCILER_CRON = '*/15 * * * * *';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('loads mainnet and sepolia TON facilitator profiles from env', async () => {
    const { loadFacilitatorConfig } = await import('@/lib/marketplace/facilitator/config');

    const config = loadFacilitatorConfig();

    expect(config.redisPrefix).toBe('sentinai:test');
    expect(config.internalAuthSecret).toBe('internal-secret');
    expect(config.reconciler.enabled).toBe(true);
    expect(config.reconciler.cron).toBe('*/15 * * * * *');
    expect(config.profiles.mainnet.chainId).toBe(1);
    expect(config.profiles.mainnet.network).toBe('eip155:1');
    expect(config.profiles.mainnet.tonAssetAddress).toBe('0x2be5e8c109e2197D077D13A82dAead6a9b3433C5');
    expect(config.profiles.sepolia.chainId).toBe(11155111);
    expect(config.profiles.sepolia.network).toBe('eip155:11155111');
    expect(config.profiles.sepolia.tonAssetAddress).toBe('0xa30fe40285b8f5c0457dbc3b7c8a280373c40044');
    expect(config.merchantAllowlist).toHaveLength(1);
    expect(config.merchantAllowlist[0]?.merchantId).toBe('sequencer-health');
  });

  it('rejects allowlist addresses that do not match the facilitator spender for the configured network', async () => {
    process.env.TON_FACILITATOR_MERCHANT_ALLOWLIST = JSON.stringify([
      {
        merchantId: 'sequencer-health',
        address: '0x4444444444444444444444444444444444444444',
        resources: ['/api/marketplace/sequencer-health'],
        networks: ['eip155:11155111'],
      },
    ]);

    const { loadFacilitatorConfig } = await import('@/lib/marketplace/facilitator/config');

    expect(() => loadFacilitatorConfig()).toThrow(
      'Merchant allowlist entry sequencer-health must match facilitator address for eip155:11155111'
    );
  });
});
