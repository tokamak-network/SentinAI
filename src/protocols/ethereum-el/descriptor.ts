/**
 * Ethereum Execution Layer Protocol Descriptor
 * Covers: Geth, Reth, Nethermind, Besu
 *
 * Metrics collected via standard JSON-RPC:
 *   eth_blockNumber, eth_syncing, net_peerCount, txpool_status (if available),
 *   admin_peers (if available), web3_clientVersion
 */

import type { ProtocolDescriptor, FieldAnomalyConfig } from '@/core/types';
import type { MetricFieldDefinition } from '@/core/metrics';

const metricsFields: MetricFieldDefinition[] = [
  {
    fieldName: 'blockHeight',
    displayName: '블록 높이',
    unit: 'count',
    description: '현재 로컬 최신 블록 높이',
    isKeyMetric: true,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'peerCount',
    displayName: '피어 수',
    unit: 'count',
    description: '연결된 P2P 피어 수 (net_peerCount)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 5, warningThreshold: 10 },
  },
  {
    fieldName: 'syncStatus',
    displayName: '싱크 상태',
    unit: 'percent',
    description: '동기화 진행률 (0=미동기, 100=완료)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 0, warningThreshold: 50 },
  },
  {
    fieldName: 'txPoolPending',
    displayName: '트랜잭션 풀 (대기)',
    unit: 'count',
    description: '트랜잭션 풀 내 대기 중인 트랜잭션 수 (txpool_status)',
    isKeyMetric: false,
    nullable: true,
    anomalyHint: { method: 'z-score', criticalThreshold: 50000 },
  },
  {
    fieldName: 'txPoolQueued',
    displayName: '트랜잭션 풀 (큐)',
    unit: 'count',
    description: '트랜잭션 풀 내 큐에 있는 트랜잭션 수 (txpool_status)',
    isKeyMetric: false,
    nullable: true,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'highestBlock',
    displayName: '최신 알려진 블록',
    unit: 'count',
    description: '피어로부터 알려진 가장 높은 블록 번호 (syncing 시에만)',
    isKeyMetric: false,
    nullable: true,
  },
  {
    fieldName: 'startingBlock',
    displayName: '싱크 시작 블록',
    unit: 'count',
    description: '동기화를 시작한 블록 번호',
    isKeyMetric: false,
    nullable: true,
  },
];

const anomalyConfig: Record<string, FieldAnomalyConfig> = {
  blockHeight:  { enabled: true, method: 'z-score' },
  peerCount:    { enabled: true, method: 'threshold', criticalThreshold: 5, warningThreshold: 10 },
  syncStatus:   { enabled: true, method: 'threshold', criticalThreshold: 0 },
  txPoolPending: { enabled: true, method: 'z-score', criticalThreshold: 50000 },
  txPoolQueued:  { enabled: true, method: 'z-score' },
};

export const ETHEREUM_EL_DESCRIPTOR: ProtocolDescriptor = {
  protocolId: 'ethereum-el',
  displayName: 'Ethereum 실행 레이어 (EL)',
  version: 'London+',
  metricsFields,
  collectorType: 'evm-execution',
  capabilities: [
    'block-production',
    'peer-monitoring',
    'txpool-monitoring',
    'sync-monitoring',
  ],
  anomalyConfig,
};
