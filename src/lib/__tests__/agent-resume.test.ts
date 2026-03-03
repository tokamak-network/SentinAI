import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTier, generateResume } from '@/lib/agent-resume';
import type { ExperienceEntry } from '@/types/experience';
import type { OperationalPattern } from '@/types/pattern';

// Mock experience-store
const mockGetExperienceByInstance = vi.fn();
const mockGetExperienceStats = vi.fn();

vi.mock('@/lib/experience-store', () => ({
  getExperienceByInstance: (...args: unknown[]) => mockGetExperienceByInstance(...args),
  getExperienceStats: (...args: unknown[]) => mockGetExperienceStats(...args),
}));

// Mock pattern-extractor
const mockExtractPatterns = vi.fn();

vi.mock('@/lib/pattern-extractor', () => ({
  extractPatterns: (...args: unknown[]) => mockExtractPatterns(...args),
}));

describe('agent-resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateTier', () => {
    it('should return trainee for < 30 days', () => {
      expect(calculateTier(0)).toBe('trainee');
      expect(calculateTier(15)).toBe('trainee');
      expect(calculateTier(29)).toBe('trainee');
    });

    it('should return junior for 30-89 days', () => {
      expect(calculateTier(30)).toBe('junior');
      expect(calculateTier(45)).toBe('junior');
      expect(calculateTier(89)).toBe('junior');
    });

    it('should return senior for 90-179 days', () => {
      expect(calculateTier(90)).toBe('senior');
      expect(calculateTier(120)).toBe('senior');
      expect(calculateTier(179)).toBe('senior');
    });

    it('should return expert for 180+ days', () => {
      expect(calculateTier(180)).toBe('expert');
      expect(calculateTier(365)).toBe('expert');
    });
  });

  describe('generateResume', () => {
    it('should generate a complete resume with empty data', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 0,
        successRate: 0,
        avgResolutionMs: 0,
        topCategories: [],
        operatingDays: 0,
      });
      mockGetExperienceByInstance.mockResolvedValue([]);
      mockExtractPatterns.mockReturnValue({
        patterns: [],
        totalExperienceAnalyzed: 0,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-1', 'opstack');

      expect(resume.instanceId).toBe('inst-1');
      expect(resume.protocolId).toBe('opstack');
      expect(resume.tier).toBe('trainee');
      expect(resume.stats.totalOperations).toBe(0);
      expect(resume.topPatterns).toEqual([]);
      expect(resume.specialties).toEqual([]);
      expect(resume.generatedAt).toBeDefined();
      expect(resume.operatingSince).toBeDefined();
    });

    it('should derive tier from operatingDays in stats', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 500,
        successRate: 0.95,
        avgResolutionMs: 12000,
        topCategories: [{ category: 'scaling-action', count: 300 }],
        operatingDays: 100,
      });
      mockGetExperienceByInstance.mockResolvedValue([]);
      mockExtractPatterns.mockReturnValue({
        patterns: [],
        totalExperienceAnalyzed: 0,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-2', 'opstack');
      expect(resume.tier).toBe('senior');
    });

    it('should include top 5 patterns and deduce specialties', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 200,
        successRate: 0.9,
        avgResolutionMs: 8000,
        topCategories: [],
        operatingDays: 45,
      });

      const entries: ExperienceEntry[] = [
        {
          id: 'e1',
          instanceId: 'inst-3',
          protocolId: 'opstack',
          timestamp: '2026-01-15T00:00:00.000Z',
          category: 'scaling-action',
          trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
          action: 'scale_up',
          outcome: 'success',
          resolutionMs: 5000,
          metricsSnapshot: { cpuUsage: 85 },
        },
      ];
      mockGetExperienceByInstance.mockResolvedValue(entries);

      const patterns: OperationalPattern[] = [
        {
          id: 'pat-1', signature: 'z-score|cpuUsage|3|scale_up',
          description: 'test', trigger: { type: 'z-score', metric: 'cpuUsage', valueRange: [3, 4] },
          action: 'scale_up', occurrences: 10, successRate: 0.9,
          avgResolutionMs: 5000, confidence: 0.8, protocols: ['opstack'],
          firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pat-2', signature: 'threshold|gasUsedRatio|0|alert',
          description: 'test', trigger: { type: 'threshold', metric: 'gasUsedRatio', valueRange: [0.8, 0.95] },
          action: 'alert', occurrences: 7, successRate: 1.0,
          avgResolutionMs: 2000, confidence: 0.7, protocols: ['opstack'],
          firstSeen: '2026-01-05T00:00:00Z', lastSeen: '2026-02-10T00:00:00Z',
        },
        {
          id: 'pat-3', signature: 'z-score|memoryUsage|2|scale_up',
          description: 'test', trigger: { type: 'z-score', metric: 'memoryUsage', valueRange: [2, 3] },
          action: 'scale_up', occurrences: 5, successRate: 0.8,
          avgResolutionMs: 6000, confidence: 0.6, protocols: ['opstack'],
          firstSeen: '2026-01-10T00:00:00Z', lastSeen: '2026-02-15T00:00:00Z',
        },
      ];
      mockExtractPatterns.mockReturnValue({
        patterns,
        totalExperienceAnalyzed: 200,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-3', 'opstack');

      expect(resume.topPatterns).toHaveLength(3);
      expect(resume.specialties).toContain('cpuUsage');
      expect(resume.specialties).toContain('gasUsedRatio');
      expect(resume.specialties).toContain('memoryUsage');
    });

    it('should limit topPatterns to 5', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 100,
        successRate: 0.85,
        avgResolutionMs: 10000,
        topCategories: [],
        operatingDays: 60,
      });
      mockGetExperienceByInstance.mockResolvedValue([]);

      const manyPatterns: OperationalPattern[] = Array.from({ length: 8 }, (_, i) => ({
        id: `pat-${i}`, signature: `sig-${i}`,
        description: `pattern ${i}`,
        trigger: { type: 'z-score', metric: `metric-${i}`, valueRange: [1, 2] as [number, number] },
        action: `action-${i}`, occurrences: 10 - i, successRate: 0.9,
        avgResolutionMs: 5000, confidence: 0.9 - i * 0.1,
        protocols: ['opstack'],
        firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-02-01T00:00:00Z',
      }));
      mockExtractPatterns.mockReturnValue({
        patterns: manyPatterns,
        totalExperienceAnalyzed: 100,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-4', 'opstack');

      expect(resume.topPatterns).toHaveLength(5);
      expect(resume.topPatterns[0].id).toBe('pat-0');
      expect(resume.topPatterns[4].id).toBe('pat-4');
    });

    it('should use earliest entry timestamp as operatingSince', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 10,
        successRate: 1.0,
        avgResolutionMs: 3000,
        topCategories: [],
        operatingDays: 30,
      });

      const entries: ExperienceEntry[] = [
        {
          id: 'e-recent', instanceId: 'inst-5', protocolId: 'opstack',
          timestamp: '2026-02-20T00:00:00.000Z', category: 'scaling-action',
          trigger: { type: 'z-score', metric: 'cpuUsage', value: 3 },
          action: 'scale_up', outcome: 'success', resolutionMs: 5000,
          metricsSnapshot: {},
        },
        {
          id: 'e-oldest', instanceId: 'inst-5', protocolId: 'opstack',
          timestamp: '2026-01-01T00:00:00.000Z', category: 'anomaly-resolution',
          trigger: { type: 'threshold', metric: 'gasUsedRatio', value: 0.9 },
          action: 'alert', outcome: 'success', resolutionMs: 2000,
          metricsSnapshot: {},
        },
      ];
      mockGetExperienceByInstance.mockResolvedValue(entries);
      mockExtractPatterns.mockReturnValue({
        patterns: [],
        totalExperienceAnalyzed: 2,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-5', 'opstack');

      // Last element in array (oldest) should be operatingSince
      expect(resume.operatingSince).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should deduplicate specialties from patterns', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 50,
        successRate: 0.8,
        avgResolutionMs: 7000,
        topCategories: [],
        operatingDays: 35,
      });
      mockGetExperienceByInstance.mockResolvedValue([]);

      // Two patterns with the same metric
      const patterns: OperationalPattern[] = [
        {
          id: 'pat-a', signature: 'sig-a', description: 'desc',
          trigger: { type: 'z-score', metric: 'cpuUsage', valueRange: [3, 4] },
          action: 'scale_up', occurrences: 10, successRate: 0.9,
          avgResolutionMs: 5000, confidence: 0.8, protocols: ['opstack'],
          firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pat-b', signature: 'sig-b', description: 'desc',
          trigger: { type: 'threshold', metric: 'cpuUsage', valueRange: [80, 95] },
          action: 'alert', occurrences: 8, successRate: 1.0,
          avgResolutionMs: 3000, confidence: 0.7, protocols: ['opstack'],
          firstSeen: '2026-01-05T00:00:00Z', lastSeen: '2026-02-10T00:00:00Z',
        },
      ];
      mockExtractPatterns.mockReturnValue({
        patterns,
        totalExperienceAnalyzed: 50,
        extractedAt: new Date().toISOString(),
      });

      const resume = await generateResume('inst-6', 'opstack');

      // cpuUsage should appear only once
      expect(resume.specialties).toEqual(['cpuUsage']);
    });

    it('should pass instanceId and limit 500 to getExperienceByInstance', async () => {
      mockGetExperienceStats.mockResolvedValue({
        totalOperations: 0,
        successRate: 0,
        avgResolutionMs: 0,
        topCategories: [],
        operatingDays: 0,
      });
      mockGetExperienceByInstance.mockResolvedValue([]);
      mockExtractPatterns.mockReturnValue({
        patterns: [],
        totalExperienceAnalyzed: 0,
        extractedAt: new Date().toISOString(),
      });

      await generateResume('inst-7', 'opstack');

      expect(mockGetExperienceByInstance).toHaveBeenCalledWith('inst-7', 500);
    });
  });
});
