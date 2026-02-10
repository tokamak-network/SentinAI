/**
 * NLOps Engine - Natural Language Operations Processing Engine
 * Core logic for processing natural language commands
 *
 * AI calls: chatCompletion() from src/lib/ai-client.ts
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
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import { generateResponse, getSuggestedFollowUps } from '@/lib/nlops-responder';

// ============================================================
// Constants
// ============================================================

const NLOPS_ENABLED = process.env.NLOPS_ENABLED !== 'false';

const DANGEROUS_ACTION_TYPES: NLOpsIntent['type'][] = ['scale', 'config'];

// ============================================================
// Intent Classification
// ============================================================

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
- "현재 상태" → query/status
- "메트릭 보여줘" → query/metrics
- "비용 얼마야" / "비용 분석" → query/cost
- "이상 탐지" / "이상 현황" → query/anomalies
- "4 vCPU로 스케일업" / "4코어로 올려" → scale/4
- "1 vCPU로 줄여" / "스케일다운" → scale/1
- "로그 분석 해줘" → analyze/live
- "자동 스케일링 켜줘" → config/autoScaling/true
- "자동 스케일링 꺼줘" → config/autoScaling/false
- "시뮬레이션 모드 켜줘" → config/simulationMode/true
- "무중단 스케일링 켜줘" → config/zeroDowntimeEnabled/true
- "왜 CPU가 높아?" → explain
- "근본 원인 분석" / "RCA 실행" → rca

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
 * Classify user input into an Intent
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
 * Normalize and validate intent
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
    throw new Error((errorData as Record<string, string>).error || `Scale request failed: ${response.status}`);
  }

  return { executed: true, result: await response.json() };
}

/**
 * Execute analyze action
 * Calls analyzeLogChunk() from ai-analyzer.ts directly
 */
async function executeAnalyzeAction(mode: AnalyzeMode): Promise<ActionExecutionResult> {
  let logs: Record<string, string>;

  try {
    logs = await getAllLiveLogs();
  } catch {
    // Use mock logs when K8s is not connected
    logs = generateMockLogs(mode === 'attack' ? 'attack' : 'normal');
  }

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
}

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

async function executeExplainAction(topic: string): Promise<ActionExecutionResult> {
  const explanations: Record<string, string> = {
    cpu: 'CPU usage indicates the processing load of the op-geth execution client. High CPU means either high transaction throughput or block synchronization in progress.',
    vcpu: 'vCPU is the number of virtual CPU cores. SentinAI dynamically scales between 1, 2, and 4 vCPU to optimize costs.',
    txpool: 'TxPool is the pool of transactions waiting to be processed. A continuously growing TxPool may indicate batcher delays or network congestion.',
    autoscaling: 'Auto-scaling automatically adjusts vCPU based on a hybrid score combining CPU (30%), Gas (30%), TxPool (20%), and AI severity (20%).',
    cooldown: 'Cooldown is the waiting period to prevent consecutive scaling operations. The default is 5 minutes (300 seconds).',
    fargate: 'AWS Fargate is a serverless container runtime. SentinAI runs op-geth on Fargate and is billed based on vCPU and memory usage.',
    optimism: 'Optimism is an Ethereum L2 rollup solution consisting of op-geth (execution), op-node (consensus), op-batcher (batch submission), and op-proposer (state proposals).',
    scaling: 'The scaling score is calculated with weights: CPU (30%), Gas (30%), TxPool (20%), AI (20%). Below 30 → 1 vCPU, below 70 → 2 vCPU, 70 or above → 4 vCPU.',
    rca: 'Root Cause Analysis (RCA) uses AI to trace fault propagation across op-geth, op-node, op-batcher, op-proposer, and L1 dependency relationships when anomalies are detected.',
    anomaly: 'Anomaly detection combines Z-Score statistical methods with rule-based detection (block plateau, TxPool monotonic increase).',
    zerodowntime: 'Zero-downtime scaling uses a Blue-Green strategy: prepares a new instance first, then switches traffic to achieve scaling without downtime.',
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
      explanation: explanation || `No explanation found for "${topic}". Try keywords like cpu, vcpu, txpool, autoscaling, cooldown, fargate, optimism, rca, anomaly.`,
    },
  };
}

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
 * NLOps main command processor
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
      response: 'NLOps is currently disabled.',
    };
  }

  const currentState = await fetchCurrentState(baseUrl);
  const { intent, requireConfirmation, clarification } = await classifyIntent(userInput, currentState);

  // Requires confirmation but not yet confirmed
  if (requireConfirmation && !confirmAction) {
    const confirmMessage = generateConfirmationMessage(intent);
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

  // Execute action
  const actionResult = await executeAction(intent, baseUrl, confirmAction);

  // Generate response
  const response = await generateResponse(intent, actionResult.result, actionResult.executed);
  const suggestedFollowUp = getSuggestedFollowUps(intent);

  return {
    intent,
    executed: actionResult.executed,
    response: clarification ? `${response}\n\n(Note: ${clarification})` : response,
    data: actionResult.result || undefined,
    suggestedFollowUp,
  };
}

function generateConfirmationMessage(intent: NLOpsIntent): string {
  switch (intent.type) {
    case 'scale':
      return `Scale to ${intent.targetVcpu} vCPU?`;
    case 'config': {
      const settingNames: Record<ConfigSetting, string> = {
        autoScaling: 'Auto-scaling',
        simulationMode: 'Simulation mode',
        zeroDowntimeEnabled: 'Zero-downtime scaling',
      };
      const action = intent.value ? 'enable' : 'disable';
      return `${action.charAt(0).toUpperCase() + action.slice(1)} ${settingNames[intent.setting]}?`;
    }
    default:
      return 'Proceed with this action?';
  }
}

export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
