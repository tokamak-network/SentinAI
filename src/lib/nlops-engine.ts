/**
 * NLOps Engine v2 - Function Calling Based Natural Language Operations
 *
 * Instead of intent classification → fixed handler,
 * LLM decides when to call tools and generates natural responses.
 *
 * AI calls: chatCompletion() from src/lib/ai-client.ts
 * Log analysis: analyzeLogChunk() from src/lib/ai-analyzer.ts
 */

import type {
  NLOpsIntent,
  NLOpsResponse,
  NLOpsTargetVcpu,
  CurrentSystemState,
} from '@/types/nlops';
import { chatCompletion } from '@/lib/ai-client';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';

// ============================================================
// Constants
// ============================================================

const NLOPS_ENABLED = process.env.NLOPS_ENABLED !== 'false';

const DANGEROUS_TOOLS = ['scale_node', 'update_config'];

/**
 * Check if read-only mode is enabled
 */
function isReadOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true';
}

// ============================================================
// Tool Definitions
// ============================================================

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'get_system_status',
    description: 'Get current system status including L2 metrics, vCPU, memory, scaling state, and component health. Use when user asks about current state, status, or health.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_metrics',
    description: 'Get detailed L2 metrics: CPU usage, TxPool count, block height, gas ratio, memory usage. Use when user asks about specific metrics or numbers.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_cost_report',
    description: 'Generate AI-powered cost optimization report with savings recommendations. Use when user asks about costs, expenses, savings, or budget.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days to analyze (default: 7)' },
      },
      required: [],
    },
  },
  {
    name: 'get_anomalies',
    description: 'Get current anomaly detection results. Use when user asks about anomalies, issues, problems, or alerts.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'analyze_logs',
    description: 'Run AI-powered log analysis across all L2 components (op-geth, op-node, batcher, proposer). Use when user asks to analyze logs, check for issues, or diagnose problems.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['normal', 'attack', 'live'],
          description: 'Analysis mode: normal (standard), attack (security focused), live (real-time logs)',
        },
      },
      required: [],
    },
  },
  {
    name: 'run_rca',
    description: 'Run Root Cause Analysis to identify the root cause of current issues. Use when user asks why something is happening, wants diagnosis, or asks about root cause.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_prediction',
    description: 'Get AI prediction for future resource needs. Use when user asks about predictions, forecasts, or what to expect.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'scale_node',
    description: 'Scale the node to a target vCPU count. DANGEROUS: requires user confirmation. Only use when user explicitly requests scaling.',
    parameters: {
      type: 'object',
      properties: {
        targetVcpu: {
          type: 'number',
          enum: [1, 2, 4],
          description: 'Target vCPU count (1, 2, or 4)',
        },
      },
      required: ['targetVcpu'],
    },
  },
  {
    name: 'update_config',
    description: 'Update system configuration. DANGEROUS: requires user confirmation. Only use when user explicitly requests config changes.',
    parameters: {
      type: 'object',
      properties: {
        setting: {
          type: 'string',
          enum: ['autoScaling', 'simulationMode', 'zeroDowntimeEnabled'],
          description: 'Setting to update',
        },
        value: { type: 'boolean', description: 'New value for the setting' },
      },
      required: ['setting', 'value'],
    },
  },
];

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `You are SentinAI Assistant, a friendly and knowledgeable AI assistant for SentinAI — an Optimism L2 node monitoring and auto-scaling system.

## Your Personality
- Friendly, professional, and concise
- You can have normal conversations (greetings, small talk, jokes)
- When asked about the system, you use the available tools to get real data
- You explain technical concepts in an accessible way

## Available Tools
You have tools to query system status, metrics, costs, anomalies, run log analysis, RCA, get predictions, scale nodes, and update configuration.

## Rules
1. For general conversation (greetings, thanks, jokes, etc.) — respond naturally WITHOUT calling any tools
2. For system-related questions — call the appropriate tool(s) first, then respond based on the data
3. For dangerous actions (scaling, config changes) — always explain what you're about to do and ask for confirmation
4. Support BOTH Korean and English — respond in the same language the user uses
5. Keep responses concise but informative (under 200 words)
6. When presenting data, format numbers nicely and highlight important values
7. If multiple tools are needed, call them and synthesize the results

## Response Format
- Use bullet points for lists
- Don't use markdown headers
- Include relevant numbers and metrics when available`;

// ============================================================
// Tool Execution
// ============================================================

async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  baseUrl: string
): Promise<Record<string, unknown>> {
  try {
    switch (toolName) {
      case 'get_system_status': {
        const [metricsRes, scalerRes] = await Promise.all([
          fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' }),
          fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' }),
        ]);
        const metricsData = metricsRes.ok ? await metricsRes.json() : { error: 'Failed to fetch metrics' };
        const scalerData = scalerRes.ok ? await scalerRes.json() : { error: 'Failed to fetch scaler' };
        return { metrics: metricsData, scaler: scalerData };
      }

      case 'get_metrics': {
        const res = await fetch(`${baseUrl}/api/metrics`, { cache: 'no-store' });
        return res.ok ? await res.json() : { error: 'Failed to fetch metrics' };
      }

      case 'get_cost_report': {
        const days = (params.days as number) || 7;
        const res = await fetch(`${baseUrl}/api/cost-report?days=${days}`, { cache: 'no-store' });
        return res.ok ? await res.json() : { error: 'Failed to fetch cost report' };
      }

      case 'get_anomalies': {
        const res = await fetch(`${baseUrl}/api/anomalies`, { cache: 'no-store' });
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
        const res = await fetch(`${baseUrl}/api/rca`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoTriggered: false }),
        });
        return res.ok ? await res.json() : { error: 'RCA analysis failed' };
      }

      case 'get_prediction': {
        const res = await fetch(`${baseUrl}/api/scaler`, { cache: 'no-store' });
        if (!res.ok) return { error: 'Failed to fetch prediction' };
        const data = await res.json();
        return {
          prediction: data.prediction || null,
          predictionMeta: data.predictionMeta || null,
        };
      }

      case 'scale_node': {
        const targetVcpu = params.targetVcpu as number;
        const res = await fetch(`${baseUrl}/api/scaler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetVcpu }),
        });
        return res.ok ? await res.json() : { error: `Scale request failed: ${res.status}` };
      }

      case 'update_config': {
        const setting = params.setting as string;
        const value = params.value as boolean;
        const bodyMap: Record<string, Record<string, boolean>> = {
          autoScaling: { autoScalingEnabled: value },
          simulationMode: { simulationMode: value },
          zeroDowntimeEnabled: { zeroDowntimeEnabled: value },
        };
        const res = await fetch(`${baseUrl}/api/scaler`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyMap[setting] || {}),
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
// Simulated Tool Use Flow
// ============================================================

/**
 * Step 1: Ask LLM what tools to call (if any)
 */
async function planToolCalls(
  userInput: string,
  currentState: CurrentSystemState
): Promise<{ toolCalls: Array<{ name: string; params: Record<string, unknown> }>; directResponse: string | null }> {
  const toolDescriptions = TOOLS.map(
    (t) => `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters.properties || {})}`
  ).join('\n');

  const planPrompt = `You are deciding whether to call tools for the user's message.

Available tools:
${toolDescriptions}

Current system state:
- vCPU: ${currentState.vcpu}, Memory: ${currentState.memoryGiB} GiB
- CPU: ${currentState.cpuUsage.toFixed(1)}%, TxPool: ${currentState.txPoolCount}
- Auto-scaling: ${currentState.autoScalingEnabled ? 'on' : 'off'}, Simulation: ${currentState.simulationMode ? 'on' : 'off'}

User message: "${userInput}"

If the user is making casual conversation (greeting, thanks, joke, general question not about the system), respond with:
{"tools": [], "directResponse": "<your friendly response>"}

If the user is asking about the system or wants an action, respond with the tools to call:
{"tools": [{"name": "<tool_name>", "params": {<params>}}], "directResponse": null}

For dangerous tools (scale_node, update_config), include them ONLY if the user explicitly requests it.
You can call multiple tools if needed.

Respond ONLY with valid JSON (no markdown).`;

  try {
    const result = await chatCompletion({
      systemPrompt: 'You are a tool planning assistant. Respond only with JSON.',
      userPrompt: planPrompt,
      modelTier: 'fast',
      temperature: 0.1,
    });

    const jsonStr = result.content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      toolCalls: Array.isArray(parsed.tools) ? parsed.tools : [],
      directResponse: parsed.directResponse || null,
    };
  } catch (error) {
    console.error('[NLOps v2] Plan failed:', error);
    return { toolCalls: [], directResponse: null };
  }
}

/**
 * Step 2: Generate final response with tool results
 */
async function generateResponseWithData(
  userInput: string,
  toolResults: Array<{ name: string; data: Record<string, unknown> }>,
  currentState: CurrentSystemState
): Promise<string> {
  const toolDataStr = toolResults
    .map((r) => `[${r.name}] Result:\n${JSON.stringify(r.data, null, 2)}`)
    .join('\n\n');

  try {
    const result = await chatCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `User asked: "${userInput}"

Current system: ${currentState.vcpu} vCPU, CPU ${currentState.cpuUsage.toFixed(1)}%, TxPool ${currentState.txPoolCount}

Tool results:
${toolDataStr}

Generate a natural, helpful response based on this data. Be concise and highlight key information.`,
      modelTier: 'fast',
      temperature: 0.3,
    });

    return result.content;
  } catch {
    // Fallback: return raw summary
    return toolResults
      .map((r) => {
        if (r.data.error) return `Error from ${r.name}: ${r.data.error}`;
        return `${r.name}: Data retrieved successfully.`;
      })
      .join('\n');
  }
}

// ============================================================
// Intent Extraction (for backwards compatibility with UI)
// ============================================================

function extractIntent(
  toolCalls: Array<{ name: string; params: Record<string, unknown> }>,
  userInput: string
): NLOpsIntent {
  if (toolCalls.length === 0) {
    return { type: 'unknown', originalInput: userInput };
  }

  const primary = toolCalls[0];
  switch (primary.name) {
    case 'get_system_status':
      return { type: 'query', target: 'status' };
    case 'get_metrics':
      return { type: 'query', target: 'metrics' };
    case 'get_cost_report':
      return { type: 'query', target: 'cost' };
    case 'get_anomalies':
      return { type: 'query', target: 'anomalies' };
    case 'analyze_logs':
      return { type: 'analyze', mode: (primary.params.mode as 'normal' | 'attack' | 'live') || 'live' };
    case 'run_rca':
      return { type: 'rca' };
    case 'get_prediction':
      return { type: 'query', target: 'status' };
    case 'scale_node':
      return {
        type: 'scale',
        targetVcpu: (primary.params.targetVcpu as NLOpsTargetVcpu) || 2,
        force: false,
      };
    case 'update_config':
      return {
        type: 'config',
        setting: (primary.params.setting as 'autoScaling' | 'simulationMode' | 'zeroDowntimeEnabled') || 'autoScaling',
        value: (primary.params.value as boolean) ?? true,
      };
    default:
      return { type: 'explain', topic: userInput };
  }
}

// ============================================================
// Current State Fetcher
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
    console.error('[NLOps v2] Failed to fetch state:', error);
    return {
      vcpu: 1, memoryGiB: 2, autoScalingEnabled: true,
      simulationMode: true, cpuUsage: 0, txPoolCount: 0, cooldownRemaining: 0,
    };
  }
}

// ============================================================
// Main Command Processor
// ============================================================

/**
 * NLOps v2 main command processor
 * Uses tool-use pattern instead of intent classification
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

  // Step 1: Plan tool calls
  const { toolCalls, directResponse } = await planToolCalls(userInput, currentState);

  // If LLM decided to respond directly (casual conversation)
  if (directResponse && toolCalls.length === 0) {
    return {
      intent: { type: 'unknown', originalInput: userInput },
      executed: false,
      response: directResponse,
      suggestedFollowUp: ['현재 상태', '로그 분석', '비용 확인'],
    };
  }

  // Check read-only mode for dangerous tools
  if (isReadOnlyMode()) {
    const hasDangerousTool = toolCalls.some((tc) => DANGEROUS_TOOLS.includes(tc.name));
    if (hasDangerousTool) {
      return {
        intent: extractIntent(toolCalls, userInput),
        executed: false,
        response: '⚠️ 읽기 전용 모드에서는 스케일링 및 설정 변경이 불가능합니다.\n\n조회 명령어를 사용하세요:\n- "현재 상태는?"\n- "메트릭 조회"\n- "비용 분석"',
        suggestedFollowUp: ['현재 상태', '로그 분석', '비용 확인'],
      };
    }
  }

  // Check for dangerous tools needing confirmation
  const hasDangerousTool = toolCalls.some((tc) => DANGEROUS_TOOLS.includes(tc.name));
  if (hasDangerousTool && !confirmAction) {
    const intent = extractIntent(toolCalls, userInput);
    const dangerousTool = toolCalls.find((tc) => DANGEROUS_TOOLS.includes(tc.name));
    let confirmMsg = 'Proceed with this action?';
    if (dangerousTool?.name === 'scale_node') {
      confirmMsg = `Scale to ${dangerousTool.params.targetVcpu} vCPU?`;
    } else if (dangerousTool?.name === 'update_config') {
      const settingNames: Record<string, string> = {
        autoScaling: 'Auto-scaling',
        simulationMode: 'Simulation mode',
        zeroDowntimeEnabled: 'Zero-downtime scaling',
      };
      const setting = dangerousTool.params.setting as string;
      const value = dangerousTool.params.value as boolean;
      confirmMsg = `${value ? 'Enable' : 'Disable'} ${settingNames[setting] || setting}?`;
    }

    return {
      intent,
      executed: false,
      response: confirmMsg,
      needsConfirmation: true,
      confirmationMessage: confirmMsg,
      suggestedFollowUp: ['Confirm', 'Cancel'],
    };
  }

  // Step 2: Execute tools
  const toolResults: Array<{ name: string; data: Record<string, unknown> }> = [];
  for (const tc of toolCalls) {
    const data = await executeTool(tc.name, tc.params, baseUrl);
    toolResults.push({ name: tc.name, data });
  }

  // Step 3: Generate response
  const intent = extractIntent(toolCalls, userInput);
  let response: string;

  if (toolResults.length > 0) {
    response = await generateResponseWithData(userInput, toolResults, currentState);
  } else {
    // Shouldn't reach here, but fallback
    response = "I'm not sure how to help with that. Try asking about system status, costs, or log analysis.";
  }

  // Generate follow-up suggestions based on tools used
  const suggestedFollowUp = generateFollowUps(toolCalls);

  return {
    intent,
    executed: toolResults.length > 0,
    response,
    data: toolResults.length === 1 ? toolResults[0].data : { results: toolResults },
    suggestedFollowUp,
  };
}

function generateFollowUps(toolCalls: Array<{ name: string; params: Record<string, unknown> }>): string[] {
  if (toolCalls.length === 0) return ['현재 상태', '로그 분석', '비용 확인'];

  const used = new Set(toolCalls.map((tc) => tc.name));
  const suggestions: string[] = [];

  if (!used.has('get_system_status')) suggestions.push('현재 상태');
  if (!used.has('analyze_logs')) suggestions.push('로그 분석 해줘');
  if (!used.has('get_cost_report')) suggestions.push('비용 확인');
  if (!used.has('get_anomalies')) suggestions.push('이상 탐지');
  if (!used.has('run_rca')) suggestions.push('근본 원인 분석');

  return suggestions.slice(0, 3);
}

// Legacy export for backwards compatibility
export async function classifyIntent() {
  throw new Error('classifyIntent is deprecated in NLOps v2. Use processCommand directly.');
}

export async function executeAction() {
  throw new Error('executeAction is deprecated in NLOps v2. Use processCommand directly.');
}

export function isNLOpsEnabled(): boolean {
  return NLOPS_ENABLED;
}
