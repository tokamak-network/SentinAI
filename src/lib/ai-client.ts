/**
 * Unified AI Client
 *
 * Supports direct API calls to multiple providers:
 * - Anthropic (Claude) via /v1/messages
 * - OpenAI (GPT) via /v1/chat/completions
 * - Google Gemini via /v1beta/openai/chat/completions
 * - LiteLLM Gateway via /v1/chat/completions (backward compatible)
 *
 * Provider detection priority:
 * 1. AI_GATEWAY_URL explicitly set → LiteLLM Gateway
 * 2. ANTHROPIC_API_KEY → Anthropic Direct
 * 3. OPENAI_API_KEY → OpenAI Direct
 * 4. GEMINI_API_KEY → Gemini Direct
 */

// ============================================================
// Types
// ============================================================

export type ModelTier = 'fast' | 'best';
export type AIProvider = 'anthropic' | 'openai' | 'gemini' | 'litellm';

export interface ChatCompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  modelTier: ModelTier;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  moduleName?: string;
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

// ============================================================
// Model Tier Mapping
// ============================================================

const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  anthropic: { fast: 'claude-haiku-4-5-20251001', best: 'claude-opus-4-6' },
  openai: { fast: 'gpt-4.1-mini', best: 'gpt-4.1' },
  gemini: { fast: 'gemini-2.5-flash-lite', best: 'gemini-2.5-pro' },
  litellm: { fast: 'claude-haiku-4.5', best: 'claude-opus-4-6' },
};

// ============================================================
// Provider Detection
// ============================================================

interface ProviderConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function detectProvider(modelTier: ModelTier, moduleName?: string): ProviderConfig {
  // Priority 0: 모듈별 제공자 오버라이드 (하이브리드 전략)
  if (moduleName) {
    const moduleOverrideKey = `${moduleName}_PROVIDER`;
    const preferredProviderName = process.env[moduleOverrideKey];
    if (preferredProviderName) {
      return getProviderConfigByName(preferredProviderName, modelTier);
    }
  }

  // Priority 1: AI_GATEWAY_URL explicitly set → LiteLLM
  const gatewayUrl = process.env.AI_GATEWAY_URL;
  if (gatewayUrl) {
    const apiKey = process.env.ANTHROPIC_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.GEMINI_API_KEY
      || '';
    if (!apiKey) {
      throw new Error('AI_GATEWAY_URL이 설정되었으나 API 키가 없습니다. ANTHROPIC_API_KEY, OPENAI_API_KEY, 또는 GEMINI_API_KEY를 설정하세요.');
    }
    return {
      provider: 'litellm',
      apiKey,
      baseUrl: gatewayUrl,
      model: MODEL_MAP.litellm[modelTier],
    };
  }

  // Priority 2: Anthropic Direct
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      baseUrl: 'https://api.anthropic.com',
      model: MODEL_MAP.anthropic[modelTier],
    };
  }

  // Priority 3: OpenAI Direct
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      baseUrl: 'https://api.openai.com',
      model: MODEL_MAP.openai[modelTier],
    };
  }

  // Priority 4: Gemini Direct
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    return {
      provider: 'gemini',
      apiKey: geminiKey,
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: MODEL_MAP.gemini[modelTier],
    };
  }

  throw new Error(
    'AI 프로바이더가 설정되지 않았습니다. AI_GATEWAY_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY, 또는 GEMINI_API_KEY 중 하나를 설정하세요.'
  );
}

/**
 * 제공자 이름으로 설정 조회 (모듈별 오버라이드용)
 */
function getProviderConfigByName(providerName: string, modelTier: ModelTier): ProviderConfig {
  const name = providerName.toLowerCase().trim();

  if (name === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
    return {
      provider: 'anthropic',
      apiKey,
      baseUrl: 'https://api.anthropic.com',
      model: MODEL_MAP.anthropic[modelTier],
    };
  }

  if (name === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
    return {
      provider: 'openai',
      apiKey,
      baseUrl: 'https://api.openai.com',
      model: MODEL_MAP.openai[modelTier],
    };
  }

  if (name === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    return {
      provider: 'gemini',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: MODEL_MAP.gemini[modelTier],
    };
  }

  if (name === 'litellm') {
    const apiKey = process.env.ANTHROPIC_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('LiteLLM 사용 시 API 키가 필요합니다.');
    const gatewayUrl = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
    return {
      provider: 'litellm',
      apiKey,
      baseUrl: gatewayUrl,
      model: MODEL_MAP.litellm[modelTier],
    };
  }

  throw new Error(`알 수 없는 AI 제공자: ${providerName}. anthropic, openai, gemini, litellm 중 하나를 사용하세요.`);
}

// ============================================================
// Request Builders
// ============================================================

interface RequestConfig {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function buildAnthropicRequest(config: ProviderConfig, options: ChatCompletionOptions): RequestConfig {
  return {
    url: `${config.baseUrl}/v1/messages`,
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: {
      model: config.model,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userPrompt }],
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
    },
  };
}

function buildOpenAICompatibleRequest(
  config: ProviderConfig,
  options: ChatCompletionOptions,
  endpoint: string,
  authHeader: Record<string, string>,
): RequestConfig {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    temperature: options.temperature ?? 0.2,
  };
  if (options.maxTokens) {
    body.max_tokens = options.maxTokens;
  }

  return {
    url: `${config.baseUrl}${endpoint}`,
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body,
  };
}

function buildRequest(config: ProviderConfig, options: ChatCompletionOptions): RequestConfig {
  switch (config.provider) {
    case 'anthropic':
      return buildAnthropicRequest(config, options);
    case 'openai':
      return buildOpenAICompatibleRequest(
        config, options,
        '/v1/chat/completions',
        { 'Authorization': `Bearer ${config.apiKey}` },
      );
    case 'gemini':
      return buildOpenAICompatibleRequest(
        config, options,
        '/v1beta/openai/chat/completions',
        { 'x-goog-api-key': config.apiKey },
      );
    case 'litellm':
      return buildOpenAICompatibleRequest(
        config, options,
        '/v1/chat/completions',
        { 'Authorization': `Bearer ${config.apiKey}` },
      );
  }
}

// ============================================================
// Response Parsers
// ============================================================

type ParsedResponse = { content: string; usage?: ChatCompletionResult['usage'] };

function parseAnthropicResponse(data: Record<string, unknown>): ParsedResponse {
  const contentArr = data.content as Array<{ type?: string; text?: string }> | undefined;
  const content = contentArr?.[0]?.text || '';
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
    } : undefined,
  };
}

function parseOpenAICompatibleResponse(data: Record<string, unknown>): ParsedResponse {
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.message?.content
    || (data.output as string)  // LiteLLM fallback
    || '';
  const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

  return {
    content,
    usage: usage ? {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    } : undefined,
  };
}

function parseResponse(provider: AIProvider, data: Record<string, unknown>): ParsedResponse {
  if (provider === 'anthropic') {
    return parseAnthropicResponse(data);
  }
  return parseOpenAICompatibleResponse(data);
}

// ============================================================
// Main Export
// ============================================================

export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = detectProvider(options.modelTier, options.moduleName);
  const request = buildRequest(config, options);

  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `AI API error ${response.status}: ${response.statusText}${errorBody ? ` — ${errorBody}` : ''}`
    );
  }

  const data = await response.json() as Record<string, unknown>;
  const parsed = parseResponse(config.provider, data);

  return {
    content: parsed.content,
    usage: parsed.usage,
    provider: config.provider,
    model: config.model,
  };
}
