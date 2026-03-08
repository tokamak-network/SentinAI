'use client';

import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, OrbitControls } from '@react-three/drei';
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

function NodeMesh({ node }: { node: NetworkNode }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const color = STATE_COLORS[node.state];
  const isActive = node.state !== 'inactive';

  useFrame(() => {
    if (!isActive || !meshRef.current) return;
    const scale = 1 + Math.sin(Date.now() * 0.003) * (node.state === 'critical' ? 0.15 : 0.05);
    meshRef.current.scale.setScalar(scale);
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
      <mesh>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>
      <Text
        position={[0, -0.35, 0]}
        fontSize={0.14}
        color="#E8F4FF"
        anchorX="center"
        anchorY="top"
      >
        {node.label}
      </Text>
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

  return <primitive object={new THREE.Line(geometry, material)} />;
}

const DEFAULT_NODES: NetworkNode[] = [
  { id: 'l1',          label: 'L1 RPC',      position: [-3, 0, 0],   state: 'normal' },
  { id: 'op-node',     label: 'op-node',     position: [-1, 0, 0],   state: 'normal' },
  { id: 'op-geth',     label: 'op-geth',     position: [1, 1, 0],    state: 'normal' },
  { id: 'op-batcher',  label: 'op-batcher',  position: [1, -1, 0],   state: 'normal' },
  { id: 'op-proposer', label: 'op-proposer', position: [3, -1, 0],   state: 'normal' },
];

const DEFAULT_EDGES: NetworkEdge[] = [
  { from: 'l1', to: 'op-node' },
  { from: 'op-node', to: 'op-geth' },
  { from: 'op-node', to: 'op-batcher' },
  { from: 'op-node', to: 'op-proposer' },
  { from: 'op-batcher', to: 'l1' },
  { from: 'op-proposer', to: 'l1' },
];

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
  const isAnimating =
    agentPhase && agentPhase !== 'idle' && agentPhase !== 'error';

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 5, 5]} intensity={1} color="#3B82F6" />
      <pointLight position={[0, -5, -5]} intensity={0.5} color="#10FFAA" />

      {edges.map((edge) => {
        const fromNode = nodeMap[edge.from];
        const toNode = nodeMap[edge.to];
        if (!fromNode || !toNode) return null;
        return (
          <group key={`${edge.from}-${edge.to}`}>
            <EdgeLine from={fromNode.position} to={toNode.position} />
            {isAnimating && (
              <PacketParticle
                from={fromNode.position}
                to={toNode.position}
                speed={0.8}
              />
            )}
          </group>
        );
      })}

      {nodes.map((node) => (
        <NodeMesh key={node.id} node={node} />
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
  const nodes = useMemo(
    () =>
      DEFAULT_NODES.map((n) => ({
        ...n,
        state: componentStates[n.id] ?? n.state,
      })),
    [componentStates],
  );

  return (
    <div className="w-full h-full min-h-[400px]">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Scene nodes={nodes} edges={DEFAULT_EDGES} agentPhase={agentPhase} />
      </Canvas>
    </div>
  );
}
