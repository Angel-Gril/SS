import { describe, expect, it } from 'vitest';
import { SystemConfigSchema, type getConfig } from '../config/system-config-schema.js';
import { getProductVisionCapability } from '../services/product-vision-runtime-config.js';

describe('product vision deployment configuration', () => {
  it('keeps visual analysis disabled and requires an explicit vision model', () => {
    const schema = SystemConfigSchema as Record<string, { parse(value: unknown): unknown }>;
    expect(schema.feature_extension_product_vision?.parse(undefined)).toBe(false);
    expect(schema.ai_product_vision_model?.parse(undefined)).toBe('');
    expect(schema.ai_user_daily_product_vision_limit?.parse(undefined)).toBe(10);
    expect(schema.ai_product_vision_provider?.parse(undefined)).toBe('disabled');
    expect(schema.ai_product_vision_base_url?.parse(undefined)).toBe('');
    expect(schema.ai_product_vision_api_key?.parse(undefined)).toBe('');
  });
  it('bounds vision model length and atomic daily request allowance', () => {
    const schema = SystemConfigSchema as Record<string, { safeParse(value: unknown): { success: boolean } }>;
    expect(schema.ai_product_vision_model?.safeParse('m'.repeat(201)).success).toBe(false);
    expect(schema.ai_user_daily_product_vision_limit?.safeParse(-1).success).toBe(false);
    expect(schema.ai_user_daily_product_vision_limit?.safeParse(10.5).success).toBe(false);
    expect(schema.ai_user_daily_product_vision_limit?.safeParse(0).success).toBe(true);
  });
  it('never inherits an ordinary text model or admits an unsafe multimodal endpoint', async () => {
    const values: Record<string, unknown> = { feature_extension_product_vision: true, feature_ai_media_workflow_v2: true,
      ai_media_workflow_v2_rollout_policy: JSON.stringify({ revision: 1, mode: 'all', tenantIds: [] }),
      ai_provider: 'custom', ai_base_url: 'https://text.example/v1', ai_api_key: 'text-fixture-key',
      ai_product_vision_provider:'custom',ai_product_vision_base_url:'https://vision.example/v1',ai_product_vision_api_key:'vision-fixture-key',
      ai_model: 'text-only-model', ai_product_vision_model: '', ai_user_daily_product_vision_limit: 10, ai_timeout_ms: 30000 };
    const load = (async (key: string) => values[key]) as typeof getConfig;
    expect((await getProductVisionCapability('owner', load)).available).toBe(false);
    values.ai_product_vision_model = 'vision-fixture';
    expect((await getProductVisionCapability('owner', load)).available).toBe(true);
    for (const endpoint of ['http://vision.example/v1', 'https://127.0.0.1/v1', 'https://localhost/v1',
      'https://user:password@vision.example/v1', 'https://vision.example/v1?token=fixture', 'https://vision.example/v1#fragment']) {
      values.ai_product_vision_base_url = endpoint;
      expect((await getProductVisionCapability('owner', load)).available).toBe(false);
    }
    values.ai_product_vision_base_url = 'https://vision.example/v1';
    values.ai_product_vision_api_key = '';
    expect((await getProductVisionCapability('owner', load)).available).toBe(false);
  });
});
