/**
 * NLOps SDK Agent
 *
 * Implements a proper Anthropic tool-use agentic loop for the NLOps engine.
 * Unlike the legacy engine which plans all tools at once then executes,
 * this agent lets the LLM decide tools iteratively:
 *
 *   1. Send user message + tool definitions to Anthropic Messages API
 *   2. If response contains tool_use blocks → execute each tool
 *   3. Send tool results back → LLM decides next step
 *   4. Repeat until stop_reason === 'end_turn' (no more tools) or MAX_ROUNDS
 *
 * Fallback: on any error, caller should fall back to the legacy nlops-engine.
 *
 * ENV:
 *   ANTHROPIC_API_KEY     — required (no other providers supported for tool use)
 *   AGENT_SDK_MODEL       — model to use (default: claude-sonnet-4-6)
 *   AGENT_SDK_TRACE       — 'true' to persist traces (default: false)
 */

import { randomUUID } from 'crypto';
import { getChainPlugin } from '@/chains';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { saveTrace } from '@/lib/agents/nlops-trace-store';
import type { ToolCallRecord } from '@/lib/agents/nlops-trace-store';
import type { NLOpsResponse } from '@/types/nlops';
import logger from '@/lib/logger';

// ============================================================
// Constants
// ============================================================

const MAX_ROUNDS = 5;
const TOOL_TIMEOUT_MS = 10_000;
const DANGEROUS_TOOLS = ['scale_node', 'update_config'];

// ============================================================
// Anthropic API Types (subset needed for tool use)
// ============================================================

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

// ============================================================
// Tool Definitions (mirrors nlops-engine TOOLS array)
// ============================================================

const AGENT_TOOLS: AnthropicToolDefinition[] = [
  {
    name: 'get_system_status',
    description:
      'Get current system status including L2 metrics, vCPU, memory, scaling state, and component health. Use when user asks about current state, status, or health.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_metrics',
    description:
      'Get detailed L2 metrics: CPU usage, TxPool count, block height, gas ratio, memory usage.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_cost_report',
    description:
      'Generate AI-powered cost optimization report with savings recommendations.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to analyze (default: 7)' },
      },
      required: [],
    },
  },
  {
    name: 'get_anomalies',
    description: 'Get current anomaly detection results.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'analyze_logs',
    description:
      'Run AI-powered log analysis across all L2 components. Use when user asks to analyze logs or diagnose problems.',
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['normal', 'attack', 'live'],
          description: 'Analysis mode (default: live)',
        },
      },
      required: [],
    },
  },
  {
    name: 'run_rca',
    description: 'Run Root Cause Analysis to identify the root cause of current issues.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_prediction',
    description: 'Get AI prediction for future resource needs.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'scale_node',
    description:
      'Scale the node to a target vCPU count. DANGEROUS: requires user confirmation. Only use when user explicitly requests scaling.',
    input_schema: {
      type: 'object',
      properties: {
        targetVcpu: {
          type: 'number',
          enum: [1, 2, 4],
          description: 'Target vCPU count',
        },
      },
      required: ['targetVcpu'],
    },
  },
  {
    name: 'update_config',
    description:
      'Update system configuration. DANGEROUS: requires user confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        setting: {
          type: 'string',
          enum: ['autoScaling', 'simulationMode', 'zeroDowntimeEnabled'],
        },
        value: { type: 'boolean' },
      },
      required: ['setting', 'value'],
    },
  },
];

// ============================================================
// System Prompt
// ============================================================

function buildSystemPrompt(): string {
  const plugin = getChainPlugin();
  return `You are SentinAI Assistant, a friendly and knowledgeable AI assistant for SentinAI — a ${plugin.displayName} node monitoring and auto-scaling system.

${plugin.aiPrompts.nlopsSystemContext}

## Rules
1. For casual conversation — respond directly WITHOUT calling tools
2. For system questions — call the appropriate tool(s), then respond based on the data
3. For dangerous actions (scale_node, update_config) — ONLY call them when the user explicitly requests it
4. Support Korean and English — respond in the same language the user uses
5. Keep responses concise but informative (under 200 words)
6. When you have tool results, synthesize them into a natural response
7. Never describe tool calls to the user — just act on them and report results`;
}

// ============================================================
// Tool Executor (replicates nlops-engine.executeTool)
// ============================================================

async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  baseUrl: string
): Promise<Record<string, unknown>> {
  const fetchWithTimeout = (url: string, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
    return fetch(url, { ...init, signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );
  };

  try {
    switch (toolName) {
      case 'get_system_status': {
        const [metricsRes, scalerRes] = await Promise.all([
          fetchWithTimeout(`${baseUrl}/api/metrics`, { cache: 'no-store' }),
          fetchWithTimeout(`${baseUrl}/api/scaler`, { cache: 'no-store' }),
        ]);
        return {
          metrics: metricsRes.ok ? await metricsRes.json() : { error: 'Failed to fetch metrics' },
          scaler: scalerRes.ok ? await scalerRes.json() : { error: 'Failed to fetch scaler' },
        };
      }
      case 'get_metrics': {
        const res = await fetchWithTimeout(`${baseUrl}/api/metrics`, { cache: 'no-store' });
        return res.ok ? await res.json() : { error: 'Failed to fetch metrics' };
      }
      case 'get_cost_report': {
        const days = (params.days as number) || 7;
        const res = await fetchWithTimeout(`${baseUrl}/api/cost-report?days=${days}`, { cache: 'no-store' });
        return res.ok ? await res.json() : { error: 'Failed to fetch cost report' };
      }
      case 'get_anomalies': {
        const res = await fetchWithTimeout(`${baseUrl}/api/anomalies`, { cache: 'no-store' });
        return res.ok ? await res.json() : { error: 'Failed to fetch anomalies' };
      }
      case 'analyze_logs': {
        const mode = (params.mode as string) || 'live';
        let logs: Record<string, string>;
        try {
          logs = await getAllLiveLogs();
        } catch {
          logs = generateMockLogs(mode === 'attack' ? 'attack' : 'normal');
        }
        const analysis = await analyzeLogChunk(logs);
        return {
          source: 'ai-analyzer',
          mode,
          severity: analysis.severity,
          summary: analysis.summary,
          action_item: analysis.action_item,
          timestamp: analysis.timestamp,
        };
      }
      case 'run_rca': {
        const res = await fetchWithTimeout(`${baseUrl}/api/rca`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoTriggered: false }),
        });
        return res.ok ? await res.json() : { error: 'RCA analysis failed' };
      }
      case 'get_prediction': {
        const res = await fetchWithTimeout(`${baseUrl}/api/scaler`, { cache: 'no-store' });
        if (!res.ok) return { error: 'Failed to fetch prediction' };
        const data = await res.json();
        return { prediction: data.prediction || null, predictionMeta: data.predictionMeta || null };
      }
      case 'scale_node': {
        const res = await fetchWithTimeout(`${baseUrl}/api/scaler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVcpu: params.targetVcpu }),
        });
        return res.ok ? await res.json() : { error: `Scale request failed: ${res.status}` };
      }
      case 'update_config': {
        const bodyMap: Record<string, Record<string, boolean>> = {
          autoScaling: { autoScalingEnabled: params.value as boolean },
          simulationMode: { simulationMode: params.value as boolean },
          zeroDowntimeEnabled: { zeroDowntimeEnabled: params.value as boolean },
        };
        const res = await fetchWithTimeout(`${baseUrl}/api/scaler`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyMap[params.setting as string] || {}),
        });
        return res.ok ? await res.json() : { error: `Config update failed: ${res.status}` };
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Tool execution failed' };
  }
}

// ============================================================
// Anthropic API Caller
// ============================================================

async function callAnthropicWithTools(
  messages: AnthropicMessage[],
  systemPrompt: string,
  model: string
): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages,
      tools: AGENT_TOOLS,
      max_tokens: 4096,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<AnthropicResponse>;
}

// ============================================================
// Read-only guard
// ============================================================

function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

// ============================================================
// Main Agent Entry Point
// ============================================================

export interface NlopsAgentOptions {
  userInput: string;
  baseUrl: string;
  confirmAction?: boolean;
}

/**
 * Run the NLOps agentic loop.
 * Returns an NLOpsResponse identical in shape to the legacy engine.
 * Throws on unrecoverable errors (caller should fall back to legacy engine).
 */
export async function runNlopsAgent(options: NlopsAgentOptions): Promise<NLOpsResponse> {
  const { userInput, baseUrl, confirmAction } = options;
  const traceEnabled = process.env.AGENT_SDK_TRACE === 'true';
  const model = process.env.AGENT_SDK_MODEL || 'claude-sonnet-4-6';

  const startTime = Date.now();
  const traceId = randomUUID();
  const toolCallRecords: ToolCallRecord[] = [];

  const systemPrompt = buildSystemPrompt();
  const messages: AnthropicMessage[] = [
    { role: 'user', content: userInput },
  ];

  let finalText = '';
  let round = 0;
  let executedAnyTool = false;
  let needsConfirmation = false;
  let confirmationMessage = '';

  while (round < MAX_ROUNDS) {
    round++;
    const assistantMsg = await callAnthropicWithTools(messages, systemPrompt, model);

    // Collect any text blocks
    const textBlocks = assistantMsg.content.filter(
      (b): b is AnthropicTextBlock => b.type === 'text'
    );
    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b) => b.text).join('\n');
    }

    // No more tool calls — done
    if (assistantMsg.stop_reason === 'end_turn') {
      break;
    }

    const toolUseBlocks = assistantMsg.content.filter(
      (b): b is AnthropicToolUseBlock => b.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) break;

    // Check for dangerous tools before executing
    const hasDangerous = toolUseBlocks.some((b) => DANGEROUS_TOOLS.includes(b.name));

    if (hasDangerous && isReadOnlyMode()) {
      return {
        intent: { type: 'unknown', originalInput: userInput },
        executed: false,
        response:
          'Scaling and configuration changes are not available in read-only mode.\n\nTry: "Current status?", "Show metrics", "Cost analysis"',
        suggestedFollowUp: ['Current status', 'Log analysis', 'Cost check'],
      };
    }

    if (hasDangerous && !confirmAction) {
      const dangerousTool = toolUseBlocks.find((b) => DANGEROUS_TOOLS.includes(b.name));
      if (dangerousTool?.name === 'scale_node') {
        confirmationMessage = `Scale to ${dangerousTool.input.targetVcpu} vCPU?`;
      } else if (dangerousTool?.name === 'update_config') {
        const settingLabels: Record<string, string> = {
          autoScaling: 'Auto-scaling',
          simulationMode: 'Simulation mode',
          zeroDowntimeEnabled: 'Zero-downtime scaling',
        };
        const setting = dangerousTool.input.setting as string;
        const value = dangerousTool.input.value as boolean;
        confirmationMessage = `${value ? 'Enable' : 'Disable'} ${settingLabels[setting] || setting}?`;
      }
      needsConfirmation = true;
      break;
    }

    // Append assistant message to conversation
    messages.push({ role: 'assistant', content: assistantMsg.content });

    // Execute all tool_use blocks and collect results
    const toolResultContents: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
    }> = [];

    for (const toolUse of toolUseBlocks) {
      const toolStart = Date.now();
      const result = await executeTool(toolUse.name, toolUse.input, baseUrl);
      const durationMs = Date.now() - toolStart;

      toolCallRecords.push({
        toolName: toolUse.name,
        params: toolUse.input,
        result,
        durationMs,
      });

      toolResultContents.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });

      executedAnyTool = true;
      logger.debug(`[NlopsAgent] Tool ${toolUse.name} completed in ${durationMs}ms`);
    }

    // Feed results back to the model
    messages.push({
      role: 'user',
      content: toolResultContents as unknown as AnthropicContentBlock[],
    });
  }

  // Save trace if enabled
  if (traceEnabled) {
    saveTrace({
      id: traceId,
      userInput,
      toolCalls: toolCallRecords,
      totalRounds: round,
      totalDurationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      model,
    });
  }

  if (needsConfirmation) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      executed: false,
      response: confirmationMessage,
      needsConfirmation: true,
      confirmationMessage,
      suggestedFollowUp: ['Confirm', 'Cancel'],
    };
  }

  if (!finalText) {
    finalText = executedAnyTool
      ? 'Tool execution completed.'
      : "I'm not sure how to help with that. Try asking about system status, costs, or log analysis.";
  }

  return {
    intent: { type: 'unknown', originalInput: userInput },
    executed: executedAnyTool,
    response: finalText,
    data: toolCallRecords.length > 0 ? { traceId, toolCalls: toolCallRecords.length } : undefined,
    suggestedFollowUp: buildFollowUps(toolCallRecords.map((r) => r.toolName)),
  };
}

function buildFollowUps(toolNames: string[]): string[] {
  if (toolNames.includes('run_rca')) return ['Show recommendations', 'What should I do next?', 'Log analysis'];
  if (toolNames.includes('get_anomalies')) return ['Run RCA', 'Log analysis', 'Current status'];
  if (toolNames.includes('get_cost_report')) return ['Scaling options', 'Current status'];
  if (toolNames.includes('scale_node') || toolNames.includes('update_config')) return ['Current status', 'Verify change'];
  return ['Current status', 'Log analysis', 'Cost check'];
}
