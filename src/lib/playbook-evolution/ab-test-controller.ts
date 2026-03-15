/**
 * ABTestController: A/B Testing Module
 *
 * Runs two playbooks in parallel with 50/50 split assignment.
 * Uses Fisher's exact test to determine statistical significance.
 * Decides winner when confidence >= 95% (p < 0.05).
 */

import type { IStateStore } from '../../types/redis';
import type { Redis } from 'ioredis';
import { ABTestSession } from '../types/playbook-evolution';

const AB_TEST_STATE_KEY = 'ab_test:state';
const AB_TEST_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Simple Result type for error handling
 */
export class Result<T, E = Error> {
  private constructor(
    private value: T | null,
    private error: E | null,
  ) {}

  isOk(): boolean {
    return this.error === null;
  }

  isErr(): boolean {
    return this.error !== null;
  }

  unwrap(): T {
    if (this.error !== null) {
      throw new Error(`Called unwrap on Err: ${this.error}`);
    }
    return this.value!;
  }

  getError(): E | null {
    return this.error;
  }

  static ok<T, E = Error>(value: T): Result<T, E> {
    return new Result<T, E>(value, null as E | null);
  }

  static err<T, E = Error>(error: E): Result<T, E> {
    return new Result<T, E>(null as T | null, error);
  }
}

/**
 * ABTestController: Manages A/B test sessions
 */
export class ABTestController {
  constructor(
    private store: IStateStore,
    private redis: Redis,
  ) {}

  /**
   * Load ABTestState from Redis (or initialize if missing)
   */
  private async loadState(): Promise<ABTestSession | null> {
    try {
      const data = await this.redis.getex(AB_TEST_STATE_KEY);
      if (!data) return null;
      return JSON.parse(data) as ABTestSession;
    } catch (err) {
      console.error('[ABTestController] loadState error:', err);
      return null;
    }
  }

  /**
   * Save ABTestState to Redis with 7-day TTL
   */
  private async saveState(session: ABTestSession): Promise<void> {
    try {
      const data = JSON.stringify(session);
      await this.redis.setex(AB_TEST_STATE_KEY, AB_TEST_TTL, data);
    } catch (err) {
      console.error('[ABTestController] saveState error:', err);
      throw err;
    }
  }

  /**
   * Start a new A/B test session
   * testPlaybookId: newly generated playbook
   * controlPlaybookId: existing playbook
   */
  async startSession(
    testPlaybookId: string,
    controlPlaybookId: string,
  ): Promise<Result<ABTestSession, Error>> {
    try {
      const sessionId = this.generateSessionId();

      const session: ABTestSession = {
        id: sessionId,
        testPlaybookId,
        controlPlaybookId,
        status: 'running',
        createdAt: new Date(),
        stats: {
          controlExecutions: 0,
          testExecutions: 0,
          controlSuccesses: 0,
          testSuccesses: 0,
          confidenceLevel: 0,
          statSignificant: false,
        },
      };

      await this.saveState(session);
      return Result.ok(session);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[ABTestController] startSession error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Record an execution result (50/50 split assignment)
   *
   * Algorithm:
   * 1. Calculate total = controlExecutions + testExecutions
   * 2. Assign:
   *    - if total % 2 === 0: assign to control
   *    - if total % 2 === 1: assign to test
   * 3. Increment execution count for assigned side
   * 4. If success, increment success count
   * 5. Recalculate confidence using Fisher's exact test
   * 6. Save to Redis
   */
  async recordExecution(
    sessionId: string,
    success: boolean,
  ): Promise<Result<{ walletAddress: string; confidenceLevel: number }, Error>> {
    try {
      const session = await this.loadState();
      if (!session || session.id !== sessionId) {
        return Result.err(new Error(`Session not found: ${sessionId}`));
      }

      const total = session.stats.controlExecutions + session.stats.testExecutions;
      const isControlTurn = total % 2 === 0;

      if (isControlTurn) {
        session.stats.controlExecutions++;
        if (success) {
          session.stats.controlSuccesses++;
        }
      } else {
        session.stats.testExecutions++;
        if (success) {
          session.stats.testSuccesses++;
        }
      }

      // Recalculate Fisher's exact test
      const { pValue, confidenceLevel, statSignificant } =
        this.computeFishersExactTest(
          session.stats.controlSuccesses,
          session.stats.controlExecutions - session.stats.controlSuccesses,
          session.stats.testSuccesses,
          session.stats.testExecutions - session.stats.testSuccesses,
        );

      session.stats.confidenceLevel = confidenceLevel;
      session.stats.statSignificant = statSignificant;

      await this.saveState(session);

      return Result.ok({
        walletAddress: sessionId,
        confidenceLevel: session.stats.confidenceLevel,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[ABTestController] recordExecution error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Compute Fisher's exact test p-value and confidence level
   *
   * 2x2 contingency table:
   *          Success  Failure
   * Control    a        b       (n1 = a+b)
   * Test       c        d       (n2 = c+d)
   *          (m1=a+c) (m2=b+d)  (N = total)
   *
   * p-value = (n1! * n2! * m1! * m2!) / (N! * a! * b! * c! * d!)
   *
   * Two-sided p-value: sum of all hypergeometric probabilities <= current
   */
  private computeFishersExactTest(
    controlSuccesses: number,
    controlFailures: number,
    testSuccesses: number,
    testFailures: number,
  ): { pValue: number; confidenceLevel: number; statSignificant: boolean } {
    const a = controlSuccesses;
    const b = controlFailures;
    const c = testSuccesses;
    const d = testFailures;

    const n1 = a + b;
    const n2 = c + d;
    const m1 = a + c;
    const m2 = b + d;
    const N = n1 + n2;

    // Avoid division by zero or invalid cases
    if (N === 0) {
      return { pValue: 1, confidenceLevel: 0, statSignificant: false };
    }

    // Compute hypergeometric probability for the observed contingency table
    const obsProb = this.hypergeometricProb(a, b, c, d, n1, n2, m1, m2, N);

    // Two-sided p-value: sum of probabilities <= observed
    let pValue = 0;

    // Iterate through all possible contingency tables with same marginals
    const minA = Math.max(0, m1 - n2);
    const maxA = Math.min(n1, m1);

    for (let testA = minA; testA <= maxA; testA++) {
      const testB = n1 - testA;
      const testC = m1 - testA;
      const testD = m2 - testB;

      const testProb = this.hypergeometricProb(
        testA,
        testB,
        testC,
        testD,
        n1,
        n2,
        m1,
        m2,
        N,
      );

      if (testProb <= obsProb + 1e-10) {
        // Add epsilon for floating point comparison
        pValue += testProb;
      }
    }

    // Clamp p-value to [0, 1]
    pValue = Math.min(1, Math.max(0, pValue));

    // Confidence level = (1 - p-value) * 100
    const confidenceLevel = (1 - pValue) * 100;
    const statSignificant = pValue < 0.05;

    return { pValue, confidenceLevel, statSignificant };
  }

  /**
   * Hypergeometric probability for a 2x2 contingency table
   * P(a, b, c, d | n1, n2, m1, m2, N) = (n1! * n2! * m1! * m2!) / (N! * a! * b! * c! * d!)
   */
  private hypergeometricProb(
    a: number,
    b: number,
    c: number,
    d: number,
    n1: number,
    n2: number,
    m1: number,
    m2: number,
    N: number,
  ): number {
    // Use log factorials for numerical stability
    const logProb =
      this.lnFactorial(n1) +
      this.lnFactorial(n2) +
      this.lnFactorial(m1) +
      this.lnFactorial(m2) -
      (this.lnFactorial(N) +
        this.lnFactorial(a) +
        this.lnFactorial(b) +
        this.lnFactorial(c) +
        this.lnFactorial(d));

    return Math.exp(logProb);
  }

  /**
   * Natural log of factorial using Stirling's approximation
   * ln(n!) ≈ n*ln(n) - n + 0.5*ln(2πn)
   */
  private lnFactorial(n: number): number {
    if (n <= 0) return 0;
    if (n <= 1) return 0;
    if (n === 2) return Math.log(2);
    return n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n);
  }

  /**
   * Check if decision is statistically ready
   * Returns true when: statSignificant === true AND confidenceLevel >= 95
   */
  async isDecisionReady(sessionId: string): Promise<boolean> {
    try {
      const session = await this.loadState();
      if (!session || session.id !== sessionId) {
        return false;
      }

      return (
        session.stats.statSignificant && session.stats.confidenceLevel >= 95
      );
    } catch (err) {
      console.error('[ABTestController] isDecisionReady error:', err);
      return false;
    }
  }

  /**
   * Complete session (status: 'completed')
   * Decides winner: testSuccessRate > controlSuccessRate ? 'test' : 'control'
   */
  async completeSession(
    sessionId: string,
  ): Promise<Result<{ winner: 'test' | 'control' }, Error>> {
    try {
      const session = await this.loadState();
      if (!session || session.id !== sessionId) {
        return Result.err(new Error(`Session not found: ${sessionId}`));
      }

      const controlSuccessRate =
        session.stats.controlExecutions > 0
          ? session.stats.controlSuccesses / session.stats.controlExecutions
          : 0;

      const testSuccessRate =
        session.stats.testExecutions > 0
          ? session.stats.testSuccesses / session.stats.testExecutions
          : 0;

      const winner = testSuccessRate > controlSuccessRate ? 'test' : 'control';

      session.status = 'completed';

      await this.saveState(session);

      return Result.ok({ winner });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[ABTestController] completeSession error:', error.message);
      return Result.err(error);
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `ab-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
