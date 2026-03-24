/**
 * Service Catalog Metadata
 * Use-case driven descriptions + response previews for each service
 */

export interface ServiceMeta {
  useCase: string;
  personas: string[];
  responsePreview: Record<string, unknown>;
}

export const SERVICE_META: Record<string, ServiceMeta> = {
  sequencer_health: {
    useCase: 'Detect sequencer failures within 1 second and automatically reroute traffic to a healthy node',
    personas: ['DeFi Ops', 'Bridge Operators', 'MEV Bots'],
    responsePreview: {
      status: 'healthy',
      latency: 1250,
      syncLag: 2,
      uptime: 99.97,
      lastUpdate: '2026-03-24T10:00:00Z',
    },
  },
  incident_summary: {
    useCase: 'Check recent incident history to decide whether it\'s safe to deploy funds on this chain',
    personas: ['Fund Managers', 'Risk Teams', 'DeFi Protocols'],
    responsePreview: {
      activeIncidents: 0,
      resolvedToday: 2,
      avgResolutionTime: '12.5 min',
      lastIncident: '2026-03-23T14:30:00Z',
    },
  },
  batch_submission_status: {
    useCase: 'Detect batch submission delays early so you can act before your L2 transactions get stuck',
    personas: ['L2 App Devs', 'MEV Bots', 'Sequencer Ops'],
    responsePreview: {
      pendingBatches: 3,
      submittedToday: 18,
      avgSubmissionTime: '2.1 min',
      lastSubmission: '2026-03-24T08:00:00Z',
    },
  },
  derivation_lag: {
    useCase: 'Monitor L1↔L2 sync lag in real-time to verify bridge safety before cross-chain transfers',
    personas: ['Bridge Operators', 'Cross-chain Protocols'],
    responsePreview: {
      l2BlockNumber: 18234567,
      l1Origin: 19876543,
      lagBlocks: 2,
      lagSeconds: 24,
      status: 'synced',
    },
  },
  anomaly_feed: {
    useCase: 'Stream real-time anomaly events directly into your bots, dashboards, or alert pipelines',
    personas: ['Monitoring Teams', 'Alert Systems', 'Trading Bots'],
    responsePreview: {
      anomalies: [
        { severity: 'warning', component: 'op-geth', metric: 'cpu', value: 78.5, threshold: 70 },
      ],
      activeCount: 1,
      totalRecent: 3,
    },
  },
  health_diagnostics: {
    useCase: 'Run a full system health check in one call — ideal for ops reports and SLA compliance',
    personas: ['Node Operators', 'DevOps', 'SRE Teams'],
    responsePreview: {
      overall: 'healthy',
      components: { 'op-geth': 'ok', 'op-node': 'ok', 'op-batcher': 'ok' },
      metrics: { cpu: '45%', memory: '8 GiB' },
      anomalies: 0,
    },
  },
  rca_report: {
    useCase: 'Get root cause analysis reports for post-mortems, compliance, and incident documentation',
    personas: ['SRE Teams', 'Compliance', 'Incident Managers'],
    responsePreview: {
      incidentId: 'INC-2026-0324-001',
      rootCause: 'L1 RPC endpoint timeout caused derivation stall',
      affectedComponents: ['op-node', 'op-batcher'],
      resolution: 'Automatic failover to backup L1 RPC',
      duration: '4 min 32 sec',
    },
  },
  // Validator services
  validator_status: {
    useCase: 'Track validator status and rewards in real-time to manage slashing risk proactively',
    personas: ['Staking Providers', 'Validators', 'DAO Treasuries'],
    responsePreview: {
      status: 'active',
      uptime: '99.95%',
      pendingRewards: '12.5 ETH',
      missedBlocks: 0,
    },
  },
  stake_info: {
    useCase: 'Check staking pool status and yield estimates to optimize your staking strategy',
    personas: ['DeFi Protocols', 'Yield Aggregators'],
    responsePreview: {
      totalStaked: '32,000 ETH',
      apr: '4.2%',
      delegators: 156,
      nextPayout: '2026-03-25T00:00:00Z',
    },
  },
  consensus_health: {
    useCase: 'Track consensus participation rate and missed blocks to assess network stability',
    personas: ['Network Monitors', 'Governance Teams'],
    responsePreview: {
      participationRate: '99.8%',
      missedSlots: 2,
      finalizedEpoch: 234567,
      headSlot: 7501234,
    },
  },
  // RPC services
  request_count: {
    useCase: 'Track RPC request volume by hour for capacity planning and cost optimization',
    personas: ['RPC Providers', 'Infrastructure Teams'],
    responsePreview: {
      lastHour: 45230,
      last24h: 1082400,
      peakRps: 125,
      trend: 'stable',
    },
  },
  latency_stats: {
    useCase: 'Monitor P99/P95 latency in real-time to ensure SLA compliance',
    personas: ['Performance Engineers', 'SLA Managers'],
    responsePreview: {
      p50: '12ms',
      p95: '45ms',
      p99: '89ms',
      avg: '18ms',
    },
  },
  error_rate: {
    useCase: 'Analyze failure rates by error code to quickly identify the source of outages',
    personas: ['Backend Devs', 'Reliability Engineers'],
    responsePreview: {
      totalErrors: 23,
      errorRate: '0.02%',
      breakdown: { '429': 15, '500': 5, '503': 3 },
    },
  },
  // Oracle services
  price_feed: {
    useCase: 'Get accurate real-time token prices aggregated from multiple DEXs for reliable price feeds',
    personas: ['DeFi Protocols', 'Trading Bots', 'Lending Platforms'],
    responsePreview: {
      pair: 'ETH/USDT',
      price: 3245.67,
      sources: 5,
      confidence: '99.2%',
      updatedAt: '2026-03-24T10:00:01Z',
    },
  },
  freshness_monitor: {
    useCase: 'Detect on-chain price update delays to prevent stale data risk in your protocols',
    personas: ['Oracle Operators', 'Risk Monitors'],
    responsePreview: {
      pairs: { 'ETH/USDT': '2s ago', 'TON/USDT': '5s ago' },
      staleCount: 0,
      avgFreshness: '3.2s',
    },
  },
  // Monitoring services
  alert_status: {
    useCase: 'Aggregate all active alerts in one view to get instant ecosystem health awareness',
    personas: ['On-call Engineers', 'NOC Teams'],
    responsePreview: {
      activeAlerts: 1,
      severity: { critical: 0, warning: 1, info: 3 },
      lastTriggered: '2026-03-24T09:45:00Z',
    },
  },
  sla_metrics: {
    useCase: 'Aggregate SLA compliance across all operators for network reliability reporting',
    personas: ['Platform Ops', 'Business Teams'],
    responsePreview: {
      avgUptime: '99.7%',
      avgResponseTime: '185ms',
      operatorsAboveSLA: 4,
      totalOperators: 5,
    },
  },
};

export function getServiceMeta(serviceKey: string): ServiceMeta | null {
  return SERVICE_META[serviceKey] ?? null;
}
