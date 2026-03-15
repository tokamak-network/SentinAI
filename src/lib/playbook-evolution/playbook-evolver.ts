import { EvolvedPlaybook, EvolvedPlaybookSchema, IncidentPattern } from '@/lib/types/playbook-evolution';
import type Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-5-20250929';
const TIMEOUT_MS = 60 * 1000;

/**
 * Simple Result type for error handling
 * Allows isOk(), isErr(), unwrap() patterns
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

  static ok<T, E>(value: T): Result<T, E> {
    return new Result(value, null);
  }

  static err<T, E>(error: E): Result<T, E> {
    return new Result(null, error);
  }
}

export class PlaybookEvolver {
  constructor(private aiClient: Anthropic) {}

  async generate(
    patterns: IncidentPattern[],
    parentVersionId: string,
    chainName: string
  ): Promise<Result<EvolvedPlaybook, Error>> {
    try {
      const nextVersionId = this.incrementVersionId(parentVersionId);
      const context = this.buildPromptContext(patterns, chainName);

      const response = await this.aiClient.messages.create({
        model: MODEL,
        max_tokens: 2048,
        timeout: TIMEOUT_MS,
        system: this.systemPrompt(chainName),
        messages: [
          {
            role: 'user',
            content: context,
          },
        ],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        return Result.err(new Error('No text content in API response'));
      }

      const jsonText = this.extractJSON(textContent.text);
      const playbookData = JSON.parse(jsonText);

      const evolved: EvolvedPlaybook = {
        ...playbookData,
        versionId: nextVersionId,
        parentVersionId,
        generatedAt: new Date(),
        generatedBy: MODEL,
        confidenceSource: 'llm_generation',
        generationPromptUsage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalCost: this.estimateCost(response.usage.input_tokens, response.usage.output_tokens),
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
        return Result.err(new Error(`Playbook validation failed: ${validation.error.message}`));
      }

      return Result.ok(validation.data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[PlaybookEvolver] generate error:', error.message);
      return Result.err(error);
    }
  }

  private systemPrompt(chainName: string): string {
    return `You are an expert ${chainName} L2 operations system designer.
Generate optimized remediation playbooks based on success patterns.
Output MUST be valid JSON matching the playbook structure (id, name, actions, fallbacks, timeout).
Constraints: Max 3 primary actions, max 2 fallbacks. Never force-restart sequencer.`;
  }

  private buildPromptContext(patterns: IncidentPattern[], chainName: string): string {
    const summary = patterns.length > 0
      ? patterns.map(p => `- ${p.anomalyType}: ${p.effectiveAction} (${p.successRate.toFixed(0)}%)`).join('\n')
      : 'No patterns yet (baseline generation)';

    return `Based on these successful remediation patterns from ${chainName}:
${summary}

Generate an optimized playbook leveraging the most successful actions.
Output ONLY valid JSON, no markdown.`;
  }

  private extractJSON(text: string): string {
    const codeBlockMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) return codeBlockMatch[1];
    return text;
  }

  private incrementVersionId(parentVersionId: string): string {
    const match = parentVersionId.match(/^v-(\d+)$/);
    if (!match) throw new Error(`Invalid version ID: ${parentVersionId}`);
    return `v-${parseInt(match[1], 10) + 1}`;
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  }
}
