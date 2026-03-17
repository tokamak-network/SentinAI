import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => {
  const store = {
    getPricingConfig: vi.fn(),
    updatePricing: vi.fn(),
    resetPricingToDefaults: vi.fn(),
    getBonusConfig: vi.fn(),
    updateBonusConfig: vi.fn(),
    getBracketPricingConfig: vi.fn(),
    updateBracketPricing: vi.fn(),
    resetBracketPricingToDefaults: vi.fn(),
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

    hoisted.store.getBracketPricingConfig.mockResolvedValue({
      brackets: [
        { floor: 80, priceCents: 79900, label: 'Expert' },
        { floor: 60, priceCents: 49900, label: 'Advanced' },
        { floor: 30, priceCents: 19900, label: 'Standard' },
        { floor: 0, priceCents: 0, label: 'Starter' },
      ],
      updatedAt: '2026-03-11T10:00:00.000Z',
    });

    hoisted.store.getPricingConfig.mockResolvedValue({
      traineePrice: 0,
      juniorPrice: 19900,
      seniorPrice: 49900,
      expertPrice: 79900,
      updatedAt: '2026-03-11T10:00:00.000Z',
    });

    hoisted.store.updateBracketPricing.mockImplementation(async (config) => ({
      ...config,
      updatedAt: '2026-03-11T10:05:00.000Z',
    }));
  });

  it('reads bracket pricing from the shared marketplace store on GET', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.getMarketplaceStoreMock).toHaveBeenCalled();
    expect(hoisted.store.getBracketPricingConfig).toHaveBeenCalledTimes(1);
    expect(body.data.brackets).toHaveLength(4);
    expect(body.data.updatedAt).toBe('2026-03-11T10:00:00.000Z');
    // Also returns legacy config
    expect(body.legacy).toBeDefined();
  });

  it('updates bracket pricing through the shared marketplace store on PUT', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        brackets: [
          { floor: 80, priceCents: 89900, label: 'Expert' },
          { floor: 0, priceCents: 0, label: 'Starter' },
        ],
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(hoisted.store.updateBracketPricing).toHaveBeenCalledTimes(1);
    expect(body.data.brackets).toHaveLength(2);
  });

  it('rejects brackets without floor=0', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        brackets: [
          { floor: 80, priceCents: 79900, label: 'Expert' },
        ],
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('floor=0');
    expect(hoisted.store.updateBracketPricing).not.toHaveBeenCalled();
  });

  it('rejects duplicate floors', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        brackets: [
          { floor: 0, priceCents: 0, label: 'Starter' },
          { floor: 0, priceCents: 100, label: 'Also Starter' },
        ],
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('unique');
    expect(hoisted.store.updateBracketPricing).not.toHaveBeenCalled();
  });

  it('rejects non-array brackets', async () => {
    const request = new NextRequest('http://localhost/api/marketplace/pricing', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ brackets: 'not-array' }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('array');
  });

  it('returns CORS headers on OPTIONS', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT, OPTIONS');
  });
});
