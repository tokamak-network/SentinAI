/**
 * Unified AI Client (Simplified)
 *
 * Fallback chain: Qwen > Claude > GPT > Gemini
 * Gateway support: Route through proxy when AI_GATEWAY_URL is set
 */

// =====================================================
// Types
// =====================================================

export type ModelTier = 'fast' | 'best';
export type AIProvider = 'qwen' | 'anthropic' | 'openai' | 'gemini';

export interface ChatCompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  modelTier: ModelTier;
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
// Model Mapping
// =====================================================

const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  qwen: {
    fast: 'qwen-turbo-latest',
    best: 'qwen-max-latest',
  },
  anthropic: {
    fast: 'claude-haiku-4-5-20251001',
    best: 'claude-sonnet-4-5-20250929',
  },
  openai: {
    fast: 'gpt-4.1-mini',
    best: 'gpt-4.1',
  },
  gemini: {
    fast: 'gemini-2.5-flash-lite',
    best: 'gemini-2.5-pro',
  },
};

// =====================================================
// Provider Detection (Priority: Qwen > Claude > GPT > Gemini)
// =====================================================

interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  useGateway: boolean;
  gatewayUrl?: string;
}

function detectProvider(modelTier: ModelTier): ProviderConfig {
  const gatewayUrl = process.env.AI_GATEWAY_URL;
  const useGateway = !!gatewayUrl;

  // Priority 1: Qwen (DashScope)
  const qwenKey = process.env.DASHSCOPE_API_KEY;
  if (qwenKey) {
    return {
      provider: 'qwen',
      apiKey: qwenKey,
      model: MODEL_MAP.qwen[modelTier],
      useGateway,
      gatewayUrl,
    };
  }

  // Priority 2: Anthropic (Claude)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: MODEL_MAP.anthropic[modelTier],
      useGateway,
      gatewayUrl,
    };
  }

  // Priority 3: OpenAI (GPT)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: MODEL_MAP.openai[modelTier],
      useGateway,
      gatewayUrl,
    };
  }

  // Priority 4: Gemini
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      model: MODEL_MAP.gemini[modelTier],
      useGateway,
      gatewayUrl,
    };
  }

  throw new Error(
    'No AI API key configured. Set DASHSCOPE_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.'
  );
}

// =====================================================
// API Callers
// =====================================================

async function callQwen(
  config: ProviderConfig,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const baseUrl = config.useGateway && config.gatewayUrl
    ? config.gatewayUrl
    : 'https://dashscope.aliyuncs.com/compatible-mode';

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
  const baseUrl = config.useGateway && config.gatewayUrl
    ? config.gatewayUrl
    : 'https://api.anthropic.com';

  const response = await fetch(`${baseUrl}/v1/messages`, {
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
  const baseUrl = config.useGateway && config.gatewayUrl
    ? config.gatewayUrl
    : 'https://api.openai.com';

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
  const baseUrl = config.useGateway && config.gatewayUrl
    ? config.gatewayUrl
    : 'https://generativelanguage.googleapis.com';

  const response = await fetch(`${baseUrl}/v1beta/openai/chat/completions`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': config.apiKey,
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

// =====================================================
// Main Export
// =====================================================

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = detectProvider(options.modelTier);

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

/**
 * Return information about the current configured AI provider
 */
export function getProviderInfo(): { provider: AIProvider; hasGateway: boolean } | null {
  try {
    const config = detectProvider('fast');
    return {
      provider: config.provider,
      hasGateway: config.useGateway,
    };
  } catch {
    return null;
  }
}
