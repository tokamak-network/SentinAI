/**
 * Playbook Evolution Types & Zod Schemas
 *
 * Defines types for Phase 6: PlaybookEvolver
 * - Dynamic playbook learning and generation
 * - A/B testing and pattern mining
 * - LLM-based playbook creation with versioning
 */

import { z } from 'zod';

/**
 * IncidentPattern Schema
 * Captures learned patterns from incident resolution history
 */
export const IncidentPatternSchema = z.object({
  anomalyType: z.string(),
  effectiveAction: z.string(),
  successRate: z.number().min(0).max(100),
  executionCount: z.number().int().positive(),
  avgDuration: z.number().positive(),
  correlationStrength: z.number().min(0).max(1),
});

export type IncidentPattern = z.infer<typeof IncidentPatternSchema>;

/**
 * RemediationAction Schema
 * Represents an executable action within a playbook
 */
export const RemediationActionSchema = z.object({
  type: z.string(),
  target: z.string(),
  params: z.unknown(),
  timeout: z.number().int().positive(),
});

export type RemediationAction = z.infer<typeof RemediationActionSchema>;

/**
 * PromptUsageMetrics Schema
 * Tracks LLM token usage for playbook generation
 */
export const PromptUsageMetricsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative(),
});

export type PromptUsageMetrics = z.infer<typeof PromptUsageMetricsSchema>;

/**
 * PatternContext Schema
 * Contextual patterns used during playbook generation
 */
export const PatternContextSchema = z.object({
  patterns: z.array(IncidentPatternSchema),
  successRateBaseline: z.number().min(0).max(100),
});

export type PatternContext = z.infer<typeof PatternContextSchema>;

/**
 * EvolvedPlaybook Schema
 * Complete playbook with generation metadata and versioning
 */
export const EvolvedPlaybookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  actions: z.array(RemediationActionSchema),
  fallbacks: z.array(RemediationActionSchema),
  timeout: z.number().int().positive(),
  versionId: z.string(),
  parentVersionId: z.string(),
  generatedAt: z.date(),
  generatedBy: z.string(),
  confidenceSource: z.enum(['llm_generation', 'pattern_mining', 'human_authored']),
  generationPromptUsage: PromptUsageMetricsSchema,
  patternContext: PatternContextSchema,
});

export type EvolvedPlaybook = z.infer<typeof EvolvedPlaybookSchema>;

/**
 * ABTestResult Schema
 * Result from an A/B test comparing two playbook versions
 */
export const ABTestResultSchema = z.object({
  testSessionId: z.string(),
  variantA: z.object({
    playbookId: z.string(),
    versionId: z.string(),
  }),
  variantB: z.object({
    playbookId: z.string(),
    versionId: z.string(),
  }),
  executionCount: z.number().int().nonnegative(),
  successCountA: z.number().int().nonnegative(),
  successCountB: z.number().int().nonnegative(),
  avgDurationA: z.number().positive(),
  avgDurationB: z.number().positive(),
  winner: z.enum(['A', 'B', 'inconclusive']),
  confidenceLevel: z.number().min(0).max(1),
  startedAt: z.date(),
  completedAt: z.date().optional(),
});

export type ABTestResult = z.infer<typeof ABTestResultSchema>;

/**
 * ABTestState Type
 * Tracks the current state of an A/B test
 */
export enum ABTestStateEnum {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  INCONCLUSIVE = 'inconclusive',
  ROLLED_BACK = 'rolled_back',
}

export const ABTestStateSchema = z.enum([
  'pending',
  'running',
  'completed',
  'inconclusive',
  'rolled_back',
]);

export type ABTestState = z.infer<typeof ABTestStateSchema>;

/**
 * ABTestSession Interface
 * Session state for managing A/B tests (Task 4: ABTestController)
 */
export interface ABTestSession {
  id: string;
  testPlaybookId: string;
  controlPlaybookId: string;
  status: 'running' | 'completed';
  createdAt: Date;
  stats: {
    controlExecutions: number;
    testExecutions: number;
    controlSuccesses: number;
    testSuccesses: number;
    confidenceLevel: number;
    statSignificant: boolean;
  };
}

/**
 * PlaybookVersion Interface
 * Represents a versioned snapshot of an evolved playbook
 */
export interface PlaybookVersion {
  versionId: string;         // v-0, v-1, v-2, ...
  playbook: EvolvedPlaybook;
  promotedAt: Date;          // When this version was promoted to active
  isActive: boolean;         // Is this the currently active version
}

/**
 * PlaybookVersionHistory Interface
 * Tracks current and historical playbook versions
 */
export interface PlaybookVersionHistory {
  current: PlaybookVersion;
  history: PlaybookVersion[]; // max 10 versions (excluding current)
}
