'use client';

import { useState } from 'react';
import { PlaybooksTab } from '@/components/playbooks-tab';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MetricData {
  metrics: {
    l1BlockHeight: number;
    blockHeight: number;
    cpuUsage: number;
    gethVcpu: number;
    txPoolPending?: number;
  };
  cost: { monthlyEstimated: number; hourlyRate: number };
  eoaBalances?: {
    roles: Record<string, { address: string; balanceEth: number; level: string } | null>;
  };
  components?: Array<{
    name: string;
    type: string;
    rawCpu?: number;
    status: string;
    usage?: { cpuPercent: number; memoryMiB: number };
  }>;
}

interface ScalerState {
  currentVcpu: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  prediction: { predictedVcpu: number; confidence: number; trend: string } | null;
}

interface AgentFleetData {
  kpi: { throughputPerMin: number };
}

interface L1FailoverStatus {
  healthy: boolean;
  failoverCount: number;
  spareUrlCount: number;
}

export interface OperationsPanelProps {
  metrics: MetricData | null;
  scalerState: ScalerState | null;
  agentFleet: AgentFleetData | null;
  l1Failover: L1FailoverStatus | null;
  scalingScore: number;
  currentVcpu?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const TIERS = [
  { label: 'IDLE',   vcpu: 1, blocks: 1, color: '#D0D0D0' },
  { label: 'NORMAL', vcpu: 2, blocks: 2, color: '#0055AA' },
  { label: 'HIGH',   vcpu: 4, blocks: 4, color: '#0055AA' },
  { label: 'EMERG',  vcpu: 8, blocks: 8, color: '#D40000' },
] as const;

function currentTierIndex(vcpu: number): number {
  if (vcpu >= 8) return 3;
  if (vcpu >= 4) return 2;
  if (vcpu >= 2) return 1;
  return 0;
}

function scoreBarColor(score: number): string {
  if (score >= 77) return '#D40000';
  if (score >= 70) return '#CC6600';
  if (score >= 30) return '#0055AA';
  return '#007A00';
}

function eoa_color(level: string): string {
  if (level === 'critical') return '#D40000';
  if (level === 'warning')  return '#CC6600';
  return '#007A00';
}


// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      background: '#0A0A0A', color: 'white',
      padding: '2px 10px', fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
      flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

function MetricRow({ label, pct, value, color }: { label: string; pct: number; value: string; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '4px 10px',
      borderBottom: '1px solid #F0F0F0', gap: 8,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 10, color: '#3A3A3A', flex: 1 }}>{label}</span>
      <div style={{ width: 60, height: 4, background: '#EFEFEF', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: 1 }} />
      </div>
      <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: '#0A0A0A', minWidth: 48, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OperationsPanel({ metrics, scalerState, agentFleet, l1Failover, scalingScore, currentVcpu: vcpuProp }: OperationsPanelProps) {
  const [activeTab, setActiveTab] = useState<'ops' | 'playbooks'>('ops');
  const vcpu = vcpuProp ?? scalerState?.currentVcpu ?? 2;
  const tierIdx = currentTierIndex(vcpu);
  const txMin = agentFleet?.kpi.throughputPerMin ?? 0;
  const costHourly = metrics?.cost.hourlyRate ?? 0;
  const costDaily = costHourly * 24;
  const eoa = metrics?.eoaBalances?.roles ?? {};
  const components = metrics?.components ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        background: '#F7F7F7', borderBottom: '1px solid #A0A0A0',
        padding: '0 10px', height: 24, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A0A0A' }}>
          Operations
        </span>
        <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>
          live · 30s window
        </span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #D0D0D0', background: '#F0F0F0', flexShrink: 0 }}>
        {(['ops', 'playbooks'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.05em',
              padding: '4px 12px',
              border: 'none',
              borderRight: '1px solid #D0D0D0',
              cursor: 'pointer',
              textTransform: 'uppercase' as const,
              background: activeTab === tab ? '#FAFAFA' : '#F0F0F0',
              color: activeTab === tab ? '#0A0A0A' : '#888',
              borderBottom: activeTab === tab ? '2px solid #D40000' : '2px solid transparent',
            }}
          >
            {tab === 'ops' ? 'OPS' : 'PLAYBOOKS'}
          </button>
        ))}
      </div>

      {activeTab === 'ops' ? (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #D0D0D0' }}>
          <div style={{ padding: '8px 10px', borderRight: '1px solid #D0D0D0' }}>
            <div style={{ fontFamily: FONT, fontSize: 9, color: '#707070', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>TX POOL</div>
            <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: txMin > 50 ? '#CC6600' : '#0055AA', lineHeight: 1 }}>
              {metrics?.metrics?.txPoolPending != null ? metrics.metrics.txPoolPending.toLocaleString() : '—'}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 9, color: '#A0A0A0', marginTop: 2 }}>pending tx</div>
          </div>
          <div style={{ padding: '8px 10px' }}>
            <div style={{ fontFamily: FONT, fontSize: 9, color: '#707070', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>COST/DAY</div>
            <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color: '#0A0A0A', lineHeight: 1 }}>
              ${costDaily.toFixed(2)}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 9, color: '#A0A0A0', marginTop: 2 }}>compute est.</div>
          </div>
        </div>

        {/* Throughput sparkline */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #D0D0D0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#707070', marginBottom: 4 }}>
            <span>CYCLES/MIN</span>
            <span style={{ color: '#007A00' }}>{txMin.toFixed(2)}/min</span>
          </div>
          <svg width="100%" height="36" viewBox="0 0 260 36" style={{ display: 'block' }}>
            <polyline
              points="0,28 22,24 44,20 66,26 88,18 110,14 132,10 154,16 176,8 198,12 220,6 242,10 258,8"
              fill="none" stroke="#0055AA" strokeWidth={1.5}
            />
            <polyline
              points="0,28 22,24 44,20 66,26 88,18 110,14 132,10 154,16 176,8 198,12 220,6 242,10 258,8 258,36 0,36"
              fill="#0055AA" fillOpacity={0.08} stroke="none"
            />
          </svg>
        </div>


        {/* L2 components */}
        {components.length > 0 && (
          <>
            <SectionLabel>L2 COMPONENTS</SectionLabel>
            {components.slice(0, 5).map(c => {
              const statusLower = c.status?.toLowerCase() ?? '';
              const notDetected = statusLower === 'stopped' || statusLower === 'error' || statusLower === 'not managed';
              const cpuPct = notDetected ? 0 : (c.usage?.cpuPercent ?? 0);
              const memMiB = notDetected ? null : (c.usage?.memoryMiB ?? null);
              const memLabel = memMiB !== null
                ? memMiB >= 1024 ? `${(memMiB / 1024).toFixed(1)}G` : `${Math.round(memMiB)}M`
                : null;
              const cpuLabel = notDetected ? '—' : `${cpuPct.toFixed(1)}%`;
              const color = notDetected ? '#A0A0A0' : '#0055AA';
              return (
                <div key={c.name} style={{
                  display: 'flex', alignItems: 'center', padding: '4px 10px',
                  borderBottom: '1px solid #F0F0F0', gap: 8,
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: '#3A3A3A', flex: 1 }}>{c.name}</span>
                  <div style={{ width: 60, height: 4, background: '#EFEFEF', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, cpuPct)}%`, height: '100%', background: color, borderRadius: 1 }} />
                  </div>
                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: notDetected ? '#C0C0C0' : '#0A0A0A', minWidth: 40, textAlign: 'right' }}>
                    {cpuLabel}
                  </span>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: notDetected ? '#A0A0A0' : '#707070', minWidth: 32, textAlign: 'right' }}>
                    {notDetected ? 'N/A' : (memLabel ?? '—')}
                  </span>
                </div>
              );
            })}
          </>
        )}

        {/* Scaling engine */}
        <div style={{ borderTop: '2px solid #A0A0A0', padding: '8px 10px', borderBottom: '1px solid #D0D0D0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A0A0A' }}>
              Scaling Engine
            </span>
            <span style={{
              fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: '1px 6px',
              borderRadius: 2, background: '#E6F4E6', color: '#007A00', border: '1px solid #007A00',
            }}>
              {TIERS[tierIdx].label} TIER
            </span>
          </div>

          {TIERS.map((tier, i) => {
            const isActive = i === tierIdx;
            return (
              <div key={tier.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontFamily: FONT, fontSize: 9, width: 52, color: '#707070', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {tier.label}
                </span>
                <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {Array.from({ length: tier.blocks }).map((_, j) => (
                    <div key={j} style={{
                      flex: 1, height: 12, borderRadius: 1,
                      background: isActive ? tier.color : '#EFEFEF',
                      border: `1px solid ${isActive ? tier.color : '#D0D0D0'}`,
                    }} />
                  ))}
                </div>
                <span style={{
                  fontFamily: FONT, fontSize: 10, fontWeight: 700, minWidth: 40, textAlign: 'right',
                  color: isActive ? (i === 3 ? '#D40000' : '#0055AA') : '#A0A0A0',
                }}>
                  {tier.vcpu}vCPU
                </span>
              </div>
            );
          })}

          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>SCORE</span>
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: scoreBarColor(scalingScore) }}>{scalingScore}</span>
            <span style={{ fontFamily: FONT, fontSize: 9, color: '#707070' }}>/ 100</span>
            <div style={{ flex: 1, height: 4, background: '#EFEFEF', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{
                width: `${scalingScore}%`, height: '100%', borderRadius: 1,
                background: `linear-gradient(to right, #007A00, #CC6600, #D40000)`,
              }} />
            </div>
          </div>
        </div>

        {/* EOA balances */}
        {Object.keys(eoa).length > 0 && (
          <>
            <SectionLabel>EOA BALANCE</SectionLabel>
            {Object.entries(eoa).filter(([, v]) => v !== null).map(([role, data]) => {
              if (!data) return null;
              const pct = Math.min(100, (data.balanceEth / 3) * 100);
              return (
                <MetricRow key={role} label={role} pct={pct}
                  value={`${data.balanceEth.toFixed(2)} ETH`} color={eoa_color(data.level)} />
              );
            })}
          </>
        )}

        {/* L1 RPC status */}
        {l1Failover && (
          <>
            <SectionLabel>L1 RPC</SectionLabel>
            <div style={{ padding: '5px 10px', display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #F0F0F0' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: l1Failover.healthy ? '#007A00' : '#D40000' }} />
              <span style={{ fontFamily: FONT, fontSize: 10, color: l1Failover.healthy ? '#007A00' : '#D40000', fontWeight: 600 }}>
                {l1Failover.healthy ? 'healthy' : 'degraded'}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070', marginLeft: 'auto' }}>
                {l1Failover.spareUrlCount} endpoints
              </span>
            </div>
          </>
        )}

      </div>
      ) : (
        <PlaybooksTab />
      )}
    </div>
  );
}
