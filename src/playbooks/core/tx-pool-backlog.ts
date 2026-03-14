/**
 * Core Playbook: TX Pool Backlog Recovery
 *
 * Responds to mempool congestion (monotonic increase in pending TX count)
 * by increasing throughput: scale batcher, then verify reduction in backlog.
 *
 * Applicable to: All L2 chains
 */

import type { AbstractPlaybook } from '../types'

export const txPoolBacklog: AbstractPlaybook = {
  id: 'core-tx-pool-backlog',
  name: 'TX Pool Backlog Recovery',
  description: 'Mempool backlog — scale tx-submitter then verify throughput improvement',
  source: 'hardcoded',

  applicableNodeLayers: ['l2'],

  requiredRoles: ['tx-submitter'],

  conditions: [
    {
      metric: 'txPoolPending',
      op: 'gt',
      threshold: 1000,
    },
    {
      metric: 'txPoolPending',
      op: 'z_score_gt',
      threshold: 2.5,
    },
  ],

  actions: [
    {
      type: 'scale_up',
      safetyLevel: 'guarded',
      targetRole: 'tx-submitter',
      params: { targetVcpu: 'next_tier' },
    },
    {
      type: 'health_check',
      safetyLevel: 'safe',
      targetRole: 'tx-submitter',
      waitAfterMs: 30000,
    },
  ],

  fallback: [
    {
      type: 'restart_pod',
      safetyLevel: 'guarded',
      targetRole: 'tx-submitter',
    },
  ],

  maxAttempts: 2,
}
