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
 * 사용자 입력을 Intent로 분류
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
 * Intent 정규화 및 유효성 검증
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
 * Analyze 액션 실행
 * ai-analyzer.ts의 analyzeLogChunk()를 직접 호출
 */
async function executeAnalyzeAction(mode: AnalyzeMode): Promise<ActionExecutionResult> {
  let logs: Record<string, string>;

  try {
    logs = await getAllLiveLogs();
  } catch {
    // K8s 미연결 시 mock 로그 사용
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
    cpu: 'CPU 사용률은 op-geth 실행 클라이언트의 처리 부하를 나타냅니다. 높은 CPU는 트랜잭션 처리량이 많거나 블록 동기화 중임을 의미합니다.',
    vcpu: 'vCPU는 가상 CPU 코어 수입니다. SentinAI는 1, 2, 4 vCPU 사이에서 동적으로 스케일링하여 비용을 최적화합니다.',
    txpool: 'TxPool은 처리 대기 중인 트랜잭션 풀입니다. TxPool이 지속적으로 증가하면 batcher 지연이나 네트워크 정체를 의심해볼 수 있습니다.',
    autoscaling: '자동 스케일링은 CPU, Gas 사용률, TxPool, AI 분석 결과를 종합하여 자동으로 vCPU를 조절하는 기능입니다.',
    cooldown: '쿨다운은 연속적인 스케일링을 방지하기 위한 대기 시간입니다. 기본값은 5분(300초)입니다.',
    fargate: 'AWS Fargate는 서버리스 컨테이너 실행 환경입니다. SentinAI는 Fargate에서 op-geth를 실행하며 vCPU/메모리 기반으로 과금됩니다.',
    optimism: 'Optimism은 이더리움 L2 롤업 솔루션입니다. op-geth(실행), op-node(합의), op-batcher(배치 제출), op-proposer(상태 제안) 컴포넌트로 구성됩니다.',
    scaling: '스케일링 점수는 CPU(30%), Gas(30%), TxPool(20%), AI(20%) 가중치로 계산됩니다. 30 미만이면 1 vCPU, 70 미만이면 2 vCPU, 70 이상이면 4 vCPU로 조정됩니다.',
    rca: '근본 원인 분석(RCA)은 이상 탐지 시 AI가 op-geth, op-node, op-batcher, op-proposer, L1 간의 의존 관계를 분석하여 문제의 원인을 추적합니다.',
    anomaly: '이상 탐지는 Z-Score 기반 통계적 방법과 규칙 기반(블록 plateau, TxPool monotonic increase) 방법을 함께 사용합니다.',
    zerodowntime: '무중단 스케일링은 Blue-Green 전략으로 새 인스턴스를 먼저 준비한 후 트래픽을 전환하여 다운타임 없이 스케일링합니다.',
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
      explanation: explanation || `"${topic}"에 대한 설명을 찾을 수 없습니다. cpu, vcpu, txpool, autoscaling, cooldown, fargate, optimism, rca, anomaly 등의 키워드를 시도해보세요.`,
    },
  };
}

async function executeRcaAction(baseUrl: string): Promise<ActionExecutionResult> {
  const response = await fetch(`${baseUrl}/api/rca`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoTriggered: false }),
  });

  if (!response.ok) throw new Error(`RCA 분석 실패: ${response.status}`);

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
 * NLOps 메인 명령 처리 함수
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
      response: 'NLOps 기능이 비활성화되어 있습니다.',
    };
  }

  const currentState = await fetchCurrentState(baseUrl);
  const { intent, requireConfirmation, clarification } = await classifyIntent(userInput, currentState);

  // 확인이 필요하고 아직 확인되지 않은 경우
  if (requireConfirmation && !confirmAction) {
    const confirmMessage = generateConfirmationMessage(intent);
    const response = await generateResponse(intent, null, false);

    return {
      intent,
      executed: false,
      response,
      needsConfirmation: true,
      confirmationMessage: confirmMessage,
      suggestedFollowUp: ['취소', '확인'],
    };
  }

  // 액션 실행
  const actionResult = await executeAction(intent, baseUrl, confirmAction);

  // 응답 생성
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

function generateConfirmationMessage(intent: NLOpsIntent): string {
  switch (intent.type) {
    case 'scale':
      return `${intent.targetVcpu} vCPU로 스케일링을 실행하시겠습니까?`;
    case 'config': {
      const settingNames: Record<ConfigSetting, string> = {
        autoScaling: '자동 스케일링',
        simulationMode: '시뮬레이션 모드',
        zeroDowntimeEnabled: '무중단 스케일링',
      };
      const action = intent.value ? '활성화' : '비활성화';
      return `${settingNames[intent.setting]}을(를) ${action}하시겠습니까?`;
    }
    default:
      return '이 작업을 실행하시겠습니까?';
  }
}

export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
