'use client';

import React, { useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRoleSummary { total: number; running: number; stale: number }

interface AgentFleetData {
  kpi: { throughputPerMin: number; successRate: number; p95CycleMs: number };
  roles: Record<string, AgentRoleSummary>;
}

interface AnomalyEvent {
  id: string;
  timestamp: number;
  status: 'active' | 'resolved' | 'acknowledged';
  deepAnalysis?: {
    severity?: string;
    anomalyType?: string;
    relatedComponents?: string[];
  };
  anomalies?: Array<{ metric: string; value: number; zScore?: number }>;
}

interface AgentDecision {
  decisionId: string;
  timestamp: string;
  severity?: string;
  chosenAction: string;
  reasoningSummary: string;
  evidence: Array<{ key: string; value: string }>;
  phaseTrace: Array<{ phase: string; startedAt: string; endedAt: string; ok: boolean }>;
  verification: { passed: boolean };
  inputs: { scalingScore?: number; anomalyCount: number };
}

export interface AgentInteractionGraphProps {
  agentFleet: AgentFleetData | null;
  anomalyEvents: AnomalyEvent[];
  agentPhase: string;
  decisions?: AgentDecision[];
  scaling?: { from: number; to: number; score: number } | null;
}

// ─── Layout (viewBox 0 0 760 390) ────────────────────────────────────────────

const NODE_W = 106;
const NODE_H = 50;
const FONT = "'IBM Plex Mono', var(--font-ibm-plex-mono), monospace";

const PIPELINE = [
  { key: 'collector',   cx: 75,  cy: 58, sub: 'metrics·rpc' },
  { key: 'detector',    cx: 227, cy: 58, sub: 'z-score·ai'  },
  { key: 'analyzer',   cx: 380, cy: 58, sub: 'rca·context' },
  { key: 'executor',   cx: 532, cy: 58, sub: 'k8s·actions' },
  { key: 'verifier',   cx: 685, cy: 58, sub: 'confirm·log' },
] as const;

const DOMAIN = [
  { key: 'scaling',     cx: 75,  cy: 195, sub: 'hybrid·score' },
  { key: 'security',    cx: 227, cy: 195, sub: 'eoa·rpc'      },
  { key: 'reliability', cx: 380, cy: 195, sub: 'uptime·sla'   },
  { key: 'rca',         cx: 532, cy: 195, sub: 'fault·trace'  },
  { key: 'cost',        cx: 685, cy: 195, sub: 'fargate·opt'  },
] as const;

const ACTION = [
  { key: 'remediation', cx: 258, cy: 320, sub: 'playbook·exec'  },
  { key: 'notifier',    cx: 503, cy: 320, sub: 'slack·webhook'  },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AgentStatus = 'ok' | 'warn' | 'err';

function getStatus(key: string, roles: Record<string, AgentRoleSummary> | undefined, hasActive: boolean): AgentStatus {
  const r = roles?.[key];
  if (r) {
    if (r.stale > 0 && r.running === 0) return 'err';
    if (r.stale > 0) return 'warn';
  }
  if ((key === 'security' || key === 'notifier') && hasActive) return 'warn';
  return 'ok';
}

function nodeColors(status: AgentStatus, layer: 'pipeline' | 'domain' | 'action') {
  if (status === 'err')  return { fill: '#FFF0F0', stroke: '#D40000' };
  if (status === 'warn') return { fill: '#FFF8F0', stroke: '#CC6600' };
  if (layer === 'pipeline') return { fill: '#F0F4FF', stroke: '#0055AA' };
  if (layer === 'domain')   return { fill: '#F0FFF4', stroke: '#007A00' };
  return { fill: '#FFF8F0', stroke: '#CC6600' };
}

function statusTextColor(status: AgentStatus): string {
  if (status === 'err')  return '#D40000';
  if (status === 'warn') return '#CC6600';
  return '#0A0A0A';
}

function isEdgeActive(phase: string, from: string, to: string): boolean {
  const map: Record<string, [string, string][]> = {
    observe: [['collector', 'detector']],
    detect:  [['collector', 'detector']],
    analyze: [['detector', 'analyzer'], ['detector', 'security']],
    act:     [['analyzer', 'executor'], ['scaling', 'remediation']],
    verify:  [['executor', 'verifier']],
  };
  return (map[phase] ?? []).some(([f, t]) => f === from && t === to);
}

// ─── SVG primitives ──────────────────────────────────────────────────────────

function AgentNode({ cx, cy, label, sub, status, stat, layer }: {
  cx: number; cy: number; label: string; sub: string;
  status: AgentStatus; stat: string; layer: 'pipeline' | 'domain' | 'action';
}) {
  const { fill, stroke } = nodeColors(status, layer);
  const statColor = status !== 'ok' ? stroke : '#007A00';
  return (
    <g>
      <rect x={cx - NODE_W / 2} y={cy - NODE_H / 2} width={NODE_W} height={NODE_H}
        rx={2} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={cx} y={cy - 11} textAnchor="middle" fontFamily={FONT} fontSize={10}
        fontWeight={600} fill={statusTextColor(status)}>
        {label}
      </text>
      <text x={cx} y={cy + 3} textAnchor="middle" fontFamily={FONT} fontSize={8} fill="#707070">
        {sub}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontFamily={FONT} fontSize={8}
        fontWeight={700} fill={statColor}>
        {stat}
      </text>
    </g>
  );
}

function HEdge({ x1, y, x2, color, active, label }: {
  x1: number; y: number; x2: number; color: string; active?: boolean; label?: string;
}) {
  const markerId = `arr-${color.replace('#', '')}`;
  const mid = (x1 + x2) / 2;
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y}
        stroke={color} strokeWidth={1.5} strokeOpacity={active ? 0.9 : 0.5}
        strokeDasharray={active ? '6 3' : undefined}
        strokeDashoffset={active ? 0 : undefined}
        markerEnd={`url(#${markerId})`}
        style={active ? { animation: 'dashFlow 0.8s linear infinite' } : undefined}
      />
      {active && label && (
        <g>
          <rect x={mid - 23} y={y - 17} width={46} height={13} rx={2}
            fill="white" stroke="none" />
          <text x={mid} y={y - 7} textAnchor="middle"
            fontFamily={FONT} fontSize={8} fontWeight={700} fill={color}>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

function CurvedEdge({ x1, y1, x2, y2, color, active, label }: {
  x1: number; y1: number; x2: number; y2: number; color: string; active?: boolean; label?: string;
}) {
  const mid = (y1 + y2) / 2;
  // Midpoint of cubic bezier M(x1,y1) C(x1,mid) (x2,mid) (x2,y2) at t=0.5
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <path
        d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`}
        fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={active ? 0.8 : 0.45}
        strokeDasharray={active ? '6 3' : undefined}
        markerEnd={`url(#arr-${color.replace('#', '')})`}
        style={active ? { animation: 'dashFlow 0.8s linear infinite' } : undefined}
      />
      {active && label && (
        <g>
          <rect x={mx - 23} y={my - 7} width={46} height={13} rx={2}
            fill="white" stroke="none" />
          <text x={mx} y={my + 3} textAnchor="middle"
            fontFamily={FONT} fontSize={8} fontWeight={700} fill={color}>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentInteractionGraph({ agentFleet, anomalyEvents, agentPhase, decisions, scaling }: AgentInteractionGraphProps) {
  const roles = agentFleet?.roles;
  const activeAnomalies = useMemo(() => anomalyEvents.filter(e => e.status === 'active'), [anomalyEvents]);
  const hasActive = activeAnomalies.length > 0;

  const corrId = activeAnomalies[0]?.id.slice(0, 6) ?? '—';

  const traceRows = useMemo(() => {
    type RawRow = { rawTs: number; ts: string; sev: string; agent: string; action: string; detail: string; latency: string; ok: boolean };
    type Row = RawRow & { count: number };

    const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };

    function normSev(s: string | undefined): string {
      const v = (s ?? 'info').toLowerCase();
      return ['critical', 'high', 'medium'].includes(v) ? v : 'info';
    }

    const fromAnomalies: RawRow[] = anomalyEvents.slice(0, 15).map(e => {
      const comp = e.deepAnalysis?.relatedComponents?.[0] ?? '';
      const type = e.deepAnalysis?.anomalyType ?? '';
      const a1 = e.anomalies?.[0];
      let detail: string;
      if (type) {
        if (a1) {
          const val = Number.isFinite(a1.value) ? a1.value.toFixed(a1.value < 10 ? 2 : 0) : '?';
          const z = a1.zScore ? ` Z=${a1.zScore.toFixed(1)}` : '';
          detail = `${comp ? comp + ': ' : ''}${type} · ${a1.metric}=${val}${z}`;
        } else {
          detail = [comp, type].filter(Boolean).join(': ');
        }
      } else {
        detail = e.id.slice(0, 24);
      }
      return {
        rawTs: typeof e.timestamp === 'number' ? e.timestamp : new Date(e.timestamp).getTime(),
        ts: new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false }),
        sev: normSev(e.deepAnalysis?.severity),
        agent: 'detector',
        action: e.status === 'active' ? 'anomaly-detected' : e.status === 'resolved' ? 'resolved' : 'acknowledged',
        detail,
        latency: '—',
        ok: e.status === 'resolved',
      };
    });

    const fromDecisions: RawRow[] = (decisions ?? []).slice(0, 15).map(d => {
      const phases = d.phaseTrace ?? [];
      const t0 = phases.length > 0 ? new Date(phases[0].startedAt).getTime() : 0;
      const t1 = phases.length > 0 ? new Date(phases[phases.length - 1].endedAt).getTime() : 0;
      const latencyMs = t1 > t0 ? t1 - t0 : 0;
      const keyEvidence = d.evidence.slice(0, 2).map(ev => `${ev.key}=${ev.value}`).join(' ');
      const agentName = d.chosenAction.startsWith('scale') ? 'executor'
        : d.chosenAction.startsWith('rca') ? 'rca'
        : d.chosenAction.startsWith('alert') || d.chosenAction.startsWith('notify') ? 'notifier'
        : d.chosenAction === 'no-action' ? 'analyzer'
        : 'executor';
      return {
        rawTs: new Date(d.timestamp).getTime(),
        ts: new Date(d.timestamp).toLocaleTimeString('en-US', { hour12: false }),
        sev: normSev(d.severity),
        agent: agentName,
        action: d.chosenAction,
        detail: keyEvidence || d.reasoningSummary.slice(0, 60),
        latency: latencyMs > 0 ? `${latencyMs}ms` : '—',
        ok: d.verification?.passed ?? false,
      };
    });

    const sorted = [...fromAnomalies, ...fromDecisions]
      .sort((a, b) => b.rawTs - a.rawTs || sevRank[a.sev] - sevRank[b.sev])
      .slice(0, 20);

    const AGENT_SHORT: Record<string, string> = {
      detector: 'det', executor: 'exe', analyzer: 'ana',
      notifier: 'ntf', rca: 'rca', collector: 'col',
    };

    // Merge consecutive rows sharing the same second-level timestamp into one
    const merged: Row[] = [];
    for (const row of sorted) {
      const prev = merged[merged.length - 1];
      if (prev && prev.ts === row.ts) {
        prev.count++;
        // Escalate severity and use the more severe event's detail
        if (sevRank[row.sev] < sevRank[prev.sev]) { prev.sev = row.sev; prev.detail = row.detail; }
        // Append distinct agents using short form when multiple
        const prevAgents = prev.agent.split('·').map(s => s.trim());
        const rowAgent = AGENT_SHORT[row.agent] ?? row.agent;
        if (!prevAgents.includes(rowAgent) && !prevAgents.includes(row.agent)) {
          const prevShort = prevAgents.map(a => AGENT_SHORT[a] ?? a).join('·');
          prev.agent = `${prevShort}·${rowAgent}`;
        }
        if (!prev.action.split(' · ').includes(row.action)) prev.action += ` · ${row.action}`;
        // Prefer a real latency value
        if (row.latency !== '—') prev.latency = row.latency;
      } else {
        merged.push({ ...row, count: 1 });
      }
    }
    return merged;
  }, [anomalyEvents, decisions]);

  const isScaling = !!scaling && scaling.from !== scaling.to;

  // Stat label for each agent
  const stat = (key: string, layer: 'pipeline' | 'domain' | 'action') => {
    if (key === 'executor' && agentPhase === 'act' && isScaling) return `${scaling!.from}→${scaling!.to} vCPU`;
    if (!roles) return '—';
    const r = roles[key];
    if (!r) return '—';
    if (layer === 'action') return `${r.running} active`;
    if (key === 'cost') return `$${(agentFleet?.kpi.throughputPerMin ?? 0).toFixed(0)}/day`;
    return `${r.running} instance${r.running !== 1 ? 's' : ''}`;
  };

  // Data label shown on active edges
  const throughput = agentFleet?.kpi.throughputPerMin ?? 0;
  const anomalyType = activeAnomalies[0]?.deepAnalysis?.anomalyType;
  const edgeLabel = (from: string, to: string): string | undefined => {
    if (from === 'collector'  && to === 'detector')    return `${throughput.toFixed(1)}/min`;
    if (from === 'detector'   && to === 'analyzer')    return anomalyType ? anomalyType.slice(0, 8) : `${activeAnomalies.length} hit`;
    if (from === 'detector'   && to === 'security')    return 'eoa·rpc';
    if (from === 'analyzer'   && to === 'executor')    return 'act·k8s';
    if (from === 'executor'   && to === 'verifier')    return 'verify';
    if (from === 'scaling'    && to === 'remediation') return 'scale·up';
    if (from === 'security'   && to === 'notifier')    return 'alert';
    if (from === 'security'   && to === 'remediation') return 'patch';
    return undefined;
  };

  const ph = NODE_H / 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderRight: '1px solid #D0D0D0' }}>
      {/* Header */}
      <div style={{
        background: '#F7F7F7', borderBottom: '1px solid #A0A0A0',
        padding: '0 10px', height: 24, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A0A0A' }}>
          Agent Interaction Map
        </span>
        <span style={{ fontFamily: FONT, fontSize: 10, color: '#707070' }}>
          correlationId: {corrId} · live trace
        </span>
      </div>

      {/* SVG */}
      <div style={{ flex: 1, overflow: 'hidden', background: '#FFFFFF' }}>
        <svg viewBox="0 0 760 390" width="100%" height="100%"
          preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
          <defs>
            {[['0055AA', '#0055AA'], ['007A00', '#007A00'], ['CC6600', '#CC6600'], ['D40000', '#D40000']].map(([id, fill]) => (
              <marker key={id} id={`arr-${id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill={fill} />
              </marker>
            ))}
          </defs>

          {/* Grid lines */}
          <line x1={0} y1={133} x2={760} y2={133} stroke="#E8E8E8" strokeWidth={0.5} />
          <line x1={0} y1={262} x2={760} y2={262} stroke="#E8E8E8" strokeWidth={0.5} />

          {/* Layer labels */}
          {[['PIPELINE', 10], ['DOMAIN', 143], ['ACTION', 272]].map(([lbl, y]) => (
            <text key={lbl as string} x={6} y={(y as number) + 10}
              fontFamily={FONT} fontSize={8} fill="#B0B0B0" letterSpacing="0.12em">
              {lbl}
            </text>
          ))}

          {/* ── Scaling Event Banner ── */}
          {isScaling && agentPhase === 'act' && (
            <g>
              <rect x={240} y={6} width={280} height={20} rx={3}
                fill="#D40000" opacity={0.92} />
              <text x={380} y={20} textAnchor="middle"
                fontFamily={FONT} fontSize={10} fontWeight={700} fill="white" letterSpacing="0.1em">
                {scaling!.to > scaling!.from ? '⬆' : '⬇'} SCALING {scaling!.from}→{scaling!.to} vCPU · SCORE {scaling!.score}
              </text>
            </g>
          )}

          {/* ── Pipeline horizontal edges ── */}
          <HEdge x1={75 + NODE_W/2} y={58} x2={227 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'collector', 'detector')} label={isEdgeActive(agentPhase, 'collector', 'detector') ? edgeLabel('collector', 'detector') : undefined} />
          <HEdge x1={227 + NODE_W/2} y={58} x2={380 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'detector', 'analyzer')} label={isEdgeActive(agentPhase, 'detector', 'analyzer') ? edgeLabel('detector', 'analyzer') : undefined} />
          <HEdge x1={380 + NODE_W/2} y={58} x2={532 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'analyzer', 'executor')} label={isEdgeActive(agentPhase, 'analyzer', 'executor') ? edgeLabel('analyzer', 'executor') : undefined} />
          <HEdge x1={532 + NODE_W/2} y={58} x2={685 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'executor', 'verifier')} label={isEdgeActive(agentPhase, 'executor', 'verifier') ? edgeLabel('executor', 'verifier') : undefined} />

          {/* ── Pipeline → Domain cross edges ── */}
          <CurvedEdge x1={227} y1={58 + ph} x2={227} y2={195 - ph} color="#007A00" active={isEdgeActive(agentPhase, 'detector', 'security')} label={isEdgeActive(agentPhase, 'detector', 'security') ? edgeLabel('detector', 'security') : undefined} />
          <CurvedEdge x1={227} y1={58 + ph} x2={75}  y2={195 - ph} color="#007A00" />
          <CurvedEdge x1={380} y1={58 + ph} x2={380} y2={195 - ph} color="#007A00" />
          <CurvedEdge x1={380} y1={58 + ph} x2={532} y2={195 - ph} color="#007A00" active={hasActive} label={hasActive ? edgeLabel('analyzer', 'rca') : undefined} />

          {/* ── Domain → Action cross edges ── */}
          <CurvedEdge x1={75}  y1={195 + ph} x2={258} y2={320 - ph} color="#CC6600" />
          <CurvedEdge x1={227} y1={195 + ph} x2={258} y2={320 - ph} color="#D40000" active={hasActive} label={hasActive ? edgeLabel('security', 'remediation') : undefined} />
          <CurvedEdge x1={532} y1={195 + ph} x2={258} y2={320 - ph} color="#CC6600" active={hasActive} label={hasActive ? edgeLabel('scaling', 'remediation') : undefined} />
          <CurvedEdge x1={380} y1={195 + ph} x2={503} y2={320 - ph} color="#007A00" />
          <CurvedEdge x1={227} y1={195 + ph} x2={503} y2={320 - ph} color="#CC6600" active={hasActive} label={hasActive ? edgeLabel('security', 'notifier') : undefined} />

          {/* ── Agent nodes ── */}
          {PIPELINE.map(a => (
            <AgentNode key={a.key} cx={a.cx} cy={a.cy} label={a.key} sub={a.sub}
              status={getStatus(a.key, roles, hasActive)} stat={stat(a.key, 'pipeline')} layer="pipeline" />
          ))}
          {DOMAIN.map(a => (
            <AgentNode key={a.key} cx={a.cx} cy={a.cy} label={a.key} sub={a.sub}
              status={getStatus(a.key, roles, hasActive)} stat={stat(a.key, 'domain')} layer="domain" />
          ))}
          {ACTION.map(a => (
            <AgentNode key={a.key} cx={a.cx} cy={a.cy} label={a.key} sub={a.sub}
              status={getStatus(a.key, roles, hasActive)} stat={stat(a.key, 'action')} layer="action" />
          ))}
        </svg>
      </div>

      {/* Event trace table */}
      <div style={{ borderTop: '2px solid #A0A0A0', flexShrink: 0, maxHeight: 162, overflowY: 'auto', background: '#FFFFFF' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '62px 46px 72px 110px 1fr 52px',
          padding: '3px 10px', background: '#0A0A0A', color: 'white',
          fontFamily: FONT, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase', position: 'sticky', top: 0,
        }}>
          <span>TIME</span><span>SEV</span><span>AGENT</span><span>ACTION</span>
          <span>DETAIL</span><span style={{ textAlign: 'right' }}>LATENCY</span>
        </div>
        {traceRows.length === 0 ? (
          <div style={{ padding: '8px 10px', fontFamily: FONT, fontSize: 10, color: '#A0A0A0' }}>
            No events — all systems nominal
          </div>
        ) : traceRows.map((row, i) => {
          const sevStyle: React.CSSProperties =
            row.sev === 'critical' ? { background: '#FFE6E6', color: '#D40000' } :
            row.sev === 'high'     ? { background: '#FFF3E0', color: '#CC6600' } :
            row.sev === 'medium'   ? { background: '#EEF3FF', color: '#0055AA' } :
                                     { background: '#F0F0F0', color: '#606060' };
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '62px 46px 72px 110px 1fr 52px',
              padding: '3px 10px', borderBottom: '1px solid #F0F0F0',
              fontFamily: FONT, fontSize: 10, alignItems: 'center',
              background: i % 2 === 1 ? '#F7F7F7' : '#FFFFFF',
            }}>
              <span style={{ color: '#707070', fontSize: 9 }}>{row.ts}</span>
              <span style={{ ...sevStyle, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2 }}>
                {row.sev.toUpperCase().slice(0, 4)}{row.count > 1 ? ` ×${row.count}` : ''}
              </span>
              <span style={{ color: '#0055AA', fontSize: 9, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.agent}</span>
              <span style={{ color: '#3A3A3A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.action}</span>
              <span style={{ color: '#0A0A0A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.detail}</span>
              <span style={{ color: row.latency !== '—' ? (row.ok ? '#007A00' : '#CC6600') : '#A0A0A0', textAlign: 'right', fontWeight: 600, fontSize: 9 }}>{row.latency}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
