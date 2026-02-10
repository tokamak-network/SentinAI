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
If there's an error, explain it kindly and suggest what to do.
Format the response as plain readable text. For cost data, include dollar amounts. For metrics, include key values. For RCA, include the root cause component and severity.`,
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
    case 'query':
      return formatQueryFallback(intent.target, result);
    case 'scale':
      return `Scaling completed: ${(result as Record<string, unknown>)?.previousVcpu || '?'} → ${(result as Record<string, unknown>)?.currentVcpu || intent.targetVcpu} vCPU`;
    case 'analyze':
      return formatAnalyzeFallback(result);
    case 'config':
      return 'Configuration updated successfully.';
    case 'rca':
      return formatRcaFallback(result);
    default:
      return 'Action completed successfully.';
  }
}

// ============================================================
// Fallback Formatters
// ============================================================

function formatQueryFallback(target: string, result: Record<string, unknown> | null): string {
  if (!result) return 'Data retrieved successfully.';

  switch (target) {
    case 'status': {
      const metricsObj = result.metrics as Record<string, unknown> | undefined;
      const inner = (metricsObj as Record<string, unknown>)?.metrics as Record<string, unknown> | undefined;
      if (inner) {
        return `Current status: ${inner.gethVcpu || 1} vCPU, CPU ${(inner.cpuUsage as number)?.toFixed(1) || 0}%, ${inner.txPoolCount || 0} pending transactions`;
      }
      return 'Data retrieved successfully.';
    }
    case 'cost': {
      const monthly = result.currentMonthly as number | undefined;
      const recs = result.recommendations as unknown[] | undefined;
      if (monthly !== undefined) {
        const parts = [`Monthly cost: $${monthly.toFixed(2)}`];
        if (recs && recs.length > 0) parts.push(`${recs.length} optimization recommendation(s) available`);
        return parts.join('. ') + '.';
      }
      return 'Cost data retrieved successfully.';
    }
    case 'anomalies': {
      const events = result.events as unknown[] | undefined;
      const total = result.total as number | undefined;
      const count = total ?? events?.length ?? 0;
      return count > 0
        ? `${count} anomaly event(s) detected.`
        : 'No anomalies detected.';
    }
    case 'metrics': {
      const m = result.metrics as Record<string, unknown> | undefined;
      if (m) {
        const parts: string[] = [];
        if (m.cpuUsage !== undefined) parts.push(`CPU: ${(m.cpuUsage as number).toFixed(1)}%`);
        if (m.gethVcpu !== undefined) parts.push(`vCPU: ${m.gethVcpu}`);
        if (m.txPoolCount !== undefined) parts.push(`TxPool: ${m.txPoolCount}`);
        if (m.l2BlockNumber !== undefined) parts.push(`L2 Block: ${m.l2BlockNumber}`);
        if (parts.length > 0) return `Current metrics: ${parts.join(', ')}`;
      }
      return 'Metrics data retrieved successfully.';
    }
    case 'history': {
      const vcpu = result.currentVcpu as number | undefined;
      const autoScaling = result.autoScalingEnabled as boolean | undefined;
      if (vcpu !== undefined) {
        const parts = [`Current: ${vcpu} vCPU`];
        if (autoScaling !== undefined) parts.push(`auto-scaling: ${autoScaling ? 'enabled' : 'disabled'}`);
        return parts.join(', ') + '.';
      }
      return 'Scaling history retrieved successfully.';
    }
    default:
      return 'Data retrieved successfully.';
  }
}

function formatAnalyzeFallback(result: Record<string, unknown> | null): string {
  const analysis = result?.analysis as Record<string, unknown> | undefined;
  if (!analysis) return 'Log analysis completed.';
  const parts: string[] = [];
  if (analysis.summary) parts.push(String(analysis.summary));
  if (analysis.severity) parts.push(`Severity: ${analysis.severity}`);
  if (analysis.action_item) parts.push(`Action: ${analysis.action_item}`);
  return parts.length > 0 ? parts.join('. ') + '.' : 'Log analysis completed.';
}

function formatRcaFallback(result: Record<string, unknown> | null): string {
  const rootCause = result?.rootCause as Record<string, unknown> | undefined;
  if (!rootCause) return 'Root cause analysis completed.';
  const parts: string[] = [];
  if (rootCause.component) parts.push(`Root cause: ${rootCause.component}`);
  if (rootCause.severity) parts.push(`Severity: ${rootCause.severity}`);
  if (rootCause.summary) parts.push(String(rootCause.summary));
  return parts.length > 0 ? parts.join('. ') + '.' : 'Root cause analysis completed.';
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
