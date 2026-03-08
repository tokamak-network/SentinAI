'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, OrbitControls, Billboard, Line } from '@react-three/drei';
import * as THREE from 'three';

export type NodeState = 'normal' | 'anomaly' | 'critical' | 'inactive';

interface NetworkNode {
  id: string;
  label: string;
  position: [number, number, number];
  state: NodeState;
}

interface NetworkEdge {
  from: string;
  to: string;
}

interface AgentNetworkGraphProps {
  componentStates: Record<string, NodeState>;
  agentPhase?: string;
}

const STATE_COLORS: Record<NodeState, string> = {
  normal:   '#3B82F6',
  anomaly:  '#F59E0B',
  critical: '#EF4444',
  inactive: '#4A7FA5',
};

const AGENT_PHASE_COLORS: Record<string, string> = {
  idle:    '#3B82F6',
  observe: '#10FFAA',
  detect:  '#F59E0B',
  analyze: '#A78BFA',
  plan:    '#22D3EE',
  act:     '#10FFAA',
  verify:  '#E8F4FF',
  error:   '#EF4444',
};

// Pentagon layout: SentinAI at center, 5 components at radius 2.8
const R = 2.8;
const DEFAULT_NODES: NetworkNode[] = [
  { id: 'sentinai',    label: 'SentinAI',    position: [0, 0, 0],                                                                     state: 'normal' },
  { id: 'l1',          label: 'L1 RPC',      position: [0, R, 0],                                                                     state: 'normal' },
  { id: 'op-node',     label: 'op-node',     position: [-R * Math.sin(72 * Math.PI / 180), R * Math.cos(72 * Math.PI / 180), 0],      state: 'normal' },
  { id: 'op-geth',     label: 'op-geth',     position: [-R * Math.sin(36 * Math.PI / 180), -R * Math.cos(36 * Math.PI / 180), 0],     state: 'normal' },
  { id: 'op-batcher',  label: 'op-batcher',  position: [R * Math.sin(36 * Math.PI / 180), -R * Math.cos(36 * Math.PI / 180), 0],      state: 'normal' },
  { id: 'op-proposer', label: 'op-proposer', position: [R * Math.sin(72 * Math.PI / 180), R * Math.cos(72 * Math.PI / 180), 0],       state: 'normal' },
];

const DEFAULT_EDGES: NetworkEdge[] = [
  { from: 'sentinai', to: 'l1' },
  { from: 'sentinai', to: 'op-node' },
  { from: 'sentinai', to: 'op-geth' },
  { from: 'sentinai', to: 'op-batcher' },
  { from: 'sentinai', to: 'op-proposer' },
];

/** Sonar pulse ring expanding from SentinAI center during observe phase */
function PulseRing({ color, initialOffset = 0 }: { color: string; initialOffset?: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const t = useRef(initialOffset);

  useFrame((_, delta) => {
    t.current = (t.current + delta * 0.5) % 1;
    const s = t.current;
    if (!meshRef.current) return;
    meshRef.current.scale.setScalar(0.5 + s * 5);
    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.6 * (1 - s);
  });

  return (
    <mesh ref={meshRef}>
      <torusGeometry args={[0.5, 0.018, 8, 64]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} />
    </mesh>
  );
}

/** Packet traveling along an edge, colored by the interaction type */
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

/** Node for infrastructure components, color driven by anomaly state */
function NodeMesh({ node }: { node: NetworkNode }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const color = STATE_COLORS[node.state];
  const isAnomaly = node.state === 'anomaly' || node.state === 'critical';

  useFrame(() => {
    if (!meshRef.current) return;
    const amplitude = node.state === 'critical' ? 0.18 : node.state === 'anomaly' ? 0.09 : 0.04;
    const freq = node.state === 'critical' ? 0.006 : 0.003;
    const scale = 1 + Math.sin(Date.now() * freq) * amplitude;
    meshRef.current.scale.setScalar(scale);
    if (haloRef.current) haloRef.current.scale.setScalar(scale);
  });

  return (
    <group position={node.position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.2, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isAnomaly ? 1.0 : 0.4}
        />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.32, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isAnomaly ? 0.14 : 0.06}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      <Billboard>
        <Text
          position={[0, -0.42, 0]}
          fontSize={0.14}
          color="#E8F4FF"
          anchorX="center"
          anchorY="top"
        >
          {node.label}
        </Text>
      </Billboard>
    </group>
  );
}

/** Central SentinAI agent node — phase-driven color + rotating ring */
function AgentCenterNode({
  node,
  agentPhase,
}: {
  node: NetworkNode;
  agentPhase?: string;
}) {
  const meshRef  = useRef<THREE.Mesh>(null!);
  const haloRef  = useRef<THREE.Mesh>(null!);
  const ringRef  = useRef<THREE.Mesh>(null!);
  const phase    = agentPhase ?? 'idle';
  const color    = AGENT_PHASE_COLORS[phase] ?? AGENT_PHASE_COLORS.idle;
  const isActive = phase !== 'idle' && phase !== 'error';

  useFrame(() => {
    if (!meshRef.current) return;
    const scale = 1 + Math.sin(Date.now() * 0.004) * (isActive ? 0.12 : 0.04);
    meshRef.current.scale.setScalar(scale);
    if (haloRef.current) haloRef.current.scale.setScalar(scale);
    if (ringRef.current) ringRef.current.rotation.z += 0.025;
  });

  return (
    <group position={node.position}>
      {/* Inner sphere — fully opaque so no depth-sort issues */}
      <mesh ref={meshRef} renderOrder={2}>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 1.1 : 0.7}
        />
      </mesh>
      {/* Halo glow — depthWrite=false to avoid occluding the inner sphere */}
      <mesh ref={haloRef} renderOrder={1}>
        <sphereGeometry args={[0.48, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.1}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {/* Rotating orbit ring while active */}
      {isActive && (
        <mesh ref={ringRef}>
          <torusGeometry args={[0.42, 0.016, 8, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
        </mesh>
      )}
      <Billboard>
        <Text
          position={[0, -0.66, 0]}
          fontSize={0.16}
          color="#E8F4FF"
          anchorX="center"
          anchorY="top"
        >
          {node.label}
        </Text>
        {phase !== 'idle' && (
          <Text
            position={[0, -0.92, 0]}
            fontSize={0.12}
            color={color}
            anchorX="center"
            anchorY="top"
          >
            {phase}
          </Text>
        )}
      </Billboard>
    </group>
  );
}

function Scene({
  nodes,
  edges,
  agentPhase,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  agentPhase?: string;
}) {
  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  const phase = agentPhase ?? 'idle';
  const isActive = phase !== 'idle' && phase !== 'error';
  const packetInward = phase === 'observe' || phase === 'detect' || phase === 'analyze';
  const phaseColor = AGENT_PHASE_COLORS[phase] ?? AGENT_PHASE_COLORS.idle;

  // Pulse rings: 2 staggered rings during observe/detect
  const showPulse = phase === 'observe' || phase === 'detect';

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 5, 5]} intensity={1} color="#3B82F6" />
      <pointLight position={[0, -5, -5]} intensity={0.5} color="#10FFAA" />

      {/* Sonar pulse rings — staggered by 0.5 offset */}
      {showPulse && <PulseRing color={phaseColor} initialOffset={0} />}
      {showPulse && <PulseRing color={phaseColor} initialOffset={0.5} />}

      {edges.map((edge) => {
        const fromNode = nodeMap[edge.from];
        const toNode = nodeMap[edge.to];
        if (!fromNode || !toNode) return null;

        // Edge color: component state wins over phase color when anomalous
        const targetNode = edge.to === 'sentinai' ? fromNode : toNode;
        const hasAnomaly = targetNode.state === 'anomaly' || targetNode.state === 'critical';
        const edgeColor = hasAnomaly
          ? STATE_COLORS[targetNode.state]
          : isActive
          ? phaseColor
          : '#1A2B4A';
        const edgeWidth = hasAnomaly ? 2.5 : isActive ? 1.5 : 1;

        // Show packets: always on anomaly edges, only active-phase edges when no anomaly
        const showPacket = isActive && (hasAnomaly || true);
        const packetColor = hasAnomaly ? STATE_COLORS[targetNode.state] : phaseColor;

        const particleFrom = packetInward ? toNode.position : fromNode.position;
        const particleTo   = packetInward ? fromNode.position : toNode.position;

        return (
          <group key={`${edge.from}-${edge.to}`}>
            <Line
              points={[fromNode.position, toNode.position]}
              color={edgeColor}
              lineWidth={edgeWidth}
              transparent
              opacity={hasAnomaly ? 0.9 : isActive ? 0.6 : 0.25}
            />
            {showPacket && (
              <PacketParticle
                from={particleFrom}
                to={particleTo}
                color={packetColor}
                speed={hasAnomaly ? 1.2 : 0.8}
                offset={0}
              />
            )}
          </group>
        );
      })}

      {nodes.map((node) =>
        node.id === 'sentinai' ? (
          <AgentCenterNode key={node.id} node={node} agentPhase={agentPhase} />
        ) : (
          <NodeMesh key={node.id} node={node} />
        ),
      )}

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
  const nodes = useMemo(
    () =>
      DEFAULT_NODES.map((n) => ({
        ...n,
        state: n.id === 'sentinai' ? ('normal' as NodeState) : (componentStates[n.id] ?? n.state),
      })),
    [componentStates],
  );

  return (
    <div className="w-full h-full min-h-[400px]">
      <Canvas
        camera={{ position: [0, 0, 7.5], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Scene nodes={nodes} edges={DEFAULT_EDGES} agentPhase={agentPhase} />
      </Canvas>
    </div>
  );
}
