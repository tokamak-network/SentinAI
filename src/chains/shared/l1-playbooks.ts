/**
 * Shared L1 Playbooks
 * Common remediation playbooks for L1 client failures (Geth, Reth, Nethermind, Besu).
 * These are included in every chain plugin's playbook list since L1 is a universal dependency.
 *
 * Playbook map:
 *   l1-rpc-failover          RPC endpoint unresponsive → auto-switch to next endpoint
 *   l1-sync-stall            L1 block production stopped (self-hosted) → restart pod
 *   l1-peer-isolation        Peer count drops to 0 → diagnose + escalate
 *   l1-high-gas              Gas price exceeds safe threshold → alert operator
 */

import type { Playbook } from '@/types/remediation';

export const L1_PLAYBOOKS: Playbook[] = [
  // ────────────────────────────────────────────────────────────
  // L1-01: RPC Endpoint Unresponsive → Auto-Failover
  // Handles: rate-limit hits, node crash, network partition on public RPC
  // ────────────────────────────────────────────────────────────
  {
    name: 'l1-rpc-failover',
    description: 'L1 RPC endpoint unresponsive — auto-switch to next healthy endpoint',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'l1BlockNumber stagnant' },
        { type: 'log_pattern', condition: 'connection refused|timeout|ECONNRESET|rate limit' },
      ],
    },
    actions: [
      {
        // Step 1: Confirm failure before acting
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        // Step 2: Switch to next endpoint in L1_RPC_URLS rotation
        type: 'switch_l1_rpc',
        safetyLevel: 'guarded',
        params: { reason: 'auto-remediation: l1-rpc-failover playbook' },
        waitAfterMs: 5000,
      },
      {
        // Step 3: Verify the new endpoint is responsive
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'critical',
          message: 'All L1 RPC endpoints are unresponsive. L2 block derivation will halt. Manual intervention required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ────────────────────────────────────────────────────────────
  // L1-02: Self-Hosted L1 Sync Stall
  // Handles: Geth/Reth stuck on a fork, DB corruption, disk I/O saturation
  // Only applies when L1 node is K8s-managed (self-hosted).
  // ────────────────────────────────────────────────────────────
  {
    name: 'l1-sync-stall',
    description: 'Self-hosted L1 node has stopped syncing — collect diagnostics then restart',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'l1BlockNumber stagnant' },
        { type: 'log_pattern', condition: 'snap sync|state heal|database|corrupt|panic' },
      ],
    },
    actions: [
      {
        // Step 1: Gather current state before touching the pod
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1',
        params: { lines: 200 },
      },
      {
        type: 'describe_pod',
        safetyLevel: 'safe',
        target: 'l1',
      },
      {
        // Step 2: Graceful restart (StatefulSet recreates, chain data preserved)
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'l1',
        waitAfterMs: 60000, // Allow 60s for re-sync startup
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'l1',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'critical',
          message: 'L1 node restart failed or health check did not recover. Manual diagnosis required (possible DB corruption).',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ────────────────────────────────────────────────────────────
  // L1-03: Peer Isolation (0 Peers)
  // Handles: firewall change, P2P port closed, bootnodes unreachable
  // Cannot be auto-resolved — safe to diagnose, unsafe to auto-fix networking
  // ────────────────────────────────────────────────────────────
  {
    name: 'l1-peer-isolation',
    description: 'L1 node has 0 peers — network partition or P2P configuration issue',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'peerCount == 0' },
        { type: 'log_pattern', condition: 'no peers|peer dropped|dial failed|discovery' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1',
        params: { lines: 100 },
      },
      {
        type: 'describe_pod',
        safetyLevel: 'safe',
        target: 'l1',
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'L1 peer count dropped to 0. Check firewall rules, P2P port (30303), and bootnode connectivity.',
        },
      },
    ],
    maxAttempts: 0, // Diagnosis + alert only — P2P recovery requires network config changes
  },

  // ────────────────────────────────────────────────────────────
  // L1-04: High Gas Price Alert
  // Handles: gas spike that will cause batcher/proposer underpayment
  // Alert-only: gas is market-driven, cannot be auto-fixed
  // ────────────────────────────────────────────────────────────
  {
    name: 'l1-high-gas',
    description: 'L1 gas price exceeds safe threshold — batcher and proposer transactions at risk',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'gasPrice > guardGwei' },
      ],
    },
    actions: [
      {
        type: 'check_l1_gas_price',
        safetyLevel: 'safe',
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'medium',
          message: 'L1 gas price exceeds EOA_GAS_GUARD_GWEI threshold. Batcher/proposer transactions may fail or drain EOA faster than expected.',
        },
      },
    ],
    maxAttempts: 0, // Alert only
  },
];
