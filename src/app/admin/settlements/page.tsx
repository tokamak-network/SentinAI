'use client';

import { useEffect, useState, useCallback } from 'react';

type SettlementStatus = 'submitted' | 'settled' | 'failed';

interface Settlement {
  settlementId: string;
  chainId: number;
  network: string;
  merchantId: string;
  asset: string;
  buyer: string;
  merchant: string;
  amount: string;
  resource: string;
  nonce: string;
  txHash: string;
  status: SettlementStatus;
  txStatus: SettlementStatus;
  confirmedBlock: number | null;
  transferVerified: boolean;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  total: number;
  submitted: number;
  settled: number;
  failed: number;
}

type FilterStatus = 'all' | SettlementStatus;

function formatTON(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const ton = Number(wei) / 1e18;
    return `${ton.toFixed(4)} TON`;
  } catch {
    return weiStr;
  }
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}...`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

const STATUS_COLOR: Record<SettlementStatus, string> = {
  submitted: '#d97706',
  settled: '#16a34a',
  failed: '#dc2626',
};

const STATUS_BG: Record<SettlementStatus, string> = {
  submitted: '#fffbeb',
  settled: '#f0fdf4',
  failed: '#fef2f2',
};

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, submitted: 0, settled: 0, failed: 0 });
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchSettlements = useCallback(async () => {
    try {
      const params = new URLSearchParams({ chainId: '11155111', limit: '100' });
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/admin/settlements?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSettlements(data.settlements ?? []);
      setSummary(data.summary ?? { total: 0, submitted: 0, settled: 0, failed: 0 });
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settlements');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchSettlements();
  }, [fetchSettlements]);

  useEffect(() => {
    const interval = setInterval(fetchSettlements, 30_000);
    return () => clearInterval(interval);
  }, [fetchSettlements]);

  const filters: { label: string; value: FilterStatus }[] = [
    { label: 'All', value: 'all' },
    { label: 'Submitted', value: 'submitted' },
    { label: 'Settled', value: 'settled' },
    { label: 'Failed', value: 'failed' },
  ];

  return (
    <div style={{ padding: '0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#111827' }}>
          Settlements
        </h1>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0' }}>
          Monitor x402 payment settlements on Sepolia.
          {lastRefreshed && (
            <span style={{ marginLeft: '12px', fontSize: '12px', color: '#9ca3af' }}>
              Last updated: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </p>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {filters.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: filter === value ? 600 : 400,
              border: filter === value ? '1px solid #3b82f6' : '1px solid #d1d5db',
              borderRadius: '6px',
              backgroundColor: filter === value ? '#eff6ff' : '#ffffff',
              color: filter === value ? '#3b82f6' : '#374151',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => { setLoading(true); fetchSettlements(); }}
          style={{
            marginLeft: 'auto',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 500,
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            backgroundColor: '#ffffff',
            color: '#374151',
            cursor: 'pointer',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          color: '#dc2626',
          fontSize: '13px',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {/* Summary Bar */}
      <div style={{
        display: 'flex',
        gap: '16px',
        padding: '12px 16px',
        background: '#f9fafb',
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        marginBottom: '16px',
        fontSize: '13px',
        color: '#374151',
        flexWrap: 'wrap',
      }}>
        <span><strong>{summary.total}</strong> total</span>
        <span style={{ color: '#16a34a' }}><strong>{summary.settled}</strong> settled</span>
        <span style={{ color: '#d97706' }}><strong>{summary.submitted}</strong> submitted</span>
        <span style={{ color: '#dc2626' }}><strong>{summary.failed}</strong> failed</span>
      </div>

      {/* Table */}
      <div style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 1fr',
          padding: '10px 16px',
          backgroundColor: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '12px',
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          <span>ID</span>
          <span>Buyer</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Time</span>
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
            Loading settlements...
          </div>
        ) : settlements.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
            No settlements found.
          </div>
        ) : (
          settlements.map((s) => (
            <div key={s.settlementId}>
              {/* Row */}
              <div
                onClick={() => setExpandedId(expandedId === s.settlementId ? null : s.settlementId)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 1.5fr 1fr 1fr 1fr',
                  padding: '12px 16px',
                  borderBottom: '1px solid #f3f4f6',
                  cursor: 'pointer',
                  fontSize: '13px',
                  backgroundColor: expandedId === s.settlementId ? '#f8fafc' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (expandedId !== s.settlementId) e.currentTarget.style.backgroundColor = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  if (expandedId !== s.settlementId) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>
                  {shortId(s.settlementId)}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>
                  {shortAddr(s.buyer)}
                </span>
                <span style={{ color: '#374151', fontWeight: 500 }}>
                  {formatTON(s.amount)}
                </span>
                <span>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: STATUS_COLOR[s.status],
                    backgroundColor: STATUS_BG[s.status],
                  }}>
                    {s.status}
                  </span>
                </span>
                <span style={{ color: '#6b7280' }}>
                  {formatTime(s.createdAt)}
                </span>
              </div>

              {/* Expanded Details */}
              {expandedId === s.settlementId && (
                <div style={{
                  padding: '16px 24px',
                  backgroundColor: '#f8fafc',
                  borderBottom: '1px solid #e5e7eb',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                    <div>
                      <span style={{ color: '#6b7280' }}>Settlement ID: </span>
                      <span style={{ color: '#111827', wordBreak: 'break-all' }}>{s.settlementId}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Tx Hash: </span>
                      <span style={{ color: '#111827', wordBreak: 'break-all' }}>{s.txHash}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Buyer: </span>
                      <span style={{ color: '#111827' }}>{s.buyer}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Merchant: </span>
                      <span style={{ color: '#111827' }}>{s.merchant}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Resource: </span>
                      <span style={{ color: '#111827' }}>{s.resource}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Merchant ID: </span>
                      <span style={{ color: '#111827' }}>{s.merchantId}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Nonce: </span>
                      <span style={{ color: '#111827', wordBreak: 'break-all' }}>{s.nonce}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Confirmed Block: </span>
                      <span style={{ color: '#111827' }}>{s.confirmedBlock ?? 'pending'}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Transfer Verified: </span>
                      <span style={{ color: s.transferVerified ? '#16a34a' : '#dc2626' }}>
                        {s.transferVerified ? 'yes' : 'no'}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Tx Status: </span>
                      <span style={{ color: STATUS_COLOR[s.txStatus] }}>{s.txStatus}</span>
                    </div>
                    {s.failureReason && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ color: '#6b7280' }}>Failure Reason: </span>
                        <span style={{ color: '#dc2626' }}>{s.failureReason}</span>
                      </div>
                    )}
                    <div>
                      <span style={{ color: '#6b7280' }}>Created: </span>
                      <span style={{ color: '#111827' }}>{new Date(s.createdAt).toLocaleString()}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Updated: </span>
                      <span style={{ color: '#111827' }}>{new Date(s.updatedAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
