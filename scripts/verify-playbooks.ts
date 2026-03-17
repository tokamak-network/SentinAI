#!/usr/bin/env npx tsx
/**
 * Playbook Integrity Verifier
 * Validates all chain plugin playbooks for structure, component references,
 * action handler coverage, and metric condition parseability.
 *
 * Usage:
 *   npx tsx scripts/verify-playbooks.ts
 *   npm run verify:playbooks
 */

import { ThanosPlugin } from '../src/chains/thanos/index';
import { OptimismPlugin } from '../src/chains/optimism/index';
import { ArbitrumPlugin } from '../src/chains/arbitrum/index';
import { ZkstackPlugin } from '../src/chains/zkstack/index';
import { ZkL2GenericPlugin } from '../src/chains/zkl2-generic/index';
import { L1EVMPlugin } from '../src/chains/l1-evm/index';
import type { ChainPlugin } from '../src/chains/types';
import type { Playbook, RemediationActionType } from '../src/types/remediation';

// ─────────────────────────────────────────────────────────────────────────────
// Action types actually handled in action-executor.ts switch statement
// ─────────────────────────────────────────────────────────────────────────────
const HANDLED_ACTION_TYPES = new Set<RemediationActionType>([
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
  // Manual actions (handled as skipped, not error)
  'config_change',
  'rollback_deployment',
  'force_restart_all',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Metric conditions matchesMetricCondition() can handle (from playbook-matcher.ts)
// ─────────────────────────────────────────────────────────────────────────────
const MATCHABLE_METRIC_KEYWORDS = [
  'cpuUsage',
  'txPoolPending',
  'l2BlockHeight stagnant',
  'l1BlockNumber stagnant',
  'hybridScore',
  'batcherBalance',
  'proposerBalance',
  'challengerBalance',
];

function isMetricConditionMatchable(condition: string): boolean {
  return MATCHABLE_METRIC_KEYWORDS.some(kw => condition.includes(kw));
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSI colors
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

const pass = (msg: string) => `${C.green}✓${C.reset} ${msg}`;
const fail = (msg: string) => `${C.red}✗${C.reset} ${msg}`;
const warn = (msg: string) => `${C.yellow}⚠${C.reset} ${msg}`;

// ─────────────────────────────────────────────────────────────────────────────
// Plugin registry
// ─────────────────────────────────────────────────────────────────────────────
interface PluginEntry {
  name: string;
  plugin: ChainPlugin;
}

function buildPlugins(): PluginEntry[] {
  return [
    { name: 'thanos', plugin: new ThanosPlugin() },
    { name: 'optimism', plugin: new OptimismPlugin() },
    { name: 'arbitrum', plugin: new ArbitrumPlugin() },
    { name: 'zkstack', plugin: new ZkstackPlugin() },
    { name: 'zkl2-generic', plugin: new ZkL2GenericPlugin() },
    { name: 'l1-evm', plugin: new L1EVMPlugin() },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────
interface PlaybookIssue {
  playbook: string;
  issue: string;
  severity: 'error' | 'warning';
}

interface PluginReport {
  name: string;
  playbookCount: number;
  structureValid: number;
  componentValid: number;
  actionValid: number;
  conditionMatchable: number;
  issues: PlaybookIssue[];
}

function verifyPlugin(entry: PluginEntry): PluginReport {
  const { name, plugin } = entry;
  const playbooks: Playbook[] = plugin.getPlaybooks();
  // ChainComponent is a string type; include both components and metaComponents
  const componentSet = new Set([
    ...plugin.components,
    ...(plugin.metaComponents ?? []),
  ]);
  const seenNames = new Set<string>();

  const report: PluginReport = {
    name,
    playbookCount: playbooks.length,
    structureValid: 0,
    componentValid: 0,
    actionValid: 0,
    conditionMatchable: 0,
    issues: [],
  };

  for (const pb of playbooks) {
    // ── Structure validation ─────────────────────────────────────────────────
    const hasName = typeof pb.name === 'string' && pb.name.length > 0;
    const hasTrigger = pb.trigger && typeof pb.trigger.component === 'string';
    const hasActions = Array.isArray(pb.actions) && pb.actions.length > 0;

    if (!hasName || !hasTrigger || !hasActions) {
      report.issues.push({
        playbook: pb.name ?? '(unnamed)',
        issue: `Missing required fields: ${[!hasName && 'name', !hasTrigger && 'trigger.component', !hasActions && 'actions'].filter(Boolean).join(', ')}`,
        severity: 'error',
      });
    } else {
      report.structureValid++;
    }

    // ── Duplicate name check ─────────────────────────────────────────────────
    if (pb.name && seenNames.has(pb.name)) {
      report.issues.push({
        playbook: pb.name,
        issue: 'Duplicate playbook name',
        severity: 'error',
      });
    } else if (pb.name) {
      seenNames.add(pb.name);
    }

    // ── Component reference validation ───────────────────────────────────────
    const comp = pb.trigger?.component;
    if (comp && comp !== 'system' && !componentSet.has(comp)) {
      report.issues.push({
        playbook: pb.name,
        issue: `trigger.component '${comp}' not in plugin.components`,
        severity: 'error',
      });
    } else if (comp) {
      report.componentValid++;
    }

    // ── Action type validation ────────────────────────────────────────────────
    const allActions = [
      ...(pb.actions ?? []),
      ...(pb.fallback ?? []),
    ];
    let playbookActionsValid = true;
    for (const action of allActions) {
      if (!HANDLED_ACTION_TYPES.has(action.type)) {
        report.issues.push({
          playbook: pb.name,
          issue: `action type '${action.type}' NOT handled in action-executor.ts`,
          severity: 'error',
        });
        playbookActionsValid = false;
      }
    }
    if (playbookActionsValid) {
      report.actionValid++;
    }

    // ── Metric condition parseability ────────────────────────────────────────
    const indicators = pb.trigger?.indicators ?? [];
    let allConditionsMatchable = true;
    for (const ind of indicators) {
      if (ind.type === 'metric') {
        if (!isMetricConditionMatchable(ind.condition)) {
          report.issues.push({
            playbook: pb.name,
            issue: `metric condition not matchable: "${ind.condition}"`,
            severity: 'warning',
          });
          allConditionsMatchable = false;
        }
      }
    }
    if (allConditionsMatchable) {
      report.conditionMatchable++;
    }
  }

  return report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  console.log(`\n${C.bold}═══ Playbook Integrity Report ═══${C.reset}\n`);

  let plugins: PluginEntry[];
  try {
    plugins = buildPlugins();
  } catch (e) {
    console.error(`${C.red}Failed to instantiate plugins:${C.reset}`, e);
    process.exit(1);
  }

  const reports: PluginReport[] = [];
  let totalPlaybooks = 0;
  let totalStructureValid = 0;
  let totalComponentValid = 0;
  let totalActionValid = 0;
  let totalConditionMatchable = 0;
  let totalIssues = 0;
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const entry of plugins) {
    let report: PluginReport;
    try {
      report = verifyPlugin(entry);
    } catch (e) {
      console.error(`${C.red}Error verifying plugin '${entry.name}':${C.reset}`, e);
      process.exit(1);
    }
    reports.push(report);

    const errors = report.issues.filter(i => i.severity === 'error');
    const warnings = report.issues.filter(i => i.severity === 'warning');

    console.log(`${C.bold}[${report.name}]${C.reset} ${report.playbookCount} playbooks`);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`  ${pass('Structure: all valid')}`);
      console.log(`  ${pass('Components: all exist in plugin.components')}`);
      console.log(`  ${pass('Actions: all handled')}`);
      console.log(`  ${pass('Conditions: all matchable')}`);
    } else {
      const unmatchableConditions = warnings.filter(i => i.issue.includes('metric condition not matchable'));
      const unhandledActions = errors.filter(i => i.issue.includes('NOT handled in action-executor'));
      const componentIssues = errors.filter(i => i.issue.includes('not in plugin.components'));
      const structureIssues = errors.filter(i => i.issue.includes('Missing required fields') || i.issue.includes('Duplicate'));

      if (structureIssues.length === 0) {
        console.log(`  ${pass('Structure: all valid')}`);
      } else {
        console.log(`  ${fail(`Structure: ${structureIssues.length} invalid`)}`);
        structureIssues.forEach(i => console.log(`    ${C.dim}↳ [${i.playbook}] ${i.issue}${C.reset}`));
      }

      if (componentIssues.length === 0) {
        console.log(`  ${pass('Components: all exist in plugin.components')}`);
      } else {
        console.log(`  ${fail(`Components: ${componentIssues.length} missing`)}`);
        componentIssues.forEach(i => console.log(`    ${C.dim}↳ [${i.playbook}] ${i.issue}${C.reset}`));
      }

      if (unhandledActions.length === 0) {
        console.log(`  ${pass('Actions: all handled')}`);
      } else {
        const uniqTypes = [...new Set(unhandledActions.map(i => i.issue.match(/'([^']+)'/)?.[1] ?? '?'))];
        console.log(`  ${fail(`Actions: ${uniqTypes.join(', ')} NOT handled in executor`)}`);
        unhandledActions.forEach(i => console.log(`    ${C.dim}↳ [${i.playbook}] ${i.issue}${C.reset}`));
      }

      if (unmatchableConditions.length === 0) {
        console.log(`  ${pass('Conditions: all matchable')}`);
      } else {
        console.log(`  ${warn(`Conditions: ${unmatchableConditions.length} unmatchable`)}`);
        unmatchableConditions.forEach(i => console.log(`    ${C.dim}↳ [${i.playbook}] ${i.issue}${C.reset}`));
      }
    }

    console.log('');
    totalPlaybooks += report.playbookCount;
    totalStructureValid += report.structureValid;
    totalComponentValid += report.componentValid;
    totalActionValid += report.actionValid;
    totalConditionMatchable += report.conditionMatchable;
    totalIssues += report.issues.length;
    totalErrors += errors.length;
    totalWarnings += warnings.length;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`${C.bold}═══ Summary ═══${C.reset}`);
  console.log(`Total: ${totalPlaybooks} playbooks across ${plugins.length} plugins`);

  const structureStatus = totalStructureValid === totalPlaybooks ? pass : fail;
  const componentStatus = totalComponentValid === totalPlaybooks ? pass : fail;
  const actionStatus = totalActionValid === totalPlaybooks ? pass : fail;
  const conditionStatus = totalConditionMatchable === totalPlaybooks ? pass : warn;

  console.log(`  ${structureStatus(`Structure: ${totalStructureValid}/${totalPlaybooks} valid`)}`);
  console.log(`  ${componentStatus(`Components: ${totalComponentValid}/${totalPlaybooks} valid`)}`);
  console.log(`  ${actionStatus(`Actions: ${totalActionValid}/${totalPlaybooks} valid`)}`);
  console.log(`  ${conditionStatus(`Conditions: ${totalConditionMatchable}/${totalPlaybooks} matchable`)}`);

  if (totalErrors > 0) {
    console.log(`\n${C.red}${C.bold}FAILED${C.reset}: ${totalErrors} error(s), ${totalWarnings} warning(s)`);
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log(`\n${C.yellow}${C.bold}WARNINGS${C.reset}: 0 errors, ${totalWarnings} warning(s)`);
    process.exit(0);
  } else {
    console.log(`\n${C.green}${C.bold}ALL CHECKS PASSED${C.reset}`);
    process.exit(0);
  }
}

main();
