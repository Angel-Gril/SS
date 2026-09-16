import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiImageSuiteProviderRuntimeSnapshot } from '../services/ai-image-suite-provider-runtime.js';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const snapshot = createAiImageSuiteProviderRuntimeSnapshot({
  provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'synthetic-migration-key', costPerImageCents: 14, currency: 'CNY',
  credentialRevision: { recordId: 'synthetic_migration_record', revision: 2, updatedAt: '2026-09-16T00:00:00.000Z' },
}, { nodeEnv: 'production' });
const operationConfig = {
  version: 'ai-image-suite-child-operation/v2', outputProfile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200,
  slotPromptId: 'prompt-1', promptBindingHash: 'a'.repeat(64), referenceSetHash: 'b'.repeat(64),
  providerRuntime: snapshot.providerRuntime!, providerRequest: { count: 1, width: 1024, height: 1024 },
  finalOutput: { profile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200,
    fit: 'contain', background: '#ffffff', format: 'png', normalizerVersion: 'ai-image-suite-output-normalizer/v1' },
};
const reference = { assetId: 'source-1', role: 'REFERENCE', ordinal: 0, sha256: 'c'.repeat(64) };

describe.skipIf(!enabled)('Wanx suite migration PostgreSQL predicates', () => {
  let database: PrismaClient;
  beforeAll(async () => {
    const url = new URL(databaseUrl);
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') || '')) {
      throw new Error('Wanx migration tests require an isolated ai_media_test_* schema');
    }
    database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await database.$connect();
  });
  afterAll(async () => database?.$disconnect());

  async function permitted(input: {
    operation?: unknown; config?: unknown; cost?: unknown; pricing?: unknown; references?: unknown;
  } = {}) {
    const value = { operation: 'IMAGE_TO_IMAGE', config: operationConfig, cost: 14,
      pricing: snapshot.providerConfig!.pricingVersion, references: [reference], ...input };
    const rows = await database.$queryRawUnsafe<Array<{ allowed: boolean | null }>>(
      'SELECT ai_media_wanx_suite_runtime_valid($1::text, $2::jsonb, $3::integer, $4::text, $5::jsonb) AS allowed',
      value.operation, value.config === null ? null : JSON.stringify(value.config), value.cost,
      value.pricing, value.references === null ? null : JSON.stringify(value.references),
    );
    return rows[0]?.allowed;
  }

  it('admits only the original complete USD v2 runtime and rejects currency, shape, endpoint and identity drift', async () => {
    const usd = createAiImageSuiteProviderRuntimeSnapshot({ provider: 'openai-images', model: 'gpt-image-1',
      baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-usd-key', costPerImageCents: 8, concurrencyLimit: 1 });
    const config = { ...operationConfig, providerRuntime: usd.providerRuntime!, providerRequest: { count: 1, width: 1024, height: 1536 } };
    const valid = { operation: 'IMAGE_TO_IMAGE', config, cost: 8, pricing: usd.providerConfig!.pricingVersion,
      references: [reference], provider: 'openai-images', model: 'gpt-image-1', hash: usd.providerConfig!.providerConfigHash, concurrency: 1 };
    const permittedUsd = async (change: Record<string, unknown> = {}) => {
      const value = { ...valid, ...change };
      const rows = await database.$queryRawUnsafe<Array<{ allowed: boolean }>>(
        'SELECT ai_media_legacy_paid_suite_runtime_valid($1::text,$2::jsonb,$3::integer,$4::text,$5::jsonb,$6::text,$7::text,$8::text,$9::integer) AS allowed',
        value.operation, JSON.stringify(value.config), value.cost, value.pricing, JSON.stringify(value.references),
        value.provider, value.model, value.hash, value.concurrency,
      );
      return rows[0]?.allowed;
    };
    expect(await permittedUsd()).toBe(true);
    for (const change of [
      { provider: 'dashscope-wanx' }, { provider: 'arbitrary-provider' }, { model: 'another-model' },
      { pricing: snapshot.providerConfig!.pricingVersion }, { pricing: `ai-image-suite-price/v1:${'0'.repeat(32)}` },
      { hash: '0'.repeat(64) }, { concurrency: 2 }, { cost: 9 },
      { config: { ...config, providerRuntime: { ...usd.providerRuntime, currency: 'CNY' } } },
      { config: { ...config, providerRuntime: { ...usd.providerRuntime, baseUrlSha256: '0'.repeat(64) } } },
      { config: { ...config, providerRequest: { count: 1, width: 1024, height: 1024 } } },
      { config: { ...config, finalOutput: { ...operationConfig.finalOutput, fit: 'cover' } } },
      { references: [] }, { references: [{ ...reference, role: 'MASK' }] },
      { references: Array.from({ length: 17 }, (_, ordinal) => ({ ...reference, ordinal })) },
    ]) expect(await permittedUsd(change)).toBe(false);
  });

  it('accepts the actual CNY runtime builder with one reference and the frozen output profiles', async () => {
    expect(snapshot.executionReady).toBe(true);
    expect(await permitted()).toBe(true);
  });

  it.each(['operation', 'config', 'cost', 'pricing', 'references'] as const)('returns explicit false for NULL %s', async field => {
    expect(await permitted({ [field]: null })).toBe(false);
  });

  it.each([
    { label: 'different operation', change: { operation: 'FULL_EDIT' } },
    { label: 'zero price', change: { cost: 0 } },
    { label: 'different frozen price', change: { cost: 15 } },
    { label: 'USD price prefix', change: { pricing: `ai-image-suite-price/v1:${'a'.repeat(32)}` } },
    { label: 'forged CNY price hash', change: { pricing: `ai-image-suite-price-cny/v1:${'a'.repeat(32)}` } },
    { label: 'two references', change: { references: [reference, { ...reference, assetId: 'other', ordinal: 1 }] } },
    { label: 'no reference', change: { references: [] } },
    { label: 'mask input', change: { references: [{ ...reference, role: 'MASK' }] } },
    { label: 'string ordinal', change: { references: [{ ...reference, ordinal: '0' }] } },
  ])('rejects $label', async ({ change }) => { expect(await permitted(change)).toBe(false); });

  it.each([
    ['contractVersion', 'ai-image-provider-runtime/v2'], ['provider', 'openai-images'], ['model', 'other-model'],
    ['baseUrlSha256', '0'.repeat(64)], ['currency', 'USD'], ['currency', null],
    ['imageCount', 2], ['imageCount', '1'], ['width', 512], ['height', 1536],
    ['unitCostCents', 0], ['unitCostCents', '14'], ['maximumCostCents', 15],
    ['credentialRevision', null],
  ])('rejects a mismatched runtime %s=%j', async (field, value) => {
    const config = structuredClone(operationConfig);
    (config.providerRuntime as unknown as Record<string, unknown>)[field as string] = value;
    expect(await permitted({ config })).toBe(false);
  });

  it.each([
    { recordId: '' }, { recordId: 'invalid.record' }, { revision: -1 }, { revision: '2' },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { updatedAt: '2026-09-16T00:00:00Z' },
    { updatedAt: '2026-02-30T00:00:00.000Z' }, { extra: true },
  ])('rejects a malformed credential revision %j', async change => {
    const config = structuredClone(operationConfig);
    Object.assign(config.providerRuntime.credentialRevision!, change);
    expect(await permitted({ config })).toBe(false);
  });

  it.each([
    { providerRequest: { count: 1, width: 1024, height: 1536 } },
    { providerRequest: { count: '1', width: 1024, height: 1024 } },
    { finalOutput: { ...operationConfig.finalOutput, width: 1024 } },
    { finalOutput: { ...operationConfig.finalOutput, fit: 'cover' } },
    { outputProfile: 'unregistered' }, { version: 'ai-image-suite-child-operation/v1' },
  ])('rejects a wrong request/output contract %j', async change => {
    expect(await permitted({ config: { ...operationConfig, ...change } })).toBe(false);
  });

  async function promptValuesAllowed(change: Record<string, unknown>) {
    const definition = await database.$queryRawUnsafe<Array<{ expression: string }>>(
      `SELECT pg_get_expr(conbin, conrelid) AS expression FROM pg_constraint
       WHERE conrelid = 'ai_media_suite_slot_prompts'::regclass AND conname = 'ai_media_suite_slot_prompt_values_check'`,
    );
    expect(definition).toHaveLength(1);
    const fields = { ordinal: 0, slot_key: 'hero', version: 'ai-image-suite-slot-prompt/v1',
      slot_hash: 'a'.repeat(64), references_hash: 'a'.repeat(64), reference_set_hash: 'a'.repeat(64), template_sequence: 1,
      template_checksum: 'a'.repeat(64), template_snapshot_hash: 'a'.repeat(64), variables_hash: 'a'.repeat(64),
      policy_hash: 'a'.repeat(64), resolved_prompt_hash: 'a'.repeat(64), resolved_negative_prompt_hash: 'a'.repeat(64),
      compiled_prompt_hash: 'a'.repeat(64), binding_hash: 'a'.repeat(64),
      resolved_prompt: '保留商品。', resolved_negative_prompt: '',
      template_key: 'ai_media_suite_generation_wanx', compiler_version: 'ai-image-suite-prompt-compiler-wanx/v1', ...change };
    const entries = Object.entries(fields);
    const projection = entries.map(([key, value], index) => `$${index + 1}::${typeof value === 'number' ? 'integer' : 'text'} AS "${key}"`).join(', ');
    const result = await database.$queryRawUnsafe<Array<{ allowed: boolean }>>(
      `SELECT (${definition[0]!.expression}) AS allowed FROM (SELECT ${projection}) candidate`, ...entries.map(([, value]) => value),
    );
    return result[0]?.allowed;
  }

  it('permits only the paired Wanx compiler/template to merge the negative prompt', async () => {
    expect(await promptValuesAllowed({})).toBe(true);
    expect(await promptValuesAllowed({ resolved_prompt: '🫖'.repeat(800) })).toBe(true);
    expect(await promptValuesAllowed({ resolved_prompt: '🫖'.repeat(801) })).toBe(false);
    expect(await promptValuesAllowed({ resolved_negative_prompt: 'not merged' })).toBe(false);
  });

  it.each([
    { template_key: 'image-suite-generation.base' },
    { compiler_version: 'ai-image-suite-prompt-compiler/v1' },
    { template_key: 'image-suite-generation.base', compiler_version: 'ai-image-suite-prompt-compiler/v1' },
  ])('rejects an empty negative prompt with unpaired or legacy identity %j', async change => {
    expect(await promptValuesAllowed(change)).toBe(false);
  });

  it('retains the original legacy nonempty prompt and hash constraints', async () => {
    const legacy = { template_key: 'image-suite-generation.base', compiler_version: 'ai-image-suite-prompt-compiler/v1', resolved_negative_prompt: 'Keep identity' };
    expect(await promptValuesAllowed(legacy)).toBe(true);
    expect(await promptValuesAllowed({ ...legacy, slot_hash: 'invalid' })).toBe(false);
  });
});
