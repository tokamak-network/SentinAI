/**
 * NLOps Responder - Natural Language Response Generator
 * 실행 결과를 자연어 응답으로 변환
 *
 * AI 호출: chatCompletion() from src/lib/ai-client.ts
 */

import type { NLOpsIntent, ConfigSetting } from '@/types/nlops';
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
  const staticResponse = getStaticResponse(intent, result, executed);
  if (staticResponse) return staticResponse;

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
  } catch {
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
        const names: Record<ConfigSetting, string> = {
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
      if (intent.target === 'status' && result) {
        const metricsObj = (result as Record<string, unknown>)?.metrics;
        const inner = (metricsObj as Record<string, unknown>)?.metrics as Record<string, unknown> | undefined;
        if (inner) {
          return `현재 상태: ${inner.gethVcpu || 1} vCPU, CPU ${(inner.cpuUsage as number)?.toFixed(1) || 0}%, TxPool ${inner.txPoolCount || 0}개 대기 중`;
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
