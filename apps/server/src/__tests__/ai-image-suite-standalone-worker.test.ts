import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAiImageProviderRuntimeConfig } from '../workers/ai-image-generation.js';
import {
  aiImageSuiteProviderRuntimeMatches,
  createAiImageSuiteProviderRuntimeSnapshot,
} from '../services/ai-image-suite-provider-runtime.js';

const db = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { systemConfig: db } }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

function configuration(textPrice = '5', editPrice = '14') {
  return Object.entries({
    ai_image_provider: 'dashscope-wanx',
    ai_image_model: 'wanx2.1-imageedit',
    ai_image_base_url: 'https://dashscope.aliyuncs.com/api/v1',
    ai_image_api_key: 'synthetic-standalone-runtime-key',
    ai_image_generation_cost_cents: editPrice,
    ai_image_text_to_image_model: 'wanx2.1-t2i-turbo',
    ai_image_text_to_image_cost_cents: textPrice,
  }).map(([key, value]) => ({
    key, value, id: `config-${key}`, revision: 1, updatedAt: new Date('2026-09-16T00:00:00.000Z'),
  }));
}

/** Execute the actual standalone entry callback without starting unrelated queues or timers. */
function standaloneRuntimeEvidence() {
  const filename = new URL('../worker.ts', import.meta.url);
  const source = ts.createSourceFile('worker.ts', readFileSync(filename, 'utf8'), ts.ScriptTarget.ES2022, true);
  const declaration = source.statements.find(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(item => ts.isIdentifier(item.name)
      && item.name.text === 'standaloneSuiteRuntimeEvidence'));
  if (!declaration) throw new Error('Standalone suite runtime callback is missing');
  const compiled = ts.transpileModule(`${declaration.getText(source)}\nstandaloneSuiteRuntimeEvidence;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return runInNewContext(compiled.outputText, {
    getAiImageProviderRuntimeConfig,
    createAiImageSuiteProviderRuntimeSnapshot,
    aiImageSuiteProviderRuntimeMatches,
  }) as (suite: Parameters<typeof aiImageSuiteProviderRuntimeMatches>[0]) => Promise<string | null>;
}

async function frozenEditingSuite() {
  const snapshot = createAiImageSuiteProviderRuntimeSnapshot(
    await getAiImageProviderRuntimeConfig('IMAGE_TO_IMAGE'),
    { nodeEnv: 'production' },
  );
  expect(snapshot.executionReady).toBe(true);
  const config = snapshot.providerConfig!;
  return {
    ...config,
    itemCount: 1,
    estimatedCostCents: config.estimatedCostPerImageCents,
    maximumCostCents: config.maximumCostPerImageCents,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  db.findMany.mockResolvedValue(configuration());
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('standalone suite worker runtime selection', () => {
  it('uses the frozen editing runtime when the same provider has a separate T2I model and price', async () => {
    const suite = await frozenEditingSuite();
    expect(await getAiImageProviderRuntimeConfig('TEXT_TO_IMAGE')).toMatchObject({
      model: 'wanx2.1-t2i-turbo', costPerImageCents: 5,
    });
    await expect(standaloneRuntimeEvidence()(suite)).resolves.toBe('sandbox-verified');
  });

  it.each(['0', 'corrupt-price'])('does not let an unrelated text price %s disable suite execution', async textPrice => {
    const suite = await frozenEditingSuite();
    db.findMany.mockResolvedValue(configuration(textPrice));
    await expect(standaloneRuntimeEvidence()(suite)).resolves.toBe('sandbox-verified');
  });

  it('still rejects an editing price changed after the suite quote was frozen', async () => {
    const suite = await frozenEditingSuite();
    db.findMany.mockResolvedValue(configuration('5', '15'));
    await expect(standaloneRuntimeEvidence()(suite)).resolves.toBeNull();
  });
});
