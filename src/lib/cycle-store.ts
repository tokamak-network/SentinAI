/**
 * Cycle Store — V2 agent cycle data access
 *
 * V2 (agent-orchestrator): event-driven parallel agents, synthesized via v2-cycle-adapter
 */

import { getV2LastCycle, getV2CycleHistory, getV2CycleCount } from '@/core/compat/v2-cycle-adapter';
import type { AgentCycleResult } from '@/types/agent-cycle';

export type { AgentCycleResult };

export async function getLastCycle(): Promise<AgentCycleResult | null> {
  return getV2LastCycle();
}

export async function getCycleHistory(limit?: number): Promise<AgentCycleResult[]> {
  return getV2CycleHistory(limit);
}

export async function getCycleCount(): Promise<number> {
  return getV2CycleCount();
}
