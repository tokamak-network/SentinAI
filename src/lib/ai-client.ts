/**
 * Unified AI Client (Simplified)
 *
 * Fallback chain: Qwen > Claude > GPT > Gemini
 * Gateway support: Route through proxy when AI_GATEWAY_URL is set
 *
 * Environment variables:
 *   AI_GATEWAY_URL       (optional) - Route all requests through a gateway/proxy
 *   QWEN_API_KEY         - Qwen (DashScope) API key
 *   ANTHROPIC_API_KEY    - Anthropic (Claude) API key
 *   OPENAI_API_KEY       - OpenAI (GPT) API key
 *   GEMINI_API_KEY       - Google (Gemini) API key
 */

import { randomUUID } from 'crypto';
import {
  estimateRequestCost,
  getRoutingPolicy,
  recordRoutingDecision,
  resolveTaskClass,
  selectProvidersForTask,
  shouldApplyRoutingSample,
} from '@/lib/ai-routing';
import type { RoutingModelTier, RoutingPolicyName, RoutingTaskClass } from '@/types/ai-routing';

// =====================================================
// Types
// =====================================================

export type ModelTier = 'fast' | 'best';
export type AIProvider = 'qwen' | 'anthropic' | 'openai' | 'gemini';

export interface ChatCompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  modelTier: ModelTier;
  modelName?: string; // Optional: explicit model name for benchmarking
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  provider: AIProvider;
  model: string;
}

// =====================================================
// Model & Endpoint Mapping
// =====================================================

const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  qwen: {
    fast: 'qwen3-80b-next',      // Benchmarked: 1.8s, 100% accuracy, $30/mo
    best: 'qwen3-80b-next',       // Benchmarked: 8s, 100% accuracy, $30/mo (faster than 235b)
  },
  anthropic: {
    fast: 'claude-haiku-4-5-20251001',
    best: 'claude-sonnet-4-5-20250929',
  },
  openai: {
    fast: 'gpt-5.2',              // Benchmarked: 8s, 100% accuracy, $220/mo
    best: 'gpt-5.2-codex',        // Benchmarked: 10s, 100% accuracy, $300/mo
  },
  gemini: {
    fast: 'gemini-2.5-flash-lite',
    best: 'gemini-2.5-pro',
  },
};

const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

// =====================================================
// Provider Detection (Priority: Qwen > Claude > GPT > Gemini)
// =====================================================

interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

function getApiKeyForProvider(provider: AIProvider): string | undefined {
  if (provider === 'qwen') return process.env.QWEN_API_KEY;
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'openai') return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
  return process.env.GEMINI_API_KEY;
}

function inferProviderFromModelName(modelName: string): AIProvider {
  if (modelName.startsWith('qwen') || modelName.startsWith('qwen3')) return 'qwen';
  if (modelName.startsWith('claude')) return 'anthropic';
  if (modelName.startsWith('gemini')) return 'gemini';
  return 'openai';
}

function buildProviderConfig(provider: AIProvider, modelTier: ModelTier, modelName?: string): ProviderConfig {
  const apiKey = getApiKeyForProvider(provider);
  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${provider}`);
  }

  const gatewayUrl = process.env.AI_GATEWAY_URL;
  return {
    provider,
    apiKey,
    model: modelName || MODEL_MAP[provider][modelTier],
    baseUrl: gatewayUrl || DEFAULT_BASE_URLS[provider],
  };
}

function resolveProviderSequence(options: ChatCompletionOptions): {
  providers: AIProvider[];
  taskClass: RoutingTaskClass;
  policyName: RoutingPolicyName;
  budgetConstrained: boolean;
} {
  const { modelTier, modelName, systemPrompt, userPrompt } = options;
  const policy = getRoutingPolicy();
  const taskClass = resolveTaskClass(modelTier as RoutingModelTier);

  if (modelName) {
    const provider = inferProviderFromModelName(modelName);
    if (!getApiKeyForProvider(provider)) {
      throw new Error(`No API key configured for provider: ${provider}`);
    }
    return {
      providers: [provider],
      taskClass,
      policyName: policy.name,
      budgetConstrained: false,
    };
  }

  const fallbackOrder: AIProvider[] = ['qwen', 'anthropic', 'openai', 'gemini'];
  const routingSampleSeed = `${modelTier}:${systemPrompt.slice(0, 24)}:${userPrompt.slice(0, 24)}`;
  const useRoutingOrder = policy.enabled && shouldApplyRoutingSample(routingSampleSeed, policy.abPercent);

  let providerOrder: AIProvider[] = fallbackOrder;
  let policyName: RoutingPolicyName = policy.name;
  let budgetConstrained = false;
  if (useRoutingOrder) {
    const selected = selectProvidersForTask(taskClass, policy);
    providerOrder = selected.providers as AIProvider[];
    policyName = selected.appliedPolicy;
    budgetConstrained = selected.budgetConstrained;
  }

  const configuredProviders = providerOrder.filter((provider) => Boolean(getApiKeyForProvider(provider)));
  if (configuredProviders.length === 0) {
    throw new Error(
      'No AI API key configured. Set QWEN_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.'
    );
  }

  return {
    providers: configuredProviders,
    taskClass,
    policyName,
    budgetConstrained,
  };
}

// =====================================================
// API Callers
// =====================================================

async function callQwen(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Qwen API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    } : undefined,
    provider: 'qwen',
    model: config.model,
  };
}

async function callAnthropic(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userPrompt }],
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  const usage = data.usage;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
    } : undefined,
    provider: 'anthropic',
    model: config.model,
  };
}

async function callOpenAI(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com';

  // Build request body with model-specific handling
  const body: Record<string, any> = {
    model: config.model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    max_tokens: options.maxTokens || 4096,
  };

  // GPT-5.2-pro doesn't support custom temperature, only 1.0
  // GPT-5.2-codex doesn't support temperature parameter at all
  if (config.model === 'gpt-5.2-codex') {
    // Don't include temperature for gpt-5.2-codex
  } else if (config.model === 'gpt-5.2-pro') {
    // gpt-5.2-pro only supports temperature=1
    body.temperature = 1;
  } else {
    // All other models support custom temperature
    body.temperature = options.temperature ?? 0.2;
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    } : undefined,
    provider: 'openai',
    model: config.model,
  };
}

async function callGemini(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  // Gemini API endpoint - use gateway if available
  const isGateway = config.baseUrl !== DEFAULT_BASE_URLS.gemini;

  // Determine endpoint and headers based on whether using gateway or direct API
  const endpoint = isGateway
    ? `${config.baseUrl}/v1/chat/completions`
    : `${config.baseUrl}/v1beta/openai/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Set authorization header based on API endpoint
  if (isGateway) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  } else {
    headers['x-goog-api-key'] = config.apiKey;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    } : undefined,
    provider: 'gemini',
    model: config.model,
  };
}

async function callProvider(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  switch (config.provider) {
    case 'qwen':
      return callQwen(config, options);
    case 'anthropic':
      return callAnthropic(config, options);
    case 'openai':
      return callOpenAI(config, options);
    case 'gemini':
      return callGemini(config, options);
  }
}

// =====================================================
// Main Export
// =====================================================

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const sequence = resolveProviderSequence(options);
  const attemptErrors: string[] = [];
  const requestId = randomUUID();

  for (let attemptIndex = 0; attemptIndex < sequence.providers.length; attemptIndex++) {
    const provider = sequence.providers[attemptIndex];
    const startedAt = Date.now();
    let config: ProviderConfig;
    try {
      config = buildProviderConfig(provider, options.modelTier, options.modelName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      attemptErrors.push(`${provider}: ${message}`);
      continue;
    }

    try {
      const result = await callProvider(config, options);
      recordRoutingDecision({
        requestId,
        attempt: attemptIndex + 1,
        timestamp: new Date().toISOString(),
        taskClass: sequence.taskClass,
        provider: config.provider,
        model: result.model,
        modelTier: options.modelTier as RoutingModelTier,
        policyName: sequence.policyName,
        latencyMs: Date.now() - startedAt,
        success: true,
        budgetConstrained: sequence.budgetConstrained,
        estimatedCostUsd: estimateRequestCost(config.provider, options.modelTier as RoutingModelTier),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      attemptErrors.push(`${provider}: ${message}`);
      recordRoutingDecision({
        requestId,
        attempt: attemptIndex + 1,
        timestamp: new Date().toISOString(),
        taskClass: sequence.taskClass,
        provider: config.provider,
        model: config.model,
        modelTier: options.modelTier as RoutingModelTier,
        policyName: sequence.policyName,
        latencyMs: Date.now() - startedAt,
        success: false,
        error: message,
        budgetConstrained: sequence.budgetConstrained,
      });
    }
  }

  throw new Error(`All AI providers failed: ${attemptErrors.join(' | ')}`);
}

/**
 * Return information about the current configured AI provider
 */
export function getProviderInfo(): { provider: AIProvider; hasGateway: boolean } | null {
  try {
    const sequence = resolveProviderSequence({
      systemPrompt: 'provider info',
      userPrompt: 'provider info',
      modelTier: 'fast',
    });
    const provider = sequence.providers[0];
    if (!provider) return null;
    return {
      provider,
      hasGateway: !!process.env.AI_GATEWAY_URL,
    };
  } catch {
    return null;
  }
}
