'use client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRoleSummary { total: number; running: number; stale: number }

interface AgentFleetData {
  kpi: { throughputPerMin: number; successRate: number; p95CycleMs: number; criticalPathPhase: string };
  roles: Record<string, AgentRoleSummary>;
  summary: { totalAgents: number; runningAgents: number };
}

interface ExperienceData {
  tier: string;
  stats: { successRate: number; totalOps?: number };
  total: number;
}

export interface AgentRosterPanelProps {
  agentFleet: AgentFleetData | null;
  experience: ExperienceData | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const LAYERS = [
  {
    id: 'pipeline',
    label: 'PIPELINE LAYER',
    agents: ['collector', 'detector', 'analyzer', 'executor', 'verifier'],
  },
  {
    id: 'domain',
    label: 'DOMAIN LAYER',
    agents: ['scaling', 'security', 'reliability', 'rca', 'cost'],
  },
  {
    id: 'action',
    label: 'ACTION LAYER',
    agents: ['remediation', 'notifier'],
  },
] as const;

type AgentStatus = 'ok' | 'warn' | 'err' | 'delay';

function getAgentStatus(key: string, roles: Record<string, AgentRoleSummary> | undefined, successRate: number): AgentStatus {
  const r = roles?.[key];
  if (!r) return 'ok';
  if (r.stale > 0 && r.running === 0) return 'err';
  if (r.stale > 0) return 'warn';
  if (key === 'notifier' && successRate < 0.95) return 'delay';
  return 'ok';
}

function statusDotColor(status: AgentStatus): string {
  if (status === 'err')   return '#D40000';
  if (status === 'warn')  return '#CC6600';
  if (status === 'delay') return '#CC6600';
  return '#007A00';
}

function badgeText(status: AgentStatus): string {
  if (status === 'err')   return 'ERR';
  if (status === 'warn')  return 'WARN';
  if (status === 'delay') return 'DELAY';
  return 'OK';
}

function badgeStyle(status: AgentStatus): React.CSSProperties {
  const base: React.CSSProperties = { fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 2 };
  if (status === 'err')   return { ...base, background: '#FFE6E6', color: '#D40000' };
  if (status === 'warn' || status === 'delay') return { ...base, background: '#FFF3E0', color: '#CC6600' };
  return { ...base, background: '#E6F4E6', color: '#007A00' };
}

function tierLabel(tier: string): string {
  switch (tier) {
    case 'expert':  return '🥇 Expert Tier';
    case 'senior':  return '🥈 Senior Tier';
    case 'junior':  return '🥉 Junior Tier';
    case 'trainee': return '🔰 Trainee Tier';
    default:        return '— Tier';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRosterPanel({ agentFleet, experience }: AgentRosterPanelProps) {
  const roles = agentFleet?.roles;
  const successRate = agentFleet?.kpi.successRate ?? 1;
  const uptime = experience?.stats?.successRate ?? (agentFleet?.kpi.successRate ?? 1);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      borderRight: '1px solid #D0D0D0', overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        background: '#F7F7F7', borderBottom: '1px solid #A0A0A0',
        padding: '0 10px', height: 24, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A0A0A' }}>
          Agent Roster
        </span>
        <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>
          {agentFleet?.summary.totalAgents ?? 0} agents · 3 layers
        </span>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #D0D0D0', flexShrink: 0 }}>
        <KpiCell label="Uptime" value={`${(uptime * 100).toFixed(1)}%`} color="#007A00" note="+0.1% vs yesterday" />
        <KpiCell label="Cycles/min" value={`${agentFleet?.kpi.throughputPerMin.toFixed(0) ?? '—'}`} color="#0055AA" note="normal range" isLast />
      </div>

      {/* Agent layers */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {LAYERS.map(layer => (
          <div key={layer.id}>
            <div style={{
              background: '#0A0A0A', color: 'white',
              padding: '2px 10px', fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
            }}>
              {layer.label}
            </div>
            {layer.agents.map(agent => {
              const status = getAgentStatus(agent, roles, successRate);
              const r = roles?.[agent];
              return (
                <div key={agent} style={{
                  display: 'grid', gridTemplateColumns: '10px 1fr 44px 38px',
                  alignItems: 'center', gap: 6, padding: '4px 10px',
                  borderBottom: '1px solid #F0F0F0', cursor: 'pointer',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: statusDotColor(status),
                    animation: status === 'err' ? 'statusBlink 1s step-end infinite' : undefined,
                  }} />
                  <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 500, color: '#0A0A0A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent}
                  </span>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070', textAlign: 'right' }}>
                    {r?.running.toLocaleString() ?? '—'}
                  </span>
                  <span style={badgeStyle(status)}>{badgeText(status)}</span>
                </div>
              );
            })}
          </div>
        ))}

        {/* Experience tier */}
        {experience && (
          <div style={{
            margin: '8px 10px', padding: '6px 8px',
            border: '1px solid #D0D0D0', borderRadius: 2, background: '#FFFEF5',
          }}>
            <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: '#0A0A0A' }}>
              {tierLabel(experience.tier)}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 9, color: '#707070', marginTop: 2 }}>
              {experience.total} ops · 운영 지속성 확인됨
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCell({ label, value, color, note, isLast }: {
  label: string; value: string; color: string; note: string; isLast?: boolean;
}) {
  return (
    <div style={{
      padding: '8px 10px',
      borderRight: isLast ? 'none' : '1px solid #D0D0D0',
    }}>
      <div style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#707070', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 18, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 10, color: '#707070', marginTop: 2 }}>
        {note}
      </div>
    </div>
  );
}
