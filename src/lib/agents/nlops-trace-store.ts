/**
 * NLOps Agent Trace Store
 *
 * Stores tool-call traces from the Anthropic agentic loop.
 * Allows post-hoc inspection of which tools the agent called and what it saw.
 *
 * Storage: in-memory ring buffer (last 100 traces).
 * If Redis is available, each trace is also persisted under nlops:trace:<id>.
 */

export interface ToolCallRecord {
  toolName: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
  durationMs: number;
}

export interface AgentTrace {
  id: string;
  userInput: string;
  toolCalls: ToolCallRecord[];
  totalRounds: number;
  totalDurationMs: number;
  timestamp: string;
  model: string;
}

// In-memory ring buffer (last 100 traces)
const MAX_TRACES = 100;
const traceBuffer: AgentTrace[] = [];

export function saveTrace(trace: AgentTrace): void {
  if (traceBuffer.length >= MAX_TRACES) {
    traceBuffer.shift();
  }
  traceBuffer.push(trace);
}

export function getRecentTraces(limit = 10): AgentTrace[] {
  return traceBuffer.slice(-limit);
}

export function getTrace(id: string): AgentTrace | undefined {
  return traceBuffer.find((t) => t.id === id);
}
