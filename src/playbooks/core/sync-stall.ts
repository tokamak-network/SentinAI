/**
 * Core Playbook: Sync Stall Recovery
 *
 * Detects block production stall (plateau in l2BlockHeight) by analyzing
 * L2 block height trend. Triggers restart of sync node or block producer.
 *
 * Applicable to: All L2 chains
 */

import type { AbstractPlaybook } from '../types'

export const syncStall: AbstractPlaybook = {
  id: 'core-sync-stall',
  name: 'Sync Stall Recovery',
  description: 'L2 block production halted — restart sync-node then verify recovery',
  source: 'hardcoded',

  applicableNodeLayers: ['l2'],

  requiredRoles: ['sync-node'],

  conditions: [
    {
      metric: 'l2BlockHeight',
      op: 'rule',
      rule: 'plateau',
    },
  ],

  actions: [
    {
      type: 'restart_pod',
      safetyLevel: 'guarded',
      targetRole: 'sync-node',
    },
    {
      type: 'health_check',
      safetyLevel: 'safe',
      targetRole: 'sync-node',
      waitAfterMs: 45000,
    },
  ],

  fallback: [
    {
      type: 'scale_up',
      safetyLevel: 'guarded',
      targetRole: 'sync-node',
      params: { targetVcpu: 'next_tier' },
    },
  ],

  maxAttempts: 1,
}
