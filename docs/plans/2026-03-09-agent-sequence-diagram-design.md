# Agent Sequence Diagram — Design Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan.

**Goal:** Replace the 3D `AgentNetworkGraph` (Three.js) with a 2D animated sequence diagram that clearly shows real-time agent-to-agent message flow during each agent loop cycle.

**Architecture:** New React component (`AgentSequenceDiagram`) using SVG for arrows and CSS animations. Receives `agentPhase` + live metrics/anomaly props from `page.tsx`. Accumulates messages per cycle, resets on `observe`. Agent names per domain configurable via env var.

**Tech Stack:** React, SVG, Tailwind CSS, CSS `stroke-dashoffset` animation. No Three.js, no Framer Motion dependency.

---

## 1. Layout

Five fixed domain columns, always rendered in pipeline order:

```
COLLECTOR       DETECTOR       ANALYZER       EXECUTOR      VERIFIER
metrics-agent · anomaly-agent · ai-agent   · scale-agent · verify-agent
     │               │               │               │            │
     │  cpu 45%      │               │               │            │
     │  tx 127       │               │               │            │  ← observe
     ├───────────────▶               │               │            │  ← detect
     │          z=3.2 HIGH           │               │            │
     │               ├───────────────▶               │            │  ← analyze
     │               └───────────────────────────────▶            │
     │                          score 74             │            │
     │                                               ├────────────▶  ← verify
     │                                               │  2→4 vCPU  │
```

- Columns are evenly spaced across the full width
- Each column has a vertical line (lifeline) extending downward
- Active column highlights with a subtle glow ring at the top
- Component replaces `agent-network-graph.tsx` in the same layout slot (`flex-1`, left side)

## 2. Agent Domain Headers

Each column shows:
- **Domain name** (always): `COLLECTOR`, `DETECTOR`, `ANALYZER`, `EXECUTOR`, `VERIFIER`
- **Agent name** (sublabel, configurable): read from `NEXT_PUBLIC_AGENT_NAMES` env var (JSON)

```bash
# Example env var:
NEXT_PUBLIC_AGENT_NAMES='{"collector":"metrics-agent","detector":"anomaly-agent","analyzer":"ai-agent","executor":"scale-agent","verifier":"verify-agent"}'
```

If not set, sublabel is omitted and only domain name is shown.

## 3. Messages Per Phase

| `agentPhase` | Arrow | Label content |
|---|---|---|
| `observe` | Collector self-pulse (no arrow) | `cpu {X}% · tx {N} · gas {G}` |
| `detect` | Collector → Detector | `z={score} · {severity}` or `normal` |
| `analyze` | Detector → Analyzer + Detector → Executor (parallel) | `score {N} · "{anomaly message}"` |
| `plan` | Analyzer self-pulse | `analyzing...` |
| `act` | Executor → Verifier | `{prev} → {next} vCPU` or `no action` |
| `verify` | Verifier self-pulse | `✓ applied` or `✗ failed` |
| `complete` / `idle` | No new arrow | Last cycle dims to opacity 0.3 |
| `error` | Red flash on last active column | `error` label |

Data sources for labels:
- `observe`: from `metrics.cpuUsage`, `metrics.txPoolPending`, `metrics.gasUsedRatio`
- `detect`: from `anomalyEvents[0].severity` and z-score (fallback: "normal" if no anomalies)
- `analyze`/`act`: from `scalingScore`, `currentVcpu`, `targetVcpu`

## 4. Animation

**Arrow drawing:** SVG `<line>` with `stroke-dasharray` equal to its length, `stroke-dashoffset` animates from full-length to 0 over 300ms (CSS `@keyframes draw-line`). Arrowhead: SVG `<marker>` polygon.

**Label appearance:** `opacity: 0 → 1` fade-in, 100ms delay after arrow completes (total: 400ms per message).

**Parallel arrows** (analyze phase — both Detector→Analyzer and Detector→Executor): staggered 100ms apart.

**Cycle reset:**
1. `observe` phase entered → existing messages fade to `opacity: 0.15` over 300ms
2. After 500ms → clear messages array → start new cycle fresh

**Idle state:** Last completed cycle remains visible at `opacity: 0.3` until next observe.

## 5. State Management

```ts
type AgentDomain = 'collector' | 'detector' | 'analyzer' | 'executor' | 'verifier';

interface DiagramMessage {
  id: string;
  from: AgentDomain;
  to: AgentDomain | null;   // null = self-pulse
  label: string;
  phase: string;
  timestamp: number;
}
```

- `messages: DiagramMessage[]` — accumulated for current cycle, stored in `useRef` to avoid re-render loops
- `prevPhase: string` — track phase transitions
- On `agentPhase` change: push new message, trigger animation
- On `observe` (new cycle): mark old messages for fade, then clear

## 6. Props Interface

```ts
interface AgentSequenceDiagramProps {
  agentPhase?: string;
  metrics?: {
    cpuUsage: number;
    txPoolPending: number;
    gasUsedRatio: number;
  };
  anomalyEvents?: Array<{ severity: string; message: string }>;
  scalingScore?: number;
  currentVcpu?: number;
  targetVcpu?: number;
}
```

`page.tsx` already has all these values — just pass them through. `componentStates` prop (from old 3D graph) is dropped.

## 7. Files

| File | Action |
|------|--------|
| `src/components/agent-sequence-diagram.tsx` | **Create** — new component |
| `src/components/agent-network-graph.tsx` | **Delete** — replaced |
| `src/app/page.tsx` | **Modify** — swap import + props |
| `.env.local.sample` | **Modify** — add `NEXT_PUBLIC_AGENT_NAMES` example |
