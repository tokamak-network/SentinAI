# Agent v2 Network Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `AgentNetworkGraph` to show the 5-agent pipeline (Collector → Detector → [Analyzer ‖ Executor] → Verifier) with infra mini-cluster, replacing the current SentinAI-center pentagon layout.

**Architecture:** Single file rewrite of `src/components/agent-network-graph.tsx`. Props interface unchanged — `componentStates` drives infra cluster colors, `agentPhase` drives which agent nodes are active. No backend changes.

**Tech Stack:** React Three Fiber (`@react-three/fiber`), `@react-three/drei` (Line, Billboard, Text, OrbitControls), `three`

---

## Context for implementer

Read the design doc first: `docs/plans/2026-03-09-agent-v2-graph-design.md`

The current file (`src/components/agent-network-graph.tsx`, 370 lines) will be fully replaced. The exported component `AgentNetworkGraph` and its props interface must remain identical so `src/app/page.tsx` needs no changes.

The current code uses:
- `PulseRing` — keep, but position it at the Detector node
- `PacketParticle` — keep unchanged
- `Line` from drei — keep for edges
- `Billboard` + `Text` — keep for labels

---

## Task 1: New constants and phase-mapping utilities

**Files:**
- Modify: `src/components/agent-network-graph.tsx` (replace entire file)

**Step 1: Replace the file with new constants block**

Write this as the new top of the file (keep existing imports):

```tsx
'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, OrbitControls, Billboard, Line } from '@react-three/drei';
import * as THREE from 'three';

// ─── Public types (unchanged — page.tsx depends on these) ─────────────────────
export type NodeState = 'normal' | 'anomaly' | 'critical' | 'inactive';

interface AgentNetworkGraphProps {
  componentStates: Record<string, NodeState>;
  agentPhase?: string;
}

// ─── Agent pipeline nodes ─────────────────────────────────────────────────────
type AgentId = 'collector' | 'detector' | 'analyzer' | 'executor' | 'verifier';

interface AgentNode {
  id: AgentId;
  label: string;
  position: [number, number, number];
}

const AGENT_NODES: AgentNode[] = [
  { id: 'collector', label: 'Collector', position: [-3.5, 0, 0] },
  { id: 'detector',  label: 'Detector',  position: [-1,   0, 0] },
  { id: 'analyzer',  label: 'Analyzer',  position: [ 1.5, 2, 0] },
  { id: 'executor',  label: 'Executor',  position: [ 1.5,-2, 0] },
  { id: 'verifier',  label: 'Verifier',  position: [ 3.5, 0, 0] },
];

// ─── Agent role colors (fixed per role, not phase-driven) ─────────────────────
const AGENT_COLORS: Record<AgentId, string> = {
  collector: '#3B82F6', // blue
  detector:  '#F59E0B', // amber
  analyzer:  '#A78BFA', // purple
  executor:  '#10FFAA', // green
  verifier:  '#22D3EE', // cyan
};

// ─── Phase → which agents are active ─────────────────────────────────────────
const PHASE_ACTIVE: Record<string, AgentId[]> = {
  observe:  ['collector'],
  detect:   ['collector', 'detector'],
  analyze:  ['detector', 'analyzer', 'executor'],
  plan:     ['analyzer'],
  act:      ['executor'],
  verify:   ['verifier'],
  complete: [],
  idle:     [],
  error:    [],
};

// ─── Infra component ids (from componentStates keys) ─────────────────────────
const INFRA_IDS = ['l1', 'op-node', 'op-geth', 'op-batcher', 'op-proposer'];

// Infra cluster: 5 small spheres arranged in a 2-row grid near Collector
const INFRA_POSITIONS: [number, number, number][] = [
  [-5.6,  0.5, 0],
  [-5.6, -0.5, 0],
  [-5.2,  0.8, 0],
  [-5.2,  0,   0],
  [-5.2, -0.8, 0],
];

const STATE_COLORS: Record<NodeState, string> = {
  normal:   '#2A4A6A',
  anomaly:  '#F59E0B',
  critical: '#EF4444',
  inactive: '#2A4A6A',
};

// Infra cluster connects to Collector at this position
const INFRA_CONNECTOR: [number, number, number] = [-5.4, 0, 0];
```

**Step 2: Verify the file starts correctly**

```bash
head -80 src/components/agent-network-graph.tsx
```

Expected: see the constants block above with no TypeScript errors when you run:

```bash
npm run build 2>&1 | head -30
```

**Step 3: Commit**

```bash
git add src/components/agent-network-graph.tsx
git commit -m "refactor(graph): replace constants with agent pipeline layout"
```

---

## Task 2: InfraCluster and AgentNode components

**Files:**
- Modify: `src/components/agent-network-graph.tsx` (append after constants)

**Step 1: Add PulseRing (unchanged from current, keep as-is)**

```tsx
/** Sonar pulse ring — rendered at a specific world position */
function PulseRing({
  position,
  color,
  initialOffset = 0,
}: {
  position: [number, number, number];
  color: string;
  initialOffset?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const t = useRef(initialOffset);

  useFrame((_, delta) => {
    t.current = (t.current + delta * 0.5) % 1;
    const s = t.current;
    if (!meshRef.current) return;
    meshRef.current.scale.setScalar(0.5 + s * 4);
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.6 * (1 - s);
  });

  return (
    <mesh ref={meshRef} position={position}>
      <torusGeometry args={[0.5, 0.018, 8, 64]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} />
    </mesh>
  );
}
```

**Step 2: Add PacketParticle (unchanged)**

```tsx
/** Packet traveling along an edge */
function PacketParticle({
  from,
  to,
  color,
  speed = 1,
  offset = 0,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  speed?: number;
  offset?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const progress = useRef(offset);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    progress.current = (progress.current + delta * speed * 0.35) % 1;
    const p = progress.current;
    meshRef.current.position.set(
      from[0] + (to[0] - from[0]) * p,
      from[1] + (to[1] - from[1]) * p,
      from[2] + (to[2] - from[2]) * p,
    );
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
    </mesh>
  );
}
```

**Step 3: Add InfraCluster component**

```tsx
/** 5 tiny infra spheres grouped near Collector. Color from componentStates. */
function InfraCluster({ componentStates }: { componentStates: Record<string, NodeState> }) {
  return (
    <group>
      {INFRA_IDS.map((id, i) => {
        const pos = INFRA_POSITIONS[i];
        const state = componentStates[id] ?? 'normal';
        const color = STATE_COLORS[state];
        const isAnomaly = state === 'anomaly' || state === 'critical';
        return (
          <mesh key={id} position={pos}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isAnomaly ? 1.2 : 0.3}
            />
          </mesh>
        );
      })}
      {/* Small bracket line connecting cluster to Collector */}
      <Line
        points={[INFRA_CONNECTOR, AGENT_NODES[0].position]}
        color="#1A2B4A"
        lineWidth={1}
        transparent
        opacity={0.4}
      />
    </group>
  );
}
```

**Step 4: Add AgentNode component**

```tsx
/** Single agent pipeline node. Active state driven by phase. */
function AgentNode({
  node,
  isActive,
}: {
  node: AgentNode;
  isActive: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const color = AGENT_COLORS[node.id];

  // Analyzer gets a rotating ring when active (AI processing signal)
  const hasRing = node.id === 'analyzer' && isActive;

  useFrame(() => {
    if (!meshRef.current) return;
    const amplitude = isActive ? 0.1 : 0.02;
    const freq = isActive ? 0.004 : 0.002;
    const scale = 1 + Math.sin(Date.now() * freq) * amplitude;
    meshRef.current.scale.setScalar(scale);
    if (haloRef.current) haloRef.current.scale.setScalar(scale);
    if (ringRef.current) ringRef.current.rotation.z += 0.025;
  });

  return (
    <group position={node.position}>
      {/* Opaque inner sphere */}
      <mesh ref={meshRef} renderOrder={2}>
        <sphereGeometry args={[0.22, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 1.0 : 0.25}
          opacity={isActive ? 1 : 0.5}
          transparent
        />
      </mesh>
      {/* Halo glow */}
      <mesh ref={haloRef} renderOrder={1}>
        <sphereGeometry args={[0.36, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isActive ? 0.12 : 0.03}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Rotating ring on Analyzer during AI processing */}
      {hasRing && (
        <mesh ref={ringRef}>
          <torusGeometry args={[0.34, 0.014, 8, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
        </mesh>
      )}
      <Billboard>
        <Text
          position={[0, -0.48, 0]}
          fontSize={0.13}
          color={isActive ? '#E8F4FF' : '#4A6A8A'}
          anchorX="center"
          anchorY="top"
        >
          {node.label}
        </Text>
      </Billboard>
    </group>
  );
}
```

**Step 5: Build check**

```bash
npm run build 2>&1 | head -30
```

Expected: no TypeScript errors.

**Step 6: Commit**

```bash
git add src/components/agent-network-graph.tsx
git commit -m "refactor(graph): add InfraCluster and AgentNode components"
```

---

## Task 3: Scene and export wrapper

**Files:**
- Modify: `src/components/agent-network-graph.tsx` (append Scene + export)

**Step 1: Define pipeline edges**

Add this constant after INFRA_POSITIONS:

```tsx
interface PipelineEdge {
  from: AgentId;
  to: AgentId;
  /** Phases during which this edge is lit (not dim) */
  activePhases: string[];
  /** Phases during which a packet travels this edge */
  packetPhases: string[];
}

const PIPELINE_EDGES: PipelineEdge[] = [
  {
    from: 'collector', to: 'detector',
    activePhases: ['observe', 'detect', 'analyze', 'plan', 'act', 'verify'],
    packetPhases: ['detect', 'analyze'],
  },
  {
    from: 'detector', to: 'analyzer',
    activePhases: ['detect', 'analyze', 'plan', 'verify', 'complete'],
    packetPhases: ['analyze', 'plan'],
  },
  {
    from: 'detector', to: 'executor',
    activePhases: ['detect', 'analyze', 'act', 'verify', 'complete'],
    packetPhases: ['analyze', 'act'],
  },
  {
    from: 'analyzer', to: 'verifier',
    activePhases: ['plan', 'verify', 'complete'],
    packetPhases: ['verify'],
  },
  {
    from: 'executor', to: 'verifier',
    activePhases: ['act', 'verify', 'complete'],
    packetPhases: ['verify'],
  },
];
```

**Step 2: Add Scene component**

```tsx
function Scene({
  componentStates,
  agentPhase,
}: {
  componentStates: Record<string, NodeState>;
  agentPhase?: string;
}) {
  const phase = agentPhase ?? 'idle';
  const activeAgents = new Set(PHASE_ACTIVE[phase] ?? []);

  // Build position lookup for edges
  const posMap = useMemo(
    () => Object.fromEntries(AGENT_NODES.map((n) => [n.id, n.position])),
    [],
  );

  // Sonar pulse at Detector when anomaly is being detected
  const showPulse = phase === 'detect' || phase === 'analyze';
  const detectorPos = posMap['detector'] as [number, number, number];

  // Infra → Collector packet during observe phase
  const showInfraPacket = phase === 'observe';

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 5, 5]} intensity={0.8} color="#3B82F6" />
      <pointLight position={[0, -5, -5]} intensity={0.4} color="#10FFAA" />

      {/* Infra cluster */}
      <InfraCluster componentStates={componentStates} />

      {/* Infra → Collector packet */}
      {showInfraPacket && (
        <PacketParticle
          from={INFRA_CONNECTOR}
          to={AGENT_NODES[0].position}
          color={AGENT_COLORS.collector}
          speed={0.8}
        />
      )}

      {/* Sonar pulse rings at Detector */}
      {showPulse && <PulseRing position={detectorPos} color={AGENT_COLORS.detector} initialOffset={0} />}
      {showPulse && <PulseRing position={detectorPos} color={AGENT_COLORS.detector} initialOffset={0.5} />}

      {/* Pipeline edges */}
      {PIPELINE_EDGES.map((edge) => {
        const fromPos = posMap[edge.from];
        const toPos = posMap[edge.to];
        const isLit = edge.activePhases.includes(phase);
        const showPacket = edge.packetPhases.includes(phase);
        const color = AGENT_COLORS[edge.to];

        return (
          <group key={`${edge.from}-${edge.to}`}>
            <Line
              points={[fromPos, toPos]}
              color={isLit ? color : '#1A2B4A'}
              lineWidth={isLit ? 1.5 : 0.8}
              transparent
              opacity={isLit ? 0.55 : 0.15}
            />
            {showPacket && (
              <PacketParticle
                from={fromPos}
                to={toPos}
                color={color}
                speed={0.9}
              />
            )}
          </group>
        );
      })}

      {/* Agent pipeline nodes */}
      {AGENT_NODES.map((node) => (
        <AgentNode
          key={node.id}
          node={node}
          isActive={activeAgents.has(node.id)}
        />
      ))}

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        autoRotate
        autoRotateSpeed={0.3}
      />
    </>
  );
}
```

**Step 3: Add export wrapper**

```tsx
export function AgentNetworkGraph({
  componentStates,
  agentPhase,
}: AgentNetworkGraphProps) {
  return (
    <div className="w-full h-full min-h-[400px]">
      <Canvas
        camera={{ position: [0, 0, 11], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Scene componentStates={componentStates} agentPhase={agentPhase} />
      </Canvas>
    </div>
  );
}
```

**Step 4: Build check**

```bash
npm run build 2>&1 | head -40
```

Expected: clean build, no errors.

**Step 5: Lint check**

```bash
npm run lint 2>&1 | head -20
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/components/agent-network-graph.tsx
git commit -m "feat(graph): rewrite to agent v2 pipeline layout (Collector→Detector→[Analyzer‖Executor]→Verifier)"
```

---

## Task 4: Visual smoke test

**Step 1: Start dev server**

```bash
npm run dev
```

Open `http://localhost:3002` in browser.

**Step 2: Verify idle state**

With no seed scenario:
- 5 agent nodes visible, all dim
- Infra cluster: 5 small spheres bottom-left
- No packets, no pulse rings
- Graph auto-rotates slowly

**Step 3: Inject spike scenario and verify active state**

```bash
curl -X POST http://localhost:3002/api/metrics/seed?scenario=spike \
  -H "x-api-key: test"
```

Wait 10 seconds, then observe the graph:
- Collector → Detector should be lit
- Detector should show sonar pulse rings
- Packets should flow Collector → Detector
- Active nodes should glow brighter

**Step 4: Verify `complete` phase shows all dim**

After the agent loop cycle completes (`complete` phase), all nodes should return to dim state with no phase label shown.

**Step 5: Commit any fixes found**

```bash
git add src/components/agent-network-graph.tsx
git commit -m "fix(graph): visual corrections from smoke test"
```

---

## Summary

| Task | File | Lines changed |
|------|------|---------------|
| 1 | `agent-network-graph.tsx` | Replace constants (~60 lines) |
| 2 | `agent-network-graph.tsx` | Add 4 components (~120 lines) |
| 3 | `agent-network-graph.tsx` | Add Scene + export (~80 lines) |
| 4 | — | Visual verification |

Total: ~260 lines (vs current 370). No changes to `page.tsx` or any other file.
