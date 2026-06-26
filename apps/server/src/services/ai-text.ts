export type AiTextProvider = 'disabled' | 'custom';

export interface AiTextConfig {
  provider: AiTextProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel?: string;
  timeoutMs?: number;
}

export interface AiTextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiTextUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type AiTextResult = {
  ok: true;
  text: string;
  provider: AiTextProvider;
  providerLabel?: string;
  model: string;
  usage: AiTextUsage | null;
  finishReason?: string;
} | {
  ok: false;
  provider: AiTextProvider;
  providerLabel?: string;
  model?: string;
  error: string;
  status?: number;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<any>;
}>;

export interface GenerateAiTextParams {
  messages: AiTextMessage[];
  config: AiTextConfig;
  fetchImpl?: FetchLike;
  temperature?: number;
  maxTokens?: number;
}

function cleanBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeUsage(value: any): AiTextUsage | null {
  if (!value || typeof value !== 'object') return null;
  return {
    promptTokens: Number.isFinite(Number(value.prompt_tokens)) ? Number(value.prompt_tokens) : undefined,
    completionTokens: Number.isFinite(Number(value.completion_tokens)) ? Number(value.completion_tokens) : undefined,
    totalTokens: Number.isFinite(Number(value.total_tokens)) ? Number(value.total_tokens) : undefined,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function reasoningRetryMaxTokens(value: unknown): number | null {
  const current = Math.ceil(Number(value));
  if (!Number.isFinite(current) || current <= 0) return 2400;
  if (current >= 8000) return null;
  return Math.min(8000, Math.max(current * 3, current + 1200, 2400));
}

export async function generateAiText(params: GenerateAiTextParams): Promise<AiTextResult> {
  const config = params.config;
  const provider = config.provider || 'disabled';
  if (provider === 'disabled') {
    return { ok: false, provider: 'disabled', providerLabel: config.providerLabel, model: config.model, error: 'AI provider disabled' };
  }

  const baseUrl = cleanBaseUrl(config.baseUrl);
  if (!baseUrl || !config.apiKey || !config.model) {
    return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, error: 'AI provider config incomplete' };
  }

  const fetchImpl = params.fetchImpl || (globalThis.fetch as unknown as FetchLike);
  if (!fetchImpl) return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, error: 'fetch unavailable' };

  const timeoutMs = Math.max(1000, Number(config.timeoutMs) || 30000);
  const maxTokenAttempts: Array<number | undefined> = [params.maxTokens];

  for (let attempt = 0; attempt < maxTokenAttempts.length; attempt += 1) {
    const maxTokens = maxTokenAttempts[attempt];
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: params.messages,
          temperature: params.temperature ?? 0,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!res.ok) {
        return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, status: res.status, error: `AI request failed: HTTP ${res.status || 'unknown'}` };
      }

      const data = await res.json();
      const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
      const text = String(choice?.message?.content ?? choice?.text ?? '').trim();
      if (!text) {
        const reasoning = String(choice?.message?.reasoning_content || '').trim();
        const finishReason = String(choice?.finish_reason || choice?.finishReason || '').trim();
        const retryMaxTokens = reasoning && finishReason === 'length' && attempt === 0
          ? reasoningRetryMaxTokens(maxTokens)
          : null;
        if (retryMaxTokens && retryMaxTokens !== maxTokens) {
          maxTokenAttempts.push(retryMaxTokens);
          continue;
        }
        const error = reasoning && finishReason === 'length'
          ? 'AI response empty: model used the token budget for reasoning; increase max tokens or use a non-reasoning chat model'
          : 'AI response empty';
        return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, error };
      }

      return {
        ok: true,
        text,
        provider,
        providerLabel: config.providerLabel,
        model: config.model,
        finishReason: choice?.finish_reason,
        usage: normalizeUsage(data?.usage),
      };
    } catch (error) {
      return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, error: errorMessage(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { ok: false, provider, providerLabel: config.providerLabel, model: config.model, error: 'AI response empty' };
}
