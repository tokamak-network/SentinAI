# Agent Sequence Diagram — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Three.js `AgentNetworkGraph` with a 2D animated SVG sequence diagram showing real-time agent-to-agent message flow per agent loop cycle.

**Architecture:** New component `AgentSequenceDiagram` uses SVG + CSS `stroke-dashoffset` animation. Accumulates messages per cycle via `useEffect` on `agentPhase`. Resets on `observe`. `page.tsx` swaps the import and passes existing state as props.

**Tech Stack:** React, SVG, CSS `@keyframes`, Tailwind CSS. No Three.js, no new dependencies.

**Design doc:** `docs/plans/2026-03-09-agent-sequence-diagram-design.md`

---

## Task 1: Create `AgentSequenceDiagram` component

**Files:**
- Create: `src/components/agent-sequence-diagram.tsx`

No tests for this task — it's a pure visual component. Verification is visual via dev server.

### Step 1: Create the file

Create `src/components/agent-sequence-diagram.tsx` with this exact content:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentDomain = 'collector' | 'detector' | 'analyzer' | 'executor' | 'verifier';

interface DiagramMessage {
  id: string;
  from: AgentDomain;
  to: AgentDomain | null; // null = self-pulse (observe / verify)
  label: string;
  phase: string;
  fading: boolean;
}

export interface AgentSequenceDiagramProps {
  agentPhase?: string;
  metrics?: { cpuUsage: number; txPoolPending: number };
  anomalyEvents?: Array<{ severity?: string; message?: string }>;
  scalingScore?: number;
  currentVcpu?: number;
  targetVcpu?: number;
}

// ─── Layout constants (SVG viewBox 0 0 1000 560) ─────────────────────────────

const DOMAINS: AgentDomain[] = [
  'collector', 'detector', 'analyzer', 'executor', 'verifier',
];

const DOMAIN_LABEL: Record<AgentDomain, string> = {
  collector: 'COLLECTOR',
  detector:  'DETECTOR',
  analyzer:  'ANALYZER',
  executor:  'EXECUTOR',
  verifier:  'VERIFIER',
};

const COL_X: Record<AgentDomain, number> = {
  collector: 100,
  detector:  265,
  analyzer:  450,
  executor:  635,
  verifier:  800,
};

const DOMAIN_COLOR: Record<AgentDomain, string> = {
  collector: '#6EE7F7',
  detector:  '#FB923C',
  analyzer:  '#A78BFA',
  executor:  '#4ADE80',
  verifier:  '#6EE7F7',
};

const HEADER_Y   = 72;   // lifeline start Y
const FIRST_Y    = 140;  // first message row Y
const ROW_STEP   = 60;   // px per message row
const VB_HEIGHT  = 560;
const VB_WIDTH   = 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readAgentNames(): Partial<Record<AgentDomain, string>> {
  try {
    const raw = process.env.NEXT_PUBLIC_AGENT_NAMES;
    return raw ? (JSON.parse(raw) as Partial<Record<AgentDomain, string>>) : {};
  } catch {
    return {};
  }
}

function buildMessages(
  phase: string,
  metrics: AgentSequenceDiagramProps['metrics'],
  anomalyEvents: AgentSequenceDiagramProps['anomalyEvents'],
  scalingScore: number | undefined,
  currentVcpu: number | undefined,
  targetVcpu: number | undefined,
): Omit<DiagramMessage, 'fading'>[] {
  const ts = Date.now();

  switch (phase) {
    case 'observe':
      return [{
        id: `observe-${ts}`,
        from: 'collector',
        to: null,
        label: metrics
          ? `cpu ${metrics.cpuUsage.toFixed(0)}%  ·  tx ${metrics.txPoolPending}`
          : 'collecting metrics…',
        phase,
      }];

    case 'detect': {
      const ev = anomalyEvents?.[0];
      return [{
        id: `detect-${ts}`,
        from: 'collector',
        to: 'detector',
        label: ev
          ? `${(ev.severity ?? 'anomaly').toUpperCase()} detected`
          : 'normal',
        phase,
      }];
    }

    case 'analyze': {
      const ev = anomalyEvents?.[0];
      const scoreStr = scalingScore !== undefined ? String(scalingScore) : '?';
      const shortMsg = ev?.message ? `"${ev.message.slice(0, 26)}…"` : '';
      const lbl = shortMsg ? `score ${scoreStr}  ·  ${shortMsg}` : `score ${scoreStr}`;
      return [
        { id: `analyze-a-${ts}`, from: 'detector', to: 'analyzer', label: lbl, phase },
        { id: `analyze-e-${ts}`, from: 'detector', to: 'executor', label: 'parallel', phase },
      ];
    }

    case 'act': {
      const scaled =
        targetVcpu !== undefined &&
        currentVcpu !== undefined &&
        targetVcpu !== currentVcpu;
      return [{
        id: `act-${ts}`,
        from: 'executor',
        to: 'verifier',
        label: scaled ? `${currentVcpu} → ${targetVcpu} vCPU` : 'no action',
        phase,
      }];
    }

    case 'verify':
      return [{
        id: `verify-${ts}`,
        from: 'verifier',
        to: null,
        label: '✓ verified',
        phase,
      }];

    default:
      return [];
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Animated arrow between two domains */
function ArrowMsg({
  from, to, y, label, stagger,
}: {
  from: AgentDomain;
  to: AgentDomain;
  y: number;
  label: string;
  stagger: number;
}) {
  const x1 = COL_X[from];
  const x2 = COL_X[to];
  const lineLen = Math.abs(x2 - x1);
  const midX = (x1 + x2) / 2;
  const color = DOMAIN_COLOR[from];
  const animDelay = `${stagger * 80}ms`;
  const markerId = `arrowhead-${from}`;

  return (
    <g>
      <defs>
        <marker
          id={markerId}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill={color} opacity={0.8} />
        </marker>
      </defs>
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.8}
        strokeDasharray={lineLen}
        strokeDashoffset={lineLen}
        markerEnd={`url(#${markerId})`}
        style={{
          animation: `sdDrawLine 300ms ${animDelay} ease-out forwards`,
        }}
      />
      <text
        x={midX}
        y={y - 9}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.55)"
        fontFamily="monospace"
        style={{
          animation: `sdFadeIn 200ms ${stagger * 80 + 320}ms ease-out forwards`,
          opacity: 0,
        }}
      >
        {label}
      </text>
    </g>
  );
}

/** Pulse ring for self-messages (observe / verify) */
function PulseMsg({
  domain, y, label,
}: {
  domain: AgentDomain;
  y: number;
  label: string;
}) {
  const cx = COL_X[domain];
  const color = DOMAIN_COLOR[domain];
  return (
    <g>
      <circle
        cx={cx}
        cy={y}
        r={0}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeOpacity={0.6}
        style={{ animation: 'sdPulseRing 600ms ease-out forwards' }}
      />
      <text
        x={cx}
        y={y - 14}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.55)"
        fontFamily="monospace"
        style={{ animation: 'sdFadeIn 200ms 300ms ease-out forwards', opacity: 0 }}
      >
        {label}
      </text>
    </g>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AgentSequenceDiagram({
  agentPhase = 'idle',
  metrics,
  anomalyEvents,
  scalingScore,
  currentVcpu,
  targetVcpu,
}: AgentSequenceDiagramProps) {
  const [messages, setMessages] = useState<DiagramMessage[]>([]);
  const prevPhaseRef = useRef<string>('idle');
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentNames = readAgentNames();

  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = agentPhase;

    // New cycle: fade old messages, then clear
    if (agentPhase === 'observe' && prev !== 'idle' && prev !== 'observe') {
      setMessages((m) => m.map((msg) => ({ ...msg, fading: true })));
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = setTimeout(() => {
        setMessages([]);
      }, 600);
      return;
    }

    const newMsgs = buildMessages(
      agentPhase,
      metrics,
      anomalyEvents,
      scalingScore,
      currentVcpu,
      targetVcpu,
    );

    if (newMsgs.length > 0) {
      setMessages((m) => [
        ...m,
        ...newMsgs.map((msg) => ({ ...msg, fading: false })),
      ]);
    }
  }, [agentPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute Y for each message slot
  const msgY = (index: number) =>
    Math.min(FIRST_Y + index * ROW_STEP, VB_HEIGHT - 40);

  const lifelineEnd = VB_HEIGHT - 20;

  return (
    <div className="w-full h-full glass-panel rounded-xl overflow-hidden relative">
      {/* Inject CSS keyframes */}
      <style>{`
        @keyframes sdDrawLine {
          to { stroke-dashoffset: 0; }
        }
        @keyframes sdFadeIn {
          to { opacity: 1; }
        }
        @keyframes sdPulseRing {
          0%  { r: 0;  stroke-opacity: 0.8; }
          60% { r: 18; stroke-opacity: 0.4; }
          100%{ r: 24; stroke-opacity: 0; }
        }
      `}</style>

      <svg
        viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* ── Column headers ───────────────────────────────────────── */}
        {DOMAINS.map((domain) => {
          const cx = COL_X[domain];
          const color = DOMAIN_COLOR[domain];
          const subName = agentNames[domain];
          const isActive =
            (agentPhase === 'observe' && domain === 'collector') ||
            (agentPhase === 'detect'  && (domain === 'collector' || domain === 'detector')) ||
            ((agentPhase === 'analyze' || agentPhase === 'plan') && (domain === 'detector' || domain === 'analyzer' || domain === 'executor')) ||
            (agentPhase === 'act'     && (domain === 'executor' || domain === 'verifier')) ||
            (agentPhase === 'verify'  && domain === 'verifier');

          return (
            <g key={domain}>
              {/* Active glow ring */}
              {isActive && (
                <circle
                  cx={cx}
                  cy={36}
                  r={22}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  strokeOpacity={0.3}
                />
              )}

              {/* Domain name */}
              <text
                x={cx}
                y={24}
                textAnchor="middle"
                fontSize={10}
                fontWeight="600"
                letterSpacing="2"
                fontFamily="monospace"
                fill={isActive ? color : 'rgba(255,255,255,0.35)'}
              >
                {DOMAIN_LABEL[domain]}
              </text>

              {/* Agent sublabel */}
              {subName && (
                <text
                  x={cx}
                  y={40}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily="monospace"
                  fill="rgba(255,255,255,0.25)"
                >
                  {subName}
                </text>
              )}

              {/* Lifeline */}
              <line
                x1={cx}
                y1={HEADER_Y}
                x2={cx}
                y2={lifelineEnd}
                stroke={isActive ? color : 'rgba(255,255,255,0.08)'}
                strokeWidth={isActive ? 1.5 : 1}
                strokeDasharray={isActive ? 'none' : '4 4'}
              />
            </g>
          );
        })}

        {/* ── Messages ─────────────────────────────────────────────── */}
        {messages.map((msg, i) => {
          const y = msgY(i);
          const opacity = msg.fading ? 0.15 : 1;
          const color = DOMAIN_COLOR[msg.from];

          // Count how many messages in same phase (for stagger)
          const phaseIdx = messages
            .slice(0, i)
            .filter((m) => m.phase === msg.phase).length;

          return (
            <g
              key={msg.id}
              style={{
                opacity,
                transition: msg.fading ? 'opacity 600ms ease' : undefined,
              }}
            >
              {msg.to === null ? (
                <PulseMsg domain={msg.from} y={y} label={msg.label} />
              ) : (
                <ArrowMsg
                  from={msg.from}
                  to={msg.to}
                  y={y}
                  label={msg.label}
                  stagger={phaseIdx}
                />
              )}
              {/* Row dot on lifeline */}
              <circle
                cx={COL_X[msg.from]}
                cy={y}
                r={3}
                fill={color}
                fillOpacity={0.7}
              />
            </g>
          );
        })}

        {/* ── Idle/complete state label ─────────────────────────────── */}
        {(agentPhase === 'idle' || agentPhase === 'complete') && messages.length === 0 && (
          <text
            x={VB_WIDTH / 2}
            y={VB_HEIGHT / 2}
            textAnchor="middle"
            fontSize={11}
            fontFamily="monospace"
            fill="rgba(255,255,255,0.2)"
          >
            awaiting next cycle…
          </text>
        )}
      </svg>
    </div>
  );
}
```

### Step 2: Build check

```bash
cd /Users/theo/workspace_tokamak/SentinAI && npm run build 2>&1 | grep -E "error|Error|✓ Compiled"
```

Expected: `✓ Compiled` — no errors.

### Step 3: Commit

```bash
git add src/components/agent-sequence-diagram.tsx
git commit -m "feat(agent-sequence-diagram): add 2D animated SVG sequence diagram"
```

---

## Task 2: Update `page.tsx` — swap AgentNetworkGraph for AgentSequenceDiagram

**Files:**
- Modify: `src/app/page.tsx`

This is a LARGE file (~2200+ lines). Make only these targeted changes.

### Step 1: Read the relevant section

Read `src/app/page.tsx` lines 20–30 (imports) and lines 975–990 (graph usage).

### Step 2: Replace import (line ~24–29)

Find:
```tsx
import type { NodeState } from '@/components/agent-network-graph';

const AgentNetworkGraph = dynamic(
  () => import('@/components/agent-network-graph').then((m) => m.AgentNetworkGraph),
  { ssr: false, loading: () => <div className="w-full h-full bg-card animate-pulse rounded-lg" /> }
);
```

Replace with:
```tsx
import { AgentSequenceDiagram } from '@/components/agent-sequence-diagram';
```

Note: `NodeState` type may be used elsewhere — check if it's used in page.tsx after removing the import. If `NodeState` is used elsewhere in the file, keep it as a local interface or import from the types file.

### Step 3: Replace the JSX usage (line ~979–985)

Find:
```tsx
        {/* Left: 3D Agent Graph (65%) */}
        <div className="flex-1 min-h-0 p-3">
          <AgentNetworkGraph
            componentStates={componentStates}
            agentPhase={graphAgentPhase}
          />
        </div>
```

Replace with:
```tsx
        {/* Left: Agent Sequence Diagram */}
        <div className="flex-1 min-h-0 p-3">
          <AgentSequenceDiagram
            agentPhase={graphAgentPhase}
            metrics={current?.metrics ? {
              cpuUsage: current.metrics.cpuUsage,
              txPoolPending: current.metrics.txPoolCount,
            } : undefined}
            anomalyEvents={anomalyEvents.map((e) => ({
              severity: e.severity,
              message: e.message,
            }))}
            scalingScore={agentLoop?.lastCycle?.scaling?.score}
            currentVcpu={scalerState?.currentVcpu ?? agentLoop?.lastCycle?.scaling?.currentVcpu}
            targetVcpu={agentLoop?.lastCycle?.scaling?.targetVcpu ?? scalerState?.currentVcpu}
          />
        </div>
```

### Step 4: Check NodeState usage

Search the file for any remaining `NodeState` or `componentStates` references that depended on the old import:

```bash
grep -n "NodeState\|componentStates\|agent-network-graph" src/app/page.tsx
```

If `componentStates` is still used elsewhere in page.tsx (e.g. for other UI elements), keep that state variable but remove the `NodeState` type import (it came from agent-network-graph.tsx which we're replacing). Define it locally if needed:
```tsx
type NodeState = 'normal' | 'anomaly' | 'critical' | 'inactive';
```

### Step 5: Build check

```bash
npm run build 2>&1 | grep -E "error|Error|✓ Compiled"
```

Expected: `✓ Compiled`

### Step 6: Commit

```bash
git add src/app/page.tsx
git commit -m "feat(page): swap 3D graph for 2D agent sequence diagram"
```

---

## Task 3: Delete old 3D graph file + add env example

**Files:**
- Delete: `src/components/agent-network-graph.tsx`
- Modify: `.env.local.sample`

### Step 1: Confirm the old file is safe to delete

```bash
grep -r "agent-network-graph" src/ --include="*.tsx" --include="*.ts"
```

Expected: no results (after Task 2, no file should import it anymore).

### Step 2: Delete the file

```bash
rm src/components/agent-network-graph.tsx
```

### Step 3: Add agent names example to .env.local.sample

Find `.env.local.sample` and add this block near the end:

```bash
# Agent names per domain (optional — shown as sublabels in sequence diagram)
# NEXT_PUBLIC_AGENT_NAMES='{"collector":"metrics-agent","detector":"anomaly-agent","analyzer":"ai-agent","executor":"scale-agent","verifier":"verify-agent"}'
```

### Step 4: Final build + lint

```bash
npm run build 2>&1 | tail -5
npm run lint 2>&1 | tail -5
```

Expected: `✓ Compiled`, lint warnings ≤ existing count.

### Step 5: Push

```bash
git add -A
git commit -m "chore: remove 3D agent-network-graph, add NEXT_PUBLIC_AGENT_NAMES env example"
git push origin main
```

---

## Visual Verification

After all tasks complete, start dev server and verify:

```bash
npm run dev
```

Open `http://localhost:3002` and check:

1. ☐ Left panel shows 5 domain columns with lifelines (no 3D canvas)
2. ☐ Column headers show domain names (`COLLECTOR`, `DETECTOR`, etc.)
3. ☐ In idle state: "awaiting next cycle…" text visible
4. ☐ Inject a seed scenario (Simulate → Spike) and watch arrows animate in sequence
5. ☐ After a new cycle, old arrows fade and clear
6. ☐ Component renders without console errors
