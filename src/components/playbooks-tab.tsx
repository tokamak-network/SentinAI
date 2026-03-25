'use client';

import { useEffect, useState, useCallback } from 'react';
import type { EvolvedPlaybook, OperationRecord } from '@/playbooks/learning/types';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
const API_KEY = process.env.NEXT_PUBLIC_SENTINAI_API_KEY || '';

function authHeaders(): HeadersInit {
  return API_KEY ? { 'x-api-key': API_KEY } : {};
}

// ─── Label Maps ─────────────────────────────────────────────────────────────

const METRIC_LABEL: Record<string, string> = {
  tx_pool_pending: 'TxPool pending',
  tx_pool_count: 'TxPool count',
  l1_sync_lag: 'L1 sync lag',
  gas_price: 'Gas price',
  cpu_usage: 'CPU usage',
  block_height: 'Block height',
  memory_usage: 'Memory usage',
  peer_count: 'Peer count',
  txPoolPending: 'TxPool pending',
  cpuUsage: 'CPU usage',
  memoryPercent: 'Memory %',
  txCountPerBlock: 'Tx count/block',
  gasUsedRatio: 'Gas used ratio',
  l2BlockHeight: 'L2 block height',
  l2BlockInterval: 'L2 block interval',
  peerCount: 'Peer count',
  blockInterval: 'Block interval',
};

const ANOMALY_OP: Record<string, string> = {
  threshold: '>',
  'z-score': '↑',
  monotonic: '↑↑',
  plateau: '—',
  'zero-drop': '→0',
};

const ACTION_LABEL: Record<string, string> = {
  'restart-batcher': 'Restart batcher',
  'restart-proposer': 'Restart proposer',
  'restart-component': 'Restart component',
  'switch-l1-rpc': 'Switch L1 RPC',
  'scale-up': 'Scale up',
  'refill-eoa': 'Refill EOA',
  restart_pod: 'Restart pod',
  scale_up: 'Scale up',
  scale_down: 'Scale down',
  health_check: 'Health check',
  check_l1_connection: 'Check L1 connection',
  collect_logs: 'Collect logs',
  escalate_operator: 'Escalate to operator',
  refill_eoa: 'Refill EOA',
  verify_balance_restored: 'Verify balance',
  switch_l1_rpc: 'Switch L1 RPC',
  claim_bond: 'Claim bond',
  zero_downtime_swap: 'Zero-downtime swap',
  unknown: '—',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSignature(sig: string): { when: string; anomalyType: string } {
  const parts = sig.split('|');
  const anomalyType = parts[0] ?? 'threshold';
  const metricName = parts[1] ?? '';
  const valuePart = parts.find(p => p.startsWith('v:'));
  const value = valuePart ? valuePart.slice(2) : null;

  const op = ANOMALY_OP[anomalyType] ?? '>';
  const label = METRIC_LABEL[metricName]
    ?? metricName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

  const when = value ? `${label} ${op} ${value}` : `${label} ${op}`;
  return { when, anomalyType };
}

function humanAction(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/[-_]/g, ' ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#007A00';
  if (c >= 0.6) return '#CC6600';
  return '#D40000';
}

function needsAttention(p: EvolvedPlaybook): boolean {
  return (
    p.reviewStatus === 'suspended' ||
    p.confidence < 0.5 ||
    p.performance.lastOutcome === 'failure'
  );
}

function sortPlaybooks(list: EvolvedPlaybook[]): EvolvedPlaybook[] {
  return [...list].sort((a, b) => {
    const aAttn = needsAttention(a) ? 0 : 1;
    const bAttn = needsAttention(b) ? 0 : 1;
    if (aAttn !== bAttn) return aAttn - bAttn;
    return a.confidence - b.confidence;
  });
}

const FONT = "'IBM Plex Mono', monospace";

// ─── StatusBar ──────────────────────────────────────────────────────────────

function StatusBar({ totalRecords, lastTimestamp, onRunNow, running, onSimulate, simulating }: {
  totalRecords: number; lastTimestamp: string | null;
  onRunNow: () => void; running: boolean;
  onSimulate: () => void; simulating: boolean;
}) {
  return (
    <div style={{ background: '#F5F5F5', border: '1px solid #D8D8D8', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 11, fontFamily: FONT, color: '#0A0A0A' }}>
      <span>RECORDS <strong>{totalRecords}</strong></span>
      <span style={{ color: '#555' }}>|</span>
      <span>LAST LEARNED <strong>{relativeTime(lastTimestamp)}</strong></span>
      <span style={{ color: '#555' }}>|</span>
      <span>
        NEXT AUTO-RUN <strong>00:05 UTC</strong>{' '}
        <span style={{ background: '#0055AA', color: '#FFF', padding: '1px 5px', fontSize: 9, fontFamily: FONT, fontWeight: 700, letterSpacing: 1 }}>DAILY</span>
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        <button onClick={onSimulate} disabled={simulating || running}
          style={{ background: simulating ? '#888' : '#007A00', color: '#FFF', border: 'none', padding: '4px 10px', fontSize: 10, fontFamily: FONT, fontWeight: 700, cursor: simulating || running ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}>
          {simulating ? 'SIMULATING…' : 'SIMULATE'}
        </button>
        <button onClick={onRunNow} disabled={running || simulating}
          style={{ background: running ? '#888' : '#0A0A0A', color: '#FFF', border: 'none', padding: '4px 10px', fontSize: 10, fontFamily: FONT, fontWeight: 700, cursor: running || simulating ? 'not-allowed' : 'pointer', letterSpacing: 0.5 }}>
          {running ? 'RUNNING…' : 'RUN NOW'}
        </button>
      </div>
    </div>
  );
}

// ─── Compact Row (healthy approved playbooks) ───────────────────────────────

function PlaybookCompactRow({ playbook, onAction }: { playbook: EvolvedPlaybook; onAction: (id: string, action: 'suspend') => void }) {
  const { when } = parseSignature(playbook.triggerSignature);
  const action = humanAction(playbook.action);
  const confPct = Math.round(playbook.confidence * 100);
  const successPct = Math.round(playbook.performance.successRate * 100);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px', borderBottom: '1px solid #F0F0F0', fontSize: 10, fontFamily: FONT, color: '#0A0A0A' }}>
      <span style={{ fontWeight: 700, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {action} <span style={{ color: '#888', fontWeight: 400 }}>when</span> {when}
      </span>
      <span style={{ color: confidenceColor(playbook.confidence), fontWeight: 700, flexShrink: 0 }}>{confPct}%</span>
      <span style={{ color: '#555', flexShrink: 0 }}>{playbook.performance.totalApplications} runs</span>
      <span style={{ color: '#555', flexShrink: 0 }}>{successPct}% ok</span>
      <span style={{ color: '#555', flexShrink: 0 }}>avg {formatDuration(playbook.performance.avgResolutionMs)}</span>
      <button onClick={() => onAction(playbook.playbookId, 'suspend')}
        style={{ background: '#E8E8E8', color: '#555', border: 'none', padding: '2px 8px', fontSize: 9, fontFamily: FONT, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5, flexShrink: 0 }}>
        SUSPEND
      </button>
    </div>
  );
}

// ─── Expanded Card (attention-needed playbooks) ─────────────────────────────

function PlaybookCard({ playbook, onAction }: { playbook: EvolvedPlaybook; onAction: (id: string, action: string) => void }) {
  const { when, anomalyType } = parseSignature(playbook.triggerSignature);
  const action = humanAction(playbook.action);
  const [showHistory, setShowHistory] = useState(false);

  const borderColor = playbook.reviewStatus === 'suspended' ? '#D40000' : playbook.confidence < 0.5 ? '#CC6600' : '#007A00';
  const successPct = Math.round(playbook.performance.successRate * 100);
  const confColor = confidenceColor(playbook.confidence);
  const confPct = Math.round(playbook.confidence * 100);

  return (
    <div style={{ background: '#FFF', borderLeft: `3px solid ${borderColor}`, border: `1px solid #E0E0E0`, borderLeftWidth: 3, borderLeftColor: borderColor, padding: '10px 12px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0A0A0A' }}>{action} when {when}</span>
          <span onClick={() => setShowHistory(prev => !prev)} style={{ marginLeft: 8, fontSize: 9, color: '#0055AA', cursor: 'pointer' }}>
            v{playbook.evolution.version} {showHistory ? '▲' : '▼'}
          </span>
        </div>
        <span style={{
          display: 'inline-block', padding: '1px 6px', fontSize: 9, fontFamily: FONT, fontWeight: 700, letterSpacing: 1,
          ...(playbook.reviewStatus === 'suspended' ? { background: '#FFF0F0', color: '#D40000' } : playbook.reviewStatus === 'approved' ? { background: '#E8FFF5', color: '#007A00' } : { background: '#FFF8E0', color: '#AA6600' }),
        }}>
          {playbook.reviewStatus.toUpperCase()}
        </span>
      </div>

      {/* WHEN → DO */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 10 }}>
        <div style={{ flex: 1, background: '#FFF8E0', border: '1px solid #E8D8A0', padding: '6px 8px' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 4 }}>WHEN THIS HAPPENS</div>
          <div style={{ color: '#0A0A0A' }}>{ANOMALY_OP[anomalyType] ?? '>'} <span style={{ fontWeight: 700 }}>{when}</span></div>
        </div>
        <div style={{ fontSize: 16, color: '#888', alignSelf: 'center', flexShrink: 0 }}>→</div>
        <div style={{ flex: 1, background: '#E8F0FF', border: '1px solid #A0B8E8', padding: '6px 8px' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#888', letterSpacing: 1, marginBottom: 4 }}>DO THIS</div>
          <div style={{ color: '#0A0A0A', fontWeight: 700 }}>{action}</div>
        </div>
      </div>

      {/* Evidence */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 10, color: '#555', marginBottom: 10, flexWrap: 'wrap' }}>
        <span>INCIDENTS <strong style={{ color: '#0A0A0A' }}>{playbook.performance.totalApplications}</strong></span>
        <span>|</span>
        <span>RESOLVED <strong style={{ color: '#0A0A0A' }}>{successPct}%</strong></span>
        <span>|</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          SUCCESS RATE
          <span style={{ display: 'inline-block', width: 80, height: 6, background: '#E0E0E0', position: 'relative' }}>
            <span style={{ display: 'block', width: `${successPct}%`, height: '100%', background: confidenceColor(playbook.performance.successRate) }} />
          </span>
          <span style={{ color: confidenceColor(playbook.performance.successRate) }}>{successPct}%</span>
        </span>
        <span>|</span>
        <span>CONFIDENCE <strong style={{ color: confColor }}>{confPct}%</strong></span>
        <span>|</span>
        <span>LAST <strong>{relativeTime(playbook.performance.lastApplied)}</strong></span>
        <span>|</span>
        <span>AVG <strong style={{ color: '#0A0A0A' }}>{formatDuration(playbook.performance.avgResolutionMs)}</strong></span>
      </div>

      {/* Evolution History */}
      {showHistory && playbook.evolution.changelog.length > 0 && (
        <div style={{ background: '#FAFAFA', border: '1px solid #E8E8E8', padding: '8px 10px', marginBottom: 8, fontSize: 9 }}>
          <div style={{ fontWeight: 700, fontSize: 8, letterSpacing: 1, color: '#888', marginBottom: 6 }}>EVOLUTION HISTORY</div>
          {playbook.evolution.changelog.slice().reverse().map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px solid #F0F0F0' }}>
              <span style={{ color: '#888', minWidth: 24 }}>v{entry.version}</span>
              <span style={{ color: '#555', minWidth: 50 }}>{relativeTime(entry.timestamp)}</span>
              <span style={{ color: '#0A0A0A', flex: 1 }}>{entry.reason}</span>
              <span style={{ color: entry.confidenceDelta > 0 ? '#007A00' : entry.confidenceDelta < 0 ? '#D40000' : '#888' }}>
                {entry.confidenceDelta > 0 ? '+' : ''}{Math.round(entry.confidenceDelta * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6 }}>
        {playbook.reviewStatus === 'approved' && (
          <button onClick={() => onAction(playbook.playbookId, 'suspend')}
            style={{ background: '#E8E8E8', color: '#555', border: 'none', padding: '4px 10px', fontSize: 10, fontFamily: FONT, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
            SUSPEND
          </button>
        )}
        {playbook.reviewStatus === 'suspended' && (
          <button onClick={() => onAction(playbook.playbookId, 'reactivate')}
            style={{ background: '#CC6600', color: '#FFF', border: 'none', padding: '4px 10px', fontSize: 10, fontFamily: FONT, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5 }}>
            REACTIVATE
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ background: '#ECECEC', padding: '5px 10px', fontSize: 9, fontFamily: FONT, fontWeight: 700, letterSpacing: 1.5, color: '#444', textTransform: 'uppercase' as const, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{label}</span>
      <span style={{ color: '#888' }}>{count}</span>
    </div>
  );
}

// ─── Executions Table ───────────────────────────────────────────────────────

function ExecutionsTable({ records }: { records: OperationRecord[] }) {
  if (records.length === 0) {
    return <div style={{ padding: 20, textAlign: 'center', fontSize: 11, fontFamily: FONT, color: '#888' }}>No executions recorded yet.</div>;
  }

  const outcomeColor = (o: string) => o === 'success' ? '#007A00' : o === 'failure' ? '#D40000' : o === 'partial' ? '#CC6600' : '#888';

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: FONT }}>
        <thead>
          <tr style={{ background: '#ECECEC' }}>
            {['TIME', 'TRIGGER', 'ACTION', 'RESULT'].map(col => (
              <th key={col} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, fontSize: 9, letterSpacing: 1, color: '#444', borderBottom: '1px solid #D0D0D0' }}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map(rec => {
            const { when } = parseSignature(`${rec.trigger.anomalyType}|${rec.trigger.metricName}|v:${rec.trigger.metricValue}`);
            return (
              <tr key={rec.operationId} style={{ borderBottom: '1px solid #F0F0F0' }}>
                <td style={{ padding: '5px 8px', color: '#555', whiteSpace: 'nowrap' }}>{relativeTime(rec.timestamp)}</td>
                <td style={{ padding: '5px 8px', color: '#0A0A0A' }}>{when}</td>
                <td style={{ padding: '5px 8px', color: '#0A0A0A' }}>{humanAction(rec.action)}</td>
                <td style={{ padding: '5px 8px', color: outcomeColor(rec.outcome), fontWeight: 700, textTransform: 'uppercase' }}>{rec.outcome}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface StatusData {
  ledger: { total: number; lastTimestamp: string | null };
  playbooks: { total: number; needsReview: number };
  scheduler: { nextCron: string };
}

export function PlaybooksTab() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [playbooks, setPlaybooks] = useState<EvolvedPlaybook[]>([]);
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [updatedPlaybookIds, setUpdatedPlaybookIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showLearning, setShowLearning] = useState(false);

  void updatedPlaybookIds; // used by simulate callback

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, playbooksRes, ledgerRes] = await Promise.all([
        fetch(`${BASE_PATH}/api/playbook-evolution?action=status`),
        fetch(`${BASE_PATH}/api/playbook-evolution?action=playbooks`),
        fetch(`${BASE_PATH}/api/playbook-evolution?action=ledger&limit=20`),
      ]);
      if (!statusRes.ok || !playbooksRes.ok || !ledgerRes.ok) throw new Error('Failed to fetch playbook data');
      const statusData = (await statusRes.json()) as StatusData;
      const playbooksData = (await playbooksRes.json()) as { playbooks: EvolvedPlaybook[] };
      const ledgerData = (await ledgerRes.json()) as { records: OperationRecord[]; total: number };
      setStatus(statusData);
      setPlaybooks(playbooksData.playbooks ?? []);
      setRecords(ledgerData.records ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const interval = setInterval(() => void fetchAll(), 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleAction = useCallback(async (id: string, action: string) => {
    try {
      const res = await fetch(`${BASE_PATH}/api/playbook-evolution?action=${action}&id=${encodeURIComponent(id)}`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Action ${action} failed (${res.status})`); }
      await fetchAll();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unknown error'); }
  }, [fetchAll]);

  const handleRunNow = useCallback(async () => {
    setRunning(true); setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/playbook-evolution?action=mine`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body.error || `Mine failed (${res.status})`); }
      const data = await res.json() as { patterns: number; saved: string[]; skipped: string[] };
      await fetchAll();
      setResult({ type: 'success', message: data.saved.length > 0 ? `Found ${data.patterns} patterns, saved ${data.saved.length} playbooks.` : data.patterns > 0 ? `Found ${data.patterns} patterns but none were new.` : 'No patterns found yet.' });
    } catch (err) { setResult({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }); }
    finally { setRunning(false); }
  }, [fetchAll]);

  const handleSimulate = useCallback(async () => {
    setSimulating(true); setResult(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/test/demo-scenario?scenario=simulate`);
      if (!res.ok) { const body = await res.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || `Simulation failed (${res.status})`); }
      const data = await res.json() as { ok: boolean; seeded: number; patternsFound: number; targetPlaybookId: string | null; diff: { versionBefore: number; versionAfter: number; confidenceBefore: number; confidenceAfter: number } | null };
      await fetchAll();
      if (data.targetPlaybookId) { setUpdatedPlaybookIds(new Set([data.targetPlaybookId])); setTimeout(() => setUpdatedPlaybookIds(new Set()), 4000); }
      if (data.diff) { setResult({ type: 'success', message: `Simulated ${data.seeded} incidents — v${data.diff.versionBefore}→v${data.diff.versionAfter}, confidence ${data.diff.confidenceBefore}%→${data.diff.confidenceAfter}%` }); }
      else { setResult({ type: 'success', message: `Simulated ${data.seeded} incidents, found ${data.patternsFound} patterns.` }); }
    } catch (err) { setResult({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' }); }
    finally { setSimulating(false); }
  }, [fetchAll]);

  // ── Derived state ──

  const learning = playbooks.filter(p => p.reviewStatus === 'draft' || p.reviewStatus === 'pending');
  const operational = playbooks.filter(p => p.reviewStatus === 'approved' || p.reviewStatus === 'suspended');
  const sorted = sortPlaybooks(operational);
  const attentionCount = sorted.filter(needsAttention).length;

  // ── Render ──

  if (loading) return <div style={{ padding: 40, textAlign: 'center', fontFamily: FONT, fontSize: 12, color: '#888' }}>Loading playbooks…</div>;

  if (error) return (
    <div style={{ padding: 20, fontFamily: FONT, fontSize: 11, color: '#D40000', background: '#FFF5F5', border: '1px solid #D40000' }}>
      <strong>ERROR</strong>: {error}
      <button onClick={() => void fetchAll()} style={{ marginLeft: 12, background: '#D40000', color: '#FFF', border: 'none', padding: '3px 8px', fontSize: 10, fontFamily: FONT, cursor: 'pointer' }}>RETRY</button>
    </div>
  );

  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <StatusBar totalRecords={status?.ledger.total ?? 0} lastTimestamp={status?.ledger.lastTimestamp ?? null} onRunNow={() => void handleRunNow()} running={running} onSimulate={() => void handleSimulate()} simulating={simulating} />

      {result && (
        <div style={{ marginTop: 8, padding: '8px 12px', fontSize: 11, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: result.type === 'success' ? '#E8FFF5' : '#FFF5F5', border: `1px solid ${result.type === 'success' ? '#007A00' : '#D40000'}`, color: result.type === 'success' ? '#007A00' : '#D40000' }}>
          <span>{result.message}</span>
          <button onClick={() => setResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#888', padding: '0 4px', fontFamily: FONT }}>x</button>
        </div>
      )}

      <div style={{ height: 12 }} />

      {playbooks.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', background: '#F9F9F9', border: '1px dashed #D0D0D0', fontFamily: FONT, fontSize: 11, color: '#888' }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: '#555' }}>No evolved playbooks yet</div>
          <div>Run <strong>RUN NOW</strong> to mine patterns from the operation ledger.</div>
        </div>
      )}

      {/* ALL PLAYBOOKS — sorted, attention first */}
      {sorted.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader label={attentionCount > 0 ? `All Playbooks — ${attentionCount} need attention` : 'All Playbooks'} count={sorted.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {sorted.map(p => needsAttention(p)
              ? <PlaybookCard key={p.playbookId} playbook={p} onAction={handleAction} />
              : <PlaybookCompactRow key={p.playbookId} playbook={p} onAction={handleAction} />
            )}
          </div>
        </div>
      )}

      {/* Learning (collapsed) */}
      {learning.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div onClick={() => setShowLearning(v => !v)} style={{ background: '#ECECEC', padding: '5px 10px', fontSize: 9, fontFamily: FONT, fontWeight: 700, letterSpacing: 1.5, color: '#444', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
            <span>{showLearning ? '▾' : '▸'} LEARNING</span>
            <span style={{ color: '#888' }}>{learning.length}</span>
          </div>
          {showLearning && learning.map(p => (
            <div key={p.playbookId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid #F0F0F0', fontSize: 10, fontFamily: FONT, color: '#888' }}>
              <span style={{ color: '#0A0A0A', fontWeight: 700, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {humanAction(p.action)} <span style={{ color: '#888', fontWeight: 400 }}>when</span> {parseSignature(p.triggerSignature).when}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ display: 'inline-block', width: 50, height: 4, background: '#E0E0E0' }}>
                  <span style={{ display: 'block', width: `${Math.round(p.confidence * 100)}%`, height: '100%', background: confidenceColor(p.confidence) }} />
                </span>
                <span style={{ color: confidenceColor(p.confidence), fontWeight: 700, fontSize: 9 }}>{Math.round(p.confidence * 100)}%</span>
              </span>
              <span style={{ flexShrink: 0 }}>{p.reviewStatus}</span>
              <button onClick={() => handleAction(p.playbookId, 'approve')} style={{ background: '#007A00', color: '#FFF', border: 'none', padding: '2px 6px', fontSize: 9, fontFamily: FONT, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>APPROVE</button>
              <button onClick={() => handleAction(p.playbookId, 'suspend')} style={{ background: '#E8E8E8', color: '#555', border: 'none', padding: '2px 6px', fontSize: 9, fontFamily: FONT, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>SKIP</button>
            </div>
          ))}
        </div>
      )}

      {/* Recent Executions */}
      <div>
        <SectionHeader label="Recent Executions" count={records.length} />
        <div style={{ marginTop: 4 }}><ExecutionsTable records={records} /></div>
      </div>
    </div>
  );
}
