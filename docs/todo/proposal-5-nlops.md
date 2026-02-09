# Proposal 5: Natural Language Ops (NLOps) - 구현 명세서

> 작성일: 2026-02-06
> 대상: Claude Opus 4.6 구현 에이전트
> 목적: 이 문서만으로 NLOps 기능을 완전히 구현할 수 있도록 모든 세부사항 제공

---

## 목차

1. [개요](#1-개요)
2. [타입 정의](#2-타입-정의)
3. [신규 파일 명세](#3-신규-파일-명세)
   - 3.1 [nlops-engine.ts](#31-srclibinlops-enginets)
   - 3.2 [nlops-responder.ts](#32-srclibnlops-responderts)
   - 3.3 [NLOps API Route](#33-srcappapinlopsroutets)
4. [기존 파일 수정](#4-기존-파일-수정)
   - 4.1 [page.tsx 수정](#41-srcappppagetsx-수정)
5. [API 명세](#5-api-명세)
6. [AI 프롬프트 전문](#6-ai-프롬프트-전문)
7. [환경 변수](#7-환경-변수)
8. [테스트 검증](#8-테스트-검증)
9. [의존관계](#9-의존관계)
10. [명령어 매핑 표](#10-명령어-매핑-표)

---

## 1. 개요

### 1.1 목표

**Natural Language Operations (NLOps)** 는 자연어 명령으로 SentinAI를 제어할 수 있는 대화형 인터페이스다.
운영자가 GUI 버튼 대신 "현재 상태 알려줘", "4 vCPU로 스케일업" 같은 자연어로 시스템을 조작한다.

### 1.2 핵심 흐름

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────────────┐
│ User Input      │     │ Intent Classifier    │     │ Action Router      │
│ (Chat UI)       │────▶│ (Claude AI)          │────▶│ (기존 API 호출)     │
└─────────────────┘     └──────────────────────┘     └─────────┬──────────┘
                                                               │
                        ┌──────────────────────┐               │
                        │ Response Generator   │◀──────────────┘
                        │ (자연어 응답 생성)    │
                        └──────────────────────┘
```

### 1.3 주요 기능

1. **Intent Classification**: 사용자 입력을 구조화된 의도(Intent)로 분류
2. **Action Router**: 의도에 따라 적절한 내부 API 호출
3. **Confirmation Flow**: 위험한 작업(스케일링, 설정 변경)은 확인 단계 필요
4. **Natural Response**: 실행 결과를 자연어로 변환하여 응답

### 1.4 지원 언어

- **입력**: 한국어 및 영어 모두 지원
- **출력**: 한국어로 응답 (UI-facing text 한글 원칙)

### 1.5 독립성

NLOps는 기존 API(`/api/metrics`, `/api/scaler`, `/api/analyze-logs`)만 사용하여 독립적으로 동작한다.
Proposal 1~4가 구현되면 추가 기능(`/api/anomalies`, `/api/rca`, `/api/cost-report`)도 활용 가능하다.

---

## 2. 타입 정의

### 2.1 파일: `src/types/nlops.ts` (신규 생성)

```typescript
/**
 * NLOps (Natural Language Operations) Type Definitions
 * 자연어 기반 운영 인터페이스를 위한 타입 정의
 */

import type { TargetVcpu } from './scaling';

// ============================================================
// Intent Types (의도 분류)
// ============================================================

/**
 * 조회 대상 타입
 */
export type QueryTarget = 'status' | 'metrics' | 'history' | 'cost' | 'anomalies';

/**
 * 로그 분석 모드
 */
export type AnalyzeMode = 'normal' | 'attack' | 'live';

/**
 * 설정 가능한 항목
 */
export type ConfigSetting = 'autoScaling' | 'simulationMode';

/**
 * NLOps 의도 - Discriminated Union
 * 각 의도 타입별로 필요한 파라미터가 다름
 */
export type NLOpsIntent =
  | {
      type: 'query';
      target: QueryTarget;
      params?: Record<string, string>;
    }
  | {
      type: 'scale';
      targetVcpu: TargetVcpu;
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
 * NLOps API 요청
 */
export interface NLOpsRequest {
  /** 사용자 입력 메시지 */
  message: string;
  /** 위험한 작업에 대한 확인 플래그 (true면 실행 승인) */
  confirmAction?: boolean;
}

/**
 * NLOps API 응답
 */
export interface NLOpsResponse {
  /** 분류된 의도 */
  intent: NLOpsIntent;
  /** 실행 여부 (확인 대기 중이면 false) */
  executed: boolean;
  /** 자연어 응답 메시지 */
  response: string;
  /** 실행 결과 데이터 (선택적) */
  data?: Record<string, unknown>;
  /** 확인이 필요한 경우 true */
  needsConfirmation?: boolean;
  /** 확인 요청 메시지 */
  confirmationMessage?: string;
  /** 후속 질문 제안 */
  suggestedFollowUp?: string[];
}

// ============================================================
// Chat UI Types
// ============================================================

/**
 * 채팅 메시지 역할
 */
export type ChatRole = 'user' | 'assistant';

/**
 * 채팅 메시지
 */
export interface ChatMessage {
  /** 고유 식별자 */
  id: string;
  /** 메시지 역할 (user 또는 assistant) */
  role: ChatRole;
  /** 메시지 내용 */
  content: string;
  /** 타임스탬프 (ISO 8601) */
  timestamp: string;
  /** 분류된 의도 (assistant 메시지인 경우) */
  intent?: NLOpsIntent;
  /** 실행 결과 데이터 (assistant 메시지인 경우) */
  data?: Record<string, unknown>;
  /** 확인 대기 중인지 여부 */
  awaitingConfirmation?: boolean;
}

/**
 * 채팅 상태
 */
export interface ChatState {
  /** 채팅 패널 열림 여부 */
  isOpen: boolean;
  /** 메시지 목록 */
  messages: ChatMessage[];
  /** 입력 중인 메시지 */
  inputValue: string;
  /** 전송 중 여부 */
  isSending: boolean;
  /** 확인 대기 중인 작업 */
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
 * Intent 분류 결과
 */
export interface IntentClassificationResult {
  intent: NLOpsIntent;
  requireConfirmation: boolean;
  clarification?: string;
}

/**
 * 액션 실행 결과
 */
export interface ActionExecutionResult {
  executed: boolean;
  result: Record<string, unknown> | null;
  error?: string;
}

/**
 * 현재 시스템 상태 (Intent 분류 시 컨텍스트로 사용)
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

// ============================================================
// AI Gateway Types
// ============================================================

/**
 * AI Gateway 채팅 메시지 형식
 */
export interface AIGatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * AI Gateway 요청 형식
 */
export interface AIGatewayRequest {
  model: string;
  messages: AIGatewayMessage[];
  temperature: number;
}

/**
 * AI Gateway 응답 형식
 */
export interface AIGatewayResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  output?: string;
}
```

---

## 3. 신규 파일 명세

### 3.1 `src/lib/nlops-engine.ts`

NLOps의 핵심 처리 엔진. Intent 분류, 액션 라우팅, 명령 처리를 담당한다.

```typescript
/**
 * NLOps Engine - Natural Language Operations Processing Engine
 * 자연어 명령 처리의 핵심 로직
 */

import type {
  NLOpsIntent,
  NLOpsResponse,
  IntentClassificationResult,
  ActionExecutionResult,
  CurrentSystemState,
  AIGatewayMessage,
  AIGatewayResponse,
  TargetVcpu,
  QueryTarget,
  AnalyzeMode,
  ConfigSetting,
} from '@/types/nlops';

// ============================================================
// Constants
// ============================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const NLOPS_ENABLED = process.env.NLOPS_ENABLED !== 'false';

/**
 * 확인이 필요한 위험한 액션 타입
 */
const DANGEROUS_ACTION_TYPES: NLOpsIntent['type'][] = ['scale', 'config'];

// ============================================================
// Intent Classification
// ============================================================

/**
 * Intent 분류를 위한 시스템 프롬프트
 */
const INTENT_CLASSIFICATION_SYSTEM_PROMPT = `You are a command interpreter for SentinAI, an Optimism L2 node monitoring and auto-scaling system.

Your task is to classify user input into one of the following intent types:

## Available Intent Types

1. **query** - Check current status, metrics, history, or cost
   - target: "status" | "metrics" | "history" | "cost" | "anomalies"
   - params: optional key-value pairs for filtering

2. **scale** - Change vCPU allocation
   - targetVcpu: 1 | 2 | 4 (only these values are valid)
   - force: boolean (true if user explicitly says to force/override)

3. **analyze** - Run AI log analysis
   - mode: "normal" | "attack" | "live"

4. **config** - Update system settings
   - setting: "autoScaling" | "simulationMode"
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
- "자동 스케일링 켜줘" / "자동 스케일링 활성화" → config/autoScaling/true
- "자동 스케일링 꺼줘" → config/autoScaling/false
- "시뮬레이션 모드 켜줘" → config/simulationMode/true
- "왜 CPU가 높아?" / "CPU 설명해줘" → explain
- "근본 원인 분석" / "RCA 실행" → rca

English:
- "current status" / "what's the status" → query/status
- "show metrics" → query/metrics
- "how much does it cost" → query/cost
- "scale up to 4 vCPU" / "set 4 cores" → scale/4
- "scale down to 1" → scale/1
- "analyze logs" → analyze/live
- "enable auto-scaling" → config/autoScaling/true
- "run root cause analysis" → rca

## Response Format

You MUST respond with a valid JSON object (no markdown code blocks):
{
  "intent": {
    "type": "<intent_type>",
    // ... type-specific fields
  },
  "requireConfirmation": <boolean>,
  "clarification": "<optional clarification message if ambiguous>"
}`;

/**
 * Intent 분류를 위한 사용자 프롬프트 생성
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
 * AI Gateway 호출
 */
async function callAIGateway(messages: AIGatewayMessage[]): Promise<string> {
  const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'claude-haiku-4.5',
      messages,
      temperature: 0.1, // Low temperature for consistent classification
    }),
  });

  if (!response.ok) {
    throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText}`);
  }

  const data: AIGatewayResponse = await response.json();
  const content = data.choices?.[0]?.message?.content || data.output || '';

  // Clean up markdown if AI wraps it in ```json ... ```
  return content.replace(/```json/g, '').replace(/```/g, '').trim();
}

/**
 * 사용자 입력을 Intent로 분류
 */
export async function classifyIntent(
  userInput: string,
  currentState: CurrentSystemState
): Promise<IntentClassificationResult> {
  // 빈 입력 처리
  if (!userInput.trim()) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      requireConfirmation: false,
    };
  }

  try {
    const messages: AIGatewayMessage[] = [
      { role: 'system', content: INTENT_CLASSIFICATION_SYSTEM_PROMPT },
      { role: 'user', content: buildIntentClassificationUserPrompt(userInput, currentState) },
    ];

    const responseText = await callAIGateway(messages);
    const parsed = JSON.parse(responseText);

    // Validate and normalize the intent
    const intent = normalizeIntent(parsed.intent, userInput);
    const requireConfirmation =
      parsed.requireConfirmation === true || DANGEROUS_ACTION_TYPES.includes(intent.type);

    return {
      intent,
      requireConfirmation,
      clarification: parsed.clarification,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NLOps] Intent classification failed:', errorMessage);

    // Fallback to unknown intent
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
      const validVcpus: TargetVcpu[] = [1, 2, 4];
      const targetVcpu = Number(rawIntent.targetVcpu) as TargetVcpu;
      if (!validVcpus.includes(targetVcpu)) {
        return { type: 'unknown', originalInput };
      }
      return {
        type: 'scale',
        targetVcpu,
        force: rawIntent.force === true,
      };
    }

    case 'analyze': {
      const validModes: AnalyzeMode[] = ['normal', 'attack', 'live'];
      const mode = (rawIntent.mode as AnalyzeMode) || 'live';
      return {
        type: 'analyze',
        mode: validModes.includes(mode) ? mode : 'live',
      };
    }

    case 'config': {
      const validSettings: ConfigSetting[] = ['autoScaling', 'simulationMode'];
      const setting = rawIntent.setting as ConfigSetting;
      if (!validSettings.includes(setting)) {
        return { type: 'unknown', originalInput };
      }
      return {
        type: 'config',
        setting,
        value: rawIntent.value === true,
      };
    }

    case 'explain':
      return {
        type: 'explain',
        topic: (rawIntent.topic as string) || originalInput,
      };

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
 * Intent에 따른 액션 실행
 */
export async function executeAction(
  intent: NLOpsIntent,
  baseUrl: string,
  confirmAction?: boolean
): Promise<ActionExecutionResult> {
  // 위험한 액션은 확인 필요
  if (DANGEROUS_ACTION_TYPES.includes(intent.type) && !confirmAction) {
    return {
      executed: false,
      result: null,
    };
  }

  try {
    switch (intent.type) {
      case 'query':
        return await executeQueryAction(intent.target, baseUrl, intent.params);

      case 'scale':
        return await executeScaleAction(intent.targetVcpu, baseUrl);

      case 'analyze':
        return await executeAnalyzeAction(intent.mode, baseUrl);

      case 'config':
        return await executeConfigAction(intent.setting, intent.value, baseUrl);

      case 'explain':
        return await executeExplainAction(intent.topic);

      case 'rca':
        return await executeRcaAction(baseUrl);

      case 'unknown':
        return {
          executed: false,
          result: null,
          error: 'Cannot understand the command',
        };

      default:
        return {
          executed: false,
          result: null,
          error: 'Unsupported intent type',
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NLOps] Action execution failed:', errorMessage);
    return {
      executed: false,
      result: null,
      error: errorMessage,
    };
  }
}

/**
 * Query 액션 실행
 */
async function executeQueryAction(
  target: QueryTarget,
  baseUrl: string,
  params?: Record<string, string>
): Promise<ActionExecutionResult> {
  let endpoint = '';
  const queryParams = new URLSearchParams(params || {}).toString();

  switch (target) {
    case 'status':
      // Fetch both metrics and scaler state
      const [metricsRes, scalerRes] = await Promise.all([
        fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' }),
        fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' }),
      ]);

      if (!metricsRes.ok || !scalerRes.ok) {
        throw new Error('Failed to fetch status');
      }

      const [metricsData, scalerData] = await Promise.all([metricsRes.json(), scalerRes.json()]);

      return {
        executed: true,
        result: {
          metrics: metricsData,
          scaler: scalerData,
        },
      };

    case 'metrics':
      endpoint = '/api/metrics';
      break;

    case 'history':
      // Scaling history from scaler API
      endpoint = '/api/scaler';
      break;

    case 'cost':
      // Try cost-report API first (Proposal 4), fallback to metrics
      try {
        const costRes = await fetch(`${baseUrl}/api/cost-report`, { cache: 'no-store' });
        if (costRes.ok) {
          return { executed: true, result: await costRes.json() };
        }
      } catch {
        // Fallback to metrics cost data
      }
      endpoint = '/api/metrics';
      break;

    case 'anomalies':
      // Try anomalies API (Proposal 2), return empty if not available
      try {
        const anomaliesRes = await fetch(
          `${baseUrl}/api/anomalies${queryParams ? `?${queryParams}` : ''}`,
          { cache: 'no-store' }
        );
        if (anomaliesRes.ok) {
          return { executed: true, result: await anomaliesRes.json() };
        }
      } catch {
        // Anomalies API not available
      }
      return {
        executed: true,
        result: { events: [], total: 0, message: '이상 탐지 기능이 아직 활성화되지 않았습니다.' },
      };
  }

  const response = await fetch(`${baseUrl}${endpoint}${queryParams ? `?${queryParams}` : ''}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return {
    executed: true,
    result: await response.json(),
  };
}

/**
 * Scale 액션 실행
 */
async function executeScaleAction(
  targetVcpu: TargetVcpu,
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

  return {
    executed: true,
    result: await response.json(),
  };
}

/**
 * Analyze 액션 실행
 */
async function executeAnalyzeAction(
  mode: AnalyzeMode,
  baseUrl: string
): Promise<ActionExecutionResult> {
  const response = await fetch(`${baseUrl}/api/analyze-logs?mode=${mode}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Analyze request failed: ${response.status}`);
  }

  return {
    executed: true,
    result: await response.json(),
  };
}

/**
 * Config 액션 실행
 */
async function executeConfigAction(
  setting: ConfigSetting,
  value: boolean,
  baseUrl: string
): Promise<ActionExecutionResult> {
  const body: Record<string, boolean> = {};

  if (setting === 'autoScaling') {
    body.autoScalingEnabled = value;
  } else if (setting === 'simulationMode') {
    body.simulationMode = value;
  }

  const response = await fetch(`${baseUrl}/api/scaler`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Config update failed: ${response.status}`);
  }

  return {
    executed: true,
    result: await response.json(),
  };
}

/**
 * Explain 액션 실행 (정적 지식 반환)
 */
async function executeExplainAction(topic: string): Promise<ActionExecutionResult> {
  // 정적 지식 베이스에서 관련 설명 반환
  const explanations: Record<string, string> = {
    cpu: 'CPU 사용률은 op-geth 실행 클라이언트의 처리 부하를 나타냅니다. 높은 CPU는 트랜잭션 처리량이 많거나 블록 동기화 중임을 의미합니다.',
    vcpu: 'vCPU는 가상 CPU 코어 수입니다. SentinAI는 1, 2, 4 vCPU 사이에서 동적으로 스케일링하여 비용을 최적화합니다.',
    txpool:
      'TxPool은 처리 대기 중인 트랜잭션 풀입니다. TxPool이 지속적으로 증가하면 batcher 지연이나 네트워크 정체를 의심해볼 수 있습니다.',
    autoscaling:
      '자동 스케일링은 CPU, Gas 사용률, TxPool, AI 분석 결과를 종합하여 자동으로 vCPU를 조절하는 기능입니다.',
    cooldown:
      '쿨다운은 연속적인 스케일링을 방지하기 위한 대기 시간입니다. 기본값은 5분(300초)입니다.',
    fargate:
      'AWS Fargate는 서버리스 컨테이너 실행 환경입니다. SentinAI는 Fargate에서 op-geth를 실행하며 vCPU/메모리 기반으로 과금됩니다.',
    optimism:
      'Optimism은 이더리움 L2 롤업 솔루션입니다. op-geth(실행), op-node(합의), op-batcher(배치 제출), op-proposer(상태 제안) 컴포넌트로 구성됩니다.',
    scaling:
      '스케일링 점수는 CPU(30%), Gas(30%), TxPool(20%), AI(20%) 가중치로 계산됩니다. 30 미만이면 1 vCPU, 70 미만이면 2 vCPU, 70 이상이면 4 vCPU로 조정됩니다.',
  };

  const topicLower = topic.toLowerCase();
  let explanation = explanations[topicLower];

  if (!explanation) {
    // 키워드 매칭 시도
    for (const [key, value] of Object.entries(explanations)) {
      if (topicLower.includes(key) || key.includes(topicLower)) {
        explanation = value;
        break;
      }
    }
  }

  return {
    executed: true,
    result: {
      topic,
      explanation: explanation || `"${topic}"에 대한 설명을 찾을 수 없습니다. 다른 키워드로 시도해보세요.`,
    },
  };
}

/**
 * RCA 액션 실행
 */
async function executeRcaAction(baseUrl: string): Promise<ActionExecutionResult> {
  // Try RCA API (Proposal 3)
  try {
    const response = await fetch(`${baseUrl}/api/rca`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      return {
        executed: true,
        result: await response.json(),
      };
    }
  } catch {
    // RCA API not available
  }

  // Fallback: run log analysis instead
  const analyzeRes = await fetch(`${baseUrl}/api/analyze-logs?mode=live`, { cache: 'no-store' });

  if (!analyzeRes.ok) {
    throw new Error('RCA 기능이 아직 활성화되지 않았고, 대체 로그 분석도 실패했습니다.');
  }

  const analyzeData = await analyzeRes.json();
  return {
    executed: true,
    result: {
      ...analyzeData,
      message: 'RCA 기능이 아직 활성화되지 않아 로그 분석으로 대체했습니다.',
    },
  };
}

// ============================================================
// Main Command Processor
// ============================================================

/**
 * 현재 시스템 상태 조회
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
      vcpu: 1,
      memoryGiB: 2,
      autoScalingEnabled: true,
      simulationMode: true,
      cpuUsage: 0,
      txPoolCount: 0,
      cooldownRemaining: 0,
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
  // NLOps 비활성화 체크
  if (!NLOPS_ENABLED) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      executed: false,
      response: 'NLOps 기능이 비활성화되어 있습니다.',
    };
  }

  // 현재 상태 조회
  const currentState = await fetchCurrentState(baseUrl);

  // Intent 분류
  const { intent, requireConfirmation, clarification } = await classifyIntent(userInput, currentState);

  // 확인이 필요하고 아직 확인되지 않은 경우
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
      suggestedFollowUp: ['취소', '확인'],
    };
  }

  // 액션 실행
  const actionResult = await executeAction(intent, baseUrl, confirmAction);

  // 응답 생성
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
 * 확인 메시지 생성
 */
function generateConfirmationMessage(intent: NLOpsIntent): string {
  switch (intent.type) {
    case 'scale':
      return `${intent.targetVcpu} vCPU로 스케일링을 실행하시겠습니까?`;
    case 'config':
      const settingName = intent.setting === 'autoScaling' ? '자동 스케일링' : '시뮬레이션 모드';
      const action = intent.value ? '활성화' : '비활성화';
      return `${settingName}을(를) ${action}하시겠습니까?`;
    default:
      return '이 작업을 실행하시겠습니까?';
  }
}

/**
 * NLOps 활성화 상태 확인
 */
export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
```

### 3.2 `src/lib/nlops-responder.ts`

실행 결과를 자연어 응답으로 변환하는 모듈.

```typescript
/**
 * NLOps Responder - Natural Language Response Generator
 * 실행 결과를 자연어 응답으로 변환
 */

import type { NLOpsIntent, AIGatewayMessage, AIGatewayResponse } from '@/types/nlops';

// ============================================================
// Constants
// ============================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ============================================================
// Response Generation
// ============================================================

/**
 * 응답 생성을 위한 시스템 프롬프트
 */
const RESPONSE_GENERATION_SYSTEM_PROMPT = `You are a helpful assistant for SentinAI, an Optimism L2 node monitoring system.

Your task is to convert structured data into natural, friendly Korean responses.

## Guidelines

1. ALWAYS respond in Korean (한국어)
2. Be concise but informative
3. Use technical terms when appropriate but explain them if complex
4. Format numbers nicely (e.g., 1,234 instead of 1234)
5. Include relevant metrics and status information
6. If an action failed, explain why and suggest alternatives
7. Use a professional but friendly tone

## Formatting

- Use bullet points for lists
- Highlight important values
- Keep responses under 200 words
- Don't use markdown headers (# or ##)

## Response Structure

1. Main status/result
2. Key metrics (if applicable)
3. Brief explanation or next steps (if applicable)`;

/**
 * 응답 생성을 위한 사용자 프롬프트 생성
 */
function buildResponseGenerationPrompt(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string {
  return `Generate a Korean response for the following:

Intent type: ${intent.type}
Intent details: ${JSON.stringify(intent)}
Executed: ${executed}
Result data: ${JSON.stringify(result, null, 2)}

If executed is false and result is null, it means the action needs user confirmation.
If there's an error, explain it kindly and suggest what to do.`;
}

/**
 * AI Gateway 호출
 */
async function callAIGateway(messages: AIGatewayMessage[]): Promise<string> {
  try {
    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4.5',
        messages,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI Gateway responded with ${response.status}`);
    }

    const data: AIGatewayResponse = await response.json();
    return data.choices?.[0]?.message?.content || data.output || '';
  } catch (error) {
    console.error('[NLOps Responder] AI Gateway call failed:', error);
    throw error;
  }
}

/**
 * 실행 결과를 자연어 응답으로 변환
 */
export async function generateResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): Promise<string> {
  // 빠른 응답이 필요한 경우 정적 응답 사용
  const staticResponse = getStaticResponse(intent, result, executed);
  if (staticResponse) {
    return staticResponse;
  }

  // AI를 통한 자연어 응답 생성
  try {
    const messages: AIGatewayMessage[] = [
      { role: 'system', content: RESPONSE_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: buildResponseGenerationPrompt(intent, result, executed) },
    ];

    return await callAIGateway(messages);
  } catch (error) {
    // AI 실패 시 폴백 응답
    return getFallbackResponse(intent, result, executed);
  }
}

/**
 * 정적 응답 (AI 호출 없이 즉시 반환 가능한 경우)
 */
function getStaticResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string | null {
  // 확인 대기 중
  if (!executed && result === null) {
    switch (intent.type) {
      case 'scale':
        return `${intent.targetVcpu} vCPU로 스케일링하려고 합니다. 계속하시려면 '확인'을 눌러주세요.`;
      case 'config':
        const settingName = intent.setting === 'autoScaling' ? '자동 스케일링' : '시뮬레이션 모드';
        const action = intent.value ? '활성화' : '비활성화';
        return `${settingName}을(를) ${action}하려고 합니다. 계속하시려면 '확인'을 눌러주세요.`;
      default:
        return null;
    }
  }

  // unknown intent
  if (intent.type === 'unknown') {
    return '죄송합니다, 명령을 이해하지 못했습니다. "현재 상태", "로그 분석", "2 vCPU로 스케일" 같은 명령을 시도해보세요.';
  }

  return null;
}

/**
 * 폴백 응답 (AI 실패 시)
 */
function getFallbackResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string {
  if (!executed) {
    return '작업을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }

  switch (intent.type) {
    case 'query':
      if (intent.target === 'status') {
        const metrics = (result as Record<string, Record<string, unknown>>)?.metrics?.metrics;
        const scaler = (result as Record<string, Record<string, unknown>>)?.scaler;
        if (metrics && scaler) {
          return `현재 상태: ${metrics.gethVcpu || 1} vCPU, CPU ${(metrics.cpuUsage as number)?.toFixed(1) || 0}%, TxPool ${metrics.txPoolCount || 0}개 대기 중`;
        }
      }
      return '데이터를 조회했습니다.';

    case 'scale':
      const scaleResult = result as Record<string, unknown>;
      return `스케일링 완료: ${scaleResult?.previousVcpu || '?'} → ${scaleResult?.currentVcpu || intent.targetVcpu} vCPU`;

    case 'analyze':
      const analysis = (result as Record<string, Record<string, unknown>>)?.analysis;
      return analysis?.summary ? String(analysis.summary) : '로그 분석을 완료했습니다.';

    case 'config':
      return `설정이 변경되었습니다.`;

    case 'explain':
      const explanation = (result as Record<string, string>)?.explanation;
      return explanation || '설명을 찾을 수 없습니다.';

    case 'rca':
      return '근본 원인 분석을 실행했습니다.';

    default:
      return '작업이 완료되었습니다.';
  }
}

// ============================================================
// Follow-up Suggestions
// ============================================================

/**
 * 후속 질문 제안
 */
export function getSuggestedFollowUps(intent: NLOpsIntent): string[] {
  switch (intent.type) {
    case 'query':
      switch (intent.target) {
        case 'status':
          return ['로그 분석 해줘', '비용 확인해줘', '이상 현황 보여줘'];
        case 'metrics':
          return ['현재 상태 알려줘', '스케일링 히스토리 보여줘'];
        case 'cost':
          return ['현재 상태 알려줘', '비용 절감 방법 알려줘'];
        case 'anomalies':
          return ['근본 원인 분석해줘', '로그 분석 해줘'];
        case 'history':
          return ['현재 상태 알려줘', '비용 확인해줘'];
        default:
          return ['현재 상태 알려줘'];
      }

    case 'scale':
      return ['현재 상태 확인해줘', '비용 얼마나 드는지 알려줘'];

    case 'analyze':
      return ['근본 원인 분석해줘', '이상 현황 보여줘', '현재 상태 알려줘'];

    case 'config':
      return ['현재 상태 알려줘', '설정 확인해줘'];

    case 'explain':
      return ['현재 상태 알려줘', '다른 것도 설명해줘'];

    case 'rca':
      return ['로그 분석 해줘', '현재 상태 알려줘', '이상 현황 보여줘'];

    case 'unknown':
      return ['현재 상태 알려줘', '로그 분석 해줘', '도움말'];

    default:
      return ['현재 상태 알려줘'];
  }
}
```

### 3.3 `src/app/api/nlops/route.ts`

NLOps API 엔드포인트.

```typescript
/**
 * NLOps API Endpoint
 * POST: Process natural language commands
 */

import { NextRequest, NextResponse } from 'next/server';
import { processCommand, isNLOpsEnabled } from '@/lib/nlops-engine';
import type { NLOpsRequest, NLOpsResponse } from '@/types/nlops';

export const dynamic = 'force-dynamic';

/**
 * POST /api/nlops - 자연어 명령 처리
 */
export async function POST(request: NextRequest): Promise<NextResponse<NLOpsResponse | { error: string }>> {
  // NLOps 활성화 확인
  if (!isNLOpsEnabled()) {
    return NextResponse.json(
      { error: 'NLOps is disabled. Set NLOPS_ENABLED=true to enable.' },
      { status: 503 }
    );
  }

  try {
    // 요청 파싱
    const body: NLOpsRequest = await request.json();
    const { message, confirmAction } = body;

    // 메시지 유효성 검사
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (message.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    if (message.length > 500) {
      return NextResponse.json({ error: 'Message is too long (max 500 characters)' }, { status: 400 });
    }

    // Base URL 결정
    const baseUrl = getBaseUrl(request);

    // 명령 처리
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
        response: `명령 처리 중 오류가 발생했습니다: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}

/**
 * Base URL 결정
 */
function getBaseUrl(request: NextRequest): string {
  // 환경 변수 우선
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL;
  }

  // Vercel 환경
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 요청 URL에서 추출
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * GET /api/nlops - Health check & info
 */
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

## 4. 기존 파일 수정

### 4.1 `src/app/page.tsx` 수정

대시보드에 채팅 UI를 추가한다. 화면 하단에 고정된 토글 버튼과 슬라이드업 패널 형태로 구현한다.

#### 4.1.1 Import 추가

파일 상단의 import 섹션에 추가:

```typescript
// 기존 import 아래에 추가
import { MessageSquare, Send, Bot, User, X, ChevronDown } from 'lucide-react';
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
```

#### 4.1.2 State 추가

`Dashboard` 컴포넌트의 기존 state 선언 아래에 추가:

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

#### 4.1.3 Chat 핸들러 함수 추가

기존 `checkLogs` 함수 아래에 추가:

```typescript
// --- NLOps Chat Handlers ---

/**
 * 채팅 메시지 스크롤
 */
useEffect(() => {
  if (chatMessagesEndRef.current) {
    chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }
}, [chatMessages]);

/**
 * 고유 ID 생성
 */
const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

/**
 * 채팅 메시지 전송
 */
const sendChatMessage = async (message: string, confirmAction?: boolean) => {
  if (!message.trim() && !confirmAction) return;

  const userMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'user',
    content: confirmAction ? '확인' : message.trim(),
    timestamp: new Date().toISOString(),
  };

  // 확인 작업이 아닌 경우에만 사용자 메시지 추가
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

    // 확인 대기 상태 업데이트
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
      content: '죄송합니다, 요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      timestamp: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, errorMessage]);
    setPendingConfirmation(null);
  } finally {
    setIsSending(false);
  }
};

/**
 * 확인 처리
 */
const handleConfirm = () => {
  if (pendingConfirmation) {
    sendChatMessage(pendingConfirmation.originalInput, true);
  }
};

/**
 * 취소 처리
 */
const handleCancel = () => {
  const cancelMessage: ChatMessage = {
    id: generateMessageId(),
    role: 'assistant',
    content: '작업이 취소되었습니다.',
    timestamp: new Date().toISOString(),
  };
  setChatMessages(prev => [...prev, cancelMessage]);
  setPendingConfirmation(null);
};

/**
 * 후속 질문 클릭 핸들러
 */
const handleFollowUpClick = (followUp: string) => {
  setChatInput(followUp);
};

/**
 * 키보드 이벤트 핸들러
 */
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter' && !e.shiftKey && !isSending) {
    e.preventDefault();
    sendChatMessage(chatInput);
  }
};
```

#### 4.1.4 Chat UI JSX 추가

`return` 문 내부, 메인 `</div>` 닫는 태그 바로 앞에 추가 (3-column grid 섹션 아래):

```tsx
{/* ============================================================ */}
{/* NLOps Chat Interface */}
{/* ============================================================ */}

{/* Chat Toggle Button (항상 표시) */}
{!chatOpen && (
  <button
    onClick={() => setChatOpen(true)}
    className="fixed bottom-6 right-6 bg-slate-900 text-white rounded-full p-4 shadow-xl hover:bg-slate-800 transition-all hover:scale-105 z-50 flex items-center gap-2"
  >
    <MessageSquare size={24} />
    <span className="text-sm font-semibold pr-1">SentinAI 어시스턴트</span>
  </button>
)}

{/* Chat Panel (슬라이드업) */}
{chatOpen && (
  <div className="fixed bottom-0 right-6 w-96 bg-white rounded-t-2xl shadow-2xl border border-gray-200 z-50 flex flex-col max-h-[600px]">

    {/* Header */}
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-slate-900 rounded-t-2xl">
      <div className="flex items-center gap-3">
        <div className="bg-blue-500 p-2 rounded-xl">
          <Bot size={18} className="text-white" />
        </div>
        <div>
          <h3 className="font-bold text-white text-sm">SentinAI Ops 어시스턴트</h3>
          <p className="text-[10px] text-gray-400">자연어로 시스템을 제어하세요</p>
        </div>
      </div>
      <button
        onClick={() => setChatOpen(false)}
        className="text-gray-400 hover:text-white transition-colors p-1"
      >
        <ChevronDown size={20} />
      </button>
    </div>

    {/* Messages Area */}
    <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[400px] bg-gray-50">
      {chatMessages.length === 0 && (
        <div className="text-center text-gray-400 mt-8">
          <Bot size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-sm">안녕하세요! SentinAI 어시스턴트입니다.</p>
          <p className="text-xs mt-1">아래 예시를 클릭하거나 직접 입력해보세요.</p>
          <div className="flex flex-wrap gap-2 justify-center mt-4">
            {['현재 상태', '로그 분석 해줘', '비용 확인'].map((example) => (
              <button
                key={example}
                onClick={() => sendChatMessage(example)}
                className="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded-full hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {chatMessages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[85%] ${
              msg.role === 'user'
                ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                : 'bg-white text-gray-800 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm'
            } px-4 py-3`}
          >
            {/* Role indicator */}
            <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && <Bot size={12} className="text-blue-500" />}
              <span className={`text-[10px] ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                {msg.role === 'user' ? '나' : 'SentinAI'}
              </span>
              {msg.role === 'user' && <User size={12} className="text-blue-100" />}
            </div>

            {/* Message content */}
            <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>

            {/* Data preview (for assistant messages with data) */}
            {msg.role === 'assistant' && msg.data && (
              <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                <p className="text-gray-500 font-semibold mb-1">상세 데이터</p>
                <pre className="text-gray-600 overflow-x-auto text-[10px]">
                  {JSON.stringify(msg.data, null, 2).slice(0, 200)}
                  {JSON.stringify(msg.data).length > 200 && '...'}
                </pre>
              </div>
            )}

            {/* Timestamp */}
            <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-300'}`}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>
      ))}

      {/* Typing indicator */}
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

    {/* Confirmation Dialog */}
    {pendingConfirmation && (
      <div className="px-4 py-3 bg-yellow-50 border-t border-yellow-100">
        <p className="text-sm text-yellow-800 mb-2 font-medium">
          {pendingConfirmation.message}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleConfirm}
            disabled={isSending}
            className="flex-1 bg-blue-500 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            확인
          </button>
          <button
            onClick={handleCancel}
            disabled={isSending}
            className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    )}

    {/* Suggested Follow-ups */}
    {chatMessages.length > 0 && !pendingConfirmation && (
      <div className="px-4 py-2 border-t border-gray-100 bg-white">
        <div className="flex flex-wrap gap-1.5">
          {['현재 상태', '로그 분석', '비용 확인'].map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => handleFollowUpClick(suggestion)}
              className="text-[11px] bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full hover:bg-blue-100 hover:text-blue-600 transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    )}

    {/* Input Area */}
    <div className="p-4 border-t border-gray-100 bg-white rounded-b-none">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="명령을 입력하세요..."
          disabled={isSending || !!pendingConfirmation}
          className="flex-1 bg-gray-100 border-none rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={() => sendChatMessage(chatInput)}
          disabled={isSending || !chatInput.trim() || !!pendingConfirmation}
          className="bg-blue-500 text-white p-3 rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  </div>
)}
```

#### 4.1.5 삽입 위치 명시

정확한 삽입 위치를 보여주는 컨텍스트:

**Before (기존 코드 끝 부분):**
```tsx
        {/* Documentation Card */}
        <div className="bg-gradient-to-br from-[#2D33EB] to-[#1E23A0] rounded-3xl p-8 text-white shadow-lg shadow-blue-900/20 relative overflow-hidden group h-full flex flex-col justify-between">
          {/* ... existing code ... */}
        </div>

      </div>
    </div>   {/* <-- 메인 컨테이너 닫는 태그 */}
  );
}
```

**After (Chat UI 추가 후):**
```tsx
        {/* Documentation Card */}
        <div className="bg-gradient-to-br from-[#2D33EB] to-[#1E23A0] rounded-3xl p-8 text-white shadow-lg shadow-blue-900/20 relative overflow-hidden group h-full flex flex-col justify-between">
          {/* ... existing code ... */}
        </div>

      </div>

      {/* NLOps Chat Interface */}
      {/* ... 위의 Chat UI JSX 전체 ... */}

    </div>   {/* <-- 메인 컨테이너 닫는 태그 */}
  );
}
```

---

## 5. API 명세

### 5.1 POST /api/nlops

자연어 명령을 처리한다.

#### Request

```typescript
interface NLOpsRequest {
  message: string;           // 필수, 1-500자
  confirmAction?: boolean;   // 선택, 위험한 작업 확인 시 true
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

#### 예시: 상태 조회

**Request:**
```json
{
  "message": "현재 상태 알려줘"
}
```

**Response:**
```json
{
  "intent": {
    "type": "query",
    "target": "status"
  },
  "executed": true,
  "response": "현재 시스템은 1 vCPU로 정상 운영 중입니다.\n\n- CPU 사용률: 12.5%\n- TxPool 대기: 23개\n- 자동 스케일링: 활성화\n- 월 예상 비용: $42",
  "data": {
    "metrics": { ... },
    "scaler": { ... }
  },
  "suggestedFollowUp": ["로그 분석 해줘", "비용 확인해줘", "이상 현황 보여줘"]
}
```

#### 예시: 스케일링 (확인 필요)

**Request 1 (최초 요청):**
```json
{
  "message": "4 vCPU로 스케일업"
}
```

**Response 1:**
```json
{
  "intent": {
    "type": "scale",
    "targetVcpu": 4,
    "force": false
  },
  "executed": false,
  "response": "4 vCPU로 스케일링하려고 합니다. 계속하시려면 '확인'을 눌러주세요.",
  "needsConfirmation": true,
  "confirmationMessage": "4 vCPU로 스케일링을 실행하시겠습니까?",
  "suggestedFollowUp": ["취소", "확인"]
}
```

**Request 2 (확인):**
```json
{
  "message": "4 vCPU로 스케일업",
  "confirmAction": true
}
```

**Response 2:**
```json
{
  "intent": {
    "type": "scale",
    "targetVcpu": 4,
    "force": false
  },
  "executed": true,
  "response": "스케일링이 완료되었습니다!\n\n- 이전: 1 vCPU / 2 GiB\n- 현재: 4 vCPU / 8 GiB\n\n시뮬레이션 모드에서 실행되었습니다.",
  "data": {
    "success": true,
    "previousVcpu": 1,
    "currentVcpu": 4,
    "decision": { ... }
  },
  "suggestedFollowUp": ["현재 상태 확인해줘", "비용 얼마나 드는지 알려줘"]
}
```

#### 예시: 로그 분석

**Request:**
```json
{
  "message": "로그 분석 해줘"
}
```

**Response:**
```json
{
  "intent": {
    "type": "analyze",
    "mode": "live"
  },
  "executed": true,
  "response": "로그 분석 결과입니다.\n\n심각도: normal\n\n네트워크는 현재 정상 동작 중입니다. op-geth, op-node, op-batcher 모두 예상대로 작동하고 있습니다.\n\n권장 조치: 현재 특별한 조치가 필요하지 않습니다.",
  "data": {
    "source": "k8s-multi-pod-stream",
    "analysis": {
      "severity": "normal",
      "summary": "...",
      "action_item": "..."
    }
  },
  "suggestedFollowUp": ["근본 원인 분석해줘", "이상 현황 보여줘", "현재 상태 알려줘"]
}
```

#### 예시: 설정 변경

**Request 1:**
```json
{
  "message": "자동 스케일링 꺼줘"
}
```

**Response 1:**
```json
{
  "intent": {
    "type": "config",
    "setting": "autoScaling",
    "value": false
  },
  "executed": false,
  "response": "자동 스케일링을(를) 비활성화하려고 합니다. 계속하시려면 '확인'을 눌러주세요.",
  "needsConfirmation": true,
  "confirmationMessage": "자동 스케일링을(를) 비활성화하시겠습니까?"
}
```

#### 예시: 설명 요청

**Request:**
```json
{
  "message": "쿨다운이 뭐야?"
}
```

**Response:**
```json
{
  "intent": {
    "type": "explain",
    "topic": "쿨다운이 뭐야?"
  },
  "executed": true,
  "response": "쿨다운은 연속적인 스케일링을 방지하기 위한 대기 시간입니다. 기본값은 5분(300초)입니다.\n\n스케일링 작업이 완료된 후 쿨다운 기간 동안은 추가 스케일링이 차단됩니다. 이는 시스템 안정성을 위한 보호 장치입니다.",
  "data": {
    "topic": "쿨다운",
    "explanation": "..."
  },
  "suggestedFollowUp": ["현재 상태 알려줘", "다른 것도 설명해줘"]
}
```

#### 예시: 알 수 없는 명령

**Request:**
```json
{
  "message": "피자 주문해줘"
}
```

**Response:**
```json
{
  "intent": {
    "type": "unknown",
    "originalInput": "피자 주문해줘"
  },
  "executed": false,
  "response": "죄송합니다, 명령을 이해하지 못했습니다. \"현재 상태\", \"로그 분석\", \"2 vCPU로 스케일\" 같은 명령을 시도해보세요.",
  "suggestedFollowUp": ["현재 상태 알려줘", "로그 분석 해줘", "도움말"]
}
```

### 5.2 GET /api/nlops

NLOps 상태 및 정보를 반환한다.

**Response:**
```json
{
  "enabled": true,
  "version": "1.0.0",
  "supportedIntents": ["query", "scale", "analyze", "config", "explain", "rca"],
  "supportedLanguages": ["ko", "en"]
}
```

---

## 6. AI 프롬프트 전문

### 6.1 Intent Classification 프롬프트

**시스템 프롬프트 (영문, AI 내부용):**

```
You are a command interpreter for SentinAI, an Optimism L2 node monitoring and auto-scaling system.

Your task is to classify user input into one of the following intent types:

## Available Intent Types

1. **query** - Check current status, metrics, history, or cost
   - target: "status" | "metrics" | "history" | "cost" | "anomalies"
   - params: optional key-value pairs for filtering

2. **scale** - Change vCPU allocation
   - targetVcpu: 1 | 2 | 4 (only these values are valid)
   - force: boolean (true if user explicitly says to force/override)

3. **analyze** - Run AI log analysis
   - mode: "normal" | "attack" | "live"

4. **config** - Update system settings
   - setting: "autoScaling" | "simulationMode"
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
- "자동 스케일링 켜줘" / "자동 스케일링 활성화" → config/autoScaling/true
- "자동 스케일링 꺼줘" → config/autoScaling/false
- "시뮬레이션 모드 켜줘" → config/simulationMode/true
- "왜 CPU가 높아?" / "CPU 설명해줘" → explain
- "근본 원인 분석" / "RCA 실행" → rca

English:
- "current status" / "what's the status" → query/status
- "show metrics" → query/metrics
- "how much does it cost" → query/cost
- "scale up to 4 vCPU" / "set 4 cores" → scale/4
- "scale down to 1" → scale/1
- "analyze logs" → analyze/live
- "enable auto-scaling" → config/autoScaling/true
- "run root cause analysis" → rca

## Response Format

You MUST respond with a valid JSON object (no markdown code blocks):
{
  "intent": {
    "type": "<intent_type>",
    // ... type-specific fields
  },
  "requireConfirmation": <boolean>,
  "clarification": "<optional clarification message if ambiguous>"
}
```

**사용자 프롬프트 템플릿:**

```
User input: "{user_input}"

Current system state:
- vCPU: {vcpu}
- Memory: {memoryGiB} GiB
- Auto-scaling: {autoScalingEnabled ? 'enabled' : 'disabled'}
- Simulation mode: {simulationMode ? 'enabled' : 'disabled'}
- CPU usage: {cpuUsage}%
- TxPool pending: {txPoolCount}
- Cooldown remaining: {cooldownRemaining}s

Parse the user's intent and respond with a JSON object.
```

### 6.2 Response Generation 프롬프트

**시스템 프롬프트 (영문, AI 내부용):**

```
You are a helpful assistant for SentinAI, an Optimism L2 node monitoring system.

Your task is to convert structured data into natural, friendly Korean responses.

## Guidelines

1. ALWAYS respond in Korean (한국어)
2. Be concise but informative
3. Use technical terms when appropriate but explain them if complex
4. Format numbers nicely (e.g., 1,234 instead of 1234)
5. Include relevant metrics and status information
6. If an action failed, explain why and suggest alternatives
7. Use a professional but friendly tone

## Formatting

- Use bullet points for lists
- Highlight important values
- Keep responses under 200 words
- Don't use markdown headers (# or ##)

## Response Structure

1. Main status/result
2. Key metrics (if applicable)
3. Brief explanation or next steps (if applicable)
```

**사용자 프롬프트 템플릿:**

```
Generate a Korean response for the following:

Intent type: {intent.type}
Intent details: {JSON.stringify(intent)}
Executed: {executed}
Result data: {JSON.stringify(result)}

If executed is false and result is null, it means the action needs user confirmation.
If there's an error, explain it kindly and suggest what to do.
```

---

## 7. 환경 변수

### 7.1 신규 환경 변수

```bash
# NLOps 활성화 (기본값: true)
NLOPS_ENABLED=true
```

### 7.2 기존 환경 변수 (필수)

NLOps가 사용하는 기존 환경 변수:

```bash
# AI Gateway (필수)
AI_GATEWAY_URL=https://api.ai.tokamak.network
ANTHROPIC_API_KEY=your-api-key-here

# Base URL (선택, 자동 감지 가능)
NEXT_PUBLIC_BASE_URL=http://localhost:3002
```

### 7.3 `.env.local.sample` 업데이트

기존 파일에 추가:

```bash
# NLOps Configuration
NLOPS_ENABLED=true
```

---

## 8. 테스트 검증

### 8.1 API 테스트 (curl)

```bash
# 1. 상태 조회
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "현재 상태 알려줘"}'

# 2. 메트릭 조회 (영어)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "show me the metrics"}'

# 3. 스케일링 요청 (확인 대기)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "4 vCPU로 올려줘"}'

# 4. 스케일링 확인
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "4 vCPU로 올려줘", "confirmAction": true}'

# 5. 로그 분석
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "로그 분석 해줘"}'

# 6. 설정 변경
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "자동 스케일링 꺼줘", "confirmAction": true}'

# 7. 설명 요청
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "vCPU가 뭐야?"}'

# 8. 비용 조회
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "비용 얼마야"}'

# 9. 알 수 없는 명령
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "안녕하세요 반갑습니다"}'

# 10. NLOps 상태 확인
curl http://localhost:3002/api/nlops
```

### 8.2 UI 테스트 체크리스트

1. **채팅 패널 토글**
   - [ ] 우하단 버튼 클릭 시 채팅 패널 열림
   - [ ] 패널 헤더의 화살표 클릭 시 패널 닫힘
   - [ ] 패널 열린 상태에서 토글 버튼 숨김

2. **메시지 전송**
   - [ ] 텍스트 입력 후 전송 버튼 클릭 시 메시지 전송
   - [ ] Enter 키로 메시지 전송
   - [ ] 빈 메시지는 전송 불가
   - [ ] 전송 중 로딩 인디케이터 표시

3. **메시지 표시**
   - [ ] 사용자 메시지 우측 정렬, 파란 배경
   - [ ] 어시스턴트 메시지 좌측 정렬, 흰 배경
   - [ ] 타임스탬프 표시
   - [ ] 새 메시지 시 자동 스크롤

4. **확인 흐름**
   - [ ] 스케일링 요청 시 확인 다이얼로그 표시
   - [ ] '확인' 클릭 시 작업 실행
   - [ ] '취소' 클릭 시 작업 취소 메시지 표시
   - [ ] 확인 대기 중 입력 비활성화

5. **예시 및 후속 질문**
   - [ ] 빈 채팅에서 예시 버튼 표시
   - [ ] 예시 버튼 클릭 시 해당 명령 전송
   - [ ] 응답 후 후속 질문 버튼 표시
   - [ ] 후속 질문 클릭 시 입력창에 텍스트 채움

6. **에러 처리**
   - [ ] API 오류 시 에러 메시지 표시
   - [ ] 네트워크 오류 시 재시도 안내

### 8.3 Edge Case 테스트

```bash
# 빈 메시지
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
# Expected: 400 Bad Request

# 너무 긴 메시지 (500자 초과)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "'$(python3 -c "print('a'*501))"'"}'
# Expected: 400 Bad Request

# 유효하지 않은 vCPU 값 (3 vCPU)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "3 vCPU로 스케일"}'
# Expected: unknown intent

# 연속 요청 (rate limiting 테스트)
for i in {1..10}; do
  curl -X POST http://localhost:3002/api/nlops \
    -H "Content-Type: application/json" \
    -d '{"message": "상태"}' &
done
wait
```

---

## 9. 의존관계

### 9.1 기본 기능 (독립 동작)

NLOps는 다음 기존 API만 사용하여 독립적으로 동작한다:

| Intent | 호출 API | 설명 |
|--------|----------|------|
| query/status | GET /api/metrics, GET /api/scaler | 현재 상태 조회 |
| query/metrics | GET /api/metrics | 메트릭 조회 |
| query/history | GET /api/scaler | 스케일링 히스토리 |
| scale | POST /api/scaler | 스케일링 실행 |
| analyze | GET /api/analyze-logs | 로그 분석 |
| config | PATCH /api/scaler | 설정 변경 |

### 9.2 확장 기능 (Proposal 1~4 연동)

Proposal 1~4가 구현되면 추가 기능 활성화:

| 연동 Proposal | 추가 Intent | 호출 API |
|---------------|-------------|----------|
| Proposal 1 (Predictive) | query/prediction | GET /api/scaler (prediction 필드) |
| Proposal 2 (Anomaly) | query/anomalies | GET /api/anomalies |
| Proposal 3 (RCA) | rca | POST /api/rca |
| Proposal 4 (Cost) | query/cost | GET /api/cost-report |

### 9.3 의존관계 다이어그램

```
NLOps Engine
    │
    ├── [필수] 기존 API
    │   ├── /api/metrics
    │   ├── /api/scaler
    │   └── /api/analyze-logs
    │
    ├── [필수] AI Gateway
    │   └── Claude Haiku 4.5 (Intent Classification, Response Generation)
    │
    └── [선택] 확장 API (Proposal 1~4)
        ├── /api/scaler (prediction 필드) - P1
        ├── /api/anomalies - P2
        ├── /api/rca - P3
        └── /api/cost-report - P4
```

---

## 10. 명령어 매핑 표

### 10.1 한국어 명령어

| 명령어 예시 | Intent Type | Target/Params | 호출 API |
|-------------|-------------|---------------|----------|
| "현재 상태" / "상태 알려줘" | query | status | GET /api/metrics + GET /api/scaler |
| "메트릭 보여줘" / "지표 확인" | query | metrics | GET /api/metrics |
| "히스토리" / "스케일링 기록" | query | history | GET /api/scaler |
| "비용 얼마야" / "비용 분석" | query | cost | GET /api/cost-report or /api/metrics |
| "이상 탐지" / "이상 현황" | query | anomalies | GET /api/anomalies |
| "4 vCPU로 올려" / "4코어로 스케일업" | scale | targetVcpu: 4 | POST /api/scaler |
| "2 vCPU로 설정" | scale | targetVcpu: 2 | POST /api/scaler |
| "1 vCPU로 줄여" / "스케일다운" | scale | targetVcpu: 1 | POST /api/scaler |
| "로그 분석 해줘" / "로그 확인" | analyze | mode: live | GET /api/analyze-logs?mode=live |
| "공격 시뮬레이션" | analyze | mode: attack | GET /api/analyze-logs?mode=attack |
| "자동 스케일링 켜줘" | config | autoScaling: true | PATCH /api/scaler |
| "자동 스케일링 꺼줘" | config | autoScaling: false | PATCH /api/scaler |
| "시뮬레이션 모드 활성화" | config | simulationMode: true | PATCH /api/scaler |
| "시뮬레이션 모드 끄기" | config | simulationMode: false | PATCH /api/scaler |
| "CPU가 뭐야?" / "vCPU 설명" | explain | topic: CPU/vCPU | 정적 응답 |
| "쿨다운이 뭐야?" | explain | topic: cooldown | 정적 응답 |
| "Optimism이 뭐야?" | explain | topic: Optimism | 정적 응답 |
| "근본 원인 분석" / "RCA 실행" | rca | - | POST /api/rca |

### 10.2 영어 명령어

| Command Example | Intent Type | Target/Params | API Call |
|-----------------|-------------|---------------|----------|
| "current status" / "what's the status" | query | status | GET /api/metrics + GET /api/scaler |
| "show metrics" | query | metrics | GET /api/metrics |
| "scaling history" | query | history | GET /api/scaler |
| "how much does it cost" | query | cost | GET /api/cost-report or /api/metrics |
| "show anomalies" | query | anomalies | GET /api/anomalies |
| "scale up to 4 vCPU" / "set 4 cores" | scale | targetVcpu: 4 | POST /api/scaler |
| "scale to 2" | scale | targetVcpu: 2 | POST /api/scaler |
| "scale down to 1" | scale | targetVcpu: 1 | POST /api/scaler |
| "analyze logs" | analyze | mode: live | GET /api/analyze-logs?mode=live |
| "simulate attack" | analyze | mode: attack | GET /api/analyze-logs?mode=attack |
| "enable auto-scaling" | config | autoScaling: true | PATCH /api/scaler |
| "disable auto-scaling" | config | autoScaling: false | PATCH /api/scaler |
| "turn on simulation mode" | config | simulationMode: true | PATCH /api/scaler |
| "what is CPU?" | explain | topic: CPU | Static response |
| "explain cooldown" | explain | topic: cooldown | Static response |
| "run root cause analysis" | rca | - | POST /api/rca |

### 10.3 모호한 입력 처리

| 입력 | 해석 | 이유 |
|------|------|------|
| "안녕" / "hi" | query/status | 인사는 상태 조회로 해석 (친근한 시작) |
| "도움말" / "help" | explain/help | 도움말 요청 |
| "스케일" (값 없음) | unknown | vCPU 값이 필수이므로 재질문 |
| "3 vCPU" | unknown | 유효한 값이 아님 (1, 2, 4만 허용) |
| "올려줘" (값 없음) | unknown | 목표 vCPU 불명확 |
| "뭐해?" | query/status | 현재 상태 질문으로 해석 |

---

## 부록 A: 파일 생성/수정 체크리스트

### A.1 신규 파일 (3개)

- [ ] `src/types/nlops.ts` - 타입 정의
- [ ] `src/lib/nlops-engine.ts` - 핵심 엔진
- [ ] `src/lib/nlops-responder.ts` - 응답 생성기
- [ ] `src/app/api/nlops/route.ts` - API 엔드포인트

### A.2 수정 파일 (1개)

- [ ] `src/app/page.tsx` - Chat UI 추가

### A.3 환경 설정

- [ ] `.env.local.sample` - NLOPS_ENABLED 추가

---

## 부록 B: 예상 토큰 사용량

| 기능 | AI 호출 빈도 | 예상 토큰/호출 |
|------|-------------|---------------|
| Intent Classification | 매 메시지 | 입력 ~200 + 출력 ~100 |
| Response Generation | 매 메시지 (선택적) | 입력 ~500 + 출력 ~200 |

- 정적 응답 사용 시 Response Generation AI 호출 생략 가능
- 평균 메시지당 약 500~1000 토큰 예상

---

## 부록 C: 향후 확장 가능성

1. **Slack 연동**: `/api/nlops/slack/route.ts` 추가하여 Slack Incoming Webhook 지원
2. **음성 입력**: Web Speech API 연동
3. **컨텍스트 유지**: 이전 대화 기반 컨텍스트 인식
4. **조건부 자동화**: "TxPool이 500 넘으면 알려줘" 같은 조건부 명령
5. **다국어 확장**: 일본어, 영어 응답 모드

---

*End of Document*
