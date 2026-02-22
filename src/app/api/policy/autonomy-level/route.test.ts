import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/policy/autonomy-level/route';
import { resetRuntimeAutonomyPolicy } from '@/lib/autonomy-policy';

describe('/api/policy/autonomy-level', () => {
  const originalApiKey = process.env.SENTINAI_API_KEY;

  beforeEach(() => {
    process.env.SENTINAI_API_KEY = 'test-admin-key';
    resetRuntimeAutonomyPolicy();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.SENTINAI_API_KEY;
    } else {
      process.env.SENTINAI_API_KEY = originalApiKey;
    }
    resetRuntimeAutonomyPolicy();
  });

  it('should return current policy on GET', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy).toBeDefined();
    expect(body.policy.level).toBeDefined();
  });

  it('should reject unauthorized POST', async () => {
    const request = new NextRequest('http://localhost/api/policy/autonomy-level', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'A4' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it('should update policy on authorized POST', async () => {
    const request = new NextRequest('http://localhost/api/policy/autonomy-level', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-admin-key',
      },
      body: JSON.stringify({
        level: 'A4',
        minConfidenceDryRun: 0.4,
        minConfidenceWrite: 0.8,
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.policy.level).toBe('A4');
    expect(body.policy.minConfidenceWrite).toBe(0.8);
  });
});
