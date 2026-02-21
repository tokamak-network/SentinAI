# Proposal 5: Natural Language Ops (NLOps) - Implementation Specification

> Creation date: 2026-02-06
> Updated: 2026-02-10 (codebase synchronization)
> Target: Claude Opus 4.6 Implementation Agent
> Purpose: To provide all the details so that you can fully implement NLOps functionality with this document alone.

---

## index

1. [Overview](#1-Overview)
2. [Type Definition](#2-Type-Definition)
3. [New file specification](#3-new-file-specification)
   - 3.1 [nlops-engine.ts](#31-srclibinlops-enginets)
   - 3.2 [nlops-responder.ts](#32-srclibnlops-responderts)
   - 3.3 [NLOps API Route](#33-srcappapinlopsroutets)
4. [Edit existing file](#4-Existing-file-Edit)
- 4.1 [page.tsx fix](#41-srcappppagetsx-fix)
5. [API specification](#5-api-specification)
6. [AI Prompt Full Text](#6-ai-Prompt-Full Text)
7. [Environment Variables](#7-Environment-Variables)
8. [Test Verification](#8-Test-Verification)
9. [Dependency](#9-Dependency)
10. [Command Mapping Table](#10-Command-Mapping-Table)

---

## 1. Overview

### 1.1 Goal

**Natural Language Operations (NLOps)** is a conversational interface that allows you to control SentinAI with natural language commands.
Instead of GUI buttons, operators operate the system with natural language such as “Tell me the current status” and “Scale up to 4 vCPU.”

### 1.2 Core flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────────────┐
│ User Input      │     │ Intent Classifier    │     │ Action Router      │
│ (Chat UI) │────▶│ (chatCompletion) │────▶│ (Existing API call) │
└─────────────────┘     └──────────────────────┘     └─────────┬──────────┘
                                                               │
                        ┌──────────────────────┐               │
                        │ Response Generator   │◀──────────────┘
│ (Generating natural language responses) │
                        └──────────────────────┘
```

### 1.3 Key features

1. **Intent Classification**: Classifies user input into structured intent.
2. **Action Router**: Call appropriate internal API based on intent
3. **Confirmation Flow**: Dangerous operations (scaling, changing settings) require a confirmation step.
4. **Natural Response**: Response by converting execution results into natural language

### 1.4 Supported languages

- **Input**: Supports both Korean and English
- **Output**: Response in Korean (UI-facing text Korean principle)

### 1.5 Current codebase state

**Existing implemented modules** that NLOps works with:

| Features | API endpoint | core files | status |
|------|---------------|----------|------|
| Metric query | `GET /api/metrics` | `src/lib/metrics-store.ts` | ✅ P1 implementation complete |
| Scaler Status/Running | `GET/POST /api/scaler` | `src/lib/k8s-scaler.ts` | ✅ Implementation complete |
| Change settings | `PATCH /api/scaler` | `src/lib/k8s-scaler.ts` | ✅ Implementation complete |
| Anomaly Detection | `GET /api/anomalies` | `src/lib/anomaly-detector.ts` | ✅ P2 implementation complete |
| Root Cause Analysis | `POST /api/rca` | `src/lib/rca-engine.ts` | ✅ P3 implementation completed |
| Cost Report | `GET /api/cost-report` | `src/lib/cost-optimizer.ts` | ✅ P4 implementation complete |
| log analysis | (internal function) | `src/lib/ai-analyzer.ts` | ✅ Implementation complete |
| AI Client | (internal function) | `src/lib/ai-client.ts` | ✅ Implementation complete |
| Health check | `GET /api/health` | - | ✅ Implementation complete |

**Important**: Log analysis directly calls the `analyzeLogChunk()` function of `ai-analyzer.ts` without a separate API route.

---

## 2. Type definition

### 2.1 File: `src/types/nlops.ts` (newly created)

```typescript
/**
 * NLOps (Natural Language Operations) Type Definitions
* Type definition for natural language-based operating interface
 */

// ============================================================
// Intent Types
// ============================================================

/**
* Search target type
 */
export type QueryTarget = 'status' | 'metrics' | 'history' | 'cost' | 'anomalies';

/**
* Log analysis mode
 */
export type AnalyzeMode = 'normal' | 'attack' | 'live';

/**
* Items that can be set
 */
export type ConfigSetting = 'autoScaling' | 'simulationMode' | 'zeroDowntimeEnabled';

/**
* Valid vCPU value (same as existing TargetVcpu type: 1 | 2 | 4)
 */
export type NLOpsTargetVcpu = 1 | 2 | 4;

/**
* NLOps Intent - Discriminated Union
* Required parameters are different for each intent type
 */
export type NLOpsIntent =
  | {
      type: 'query';
      target: QueryTarget;
      params?: Record<string, string>;
    }
  | {
      type: 'scale';
      targetVcpu: NLOpsTargetVcpu;
      force: boolean;
    }
  | {
      type: 'analyze';
      mode: AnalyzeMode;
    }
  | {
      type: 'config';
      setting: ConfigSetting;
      value: boolean;
    }
  | {
      type: 'explain';
      topic: string;
    }
  | {
      type: 'rca';
    }
  | {
      type: 'unknown';
      originalInput: string;
    };

// ============================================================
// Request/Response Types
// ============================================================

/**
* NLOps API request
 */
export interface NLOpsRequest {
/** User input message */
  message: string;
/** Confirm flag for dangerous operation (if true, approve execution) */
  confirmAction?: boolean;
}

/**
* NLOps API response
 */
export interface NLOpsResponse {
/** Classified intent */
  intent: NLOpsIntent;
/** Whether to execute (false if waiting for confirmation) */
  executed: boolean;
/** Natural language response message */
  response: string;
/** Execution result data (optional) */
  data?: Record<string, unknown>;
/** true if confirmation is required */
  needsConfirmation?: boolean;
/** Confirmation request message */
  confirmationMessage?: string;
/** Suggest follow-up questions */
  suggestedFollowUp?: string[];
}

// ============================================================
// Chat UI Types
// ============================================================

/**
* Chat message role
 */
export type ChatRole = 'user' | 'assistant';

/**
* Chat messages
 */
export interface ChatMessage {
/** Unique identifier */
  id: string;
/** Message role (user or assistant) */
  role: ChatRole;
/** Message content */
  content: string;
/** Timestamp (ISO 8601) */
  timestamp: string;
/** Classified intent (if assistant message) */
  intent?: NLOpsIntent;
/** Execution result data (in case of assistant message) */
  data?: Record<string, unknown>;
/** Whether waiting for confirmation */
  awaitingConfirmation?: boolean;
}

/**
* Chat status
 */
export interface ChatState {
/** Whether to open chat panel */
  isOpen: boolean;
/** Message list */
  messages: ChatMessage[];
/** Message being entered */
  inputValue: string;
/** Whether transmitting */
  isSending: boolean;
/** Task awaiting confirmation */
  pendingConfirmation: {
    message: string;
    originalInput: string;
    intent: NLOpsIntent;
  } | null;
}

// ============================================================
// Internal Engine Types
// ============================================================

/**
* Intent classification results
 */
export interface IntentClassificationResult {
  intent: NLOpsIntent;
  requireConfirmation: boolean;
  clarification?: string;
}

/**
* Action execution result
 */
export interface ActionExecutionResult {
  executed: boolean;
  result: Record<string, unknown> | null;
  error?: string;
}

/**
* Current system state (used as context when classifying intent)
 */
export interface CurrentSystemState {
  vcpu: number;
  memoryGiB: number;
  autoScalingEnabled: boolean;
  simulationMode: boolean;
  cpuUsage: number;
  txPoolCount: number;
  cooldownRemaining: number;
}
```

---

## 3. New file specification

### 3.1 `src/lib/nlops-engine.ts`

The core processing engine of NLOps. Responsible for intent classification, action routing, and command processing.

**Key Design Principles:**
- AI calls must use the `chatCompletion()` function in `src/lib/ai-client.ts`
- Log analysis directly calls the `analyzeLogChunk()` function in `src/lib/ai-analyzer.ts`.
- Anomaly detection, RCA, and cost reports call existing API endpoints using fetch.

```typescript
/**
 * NLOps Engine - Natural Language Operations Processing Engine
* Core logic of natural language command processing
 *
* AI 호출: chatCompletion() from src/lib/ai-client.ts
* Log analysis: analyzeLogChunk() from src/lib/ai-analyzer.ts
 */

import type {
  NLOpsIntent,
  NLOpsResponse,
  IntentClassificationResult,
  ActionExecutionResult,
  CurrentSystemState,
  NLOpsTargetVcpu,
  QueryTarget,
  AnalyzeMode,
  ConfigSetting,
} from '@/types/nlops';
import { chatCompletion } from '@/lib/ai-client';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { getAllLiveLogs } from '@/lib/log-ingester';

// ============================================================
// Constants
// ============================================================

const NLOPS_ENABLED = process.env.NLOPS_ENABLED !== 'false';

/**
* Dangerous action types that require confirmation
 */
const DANGEROUS_ACTION_TYPES: NLOpsIntent['type'][] = ['scale', 'config'];

// ============================================================
// Intent Classification
// ============================================================

/**
* System prompt for intent classification
 */
const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `You are a command interpreter for SentinAI, an Optimism L2 node monitoring and auto-scaling system.

Your task is to classify user input into one of the following intent types:

## Available Intent Types

1. **query** - Check current status, metrics, history, cost, or anomalies
   - target: "status" | "metrics" | "history" | "cost" | "anomalies"
   - params: optional key-value pairs for filtering

2. **scale** - Change vCPU allocation
   - targetVcpu: 1 | 2 | 4 (only these values are valid)
   - force: boolean (true if user explicitly says to force/override)

3. **analyze** - Run AI log analysis
   - mode: "normal" | "attack" | "live"

4. **config** - Update system settings
   - setting: "autoScaling" | "simulationMode" | "zeroDowntimeEnabled"
   - value: boolean

5. **explain** - Explain a concept, metric, or current state
   - topic: string describing what to explain

6. **rca** - Trigger Root Cause Analysis
   - No parameters needed

7. **unknown** - Cannot understand the user's intent
   - originalInput: the original user message

## Classification Rules

1. Support BOTH Korean and English input
2. For "scale" intent, extract the target vCPU value (must be 1, 2, or 4)
3. For "query" intent, determine the most appropriate target based on keywords
4. For "config" intent, extract both the setting name and desired value
5. If the request is ambiguous, prefer "query/status" over "unknown"
6. Set requireConfirmation=true for "scale" and "config" intents

## Common Patterns

Korean:
- “Current status” → query/status
- “Show me metrics” → query/metrics
- “How much does it cost” / “Cost analysis” → query/cost
- “Anomaly detection” / “Anomaly status” → query/anomalies
- “Scaling up to 4 vCPU” / “Scaling up to 4 cores” → scale/4
- "Reduce to 1 vCPU" / "Scale down" → scale/1
- “Analyze the log” → analyze/live
- “Turn on auto scaling” → config/autoScaling/true
- “Turn off auto scaling” → config/autoScaling/false
- “Turn on simulation mode” → config/simulationMode/true
- “Turn on non-stop scaling” → config/zeroDowntimeEnabled/true
- “Why is my CPU high?” → explain
- “Root cause analysis” / “RCA execution” → rca

English:
- "current status" → query/status
- "show metrics" → query/metrics
- "how much does it cost" → query/cost
- "show anomalies" → query/anomalies
- "scale up to 4 vCPU" → scale/4
- "analyze logs" → analyze/live
- "enable auto-scaling" → config/autoScaling/true
- "run root cause analysis" → rca

Respond ONLY with a valid JSON object (no markdown code blocks):
{
  "intent": { "type": "<type>", ... },
  "requireConfirmation": <boolean>,
  "clarification": "<optional>"
}`;

/**
* Creating user prompts for intent classification
 */
function buildIntentClassificationUserPrompt(
  userInput: string,
  currentState: CurrentSystemState
): string {
  return `User input: "${userInput}"

Current system state:
- vCPU: ${currentState.vcpu}
- Memory: ${currentState.memoryGiB} GiB
- Auto-scaling: ${currentState.autoScalingEnabled ? 'enabled' : 'disabled'}
- Simulation mode: ${currentState.simulationMode ? 'enabled' : 'disabled'}
- CPU usage: ${currentState.cpuUsage.toFixed(1)}%
- TxPool pending: ${currentState.txPoolCount}
- Cooldown remaining: ${currentState.cooldownRemaining}s

Parse the user's intent and respond with a JSON object.`;
}

/**
* Classify user input as Intent
 *
* use modelTier: 'fast' (Haiku) in chatCompletion() — fast classification
 */
export async function classifyIntent(
  userInput: string,
  currentState: CurrentSystemState
): Promise<IntentClassificationResult> {
  if (!userInput.trim()) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      requireConfirmation: false,
    };
  }

  try {
    const result = await chatCompletion({
      systemPrompt: INTENT_CLASSIFICATION_SYSTEM_PROMPT,
      userPrompt: buildIntentClassificationUserPrompt(userInput, currentState),
      modelTier: 'fast',
      temperature: 0.1,
    });

    const jsonStr = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const intent = normalizeIntent(parsed.intent, userInput);
    const requireConfirmation =
      parsed.requireConfirmation === true || DANGEROUS_ACTION_TYPES.includes(intent.type);

    return {
      intent,
      requireConfirmation,
      clarification: parsed.clarification,
    };
  } catch (error) {
    console.error('[NLOps] Intent classification failed:', error);
    return {
      intent: { type: 'unknown', originalInput: userInput },
      requireConfirmation: false,
    };
  }
}

/**
* Intent normalization and validation
 */
function normalizeIntent(rawIntent: Record<string, unknown>, originalInput: string): NLOpsIntent {
  const type = rawIntent.type as string;

  switch (type) {
    case 'query': {
      const validTargets: QueryTarget[] = ['status', 'metrics', 'history', 'cost', 'anomalies'];
      const target = (rawIntent.target as QueryTarget) || 'status';
      return {
        type: 'query',
        target: validTargets.includes(target) ? target : 'status',
        params: (rawIntent.params as Record<string, string>) || undefined,
      };
    }

    case 'scale': {
      const validVcpus: NLOpsTargetVcpu[] = [1, 2, 4];
      const targetVcpu = Number(rawIntent.targetVcpu) as NLOpsTargetVcpu;
      if (!validVcpus.includes(targetVcpu)) {
        return { type: 'unknown', originalInput };
      }
      return { type: 'scale', targetVcpu, force: rawIntent.force === true };
    }

    case 'analyze': {
      const validModes: AnalyzeMode[] = ['normal', 'attack', 'live'];
      const mode = (rawIntent.mode as AnalyzeMode) || 'live';
      return { type: 'analyze', mode: validModes.includes(mode) ? mode : 'live' };
    }

    case 'config': {
      const validSettings: ConfigSetting[] = ['autoScaling', 'simulationMode', 'zeroDowntimeEnabled'];
      const setting = rawIntent.setting as ConfigSetting;
      if (!validSettings.includes(setting)) {
        return { type: 'unknown', originalInput };
      }
      return { type: 'config', setting, value: rawIntent.value === true };
    }

    case 'explain':
      return { type: 'explain', topic: (rawIntent.topic as string) || originalInput };

    case 'rca':
      return { type: 'rca' };

    default:
      return { type: 'unknown', originalInput };
  }
}

// ============================================================
// Action Execution
// ============================================================

/**
Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
 */
export async function executeAction(
  intent: NLOpsIntent,
  baseUrl: string,
  confirmAction?: boolean
): Promise<ActionExecutionResult> {
  if (DANGEROUS_ACTION_TYPES.includes(intent.type) && !confirmAction) {
    return { executed: false, result: null };
  }

  try {
    switch (intent.type) {
      case 'query':
        return await executeQueryAction(intent.target, baseUrl, intent.params);
      case 'scale':
        return await executeScaleAction(intent.targetVcpu, baseUrl);
      case 'analyze':
        return await executeAnalyzeAction(intent.mode);
      case 'config':
        return await executeConfigAction(intent.setting, intent.value, baseUrl);
      case 'explain':
        return await executeExplainAction(intent.topic);
      case 'rca':
        return await executeRcaAction(baseUrl);
      case 'unknown':
        return { executed: false, result: null, error: 'Cannot understand the command' };
      default:
        return { executed: false, result: null, error: 'Unsupported intent type' };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NLOps] Action execution failed:', errorMessage);
    return { executed: false, result: null, error: errorMessage };
  }
}

/**
* Execute Query action
 */
async function executeQueryAction(
  target: QueryTarget,
  baseUrl: string,
  params?: Record<string, string>
): Promise<ActionExecutionResult> {
  const queryParams = new URLSearchParams(params || {}).toString();

  switch (target) {
    case 'status': {
      const [metricsRes, scalerRes] = await Promise.all([
        fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' }),
        fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' }),
      ]);
      if (!metricsRes.ok || !scalerRes.ok) throw new Error('Failed to fetch status');
      const [metricsData, scalerData] = await Promise.all([metricsRes.json(), scalerRes.json()]);
      return { executed: true, result: { metrics: metricsData, scaler: scalerData } };
    }

    case 'metrics': {
      const res = await fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch metrics');
      return { executed: true, result: await res.json() };
    }

    case 'history': {
      const res = await fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch scaler state');
      return { executed: true, result: await res.json() };
    }

    case 'cost': {
      const res = await fetch(
        `${baseUrl}/api/cost-report${queryParams ? `?${queryParams}` : '?days=7'}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error('Failed to fetch cost report');
      return { executed: true, result: await res.json() };
    }

    case 'anomalies': {
      const res = await fetch(
        `${baseUrl}/api/anomalies${queryParams ? `?${queryParams}` : ''}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw new Error('Failed to fetch anomalies');
      return { executed: true, result: await res.json() };
    }

    default:
      return { executed: false, result: null, error: 'Unknown query target' };
  }
}

/**
* Execute Scale action
 */
async function executeScaleAction(
  targetVcpu: NLOpsTargetVcpu,
  baseUrl: string
): Promise<ActionExecutionResult> {
  const response = await fetch(`${baseUrl}/api/scaler`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetVcpu }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Scale request failed: ${response.status}`);
  }

  return { executed: true, result: await response.json() };
}

/**
* Execute Analyze action
 *
* Note: There is no /api/analyze-logs route.
* Directly call analyzeLogChunk() in ai-analyzer.ts.
 */
async function executeAnalyzeAction(mode: AnalyzeMode): Promise<ActionExecutionResult> {
  try {
    const logs = await getAllLiveLogs();
    const analysis = await analyzeLogChunk(logs);

    return {
      executed: true,
      result: {
        source: 'ai-analyzer',
        mode,
        analysis: {
          severity: analysis.severity,
          summary: analysis.summary,
          action_item: analysis.action_item,
          timestamp: analysis.timestamp,
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
throw new Error(`Log analysis failed: ${errorMessage}`);
  }
}

/**
* Execute Config action
 *
* Use existing PATCH /api/scaler endpoint
* Supported fields: autoScalingEnabled, simulationMode, zeroDowntimeEnabled
 */
async function executeConfigAction(
  setting: ConfigSetting,
  value: boolean,
  baseUrl: string
): Promise<ActionExecutionResult> {
  const bodyMap: Record<ConfigSetting, Record<string, boolean>> = {
    autoScaling: { autoScalingEnabled: value },
    simulationMode: { simulationMode: value },
    zeroDowntimeEnabled: { zeroDowntimeEnabled: value },
  };

  const response = await fetch(`${baseUrl}/api/scaler`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyMap[setting]),
  });

  if (!response.ok) throw new Error(`Config update failed: ${response.status}`);

  return { executed: true, result: await response.json() };
}

/**
* Execute Explain action (return static knowledge)
 */
async function executeExplainAction(topic: string): Promise<ActionExecutionResult> {
  const explanations: Record<string, string> = {
cpu: 'CPU utilization indicates the processing load on the client executing op-geth. High CPU means high transaction processing or block synchronization.',
vcpu: 'vCPU is the number of virtual CPU cores. SentinAI dynamically scales between 1, 2, and 4 vCPUs to optimize costs.',
txpool: 'TxPool is a pool of transactions waiting to be processed. If TxPool continues to increase, batcher delay or network congestion may be suspected.',
autoscaling: 'Auto scaling is a function that automatically adjusts vCPU by combining CPU, Gas utilization, TxPool, and AI analysis results.',
cooldown: 'Cooldown is a waiting period to prevent continuous scaling. The default is 5 minutes (300 seconds).',
fargate: 'AWS Fargate is a serverless container execution environment. SentinAI runs op-geth on Fargate and is billed based on vCPU/memory.',
optimism: 'Optimism is an Ethereum L2 rollup solution. It consists of op-geth (execution), op-node (consensus), op-batcher (batch submission), and op-proposer (state proposal) components.',
scaling: 'The scaling score is calculated with CPU (30%), Gas (30%), TxPool (20%), and AI (20%) weights. Below 30, this scales to 1 vCPU, below 70 scales to 2 vCPU, and above 70 scales to 4 vCPU.',
rca: 'Root cause analysis (RCA) traces the cause of the problem by analyzing the dependency relationships between op-geth, op-node, op-batcher, op-proposer, and L1 when detecting an anomaly.',
anomaly: 'Anomaly detection uses a combination of Z-Score based statistical methods and rule-based (block plateau, TxPool monotonic increase) methods.',
zerodowntime: 'Non-disruptive scaling is a Blue-Green strategy that first prepares new instances and then switches traffic to scale without downtime.',
  };

  const topicLower = topic.toLowerCase();
  let explanation: string | undefined;

  for (const [key, value] of Object.entries(explanations)) {
    if (topicLower.includes(key) || key.includes(topicLower)) {
      explanation = value;
      break;
    }
  }

  return {
    executed: true,
    result: {
      topic,
explanation: explanation || No description found for `"${topic}". Try keywords such as cpu, vcpu, txpool, autoscaling, cooldown, fargate, optimism, rca, anomaly, etc.`,
    },
  };
}

/**
* Execute RCA action
 *
* Use existing POST /api/rca endpoint
 */
async function executeRcaAction(baseUrl: string): Promise<ActionExecutionResult> {
  const response = await fetch(`${baseUrl}/api/rca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoTriggered: false }),
  });

if (!response.ok) throw new Error(`RCA analysis failed: ${response.status}`);

  return { executed: true, result: await response.json() };
}

// ============================================================
// Main Command Processor
// ============================================================

/**
* Check current system status
 */
async function fetchCurrentState(baseUrl: string): Promise<CurrentSystemState> {
  try {
    const [metricsRes, scalerRes] = await Promise.all([
      fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' }),
      fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' }),
    ]);

    const metricsData = metricsRes.ok ? await metricsRes.json() : {};
    const scalerData = scalerRes.ok ? await scalerRes.json() : {};

    return {
      vcpu: metricsData.metrics?.gethVcpu || scalerData.currentVcpu || 1,
      memoryGiB: metricsData.metrics?.gethMemGiB || scalerData.currentMemoryGiB || 2,
      autoScalingEnabled: scalerData.autoScalingEnabled ?? true,
      simulationMode: scalerData.simulationMode ?? true,
      cpuUsage: metricsData.metrics?.cpuUsage || 0,
      txPoolCount: metricsData.metrics?.txPoolCount || 0,
      cooldownRemaining: scalerData.cooldownRemaining || 0,
    };
  } catch (error) {
    console.error('[NLOps] Failed to fetch current state:', error);
    return {
      vcpu: 1, memoryGiB: 2, autoScalingEnabled: true,
      simulationMode: true, cpuUsage: 0, txPoolCount: 0, cooldownRemaining: 0,
    };
  }
}

/**
* NLOps main command processing function
 */
export async function processCommand(
  userInput: string,
  baseUrl: string,
  confirmAction?: boolean
): Promise<NLOpsResponse> {
  if (!NLOPS_ENABLED) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      executed: false,
response: 'NLOps feature is disabled.',
    };
  }

  const currentState = await fetchCurrentState(baseUrl);
  const { intent, requireConfirmation, clarification } = await classifyIntent(userInput, currentState);

// If confirmation is required and not yet confirmed
  if (requireConfirmation && !confirmAction) {
    const confirmMessage = generateConfirmationMessage(intent);
    const { generateResponse } = await import('./nlops-responder');
    const response = await generateResponse(intent, null, false);

    return {
      intent,
      executed: false,
      response,
      needsConfirmation: true,
      confirmationMessage: confirmMessage,
suggestedFollowUp: ['Cancel', 'Confirm'],
    };
  }

// action execution
  const actionResult = await executeAction(intent, baseUrl, confirmAction);

// generate response
  const { generateResponse, getSuggestedFollowUps } = await import('./nlops-responder');
  const response = await generateResponse(intent, actionResult.result, actionResult.executed);
  const suggestedFollowUp = getSuggestedFollowUps(intent);

  return {
    intent,
    executed: actionResult.executed,
response: clarification ? `${response}\n\n(참고: ${clarification})` : response,
    data: actionResult.result || undefined,
    suggestedFollowUp,
  };
}

/**
* Generate confirmation message
 */
function generateConfirmationMessage(intent: NLOpsIntent): string {
  switch (intent.type) {
    case 'scale':
return `Do you want to scale to ${intent.targetVcpu} vCPU?`;
    case 'config': {
      const settingNames: Record<ConfigSetting, string> = {
autoScaling: 'Auto scaling',
simulationMode: 'Simulation mode',
zeroDowntimeEnabled: 'Non-disruptive scaling',
      };
const action = intent.value ? 'enabled' : 'deactivated';
return `Do you want ${action} ${settingNames[intent.setting]}?`;
    }
    default:
return 'Do you want to run this task?';
  }
}

/**
* Check NLOps activation status
 */
export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
```

### 3.2 `src/lib/nlops-responder.ts`

A module that converts execution results into natural language responses.

**Key Design Principles:**
- AI calls use `chatCompletion()` (modelTier: 'fast')
- Omit AI call when static response is possible (token saving)

```typescript
/**
 * NLOps Responder - Natural Language Response Generator
* Convert execution results into natural language responses
 *
* AI 호출: chatCompletion() from src/lib/ai-client.ts
 */

import type { NLOpsIntent } from '@/types/nlops';
import { chatCompletion } from '@/lib/ai-client';

// ============================================================
// Response Generation
// ============================================================

const RESPONSE_SYSTEM_PROMPT = `You are a helpful assistant for SentinAI, an Optimism L2 node monitoring system.

Your task is to convert structured data into natural, friendly Korean responses.

## Guidelines
1. ALWAYS respond in Korean
2. Be concise but informative
3. Format numbers nicely (e.g., 1,234 instead of 1234)
4. Include relevant metrics and status information
5. If an action failed, explain why and suggest alternatives
6. Use a professional but friendly tone

## Formatting
- Use bullet points for lists
- Keep responses under 200 words
- Don't use markdown headers (# or ##)

## Response Structure
1. Main status/result
2. Key metrics (if applicable)
3. Brief explanation or next steps (if applicable)`;

/**
* Convert execution results into natural language responses
 */
export async function generateResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): Promise<string> {
// When static response is possible
  const staticResponse = getStaticResponse(intent, result, executed);
  if (staticResponse) return staticResponse;

// Generate natural language responses through AI
  try {
    const aiResult = await chatCompletion({
      systemPrompt: RESPONSE_SYSTEM_PROMPT,
      userPrompt: `Generate a Korean response for the following:

Intent type: ${intent.type}
Intent details: ${JSON.stringify(intent)}
Executed: ${executed}
Result data: ${JSON.stringify(result, null, 2)}

If executed is false and result is null, it means the action needs user confirmation.
If there's an error, explain it kindly and suggest what to do.`,
      modelTier: 'fast',
      temperature: 0.3,
    });

    return aiResult.content;
  } catch (error) {
    return getFallbackResponse(intent, result, executed);
  }
}

/**
* Static response (returns immediately without AI call)
 */
function getStaticResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string | null {
// Waiting for confirmation
  if (!executed && result === null) {
    switch (intent.type) {
      case 'scale':
return `${intent.targetVcpu} Attempting to scale to vCPU. To continue, click 'OK'.`;
      case 'config': {
        const names: Record<string, string> = {
autoScaling: 'Auto scaling',
simulationMode: 'Simulation mode',
zeroDowntimeEnabled: 'Non-disruptive scaling',
        };
const action = intent.value ? 'enabled' : 'deactivated';
return `Attempting to ${action} ${names[intent.setting]}. To continue, click 'OK'.`;
      }
    }
  }

  if (intent.type === 'unknown') {
return 'Sorry, I didn't understand your command. Try commands like "current status", "analyze logs", and "scale to 2 vCPU"';
  }

// explain uses static response
  if (intent.type === 'explain' && result) {
    const explanation = (result as Record<string, string>)?.explanation;
    if (explanation) return explanation;
  }

  return null;
}

/**
* Fallback response (in case of AI failure)
 */
function getFallbackResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string {
if (!executed) return 'The task execution failed. Please try again later.';

  switch (intent.type) {
    case 'query': {
      if (intent.target === 'status') {
        const metrics = (result as Record<string, Record<string, unknown>>)?.metrics?.metrics;
        if (metrics) {
return `Current state: ${metrics.gethVcpu || 1} vCPU, CPU ${(metrics.cpuUsage as number)?.toFixed(1) || 0}%, TxPool ${metrics.txPoolCount || 0} waiting`;
        }
      }
return 'Data was viewed.';
    }
    case 'scale':
return `스케일링 완료: ${(result as Record<string, unknown>)?.previousVcpu || '?'} → ${(result as Record<string, unknown>)?.currentVcpu || intent.targetVcpu} vCPU`;
    case 'analyze':
      return (result as Record<string, Record<string, unknown>>)?.analysis?.summary
        ? String((result as Record<string, Record<string, unknown>>).analysis.summary)
: 'Log analysis completed.';
    case 'config':
return 'Settings have been changed.';
    case 'rca':
return 'Root cause analysis has been run.';
    default:
return 'The operation has been completed.';
  }
}

// ============================================================
// Follow-up Suggestions
// ============================================================

export function getSuggestedFollowUps(intent: NLOpsIntent): string[] {
  switch (intent.type) {
    case 'query':
      switch (intent.target) {
case 'status': return ['Analyze logs', 'Check costs', 'Show me abnormal status'];
case 'metrics': return ['Tell me the current status', 'Show me the scaling history'];
case 'cost': return ['Tell me the current status', 'Tell me how to reduce costs'];
case 'anomalies': return ['Analyze the root cause', 'Analyze the log'];
case 'history': return ['Tell me the current status', 'Check the cost'];
default: return ['Tell me the current status'];
      }
case 'scale': return ['Check the current status', 'Tell me how much it costs'];
case 'analyze': return ['Analyze the root cause', 'Show me the status of the problem', 'Tell me the current status'];
case 'config': return ['Tell me the current status', 'Check the settings'];
case 'explain': return ['Tell me the current status', 'Tell me something else'];
case 'rca': return ['Analyze the log', 'Tell me the current status', 'Show me the status of abnormalities'];
case 'unknown': return ['Tell me the current status', 'Analyze the log', 'Help'];
default: return ['Tell me the current status'];
  }
}
```

### 3.3 `src/app/api/nlops/route.ts`

NLOps API endpoint.

```typescript
/**
 * NLOps API Endpoint
 * POST: Process natural language commands
 * GET: Health check & info
 */

import { NextRequest, NextResponse } from 'next/server';
import { processCommand, isNLOpsEnabled } from '@/lib/nlops-engine';
import type { NLOpsRequest, NLOpsResponse } from '@/types/nlops';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse<NLOpsResponse | { error: string }>> {
  if (!isNLOpsEnabled()) {
    return NextResponse.json(
      { error: 'NLOps is disabled. Set NLOPS_ENABLED=true to enable.' },
      { status: 503 }
    );
  }

  try {
    const body: NLOpsRequest = await request.json();
    const { message, confirmAction } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }
    if (message.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ error: 'Message is too long (max 500 characters)' }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const response = await processCommand(message, baseUrl, confirmAction);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[NLOps API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to process command',
        intent: { type: 'unknown' as const, originalInput: '' },
        executed: false,
response: `An error occurred while processing the command: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}

function getBaseUrl(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    enabled: isNLOpsEnabled(),
    version: '1.0.0',
    supportedIntents: ['query', 'scale', 'analyze', 'config', 'explain', 'rca'],
    supportedLanguages: ['ko', 'en'],
  });
}
```

---

## 4. Edit existing files

### 4.1 Modify `src/app/page.tsx`

Add chat UI to the dashboard. Toggle button and slide-up panel fixed at the bottom of the screen.

#### 4.1.1 Add Import

Add to the import section at the top of the file (add icon to `lucide-react` import + type import):

```typescript
// Icon to add to existing lucide-react import:
// MessageSquare, Send, Bot, User, X

// new import to add:
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
```

#### 4.1.2 State added

Add below the existing state declaration block of the `Dashboard` component (near the costReport state):

```typescript
// --- NLOps Chat State ---
const [chatOpen, setChatOpen] = useState(false);
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState('');
const [isSending, setIsSending] = useState(false);
const [pendingConfirmation, setPendingConfirmation] = useState<{
  message: string;
  originalInput: string;
  intent: NLOpsIntent;
} | null>(null);
const chatMessagesEndRef = useRef<HTMLDivElement>(null);
```

#### 4.1.3 Add Chat handler function

Add below `fetchCostReport` function:

```typescript
// --- NLOps Chat Handlers ---

useEffect(() => {
  if (chatMessagesEndRef.current) {
    chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }
}, [chatMessages]);

const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const sendChatMessage = async (message: string, confirmAction?: boolean) => {
  if (!message.trim() && !confirmAction) return;

  const userMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'user',
content: confirmAction? '확인': message.trim(),
    timestamp: new Date().toISOString(),
  };

  if (!confirmAction) {
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
  }

  setIsSending(true);

  try {
    const response = await fetch('/api/nlops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: confirmAction ? pendingConfirmation?.originalInput : message.trim(),
        confirmAction,
      }),
    });

    const data: NLOpsResponse = await response.json();

    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: data.response,
      timestamp: new Date().toISOString(),
      intent: data.intent,
      data: data.data,
      awaitingConfirmation: data.needsConfirmation,
    };

    setChatMessages(prev => [...prev, assistantMessage]);

    if (data.needsConfirmation && data.confirmationMessage) {
      setPendingConfirmation({
        message: data.confirmationMessage,
        originalInput: message.trim(),
        intent: data.intent,
      });
    } else {
      setPendingConfirmation(null);
    }
  } catch (error) {
    const errorMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
content: 'Sorry, there was an error processing your request. Please try again later.',
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, errorMessage]);
    setPendingConfirmation(null);
  } finally {
    setIsSending(false);
  }
};

const handleConfirm = () => {
  if (pendingConfirmation) {
    sendChatMessage(pendingConfirmation.originalInput, true);
  }
};

const handleCancel = () => {
  const cancelMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'assistant',
content: 'The operation has been cancelled.',
    timestamp: new Date().toISOString(),
  };
  setChatMessages(prev => [...prev, cancelMessage]);
  setPendingConfirmation(null);
};

const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && !e.shiftKey && !isSending) {
    e.preventDefault();
    sendChatMessage(chatInput);
  }
};
```

#### 4.1.4 Chat UI JSX insertion location

**Exact insertion location**: Inside the `return` statement, below the closing `</div>` of the 3-column grid (`md:grid-cols-3`), and immediately before the main container `</div>`.

The last section in the current page.tsx is a 3-column grid containing the Documentation card.
Add the Chat UI after the grid's closing tag:

```tsx
{/* Existing 3-column grid closing tag */}
      </div>

      {/* ============================================================ */}
      {/* NLOps Chat Interface                                         */}
      {/* ============================================================ */}

      {/* Chat Toggle Button */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-full p-4 shadow-xl hover:bg-slate-800 transition-all hover:scale-105 z-50 flex items-center gap-2"
        >
          <MessageSquare size={24} />
<span className="text-sm font-semibold pr-1">SentinAI Assistant</span>
        </button>
      )}

      {/* Chat Panel */}
      {chatOpen && (
        <div className="fixed bottom-0 right-6 w-96 bg-white rounded-t-2xl shadow-2xl border border-gray-200 z-50 flex flex-col max-h-[600px]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-slate-900 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500 p-2 rounded-xl">
                <Bot size={18} className="text-white" />
              </div>
              <div>
<h3 className="font-bold text-white text-sm">SentinAI Ops Assistant</h3>
<p className="text-[10px] text-gray-400">Control your system with natural language</p>
              </div>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white transition-colors p-1">
              <ChevronDown size={20} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[400px] bg-gray-50">
            {chatMessages.length === 0 && (
              <div className="text-center text-gray-400 mt-8">
                <Bot size={40} className="mx-auto mb-3 opacity-50" />
<p className="text-sm">Hello! This is SentinAI assistant.</p>
<p className="text-xs mt-1">Click on the example below or enter it yourself.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
{['Current status', 'Analyze log', 'Check cost'].map((example) => (
                    <button key={example} onClick={() => sendChatMessage(example)}
                      className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-full hover:border-blue-300 hover:text-blue-600 transition-colors">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                    : 'bg-white text-gray-800 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm'
                } px-4 py-3`}>
                  <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && <Bot size={12} className="text-blue-500" />}
                    <span className={`text-[10px] ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
{msg.role === 'user' ? '나' : 'SentinAI'}
                    </span>
                    {msg.role === 'user' && <User size={12} className="text-blue-100" />}
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-300'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-500 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm px-4 py-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Confirmation */}
          {pendingConfirmation && (
            <div className="px-4 py-3 bg-yellow-50 border-t border-yellow-100">
              <p className="text-sm text-yellow-800 mb-2 font-medium">{pendingConfirmation.message}</p>
              <div className="flex gap-2">
                <button onClick={handleConfirm} disabled={isSending}
                  className="flex-1 bg-blue-500 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50">
check
                </button>
                <button onClick={handleCancel} disabled={isSending}
                  className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50">
cancellation
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-100 bg-white">
            <div className="flex items-center gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
onKeyDown={handleChatKeyDown} placeholder="Enter the command..."
                disabled={isSending || !!pendingConfirmation}
                className="flex-1 bg-gray-100 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" />
              <button onClick={() => sendChatMessage(chatInput)}
                disabled={isSending || !chatInput.trim() || !!pendingConfirmation}
                className="bg-blue-500 text-white p-3 rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

{/* main container closing tag */}
    </div>
  );
}
```

---

## 5. API Specification

### 5.1 POST /api/nlops

Process natural language commands.

#### Request

```typescript
interface NLOpsRequest {
message: string;           // Required, 1-500 characters
confirmAction?: boolean;   // Optional, true when checking for dangerous operations
}
```

#### Response

```typescript
interface NLOpsResponse {
  intent: NLOpsIntent;
  executed: boolean;
  response: string;
  data?: Record<string, unknown>;
  needsConfirmation?: boolean;
  confirmationMessage?: string;
  suggestedFollowUp?: string[];
}
```

#### Example: Status query

```json
// Request
{ "message": "Tell me your current status" }

// Response
{
  "intent": { "type": "query", "target": "status" },
  "executed": true,
"response": "Currently the system is operating normally with 1 vCPU.\n\n- CPU Utilization: 12.5%\n- TxPool Standbys: 23\n- Autoscaling: Enabled\n- Estimated monthly cost: $42",
  "data": { "metrics": { ... }, "scaler": { ... } },
"suggestedFollowUp": ["Analyze logs", "Check costs", "Show me abnormal status"]
}
```

#### Example: Scaling (requires confirmation)

```json
// Request 1 (initial request)
{ "message": "Scale up to 4 vCPU" }

// Response 1 (waiting for confirmation)
{
  "intent": { "type": "scale", "targetVcpu": 4, "force": false },
  "executed": false,
"response": "You are about to scale to 4 vCPU. Click 'OK' to continue.",
  "needsConfirmation": true,
"confirmationMessage": "Do you want to scale to 4 vCPU?"
}

// Request 2 (Confirm)
{ "message": "Scale up to 4 vCPU", "confirmAction": true }

// Response 2 (execution complete)
{
  "intent": { "type": "scale", "targetVcpu": 4, "force": false },
  "executed": true,
"response": "Scaling completed!\nPrevious: 1 vCPU / 2 GiB\nCurrent: 4 vCPU / 8 GiB"
}
```

#### Example: Log analysis

```json
// Request
{ "message": "Please analyze the log" }

// Response
{
  "intent": { "type": "analyze", "mode": "live" },
  "executed": true,
"response": "This is the result of log analysis.\n\nSeverity: normal\n\nAll components are operating normally.",
  "data": {
    "source": "ai-analyzer",
    "mode": "live",
    "analysis": {
      "severity": "normal",
      "summary": "All components operating normally.",
      "action_item": "No action required."
    }
  }
}
```

### 5.2 GET /api/nlops

```json
{
  "enabled": true,
  "version": "1.0.0",
  "supportedIntents": ["query", "scale", "analyze", "config", "explain", "rca"],
  "supportedLanguages": ["ko", "en"]
}
```

---

## 6. AI Prompt Professional

### 6.1 Intent Classification Prompt

System prompt: See `INTENT_CLASSIFICATION_SYSTEM_PROMPT` in section 3.1

### 6.2 Response Generation Prompt

System prompt: see `RESPONSE_SYSTEM_PROMPT` in section 3.2

---

## 7. Environment variables

### 7.1 New

```bash
# Enable NLOps (default: true)
NLOPS_ENABLED=true
```

### 7.2 Existing (required, already set)

```bash
# AI Client (ai-client.ts automatically detects)
ANTHROPIC_API_KEY=sk-xxx
AI_GATEWAY_URL=https://api.ai.tokamak.network # optional, via proxy

# Base URL
NEXT_PUBLIC_BASE_URL=http://localhost:3002
```

---

## 8. Test verification

### 8.1 API testing (curl)

```bash
# 1. Status inquiry
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Tell me the current status"}'

# 2. Metric lookup (English)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "show me the metrics"}'

# 3. Scaling request (awaiting confirmation)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Upgrade to 4 vCPU"}'

#4. Check scaling
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Upgrade to 4 vCPU", "confirmAction": true}'

# 5. Log analysis (call ai-analyzer.ts directly)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Please analyze the log"}'

# 6. Anomaly detection query
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Show me the status of an error"}'

#7. RCA Analysis
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Analyze the root cause"}'

# 8. Cost Report
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "How much does it cost"}'

# 9. Change settings
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Turn off automatic scaling", "confirmAction": true}'

# 10. Ask for clarification
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "What is a vCPU?"}'

# 11. Check NLOps status
curl http://localhost:3002/api/nlops

# 12. Error case: Empty message
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
# Expected: 400

# 13. Error case: Invalid vCPU (3)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
-d '{"message": "Scale to 3 vCPU"}'
# Expected: unknown intent
```

### 8.2 UI testing checklist

1. **Chat Panel**
- Click the [ ] button at the bottom right → Open the panel
- Click the [ ] header arrow → close the panel
- [ ] Hide toggle button when panel is open

2. **Send message**
- Send with [ ] Enter key
- [ ] Empty message cannot be sent
- [ ] Loading indicator during transfer (bounce dots)

3. **Confirmation Flow**
- [ ] Scaling request → confirmation dialog
- [ ] OK → Run
- [ ] Cancel → Cancel message

4. **Example Button**
- [ ] Show example in empty chat
- Click [ ] to send the corresponding command

---

## 9. Dependencies

### 9.1 Internal module dependencies

```
nlops-engine.ts
├── ai-client.ts # chatCompletion() - Intent 분류
├── ai-analyzer.ts # analyzeLogChunk() - Log analysis
├── log-ingester.ts # getAllLiveLogs() - Log collection
└── nlops-responder.ts # generateResponse() - Generate response
└── ai-client.ts # chatCompletion() - Generate response

/api/nlops/route.ts
  └── nlops-engine.ts        # processCommand()
```

### 9.2 API endpoint dependencies

| Intent | API call | method |
|--------|----------|--------|
| query/status | `/api/metrics` + `/api/scaler` | GET |
| query/metrics | `/api/metrics` | GET |
| query/history | `/api/scaler` | GET |
| query/cost | `/api/cost-report?days=7` | GET |
| query/anomalies | `/api/anomalies` | GET |
| scale | `/api/scaler` | POST |
| analyze | Call `analyzeLogChunk()` directly | - |
| config | `/api/scaler` | PATCH |
| explain | static response | - |
| rca | `/api/rca` | POST |

---

## 10. Command mapping table

### 10.1 Korean commands

| Command example | Intent | call target |
|-------------|--------|----------|
| “Current status” / “Tell me the status” | query/status | GET /api/metrics + /api/scaler |
| “Show me the metrics” | query/metrics | GET /api/metrics |
| "Scaling Records" | query/history | GET /api/scaler |
| “How much does it cost” / “Cost analysis” | query/cost | GET /api/cost-report |
| “Anomaly Status” / “Anomaly Detection” | query/anomalies | GET /api/anomalies |
| "Up to 4 vCPU" | scale/4 | POST /api/scaler |
| "Reduce to 1 vCPU" | scale/1 | POST /api/scaler |
| “Analyze logs” | analyze/live | analyzeLogChunk() |
| “Turn on automatic scaling” | config/autoScaling/true | PATCH /api/scaler |
| "Turn off simulation mode" | config/simulationMode/false | PATCH /api/scaler |
| “Turn on non-stop scaling” | config/zeroDowntimeEnabled/true | PATCH /api/scaler |
| “What is a CPU?” | explain/cpu | static response |
| “Root Cause Analysis” | rca | POST /api/rca |

### 10.2 English commands

| Command Example | Intent | Target |
|-----------------|--------|--------|
| "current status" | query/status | GET /api/metrics + /api/scaler |
| "show metrics" | query/metrics | GET /api/metrics |
| "how much does it cost" | query/cost | GET /api/cost-report |
| "show anomalies" | query/anomalies | GET /api/anomalies |
| "scale up to 4 vCPU" | scale/4 | POST /api/scaler |
| "analyze logs" | analyze/live | analyzeLogChunk() |
| "enable auto-scaling" | config/autoScaling/true | PATCH /api/scaler |
| "run root cause analysis" | rca | POST /api/rca |

---

## Appendix A: File Creation/Modification Checklist

### A.1 New files (4)

- [ ] `src/types/nlops.ts` — Type definitions
- [ ] `src/lib/nlops-engine.ts` — Core engine
- [ ] `src/lib/nlops-responder.ts` — Response generator
- [ ] `src/app/api/nlops/route.ts` — API endpoint

### A.2 Modified files (2)

- [ ] `src/app/page.tsx` — Chat UI 추가 (import, state, handlers, JSX)
- [ ] `.env.local.sample` — NLOPS_ENABLED 추가

### A.3 Preferences

- [ ] `.env.local` — NLOPS_ENABLED=true 추가

---

## Appendix B: Expected Token Usage

| Features | AI model | call frequency | expected token/call |
|------|---------|----------|---------------|
| Intent Classification | Haiku 4.5 (fast) | Every message | ~300 |
| Response Generation | Haiku 4.5 (fast) | Complex responses only | ~700 |
| Explain | None (static) | - | 0 |

- Response Generation AI call is omitted when using static response
- Expect approximately 300 to 1000 tokens per message on average

---

*End of Document*
