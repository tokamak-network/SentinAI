import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/ai-routing/policy/route';
import { setRoutingPolicy } from '@/lib/ai-routing';

describe('POST /api/ai-routing/policy', () => {
  const originalApiKey = process.env.SENTINAI_API_KEY;

  beforeEach(() => {
    process.env.SENTINAI_API_KEY = 'test-admin-key';
    setRoutingPolicy({
      enabled: false,
      name: 'balanced',
      abPercent: 10,
      budgetUsdDaily: 50,
    });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.SENTINAI_API_KEY;
    } else {
      process.env.SENTINAI_API_KEY = originalApiKey;
    }
  });

  it('denies mutation without admin key', async () => {
    const request = new NextRequest('http://localhost/api/ai-routing/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'cost-first',
        enabled: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error).toContain('Unauthorized');
  });

  it('allows mutation with valid admin key', async () => {
    const request = new NextRequest('http://localhost/api/ai-routing/policy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-admin-key',
      },
      body: JSON.stringify({
        name: 'cost-first',
        enabled: true,
        abPercent: 25,
        budgetUsdDaily: 80,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.policy.name).toBe('cost-first');
    expect(body.policy.enabled).toBe(true);
    expect(body.policy.abPercent).toBe(25);
    expect(body.policy.budgetUsdDaily).toBe(80);
  });
});
