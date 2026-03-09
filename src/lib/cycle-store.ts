/**
 * Cycle Store — unified cycle data access for V1 and V2 agent systems.
 *
 * V1 (agent-loop.ts): serial 60s cron cycle, stores AgentCycleResult in Redis/InMemory
 * V2 (agent-orchestrator): event-driven parallel agents, synthesized via v2-cycle-adapter
 *
 * All callers should import from here instead of @/lib/agent-loop directly.
 * When agent-loop.ts is eventually removed, only this file needs to change.
 */

import { isAgentV2Enabled } from '@/core/agent-orchestrator';
import { getV2LastCycle, getV2CycleHistory, getV2CycleCount } from '@/core/compat/v2-cycle-adapter';
import type { AgentCycleResult } from '@/types/agent-cycle';

export type { AgentCycleResult };

export async function getLastCycle(): Promise<AgentCycleResult | null> {
  if (isAgentV2Enabled()) return getV2LastCycle();
  const { getLastCycleResult } = await import('@/lib/agent-loop');
  return getLastCycleResult();
}

export async function getCycleHistory(limit?: number): Promise<AgentCycleResult[]> {
  if (isAgentV2Enabled()) return getV2CycleHistory(limit);
  const { getAgentCycleHistory } = await import('@/lib/agent-loop');
  return getAgentCycleHistory(limit);
}

export async function getCycleCount(): Promise<number> {
  if (isAgentV2Enabled()) return getV2CycleCount();
  const { getAgentCycleCount } = await import('@/lib/agent-loop');
  return getAgentCycleCount();
}
