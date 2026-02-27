/**
 * ChainPlugin → ProtocolDescriptor Bridge
 * Backwards-compatibility adapter for the legacy ChainPlugin system.
 *
 * Converts the old single-chain ChainPlugin interface into the new multi-protocol
 * ProtocolDescriptor format, enabling existing chain plugins (Thanos, Optimism, etc.)
 * to work seamlessly with the new InstanceRegistry + AgentOrchestrator.
 *
 * Usage:
 *   const descriptor = bridgeChainPlugin(new ThanosPlugin(), 'opstack-l2');
 *   registerProtocol(descriptor);
 */

import type { ChainPlugin } from '@/chains/types';
import type { ProtocolDescriptor, ProtocolCapability, FieldAnomalyConfig } from '../types';
import type { NodeType } from '../types';
import type { MetricFieldDefinition } from '../metrics';

// ============================================================
// Default Metric Fields for OP Stack L2
// (mirrored from the existing agent-loop.ts collectMetrics)
// ============================================================

const OP_STACK_METRIC_FIELDS: MetricFieldDefinition[] = [
  {
    fieldName: 'blockHeight',
    displayName: '블록 높이',
    unit: 'count',
    description: '현재 L2 블록 높이',
    isKeyMetric: true,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'txPoolPending',
    displayName: '트랜잭션 풀 (대기)',
    unit: 'count',
    description: '트랜잭션 풀 내 대기 중인 트랜잭션 수',
    isKeyMetric: true,
    anomalyHint: { method: 'z-score', criticalThreshold: 10000 },
  },
  {
    fieldName: 'peerCount',
    displayName: '피어 수',
    unit: 'count',
    description: '연결된 P2P 피어 수',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 3 },
  },
  {
    fieldName: 'gasUsedRatio',
    displayName: '가스 사용률',
    unit: 'ratio',
    description: 'gasUsed / gasLimit 비율 (0–1)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 0.95 },
  },
  {
    fieldName: 'cpuUsage',
    displayName: 'CPU 사용률',
    unit: 'percent',
    description: 'op-geth 컨테이너 CPU 사용률 (%)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 90 },
  },
  {
    fieldName: 'l1BlockHeight',
    displayName: 'L1 블록 높이',
    unit: 'count',
    description: '참조 중인 L1 블록 높이',
    isKeyMetric: false,
    anomalyHint: { method: 'plateau' },
  },
];

const OP_STACK_ANOMALY_CONFIG: Record<string, FieldAnomalyConfig> = {
  blockHeight:   { enabled: true, method: 'z-score' },
  txPoolPending: { enabled: true, method: 'z-score', criticalThreshold: 10000 },
  peerCount:     { enabled: true, method: 'threshold', criticalThreshold: 3 },
  gasUsedRatio:  { enabled: true, method: 'threshold', criticalThreshold: 0.95 },
  cpuUsage:      { enabled: true, method: 'threshold', criticalThreshold: 90 },
  l1BlockHeight: { enabled: true, method: 'plateau' },
};

// ============================================================
// Bridge Function
// ============================================================

/**
 * Convert a legacy ChainPlugin into a ProtocolDescriptor.
 *
 * @param plugin - The legacy ChainPlugin instance
 * @param protocolId - Target NodeType ('opstack-l2', 'arbitrum-nitro', etc.)
 * @returns ProtocolDescriptor compatible with the new core system
 */
export function bridgeChainPlugin(
  plugin: ChainPlugin,
  protocolId: NodeType
): ProtocolDescriptor {
  // Derive capabilities from ChainPlugin.capabilities
  const capabilities: ProtocolCapability[] = [
    'block-production',
    'peer-monitoring',
    'txpool-monitoring',
    'gas-monitoring',
    'cpu-monitoring',
    'l1-dependency-monitoring',
  ];

  if (plugin.capabilities.eoaBalanceMonitoring) {
    capabilities.push('eoa-balance-monitoring');
  }

  // Metric fields vary by protocol type but share a common base
  let metricsFields: MetricFieldDefinition[];
  let anomalyConfig: Record<string, FieldAnomalyConfig>;

  switch (protocolId) {
    case 'opstack-l2':
    case 'arbitrum-nitro':
      metricsFields = OP_STACK_METRIC_FIELDS;
      anomalyConfig = OP_STACK_ANOMALY_CONFIG;
      break;
    default:
      metricsFields = OP_STACK_METRIC_FIELDS;
      anomalyConfig = OP_STACK_ANOMALY_CONFIG;
  }

  return {
    protocolId,
    displayName: plugin.displayName,
    version: `${plugin.chainType} (legacy bridge)`,
    metricsFields,
    collectorType: protocolId === 'opstack-l2' ? 'opstack-l2' : 'evm-execution',
    capabilities,
    anomalyConfig,
    legacyChainType: plugin.chainType,
  };
}

// ============================================================
// Convenience: Map chain type string → NodeType
// ============================================================

/**
 * Map a legacy chainType identifier to the canonical NodeType.
 * Returns 'opstack-l2' as fallback for unknown OP Stack variants.
 */
export function chainTypeToNodeType(chainType: string): NodeType {
  const lower = chainType.toLowerCase();

  if (lower.includes('arbitrum') || lower === 'nitro') {
    return 'arbitrum-nitro';
  }
  if (lower.includes('zk') || lower === 'zkstack') {
    return 'zkstack';
  }
  // thanos, optimism, op-stack, etc.
  return 'opstack-l2';
}
