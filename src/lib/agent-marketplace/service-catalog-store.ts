/**
 * Agent Marketplace Service Catalog Store
 *
 * Allows runtime overrides of service price and state via Redis.
 * Falls back to the hardcoded defaults in catalog.ts when Redis is unavailable.
 */

import { getCoreRedis } from '@/core/redis';
import type { AgentMarketplaceServiceKey } from '@/types/agent-marketplace';

export interface ServiceOverride {
  amount?: string;   // TON wei string
  state?: 'active' | 'planned';
}

function getOverrideKey(serviceKey: AgentMarketplaceServiceKey): string {
  return `sentinai:agent-marketplace:service-override:${serviceKey}`;
}

export async function getServiceOverride(
  serviceKey: AgentMarketplaceServiceKey
): Promise<ServiceOverride | null> {
  const redis = getCoreRedis();
  if (!redis) return null;
  const raw = await redis.get(getOverrideKey(serviceKey));
  return raw ? (JSON.parse(raw) as ServiceOverride) : null;
}

export async function setServiceOverride(
  serviceKey: AgentMarketplaceServiceKey,
  override: ServiceOverride
): Promise<void> {
  const redis = getCoreRedis();
  if (!redis) throw new Error('Redis is required to persist service overrides');
  await redis.set(getOverrideKey(serviceKey), JSON.stringify(override));
}

export async function getAllServiceOverrides(): Promise<
  Partial<Record<AgentMarketplaceServiceKey, ServiceOverride>>
> {
  const redis = getCoreRedis();
  if (!redis) return {};

  const keys: AgentMarketplaceServiceKey[] = [
    'sequencer_health',
    'incident_summary',
    'batch_submission_status',
  ];

  const raws = await redis.mget(...keys.map(getOverrideKey));
  const result: Partial<Record<AgentMarketplaceServiceKey, ServiceOverride>> = {};
  keys.forEach((key, i) => {
    const raw = raws[i];
    if (raw) result[key] = JSON.parse(raw) as ServiceOverride;
  });
  return result;
}
