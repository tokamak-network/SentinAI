import type { Playbook } from '@/types/remediation';

export const ZKSTACK_PLAYBOOKS: Playbook[] = [
  {
    name: 'zksync-server-resource-pressure',
    description: 'zksync-server high CPU or memory pressure',
    trigger: {
      component: 'zksync-server',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'zksync-server',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zksync-server',
      },
    ],
    maxAttempts: 1,
  },
  {
    name: 'zk-settlement-lag',
    description: 'batch settlement lag on L1/Gateway path',
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
  {
    name: 'zk-proof-backlog',
    description: 'proof queue growth and delayed verification',
    trigger: {
      component: 'zk-prover',
      indicators: [
        { type: 'metric', condition: 'proofQueueDepth increasing' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'zk-prover',
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: { urgency: 'high', message: 'Proof queue depth is increasing. Check prover capacity.' },
      },
    ],
    maxAttempts: 0,
  },
];
