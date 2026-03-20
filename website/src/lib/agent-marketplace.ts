/**
 * Agent Marketplace - Service-based data catalog for public marketplace
 * Aligned with the main app's agent-marketplace catalog (x402 / TON per-call pricing)
 */

// ─── Types (copied from src/types/agent-marketplace.ts — separate Next.js app) ─

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

export interface MarketplaceAgentMetadata {
  id: string;
  status: 'active' | 'inactive';
  version: string;
  operator: string;
  operatorAddress?: string; // on-chain wallet address from ERC8004 registry
  baseUrl: string; // operator's SentinAI API base URL
}

export interface AgentMarketplaceCatalog {
  agent: MarketplaceAgentMetadata;
  services: AgentMarketplaceServiceDefinition[];
  updatedAt: string;
  acceptableUsePolicyVersion: string;
}

// ─── Static Catalog (mirrors src/lib/agent-marketplace/catalog.ts) ─────────────

// baseUrl is injected dynamically by getServiceCatalog() — not hardcoded here
const SERVICE_CATALOG_BASE = {
  agent: {
    id: 'sentinai-agent-marketplace',
    status: 'active' as const,
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
        token: 'TON',
        amount: '100000000000000000',
      },
      sla: {
        availabilityPercent: 99.9,
        responseTimeMs: 150,
        supportLevel: '24/7 Premium',
        refundPolicy: '5% credit if SLA missed'
      }
    },
    {
      key: 'incident_summary',
      state: 'active',
      displayName: 'Incident Summary',
      description: 'Current incident state and recent reliability summary',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '150000000000000000',
      },
      sla: {
        availabilityPercent: 99.5,
        responseTimeMs: 250,
        supportLevel: 'Standard',
        refundPolicy: '2% credit if SLA missed'
      }
    },
    {
      key: 'batch_submission_status',
      state: 'active',
      displayName: 'Batch Submission Status',
      description: 'Recent batch posting health, lag, and settlement risk',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '150000000000000000',
      },
      sla: {
        availabilityPercent: 99.0,
        responseTimeMs: 350,
        supportLevel: 'Standard',
        refundPolicy: '2% credit if SLA missed'
      }
    },
    {
      key: 'derivation_lag',
      state: 'active',
      displayName: 'Derivation Lag',
      description: 'L2-to-L1 derivation pipeline health with block-level lag tracking',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '100000000000000000',
      },
      sla: {
        availabilityPercent: 99.9,
        responseTimeMs: 200,
        supportLevel: '24/7 Premium',
        refundPolicy: '5% credit if SLA missed'
      }
    },
    {
      key: 'anomaly_feed',
      state: 'active',
      displayName: 'Anomaly Feed',
      description: 'Real-time anomaly detection events with severity and status tracking',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '100000000000000000',
      },
      sla: {
        availabilityPercent: 99.95,
        responseTimeMs: 100,
        supportLevel: '24/7 Premium',
        refundPolicy: '10% credit if SLA missed'
      }
    },
    {
      key: 'health_diagnostics',
      state: 'active',
      displayName: 'Health Diagnostics',
      description: 'Comprehensive system health check across metrics, anomalies, L1 RPC, and components',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '150000000000000000',
      },
      sla: {
        availabilityPercent: 98.5,
        responseTimeMs: 500,
        supportLevel: 'Basic',
        refundPolicy: 'None'
      }
    },
    {
      key: 'rca_report',
      state: 'active',
      displayName: 'RCA Report',
      description: 'Root cause analysis history with causal chains and remediation recommendations',
      payment: {
        scheme: 'exact',
        network: 'eip155:11155111',
        token: 'TON',
        amount: '250000000000000000',
      },
      sla: {
        availabilityPercent: 98.0,
        responseTimeMs: 1000,
        supportLevel: 'Basic',
        refundPolicy: 'None'
      }
    },
  ],
  updatedAt: '2026-03-12T00:00:00.000Z',
  acceptableUsePolicyVersion: '2026-03-11',
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

/** Convert wei string to human-readable TON price: "100000000000000000" → "0.10 TON" */
export function formatTONPrice(weiStr: string): string {
  const wei = BigInt(weiStr);
  const ton = Number(wei) / 1e18;
  return `${ton.toFixed(2)} TON`;
}

/**
 * Convert service key to full API endpoint URL.
 * "sequencer_health" + "https://sentinai-a.example.com"
 *   → "https://sentinai-a.example.com/api/agent-marketplace/sequencer-health"
 */
export function serviceKeyToEndpoint(key: string, baseUrl: string): string {
  const slug = key.replace(/_/g, '-');
  return `${baseUrl}/api/agent-marketplace/${slug}`;
}

/** Format network identifier to human-readable string */
export function formatNetworkName(network: string): string {
  const names: Record<string, string> = {
    'eip155:1': 'eip155:1 (Ethereum)',
    'eip155:11155111': 'eip155:11155111 (Sepolia)',
  };
  return names[network] ?? network;
}

/**
 * Returns the service catalog with the operator's baseUrl injected at call time.
 * baseUrl comes from NEXT_PUBLIC_OPERATOR_API_URL (set per deployment),
 * or falls back to localhost for local dev.
 * Each operator running their own SentinAI will have a different baseUrl.
 */
export function getServiceCatalog(): AgentMarketplaceCatalog {
  const baseUrl =
    process.env.NEXT_PUBLIC_OPERATOR_API_URL?.replace(/\/$/, '') ??
    'http://localhost:3002';
  return {
    ...SERVICE_CATALOG_BASE,
    agent: { ...SERVICE_CATALOG_BASE.agent, baseUrl },
  } as AgentMarketplaceCatalog;
}

/** Returns the service catalog as a manifest (alias for getServiceCatalog, kept for route compatibility) */
export function getManifestCatalog(): AgentMarketplaceCatalog {
  return getServiceCatalog();
}

/** Verify that a payment header exists (kept for mock API route compatibility) */
export function verifyPaymentHeader(header: string | undefined): boolean {
  return header !== undefined && header.length > 0;
}

// ─── Legacy Types (kept for mock API route compatibility) ─────────────────────

export interface SequencerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  syncLag: number;
  uptime: number;
  lastUpdate: string;
}

export interface IncidentSummary {
  activeIncidents: number;
  resolvedToday: number;
  avgResolutionTime: number;
  lastIncident: string | null;
}

export interface BatchSubmissionStatus {
  pendingBatches: number;
  submittedToday: number;
  avgSubmissionTime: number;
  lastSubmission: string | null;
}

// ─── Mock Data for Premium Endpoints ──────────────────────────────────────────

export function getSequencerHealth(): SequencerHealth {
  return {
    status: 'healthy',
    latency: 1250,
    syncLag: 2,
    uptime: 99.97,
    lastUpdate: new Date().toISOString(),
  };
}

export function getIncidentSummary(): IncidentSummary {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return {
    activeIncidents: 0,
    resolvedToday: 2,
    avgResolutionTime: 12.5,
    lastIncident: yesterday.toISOString(),
  };
}

export function getBatchSubmissionStatus(): BatchSubmissionStatus {
  const lastSubmissionTime = new Date();
  lastSubmissionTime.setHours(lastSubmissionTime.getHours() - 2);
  return {
    pendingBatches: 3,
    submittedToday: 18,
    avgSubmissionTime: 2.1,
    lastSubmission: lastSubmissionTime.toISOString(),
  };
}
