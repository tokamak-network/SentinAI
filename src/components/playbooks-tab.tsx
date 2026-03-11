'use client';

import { useEffect, useState, useCallback } from 'react';
import type { EvolvedPlaybook, OperationRecord } from '@/core/playbook-system/types';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

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
  'scale-up': 'Scale up resources',
  'refill-eoa': 'Refill EOA wallet',
  unknown: '—',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * triggerSignature format: "threshold|tx_pool_pending|z:3.5|v:1000"
 * Parts: [anomalyType, metricName, z:..., v:...]
 */
function parseSignature(sig: string): { when: string; anomalyType: string } {
  const parts = sig.split('|');
  const anomalyType = parts[0] ?? 'threshold';
  const metricName = parts[1] ?? '';
  const valuePart = parts.find(p => p.startsWith('v:'));
  const value = valuePart ? valuePart.slice(2) : null;

  const op = ANOMALY_OP[anomalyType] ?? '>';
  const label = METRIC_LABEL[metricName] ?? metricName.replace(/_/g, ' ');

  const when = value ? `${label} ${op} ${value}` : `${label} ${op}`;
  return { when, anomalyType };
}

function humanAction(action: string): string {
  return ACTION_LABEL[action] ?? action.replace(/-/g, ' ');
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

// ─── Sub-components ──────────────────────────────────────────────────────────

interface StatusBarProps {
  totalRecords: number;
  lastTimestamp: string | null;
  onRunNow: () => void;
  running: boolean;
}

function StatusBar({ totalRecords, lastTimestamp, onRunNow, running }: StatusBarProps) {
  const font = "'IBM Plex Mono', monospace";
  return (
    <div
      style={{
        background: '#F5F5F5',
        border: '1px solid #D8D8D8',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        fontSize: 11,
        fontFamily: font,
        color: '#0A0A0A',
      }}
    >
      <span>
        RECORDS <strong>{totalRecords}</strong>
      </span>
      <span style={{ color: '#555' }}>|</span>
      <span>
        LAST LEARNED{' '}
        <strong>{relativeTime(lastTimestamp)}</strong>
      </span>
      <span style={{ color: '#555' }}>|</span>
      <span>
        NEXT AUTO-RUN{' '}
        <strong>00:05 UTC</strong>{' '}
        <span
          style={{
            background: '#0055AA',
            color: '#FFF',
            padding: '1px 5px',
            fontSize: 9,
            fontFamily: font,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          DAILY
        </span>
      </span>
      <button
        onClick={onRunNow}
        disabled={running}
        style={{
          marginLeft: 'auto',
          background: running ? '#888' : '#0A0A0A',
          color: '#FFF',
          border: 'none',
          padding: '4px 10px',
          fontSize: 10,
          fontFamily: font,
          fontWeight: 700,
          cursor: running ? 'not-allowed' : 'pointer',
          letterSpacing: 0.5,
        }}
      >
        {running ? '⏳ RUNNING…' : '▶ RUN NOW'}
      </button>
    </div>
  );
}

interface PlaybookCardProps {
  playbook: EvolvedPlaybook;
  onAction: (id: string, action: 'approve' | 'promote' | 'suspend') => void;
}

function PlaybookCard({ playbook, onAction }: PlaybookCardProps) {
  const font = "'IBM Plex Mono', monospace";
  const { when, anomalyType } = parseSignature(playbook.triggerSignature);
  const action = humanAction(playbook.action);

  const borderColor =
    playbook.reviewStatus === 'trusted'
      ? '#007A00'
      : playbook.reviewStatus === 'approved'
      ? '#0055AA'
      : '#D40000';

  const badgeStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '1px 6px',
    fontSize: 9,
    fontFamily: font,
    fontWeight: 700,
    letterSpacing: 1,
    ...(playbook.reviewStatus === 'trusted'
      ? { background: '#E8FFF5', color: '#007A00' }
      : playbook.reviewStatus === 'approved'
      ? { background: '#E8F0FF', color: '#0055AA' }
      : { background: '#FFF8E0', color: '#AA6600' }),
  };

  const successPct = Math.round(playbook.performance.successRate * 100);
  const confColor = confidenceColor(playbook.confidence);
  const confPct = Math.round(playbook.confidence * 100);

  return (
    <div
      style={{
        background: '#FFF',
        borderLeft: `3px solid ${borderColor}`,
        border: `1px solid #E0E0E0`,
        borderLeftWidth: 3,
        borderLeftColor: borderColor,
        padding: '10px 12px',
        fontFamily: font,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0A0A0A' }}>
            {action} when {when}
          </span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 9,
              color: '#888',
              textTransform: 'uppercase',
            }}
          >
            v{playbook.evolution.version}
          </span>
        </div>
        <span style={badgeStyle}>{playbook.reviewStatus.toUpperCase()}</span>
      </div>

      {/* WHEN → DO layout */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 10,
          fontSize: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            background: '#FFF8E0',
            border: '1px solid #E8D8A0',
            padding: '6px 8px',
          }}
        >
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: '#888',
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            WHEN THIS HAPPENS
          </div>
          <div style={{ color: '#0A0A0A' }}>
            {ANOMALY_OP[anomalyType] ?? '>'}{' '}
            <span style={{ fontWeight: 700 }}>{when}</span>
          </div>
        </div>
        <div
          style={{
            fontSize: 16,
            color: '#888',
            alignSelf: 'center',
            flexShrink: 0,
          }}
        >
          →
        </div>
        <div
          style={{
            flex: 1,
            background: '#E8F0FF',
            border: '1px solid #A0B8E8',
            padding: '6px 8px',
          }}
        >
          <div
            style={{
              fontSize: 8,
              fontWeight: 700,
              color: '#888',
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            DO THIS
          </div>
          <div style={{ color: '#0A0A0A', fontWeight: 700 }}>{action}</div>
        </div>
      </div>

      {/* Evidence row */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          fontSize: 10,
          color: '#555',
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <span>
          INCIDENTS{' '}
          <strong style={{ color: '#0A0A0A' }}>
            {playbook.performance.totalApplications}
          </strong>
        </span>
        <span>|</span>
        <span>
          RESOLVED{' '}
          <strong style={{ color: '#0A0A0A' }}>{successPct}%</strong>
        </span>
        <span>|</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          SUCCESS RATE
          <span
            style={{
              display: 'inline-block',
              width: 80,
              height: 6,
              background: '#E0E0E0',
              position: 'relative',
              verticalAlign: 'middle',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${successPct}%`,
                height: '100%',
                background: confidenceColor(playbook.performance.successRate),
              }}
            />
          </span>
          <span style={{ color: confidenceColor(playbook.performance.successRate) }}>
            {successPct}%
          </span>
        </span>
        <span>|</span>
        <span>
          CONFIDENCE{' '}
          <strong style={{ color: confColor }}>{confPct}%</strong>
        </span>
        <span>|</span>
        <span>
          LAST{' '}
          <strong>{relativeTime(playbook.performance.lastApplied)}</strong>
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(playbook.reviewStatus === 'draft' || playbook.reviewStatus === 'pending') && (
          <>
            <button
              onClick={() => onAction(playbook.playbookId, 'approve')}
              style={{
                background: '#D40000',
                color: '#FFF',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                fontFamily: font,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              APPROVE
            </button>
            <button
              onClick={() => onAction(playbook.playbookId, 'suspend')}
              style={{
                background: '#E8E8E8',
                color: '#555',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                fontFamily: font,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              SKIP
            </button>
          </>
        )}
        {playbook.reviewStatus === 'approved' && (
          <>
            <button
              onClick={() => onAction(playbook.playbookId, 'promote')}
              style={{
                background: '#0055AA',
                color: '#FFF',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                fontFamily: font,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              MARK TRUSTED
            </button>
            <button
              onClick={() => onAction(playbook.playbookId, 'suspend')}
              style={{
                background: '#E8E8E8',
                color: '#555',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                fontFamily: font,
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.5,
              }}
            >
              SUSPEND
            </button>
          </>
        )}
        {playbook.reviewStatus === 'trusted' && (
          <button
            onClick={() => onAction(playbook.playbookId, 'suspend')}
            style={{
              background: '#E8E8E8',
              color: '#555',
              border: 'none',
              padding: '4px 10px',
              fontSize: 10,
              fontFamily: font,
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: 0.5,
            }}
          >
            SUSPEND
          </button>
        )}
      </div>
    </div>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
}

function SectionHeader({ label, count }: SectionHeaderProps) {
  return (
    <div
      style={{
        background: '#ECECEC',
        padding: '5px 10px',
        fontSize: 9,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 700,
        letterSpacing: 1.5,
        color: '#444',
        textTransform: 'uppercase' as const,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{label}</span>
      <span style={{ color: '#888' }}>{count}</span>
    </div>
  );
}

interface ExecutionsTableProps {
  records: OperationRecord[];
}

function ExecutionsTable({ records }: ExecutionsTableProps) {
  const font = "'IBM Plex Mono', monospace";

  if (records.length === 0) {
    return (
      <div
        style={{
          padding: '20px',
          textAlign: 'center',
          fontSize: 11,
          fontFamily: font,
          color: '#888',
        }}
      >
        No executions recorded yet.
      </div>
    );
  }

  const outcomeColor = (outcome: string) => {
    if (outcome === 'success') return '#007A00';
    if (outcome === 'failure') return '#D40000';
    if (outcome === 'partial') return '#CC6600';
    return '#888';
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 10,
          fontFamily: font,
        }}
      >
        <thead>
          <tr style={{ background: '#ECECEC' }}>
            {['TIME', 'TRIGGER', 'ACTION', 'RESULT'].map(col => (
              <th
                key={col}
                style={{
                  padding: '5px 8px',
                  textAlign: 'left',
                  fontWeight: 700,
                  fontSize: 9,
                  letterSpacing: 1,
                  color: '#444',
                  borderBottom: '1px solid #D0D0D0',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map(rec => {
            const { when } = parseSignature(
              `${rec.trigger.anomalyType}|${rec.trigger.metricName}|v:${rec.trigger.metricValue}`
            );
            return (
              <tr
                key={rec.operationId}
                style={{ borderBottom: '1px solid #F0F0F0' }}
              >
                <td
                  style={{ padding: '5px 8px', color: '#555', whiteSpace: 'nowrap' }}
                >
                  {relativeTime(rec.timestamp)}
                </td>
                <td style={{ padding: '5px 8px', color: '#0A0A0A' }}>{when}</td>
                <td style={{ padding: '5px 8px', color: '#0A0A0A' }}>
                  {humanAction(rec.action)}
                </td>
                <td
                  style={{
                    padding: '5px 8px',
                    color: outcomeColor(rec.outcome),
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {rec.outcome}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Data Types ──────────────────────────────────────────────────────────────

interface StatusData {
  ledger: { total: number; lastTimestamp: string | null };
  playbooks: { total: number; needsReview: number };
  scheduler: { nextCron: string };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PlaybooksTab() {
  const font = "'IBM Plex Mono', monospace";

  const [status, setStatus] = useState<StatusData | null>(null);
  const [playbooks, setPlaybooks] = useState<EvolvedPlaybook[]>([]);
  const [records, setRecords] = useState<OperationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, playbooksRes, ledgerRes] = await Promise.all([
        fetch(`${BASE_PATH}/api/playbook-evolution?action=status`),
        fetch(`${BASE_PATH}/api/playbook-evolution?action=playbooks`),
        fetch(`${BASE_PATH}/api/playbook-evolution?action=ledger&limit=20`),
      ]);

      if (!statusRes.ok || !playbooksRes.ok || !ledgerRes.ok) {
        throw new Error('Failed to fetch playbook data');
      }

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

  const handleAction = useCallback(
    async (id: string, action: 'approve' | 'promote' | 'suspend') => {
      try {
        const res = await fetch(
          `${BASE_PATH}/api/playbook-evolution?action=${action}&id=${encodeURIComponent(id)}`,
          { method: 'POST' }
        );
        if (!res.ok) throw new Error(`Action ${action} failed`);
        await fetchAll();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [fetchAll]
  );

  const handleRunNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/playbook-evolution?action=mine`, { method: 'POST' });
      if (!res.ok) throw new Error('Mine operation failed');
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }, [fetchAll]);

  // ── Derived state ──

  const needsReview = playbooks.filter(
    p => p.reviewStatus === 'draft' || p.reviewStatus === 'pending'
  );
  const activePlaybooks = playbooks.filter(
    p => p.reviewStatus === 'approved' || p.reviewStatus === 'trusted'
  );

  // ── Render ──

  if (loading) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: font,
          fontSize: 12,
          color: '#888',
        }}
      >
        Loading playbooks…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 20,
          fontFamily: font,
          fontSize: 11,
          color: '#D40000',
          background: '#FFF5F5',
          border: '1px solid #D40000',
        }}
      >
        <strong>ERROR</strong>: {error}
        <button
          onClick={() => void fetchAll()}
          style={{
            marginLeft: 12,
            background: '#D40000',
            color: '#FFF',
            border: 'none',
            padding: '3px 8px',
            fontSize: 10,
            fontFamily: font,
            cursor: 'pointer',
          }}
        >
          RETRY
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: font, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Status Bar */}
      <StatusBar
        totalRecords={status?.ledger.total ?? 0}
        lastTimestamp={status?.ledger.lastTimestamp ?? null}
        onRunNow={() => void handleRunNow()}
        running={running}
      />

      <div style={{ height: 12 }} />

      {/* Empty state */}
      {playbooks.length === 0 && (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: '#F9F9F9',
            border: '1px dashed #D0D0D0',
            fontFamily: font,
            fontSize: 11,
            color: '#888',
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
          <div style={{ fontWeight: 700, marginBottom: 4, color: '#555' }}>
            No evolved playbooks yet
          </div>
          <div>
            Run <strong>▶ RUN NOW</strong> to mine patterns from the operation ledger.
          </div>
        </div>
      )}

      {/* NEEDS REVIEW section */}
      {needsReview.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader label="Needs Review" count={needsReview.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {needsReview.map(p => (
              <PlaybookCard key={p.playbookId} playbook={p} onAction={handleAction} />
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE PLAYBOOKS section */}
      {activePlaybooks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader label="Active Playbooks" count={activePlaybooks.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {activePlaybooks.map(p => (
              <PlaybookCard key={p.playbookId} playbook={p} onAction={handleAction} />
            ))}
          </div>
        </div>
      )}

      {/* Recent Executions */}
      <div>
        <SectionHeader label="Recent Executions" count={records.length} />
        <div style={{ marginTop: 4 }}>
          <ExecutionsTable records={records} />
        </div>
      </div>
    </div>
  );
}
