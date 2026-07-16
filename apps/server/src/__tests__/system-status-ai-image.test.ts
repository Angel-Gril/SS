import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  savedConfig: new Map<string, string>(),
  testConnection: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: async () => undefined,
  requireSuperAdmin: async () => undefined,
}));

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: vi.fn(async (key: string) => mocks.savedConfig.get(key) || ''),
}));

vi.mock('../services/ai-image-providers.js', () => ({
  testAiImageProviderConnection: mocks.testConnection,
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
});
