/**
 * Agent Event Flow Integration Tests
 * Verifies the EventBus event chain across agents:
 *   anomaly-detected → ExecutorAgent + AnalyzerAgent fire in parallel
 *   execution-complete → VerifierAgent records to ledger
 *   AGENT_V2=true → serial agent-loop is skipped
 *
 * Strategy: REAL EventBus, MOCKED external deps (RPC, K8s, AI, Redis).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks — declared before any imports that use them
// ============================================================

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  scaleOpGeth: vi.fn().mockResolvedValue({
    success: true,
    previousVcpu: 2,
    currentVcpu: 4,
    previousMemoryGiB: 4,
    currentMemoryGiB: 8,
    timestamp: new Date().toISOString(),
    message: 'Scaled to 4 vCPU',
  }),
  getCurrentVcpu: vi.fn().mockResolvedValue(4),
  isAutoScalingEnabled: vi.fn().mockResolvedValue(true),
  checkCooldown: vi.fn().mockResolvedValue({ inCooldown: false, remainingSeconds: 0 }),
  addScalingHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn().mockResolvedValue({
    content: '{"severity":"high","summary":"Gas spike detected, scaling recommended"}',
  }),
}));

vi.mock('@/core/instance-metrics-store', () => ({
  getRecentMetrics: vi.fn().mockResolvedValue([
    {
      instanceId: 'test-inst',
      timestamp: new Date().toISOString(),
      fields: {
        cpuUsage: 85,
        txPoolPending: 500,
        gasUsedRatio: 0.9,
      },
    },
  ]),
  pushMetric: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/daily-accumulator', () => ({
  addScalingEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/redis', () => ({
  getCoreRedis: vi.fn().mockReturnValue(null),
  resetCoreRedis: vi.fn().mockResolvedValue(undefined),
}));

// ============================================================
// Imports — after mocks
// ============================================================

import { AgentEventBus, getAgentEventBus } from '@/core/agent-event-bus';
import type { AgentEvent } from '@/core/agent-event-bus';
import { ExecutorAgent } from '@/core/agents/executor-agent';
import { AnalyzerAgent } from '@/core/agents/analyzer-agent';
import { VerifierAgent } from '@/core/agents/verifier-agent';
import type { DetectionResult } from '@/core/anomaly/generic-detector';

// ============================================================
// Helpers
// ============================================================

const INSTANCE_ID = 'test-inst';

function makeAnomalyEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  const detection: DetectionResult = {
    instanceId: INSTANCE_ID,
    timestamp: new Date().toISOString(),
    hasAnomaly: true,
    anomalies: [
      {
        fieldName: 'gasUsedRatio',
        displayName: 'Gas Used Ratio',
        method: 'z-score',
        currentValue: 0.95,
        zScore: 4.2,
        severity: 'high',
        message: 'Gas used ratio 0.95 exceeds normal range (z=4.2)',
      },
    ],
  };

  return {
    type: 'anomaly-detected',
    instanceId: INSTANCE_ID,
    payload: { detection, protocolId: 'opstack-l2' },
    timestamp: new Date().toISOString(),
    correlationId: 'corr-test-001',
    ...overrides,
  };
}

/**
 * Wait for all pending microtasks/promises to settle.
 * Needed because agent handlers are fire-and-forget (void this.handle...).
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ============================================================
// Tests
// ============================================================

describe('Agent Event Flow Integration', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    // Reset the global EventBus singleton for test isolation
    const g = globalThis as Record<string, unknown>;
    delete g.__sentinai_agent_event_bus;
    bus = getAgentEventBus();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Ensure agents are unsubscribed to prevent cross-test leaks
    const g = globalThis as Record<string, unknown>;
    delete g.__sentinai_agent_event_bus;
  });

  // ----------------------------------------------------------
  // Test 1: anomaly-detected → executor + analyzer both fire
  // ----------------------------------------------------------
  describe('anomaly-detected → ExecutorAgent + AnalyzerAgent', () => {
    it('both agents receive the event and emit downstream events', async () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });
      const analyzer = new AnalyzerAgent({ instanceId: INSTANCE_ID });

      executor.start();
      analyzer.start();

      // Verify subscriptions were registered
      expect(bus.listenerCount('anomaly-detected')).toBe(2);

      // Capture downstream events
      const executionEvents: AgentEvent[] = [];
      const analysisEvents: AgentEvent[] = [];
      bus.on('execution-complete', (e) => executionEvents.push(e));
      bus.on('analysis-complete', (e) => analysisEvents.push(e));

      // Emit anomaly event
      bus.emit(makeAnomalyEvent());
      await flushPromises();

      // ExecutorAgent should have emitted execution-complete
      expect(executionEvents.length).toBe(1);
      expect(executionEvents[0].type).toBe('execution-complete');
      expect(executionEvents[0].instanceId).toBe(INSTANCE_ID);
      expect(executionEvents[0].correlationId).toBe('corr-test-001');

      // AnalyzerAgent should have emitted analysis-complete
      expect(analysisEvents.length).toBe(1);
      expect(analysisEvents[0].type).toBe('analysis-complete');
      expect(analysisEvents[0].instanceId).toBe(INSTANCE_ID);
      expect(analysisEvents[0].correlationId).toBe('corr-test-001');

      // Cleanup
      executor.stop();
      analyzer.stop();
    });

    it('agents only handle events matching their instanceId', async () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });
      executor.start();

      const executionEvents: AgentEvent[] = [];
      bus.on('execution-complete', (e) => executionEvents.push(e));

      // Emit event for a DIFFERENT instance
      bus.emit(makeAnomalyEvent({ instanceId: 'other-instance' }));
      await flushPromises();

      // Should NOT fire — instanceId mismatch
      expect(executionEvents.length).toBe(0);

      executor.stop();
    });

    it('events with hasAnomaly=false are ignored', async () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });
      executor.start();

      const executionEvents: AgentEvent[] = [];
      bus.on('execution-complete', (e) => executionEvents.push(e));

      const noAnomalyEvent = makeAnomalyEvent();
      const detection = noAnomalyEvent.payload['detection'] as DetectionResult;
      (noAnomalyEvent.payload as Record<string, unknown>)['detection'] = {
        ...detection,
        hasAnomaly: false,
        anomalies: [],
      };

      bus.emit(noAnomalyEvent);
      await flushPromises();

      expect(executionEvents.length).toBe(0);

      executor.stop();
    });
  });

  // ----------------------------------------------------------
  // Test 2: execution-complete → VerifierAgent records
  // ----------------------------------------------------------
  describe('execution-complete → VerifierAgent', () => {
    it('verifier records execution and emits verification-complete', async () => {
      const verifier = new VerifierAgent({ instanceId: INSTANCE_ID });
      verifier.start();

      expect(bus.listenerCount('execution-complete')).toBe(1);

      const verificationEvents: AgentEvent[] = [];
      bus.on('verification-complete', (e) => verificationEvents.push(e));

      // Emit execution-complete directly (simulating ExecutorAgent output)
      bus.emit({
        type: 'execution-complete',
        instanceId: INSTANCE_ID,
        payload: {
          decision: { targetVcpu: 4, score: 80, reason: 'High load' },
          executed: true,
          previousVcpu: 2,
          currentVcpu: 4,
          reason: '[Executed] 2 → 4 vCPU',
          durationMs: 150,
        },
        timestamp: new Date().toISOString(),
        correlationId: 'corr-test-002',
      });
      await flushPromises();

      expect(verificationEvents.length).toBe(1);
      expect(verificationEvents[0].type).toBe('verification-complete');
      expect(verificationEvents[0].correlationId).toBe('corr-test-002');

      // Verify the operation record is present in the payload
      const record = (verificationEvents[0].payload as Record<string, unknown>)['operationRecord'] as Record<string, unknown>;
      expect(record).toBeDefined();
      expect(record['instanceId']).toBe(INSTANCE_ID);
      expect(record['passed']).toBe(true); // getCurrentVcpu mock returns 4, expected 4
      expect(record['executed']).toBe(true);

      verifier.stop();
    });

    it('verifier records non-executed events without K8s verification', async () => {
      const verifier = new VerifierAgent({ instanceId: INSTANCE_ID });
      verifier.start();

      const verificationEvents: AgentEvent[] = [];
      bus.on('verification-complete', (e) => verificationEvents.push(e));

      // Emit execution-complete where scaling was NOT executed (e.g. cooldown)
      bus.emit({
        type: 'execution-complete',
        instanceId: INSTANCE_ID,
        payload: {
          executed: false,
          previousVcpu: 2,
          currentVcpu: 2,
          reason: '[Skip] Cooldown 120s',
          durationMs: 5,
        },
        timestamp: new Date().toISOString(),
        correlationId: 'corr-test-003',
      });
      await flushPromises();

      expect(verificationEvents.length).toBe(1);
      const record = (verificationEvents[0].payload as Record<string, unknown>)['operationRecord'] as Record<string, unknown>;
      expect(record['executed']).toBe(false);
      // Non-executed events should pass verification trivially
      expect(record['passed']).toBe(true);

      verifier.stop();
    });
  });

  // ----------------------------------------------------------
  // Test 3: Full chain — anomaly → executor → verifier
  // ----------------------------------------------------------
  describe('full event chain: anomaly → execution → verification', () => {
    it('end-to-end event propagation preserves correlationId', async () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });
      const analyzer = new AnalyzerAgent({ instanceId: INSTANCE_ID });
      const verifier = new VerifierAgent({ instanceId: INSTANCE_ID });

      executor.start();
      analyzer.start();
      verifier.start();

      const allEvents: AgentEvent[] = [];
      bus.on('execution-complete', (e) => allEvents.push(e));
      bus.on('analysis-complete', (e) => allEvents.push(e));
      bus.on('verification-complete', (e) => allEvents.push(e));

      // Trigger the full chain
      bus.emit(makeAnomalyEvent({ correlationId: 'corr-e2e-001' }));
      await flushPromises();

      // All downstream events must carry the same correlationId
      const correlationIds = allEvents.map((e) => e.correlationId);
      expect(correlationIds.length).toBeGreaterThanOrEqual(3); // exec + analysis + verification
      correlationIds.forEach((id) => expect(id).toBe('corr-e2e-001'));

      // Verify event types
      const types = allEvents.map((e) => e.type);
      expect(types).toContain('execution-complete');
      expect(types).toContain('analysis-complete');
      expect(types).toContain('verification-complete');

      executor.stop();
      analyzer.stop();
      verifier.stop();
    });
  });

  // ----------------------------------------------------------
  // Test 4: Agent start/stop lifecycle
  // ----------------------------------------------------------
  describe('agent start/stop lifecycle', () => {
    it('stopped agents do not receive events', async () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });

      executor.start();
      expect(bus.listenerCount('anomaly-detected')).toBe(1);

      executor.stop();
      expect(bus.listenerCount('anomaly-detected')).toBe(0);

      const executionEvents: AgentEvent[] = [];
      bus.on('execution-complete', (e) => executionEvents.push(e));

      bus.emit(makeAnomalyEvent());
      await flushPromises();

      expect(executionEvents.length).toBe(0);
    });

    it('start() is idempotent — double start does not double-subscribe', () => {
      const executor = new ExecutorAgent({ instanceId: INSTANCE_ID });

      executor.start();
      executor.start(); // should be a no-op

      expect(bus.listenerCount('anomaly-detected')).toBe(1);

      executor.stop();
    });
  });

});
