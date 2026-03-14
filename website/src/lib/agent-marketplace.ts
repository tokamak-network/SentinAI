/**
 * Agent Marketplace - Shared data and helpers for public marketplace
 * This is a lightweight, self-contained marketplace implementation for the website
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description: string;
  tier: 'trainee' | 'junior' | 'senior' | 'expert';
  priceUSDCents: number;
  image?: string;
  enabled: boolean;
}

export interface AgentManifest {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  documentation: string;
  pricing: {
    tier: string;
    priceUSDCents: number;
  };
}

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

// ─── Static Catalog ───────────────────────────────────────────────────────────

export const AGENT_CATALOG: Agent[] = [
  {
    id: 'anomaly-detector',
    name: 'Anomaly Detector',
    description: 'Real-time detection of L2 operational anomalies using Z-Score + AI analysis',
    tier: 'junior',
    priceUSDCents: 19900,
    enabled: true,
  },
  {
    id: 'rca-engine',
    name: 'RCA Engine',
    description: 'Root cause analysis with fault propagation tracing and context extraction',
    tier: 'senior',
    priceUSDCents: 49900,
    enabled: true,
  },
  {
    id: 'cost-optimizer',
    name: 'Cost Optimizer',
    description: 'Intelligent cost analysis and optimization recommendations for L2 operations',
    tier: 'senior',
    priceUSDCents: 49900,
    enabled: true,
  },
  {
    id: 'predictive-scaler',
    name: 'Predictive Scaler',
    description: 'Forecasts L2 demand and auto-scales infrastructure with zero downtime',
    tier: 'expert',
    priceUSDCents: 79900,
    enabled: true,
  },
  {
    id: 'nlops-chat',
    name: 'NLOps Chat',
    description: '9-tool conversational interface for log analysis, RCA, scaling, and cost optimization',
    tier: 'expert',
    priceUSDCents: 79900,
    enabled: true,
  },
];

// ─── Pricing ──────────────────────────────────────────────────────────────────

export const PRICING_TIERS = {
  trainee: 0,
  junior: 19900,
  senior: 49900,
  expert: 79900,
};

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(2)}`;
}

export function getPriceDisplay(cents: number): string {
  if (cents === 0) return 'Free';
  return formatPrice(cents);
}

// ─── Catalog Helpers ──────────────────────────────────────────────────────────

export function getAgentCatalog(): Agent[] {
  return AGENT_CATALOG.filter(agent => agent.enabled);
}

export function getAgentById(id: string): Agent | null {
  return AGENT_CATALOG.find(agent => agent.id === id) || null;
}

export function getAgentsByTier(tier: Agent['tier']): Agent[] {
  return AGENT_CATALOG.filter(agent => agent.tier === tier && agent.enabled);
}

// ─── Manifest Projection ──────────────────────────────────────────────────────

export function agentToManifest(agent: Agent): AgentManifest {
  return {
    id: agent.id,
    name: agent.name,
    version: '1.0.0',
    capabilities: getCapabilities(agent.id),
    documentation: `https://docs.sentinai.io/agents/${agent.id}`,
    pricing: {
      tier: agent.tier,
      priceUSDCents: agent.priceUSDCents,
    },
  };
}

export function getManifestCatalog(): AgentManifest[] {
  return getAgentCatalog().map(agentToManifest);
}

function getCapabilities(agentId: string): string[] {
  const capabilityMap: Record<string, string[]> = {
    'anomaly-detector': [
      'real-time monitoring',
      'statistical analysis',
      'ai-powered detection',
      'alert generation',
    ],
    'rca-engine': [
      'root cause analysis',
      'fault propagation',
      'context extraction',
      'incident correlation',
    ],
    'cost-optimizer': [
      'cost analysis',
      'usage tracking',
      'recommendations',
      'savings forecasting',
    ],
    'predictive-scaler': [
      'demand forecasting',
      'auto-scaling',
      'zero-downtime',
      'policy-based execution',
    ],
    'nlops-chat': [
      'conversational interface',
      'log analysis',
      'rca support',
      'scaling commands',
      'cost insights',
    ],
  };

  return capabilityMap[agentId] || [];
}

// ─── Payment Verification ─────────────────────────────────────────────────────

export function requiresPayment(agent: Agent): boolean {
  return agent.priceUSDCents > 0;
}

export function verifyPaymentHeader(header: string | undefined): boolean {
  return header !== undefined && header.length > 0;
}

// ─── Mock Data for Premium Endpoints ──────────────────────────────────────────

export function getSequencerHealth(): SequencerHealth {
  const now = new Date();
  return {
    status: 'healthy',
    latency: 1250,
    syncLag: 2,
    uptime: 99.97,
    lastUpdate: now.toISOString(),
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
