/**
 * Domain Agent — Abstract Base Class for Specialized Domain Agents
 *
 * Domain agents are independent specialists that wrap existing lib modules
 * and operate in parallel alongside the pipeline agents (Collector→Verifier).
 *
 * Architecture:
 *   [Domain Layer]  ScalingAgent | SecurityAgent | ReliabilityAgent | RCAAgent | CostAgent
 *                        ↓              ↓              ↓               ↓          ↓
 *   [Pipeline]      Collect → Detect → Analyze → Execute → Verify
 *                        ↓
 *   [Experience]    Experience Store → Pattern Extractor → Resume
 *
 * Design:
 *   - Implements RoleAgent for seamless AgentOrchestrator integration
 *   - Communicates via EventBus only — no direct agent references
 *   - Each agent records domain-specific experience entries
 *   - Periodic agents use tick(), event-reactive agents override start/stop
 */

import { createLogger } from '@/lib/logger';
import { recordExperience } from '@/lib/experience-store';
import { DOMAIN_CATEGORY_MAP } from '@/types/experience';
import type { RoleAgent } from '@/core/agent-orchestrator';
import type { ExperienceEntry, ExperienceCategory } from '@/types/experience';

const logger = createLogger('DomainAgent');

// ============================================================
// Types
// ============================================================

export type DomainAgentType = 'scaling' | 'security' | 'reliability' | 'rca' | 'cost';

export interface DomainAgentConfig {
  instanceId: string;
  protocolId: string;
  /** Tick interval in milliseconds (default varies by agent) */
  intervalMs?: number;
}

export type DomainExperienceCategory = ExperienceCategory;

// ============================================================
// DomainAgent Abstract Class
// ============================================================

export abstract class DomainAgent implements RoleAgent {
  readonly instanceId: string;
  readonly protocolId: string;
  abstract readonly domain: DomainAgentType;

  protected timer: ReturnType<typeof setInterval> | null = null;
  protected running = false;
  protected tickCount = 0;
  protected lastTickAt: string | null = null;

  private readonly intervalMs: number;

  constructor(config: DomainAgentConfig) {
    this.instanceId = config.instanceId;
    this.protocolId = config.protocolId;
    this.intervalMs = config.intervalMs ?? 30_000;
  }

  /**
   * Start the periodic tick loop.
   * Override in event-reactive agents (e.g., RCAAgent subscribes to events instead).
   */
  start(): void {
    if (this.running) {
      logger.warn(`[${this.domain}Agent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    logger.info(`[${this.domain}Agent:${this.instanceId}] Starting (interval=${this.intervalMs}ms)`);

    this.timer = setInterval(() => {
      void this.safeTick();
    }, this.intervalMs);
  }

  /**
   * Stop the periodic tick loop or event subscriptions.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    logger.info(`[${this.domain}Agent:${this.instanceId}] Stopped`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  getLastTickAt(): string | null {
    return this.lastTickAt;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  // ============================================================
  // Abstract — Subclasses implement domain-specific logic
  // ============================================================

  /**
   * Domain-specific work executed periodically or triggered by events.
   * Must not throw — errors are caught by safeTick().
   */
  protected abstract tick(): Promise<void>;

  // ============================================================
  // Protected helpers
  // ============================================================

  /**
   * Record a domain experience entry with automatic category tagging.
   */
  protected async recordDomainExperience(params: {
    trigger: { type: string; metric: string; value: number };
    action: string;
    outcome: 'success' | 'failure' | 'partial';
    resolutionMs: number;
    metricsSnapshot?: Record<string, number>;
  }): Promise<ExperienceEntry> {
    return recordExperience({
      instanceId: this.instanceId,
      protocolId: this.protocolId,
      category: DOMAIN_CATEGORY_MAP[this.domain],
      trigger: params.trigger,
      action: params.action,
      outcome: params.outcome,
      resolutionMs: params.resolutionMs,
      metricsSnapshot: params.metricsSnapshot ?? {},
    });
  }

  // ============================================================
  // Private
  // ============================================================

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
      this.tickCount += 1;
      this.lastTickAt = new Date().toISOString();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[${this.domain}Agent:${this.instanceId}] Tick error: ${message}`);
      // Non-fatal: tick failure doesn't stop the agent
    }
  }
}
