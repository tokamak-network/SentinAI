/**
 * Model Configuration for Benchmarking
 * Qwen vs GPT Comparison
 */

import type { AIProvider, ModelTier } from '@/lib/ai-client';

/**
 * Model definition for benchmarking
 */
export interface ModelDef {
  id: string;
  provider: AIProvider;
  modelName: string;
  tier: ModelTier;
  description: string;
  // Pricing (per 1M tokens)
  pricing: {
    inputCost: number;
    outputCost: number;
  };
}

/**
 * Pricing per 1M tokens (LiteLLM Gateway rates, 2026-02)
 * Note: Prices vary by region and may change. These are estimates.
 */
export const MODEL_PRICING: Record<string, { inputCost: number; outputCost: number }> = {
  // Qwen Models (2026-02 pricing)
  'qwen-turbo-latest': { inputCost: 0.50, outputCost: 0.50 },
  'qwen-max-latest': { inputCost: 2.00, outputCost: 2.00 },
  'qwen3-coder-flash': { inputCost: 0.50, outputCost: 0.50 },
  'qwen3-235b': { inputCost: 5.00, outputCost: 5.00 },
  'qwen3-235b-thinking': { inputCost: 8.00, outputCost: 12.00 },
  'qwen3-80b-next': { inputCost: 2.50, outputCost: 5.00 },
  'qwen-long': { inputCost: 1.00, outputCost: 1.00 },

  // GPT Models (via LiteLLM Gateway) - GPT-5.2 Series
  'gpt-5.2': { inputCost: 15.00, outputCost: 45.00 },
  'gpt-5.2-pro': { inputCost: 20.00, outputCost: 60.00 },
  'gpt-5.2-codex': { inputCost: 25.00, outputCost: 75.00 },

  // Legacy models (if needed)
  'gpt-4-turbo': { inputCost: 10.00, outputCost: 30.00 },
  'gpt-4o': { inputCost: 5.00, outputCost: 15.00 },
  'gpt-4o-mini': { inputCost: 0.15, outputCost: 0.60 },

  // Claude Models
  'claude-haiku-4-5-20251001': { inputCost: 0.80, outputCost: 0.15 },
  'claude-sonnet-4-5-20250929': { inputCost: 3.00, outputCost: 15.00 },

  // Gemini Models (新增)
  'gemini-3-flash': { inputCost: 0.075, outputCost: 0.30 },
  'gemini-3-pro': { inputCost: 1.50, outputCost: 6.00 },
  'gemini-2.5-flash-lite': { inputCost: 0.075, outputCost: 0.30 },
  'gemini-2.5-pro': { inputCost: 1.50, outputCost: 6.00 },
};

/**
 * Test Models: Qwen + Gemini + GPT (All via LiteLLM Gateway)
 * Testing multiple AI providers through unified gateway
 */
export const TEST_MODELS_QWEN_VS_GPT: ModelDef[] = [
  // ============ Qwen Models (Fast Tier) ============
  {
    id: 'qwen3-coder-flash',
    provider: 'qwen',
    modelName: 'qwen3-coder-flash',
    tier: 'fast',
    description: 'Qwen3 Coder Flash: Code specialist',
    pricing: MODEL_PRICING['qwen3-coder-flash'],
  },

  // ============ Gemini Models (New) ============
  {
    id: 'gemini-3-flash',
    provider: 'gemini',
    modelName: 'gemini-3-flash',
    tier: 'fast',
    description: 'Gemini 3 Flash: Fast multimodal model',
    pricing: MODEL_PRICING['gemini-3-flash'],
  },
  {
    id: 'gemini-3-pro',
    provider: 'gemini',
    modelName: 'gemini-3-pro',
    tier: 'best',
    description: 'Gemini 3 Pro: Advanced reasoning',
    pricing: MODEL_PRICING['gemini-3-pro'],
  },

  // ============ GPT-5.2 Models (via Gateway) ============
  {
    id: 'gpt-5.2',
    provider: 'openai',
    modelName: 'gpt-5.2',
    tier: 'fast',
    description: 'GPT-5.2: Fast baseline model',
    pricing: MODEL_PRICING['gpt-5.2'],
  },
  {
    id: 'gpt-5.2-pro',
    provider: 'openai',
    modelName: 'gpt-5.2-pro',
    tier: 'best',
    description: 'GPT-5.2 Pro: Professional model with enhanced reasoning',
    pricing: MODEL_PRICING['gpt-5.2-pro'],
  },
  {
    id: 'gpt-5.2-codex',
    provider: 'openai',
    modelName: 'gpt-5.2-codex',
    tier: 'best',
    description: 'GPT-5.2 Codex: Code specialist variant',
    pricing: MODEL_PRICING['gpt-5.2-codex'],
  },

  // ============ Qwen Models (Best Tier) ============
  {
    id: 'qwen3-235b',
    provider: 'qwen',
    modelName: 'qwen3-235b',
    tier: 'best',
    description: 'Qwen3 235B: Large scale model',
    pricing: MODEL_PRICING['qwen3-235b'],
  },
  {
    id: 'qwen3-80b-next',
    provider: 'qwen',
    modelName: 'qwen3-80b-next',
    tier: 'best',
    description: 'Qwen3 80B Next: Next-gen 80B model',
    pricing: MODEL_PRICING['qwen3-80b-next'],
  },
];

/**
 * Preset configurations for benchmarking
 */
export const BENCHMARK_PRESETS = {
  // Quick test (minimal cost) - All Providers Fast Models
  'quick': {
    models: [
      'qwen3-coder-flash',
      'gpt-5.2',
    ],
    iterations: 1,
    description: 'Quick test: Fast models (Qwen/GPT-5.2) × 1 iteration (~5 min)',
  },

  // Standard test (recommended) - All Providers with GPT-5.2
  'standard': {
    models: [
      'qwen3-coder-flash',
      'gpt-5.2',
      'qwen3-235b',
      'gpt-5.2-pro',
      'qwen3-80b-next',
      'gpt-5.2-codex',
    ],
    iterations: 1,
    description: 'Standard: Qwen & GPT-5.2 comparison × 1 iteration (~15 min)',
  },

  // Comprehensive test - All Models (Qwen + GPT + Gemini)
  'comprehensive': {
    models: [
      'qwen3-coder-flash',
      'qwen3-235b',
      'qwen3-80b-next',
      'gpt-5.2',
      'gpt-5.2-pro',
      'gpt-5.2-codex',
      'gemini-3-flash',
      'gemini-3-pro',
    ],
    iterations: 1,
    description: 'Comprehensive: All models (Qwen/GPT/Gemini) × 1 iteration (~30 min)',
  },

  // Cost-focused test - Qwen Only (Cheapest)
  'cost-focused': {
    models: [
      'qwen3-coder-flash',
      'qwen3-235b',
    ],
    iterations: 1,
    description: 'Cost-focused: Qwen models only (~3 min, lowest cost)',
  },

  // Quality-focused test - GPT-5.2 Series
  'quality-focused': {
    models: [
      'gpt-5.2',
      'gpt-5.2-pro',
      'gpt-5.2-codex',
    ],
    iterations: 2,
    description: 'Quality-focused: GPT-5.2 series × 2 iterations (~20 min)',
  },

  // Qwen vs GPT-5.2 comparison (latest)
  'provider-comparison': {
    models: [
      'qwen3-coder-flash',
      'gpt-5.2',
      'qwen3-235b',
      'gpt-5.2-pro',
      'qwen3-80b-next',
      'gpt-5.2-codex',
    ],
    iterations: 1,
    description: 'Provider Comparison: Qwen vs GPT-5.2 across tiers × 1 iteration (~15 min)',
  },
};

/**
 * Get model configuration by ID
 */
export function getModel(modelId: string): ModelDef | undefined {
  return TEST_MODELS_QWEN_VS_GPT.find(m => m.id === modelId);
}

/**
 * Get all model IDs
 */
export function getAllModelIds(): string[] {
  return TEST_MODELS_QWEN_VS_GPT.map(m => m.id);
}

/**
 * Get models for a preset
 */
export function getPresetModels(
  preset: keyof typeof BENCHMARK_PRESETS
): ModelDef[] {
  const config = BENCHMARK_PRESETS[preset];
  return config.models
    .map(id => getModel(id))
    .filter((m): m is ModelDef => !!m);
}

/**
 * Format model name for display
 */
export function formatModelName(model: ModelDef): string {
  return `${model.id} (${model.modelName})`;
}
