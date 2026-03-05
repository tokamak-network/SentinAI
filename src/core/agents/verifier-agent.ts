/**
 * Verifier Agent
 * Subscribes to 'execution-complete' events and verifies post-conditions.
 * Records results to OperationLedger in Redis (inst:{instanceId}:operations:{id}).
 * Emits 'verification-complete' when done.
 *
 * Role in the pipeline:
 *   EventBus('execution-complete') → VerifierAgent → OperationLedger (Redis) → EventBus('verification-complete')
 *
 * The ledger data powers future Self-Evolving Playbook (Proposal 32).
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getCurrentVcpu } from '@/lib/k8s-scaler';
import { getCoreRedis } from '@/core/redis';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { ExecutionPayload } from './executor-agent';

const logger = createLogger('VerifierAgent');

// ============================================================
// Types
// ============================================================

export interface VerifierAgentConfig {
  instanceId: string;
}

export interface OperationRecord {
  id: string;
  instanceId: string;
  correlationId: string;
  timestamp: string;
  /** Whether the scaling action was executed */
  executed: boolean;
  /** Expected vCPU after execution */
  expectedVcpu: number;
  /** Observed vCPU from K8s after execution */
  observedVcpu: number;
  /** Whether post-condition verification passed */
  passed: boolean;
  /** Human-readable verification detail */
  detail: string;
  /** Execution payload snapshot */
  executionPayload: Partial<ExecutionPayload>;
}

export interface VerificationPayload {
  operationRecord: OperationRecord;
}

// ============================================================
// OperationLedger
// ============================================================

const LEDGER_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const LEDGER_MAX_PER_INSTANCE = 200;

function buildLedgerKey(instanceId: string, operationId: string): string {
  return `inst:${instanceId}:operations:${operationId}`;
}

function buildLedgerIndexKey(instanceId: string): string {
  return `inst:${instanceId}:operations:index`;
}

async function persistOperationRecord(record: OperationRecord): Promise<void> {
  const redis = getCoreRedis();
  if (!redis) {
    // In-memory fallback: just log — ledger requires Redis for cross-restart persistence
    logger.debug(
      `[VerifierAgent:${record.instanceId}] Ledger (in-memory fallback): op=${record.id} passed=${record.passed}`
    );
    return;
  }

  const key = buildLedgerKey(record.instanceId, record.id);
  const indexKey = buildLedgerIndexKey(record.instanceId);

  await redis.set(key, JSON.stringify(record), 'EX', LEDGER_TTL_SECONDS);
  // Maintain a sorted index (score = timestamp epoch ms)
  await redis.zadd(indexKey, Date.now(), record.id);
  // Trim index to max entries
  await redis.zremrangebyrank(indexKey, 0, -(LEDGER_MAX_PER_INSTANCE + 1));
}

// ============================================================
// VerifierAgent
// ============================================================

/**
 * Event-driven post-execution verifier for a single node instance.
 */
export class VerifierAgent {
  readonly instanceId: string;

  private running = false;
  private verificationCount = 0;
  private lastActivityAt: string | null = null;
  private readonly handler: AgentEventHandler;

  constructor(config: VerifierAgentConfig) {
    this.instanceId = config.instanceId;

    this.handler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleExecutionComplete(event);
    };
  }

  /**
   * Start listening for execution-complete events.
   */
  start(): void {
    if (this.running) {
      logger.warn(`[VerifierAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    getAgentEventBus().on('execution-complete', this.handler);
    logger.info(`[VerifierAgent:${this.instanceId}] Subscribed to execution-complete`);
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    getAgentEventBus().off('execution-complete', this.handler);
    logger.info(`[VerifierAgent:${this.instanceId}] Unsubscribed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getVerificationCount(): number {
    return this.verificationCount;
  }

  getLastActivityAt(): string | null {
    return this.lastActivityAt;
  }

  // ============================================================
  // Private
  // ============================================================

  private async handleExecutionComplete(event: AgentEvent): Promise<void> {
    const executionPayload = event.payload as Partial<ExecutionPayload>;

    logger.info(
      `[VerifierAgent:${this.instanceId}] Verifying (correlationId=${event.correlationId})`
    );

    try {
      let passed = true;
      let detail = 'No scaling executed — verification not required';
      let observedVcpu = executionPayload.currentVcpu ?? 0;
      const expectedVcpu = executionPayload.currentVcpu ?? 0;

      if (executionPayload.executed) {
        // Verify the actual K8s state matches the expected vCPU
        observedVcpu = await getCurrentVcpu();
        passed = observedVcpu === expectedVcpu;
        detail = passed
          ? `Post-condition verified: ${observedVcpu} vCPU matches expected ${expectedVcpu} vCPU`
          : `Post-condition FAILED: observed ${observedVcpu} vCPU, expected ${expectedVcpu} vCPU`;

        if (!passed) {
          logger.warn(
            `[VerifierAgent:${this.instanceId}] Verification failed — ${detail}`
          );
        }
      }

      const record: OperationRecord = {
        id: randomUUID(),
        instanceId: this.instanceId,
        correlationId: event.correlationId,
        timestamp: event.timestamp,
        executed: executionPayload.executed ?? false,
        expectedVcpu,
        observedVcpu,
        passed,
        detail,
        executionPayload,
      };

      await persistOperationRecord(record);
      this.verificationCount += 1;
      this.lastActivityAt = new Date().toISOString();

      logger.info(
        `[VerifierAgent:${this.instanceId}] Verification complete — passed=${passed}`
      );

      const payload: VerificationPayload = { operationRecord: record };

      getAgentEventBus().emit({
        type: 'verification-complete',
        instanceId: this.instanceId,
        payload: payload as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[VerifierAgent:${this.instanceId}] Verification error: ${message}`);
      // Non-fatal: emit verification-complete with failure state
      getAgentEventBus().emit({
        type: 'verification-complete',
        instanceId: this.instanceId,
        payload: {
          operationRecord: {
            id: randomUUID(),
            instanceId: this.instanceId,
            correlationId: event.correlationId,
            timestamp: event.timestamp,
            executed: false,
            expectedVcpu: 0,
            observedVcpu: 0,
            passed: false,
            detail: `Verification error: ${message}`,
            executionPayload: {},
          } satisfies OperationRecord,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    }
  }
}
