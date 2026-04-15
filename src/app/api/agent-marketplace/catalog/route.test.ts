import { describe, expect, it } from 'vitest';

const { GET } = await import('@/app/api/agent-marketplace/catalog/route');

describe('/api/agent-marketplace/catalog', () => {
  it('returns public agent metadata and payment requirements without internal-only fields', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.id).toBe('sentinai-agent-marketplace');
    expect(body.acceptableUsePolicyVersion).toBe('2026-03-11');
    expect(body.services.map((service: { key: string }) => service.key)).toEqual([
      'sequencer_health',
      'incident_summary',
      'batch_submission_status',
      'derivation_lag',
      'anomaly_feed',
      'health_diagnostics',
      'rca_report',
      'request_count',
      'latency_stats',
      'error_rate',
      'alert_status',
      'sla_metrics',
    ]);
    expect(body.services[0].payment.amount).toBe('100000000000000000');
    expect(body.internalNotes).toBeUndefined();
  });
});
