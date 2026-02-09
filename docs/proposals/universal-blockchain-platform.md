# SentinAI Universal Blockchain Infrastructure Platform

## PRD (Product Requirements Document)

**Version:** 1.0  
**Date:** 2026-02-09  
**Author:** Julian (AI Assistant)  
**Status:** Ready for Implementation

---

## 1. 개요

### 1.1 목표
SentinAI를 L2 전용 모니터링 도구에서 **모든 블록체인 인프라를 관리하는 범용 플랫폼**으로 확장한다.

### 1.2 현재 vs 목표

| 항목 | 현재 | 목표 |
|------|------|------|
| 지원 프로토콜 | Optimism L2 only | Any EVM + Non-EVM |
| 확장성 | 하드코딩 | Plugin/Adapter 시스템 |
| 대시보드 | 단일 네트워크 | 멀티 네트워크 통합 |
| 커뮤니티 | - | Adapter Marketplace |

### 1.3 핵심 가치
- **Protocol-agnostic**: 어떤 블록체인이든 동일한 인터페이스로 관리
- **Extensible**: 새 프로토콜 = Adapter 하나 추가
- **Unified Dashboard**: 여러 네트워크를 한 화면에서 모니터링
- **Community-driven**: 사용자가 Adapter 기여 가능

### 1.4 범위
- Phase 1: Adapter Interface 설계 + 기존 코드 리팩토링
- Phase 2: Ethereum/Bitcoin Adapter 추가
- Phase 3: 멀티 프로토콜 Dashboard UI
- Phase 4: Adapter Marketplace (선택적)

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

### US-4: 커스텀 메트릭
```
As a protocol-specific expert
I want to define custom metrics and anomaly rules
So that monitoring is tailored to each protocol's characteristics
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
 * 공통 메트릭 구조
 */
export interface Metrics {
  // 필수 필드
  blockHeight: number;
  syncStatus: number;        // 0-100 (percentage)
  
  // 리소스 메트릭 (선택적)
  cpuUsage?: number;         // 0-100
  memoryUsage?: number;      // 0-100
  diskUsage?: number;        // 0-100
  networkIO?: {
    bytesIn: number;
    bytesOut: number;
  };
  
  // 프로토콜별 커스텀 메트릭
  customMetrics?: Record<string, any>;
  
  // 메타데이터
  timestamp: Date;
}

/**
 * 헬스 상태
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  score: number;             // 0-100
  checks: HealthCheck[];
  lastChecked: Date;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  value?: any;
}

/**
 * 이상 탐지 결과
 */
export interface Anomaly {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  aiAnalysis?: string;
  recommendation?: string;
  timestamp: Date;
  resolved: boolean;
}

/**
 * 리소스 스펙 (스케일링용)
 */
export interface ResourceSpec {
  vCPU?: number;
  memoryGiB?: number;
  replicas?: number;
  customSpec?: Record<string, any>;
}

/**
 * 로그 필터
 */
export interface LogFilter {
  severity?: 'debug' | 'info' | 'warning' | 'error';
  component?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

/**
 * 로그 엔트리
 */
export interface LogEntry {
  timestamp: Date;
  severity: string;
  component: string;
  message: string;
  metadata?: Record<string, any>;
}

/**
 * Adapter 설정
 */
export interface AdapterConfig {
  id: string;                // Unique identifier
  name: string;              // Display name
  type: ProtocolType;
  enabled: boolean;
  
  // 연결 정보
  rpcUrl?: string;
  wsUrl?: string;
  apiUrl?: string;
  
  // 인증
  credentials?: {
    type: 'none' | 'basic' | 'bearer' | 'aws';
    [key: string]: any;
  };
  
  // K8s 연결 (선택적)
  kubernetes?: {
    context?: string;
    namespace?: string;
    labelSelector?: string;
  };
  
  // 프로토콜별 추가 설정
  protocolConfig?: Record<string, any>;
  
  // 이상 탐지 규칙
  anomalyRules?: AnomalyRule[];
}

export interface AnomalyRule {
  id: string;
  name: string;
  condition: string;         // Expression (e.g., "metrics.cpuUsage > 80")
  severity: 'info' | 'warning' | 'critical';
  message: string;
  cooldownMinutes?: number;  // Alert cooldown
}

/**
 * 블록체인 Adapter 인터페이스
 * 모든 프로토콜 Adapter는 이 인터페이스를 구현해야 함
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
  getMetrics(): Promise<Metrics>;
  getHealth(): Promise<HealthStatus>;
  
  // 로그 (선택적)
  getLogs?(filter: LogFilter): Promise<LogEntry[]>;
  
  // 이상 탐지 (선택적)
  detectAnomalies?(): Promise<Anomaly[]>;
  
  // 리소스 관리 (선택적)
  scale?(resources: ResourceSpec): Promise<void>;
  restart?(): Promise<void>;
  
  // 커스텀 액션 (선택적)
  executeAction?(action: string, params: Record<string, any>): Promise<any>;
}

/**
 * Adapter Factory 함수 타입
 */
export type AdapterFactory = (config: AdapterConfig) => BlockchainAdapter;
```

### 3.3 Protocol Registry

```typescript
// src/lib/protocol-registry.ts

import { BlockchainAdapter, AdapterConfig, AdapterFactory, Metrics, HealthStatus } from '@/adapters/types';

/**
 * 프로토콜 레지스트리
 * 모든 Adapter를 중앙에서 관리
 */
export class ProtocolRegistry {
  private static instance: ProtocolRegistry;
  private adapters: Map<string, BlockchainAdapter> = new Map();
  private factories: Map<string, AdapterFactory> = new Map();
  private configs: Map<string, AdapterConfig> = new Map();
  
  private constructor() {}
  
  static getInstance(): ProtocolRegistry {
    if (!ProtocolRegistry.instance) {
      ProtocolRegistry.instance = new ProtocolRegistry();
    }
    return ProtocolRegistry.instance;
  }
  
  /**
   * Adapter Factory 등록 (플러그인 시스템)
   */
  registerFactory(type: string, factory: AdapterFactory): void {
    this.factories.set(type, factory);
    console.log(`Registered adapter factory: ${type}`);
  }
  
  /**
   * Adapter 인스턴스 등록 및 초기화
   */
  async register(config: AdapterConfig): Promise<void> {
    const factory = this.factories.get(config.type);
    
    if (!factory) {
      throw new Error(`No factory registered for type: ${config.type}`);
    }
    
    const adapter = factory(config);
    await adapter.initialize(config);
    
    this.adapters.set(config.id, adapter);
    this.configs.set(config.id, config);
    
    console.log(`Registered adapter: ${config.id} (${config.type})`);
  }
  
  /**
   * Adapter 해제
   */
  async unregister(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter) {
      await adapter.dispose();
      this.adapters.delete(id);
      this.configs.delete(id);
    }
  }
  
  /**
   * Adapter 조회
   */
  get(id: string): BlockchainAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Adapter not found: ${id}`);
    }
    return adapter;
  }
  
  /**
   * 모든 Adapter ID 목록
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
  
  /**
   * 활성화된 Adapter 설정 목록
   */
  listConfigs(): AdapterConfig[] {
    return Array.from(this.configs.values());
  }
  
  /**
   * 전체 시스템 메트릭 집계
   */
  async getAggregatedMetrics(): Promise<Record<string, Metrics>> {
    const results: Record<string, Metrics> = {};
    
    await Promise.all(
      Array.from(this.adapters.entries()).map(async ([id, adapter]) => {
        try {
          results[id] = await adapter.getMetrics();
        } catch (error) {
          console.error(`Failed to get metrics for ${id}:`, error);
        }
      })
    );
    
    return results;
  }
  
  /**
   * 전체 시스템 헬스 집계
   */
  async getAggregatedHealth(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};
    
    await Promise.all(
      Array.from(this.adapters.entries()).map(async ([id, adapter]) => {
        try {
          results[id] = await adapter.getHealth();
        } catch (error) {
          console.error(`Failed to get health for ${id}:`, error);
          results[id] = {
            status: 'unknown',
            score: 0,
            checks: [],
            lastChecked: new Date(),
          };
        }
      })
    );
    
    return results;
  }
  
  /**
   * 전체 이상 탐지
   */
  async getAllAnomalies(): Promise<Record<string, Anomaly[]>> {
    const results: Record<string, Anomaly[]> = {};
    
    await Promise.all(
      Array.from(this.adapters.entries()).map(async ([id, adapter]) => {
        if (adapter.detectAnomalies) {
          try {
            results[id] = await adapter.detectAnomalies();
          } catch (error) {
            console.error(`Failed to detect anomalies for ${id}:`, error);
            results[id] = [];
          }
        }
      })
    );
    
    return results;
  }
}

// Singleton export
export const registry = ProtocolRegistry.getInstance();
```

---

## 4. 파일 구조

### 4.1 전체 프로젝트 구조

```
src/
├── adapters/
│   ├── types.ts                      # 공통 인터페이스 정의
│   ├── base/
│   │   ├── BaseAdapter.ts            # 추상 기본 클래스
│   │   └── utils.ts                  # 공통 유틸리티
│   ├── optimism/
│   │   ├── index.ts                  # Optimism Adapter
│   │   ├── metrics.ts                # 메트릭 수집 로직
│   │   ├── anomalies.ts              # 이상 탐지 로직
│   │   └── scaler.ts                 # 스케일링 로직
│   ├── ethereum/
│   │   ├── index.ts                  # Ethereum Adapter
│   │   └── metrics.ts
│   ├── bitcoin/
│   │   ├── index.ts                  # Bitcoin Adapter
│   │   └── metrics.ts
│   ├── solana/
│   │   ├── index.ts                  # Solana Adapter
│   │   └── metrics.ts
│   └── custom/
│       └── YamlAdapter.ts            # YAML 기반 커스텀 Adapter
├── lib/
│   ├── protocol-registry.ts          # 프로토콜 레지스트리
│   ├── adapter-loader.ts             # Adapter 동적 로딩
│   └── config-loader.ts              # 설정 파일 로딩
├── app/
│   ├── api/
│   │   ├── protocols/
│   │   │   ├── route.ts              # GET /api/protocols - 목록
│   │   │   └── [id]/
│   │   │       ├── route.ts          # GET/DELETE /api/protocols/:id
│   │   │       ├── metrics/
│   │   │       │   └── route.ts      # GET /api/protocols/:id/metrics
│   │   │       ├── health/
│   │   │       │   └── route.ts      # GET /api/protocols/:id/health
│   │   │       ├── anomalies/
│   │   │       │   └── route.ts      # GET /api/protocols/:id/anomalies
│   │   │       └── scale/
│   │   │           └── route.ts      # POST /api/protocols/:id/scale
│   │   └── dashboard/
│   │       └── aggregate/
│   │           └── route.ts          # GET /api/dashboard/aggregate
│   └── dashboard/
│       ├── page.tsx                  # 메인 대시보드 (멀티 프로토콜)
│       ├── layout.tsx
│       └── [protocol]/
│           └── page.tsx              # 프로토콜별 상세 뷰
├── components/
│   ├── dashboard/
│   │   ├── ProtocolCard.tsx          # 프로토콜별 상태 카드
│   │   ├── ProtocolSelector.tsx      # 프로토콜 선택 드롭다운
│   │   ├── AggregateMetrics.tsx      # 통합 메트릭 뷰
│   │   └── UniversalAnomalyPanel.tsx # 통합 이상 탐지 패널
│   └── protocols/
│       ├── OptimismView.tsx          # Optimism 전용 뷰
│       ├── EthereumView.tsx          # Ethereum 전용 뷰
│       └── GenericView.tsx           # 범용 프로토콜 뷰
├── config/
│   └── protocols/
│       ├── optimism.json             # Optimism 설정
│       ├── ethereum.json             # Ethereum 설정
│       └── bitcoin.json              # Bitcoin 설정
└── types/
    └── protocol.ts                   # 프로토콜 관련 타입
```

---

## 5. 구현 가이드

### Phase 1: Adapter Interface + 기존 코드 리팩토링 (Day 1-5)

#### Step 1.1: Base Adapter 클래스

```typescript
// src/adapters/base/BaseAdapter.ts

import {
  BlockchainAdapter,
  AdapterConfig,
  Metrics,
  HealthStatus,
  HealthCheck,
  Anomaly,
  AnomalyRule,
  LogFilter,
  LogEntry,
  ResourceSpec,
  ProtocolType,
} from '../types';

/**
 * 기본 Adapter 추상 클래스
 * 공통 기능 구현 및 템플릿 메서드 패턴 제공
 */
export abstract class BaseAdapter implements BlockchainAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: ProtocolType;
  readonly version: string = '1.0.0';
  
  protected config!: AdapterConfig;
  protected initialized: boolean = false;
  protected lastMetrics?: Metrics;
  protected lastAnomalies: Anomaly[] = [];
  
  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
    await this.onInitialize();
    this.initialized = true;
    console.log(`[${this.id}] Adapter initialized`);
  }
  
  async dispose(): Promise<void> {
    await this.onDispose();
    this.initialized = false;
    console.log(`[${this.id}] Adapter disposed`);
  }
  
  // 서브클래스에서 구현
  protected abstract onInitialize(): Promise<void>;
  protected abstract onDispose(): Promise<void>;
  protected abstract fetchMetrics(): Promise<Metrics>;
  
  // 공통 메트릭 조회
  async getMetrics(): Promise<Metrics> {
    this.ensureInitialized();
    const metrics = await this.fetchMetrics();
    this.lastMetrics = metrics;
    return metrics;
  }
  
  // 공통 헬스 체크
  async getHealth(): Promise<HealthStatus> {
    this.ensureInitialized();
    
    const checks: HealthCheck[] = await this.runHealthChecks();
    const failedChecks = checks.filter(c => c.status === 'fail').length;
    const warnChecks = checks.filter(c => c.status === 'warn').length;
    
    let status: HealthStatus['status'];
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
    
    return {
      status,
      score,
      checks,
      lastChecked: new Date(),
    };
  }
  
  // 서브클래스에서 오버라이드 가능
  protected async runHealthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    
    // 기본 체크: 메트릭 조회 가능
    try {
      const metrics = await this.getMetrics();
      checks.push({
        name: 'metrics_available',
        status: 'pass',
        message: 'Metrics are available',
      });
      
      // Sync 상태 체크
      if (metrics.syncStatus < 99) {
        checks.push({
          name: 'sync_status',
          status: metrics.syncStatus < 50 ? 'fail' : 'warn',
          message: `Sync at ${metrics.syncStatus}%`,
          value: metrics.syncStatus,
        });
      } else {
        checks.push({
          name: 'sync_status',
          status: 'pass',
          message: 'Fully synced',
          value: metrics.syncStatus,
        });
      }
    } catch (error) {
      checks.push({
        name: 'metrics_available',
        status: 'fail',
        message: `Failed to fetch metrics: ${error}`,
      });
    }
    
    return checks;
  }
  
  // 기본 이상 탐지 (규칙 기반)
  async detectAnomalies(): Promise<Anomaly[]> {
    this.ensureInitialized();
    
    if (!this.config.anomalyRules || this.config.anomalyRules.length === 0) {
      return [];
    }
    
    const metrics = await this.getMetrics();
    const anomalies: Anomaly[] = [];
    
    for (const rule of this.config.anomalyRules) {
      if (this.evaluateRule(rule, metrics)) {
        anomalies.push({
          id: `${this.id}-${rule.id}-${Date.now()}`,
          severity: rule.severity,
          component: this.id,
          message: rule.message,
          timestamp: new Date(),
          resolved: false,
        });
      }
    }
    
    this.lastAnomalies = anomalies;
    return anomalies;
  }
  
  // 규칙 평가 (간단한 expression evaluator)
  protected evaluateRule(rule: AnomalyRule, metrics: Metrics): boolean {
    try {
      // 간단한 조건 파싱 (e.g., "metrics.cpuUsage > 80")
      const condition = rule.condition
        .replace(/metrics\./g, '')
        .replace(/customMetrics\./g, 'metrics.customMetrics.');
      
      const fn = new Function('metrics', `return ${condition}`);
      return fn(metrics);
    } catch (error) {
      console.error(`[${this.id}] Failed to evaluate rule ${rule.id}:`, error);
      return false;
    }
  }
  
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.id} is not initialized`);
    }
  }
}
```

#### Step 1.2: Optimism Adapter 리팩토링

```typescript
// src/adapters/optimism/index.ts

import { BaseAdapter } from '../base/BaseAdapter';
import {
  Metrics,
  HealthCheck,
  Anomaly,
  ResourceSpec,
  LogFilter,
  LogEntry,
  ProtocolType,
} from '../types';
import { getK8sPods, scaleDeployment, restartDeployment } from './k8s';
import { getL2BlockHeight, getL1BlockHeight, getTxPoolStatus, getGasPrice } from './rpc';
import { detectOptimismAnomalies } from './anomalies';

export class OptimismAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType = 'l2-rollup';
  
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
    
    if (!this.l2RpcUrl) {
      throw new Error('L2 RPC URL is required');
    }
  }
  
  protected async onDispose(): Promise<void> {
    // Cleanup if needed
  }
  
  protected async fetchMetrics(): Promise<Metrics> {
    // 병렬로 모든 메트릭 조회
    const [l2Height, l1Height, txPool, gasPrice, pods] = await Promise.all([
      getL2BlockHeight(this.l2RpcUrl),
      getL1BlockHeight(this.l1RpcUrl),
      getTxPoolStatus(this.l2RpcUrl),
      getGasPrice(this.l2RpcUrl),
      this.config.kubernetes ? getK8sPods(this.config.kubernetes) : null,
    ]);
    
    // CPU/Memory 계산 (K8s pods에서)
    let cpuUsage = 0;
    let memoryUsage = 0;
    
    if (pods && pods.length > 0) {
      cpuUsage = pods.reduce((sum, p) => sum + (p.cpuUsage || 0), 0) / pods.length;
      memoryUsage = pods.reduce((sum, p) => sum + (p.memoryUsage || 0), 0) / pods.length;
    }
    
    return {
      blockHeight: l2Height,
      syncStatus: 100, // TODO: Calculate actual sync status
      cpuUsage,
      memoryUsage,
      customMetrics: {
        l1BlockHeight: l1Height,
        txPoolPending: txPool.pending,
        txPoolQueued: txPool.queued,
        gasPrice: gasPrice.average,
        baseFee: gasPrice.baseFee,
        podCount: pods?.length || 0,
      },
      timestamp: new Date(),
    };
  }
  
  protected async runHealthChecks(): Promise<HealthCheck[]> {
    const checks = await super.runHealthChecks();
    
    // Optimism 전용 체크
    const metrics = this.lastMetrics;
    
    if (metrics?.customMetrics) {
      // TxPool 체크
      const pending = metrics.customMetrics.txPoolPending || 0;
      if (pending > 1000) {
        checks.push({
          name: 'txpool_congestion',
          status: pending > 5000 ? 'fail' : 'warn',
          message: `TxPool has ${pending} pending transactions`,
          value: pending,
        });
      }
      
      // L1 sync 체크
      // TODO: Add L1 sync lag check
    }
    
    return checks;
  }
  
  async detectAnomalies(): Promise<Anomaly[]> {
    const metrics = await this.getMetrics();
    const logs = await this.getLogs?.({ severity: 'warning', limit: 100 }) || [];
    
    // Optimism 전용 이상 탐지 로직
    return detectOptimismAnomalies(this.id, metrics, logs);
  }
  
  async scale(resources: ResourceSpec): Promise<void> {
    if (!this.config.kubernetes) {
      throw new Error('Kubernetes configuration is required for scaling');
    }
    
    await scaleDeployment(this.config.kubernetes, {
      vCPU: resources.vCPU,
      memoryGiB: resources.memoryGiB,
    });
  }
  
  async restart(): Promise<void> {
    if (!this.config.kubernetes) {
      throw new Error('Kubernetes configuration is required for restart');
    }
    
    await restartDeployment(this.config.kubernetes);
  }
  
  async getLogs(filter: LogFilter): Promise<LogEntry[]> {
    // TODO: Implement log fetching from K8s
    return [];
  }
}

// Factory function
export function createOptimismAdapter(config: any): OptimismAdapter {
  return new OptimismAdapter(config.id, config.name);
}
```

#### Step 1.3: Optimism 헬퍼 함수들

```typescript
// src/adapters/optimism/rpc.ts

import { createPublicClient, http } from 'viem';
import { optimism } from 'viem/chains';

export async function getL2BlockHeight(rpcUrl: string): Promise<number> {
  const client = createPublicClient({
    chain: optimism,
    transport: http(rpcUrl),
  });
  
  const blockNumber = await client.getBlockNumber();
  return Number(blockNumber);
}

export async function getL1BlockHeight(rpcUrl: string): Promise<number> {
  if (!rpcUrl) return 0;
  
  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  
  const blockNumber = await client.getBlockNumber();
  return Number(blockNumber);
}

export async function getTxPoolStatus(rpcUrl: string): Promise<{ pending: number; queued: number }> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'txpool_status',
        params: [],
        id: 1,
      }),
    });
    
    const data = await response.json();
    
    if (data.result) {
      return {
        pending: parseInt(data.result.pending, 16),
        queued: parseInt(data.result.queued, 16),
      };
    }
  } catch (error) {
    console.error('Failed to get txpool status:', error);
  }
  
  return { pending: 0, queued: 0 };
}

export async function getGasPrice(rpcUrl: string): Promise<{ average: number; baseFee: number }> {
  const client = createPublicClient({
    chain: optimism,
    transport: http(rpcUrl),
  });
  
  try {
    const [gasPrice, block] = await Promise.all([
      client.getGasPrice(),
      client.getBlock(),
    ]);
    
    return {
      average: Number(gasPrice) / 1e9,  // Convert to Gwei
      baseFee: Number(block.baseFeePerGas || 0) / 1e9,
    };
  } catch (error) {
    console.error('Failed to get gas price:', error);
    return { average: 0, baseFee: 0 };
  }
}
```

```typescript
// src/adapters/optimism/k8s.ts

interface K8sConfig {
  context?: string;
  namespace?: string;
  labelSelector?: string;
}

interface PodInfo {
  name: string;
  status: string;
  cpuUsage: number;
  memoryUsage: number;
}

export async function getK8sPods(config: K8sConfig): Promise<PodInfo[]> {
  // 기존 K8s 조회 로직 재사용
  // TODO: Refactor from existing code
  return [];
}

export async function scaleDeployment(
  config: K8sConfig,
  resources: { vCPU?: number; memoryGiB?: number }
): Promise<void> {
  // 기존 스케일링 로직 재사용
  // TODO: Refactor from existing code
}

export async function restartDeployment(config: K8sConfig): Promise<void> {
  // kubectl rollout restart 로직
  // TODO: Implement
}
```

### Phase 2: Ethereum/Bitcoin Adapter 추가 (Day 6-8)

#### Step 2.1: Ethereum Adapter

```typescript
// src/adapters/ethereum/index.ts

import { BaseAdapter } from '../base/BaseAdapter';
import { Metrics, HealthCheck, ProtocolType } from '../types';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export class EthereumAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType = 'l1-node';
  
  private rpcUrl: string = '';
  private client: any;
  
  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }
  
  protected async onInitialize(): Promise<void> {
    this.rpcUrl = this.config.rpcUrl || '';
    
    if (!this.rpcUrl) {
      throw new Error('RPC URL is required');
    }
    
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(this.rpcUrl),
    });
  }
  
  protected async onDispose(): Promise<void> {
    this.client = null;
  }
  
  protected async fetchMetrics(): Promise<Metrics> {
    const [blockNumber, syncing, gasPrice, peerCount] = await Promise.all([
      this.client.getBlockNumber(),
      this.getSyncStatus(),
      this.client.getGasPrice(),
      this.getPeerCount(),
    ]);
    
    return {
      blockHeight: Number(blockNumber),
      syncStatus: syncing.syncing ? syncing.progress : 100,
      customMetrics: {
        peerCount,
        gasPrice: Number(gasPrice) / 1e9,
        syncing: syncing.syncing,
        currentBlock: syncing.currentBlock,
        highestBlock: syncing.highestBlock,
      },
      timestamp: new Date(),
    };
  }
  
  private async getSyncStatus(): Promise<{
    syncing: boolean;
    progress: number;
    currentBlock?: number;
    highestBlock?: number;
  }> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_syncing',
          params: [],
          id: 1,
        }),
      });
      
      const data = await response.json();
      
      if (data.result === false) {
        return { syncing: false, progress: 100 };
      }
      
      const current = parseInt(data.result.currentBlock, 16);
      const highest = parseInt(data.result.highestBlock, 16);
      const progress = highest > 0 ? (current / highest) * 100 : 0;
      
      return {
        syncing: true,
        progress,
        currentBlock: current,
        highestBlock: highest,
      };
    } catch (error) {
      console.error('Failed to get sync status:', error);
      return { syncing: false, progress: 100 };
    }
  }
  
  private async getPeerCount(): Promise<number> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'net_peerCount',
          params: [],
          id: 1,
        }),
      });
      
      const data = await response.json();
      return parseInt(data.result, 16);
    } catch (error) {
      console.error('Failed to get peer count:', error);
      return 0;
    }
  }
  
  protected async runHealthChecks(): Promise<HealthCheck[]> {
    const checks = await super.runHealthChecks();
    const metrics = this.lastMetrics;
    
    if (metrics?.customMetrics) {
      // Peer count 체크
      const peerCount = metrics.customMetrics.peerCount || 0;
      checks.push({
        name: 'peer_count',
        status: peerCount < 3 ? 'fail' : peerCount < 10 ? 'warn' : 'pass',
        message: `Connected to ${peerCount} peers`,
        value: peerCount,
      });
    }
    
    return checks;
  }
}

export function createEthereumAdapter(config: any): EthereumAdapter {
  return new EthereumAdapter(config.id, config.name);
}
```

#### Step 2.2: Bitcoin Adapter

```typescript
// src/adapters/bitcoin/index.ts

import { BaseAdapter } from '../base/BaseAdapter';
import { Metrics, HealthCheck, ProtocolType } from '../types';

interface BitcoinRpcResponse {
  result: any;
  error: any;
  id: string;
}

export class BitcoinAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: ProtocolType = 'l1-node';
  
  private rpcUrl: string = '';
  private rpcAuth: { username: string; password: string } = { username: '', password: '' };
  
  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }
  
  protected async onInitialize(): Promise<void> {
    this.rpcUrl = this.config.rpcUrl || '';
    
    if (this.config.credentials?.type === 'basic') {
      this.rpcAuth = {
        username: this.config.credentials.username || '',
        password: this.config.credentials.password || '',
      };
    }
    
    if (!this.rpcUrl) {
      throw new Error('RPC URL is required');
    }
  }
  
  protected async onDispose(): Promise<void> {
    // Cleanup
  }
  
  private async rpcCall(method: string, params: any[] = []): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.rpcAuth.username && this.rpcAuth.password) {
      const auth = Buffer.from(`${this.rpcAuth.username}:${this.rpcAuth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    
    const response = await fetch(this.rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'sentinai',
        method,
        params,
      }),
    });
    
    const data: BitcoinRpcResponse = await response.json();
    
    if (data.error) {
      throw new Error(`Bitcoin RPC error: ${data.error.message}`);
    }
    
    return data.result;
  }
  
  protected async fetchMetrics(): Promise<Metrics> {
    const [blockchainInfo, mempoolInfo, networkInfo, peerInfo] = await Promise.all([
      this.rpcCall('getblockchaininfo'),
      this.rpcCall('getmempoolinfo'),
      this.rpcCall('getnetworkinfo'),
      this.rpcCall('getpeerinfo'),
    ]);
    
    const syncProgress = blockchainInfo.headers > 0
      ? (blockchainInfo.blocks / blockchainInfo.headers) * 100
      : 100;
    
    return {
      blockHeight: blockchainInfo.blocks,
      syncStatus: syncProgress,
      customMetrics: {
        headers: blockchainInfo.headers,
        difficulty: blockchainInfo.difficulty,
        chain: blockchainInfo.chain,
        verificationProgress: blockchainInfo.verificationprogress * 100,
        mempoolSize: mempoolInfo.size,
        mempoolBytes: mempoolInfo.bytes,
        mempoolMinFee: mempoolInfo.mempoolminfee,
        peerCount: peerInfo.length,
        networkVersion: networkInfo.version,
        subversion: networkInfo.subversion,
        connections: networkInfo.connections,
      },
      timestamp: new Date(),
    };
  }
  
  protected async runHealthChecks(): Promise<HealthCheck[]> {
    const checks = await super.runHealthChecks();
    const metrics = this.lastMetrics;
    
    if (metrics?.customMetrics) {
      // Peer count
      const peers = metrics.customMetrics.peerCount || 0;
      checks.push({
        name: 'peer_count',
        status: peers < 3 ? 'fail' : peers < 8 ? 'warn' : 'pass',
        message: `Connected to ${peers} peers`,
        value: peers,
      });
      
      // Mempool
      const mempoolSize = metrics.customMetrics.mempoolSize || 0;
      if (mempoolSize > 100000) {
        checks.push({
          name: 'mempool_congestion',
          status: 'warn',
          message: `Mempool has ${mempoolSize} transactions`,
          value: mempoolSize,
        });
      }
    }
    
    return checks;
  }
}

export function createBitcoinAdapter(config: any): BitcoinAdapter {
  return new BitcoinAdapter(config.id, config.name);
}
```

### Phase 3: 멀티 프로토콜 API + Dashboard (Day 9-12)

#### Step 3.1: 프로토콜 목록 API

```typescript
// src/app/api/protocols/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { registry } from '@/lib/protocol-registry';

export async function GET(req: NextRequest) {
  try {
    const configs = registry.listConfigs();
    
    return NextResponse.json({
      protocols: configs.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        enabled: c.enabled,
      })),
    });
  } catch (error) {
    console.error('Failed to list protocols:', error);
    return NextResponse.json({ error: 'Failed to list protocols' }, { status: 500 });
  }
}
```

#### Step 3.2: 프로토콜별 메트릭 API

```typescript
// src/app/api/protocols/[id]/metrics/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { registry } from '@/lib/protocol-registry';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const adapter = registry.get(params.id);
    const metrics = await adapter.getMetrics();
    
    return NextResponse.json({
      protocolId: params.id,
      metrics,
    });
  } catch (error) {
    console.error(`Failed to get metrics for ${params.id}:`, error);
    return NextResponse.json(
      { error: `Failed to get metrics: ${error}` },
      { status: 500 }
    );
  }
}
```

#### Step 3.3: 통합 대시보드 API

```typescript
// src/app/api/dashboard/aggregate/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { registry } from '@/lib/protocol-registry';

export async function GET(req: NextRequest) {
  try {
    const [metrics, health, anomalies] = await Promise.all([
      registry.getAggregatedMetrics(),
      registry.getAggregatedHealth(),
      registry.getAllAnomalies(),
    ]);
    
    // 전체 시스템 요약
    const healthScores = Object.values(health).map(h => h.score);
    const avgHealthScore = healthScores.length > 0
      ? healthScores.reduce((a, b) => a + b, 0) / healthScores.length
      : 0;
    
    const totalAnomalies = Object.values(anomalies)
      .flat()
      .filter(a => !a.resolved);
    
    return NextResponse.json({
      summary: {
        protocolCount: registry.list().length,
        avgHealthScore: Math.round(avgHealthScore),
        activeAnomalies: totalAnomalies.length,
        criticalAnomalies: totalAnomalies.filter(a => a.severity === 'critical').length,
      },
      protocols: registry.list().map(id => ({
        id,
        metrics: metrics[id],
        health: health[id],
        anomalies: anomalies[id] || [],
      })),
    });
  } catch (error) {
    console.error('Failed to get aggregate data:', error);
    return NextResponse.json({ error: 'Failed to aggregate data' }, { status: 500 });
  }
}
```

#### Step 3.4: 멀티 프로토콜 Dashboard UI

```typescript
// src/app/dashboard/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { ProtocolCard } from '@/components/dashboard/ProtocolCard';
import { AggregateMetrics } from '@/components/dashboard/AggregateMetrics';
import { UniversalAnomalyPanel } from '@/components/dashboard/UniversalAnomalyPanel';

interface DashboardData {
  summary: {
    protocolCount: number;
    avgHealthScore: number;
    activeAnomalies: number;
    criticalAnomalies: number;
  };
  protocols: Array<{
    id: string;
    metrics: any;
    health: any;
    anomalies: any[];
  }>;
}

export default function UniversalDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/dashboard/aggregate');
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 10000); // 10초마다 새로고침
    
    return () => clearInterval(interval);
  }, []);
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  
  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">Error: {error || 'No data'}</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">🛡️ SentinAI Universal Dashboard</h1>
        <p className="text-gray-400">Monitoring {data.summary.protocolCount} protocols</p>
      </header>
      
      {/* Summary Cards */}
      <AggregateMetrics summary={data.summary} />
      
      {/* Protocol Grid */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Protocols</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.protocols.map(protocol => (
            <ProtocolCard
              key={protocol.id}
              id={protocol.id}
              metrics={protocol.metrics}
              health={protocol.health}
              anomalyCount={protocol.anomalies.length}
            />
          ))}
        </div>
      </section>
      
      {/* Anomaly Panel */}
      <section className="mt-8">
        <UniversalAnomalyPanel
          anomalies={data.protocols.flatMap(p => 
            p.anomalies.map(a => ({ ...a, protocolId: p.id }))
          )}
        />
      </section>
    </div>
  );
}
```

#### Step 3.5: ProtocolCard 컴포넌트

```typescript
// src/components/dashboard/ProtocolCard.tsx

import Link from 'next/link';

interface ProtocolCardProps {
  id: string;
  metrics: any;
  health: any;
  anomalyCount: number;
}

const healthColors = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  unhealthy: 'bg-red-500',
  unknown: 'bg-gray-500',
};

const protocolIcons: Record<string, string> = {
  'l2-rollup': '🔷',
  'l1-node': '⛓️',
  'validator': '✅',
  'indexer': '📊',
  'custom': '🔧',
};

export function ProtocolCard({ id, metrics, health, anomalyCount }: ProtocolCardProps) {
  const healthColor = healthColors[health?.status || 'unknown'];
  
  return (
    <Link href={`/dashboard/${id}`}>
      <div className="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{protocolIcons[metrics?.type] || '🔧'}</span>
            <h3 className="font-semibold text-lg">{id}</h3>
          </div>
          <div className={`w-3 h-3 rounded-full ${healthColor}`}></div>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Block Height</span>
            <span>{metrics?.blockHeight?.toLocaleString() || 'N/A'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Sync Status</span>
            <span>{metrics?.syncStatus?.toFixed(1) || 0}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Health Score</span>
            <span>{health?.score || 0}/100</span>
          </div>
          {anomalyCount > 0 && (
            <div className="flex justify-between text-yellow-400">
              <span>Active Anomalies</span>
              <span>{anomalyCount}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
```

---

## 6. 환경 변수

```env
# .env.local에 추가

# Protocol Configuration File Path (JSON)
PROTOCOLS_CONFIG_PATH=./config/protocols.json

# Default L2 (Optimism) - 기존 호환성 유지
L2_RPC_URL=https://mainnet.optimism.io
L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# Ethereum Node (선택적)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key

# Bitcoin Node (선택적)
BITCOIN_RPC_URL=http://localhost:8332
BITCOIN_RPC_USER=user
BITCOIN_RPC_PASSWORD=password

# Solana (선택적)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

---

## 7. 설정 파일 예시

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
      },
      "anomalyRules": [
        {
          "id": "high-cpu",
          "name": "High CPU Usage",
          "condition": "cpuUsage > 80",
          "severity": "warning",
          "message": "CPU usage is above 80%"
        },
        {
          "id": "txpool-congestion",
          "name": "TxPool Congestion",
          "condition": "customMetrics.txPoolPending > 1000",
          "severity": "warning",
          "message": "TxPool has high pending transaction count"
        }
      ]
    },
    {
      "id": "ethereum-mainnet",
      "name": "Ethereum Mainnet",
      "type": "l1-node",
      "enabled": true,
      "rpcUrl": "${ETHEREUM_RPC_URL}",
      "anomalyRules": [
        {
          "id": "low-peers",
          "name": "Low Peer Count",
          "condition": "customMetrics.peerCount < 5",
          "severity": "warning",
          "message": "Connected to less than 5 peers"
        }
      ]
    },
    {
      "id": "bitcoin-mainnet",
      "name": "Bitcoin Mainnet",
      "type": "l1-node",
      "enabled": false,
      "rpcUrl": "${BITCOIN_RPC_URL}",
      "credentials": {
        "type": "basic",
        "username": "${BITCOIN_RPC_USER}",
        "password": "${BITCOIN_RPC_PASSWORD}"
      }
    }
  ]
}
```

---

## 8. 테스트 계획

### 8.1 단위 테스트

```typescript
// __tests__/adapters/ethereum.test.ts

import { EthereumAdapter } from '@/adapters/ethereum';

describe('EthereumAdapter', () => {
  let adapter: EthereumAdapter;
  
  beforeEach(async () => {
    adapter = new EthereumAdapter('eth-test', 'Ethereum Test');
    await adapter.initialize({
      id: 'eth-test',
      name: 'Ethereum Test',
      type: 'l1-node',
      enabled: true,
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
    });
  });
  
  afterEach(async () => {
    await adapter.dispose();
  });
  
  it('should fetch metrics', async () => {
    const metrics = await adapter.getMetrics();
    
    expect(metrics.blockHeight).toBeGreaterThan(0);
    expect(metrics.syncStatus).toBeGreaterThanOrEqual(0);
    expect(metrics.syncStatus).toBeLessThanOrEqual(100);
  });
  
  it('should perform health check', async () => {
    const health = await adapter.getHealth();
    
    expect(health.status).toBeDefined();
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.checks).toBeInstanceOf(Array);
  });
});
```

### 8.2 통합 테스트

```typescript
// __tests__/api/protocols.test.ts

import { GET } from '@/app/api/protocols/route';
import { NextRequest } from 'next/server';

describe('Protocols API', () => {
  it('should return list of protocols', async () => {
    const req = new NextRequest('http://localhost/api/protocols');
    const res = await GET(req);
    const data = await res.json();
    
    expect(data.protocols).toBeInstanceOf(Array);
  });
});
```

### 8.3 수동 테스트 체크리스트

- [ ] Optimism Adapter 정상 동작 (기존 기능 유지)
- [ ] Ethereum Adapter 메트릭 조회
- [ ] Bitcoin Adapter 메트릭 조회 (설정된 경우)
- [ ] 멀티 프로토콜 Dashboard 렌더링
- [ ] 프로토콜별 상세 페이지 동작
- [ ] 통합 이상 탐지 패널 동작
- [ ] 새 프로토콜 동적 추가 (설정 파일 수정)

---

## 9. 마이그레이션 가이드

### 기존 코드 → Adapter 시스템

1. **기존 `/api/metrics` 유지**
   - 기존 API는 `optimism-mainnet` Adapter로 리다이렉트
   - 하위 호환성 보장

2. **점진적 마이그레이션**
   - Phase 1: Adapter 인터페이스 + Optimism 리팩토링
   - Phase 2: 새 프로토콜 추가 (기존 코드 영향 없음)
   - Phase 3: 새 Dashboard UI (기존 페이지 유지)

3. **설정 파일 추가**
   - `config/protocols.json` 생성
   - 환경 변수 참조 지원 (`${VAR_NAME}`)

---

## 10. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|----------|
| 지원 프로토콜 수 | ≥ 3 | Adapter 개수 |
| API 응답 시간 | < 500ms | p95 latency |
| 코드 재사용률 | > 70% | 공통 코드 비율 |
| 테스트 커버리지 | > 80% | Jest coverage |

---

## 11. 배포 체크리스트

- [ ] Adapter Interface 타입 정의 완료
- [ ] BaseAdapter 구현 완료
- [ ] OptimismAdapter 리팩토링 완료
- [ ] EthereumAdapter 구현 완료
- [ ] Protocol Registry 구현 완료
- [ ] API 엔드포인트 구현 완료
- [ ] Dashboard UI 구현 완료
- [ ] 설정 파일 템플릿 작성
- [ ] 테스트 통과
- [ ] 기존 기능 회귀 테스트
- [ ] Cloud Run 재배포
