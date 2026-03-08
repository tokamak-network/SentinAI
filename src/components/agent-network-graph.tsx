'use client';

import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, OrbitControls, Billboard } from '@react-three/drei';
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
  normal: '#3B82F6',
  anomaly: '#F59E0B',
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
// Angles (CCW from top): L1=90°, op-node=162°, op-geth=234°, op-batcher=306°, op-proposer=18°
const R = 2.8;
const DEFAULT_NODES: NetworkNode[] = [
  { id: 'sentinai',    label: 'SentinAI',    position: [0, 0, 0],                                        state: 'normal' },
  { id: 'l1',          label: 'L1 RPC',      position: [0, R, 0],                                        state: 'normal' },
  { id: 'op-node',     label: 'op-node',     position: [-R * Math.sin(72 * Math.PI / 180), R * Math.cos(72 * Math.PI / 180), 0],  state: 'normal' },
  { id: 'op-geth',     label: 'op-geth',     position: [-R * Math.sin(36 * Math.PI / 180), -R * Math.cos(36 * Math.PI / 180), 0], state: 'normal' },
  { id: 'op-batcher',  label: 'op-batcher',  position: [R * Math.sin(36 * Math.PI / 180), -R * Math.cos(36 * Math.PI / 180), 0],  state: 'normal' },
  { id: 'op-proposer', label: 'op-proposer', position: [R * Math.sin(72 * Math.PI / 180), R * Math.cos(72 * Math.PI / 180), 0],   state: 'normal' },
];

const DEFAULT_EDGES: NetworkEdge[] = [
  { from: 'sentinai', to: 'l1' },
  { from: 'sentinai', to: 'op-node' },
  { from: 'sentinai', to: 'op-geth' },
  { from: 'sentinai', to: 'op-batcher' },
  { from: 'sentinai', to: 'op-proposer' },
];

function AgentCenterNode({
  node,
  agentPhase,
}: {
  node: NetworkNode;
  agentPhase?: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const phase = agentPhase ?? 'idle';
  const color = AGENT_PHASE_COLORS[phase] ?? AGENT_PHASE_COLORS.idle;
  const isActive = phase !== 'idle' && phase !== 'error';

  useFrame(() => {
    if (!meshRef.current) return;
    const scale = 1 + Math.sin(Date.now() * 0.004) * (isActive ? 0.12 : 0.04);
    meshRef.current.scale.setScalar(scale);
    if (haloRef.current) haloRef.current.scale.setScalar(scale);
    if (ringRef.current) {
      ringRef.current.rotation.z += 0.02;
    }
  });

  return (
    <group position={node.position}>
      <mesh ref={meshRef} renderOrder={2}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 1.0 : 0.7}
        />
      </mesh>
      <mesh ref={haloRef} renderOrder={1}>
        <sphereGeometry args={[0.44, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.1}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
      {isActive && (
        <mesh ref={ringRef}>
          <torusGeometry args={[0.38, 0.015, 8, 64]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1} />
        </mesh>
      )}
      <Billboard>
        <Text
          position={[0, -0.62, 0]}
          fontSize={0.16}
          color="#E8F4FF"
          anchorX="center"
          anchorY="top"
        >
          {node.label}
        </Text>
        {phase !== 'idle' && (
          <Text
            position={[0, -0.88, 0]}
            fontSize={0.11}
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

function NodeMesh({ node }: { node: NetworkNode }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const haloRef = useRef<THREE.Mesh>(null!);
  const color = STATE_COLORS[node.state];
  const isActive = node.state !== 'inactive';

  useFrame(() => {
    if (!isActive || !meshRef.current) return;
    const scale = 1 + Math.sin(Date.now() * 0.003) * (node.state === 'critical' ? 0.15 : 0.05);
    meshRef.current.scale.setScalar(scale);
    if (haloRef.current) haloRef.current.scale.setScalar(scale);
  });

  return (
    <group position={node.position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.18, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={node.state === 'normal' ? 0.4 : 0.8}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>
      <Billboard>
        <Text
          position={[0, -0.35, 0]}
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

function PacketParticle({
  from,
  to,
  speed = 1,
}: {
  from: [number, number, number];
  to: [number, number, number];
  speed?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const progress = useRef(0);

  useEffect(() => {
    progress.current = Math.random();
  }, []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    progress.current = (progress.current + delta * speed * 0.3) % 1;
    const p = progress.current;
    meshRef.current.position.set(
      from[0] + (to[0] - from[0]) * p,
      from[1] + (to[1] - from[1]) * p,
      from[2] + (to[2] - from[2]) * p,
    );
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshStandardMaterial color="#10FFAA" emissive="#10FFAA" emissiveIntensity={1} />
    </mesh>
  );
}

function EdgeLine({
  from,
  to,
}: {
  from: [number, number, number];
  to: [number, number, number];
}) {
  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [from, to]);

  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color: '#1A2B4A' }),
    [],
  );

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return <primitive object={line} />;
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
  const isAnimating = phase !== 'idle' && phase !== 'error';

  // observe / detect / analyze: data flows inward (component → sentinai)
  // plan / act / verify: commands flow outward (sentinai → component)
  const packetInward = phase === 'observe' || phase === 'detect' || phase === 'analyze';

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 5, 5]} intensity={1} color="#3B82F6" />
      <pointLight position={[0, -5, -5]} intensity={0.5} color="#10FFAA" />

      {edges.map((edge) => {
        const fromNode = nodeMap[edge.from];
        const toNode = nodeMap[edge.to];
        if (!fromNode || !toNode) return null;

        const particleFrom = packetInward ? toNode.position : fromNode.position;
        const particleTo   = packetInward ? fromNode.position : toNode.position;

        return (
          <group key={`${edge.from}-${edge.to}`}>
            <EdgeLine from={fromNode.position} to={toNode.position} />
            {isAnimating && (
              <PacketParticle from={particleFrom} to={particleTo} speed={0.8} />
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
        state: n.id === 'sentinai' ? 'normal' as NodeState : (componentStates[n.id] ?? n.state),
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
