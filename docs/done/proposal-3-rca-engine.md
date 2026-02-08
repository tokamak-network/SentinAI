# Proposal 3: Root Cause Analysis Engine - 구현 명세서

> **문서 버전**: 1.0.0
> **작성일**: 2026-02-06
> **대상 독자**: Claude Opus 4.6 구현 에이전트
> **선행 조건**: Proposal 1 (MetricsStore), Proposal 2 (AnomalyDetector) 구현 완료

---

## 목차

1. [개요](#1-개요)
2. [타입 정의](#2-타입-정의)
3. [신규 파일 명세](#3-신규-파일-명세)
4. [기존 파일 수정](#4-기존-파일-수정)
5. [API 명세](#5-api-명세)
6. [AI 프롬프트 전문](#6-ai-프롬프트-전문)
7. [환경 변수](#7-환경-변수)
8. [테스트 검증](#8-테스트-검증)
9. [의존관계](#9-의존관계)
10. [UI 상세 - Causal Chain Diagram](#10-ui-상세---causal-chain-diagram)

---

## 1. 개요

### 1.1 배경

현재 SentinAI의 `ai-analyzer.ts`는 로그를 분석하여 `summary`와 `action_item`을 반환한다. 이 방식은 "무엇이 잘못됐는지"는 알려주지만, "왜 잘못됐는지"와 "어떤 순서로 문제가 전파됐는지"는 제공하지 않는다.

### 1.2 목표

**Root Cause Analysis (RCA) Engine**은 다음 기능을 제공한다:

1. **이벤트 타임라인 구성**: 로그와 메트릭 이상치를 시간순으로 정렬
2. **컴포넌트 의존관계 매핑**: Optimism Rollup 컴포넌트 간 의존성 그래프 활용
3. **AI 기반 인과 추론**: Claude를 활용하여 근본 원인을 식별하고 전파 경로를 추적
4. **조치 권고 제공**: 즉시 조치 사항과 재발 방지 대책 제안

### 1.3 트리거 방식

RCA는 두 가지 방식으로 트리거된다:

1. **수동 트리거**: UI의 "ROOT CAUSE ANALYSIS" 버튼 클릭
2. **자동 트리거**: Proposal 2의 심층 분석에서 `severity === 'critical'` 감지 시 (선택적)

### 1.4 의존 모듈

| 모듈 | 용도 | 출처 |
|------|------|------|
| `MetricsStore` | 최근 메트릭 히스토리 조회 | Proposal 1 (`src/lib/metrics-store.ts`) |
| `AnomalyDetector` | 통계 기반 이상치 탐지 | Proposal 2 (`src/lib/anomaly-detector.ts`) |
| `LogIngester` | 컴포넌트별 로그 수집 | 기존 (`src/lib/log-ingester.ts`) |
| `AnomalyResult` | 이상 탐지 결과 타입 | Proposal 2 (`src/types/anomaly.ts`) |

### 1.5 아키텍처 다이어그램

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           RCA Engine Flow                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Trigger: Manual Button / Auto from Anomaly]                            │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Data Collection Phase                         │    │
│  │                                                                  │    │
│  │   MetricsStore.getRecent(5)  ──┐                                │    │
│  │                                 │                                │    │
│  │   AnomalyDetector.detect()  ───┼──▶  Raw Data                   │    │
│  │                                 │                                │    │
│  │   LogIngester.getAllLiveLogs()─┘                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Timeline Builder                              │    │
│  │                                                                  │    │
│  │   • Parse logs for ERROR/WARN entries with timestamps           │    │
│  │   • Convert anomalies to RCAEvent format                        │    │
│  │   • Sort all events chronologically                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    AI Causal Inference                           │    │
│  │                                                                  │    │
│  │   DEPENDENCY_GRAPH + Timeline + Logs ──▶ Claude API             │    │
│  │                                                                  │    │
│  │   ◀── { rootCause, causalChain, remediation }                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                               │
│                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    RCAResult                                     │    │
│  │                                                                  │    │
│  │   • Root cause component & description                          │    │
│  │   • Causal chain (event sequence)                               │    │
│  │   • Affected components list                                    │    │
│  │   • Remediation steps (immediate + preventive)                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 타입 정의

### 2.1 신규 파일: `src/types/rca.ts`

```typescript
/**
 * Root Cause Analysis Types
 * Optimism Rollup 장애 분석을 위한 타입 정의
 */

import type { AISeverity } from './scaling';

/**
 * Optimism Rollup 컴포넌트 식별자
 * - op-geth: Execution Client (L2 블록 실행)
 * - op-node: Consensus Client / Derivation Driver (L1에서 L2 상태 파생)
 * - op-batcher: Transaction Batch Submitter (L2 트랜잭션을 L1에 제출)
 * - op-proposer: State Root Proposer (L2 상태 루트를 L1에 제출)
 * - l1: L1 Ethereum (외부 의존성)
 * - system: 시스템 레벨 이벤트 (K8s, 네트워크 등)
 */
export type RCAComponent =
  | 'op-geth'
  | 'op-node'
  | 'op-batcher'
  | 'op-proposer'
  | 'l1'
  | 'system';

/**
 * RCA 이벤트 유형
 * - error: 에러 로그 또는 치명적 실패
 * - warning: 경고 로그 또는 주의 필요 상태
 * - metric_anomaly: 메트릭 이상치 (Z-Score 기반)
 * - state_change: 상태 변화 (스케일링, 재시작 등)
 */
export type RCAEventType = 'error' | 'warning' | 'metric_anomaly' | 'state_change';

/**
 * RCA 이벤트
 * 타임라인을 구성하는 개별 이벤트
 */
export interface RCAEvent {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

  /** 이벤트 발생 컴포넌트 */
  component: RCAComponent;

  /** 이벤트 유형 */
  type: RCAEventType;

  /** 이벤트 설명 (사람이 읽을 수 있는 형태) */
  description: string;

  /** 원본 로그 라인 (있는 경우) */
  rawLog?: string;

  /** 이벤트 심각도 (있는 경우) */
  severity?: AISeverity;
}

/**
 * 컴포넌트 의존관계
 * Optimism Rollup 아키텍처 기반 정의
 */
export interface ComponentDependency {
  /** 이 컴포넌트가 의존하는 컴포넌트 목록 (upstream) */
  dependsOn: RCAComponent[];

  /** 이 컴포넌트에 의존하는 컴포넌트 목록 (downstream) */
  feeds: RCAComponent[];
}

/**
 * 근본 원인 정보
 */
export interface RootCauseInfo {
  /** 근본 원인 컴포넌트 */
  component: RCAComponent;

  /** 근본 원인 설명 */
  description: string;

  /** 분석 신뢰도 (0-1) */
  confidence: number;
}

/**
 * 조치 권고
 */
export interface RemediationAdvice {
  /** 즉시 조치 사항 */
  immediate: string[];

  /** 재발 방지 대책 */
  preventive: string[];
}

/**
 * RCA 분석 결과
 */
export interface RCAResult {
  /** 고유 식별자 (UUID) */
  id: string;

  /** 근본 원인 정보 */
  rootCause: RootCauseInfo;

  /** 인과 체인 (근본 원인 → 최종 증상 순서) */
  causalChain: RCAEvent[];

  /** 영향 받은 컴포넌트 목록 */
  affectedComponents: RCAComponent[];

  /** 전체 이벤트 타임라인 (시간순) */
  timeline: RCAEvent[];

  /** 조치 권고 */
  remediation: RemediationAdvice;

  /** 분석 완료 시각 (ISO 8601) */
  generatedAt: string;
}

/**
 * RCA 히스토리 엔트리
 */
export interface RCAHistoryEntry {
  /** RCAResult의 id와 동일 */
  id: string;

  /** RCA 분석 결과 */
  result: RCAResult;

  /** 트리거 방식 */
  triggeredBy: 'manual' | 'auto';

  /** 트리거 시각 (ISO 8601) */
  triggeredAt: string;
}

/**
 * RCA API 요청 본문
 */
export interface RCARequest {
  /** 자동 트리거 여부 (Proposal 2 연동 시 사용) */
  autoTriggered?: boolean;
}

/**
 * RCA API 응답
 */
export interface RCAResponse {
  /** 성공 여부 */
  success: boolean;

  /** RCA 결과 (성공 시) */
  result?: RCAResult;

  /** 에러 메시지 (실패 시) */
  error?: string;

  /** 상세 에러 (디버깅용) */
  message?: string;
}

/**
 * RCA 히스토리 API 응답
 */
export interface RCAHistoryResponse {
  /** RCA 히스토리 목록 */
  history: RCAHistoryEntry[];

  /** 전체 히스토리 수 */
  total: number;
}
```

---

## 3. 신규 파일 명세

### 3.1 `src/lib/rca-engine.ts`

RCA의 핵심 로직을 담당하는 모듈이다.

```typescript
/**
 * Root Cause Analysis Engine
 * Optimism Rollup 장애의 근본 원인을 분석하고 인과 체인을 추적
 */

import type { AnomalyResult } from '@/types/anomaly';
import type { MetricDataPoint } from '@/types/metrics';
import type {
  RCAEvent,
  RCAResult,
  RCAHistoryEntry,
  RCAComponent,
  ComponentDependency,
  RootCauseInfo,
  RemediationAdvice,
} from '@/types/rca';
import type { AISeverity } from '@/types/scaling';

// ============================================================================
// Constants
// ============================================================================

/**
 * AI Gateway 설정
 */
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * Optimism Rollup 컴포넌트 의존관계 그래프
 *
 * 데이터 흐름:
 * - L1 → op-node: L1 블록 데이터를 읽어 L2 상태 파생
 * - op-node → op-geth: 파생된 블록을 실행 클라이언트에 전달
 * - op-node → op-batcher: 배치 제출 트리거
 * - op-node → op-proposer: 상태 루트 제출 트리거
 * - op-batcher → L1: 트랜잭션 배치를 L1에 제출
 * - op-proposer → L1: 상태 루트를 L1에 제출
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
  'op-batcher': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-proposer': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'l1': {
    dependsOn: [],
    feeds: ['op-node', 'op-batcher', 'op-proposer'],
  },
  'system': {
    dependsOn: [],
    feeds: ['op-geth', 'op-node', 'op-batcher', 'op-proposer'],
  },
};

/**
 * 로그 레벨과 RCAEventType 매핑
 */
const LOG_LEVEL_MAP: Record<string, 'error' | 'warning'> = {
  'ERROR': 'error',
  'ERR': 'error',
  'FATAL': 'error',
  'WARN': 'warning',
  'WARNING': 'warning',
};

/**
 * 컴포넌트 이름 정규화 맵
 */
const COMPONENT_NAME_MAP: Record<string, RCAComponent> = {
  'op-geth': 'op-geth',
  'geth': 'op-geth',
  'op-node': 'op-node',
  'node': 'op-node',
  'op-batcher': 'op-batcher',
  'batcher': 'op-batcher',
  'op-proposer': 'op-proposer',
  'proposer': 'op-proposer',
};

/**
 * RCA 히스토리 최대 보관 수
 */
const MAX_HISTORY_SIZE = 20;

// ============================================================================
// In-Memory State
// ============================================================================

/**
 * RCA 히스토리 저장소 (in-memory)
 * 실제 운영 환경에서는 Redis 또는 DB 사용 권장
 */
let rcaHistory: RCAHistoryEntry[] = [];

// ============================================================================
// Timeline Builder Functions
// ============================================================================

/**
 * 로그 라인에서 타임스탬프 추출
 * 지원 포맷:
 * - ISO 8601: 2026-02-06T12:34:56.789Z
 * - Geth 스타일: [02-06|12:34:56.789]
 * - 일반: 2026-02-06 12:34:56
 *
 * @param logLine - 로그 라인
 * @returns Unix timestamp (ms) 또는 null
 */
function extractTimestamp(logLine: string): number | null {
  // ISO 8601 포맷
  const isoMatch = logLine.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/);
  if (isoMatch) {
    const date = new Date(isoMatch[1]);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  // Geth 스타일 [MM-DD|HH:mm:ss.mmm]
  const gethMatch = logLine.match(/\[(\d{2})-(\d{2})\|(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]/);
  if (gethMatch) {
    const now = new Date();
    const [, month, day, hour, minute, second, ms] = gethMatch;
    const date = new Date(
      now.getFullYear(),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10),
      ms ? parseInt(ms, 10) : 0
    );
    return date.getTime();
  }

  // 일반 포맷 YYYY-MM-DD HH:mm:ss
  const generalMatch = logLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (generalMatch) {
    const date = new Date(`${generalMatch[1]}T${generalMatch[2]}Z`);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return null;
}

/**
 * 로그 라인에서 로그 레벨 추출
 *
 * @param logLine - 로그 라인
 * @returns 로그 레벨 또는 null
 */
function extractLogLevel(logLine: string): 'error' | 'warning' | null {
  const upperLine = logLine.toUpperCase();

  for (const [levelStr, eventType] of Object.entries(LOG_LEVEL_MAP)) {
    // 단어 경계로 매칭하여 오탐 방지
    const regex = new RegExp(`\\b${levelStr}\\b`);
    if (regex.test(upperLine)) {
      return eventType;
    }
  }

  return null;
}

/**
 * 컴포넌트 이름 정규화
 *
 * @param name - 원본 컴포넌트 이름
 * @returns 정규화된 RCAComponent
 */
function normalizeComponentName(name: string): RCAComponent {
  const lowered = name.toLowerCase().trim();
  return COMPONENT_NAME_MAP[lowered] || 'system';
}

/**
 * 로그에서 RCAEvent 목록 파싱
 *
 * @param logs - 컴포넌트별 로그 (key: 컴포넌트 이름, value: 로그 텍스트)
 * @returns RCAEvent 배열
 */
function parseLogsToEvents(logs: Record<string, string>): RCAEvent[] {
  const events: RCAEvent[] = [];

  for (const [componentName, logText] of Object.entries(logs)) {
    const component = normalizeComponentName(componentName);
    const lines = logText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const level = extractLogLevel(line);

      // ERROR 또는 WARN 로그만 이벤트로 추출
      if (!level) continue;

      const timestamp = extractTimestamp(line) || Date.now();

      // 로그 메시지에서 의미 있는 부분 추출
      // 타임스탬프와 레벨을 제거한 나머지
      const description = line
        .replace(/\[\d{2}-\d{2}\|\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '')
        .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?/g, '')
        .replace(/\b(ERROR|ERR|FATAL|WARN|WARNING|INFO|DEBUG)\b/gi, '')
        .trim();

      events.push({
        timestamp,
        component,
        type: level,
        description: description || line,
        rawLog: line,
        severity: level === 'error' ? 'high' : 'medium',
      });
    }
  }

  return events;
}

/**
 * AnomalyResult를 RCAEvent로 변환
 *
 * @param anomalies - 이상 탐지 결과 배열
 * @returns RCAEvent 배열
 */
function anomaliesToEvents(anomalies: AnomalyResult[]): RCAEvent[] {
  return anomalies
    .filter(a => a.isAnomaly)
    .map(anomaly => {
      // 메트릭 이름에서 컴포넌트 추론
      let component: RCAComponent = 'system';
      if (anomaly.metric.includes('cpu') || anomaly.metric.includes('memory')) {
        component = 'op-geth'; // CPU/Memory는 주로 geth 관련
      } else if (anomaly.metric.includes('txPool') || anomaly.metric.includes('gas')) {
        component = 'op-geth';
      } else if (anomaly.metric.includes('block')) {
        component = 'op-node';
      }

      // 방향에 따른 심각도 결정
      let severity: AISeverity = 'medium';
      if (Math.abs(anomaly.zScore) > 3.5) {
        severity = 'critical';
      } else if (Math.abs(anomaly.zScore) > 2.5) {
        severity = 'high';
      }

      return {
        timestamp: Date.now(),
        component,
        type: 'metric_anomaly' as const,
        description: anomaly.description,
        severity,
      };
    });
}

/**
 * 이벤트 타임라인 구성
 *
 * @param anomalies - 이상 탐지 결과 배열
 * @param logs - 컴포넌트별 로그
 * @param minutes - 분석할 시간 범위 (분)
 * @returns 시간순 정렬된 RCAEvent 배열
 */
export function buildTimeline(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  minutes: number = 5
): RCAEvent[] {
  // 로그에서 이벤트 추출
  const logEvents = parseLogsToEvents(logs);

  // 이상치를 이벤트로 변환
  const anomalyEvents = anomaliesToEvents(anomalies);

  // 모든 이벤트 병합
  const allEvents = [...logEvents, ...anomalyEvents];

  // 시간 범위 필터링
  const cutoffTime = Date.now() - minutes * 60 * 1000;
  const filteredEvents = allEvents.filter(e => e.timestamp >= cutoffTime);

  // 시간순 정렬 (오래된 것 먼저)
  filteredEvents.sort((a, b) => a.timestamp - b.timestamp);

  return filteredEvents;
}

// ============================================================================
// Dependency Graph Functions
// ============================================================================

/**
 * 특정 컴포넌트로부터 영향받는 모든 downstream 컴포넌트 탐색
 *
 * @param rootComponent - 근본 원인 컴포넌트
 * @returns 영향받는 컴포넌트 목록
 */
export function findAffectedComponents(rootComponent: RCAComponent): RCAComponent[] {
  const affected = new Set<RCAComponent>();
  const queue: RCAComponent[] = [rootComponent];

  while (queue.length > 0) {
    const current = queue.shift()!;

    // 이미 처리된 컴포넌트는 스킵
    if (affected.has(current) && current !== rootComponent) {
      continue;
    }

    // downstream 컴포넌트 탐색
    const deps = DEPENDENCY_GRAPH[current];
    if (deps) {
      for (const downstream of deps.feeds) {
        if (!affected.has(downstream)) {
          affected.add(downstream);
          queue.push(downstream);
        }
      }
    }
  }

  return Array.from(affected);
}

/**
 * 특정 컴포넌트의 upstream 의존성 조회
 *
 * @param component - 대상 컴포넌트
 * @returns upstream 컴포넌트 목록
 */
export function findUpstreamComponents(component: RCAComponent): RCAComponent[] {
  const deps = DEPENDENCY_GRAPH[component];
  return deps ? deps.dependsOn : [];
}

// ============================================================================
// AI Integration
// ============================================================================

/**
 * RCA 시스템 프롬프트
 */
const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for an Optimism L2 Rollup incident.

== Optimism Rollup Component Architecture ==

1. **L1 (Ethereum Mainnet/Sepolia)**
   - External dependency providing L1 block data and finality
   - All L2 components ultimately depend on L1

2. **op-node (Consensus Client / Derivation Driver)**
   - Reads L1 blocks and derives L2 state
   - Feeds derived blocks to op-geth for execution
   - Triggers op-batcher for batch submissions
   - Triggers op-proposer for state root submissions
   - CRITICAL: If op-node fails, ALL downstream components are affected

3. **op-geth (Execution Client)**
   - Executes L2 blocks received from op-node
   - Manages transaction pool (txpool)
   - Depends solely on op-node

4. **op-batcher (Transaction Batch Submitter)**
   - Collects L2 transactions and submits batches to L1
   - Depends on op-node for block data and L1 for gas/submission
   - If batcher fails: txpool accumulates, but L2 continues producing blocks

5. **op-proposer (State Root Proposer)**
   - Submits L2 state roots to L1 for fraud proof window
   - Depends on op-node for state data and L1 for submission
   - If proposer fails: withdrawals delayed, but L2 continues operating

== Component Dependency Graph ==
\`\`\`
L1 ─────────────────────────────────────────┐
│                                            │
▼                                            ▼
op-node ────────────────────┬───────────────┬─▶ op-batcher ──▶ L1
│                           │               │
▼                           ▼               └─▶ op-proposer ──▶ L1
op-geth
\`\`\`

== Common Optimism Failure Patterns ==

1. **L1 Reorg / Gas Spike**
   - Symptom: op-batcher/op-proposer submission failures, txpool growth
   - Chain: L1 issue → batcher unable to post → txpool accumulation
   - Root Cause: Usually L1 (external)

2. **op-node Derivation Stall**
   - Symptom: L2 block production stops, all components show errors
   - Chain: L1 data unavailable → op-node stall → op-geth stall → cascading failures
   - Root Cause: Check L1 connection, op-node sync status

3. **op-geth Crash / OOM**
   - Symptom: CPU/Memory anomalies, connection refused errors in other components
   - Chain: op-geth crash → downstream components can't connect
   - Root Cause: Resource exhaustion, check pod restarts

4. **Batcher Backlog**
   - Symptom: txpool monotonically increasing, no batch submissions
   - Chain: Batcher failure → txs not posted to L1 → txpool grows
   - Root Cause: Check batcher logs, L1 gas prices

5. **Network Partition / P2P Issues**
   - Symptom: Peer disconnections, gossip failures, unsafe head divergence
   - Chain: Network issue → peers dropped → consensus problems
   - Root Cause: Check firewall, P2P port accessibility

== Your Task ==

Given the event timeline, anomalies, metrics, and logs below:

1. **Identify the ROOT CAUSE**: Find the earliest triggering event that started the incident
2. **Trace the CAUSAL CHAIN**: Follow the propagation from root cause to observed symptoms
3. **Consider Dependencies**: Upstream failures propagate downstream (L1 → op-node → op-geth/batcher/proposer)
4. **Provide REMEDIATION**:
   - Immediate: Steps to restore service NOW
   - Preventive: Measures to prevent recurrence

== Output Format ==

Respond ONLY with a valid JSON object (no markdown code blocks):
{
  "rootCause": {
    "component": "op-geth" | "op-node" | "op-batcher" | "op-proposer" | "l1" | "system",
    "description": "Clear explanation of what triggered the incident",
    "confidence": 0.0-1.0
  },
  "causalChain": [
    {
      "timestamp": <unix_ms>,
      "component": "<component>",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
      "description": "What happened at this step"
    }
  ],
  "affectedComponents": ["<component1>", "<component2>"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}`;

/**
 * RCA 사용자 프롬프트 생성
 */
function buildUserPrompt(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint[],
  logs: Record<string, string>
): string {
  // 타임라인 JSON
  const timelineJson = JSON.stringify(
    timeline.map(e => ({
      time: new Date(e.timestamp).toISOString(),
      component: e.component,
      type: e.type,
      description: e.description,
    })),
    null,
    2
  );

  // 이상치 요약
  const anomalySummary = anomalies
    .filter(a => a.isAnomaly)
    .map(a => `- ${a.metric}: ${a.value.toFixed(2)} (z-score: ${a.zScore.toFixed(2)}, ${a.direction})`)
    .join('\n');

  // 최근 메트릭 (마지막 5개)
  const recentMetrics = metrics.slice(-5).map(m => ({
    time: new Date(m.timestamp).toISOString(),
    cpu: m.cpuUsage.toFixed(1),
    txPool: m.txPoolPending,
    gasRatio: m.gasUsedRatio.toFixed(3),
  }));

  // 로그 요약 (각 컴포넌트 마지막 20줄)
  const logSummary = Object.entries(logs)
    .map(([comp, log]) => {
      const lines = log.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-20).join('\n');
      return `=== ${comp} (last 20 lines) ===\n${lastLines}`;
    })
    .join('\n\n');

  return `== Event Timeline (chronological) ==
${timelineJson}

== Detected Anomalies ==
${anomalySummary || 'No statistical anomalies detected'}

== Recent Metrics Snapshot ==
${JSON.stringify(recentMetrics, null, 2)}

== Component Logs ==
${logSummary}

Analyze the above data and identify the root cause of the incident.`;
}

/**
 * AI Gateway를 통한 RCA 분석 수행
 */
async function callAIForRCA(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint[],
  logs: Record<string, string>
): Promise<{
  rootCause: RootCauseInfo;
  causalChain: RCAEvent[];
  affectedComponents: RCAComponent[];
  remediation: RemediationAdvice;
}> {
  const userPrompt = buildUserPrompt(timeline, anomalies, metrics, logs);

  try {
    console.log(`[RCA Engine] Calling AI Gateway at ${AI_GATEWAY_URL}...`);

    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4.5',
        messages: [
          { role: 'system', content: RCA_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.output || '{}';

    // JSON 파싱 (markdown 코드 블록 제거)
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // 응답 구조 검증 및 변환
    return {
      rootCause: {
        component: parsed.rootCause?.component || 'system',
        description: parsed.rootCause?.description || 'Unable to determine root cause',
        confidence: parsed.rootCause?.confidence || 0.5,
      },
      causalChain: (parsed.causalChain || []).map((e: Record<string, unknown>) => ({
        timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
        component: (e.component as RCAComponent) || 'system',
        type: (e.type as RCAEvent['type']) || 'error',
        description: (e.description as string) || '',
      })),
      affectedComponents: parsed.affectedComponents || [],
      remediation: {
        immediate: parsed.remediation?.immediate || [],
        preventive: parsed.remediation?.preventive || [],
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RCA Engine] AI analysis failed:', errorMessage);

    // Fallback: 타임라인 기반 휴리스틱 분석
    return generateFallbackAnalysis(timeline, anomalies);
  }
}

/**
 * AI 호출 실패 시 폴백 분석
 */
function generateFallbackAnalysis(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[]
): {
  rootCause: RootCauseInfo;
  causalChain: RCAEvent[];
  affectedComponents: RCAComponent[];
  remediation: RemediationAdvice;
} {
  // 가장 오래된 에러 이벤트를 근본 원인으로 가정
  const errorEvents = timeline.filter(e => e.type === 'error');
  const firstError = errorEvents[0] || timeline[0];

  const rootCauseComponent = firstError?.component || 'system';
  const affectedComponents = findAffectedComponents(rootCauseComponent);

  return {
    rootCause: {
      component: rootCauseComponent,
      description: firstError?.description || 'Unable to determine root cause (AI unavailable)',
      confidence: 0.3, // 낮은 신뢰도
    },
    causalChain: errorEvents.slice(0, 5),
    affectedComponents,
    remediation: {
      immediate: [
        'Check component logs for detailed error messages',
        'Verify all pods are running: kubectl get pods -n <namespace>',
        'Check L1 connectivity and block sync status',
      ],
      preventive: [
        'Set up automated alerting for critical metrics',
        'Implement health check endpoints for all components',
        'Document incident response procedures',
      ],
    },
  };
}

// ============================================================================
// Main RCA Function
// ============================================================================

/**
 * UUID 생성 (crypto.randomUUID가 없는 환경용 폴백)
 */
function generateId(): string {
  return 'rca-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
 * RCA 수행
 *
 * @param anomalies - 이상 탐지 결과 (Proposal 2)
 * @param logs - 컴포넌트별 로그
 * @param metrics - 메트릭 데이터 포인트 (Proposal 1)
 * @returns RCAResult
 */
export async function performRCA(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  metrics: MetricDataPoint[]
): Promise<RCAResult> {
  const startTime = Date.now();
  console.log('[RCA Engine] Starting root cause analysis...');

  // 1. 이벤트 타임라인 구성
  const timeline = buildTimeline(anomalies, logs, 5);
  console.log(`[RCA Engine] Built timeline with ${timeline.length} events`);

  // 2. AI를 통한 인과 분석
  const aiResult = await callAIForRCA(timeline, anomalies, metrics, logs);

  // 3. 결과 구성
  const result: RCAResult = {
    id: generateId(),
    rootCause: aiResult.rootCause,
    causalChain: aiResult.causalChain,
    affectedComponents: aiResult.affectedComponents.length > 0
      ? aiResult.affectedComponents
      : findAffectedComponents(aiResult.rootCause.component),
    timeline,
    remediation: aiResult.remediation,
    generatedAt: new Date().toISOString(),
  };

  console.log(`[RCA Engine] Analysis complete in ${Date.now() - startTime}ms`);
  console.log(`[RCA Engine] Root cause: ${result.rootCause.component} (confidence: ${result.rootCause.confidence})`);

  return result;
}

// ============================================================================
// History Management
// ============================================================================

/**
 * RCA 히스토리에 엔트리 추가
 */
export function addRCAHistory(result: RCAResult, triggeredBy: 'manual' | 'auto'): void {
  const entry: RCAHistoryEntry = {
    id: result.id,
    result,
    triggeredBy,
    triggeredAt: new Date().toISOString(),
  };

  rcaHistory.unshift(entry);

  // 최대 보관 수 초과 시 오래된 항목 제거
  if (rcaHistory.length > MAX_HISTORY_SIZE) {
    rcaHistory = rcaHistory.slice(0, MAX_HISTORY_SIZE);
  }
}

/**
 * RCA 히스토리 조회
 *
 * @param limit - 반환할 최대 항목 수
 * @returns RCAHistoryEntry 배열
 */
export function getRCAHistory(limit: number = 10): RCAHistoryEntry[] {
  return rcaHistory.slice(0, Math.min(limit, MAX_HISTORY_SIZE));
}

/**
 * 특정 RCA 결과 조회
 *
 * @param id - RCA 결과 ID
 * @returns RCAHistoryEntry 또는 undefined
 */
export function getRCAById(id: string): RCAHistoryEntry | undefined {
  return rcaHistory.find(entry => entry.id === id);
}

/**
 * 히스토리 전체 수 조회
 */
export function getRCAHistoryCount(): number {
  return rcaHistory.length;
}
```

### 3.2 `src/app/api/rca/route.ts`

RCA API 엔드포인트 구현.

```typescript
/**
 * RCA API Endpoint
 * POST: Trigger RCA analysis
 * GET: Get RCA history
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  performRCA,
  addRCAHistory,
  getRCAHistory,
  getRCAHistoryCount,
} from '@/lib/rca-engine';
import { getRecent } from '@/lib/metrics-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import type { RCARequest, RCAResponse, RCAHistoryResponse } from '@/types/rca';
import type { MetricDataPoint } from '@/types/metrics';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';

/**
 * POST: Trigger RCA analysis
 *
 * Request body (optional):
 * {
 *   "autoTriggered": boolean  // true if triggered by anomaly detection
 * }
 *
 * Response:
 * {
 *   "success": boolean,
 *   "result": RCAResult,
 *   "error": string (if failed)
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse<RCAResponse>> {
  const startTime = Date.now();
  console.log('[API /rca] POST request received');

  try {
    // Parse request body
    let body: RCARequest = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is acceptable
    }

    const triggeredBy = body.autoTriggered ? 'auto' : 'manual';
    console.log(`[API /rca] Triggered by: ${triggeredBy}`);

    // 1. Collect recent metrics from MetricsStore (last 5 minutes)
    const metrics: MetricDataPoint[] = getRecent(5);
    console.log(`[API /rca] Collected ${metrics.length} metric data points`);

    // 2. Detect anomalies using the latest metrics
    let anomalies = [];
    if (metrics.length > 1) {
      const currentMetric = metrics[metrics.length - 1];
      const historyMetrics = metrics.slice(0, -1);
      anomalies = detectAnomalies(currentMetric, historyMetrics);
      console.log(`[API /rca] Detected ${anomalies.filter(a => a.isAnomaly).length} anomalies`);
    }

    // 3. Collect logs from all components
    let logs: Record<string, string>;
    try {
      logs = await getAllLiveLogs();
      console.log(`[API /rca] Collected logs from ${Object.keys(logs).length} components`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[API /rca] Failed to get live logs, using mock: ${errorMessage}`);
      // Fallback to mock logs if K8s is unavailable
      logs = generateMockLogs('normal');
    }

    // 4. Perform RCA analysis
    const result = await performRCA(anomalies, logs, metrics);

    // 5. Add to history
    addRCAHistory(result, triggeredBy);

    console.log(`[API /rca] Analysis complete in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /rca] Error:', errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: 'RCA analysis failed',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET: Get RCA history
 *
 * Query parameters:
 * - limit: number (default: 10, max: 20)
 *
 * Response:
 * {
 *   "history": RCAHistoryEntry[],
 *   "total": number
 * }
 */
export async function GET(request: NextRequest): Promise<NextResponse<RCAHistoryResponse>> {
  console.log('[API /rca] GET request received');

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 20) : 10;

    const history = getRCAHistory(limit);
    const total = getRCAHistoryCount();

    return NextResponse.json({
      history,
      total,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /rca] Error:', errorMessage);

    return NextResponse.json(
      {
        history: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}
```

---

## 4. 기존 파일 수정

### 4.1 `src/types/anomaly.ts` (Proposal 2에서 생성)

RCA 엔진이 의존하는 AnomalyResult 타입. Proposal 2 구현 시 이 파일이 생성되어야 한다.

```typescript
/**
 * Anomaly Detection Types
 * (Proposal 2에서 생성됨)
 */

/**
 * 이상 탐지 결과
 */
export interface AnomalyResult {
  /** 이상 여부 */
  isAnomaly: boolean;

  /** 메트릭 이름 */
  metric: string;

  /** 현재 값 */
  value: number;

  /** Z-Score (|z| > 2.5이면 이상) */
  zScore: number;

  /** 이상 방향 */
  direction: 'spike' | 'drop' | 'plateau';

  /** 설명 */
  description: string;
}
```

### 4.2 `src/types/metrics.ts` (Proposal 1에서 생성)

RCA 엔진이 의존하는 MetricDataPoint 타입. Proposal 1 구현 시 이 파일이 생성되어야 한다.

```typescript
/**
 * Metrics Store Types
 * (Proposal 1에서 생성됨)
 */

/**
 * 메트릭 데이터 포인트
 */
export interface MetricDataPoint {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

  /** CPU 사용률 (0-100) */
  cpuUsage: number;

  /** 트랜잭션 풀 대기 수 */
  txPoolPending: number;

  /** 가스 사용 비율 (0-1) */
  gasUsedRatio: number;

  /** L2 블록 높이 */
  l2BlockHeight: number;

  /** L2 블록 간 시간 간격 (초) */
  l2BlockInterval: number;
}
```

### 4.3 `src/lib/metrics-store.ts` (Proposal 1에서 생성)

RCA 엔진이 의존하는 MetricsStore의 `getRecent` 함수. Proposal 1 구현 시 이 파일이 생성되어야 한다.

```typescript
/**
 * Metrics Store
 * (Proposal 1에서 생성됨)
 *
 * 최소 필요 인터페이스:
 */

import type { MetricDataPoint } from '@/types/metrics';

/**
 * 최근 N분 동안의 메트릭 조회
 *
 * @param minutes - 조회할 시간 범위 (분)
 * @returns MetricDataPoint 배열
 */
export function getRecent(minutes: number): MetricDataPoint[];
```

### 4.4 `src/lib/anomaly-detector.ts` (Proposal 2에서 생성)

RCA 엔진이 의존하는 AnomalyDetector의 `detectAnomalies` 함수. Proposal 2 구현 시 이 파일이 생성되어야 한다.

```typescript
/**
 * Anomaly Detector
 * (Proposal 2에서 생성됨)
 *
 * 최소 필요 인터페이스:
 */

import type { MetricDataPoint } from '@/types/metrics';
import type { AnomalyResult } from '@/types/anomaly';

/**
 * 현재 메트릭에서 이상 탐지
 *
 * @param current - 현재 메트릭 데이터
 * @param history - 과거 메트릭 데이터 (최근 30분)
 * @returns AnomalyResult 배열
 */
export function detectAnomalies(
  current: MetricDataPoint,
  history: MetricDataPoint[]
): AnomalyResult[];
```

### 4.5 `src/app/page.tsx` 수정

기존 UI에 RCA 기능을 추가한다.

#### 4.5.1 상태 추가 (state 선언부)

**기존 코드** (라인 62-63 근처):

```typescript
const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
const [isAnalyzing, setIsAnalyzing] = useState(false);
```

**수정 후**:

```typescript
const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
const [isAnalyzing, setIsAnalyzing] = useState(false);

// RCA State
const [rcaResult, setRcaResult] = useState<RCAResult | null>(null);
const [isRunningRCA, setIsRunningRCA] = useState(false);
const [rcaError, setRcaError] = useState<string | null>(null);
```

#### 4.5.2 Import 추가 (파일 상단)

**기존 코드** (라인 9-11 근처):

```typescript
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield
} from 'lucide-react';
```

**수정 후**:

```typescript
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield,
  GitBranch, AlertTriangle, ChevronDown, ChevronRight
} from 'lucide-react';
import type { RCAResult, RCAEvent, RCAComponent } from '@/types/rca';
```

#### 4.5.3 RCA 함수 추가 (checkLogs 함수 뒤)

**기존 코드** (라인 79 근처):

```typescript
  } finally {
    setIsAnalyzing(false);
  }
};

// Track current stressMode for async operations
```

**수정 후**:

```typescript
  } finally {
    setIsAnalyzing(false);
  }
};

// RCA Logic
const runRCA = async () => {
  setRcaResult(null);
  setRcaError(null);
  setIsRunningRCA(true);
  try {
    const res = await fetch('/api/rca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoTriggered: false }),
    });
    const data = await res.json();
    if (data.success && data.result) {
      setRcaResult(data.result);
    } else {
      setRcaError(data.error || 'RCA analysis failed');
    }
  } catch (e) {
    console.error(e);
    setRcaError('Failed to connect to RCA API');
  } finally {
    setIsRunningRCA(false);
  }
};

// Track current stressMode for async operations
```

#### 4.5.4 RCA 버튼 추가 (Controls 섹션)

**기존 코드** (라인 401-416 근처, CHECK HEALTH 버튼):

```typescript
<button
  onClick={() => checkLogs('live')}
  disabled={isAnalyzing}
  className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 mb-4 group ${isAnalyzing
    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40'
    }`}
>
  {isAnalyzing ? (
    <Activity className="animate-spin" size={18} />
  ) : (
    <Activity className="group-hover:animate-spin" size={18} />
  )}
  {isAnalyzing ? 'ANALYZING...' : 'CHECK HEALTH'}
</button>
```

**수정 후**:

```typescript
<button
  onClick={() => checkLogs('live')}
  disabled={isAnalyzing || isRunningRCA}
  className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 mb-4 group ${isAnalyzing
    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40'
    }`}
>
  {isAnalyzing ? (
    <Activity className="animate-spin" size={18} />
  ) : (
    <Activity className="group-hover:animate-spin" size={18} />
  )}
  {isAnalyzing ? 'ANALYZING...' : 'CHECK HEALTH'}
</button>

{/* RCA Button */}
<button
  onClick={runRCA}
  disabled={isRunningRCA || isAnalyzing}
  className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all flex items-center justify-center gap-3 group ${isRunningRCA
    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
    : 'bg-orange-600 hover:bg-orange-500 text-white shadow-orange-900/40'
    }`}
>
  {isRunningRCA ? (
    <GitBranch className="animate-spin" size={18} />
  ) : (
    <GitBranch className="group-hover:rotate-12 transition-transform" size={18} />
  )}
  {isRunningRCA ? 'ANALYZING...' : 'ROOT CAUSE ANALYSIS'}
</button>
```

#### 4.5.5 RCA 결과 표시 영역 추가 (Log Stream 영역 내부)

**기존 코드** (라인 370-393 근처, AI Result Injection 부분):

```typescript
{/* AI Result Injection */}
{logInsight && !isAnalyzing && (
  <div className="my-6 p-4 rounded-lg bg-gray-800/50 border-l-4 border-blue-500 animate-slideIn">
    {/* ... existing AI result display ... */}
  </div>
)}
```

**수정 후** (AI Result 다음에 RCA Result 추가):

```typescript
{/* AI Result Injection */}
{logInsight && !isAnalyzing && (
  <div className="my-6 p-4 rounded-lg bg-gray-800/50 border-l-4 border-blue-500 animate-slideIn">
    {/* ... existing AI result display ... */}
  </div>
)}

{/* RCA Result Display */}
{rcaResult && !isRunningRCA && (
  <RCAResultDisplay result={rcaResult} />
)}

{/* RCA Error Display */}
{rcaError && !isRunningRCA && (
  <div className="my-6 p-4 rounded-lg bg-red-900/30 border-l-4 border-red-500">
    <div className="flex items-center gap-2 mb-2">
      <XCircle size={16} className="text-red-400" />
      <span className="text-red-400 font-bold text-xs uppercase">RCA Failed</span>
    </div>
    <p className="text-gray-300 text-sm">{rcaError}</p>
  </div>
)}

{/* RCA Loading State */}
{isRunningRCA && (
  <div className="flex flex-col items-center justify-center py-10 animate-pulse">
    <div className="w-full max-w-xs bg-gray-800 rounded-full h-1.5 mb-4 overflow-hidden">
      <div className="bg-orange-500 h-1.5 rounded-full animate-loading-bar"></div>
    </div>
    <p className="text-orange-400 font-mono text-xs animate-pulse">Performing Root Cause Analysis...</p>
  </div>
)}
```

#### 4.5.6 RCA 결과 컴포넌트 추가 (파일 최하단, LogBlock 다음)

```typescript
// --- Sub Components ---

function LogBlock({ time, source, level, msg, highlight, color }: { time: string; source: string; level: string; msg: string; highlight?: boolean; color?: string }) {
  // ... existing code ...
}

// RCA Result Display Component
function RCAResultDisplay({ result }: { result: RCAResult }) {
  const [expandedChain, setExpandedChain] = useState(true);

  // Component color mapping
  const componentColors: Record<RCAComponent, string> = {
    'op-geth': 'bg-blue-500',
    'op-node': 'bg-green-500',
    'op-batcher': 'bg-yellow-500',
    'op-proposer': 'bg-purple-500',
    'l1': 'bg-red-500',
    'system': 'bg-gray-500',
  };

  // Event type icons
  const getEventIcon = (type: RCAEvent['type']) => {
    switch (type) {
      case 'error':
        return <XCircle size={12} className="text-red-400" />;
      case 'warning':
        return <AlertTriangle size={12} className="text-yellow-400" />;
      case 'metric_anomaly':
        return <Activity size={12} className="text-orange-400" />;
      case 'state_change':
        return <GitBranch size={12} className="text-blue-400" />;
      default:
        return <Activity size={12} className="text-gray-400" />;
    }
  };

  return (
    <div className="my-6 space-y-4 animate-slideIn">
      {/* Header */}
      <div className="p-4 rounded-lg bg-orange-900/30 border-l-4 border-orange-500">
        <div className="flex items-center justify-between mb-2">
          <span className="text-orange-400 font-bold text-xs uppercase flex items-center gap-2">
            <GitBranch size={14} />
            Root Cause Analysis Report
          </span>
          <span className="text-gray-500 text-[10px]">
            {new Date(result.generatedAt).toLocaleTimeString()}
          </span>
        </div>

        {/* Root Cause */}
        <div className="mt-3 p-3 bg-red-900/40 rounded-lg border border-red-500/50">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${componentColors[result.rootCause.component]} animate-pulse`}></div>
            <span className="text-red-400 font-bold text-sm uppercase">{result.rootCause.component}</span>
            <span className="text-gray-500 text-[10px] ml-auto">
              Confidence: {(result.rootCause.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-gray-200 text-sm leading-relaxed">
            {result.rootCause.description}
          </p>
        </div>
      </div>

      {/* Causal Chain */}
      <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <button
          onClick={() => setExpandedChain(!expandedChain)}
          className="w-full flex items-center justify-between text-gray-400 font-bold text-xs uppercase mb-3 hover:text-gray-200 transition-colors"
        >
          <span className="flex items-center gap-2">
            <GitBranch size={14} />
            Causal Chain ({result.causalChain.length} events)
          </span>
          {expandedChain ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {expandedChain && (
          <div className="relative pl-4 border-l-2 border-gray-600 space-y-3">
            {result.causalChain.map((event, index) => (
              <div
                key={index}
                className={`relative pl-4 ${index === 0 ? 'opacity-100' : 'opacity-80'}`}
              >
                {/* Timeline dot */}
                <div
                  className={`absolute -left-[calc(0.5rem+1px)] top-1 w-3 h-3 rounded-full border-2 border-gray-800 ${
                    index === 0 ? 'bg-red-500 ring-2 ring-red-500/30' : componentColors[event.component]
                  }`}
                ></div>

                <div className="flex items-start gap-2">
                  {/* Component Badge */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase text-white ${componentColors[event.component]}`}
                  >
                    {event.component}
                  </span>

                  {/* Event Icon */}
                  {getEventIcon(event.type)}

                  {/* Timestamp */}
                  <span className="text-gray-500 text-[10px] shrink-0">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <p className="text-gray-300 text-xs mt-1 leading-relaxed">
                  {event.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Affected Components */}
      {result.affectedComponents.length > 0 && (
        <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <span className="text-gray-400 font-bold text-xs uppercase mb-3 block">
            Affected Components
          </span>
          <div className="flex flex-wrap gap-2">
            {result.affectedComponents.map((comp) => (
              <span
                key={comp}
                className={`px-3 py-1 rounded-full text-xs font-bold text-white ${componentColors[comp]}`}
              >
                {comp}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Remediation */}
      <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <span className="text-gray-400 font-bold text-xs uppercase mb-3 block flex items-center gap-2">
          <CheckCircle2 size={14} className="text-green-400" />
          Remediation Steps
        </span>

        {/* Immediate Actions */}
        {result.remediation.immediate.length > 0 && (
          <div className="mb-4">
            <span className="text-red-400 font-bold text-[10px] uppercase block mb-2">
              Immediate Actions
            </span>
            <ul className="space-y-1">
              {result.remediation.immediate.map((step, i) => (
                <li key={i} className="text-gray-300 text-xs flex items-start gap-2">
                  <span className="text-red-400 shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Preventive Measures */}
        {result.remediation.preventive.length > 0 && (
          <div>
            <span className="text-blue-400 font-bold text-[10px] uppercase block mb-2">
              Preventive Measures
            </span>
            <ul className="space-y-1">
              {result.remediation.preventive.map((step, i) => (
                <li key={i} className="text-gray-300 text-xs flex items-start gap-2">
                  <span className="text-blue-400 shrink-0">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
```

#### 4.5.7 RCAResultDisplay 컴포넌트에 useState import 추가

**주의**: `RCAResultDisplay`가 `useState`를 사용하므로, 파일 상단의 import를 확인하여 `useState`가 이미 포함되어 있는지 확인한다. 이미 포함되어 있다면 추가 수정 불필요.

```typescript
import { useEffect, useState, useRef } from 'react';
```

### 4.6 `src/lib/anomaly-ai-analyzer.ts` (Proposal 2) - 선택적 자동 트리거

Proposal 2의 심층 분석에서 `critical` 심각도 발견 시 자동으로 RCA를 트리거하는 기능. **선택적 구현**이며 필수 아님.

```typescript
// anomaly-ai-analyzer.ts 내부 (Proposal 2)
// performDeepAnalysis 함수 끝부분에 추가

import { performRCA, addRCAHistory } from '@/lib/rca-engine';

// ... existing code ...

// Deep analysis 결과가 critical인 경우 자동 RCA 트리거
if (deepAnalysisResult.severity === 'critical') {
  console.log('[Anomaly AI] Critical severity detected, triggering auto-RCA...');

  try {
    const rcaResult = await performRCA(anomalies, logs, metrics);
    addRCAHistory(rcaResult, 'auto');
    console.log(`[Anomaly AI] Auto-RCA complete: ${rcaResult.rootCause.component}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Anomaly AI] Auto-RCA failed:', msg);
  }
}
```

---

## 5. API 명세

### 5.1 POST `/api/rca` - RCA 분석 트리거

#### 요청

```http
POST /api/rca HTTP/1.1
Content-Type: application/json

{
  "autoTriggered": false
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `autoTriggered` | `boolean` | 아니오 | 자동 트리거 여부 (기본값: `false`) |

#### 응답 (성공)

```json
{
  "success": true,
  "result": {
    "id": "rca-m5k2x9a-7h3j1f",
    "rootCause": {
      "component": "op-batcher",
      "description": "Batcher unable to submit transactions to L1 due to gas price spike. L1 base fee exceeded configured maximum, causing submission failures.",
      "confidence": 0.85
    },
    "causalChain": [
      {
        "timestamp": 1738857600000,
        "component": "l1",
        "type": "state_change",
        "description": "L1 base fee increased from 25 to 150 gwei"
      },
      {
        "timestamp": 1738857660000,
        "component": "op-batcher",
        "type": "error",
        "description": "Failed to submit batch: max fee per gas too low"
      },
      {
        "timestamp": 1738857720000,
        "component": "op-geth",
        "type": "metric_anomaly",
        "description": "TxPool pending count spike: 2500 (z-score: 3.2)"
      }
    ],
    "affectedComponents": ["op-batcher", "op-geth"],
    "timeline": [
      {
        "timestamp": 1738857600000,
        "component": "l1",
        "type": "state_change",
        "description": "L1 base fee increased from 25 to 150 gwei"
      },
      {
        "timestamp": 1738857660000,
        "component": "op-batcher",
        "type": "error",
        "description": "Failed to submit batch: max fee per gas too low"
      },
      {
        "timestamp": 1738857720000,
        "component": "op-geth",
        "type": "metric_anomaly",
        "description": "TxPool pending count spike: 2500 (z-score: 3.2)"
      },
      {
        "timestamp": 1738857780000,
        "component": "op-geth",
        "type": "warning",
        "description": "TxPool nearing capacity limit"
      }
    ],
    "remediation": {
      "immediate": [
        "Increase batcher max gas price configuration",
        "Monitor L1 gas prices and wait for stabilization",
        "Check batcher wallet balance for sufficient ETH"
      ],
      "preventive": [
        "Implement dynamic gas pricing for batcher submissions",
        "Set up L1 gas price alerting thresholds",
        "Consider gas price oracle integration for better estimation"
      ]
    },
    "generatedAt": "2026-02-06T12:35:00.000Z"
  }
}
```

#### 응답 (실패)

```json
{
  "success": false,
  "error": "RCA analysis failed",
  "message": "AI Gateway timeout after 30000ms"
}
```

### 5.2 GET `/api/rca` - RCA 히스토리 조회

#### 요청

```http
GET /api/rca?limit=5 HTTP/1.1
```

| 쿼리 파라미터 | 타입 | 필수 | 설명 |
|---------------|------|------|------|
| `limit` | `number` | 아니오 | 반환할 최대 항목 수 (기본값: 10, 최대: 20) |

#### 응답

```json
{
  "history": [
    {
      "id": "rca-m5k2x9a-7h3j1f",
      "result": { /* RCAResult object */ },
      "triggeredBy": "manual",
      "triggeredAt": "2026-02-06T12:34:00.000Z"
    },
    {
      "id": "rca-k8n3p2b-9x1m5q",
      "result": { /* RCAResult object */ },
      "triggeredBy": "auto",
      "triggeredAt": "2026-02-06T11:22:00.000Z"
    }
  ],
  "total": 2
}
```

---

## 6. AI 프롬프트 전문

### 6.1 시스템 프롬프트 (전체)

```
You are performing Root Cause Analysis (RCA) for an Optimism L2 Rollup incident.

== Optimism Rollup Component Architecture ==

1. **L1 (Ethereum Mainnet/Sepolia)**
   - External dependency providing L1 block data and finality
   - All L2 components ultimately depend on L1

2. **op-node (Consensus Client / Derivation Driver)**
   - Reads L1 blocks and derives L2 state
   - Feeds derived blocks to op-geth for execution
   - Triggers op-batcher for batch submissions
   - Triggers op-proposer for state root submissions
   - CRITICAL: If op-node fails, ALL downstream components are affected

3. **op-geth (Execution Client)**
   - Executes L2 blocks received from op-node
   - Manages transaction pool (txpool)
   - Depends solely on op-node

4. **op-batcher (Transaction Batch Submitter)**
   - Collects L2 transactions and submits batches to L1
   - Depends on op-node for block data and L1 for gas/submission
   - If batcher fails: txpool accumulates, but L2 continues producing blocks

5. **op-proposer (State Root Proposer)**
   - Submits L2 state roots to L1 for fraud proof window
   - Depends on op-node for state data and L1 for submission
   - If proposer fails: withdrawals delayed, but L2 continues operating

== Component Dependency Graph ==
```
L1 ─────────────────────────────────────────┐
│                                            │
▼                                            ▼
op-node ────────────────────┬───────────────┬─▶ op-batcher ──▶ L1
│                           │               │
▼                           ▼               └─▶ op-proposer ──▶ L1
op-geth
```

== Common Optimism Failure Patterns ==

1. **L1 Reorg / Gas Spike**
   - Symptom: op-batcher/op-proposer submission failures, txpool growth
   - Chain: L1 issue → batcher unable to post → txpool accumulation
   - Root Cause: Usually L1 (external)

2. **op-node Derivation Stall**
   - Symptom: L2 block production stops, all components show errors
   - Chain: L1 data unavailable → op-node stall → op-geth stall → cascading failures
   - Root Cause: Check L1 connection, op-node sync status

3. **op-geth Crash / OOM**
   - Symptom: CPU/Memory anomalies, connection refused errors in other components
   - Chain: op-geth crash → downstream components can't connect
   - Root Cause: Resource exhaustion, check pod restarts

4. **Batcher Backlog**
   - Symptom: txpool monotonically increasing, no batch submissions
   - Chain: Batcher failure → txs not posted to L1 → txpool grows
   - Root Cause: Check batcher logs, L1 gas prices

5. **Network Partition / P2P Issues**
   - Symptom: Peer disconnections, gossip failures, unsafe head divergence
   - Chain: Network issue → peers dropped → consensus problems
   - Root Cause: Check firewall, P2P port accessibility

== Your Task ==

Given the event timeline, anomalies, metrics, and logs below:

1. **Identify the ROOT CAUSE**: Find the earliest triggering event that started the incident
2. **Trace the CAUSAL CHAIN**: Follow the propagation from root cause to observed symptoms
3. **Consider Dependencies**: Upstream failures propagate downstream (L1 → op-node → op-geth/batcher/proposer)
4. **Provide REMEDIATION**:
   - Immediate: Steps to restore service NOW
   - Preventive: Measures to prevent recurrence

== Output Format ==

Respond ONLY with a valid JSON object (no markdown code blocks):
{
  "rootCause": {
    "component": "op-geth" | "op-node" | "op-batcher" | "op-proposer" | "l1" | "system",
    "description": "Clear explanation of what triggered the incident",
    "confidence": 0.0-1.0
  },
  "causalChain": [
    {
      "timestamp": <unix_ms>,
      "component": "<component>",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
      "description": "What happened at this step"
    }
  ],
  "affectedComponents": ["<component1>", "<component2>"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}
```

### 6.2 사용자 프롬프트 템플릿

```
== Event Timeline (chronological) ==
{timelineJson}

== Detected Anomalies ==
{anomalySummary}

== Recent Metrics Snapshot ==
{metricsJson}

== Component Logs ==
{logSummary}

Analyze the above data and identify the root cause of the incident.
```

### 6.3 예상 AI 응답 예시

```json
{
  "rootCause": {
    "component": "l1",
    "description": "L1 gas price spike from 25 to 150 gwei caused batcher to exceed maximum configured gas price, preventing batch submissions",
    "confidence": 0.85
  },
  "causalChain": [
    {
      "timestamp": 1738857600000,
      "component": "l1",
      "type": "state_change",
      "description": "L1 base fee increased from 25 to 150 gwei due to network congestion"
    },
    {
      "timestamp": 1738857660000,
      "component": "op-batcher",
      "type": "error",
      "description": "Batch submission failed: max fee per gas (50 gwei) below required (150 gwei)"
    },
    {
      "timestamp": 1738857720000,
      "component": "op-geth",
      "type": "metric_anomaly",
      "description": "TxPool pending transactions increased to 2500 (3.2 standard deviations above normal)"
    },
    {
      "timestamp": 1738857780000,
      "component": "op-geth",
      "type": "warning",
      "description": "TxPool approaching capacity limit, may start rejecting new transactions"
    }
  ],
  "affectedComponents": ["op-batcher", "op-geth"],
  "remediation": {
    "immediate": [
      "Increase batcher --max-l1-gas-price configuration to 200 gwei",
      "Monitor L1 gas prices using etherscan.io/gastracker",
      "Verify batcher wallet has sufficient ETH balance (at least 1 ETH recommended)"
    ],
    "preventive": [
      "Implement dynamic gas pricing: use --gas-price-mode dynamic flag",
      "Set up PagerDuty/Slack alerts when L1 gas exceeds 100 gwei",
      "Consider implementing gas price oracle integration (Chainlink or internal)"
    ]
  }
}
```

---

## 7. 환경 변수

RCA Engine은 **추가 환경 변수가 필요하지 않다**. 기존 AI Gateway 환경 변수를 그대로 사용한다.

| 환경 변수 | 설명 | 출처 |
|-----------|------|------|
| `AI_GATEWAY_URL` | AI Gateway URL (기본값: `https://api.ai.tokamak.network`) | 기존 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 | 기존 |
| `K8S_NAMESPACE` | K8s 네임스페이스 (로그 수집용) | 기존 |
| `K8S_APP_PREFIX` | K8s 앱 라벨 프리픽스 | 기존 |

---

## 8. 테스트 검증

### 8.1 API 테스트 (curl)

#### RCA 트리거 (수동)

```bash
# RCA 분석 실행
curl -X POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}'

# 예상 응답
# {
#   "success": true,
#   "result": {
#     "id": "rca-xxx-xxx",
#     "rootCause": { ... },
#     ...
#   }
# }
```

#### RCA 히스토리 조회

```bash
# 최근 5개 RCA 결과 조회
curl "http://localhost:3002/api/rca?limit=5"

# 예상 응답
# {
#   "history": [ ... ],
#   "total": 5
# }
```

### 8.2 UI 테스트

1. **정상 동작 확인**
   - 대시보드 접속 (`http://localhost:3002`)
   - AI Monitor 영역의 Controls 섹션 확인
   - "ROOT CAUSE ANALYSIS" 버튼 확인 (주황색)
   - 버튼 클릭 → 로딩 상태 표시 ("ANALYZING...")
   - 분석 완료 후 결과 표시 확인

2. **결과 UI 확인**
   - Root Cause 카드: 빨간색 테두리, 컴포넌트 이름, 설명, 신뢰도
   - Causal Chain: 수직 타임라인, 컴포넌트 배지, 화살표
   - Affected Components: 컴포넌트 배지 목록
   - Remediation: 즉시 조치 + 예방 조치 목록

3. **에러 처리 확인**
   - AI Gateway 연결 실패 시 에러 메시지 표시
   - 네트워크 오류 시 fallback 분석 결과 표시

### 8.3 Mock 시나리오 테스트

**시나리오: Batcher 장애로 인한 TxPool 축적**

1. 스트레스 모드 활성화 ("Simulate Load" 버튼)
2. "ROOT CAUSE ANALYSIS" 버튼 클릭
3. 결과 확인:
   - Root Cause: `op-batcher` 또는 `l1`
   - Causal Chain: L1 gas spike → Batcher failure → TxPool growth
   - Affected Components: `op-geth`, `op-batcher`

### 8.4 통합 테스트 체크리스트

| 항목 | 확인 방법 | 예상 결과 |
|------|-----------|-----------|
| API 엔드포인트 | POST /api/rca 호출 | 200 OK, RCAResult 반환 |
| 히스토리 저장 | POST 후 GET /api/rca 호출 | 방금 실행한 RCA가 목록에 포함 |
| UI 버튼 렌더링 | 대시보드 접속 | "ROOT CAUSE ANALYSIS" 버튼 표시 |
| 로딩 상태 | 버튼 클릭 | 버튼 비활성화, 로딩 애니메이션 |
| 결과 표시 | 분석 완료 | Causal Chain 다이어그램 표시 |
| 에러 처리 | AI Gateway 오프라인 | 에러 메시지 또는 fallback 결과 |
| MetricsStore 연동 | Proposal 1 구현 후 | 최근 메트릭 데이터 사용 |
| AnomalyDetector 연동 | Proposal 2 구현 후 | 이상 탐지 결과 사용 |

---

## 9. 의존관계

### 9.1 필수 의존성 (Proposal 구현 순서)

```
Proposal 1 (MetricsStore)
        │
        ▼
Proposal 2 (AnomalyDetector)
        │
        ▼
Proposal 3 (RCA Engine) ← 현재 문서
```

### 9.2 선행 구현 필요 항목

| 의존 모듈 | 파일 | 필요 함수/타입 |
|-----------|------|----------------|
| MetricsStore | `src/lib/metrics-store.ts` | `getRecent(minutes: number)` |
| AnomalyDetector | `src/lib/anomaly-detector.ts` | `detectAnomalies(current, history)` |
| MetricDataPoint | `src/types/metrics.ts` | 전체 인터페이스 |
| AnomalyResult | `src/types/anomaly.ts` | 전체 인터페이스 |

### 9.3 기존 모듈 의존성 (수정 불필요)

| 모듈 | 파일 | 사용 함수 |
|------|------|-----------|
| LogIngester | `src/lib/log-ingester.ts` | `getAllLiveLogs()`, `generateMockLogs()` |
| AISeverity | `src/types/scaling.ts` | 타입 정의 |

### 9.4 독립적 구현 가능 항목

- **Proposal 4 (Cost Optimizer)**: RCA와 무관
- **Proposal 5 (NLOps)**: RCA API를 호출하는 소비자 역할

---

## 10. UI 상세 - Causal Chain Diagram

### 10.1 디자인 컨셉

Causal Chain은 **수직 타임라인** 형태로 표시된다. 상단에 근본 원인, 하단으로 갈수록 최근 이벤트/증상이 나타난다.

```
┌─────────────────────────────────────────────────────────┐
│  Root Cause Analysis Report           12:35:00 PM      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ROOT CAUSE                           85%        │   │
│  │ ● L1                                            │   │
│  │ L1 gas price spike from 25 to 150 gwei caused   │   │
│  │ batcher to exceed maximum configured gas price  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ CAUSAL CHAIN (4 events)                    [▼] │   │
│  ├─────────────────────────────────────────────────┤   │
│  │                                                 │   │
│  │  ●──┐ [L1] ⚠ 12:00:00                          │   │
│  │  │  │ L1 base fee increased to 150 gwei        │   │
│  │  │  │                                          │   │
│  │  ○──┤ [op-batcher] ✕ 12:01:00                  │   │
│  │  │  │ Batch submission failed: max fee too low │   │
│  │  │  │                                          │   │
│  │  ○──┤ [op-geth] ◆ 12:02:00                     │   │
│  │  │  │ TxPool spike: 2500 (z-score: 3.2)        │   │
│  │  │  │                                          │   │
│  │  ○──┘ [op-geth] ⚠ 12:03:00                     │   │
│  │       TxPool approaching capacity limit         │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ AFFECTED COMPONENTS                             │   │
│  │ [op-batcher] [op-geth]                          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ REMEDIATION STEPS                        ✓     │   │
│  │                                                 │   │
│  │ IMMEDIATE:                                      │   │
│  │ 1. Increase batcher max gas price              │   │
│  │ 2. Monitor L1 gas prices                       │   │
│  │ 3. Check batcher wallet balance                │   │
│  │                                                 │   │
│  │ PREVENTIVE:                                    │   │
│  │ 1. Implement dynamic gas pricing               │   │
│  │ 2. Set up gas price alerts                     │   │
│  │ 3. Integrate gas price oracle                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 10.2 컴포넌트 색상 매핑

| 컴포넌트 | Tailwind Class | HEX 코드 |
|----------|----------------|----------|
| `op-geth` | `bg-blue-500` | `#3B82F6` |
| `op-node` | `bg-green-500` | `#22C55E` |
| `op-batcher` | `bg-yellow-500` | `#EAB308` |
| `op-proposer` | `bg-purple-500` | `#A855F7` |
| `l1` | `bg-red-500` | `#EF4444` |
| `system` | `bg-gray-500` | `#6B7280` |

### 10.3 이벤트 타입 아이콘

| 이벤트 타입 | 아이콘 | 색상 |
|-------------|--------|------|
| `error` | `XCircle` | `text-red-400` |
| `warning` | `AlertTriangle` | `text-yellow-400` |
| `metric_anomaly` | `Activity` | `text-orange-400` |
| `state_change` | `GitBranch` | `text-blue-400` |

### 10.4 애니메이션

- **로딩 바**: `animate-loading-bar` (기존 CSS 애니메이션 재사용)
- **결과 슬라이드인**: `animate-slideIn` (기존 CSS 애니메이션 재사용)
- **근본 원인 펄스**: `animate-pulse` (Tailwind 기본)

### 10.5 반응형 동작

- **데스크톱 (lg 이상)**: Causal Chain 완전 펼침 기본
- **모바일**: Causal Chain 접힘 기본, 클릭으로 토글

---

## 부록 A: 전체 파일 목록

### 신규 생성 파일

| 파일 경로 | 설명 |
|-----------|------|
| `src/types/rca.ts` | RCA 관련 타입 정의 |
| `src/lib/rca-engine.ts` | RCA 핵심 로직 (타임라인 빌더, AI 연동, 히스토리 관리) |
| `src/app/api/rca/route.ts` | RCA API 엔드포인트 (POST, GET) |

### 수정 파일

| 파일 경로 | 수정 내용 |
|-----------|-----------|
| `src/app/page.tsx` | RCA 상태, 버튼, 결과 컴포넌트 추가 |
| `src/lib/anomaly-ai-analyzer.ts` | (선택) 자동 RCA 트리거 연동 |

### 의존 파일 (Proposal 1, 2에서 생성)

| 파일 경로 | 출처 |
|-----------|------|
| `src/types/metrics.ts` | Proposal 1 |
| `src/types/anomaly.ts` | Proposal 2 |
| `src/lib/metrics-store.ts` | Proposal 1 |
| `src/lib/anomaly-detector.ts` | Proposal 2 |

---

## 부록 B: 코드 품질 체크리스트

구현 완료 후 다음 항목을 확인한다:

- [ ] `npm run lint` 통과
- [ ] `npm run build` 통과
- [ ] TypeScript strict mode 에러 없음
- [ ] `any` 타입 사용 없음
- [ ] 모든 함수에 JSDoc 주석 존재
- [ ] 에러 핸들링이 `error instanceof Error` 패턴 사용
- [ ] API 응답이 `NextResponse.json()` 패턴 사용
- [ ] Import alias `@/*` 사용

---

## 부록 C: 구현 순서 권장

1. **타입 정의** (`src/types/rca.ts`)
2. **RCA 엔진 핵심 로직** (`src/lib/rca-engine.ts`)
   - 상수 및 의존관계 그래프
   - 타임라인 빌더 함수
   - AI 연동 함수
   - 히스토리 관리 함수
3. **API 엔드포인트** (`src/app/api/rca/route.ts`)
4. **UI 컴포넌트** (`src/app/page.tsx`)
   - 상태 및 import 추가
   - 버튼 추가
   - 결과 표시 컴포넌트
5. **통합 테스트**
6. **(선택) 자동 트리거 연동** (`src/lib/anomaly-ai-analyzer.ts`)

---

**문서 끝**
