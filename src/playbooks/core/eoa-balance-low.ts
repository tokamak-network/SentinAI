/**
 * Core Playbook: EOA Balance Low Recovery
 *
 * Monitors EOA account balances (batcher, proposer, etc). When balance falls
 * below threshold, alerts operations to top up the account.
 *
 * In future versions, could integrate auto-refill mechanisms.
 *
 * Applicable to: All L2 chains
 */

import type { AbstractPlaybook } from '../types'

export const eoaBalanceLow: AbstractPlaybook = {
  id: 'core-eoa-balance-low',
  name: 'EOA Balance Low Alert',
  description: 'Critical EOA balance low — alert ops for manual top-up',
  source: 'hardcoded',

  applicableNodeLayers: ['l2'],

  requiredRoles: ['tx-submitter', 'state-root-poster'],

  conditions: [
    {
      metric: 'batcherBalance',
      op: 'lt',
      threshold: 0.5, // 0.5 ETH in wei (raw threshold in wei would be much larger in practice)
    },
  ],

  actions: [
    {
      type: 'escalate_operator',
      safetyLevel: 'safe',
      targetRole: 'tx-submitter',
    },
  ],

  fallback: [],

  maxAttempts: 1,
}
