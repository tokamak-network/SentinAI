import type { Playbook } from '@/types/remediation';

export const ZKL2_GENERIC_PLAYBOOKS: Playbook[] = [
  {
    name: 'zkl2-sequencer-resource-pressure',
    description: 'zk-sequencer high CPU or memory pressure',
    trigger: {
      component: 'zk-sequencer',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
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
      },
    ],
    maxAttempts: 1,
  },
  {
    name: 'zkl2-settlement-lag',
    description: 'batch settlement lag on parent-chain path',
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
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'zk-batcher',
      },
    ],
    maxAttempts: 0,
  },
];
