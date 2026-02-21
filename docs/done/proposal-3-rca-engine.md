# Proposal 3: Root Cause Analysis Engine - Implementation Specification

> **Document version**: 1.0.0
> **Created date**: 2026-02-06
> **Target audience**: Claude Opus 4.6 Implementation Agent
> **Prerequisite**: Completed implementation of Proposal 1 (MetricsStore), Proposal 2 (AnomalyDetector)

---

## index

1. [Overview](#1-Overview)
2. [Type Definition](#2-Type-Definition)
3. [New file specification](#3-new-file-specification)
4. [Edit existing file](#4-Existing-file-Edit)
5. [API specification](#5-api-specification)
6. [AI Prompt Full Text](#6-ai-Prompt-Full Text)
7. [Environment Variables](#7-Environment-Variables)
8. [Test Verification](#8-Test-Verification)
9. [Dependency](#9-Dependency)
10. [UI Details - Causal Chain Diagram](#10-ui-Details---causal-chain-diagram)

---

## 1. Overview

### 1.1 Background

Currently, SentinAI's `ai-analyzer.ts` analyzes logs and returns `summary` and `action_item`. This method tells you “what went wrong” but not “why it went wrong” or “in what order the problem propagated.”

### 1.2 Goal

**Root Cause Analysis (RCA) Engine** provides the following features:

1. **Configure event timeline**: Sort logs and metric outliers chronologically.
2. **Component dependency mapping**: Utilizing the dependency graph between Optimism Rollup components
3. **AI-based causal inference**: Leverage Claude to identify root causes and trace propagation paths
4. **Provide action recommendations**: Propose immediate actions and measures to prevent recurrence

### 1.3 Trigger method

RCA is triggered in two ways:

1. **Manual trigger**: Click the “ROOT CAUSE ANALYSIS” button in the UI
2. **Auto trigger**: When detecting `severity === 'critical'` in deep analysis of Proposal 2 (optional)

### 1.4 Dependent modules

| module | Use | Source |
|------|------|------|
| `MetricsStore` | View recent metric history | Proposal 1 (`src/lib/metrics-store.ts`) |
| `AnomalyDetector` | Statistically based outlier detection | Proposal 2 (`src/lib/anomaly-detector.ts`) |
| `LogIngester` | Log collection by component | existing (`src/lib/log-ingester.ts`) |
| `AnomalyResult` | Anomaly detection result type | Proposal 2 (`src/types/anomaly.ts`) |

### 1.5 Architecture diagram

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

## 2. Type definition

### 2.1 New file: `src/types/rca.ts`

```typescript
/**
 * Root Cause Analysis Types
* Type definition for Optimism Rollup failure analysis
 */

import type { AISeverity } from './scaling';

/**
* Optimism Rollup component identifier
* - op-geth: Execution Client (L2 block execution)
* - op-node: Consensus Client / Derivation Driver (derivation of L2 state from L1)
* - op-batcher: Transaction Batch Submitter (submits L2 transactions to L1)
* - op-proposer: State Root Proposer (submits L2 state root to L1)
* - l1: L1 Ethereum (external dependency)
* - system: system level events (K8s, network, etc.)
 */
export type RCAComponent =
  | 'op-geth'
  | 'op-node'
  | 'op-batcher'
  | 'op-proposer'
  | 'l1'
  | 'system';

/**
* RCA event type
* - error: error log or fatal failure
* - warning: warning log or attention-needs status
* - metric_anomaly: Metric outliers (based on Z-Score)
* - state_change: State change (scaling, restart, etc.)
 */
export type RCAEventType = 'error' | 'warning' | 'metric_anomaly' | 'state_change';

/**
* RCA Events
* Individual events that make up the timeline
 */
export interface RCAEvent {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

/** Event generating component */
  component: RCAComponent;

/** Event type */
  type: RCAEventType;

/** Event description (in human-readable form) */
  description: string;

/** Original log line (if any) */
  rawLog?: string;

/** Event severity (if any) */
  severity?: AISeverity;
}

/**
* Component dependencies
* Optimism Rollup architecture-based definition
 */
export interface ComponentDependency {
/** List of components this component depends on (upstream) */
  dependsOn: RCAComponent[];

/** List of components that depend on this component (downstream) */
  feeds: RCAComponent[];
}

/**
* Root cause information
 */
export interface RootCauseInfo {
/** Root cause component */
  component: RCAComponent;

/** Root cause explanation */
  description: string;

/** Analysis reliability (0-1) */
  confidence: number;
}

/**
* Action recommendations
 */
export interface RemediationAdvice {
/** Immediate action */
  immediate: string[];

/** Measures to prevent recurrence */
  preventive: string[];
}

/**
* RCA analysis results
 */
export interface RCAResult {
/** Unique identifier (UUID) */
  id: string;

/** Root cause information */
  rootCause: RootCauseInfo;

/** Causal chain (root cause → final symptom sequence) */
  causalChain: RCAEvent[];

/** List of affected components */
  affectedComponents: RCAComponent[];

/** Full event timeline (in chronological order) */
  timeline: RCAEvent[];

/** Recommend action */
  remediation: RemediationAdvice;

/** Analysis completion time (ISO 8601) */
  generatedAt: string;
}

/**
* RCA history entry
 */
export interface RCAHistoryEntry {
/** Same as id of RCAResult */
  id: string;

/** RCA analysis results */
  result: RCAResult;

/** Trigger method */
  triggeredBy: 'manual' | 'auto';

/** Trigger time (ISO 8601) */
  triggeredAt: string;
}

/**
* RCA API request body
 */
export interface RCARequest {
/** Automatic trigger (used when linking Proposal 2) */
  autoTriggered?: boolean;
}

/**
* RCA API response
 */
export interface RCAResponse {
/** Success or not */
  success: boolean;

/** RCA result (if successful) */
  result?: RCAResult;

/** Error message (in case of failure) */
  error?: string;

/** Detailed error (for debugging) */
  message?: string;
}

/**
* RCA History API response
 */
export interface RCAHistoryResponse {
/** RCA history list */
  history: RCAHistoryEntry[];

/** Total history count */
  total: number;
}
```

---

## 3. New file specification

### 3.1 `src/lib/rca-engine.ts`

This module is responsible for the core logic of RCA.

```typescript
/**
 * Root Cause Analysis Engine
* Optimism Rollup Analyze the root cause of failures and trace the causal chain
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
* AI Gateway settings
 */
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
* Optimism Rollup component dependency graph
 *
* Data flow:
* - L1 → op-node: Derive L2 state by reading L1 block data
* - op-node → op-geth: Pass the derived block to the execution client.
* - op-node → op-batcher: trigger batch submission
* - op-node → op-proposer: trigger state route submission
* - op-batcher → L1: Submit transaction batch to L1
* - op-proposer → L1: submit state root to L1
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
* Mapping log levels and RCAEventType
 */
const LOG_LEVEL_MAP: Record<string, 'error' | 'warning'> = {
  'ERROR': 'error',
  'ERR': 'error',
  'FATAL': 'error',
  'WARN': 'warning',
  'WARNING': 'warning',
};

/**
* Component name normalization map
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
* Maximum number of RCA history storage
 */
const MAX_HISTORY_SIZE = 20;

// ============================================================================
// In-Memory State
// ============================================================================

/**
* RCA history storage (in-memory)
* In actual operating environments, use of Redis or DB is recommended
 */
let rcaHistory: RCAHistoryEntry[] = [];

// ============================================================================
// Timeline Builder Functions
// ============================================================================

/**
* Extract timestamps from log lines
* Supported formats:
 * - ISO 8601: 2026-02-06T12:34:56.789Z
* - Geth style: [02-06|12:34:56.789]
* - General: 2026-02-06 12:34:56
 *
* @param logLine - log line
* @returns Unix timestamp (ms) 또는 null
 */
function extractTimestamp(logLine: string): number | null {
// ISO 8601 format
  const isoMatch = logLine.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/);
  if (isoMatch) {
    const date = new Date(isoMatch[1]);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

// Geth style [MM-DD|HH:mm:ss.mmm]
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

// General format YYYY-MM-DD HH:mm:ss
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
* Extract log levels from log lines
 *
* @param logLine - log line
* @returns log level or null
 */
function extractLogLevel(logLine: string): 'error' | 'warning' | null {
  const upperLine = logLine.toUpperCase();

  for (const [levelStr, eventType] of Object.entries(LOG_LEVEL_MAP)) {
// Prevent false positives by matching on word boundaries
    const regex = new RegExp(`\\b${levelStr}\\b`);
    if (regex.test(upperLine)) {
      return eventType;
    }
  }

  return null;
}

/**
* Component name normalization
 *
* @param name - Original component name
* @returns Normalized RCAComponent
 */
function normalizeComponentName(name: string): RCAComponent {
  const lowered = name.toLowerCase().trim();
  return COMPONENT_NAME_MAP[lowered] || 'system';
}

/**
* Parse RCAEvent list from log
 *
* @param logs - Logs by component (key: component name, value: log text)
* @returns RCAEvent array
 */
function parseLogsToEvents(logs: Record<string, string>): RCAEvent[] {
  const events: RCAEvent[] = [];

  for (const [componentName, logText] of Object.entries(logs)) {
    const component = normalizeComponentName(componentName);
    const lines = logText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const level = extractLogLevel(line);

// Extract only ERROR or WARN logs as events
      if (!level) continue;

      const timestamp = extractTimestamp(line) || Date.now();

// Extract meaningful parts from log messages
// Remainder after removing timestamp and level
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
* Convert AnomalyResult to RCAEvent
 *
* @param anomalies - Anomaly detection result array
* @returns RCAEvent array
 */
function anomaliesToEvents(anomalies: AnomalyResult[]): RCAEvent[] {
  return anomalies
    .filter(a => a.isAnomaly)
    .map(anomaly => {
// Infer component from metric name
      let component: RCAComponent = 'system';
      if (anomaly.metric.includes('cpu') || anomaly.metric.includes('memory')) {
component = 'op-geth'; // CPU/Memory mainly related to geth
      } else if (anomaly.metric.includes('txPool') || anomaly.metric.includes('gas')) {
        component = 'op-geth';
      } else if (anomaly.metric.includes('block')) {
        component = 'op-node';
      }

// Determine severity based on direction
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
* Event timeline configuration
 *
* @param anomalies - Anomaly detection result array
* @param logs - logs for each component
* @param minutes - Time range to analyze (minutes)
* @returns Array of RCAEvents sorted by time.
 */
export function buildTimeline(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  minutes: number = 5
): RCAEvent[] {
// Extract events from log
  const logEvents = parseLogsToEvents(logs);

// Convert outliers to events
  const anomalyEvents = anomaliesToEvents(anomalies);

// Merge all events
  const allEvents = [...logEvents, ...anomalyEvents];

// Filter time range
  const cutoffTime = Date.now() - minutes * 60 * 1000;
  const filteredEvents = allEvents.filter(e => e.timestamp >= cutoffTime);

// Sort chronologically (oldest first)
  filteredEvents.sort((a, b) => a.timestamp - b.timestamp);

  return filteredEvents;
}

// ============================================================================
// Dependency Graph Functions
// ============================================================================

/**
* Explore all downstream components affected by a specific component
 *
* @param rootComponent - root cause component
* @returns list of affected components
 */
export function findAffectedComponents(rootComponent: RCAComponent): RCAComponent[] {
  const affected = new Set<RCAComponent>();
  const queue: RCAComponent[] = [rootComponent];

  while (queue.length > 0) {
    const current = queue.shift()!;

// Skip components that have already been processed
    if (affected.has(current) && current !== rootComponent) {
      continue;
    }

// Explore downstream components
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
* Check upstream dependency of a specific component
 *
* @param component - target component
* @returns upstream component list
 */
export function findUpstreamComponents(component: RCAComponent): RCAComponent[] {
  const deps = DEPENDENCY_GRAPH[component];
  return deps ? deps.dependsOn : [];
}

// ============================================================================
// AI Integration
// ============================================================================

/**
* RCA system prompt
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
* Generate RCA user prompt
 */
function buildUserPrompt(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint[],
  logs: Record<string, string>
): string {
// Timeline JSON
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

// Summary of outliers
  const anomalySummary = anomalies
    .filter(a => a.isAnomaly)
    .map(a => `- ${a.metric}: ${a.value.toFixed(2)} (z-score: ${a.zScore.toFixed(2)}, ${a.direction})`)
    .join('\n');

// Recent metrics (last 5)
  const recentMetrics = metrics.slice(-5).map(m => ({
    time: new Date(m.timestamp).toISOString(),
    cpu: m.cpuUsage.toFixed(1),
    txPool: m.txPoolPending,
    gasRatio: m.gasUsedRatio.toFixed(3),
  }));

// Log summary (last 20 lines of each component)
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
* Perform RCA analysis through AI Gateway
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

// Parse JSON (remove markdown code blocks)
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

// Verify and convert response structure
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

// Fallback: Timeline-based heuristic analysis
    return generateFallbackAnalysis(timeline, anomalies);
  }
}

/**
* Fallback analysis when AI call fails
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
// Assume the oldest error event as the root cause
  const errorEvents = timeline.filter(e => e.type === 'error');
  const firstError = errorEvents[0] || timeline[0];

  const rootCauseComponent = firstError?.component || 'system';
  const affectedComponents = findAffectedComponents(rootCauseComponent);

  return {
    rootCause: {
      component: rootCauseComponent,
      description: firstError?.description || 'Unable to determine root cause (AI unavailable)',
confidence: 0.3, // low confidence
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
* Generate UUID (fallback for environments without crypto.randomUUID)
 */
function generateId(): string {
  return 'rca-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
* Perform RCA
 *
* @param anomalies - Anomaly detection results (Proposal 2)
* @param logs - logs for each component
* @param metrics - Metric data point (Proposal 1)
 * @returns RCAResult
 */
export async function performRCA(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  metrics: MetricDataPoint[]
): Promise<RCAResult> {
  const startTime = Date.now();
  console.log('[RCA Engine] Starting root cause analysis...');

// 1. Event timeline configuration
  const timeline = buildTimeline(anomalies, logs, 5);
  console.log(`[RCA Engine] Built timeline with ${timeline.length} events`);

// 2. Causal analysis through AI
  const aiResult = await callAIForRCA(timeline, anomalies, metrics, logs);

// 3. Configure results
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
* Add entry to RCA history
 */
export function addRCAHistory(result: RCAResult, triggeredBy: 'manual' | 'auto'): void {
  const entry: RCAHistoryEntry = {
    id: result.id,
    result,
    triggeredBy,
    triggeredAt: new Date().toISOString(),
  };

  rcaHistory.unshift(entry);

// Remove old items when maximum storage number is exceeded
  if (rcaHistory.length > MAX_HISTORY_SIZE) {
    rcaHistory = rcaHistory.slice(0, MAX_HISTORY_SIZE);
  }
}

/**
* RCA history search
 *
* @param limit - Maximum number of items to return
* @returns RCAHistoryEntry 배열
 */
export function getRCAHistory(limit: number = 10): RCAHistoryEntry[] {
  return rcaHistory.slice(0, Math.min(limit, MAX_HISTORY_SIZE));
}

/**
* Query specific RCA results
 *
* @param id - RCA result ID
* @returns RCAHistoryEntry 또는 undefined
 */
export function getRCAById(id: string): RCAHistoryEntry | undefined {
  return rcaHistory.find(entry => entry.id === id);
}

/**
* View total history count
 */
export function getRCAHistoryCount(): number {
  return rcaHistory.length;
}
```

### 3.2 `src/app/api/rca/route.ts`

RCA API endpoint implementation.

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

## 4. Edit existing files

### 4.1 `src/types/anomaly.ts` (created in Proposal 2)

AnomalyResult type that the RCA engine relies on. This file must be created when implementing Proposal 2.

```typescript
/**
 * Anomaly Detection Types
* (Created from Proposal 2)
 */

/**
* Anomaly detection results
 */
export interface AnomalyResult {
/** Is there a problem */
  isAnomaly: boolean;

/** Metric name */
  metric: string;

/** Current value */
  value: number;

/** Z-Score (greater than |z| > 2.5) */
  zScore: number;

/** Ideal direction */
  direction: 'spike' | 'drop' | 'plateau';

/** explanation */
  description: string;
}
```

### 4.2 `src/types/metrics.ts` (created in Proposal 1)

MetricDataPoint type that the RCA engine relies on. This file must be created when implementing Proposal 1.

```typescript
/**
 * Metrics Store Types
* (Created from Proposal 1)
 */

/**
* Metric data points
 */
export interface MetricDataPoint {
  /** Unix timestamp (milliseconds) */
  timestamp: number;

/** CPU utilization (0-100) */
  cpuUsage: number;

/** Transaction pool wait count */
  txPoolPending: number;

/** Gas ​​usage rate (0-1) */
  gasUsedRatio: number;

/** L2 block height */
  l2BlockHeight: number;

/** Time interval between L2 blocks (seconds) */
  l2BlockInterval: number;
}
```

### 4.3 `src/lib/metrics-store.ts` (created in Proposal 1)

The `getRecent` function of MetricsStore that the RCA engine depends on. This file must be created when implementing Proposal 1.

```typescript
/**
 * Metrics Store
* (Created from Proposal 1)
 *
* Minimum required interface:
 */

import type { MetricDataPoint } from '@/types/metrics';

/**
* View metrics for the last N minutes
 *
* @param minutes - Time range to query (minutes)
* @returns MetricDataPoint 배열
 */
export function getRecent(minutes: number): MetricDataPoint[];
```

### 4.4 `src/lib/anomaly-detector.ts` (generated in Proposal 2)

AnomalyDetector's `detectAnomalies` function that the RCA engine relies on. This file must be created when implementing Proposal 2.

```typescript
/**
 * Anomaly Detector
* (Created from Proposal 2)
 *
* Minimum required interface:
 */

import type { MetricDataPoint } from '@/types/metrics';
import type { AnomalyResult } from '@/types/anomaly';

/**
* Detect anomalies in current metrics
 *
* @param current - Current metric data
* @param history - Past metric data (last 30 minutes)
* @returns AnomalyResult array
 */
export function detectAnomalies(
  current: MetricDataPoint,
  history: MetricDataPoint[]
): AnomalyResult[];
```

### 4.5 Modify `src/app/page.tsx`

Add RCA function to existing UI.

#### 4.5.1 Add state (state declaration part)

**Original code** (near lines 62-63):

```typescript
const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
const [isAnalyzing, setIsAnalyzing] = useState(false);
```

**After modification**:

```typescript
const [logInsight, setLogInsight] = useState<{ summary: string; severity: string; timestamp: string; action_item?: string } | null>(null);
const [isAnalyzing, setIsAnalyzing] = useState(false);

// RCA State
const [rcaResult, setRcaResult] = useState<RCAResult | null>(null);
const [isRunningRCA, setIsRunningRCA] = useState(false);
const [rcaError, setRcaError] = useState<string | null>(null);
```

#### 4.5.2 Add Import (top of file)

**Original code** (near lines 9-11):

```typescript
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield
} from 'lucide-react';
```

**After modification**:

```typescript
import {
  Activity, Server, Zap, ShieldAlert, Cpu, ArrowUpRight,
  TrendingDown, FileText, CheckCircle2, XCircle, Shield,
  GitBranch, AlertTriangle, ChevronDown, ChevronRight
} from 'lucide-react';
import type { RCAResult, RCAEvent, RCAComponent } from '@/types/rca';
```

#### 4.5.3 Add RCA function (after checkLogs function)

**Original code** (near line 79):

```typescript
  } finally {
    setIsAnalyzing(false);
  }
};

// Track current stressMode for async operations
```

**After modification**:

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

#### 4.5.4 Add RCA button (Controls section)

**Old code** (near lines 401-416, CHECK HEALTH button):

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

**After modification**:

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

#### 4.5.5 Add RCA result display area (inside Log Stream area)

**Existing code** (near lines 370-393, AI Result Injection section):

```typescript
{/* AI Result Injection */}
{logInsight && !isAnalyzing && (
  <div className="my-6 p-4 rounded-lg bg-gray-800/50 border-l-4 border-blue-500 animate-slideIn">
    {/* ... existing AI result display ... */}
  </div>
)}
```

**After modification** (add RCA Result after AI Result):

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

#### 4.5.6 Addition of RCA result component (bottom of file, after LogBlock)

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

#### 4.5.7 Add useState import to RCAResultDisplay component

**Caution**: Since `RCAResultDisplay` uses `useState`, check the import at the top of the file to see if `useState` is already included. If it is already included, no further modifications are required.

```typescript
import { useEffect, useState, useRef } from 'react';
```

### 4.6 `src/lib/anomaly-ai-analyzer.ts` (Proposal 2) - Optional automatic triggering

Ability to automatically trigger RCA when `critical` severity is found in deep analysis of Proposal 2. **Optional implementation** and not required.

```typescript
// internal anomaly-ai-analyzer.ts (Proposal 2)
// Add at the end of the performDeepAnalysis function

import { performRCA, addRCAHistory } from '@/lib/rca-engine';

// ... existing code ...

// Automatic RCA trigger if deep analysis result is critical
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

## 5. API Specification

### 5.1 POST `/api/rca` - RCA analysis trigger

#### request

```http
POST /api/rca HTTP/1.1
Content-Type: application/json

{
  "autoTriggered": false
}
```

| field | Type | Required | Description |
|------|------|------|------|
| `autoTriggered` | `boolean` | No | Whether to automatically trigger (default: `false`) |

#### Response (success)

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

#### Response (failed)

```json
{
  "success": false,
  "error": "RCA analysis failed",
  "message": "AI Gateway timeout after 30000ms"
}
```

### 5.2 GET `/api/rca` - RCA history query

#### request

```http
GET /api/rca?limit=5 HTTP/1.1
```

| query parameters | Type | Required | Description |
|---------------|------|------|------|
| `limit` | `number` | No | Maximum number of items to return (default: 10, maximum: 20) |

#### Response

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

## 6. AI Prompt Professional

### 6.1 System Prompt (All)

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

### 6.2 User Prompt Template

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

### 6.3 Example of expected AI response

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

## 7. Environment variables

RCA Engine **requires no additional environment variables**. Use the existing AI Gateway environment variables as is.

| environment variables | Description | Source |
|-----------|------|------|
| `AI_GATEWAY_URL` | AI Gateway URL (default: `https://api.ai.tokamak.network`) | existing |
| `ANTHROPIC_API_KEY` | Anthropic API Key | existing |
| `K8S_NAMESPACE` | K8s namespace (for log collection) | existing |
| `K8S_APP_PREFIX` | K8s app label prefix | existing |

---

## 8. Test verification

### 8.1 API testing (curl)

#### RCA trigger (manual)

```bash
# Run RCA analysis
curl -X POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{"autoTriggered": false}'

# Expected response
# {
#   "success": true,
#   "result": {
#     "id": "rca-xxx-xxx",
#     "rootCause": { ... },
#     ...
#   }
# }
```

#### RCA History View

```bash
# View the most recent 5 RCA results
curl "http://localhost:3002/api/rca?limit=5"

# Expected response
# {
#   "history": [ ... ],
#   "total": 5
# }
```

### 8.2 UI testing

1. **Check normal operation**
- Access dashboard (`http://localhost:3002`)
- Check the Controls section in the AI ​​Monitor area.
- Check the “ROOT CAUSE ANALYSIS” button (orange)
- Click button → Show loading status ("ANALYZING...")
- Check result display after completion of analysis

2. **Check the result UI**
- Root Cause card: red border, component name, description, reliability
- Causal Chain: vertical timeline, component badges, arrows
- Affected Components: List of component badges
- Remediation: Immediate action + list of preventive actions

3. **Check error handling**
- Error message displayed when AI Gateway connection fails
- Display fallback analysis results in case of network error

### 8.3 Mock scenario testing

**Scenario: TxPool accumulation due to Batcher failure**

1. Activate stress mode (“Simulate Load” button)
2. Click the “ROOT CAUSE ANALYSIS” button
3. Check the results:
- Root Cause: `op-batcher` or `l1`
   - Causal Chain: L1 gas spike → Batcher failure → TxPool growth
   - Affected Components: `op-geth`, `op-batcher`

### 8.4 Integration testing checklist

| Item | How to check | Expected results |
|------|-----------|-----------|
| API endpoint | POST /api/rca call | 200 OK, return RCAResult |
| Save History | Call GET /api/rca after POST | The RCA you just ran is included in the list |
| UI button rendering | Dashboard access | Show "ROOT CAUSE ANALYSIS" button |
| loading status | button click | Button disable, loading animation |
| Show results | Analysis complete | Show Causal Chain Diagram |
| error handling | AI Gateway offline | Error message or fallback result |
| MetricsStore integration | After implementing Proposal 1 | Use recent metric data |
| AnomalyDetector integration | After implementing Proposal 2 | Using anomaly detection results |

---

## 9. Dependencies

### 9.1 Required dependencies (Proposal implementation order)

```
Proposal 1 (MetricsStore)
        │
        ▼
Proposal 2 (AnomalyDetector)
        │
        ▼
Proposal 3 (RCA Engine) ← Current Document
```

### 9.2 Prerequisites for implementation

| dependent modules | file | Required function/type |
|-----------|------|----------------|
| MetricsStore | `src/lib/metrics-store.ts` | `getRecent(minutes: number)` |
| AnomalyDetector | `src/lib/anomaly-detector.ts` | `detectAnomalies(current, history)` |
| MetricDataPoint | `src/types/metrics.ts` | Full interface |
| AnomalyResult | `src/types/anomaly.ts` | Full interface |

### 9.3 Existing module dependencies (no modification required)

| module | file | Use function |
|------|------|-----------|
| LogIngester | `src/lib/log-ingester.ts` | `getAllLiveLogs()`, `generateMockLogs()` |
| AISeverity | `src/types/scaling.ts` | type definition |

### 9.4 Independently Implementable Items

- **Proposal 4 (Cost Optimizer)**: Not related to RCA
- **Proposal 5 (NLOps)**: Consumer role calling RCA API

---

## 10. UI Details - Causal Chain Diagram

### 10.1 Design concept

The Causal Chain is displayed in the form of a **vertical timeline**. The root cause appears at the top, and more recent events/symptoms appear toward the bottom.

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

### 10.2 Component color mapping

| component | Tailwind Class | HEX code |
|----------|----------------|----------|
| `op-geth` | `bg-blue-500` | `#3B82F6` |
| `op-node` | `bg-green-500` | `#22C55E` |
| `op-batcher` | `bg-yellow-500` | `#EAB308` |
| `op-proposer` | `bg-purple-500` | `#A855F7` |
| `l1` | `bg-red-500` | `#EF4444` |
| `system` | `bg-gray-500` | `#6B7280` |

### 10.3 Event type icon

| Event Type | Icon | color |
|-------------|--------|------|
| `error` | `XCircle` | `text-red-400` |
| `warning` | `AlertTriangle` | `text-yellow-400` |
| `metric_anomaly` | `Activity` | `text-orange-400` |
| `state_change` | `GitBranch` | `text-blue-400` |

### 10.4 Animation

- **Loading Bar**: `animate-loading-bar` (reuse existing CSS animation)
- **Result SlideIn**: `animate-slideIn` (reuse existing CSS animation)
- **Root Cause Pulse**: `animate-pulse` (Tailwind default)

### 10.5 Responsive behavior

- **Desktop (LG or higher)**: Causal Chain fully expanded by default
- **Mobile**: Causal Chain collapse default, toggle with click

---

## Appendix A: Complete File List

### Newly created file

| file path | Description |
|-----------|------|
| `src/types/rca.ts` | RCA-related type definitions |
| `src/lib/rca-engine.ts` | RCA core logic (timeline builder, AI linkage, history management) |
| `src/app/api/rca/route.ts` | RCA API endpoint (POST, GET) |

### Modify file

| file path | Edit details |
|-----------|-----------|
| `src/app/page.tsx` | Add RCA status, button, and result components |
| `src/lib/anomaly-ai-analyzer.ts` | (Optional) Automatic RCA trigger linkage |

### Dependent files (generated in Proposal 1 and 2)

| file path | Source |
|-----------|------|
| `src/types/metrics.ts` | Proposal 1 |
| `src/types/anomaly.ts` | Proposal 2 |
| `src/lib/metrics-store.ts` | Proposal 1 |
| `src/lib/anomaly-detector.ts` | Proposal 2 |

---

## Appendix B: Code Quality Checklist

After completing implementation, check the following items:

- [ ] `npm run lint` passed
- [ ] Pass `npm run build`
- [ ] TypeScript strict mode no errors
- [ ] No use of `any` type
- [ ] JSDoc comments present in all functions
- [ ] Error handling uses the `error instanceof Error` pattern.
- [ ] API response uses `NextResponse.json()` pattern
- [ ] Use import alias `@/*`

---

## Appendix C: Recommended Implementation Order

1. **Type definition** (`src/types/rca.ts`)
2. **RCA engine core logic** (`src/lib/rca-engine.ts`)
- Constants and dependency graph
- Timeline builder function
- AI linked function
- History management function
3. **API Endpoint** (`src/app/api/rca/route.ts`)
4. **UI component** (`src/app/page.tsx`)
- Add status and import
- Add button
- Result display component
5. **Integration Testing**
6. **(Optional) Automatic trigger integration** (`src/lib/anomaly-ai-analyzer.ts`)

---

**End of document**
