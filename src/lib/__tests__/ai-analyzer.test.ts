/**
 * Unit tests for ai-analyzer module
 * Tests log chunk analysis with AI
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analyzeLogChunk } from '@/lib/ai-analyzer';

// Mock ai-client
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: vi.fn(),
}));

const { chatCompletion } = await import('@/lib/ai-client');

describe('ai-analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeLogChunk', () => {
    it('should analyze string log chunk', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'normal',
          summary: 'System running normally',
          action_item: 'Monitor performance',
        }),
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('INFO log line');

      expect(result.severity).toBe('normal');
      expect(result.summary).toBe('System running normally');
      expect(result.timestamp).toBeTruthy();
    });

    it('should analyze record of logs', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'warning',
          summary: 'High memory usage detected',
          action_item: 'Check memory limits',
        }),
        stopReason: 'end_turn',
      });

      const logs = {
        'op-geth': 'WARN memory usage high',
        'op-node': 'INFO status normal',
      };

      const result = await analyzeLogChunk(logs);

      expect(result.severity).toBe('warning');
      expect(result.action_item).toBe('Check memory limits');
    });

    it('should detect critical severity', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'critical',
          summary: 'Node is down',
          action_item: 'Restart immediately',
        }),
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('ERROR node down');

      expect(result.severity).toBe('critical');
    });

    it('should handle markdown-wrapped JSON', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '```json\n{"severity": "warning", "summary": "Test", "action_item": "Check"}\n```',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('Log data');

      expect(result.severity).toBe('warning');
    });

    it('should fallback to normal on non-JSON response', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: 'This is plain text response',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('Log data');

      expect(result.severity).toBe('normal');
      expect(result.summary).toContain('This is plain text');
    });

    it('should handle AI provider error', async () => {
      vi.mocked(chatCompletion).mockRejectedValue(new Error('API error'));

      const result = await analyzeLogChunk('Log data');

      expect(result.severity).toBe('critical');
      expect(result.summary).toContain('Analysis Failed');
    });

    it('should set timestamp in result', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '{"severity": "normal", "summary": "OK", "action_item": "None"}',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('Log');

      expect(result.timestamp).toBeTruthy();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should handle multi-component logs', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'warning',
          summary: 'Sync lag detected',
          action_item: 'Check L1 connection',
        }),
        stopReason: 'end_turn',
      });

      const logs = {
        'op-geth': 'ERROR: sync lag',
        'op-node': 'WARN: derivation stalled',
        'op-batcher': 'INFO: normal',
        'op-proposer': 'INFO: normal',
      };

      const result = await analyzeLogChunk(logs);

      expect(result.severity).toContain('warning');
    });
  });

  describe('Integration', () => {
    it('should handle complete analysis flow', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: JSON.stringify({
          severity: 'warning',
          summary: 'CPU high, network stable',
          action_item: 'Monitor and scale if needed',
        }),
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk({
        'op-geth': 'WARN high CPU',
        'op-node': 'INFO network ok',
      });

      expect(result.severity).toBe('warning');
      expect(result.summary).toContain('CPU');
      expect(result.action_item).toBeTruthy();
      expect(result.timestamp).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty log string', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '{"severity": "normal", "summary": "Empty", "action_item": "None"}',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk('');

      expect(result.severity).toBe('normal');
    });

    it('should handle empty log record', async () => {
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '{"severity": "normal", "summary": "Empty", "action_item": "None"}',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk({});

      expect(result.severity).toBe('normal');
    });

    it('should handle very long logs', async () => {
      const longLog = 'x'.repeat(10000);
      vi.mocked(chatCompletion).mockResolvedValue({
        content: '{"severity": "normal", "summary": "Long", "action_item": "OK"}',
        stopReason: 'end_turn',
      });

      const result = await analyzeLogChunk(longLog);

      expect(result).toBeDefined();
    });
  });
});
