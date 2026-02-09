import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Save original env
const originalEnv = { ...process.env };

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import to reset module state between tests
async function importAiClient() {
  // Clear module cache so env vars are re-read
  vi.resetModules();
  return await import('../ai-client');
}

describe('ai-client', () => {
  beforeEach(() => {
    // Clear all env vars
    delete process.env.AI_GATEWAY_URL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    mockFetch.mockReset();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  // ============================================================
  // Provider Detection
  // ============================================================

  describe('provider detection', () => {
    it('should throw when no provider is configured', async () => {
      const { chatCompletion } = await importAiClient();

      await expect(chatCompletion({
        systemPrompt: 'test',
        userPrompt: 'test',
        modelTier: 'fast',
      })).rejects.toThrow('AI 프로바이더가 설정되지 않았습니다');
    });

    it('should use LiteLLM when AI_GATEWAY_URL is set', async () => {
      process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.provider).toBe('litellm');
      expect(result.model).toBe('claude-haiku-4.5');
      expect(result.content).toBe('response');

      // Verify fetch was called with gateway URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-key',
          }),
        }),
      );
    });

    it('should use Anthropic direct when only ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'claude response' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(result.content).toBe('claude response');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'sk-ant-test',
            'anthropic-version': '2023-06-01',
          }),
        }),
      );
    });

    it('should use OpenAI when only OPENAI_API_KEY is set', async () => {
      process.env.OPENAI_API_KEY = 'sk-openai-test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'gpt response' } }],
          usage: { prompt_tokens: 5, completion_tokens: 10 },
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4.1-mini');
      expect(result.content).toBe('gpt response');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-openai-test',
          }),
        }),
      );
    });

    it('should use Gemini when only GEMINI_API_KEY is set', async () => {
      process.env.GEMINI_API_KEY = 'AIza-gemini-test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'gemini response' } }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-2.5-flash-lite');
      expect(result.content).toBe('gemini response');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': 'AIza-gemini-test',
          }),
        }),
      );
    });
  });

  // ============================================================
  // Model Tier Mapping
  // ============================================================

  describe('model tier mapping', () => {
    it('should use best-tier models', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'opus response' }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'best',
      });

      expect(result.model).toBe('claude-opus-4-6');

      // Verify model in request body
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody.model).toBe('claude-opus-4-6');
    });

    it('should map OpenAI best tier to gpt-4.1', async () => {
      process.env.OPENAI_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'best',
      });

      expect(result.model).toBe('gpt-4.1');
    });
  });

  // ============================================================
  // Request Format
  // ============================================================

  describe('request format', () => {
    it('should use separate system field for Anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      await chatCompletion({
        systemPrompt: 'You are helpful',
        userPrompt: 'Hello',
        modelTier: 'fast',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBe('You are helpful');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(body.max_tokens).toBe(4096); // Anthropic requires max_tokens
    });

    it('should use messages array for OpenAI', async () => {
      process.env.OPENAI_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      await chatCompletion({
        systemPrompt: 'You are helpful',
        userPrompt: 'Hello',
        modelTier: 'fast',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBeUndefined();
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should pass maxTokens and temperature', async () => {
      process.env.OPENAI_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'best',
        temperature: 0.3,
        maxTokens: 8192,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(8192);
    });

    it('should pass AbortSignal to fetch', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }),
      });

      const controller = new AbortController();
      const { chatCompletion } = await importAiClient();
      await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
        signal: controller.signal,
      });

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  // ============================================================
  // Error Handling
  // ============================================================

  describe('error handling', () => {
    it('should throw on non-ok response', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => 'rate limited',
      });

      const { chatCompletion } = await importAiClient();

      await expect(chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      })).rejects.toThrow('AI API error 429: Too Many Requests');
    });

    it('should throw when gateway URL set but no API key', async () => {
      process.env.AI_GATEWAY_URL = 'https://gateway.example.com';

      const { chatCompletion } = await importAiClient();

      await expect(chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      })).rejects.toThrow('API 키가 없습니다');
    });
  });

  // ============================================================
  // Usage Tracking
  // ============================================================

  describe('usage tracking', () => {
    it('should return usage from Anthropic response', async () => {
      process.env.ANTHROPIC_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
      });
    });

    it('should return usage from OpenAI response', async () => {
      process.env.OPENAI_API_KEY = 'test';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 80, completion_tokens: 40 },
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.usage).toEqual({
        promptTokens: 80,
        completionTokens: 40,
      });
    });
  });

  // ============================================================
  // LiteLLM Backward Compatibility
  // ============================================================

  describe('LiteLLM backward compatibility', () => {
    it('should prioritize AI_GATEWAY_URL over direct API', async () => {
      process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'should-not-use';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'gateway response' } }],
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.provider).toBe('litellm');
      expect(mockFetch.mock.calls[0][0]).toBe('https://gateway.example.com/v1/chat/completions');
    });

    it('should handle LiteLLM output fallback field', async () => {
      process.env.AI_GATEWAY_URL = 'https://gateway.example.com';
      process.env.ANTHROPIC_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: 'fallback output',
        }),
      });

      const { chatCompletion } = await importAiClient();
      const result = await chatCompletion({
        systemPrompt: 'sys',
        userPrompt: 'user',
        modelTier: 'fast',
      });

      expect(result.content).toBe('fallback output');
    });
  });
});
