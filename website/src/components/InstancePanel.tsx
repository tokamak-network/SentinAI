'use client';

import { useEffect, useState } from 'react';
import { getServiceCatalog } from '@/lib/agent-marketplace';

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

// ─── Raw API response types (matching actual server responses) ─────────────────

interface OperatorInfoRaw {
  address: string | null;
  registered: boolean;
  agentId: string | number | null;
  agentUri: string | null;
  contractAddress: string | null;
}

interface OpsSnapshotRaw {
  version: string;
  generatedAt: string;
  chain?: { chainType: string; displayName: string };
  metrics?: {
    cpu?: { mean: number; max: number; trend: string };
    txPool?: { mean: number; max: number; trend: string };
    gasUsedRatio?: { mean: number; max: number };
    blockInterval?: { mean: number; stdDev: number };
  };
  scaling?: {
    currentVcpu: number;
    currentMemoryGiB: number;
    autoScalingEnabled: boolean;
    cooldownRemaining: number;
    lastDecisionScore: number | null;
    lastDecisionReason: string | null;
  };
  anomalies?: {
    activeCount: number;
    totalRecent: number;
  };
}

interface OpsSummaryService {
  key: string;
  displayName?: string;
  requestCount: number;
  volumeWei?: string;
}

interface OpsSummaryRaw {
  enabled: boolean;
  requestTotals: { total: number; verified: number; rejected: number; rateLimited: number };
  distinctBuyerCount: number;
  services: OpsSummaryService[];
  slaAgents?: Array<{ uptime: number }>;
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

function MetricCell({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px',
      borderRight: last ? 'none' : '1px solid #E0E0E0',
      minWidth: 0,
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
      padding: '7px 0', borderBottom: '1px solid #EBEBEB',
    }}>
      <span style={{
        fontFamily: FONT, fontSize: 9, color: '#707070',
        width: 140, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>
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

// ─── Derived helpers ──────────────────────────────────────────────────────────

function deriveScalingState(snap: OpsSnapshotRaw): string {
  const score = snap.scaling?.lastDecisionScore;
  if (score === null || score === undefined) return 'STABLE';
  if (score >= 70) return 'SCALING_UP';
  if (score <= 20) return 'SCALING_DOWN';
  return 'STABLE';
}

function formatCpu(mean: number): string {
  // mean is 0-1 fraction or already a percentage; treat >1 as percentage, <=1 as fraction
  const pct = mean > 1 ? mean : mean * 100;
  return `${pct.toFixed(1)}%`;
}

function formatMemory(gib: number): string {
  return `${gib} GiB`;
}

function formatTxPool(mean: number): string {
  return mean.toFixed(1);
}

function formatGasRatio(mean: number): string {
  return `${(mean * 100).toFixed(2)}%`;
}

function formatVolumeTON(weiStr: string): string {
  try {
    const val = Number(BigInt(weiStr)) / 1e18;
    return `${val.toFixed(3)} TON`;
  } catch {
    return '---';
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InstancePanel() {
  const [operatorInfo, setOperatorInfo] = useState<OperatorInfoRaw | null>(null);
  const [snapshot, setSnapshot] = useState<OpsSnapshotRaw | null>(null);
  const [summary, setSummary] = useState<OpsSummaryRaw | null>(null);
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
      setOperatorInfo(results[0].value as OperatorInfoRaw);
      anySuccess = true;
    }
    if (results[1].status === 'fulfilled') {
      setSnapshot(results[1].value as OpsSnapshotRaw);
      anySuccess = true;
    }
    if (results[2].status === 'fulfilled') {
      setSummary(results[2].value as OpsSummaryRaw);
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

  const scalingState = snapshot ? deriveScalingState(snapshot) : null;
  const scalingColor: Record<string, string> = {
    STABLE: '#007A00',
    SCALING_UP: '#D40000',
    SCALING_DOWN: '#E8A000',
  };

  const isRegistered = operatorInfo?.registered === true;
  const regLabel = isRegistered ? 'REGISTERED' : 'NOT REGISTERED';
  const regColor = isRegistered ? '#007A00' : '#707070';

  const walletAddr = operatorInfo?.address;
  const walletDisplay = walletAddr
    ? `${walletAddr.slice(0, 10)}...${walletAddr.slice(-8)}`
    : '---';

  const agentIdDisplay = operatorInfo?.agentId != null ? `#${operatorInfo.agentId}` : '---';

  const chainDisplay = snapshot?.chain?.displayName ?? 'Sepolia';

  const cpu = snapshot?.metrics?.cpu?.mean;
  const txPool = snapshot?.metrics?.txPool?.mean;
  const gasRatio = snapshot?.metrics?.gasUsedRatio?.mean;
  const memGiB = snapshot?.scaling?.currentMemoryGiB;
  const anomalyCount = snapshot?.anomalies?.activeCount ?? 0;

  const totalRequests = summary?.requestTotals?.total;
  const distinctBuyers = summary?.distinctBuyerCount;
  const services = summary?.services ?? [];

  const avgUptime = summary?.slaAgents && summary.slaAgents.length > 0
    ? summary.slaAgents.reduce((acc, a) => acc + a.uptime, 0) / summary.slaAgents.length
    : null;

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
          background: '#00C853',
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
        <div style={{ padding: '8px 0' }}>
          <KVRow label="Operator Wallet">
            <span style={{ fontFamily: FONT, fontSize: 10, color: walletAddr ? '#0A0A0A' : '#707070', wordBreak: 'break-all' }}>
              {walletDisplay}
            </span>
          </KVRow>
          <KVRow label="Registration">
            {operatorInfo !== null ? (
              <StatusBadge text={regLabel} color={regColor} />
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>---</span>
            )}
          </KVRow>
          <KVRow label="Agent ID" value={agentIdDisplay} />
          <KVRow label="Network" value={chainDisplay} />
        </div>
      </div>

      {/* System Health */}
      {snapshot && (
        <div style={{ borderBottom: '1px solid #D0D0D0' }}>
          <div style={{ padding: '16px 20px 0' }}>
            <SectionBar>System Health</SectionBar>
          </div>
          <div style={{ display: 'flex', borderTop: '1px solid #D0D0D0', borderBottom: '1px solid #E0E0E0' }}>
            <MetricCell
              label="CPU Usage"
              value={cpu !== undefined ? formatCpu(cpu) : '---'}
            />
            <MetricCell
              label="Memory"
              value={memGiB !== undefined ? formatMemory(memGiB) : '---'}
            />
            <MetricCell
              label="TX Pool (avg)"
              value={txPool !== undefined ? formatTxPool(txPool) : '---'}
            />
            <MetricCell
              label="Gas Used Ratio"
              value={gasRatio !== undefined ? formatGasRatio(gasRatio) : '---'}
              last
            />
          </div>
          <div style={{ padding: '10px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Scaling State
            </span>
            {scalingState ? (
              <StatusBadge text={scalingState} color={scalingColor[scalingState] ?? '#707070'} />
            ) : (
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>---</span>
            )}
            {snapshot.scaling?.autoScalingEnabled && (
              <span style={{ fontFamily: FONT, fontSize: 8, color: '#007A00' }}>AUTO-SCALING ON</span>
            )}
            {anomalyCount > 0 && (
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#D40000', marginLeft: 8 }}>
                ⚠ {anomalyCount} active anomal{anomalyCount === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>
          {snapshot.scaling && (
            <div style={{ padding: '0 20px 12px', display: 'flex', gap: 24 }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>
                vCPU: <span style={{ color: '#0A0A0A' }}>{snapshot.scaling.currentVcpu}</span>
              </span>
              <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>
                Cooldown: <span style={{ color: '#0A0A0A' }}>{snapshot.scaling.cooldownRemaining}s</span>
              </span>
              {snapshot.scaling.lastDecisionReason && (
                <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>
                  Last reason: <span style={{ color: '#0A0A0A' }}>{snapshot.scaling.lastDecisionReason}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Service Stats */}
      {summary && (
        <div style={{ padding: '16px 20px' }}>
          <SectionBar>Service Stats</SectionBar>
          <div style={{ display: 'flex', borderBottom: '1px solid #E0E0E0' }}>
            <MetricCell
              label="Total Requests"
              value={totalRequests !== undefined ? String(totalRequests) : '---'}
            />
            <MetricCell
              label="Distinct Buyers"
              value={distinctBuyers !== undefined ? String(distinctBuyers) : '---'}
            />
            <MetricCell
              label="SLA Uptime"
              value={avgUptime !== null ? `${avgUptime.toFixed(2)}%` : '---'}
              last
            />
          </div>
          {!summary.enabled && (
            <div style={{
              fontFamily: FONT, fontSize: 8, color: '#A0A0A0',
              padding: '6px 0', letterSpacing: '0.08em',
            }}>
              x402 payment tracking is disabled on this instance
            </div>
          )}
          {services.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 110px',
                fontFamily: FONT, fontSize: 8, color: '#707070',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '4px 0', borderBottom: '1px solid #EBEBEB',
              }}>
                <span>Service</span>
                <span style={{ textAlign: 'right' }}>Requests</span>
                <span style={{ textAlign: 'right' }}>Volume</span>
              </div>
              {services.map((row, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 110px',
                  fontFamily: FONT, fontSize: 9, color: '#0A0A0A',
                  padding: '5px 0', borderBottom: '1px solid #F0F0F0',
                }}>
                  <span>{row.displayName ?? row.key}</span>
                  <span style={{ textAlign: 'right', color: '#D40000' }}>{row.requestCount}</span>
                  <span style={{ textAlign: 'right', color: '#707070' }}>
                    {row.volumeWei ? formatVolumeTON(row.volumeWei) : '---'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
