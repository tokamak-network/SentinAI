import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybookEvolver } from '@/lib/playbook-evolution/playbook-evolver';
import type { IncidentPattern } from '@/lib/types/playbook-evolution';

// Mock the ai-client module
const mockChatCompletion = vi.fn();
vi.mock('@/lib/ai-client', () => ({
  chatCompletion: (...args: any[]) => mockChatCompletion(...args),
}));

describe('PlaybookEvolver', () => {
  let evolver: PlaybookEvolver;

  beforeEach(() => {
    evolver = new PlaybookEvolver();
    vi.clearAllMocks();
  });

  it('should generate EvolvedPlaybook from patterns via chatCompletion', async () => {
    const patterns: IncidentPattern[] = [
      {
        anomalyType: 'high_cpu',
        effectiveAction: 'scale_up',
        successRate: 92,
        executionCount: 50,
        avgDuration: 8200,
        correlationStrength: 0.95,
      },
    ];

    mockChatCompletion.mockResolvedValue({
      content: JSON.stringify({
        id: 'pb-gen-1',
        name: 'Optimized High CPU Response v1',
        description: 'Generated from pattern analysis',
        actions: [
          { type: 'scale', target: 'op-geth', params: { vCPU: 4 }, timeout: 30000 },
        ],
        fallbacks: [
          { type: 'drain', target: 'op-geth', params: {}, timeout: 15000 },
        ],
        timeout: 60000,
      }),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage: { promptTokens: 4200, completionTokens: 1850 },
    });

    const result = await evolver.generate(patterns, 'v-0', 'thanos-sepolia');
    expect(result.isOk()).toBe(true);
    const playbook = result.unwrap();
    expect(playbook.versionId).toBe('v-1');
    expect(playbook.generatedBy).toBe('anthropic/claude-sonnet-4-5-20250929');
    expect(playbook.confidenceSource).toBe('llm_generation');
    expect(playbook.actions).toHaveLength(1);
    expect(playbook.fallbacks).toHaveLength(1);
    expect(playbook.generationPromptUsage.inputTokens).toBe(4200);
    expect(playbook.patternContext.patterns).toHaveLength(1);
  });

  it('should return error on invalid generated JSON', async () => {
    mockChatCompletion.mockResolvedValue({
      content: 'not valid json at all',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage: { promptTokens: 100, completionTokens: 100 },
    });

    const result = await evolver.generate([], 'v-0', 'thanos-sepolia');
    expect(result.isErr()).toBe(true);
  });

  it('should handle chatCompletion errors gracefully', async () => {
    mockChatCompletion.mockRejectedValue(new Error('All providers failed'));

    const result = await evolver.generate([], 'v-0', 'thanos-sepolia');
    expect(result.isErr()).toBe(true);
    expect(result.getError()?.message).toBe('All providers failed');
  });

  it('should validate playbook structure via Zod', async () => {
    mockChatCompletion.mockResolvedValue({
      content: JSON.stringify({ id: 'incomplete' }),
      provider: 'openai',
      model: 'gpt-4o',
      usage: { promptTokens: 100, completionTokens: 100 },
    });

    const result = await evolver.generate([], 'v-0', 'thanos-sepolia');
    expect(result.isErr()).toBe(true);
    expect(result.getError()?.message).toContain('validation failed');
  });

  it('should increment version correctly', async () => {
    mockChatCompletion.mockResolvedValue({
      content: JSON.stringify({
        id: 'pb-v5',
        name: 'V5 playbook',
        description: 'Test',
        actions: [{ type: 'scale', target: 'op-geth', params: {}, timeout: 10000 }],
        fallbacks: [],
        timeout: 30000,
      }),
      provider: 'qwen',
      model: 'qwen-plus',
      usage: { promptTokens: 500, completionTokens: 200 },
    });

    const result = await evolver.generate([], 'v-4', 'thanos-sepolia');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().versionId).toBe('v-5');
  });

  it('should extract JSON from code blocks', async () => {
    const playbookJson = {
      id: 'pb-cb',
      name: 'Code block playbook',
      description: 'Extracted from markdown',
      actions: [{ type: 'restart', target: 'op-node', params: {}, timeout: 15000 }],
      fallbacks: [],
      timeout: 30000,
    };

    mockChatCompletion.mockResolvedValue({
      content: '```json\n' + JSON.stringify(playbookJson) + '\n```',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      usage: { promptTokens: 300, completionTokens: 150 },
    });

    const result = await evolver.generate([], 'v-0', 'thanos-sepolia');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().name).toBe('Code block playbook');
  });
});
