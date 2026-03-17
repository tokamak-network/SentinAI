import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agent-marketplace/registration-status', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({
    registered: true,
    agentId: '42',
    agentUri: 'https://my.sentinai.io/api/agent-marketplace/agent.json',
    txHash: '0xtxhash',
    registeredAt: '2024-03-13T14:22:00.000Z',
    contractAddress: '0xREG',
  }),
}));

const { GET } = await import(
  '@/app/api/agent-marketplace/ops/registration-status/route'
);

describe('GET /api/agent-marketplace/ops/registration-status', () => {
  it('returns 200 with registration status', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.agentId).toBe('42');
  });
});
