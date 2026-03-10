/**
 * L1 EVM Node Plugin — Remediation Playbooks
 * 5 L1-execution-specific playbooks + shared L1_PLAYBOOKS
 */

import type { Playbook } from '@/types/remediation';
import { L1_PLAYBOOKS } from '@/chains/shared/l1-playbooks';

export const L1_EVM_PLAYBOOKS: Playbook[] = [
  // ─────────────────────────────────────────────────────────
  // L1EVM-01: Node Resource Pressure
  // Handles: OOM, sustained high CPU on the L1 execution client
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-resource-pressure',
    description: 'L1 execution client OOM or sustained high CPU — scale up and health check',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
        { type: 'log_pattern', condition: 'out of memory|OOM killed|fatal error' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'l1-execution',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'l1-execution',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'l1-execution',
      },
    ],
    maxAttempts: 2,
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-02: Sync Lag Recovery
  // Handles: node fell behind chain tip after a stall or restart
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-sync-lag',
    description: 'L1 node sync gap growing — collect diagnostics then restart',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'syncGap increasing' },
        { type: 'log_pattern', condition: 'snap sync|state heal|behind by' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 200 },
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'l1-execution',
        waitAfterMs: 60000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'l1-execution',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'L1 node sync lag persists after restart. Manual investigation required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-03: Mempool Spike
  // Alert-only — mempool state is transient and self-resolving
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-mempool-spike',
    description: 'Mempool pending transaction count spiked — alert operator',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'txPoolPending > threshold' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 100 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'medium',
          message: 'L1 node mempool spike detected. Transaction pending count is unusually high.',
        },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-04: Disk Pressure
  // Cannot auto-fix disk — alert with context
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-disk-pressure',
    description: 'L1 node disk usage critical — alert operator for pruning or expansion',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'log_pattern', condition: 'no space left|disk full|ENOSPC' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 100 },
      },
      {
        type: 'describe_pod',
        safetyLevel: 'safe',
        target: 'l1-execution',
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'L1 node disk pressure detected. Chain state may be full. Pruning or volume expansion required.',
        },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-05: Chain Reorg Detected
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-chain-reorg',
    description: 'Deep chain reorganization detected — collect diagnostics and escalate',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'log_pattern', condition: 'chain reorg|reorg depth|block reorganis' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 500 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'critical',
          message: 'Deep chain reorganization detected on L1 node. Check peer connectivity and chain tip consensus.',
        },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // Shared L1 playbooks (rpc-failover, sync-stall, peer-isolation, high-gas)
  ...L1_PLAYBOOKS,
];
