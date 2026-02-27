/**
 * ZK Stack L2 Protocol Descriptor
 * Covers: zkSync Era and other ZK Stack derivatives
 */

import type { ProtocolDescriptor, FieldAnomalyConfig } from '@/core/types';
import type { MetricFieldDefinition } from '@/core/metrics';

const metricsFields: MetricFieldDefinition[] = [
  {
    fieldName: 'blockHeight',
    displayName: '블록 높이',
    unit: 'count',
    description: '현재 L2 블록 높이 (miniblock)',
    isKeyMetric: true,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'l1BatchNumber',
    displayName: 'L1 배치 번호',
    unit: 'count',
    description: 'L1에 커밋된 최신 배치 번호',
    isKeyMetric: true,
    anomalyHint: { method: 'plateau' },
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
    isKeyMetric: false,
    anomalyHint: { method: 'threshold', criticalThreshold: 1 },
  },
  {
    fieldName: 'cpuUsage',
    displayName: 'CPU 사용률',
    unit: 'percent',
    description: 'ZK Stack 컨테이너 CPU 사용률 (%)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 90, warningThreshold: 75 },
  },
  {
    fieldName: 'proverQueueDepth',
    displayName: '프루버 큐 깊이',
    unit: 'count',
    description: '프루버 큐에 대기 중인 배치 수 (ZK Stack 전용)',
    isKeyMetric: false,
    anomalyHint: { method: 'threshold', criticalThreshold: 100 },
    nullable: true,
  },
  {
    fieldName: 'l1BlockHeight',
    displayName: 'L1 블록 높이',
    unit: 'count',
    description: '현재 참조 중인 L1 블록 높이',
    isKeyMetric: false,
    anomalyHint: { method: 'plateau' },
  },
];

const anomalyConfig: Record<string, FieldAnomalyConfig> = {
  blockHeight:      { enabled: true, method: 'z-score' },
  l1BatchNumber:    { enabled: true, method: 'plateau' },
  txPoolPending:    { enabled: true, method: 'z-score', criticalThreshold: 10000 },
  peerCount:        { enabled: true, method: 'threshold', criticalThreshold: 1 },
  cpuUsage:         { enabled: true, method: 'threshold', criticalThreshold: 90, warningThreshold: 75 },
  proverQueueDepth: { enabled: true, method: 'threshold', criticalThreshold: 100 },
  l1BlockHeight:    { enabled: true, method: 'plateau' },
};

export const ZKSTACK_DESCRIPTOR: ProtocolDescriptor = {
  protocolId: 'zkstack',
  displayName: 'ZK Stack L2',
  version: 'ZK Stack',
  metricsFields,
  collectorType: 'evm-execution',
  capabilities: [
    'block-production',
    'txpool-monitoring',
    'cpu-monitoring',
    'l1-dependency-monitoring',
  ],
  anomalyConfig,
};
