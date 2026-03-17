/**
 * PlaybookEvolver: LLM-enhanced playbook generation
 *
 * Uses the project's chatCompletion() AI client (with provider fallback)
 * to generate optimized remediation playbooks from incident patterns.
 */

import { chatCompletion } from '@/lib/ai-client';
import { EvolvedPlaybook, EvolvedPlaybookSchema, IncidentPattern } from '@/lib/types/playbook-evolution';
import { createLogger } from '@/lib/logger';

const logger = createLogger('PlaybookEvolver');

/**
 * Simple Result type for error handling
 */
export class Result<T, E> {
  constructor(
    private value: T | null,
    private error: E | null,
  ) {}

  isOk(): boolean {
    return this.error === null;
  }

  isErr(): boolean {
    return this.error !== null;
  }

  unwrap(): T {
    if (this.error !== null) {
      throw new Error(`Called unwrap on Err: ${this.error}`);
    }
    return this.value!;
  }

  getError(): E | null {
    return this.error;
  }

  static ok<T, E = any>(value: T): Result<T, E> {
    return new Result(value, null) as Result<T, E>;
  }

  static err<T = any, E = any>(error: E): Result<T, E> {
    return new Result(null, error) as Result<T, E>;
  }
}

export class PlaybookEvolver {
  async generate(
    patterns: IncidentPattern[],
    parentVersionId: string,
    chainName: string
  ): Promise<Result<EvolvedPlaybook, Error>> {
    try {
      const nextVersionId = this.incrementVersionId(parentVersionId);

      const response = await chatCompletion({
        systemPrompt: this.systemPrompt(chainName),
        userPrompt: this.buildPromptContext(patterns, chainName),
        modelTier: 'best',
        temperature: 0.3,
        maxTokens: 2048,
      });

      const jsonText = this.extractJSON(response.content);
      const playbookData = JSON.parse(jsonText);

      const evolved: EvolvedPlaybook = {
        ...playbookData,
        versionId: nextVersionId,
        parentVersionId,
        generatedAt: new Date(),
        generatedBy: `${response.provider}/${response.model}`,
        confidenceSource: 'llm_generation',
        generationPromptUsage: {
          inputTokens: response.usage?.promptTokens ?? 0,
          outputTokens: response.usage?.completionTokens ?? 0,
          totalCost: this.estimateCost(
            response.usage?.promptTokens ?? 0,
            response.usage?.completionTokens ?? 0,
          ),
        },
        patternContext: {
          patterns,
          successRateBaseline: patterns.length > 0
            ? patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length
            : 0,
        },
      };

      const validation = EvolvedPlaybookSchema.safeParse(evolved);
      if (!validation.success) {
        logger.warn('[PlaybookEvolver] Validation failed: %s', validation.error.message);
        return Result.err(new Error(`Playbook validation failed: ${validation.error.message}`));
      }

      logger.info(
        '[PlaybookEvolver] Generated %s from %d patterns via %s/%s (tokens: %d+%d)',
        nextVersionId,
        patterns.length,
        response.provider,
        response.model,
        response.usage?.promptTokens ?? 0,
        response.usage?.completionTokens ?? 0,
      );

      return Result.ok(validation.data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('[PlaybookEvolver] generate error: %s', error.message);
      return Result.err(error);
    }
  }

  private systemPrompt(chainName: string): string {
    return `You are an expert ${chainName} L2 operations system designer.
Generate optimized remediation playbooks based on observed incident response patterns.

Output MUST be valid JSON with this exact structure:
{
  "id": "pb-<short-id>",
  "name": "<descriptive name>",
  "description": "<what this playbook does and when to use it>",
  "actions": [
    { "type": "<action-type>", "target": "<component>", "params": {}, "timeout": <ms> }
  ],
  "fallbacks": [
    { "type": "<fallback-type>", "target": "<component>", "params": {}, "timeout": <ms> }
  ],
  "timeout": <total-timeout-ms>
}

Action types: scale, restart, drain, config-patch, cache-clear, rpc-failover, alert
Targets: op-geth, op-node, op-batcher, op-proposer, sequencer, validator

Constraints:
- Max 3 primary actions, max 2 fallbacks
- Never force-restart sequencer without drain first
- Prefer vertical scaling (vCPU adjustment) over horizontal
- Timeouts must be realistic (5s-300s per action, 60s-600s total)
- Output ONLY valid JSON, no markdown code blocks, no explanation`;
  }

  private buildPromptContext(patterns: IncidentPattern[], chainName: string): string {
    if (patterns.length === 0) {
      return `No incident patterns available yet for ${chainName}. Generate a baseline defensive playbook for common L2 operational scenarios (high CPU, gas spikes, sync lag).`;
    }

    const summary = patterns
      .sort((a, b) => b.executionCount - a.executionCount)
      .map(p =>
        `- ${p.anomalyType}: action="${p.effectiveAction}" success=${p.successRate.toFixed(0)}% ` +
        `count=${p.executionCount} avgDuration=${Math.round(p.avgDuration)}ms correlation=${p.correlationStrength.toFixed(2)}`
      )
      .join('\n');

    return `Based on these observed remediation patterns from ${chainName} (${patterns.length} patterns, sorted by frequency):

${summary}

Generate an optimized playbook that:
1. Leverages the most successful actions as primary steps
2. Uses less-proven actions as fallbacks
3. Orders actions by urgency and dependency
4. Sets appropriate timeouts based on observed durations

Output ONLY valid JSON.`;
  }

  private extractJSON(text: string): string {
    // Try code block first
    const codeBlockMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();
    // Try to find JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return text;
  }

  private incrementVersionId(parentVersionId: string): string {
    const match = parentVersionId.match(/^v-(\d+)$/);
    if (!match) return `v-1`;
    return `v-${parseInt(match[1], 10) + 1}`;
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Conservative estimate (Anthropic Sonnet pricing)
    return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  }
}
