import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setConfig } from '../config/system-config-schema.js';
import * as operationRuntime from '../services/ai-image-operation-runtime-config.js';
import { getAiImageSuiteProviderRuntimeConfig } from '../services/ai-image-suite-runtime-config.js';
import {
  assertAiImageProviderRuntimeContract,
  createAiImageProviderRuntimeContract,
} from '../services/ai-image-provider-runtime-contract.js';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { systemConfig: db } }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

const changedAt = new Date('2026-10-08T01:00:00.000Z');
const globalValues = {
  ai_image_provider: 'dashscope-wanx',
  ai_image_model: 'wanx2.1-imageedit',
  ai_image_base_url: 'https://dashscope.aliyuncs.com/api/v1',
  ai_image_api_key: 'synthetic-global-key-sentinel',
  ai_image_generation_cost_cents: '14',
};
const suiteValues = {
  ai_image_suite_provider: 'custom',
  ai_image_suite_model: 'gpt-image-2-count',
  ai_image_suite_base_url: 'https://ai.big-model-api.top/v1',
  ai_image_suite_api_key: 'synthetic-suite-key-sentinel',
  ai_image_suite_cost_cents: '10',
  ai_image_suite_currency: 'CNY',
};

type ConfigRow = {
  key: string;
  value: string;
  id: string;
  revision: number;
  updatedAt: Date;
};

let current: ConfigRow[];
let beforeRead: (read: number) => void;

function install(values: Record<string, string>) {
  current = Object.entries(values).map(([key, value]) => ({
    key, value, id: `record-${key}`, revision: 3, updatedAt: changedAt,
  }));
}

function change(key: string, value: string) {
  const row = current.find((item) => item.key === key)!;
  row.value = value;
  row.revision += 1;
}

function requestedKeys() {
  return db.findMany.mock.calls.map(([input]) => input.where.key.in as string[]);
}

describe('hosted suite configuration owner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    install({ ...globalValues, ...suiteValues });
    beforeRead = () => {};
    let reads = 0;
    db.findMany.mockImplementation(async ({ where }) => {
      beforeRead(++reads);
      return current.filter((row) => where.key.in.includes(row.key)).map((row) => ({ ...row }));
    });
    db.findUnique.mockImplementation(async ({ where }) => current.find((row) => row.key === where.key));
    db.upsert.mockImplementation(async ({ where, update }) => {
      const row = current.find((item) => item.key === where.key)!;
      row.value = update.value;
      row.revision += update.revision?.increment || 0;
      return { ...row };
    });
  });

  it('defaults to the existing IMAGE_TO_IMAGE owner when no dedicated mode exists', async () => {
    install(globalValues);
    const inherited = vi.spyOn(operationRuntime, 'getAiImageOperationProviderRuntimeConfig');
    expect(await getAiImageSuiteProviderRuntimeConfig()).toEqual({
      provider: globalValues.ai_image_provider,
      model: globalValues.ai_image_model,
      baseUrl: globalValues.ai_image_base_url,
      apiKey: globalValues.ai_image_api_key,
      costPerImageCents: 14,
      currency: 'CNY',
      credentialRevision: {
        recordId: 'record-ai_image_api_key', revision: 3, updatedAt: changedAt.toISOString(),
      },
    });
    expect(inherited).toHaveBeenCalledExactlyOnceWith('IMAGE_TO_IMAGE');
    expect(db.findMany).toHaveBeenCalledTimes(3);
    expect(db.findUnique).not.toHaveBeenCalled();
  });

  it('reads the dedicated count identity, CNY 10 minor units and credential revision from one family snapshot', async () => {
    const inherited = vi.spyOn(operationRuntime, 'getAiImageOperationProviderRuntimeConfig');
    const config = await getAiImageSuiteProviderRuntimeConfig();
    expect(config).toEqual({
      provider: 'custom',
      model: 'gpt-image-2-count',
      baseUrl: suiteValues.ai_image_suite_base_url,
      apiKey: suiteValues.ai_image_suite_api_key,
      costPerImageCents: 10,
      currency: 'CNY',
      credentialRevision: {
        recordId: 'record-ai_image_suite_api_key', revision: 3, updatedAt: changedAt.toISOString(),
      },
    });
    expect(db.findMany).toHaveBeenCalledTimes(2);
    expect(requestedKeys()).toEqual([
      ['ai_image_suite_provider'],
      expect.arrayContaining(Object.keys(suiteValues)),
    ]);
    expect(requestedKeys()[1]).toHaveLength(Object.keys(suiteValues).length);
    expect(inherited).not.toHaveBeenCalled();
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(JSON.stringify(config.credentialRevision)).not.toContain(suiteValues.ai_image_suite_api_key);
    expect(JSON.stringify(config.credentialRevision)).not.toContain(globalValues.ai_image_api_key);
  });

  it('preserves ordinary edit configuration when a dedicated suite is selected', async () => {
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ model: 'gpt-image-2-count', currency: 'CNY', costPerImageCents: 10 });
    expect(await operationRuntime.getAiImageOperationProviderRuntimeConfig('IMAGE_TO_IMAGE')).toMatchObject({
      model: 'wanx2.1-imageedit', apiKey: globalValues.ai_image_api_key, costPerImageCents: 14, currency: 'CNY',
    });
  });

  it.each(['', '   '])('rejects an empty dedicated key without borrowing the global key: %j', async (value) => {
    change('ai_image_suite_api_key', value);
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(requestedKeys().flat()).not.toContain('ai_image_api_key');
  });

  it('does not adopt global model, endpoint or price when dedicated fields are empty', async () => {
    change('ai_image_suite_model', '');
    change('ai_image_suite_base_url', '');
    change('ai_image_suite_cost_cents', '0');
    const config = await getAiImageSuiteProviderRuntimeConfig();
    expect(config).toMatchObject({ provider: 'custom', model: '', baseUrl: '', costPerImageCents: 0 });
    expect(config.model).not.toBe(globalValues.ai_image_model);
    expect(config.baseUrl).not.toBe(globalValues.ai_image_base_url);
  });

  it.each(['ai_image_provider', 'ai_image_generation_cost_cents', 'ai_image_api_key'])('ignores corrupt unselected global setting %s', async (key) => {
    change(key, key.endsWith('api_key') ? 'enc:v1:synthetic-corrupt' : 'invalid');
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ model: 'gpt-image-2-count', currency: 'CNY', costPerImageCents: 10 });
    expect(requestedKeys().flat()).not.toContain(key);
  });

  it.each(['ai_image_suite_cost_cents', 'ai_image_suite_currency', 'ai_image_suite_api_key'])('ignores corrupt unselected dedicated setting %s while inheriting', async (key) => {
    change('ai_image_suite_provider', 'inherit');
    change(key, key.endsWith('api_key') ? 'enc:v1:synthetic-corrupt' : 'invalid');
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ model: 'wanx2.1-imageedit', currency: 'CNY', costPerImageCents: 14 });
    expect(requestedKeys().flat()).not.toContain(key);
  });

  it.each(['ai_image_suite_cost_cents', 'ai_image_suite_currency', 'ai_image_suite_api_key'])('rejects corrupt selected dedicated setting %s', async (key) => {
    change(key, key.endsWith('api_key') ? 'enc:v1:synthetic-corrupt' : 'invalid');
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toThrow();
    expect(requestedKeys().flat()).not.toContain('ai_image_api_key');
  });

  it.each(['id', 'revision', 'updatedAt'] as const)('rejects an unbindable dedicated credential %s', async (field) => {
    const row = current.find((item) => item.key === 'ai_image_suite_api_key')!;
    Object.assign(row, { [field]: null });
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
  });

  it('advances dedicated credential revision through the writer and rejects a frozen identity after rotation', async () => {
    const before = await getAiImageSuiteProviderRuntimeConfig();
    const shape = { count: 1, width: 1008, height: 1344 };
    const frozen = createAiImageProviderRuntimeContract(before, shape);
    await setConfig('ai_image_suite_api_key', 'synthetic-rotated-suite-key');
    const after = await getAiImageSuiteProviderRuntimeConfig();
    expect(after).toMatchObject({
      apiKey: 'synthetic-rotated-suite-key',
      credentialRevision: { ...before.credentialRevision, revision: 4 },
    });
    expect(() => assertAiImageProviderRuntimeContract(frozen, after, { ...shape, estimatedCostCents: 10 })).toThrow(/identity does not match/u);
    expect(current.find((row) => row.key === 'ai_image_api_key')?.revision).toBe(3);
  });

  it('takes credential value and its revision from the same dedicated read during a rotation', async () => {
    beforeRead = (read) => { if (read === 2) change('ai_image_suite_api_key', 'synthetic-suite-key-new'); };
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({
      apiKey: 'synthetic-suite-key-new', credentialRevision: { revision: 4 },
    });
  });

  it('rejects an inherit-to-dedicated change while the global snapshot is being read', async () => {
    change('ai_image_suite_provider', 'inherit');
    beforeRead = (read) => { if (read === 2) change('ai_image_suite_provider', 'custom'); };
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(db.findMany).toHaveBeenCalledTimes(3);
  });

  it('rejects a dedicated-to-inherit change before the selected family snapshot', async () => {
    beforeRead = (read) => { if (read === 2) change('ai_image_suite_provider', 'inherit'); };
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
    expect(requestedKeys().flat()).not.toContain('ai_image_api_key');
  });

  it('rejects a same-value selector revision change rather than accepting an interrupted inherit read', async () => {
    change('ai_image_suite_provider', 'inherit');
    beforeRead = (read) => { if (read === 3) change('ai_image_suite_provider', 'inherit'); };
    await expect(getAiImageSuiteProviderRuntimeConfig()).rejects.toMatchObject({ code: 'PROVIDER_RUNTIME_CONTRACT_MISMATCH' });
  });

  it('advances selector revision for a same-value write in the same millisecond', async () => {
    const row = current.find((item) => item.key === 'ai_image_suite_provider')!;
    await setConfig('ai_image_suite_provider', 'custom');
    expect(row).toMatchObject({ value: 'custom', revision: 4, updatedAt: changedAt });
    expect(current.find((item) => item.key === 'ai_image_suite_api_key')?.revision).toBe(3);
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ model: 'gpt-image-2-count' });
  });

  it('explicitly disables suites without falling back to the enabled global provider', async () => {
    change('ai_image_suite_provider', 'disabled');
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ provider: 'disabled' });
    expect(requestedKeys().flat()).not.toContain('ai_image_provider');
  });

  it('preserves an explicit dedicated USD currency without deriving currency from model names', async () => {
    change('ai_image_suite_currency', 'USD');
    expect(await getAiImageSuiteProviderRuntimeConfig()).toMatchObject({ currency: 'USD', costPerImageCents: 10 });
  });
});
