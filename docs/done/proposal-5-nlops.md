# Proposal 5: Natural Language Ops (NLOps) - 구현 명세서

> 작성일: 2026-02-06
> 업데이트: 2026-02-10 (코드베이스 동기화)
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
│ (Chat UI)       │────▶│ (chatCompletion)     │────▶│ (기존 API 호출)     │
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

### 1.5 현재 코드베이스 상태

NLOps가 연동하는 **기존 구현 완료 모듈**:

| 기능 | API 엔드포인트 | 핵심 파일 | 상태 |
|------|---------------|----------|------|
| 메트릭 조회 | `GET /api/metrics` | `src/lib/metrics-store.ts` | ✅ P1 구현 완료 |
| 스케일러 상태/실행 | `GET/POST /api/scaler` | `src/lib/k8s-scaler.ts` | ✅ 구현 완료 |
| 설정 변경 | `PATCH /api/scaler` | `src/lib/k8s-scaler.ts` | ✅ 구현 완료 |
| 이상 탐지 | `GET /api/anomalies` | `src/lib/anomaly-detector.ts` | ✅ P2 구현 완료 |
| 근본 원인 분석 | `POST /api/rca` | `src/lib/rca-engine.ts` | ✅ P3 구현 완료 |
| 비용 리포트 | `GET /api/cost-report` | `src/lib/cost-optimizer.ts` | ✅ P4 구현 완료 |
| 로그 분석 | (내부 함수) | `src/lib/ai-analyzer.ts` | ✅ 구현 완료 |
| AI 클라이언트 | (내부 함수) | `src/lib/ai-client.ts` | ✅ 구현 완료 |
| 헬스 체크 | `GET /api/health` | - | ✅ 구현 완료 |

**중요**: 로그 분석은 별도 API 라우트 없이 `ai-analyzer.ts`의 `analyzeLogChunk()` 함수를 직접 호출한다.

---

## 2. 타입 정의

### 2.1 파일: `src/types/nlops.ts` (신규 생성)

```typescript
/**
 * NLOps (Natural Language Operations) Type Definitions
 * 자연어 기반 운영 인터페이스를 위한 타입 정의
 */

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
export type ConfigSetting = 'autoScaling' | 'simulationMode' | 'zeroDowntimeEnabled';

/**
 * 유효한 vCPU 값 (기존 TargetVcpu 타입과 동일: 1 | 2 | 4)
 */
export type NLOpsTargetVcpu = 1 | 2 | 4;

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
```

---

## 3. 신규 파일 명세

### 3.1 `src/lib/nlops-engine.ts`

NLOps의 핵심 처리 엔진. Intent 분류, 액션 라우팅, 명령 처리를 담당한다.

**핵심 설계 원칙:**
- AI 호출은 반드시 `src/lib/ai-client.ts`의 `chatCompletion()` 함수를 사용한다
- 로그 분석은 `src/lib/ai-analyzer.ts`의 `analyzeLogChunk()` 함수를 직접 호출한다
- 이상 탐지, RCA, 비용 리포트는 기존 API 엔드포인트를 fetch로 호출한다

```typescript
/**
 * NLOps Engine - Natural Language Operations Processing Engine
 * 자연어 명령 처리의 핵심 로직
 *
 * AI 호출: chatCompletion() from src/lib/ai-client.ts
 * 로그 분석: analyzeLogChunk() from src/lib/ai-analyzer.ts
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
 * 사용자 입력을 Intent로 분류
 *
 * chatCompletion()의 modelTier: 'fast' (Haiku) 사용 — 빠른 분류
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

/**
 * Intent에 따른 액션 실행
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
 * Query 액션 실행
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
 * Scale 액션 실행
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
 * Analyze 액션 실행
 *
 * 주의: /api/analyze-logs 라우트가 없으므로
 * ai-analyzer.ts의 analyzeLogChunk()를 직접 호출한다.
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
    throw new Error(`로그 분석 실패: ${errorMessage}`);
  }
}

/**
 * Config 액션 실행
 *
 * 기존 PATCH /api/scaler 엔드포인트 사용
 * 지원 필드: autoScalingEnabled, simulationMode, zeroDowntimeEnabled
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
 * Explain 액션 실행 (정적 지식 반환)
 */
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

/**
 * RCA 액션 실행
 *
 * 기존 POST /api/rca 엔드포인트 사용
 */
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

/**
 * NLOps 활성화 상태 확인
 */
export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
```

### 3.2 `src/lib/nlops-responder.ts`

실행 결과를 자연어 응답으로 변환하는 모듈.

**핵심 설계 원칙:**
- AI 호출은 `chatCompletion()` 사용 (modelTier: 'fast')
- 정적 응답이 가능한 경우 AI 호출 생략 (토큰 절약)

```typescript
/**
 * NLOps Responder - Natural Language Response Generator
 * 실행 결과를 자연어 응답으로 변환
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
1. ALWAYS respond in Korean (한국어)
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
 * 실행 결과를 자연어 응답으로 변환
 */
export async function generateResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): Promise<string> {
  // 정적 응답이 가능한 경우
  const staticResponse = getStaticResponse(intent, result, executed);
  if (staticResponse) return staticResponse;

  // AI를 통한 자연어 응답 생성
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
 * 정적 응답 (AI 호출 없이 즉시 반환)
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
      case 'config': {
        const names: Record<string, string> = {
          autoScaling: '자동 스케일링',
          simulationMode: '시뮬레이션 모드',
          zeroDowntimeEnabled: '무중단 스케일링',
        };
        const action = intent.value ? '활성화' : '비활성화';
        return `${names[intent.setting]}을(를) ${action}하려고 합니다. 계속하시려면 '확인'을 눌러주세요.`;
      }
    }
  }

  if (intent.type === 'unknown') {
    return '죄송합니다, 명령을 이해하지 못했습니다. "현재 상태", "로그 분석", "2 vCPU로 스케일" 같은 명령을 시도해보세요.';
  }

  // explain은 정적 응답 사용
  if (intent.type === 'explain' && result) {
    const explanation = (result as Record<string, string>)?.explanation;
    if (explanation) return explanation;
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
  if (!executed) return '작업을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.';

  switch (intent.type) {
    case 'query': {
      if (intent.target === 'status') {
        const metrics = (result as Record<string, Record<string, unknown>>)?.metrics?.metrics;
        if (metrics) {
          return `현재 상태: ${metrics.gethVcpu || 1} vCPU, CPU ${(metrics.cpuUsage as number)?.toFixed(1) || 0}%, TxPool ${metrics.txPoolCount || 0}개 대기 중`;
        }
      }
      return '데이터를 조회했습니다.';
    }
    case 'scale':
      return `스케일링 완료: ${(result as Record<string, unknown>)?.previousVcpu || '?'} → ${(result as Record<string, unknown>)?.currentVcpu || intent.targetVcpu} vCPU`;
    case 'analyze':
      return (result as Record<string, Record<string, unknown>>)?.analysis?.summary
        ? String((result as Record<string, Record<string, unknown>>).analysis.summary)
        : '로그 분석을 완료했습니다.';
    case 'config':
      return '설정이 변경되었습니다.';
    case 'rca':
      return '근본 원인 분석을 실행했습니다.';
    default:
      return '작업이 완료되었습니다.';
  }
}

// ============================================================
// Follow-up Suggestions
// ============================================================

export function getSuggestedFollowUps(intent: NLOpsIntent): string[] {
  switch (intent.type) {
    case 'query':
      switch (intent.target) {
        case 'status': return ['로그 분석 해줘', '비용 확인해줘', '이상 현황 보여줘'];
        case 'metrics': return ['현재 상태 알려줘', '스케일링 히스토리 보여줘'];
        case 'cost': return ['현재 상태 알려줘', '비용 절감 방법 알려줘'];
        case 'anomalies': return ['근본 원인 분석해줘', '로그 분석 해줘'];
        case 'history': return ['현재 상태 알려줘', '비용 확인해줘'];
        default: return ['현재 상태 알려줘'];
      }
    case 'scale': return ['현재 상태 확인해줘', '비용 얼마나 드는지 알려줘'];
    case 'analyze': return ['근본 원인 분석해줘', '이상 현황 보여줘', '현재 상태 알려줘'];
    case 'config': return ['현재 상태 알려줘', '설정 확인해줘'];
    case 'explain': return ['현재 상태 알려줘', '다른 것도 설명해줘'];
    case 'rca': return ['로그 분석 해줘', '현재 상태 알려줘', '이상 현황 보여줘'];
    case 'unknown': return ['현재 상태 알려줘', '로그 분석 해줘', '도움말'];
    default: return ['현재 상태 알려줘'];
  }
}
```

### 3.3 `src/app/api/nlops/route.ts`

NLOps API 엔드포인트.

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
        response: `명령 처리 중 오류가 발생했습니다: ${errorMessage}`,
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

## 4. 기존 파일 수정

### 4.1 `src/app/page.tsx` 수정

대시보드에 채팅 UI를 추가한다. 화면 하단에 고정된 토글 버튼과 슬라이드업 패널 형태.

#### 4.1.1 Import 추가

파일 상단의 import 섹션에 추가 (`lucide-react` import에 아이콘 추가 + 타입 import):

```typescript
// 기존 lucide-react import에 추가할 아이콘:
// MessageSquare, Send, Bot, User, X

// 새로 추가할 import:
import type { ChatMessage, NLOpsResponse, NLOpsIntent } from '@/types/nlops';
```

#### 4.1.2 State 추가

`Dashboard` 컴포넌트의 기존 state 선언 블록 (costReport state 근처) 아래에 추가:

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

`fetchCostReport` 함수 아래에 추가:

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
    content: confirmAction ? '확인' : message.trim(),
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
      content: '죄송합니다, 요청을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
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
    content: '작업이 취소되었습니다.',
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

#### 4.1.4 Chat UI JSX 삽입 위치

**정확한 삽입 위치**: `return` 문 내부, 3-column grid (`md:grid-cols-3`) 닫는 `</div>` 아래, 메인 컨테이너 `</div>` 바로 앞.

현재 page.tsx에서 마지막 섹션은 Documentation 카드가 포함된 3-column grid이다.
해당 grid의 닫는 태그 이후에 Chat UI를 추가한다:

```tsx
      {/* 기존 3-column grid 닫는 태그 */}
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
          <span className="text-sm font-semibold pr-1">SentinAI 어시스턴트</span>
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
                <h3 className="font-bold text-white text-sm">SentinAI Ops 어시스턴트</h3>
                <p className="text-[10px] text-gray-400">자연어로 시스템을 제어하세요</p>
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
                <p className="text-sm">안녕하세요! SentinAI 어시스턴트입니다.</p>
                <p className="text-xs mt-1">아래 예시를 클릭하거나 직접 입력해보세요.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {['현재 상태', '로그 분석 해줘', '비용 확인'].map((example) => (
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
                  확인
                </button>
                <button onClick={handleCancel} disabled={isSending}
                  className="flex-1 bg-gray-200 text-gray-700 text-sm font-semibold py-2 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50">
                  취소
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-100 bg-white">
            <div className="flex items-center gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown} placeholder="명령을 입력하세요..."
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

    {/* 메인 컨테이너 닫는 태그 */}
    </div>
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

```json
// Request
{ "message": "현재 상태 알려줘" }

// Response
{
  "intent": { "type": "query", "target": "status" },
  "executed": true,
  "response": "현재 시스템은 1 vCPU로 정상 운영 중입니다.\n\n- CPU 사용률: 12.5%\n- TxPool 대기: 23개\n- 자동 스케일링: 활성화\n- 월 예상 비용: $42",
  "data": { "metrics": { ... }, "scaler": { ... } },
  "suggestedFollowUp": ["로그 분석 해줘", "비용 확인해줘", "이상 현황 보여줘"]
}
```

#### 예시: 스케일링 (확인 필요)

```json
// Request 1 (최초 요청)
{ "message": "4 vCPU로 스케일업" }

// Response 1 (확인 대기)
{
  "intent": { "type": "scale", "targetVcpu": 4, "force": false },
  "executed": false,
  "response": "4 vCPU로 스케일링하려고 합니다. 계속하시려면 '확인'을 눌러주세요.",
  "needsConfirmation": true,
  "confirmationMessage": "4 vCPU로 스케일링을 실행하시겠습니까?"
}

// Request 2 (확인)
{ "message": "4 vCPU로 스케일업", "confirmAction": true }

// Response 2 (실행 완료)
{
  "intent": { "type": "scale", "targetVcpu": 4, "force": false },
  "executed": true,
  "response": "스케일링이 완료되었습니다!\n이전: 1 vCPU / 2 GiB\n현재: 4 vCPU / 8 GiB"
}
```

#### 예시: 로그 분석

```json
// Request
{ "message": "로그 분석 해줘" }

// Response
{
  "intent": { "type": "analyze", "mode": "live" },
  "executed": true,
  "response": "로그 분석 결과입니다.\n\n심각도: normal\n\n모든 컴포넌트가 정상 동작 중입니다.",
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

## 6. AI 프롬프트 전문

### 6.1 Intent Classification 프롬프트

시스템 프롬프트: 섹션 3.1의 `INTENT_CLASSIFICATION_SYSTEM_PROMPT` 참조

### 6.2 Response Generation 프롬프트

시스템 프롬프트: 섹션 3.2의 `RESPONSE_SYSTEM_PROMPT` 참조

---

## 7. 환경 변수

### 7.1 신규

```bash
# NLOps 활성화 (기본값: true)
NLOPS_ENABLED=true
```

### 7.2 기존 (필수, 이미 설정됨)

```bash
# AI Client (ai-client.ts가 자동 감지)
ANTHROPIC_API_KEY=sk-xxx
AI_GATEWAY_URL=https://api.ai.tokamak.network  # 선택, 프록시 경유

# Base URL
NEXT_PUBLIC_BASE_URL=http://localhost:3002
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

# 5. 로그 분석 (ai-analyzer.ts 직접 호출)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "로그 분석 해줘"}'

# 6. 이상 탐지 조회
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "이상 현황 보여줘"}'

# 7. RCA 분석
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "근본 원인 분석해줘"}'

# 8. 비용 리포트
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "비용 얼마야"}'

# 9. 설정 변경
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "자동 스케일링 꺼줘", "confirmAction": true}'

# 10. 설명 요청
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "vCPU가 뭐야?"}'

# 11. NLOps 상태 확인
curl http://localhost:3002/api/nlops

# 12. 에러 케이스: 빈 메시지
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": ""}'
# Expected: 400

# 13. 에러 케이스: 유효하지 않은 vCPU (3)
curl -X POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "3 vCPU로 스케일"}'
# Expected: unknown intent
```

### 8.2 UI 테스트 체크리스트

1. **채팅 패널**
   - [ ] 우하단 버튼 클릭 → 패널 열림
   - [ ] 헤더 화살표 클릭 → 패널 닫힘
   - [ ] 패널 열린 상태에서 토글 버튼 숨김

2. **메시지 전송**
   - [ ] Enter 키로 전송
   - [ ] 빈 메시지 전송 불가
   - [ ] 전송 중 로딩 인디케이터 (bounce dots)

3. **확인 흐름**
   - [ ] 스케일링 요청 → 확인 다이얼로그
   - [ ] 확인 → 실행
   - [ ] 취소 → 취소 메시지

4. **예시 버튼**
   - [ ] 빈 채팅에서 예시 표시
   - [ ] 클릭 시 해당 명령 전송

---

## 9. 의존관계

### 9.1 내부 모듈 의존성

```
nlops-engine.ts
  ├── ai-client.ts          # chatCompletion() - Intent 분류
  ├── ai-analyzer.ts         # analyzeLogChunk() - 로그 분석
  ├── log-ingester.ts        # getAllLiveLogs() - 로그 수집
  └── nlops-responder.ts     # generateResponse() - 응답 생성
        └── ai-client.ts     # chatCompletion() - 응답 생성

/api/nlops/route.ts
  └── nlops-engine.ts        # processCommand()
```

### 9.2 API 엔드포인트 의존성

| Intent | API 호출 | 메서드 |
|--------|----------|--------|
| query/status | `/api/metrics` + `/api/scaler` | GET |
| query/metrics | `/api/metrics` | GET |
| query/history | `/api/scaler` | GET |
| query/cost | `/api/cost-report?days=7` | GET |
| query/anomalies | `/api/anomalies` | GET |
| scale | `/api/scaler` | POST |
| analyze | `analyzeLogChunk()` 직접 호출 | - |
| config | `/api/scaler` | PATCH |
| explain | 정적 응답 | - |
| rca | `/api/rca` | POST |

---

## 10. 명령어 매핑 표

### 10.1 한국어 명령어

| 명령어 예시 | Intent | 호출 대상 |
|-------------|--------|----------|
| "현재 상태" / "상태 알려줘" | query/status | GET /api/metrics + /api/scaler |
| "메트릭 보여줘" | query/metrics | GET /api/metrics |
| "스케일링 기록" | query/history | GET /api/scaler |
| "비용 얼마야" / "비용 분석" | query/cost | GET /api/cost-report |
| "이상 현황" / "이상 탐지" | query/anomalies | GET /api/anomalies |
| "4 vCPU로 올려" | scale/4 | POST /api/scaler |
| "1 vCPU로 줄여" | scale/1 | POST /api/scaler |
| "로그 분석 해줘" | analyze/live | analyzeLogChunk() |
| "자동 스케일링 켜줘" | config/autoScaling/true | PATCH /api/scaler |
| "시뮬레이션 모드 끄기" | config/simulationMode/false | PATCH /api/scaler |
| "무중단 스케일링 켜줘" | config/zeroDowntimeEnabled/true | PATCH /api/scaler |
| "CPU가 뭐야?" | explain/cpu | 정적 응답 |
| "근본 원인 분석" | rca | POST /api/rca |

### 10.2 영어 명령어

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

## 부록 A: 파일 생성/수정 체크리스트

### A.1 신규 파일 (4개)

- [ ] `src/types/nlops.ts` — 타입 정의
- [ ] `src/lib/nlops-engine.ts` — 핵심 엔진
- [ ] `src/lib/nlops-responder.ts` — 응답 생성기
- [ ] `src/app/api/nlops/route.ts` — API 엔드포인트

### A.2 수정 파일 (2개)

- [ ] `src/app/page.tsx` — Chat UI 추가 (import, state, handlers, JSX)
- [ ] `.env.local.sample` — NLOPS_ENABLED 추가

### A.3 환경 설정

- [ ] `.env.local` — NLOPS_ENABLED=true 추가

---

## 부록 B: 예상 토큰 사용량

| 기능 | AI 모델 | 호출 빈도 | 예상 토큰/호출 |
|------|---------|----------|---------------|
| Intent Classification | Haiku 4.5 (fast) | 매 메시지 | ~300 |
| Response Generation | Haiku 4.5 (fast) | 복잡한 응답만 | ~700 |
| Explain | 없음 (정적) | - | 0 |

- 정적 응답 사용 시 Response Generation AI 호출 생략
- 평균 메시지당 약 300~1000 토큰 예상

---

*End of Document*
