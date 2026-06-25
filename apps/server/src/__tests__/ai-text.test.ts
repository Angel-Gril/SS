import { describe, expect, it, vi } from 'vitest';
import { generateAiText, type AiTextConfig } from '../services/ai-text.js';

function config(overrides: Partial<AiTextConfig> = {}): AiTextConfig {
  return {
    provider: 'disabled',
    baseUrl: '',
    apiKey: '',
    model: '',
    providerLabel: '',
    timeoutMs: 1000,
    ...overrides,
  };
}

describe('AI text client', () => {
  it('returns unavailable without making network calls when provider is disabled', async () => {
    const fetchMock = vi.fn();

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Translate Белье' }],
      config: config(),
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      provider: 'disabled',
      error: 'AI provider disabled',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls a custom OpenAI-compatible chat endpoint and preserves usage metadata', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '内衣' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }),
    }));

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Translate Белье' }],
      config: config({
        provider: 'custom',
        providerLabel: 'DeepSeek',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-token',
        model: 'deepseek-chat',
      }),
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      text: '内衣',
      provider: 'custom',
      providerLabel: 'DeepSeek',
      model: 'deepseek-chat',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    });
  });
});
