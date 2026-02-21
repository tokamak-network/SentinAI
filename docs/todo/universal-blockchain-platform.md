# SentinAI Universal Blockchain Infrastructure Platform PRD

**Version:** 1.1
**Date:** 2026-02-10
**Status:** Ready for Implementation

---

## 1. Overview

### 1.1 Goal
Expands SentinAI from an L2-only monitoring tool to a universal platform that manages all blockchain infrastructure.

### 1.2 Current vs Goal

| Item | Current status | Goal |
|------|----------|------|
| Supported Protocols | Optimism L2 only | Any EVM + Non-EVM |
| Scalability | Hard coding for each component | Plugin/Adapter system |
| Dashboard | single network | Multi-network integration |
| Community | - | Adapter Marketplace |

### 1.3 Current code base analysis

**Implemented core modules:**

```
src/lib/
├── ai-client.ts # AI Gateway 통합 (Claude API)
├── anomaly-detector.ts # Anomaly detection (Z-Score, Rules)
├── anomaly-event-store.ts # anomaly event store
├── cost-optimizer.ts # AI cost optimization
├── k8s-scaler.ts # K8s resource scaling
├── metrics-store.ts # Store metrics time series
├── prediction-tracker.ts # prediction tracking
├── predictive-scaler.ts # AI-based predictive scaling
├── rca-engine.ts # Root cause analysis
└── usage-tracker.ts # Track usage patterns
```

**Current Optimism only logic:**
- `metrics-store.ts`: L2 block height, TxPool, Gas metrics
- `rca-engine.ts`: op-geth, op-node, op-batcher, op-proposer component graph
- `anomaly-detector.ts`: L2 block plateau, TxPool monotonic rules.

### 1.4 Refactoring Strategy

```
Phase 1: Adapter Interface Design
         ↓
Phase 2: Extract existing logic into OptimismAdapter
         ↓
Phase 3: EthereumAdapter, BitcoinAdapter 추가
         ↓
Phase 4: Multi-protocol Dashboard UI
```

---

## 2. User Story

### US-1: Multichain monitoring
```
As a blockchain infrastructure operator
I want to monitor multiple networks from a single dashboard
So that I can efficiently manage all my nodes
```

### US-2: Add new protocol
```
As a DevOps engineer
I want to easily add support for new blockchain protocols
So that I can extend monitoring to new networks without major code changes
```

### US-3: Unified Notifications
```
As an on-call engineer
I want to receive unified alerts for all monitored networks
So that I can quickly identify and respond to issues across chains
```

---

## 3. Technical architecture

### 3.1 System structure

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

### 3.2 Adapter Interface Design

All blockchain adapters must implement a common interface.

```typescript
// src/adapters/types.ts

/**
* Blockchain protocol type
 */
export type ProtocolType =
  | 'l2-rollup'      // L2 Rollup (Optimism, Arbitrum, etc.)
  | 'l1-node'        // L1 Full Node (Ethereum, Bitcoin, etc.)
  | 'validator'      // PoS Validator (Solana, Cosmos, etc.)
  | 'indexer'        // Indexer/Subgraph
  | 'rpc-provider'   // RPC Provider
  | 'custom';        // Custom protocol

/**
* Common metric structure (based on existing MetricDataPoint)
 */
export interface UniversalMetrics {
// Required fields (all protocols)
  blockHeight: number;
  syncStatus: number;        // 0-100 (percentage)
  timestamp: Date;

// Resource metrics (optional)
  cpuUsage?: number;         // 0-100
  memoryUsage?: number;      // 0-100
  diskUsage?: number;        // 0-100

// Custom metrics per protocol
  customMetrics?: Record<string, unknown>;
}

/**
* Health status (extending existing HealthStatus)
 */
export interface AdapterHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  score: number;             // 0-100
  checks: HealthCheck[];
  lastChecked: Date;
}

/**
* Blockchain Adapter interface
 */
export interface BlockchainAdapter {
// metadata
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType;
  readonly version: string;

// reset
  initialize(config: AdapterConfig): Promise<void>;
  dispose(): Promise<void>;

// status inquiry (required)
  getMetrics(): Promise<UniversalMetrics>;
  getHealth(): Promise<AdapterHealthStatus>;

// Anomaly detection (optional) - use existing AnomalyResult type
  detectAnomalies?(): Promise<AnomalyResult[]>;

// Resource management (optional) - Integration with existing K8s scaler
  scale?(resources: ResourceSpec): Promise<void>;
  restart?(): Promise<void>;
}
```

---

## 4. File structure (refactoring plan)

### 4.1 Current structure → Target structure

**today:**
```
src/
├── lib/
│ ├── metrics-store.ts # Optimism metrics (hardcoding)
│ ├── anomaly-detector.ts # Optimism anomaly detection rules
│ ├── rca-engine.ts # Optimism component graph
│   └── ...
```

**target:**
```
src/
├── adapters/
│ ├── types.ts # Common Adapter interface
│   ├── registry.ts                   # Protocol Registry
│   ├── base/
│ │ └── BaseAdapter.ts # Abstract base class
│   ├── optimism/
│   │   ├── index.ts                  # OptimismAdapter
│ │ ├── metrics.ts # Move existing metrics-store logic
│ │ ├── anomalies.ts # Move existing anomaly-detector logic
│ │ └── components.ts # Move existing rca-engine component graph
│   ├── ethereum/
│ │ ├── index.ts # EthereumAdapter (New)
│   │   └── metrics.ts
│   └── bitcoin/
│ ├── index.ts # BitcoinAdapter (New)
│       └── metrics.ts
├── lib/
│ ├── ai-client.ts # maintenance (common)
│ ├── cost-optimizer.ts # Maintenance (common, Adapter linked)
│   ├── metrics-store.ts              # → adapters/optimism/metrics.ts로 이동
│   ├── anomaly-detector.ts           # → adapters/optimism/anomalies.ts로 이동
│ ├── rca-engine.ts # → Separate by adapters
│   └── ...
├── app/
│   └── api/
│       ├── protocols/
│ │ ├── route.ts # GET /api/protocols (new)
│       │   └── [id]/
│       │       ├── route.ts          # GET /api/protocols/:id
│       │       ├── metrics/route.ts  # GET /api/protocols/:id/metrics
│       │       └── health/route.ts   # GET /api/protocols/:id/health
│       └── dashboard/
│           └── aggregate/route.ts    # GET /api/dashboard/aggregate (신규)
```

---

## 5. Existing code extraction guide

### 5.1 Creating OptimismAdapter

Encapsulate the existing logic into OptimismAdapter:

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
// Reuse existing metrics-store.ts logic
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

// Existing health logic
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
// Reuse existing anomaly-detector.ts logic
    return detectOptimismAnomalies();
  }

// Optimism only: component dependency graph
  getDependencyGraph() {
    return DEPENDENCY_GRAPH;
  }
}
```

### 5.2 Separate existing anomaly-detector.ts

```typescript
// src/adapters/optimism/anomalies.ts
// Extract only the logic dedicated to Optimism from the existing anomaly-detector.ts

import { AnomalyResult } from '@/types/anomaly';
import { getRecentMetrics } from '@/lib/metrics-store';

/**
 * Optimism L2 Block plateau detection
 */
function detectBlockPlateau(...) { /* existing logic */ }

/**
 * Optimism TxPool monotonic increase detection
 */
function detectTxPoolMonotonicIncrease(...) { /* existing logic */ }

export async function detectOptimismAnomalies(): Promise<AnomalyResult[]> {
  const history = getRecentMetrics(30);
// Existing detectAnomalies logic
}
```

### 5.3 Separation of existing rca-engine.ts component

```typescript
// src/adapters/optimism/components.ts
import { RCAComponent, ComponentDependency } from '@/types/rca';

/**
 * Optimism Rollup component dependency graph
* Move DEPENDENCY_GRAPH from existing rca-engine.ts
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
// ... maintain existing graph
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

## 7. New API endpoint

### 7.1 Protocol list

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

### 7.2 Integrated Dashboard

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

## 8. Migration Strategy

### Maintain backwards compatibility with 8.1

Keep the existing API endpoint as is and call OptimismAdapter internally:

```typescript
// src/app/api/metrics/route.ts (edited)
import { registry } from '@/adapters/registry';

export async function GET(request: Request) {
// Maintain existing logic (backwards compatible)
// or redirect to OptimismAdapter
  const adapter = registry.get('optimism-mainnet');
  const metrics = await adapter.getMetrics();

// Convert to existing response format
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    metrics: {
      l1BlockHeight: metrics.customMetrics?.l1BlockHeight,
      blockHeight: metrics.blockHeight,
// ... Mapping existing fields
    },
  });
}
```

### 8.2 Progressive Migration Checklist

- [ ] Phase 1: `src/adapters/types.ts` 생성
- [ ] Phase 1: `src/adapters/base/BaseAdapter.ts` 생성
- [ ] Phase 1: `src/adapters/registry.ts` 생성
- [ ] Phase 2: Create `src/adapters/optimism/` directory
- [ ] Phase 2: Extract existing metrics-store logic
- [ ] Phase 2: Extracting existing anomaly-detector logic
- [ ] Phase 2: Extract existing rca-engine component graph
- [ ] Phase 2: Existing API backward compatibility test
- [ ] Phase 3: EthereumAdapter implementation
- [ ] Phase 3: BitcoinAdapter implementation
- [ ] Phase 4: Multi-protocol Dashboard UI

---

## 9. Environment variables

```env
# Existing (maintained)
L2_RPC_URL=https://mainnet.optimism.io
L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# New (optional)
PROTOCOLS_CONFIG_PATH=./config/protocols.json

# Ethereum Node (optional)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key

# Bitcoin Node (optional)
BITCOIN_RPC_URL=http://localhost:8332
BITCOIN_RPC_USER=user
BITCOIN_RPC_PASSWORD=password
```

---

## 10. Example configuration file

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

## 11. Success indicators

| indicators | Goal | Measurement method |
|------|------|----------|
| Number of supported protocols | ≥ 3 | Number of Adapters |
| Existing API compatibility | 100% | regression testing |
| Code reuse rate | > 70% | Common code rate |
| test coverage | > 80% | jest coverage |

---

## 12. Test checklist

- [ ] OptimismAdapter metric query (maintains existing functionality)
- [ ] OptimismAdapter abnormality detection (maintaining existing functions)
- [ ] Protocol Registry registration/search
- [ ] Backward compatibility with existing /api/metrics
- [ ] Backward compatibility with existing /api/anomalies
- [ ] Existing /api/rca backward compatibility
- [ ] EthereumAdapter metrics query (optional)
- [ ] Integrated Dashboard API
