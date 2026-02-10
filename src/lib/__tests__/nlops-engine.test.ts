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
import { classifyIntent, executeAction, isNLOpsEnabled } from '../nlops-engine';
import { generateResponse, getSuggestedFollowUps } from '../nlops-responder';
import type { CurrentSystemState, NLOpsIntent } from '@/types/nlops';

const mockChatCompletion = vi.mocked(chatCompletion);

const DEFAULT_STATE: CurrentSystemState = {
  vcpu: 1,
  memoryGiB: 2,
  autoScalingEnabled: true,
  simulationMode: true,
  cpuUsage: 15.5,
  txPoolCount: 0,
  cooldownRemaining: 0,
};

const BASE_URL = 'http://localhost:3002';

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
  // Intent Classification
  // ============================================================

  describe('classifyIntent', () => {
    it('should return unknown for empty input', async () => {
      const result = await classifyIntent('', DEFAULT_STATE);
      expect(result.intent.type).toBe('unknown');
      expect(result.requireConfirmation).toBe(false);
    });

    it('should classify query/status intent', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'query', target: 'status' },
          requireConfirmation: false,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('현재 상태 알려줘', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'query', target: 'status' });
      expect(result.requireConfirmation).toBe(false);
    });

    it('should classify scale intent with confirmation', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'scale', targetVcpu: 2, force: false },
          requireConfirmation: true,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('2 vCPU로 스케일해줘', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'scale', targetVcpu: 2, force: false });
      expect(result.requireConfirmation).toBe(true);
    });

    it('should classify config intent', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'config', setting: 'autoScaling', value: false },
          requireConfirmation: true,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('자동 스케일링 꺼줘', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'config', setting: 'autoScaling', value: false });
      expect(result.requireConfirmation).toBe(true);
    });

    it('should classify analyze intent', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'analyze', mode: 'live' },
          requireConfirmation: false,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('로그 분석 해줘', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'analyze', mode: 'live' });
    });

    it('should classify explain intent', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'explain', topic: 'CPU 사용률' },
          requireConfirmation: false,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('CPU가 뭐야?', DEFAULT_STATE);
      expect(result.intent.type).toBe('explain');
    });

    it('should classify rca intent', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'rca' },
          requireConfirmation: false,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('근본 원인 분석해줘', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'rca' });
    });

    it('should fallback to unknown on AI failure', async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error('AI unavailable'));

      const result = await classifyIntent('테스트 입력', DEFAULT_STATE);
      expect(result.intent.type).toBe('unknown');
    });

    it('should reject invalid scale vCPU values', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'scale', targetVcpu: 3, force: false },
          requireConfirmation: true,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('3 vCPU로 해줘', DEFAULT_STATE);
      expect(result.intent.type).toBe('unknown');
    });

    it('should reject invalid config settings', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: JSON.stringify({
          intent: { type: 'config', setting: 'invalidSetting', value: true },
          requireConfirmation: true,
        }),
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('잘못된 설정', DEFAULT_STATE);
      expect(result.intent.type).toBe('unknown');
    });

    it('should handle markdown-wrapped JSON from AI', async () => {
      mockChatCompletion.mockResolvedValueOnce({
        content: '```json\n{"intent": {"type": "query", "target": "cost"}, "requireConfirmation": false}\n```',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      });

      const result = await classifyIntent('비용 확인', DEFAULT_STATE);
      expect(result.intent).toEqual({ type: 'query', target: 'cost' });
    });
  });

  // ============================================================
  // Action Execution
  // ============================================================

  describe('executeAction', () => {
    it('should block dangerous actions without confirmation', async () => {
      const scaleIntent: NLOpsIntent = { type: 'scale', targetVcpu: 2, force: false };
      const result = await executeAction(scaleIntent, BASE_URL);
      expect(result.executed).toBe(false);
      expect(result.result).toBeNull();
    });

    it('should block config actions without confirmation', async () => {
      const configIntent: NLOpsIntent = { type: 'config', setting: 'autoScaling', value: false };
      const result = await executeAction(configIntent, BASE_URL);
      expect(result.executed).toBe(false);
    });

    it('should execute scale with confirmation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ currentVcpu: 2, previousVcpu: 1 }),
      });

      const intent: NLOpsIntent = { type: 'scale', targetVcpu: 2, force: false };
      const result = await executeAction(intent, BASE_URL, true);
      expect(result.executed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/scaler`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should execute config with confirmation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ autoScalingEnabled: false }),
      });

      const intent: NLOpsIntent = { type: 'config', setting: 'autoScaling', value: false };
      const result = await executeAction(intent, BASE_URL, true);
      expect(result.executed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/scaler`,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('should execute query/status (parallel fetch)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ metrics: { cpuUsage: 10 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ currentVcpu: 1 }),
        });

      const intent: NLOpsIntent = { type: 'query', target: 'status' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      expect(result.result).toHaveProperty('metrics');
      expect(result.result).toHaveProperty('scaler');
    });

    it('should execute query/cost', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ currentMonthly: 41.45, recommendations: [] }),
      });

      const intent: NLOpsIntent = { type: 'query', target: 'cost' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/cost-report'),
        expect.any(Object),
      );
    });

    it('should execute query/anomalies', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ events: [], total: 0 }),
      });

      const intent: NLOpsIntent = { type: 'query', target: 'anomalies' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
    });

    it('should execute analyze (uses mock logs on K8s failure)', async () => {
      const intent: NLOpsIntent = { type: 'analyze', mode: 'live' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      expect(result.result).toHaveProperty('analysis');
    });

    it('should execute explain with known topic', async () => {
      const intent: NLOpsIntent = { type: 'explain', topic: 'CPU 사용률' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      const explanation = (result.result as Record<string, string>)?.explanation;
      expect(explanation).toContain('CPU');
    });

    it('should execute explain with unknown topic', async () => {
      const intent: NLOpsIntent = { type: 'explain', topic: '블록 타임' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      const explanation = (result.result as Record<string, string>)?.explanation;
      expect(explanation).toContain('Try keywords like');
    });

    it('should execute rca', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ rootCause: { component: 'op-geth' } }),
      });

      const intent: NLOpsIntent = { type: 'rca' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/rca`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should return error for unknown intent', async () => {
      const intent: NLOpsIntent = { type: 'unknown', originalInput: 'gibberish' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle fetch failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const intent: NLOpsIntent = { type: 'query', target: 'metrics' };
      const result = await executeAction(intent, BASE_URL);
      expect(result.executed).toBe(false);
      expect(result.error).toContain('Network error');
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
