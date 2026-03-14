/**
 * A/B Test Controller
 * Manages A/B testing sessions between control and test playbook versions
 */

import type { ABTestSession, PlaybookVersion } from './playbook-evolution-types';

interface FishersExactTestResult {
  pValue: number;
  significant: boolean;
  confidenceThreshold: number;
}

export class ABTestController {
  private sessions = new Map<string, ABTestSession>();

  createSession(
    id: string,
    controlVersionId: string,
    testVersionId: string
  ): ABTestSession {
    const session: ABTestSession = {
      id,
      status: 'running',
      controlVersionId,
      testVersionId,
      stats: {
        controlExecutions: 0,
        testExecutions: 0,
        controlSuccesses: 0,
        testSuccesses: 0,
      },
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    return session;
  }

  recordExecution(
    sessionId: string,
    isTest: boolean,
    success: boolean
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (isTest) {
      session.stats.testExecutions++;
      if (success) session.stats.testSuccesses++;
    } else {
      session.stats.controlExecutions++;
      if (success) session.stats.controlSuccesses++;
    }
  }

  analyzeSession(sessionId: string): FishersExactTestResult {
    const session = this.sessions.get(sessionId);
    if (!session || session.stats.controlExecutions === 0 || session.stats.testExecutions === 0) {
      return {
        pValue: 1,
        significant: false,
        confidenceThreshold: 0.15,
      };
    }

    // Fisher's exact test approximation
    const n1 = session.stats.testExecutions;
    const n2 = session.stats.controlExecutions;
    const x1 = session.stats.testSuccesses;
    const x2 = session.stats.controlSuccesses;

    const p1 = x1 / n1;
    const p2 = x2 / n2;

    // Simplified Fisher's exact test using hypergeometric approximation
    const pEst = (x1 + x2) / (n1 + n2);
    const seEst = Math.sqrt(pEst * (1 - pEst) * (1 / n1 + 1 / n2));
    const zStat = Math.abs((p1 - p2) / (seEst + 0.0001));

    // Two-tailed p-value
    const pValue = 2 * (1 - this.normalCDF(zStat));

    // Significant if p-value < 0.15 (85% confidence)
    return {
      pValue,
      significant: pValue < 0.15,
      confidenceThreshold: 0.15,
    };
  }

  private normalCDF(z: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const absZ = Math.abs(z);
    const t = 1.0 / (1.0 + p * absZ);
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
        t *
        Math.exp(-absZ * absZ);

    return z >= 0 ? y : 1 - y;
  }

  completeSession(sessionId: string, winner: 'control' | 'test'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    session.decision = winner === 'test' ? 'promote' : 'control';
  }

  getSession(sessionId: string): ABTestSession | undefined {
    return this.sessions.get(sessionId);
  }
}
