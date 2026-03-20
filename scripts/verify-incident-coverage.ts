#!/usr/bin/env tsx
/**
 * verify-incident-coverage.ts
 *
 * Generates a coverage report mapping historical L1/L2 operational incidents
 * (from docs/verification/10-years-operation-issues.md) to SentinAI capabilities.
 *
 * Usage:
 *   npx tsx scripts/verify-incident-coverage.ts
 *   npx tsx scripts/verify-incident-coverage.ts --format md    # Markdown (default)
 *   npx tsx scripts/verify-incident-coverage.ts --format json  # JSON
 *
 * Output: docs/verification/incident-coverage-report.html (HTML) and stdout
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Types
// ============================================================

type CoverageGrade = 'COVERED' | 'PARTIAL' | 'DETECT-ONLY' | 'OUT-OF-SCOPE';

interface Incident {
  id: string;
  year: number;
  title: string;
  category: 'L1-Consensus' | 'OP-Stack' | 'Arbitrum' | 'ZK-Rollup' | 'Structural';
  symptoms: string[];
  sentinaiDetection: string;
  sentinaiPlaybook: string | null;
  grade: CoverageGrade;
  gap?: string;
}

// ============================================================
// Incident Database
// ============================================================

const INCIDENTS: Incident[] = [
  // ── Category 1: L1 EVM Consensus Bugs ──────────────────────────────────
  {
    id: 'L1-01',
    year: 2016,
    title: 'Shanghai DoS Attack — opcode gas cost exploitation',
    category: 'L1-Consensus',
    symptoms: ['cpuUsage spike', 'blockInterval increase', 'state trie bloat'],
    sentinaiDetection: 'cpuUsage Z-score + l2BlockInterval Z-score',
    sentinaiPlaybook: 'l1-resource-pressure (scale_up)',
    grade: 'PARTIAL',
  },
  {
    id: 'L1-02',
    year: 2019,
    title: 'Besu SELFBALANCE consensus bug — block rejection',
    category: 'L1-Consensus',
    symptoms: ['l1BlockNumber stagnant (Besu-only chain)'],
    sentinaiDetection: 'l2BlockHeight plateau (blockHeight proxy)',
    sentinaiPlaybook: 'l1-rpc-failover or l1-sync-stall (via log pattern)',
    grade: 'DETECT-ONLY',
  },
  {
    id: 'L1-03',
    year: 2020,
    title: 'Geth chain split — Infura outage, 54% minority chain',
    category: 'L1-Consensus',
    symptoms: ['l1BlockNumber stagnant', 'ECONNRESET errors', 'node sync divergence'],
    sentinaiDetection: 'ECONNRESET log pattern → l1-rpc-failover',
    sentinaiPlaybook: 'l1-rpc-failover (switch_l1_rpc) / l1-sync-stall (restart)',
    grade: 'PARTIAL',
  },
  {
    id: 'L1-04',
    year: 2021,
    title: 'Berlin — OpenEthereum halts on EIP-2929 bug',
    category: 'L1-Consensus',
    symptoms: ['l1BlockNumber stagnant', 'panic logs', 'InvalidStateRoot'],
    sentinaiDetection: 'panic/database log pattern → l1-sync-stall',
    sentinaiPlaybook: 'l1-sync-stall (restart_pod)',
    grade: 'PARTIAL',
  },
  {
    id: 'L1-05',
    year: 2021,
    title: 'Geth CVE-2021-39137 — EVM memory corruption crash',
    category: 'L1-Consensus',
    symptoms: ['cpuUsage zero-drop', 'l1BlockNumber stagnant', 'OOM crash'],
    sentinaiDetection: 'OOM log → l1-resource-pressure; blockHeight plateau',
    sentinaiPlaybook: 'l1-resource-pressure (restart_pod fallback)',
    grade: 'PARTIAL',
  },
  {
    id: 'L1-06',
    year: 2022,
    title: 'Besu gas leak CVE-2022-36025 — infinite gas bug',
    category: 'L1-Consensus',
    symptoms: ['incorrect gas accounting (silent)'],
    sentinaiDetection: 'Not detectable — consensus-level logic error',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'L1-07',
    year: 2024,
    title: 'Nethermind revert bug — 8.2% validators stopped attesting',
    category: 'L1-Consensus',
    symptoms: ['l1BlockNumber stagnant (8.2% minority)'],
    sentinaiDetection: 'blockHeight plateau → escalate_operator',
    sentinaiPlaybook: 'l1-sync-stall (escalate after restart fails)',
    grade: 'DETECT-ONLY',
  },
  {
    id: 'L1-08',
    year: 2025,
    title: 'Pectra/Reth state root bug — node halt at block 2,327,426',
    category: 'L1-Consensus',
    symptoms: ['l1BlockNumber stagnant', 'state root mismatch log'],
    sentinaiDetection: 'state root log pattern → l1-sync-stall',
    sentinaiPlaybook: 'l1-sync-stall (restart_pod → escalate)',
    grade: 'PARTIAL',
  },

  // ── Category 2: OP Stack Operational Issues ─────────────────────────────
  {
    id: 'OP-01',
    year: 2021,
    title: 'OVM → EVM Regenesis — planned migration',
    category: 'OP-Stack',
    symptoms: ['planned downtime'],
    sentinaiDetection: 'N/A — scheduled maintenance',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'OP-02',
    year: 2022,
    title: 'SELFDESTRUCT infinite ETH bug — $530M TVL at risk',
    category: 'OP-Stack',
    symptoms: ['silent ETH duplication (protocol bug)'],
    sentinaiDetection: 'Not detectable — L2 EVM logic error',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'OP-03',
    year: 2022,
    title: 'Wintermute 20M OP token theft — social engineering + replay',
    category: 'OP-Stack',
    symptoms: ['off-chain asset management issue'],
    sentinaiDetection: 'Not detectable — key/asset management',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'OP-04',
    year: 2023,
    title: 'Bedrock upgrade — planned 2–4h downtime',
    category: 'OP-Stack',
    symptoms: ['planned downtime'],
    sentinaiDetection: 'N/A — scheduled maintenance',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'OP-05',
    year: 2024,
    title: 'Fault Proof vulnerability — Guardian activation required',
    category: 'OP-Stack',
    symptoms: ['dispute game manipulation (silent)'],
    sentinaiDetection: 'dispute-game-deadline-near playbook (monitoring exists)',
    sentinaiPlaybook: 'dispute-game-deadline-near (escalate_operator)',
    grade: 'DETECT-ONLY',
  },
  {
    id: 'OP-06',
    year: 2023,
    title: 'Base sequencer 45min outage — infrastructure refresh',
    category: 'OP-Stack',
    symptoms: ['l2BlockHeight stagnant'],
    sentinaiDetection: 'blockHeight plateau → op-node-derivation-stall',
    sentinaiPlaybook: 'op-node-derivation-stall (restart_pod)',
    grade: 'COVERED',
  },
  {
    id: 'OP-07',
    year: 2024,
    title: 'Base op-conductor misconfiguration — 17min HA failover failure',
    category: 'OP-Stack',
    symptoms: ['l2BlockHeight stagnant', 'HA failover not triggered'],
    sentinaiDetection: 'blockHeight plateau → op-node-derivation-stall → restart',
    sentinaiPlaybook: 'op-node-derivation-stall (restart, escalate on fail)',
    grade: 'PARTIAL',
  },
  {
    id: 'OP-08',
    year: 2025,
    title: 'Base traffic surge — 33min sequencer overload',
    category: 'OP-Stack',
    symptoms: ['cpuUsage > 90', 'txPoolPending monotonic increase'],
    sentinaiDetection: 'cpuUsage Z-score → op-geth-resource-exhaustion',
    sentinaiPlaybook: 'op-geth-resource-exhaustion (scale_up)',
    grade: 'COVERED',
  },

  // ── Category 3: Arbitrum ───────────────────────────────────────────────
  {
    id: 'ARB-01',
    year: 2021,
    title: 'Arbitrum sequencer 45min downtime — software bug',
    category: 'Arbitrum',
    symptoms: ['l2BlockHeight stagnant'],
    sentinaiDetection: 'blockHeight plateau → sequencer-stall (via AI component)',
    sentinaiPlaybook: 'sequencer-stall (restart_pod)',
    grade: 'COVERED',
  },
  {
    id: 'ARB-02',
    year: 2022,
    title: 'Nitro bridge init vulnerability — $250M at risk',
    category: 'Arbitrum',
    symptoms: ['silent smart contract vulnerability'],
    sentinaiDetection: 'Not detectable — bridge contract bug',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'ARB-03',
    year: 2023,
    title: 'Inscription surge — 80MB/hr batch overload, ~7h partial',
    category: 'Arbitrum',
    symptoms: ['cpuUsage > 90', 'txPoolPending spike', 'gas spike'],
    sentinaiDetection: 'cpuUsage spike → nitro-resource-exhaustion (scale_up)',
    sentinaiPlaybook: 'nitro-resource-exhaustion + batch-poster-backlog',
    grade: 'PARTIAL',
  },
  {
    id: 'ARB-04',
    year: 2024,
    title: 'Stylus WASM DoS — no-cost sequencer crash loop',
    category: 'Arbitrum',
    symptoms: ['cpuUsage zero-drop', 'l2BlockHeight stagnant'],
    sentinaiDetection: 'cpuUsage zero-drop → nitro-resource-exhaustion restart',
    sentinaiPlaybook: 'nitro-resource-exhaustion (restart_pod fallback)',
    grade: 'PARTIAL',
  },
  {
    id: 'ARB-05',
    year: 2025,
    title: 'BOLD permissionless validation — planned upgrade',
    category: 'Arbitrum',
    symptoms: ['planned protocol upgrade'],
    sentinaiDetection: 'N/A — scheduled upgrade',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },

  // ── Category 4: ZK Rollups ─────────────────────────────────────────────
  {
    id: 'ZK-01',
    year: 2023,
    title: 'zkSync Era launch outages — multiple 4–5h failures',
    category: 'ZK-Rollup',
    symptoms: ['l2BlockHeight stagnant', 'cpuUsage spikes'],
    sentinaiDetection: 'cpuUsage spike → zksync-server-resource-pressure',
    sentinaiPlaybook: 'zksync-server-resource-pressure (scale_up)',
    grade: 'PARTIAL',
  },
  {
    id: 'ZK-02',
    year: 2023,
    title: 'zkSync Era zk-circuit soundness bug — $1.9B at risk',
    category: 'ZK-Rollup',
    symptoms: ['silent ZK circuit vulnerability'],
    sentinaiDetection: 'Not detectable — cryptographic circuit flaw',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'ZK-03',
    year: 2023,
    title: 'Polygon zkEVM proof forgery — Fp3/Fq field arithmetic bug',
    category: 'ZK-Rollup',
    symptoms: ['silent ZK proof forgery'],
    sentinaiDetection: 'Not detectable — mathematical vulnerability',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'ZK-04',
    year: 2024,
    title: 'Polygon zkEVM 10h outage — L1 reorg → sequencer halt',
    category: 'ZK-Rollup',
    symptoms: ['l2BlockHeight stagnant', 'settlementLag high'],
    sentinaiDetection: 'settlementLag spike → zk-settlement-lag',
    sentinaiPlaybook: 'zk-settlement-lag (check_l1_connection + restart)',
    grade: 'PARTIAL',
  },
  {
    id: 'ZK-05',
    year: 2025,
    title: 'zkSync airdrop admin key theft — $5M token mint',
    category: 'ZK-Rollup',
    symptoms: ['off-chain key compromise'],
    sentinaiDetection: 'Not detectable — private key management',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },
  {
    id: 'ZK-06',
    year: 2025,
    title: 'Polygon zkEVM sunset — strategic decision',
    category: 'ZK-Rollup',
    symptoms: ['planned network shutdown'],
    sentinaiDetection: 'N/A — business decision',
    sentinaiPlaybook: null,
    grade: 'OUT-OF-SCOPE',
  },

  // ── Category 5: Structural Risks ────────────────────────────────────────
  {
    id: 'STR-01',
    year: 0,
    title: 'Centralized sequencer SPoF (all major L2s)',
    category: 'Structural',
    symptoms: ['l2BlockHeight stagnant', 'cpuUsage spikes', 'txPool backlog'],
    sentinaiDetection: 'Core coverage: block plateau + CPU + EOA monitoring',
    sentinaiPlaybook: 'op-node-derivation-stall / sequencer-stall / scale_up',
    grade: 'COVERED',
  },
  {
    id: 'STR-02',
    year: 0,
    title: 'Bridge security (state root / proposer liveness)',
    category: 'Structural',
    symptoms: ['proposerBalance low', 'dispute-game deadline approaching'],
    sentinaiDetection: 'proposerBalance threshold-breach + dispute-game monitoring',
    sentinaiPlaybook: 'proposer-eoa-balance-critical + dispute-game-deadline-near',
    grade: 'PARTIAL',
  },
  {
    id: 'STR-03',
    year: 0,
    title: 'L1 client diversity — Geth 85%+ monoculture risk',
    category: 'Structural',
    symptoms: ['l1BlockNumber stagnant after Geth bug'],
    sentinaiDetection: 'blockHeight plateau → l1-rpc-failover / l1-sync-stall',
    sentinaiPlaybook: 'l1-rpc-failover (switch_l1_rpc)',
    grade: 'DETECT-ONLY',
  },
];

// ============================================================
// Coverage Statistics
// ============================================================

interface CategoryStats {
  total: number;
  covered: number;
  partial: number;
  detectOnly: number;
  outOfScope: number;
}

function computeStats(incidents: Incident[]): Record<string, CategoryStats> {
  const categories: Record<string, CategoryStats> = {};

  for (const inc of incidents) {
    if (!categories[inc.category]) {
      categories[inc.category] = { total: 0, covered: 0, partial: 0, detectOnly: 0, outOfScope: 0 };
    }
    const s = categories[inc.category];
    s.total++;
    switch (inc.grade) {
      case 'COVERED': s.covered++; break;
      case 'PARTIAL': s.partial++; break;
      case 'DETECT-ONLY': s.detectOnly++; break;
      case 'OUT-OF-SCOPE': s.outOfScope++; break;
    }
  }

  return categories;
}

function computeOverall(incidents: Incident[]) {
  const total = incidents.length;
  const outOfScope = incidents.filter((i) => i.grade === 'OUT-OF-SCOPE').length;
  const operable = total - outOfScope;
  const covered = incidents.filter((i) => i.grade === 'COVERED').length;
  const partial = incidents.filter((i) => i.grade === 'PARTIAL').length;
  const detectOnly = incidents.filter((i) => i.grade === 'DETECT-ONLY').length;

  return { total, outOfScope, operable, covered, partial, detectOnly };
}

// ============================================================
// Gap Analysis
// ============================================================

const GAPS = [
  {
    id: 'GAP-1',
    title: 'Memory metrics not collected',
    impact: 'memoryPercent > 85/90 triggers in 6 playbooks but anomaly detector lacks memory collection',
    effort: 'Medium — requires K8s metrics-server or Docker stats integration',
    affected: ['op-geth-resource-exhaustion', 'nitro-resource-exhaustion', 'zksync-server-resource-pressure'],
  },
  {
    id: 'GAP-2',
    title: 'peerCount metric not collected',
    impact: 'l1-peer-isolation playbook requires peerCount == 0 but metric not in MetricDataPoint',
    effort: 'Low — single net_peerCount RPC call',
    affected: ['l1-peer-isolation'],
  },
  {
    id: 'GAP-3',
    title: 'Dispute game / proof metrics not collected',
    impact: 'gameDeadlineProximity, proofGenerationLatency, unclaimedBonds require on-chain polling',
    effort: 'High — DisputeGameFactory contract state queries',
    affected: ['dispute-game-deadline-near', 'proof-submission-delay'],
  },
  {
    id: 'GAP-4',
    title: 'ZK prover-specific metrics not collected',
    impact: 'proofQueueDepth, settlementLag depend on zk-prover API or custom metrics',
    effort: 'Medium — chain-specific API integration',
    affected: ['zk-prover-backlog', 'zk-settlement-lag'],
  },
  {
    id: 'GAP-5',
    title: 'L1 chain reorg detection missing (metric-based)',
    impact: 'l1-chain-reorg playbook is log-pattern-only; no parent-hash continuity check',
    effort: 'Medium — eth_getBlockByNumber + parent hash diff',
    affected: ['l1-chain-reorg'],
  },
  {
    id: 'GAP-6',
    title: 'Batch calldata size monitoring absent',
    impact: 'Inscription-style traffic surges detectable only via CPU/txPool, not batch data size',
    effort: 'Medium — batchDataSize or calldataPerBlock custom metric',
    affected: ['op-batcher-backlog', 'batch-poster-backlog'],
  },
];

// ============================================================
// Report Generators
// ============================================================

function gradeEmoji(grade: CoverageGrade): string {
  switch (grade) {
    case 'COVERED': return '✅';
    case 'PARTIAL': return '🟡';
    case 'DETECT-ONLY': return '🔍';
    case 'OUT-OF-SCOPE': return '⬜';
  }
}

function generateMarkdown(): string {
  const overall = computeOverall(INCIDENTS);
  const stats = computeStats(INCIDENTS);
  const pct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}%` : 'N/A';

  let md = '';
  md += '# SentinAI — Incident Coverage Report\n\n';
  md += `> Generated: ${new Date().toISOString()}\n`;
  md += `> Source: \`docs/verification/10-years-operation-issues.md\`\n\n`;
  md += '---\n\n';

  md += '## Executive Summary\n\n';
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total incidents analyzed | ${overall.total} |\n`;
  md += `| Out-of-scope (protocol bugs) | ${overall.outOfScope} |\n`;
  md += `| Operationally relevant | ${overall.operable} |\n`;
  md += `| COVERED | ${overall.covered} (${pct(overall.covered, overall.operable)} of operable) |\n`;
  md += `| PARTIAL | ${overall.partial} (${pct(overall.partial, overall.operable)} of operable) |\n`;
  md += `| DETECT-ONLY | ${overall.detectOnly} (${pct(overall.detectOnly, overall.operable)} of operable) |\n\n`;

  md += '**Grade definitions**:\n';
  md += '- ✅ **COVERED** — SentinAI detects and auto-remediates\n';
  md += '- 🟡 **PARTIAL** — Symptom detected; root cause response limited\n';
  md += '- 🔍 **DETECT-ONLY** — Alert/escalate only; no automated fix possible\n';
  md += '- ⬜ **OUT-OF-SCOPE** — Protocol/cryptographic bug; outside node operator scope\n\n';
  md += '---\n\n';

  md += '## Incident Mapping\n\n';

  const categoryNames: Record<string, string> = {
    'L1-Consensus': 'L1 EVM Consensus Client Bugs',
    'OP-Stack': 'OP Stack Operational Issues',
    'Arbitrum': 'Arbitrum Operational Issues',
    'ZK-Rollup': 'ZK Rollup Issues',
    'Structural': 'Structural Risks',
  };

  for (const [cat, label] of Object.entries(categoryNames)) {
    const catIncidents = INCIDENTS.filter((i) => i.category === cat);
    if (catIncidents.length === 0) continue;

    md += `### ${label}\n\n`;
    md += `| ID | Year | Incident | SentinAI Detection | Playbook | Grade |\n`;
    md += `|----|----- |----------|--------------------|----------|-------|\n`;
    for (const inc of catIncidents) {
      const year = inc.year > 0 ? String(inc.year) : '—';
      const pb = inc.sentinaiPlaybook ?? '—';
      md += `| ${inc.id} | ${year} | ${inc.title} | ${inc.sentinaiDetection} | \`${pb}\` | ${gradeEmoji(inc.grade)} ${inc.grade} |\n`;
    }
    md += '\n';
  }

  md += '## Category Statistics\n\n';
  md += `| Category | Total | COVERED | PARTIAL | DETECT-ONLY | OUT-OF-SCOPE |\n`;
  md += `|----------|-------|---------|---------|-------------|---------------|\n`;
  const totals = { total: 0, covered: 0, partial: 0, detectOnly: 0, outOfScope: 0 };
  for (const [cat, s] of Object.entries(stats)) {
    md += `| ${cat} | ${s.total} | ${s.covered} | ${s.partial} | ${s.detectOnly} | ${s.outOfScope} |\n`;
    totals.total += s.total;
    totals.covered += s.covered;
    totals.partial += s.partial;
    totals.detectOnly += s.detectOnly;
    totals.outOfScope += s.outOfScope;
  }
  md += `| **Total** | **${totals.total}** | **${totals.covered}** | **${totals.partial}** | **${totals.detectOnly}** | **${totals.outOfScope}** |\n\n`;
  md += '---\n\n';

  md += '## Gap Analysis\n\n';
  md += `| Gap | Title | Effort | Affected Playbooks |\n`;
  md += `|-----|-------|--------|--------------------|\n`;
  for (const gap of GAPS) {
    md += `| ${gap.id} | ${gap.title} | ${gap.effort} | ${gap.affected.join(', ')} |\n`;
  }
  md += '\n';

  md += '### Gap Details\n\n';
  for (const gap of GAPS) {
    md += `**${gap.id}: ${gap.title}**\n\n`;
    md += `- Impact: ${gap.impact}\n`;
    md += `- Effort: ${gap.effort}\n`;
    md += `- Affected: \`${gap.affected.join('`, `')}\`\n\n`;
  }

  return md;
}

function generateHTML(): string {
  const overall = computeOverall(INCIDENTS);
  const pct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}` : '0';

  const gradeColor: Record<CoverageGrade, string> = {
    COVERED: '#22c55e',
    PARTIAL: '#f59e0b',
    'DETECT-ONLY': '#3b82f6',
    'OUT-OF-SCOPE': '#9ca3af',
  };

  const incidentRows = INCIDENTS.map((inc) => {
    const color = gradeColor[inc.grade];
    const year = inc.year > 0 ? String(inc.year) : '—';
    const pb = inc.sentinaiPlaybook
      ? `<code>${inc.sentinaiPlaybook}</code>`
      : '<em style="color:#9ca3af">—</em>';
    return `
      <tr>
        <td style="font-weight:600;color:#6366f1">${inc.id}</td>
        <td>${year}</td>
        <td><span style="font-size:0.8em;background:#1e293b;padding:2px 6px;border-radius:4px">${inc.category}</span></td>
        <td>${inc.title}</td>
        <td style="font-size:0.85em;color:#94a3b8">${inc.sentinaiDetection}</td>
        <td>${pb}</td>
        <td><span style="background:${color}22;color:${color};padding:2px 8px;border-radius:4px;font-weight:600;font-size:0.8em">${inc.grade}</span></td>
      </tr>`;
  }).join('\n');

  const gapRows = GAPS.map((g) => `
    <tr>
      <td style="font-weight:600;color:#f59e0b">${g.id}</td>
      <td>${g.title}</td>
      <td style="font-size:0.85em;color:#94a3b8">${g.impact}</td>
      <td><span style="font-size:0.8em;background:#1e293b;padding:2px 6px;border-radius:4px">${g.effort}</span></td>
      <td style="font-size:0.85em">${g.affected.map((a) => `<code>${a}</code>`).join(', ')}</td>
    </tr>`).join('\n');

  const operable = overall.operable;
  const covPct = pct(overall.covered, operable);
  const parPct = pct(overall.partial, operable);
  const detPct = pct(overall.detectOnly, operable);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SentinAI — Incident Coverage Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; padding: 2rem; line-height: 1.6; }
    h1 { font-size: 1.8rem; color: #f8fafc; margin-bottom: 0.5rem; }
    h2 { font-size: 1.3rem; color: #94a3b8; margin: 2rem 0 1rem; border-bottom: 1px solid #1e293b; padding-bottom: 0.5rem; }
    .subtitle { color: #64748b; margin-bottom: 2rem; font-size: 0.9rem; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
    .stat-card { background: #1e293b; border-radius: 12px; padding: 1rem; text-align: center; }
    .stat-card .value { font-size: 2rem; font-weight: 700; }
    .stat-card .label { color: #64748b; font-size: 0.8rem; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.88rem; }
    th { background: #1e293b; color: #94a3b8; padding: 10px 12px; text-align: left; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #1e293b; vertical-align: top; }
    tr:hover td { background: #1e293b44; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; font-size: 0.82em; color: #a5b4fc; }
    .bar { display: flex; height: 20px; border-radius: 6px; overflow: hidden; margin: 0.5rem 0; }
    .bar-seg { display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; color: #fff; min-width: 2%; }
    footer { margin-top: 3rem; color: #475569; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>SentinAI — Incident Coverage Report</h1>
  <p class="subtitle">
    Mapping 10 years of L1/L2 operational incidents against SentinAI detection &amp; remediation capabilities<br>
    Generated: ${new Date().toISOString()} &nbsp;|&nbsp; Source: <code>docs/verification/10-years-operation-issues.md</code>
  </p>

  <h2>Executive Summary</h2>
  <div class="stat-grid">
    <div class="stat-card"><div class="value" style="color:#6366f1">${overall.total}</div><div class="label">Total Incidents</div></div>
    <div class="stat-card"><div class="value" style="color:#22c55e">${overall.covered}</div><div class="label">COVERED</div></div>
    <div class="stat-card"><div class="value" style="color:#f59e0b">${overall.partial}</div><div class="label">PARTIAL</div></div>
    <div class="stat-card"><div class="value" style="color:#3b82f6">${overall.detectOnly}</div><div class="label">DETECT-ONLY</div></div>
    <div class="stat-card"><div class="value" style="color:#9ca3af">${overall.outOfScope}</div><div class="label">OUT-OF-SCOPE</div></div>
    <div class="stat-card"><div class="value" style="color:#f8fafc">${covPct}%</div><div class="label">Covered (of operable)</div></div>
  </div>

  <p>Of ${operable} operationally relevant incidents (excluding OUT-OF-SCOPE protocol bugs):</p>
  <div class="bar">
    <div class="bar-seg" style="width:${covPct}%;background:#22c55e">${covPct}%</div>
    <div class="bar-seg" style="width:${parPct}%;background:#f59e0b">${parPct}%</div>
    <div class="bar-seg" style="width:${detPct}%;background:#3b82f6">${detPct}%</div>
  </div>
  <p style="font-size:0.8rem;color:#64748b;margin-top:0.25rem">
    <span style="color:#22c55e">■</span> COVERED &nbsp;
    <span style="color:#f59e0b">■</span> PARTIAL &nbsp;
    <span style="color:#3b82f6">■</span> DETECT-ONLY
  </p>

  <h2>Incident Mapping (${overall.total} incidents)</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Year</th><th>Category</th><th>Incident</th>
        <th>SentinAI Detection</th><th>Playbook</th><th>Grade</th>
      </tr>
    </thead>
    <tbody>${incidentRows}</tbody>
  </table>

  <h2>Gap Analysis (${GAPS.length} gaps identified)</h2>
  <table>
    <thead>
      <tr>
        <th>Gap</th><th>Title</th><th>Impact</th><th>Effort</th><th>Affected Playbooks</th>
      </tr>
    </thead>
    <tbody>${gapRows}</tbody>
  </table>

  <footer>
    SentinAI &mdash; L2 Network Monitoring &amp; Auto-Scaling &nbsp;|&nbsp;
    Run <code>npx tsx scripts/verify-incident-coverage.ts</code> to regenerate
  </footer>
</body>
</html>`;
}

// ============================================================
// Main
// ============================================================

const args = process.argv.slice(2);
const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'md';
const outputDir = path.join(process.cwd(), 'docs', 'verification');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Always generate HTML
const htmlPath = path.join(outputDir, 'incident-coverage-report.html');
fs.writeFileSync(htmlPath, generateHTML(), 'utf-8');
console.log(`✅ HTML report written to: ${htmlPath}`);

// Generate MD
const mdPath = path.join(outputDir, 'incident-coverage-report.md');
const md = generateMarkdown();
fs.writeFileSync(mdPath, md, 'utf-8');
console.log(`✅ Markdown report written to: ${mdPath}`);

// Print summary to stdout
const overall = computeOverall(INCIDENTS);
const operable = overall.operable;
const pct = (n: number) => Math.round((n / operable) * 100);

console.log('\n─── SentinAI Incident Coverage Summary ───────────────────────');
console.log(`  Total incidents:    ${overall.total}`);
console.log(`  Out-of-scope:       ${overall.outOfScope}`);
console.log(`  Operationally relevant: ${operable}`);
console.log(`  ✅ COVERED:         ${overall.covered} (${pct(overall.covered)}%)`);
console.log(`  🟡 PARTIAL:         ${overall.partial} (${pct(overall.partial)}%)`);
console.log(`  🔍 DETECT-ONLY:     ${overall.detectOnly} (${pct(overall.detectOnly)}%)`);
console.log(`  Gaps identified:    ${GAPS.length}`);
console.log('──────────────────────────────────────────────────────────────');

if (format === 'json') {
  console.log('\nJSON output:');
  console.log(JSON.stringify({ incidents: INCIDENTS, gaps: GAPS, overall }, null, 2));
}
