import { describe, it, expect } from 'vitest';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { ExperienceEntry } from '@/types/experience';

const makeEntry = (overrides: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
  id: `exp-${Math.random().toString(36).slice(2)}`,
  instanceId: 'inst-1',
  protocolId: 'opstack',
  timestamp: new Date().toISOString(),
  category: 'scaling-action',
  trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
  action: 'scale_up',
  outcome: 'success',
  resolutionMs: 45000,
  metricsSnapshot: { cpuUsage: 85 },
  ...overrides,
});

describe('pattern-extractor', () => {
  it('should extract pattern from 3+ similar experiences', () => {
    const entries = [
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.2 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.7 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].occurrences).toBe(3);
    expect(result.patterns[0].successRate).toBe(1.0);
    expect(result.patterns[0].trigger.metric).toBe('cpuUsage');
  });

  it('should require minimum 3 occurrences', () => {
    const entries = [makeEntry(), makeEntry()];
    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(0);
  });

  it('should calculate success rate correctly', () => {
    const entries = [
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'failure' }),
      makeEntry({ outcome: 'success' }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].successRate).toBe(0.75);
  });

  it('should track multiple protocols', () => {
    const entries = [
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'arbitrum' }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].protocols).toContain('opstack');
    expect(result.patterns[0].protocols).toContain('arbitrum');
  });

  it('should separate different trigger types into different patterns', () => {
    const entries = [
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
      makeEntry({ trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.9 }, action: 'alert' }),
      makeEntry({ trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.9 }, action: 'alert' }),
      makeEntry({ trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.9 }, action: 'alert' }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(2);
  });

  it('should sort patterns by confidence descending', () => {
    const entries = [
      // 3 entries, all success -> higher confidence
      makeEntry({ action: 'scale_up', outcome: 'success' }),
      makeEntry({ action: 'scale_up', outcome: 'success' }),
      makeEntry({ action: 'scale_up', outcome: 'success' }),
      // 3 entries, mixed -> lower confidence
      makeEntry({ trigger: { type: 'threshold', metric: 'gas', value: 0.9 }, action: 'alert', outcome: 'success' }),
      makeEntry({ trigger: { type: 'threshold', metric: 'gas', value: 0.9 }, action: 'alert', outcome: 'failure' }),
      makeEntry({ trigger: { type: 'threshold', metric: 'gas', value: 0.9 }, action: 'alert', outcome: 'failure' }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].confidence).toBeGreaterThan(result.patterns[1].confidence);
  });

  it('should calculate confidence from occurrences and success rate', () => {
    const entries = Array.from({ length: 10 }, () => makeEntry({ outcome: 'success' }));
    const result = extractPatterns(entries);
    expect(result.patterns[0].confidence).toBeGreaterThan(0.5);
    expect(result.patterns[0].confidence).toBeLessThanOrEqual(1);
  });

  it('should compute correct valueRange from trigger values', () => {
    const entries = [
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.2 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.9 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].trigger.valueRange[0]).toBe(3.2);
    expect(result.patterns[0].trigger.valueRange[1]).toBe(3.9);
  });

  it('should compute avgResolutionMs correctly', () => {
    const entries = [
      makeEntry({ resolutionMs: 30000 }),
      makeEntry({ resolutionMs: 60000 }),
      makeEntry({ resolutionMs: 45000 }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].avgResolutionMs).toBe(45000);
  });

  it('should track firstSeen and lastSeen timestamps', () => {
    const entries = [
      makeEntry({ timestamp: '2026-01-01T00:00:00Z' }),
      makeEntry({ timestamp: '2026-01-03T00:00:00Z' }),
      makeEntry({ timestamp: '2026-01-02T00:00:00Z' }),
    ];
    const result = extractPatterns(entries);
    expect(result.patterns[0].firstSeen).toBe('2026-01-01T00:00:00Z');
    expect(result.patterns[0].lastSeen).toBe('2026-01-03T00:00:00Z');
  });

  it('should return totalExperienceAnalyzed count', () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const result = extractPatterns(entries);
    expect(result.totalExperienceAnalyzed).toBe(3);
  });

  it('should handle empty input', () => {
    const result = extractPatterns([]);
    expect(result.patterns).toEqual([]);
    expect(result.totalExperienceAnalyzed).toBe(0);
  });

  it('should allow custom minOccurrences', () => {
    const entries = [makeEntry(), makeEntry()];
    const result = extractPatterns(entries, 2);
    expect(result.patterns.length).toBe(1);
  });

  it('should generate deterministic pattern IDs from signature', () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const result1 = extractPatterns(entries);
    const result2 = extractPatterns(entries);
    expect(result1.patterns[0].id).toBe(result2.patterns[0].id);
  });
});
