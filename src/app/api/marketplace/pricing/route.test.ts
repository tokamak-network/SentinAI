import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => {
  const store = {
    getPricingConfig: vi.fn(),
    updatePricing: vi.fn(),
    resetPricingToDefaults: vi.fn(),
    getBonusConfig: vi.fn(),
    updateBonusConfig: vi.fn(),
  };

  return {
    store,
    getMarketplaceStoreMock: vi.fn(() => store),
  };
});

vi.mock('@/lib/marketplace-store', () => ({
  getMarketplaceStore: hoisted.getMarketplaceStoreMock,
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { GET, PUT, OPTIONS } = await import('@/app/api/marketplace/pricing/route');

describe('/api/marketplace/pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENTINAI_API_KEY = 'test-api-key';

    hoisted.store.getPricingConfig.mockResolvedValue({
      traineePrice: 0,
      juniorPrice: 19900,
      seniorPrice: 49900,
      expertPrice: 79900,
      updatedAt: '2026-03-11T10:00:00.000Z',
    });
    hoisted.store.updatePricing.mockImplementation(async (update) => ({
      traineePrice: update.traineePrice ?? 0,
      juniorPrice: update.juniorPrice ?? 19900,
      seniorPrice: update.seniorPrice ?? 49900,
      expertPrice: update.expertPrice ?? 79900,
      updatedAt: '2026-03-11T10:05:00.000Z',
    }));
  });

  it('reads pricing from the shared marketplace store on GET', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.getMarketplaceStoreMock).toHaveBeenCalledTimes(1);
    expect(hoisted.store.getPricingConfig).toHaveBeenCalledTimes(1);
    expect(body.data.updatedAt).toBe('2026-03-11T10:00:00.000Z');
  });

  it('updates pricing through the shared marketplace store on PUT', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ juniorPrice: 25000 }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.getMarketplaceStoreMock).toHaveBeenCalledTimes(1);
    expect(hoisted.store.updatePricing).toHaveBeenCalledWith({ juniorPrice: 25000 });
    expect(body.data.juniorPrice).toBe(25000);
    expect(body.data.updatedAt).toBe('2026-03-11T10:05:00.000Z');
  });

  it('rejects unknown pricing keys', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ juniorPrice: 25000, foo: 1 }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('foo');
    expect(hoisted.store.updatePricing).not.toHaveBeenCalled();
  });

  it('returns CORS headers on OPTIONS', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, OPTIONS');
  });
});
