/**
 * Goal Planner LLM Adapter
 * Generates candidate plans for natural-language goals.
 */

import { chatCompletion, type ModelTier } from '@/lib/ai-client';
import { parseAIJSON } from '@/lib/ai-response-parser';
import type { GoalPlanFailureReasonCode } from '@/types/goal-planner';
import type { GoalPlanCandidate } from '@/lib/goal-plan-validator';

const MAX_MODEL_STEPS = 10;
const DEFAULT_MODEL_TIER: ModelTier = process.env.GOAL_PLANNER_MODEL_TIER === 'best' ? 'best' : 'fast';

export interface GenerateGoalPlanInput {
  goal: string;
  dryRun: boolean;
  replanCount: number;
  maxReplans: number;
  previousIssues: string[];
}

export interface GenerateGoalPlanSuccess {
  ok: true;
  candidate: GoalPlanCandidate;
  provider: string;
  model: string;
}

export interface GenerateGoalPlanFailure {
  ok: false;
  reasonCode: GoalPlanFailureReasonCode;
  message: string;
}

export type GenerateGoalPlanResult =
  | GenerateGoalPlanSuccess
  | GenerateGoalPlanFailure;

function isLlmPlanningEnabled(): boolean {
  return process.env.GOAL_PLANNER_LLM_ENABLED !== 'false';
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

function buildSystemPrompt(): string {
  return [
    'You are a strict L2 operations planner.',
    'Return only JSON with fields: intent, summary, steps.',
    'Allowed intent: stabilize, cost-optimize, investigate, recover, custom.',
    'Allowed step.action: collect_state, inspect_anomalies, run_rca, scale_execution, restart_execution, set_routing_policy.',
    'Each step must include: title, action, reason, risk, requiresApproval.',
    'Optional fields: parameters, preconditions, rollbackHint.',
    'For scale_execution, include parameters.targetVcpu in [1,2,4,8].',
    'For set_routing_policy, include parameters.policyName in [balanced,cost-first,latency-first,quality-first].',
    'Never include markdown fences, comments, or additional text.',
  ].join('\n');
}

function buildUserPrompt(input: GenerateGoalPlanInput): string {
  const priorIssues = input.previousIssues.length > 0
    ? input.previousIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')
    : 'None';

  return [
    `Goal: ${input.goal}`,
    `dryRun: ${input.dryRun}`,
    `replanCount: ${input.replanCount} / ${input.maxReplans}`,
    `Previous validation issues:\n${priorIssues}`,
    `Hard limits: max ${MAX_MODEL_STEPS} steps.`,
    'Output JSON example:',
    '{"intent":"stabilize","summary":"...","steps":[{"title":"...","action":"collect_state","reason":"...","risk":"low","requiresApproval":false}]}',
  ].join('\n');
}

function toFailure(reasonCode: GoalPlanFailureReasonCode, message: string): GenerateGoalPlanFailure {
  return {
    ok: false,
    reasonCode,
    message,
  };
}

function normalizeCandidate(raw: unknown): GoalPlanCandidate {
  if (!raw || typeof raw !== 'object') return {};
  const candidate = raw as Record<string, unknown>;
  const steps = Array.isArray(candidate.steps) ? candidate.steps : [];

  return {
    intent: typeof candidate.intent === 'string' ? candidate.intent : undefined,
    summary: typeof candidate.summary === 'string' ? candidate.summary : undefined,
    steps: steps.map((step) => (typeof step === 'object' && step !== null ? step : {})),
  };
}

export async function generateGoalPlanCandidate(
  input: GenerateGoalPlanInput
): Promise<GenerateGoalPlanResult> {
  if (!isLlmPlanningEnabled()) {
    return toFailure('llm_unavailable', 'LLM planning is disabled by GOAL_PLANNER_LLM_ENABLED=false');
  }

  if (!hasAnyAiProviderKey()) {
    return toFailure('llm_unavailable', 'No AI provider key configured for LLM goal planning');
  }

  try {
    const completion = await chatCompletion({
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt(input),
      modelTier: DEFAULT_MODEL_TIER,
      temperature: 0.1,
      maxTokens: 1200,
    });

    const parsed = parseAIJSON<unknown>(completion.content);
    return {
      ok: true,
      candidate: normalizeCandidate(parsed),
      provider: completion.provider,
      model: completion.model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const reasonCode: GoalPlanFailureReasonCode = message.includes('JSON') ? 'llm_parse_error' : 'llm_unavailable';
    return toFailure(reasonCode, message);
  }
}
