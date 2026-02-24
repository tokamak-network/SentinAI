/**
 * Arbitrum Orbit Chain - Remediation Playbooks
 */

import type { Playbook } from '@/types/remediation';

export const ARBITRUM_PLAYBOOKS: Playbook[] = [
  // Playbook 1: nitro-node Resource Exhaustion
  {
    name: 'nitro-resource-exhaustion',
    description: 'nitro-node OOM or high CPU — 0.25s block rate amplifies resource pressure',
    trigger: {
      component: 'nitro-node',
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
        target: 'nitro-node',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'nitro-node',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'nitro-node',
      },
    ],
    maxAttempts: 2,
  },

  // Playbook 2: Sequencer Stall (L2 blocks plateau)
  {
    name: 'sequencer-stall',
    description: 'nitro-node L2 block production stopped',
    trigger: {
      component: 'nitro-node',
      indicators: [
        { type: 'metric', condition: 'l2BlockHeight stagnant' },
        { type: 'log_pattern', condition: 'sequencer stall|inbox derivation|reset' },
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
        target: 'nitro-node',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'nitro-node',
        waitAfterMs: 60000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'nitro-node',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 3: Batch Poster Backlog
  {
    name: 'batch-poster-backlog',
    description: 'batch-poster falling behind — SequencerInbox lag growing',
    trigger: {
      component: 'batch-poster',
      indicators: [
        { type: 'metric', condition: 'txPoolPending monotonic increase' },
        { type: 'log_pattern', condition: 'failed to post batch|insufficient funds|blob fee' },
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
        target: 'batch-poster',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'batch-poster',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 4: Validator Assertion Failure
  {
    name: 'validator-assertion-failure',
    description: 'validator RBlock submission rejected or fraud proof challenge',
    trigger: {
      component: 'validator',
      indicators: [
        { type: 'log_pattern', condition: 'assertion failed|challenge opened|validator stall' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'validator',
        params: { lines: 500 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'critical', message: 'Validator assertion failure detected. Manual review required — security risk.' },
      },
    ],
    maxAttempts: 0, // Alert only — requires operator review
  },

  // Playbook 5: L1 Connectivity Failure
  {
    name: 'l1-connectivity',
    description: 'L1 RPC connection issues affecting all Arbitrum components',
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
        target: 'nitro-node',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'batch-poster',
      },
    ],
    maxAttempts: 0, // Immediate escalation
  },

  // Playbook 6: Batch Poster EOA Balance Critical
  {
    name: 'batch-poster-balance',
    description: 'Batch Poster EOA balance below critical threshold — auto-refill',
    trigger: {
      component: 'batch-poster',
      indicators: [
        { type: 'metric', condition: 'batchPosterBalance < critical' },
      ],
    },
    actions: [
      { type: 'check_treasury_balance', safetyLevel: 'safe' },
      { type: 'check_l1_gas_price', safetyLevel: 'safe' },
      {
        type: 'refill_eoa',
        safetyLevel: 'guarded',
        params: { role: 'batcher' },
        waitAfterMs: 30000,
      },
      { type: 'verify_balance_restored', safetyLevel: 'safe', params: { role: 'batcher' } },
    ],
    fallback: [
      { type: 'escalate_operator', safetyLevel: 'safe', params: { message: 'Batch Poster EOA refill failed. Manual intervention required.' } },
    ],
    maxAttempts: 1,
  },

  // Playbook 7: Validator EOA Balance Critical
  {
    name: 'validator-balance',
    description: 'Validator EOA balance below critical threshold — auto-refill',
    trigger: {
      component: 'validator',
      indicators: [
        { type: 'metric', condition: 'validatorBalance < critical' },
      ],
    },
    actions: [
      { type: 'check_treasury_balance', safetyLevel: 'safe' },
      { type: 'check_l1_gas_price', safetyLevel: 'safe' },
      {
        type: 'refill_eoa',
        safetyLevel: 'guarded',
        params: { role: 'validator' },
        waitAfterMs: 30000,
      },
      { type: 'verify_balance_restored', safetyLevel: 'safe', params: { role: 'validator' } },
    ],
    fallback: [
      { type: 'escalate_operator', safetyLevel: 'safe', params: { message: 'Validator EOA refill failed. Cannot post RBlocks — security risk!' } },
    ],
    maxAttempts: 1,
  },

  // Playbook 8: General Resource Pressure
  {
    name: 'general-resource-pressure',
    description: 'System-wide resource constraints on Arbitrum Orbit node',
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
        target: 'nitro-node',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'zero_downtime_swap',
        safetyLevel: 'guarded',
        target: 'nitro-node',
      },
    ],
    maxAttempts: 1,
  },
];
