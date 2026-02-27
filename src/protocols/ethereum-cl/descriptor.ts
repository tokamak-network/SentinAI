/**
 * Ethereum Consensus Layer Protocol Descriptor
 * Covers: Lighthouse, Prysm, Teku, Nimbus
 *
 * Metrics collected via Beacon API (REST):
 *   /eth/v1/node/syncing          → headSlot, syncDistance, isSyncing
 *   /eth/v1/node/peer_count       → peerCount
 *   /eth/v1/beacon/states/head/finality_checkpoints → finalizedEpoch, justifiedEpoch
 *   /eth/v1/node/version          → clientVersion
 */

import type { ProtocolDescriptor, FieldAnomalyConfig } from '@/core/types';
import type { MetricFieldDefinition } from '@/core/metrics';

const metricsFields: MetricFieldDefinition[] = [
  {
    fieldName: 'headSlot',
    displayName: '헤드 슬롯',
    unit: 'slot',
    description: '현재 로컬 헤드 슬롯 번호',
    isKeyMetric: true,
    anomalyHint: { method: 'z-score' },
  },
  {
    fieldName: 'headEpoch',
    displayName: '헤드 에포크',
    unit: 'epoch',
    description: '헤드 슬롯에서 계산된 현재 에포크',
    isKeyMetric: true,
  },
  {
    fieldName: 'finalizedEpoch',
    displayName: '파이널라이즈드 에포크',
    unit: 'epoch',
    description: '마지막으로 파이널라이즈된 에포크 번호',
    isKeyMetric: true,
    anomalyHint: { method: 'plateau' },
  },
  {
    fieldName: 'justifiedEpoch',
    displayName: '저스티파이드 에포크',
    unit: 'epoch',
    description: '마지막으로 저스티파이드된 에포크 번호',
    isKeyMetric: false,
    anomalyHint: { method: 'plateau' },
  },
  {
    fieldName: 'syncDistance',
    displayName: '싱크 거리',
    unit: 'slot',
    description: '헤드와 체인 헤드 간의 슬롯 차이 (0=완전 동기화)',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 32, warningThreshold: 8 },
  },
  {
    fieldName: 'peerCount',
    displayName: '피어 수',
    unit: 'count',
    description: '연결된 P2P 피어 수',
    isKeyMetric: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 10, warningThreshold: 25 },
  },
  {
    fieldName: 'isSyncing',
    displayName: '동기화 중',
    unit: 'count',
    description: '동기화 중 여부 (1=동기화 중, 0=완료)',
    isKeyMetric: false,
  },
  {
    fieldName: 'activeValidators',
    displayName: '활성 밸리데이터',
    unit: 'count',
    description: '로컬에서 관리 중인 활성 밸리데이터 수',
    isKeyMetric: false,
    nullable: true,
  },
  {
    fieldName: 'slashingCount',
    displayName: '슬래싱 감지',
    unit: 'count',
    description: '이번 에포크 내 슬래싱 이벤트 수',
    isKeyMetric: false,
    nullable: true,
    anomalyHint: { method: 'threshold', criticalThreshold: 1 },
  },
];

const anomalyConfig: Record<string, FieldAnomalyConfig> = {
  headSlot:        { enabled: true, method: 'z-score' },
  finalizedEpoch:  { enabled: true, method: 'plateau' },
  justifiedEpoch:  { enabled: true, method: 'plateau' },
  syncDistance:    { enabled: true, method: 'threshold', criticalThreshold: 32, warningThreshold: 8 },
  peerCount:       { enabled: true, method: 'threshold', criticalThreshold: 10, warningThreshold: 25 },
  slashingCount:   { enabled: true, method: 'threshold', criticalThreshold: 1 },
};

export const ETHEREUM_CL_DESCRIPTOR: ProtocolDescriptor = {
  protocolId: 'ethereum-cl',
  displayName: 'Ethereum 합의 레이어 (CL)',
  version: 'Phase 0+',
  metricsFields,
  collectorType: 'beacon-api',
  capabilities: [
    'block-production',
    'peer-monitoring',
    'sync-monitoring',
    'finality-monitoring',
    'validator-monitoring',
  ],
  anomalyConfig,
};
