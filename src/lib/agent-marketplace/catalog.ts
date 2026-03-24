import type {
  AgentMarketplaceCatalog,
  AgentMarketplaceServiceDefinition,
  AgentMarketplaceServiceKey,
} from '@/types/agent-marketplace';
import { getAllServiceOverrides } from '@/lib/agent-marketplace/service-catalog-store';

const DEFAULT_UPDATED_AT = '2026-03-12T00:00:00.000Z';
const DEFAULT_AUP_VERSION = '2026-03-11';

export const defaultAgentMarketplaceCatalog: AgentMarketplaceCatalog = {
  agent: {
    id: 'sentinai-agent-marketplace',
    status: 'active',
    version: '2026-03-12',
    operator: 'sentinai-operator',
  },
  services: [
    {
      key: 'sequencer_health',
      state: 'active',
      displayName: 'Sequencer Health',
      description: 'Decision-ready execution health snapshot for agent gating',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '100000000000000000',
      },
    },
    {
      key: 'incident_summary',
      state: 'active',
      displayName: 'Incident Summary',
      description: 'Current incident state and recent reliability summary',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '150000000000000000',
      },
    },
    {
      key: 'batch_submission_status',
      state: 'active',
      displayName: 'Batch Submission Status',
      description: 'Recent batch posting health, lag, and settlement risk',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '150000000000000000',
      },
    },
    {
      key: 'derivation_lag',
      state: 'active',
      displayName: 'Derivation Lag',
      description: 'L2-to-L1 derivation pipeline health with block-level lag tracking',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '100000000000000000',
      },
    },
    {
      key: 'anomaly_feed',
      state: 'active',
      displayName: 'Anomaly Feed',
      description: 'Real-time anomaly detection events with severity and status tracking',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '100000000000000000',
      },
    },
    {
      key: 'health_diagnostics',
      state: 'active',
      displayName: 'Health Diagnostics',
      description: 'Comprehensive system health check across metrics, anomalies, L1 RPC, and components',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '150000000000000000',
      },
    },
    {
      key: 'rca_report',
      state: 'active',
      displayName: 'RCA Report',
      description: 'Root cause analysis history with causal chains and remediation recommendations',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '250000000000000000',
      },
    },
    {
      key: 'request_count',
      state: 'active',
      displayName: 'Request Volume',
      description: 'RPC request volume tracking by hour with peak RPS and trend analysis',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '50000000000000000',
      },
    },
    {
      key: 'latency_stats',
      state: 'active',
      displayName: 'Latency Stats',
      description: 'P50/P95/P99 latency percentiles for RPC endpoint performance evaluation',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '50000000000000000',
      },
    },
    {
      key: 'error_rate',
      state: 'active',
      displayName: 'Error Rate',
      description: 'Failed request breakdown by error code with overall error rate percentage',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '50000000000000000',
      },
    },
    {
      key: 'alert_status',
      state: 'active',
      displayName: 'Active Alerts',
      description: 'Current triggered alerts across the monitored ecosystem with severity breakdown',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '100000000000000000',
      },
    },
    {
      key: 'sla_metrics',
      state: 'active',
      displayName: 'SLA Dashboard',
      description: 'Aggregated SLA compliance data across all operators with uptime and latency metrics',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'ton',
        amount: '300000000000000000',
      },
    },
  ],
  updatedAt: DEFAULT_UPDATED_AT,
  acceptableUsePolicyVersion: DEFAULT_AUP_VERSION,
};

export const agentMarketplaceCatalog = defaultAgentMarketplaceCatalog;

export function getAgentMarketplaceCatalog(): AgentMarketplaceCatalog {
  return agentMarketplaceCatalog;
}

export async function getAgentMarketplaceCatalogWithOverrides(): Promise<AgentMarketplaceCatalog> {
  const overrides = await getAllServiceOverrides();
  const services = agentMarketplaceCatalog.services.map((service) => {
    const override = overrides[service.key];
    if (!override) return service;
    return {
      ...service,
      ...(override.state !== undefined ? { state: override.state } : {}),
      ...(override.amount !== undefined && service.payment
        ? { payment: { ...service.payment, amount: override.amount } }
        : {}),
    } satisfies AgentMarketplaceServiceDefinition;
  });
  return {
    ...agentMarketplaceCatalog,
    services,
    updatedAt: new Date().toISOString(),
  };
}

export function getAgentMarketplaceService(
  key: AgentMarketplaceServiceKey
): AgentMarketplaceServiceDefinition {
  const service = agentMarketplaceCatalog.services.find((entry) => entry.key === key);
  if (!service) {
    throw new Error(`Unknown agent marketplace service: ${key}`);
  }

  return service;
}
