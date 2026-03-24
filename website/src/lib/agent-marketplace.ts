/**
 * Agent Marketplace - Service-based data catalog for public marketplace
 * Aligned with the main app's agent-marketplace catalog (x402 / TON per-call pricing)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentMarketplacePaymentRequirement {
  scheme: 'exact';
  network: string;
  token: string;
  amount: string; // wei string
}

export interface ServiceSLA {
  availabilityPercent: number;
  responseTimeMs: number;
  supportLevel: 'Basic' | 'Standard' | '24/7 Premium';
  refundPolicy: string;
}

export interface AgentMarketplaceServiceDefinition {
  key: string;
  state: 'active' | 'planned';
  displayName: string;
  description: string;
  payment: AgentMarketplacePaymentRequirement;
  sla?: ServiceSLA;
}

export interface DailyMetric {
  date: string;
  responseTimeMs: number;
  uptimePercent: number;
  requestCount: number;
}

export interface PerformanceHistory {
  metrics: DailyMetric[];
  lastUpdated: string;
}

export interface OperatorMetrics {
  cpuMean: number;
  memoryGiB: number;
  activeAnomalies: number;
  rating: number;
  reviewCount: number;
  uptimePercent: number;
  avgLatencyMs: number;
  monthlyCallCount: number;
}

export interface OperatorCatalog {
  operator: string;
  address: string;
  description: string;
  status: 'online' | 'offline' | 'degraded';
  services: AgentMarketplaceServiceDefinition[];
  metrics: OperatorMetrics;
  performanceHistory: PerformanceHistory;
}

export interface MarketplaceAgentMetadata {
  id: string;
  status: 'active' | 'inactive';
  version: string;
  operator: string;
  operatorAddress?: string; // on-chain wallet address
  baseUrl: string; // operator's API base URL
}

export interface AgentMarketplaceCatalog {
  agent: MarketplaceAgentMetadata & { performanceHistory?: PerformanceHistory };
  services: AgentMarketplaceServiceDefinition[];
  updatedAt: string;
  acceptableUsePolicyVersion: string;
}

export const generateMockPerformance = (days: number = 90): any => {
  const metrics: DailyMetric[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - i));
    metrics.push({
      date: date.toISOString().split('T')[0],
      responseTimeMs: 150 + Math.random() * 200,
      uptimePercent: 98.5 + Math.random() * 1.4,
      requestCount: Math.floor(800 + Math.random() * 1200),
    });
  }
  return {
    metrics,
    lastUpdated: new Date().toISOString()
  };
};

// ─── Multiple Operators Data ──────────────────────────────────────────────────

const ALL_OPERATORS: Record<string, OperatorCatalog> = {
  '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9': {
    operator: 'sentinai-operator',
    address: '0xd7d57ba9f40629d48c4009a87654cdda8a5433e9',
    description: 'L2 Node Monitor & Auto-Recovery',
    status: 'online',
    services: [
      {
        key: 'sequencer_health',
        state: 'active',
        displayName: 'Sequencer Health',
        description: 'Decision-ready execution health snapshot for agent gating',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 150, supportLevel: '24/7 Premium', refundPolicy: '5% credit if SLA missed' }
      },
      {
        key: 'incident_summary',
        state: 'active',
        displayName: 'Incident Summary',
        description: 'Current incident state and recent reliability summary',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '150000000000000000' },
        sla: { availabilityPercent: 99.5, responseTimeMs: 250, supportLevel: 'Standard', refundPolicy: '2% credit if SLA missed' }
      },
      {
        key: 'batch_submission_status',
        state: 'active',
        displayName: 'Batch Submission Status',
        description: 'Recent batch posting health, lag, and settlement risk',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '150000000000000000' },
        sla: { availabilityPercent: 99.0, responseTimeMs: 350, supportLevel: 'Standard', refundPolicy: '2% credit if SLA missed' }
      },
      {
        key: 'derivation_lag',
        state: 'active',
        displayName: 'Derivation Lag',
        description: 'L2-to-L1 derivation pipeline health with block-level lag tracking',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 200, supportLevel: '24/7 Premium', refundPolicy: '5% credit if SLA missed' }
      },
      {
        key: 'anomaly_feed',
        state: 'active',
        displayName: 'Anomaly Feed',
        description: 'Real-time anomaly detection events with severity and status tracking',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.95, responseTimeMs: 100, supportLevel: '24/7 Premium', refundPolicy: '10% credit if SLA missed' }
      },
      {
        key: 'health_diagnostics',
        state: 'active',
        displayName: 'Health Diagnostics',
        description: 'Comprehensive system health check across metrics, anomalies, L1 RPC, and components',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '150000000000000000' },
        sla: { availabilityPercent: 98.5, responseTimeMs: 500, supportLevel: 'Basic', refundPolicy: 'None' }
      },
      {
        key: 'rca_report',
        state: 'active',
        displayName: 'RCA Report',
        description: 'Root cause analysis history with causal chains and remediation recommendations',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '250000000000000000' },
        sla: { availabilityPercent: 98.0, responseTimeMs: 1000, supportLevel: 'Basic', refundPolicy: 'None' }
      }
    ],
    metrics: { cpuMean: 45, memoryGiB: 8, activeAnomalies: 0, rating: 4.8, reviewCount: 127, uptimePercent: 99.9, avgLatencyMs: 234, monthlyCallCount: 847 },
    performanceHistory: generateMockPerformance() as any as any,
  },
  '0x1111111111111111111111111111111111111111': {
    operator: 'validator-node',
    address: '0x1111111111111111111111111111111111111111',
    description: 'Stake Validation & Consensus',
    status: 'online',
    services: [
      {
        key: 'validator_status',
        state: 'active',
        displayName: 'Validator Status',
        description: 'Real-time validator status and rewards',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '150000000000000000' },
        sla: { availabilityPercent: 99.95, responseTimeMs: 100, supportLevel: '24/7 Premium', refundPolicy: '10% credit if SLA missed' }
      },
      {
        key: 'stake_info',
        state: 'active',
        displayName: 'Stake Info',
        description: 'Current staking pool details and yield estimates',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.5, responseTimeMs: 200, supportLevel: 'Standard', refundPolicy: '2% credit if SLA missed' }
      },
      {
        key: 'consensus_health',
        state: 'active',
        displayName: 'Consensus Health',
        description: 'Consensus participation metrics and missed blocks',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '200000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 150, supportLevel: '24/7 Premium', refundPolicy: '5% credit if SLA missed' }
      }
    ],
    metrics: { cpuMean: 60, memoryGiB: 16, activeAnomalies: 1, rating: 4.6, reviewCount: 342, uptimePercent: 99.8, avgLatencyMs: 150, monthlyCallCount: 1500 },
    performanceHistory: generateMockPerformance() as any,
  },
  '0x2222222222222222222222222222222222222222': {
    operator: 'rpc-provider',
    address: '0x2222222222222222222222222222222222222222',
    description: 'High-Performance RPC Gateway',
    status: 'online',
    services: [
      {
        key: 'request_count',
        state: 'active',
        displayName: 'Request Volume',
        description: 'Total RPC requests processed per hour',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '50000000000000000' },
        sla: { availabilityPercent: 99.99, responseTimeMs: 50, supportLevel: '24/7 Premium', refundPolicy: '10% credit if SLA missed' }
      },
      {
        key: 'latency_stats',
        state: 'active',
        displayName: 'Latency Stats',
        description: 'Detailed P99, P95, and average latency metrics',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '50000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 100, supportLevel: 'Standard', refundPolicy: 'None' }
      },
      {
        key: 'error_rate',
        state: 'active',
        displayName: 'Error Rate',
        description: 'Failed requests breakdown by error code',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '50000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 100, supportLevel: 'Standard', refundPolicy: 'None' }
      }
    ],
    metrics: { cpuMean: 75, memoryGiB: 32, activeAnomalies: 0, rating: 4.9, reviewCount: 1250, uptimePercent: 99.99, avgLatencyMs: 45, monthlyCallCount: 50000 },
    performanceHistory: generateMockPerformance() as any,
  },
  '0x3333333333333333333333333333333333333333': {
    operator: 'data-oracle',
    address: '0x3333333333333333333333333333333333333333',
    description: 'Decentralized Price Feeds',
    status: 'degraded',
    services: [
      {
        key: 'price_feed',
        state: 'active',
        displayName: 'Price Feed',
        description: 'Real-time token prices aggregated from multiple DEXs',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '250000000000000000' },
        sla: { availabilityPercent: 99.0, responseTimeMs: 500, supportLevel: 'Standard', refundPolicy: 'None' }
      },
      {
        key: 'freshness_monitor',
        state: 'active',
        displayName: 'Data Freshness',
        description: 'Time since last on-chain update for all supported pairs',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.5, responseTimeMs: 300, supportLevel: 'Standard', refundPolicy: 'None' }
      }
    ],
    metrics: { cpuMean: 85, memoryGiB: 4, activeAnomalies: 3, rating: 3.8, reviewCount: 85, uptimePercent: 95.5, avgLatencyMs: 600, monthlyCallCount: 1200 },
    performanceHistory: generateMockPerformance() as any,
  },
  '0x4444444444444444444444444444444444444444': {
    operator: 'monitoring-service',
    address: '0x4444444444444444444444444444444444444444',
    description: 'Ecosystem Alerting & Dashboards',
    status: 'online',
    services: [
      {
        key: 'alert_status',
        state: 'active',
        displayName: 'Active Alerts',
        description: 'Current triggered alerts across the monitored ecosystem',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '100000000000000000' },
        sla: { availabilityPercent: 99.9, responseTimeMs: 150, supportLevel: '24/7 Premium', refundPolicy: '5% credit if SLA missed' }
      },
      {
        key: 'sla_metrics',
        state: 'active',
        displayName: 'SLA Dashboard',
        description: 'Aggregated SLA compliance data for all operators',
        payment: { scheme: 'exact', network: 'eip155:11155111', token: 'TON', amount: '300000000000000000' },
        sla: { availabilityPercent: 99.5, responseTimeMs: 400, supportLevel: 'Standard', refundPolicy: 'None' }
      }
    ],
    metrics: { cpuMean: 30, memoryGiB: 8, activeAnomalies: 0, rating: 4.7, reviewCount: 210, uptimePercent: 99.9, avgLatencyMs: 180, monthlyCallCount: 3000 },
    performanceHistory: generateMockPerformance() as any,
  }
};

export function getOperatorByAddress(address: string): OperatorCatalog | null {
  return ALL_OPERATORS[address.toLowerCase()] || null;
}

export function getAllOperators(): OperatorCatalog[] {
  return Object.values(ALL_OPERATORS);
}

// ─── Legacy Single Catalog Support ─────────────────────────────────────────────

export function getServiceCatalog(): AgentMarketplaceCatalog {
  const baseUrl = process.env.NEXT_PUBLIC_OPERATOR_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3002';
  const defaultOp = ALL_OPERATORS['0xd7d57ba9f40629d48c4009a87654cdda8a5433e9'];
  return {
    agent: {
      id: 'sentinai-agent-marketplace',
      status: 'active',
      version: '2026-03-12',
      operator: defaultOp.operator,
      operatorAddress: defaultOp.address,
      baseUrl,
      performanceHistory: defaultOp.performanceHistory
    },
    services: defaultOp.services,
    updatedAt: new Date().toISOString(),
    acceptableUsePolicyVersion: '2026-03-11',
  };
}

export function getManifestCatalog(): AgentMarketplaceCatalog {
  return getServiceCatalog();
}

export function verifyPaymentHeader(header: string | undefined): boolean {
  return header !== undefined && header.length > 0;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

export function formatTONPrice(weiStr: string): string {
  const wei = BigInt(weiStr);
  const ton = Number(wei) / 1e18;
  return `${ton.toFixed(2)} TON`;
}

export function serviceKeyToEndpoint(key: string, baseUrl: string): string {
  const slug = key.replace(/_/g, '-');
  return `${baseUrl}/api/agent-marketplace/${slug}`;
}

export function formatNetworkName(network: string): string {
  const names: Record<string, string> = {
    'eip155:1': 'eip155:1 (Ethereum)',
    'eip155:11155111': 'eip155:11155111 (Sepolia)',
  };
  return names[network] ?? network;
}

// ─── Legacy Mocks ─────────────────────────────────────────────────────────────

export interface SequencerHealth { status: 'healthy' | 'degraded' | 'unhealthy'; latency: number; syncLag: number; uptime: number; lastUpdate: string; }
export interface IncidentSummary { activeIncidents: number; resolvedToday: number; avgResolutionTime: number; lastIncident: string | null; }
export interface BatchSubmissionStatus { pendingBatches: number; submittedToday: number; avgSubmissionTime: number; lastSubmission: string | null; }

export function getSequencerHealth(): SequencerHealth {
  return { status: 'healthy', latency: 1250, syncLag: 2, uptime: 99.97, lastUpdate: new Date().toISOString() };
}
export function getIncidentSummary(): IncidentSummary {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  return { activeIncidents: 0, resolvedToday: 2, avgResolutionTime: 12.5, lastIncident: yesterday.toISOString() };
}
export function getBatchSubmissionStatus(): BatchSubmissionStatus {
  const lastSubmissionTime = new Date(); lastSubmissionTime.setHours(lastSubmissionTime.getHours() - 2);
  return { pendingBatches: 3, submittedToday: 18, avgSubmissionTime: 2.1, lastSubmission: lastSubmissionTime.toISOString() };
}
