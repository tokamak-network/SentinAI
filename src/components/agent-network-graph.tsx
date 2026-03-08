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

// ─── Agent role colors (fixed per role) ──────────────────────────────────────
const AGENT_COLORS: Record<AgentId, string> = {
  collector: '#3B82F6', // blue
  detector:  '#F59E0B', // amber
  analyzer:  '#A78BFA', // purple
  executor:  '#10FFAA', // mint
  verifier:  '#22D3EE', // cyan
};

// ─── Phase → which agents are active ─────────────────────────────────────────
const PHASE_ACTIVE: Record<string, AgentId[]> = {
  observe:  ['collector'],
  detect:   ['collector', 'detector'],
  analyze:  ['detector', 'analyzer'],
  plan:     ['analyzer'],
  act:      ['executor'],
  verify:   ['verifier'],
  complete: [],
  idle:     [],
  error:    [],
};

// ─── Pipeline edges ───────────────────────────────────────────────────────────
interface PipelineEdge {
  from: AgentId;
  to: AgentId;
  activePhases: string[];
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

// ─── Infra mini-cluster ───────────────────────────────────────────────────────
const INFRA_NODES: { id: string; position: [number, number, number] }[] = [
  { id: 'l1',          position: [-5.6,  0.5, 0] },
  { id: 'op-node',     position: [-5.6, -0.5, 0] },
  { id: 'op-geth',     position: [-5.2,  0.8, 0] },
  { id: 'op-batcher',  position: [-5.2,  0,   0] },
  { id: 'op-proposer', position: [-5.2, -0.8, 0] },
];

const INFRA_CONNECTOR: [number, number, number] = [-5.4, 0, 0];

const STATE_COLORS: Record<NodeState, string> = {
  normal:   '#2A4A6A',
  anomaly:  '#F59E0B',
  critical: '#EF4444',
  inactive: '#2A4A6A', // intentionally same as normal — infra shows no distinction when inactive
};

/** Sonar pulse ring — rendered at a given world position */
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

/** 5 tiny infra spheres near Collector. Color from componentStates anomaly state. */
function InfraCluster({ componentStates }: { componentStates: Record<string, NodeState> }) {
  return (
    <group>
      {INFRA_NODES.map((node) => {
        const state = componentStates[node.id] ?? 'normal';
        const color = STATE_COLORS[state];
        const isAnomaly = state === 'anomaly' || state === 'critical';
        return (
          <mesh key={node.id} position={node.position}>
            <sphereGeometry args={[0.1, 12, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={isAnomaly ? 1.2 : 0.3}
            />
          </mesh>
        );
      })}
      {/* Connector line from cluster to Collector */}
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

/** Single agent pipeline node. Glows and pulses when active. */
function AgentNodeMesh({
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

function Scene({
  componentStates,
  agentPhase,
}: {
  componentStates: Record<string, NodeState>;
  agentPhase?: string;
}) {
  const phase = agentPhase ?? 'idle';
  const activeAgents = new Set(PHASE_ACTIVE[phase] ?? []);

  const posMap = useMemo(
    () => Object.fromEntries(AGENT_NODES.map((n) => [n.id, n.position])) as Record<AgentId, [number, number, number]>,
    [],
  );

  const showPulse = phase === 'detect' || phase === 'analyze';
  const detectorPos = posMap['detector'];
  const showInfraPacket = phase === 'observe';

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 5, 5]} intensity={0.8} color="#3B82F6" />
      <pointLight position={[0, -5, -5]} intensity={0.4} color="#10FFAA" />

      <InfraCluster componentStates={componentStates} />

      {showInfraPacket && (
        <PacketParticle
          from={INFRA_CONNECTOR}
          to={AGENT_NODES[0].position}
          color={AGENT_COLORS.collector}
          speed={0.8}
        />
      )}

      {showPulse && <PulseRing position={detectorPos} color={AGENT_COLORS.detector} initialOffset={0} />}
      {showPulse && <PulseRing position={detectorPos} color={AGENT_COLORS.detector} initialOffset={0.5} />}

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

      {AGENT_NODES.map((node) => (
        <AgentNodeMesh
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
