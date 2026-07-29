import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  savedConfig: new Map<string, string>(),
  testConnection: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = { tokenUse: request.headers['x-token-use'] || 'account_session' };
  },
  requireSuperAdmin: async () => undefined,
}));

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: vi.fn(async (key: string) => mocks.savedConfig.get(key) || ''),
}));

vi.mock('../services/ai-image-providers.js', () => ({
  testAiImageProviderConnection: mocks.testConnection,
  aiImageCredentialEndpointIdentity: (provider: string, baseUrl: string) => {
    if (provider === 'openai-images' || provider === 'custom') {
      const raw = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const normalized = /\/v1$/iu.test(raw) ? raw : `${raw}/v1`;
      return `openai-compatible:${normalized}`;
    }
    return provider === 'dashscope-wanx'
      ? `dashscope:${String(baseUrl).replace(/\/+$/, '')}`
      : null;
  },
}));

import { systemStatusRoutes } from '../routes/system-status.js';

async function createApp() {
  const app = Fastify();
  await app.register(systemStatusRoutes);
  return app;
}

describe('system status AI image connection test', () => {
  beforeEach(() => {
    mocks.savedConfig.clear();
    mocks.testConnection.mockReset();
    mocks.testConnection.mockResolvedValue({
      ok: true,
      provider: 'custom',
      detail: 'Connection succeeded',
    });
  });

  it('tests the submitted unsaved provider configuration instead of the saved SystemConfig values', async () => {
    mocks.savedConfig.set('ai_image_generation_enabled', 'false');
    mocks.savedConfig.set('ai_image_provider', 'disabled');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      payload: {
        provider: 'custom',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-unsaved-provider-key',
        model: 'image-model-v2',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.testConnection).toHaveBeenCalledWith({
      provider: 'custom',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-unsaved-provider-key',
      model: 'image-model-v2',
    });
    expect(response.body).not.toContain('sk-unsaved-provider-key');
  });

  it('does not report a successful provider test when the submitted provider is disabled', async () => {
    mocks.savedConfig.set('ai_image_generation_enabled', 'true');
    mocks.savedConfig.set('ai_image_provider', 'openai');
    mocks.savedConfig.set('ai_image_api_key', 'saved-key');
    mocks.savedConfig.set('ai_image_model', 'saved-model');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      payload: {
        provider: 'disabled',
        baseUrl: '',
        apiKey: '',
        model: '',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });

  it('uses the saved secret when the form submits its partial mask', async () => {
    mocks.savedConfig.set('ai_image_provider', 'openai-images');
    mocks.savedConfig.set('ai_image_base_url', 'https://api.openai.com/v1');
    mocks.savedConfig.set('ai_image_api_key', 'sk-saved-provider-key');
    mocks.savedConfig.set('ai_image_model', 'gpt-image-1');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      payload: {
        provider: 'openai-images',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-s***-key',
        model: 'gpt-image-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-saved-provider-key',
    }));
    expect(response.body).not.toContain('sk-saved-provider-key');
  });

  it.each([
    ['saved bare origin', 'https://images.example.test', 'https://images.example.test/v1'],
    ['submitted bare origin', 'https://images.example.test/v1', 'https://images.example.test'],
  ])('reuses the saved secret across canonical-equivalent endpoints: %s', async (
    _label,
    savedBaseUrl,
    submittedBaseUrl,
  ) => {
    mocks.savedConfig.set('ai_image_provider', 'custom');
    mocks.savedConfig.set('ai_image_base_url', savedBaseUrl);
    mocks.savedConfig.set('ai_image_api_key', 'sk-saved-provider-key');
    mocks.savedConfig.set('ai_image_model', 'image-model-v2');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      payload: {
        provider: 'custom',
        baseUrl: submittedBaseUrl,
        apiKey: '',
        model: 'image-model-v2',
      },
    });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: submittedBaseUrl,
      apiKey: 'sk-saved-provider-key',
    }));
  });

  it.each(['', 'sk-s***-key'])(
    'never forwards the saved secret to a newly submitted endpoint for placeholder %j',
    async (apiKey) => {
      mocks.savedConfig.set('ai_image_provider', 'custom');
      mocks.savedConfig.set('ai_image_base_url', 'https://saved-relay.example/v1');
      mocks.savedConfig.set('ai_image_api_key', 'sk-saved-provider-key');
      mocks.savedConfig.set('ai_image_model', 'image-model-v2');
      const app = await createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/test/ai-image',
        payload: {
          provider: 'custom',
          baseUrl: 'https://new-relay.example/v1',
          apiKey,
          model: 'image-model-v2',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 0 });
      expect(response.body).toContain('Base URL');
      expect(response.body).not.toContain('sk-saved-provider-key');
      expect(mocks.testConnection).not.toHaveBeenCalled();
    },
  );

  it('reuses the saved secret when only the compatible Provider label is corrected', async () => {
    mocks.savedConfig.set('ai_image_provider', 'openai-images');
    mocks.savedConfig.set('ai_image_base_url', 'https://images.example.test/v1');
    mocks.savedConfig.set('ai_image_api_key', 'sk-saved-provider-key');
    mocks.savedConfig.set('ai_image_model', 'image-model-v2');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      payload: {
        provider: 'custom',
        baseUrl: 'https://images.example.test/v1',
        apiKey: '',
        model: 'image-model-v2',
      },
    });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'custom',
      apiKey: 'sk-saved-provider-key',
    }));
  });

  it('rejects legacy extension tokens before loading or forwarding saved credentials', async () => {
    mocks.savedConfig.set('ai_image_provider', 'custom');
    mocks.savedConfig.set('ai_image_base_url', 'https://images.example.test/v1');
    mocks.savedConfig.set('ai_image_api_key', 'sk-saved-provider-key');
    mocks.savedConfig.set('ai_image_model', 'image-model-v2');
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/test/ai-image',
      headers: { 'x-token-use': 'legacy_extension' },
      payload: { baseUrl: 'https://attacker.example.test/v1' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      errorCode: 'system_status_account_session_required',
    });
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });
});
