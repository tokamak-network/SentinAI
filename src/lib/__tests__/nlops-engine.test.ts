import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ai-client
vi.mock('../ai-client', () => ({
  chatCompletion: vi.fn(),
}));

// Mock ai-analyzer
vi.mock('../ai-analyzer', () => ({
  analyzeLogChunk: vi.fn().mockResolvedValue({
    severity: 'low',
    summary: 'All components healthy',
    action_item: 'No action needed',
    timestamp: new Date().toISOString(),
  }),
}));

// Mock log-ingester
vi.mock('../log-ingester', () => ({
  getAllLiveLogs: vi.fn().mockRejectedValue(new Error('No K8s')),
  generateMockLogs: vi.fn().mockReturnValue({
    'op-geth': 'INFO block synced',
    'op-node': 'INFO sequencing',
  }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { chatCompletion } from '../ai-client';
import { processCommand, classifyIntent, executeAction, isNLOpsEnabled } from '../nlops-engine';
import { generateResponse, getSuggestedFollowUps } from '../nlops-responder';
import type { NLOpsIntent } from '@/types/nlops';

const mockChatCompletion = vi.mocked(chatCompletion);

const BASE_URL = 'http://localhost:3002';

// Helper: mock the fetchCurrentState calls (metrics + scaler)
function mockFetchCurrentState() {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ metrics: { gethVcpu: 1, cpuUsage: 15.5, txPoolCount: 0, gethMemGiB: 2 } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        currentVcpu: 1,
        currentMemoryGiB: 2,
        autoScalingEnabled: true,
        simulationMode: true,
        cooldownRemaining: 0,
      }),
    });
}

// Helper: mock planToolCalls response
function mockPlanResponse(tools: Array<{ name: string; params: Record<string, unknown> }>, directResponse: string | null = null) {
  mockChatCompletion.mockResolvedValueOnce({
    content: JSON.stringify({ tools, directResponse }),
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
  });
}

// Helper: mock generateResponseWithData
function mockGenerateResponse(content: string) {
  mockChatCompletion.mockResolvedValueOnce({
    content,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
  });
}

describe('nlops-engine', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockChatCompletion.mockReset();
  });

  // ============================================================
  // isNLOpsEnabled
  // ============================================================

  describe('isNLOpsEnabled', () => {
    it('should return true by default', () => {
      expect(isNLOpsEnabled()).toBe(true);
    });
  });

  // ============================================================
  // Deprecated APIs
  // ============================================================

  describe('deprecated APIs', () => {
    it('should throw on classifyIntent (deprecated in v2)', async () => {
      await expect(classifyIntent()).rejects.toThrow('deprecated');
    });

    it('should throw on executeAction (deprecated in v2)', async () => {
      await expect(executeAction()).rejects.toThrow('deprecated');
    });
  });

  // ============================================================
  // processCommand - Casual Conversation
  // ============================================================

  describe('processCommand - casual conversation', () => {
    it('should handle casual greeting with direct response', async () => {
      mockFetchCurrentState();
      mockPlanResponse([], 'Hello! How can I help you today?');

      const result = await processCommand('안녕하세요', BASE_URL);

      expect(result.executed).toBe(false);
      expect(result.response).toBe('Hello! How can I help you today?');
      expect(result.intent.type).toBe('unknown');
    });

    it('should return follow-up suggestions for casual conversation', async () => {
      mockFetchCurrentState();
      mockPlanResponse([], 'Hi there!');

      const result = await processCommand('hi', BASE_URL);

      expect(result.suggestedFollowUp).toBeDefined();
      expect(result.suggestedFollowUp!.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // processCommand - Query Tools
  // ============================================================

  describe('processCommand - query tools', () => {
    it('should query system status', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_system_status', params: {} }]);
      // Tool: get_system_status fetches /api/metrics + /api/scaler
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ metrics: { cpuUsage: 15 } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ currentVcpu: 1 }) });
      mockGenerateResponse('System is running normally at 1 vCPU with 15% CPU usage.');

      const result = await processCommand('현재 상태 알려줘', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent).toEqual({ type: 'query', target: 'status' });
      expect(result.response).toContain('1 vCPU');
    });

    it('should query cost report', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_cost_report', params: {} }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ currentMonthly: 41.45, recommendations: [] }),
      });
      mockGenerateResponse('Current monthly cost is $41.45.');

      const result = await processCommand('비용 확인', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent).toEqual({ type: 'query', target: 'cost' });
    });

    it('should query anomalies', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_anomalies', params: {} }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [], total: 0 }),
      });
      mockGenerateResponse('No anomalies detected.');

      const result = await processCommand('이상 탐지 결과', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent).toEqual({ type: 'query', target: 'anomalies' });
    });

    it('should query metrics', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_metrics', params: {} }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ metrics: { cpuUsage: 25.3, txPoolCount: 5 } }),
      });
      mockGenerateResponse('CPU at 25.3%, TxPool has 5 pending transactions.');

      const result = await processCommand('메트릭 조회', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent).toEqual({ type: 'query', target: 'metrics' });
    });
  });

  // ============================================================
  // processCommand - Analysis Tools
  // ============================================================

  describe('processCommand - analysis tools', () => {
    it('should analyze logs (falls back to mock logs on K8s failure)', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'analyze_logs', params: { mode: 'live' } }]);
      // analyze_logs uses mocked getAllLiveLogs (rejects) -> generateMockLogs -> analyzeLogChunk
      mockGenerateResponse('Logs look healthy. All components operating normally.');

      const result = await processCommand('로그 분석 해줘', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent.type).toBe('analyze');
    });

    it('should run root cause analysis', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'run_rca', params: {} }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rootCause: { component: 'op-geth', confidence: 0.85 } }),
      });
      mockGenerateResponse('Root cause identified: op-geth component issue.');

      const result = await processCommand('근본 원인 분석해줘', BASE_URL);

      expect(result.executed).toBe(true);
      expect(result.intent.type).toBe('rca');
    });

    it('should get prediction', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_prediction', params: {} }]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ prediction: { targetVcpu: 2 }, predictionMeta: {} }),
      });
      mockGenerateResponse('Prediction: scaling to 2 vCPU likely needed soon.');

      const result = await processCommand('예측 확인', BASE_URL);

      expect(result.executed).toBe(true);
    });
  });

  // ============================================================
  // processCommand - Dangerous Actions
  // ============================================================

  describe('processCommand - dangerous actions', () => {
    it('should require confirmation for scale actions', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'scale_node', params: { targetVcpu: 4 } }]);

      const result = await processCommand('4 vCPU로 스케일해줘', BASE_URL);

      expect(result.executed).toBe(false);
      expect(result.needsConfirmation).toBe(true);
      expect(result.intent.type).toBe('scale');
    });

    it('should require confirmation for config changes', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'update_config', params: { setting: 'autoScaling', value: false } }]);

      const result = await processCommand('자동 스케일링 꺼줘', BASE_URL);

      expect(result.executed).toBe(false);
      expect(result.needsConfirmation).toBe(true);
      expect(result.intent.type).toBe('config');
    });

    it('should execute scale when confirmed', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'scale_node', params: { targetVcpu: 2 } }]);
      // Tool: scale_node POST /api/scaler
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ currentVcpu: 2, previousVcpu: 1 }),
      });
      mockGenerateResponse('Scaled to 2 vCPU successfully.');

      const result = await processCommand('2 vCPU로 스케일해줘', BASE_URL, true);

      expect(result.executed).toBe(true);
      expect(result.intent.type).toBe('scale');
    });

    it('should execute config change when confirmed', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'update_config', params: { setting: 'autoScaling', value: false } }]);
      // Tool: update_config PATCH /api/scaler
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ autoScalingEnabled: false }),
      });
      mockGenerateResponse('Auto-scaling has been disabled.');

      const result = await processCommand('자동 스케일링 꺼줘', BASE_URL, true);

      expect(result.executed).toBe(true);
      expect(result.intent.type).toBe('config');
    });

    it('should include confirmation message for scale', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'scale_node', params: { targetVcpu: 4 } }]);

      const result = await processCommand('4 vCPU', BASE_URL);

      expect(result.confirmationMessage).toContain('4 vCPU');
    });

    it('should include confirmation message for config', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'update_config', params: { setting: 'autoScaling', value: true } }]);

      const result = await processCommand('자동 스케일링 켜줘', BASE_URL);

      expect(result.confirmationMessage).toContain('Auto-scaling');
    });
  });

  // ============================================================
  // processCommand - Error Handling
  // ============================================================

  describe('processCommand - error handling', () => {
    it('should handle AI planning failure gracefully', async () => {
      mockFetchCurrentState();
      mockChatCompletion.mockRejectedValueOnce(new Error('AI unavailable'));

      const result = await processCommand('상태 알려줘', BASE_URL);

      // planToolCalls returns empty on failure → treated as no response
      expect(result.intent.type).toBe('unknown');
    });

    it('should handle tool execution error gracefully', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_system_status', params: {} }]);
      // Tool fetch fails
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'));
      mockGenerateResponse('Unable to fetch system data. Please try again.');

      const result = await processCommand('상태', BASE_URL);

      expect(result.executed).toBe(true);
      // Tool returned error object but execution completed
    });

    it('should handle fetchCurrentState failure gracefully', async () => {
      // Both metrics and scaler fetch fail
      mockFetch
        .mockRejectedValueOnce(new Error('Server down'))
        .mockRejectedValueOnce(new Error('Server down'));
      mockPlanResponse([], 'System appears to be unavailable.');

      const result = await processCommand('안녕', BASE_URL);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  // ============================================================
  // processCommand - Follow-up Suggestions
  // ============================================================

  describe('processCommand - follow-up suggestions', () => {
    it('should suggest relevant follow-ups after status query', async () => {
      mockFetchCurrentState();
      mockPlanResponse([{ name: 'get_system_status', params: {} }]);
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ metrics: {} }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      mockGenerateResponse('Status OK.');

      const result = await processCommand('상태', BASE_URL);

      expect(result.suggestedFollowUp).toBeDefined();
      expect(result.suggestedFollowUp!.length).toBeGreaterThan(0);
      expect(result.suggestedFollowUp!.length).toBeLessThanOrEqual(3);
    });
  });

  // ============================================================
  // Responder
  // ============================================================

  describe('nlops-responder', () => {
    it('should return static confirmation for scale', async () => {
      const intent: NLOpsIntent = { type: 'scale', targetVcpu: 4, force: false };
      const response = await generateResponse(intent, null, false);
      expect(response).toContain('4 vCPU');
      expect(response).toContain('confirm');
    });

    it('should return static confirmation for config', async () => {
      const intent: NLOpsIntent = { type: 'config', setting: 'autoScaling', value: true };
      const response = await generateResponse(intent, null, false);
      expect(response).toContain('Auto-scaling');
      expect(response).toContain('enable');
    });

    it('should return help text for unknown', async () => {
      const intent: NLOpsIntent = { type: 'unknown', originalInput: 'asdf' };
      const response = await generateResponse(intent, null, false);
      expect(response).toContain('didn\'t understand');
    });

    it('should return explain result directly', async () => {
      const intent: NLOpsIntent = { type: 'explain', topic: 'test' };
      const result = { explanation: '테스트 설명입니다' };
      const response = await generateResponse(intent, result, true);
      expect(response).toBe('테스트 설명입니다');
    });

    it('should return fallback on AI failure', async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error('AI down'));

      const intent: NLOpsIntent = { type: 'query', target: 'status' };
      const response = await generateResponse(intent, { metrics: { metrics: { gethVcpu: 2, cpuUsage: 30.5, txPoolCount: 5 } } }, true);
      expect(response).toContain('Current status');
    });

    it('should generate follow-up suggestions', () => {
      expect(getSuggestedFollowUps({ type: 'query', target: 'status' })).toContain('Analyze logs');
      expect(getSuggestedFollowUps({ type: 'scale', targetVcpu: 2, force: false })).toContain('Check current status');
      expect(getSuggestedFollowUps({ type: 'rca' })).toContain('Analyze logs');
      expect(getSuggestedFollowUps({ type: 'unknown', originalInput: '' })).toContain('Show current status');
    });
  });
});
