import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateGoalPlanCandidate } from '@/lib/goal-planner-llm';

const hoisted = vi.hoisted(() => ({
  aiClientMock: {
    chatCompletion: vi.fn(),
  },
}));

vi.mock('@/lib/ai-client', () => ({
  chatCompletion: hoisted.aiClientMock.chatCompletion,
}));

describe('goal-planner-llm', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envBackup };
    process.env.QWEN_API_KEY = 'test-key';
    process.env.GOAL_PLANNER_LLM_ENABLED = 'true';
  });

  it('should return normalized candidate on valid model response', async () => {
    hoisted.aiClientMock.chatCompletion.mockResolvedValue({
      content: JSON.stringify({
        intent: 'stabilize',
        summary: 'stabilize plan',
        steps: [
          {
            title: 'Collect state',
            action: 'collect_state',
            reason: 'baseline',
            risk: 'low',
            requiresApproval: false,
          },
        ],
      }),
      provider: 'qwen',
      model: 'qwen3-80b-next',
    });

    const result = await generateGoalPlanCandidate({
      goal: 'stabilize system',
      dryRun: true,
      replanCount: 0,
      maxReplans: 2,
      previousIssues: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.intent).toBe('stabilize');
      expect(result.candidate.steps?.[0]?.action).toBe('collect_state');
    }
  });

  it('should fail when llm planning disabled', async () => {
    process.env.GOAL_PLANNER_LLM_ENABLED = 'false';

    const result = await generateGoalPlanCandidate({
      goal: 'investigate',
      dryRun: true,
      replanCount: 0,
      maxReplans: 2,
      previousIssues: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe('llm_unavailable');
    }
  });

  it('should fail with parse error for malformed json', async () => {
    hoisted.aiClientMock.chatCompletion.mockResolvedValue({
      content: '{invalid',
      provider: 'qwen',
      model: 'qwen3-80b-next',
    });

    const result = await generateGoalPlanCandidate({
      goal: 'recover',
      dryRun: true,
      replanCount: 1,
      maxReplans: 2,
      previousIssues: ['schema_invalid'],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe('llm_parse_error');
    }
  });
});
