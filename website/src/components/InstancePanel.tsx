'use client';

import { useEffect, useState } from 'react';
import { getServiceCatalog } from '@/lib/agent-marketplace';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OperatorInfo {
  operatorAddress?: string;
  registrationStatus?: 'REGISTERED' | 'NOT_REGISTERED' | 'UNKNOWN';
  agentId?: string | number;
  network?: string;
}

interface OpsSnapshot {
  cpuUsage?: number;
  memoryUsageMB?: number;
  txPoolSize?: number;
  gasPriceGwei?: number;
  scalingState?: string;
  anomalies?: Array<{ severity: string; message: string }>;
  activeAnomalyCount?: number;
}

interface ServiceBreakdownEntry {
  service: string;
  requests: number;
  volumeTON?: string;
}

interface OpsSummary {
  totalRequests?: number;
  distinctBuyers?: number;
  slaUptime?: number;
  serviceBreakdown?: ServiceBreakdownEntry[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionBar({ children }: { children: string }) {
  return (
    <div style={{
      background: '#0A0A0A', color: 'white',
      padding: '3px 14px', fontFamily: FONT, fontSize: 9, fontWeight: 700,
      letterSpacing: '0.15em', textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px', borderRight: '1px solid #E0E0E0', minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 20, fontWeight: 700, color: '#D40000',
        letterSpacing: '-0.01em', marginBottom: 4, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070',
        letterSpacing: '0.15em', textTransform: 'uppercase',
      }}>
        {label}
      </div>
    </div>
  );
}

function StatusBadge({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', background: color, color: 'white',
      padding: '2px 8px', borderRadius: 2,
    }}>
      {text}
    </span>
  );
}

function KVRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '6px 0', borderBottom: '1px solid #EBEBEB',
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070', width: 140, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </span>
      {children ?? (
        <span style={{ fontFamily: FONT, fontSize: 10, color: '#0A0A0A', wordBreak: 'break-all' }}>
          {value ?? '---'}
        </span>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InstancePanel() {
  const [operatorInfo, setOperatorInfo] = useState<OperatorInfo | null>(null);
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const baseUrl = getServiceCatalog().agent.baseUrl;

  const fetchAll = async () => {
    const results = await Promise.allSettled([
      fetch(`${baseUrl}/api/agent-marketplace/ops/operator-info`).then((r) => r.json()),
      fetch(`${baseUrl}/api/agent-marketplace/ops-snapshot.json`).then((r) => r.json()),
      fetch(`${baseUrl}/api/agent-marketplace/ops/summary`).then((r) => r.json()),
    ]);

    let anySuccess = false;

    if (results[0].status === 'fulfilled') {
      setOperatorInfo(results[0].value as OperatorInfo);
      anySuccess = true;
    }
    if (results[1].status === 'fulfilled') {
      setSnapshot(results[1].value as OpsSnapshot);
      anySuccess = true;
    }
    if (results[2].status === 'fulfilled') {
      setSummary(results[2].value as OpsSummary);
      anySuccess = true;
    }

    setOffline(!anySuccess);
    setLastRefresh(new Date());
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  if (offline) {
    return (
      <div style={{
        padding: 32, background: '#F7F7F7', border: '1px solid #D0D0D0',
        fontFamily: FONT, fontSize: 10, color: '#707070', textAlign: 'center',
      }}>
        Operator instance is offline or unreachable.
      </div>
    );
  }

  const scalingColor: Record<string, string> = {
    STABLE: '#007A00',
    SCALING_UP: '#D40000',
    SCALING_DOWN: '#E8A000',
  };

  const regStatusColor = operatorInfo?.registrationStatus === 'REGISTERED' ? '#007A00' : '#707070';

  return (
    <div style={{ background: '#F7F7F7', border: '1px solid #D0D0D0' }}>

      {/* Header */}
      <div style={{
        background: '#0A0A0A', color: 'white', padding: '3px 14px',
        fontFamily: FONT, fontSize: 9, fontWeight: 700,
        letterSpacing: '0.15em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
          background: offline ? '#888' : '#00C853',
        }} />
        Operator Instance
        {lastRefresh && (
          <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.6 }}>
            updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Operator Info */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #D0D0D0' }}>
        <SectionBar>Operator Info</SectionBar>
        <div style={{ padding: '12px 0' }}>
          <KVRow label="Operator Wallet">
            <span style={{ fontFamily: FONT, fontSize: 10, color: '#0A0A0A', wordBreak: 'break-all' }}>
              {operatorInfo?.operatorAddress
                ? `${operatorInfo.operatorAddress.slice(0, 10)}...${operatorInfo.operatorAddress.slice(-8)}`
                : '---'}
            </span>
          </KVRow>
          <KVRow label="Registration">
            {operatorInfo?.registrationStatus ? (
              <StatusBadge
                text={operatorInfo.registrationStatus}
                color={regStatusColor}
              />
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>---</span>
            )}
          </KVRow>
          <KVRow
            label="Agent ID"
            value={operatorInfo?.agentId !== undefined ? `#${operatorInfo.agentId}` : '---'}
          />
          <KVRow
            label="Network"
            value={operatorInfo?.network ?? 'Sepolia'}
          />
        </div>
      </div>

      {/* System Health */}
      {snapshot && (
        <div style={{ borderBottom: '1px solid #D0D0D0' }}>
          <div style={{ padding: '16px 20px 0' }}>
            <SectionBar>System Health</SectionBar>
          </div>
          <div style={{ display: 'flex', borderTop: '1px solid #D0D0D0', borderBottom: '1px solid #E0E0E0' }}>
            <MetricCell label="CPU Usage" value={snapshot.cpuUsage !== undefined ? `${snapshot.cpuUsage}%` : '---'} />
            <MetricCell label="Memory (MB)" value={snapshot.memoryUsageMB !== undefined ? String(snapshot.memoryUsageMB) : '---'} />
            <MetricCell label="TX Pool" value={snapshot.txPoolSize !== undefined ? String(snapshot.txPoolSize) : '---'} />
            <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: '#D40000', letterSpacing: '-0.01em', marginBottom: 4 }}>
                {snapshot.gasPriceGwei !== undefined ? `${snapshot.gasPriceGwei}` : '---'}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Gas (Gwei)
              </div>
            </div>
          </div>
          <div style={{ padding: '12px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Scaling State
            </span>
            {snapshot.scalingState ? (
              <StatusBadge
                text={snapshot.scalingState}
                color={scalingColor[snapshot.scalingState] ?? '#707070'}
              />
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>---</span>
            )}
            {(snapshot.activeAnomalyCount ?? 0) > 0 && (
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#D40000', marginLeft: 12 }}>
                {snapshot.activeAnomalyCount} active anomal{snapshot.activeAnomalyCount === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>
          {snapshot.anomalies && snapshot.anomalies.length > 0 && (
            <div style={{ padding: '0 20px 12px' }}>
              {snapshot.anomalies.slice(0, 5).map((a, i) => (
                <div key={i} style={{
                  fontFamily: FONT, fontSize: 9, color: '#D40000',
                  padding: '3px 0', borderTop: i === 0 ? '1px solid #EBEBEB' : undefined,
                }}>
                  [{a.severity?.toUpperCase() ?? 'WARN'}] {a.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Service Stats */}
      {summary && (
        <div style={{ padding: '16px 20px' }}>
          <SectionBar>Service Stats</SectionBar>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E0E0E0', marginTop: 0 }}>
            <MetricCell label="Total Requests" value={summary.totalRequests !== undefined ? String(summary.totalRequests) : '---'} />
            <MetricCell label="Distinct Buyers" value={summary.distinctBuyers !== undefined ? String(summary.distinctBuyers) : '---'} />
            <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: '#D40000', letterSpacing: '-0.01em', marginBottom: 4 }}>
                {summary.slaUptime !== undefined ? `${summary.slaUptime.toFixed(2)}%` : '---'}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, color: '#707070', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                SLA Uptime
              </div>
            </div>
          </div>
          {summary.serviceBreakdown && summary.serviceBreakdown.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 100px',
                fontFamily: FONT, fontSize: 8, color: '#707070',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '4px 0', borderBottom: '1px solid #EBEBEB',
              }}>
                <span>Service</span>
                <span style={{ textAlign: 'right' }}>Requests</span>
                <span style={{ textAlign: 'right' }}>Volume</span>
              </div>
              {summary.serviceBreakdown.map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 100px',
                  fontFamily: FONT, fontSize: 9, color: '#0A0A0A',
                  padding: '5px 0', borderBottom: '1px solid #F0F0F0',
                }}>
                  <span>{row.service}</span>
                  <span style={{ textAlign: 'right', color: '#D40000' }}>{row.requests}</span>
                  <span style={{ textAlign: 'right', color: '#707070' }}>{row.volumeTON ?? '---'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
