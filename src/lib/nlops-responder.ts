/**
 * NLOps Responder - Natural Language Response Generator
 * Convert execution results into natural language responses
 *
 * AI calls: chatCompletion() from src/lib/ai-client.ts
 */

import type { NLOpsIntent, ConfigSetting } from '@/types/nlops';
import { chatCompletion } from '@/lib/ai-client';

// ============================================================
// Response Generation
// ============================================================

const RESPONSE_SYSTEM_PROMPT = `You are a helpful assistant for SentinAI, an Optimism L2 node monitoring system.

Your task is to convert structured data into natural, friendly responses.

## Guidelines
1. Be concise but informative
2. Format numbers nicely (e.g., 1,234 instead of 1234)
3. Include relevant metrics and status information
4. If an action failed, explain why and suggest alternatives
5. Use a professional but friendly tone

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
  const staticResponse = getStaticResponse(intent, result, executed);
  if (staticResponse) return staticResponse;

  try {
    const aiResult = await chatCompletion({
      systemPrompt: RESPONSE_SYSTEM_PROMPT,
      userPrompt: `Generate a response for the following:

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
 * Static response (returned immediately without AI call)
 */
function getStaticResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string | null {
  // Waiting for user confirmation
  if (!executed && result === null) {
    switch (intent.type) {
      case 'scale':
        return `You are about to scale to ${intent.targetVcpu} vCPU. Press "confirm" to proceed.`;
      case 'config': {
        const names: Record<ConfigSetting, string> = {
          autoScaling: 'Auto-scaling',
          simulationMode: 'Simulation mode',
          zeroDowntimeEnabled: 'Zero-downtime scaling',
        };
        const action = intent.value ? 'enable' : 'disable';
        return `You are about to ${action} ${names[intent.setting]}. Press "confirm" to proceed.`;
      }
    }
  }

  if (intent.type === 'unknown') {
    return 'Sorry, I didn\'t understand that command. Try commands like "show current status", "analyze logs", or "scale to 2 vCPU".';
  }

  // explain uses static response
  if (intent.type === 'explain' && result) {
    const explanation = (result as Record<string, string>)?.explanation;
    if (explanation) return explanation;
  }

  return null;
}

/**
 * Fallback response (when AI fails)
 */
function getFallbackResponse(
  intent: NLOpsIntent,
  result: Record<string, unknown> | null,
  executed: boolean
): string {
  if (!executed) return 'Failed to execute action. Please try again in a moment.';

  switch (intent.type) {
    case 'query': {
      if (intent.target === 'status' && result) {
        const metricsObj = (result as Record<string, unknown>)?.metrics;
        const inner = (metricsObj as Record<string, unknown>)?.metrics as Record<string, unknown> | undefined;
        if (inner) {
          return `Current status: ${inner.gethVcpu || 1} vCPU, CPU ${(inner.cpuUsage as number)?.toFixed(1) || 0}%, ${inner.txPoolCount || 0} pending transactions`;
        }
      }
      return 'Data retrieved successfully.';
    }
    case 'scale':
      return `Scaling completed: ${(result as Record<string, unknown>)?.previousVcpu || '?'} → ${(result as Record<string, unknown>)?.currentVcpu || intent.targetVcpu} vCPU`;
    case 'analyze':
      return (result as Record<string, Record<string, unknown>>)?.analysis?.summary
        ? String((result as Record<string, Record<string, unknown>>).analysis.summary)
        : 'Log analysis completed.';
    case 'config':
      return 'Configuration updated successfully.';
    case 'rca':
      return 'Root cause analysis completed.';
    default:
      return 'Action completed successfully.';
  }
}

// ============================================================
// Follow-up Suggestions
// ============================================================

export function getSuggestedFollowUps(intent: NLOpsIntent): string[] {
  switch (intent.type) {
    case 'query':
      switch (intent.target) {
        case 'status': return ['Analyze logs', 'Check cost', 'Show anomalies'];
        case 'metrics': return ['Show current status', 'Display scaling history'];
        case 'cost': return ['Show current status', 'Show cost reduction tips'];
        case 'anomalies': return ['Analyze root cause', 'Analyze logs'];
        case 'history': return ['Show current status', 'Check cost'];
        default: return ['Show current status'];
      }
    case 'scale': return ['Check current status', 'Estimate cost'];
    case 'analyze': return ['Analyze root cause', 'Show anomalies', 'Show current status'];
    case 'config': return ['Show current status', 'Show configuration'];
    case 'explain': return ['Show current status', 'Explain more'];
    case 'rca': return ['Analyze logs', 'Show current status', 'Show anomalies'];
    case 'unknown': return ['Show current status', 'Analyze logs', 'Help'];
    default: return ['Show current status'];
  }
}
