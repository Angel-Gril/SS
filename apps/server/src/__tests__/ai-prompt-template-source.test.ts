import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminAiPromptTemplateRoutes } from '../routes/admin-ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { InMemoryAiPromptTemplateStore } from '../services/ai-prompt-templates.js';

const KEY = 'full-image-edit.base';
const variables = { userPrompt: 'Keep the product and change the background.', userNegativePrompt: 'No added text.' };

async function fixture(populate = true) {
  const store = new InMemoryAiPromptTemplateStore();
  const getLegacyPrompt = vi.fn(async () => 'Unused legacy prompt');
  const registry = new AiPromptTemplateRegistryService(store, { getLegacyPrompt });
  if (populate) await registry.resolveTemplate({ templateKey: KEY, variables });
  const writes = ['ensureTemplate', 'createRevision', 'updateRevision', 'createTestRun', 'appendRelease'] as const;
  const writeSpies = writes.map((method) => vi.spyOn(store, method));
  const read = (key = KEY) => registry.readExistingPublishedSource(key);
  return { store, registry, read, getLegacyPrompt, writeSpies };
}

describe('existing published prompt source', () => {
  it('returns the stored published revision and PASS test without initialization or writes', async () => {
    const target = await fixture();
    const active = await target.store.getActiveRelease(KEY);
    const source = await target.read();
    expect(source).toMatchObject({
      schemaVersion: 1,
      kind: 'AI_PROMPT_PUBLISHED_SOURCE_V1',
      templateKey: KEY,
      activeRelease: { id: active!.id, action: 'PUBLISH', sequence: 1 },
      revision: { id: active!.revisionId, status: 'PUBLISHED' },
      publicationRelease: { id: active!.id, testRunId: active!.testRunId },
      testRun: { id: active!.testRunId, revisionId: active!.revisionId, status: 'PASS' },
    });
    expect(source.testRun.revisionChecksum).toBe(source.revision.checksum);
    for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
    expect(target.getLegacyPrompt).not.toHaveBeenCalled();
    expect(JSON.stringify(source)).not.toMatch(/actorUserId|createdByUserId|updatedByUserId|"note"/u);
  });

  it('reports a missing release while leaving an empty store empty', async () => {
    const target = await fixture(false);
    await expect(target.read()).rejects.toMatchObject({ code: 'ACTIVE_RELEASE_NOT_FOUND' });
    expect(await target.store.listTemplates()).toEqual([]);
    for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
    expect(target.getLegacyPrompt).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'text-to-image.base', 'unknown.base'])('rejects unsupported source key %s before reading', async (key) => {
    const target = await fixture(false);
    const readActive = vi.spyOn(target.store, 'getActiveRelease');
    await expect(target.read(key)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    expect(readActive).not.toHaveBeenCalled();
    for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('links a legitimate rollback to the original publication test', async () => {
    const target = await fixture();
    const first = (await target.store.getActiveRelease(KEY))!;
    const revision = await target.registry.createRevision({
      actorUserId: 'synthetic-admin', key: KEY,
      promptTemplate: 'Change background only: {{user_prompt}}',
      negativePromptTemplate: '{{user_negative_prompt}}',
    });
    const tested = await target.registry.testRevision({
      actorUserId: 'synthetic-admin', revisionId: revision.id, sampleInput: variables,
    });
    await target.registry.publishRevision({
      actorUserId: 'synthetic-admin', key: KEY, revisionId: revision.id,
      testRunId: tested.testRunId, expectedSequence: 1,
    });
    const rollback = await target.registry.rollbackTemplate({
      actorUserId: 'synthetic-admin', key: KEY,
      targetRevisionId: first.revisionId, expectedSequence: 2,
    });
    for (const spy of target.writeSpies) spy.mockClear();
    const source = await target.read();
    expect(source).toMatchObject({
      activeRelease: { id: rollback.id, action: 'ROLLBACK', testRunId: null, sequence: 3 },
      revision: { id: first.revisionId },
      publicationRelease: { id: first.id, action: 'PUBLISH', sequence: 1 },
      testRun: { id: first.testRunId, revisionId: first.revisionId, status: 'PASS' },
    });
    for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['revision id', { id: 'another-revision' }],
    ['template key', { templateKey: 'inpaint.base' }],
    ['draft revision', { status: 'DRAFT' }],
    ['content checksum', { checksum: '0'.repeat(64) }],
    ['changed content', { promptTemplate: 'Different content: {{user_prompt}}' }],
  ])('rejects a mismatched %s', async (_name, mutation) => {
    const target = await fixture();
    const active = (await target.store.getActiveRelease(KEY))!;
    const revision = (await target.store.getRevision(active.revisionId))!;
    vi.spyOn(target.store, 'getRevision').mockResolvedValue({ ...revision, ...mutation } as any);
    await expect(target.read()).rejects.toMatchObject({ code: 'TEMPLATE_SOURCE_CONFLICT' });
    for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['missing test', null],
    ['failed test', { status: 'FAIL' }],
    ['wrong revision', { revisionId: 'another-revision' }],
    ['wrong checksum', { revisionChecksum: '0'.repeat(64) }],
    ['future test', { createdAt: '2099-01-01T00:00:00.000Z' }],
  ])('rejects a %s', async (_name, mutation) => {
    const target = await fixture();
    const active = (await target.store.getActiveRelease(KEY))!;
    const testRun = (await target.store.getTestRun(active.testRunId!))!;
    vi.spyOn(target.store, 'getTestRun').mockResolvedValue(mutation ? { ...testRun, ...mutation } as any : null);
    await expect(target.read()).rejects.toMatchObject({ code: 'TEMPLATE_SOURCE_CONFLICT' });
  });

  it('rejects a release changed during the read instead of mixing versions', async () => {
    const target = await fixture();
    const active = (await target.store.getActiveRelease(KEY))!;
    vi.spyOn(target.store, 'getActiveRelease')
      .mockResolvedValueOnce(active)
      .mockResolvedValue({ ...active, id: 'new-release', sequence: active.sequence + 1 });
    await expect(target.read()).rejects.toMatchObject({ code: 'TEMPLATE_SOURCE_CONFLICT' });
  });

  it('rejects an orphan rollback without treating it as a publication', async () => {
    const target = await fixture();
    const active = (await target.store.getActiveRelease(KEY))!;
    vi.spyOn(target.store, 'getActiveRelease').mockResolvedValue({ ...active, action: 'ROLLBACK', testRunId: null });
    await expect(target.read()).rejects.toMatchObject({ code: 'TEMPLATE_SOURCE_CONFLICT' });
  });
});

describe('read-only published source API', () => {
  async function appFor(identity: 'none' | 'admin' | 'super', populate = true) {
    const target = await fixture(populate);
    const app = Fastify();
    await app.register(adminAiPromptTemplateRoutes, {
      service: target.registry,
      authenticate: async (request, reply) => {
        if (identity === 'none') return reply.status(401).send({ code: 0 });
        (request as any).user = { actorUserId: 'synthetic-admin', isSuperAdmin: identity === 'super' };
      },
      requireSuperAdmin: async (request, reply) => {
        if (!(request as any).user?.isSuperAdmin) return reply.status(403).send({ code: 0 });
      },
    });
    return { app, ...target };
  }

  it.each([['none', 401], ['admin', 403]] as const)('denies %s without reading the store', async (identity, status) => {
    const target = await appFor(identity);
    const read = vi.spyOn(target.store, 'getActiveRelease');
    try {
      const response = await target.app.inject({ method: 'GET', url: `/${KEY}/source` });
      expect(response.statusCode).toBe(status);
      expect(read).not.toHaveBeenCalled();
    } finally { await target.app.close(); }
  });

  it('returns only the source contract to the existing superadmin role', async () => {
    const target = await appFor('super');
    try {
      const response = await target.app.inject({ method: 'GET', url: `/${KEY}/source` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: {
        kind: 'AI_PROMPT_PUBLISHED_SOURCE_V1', templateKey: KEY, testRun: { status: 'PASS' },
      } });
      expect(response.body).not.toMatch(/actorUserId|createdByUserId|updatedByUserId/u);
      for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
    } finally { await target.app.close(); }
  });

  it('does not initialize a missing source and rejects query overrides', async () => {
    const target = await appFor('super', false);
    try {
      const missing = await target.app.inject({ method: 'GET', url: `/${KEY}/source` });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error?.code).toBe('ACTIVE_RELEASE_NOT_FOUND');
      const override = await target.app.inject({ method: 'GET', url: `/${KEY}/source?revisionId=another` });
      expect(override.statusCode).toBe(400);
      expect(await target.store.listTemplates()).toEqual([]);
      for (const spy of target.writeSpies) expect(spy).not.toHaveBeenCalled();
    } finally { await target.app.close(); }
  });
});
