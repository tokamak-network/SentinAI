/**
 * OP Stack L2 Protocol Descriptor
 * Covers: Thanos, Optimism, Base, and all OP Stack derivatives
 */

import type { ProtocolDescriptor, FieldAnomalyConfig } from '@/core/types';
import type { MetricFieldDefinition } from '@/core/metrics';

const metricsFields: MetricFieldDefinition[] = [
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
    anomalyHint: { method: 'z-score', criticalThreshold: 10000, warningThreshold: 5000 },
  },
  {
    fieldName: 'txPoolQueued',
    displayName: '트랜잭션 풀 (큐)',
    unit: 'count',
    description: '트랜잭션 풀 내 순서 대기 중인 트랜잭션 수',
    isKeyMetric: false,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'peerCount',
    displayName: '피어 수',
    unit: 'count',
    description: '연결된 P2P 피어 수',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 3, warningThreshold: 5 },
  },
  {
    fieldName: 'gasUsedRatio',
    displayName: '가스 사용률',
    unit: 'ratio',
    description: '최근 블록 gasUsed / gasLimit 비율 (0–1)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 0.95, warningThreshold: 0.85 },
  },
  {
    fieldName: 'cpuUsage',
    displayName: 'CPU 사용률',
    unit: 'percent',
    description: 'op-geth 컨테이너 CPU 사용률 (%)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 90, warningThreshold: 75 },
  },
  {
    fieldName: 'l1BlockHeight',
    displayName: 'L1 블록 높이',
    unit: 'count',
    description: '현재 참조 중인 L1 블록 높이',
    isKeyMetric: false,
    anomalyHint: { method: 'plateau' },
  },
  {
    fieldName: 'l1SyncLag',
    displayName: 'L1 싱크 지연',
    unit: 'count',
    description: '최신 L1 블록과 현재 참조 L1 블록 간 차이',
    isKeyMetric: false,
    anomalyHint: { method: 'threshold', criticalThreshold: 50 },
  },
  {
    fieldName: 'batcherBalance',
    displayName: '배처 잔액',
    unit: 'eth',
    description: 'op-batcher EOA 잔액 (ETH)',
    isKeyMetric: false,
    anomalyHint: { method: 'threshold', criticalThreshold: 0.1 },
  },
  {
    fieldName: 'proposerBalance',
    displayName: '프로포저 잔액',
    unit: 'eth',
    description: 'op-proposer EOA 잔액 (ETH)',
    isKeyMetric: false,
    anomalyHint: { method: 'threshold', criticalThreshold: 0.1 },
  },
];

const anomalyConfig: Record<string, FieldAnomalyConfig> = {
  blockHeight:    { enabled: true, method: 'z-score' },
  txPoolPending:  { enabled: true, method: 'z-score', criticalThreshold: 10000, warningThreshold: 5000 },
  txPoolQueued:   { enabled: true, method: 'z-score' },
  peerCount:      { enabled: true, method: 'threshold', criticalThreshold: 3, warningThreshold: 5 },
  gasUsedRatio:   { enabled: true, method: 'threshold', criticalThreshold: 0.95, warningThreshold: 0.85 },
  cpuUsage:       { enabled: true, method: 'threshold', criticalThreshold: 90, warningThreshold: 75 },
  l1BlockHeight:  { enabled: true, method: 'plateau' },
  l1SyncLag:      { enabled: true, method: 'threshold', criticalThreshold: 50 },
  batcherBalance: { enabled: true, method: 'threshold', criticalThreshold: 0.1 },
  proposerBalance: { enabled: true, method: 'threshold', criticalThreshold: 0.1 },
};

export const OPSTACK_L2_DESCRIPTOR: ProtocolDescriptor = {
  protocolId: 'opstack-l2',
  displayName: 'OP Stack L2',
  version: 'Bedrock+',
  metricsFields,
  collectorType: 'opstack-l2',
  capabilities: [
    'block-production',
    'peer-monitoring',
    'txpool-monitoring',
    'gas-monitoring',
    'cpu-monitoring',
    'l1-dependency-monitoring',
    'eoa-balance-monitoring',
  ],
  anomalyConfig,
};
