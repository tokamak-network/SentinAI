interface SessionStats {
  controlExecutions: number;
  controlSuccesses: number;
  testExecutions: number;
  testSuccesses: number;
}

interface ABTestSession {
  id: string;
  controlVersionId: string;
  testVersionId: string;
  status: 'running' | 'completed';
  stats: SessionStats;
  decision?: 'promote' | 'keep';
}

interface SessionAnalysis {
  pValue: number;
  isSignificant: boolean;
}

/**
 * In-memory A/B test controller for playbook version comparison.
 */
export class ABTestController {
  private sessions = new Map<string, ABTestSession>();

  createSession(id: string, controlVersionId: string, testVersionId: string): ABTestSession {
    const session: ABTestSession = {
      id,
      controlVersionId,
      testVersionId,
      status: 'running',
      stats: {
        controlExecutions: 0,
        controlSuccesses: 0,
        testExecutions: 0,
        testSuccesses: 0,
      },
    };
    this.sessions.set(id, session);
    return session;
  }

  recordExecution(sessionId: string, isTest: boolean, success: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (isTest) {
      session.stats.testExecutions += 1;
      if (success) session.stats.testSuccesses += 1;
    } else {
      session.stats.controlExecutions += 1;
      if (success) session.stats.controlSuccesses += 1;
    }
  }

  getSession(sessionId: string): ABTestSession | undefined {
    return this.sessions.get(sessionId);
  }

  analyzeSession(sessionId: string): SessionAnalysis {
    const session = this.sessions.get(sessionId);
    if (!session) return { pValue: 1, isSignificant: false };

    const { controlExecutions, controlSuccesses, testExecutions, testSuccesses } =
      session.stats;

    if (controlExecutions === 0 || testExecutions === 0) {
      return { pValue: 1, isSignificant: false };
    }

    const controlRate = controlSuccesses / controlExecutions;
    const testRate = testSuccesses / testExecutions;
    const diff = Math.abs(testRate - controlRate);
    const pValue = Math.max(0, 1 - diff * 2);

    return { pValue, isSignificant: pValue < 0.15 };
  }

  completeSession(sessionId: string, winner: 'control' | 'test'): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'completed';
    session.decision = winner === 'test' ? 'promote' : 'keep';
  }
}
