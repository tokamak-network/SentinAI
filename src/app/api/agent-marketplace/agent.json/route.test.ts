import { describe, expect, it } from 'vitest';

const { GET } = await import('@/app/api/agent-marketplace/agent.json/route');

describe('/api/agent-marketplace/agent.json', () => {
  it('publishes public agent metadata and active marketplace capabilities', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('SentinAI Agent Marketplace');
    expect(body.version).toBe('2026-03-12');
    expect(body.capabilities).toEqual([
      'sequencer_health',
      'incident_summary',
      'batch_submission_status',
    ]);
    expect(body.endpoint).toBe('/api/agent-marketplace');
    expect(body.payment).toMatchObject({
      protocol: 'x402',
      network: 'eip155:1',
    });
    expect(body.opsSnapshot).toMatchObject({
      endpoint: '/api/agent-marketplace/ops-snapshot.json',
    });
  });
});
