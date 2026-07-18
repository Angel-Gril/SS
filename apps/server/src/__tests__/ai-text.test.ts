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
      error: 'AI 服务未启用',
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

  it('returns a localized message when the AI endpoint rejects the request', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    }));

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Generate title' }],
      config: config({
        provider: 'custom',
        providerLabel: 'DeepSeek',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-token',
        model: 'bad-model',
      }),
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: 'AI 请求失败：HTTP 400',
    });
  });

  it('reports a token-budget hint when a reasoning model returns empty final content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            reasoning_content: 'The model spent the whole budget reasoning.',
          },
          finish_reason: 'length',
        }],
      }),
    }));

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Generate title' }],
      config: config({
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-token',
        model: 'deepseek-v4-flash',
      }),
      fetchImpl: fetchMock,
      maxTokens: 120,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'AI 没有返回正文：模型把输出额度用于推理，请增加 max_tokens 或改用非推理聊天模型',
    });
  });
  it('retries once with a larger completion budget when reasoning consumes the first response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '',
              reasoning_content: 'The model spent the whole budget reasoning.',
            },
            finish_reason: 'length',
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Готовое описание' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 },
        }),
      });

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Generate title' }],
      config: config({
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-token',
        model: 'deepseek-v4-flash',
      }),
      fetchImpl: fetchMock,
      maxTokens: 120,
    });

    expect(result).toMatchObject({
      ok: true,
      text: 'Готовое описание',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.max_tokens).toBe(120);
    expect(secondBody.max_tokens).toBeGreaterThan(120);
  });

  it('does not change a frozen request token budget when reasoning retry is disabled', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: '', reasoning_content: 'Reasoning used the frozen budget.' },
          finish_reason: 'length',
        }],
      }),
    }));

    const result = await generateAiText({
      messages: [{ role: 'user', content: 'Generate frozen listing copy' }],
      config: config({
        provider: 'custom', baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret-token', model: 'deepseek-v4-flash',
      }),
      fetchImpl: fetchMock,
      maxTokens: 600,
      allowReasoningRetry: false,
    });

    expect(result).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls as any[])[0]?.[1]?.body)).max_tokens).toBe(600);
  });
});
