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
    useCase: 'Know instantly if the sequencer is down before submitting transactions — avoid failed txs and wasted gas',
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
    useCase: 'Check if this chain had recent outages before depositing funds — see incident count, resolution time, and patterns',
    personas: ['Fund Managers', 'Risk Teams', 'DeFi Protocols'],
    responsePreview: {
      activeIncidents: 0,
      resolvedToday: 2,
      avgResolutionTime: '12.5 min',
      lastIncident: '2026-03-23T14:30:00Z',
    },
  },
  batch_submission_status: {
    useCase: 'Spot batch posting delays that signal withdrawal slowdowns — critical for bridges and fund managers moving assets off L2',
    personas: ['L2 App Devs', 'MEV Bots', 'Sequencer Ops'],
    responsePreview: {
      pendingBatches: 3,
      submittedToday: 18,
      avgSubmissionTime: '2.1 min',
      lastSubmission: '2026-03-24T08:00:00Z',
    },
  },
  derivation_lag: {
    useCase: 'Verify L1↔L2 sync is healthy before bridging assets — a lag spike means your bridge tx could be delayed or stuck',
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
    useCase: 'Get early warnings when something goes wrong on-chain — so you can pause deposits, hedge positions, or alert users before impact',
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
    useCase: 'Confirm the chain infrastructure is healthy before relying on it — one API call covers CPU, sync, anomalies, and components',
    personas: ['Node Operators', 'DevOps', 'SRE Teams'],
    responsePreview: {
      overall: 'healthy',
      components: { 'op-geth': 'ok', 'op-node': 'ok', 'op-batcher': 'ok' },
      metrics: { cpu: '45%', memory: '8 GiB' },
      anomalies: 0,
    },
  },
  rca_report: {
    useCase: 'Understand why an outage happened and whether it could affect you again — detailed causal chain with remediation steps',
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
    useCase: 'Check if your validator is at risk of slashing — see uptime, missed blocks, and pending rewards before they\'re lost',
    personas: ['Staking Providers', 'Validators', 'DAO Treasuries'],
    responsePreview: {
      status: 'active',
      uptime: '99.95%',
      pendingRewards: '12.5 ETH',
      missedBlocks: 0,
    },
  },
  stake_info: {
    useCase: 'Compare staking yields and pool sizes to find the best place for your stake — updated in real-time',
    personas: ['DeFi Protocols', 'Yield Aggregators'],
    responsePreview: {
      totalStaked: '32,000 ETH',
      apr: '4.2%',
      delegators: 156,
      nextPayout: '2026-03-25T00:00:00Z',
    },
  },
  consensus_health: {
    useCase: 'See if the network is reaching consensus reliably — missed slots signal instability that could affect finality of your txs',
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
    useCase: 'See how loaded this RPC endpoint is before routing your traffic to it — avoid congested nodes that slow your app',
    personas: ['RPC Providers', 'Infrastructure Teams'],
    responsePreview: {
      lastHour: 45230,
      last24h: 1082400,
      peakRps: 125,
      trend: 'stable',
    },
  },
  latency_stats: {
    useCase: 'Know exactly how fast this RPC responds at P95/P99 — pick the fastest provider for your latency-sensitive operations',
    personas: ['Performance Engineers', 'SLA Managers'],
    responsePreview: {
      p50: '12ms',
      p95: '45ms',
      p99: '89ms',
      avg: '18ms',
    },
  },
  error_rate: {
    useCase: 'Check if this RPC is dropping requests before you commit to it — see error breakdown by code (429, 500, 503)',
    personas: ['Backend Devs', 'Reliability Engineers'],
    responsePreview: {
      totalErrors: 23,
      errorRate: '0.02%',
      breakdown: { '429': 15, '500': 5, '503': 3 },
    },
  },
  // Oracle services
  price_feed: {
    useCase: 'Get multi-DEX aggregated token prices for your lending protocol, trading bot, or liquidation engine — higher accuracy than single-source feeds',
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
    useCase: 'Know if oracle prices are stale before your protocol uses them — stale data causes bad liquidations and arbitrage losses',
    personas: ['Oracle Operators', 'Risk Monitors'],
    responsePreview: {
      pairs: { 'ETH/USDT': '2s ago', 'TON/USDT': '5s ago' },
      staleCount: 0,
      avgFreshness: '3.2s',
    },
  },
  // Monitoring services
  alert_status: {
    useCase: 'See all active infrastructure alerts in one call — know immediately if something is wrong before your users notice',
    personas: ['On-call Engineers', 'NOC Teams'],
    responsePreview: {
      activeAlerts: 1,
      severity: { critical: 0, warning: 1, info: 3 },
      lastTriggered: '2026-03-24T09:45:00Z',
    },
  },
  sla_metrics: {
    useCase: 'Get a reliability scorecard across all operators — useful for choosing which infrastructure providers to trust with your funds',
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
