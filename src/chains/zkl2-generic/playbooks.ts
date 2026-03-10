/**
 * ZK L2 Generic Chain - Remediation Playbooks
 */

import type { Playbook } from '@/types/remediation';
import { L1_PLAYBOOKS } from '@/chains/shared/l1-playbooks';

export const ZKL2_GENERIC_PLAYBOOKS: Playbook[] = [
  {
    name: 'zkl2-sequencer-resource-pressure',
    description: 'zk-sequencer high CPU or memory pressure',
    trigger: {
      component: 'zk-sequencer',
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
        target: 'zk-sequencer',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zk-sequencer',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'zk-sequencer',
      },
    ],
    maxAttempts: 2,
  },

  {
    name: 'zkl2-settlement-lag',
    description: 'Batch settlement lag on parent-chain path — diagnose then restart batcher',
    trigger: {
      component: 'zk-batcher',
      indicators: [
        { type: 'metric', condition: 'settlementLag high' },
        { type: 'log_pattern', condition: 'batch submit failed|timeout' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'check_l1_gas_price',
        safetyLevel: 'safe',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'zk-batcher',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'zk-batcher',
        waitAfterMs: 30000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zk-batcher',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'ZK batcher restart failed to resolve settlement lag. Manual diagnosis required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  {
    name: 'zkl2-proof-backlog',
    description: 'Proof queue depth growing — scale up prover',
    trigger: {
      component: 'zk-prover',
      indicators: [
        { type: 'metric', condition: 'proofQueueDepth increasing' },
        { type: 'metric', condition: 'cpuUsage > 80' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'zk-prover',
      },
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'zk-prover',
        params: { targetVcpu: 'next_tier' },
        waitAfterMs: 15000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zk-prover',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'Proof queue backlog persists after scale-up. Manual investigation required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // L1 Playbooks (shared)
  ...L1_PLAYBOOKS,
];
