# SentinAI Universal Blockchain Infrastructure Platform PRD

**Version:** 1.1
**Date:** 2026-02-10
**Status:** Ready for Implementation

---

## 1. 개요

### 1.1 목표
SentinAI를 L2 전용 모니터링 도구에서 **모든 블록체인 인프라를 관리하는 범용 플랫폼**으로 확장한다.

### 1.2 현재 vs 목표

| 항목 | 현재 상태 | 목표 |
|------|----------|------|
| 지원 프로토콜 | Optimism L2 only | Any EVM + Non-EVM |
| 확장성 | 컴포넌트별 하드코딩 | Plugin/Adapter 시스템 |
| 대시보드 | 단일 네트워크 | 멀티 네트워크 통합 |
| 커뮤니티 | - | Adapter Marketplace |

### 1.3 현재 코드베이스 분석

**구현 완료된 핵심 모듈:**

```
src/lib/
├── ai-client.ts           # AI Gateway 통합 (Claude API)
├── anomaly-detector.ts    # 이상 탐지 (Z-Score, Rules)
├── anomaly-event-store.ts # 이상 이벤트 저장소
├── cost-optimizer.ts      # AI 비용 최적화
├── k8s-scaler.ts          # K8s 리소스 스케일링
├── metrics-store.ts       # 메트릭 시계열 저장
├── prediction-tracker.ts  # 예측 추적
├── predictive-scaler.ts   # AI 기반 예측 스케일링
├── rca-engine.ts          # 근본 원인 분석
└── usage-tracker.ts       # 사용량 패턴 추적
```

**현재 Optimism 전용 로직:**
- `metrics-store.ts`: L2 블록 높이, TxPool, Gas 메트릭
- `rca-engine.ts`: op-geth, op-node, op-batcher, op-proposer 컴포넌트 그래프
- `anomaly-detector.ts`: L2 블록 plateau, TxPool monotonic 규칙

### 1.4 리팩토링 전략

```
Phase 1: Adapter Interface 설계
         ↓
Phase 2: 기존 로직을 OptimismAdapter로 추출
         ↓
Phase 3: EthereumAdapter, BitcoinAdapter 추가
         ↓
Phase 4: 멀티 프로토콜 Dashboard UI
```

---

## 2. 사용자 스토리

### US-1: 멀티체인 모니터링
```
As a blockchain infrastructure operator
I want to monitor multiple networks from a single dashboard
So that I can efficiently manage all my nodes
```

### US-2: 새 프로토콜 추가
```
As a DevOps engineer
I want to easily add support for new blockchain protocols
So that I can extend monitoring to new networks without major code changes
```

### US-3: 통합 알림
```
As an on-call engineer
I want to receive unified alerts for all monitored networks
So that I can quickly identify and respond to issues across chains
```

---

## 3. 기술 아키텍처

### 3.1 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│                    SentinAI Platform                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Unified Dashboard (Next.js)             │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │    │
│  │  │Optimism │ │Ethereum │ │ Bitcoin │ │ Solana  │   │    │
│  │  │  Card   │ │  Card   │ │  Card   │ │  Card   │   │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                            │                                 │
│  ┌─────────────────────────┴─────────────────────────┐      │
│  │              Protocol Registry                     │      │
│  │  - Adapter discovery & instantiation              │      │
│  │  - Configuration management                        │      │
│  │  - Health aggregation                              │      │
│  └─────────────────────────┬─────────────────────────┘      │
│                            │                                 │
│  ┌─────────────────────────┴─────────────────────────┐      │
│  │              Adapter Layer                         │      │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │      │
│  │  │ Optimism │ │ Ethereum │ │ Bitcoin  │ ...      │      │
│  │  │ Adapter  │ │ Adapter  │ │ Adapter  │          │      │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘          │      │
│  └───────┼────────────┼────────────┼─────────────────┘      │
│          │            │            │                         │
└──────────┼────────────┼────────────┼─────────────────────────┘
           │            │            │
           ▼            ▼            ▼
      ┌────────┐   ┌────────┐   ┌────────┐
      │  EKS   │   │  Geth  │   │ Bitcoin│
      │Cluster │   │  Node  │   │  Core  │
      └────────┘   └────────┘   └────────┘
```

### 3.2 Adapter Interface 설계

모든 블록체인 Adapter는 공통 인터페이스를 구현해야 한다.

```typescript
// src/adapters/types.ts

/**
 * 블록체인 프로토콜 타입
 */
export type ProtocolType =
  | 'l2-rollup'      // L2 Rollup (Optimism, Arbitrum, etc.)
  | 'l1-node'        // L1 Full Node (Ethereum, Bitcoin, etc.)
  | 'validator'      // PoS Validator (Solana, Cosmos, etc.)
  | 'indexer'        // Indexer/Subgraph
  | 'rpc-provider'   // RPC Provider
  | 'custom';        // Custom protocol

/**
 * 공통 메트릭 구조 (기존 MetricDataPoint 기반)
 */
export interface UniversalMetrics {
  // 필수 필드 (모든 프로토콜)
  blockHeight: number;
  syncStatus: number;        // 0-100 (percentage)
  timestamp: Date;

  // 리소스 메트릭 (선택적)
  cpuUsage?: number;         // 0-100
  memoryUsage?: number;      // 0-100
  diskUsage?: number;        // 0-100

  // 프로토콜별 커스텀 메트릭
  customMetrics?: Record<string, unknown>;
}

/**
 * 헬스 상태 (기존 HealthStatus 확장)
 */
export interface AdapterHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  score: number;             // 0-100
  checks: HealthCheck[];
  lastChecked: Date;
}

/**
 * 블록체인 Adapter 인터페이스
 */
export interface BlockchainAdapter {
  // 메타데이터
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType;
  readonly version: string;

  // 초기화
  initialize(config: AdapterConfig): Promise<void>;
  dispose(): Promise<void>;

  // 상태 조회 (필수)
  getMetrics(): Promise<UniversalMetrics>;
  getHealth(): Promise<AdapterHealthStatus>;

  // 이상 탐지 (선택적) - 기존 AnomalyResult 타입 사용
  detectAnomalies?(): Promise<AnomalyResult[]>;

  // 리소스 관리 (선택적) - 기존 K8s scaler 연동
  scale?(resources: ResourceSpec): Promise<void>;
  restart?(): Promise<void>;
}
```

---

## 4. 파일 구조 (리팩토링 계획)

### 4.1 현재 구조 → 목표 구조

**현재:**
```
src/
├── lib/
│   ├── metrics-store.ts      # Optimism 메트릭 (하드코딩)
│   ├── anomaly-detector.ts   # Optimism 이상 탐지 규칙
│   ├── rca-engine.ts         # Optimism 컴포넌트 그래프
│   └── ...
```

**목표:**
```
src/
├── adapters/
│   ├── types.ts                      # 공통 Adapter 인터페이스
│   ├── registry.ts                   # Protocol Registry
│   ├── base/
│   │   └── BaseAdapter.ts            # 추상 기본 클래스
│   ├── optimism/
│   │   ├── index.ts                  # OptimismAdapter
│   │   ├── metrics.ts                # 기존 metrics-store 로직 이동
│   │   ├── anomalies.ts              # 기존 anomaly-detector 로직 이동
│   │   └── components.ts             # 기존 rca-engine 컴포넌트 그래프 이동
│   ├── ethereum/
│   │   ├── index.ts                  # EthereumAdapter (신규)
│   │   └── metrics.ts
│   └── bitcoin/
│       ├── index.ts                  # BitcoinAdapter (신규)
│       └── metrics.ts
├── lib/
│   ├── ai-client.ts                  # 유지 (공통)
│   ├── cost-optimizer.ts             # 유지 (공통, Adapter 연동)
│   ├── metrics-store.ts              # → adapters/optimism/metrics.ts로 이동
│   ├── anomaly-detector.ts           # → adapters/optimism/anomalies.ts로 이동
│   ├── rca-engine.ts                 # → adapters 별로 분리
│   └── ...
├── app/
│   └── api/
│       ├── protocols/
│       │   ├── route.ts              # GET /api/protocols (신규)
│       │   └── [id]/
│       │       ├── route.ts          # GET /api/protocols/:id
│       │       ├── metrics/route.ts  # GET /api/protocols/:id/metrics
│       │       └── health/route.ts   # GET /api/protocols/:id/health
│       └── dashboard/
│           └── aggregate/route.ts    # GET /api/dashboard/aggregate (신규)
```

---

## 5. 기존 코드 추출 가이드

### 5.1 OptimismAdapter 생성

기존 로직을 OptimismAdapter로 캡슐화:

```typescript
// src/adapters/optimism/index.ts
import { BaseAdapter } from '../base/BaseAdapter';
import { UniversalMetrics, AdapterHealthStatus, ProtocolType } from '../types';
import { AnomalyResult } from '@/types/anomaly';
import { detectAnomalies as detectOptimismAnomalies } from './anomalies';
import { getMetrics as getOptimismMetrics } from './metrics';
import { DEPENDENCY_GRAPH } from './components';

export class OptimismAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType = 'l2-rollup';
  readonly version = '1.0.0';

  private l2RpcUrl: string = '';
  private l1RpcUrl: string = '';

  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }

  protected async onInitialize(): Promise<void> {
    this.l2RpcUrl = this.config.rpcUrl || process.env.L2_RPC_URL || '';
    this.l1RpcUrl = this.config.protocolConfig?.l1RpcUrl || process.env.L1_RPC_URL || '';
  }

  protected async onDispose(): Promise<void> {}

  async getMetrics(): Promise<UniversalMetrics> {
    // 기존 metrics-store.ts 로직 재사용
    const metrics = await getOptimismMetrics(this.l2RpcUrl, this.l1RpcUrl);

    return {
      blockHeight: metrics.blockHeight,
      syncStatus: metrics.syncLag === 0 ? 100 : 99,
      timestamp: new Date(),
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage,
      customMetrics: {
        l1BlockHeight: metrics.l1BlockHeight,
        txPoolPending: metrics.txPoolCount,
        gasUsedRatio: metrics.gasUsedRatio,
        gethVcpu: metrics.gethVcpu,
        gethMemGiB: metrics.gethMemGiB,
      },
    };
  }

  async getHealth(): Promise<AdapterHealthStatus> {
    const metrics = await this.getMetrics();
    const checks = await this.runHealthChecks(metrics);

    // 기존 health 로직
    const failedChecks = checks.filter(c => c.status === 'fail').length;
    const warnChecks = checks.filter(c => c.status === 'warn').length;

    let status: AdapterHealthStatus['status'];
    let score: number;

    if (failedChecks > 0) {
      status = 'unhealthy';
      score = Math.max(0, 100 - failedChecks * 30 - warnChecks * 10);
    } else if (warnChecks > 0) {
      status = 'degraded';
      score = Math.max(50, 100 - warnChecks * 15);
    } else {
      status = 'healthy';
      score = 100;
    }

    return { status, score, checks, lastChecked: new Date() };
  }

  async detectAnomalies(): Promise<AnomalyResult[]> {
    // 기존 anomaly-detector.ts 로직 재사용
    return detectOptimismAnomalies();
  }

  // Optimism 전용: 컴포넌트 의존성 그래프
  getDependencyGraph() {
    return DEPENDENCY_GRAPH;
  }
}
```

### 5.2 기존 anomaly-detector.ts 분리

```typescript
// src/adapters/optimism/anomalies.ts
// 기존 anomaly-detector.ts에서 Optimism 전용 로직만 추출

import { AnomalyResult } from '@/types/anomaly';
import { getRecentMetrics } from '@/lib/metrics-store';

/**
 * Optimism L2 Block plateau detection
 */
function detectBlockPlateau(...) { /* 기존 로직 */ }

/**
 * Optimism TxPool monotonic increase detection
 */
function detectTxPoolMonotonicIncrease(...) { /* 기존 로직 */ }

export async function detectOptimismAnomalies(): Promise<AnomalyResult[]> {
  const history = getRecentMetrics(30);
  // 기존 detectAnomalies 로직
}
```

### 5.3 기존 rca-engine.ts 컴포넌트 분리

```typescript
// src/adapters/optimism/components.ts
import { RCAComponent, ComponentDependency } from '@/types/rca';

/**
 * Optimism Rollup component dependency graph
 * 기존 rca-engine.ts의 DEPENDENCY_GRAPH 이동
 */
export const DEPENDENCY_GRAPH: Record<RCAComponent, ComponentDependency> = {
  'op-geth': {
    dependsOn: ['op-node'],
    feeds: [],
  },
  'op-node': {
    dependsOn: ['l1'],
    feeds: ['op-geth', 'op-batcher', 'op-proposer'],
  },
  // ... 기존 그래프 유지
};
```

---

## 6. Protocol Registry

```typescript
// src/adapters/registry.ts
import { BlockchainAdapter, AdapterConfig, UniversalMetrics, AdapterHealthStatus } from './types';
import { AnomalyResult } from '@/types/anomaly';

type AdapterFactory = (config: AdapterConfig) => BlockchainAdapter;

class ProtocolRegistry {
  private static instance: ProtocolRegistry;
  private adapters: Map<string, BlockchainAdapter> = new Map();
  private factories: Map<string, AdapterFactory> = new Map();

  private constructor() {}

  static getInstance(): ProtocolRegistry {
    if (!ProtocolRegistry.instance) {
      ProtocolRegistry.instance = new ProtocolRegistry();
    }
    return ProtocolRegistry.instance;
  }

  registerFactory(type: string, factory: AdapterFactory): void {
    this.factories.set(type, factory);
  }

  async register(config: AdapterConfig): Promise<void> {
    const factory = this.factories.get(config.type);
    if (!factory) throw new Error(`No factory for type: ${config.type}`);

    const adapter = factory(config);
    await adapter.initialize(config);
    this.adapters.set(config.id, adapter);
  }

  get(id: string): BlockchainAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Adapter not found: ${id}`);
    return adapter;
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  async getAggregatedMetrics(): Promise<Record<string, UniversalMetrics>> {
    const results: Record<string, UniversalMetrics> = {};
    for (const [id, adapter] of this.adapters) {
      try {
        results[id] = await adapter.getMetrics();
      } catch (error) {
        console.error(`Failed to get metrics for ${id}:`, error);
      }
    }
    return results;
  }

  async getAggregatedHealth(): Promise<Record<string, AdapterHealthStatus>> {
    const results: Record<string, AdapterHealthStatus> = {};
    for (const [id, adapter] of this.adapters) {
      try {
        results[id] = await adapter.getHealth();
      } catch (error) {
        results[id] = { status: 'unknown', score: 0, checks: [], lastChecked: new Date() };
      }
    }
    return results;
  }

  async getAllAnomalies(): Promise<Record<string, AnomalyResult[]>> {
    const results: Record<string, AnomalyResult[]> = {};
    for (const [id, adapter] of this.adapters) {
      if (adapter.detectAnomalies) {
        try {
          results[id] = await adapter.detectAnomalies();
        } catch (error) {
          results[id] = [];
        }
      }
    }
    return results;
  }
}

export const registry = ProtocolRegistry.getInstance();
```

---

## 7. 새 API 엔드포인트

### 7.1 프로토콜 목록

```typescript
// src/app/api/protocols/route.ts
import { NextResponse } from 'next/server';
import { registry } from '@/adapters/registry';

export async function GET() {
  const protocols = registry.list().map(id => {
    const adapter = registry.get(id);
    return {
      id: adapter.id,
      name: adapter.name,
      type: adapter.type,
      version: adapter.version,
    };
  });

  return NextResponse.json({ protocols });
}
```

### 7.2 통합 대시보드

```typescript
// src/app/api/dashboard/aggregate/route.ts
import { NextResponse } from 'next/server';
import { registry } from '@/adapters/registry';

export async function GET() {
  const [metrics, health, anomalies] = await Promise.all([
    registry.getAggregatedMetrics(),
    registry.getAggregatedHealth(),
    registry.getAllAnomalies(),
  ]);

  const healthScores = Object.values(health).map(h => h.score);
  const avgHealthScore = healthScores.length > 0
    ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
    : 0;

  const totalAnomalies = Object.values(anomalies)
    .flat()
    .filter(a => a.isAnomaly);

  return NextResponse.json({
    summary: {
      protocolCount: registry.list().length,
      avgHealthScore: Math.round(avgHealthScore),
      activeAnomalies: totalAnomalies.length,
      criticalAnomalies: totalAnomalies.filter(a => Math.abs(a.zScore) > 3.5).length,
    },
    protocols: registry.list().map(id => ({
      id,
      metrics: metrics[id],
      health: health[id],
      anomalies: anomalies[id] || [],
    })),
  });
}
```

---

## 8. 마이그레이션 전략

### 8.1 하위 호환성 유지

기존 API 엔드포인트는 그대로 유지하고, 내부적으로 OptimismAdapter 호출:

```typescript
// src/app/api/metrics/route.ts (수정)
import { registry } from '@/adapters/registry';

export async function GET(request: Request) {
  // 기존 로직 유지 (하위 호환)
  // 또는 OptimismAdapter로 리다이렉트
  const adapter = registry.get('optimism-mainnet');
  const metrics = await adapter.getMetrics();

  // 기존 응답 포맷으로 변환
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    metrics: {
      l1BlockHeight: metrics.customMetrics?.l1BlockHeight,
      blockHeight: metrics.blockHeight,
      // ... 기존 필드 매핑
    },
  });
}
```

### 8.2 점진적 마이그레이션 체크리스트

- [ ] Phase 1: `src/adapters/types.ts` 생성
- [ ] Phase 1: `src/adapters/base/BaseAdapter.ts` 생성
- [ ] Phase 1: `src/adapters/registry.ts` 생성
- [ ] Phase 2: `src/adapters/optimism/` 디렉토리 생성
- [ ] Phase 2: 기존 metrics-store 로직 추출
- [ ] Phase 2: 기존 anomaly-detector 로직 추출
- [ ] Phase 2: 기존 rca-engine 컴포넌트 그래프 추출
- [ ] Phase 2: 기존 API 하위 호환성 테스트
- [ ] Phase 3: EthereumAdapter 구현
- [ ] Phase 3: BitcoinAdapter 구현
- [ ] Phase 4: 멀티 프로토콜 Dashboard UI

---

## 9. 환경 변수

```env
# 기존 (유지)
L2_RPC_URL=https://mainnet.optimism.io
L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# 신규 (선택적)
PROTOCOLS_CONFIG_PATH=./config/protocols.json

# Ethereum Node (선택적)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key

# Bitcoin Node (선택적)
BITCOIN_RPC_URL=http://localhost:8332
BITCOIN_RPC_USER=user
BITCOIN_RPC_PASSWORD=password
```

---

## 10. 설정 파일 예시

```json
// config/protocols.json
{
  "protocols": [
    {
      "id": "optimism-mainnet",
      "name": "Optimism Mainnet",
      "type": "l2-rollup",
      "enabled": true,
      "rpcUrl": "${L2_RPC_URL}",
      "protocolConfig": {
        "l1RpcUrl": "${L1_RPC_URL}"
      },
      "kubernetes": {
        "namespace": "optimism",
        "labelSelector": "app=op-geth"
      }
    },
    {
      "id": "ethereum-mainnet",
      "name": "Ethereum Mainnet",
      "type": "l1-node",
      "enabled": true,
      "rpcUrl": "${ETHEREUM_RPC_URL}"
    }
  ]
}
```

---

## 11. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| 지원 프로토콜 수 | ≥ 3 | Adapter 개수 |
| 기존 API 호환성 | 100% | 회귀 테스트 |
| 코드 재사용률 | > 70% | 공통 코드 비율 |
| 테스트 커버리지 | > 80% | Jest coverage |

---

## 12. 테스트 체크리스트

- [ ] OptimismAdapter 메트릭 조회 (기존 기능 유지)
- [ ] OptimismAdapter 이상 탐지 (기존 기능 유지)
- [ ] Protocol Registry 등록/조회
- [ ] 기존 /api/metrics 하위 호환성
- [ ] 기존 /api/anomalies 하위 호환성
- [ ] 기존 /api/rca 하위 호환성
- [ ] EthereumAdapter 메트릭 조회 (선택적)
- [ ] 통합 Dashboard API
