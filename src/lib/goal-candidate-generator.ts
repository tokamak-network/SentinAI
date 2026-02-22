/**
 * Goal Candidate Generator
 * Phase B baseline: rule-based generation with optional LLM phrasing enhancer.
 */

import { createHash, randomUUID } from 'crypto';
import { chatCompletion, type ModelTier } from '@/lib/ai-client';
import { parseAIJSON } from '@/lib/ai-response-parser';
import type {
  AutonomousGoalCandidate,
  GoalSignalSnapshot,
  AutonomousGoalSource,
  AutonomousGoalRisk,
} from '@/types/goal-manager';
import type { GoalPlanIntent } from '@/types/goal-planner';

const DEFAULT_MODEL_TIER: ModelTier = process.env.GOAL_CANDIDATE_MODEL_TIER === 'best' ? 'best' : 'fast';
const MAX_CANDIDATES_DEFAULT = 6;

export interface GenerateGoalCandidatesOptions {
  now?: number;
  maxCandidates?: number;
  llmEnhancerEnabled?: boolean;
}

export interface GenerateGoalCandidatesResult {
  candidates: AutonomousGoalCandidate[];
  llmEnhanced: boolean;
  llmFallbackReason?: string;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampConfidence(value: number): number {
  return Math.min(0.99, Math.max(0.05, Math.round(value * 100) / 100));
}

function normalizeGoalText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function toSignature(chainType: string, source: AutonomousGoalSource, intent: GoalPlanIntent, goal: string): string {
  return createHash('sha256')
    .update(`${chainType}|${source}|${intent}|${normalizeGoalText(goal).toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function hasAnyAiProviderKey(): boolean {
  return Boolean(
    process.env.QWEN_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GPT_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY
  );
}

function isLlmEnhancerEnabled(options?: GenerateGoalCandidatesOptions): boolean {
  if (typeof options?.llmEnhancerEnabled === 'boolean') {
    return options.llmEnhancerEnabled;
  }
  return process.env.GOAL_CANDIDATE_LLM_ENABLED === 'true';
}

function createCandidate(params: {
  snapshot: GoalSignalSnapshot;
  now: number;
  source: AutonomousGoalSource;
  intent: GoalPlanIntent;
  risk: AutonomousGoalRisk;
  confidence: number;
  goal: string;
  rationale: string;
  metadata?: Record<string, unknown>;
}): AutonomousGoalCandidate {
  const timestamp = new Date(params.now).toISOString();
  const goal = normalizeGoalText(params.goal);
  const signature = toSignature(params.snapshot.chainType, params.source, params.intent, goal);

  return {
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    source: params.source,
    status: 'candidate',
    goal,
    intent: params.intent,
    risk: params.risk,
    confidence: clampConfidence(params.confidence),
    signature,
    rationale: normalizeGoalText(params.rationale),
    signalSnapshotId: params.snapshot.snapshotId,
    metadata: params.metadata,
  };
}

function dedupeCandidates(candidates: AutonomousGoalCandidate[]): AutonomousGoalCandidate[] {
  const seen = new Set<string>();
  const unique: AutonomousGoalCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.signature)) {
      continue;
    }
    seen.add(candidate.signature);
    unique.push(candidate);
  }

  return unique;
}

function buildRuleCandidates(snapshot: GoalSignalSnapshot, now: number): AutonomousGoalCandidate[] {
  const candidates: AutonomousGoalCandidate[] = [];
  const cpu = snapshot.metrics.latestCpuUsage ?? 0;
  const txPool = snapshot.metrics.latestTxPoolPending ?? 0;

  const highPressure = cpu >= 75 || snapshot.anomalies.activeCount > 0 || (snapshot.metrics.txPoolTrend === 'rising' && txPool >= 500);
  if (highPressure) {
    const risk: AutonomousGoalRisk = snapshot.anomalies.criticalCount > 0 || cpu >= 90 ? 'critical' : 'high';
    const confidenceBase = 0.62
      + (snapshot.anomalies.activeCount > 0 ? 0.14 : 0)
      + (cpu >= 85 ? 0.12 : 0)
      + (txPool >= 1000 ? 0.1 : 0);
    candidates.push(createCandidate({
      snapshot,
      now,
      source: snapshot.anomalies.activeCount > 0 ? 'anomaly' : 'metrics',
      intent: 'stabilize',
      risk,
      confidence: confidenceBase,
      goal: 'Stabilize L2 throughput and mitigate active anomaly signals',
      rationale: `CPU=${cpu.toFixed(1)}%, activeAnomaly=${snapshot.anomalies.activeCount}, txPool=${txPool}`,
      metadata: {
        cpu,
        activeAnomalyCount: snapshot.anomalies.activeCount,
        txPoolPending: txPool,
      },
    }));
  }

  if (snapshot.failover.recentCount > 0) {
    const risk: AutonomousGoalRisk = snapshot.failover.recentCount >= 2 ? 'high' : 'medium';
    const confidence = 0.58 + Math.min(0.24, snapshot.failover.recentCount * 0.08);
    candidates.push(createCandidate({
      snapshot,
      now,
      source: 'failover',
      intent: 'investigate',
      risk,
      confidence,
      goal: 'Investigate recent L1 RPC failover causes and define recurrence prevention actions',
      rationale: `failoverRecent=${snapshot.failover.recentCount}, activeL1Rpc=${snapshot.failover.activeL1RpcUrl}`,
      metadata: {
        failoverRecentCount: snapshot.failover.recentCount,
      },
    }));
  }

  const costOptimizable =
    snapshot.anomalies.activeCount === 0 &&
    snapshot.failover.recentCount === 0 &&
    snapshot.metrics.cooldownRemaining === 0 &&
    snapshot.cost.dataPointCount >= 24 &&
    snapshot.cost.avgVcpu >= 2 &&
    snapshot.cost.avgUtilization <= 45;
  if (costOptimizable) {
    const confidence = 0.56
      + Math.min(0.18, Math.max(0, (45 - snapshot.cost.avgUtilization) / 100))
      + Math.min(0.12, snapshot.cost.dataPointCount / 1000);
    candidates.push(createCandidate({
      snapshot,
      now,
      source: 'cost',
      intent: 'cost-optimize',
      risk: 'medium',
      confidence,
      goal: 'Optimize execution resources for cost during idle windows',
      rationale: `avgVcpu=${snapshot.cost.avgVcpu}, avgUtil=${snapshot.cost.avgUtilization}%, data=${snapshot.cost.dataPointCount}`,
      metadata: {
        avgVcpu: snapshot.cost.avgVcpu,
        avgUtilization: snapshot.cost.avgUtilization,
        dataPointCount: snapshot.cost.dataPointCount,
      },
    }));
  }

  if (snapshot.memory.recentIncidentCount >= 3 || snapshot.memory.recentHighSeverityCount >= 2) {
    const confidence = 0.53 + Math.min(0.25, snapshot.memory.recentIncidentCount * 0.05);
    candidates.push(createCandidate({
      snapshot,
      now,
      source: 'memory',
      intent: 'investigate',
      risk: snapshot.memory.recentHighSeverityCount >= 2 ? 'high' : 'medium',
      confidence,
      goal: 'Analyze recurring incident patterns and define preventive operational goals',
      rationale: `incidentMemory=${snapshot.memory.recentIncidentCount}, highSeverityMemory=${snapshot.memory.recentHighSeverityCount}`,
      metadata: {
        recentIncidentCount: snapshot.memory.recentIncidentCount,
        recentHighSeverityCount: snapshot.memory.recentHighSeverityCount,
      },
    }));
  }

  if (!snapshot.policy.autoScalingEnabled && (cpu >= 70 || snapshot.anomalies.activeCount > 0)) {
    candidates.push(createCandidate({
      snapshot,
      now,
      source: 'policy',
      intent: 'investigate',
      risk: 'high',
      confidence: 0.64,
      goal: 'Assess risk from disabled autoscaling and restore a safe operating path',
      rationale: `autoScalingEnabled=false, cpu=${cpu.toFixed(1)}%, activeAnomaly=${snapshot.anomalies.activeCount}`,
      metadata: {
        autoScalingEnabled: false,
        cpu,
      },
    }));
  }

  if (candidates.length === 0) {
    candidates.push(createCandidate({
      snapshot,
      now,
      source: 'metrics',
      intent: 'investigate',
      risk: 'low',
      confidence: 0.42,
      goal: 'Review current operations and prepare next-cycle goals',
      rationale: 'Generated a baseline inspection goal because no strong anomaly signal was detected',
      metadata: {
        fallback: true,
      },
    }));
  }

  return dedupeCandidates(candidates);
}

interface GoalCandidateEnhancerOutput {
  candidates?: Array<{
    index?: number;
    goal?: string;
    rationale?: string;
  }>;
}

function buildEnhancerSystemPrompt(): string {
  return [
    'You are a goal text enhancer for L2 operations automation.',
    'Return only JSON: {"candidates":[{"index":0,"goal":"...","rationale":"..."}]}',
    'Do not change intent/source/risk/confidence meaning.',
    'Keep each goal and rationale concise, operational, and in English.',
    'Do not add markdown fences or commentary.',
  ].join('\n');
}

function buildEnhancerUserPrompt(snapshot: GoalSignalSnapshot, candidates: AutonomousGoalCandidate[]): string {
  const compactCandidates = candidates.map((candidate, index) => ({
    index,
    source: candidate.source,
    intent: candidate.intent,
    risk: candidate.risk,
    goal: candidate.goal,
    rationale: candidate.rationale,
  }));

  return JSON.stringify({
    chainType: snapshot.chainType,
    snapshotId: snapshot.snapshotId,
    summary: {
      cpu: snapshot.metrics.latestCpuUsage,
      txPool: snapshot.metrics.latestTxPoolPending,
      activeAnomaly: snapshot.anomalies.activeCount,
      failoverRecent: snapshot.failover.recentCount,
      avgUtilization: snapshot.cost.avgUtilization,
    },
    candidates: compactCandidates,
  });
}

async function enhanceCandidatesWithLlm(
  snapshot: GoalSignalSnapshot,
  candidates: AutonomousGoalCandidate[]
): Promise<GenerateGoalCandidatesResult> {
  if (!hasAnyAiProviderKey()) {
    return {
      candidates,
      llmEnhanced: false,
      llmFallbackReason: 'no_ai_provider_key',
    };
  }

  try {
    const completion = await chatCompletion({
      systemPrompt: buildEnhancerSystemPrompt(),
      userPrompt: buildEnhancerUserPrompt(snapshot, candidates),
      modelTier: DEFAULT_MODEL_TIER,
      temperature: 0.1,
      maxTokens: 900,
    });

    const parsed = parseAIJSON<GoalCandidateEnhancerOutput>(completion.content);
    if (!parsed || !Array.isArray(parsed.candidates)) {
      return {
        candidates,
        llmEnhanced: false,
        llmFallbackReason: 'llm_parse_error',
      };
    }

    const enhanced = candidates.map((candidate) => ({ ...candidate }));
    let changed = false;

    for (const patch of parsed.candidates) {
      if (typeof patch.index !== 'number') continue;
      if (patch.index < 0 || patch.index >= enhanced.length) continue;

      if (typeof patch.goal === 'string' && normalizeGoalText(patch.goal).length > 0) {
        enhanced[patch.index].goal = normalizeGoalText(patch.goal);
        changed = true;
      }

      if (typeof patch.rationale === 'string' && normalizeGoalText(patch.rationale).length > 0) {
        enhanced[patch.index].rationale = normalizeGoalText(patch.rationale);
        changed = true;
      }

      enhanced[patch.index].signature = toSignature(
        snapshot.chainType,
        enhanced[patch.index].source,
        enhanced[patch.index].intent,
        enhanced[patch.index].goal
      );
    }

    return {
      candidates: dedupeCandidates(enhanced),
      llmEnhanced: changed,
      llmFallbackReason: changed ? undefined : 'llm_noop',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    return {
      candidates,
      llmEnhanced: false,
      llmFallbackReason: message.includes('JSON') ? 'llm_parse_error' : 'llm_unavailable',
    };
  }
}

export function generateRuleBasedGoalCandidates(
  snapshot: GoalSignalSnapshot,
  options: GenerateGoalCandidatesOptions = {}
): AutonomousGoalCandidate[] {
  const now = options.now ?? Date.now();
  const maxCandidates = clampInt(options.maxCandidates, MAX_CANDIDATES_DEFAULT, 1, 20);

  return buildRuleCandidates(snapshot, now).slice(0, maxCandidates);
}

export async function generateAutonomousGoalCandidates(
  snapshot: GoalSignalSnapshot,
  options: GenerateGoalCandidatesOptions = {}
): Promise<GenerateGoalCandidatesResult> {
  const ruleCandidates = generateRuleBasedGoalCandidates(snapshot, options);
  if (ruleCandidates.length === 0) {
    return { candidates: [], llmEnhanced: false, llmFallbackReason: 'empty_rule_candidates' };
  }

  if (!isLlmEnhancerEnabled(options)) {
    return { candidates: ruleCandidates, llmEnhanced: false };
  }

  return enhanceCandidatesWithLlm(snapshot, ruleCandidates);
}
