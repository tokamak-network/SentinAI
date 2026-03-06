/**
 * Agent Event Bus
 * EventEmitter-based pub/sub bus for inter-agent communication.
 * Agents communicate exclusively through this bus — no direct references between agents.
 *
 * Event flow:
 *   DetectorAgent    → emit('anomaly-detected')  → AnalyzerAgent, ExecutorAgent
 *   AnalyzerAgent    → emit('analysis-complete') → VerifierAgent, reports
 *   ExecutorAgent    → emit('execution-complete') → VerifierAgent
 *   VerifierAgent    → emit('verification-complete') → logs
 */

import { EventEmitter } from 'events';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AgentEventBus');

// ============================================================
// Types
// ============================================================

export type AgentEventType =
  // Pipeline events
  | 'anomaly-detected'       // DetectorAgent → AnalyzerAgent, ExecutorAgent
  | 'analysis-complete'      // AnalyzerAgent → VerifierAgent, reports
  | 'execution-complete'     // ExecutorAgent → VerifierAgent
  | 'verification-complete'  // VerifierAgent → logs
  // Domain agent events
  | 'scaling-recommendation' // ScalingAgent/CostAgent → NotifierAgent, ExecutorAgent
  | 'security-alert'         // SecurityAgent → RemediationAgent
  | 'reliability-issue'      // ReliabilityAgent → RemediationAgent
  | 'rca-result'             // RCAAgent → RemediationAgent
  | 'cost-insight'           // CostAgent → CostAgent (auto-apply schedule)
  | 'remediation-complete';  // RemediationAgent → NotifierAgent

export interface AgentEvent {
  type: AgentEventType;
  /** Instance ID this event belongs to */
  instanceId: string;
  /** Event payload — varies by event type */
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** UUID for tracing a single anomaly across all agents */
  correlationId: string;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ============================================================
// AgentEventBus
// ============================================================

/**
 * Lightweight event bus wrapping Node.js EventEmitter.
 * Singleton per process — survives Next.js hot reload via globalThis.
 */
export class AgentEventBus {
  private readonly emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    // Prevent Node.js warning for many listeners (one per agent per instance)
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit an event to all registered handlers.
   */
  emit(event: AgentEvent): void {
    logger.debug(
      `[AgentEventBus] emit type=${event.type} instanceId=${event.instanceId} correlationId=${event.correlationId}`
    );
    this.emitter.emit(event.type, event);
  }

  /**
   * Subscribe to events of a specific type.
   */
  on(type: AgentEventType, handler: AgentEventHandler): void {
    this.emitter.on(type, handler);
  }

  /**
   * Unsubscribe a previously registered handler.
   */
  off(type: AgentEventType, handler: AgentEventHandler): void {
    this.emitter.off(type, handler);
  }

  /**
   * Get the number of active listeners for a given event type.
   * Useful for debugging.
   */
  listenerCount(type: AgentEventType): number {
    return this.emitter.listenerCount(type);
  }
}

// ============================================================
// Singleton
// ============================================================

const g = globalThis as unknown as {
  __sentinai_agent_event_bus?: AgentEventBus;
};

/**
 * Returns the global AgentEventBus singleton.
 * Safe to call during hot reload — always returns the same instance.
 */
export function getAgentEventBus(): AgentEventBus {
  if (!g.__sentinai_agent_event_bus) {
    g.__sentinai_agent_event_bus = new AgentEventBus();
    logger.info('[AgentEventBus] Singleton created');
  }
  return g.__sentinai_agent_event_bus;
}
