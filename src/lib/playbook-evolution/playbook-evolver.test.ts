import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybookEvolver, type Result } from '@/lib/playbook-evolution/playbook-evolver';
import { EvolvedPlaybookSchema } from '@/lib/types/playbook-evolution';
import type { IncidentPattern } from '@/lib/types/playbook-evolution';

const mockAIClient = {
  messages: {
    create: vi.fn(),
  },
};

describe('PlaybookEvolver', () => {
  let evolver: PlaybookEvolver;

  beforeEach(() => {
    evolver = new PlaybookEvolver(mockAIClient as any);
    vi.clearAllMocks();
  });

  it('should generate EvolvedPlaybook from patterns via Claude API', async () => {
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

    mockAIClient.messages.create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: 'pb-gen-1',
            name: 'Optimized High CPU Response v1',
            description: 'Generated from pattern analysis',
            actions: [
              {
                type: 'scale',
                target: 'sequencer',
                params: { replicas: 5 },
                timeout: 30000,
              },
            ],
            fallbacks: [
              {
                type: 'drain',
                target: 'sequencer',
                timeout: 15000,
              },
            ],
            timeout: 60000,
          }),
        },
      ],
      usage: {
        input_tokens: 4200,
        output_tokens: 1850,
      },
    });

    const result = await evolver.generate(patterns, 'v-0', 'optimism');
    expect(result.isOk()).toBe(true);
    const playbook = result.unwrap();
    expect(playbook.versionId).toBe('v-1');
    expect(playbook.generatedBy).toBe('claude-sonnet-4-5-20250929');
  });

  it('should return error on invalid generated JSON', async () => {
    mockAIClient.messages.create.mockResolvedValue({
      content: [{ type: 'text', text: 'invalid json' }],
      usage: { input_tokens: 100, output_tokens: 100 },
    });

    const result = await evolver.generate([], 'v-0', 'optimism');
    expect(result.isErr()).toBe(true);
  });

  it('should fallback on API timeout', async () => {
    mockAIClient.messages.create.mockRejectedValue(new Error('API timeout'));

    const result = await evolver.generate([], 'v-0', 'optimism');
    expect(result.isErr()).toBe(true);
  });

  it('should validate playbook structure via Zod', async () => {
    mockAIClient.messages.create.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ id: 'incomplete' }) }],
      usage: { input_tokens: 100, output_tokens: 100 },
    });

    const result = await evolver.generate([], 'v-0', 'optimism');
    expect(result.isErr()).toBe(true);
  });
});
