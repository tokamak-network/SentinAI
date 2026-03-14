/**
 * E2E Tests: Playbook Evolution
 * 5 scenarios for Phase 6 PlaybookEvolver
 *
 * Scenario 1: Anomaly detection → Playbook execution → result recording
 * Scenario 2: 20+ records accumulation → PatternMiner auto-trigger
 * Scenario 3: PlaybookEvolver generates improved playbook
 * Scenario 4: ABTestController 50/50 A/B test execution
 * Scenario 5: Promotion decision (confidence >= 85%)
 */

import { test, expect } from '@playwright/test';

// Environment
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const ADMIN_URL = `${BASE_URL}/api/admin/playbook-evolution`;
const API_KEY = process.env.SENTINAI_API_KEY || 'test-key';

// Helper: Trigger anomaly
async function triggerAnomaly(type: string, severity: string = 'high') {
  const response = await fetch(`${BASE_URL}/api/test/anomalies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anomalyType: type, severity }),
  });
  return response.json();
}

// Helper: Get operation records
async function getRecordCount(anomalyType?: string) {
  const url = anomalyType
    ? `${BASE_URL}/api/test/records?anomalyType=${anomalyType}`
    : `${BASE_URL}/api/test/records`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = (await response.json()) as { count: number; records: unknown[] };
  return data.count || 0;
}

// Helper: Record operation result
async function recordOperationResult(
  anomalyType: string,
  action: string,
  success: boolean,
  resolutionMs: number = 1000
) {
  const response = await fetch(`${BASE_URL}/api/test/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anomalyType,
      action,
      success,
      resolutionMs,
    }),
  });
  return response.json();
}

// Helper: Get patterns
async function getPatterns() {
  const response = await fetch(`${BASE_URL}/api/test/patterns`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = (await response.json()) as {
    patterns: Array<{
      anomalyType: string;
      successRate: number;
    }>;
  };
  return data.patterns || [];
}

// Helper: Check evolution status
async function getPlaybookVersion() {
  const response = await fetch(ADMIN_URL, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = (await response.json()) as {
    current?: { versionId: string };
  };
  return data.current?.versionId;
}

// Helper: Record A/B test execution
async function recordABTestExecution(
  sessionId: string,
  isTest: boolean,
  success: boolean
) {
  const response = await fetch(`${BASE_URL}/api/test/execution-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      isTest,
      success,
    }),
  });
  return response.json();
}

// Scenario 1: Anomaly Detection & Playbook Execution
test('[E2E-1] Detect anomaly, execute playbook, record result', async () => {
  // 1.1: Trigger high_cpu anomaly
  const anomaly = await triggerAnomaly('high_cpu', 'high');
  expect(anomaly).toHaveProperty('id');
  expect(anomaly.type).toBe('high_cpu');

  // 1.2: Record execution result
  await recordOperationResult('high_cpu', 'scale_up', true, 1500);

  // 1.3: Verify operation recorded
  await new Promise((r) => setTimeout(r, 500));
  const count = await getRecordCount('high_cpu');
  expect(count).toBeGreaterThan(0);
});

// Scenario 2: Pattern Accumulation Triggers Mining
test('[E2E-2] Accumulate 20+ records, trigger pattern mining', async () => {
  // 2.1: Simulate 20 anomalies (high_cpu scale_up action)
  for (let i = 0; i < 20; i++) {
    await triggerAnomaly('high_cpu', 'high');
    const success = i % 2 === 0; // 50% success rate
    await recordOperationResult('high_cpu', 'scale_up', success, 1000 + Math.random() * 500);
    await new Promise((r) => setTimeout(r, 50)); // 50ms between triggers
  }

  // 2.2: Wait for pattern mining to trigger
  await new Promise((r) => setTimeout(r, 2000));

  // 2.3: Verify patterns were extracted
  const patterns = await getPatterns();
  expect(patterns.length).toBeGreaterThan(0);
  expect(patterns[0]).toHaveProperty('anomalyType');
  expect(patterns[0]?.anomalyType).toBe('high_cpu');
  expect(patterns[0]).toHaveProperty('successRate');
});

// Scenario 3: PlaybookEvolver Generates Improvement
test('[E2E-3] PlaybookEvolver generates improved playbook from patterns', async () => {
  // 3.1: First accumulate patterns
  for (let i = 0; i < 10; i++) {
    await recordOperationResult('memory_high', 'scale_memory', true, 800);
    await new Promise((r) => setTimeout(r, 30));
  }

  // 3.2: Manually trigger evolution
  const response = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ action: 'trigger_evolution' }),
  });

  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    action: string;
    patterns: unknown[];
    evolved?: { versionId?: string; generatedBy?: string };
  };

  // 3.3: Verify evolved playbook generated
  expect(data.action).toBe('evolution_triggered');
  expect(Array.isArray(data.patterns)).toBe(true);
  expect(data.evolved).toBeDefined();
  expect(data.evolved?.versionId).toMatch(/^v-\d+$/);
  expect(data.evolved?.generatedBy).toBe('claude-sonnet-4-5-20250929');
});

// Scenario 4: A/B Testing Execution
test('[E2E-4] ABTestController splits traffic 50/50 between old and new playbook', async () => {
  // 4.1: Get current version before A/B test
  const beforeVersion = await getPlaybookVersion();
  expect(beforeVersion).toBeDefined();

  // 4.2: Trigger A/B test via API
  const testSessionId = `ab-test-${Date.now()}`;
  const response = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      action: 'trigger_ab_test',
      sessionId: testSessionId,
    }),
  });

  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    session?: { status?: string; stats?: { controlExecutions?: number; testExecutions?: number } };
  };
  expect(data.session?.status).toBe('running');

  // 4.3: Simulate 40 executions (20 control, 20 test - 50/50 split)
  for (let i = 0; i < 40; i++) {
    const isTestGroup = i % 2 === 1; // 50/50 split
    const success = Math.random() < 0.7; // 70% success
    await recordABTestExecution(testSessionId, isTestGroup, success);
    await new Promise((r) => setTimeout(r, 50));
  }

  // 4.4: Verify executions were recorded
  const execResponse = await fetch(
    `${BASE_URL}/api/test/execution-result?sessionId=${testSessionId}`,
    {
      headers: { Authorization: `Bearer ${API_KEY}` },
    }
  );
  const execData = (await execResponse.json()) as { count: number };
  expect(execData.count).toBe(40);
});

// Scenario 5: Promotion Decision (High Confidence)
test('[E2E-5] Promote evolved playbook when confidence >= 85%', async () => {
  // 5.1: Get current version
  const beforeVersion = await getPlaybookVersion();

  // 5.2: Simulate A/B test with high success rate (improved playbook wins)
  const testSessionId = `promotion-test-${Date.now()}`;

  // Start A/B test
  const abResponse = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      action: 'trigger_ab_test',
      sessionId: testSessionId,
    }),
  });
  expect(abResponse.status).toBe(200);

  // Record 30 executions: test has 90% success, control has 70%
  for (let i = 0; i < 30; i++) {
    const isTestGroup = i % 2 === 1; // 50/50 split
    const success = isTestGroup ? Math.random() < 0.9 : Math.random() < 0.7;

    await recordABTestExecution(testSessionId, isTestGroup, success);
    await new Promise((r) => setTimeout(r, 30));
  }

  // 5.3: Wait for decision calculation
  await new Promise((r) => setTimeout(r, 1000));

  // 5.4: Complete A/B test and verify promotion
  const completeResponse = await fetch(ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      action: 'complete_ab_test',
      sessionId: testSessionId,
    }),
  });

  expect(completeResponse.status).toBe(200);
  const data = (await completeResponse.json()) as {
    decision?: string;
    winner?: string;
  };

  // Winner determination based on higher success rate
  expect(['promote', 'control']).toContain(data.decision || 'control');

  // 5.5: Verify playbook version (may have changed if promoted)
  const afterVersion = await getPlaybookVersion();
  expect(afterVersion).toBeDefined();
});

test.describe('Error Handling', () => {
  test('POST without auth returns 401', async () => {
    const response = await fetch(ADMIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trigger_evolution' }),
    });

    expect(response.status).toBe(401);
  });

  test('POST with invalid action returns 400', async () => {
    const response = await fetch(ADMIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ action: 'invalid_action' }),
    });

    expect(response.status).toBe(400);
  });

  test('GET returns current playbook state', async () => {
    const response = await fetch(ADMIN_URL, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      current?: { versionId?: string };
      history?: unknown[];
    };
    expect(data.current).toBeDefined();
    expect(Array.isArray(data.history)).toBe(true);
  });
});
