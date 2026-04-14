'use client';

/**
 * Autonomy Feed Panel
 *
 * Shows real-time evidence that the pipeline is running autonomously:
 * - Recent autonomous decisions / actions from the ledger
 * - Guardrail events (suppressed / blocked)
 * - AI fallback triggers
 *
 * Polls /api/autonomy-ledger every 15 seconds.
 */

import { useEffect, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type LedgerEntryKind =
  | 'decision_taken'
  | 'action_executed'
  | 'action_suppressed'
  | 'fallback_triggered'
  | 'guardrail_blocked';

interface LedgerEntry {
  id: string;
  kind: LedgerEntryKind;
  timestamp: string;
  agent?: string;
  action?: string;
  playbook?: string;
  verdict?: string;
  suppressionReason?: string;
  meta?: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function kindLabel(kind: LedgerEntryKind): string {
  switch (kind) {
    case 'decision_taken':    return 'Decision';
    case 'action_executed':   return 'Executed';
    case 'action_suppressed': return 'Suppressed';
    case 'fallback_triggered':return 'Fallback';
    case 'guardrail_blocked': return 'Blocked';
  }
}

function kindColor(kind: LedgerEntryKind): string {
  switch (kind) {
    case 'decision_taken':    return '#60A5FA'; // blue
    case 'action_executed':   return '#34D399'; // green
    case 'action_suppressed': return '#FBBF24'; // amber
    case 'fallback_triggered':return '#A78BFA'; // purple
    case 'guardrail_blocked': return '#F87171'; // red
  }
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000)  return `${Math.round(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`;
  return `${Math.round(diffMs / 3_600_000)}h ago`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AutonomyFeedPanel() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerEntryKind | 'all'>('all');

  const fetchFeed = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (filter !== 'all') params.set('kind', filter);
      const res = await fetch(`/api/autonomy-ledger?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchFeed();
    const id = setInterval(fetchFeed, 15_000);
    return () => clearInterval(id);
  }, [fetchFeed]);

  const kindsToShow: Array<LedgerEntryKind | 'all'> = [
    'all', 'action_executed', 'action_suppressed', 'guardrail_blocked', 'fallback_triggered',
  ];

  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{
      borderTop: '1px solid #D0D0D0',
      padding: '10px 16px 8px',
      background: '#0A0A0A',
      color: '#E5E7EB',
      fontSize: '11px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Pulsing dot — shows the pipeline is alive */}
          <span style={{
            display: 'inline-block',
            width: 7, height: 7,
            borderRadius: '50%',
            background: error ? '#F87171' : '#34D399',
            animation: error ? 'none' : 'pulse 2s infinite',
          }} />
          <span style={{ fontWeight: 600, color: '#9CA3AF', letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: 10 }}>
            Autonomous Activity
          </span>
        </div>

        {/* Kind summary badges */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['action_executed', 'action_suppressed', 'guardrail_blocked', 'fallback_triggered'] as const).map(k => (
            counts[k] ? (
              <span key={k} style={{
                padding: '1px 6px',
                borderRadius: 4,
                background: kindColor(k) + '22',
                color: kindColor(k),
                border: `1px solid ${kindColor(k)}55`,
              }}>
                {kindLabel(k)}: {counts[k]}
              </span>
            ) : null
          ))}
        </div>

        {/* Filter buttons */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {kindsToShow.map(k => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              style={{
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 10,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: filter === k ? '#6B7280' : '#374151',
                background: filter === k ? '#374151' : 'transparent',
                color: filter === k ? '#E5E7EB' : '#6B7280',
              }}
            >
              {k === 'all' ? 'All' : kindLabel(k as LedgerEntryKind)}
            </button>
          ))}
        </div>
      </div>

      {/* Feed rows */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {loading && (
          <span style={{ color: '#6B7280', fontStyle: 'italic' }}>Loading...</span>
        )}
        {!loading && error && (
          <span style={{ color: '#F87171' }}>Error: {error}</span>
        )}
        {!loading && !error && entries.length === 0 && (
          <span style={{ color: '#6B7280', fontStyle: 'italic' }}>
            No autonomous activity recorded yet. The pipeline will log here as it runs.
          </span>
        )}
        {!loading && entries.map(entry => (
          <div key={entry.id} style={{
            flexShrink: 0,
            padding: '4px 8px',
            borderRadius: 6,
            border: `1px solid ${kindColor(entry.kind)}44`,
            background: kindColor(entry.kind) + '11',
            minWidth: 160,
            maxWidth: 220,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <span style={{
                color: kindColor(entry.kind),
                fontWeight: 600,
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {kindLabel(entry.kind)}
              </span>
              <span style={{ color: '#4B5563', marginLeft: 'auto', fontSize: 9 }}>
                {relativeTime(entry.timestamp)}
              </span>
            </div>
            {entry.action && (
              <div style={{ color: '#D1D5DB', fontFamily: 'monospace', fontSize: 10 }}>
                {entry.action}
              </div>
            )}
            {entry.agent && (
              <div style={{ color: '#6B7280', fontSize: 9 }}>
                {entry.agent}
              </div>
            )}
            {entry.suppressionReason && (
              <div style={{ color: '#FBBF24', fontSize: 9 }}>
                reason: {entry.suppressionReason}
              </div>
            )}
            {entry.verdict && (
              <div style={{ color: '#9CA3AF', fontSize: 9 }} title={entry.verdict}>
                {entry.verdict.length > 40 ? entry.verdict.slice(0, 40) + '…' : entry.verdict}
              </div>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
