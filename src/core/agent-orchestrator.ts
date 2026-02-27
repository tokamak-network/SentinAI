/**
 * Agent Orchestrator
 * Manages role-based parallel agents per node instance.
 * Replaces the serial agent-loop.ts pipeline with concurrent event-driven agents.
 *
 * Per-instance agent set:
 *   CollectorAgent  — 5s interval, collects metrics
 *   DetectorAgent   — 10s interval, detects anomalies, emits events
 *   AnalyzerAgent   — reacts to anomaly-detected, runs AI deep analysis (async)
 *   ExecutorAgent   — reacts to anomaly-detected, executes scaling immediately (parallel with AI)
 *   VerifierAgent   — reacts to execution-complete, verifies post-conditions
 *
 * Critical path: anomaly-detected → ExecutorAgent → 2s (vs. 10s serial pipeline)
 */

import { createLogger } from '@/lib/logger';
import { CollectorAgent } from '@/core/agents/collector-agent';
import { DetectorAgent } from '@/core/agents/detector-agent';
import { AnalyzerAgent } from '@/core/agents/analyzer-agent';
import { ExecutorAgent } from '@/core/agents/executor-agent';
import { VerifierAgent } from '@/core/agents/verifier-agent';

const logger = createLogger('AgentOrchestrator');

// ============================================================
// Types
// ============================================================

export type AgentRole = 'collector' | 'detector' | 'analyzer' | 'executor' | 'verifier';

export interface AgentStatus {
  role: AgentRole;
  instanceId: string;
  running: boolean;
  lastActivityAt: string | null;
}

export interface RoleAgent {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export interface OrchestratorInstance {
  instanceId: string;
  protocolId: string;
  agents: Map<AgentRole, RoleAgent>;
  startedAt: string;
}

// ============================================================
// AgentOrchestrator
// ============================================================

/**
 * Singleton orchestrator that manages all agent instances.
 * Each call to startInstance() creates and starts a full agent set for a node instance.
 */
export class AgentOrchestrator {
  private readonly instances: Map<string, OrchestratorInstance> = new Map();

  /**
   * Start all 5 agents for a node instance.
   * If the instance is already running, this is a no-op.
   *
   * @param instanceId - Unique node instance ID
   * @param protocolId - Protocol type (e.g. 'opstack-l2') used by DetectorAgent
   * @param rpcUrl - Optional RPC endpoint for CollectorAgent (required for metric collection)
   */
  startInstance(instanceId: string, protocolId: string, rpcUrl?: string): void {
    if (this.instances.has(instanceId)) {
      logger.warn(`[AgentOrchestrator] Instance ${instanceId} already running, ignoring startInstance()`);
      return;
    }

    logger.info(`[AgentOrchestrator] Starting instance ${instanceId} (protocol=${protocolId})`);

    const agents = new Map<AgentRole, RoleAgent>();

    // Collector: fetches metrics from the RPC endpoint
    const collectorRpcUrl = rpcUrl ?? process.env.L2_RPC_URL ?? '';
    if (collectorRpcUrl) {
      const collector = new CollectorAgent({ instanceId, rpcUrl: collectorRpcUrl });
      agents.set('collector', collector);
    } else {
      logger.warn(
        `[AgentOrchestrator:${instanceId}] No rpcUrl provided — CollectorAgent skipped. ` +
          'Set L2_RPC_URL or pass rpcUrl to startInstance().'
      );
    }

    // Detector: reads from InstanceMetricsStore, emits anomaly events
    const detector = new DetectorAgent({ instanceId, protocolId });
    agents.set('detector', detector);

    // Analyzer: AI deep analysis (async, non-blocking)
    const analyzer = new AnalyzerAgent({ instanceId });
    agents.set('analyzer', analyzer);

    // Executor: immediate scaling decision (parallel with analyzer)
    const executor = new ExecutorAgent({ instanceId });
    agents.set('executor', executor);

    // Verifier: post-condition check, ledger write
    const verifier = new VerifierAgent({ instanceId });
    agents.set('verifier', verifier);

    // Start all agents
    for (const [role, agent] of agents) {
      try {
        agent.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[AgentOrchestrator:${instanceId}] Failed to start ${role}: ${message}`);
        // Non-fatal: other agents continue even if one fails to start
      }
    }

    this.instances.set(instanceId, {
      instanceId,
      protocolId,
      agents,
      startedAt: new Date().toISOString(),
    });

    logger.info(
      `[AgentOrchestrator] Instance ${instanceId} started (${agents.size} agents)`
    );
  }

  /**
   * Stop all agents for a node instance.
   */
  stopInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      logger.warn(`[AgentOrchestrator] Instance ${instanceId} not found, ignoring stopInstance()`);
      return;
    }

    logger.info(`[AgentOrchestrator] Stopping instance ${instanceId}`);

    for (const [role, agent] of instance.agents) {
      try {
        agent.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[AgentOrchestrator:${instanceId}] Failed to stop ${role}: ${message}`);
      }
    }

    this.instances.delete(instanceId);
    logger.info(`[AgentOrchestrator] Instance ${instanceId} stopped`);
  }

  /**
   * Stop all instances.
   */
  stopAll(): void {
    const instanceIds = Array.from(this.instances.keys());
    logger.info(`[AgentOrchestrator] Stopping all instances (${instanceIds.length})`);

    for (const instanceId of instanceIds) {
      this.stopInstance(instanceId);
    }
  }

  /**
   * Get running status for every agent across all instances.
   */
  getStatuses(): AgentStatus[] {
    const statuses: AgentStatus[] = [];

    for (const instance of this.instances.values()) {
      for (const [role, agent] of instance.agents) {
        // Best-effort: get last activity from agents that expose it
        let lastActivityAt: string | null = null;
        if ('getLastCollectedAt' in agent && typeof agent.getLastCollectedAt === 'function') {
          lastActivityAt = (agent as CollectorAgent).getLastCollectedAt();
        } else if ('getLastExecutedAt' in agent && typeof agent.getLastExecutedAt === 'function') {
          lastActivityAt = (agent as ExecutorAgent).getLastExecutedAt();
        }

        statuses.push({
          role,
          instanceId: instance.instanceId,
          running: agent.isRunning(),
          lastActivityAt,
        });
      }
    }

    return statuses;
  }

  /**
   * Get all running instance IDs.
   */
  getInstanceIds(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * Check if a specific instance is running.
   */
  isInstanceRunning(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }
}

// ============================================================
// Singleton
// ============================================================

const g = globalThis as unknown as {
  __sentinai_agent_orchestrator?: AgentOrchestrator;
};

/**
 * Returns the global AgentOrchestrator singleton.
 * Safe to call during Next.js hot reload — always returns the same instance.
 */
export function getAgentOrchestrator(): AgentOrchestrator {
  if (!g.__sentinai_agent_orchestrator) {
    g.__sentinai_agent_orchestrator = new AgentOrchestrator();
    logger.info('[AgentOrchestrator] Singleton created');
  }
  return g.__sentinai_agent_orchestrator;
}
