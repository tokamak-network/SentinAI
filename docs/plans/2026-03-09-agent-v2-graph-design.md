# Agent v2 Network Graph Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan.

**Goal:** Redesign `AgentNetworkGraph` to accurately represent the agent v2 architecture — 5 key pipeline agents with event-driven parallel flow, infra components minimized to a small cluster.

**Architecture:** Left-to-right directed pipeline: Collector → Detector → [Analyzer ‖ Executor] → Verifier. Infra mini-cluster (5 small spheres) positioned near Collector to show data source. Event packets flow along active edges only.

**Tech Stack:** React Three Fiber, @react-three/drei (Line, Billboard, Text, OrbitControls), THREE.js

---

## Layout

5 agent nodes in a directed left-to-right arrangement:

| Agent | Position | Role |
|-------|----------|------|
| Collector | `[-4, 0, 0]` | Collects metrics from infra (5s interval) |
| Detector | `[-1.5, 0, 0]` | Anomaly detection hub (10s interval) |
| Analyzer | `[1.5, 2, 0]` | AI deep analysis (parallel branch) |
| Executor | `[1.5, -2, 0]` | Scaling execution (parallel branch) |
| Verifier | `[4, 0, 0]` | Post-condition verification |

Infra mini-cluster: 5 small spheres (radius 0.08) grouped at `[-6.5, 0, 0]`, connected to Collector via a single dim edge. Labels omitted. Color reflects `componentStates` anomaly severity only.

## Edges

| Edge | Condition |
|------|-----------|
| InfraCluster → Collector | Always visible (dim), packets when `observe` |
| Collector → Detector | Always visible, packets always flow |
| Detector → Analyzer | Visible when phase is `detect`/`analyze`/`plan` |
| Detector → Executor | Visible when phase is `detect`/`analyze`/`act` |
| Analyzer → Verifier | Visible when phase is `plan`/`verify`/`complete` |
| Executor → Verifier | Visible when phase is `act`/`verify`/`complete` |

## State Mapping

| `agentPhase` | Active nodes | Packet direction | Color |
|---|---|---|---|
| `observe` | Collector | Infra → Collector | blue `#3B82F6` |
| `detect` | Detector | Collector → Detector | amber `#F59E0B` |
| `analyze` | Analyzer + Executor | Detector → both (parallel) | purple + green |
| `plan` | Analyzer | Analyzer pulse | purple `#A78BFA` |
| `act` | Executor | Executor → Verifier | green `#10FFAA` |
| `verify` | Verifier | both → Verifier | cyan `#22D3EE` |
| `complete` / `idle` | All dim | None | dim blue |
| `error` | Affected node red | Stopped | red `#EF4444` |

## Visual Elements

| Element | Behavior |
|---------|----------|
| Active agent node | scale pulse + increased emissive glow |
| Analyzer (AI processing) | Rotating torus ring (moved from old SentinAI center) |
| Detector (anomaly found) | 2 staggered sonar pulse rings |
| Packets | Small sphere traveling along edge, shown only on active edges |
| Verifier completion | Brief emissive flash on `verify` → `complete` transition |
| Idle agents | Low opacity halo, reduced emissive intensity |
| Infra cluster anomaly | Individual sphere color: amber=high, red=critical |

## API / Props

```ts
interface AgentNetworkGraphProps {
  componentStates: Record<string, NodeState>;  // existing — drives infra cluster
  agentPhase?: string;                          // existing — drives agent pipeline state
}
```

No new props needed. All rendering logic derived from these two inputs.

## What Changes vs Current

| Current | New |
|---------|-----|
| SentinAI center + 5 infra pentagon | 5 agent pipeline + infra mini-cluster |
| Single `agentPhase` color on center node | Each agent lights up per phase |
| Packets flow SentinAI ↔ infra | Packets flow agent → agent |
| Rotating ring on SentinAI | Rotating ring on Analyzer (AI processing) |
| Sonar rings from center | Sonar rings from Detector |
| `complete` shown as phase label | `complete`/`idle` = all nodes dim, no label |

## Files

- **Modify**: `src/components/agent-network-graph.tsx` — complete rewrite of layout + components
- **No changes**: `src/app/page.tsx` — props interface unchanged
