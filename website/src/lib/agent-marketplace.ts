// website/src/lib/agent-marketplace.ts

import { type ReactNode } from 'react';

// ─── Configuration ────────────────────────────────────────────────────────────

export const ROOT_APP_URL = process.env.NEXT_PUBLIC_ROOT_APP_URL
  ?? process.env.ROOT_APP_URL
  ?? 'http://localhost:3002';

// ─── Types (mirror root app types) ────────────────────────────────────────────

export interface ServicePrice {
  network: string;
  asset: string;
  amount: string;
  scheme: 'exact' | 'minimum';
}

export interface Catalog {
  services: Array<{
    key: string;
    displayName: string;
    description: string;
    payment: ServicePrice;
  }>;
  payment: {
    protocol: string;
    network: string;
    asset: string;
  };
}

export interface AgentManifest {
  endpoint: string;
  version: string;
  payment: {
    protocol: string;
    network: string;
    asset: string;
  };
  capabilities: string[];
}

export interface RegistryRow {
  agent: string;
  agentId: string;
  agentUri: string;
  manifest?: {
    name: string;
    version: string;
    paymentNetwork: string;
    capabilities: string[];
    endpoint: string;
  };
  manifestStatus: 'ok' | 'error';
}

// ─── Root App Communication ───────────────────────────────────────────────────

export async function fetchFromRootApp<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  try {
    const url = new URL(path, ROOT_APP_URL).toString();
    const res = await fetch(url, {
      ...init,
      next: { revalidate: 60 }, // ISR: revalidate every 60s
    });
    if (!res.ok) {
      throw new Error(`Root app error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    console.error('[agent-marketplace] fetch error:', error);
    throw error; // Let API route handle retry/fallback
  }
}

// ─── Public Helpers (used by page.tsx) ────────────────────────────────────────

export const websiteAgentMarketplaceCatalog: Catalog = {
  services: [
    {
      key: 'sequencer_health',
      displayName: 'Sequencer Health',
      description: 'Real-time sequencer availability and performance monitoring',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '1000000000', // 1 TON in nano
        scheme: 'exact',
      },
    },
    {
      key: 'incident_summary',
      displayName: 'Incident Summary',
      description: 'Aggregated incident reports with root cause analysis',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '2000000000', // 2 TON
        scheme: 'exact',
      },
    },
    {
      key: 'batch_submission_status',
      displayName: 'Batch Submission Status',
      description: 'Batch processing metrics and submission queue health',
      payment: {
        network: 'ton',
        asset: 'TON',
        amount: '500000000', // 0.5 TON
        scheme: 'exact',
      },
    },
  ],
  payment: {
    protocol: 'x402',
    network: 'ton',
    asset: 'TON',
  },
};

export type MarketplaceTab = 'instance' | 'registry' | 'guide' | 'sandbox';

export function resolveMarketplaceTab(value: string | undefined): MarketplaceTab {
  if (value === 'instance' || value === 'guide' || value === 'sandbox') {
    return value;
  }
  return 'registry';
}

export function formatTonAmount(amount: string | null | undefined): string {
  if (!amount || !/^\d+$/.test(amount)) {
    return 'N/A';
  }
  const normalized = amount.padStart(19, '0');
  const whole = normalized.slice(0, -18).replace(/^0+/, '') || '0';
  const fraction = normalized.slice(-18).slice(0, 2).replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} TON`;
}

export function toWebsiteAgentMarketplaceManifest(): AgentManifest {
  return {
    endpoint: '/api/agent-marketplace/catalog',
    version: '1.0.0',
    payment: websiteAgentMarketplaceCatalog.payment,
    capabilities: websiteAgentMarketplaceCatalog.services.map(s => s.key),
  };
}

export function toServiceRoutePath(serviceKey: string): string {
  return `/api/agent-marketplace/${serviceKey.replace(/_/g, '-')}`;
}

export function getWebsiteAgentMarketplaceRegistryRows(): RegistryRow[] {
  // Static registry for now. In future, fetch from root app.
  return [
    {
      agent: 'SentinAI',
      agentId: '0x01',
      agentUri: 'sentinai://agent/v1',
      manifest: {
        name: 'SentinAI Marketplace Agent',
        version: '1.0.0',
        paymentNetwork: 'ton',
        capabilities: websiteAgentMarketplaceCatalog.services.map(s => s.key),
        endpoint: '/api/agent-marketplace/agent.json',
      },
      manifestStatus: 'ok',
    },
  ];
}
