/**
 * ZK Stack Chain - Remediation Playbooks
 */

import type { Playbook } from '@/types/remediation';
import { L1_PLAYBOOKS } from '@/chains/shared/l1-playbooks';

export const ZKSTACK_PLAYBOOKS: Playbook[] = [
  // ────────────────────────────────────────────────────────────
  // ZK-01: zksync-server Resource Pressure
  // ────────────────────────────────────────────────────────────
  {
    name: 'zksync-server-resource-pressure',
    description: 'zksync-server high CPU or memory pressure',
    trigger: {
      component: 'zksync-server',
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
        target: 'zksync-server',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zksync-server',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'zksync-server',
      },
    ],
    maxAttempts: 2,
  },

  // ────────────────────────────────────────────────────────────
  // ZK-02: Batch Settlement Lag
  // Handles: zk-batcher falling behind L1 due to RPC issues or gas spike
  // ────────────────────────────────────────────────────────────
  {
    name: 'zk-settlement-lag',
    description: 'ZK batch settlement lag on L1 — diagnose then restart batcher',
    trigger: {
      component: 'zk-batcher',
      indicators: [
        { type: 'metric', condition: 'settlementLag high' },
        { type: 'log_pattern', condition: 'batch submit failed|timeout|nonce' },
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
        // Restart clears nonce conflicts and reconnects to L1
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

  // ────────────────────────────────────────────────────────────
  // ZK-03: Proof Queue Backlog
  // Handles: prover capacity bottleneck causing queue depth to grow
  // ────────────────────────────────────────────────────────────
  {
    name: 'zk-proof-backlog',
    description: 'Proof queue depth growing — prover capacity bottleneck',
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
        // Scale up prover to handle queue backlog
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
          message: 'Proof queue backlog persists after scale-up. Check prover capacity and circuit complexity.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ────────────────────────────────────────────────────────────
  // ZK-04: Prover Resource Exhaustion
  // Handles: ZK proof computation is memory-heavy — OOM is common
  // ────────────────────────────────────────────────────────────
  {
    name: 'zk-prover-resource-exhaustion',
    description: 'zk-prover OOM or sustained high CPU — ZK proof computation overhead',
    trigger: {
      component: 'zk-prover',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 95' },
        { type: 'metric', condition: 'memoryPercent > 90' },
        { type: 'log_pattern', condition: 'out of memory|OOM killed|prover panic' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'zk-prover',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'zk-prover',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'zk-prover',
      },
    ],
    maxAttempts: 2,
  },

  // ────────────────────────────────────────────────────────────
  // ZK-05: ZK Batcher EOA Balance Critical — Auto-Refill
  // ────────────────────────────────────────────────────────────
  {
    name: 'zk-batcher-balance-critical',
    description: 'ZK batcher EOA balance below critical threshold — auto-refill',
    trigger: {
      component: 'zk-batcher',
      indicators: [
        { type: 'metric', condition: 'batcherBalance < critical' },
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
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'critical',
          message: 'ZK batcher EOA refill failed. Batch submission will halt. Manual intervention required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ────────────────────────────────────────────────────────────
  // ZK-06: General Resource Pressure
  // ────────────────────────────────────────────────────────────
  {
    name: 'zk-general-resource-pressure',
    description: 'System-wide resource pressure on ZK Stack node',
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
        target: 'zksync-server',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'zero_downtime_swap',
        safetyLevel: 'guarded',
        target: 'zksync-server',
      },
    ],
    maxAttempts: 1,
  },

  // L1 Playbooks (shared)
  ...L1_PLAYBOOKS,
];
