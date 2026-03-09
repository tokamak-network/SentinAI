'use client';

import { useMemo } from 'react';

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
}

export interface AgentInteractionGraphProps {
  agentFleet: AgentFleetData | null;
  anomalyEvents: AnomalyEvent[];
  agentPhase: string;
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

function HEdge({ x1, y, x2, color, active }: { x1: number; y: number; x2: number; color: string; active?: boolean }) {
  const markerId = `arr-${color.replace('#', '')}`;
  return (
    <line x1={x1} y1={y} x2={x2} y2={y}
      stroke={color} strokeWidth={1.5} strokeOpacity={active ? 0.9 : 0.5}
      strokeDasharray={active ? '6 3' : undefined}
      strokeDashoffset={active ? 0 : undefined}
      markerEnd={`url(#${markerId})`}
      style={active ? { animation: 'dashFlow 0.8s linear infinite' } : undefined}
    />
  );
}

function CurvedEdge({ x1, y1, x2, y2, color, active }: {
  x1: number; y1: number; x2: number; y2: number; color: string; active?: boolean;
}) {
  const mid = (y1 + y2) / 2;
  return (
    <path
      d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`}
      fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={active ? 0.8 : 0.45}
      strokeDasharray={active ? '6 3' : undefined}
      markerEnd={`url(#arr-${color.replace('#', '')})`}
      style={active ? { animation: 'dashFlow 0.8s linear infinite' } : undefined}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentInteractionGraph({ agentFleet, anomalyEvents, agentPhase }: AgentInteractionGraphProps) {
  const roles = agentFleet?.roles;
  const activeAnomalies = useMemo(() => anomalyEvents.filter(e => e.status === 'active'), [anomalyEvents]);
  const hasActive = activeAnomalies.length > 0;

  const corrId = activeAnomalies[0]?.id.slice(0, 6) ?? '—';

  const traceRows = useMemo(() => anomalyEvents.slice(0, 8).map(e => ({
    ts: new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false }),
    corrId: e.id.slice(0, 6),
    event: e.status === 'active' ? 'anomaly-detected'
         : e.status === 'resolved' ? 'remediation-complete'
         : 'acknowledged',
    detail: e.deepAnalysis?.anomalyType
      ? `${e.deepAnalysis.relatedComponents?.[0] ?? 'component'}: ${e.deepAnalysis.anomalyType}`
      : e.id,
    latency: `${Math.floor(50 + (parseInt(e.id.slice(-3), 16) % 900))}ms`,
  })), [anomalyEvents]);

  // Stat label for each agent
  const stat = (key: string, layer: 'pipeline' | 'domain' | 'action') => {
    if (!roles) return '—';
    const r = roles[key];
    if (!r) return '—';
    if (layer === 'action') return `${r.running} actions`;
    if (key === 'cost') return `$${(agentFleet?.kpi.throughputPerMin ?? 0).toFixed(0)}/day`;
    return `${r.running.toLocaleString()} cycles`;
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

          {/* ── Pipeline horizontal edges ── */}
          <HEdge x1={75 + NODE_W/2} y={58} x2={227 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'collector', 'detector')} />
          <HEdge x1={227 + NODE_W/2} y={58} x2={380 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'detector', 'analyzer')} />
          <HEdge x1={380 + NODE_W/2} y={58} x2={532 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'analyzer', 'executor')} />
          <HEdge x1={532 + NODE_W/2} y={58} x2={685 - NODE_W/2} color="#0055AA" active={isEdgeActive(agentPhase, 'executor', 'verifier')} />

          {/* ── Pipeline → Domain cross edges ── */}
          <CurvedEdge x1={227} y1={58 + ph} x2={227} y2={195 - ph} color="#007A00" active={isEdgeActive(agentPhase, 'detector', 'security')} />
          <CurvedEdge x1={227} y1={58 + ph} x2={75}  y2={195 - ph} color="#007A00" />
          <CurvedEdge x1={380} y1={58 + ph} x2={380} y2={195 - ph} color="#007A00" />
          <CurvedEdge x1={380} y1={58 + ph} x2={532} y2={195 - ph} color="#007A00" active={hasActive} />

          {/* ── Domain → Action cross edges ── */}
          <CurvedEdge x1={75}  y1={195 + ph} x2={258} y2={320 - ph} color="#CC6600" />
          <CurvedEdge x1={227} y1={195 + ph} x2={258} y2={320 - ph} color="#D40000" active={hasActive} />
          <CurvedEdge x1={532} y1={195 + ph} x2={258} y2={320 - ph} color="#CC6600" />
          <CurvedEdge x1={380} y1={195 + ph} x2={503} y2={320 - ph} color="#007A00" />
          <CurvedEdge x1={227} y1={195 + ph} x2={503} y2={320 - ph} color="#CC6600" active={hasActive} />

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
          display: 'grid', gridTemplateColumns: '70px 60px 155px 1fr 58px',
          padding: '3px 10px', background: '#0A0A0A', color: 'white',
          fontFamily: FONT, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase', position: 'sticky', top: 0,
        }}>
          <span>TIME</span><span>CORR-ID</span><span>EVENT</span><span>DETAIL</span>
          <span style={{ textAlign: 'right' }}>LATENCY</span>
        </div>
        {traceRows.length === 0 ? (
          <div style={{ padding: '8px 10px', fontFamily: FONT, fontSize: 10, color: '#A0A0A0' }}>
            이상 이벤트 없음 — 정상 운영 중
          </div>
        ) : traceRows.map((row, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '70px 60px 155px 1fr 58px',
            padding: '3px 10px', borderBottom: '1px solid #F0F0F0',
            fontFamily: FONT, fontSize: 10, alignItems: 'center',
            background: i % 2 === 1 ? '#F7F7F7' : '#FFFFFF',
          }}>
            <span style={{ color: '#707070', fontSize: 9 }}>{row.ts}</span>
            <span style={{ color: '#0055AA', fontSize: 9, fontWeight: 600 }}>{row.corrId}</span>
            <span style={{ color: '#3A3A3A' }}>{row.event}</span>
            <span style={{ color: '#0A0A0A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.detail}</span>
            <span style={{ color: '#007A00', textAlign: 'right', fontWeight: 600 }}>{row.latency}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
