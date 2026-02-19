/**
 * Thanos Chain - Remediation Playbooks
 * Extracted from playbook-matcher.ts:13-230
 */

import type { Playbook } from '@/types/remediation';

export const THANOS_PLAYBOOKS: Playbook[] = [
  // Playbook 1: op-geth Resource Exhaustion
  {
    name: 'op-geth-resource-exhaustion',
    description: 'op-geth OOM or high CPU usage',
    trigger: {
      component: 'op-geth',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
        { type: 'log_pattern', condition: 'out of memory|OOM killed' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'op-geth',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'op-geth',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-geth',
      },
    ],
    maxAttempts: 2,
  },

  // Playbook 2: op-node Derivation Stall
  {
    name: 'op-node-derivation-stall',
    description: 'op-node derivation pipeline stagnation',
    trigger: {
      component: 'op-node',
      indicators: [
        { type: 'metric', condition: 'l2BlockHeight stagnant' },
        { type: 'log_pattern', condition: 'derivation pipeline|reset' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-node',
        waitAfterMs: 60000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'op-node',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 3: op-batcher Backlog
  {
    name: 'op-batcher-backlog',
    description: 'op-batcher transaction submission failures',
    trigger: {
      component: 'op-batcher',
      indicators: [
        { type: 'metric', condition: 'txPoolPending monotonic increase' },
        { type: 'log_pattern', condition: 'failed to submit|insufficient funds' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-batcher',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-batcher',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 4: General Resource Pressure
  {
    name: 'general-resource-pressure',
    description: 'System-wide resource constraints',
    trigger: {
      component: 'system',
      indicators: [
        { type: 'metric', condition: 'hybridScore >= 70' },
        { type: 'metric', condition: 'cpuUsage > 80' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'op-geth',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'zero_downtime_swap',
        safetyLevel: 'guarded',
        target: 'op-geth',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 5: L1 Connectivity Failure
  {
    name: 'l1-connectivity-failure',
    description: 'L1 RPC connection issues',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'l1BlockNumber stagnant' },
        { type: 'log_pattern', condition: 'connection refused|timeout|ECONNRESET' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-node',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-batcher',
      },
    ],
    maxAttempts: 0, // Immediate escalation — L1 issues cannot be auto-resolved
  },

  // Playbook 6: EOA Balance Critical — Auto-refill
  {
    name: 'eoa-balance-critical',
    description: 'Batcher or proposer EOA balance below critical threshold',
    trigger: {
      component: 'op-batcher',
      indicators: [
        { type: 'metric', condition: 'batcherBalance < critical' },
        { type: 'metric', condition: 'proposerBalance < critical' },
      ],
    },
    actions: [
      {
        type: 'check_treasury_balance',
        safetyLevel: 'safe',
      },
      {
        type: 'check_l1_gas_price',
        safetyLevel: 'safe',
      },
      {
        type: 'refill_eoa',
        safetyLevel: 'guarded',
        params: { role: 'batcher' },
        waitAfterMs: 30000,
      },
      {
        type: 'verify_balance_restored',
        safetyLevel: 'safe',
        params: { role: 'batcher' },
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { message: 'EOA refill failed. Manual intervention required.' },
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 7: EOA Balance Critical — Immediate Escalation
  {
    name: 'eoa-balance-critical',
    description: 'EOA balance critically low — immediate operator alert and auto-refill',
    trigger: {
      component: 'op-batcher',
      indicators: [
        { type: 'metric', condition: 'batcherBalance < critical' },
        { type: 'metric', condition: 'proposerBalance < critical' },
      ],
    },
    actions: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'critical', message: 'EOA balance near zero. Rollup submission will halt imminently.' },
      },
    ],
    maxAttempts: 0, // Immediate escalation
  },

  // Playbook 8: Challenger EOA Balance Low (Phase 1)
  {
    name: 'challenger-balance-low',
    description: 'Challenger EOA balance below warning threshold',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'metric', condition: 'challengerBalance < warning' },
      ],
    },
    actions: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'medium', message: 'Challenger EOA balance low. Refill recommended.' },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // Playbook 9: Challenger EOA Balance Critical (Phase 1)
  {
    name: 'challenger-balance-critical',
    description: 'Challenger EOA balance critically low — auto-refill for dispute game participation',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'metric', condition: 'challengerBalance < critical' },
      ],
    },
    actions: [
      {
        type: 'check_treasury_balance',
        safetyLevel: 'safe',
      },
      {
        type: 'check_l1_gas_price',
        safetyLevel: 'safe',
      },
      {
        type: 'refill_eoa',
        safetyLevel: 'guarded',
        params: { role: 'challenger', amount: '1.0' },
        waitAfterMs: 30000,
      },
      {
        type: 'verify_balance_restored',
        safetyLevel: 'safe',
        params: { role: 'challenger' },
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'critical', message: 'Challenger EOA refill failed. Cannot participate in dispute games — security risk!' },
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 10: op-challenger Component Failure (Phase 1)
  {
    name: 'op-challenger-failure',
    description: 'op-challenger pod crash or proof generation failure',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'log_pattern', condition: 'proof generation failed|panic|fatal error' },
        { type: 'metric', condition: 'pod restart count > 3' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-challenger',
        params: { lines: 500 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'critical', message: 'op-challenger failure detected. Dispute resolution compromised.' },
      },
    ],
    maxAttempts: 0, // Manual intervention required
  },

  // Playbook 11: Dispute Game Deadline Approaching (Phase 2)
  {
    name: 'dispute-game-deadline-near',
    description: 'Dispute game deadline approaching — requires immediate action',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'metric', condition: 'gameDeadlineProximity < 1h' },
      ],
    },
    actions: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'critical', message: 'Dispute game deadline < 1 hour. Immediate review required.' },
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-challenger',
        params: { lines: 200 },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // Playbook 12: Unclaimed Bond Alert (Phase 2)
  {
    name: 'unclaimed-bond-alert',
    description: 'Bond from resolved game not claimed after 24h',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'metric', condition: 'unclaimedBonds > 0 && unclaimedAge > 24h' },
      ],
    },
    actions: [
      {
        type: 'claim_bond',
        safetyLevel: 'guarded',
        params: { auto: true },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'medium', message: 'Auto-claiming unclaimed bonds from resolved games.' },
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'high', message: 'Bond claim failed. Manual intervention required.' },
      },
    ],
    maxAttempts: 2,
  },

  // Playbook 13: Proof Generation Timeout (Phase 2)
  {
    name: 'proof-generation-timeout',
    description: 'Fault proof generation taking too long or stalled',
    trigger: {
      component: 'op-challenger',
      indicators: [
        { type: 'metric', condition: 'proofGenerationLatency > 300s' },
        { type: 'log_pattern', condition: 'proof generation timeout|MIPS execution stalled' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-challenger',
        params: { lines: 500 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'high', message: 'Proof generation timeout. Check op-program logs and game deadline.' },
      },
    ],
    maxAttempts: 0, // Requires manual investigation
  },
];
