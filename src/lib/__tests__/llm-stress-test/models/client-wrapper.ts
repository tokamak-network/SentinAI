import { chatCompletion, type AIProvider, type ModelTier } from '@/lib/ai-client';
import type { InvokeResult } from '../types';

/**
 * Environment variable configuration for LLM testing
 */
interface LLMTestConfig {
  providers: AIProvider[];
  timeoutFast: number;
  timeoutBest: number;
  proxyUrl?: string;
  proxyEnabled: boolean;
}

/**
 * Load LLM test configuration from environment variables
 */
function loadLLMTestConfig(): LLMTestConfig {
  return {
    providers: (process.env.LLM_TEST_PROVIDERS || 'qwen,anthropic,openai,gemini')
      .split(',')
      .map(p => p.trim() as AIProvider),
    timeoutFast: parseInt(process.env.LLM_TEST_TIMEOUT_FAST || '30000', 10),
    timeoutBest: parseInt(process.env.LLM_TEST_TIMEOUT_BEST || '60000', 10),
    proxyUrl: process.env.LLM_TEST_PROXY_URL,
    proxyEnabled: process.env.LLM_TEST_PROXY_ENABLED === 'true',
  };
}

/**
 * Wrapper around ai-client.ts chatCompletion() for stress testing
 * Handles: latency measurement, cost calculation, timeout, error handling
 */
export class LLMClientWrapper {
  /**
   * Pricing per 1M tokens (input/output)
   * Source: Official provider pricing as of 2026-02
   */
  private static readonly PRICING: Record<AIProvider, Record<ModelTier, { input: number; output: number }>> = {
    qwen: {
      fast: { input: 0.50, output: 0.50 },     // qwen-turbo-latest
      best: { input: 2.00, output: 2.00 },     // qwen-max-latest
    },
    anthropic: {
      fast: { input: 0.80, output: 0.15 },     // claude-haiku-4.5
      best: { input: 3.00, output: 15.00 },    // claude-sonnet-4.5
    },
    openai: {
      fast: { input: 0.15, output: 0.60 },     // gpt-4.1-mini
      best: { input: 30.00, output: 60.00 },   // gpt-4.1
    },
    gemini: {
      fast: { input: 0.075, output: 0.30 },    // gemini-2.5-flash-lite
      best: { input: 1.50, output: 6.00 },     // gemini-2.5-pro
    },
  };

  private static readonly testConfig = loadLLMTestConfig();

  constructor(
    private provider: AIProvider,
    private tier: ModelTier
  ) {}

  /**
   * Get default timeout for this tier
   */
  private getDefaultTimeout(): number {
    return this.tier === 'fast'
      ? LLMClientWrapper.testConfig.timeoutFast
      : LLMClientWrapper.testConfig.timeoutBest;
  }

  /**
   * Invoke LLM with system and user prompts
   * Measures latency, calculates cost, handles errors and timeouts
   */
  async invoke(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      maxTokens?: number;
      timeout?: number;
    }
  ): Promise<InvokeResult> {
    const startTime = Date.now();

    // Setup timeout with AbortController
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | null = null;

    // Use provided timeout or default based on tier
    const timeout = options?.timeout ?? this.getDefaultTimeout();
    if (timeout) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, timeout);
    }

    try {
      const result = await chatCompletion({
        systemPrompt,
        userPrompt,
        modelTier: this.tier,
        maxTokens: options?.maxTokens ?? 2048,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startTime;
      const tokensIn = result.usage?.promptTokens ?? 0;
      const tokensOut = result.usage?.completionTokens ?? 0;
      const costUsd = this.calculateCost(tokensIn, tokensOut);

      return {
        text: result.content,
        tokensIn,
        tokensOut,
        latencyMs,
        costUsd,
        provider: result.provider,
        model: result.model,
        timestamp: Date.now(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        text: '',
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
        costUsd: 0,
        provider: this.provider,
        model: 'unknown',
        timestamp: Date.now(),
        error: errorMessage,
      };
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Calculate cost in USD based on token counts
   * Uses provider/tier-specific pricing
   */
  private calculateCost(tokensIn: number, tokensOut: number): number {
    const rates = LLMClientWrapper.PRICING[this.provider][this.tier];
    if (!rates) {
      throw new Error(`Unknown provider/tier: ${this.provider}/${this.tier}`);
    }

    // Cost = (input_tokens * input_rate + output_tokens * output_rate) / 1,000,000
    return (tokensIn * rates.input + tokensOut * rates.output) / 1_000_000;
  }

  /**
   * Get provider and tier information
   */
  getInfo(): { provider: AIProvider; tier: ModelTier } {
    return {
      provider: this.provider,
      tier: this.tier,
    };
  }
}

/**
 * Factory to create client wrappers for multiple provider/tier combinations
 */
export function createClientsForAllProviders(
  providers: AIProvider[] = ['qwen', 'anthropic', 'openai', 'gemini'],
  tiers: ModelTier[] = ['fast', 'best']
): LLMClientWrapper[] {
  const clients: LLMClientWrapper[] = [];

  for (const provider of providers) {
    for (const tier of tiers) {
      clients.push(new LLMClientWrapper(provider, tier));
    }
  }

  return clients;
}
