/**
 * Pattern Extractor Types
 *
 * Represents repeatable operational patterns discovered from ExperienceEntry records.
 * A pattern captures: "When [trigger condition], doing [action] has [success rate]
 * over [N occurrences]."
 */

export interface OperationalPattern {
  id: string;
  signature: string;          // e.g., "z-score|cpuUsage|3|scale_up"
  description: string;        // human-readable
  trigger: {
    type: string;
    metric: string;
    valueRange: [number, number];
  };
  action: string;
  occurrences: number;
  successRate: number;         // 0-1
  avgResolutionMs: number;
  confidence: number;          // 0-1 (based on occurrences + success rate)
  protocols: string[];         // which protocol types
  firstSeen: string;
  lastSeen: string;
}

export interface PatternExtractionResult {
  patterns: OperationalPattern[];
  totalExperienceAnalyzed: number;
  extractedAt: string;
}
