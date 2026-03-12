import { describe, expect, it } from 'vitest';
import {
  agentMarketplaceServiceKeys,
  sequencerHealthActions,
  sequencerHealthStatuses,
} from '@/types/agent-marketplace';
import {
  agentMarketplaceCatalog,
  defaultAgentMarketplaceCatalog,
  getAgentMarketplaceCatalog,
} from '@/lib/agent-marketplace/catalog';
import type {
  AgentMarketplaceCatalog,
  AgentMarketplacePaymentRequirement,
  AgentMarketplaceServiceKey,
  BatchSubmissionStatusSnapshot,
  IncidentSummarySnapshot,
  MarketplaceAgentMetadata,
  SequencerHealthAction,
  SequencerHealthSnapshot,
  SequencerHealthStatus,
} from '@/types/agent-marketplace';

describe('agent-marketplace core types', () => {
  it('supports the approved phase 1 service keys', () => {
    const sequencerHealth: AgentMarketplaceServiceKey = 'sequencer_health';
    const incidentSummary: AgentMarketplaceServiceKey = 'incident_summary';
    const batchSubmissionStatus: AgentMarketplaceServiceKey = 'batch_submission_status';

    expect(agentMarketplaceServiceKeys).toEqual([
      'sequencer_health',
      'incident_summary',
      'batch_submission_status',
    ]);
    expect(sequencerHealth).toBe('sequencer_health');
    expect(incidentSummary).toBe('incident_summary');
    expect(batchSubmissionStatus).toBe('batch_submission_status');
  });

  it('represents paid TON-denominated requirements and marketplace metadata', () => {
    const payment: AgentMarketplacePaymentRequirement = {
      scheme: 'exact',
      network: 'eip155:1',
      token: '0xton',
      amount: '100000000000000000',
    };

    const agent: MarketplaceAgentMetadata = {
      id: 'sentinai-thanos',
      status: 'active',
      version: '2026-03-12',
      operator: 'thanos-operator',
    };

    const catalog: AgentMarketplaceCatalog = {
      agent,
      services: [],
      updatedAt: '2026-03-12T00:00:00.000Z',
      acceptableUsePolicyVersion: '2026-03-11',
    };

    expect(payment.amount).toBe('100000000000000000');
    expect(catalog.agent.status).toBe('active');
    expect(catalog.acceptableUsePolicyVersion).toBe('2026-03-11');
  });

  it('supports sequencer health status and action enums', () => {
    const status: SequencerHealthStatus = 'healthy';
    const action: SequencerHealthAction = 'proceed';
    const snapshot: SequencerHealthSnapshot = {
      status,
      healthScore: 84,
      action,
      reasons: ['block interval stable'],
      window: {
        lookbackMinutes: 15,
        sampleCount: 15,
      },
      blockProduction: {
        latestBlockIntervalSec: 2.1,
        avgBlockIntervalSec: 2.3,
        stdDevBlockIntervalSec: 0.4,
        trend: 'stable',
        stalled: false,
      },
      sync: {
        lagBlocks: 0,
        lagTrend: 'stable',
        catchingUp: false,
      },
      incident: {
        activeCount: 0,
        highestSeverity: 'none',
        lastIncidentAt: '2026-03-12T00:00:00.000Z',
      },
      resources: {
        cpuPressure: 'normal',
        memoryPressure: 'normal',
      },
      updatedAt: '2026-03-12T00:05:00.000Z',
    };

    expect(sequencerHealthStatuses).toEqual(['healthy', 'degraded', 'critical']);
    expect(sequencerHealthActions).toEqual(['proceed', 'caution', 'delay', 'halt']);
    expect(snapshot.status).toBe('healthy');
    expect(snapshot.action).toBe('proceed');
  });

  it('defines incident and batch status snapshots for agent responses', () => {
    const incidentSummary: IncidentSummarySnapshot = {
      status: 'degraded',
      activeCount: 1,
      highestSeverity: 'high',
      unresolvedCount: 1,
      lastIncidentAt: '2026-03-12T00:00:00.000Z',
      rollingWindow: {
        lookbackHours: 24,
        incidentCount: 3,
        mttrMinutes: 18,
      },
    };

    const batchStatus: BatchSubmissionStatusSnapshot = {
      status: 'warning',
      lastSuccessfulSubmissionAt: '2026-03-12T00:00:00.000Z',
      submissionLagSec: 540,
      riskLevel: 'elevated',
      reasons: ['batch posting delayed'],
    };

    expect(incidentSummary.highestSeverity).toBe('high');
    expect(batchStatus.riskLevel).toBe('elevated');
  });

  it('builds a launch-ready catalog with only the approved phase 1 paid services active', () => {
    expect(agentMarketplaceCatalog).toEqual(defaultAgentMarketplaceCatalog);
    expect(getAgentMarketplaceCatalog().services).toHaveLength(3);
    expect(getAgentMarketplaceCatalog().services.map((service) => service.key)).toEqual([
      'sequencer_health',
      'incident_summary',
      'batch_submission_status',
    ]);
    expect(getAgentMarketplaceCatalog().services.every((service) => service.state === 'active')).toBe(true);
    expect(getAgentMarketplaceCatalog().services.every((service) => typeof service.payment?.amount === 'string')).toBe(true);
  });
});
