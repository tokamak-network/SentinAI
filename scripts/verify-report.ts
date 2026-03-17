/**
 * SentinAI — Connect → .env → Playbook Verification Report
 *
 * Usage:
 *   npx tsx scripts/verify-report.ts              # Playbook validation only
 *   npx tsx scripts/verify-report.ts --check-rpc  # + live RPC connectivity checks
 *
 * Output: docs/verify-report.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ─────────────────────────────────────────────────────────────
// Playbook imports
// ─────────────────────────────────────────────────────────────
import { THANOS_PLAYBOOKS } from '@/chains/thanos/playbooks';
import { ARBITRUM_PLAYBOOKS } from '@/chains/arbitrum/playbooks';
import { ZKSTACK_PLAYBOOKS } from '@/chains/zkstack/playbooks';
import { ZKL2_GENERIC_PLAYBOOKS } from '@/chains/zkl2-generic/playbooks';
import { L1_EVM_PLAYBOOKS } from '@/chains/l1-evm/playbooks';

import type { Playbook } from '@/types/remediation';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Action types that the executor switch-case handles (auto-executed or manual-skip) */
const HANDLED_ACTION_TYPES = new Set([
  'collect_logs',
  'health_check',
  'check_l1_connection',
  'describe_pod',
  'restart_pod',
  'scale_up',
  'scale_down',
  'zero_downtime_swap',
  'check_treasury_balance',
  'check_l1_gas_price',
  'refill_eoa',
  'verify_balance_restored',
  'switch_l1_rpc',
  'escalate_operator',
  // Manual-skip (handled but return 'skipped' status)
  'config_change',
  'rollback_deployment',
  'force_restart_all',
]);

const MANUAL_ACTION_TYPES = new Set([
  'config_change',
  'rollback_deployment',
  'force_restart_all',
]);

/** Valid component sets for each plugin */
const PLUGIN_COMPONENTS: Record<string, Set<string>> = {
  thanos: new Set(['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'op-challenger', 'l1', 'system']),
  optimism: new Set(['op-geth', 'op-node', 'op-batcher', 'op-proposer', 'op-challenger', 'l1', 'system']),
  arbitrum: new Set(['nitro-node', 'batch-poster', 'validator', 'l1', 'system']),
  zkstack: new Set(['zksync-server', 'zk-batcher', 'zk-prover', 'l1', 'system']),
  'zkl2-generic': new Set(['zk-sequencer', 'zk-batcher', 'zk-prover', 'l1', 'system']),
  'l1-evm': new Set(['l1-execution', 'system']),
};

/**
 * Matchable metric conditions — mirrors the table-based parser in playbook-matcher.ts.
 * A condition is matchable if any of the supported patterns can parse it.
 */
function isMetricConditionMatchable(condition: string): boolean {
  // Compound: at least one arm matchable
  if (condition.includes('&&')) {
    return condition.split('&&').some(p => isMetricConditionMatchable(p.trim()));
  }

  const c = condition.trim();

  // hybridScore heuristic
  if (c.includes('hybridScore')) return true;

  // "metric stagnant"
  if (/^\S+\s+stagnant$/i.test(c)) return true;

  // "metric monotonic increase" / "metric increasing"
  if (/^\S+\s+(monotonic increase|increasing)$/i.test(c)) return true;

  // "metric high"
  if (/^\S+\s+high$/i.test(c)) return true;

  // "metric < level"
  if (/^\S+\s+<\s+(critical|warning|low|high)$/i.test(c)) return true;

  // "metric op time-value" (e.g. > 300s, < 1h)
  if (/^\S+\s*(>=?|<=?|==)\s*\d+(?:\.\d+)?[smhd]$/i.test(c)) return true;

  // "metric op number"
  if (/^\S+\s*(>=?|<=?|==)\s*-?\d+(?:\.\d+)?$/.test(c)) return true;

  // "metric op identifier" (named threshold)
  if (/^\S+\s*(>=?|<=?|==)\s*[a-zA-Z]\w*$/.test(c)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────
// Connect page .env simulation
// ─────────────────────────────────────────────────────────────

interface NodeTypeConfig {
  nodeType: string;
  chainType: string;
  displayName: string;
  rpcUrl: string;
  envVars: Record<string, string>;
}

const NODE_CONFIGS: NodeTypeConfig[] = [
  {
    nodeType: 'ethereum-el',
    chainType: 'l1-evm',
    displayName: 'Ethereum (L1 EVM)',
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
    envVars: {
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'l1-evm',
    },
  },
  {
    nodeType: 'opstack-l2',
    chainType: 'optimism',
    displayName: 'OP Stack L2 (Optimism)',
    rpcUrl: 'https://optimism-rpc.publicnode.com',
    envVars: {
      L2_RPC_URL: 'https://optimism-rpc.publicnode.com',
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'optimism',
    },
  },
  {
    nodeType: 'opstack-l2',
    chainType: 'thanos',
    displayName: 'Thanos L2 (Tokamak)',
    rpcUrl: 'https://rpc.titan.tokamak.network',
    envVars: {
      L2_RPC_URL: 'https://rpc.titan.tokamak.network',
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'thanos',
    },
  },
  {
    nodeType: 'arbitrum-nitro',
    chainType: 'arbitrum',
    displayName: 'Arbitrum Nitro',
    rpcUrl: 'https://arbitrum-one-rpc.publicnode.com',
    envVars: {
      L2_RPC_URL: 'https://arbitrum-one-rpc.publicnode.com',
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'arbitrum',
    },
  },
  {
    nodeType: 'zkstack',
    chainType: 'zkstack',
    displayName: 'ZK Stack (zkSync Era)',
    rpcUrl: 'https://mainnet.era.zksync.io',
    envVars: {
      L2_RPC_URL: 'https://mainnet.era.zksync.io',
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'zkstack',
    },
  },
  {
    nodeType: 'zkl2-generic',
    chainType: 'zkl2-generic',
    displayName: 'ZK L2 Generic (Scroll)',
    rpcUrl: 'https://rpc.scroll.io',
    envVars: {
      L2_RPC_URL: 'https://rpc.scroll.io',
      SENTINAI_L1_RPC_URL: 'https://ethereum-rpc.publicnode.com',
      CHAIN_TYPE: 'zkl2-generic',
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Validation types
// ─────────────────────────────────────────────────────────────

interface ActionIssue {
  playbook: string;
  actionType: string;
  reason: string;
}

interface ConditionIssue {
  playbook: string;
  condition: string;
  indicatorType: string;
}

interface ComponentIssue {
  playbook: string;
  component: string;
}

interface PluginReport {
  name: string;
  displayName: string;
  playbookCount: number;
  structureValid: number;
  componentIssues: ComponentIssue[];
  actionIssues: ActionIssue[];
  conditionIssues: ConditionIssue[];
  coverageScore: number; // 0-100
  playbooks: PlaybookDetail[];
}

interface PlaybookDetail {
  name: string;
  description: string;
  component: string;
  indicators: { type: string; condition: string; matchable: boolean }[];
  actions: { type: string; status: 'auto' | 'manual' | 'unhandled' }[];
  overallStatus: 'ok' | 'warn' | 'error';
}

interface EnvReport {
  nodeType: string;
  chainType: string;
  displayName: string;
  hasChainType: boolean;
  hasRpcUrl: boolean;
  envVars: Record<string, string>;
}

interface RpcResult {
  name: string;
  url: string;
  chainType: string;
  blockNumber?: number;
  clientVersion?: string;
  chainId?: string;
  latencyMs?: number;
  error?: string;
  ok: boolean;
}

// ─────────────────────────────────────────────────────────────
// Validation logic
// ─────────────────────────────────────────────────────────────

function validatePlugin(
  name: string,
  displayName: string,
  playbooks: Playbook[]
): PluginReport {
  const validComponents = PLUGIN_COMPONENTS[name] ?? new Set<string>();
  const componentIssues: ComponentIssue[] = [];
  const actionIssues: ActionIssue[] = [];
  const conditionIssues: ConditionIssue[] = [];
  const details: PlaybookDetail[] = [];

  let structureValid = 0;

  for (const pb of playbooks) {
    // Structure check
    const hasName = typeof pb.name === 'string' && pb.name.length > 0;
    const hasTrigger = pb.trigger && typeof pb.trigger.component === 'string';
    const hasActions = Array.isArray(pb.actions) && pb.actions.length > 0;

    if (!hasName || !hasTrigger || !hasActions) {
      continue; // skip structurally invalid
    }
    structureValid++;

    // Component check
    if (!validComponents.has(pb.trigger.component)) {
      componentIssues.push({ playbook: pb.name, component: pb.trigger.component });
    }

    // Indicators analysis
    const indicatorDetails = pb.trigger.indicators.map(ind => {
      let matchable = false;
      if (ind.type === 'metric') {
        matchable = isMetricConditionMatchable(ind.condition);
        if (!matchable) {
          conditionIssues.push({ playbook: pb.name, condition: ind.condition, indicatorType: ind.type });
        }
      } else if (ind.type === 'log_pattern') {
        // matchesLogPattern always returns false — always unmatchable
        matchable = false;
        conditionIssues.push({ playbook: pb.name, condition: ind.condition, indicatorType: ind.type });
      }
      return { type: ind.type, condition: ind.condition, matchable };
    });

    // Actions analysis
    const actionDetails = pb.actions.map(act => {
      if (MANUAL_ACTION_TYPES.has(act.type)) {
        return { type: act.type, status: 'manual' as const };
      } else if (HANDLED_ACTION_TYPES.has(act.type)) {
        return { type: act.type, status: 'auto' as const };
      } else {
        actionIssues.push({ playbook: pb.name, actionType: act.type, reason: 'No case in action-executor switch' });
        return { type: act.type, status: 'unhandled' as const };
      }
    });

    // Fallback actions
    if (pb.fallback) {
      for (const act of pb.fallback) {
        if (!HANDLED_ACTION_TYPES.has(act.type) && !MANUAL_ACTION_TYPES.has(act.type)) {
          actionIssues.push({ playbook: pb.name, actionType: act.type, reason: 'Fallback action unhandled' });
        }
      }
    }

    const hasUnhandledAction = actionDetails.some(a => a.status === 'unhandled');
    const hasUnmatchableOnly = indicatorDetails.every(i => !i.matchable);

    const overallStatus: PlaybookDetail['overallStatus'] =
      hasUnhandledAction ? 'error' :
      hasUnmatchableOnly ? 'warn' :
      'ok';

    details.push({
      name: pb.name,
      description: pb.description,
      component: pb.trigger.component,
      indicators: indicatorDetails,
      actions: actionDetails,
      overallStatus,
    });
  }

  // Coverage score: fraction of playbooks with at least one matchable indicator and all actions handled
  const fullyFunctional = details.filter(d => d.overallStatus === 'ok').length;
  const coverageScore = playbooks.length > 0 ? Math.round((fullyFunctional / playbooks.length) * 100) : 0;

  return {
    name,
    displayName,
    playbookCount: playbooks.length,
    structureValid,
    componentIssues,
    actionIssues,
    conditionIssues,
    coverageScore,
    playbooks: details,
  };
}

// ─────────────────────────────────────────────────────────────
// RPC connectivity check
// ─────────────────────────────────────────────────────────────

async function checkRpcEndpoint(config: NodeTypeConfig): Promise<RpcResult> {
  const start = Date.now();
  try {
    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { name: config.displayName, url: config.rpcUrl, chainType: config.chainType, ok: false, error: `HTTP ${res.status}` };
    }

    const latencyMs = Date.now() - start;
    const data = await res.json() as { result?: string; error?: { message: string } };

    if (data.error) {
      return { name: config.displayName, url: config.rpcUrl, chainType: config.chainType, ok: false, error: data.error.message };
    }

    const blockNumber = data.result ? parseInt(data.result, 16) : undefined;

    // Get client version
    const verRes = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'web3_clientVersion', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const verData = await verRes.json() as { result?: string };

    // Get chain ID
    const chainIdRes = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const chainIdData = await chainIdRes.json() as { result?: string };
    const chainId = chainIdData.result ? `${parseInt(chainIdData.result, 16)} (0x${parseInt(chainIdData.result, 16).toString(16)})` : undefined;

    return {
      name: config.displayName,
      url: config.rpcUrl,
      chainType: config.chainType,
      blockNumber,
      clientVersion: verData.result?.split('/')[0] ?? verData.result,
      chainId,
      latencyMs,
      ok: true,
    };
  } catch (e) {
    return {
      name: config.displayName,
      url: config.rpcUrl,
      chainType: config.chainType,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// HTML generation
// ─────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(score: number): string {
  if (score >= 80) return '#4ade80';  // green
  if (score >= 50) return '#facc15';  // yellow
  return '#f87171';                   // red
}

function statusBadge(status: 'ok' | 'warn' | 'error' | 'auto' | 'manual' | 'unhandled'): string {
  const map: Record<string, [string, string]> = {
    ok: ['#4ade80', '✓'],
    warn: ['#facc15', '⚠'],
    error: ['#f87171', '✗'],
    auto: ['#60a5fa', 'auto'],
    manual: ['#a78bfa', 'manual'],
    unhandled: ['#f87171', 'UNHANDLED'],
  };
  const [color, label] = map[status] ?? ['#9ca3af', status];
  return `<span style="background:${color}22;color:${color};border:1px solid ${color}44;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600">${label}</span>`;
}

function generateHtml(
  pluginReports: PluginReport[],
  envReports: EnvReport[],
  rpcResults: RpcResult[] | null,
  generatedAt: string
): string {
  const totalPlaybooks = pluginReports.reduce((s, r) => s + r.playbookCount, 0);
  const totalStructureValid = pluginReports.reduce((s, r) => s + r.structureValid, 0);
  const totalActionIssues = pluginReports.reduce((s, r) => s + r.actionIssues.length, 0);
  const totalConditionIssues = pluginReports.reduce((s, r) => s + r.conditionIssues.length, 0);
  const avgCoverage = Math.round(pluginReports.reduce((s, r) => s + r.coverageScore, 0) / pluginReports.length);

  function renderPluginSection(r: PluginReport): string {
    const coverCol = scoreColor(r.coverageScore);

    const playbookRows = r.playbooks.map(pb => {
      const matchableCount = pb.indicators.filter(i => i.matchable).length;
      const totalIndicators = pb.indicators.length;
      const indicatorSummary = `${matchableCount}/${totalIndicators} matchable`;

      const autoActions = pb.actions.filter(a => a.status === 'auto').length;
      const manualActions = pb.actions.filter(a => a.status === 'manual').length;
      const unhandledActions = pb.actions.filter(a => a.status === 'unhandled').length;
      let actionSummary = `${autoActions} auto`;
      if (manualActions > 0) actionSummary += `, ${manualActions} manual`;
      if (unhandledActions > 0) actionSummary += `, <span style="color:#f87171">${unhandledActions} unhandled</span>`;

      return `
        <tr style="border-bottom:1px solid #1f2937">
          <td style="padding:8px 12px">${statusBadge(pb.overallStatus)}</td>
          <td style="padding:8px 12px;font-family:monospace;font-size:12px">${escHtml(pb.name)}</td>
          <td style="padding:8px 12px;color:#9ca3af;font-size:12px">${escHtml(pb.component)}</td>
          <td style="padding:8px 12px;font-size:12px">${indicatorSummary}</td>
          <td style="padding:8px 12px;font-size:12px">${actionSummary}</td>
        </tr>`;
    }).join('');

    const issueRows = [
      ...r.actionIssues.map(i => `<li style="color:#f87171">Action <code>${escHtml(i.actionType)}</code> in <code>${escHtml(i.playbook)}</code> — ${escHtml(i.reason)}</li>`),
      ...r.conditionIssues.map(i => `<li style="color:#facc15">Condition <code>${escHtml(i.condition)}</code> in <code>${escHtml(i.playbook)}</code> (${i.indicatorType}) — unmatchable</li>`),
      ...r.componentIssues.map(i => `<li style="color:#f87171">Component <code>${escHtml(i.component)}</code> in <code>${escHtml(i.playbook)}</code> — not in plugin.components</li>`),
    ].join('');

    return `
    <div style="margin-bottom:32px;background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden">
      <div style="padding:16px 20px;background:#0d1117;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:16px;color:#f9fafb">${escHtml(r.displayName)}</h2>
          <span style="color:#6b7280;font-size:12px">${r.playbookCount} playbooks · ${r.structureValid} structure-valid</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:700;color:${coverCol}">${r.coverageScore}%</div>
          <div style="color:#6b7280;font-size:11px">coverage</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0d1117;border-bottom:1px solid #1f2937">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Status</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Name</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Component</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Indicators</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Actions</th>
          </tr>
        </thead>
        <tbody style="color:#e5e7eb">
          ${playbookRows}
        </tbody>
      </table>
      ${issueRows ? `<div style="padding:12px 20px;background:#0d1117;border-top:1px solid #1f2937"><ul style="margin:0;padding:0 0 0 16px;font-size:12px;line-height:2">${issueRows}</ul></div>` : ''}
    </div>`;
  }

  function renderEnvSection(): string {
    const rows = envReports.map(e => {
      const envLines = Object.entries(e.envVars)
        .map(([k, v]) => `<div><span style="color:#60a5fa">${k}</span>=<span style="color:#a3e635">${escHtml(v)}</span></div>`)
        .join('');
      return `
        <tr style="border-bottom:1px solid #1f2937">
          <td style="padding:10px 14px;font-size:12px;color:#f9fafb">${escHtml(e.displayName)}</td>
          <td style="padding:10px 14px;font-family:monospace;font-size:11px;color:#6b7280">${escHtml(e.nodeType)}</td>
          <td style="padding:10px 14px">${e.hasChainType ? statusBadge('ok') : statusBadge('error')}</td>
          <td style="padding:10px 14px">${e.hasRpcUrl ? statusBadge('ok') : statusBadge('error')}</td>
          <td style="padding:10px 14px;font-family:monospace;font-size:11px;color:#9ca3af">${envLines}</td>
        </tr>`;
    }).join('');

    return `
    <div style="margin-bottom:32px;background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden">
      <div style="padding:16px 20px;background:#0d1117">
        <h2 style="margin:0;font-size:16px;color:#f9fafb">.env Generation (Connect Page Simulation)</h2>
        <span style="color:#6b7280;font-size:12px">${envReports.length} node types verified</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0d1117;border-bottom:1px solid #1f2937">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Chain</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">nodeType</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">CHAIN_TYPE</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">RPC URL</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">.env vars</th>
          </tr>
        </thead>
        <tbody style="color:#e5e7eb">
          ${rows}
        </tbody>
      </table>
    </div>`;
  }

  function renderRpcSection(): string {
    if (!rpcResults) {
      return `
      <div style="margin-bottom:32px;background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden">
        <div style="padding:16px 20px;background:#0d1117">
          <h2 style="margin:0;font-size:16px;color:#f9fafb">RPC Connectivity</h2>
          <span style="color:#6b7280;font-size:12px">Skipped — run with <code>--check-rpc</code> to enable</span>
        </div>
      </div>`;
    }

    const rows = rpcResults.map(r => {
      return `
        <tr style="border-bottom:1px solid #1f2937">
          <td style="padding:10px 14px">${r.ok ? statusBadge('ok') : statusBadge('error')}</td>
          <td style="padding:10px 14px;font-size:12px;color:#f9fafb">${escHtml(r.name)}</td>
          <td style="padding:10px 14px;font-family:monospace;font-size:11px;color:#9ca3af">${escHtml(r.url)}</td>
          <td style="padding:10px 14px;font-size:12px">${r.blockNumber ? `#${r.blockNumber.toLocaleString()}` : '-'}</td>
          <td style="padding:10px 14px;font-size:12px;color:#9ca3af">${r.clientVersion ? escHtml(r.clientVersion) : '-'}</td>
          <td style="padding:10px 14px;font-size:12px;color:#9ca3af">${r.chainId ?? '-'}</td>
          <td style="padding:10px 14px;font-size:12px">${r.latencyMs ? `${r.latencyMs}ms` : r.error ? `<span style="color:#f87171">${escHtml(r.error)}</span>` : '-'}</td>
        </tr>`;
    }).join('');

    const okCount = rpcResults.filter(r => r.ok).length;

    return `
    <div style="margin-bottom:32px;background:#111827;border:1px solid #1f2937;border-radius:8px;overflow:hidden">
      <div style="padding:16px 20px;background:#0d1117;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:16px;color:#f9fafb">RPC Connectivity</h2>
          <span style="color:#6b7280;font-size:12px">Live checks against public endpoints</span>
        </div>
        <div style="color:${okCount === rpcResults.length ? '#4ade80' : '#facc15'};font-size:14px;font-weight:600">
          ${okCount}/${rpcResults.length} online
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0d1117;border-bottom:1px solid #1f2937">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Status</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Chain</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">URL</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Block</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Client</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Chain ID</th>
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">Latency</th>
          </tr>
        </thead>
        <tbody style="color:#e5e7eb">
          ${rows}
        </tbody>
      </table>
    </div>`;
  }

  const pluginSections = pluginReports.map(renderPluginSection).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SentinAI — Verification Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #030712; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; padding: 32px 24px; }
    code { font-family: 'SF Mono', 'Fira Code', monospace; background: #1f2937; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .stat-card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 20px; }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div style="margin-bottom:32px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px">🛡</div>
      <h1 style="font-size:22px;font-weight:700;color:#f9fafb">SentinAI Verification Report</h1>
    </div>
    <p style="color:#6b7280;font-size:13px">Connect → .env → Playbook integrity check · Generated ${escHtml(generatedAt)}</p>
  </div>

  <!-- Summary Cards -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:32px">
    <div class="stat-card">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Total Playbooks</div>
      <div style="font-size:28px;font-weight:700;color:#f9fafb;margin-top:4px">${totalPlaybooks}</div>
      <div style="color:#4ade80;font-size:12px">${totalStructureValid} structure valid</div>
    </div>
    <div class="stat-card">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Avg Coverage</div>
      <div style="font-size:28px;font-weight:700;color:${scoreColor(avgCoverage)};margin-top:4px">${avgCoverage}%</div>
      <div style="color:#6b7280;font-size:12px">fully functional</div>
    </div>
    <div class="stat-card">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Action Issues</div>
      <div style="font-size:28px;font-weight:700;color:${totalActionIssues > 0 ? '#f87171' : '#4ade80'};margin-top:4px">${totalActionIssues}</div>
      <div style="color:#6b7280;font-size:12px">unhandled action types</div>
    </div>
    <div class="stat-card">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">Condition Issues</div>
      <div style="font-size:28px;font-weight:700;color:${totalConditionIssues > 0 ? '#facc15' : '#4ade80'};margin-top:4px">${totalConditionIssues}</div>
      <div style="color:#6b7280;font-size:12px">unmatchable conditions</div>
    </div>
    <div class="stat-card">
      <div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em">.env Configs</div>
      <div style="font-size:28px;font-weight:700;color:#4ade80;margin-top:4px">${envReports.length}</div>
      <div style="color:#6b7280;font-size:12px">node types verified</div>
    </div>
  </div>

  <!-- RPC Section -->
  ${renderRpcSection()}

  <!-- .env Section -->
  ${renderEnvSection()}

  <!-- Plugin Sections -->
  <h2 style="font-size:18px;color:#f9fafb;margin-bottom:16px">Playbook Analysis by Plugin</h2>
  ${pluginSections}

  <!-- Footer -->
  <div style="text-align:center;color:#374151;font-size:12px;margin-top:32px;padding-top:16px;border-top:1px solid #1f2937">
    SentinAI · ${escHtml(generatedAt)}
  </div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const checkRpc = process.argv.includes('--check-rpc');

  console.log('SentinAI Verification Report');
  console.log('════════════════════════════\n');

  // 1. Validate all plugins
  const pluginDefs: [string, string, Playbook[]][] = [
    ['thanos', 'Thanos L2 (Tokamak / OP Stack)', THANOS_PLAYBOOKS],
    ['optimism', 'Optimism / OP Stack', THANOS_PLAYBOOKS], // shares playbooks
    ['arbitrum', 'Arbitrum Nitro', ARBITRUM_PLAYBOOKS],
    ['zkstack', 'ZK Stack (zkSync Era)', ZKSTACK_PLAYBOOKS],
    ['zkl2-generic', 'ZK L2 Generic (Scroll, Linea)', ZKL2_GENERIC_PLAYBOOKS],
    ['l1-evm', 'L1 EVM (Ethereum, Geth, Reth)', L1_EVM_PLAYBOOKS],
  ];

  // Deduplicate — optimism reuses thanos playbooks, skip it
  const uniquePluginDefs: [string, string, Playbook[]][] = [
    ['thanos', 'Thanos / Optimism L2 (OP Stack)', THANOS_PLAYBOOKS],
    ['arbitrum', 'Arbitrum Nitro', ARBITRUM_PLAYBOOKS],
    ['zkstack', 'ZK Stack (zkSync Era)', ZKSTACK_PLAYBOOKS],
    ['zkl2-generic', 'ZK L2 Generic (Scroll, Linea)', ZKL2_GENERIC_PLAYBOOKS],
    ['l1-evm', 'L1 EVM (Ethereum)', L1_EVM_PLAYBOOKS],
  ];

  const pluginReports = uniquePluginDefs.map(([name, displayName, playbooks]) =>
    validatePlugin(name, displayName, playbooks)
  );

  // Print summary to console
  for (const r of pluginReports) {
    const issues = r.actionIssues.length + r.conditionIssues.length + r.componentIssues.length;
    const status = r.actionIssues.length > 0 ? '✗' : r.conditionIssues.length > 0 ? '⚠' : '✓';
    console.log(`  ${status} ${r.displayName}`);
    console.log(`    Playbooks: ${r.playbookCount} | Coverage: ${r.coverageScore}% | Issues: ${issues}`);
    if (r.actionIssues.length > 0) {
      console.log(`    Action issues: ${r.actionIssues.map(i => i.actionType).join(', ')}`);
    }
  }

  // 2. Simulate .env generation
  console.log('\n.env Generation:');
  const envReports: EnvReport[] = NODE_CONFIGS.map(c => ({
    nodeType: c.nodeType,
    chainType: c.chainType,
    displayName: c.displayName,
    hasChainType: 'CHAIN_TYPE' in c.envVars,
    hasRpcUrl: 'L2_RPC_URL' in c.envVars || 'SENTINAI_L1_RPC_URL' in c.envVars,
    envVars: c.envVars,
  }));

  for (const e of envReports) {
    const ok = e.hasChainType && e.hasRpcUrl;
    console.log(`  ${ok ? '✓' : '✗'} ${e.displayName} (${e.chainType})`);
  }

  // 3. Optional RPC check
  let rpcResults: RpcResult[] | null = null;
  if (checkRpc) {
    console.log('\nRPC Connectivity:');
    rpcResults = [];
    for (const config of NODE_CONFIGS) {
      process.stdout.write(`  Checking ${config.displayName}...`);
      const result = await checkRpcEndpoint(config);
      rpcResults.push(result);
      if (result.ok) {
        console.log(` ✓ block #${result.blockNumber?.toLocaleString()} (${result.latencyMs}ms)`);
      } else {
        console.log(` ✗ ${result.error}`);
      }
    }
  }

  // 4. Generate HTML
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const html = generateHtml(pluginReports, envReports, rpcResults, generatedAt);

  const outDir = path.join(process.cwd(), 'docs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'verify-report.html');
  fs.writeFileSync(outPath, html, 'utf-8');

  const totalIssues = pluginReports.reduce((s, r) => s + r.actionIssues.length + r.conditionIssues.length, 0);
  const totalPlaybooks = pluginReports.reduce((s, r) => s + r.playbookCount, 0);

  console.log('\n════════════════════════════');
  console.log(`Report: ${outPath}`);
  console.log(`Playbooks: ${totalPlaybooks} total`);
  console.log(`Issues: ${totalIssues} (${pluginReports.reduce((s, r) => s + r.actionIssues.length, 0)} unhandled actions, ${pluginReports.reduce((s, r) => s + r.conditionIssues.length, 0)} unmatchable conditions)`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
