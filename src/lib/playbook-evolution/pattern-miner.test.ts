import { describe, it, expect } from 'vitest';
import {
  IncidentPatternSchema,
  EvolvedPlaybookSchema,
} from '../types/playbook-evolution';

describe('Playbook Evolution Types', () => {
  it('should validate IncidentPattern with required fields', () => {
    const pattern = {
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 85,
      executionCount: 42,
      avgDuration: 8500,
      correlationStrength: 0.92,
    };

    const result = IncidentPatternSchema.safeParse(pattern);
    expect(result.success).toBe(true);
  });

  it('should reject pattern with invalid successRate', () => {
    const pattern = {
      anomalyType: 'high_cpu',
      effectiveAction: 'scale_up',
      successRate: 105, // Invalid: > 100
      executionCount: 42,
      avgDuration: 8500,
      correlationStrength: 0.92,
    };

    const result = IncidentPatternSchema.safeParse(pattern);
    expect(result.success).toBe(false);
  });

  it('should validate EvolvedPlaybook with all Phase 6 fields', () => {
    const playbook = {
      id: 'pb-001',
      name: 'Optimized High CPU Response',
      description: 'Auto-generated v1',
      actions: [
        { type: 'scale', target: 'sequencer', params: { replicas: 5 }, timeout: 30000 },
      ],
      fallbacks: [
        { type: 'drain', target: 'sequencer', timeout: 15000 },
      ],
      timeout: 60000,
      versionId: 'v-1',
      parentVersionId: 'v-0',
      generatedAt: new Date(),
      generatedBy: 'claude-sonnet-4-5-20250929',
      confidenceSource: 'llm_generation',
      generationPromptUsage: {
        inputTokens: 4200,
        outputTokens: 1850,
        totalCost: 0.042,
      },
      patternContext: {
        patterns: [],
        successRateBaseline: 78,
      },
    };

    const result = EvolvedPlaybookSchema.safeParse(playbook);
    expect(result.success).toBe(true);
  });
});
