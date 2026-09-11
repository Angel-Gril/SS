import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiPromptTemplateStore } from '../services/ai-prompt-template-prisma.js';
import { AiPromptTemplateService } from '../services/ai-prompt-templates.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const actorUserId = 'template-source-integration-actor';

function assertIsolatedSchema() {
  const schema = new URL(databaseUrl).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

function fixturePrefix() {
  return `template_source_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

describePostgres('AI prompt published source PostgreSQL boundary', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    assertIsolatedSchema();
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => client?.$disconnect());

  async function createRevision(templateKey: string, revisionId: string, published = false) {
    const promptTemplate = 'Preserve the fixture object. {{user_prompt}}';
    const negativePromptTemplate = 'Avoid fixture changes. {{user_negative_prompt}}';
    return client.aiPromptRevision.create({ data: {
      id: revisionId,
      templateKey,
      status: published ? 'PUBLISHED' : 'DRAFT',
      promptTemplate,
      negativePromptTemplate,
      checksum: createHash('sha256').update(JSON.stringify({
        templateKey, promptTemplate, negativePromptTemplate,
      })).digest('hex'),
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    } });
  }

  async function snapshot(templateKey: string) {
    return {
      template: await client.aiPromptTemplate.findUnique({ where: { key: templateKey } }),
      revisions: await client.aiPromptRevision.findMany({ where: { templateKey }, orderBy: { id: 'asc' } }),
      testRuns: await client.aiPromptTestRun.findMany({
        where: { revision: { templateKey } }, orderBy: { id: 'asc' },
      }),
      releases: await client.aiPromptRelease.findMany({ where: { templateKey }, orderBy: { sequence: 'asc' } }),
    };
  }

  it('selects the latest strictly earlier publish without crossing template, revision or action boundaries', async () => {
    const prefix = fixturePrefix();
    const templateKey = `${prefix}.target`;
    const otherTemplateKey = `${prefix}.other`;
    await client.aiPromptTemplate.createMany({ data: [
      { key: templateKey, label: 'Synthetic source fixture', currentSequence: 6 },
      { key: otherTemplateKey, label: 'Synthetic other fixture', currentSequence: 4 },
    ] });
    const targetRevision = await createRevision(templateKey, `${prefix}_revision`, true);
    const otherRevision = await createRevision(templateKey, `${prefix}_other_revision`, true);
    const targetTest = await client.aiPromptTestRun.create({ data: {
      id: `${prefix}_pass`, revisionId: targetRevision.id,
      revisionChecksum: targetRevision.checksum, status: 'PASS', actorUserId,
    } });
    const otherTest = await client.aiPromptTestRun.create({ data: {
      id: `${prefix}_other_pass`, revisionId: otherRevision.id,
      revisionChecksum: otherRevision.checksum, status: 'PASS', actorUserId,
    } });
    await client.aiPromptRelease.createMany({ data: [
      { id: `${prefix}_first`, templateKey, revisionId: targetRevision.id, sequence: 1, action: 'PUBLISH', testRunId: targetTest.id, actorUserId },
      { id: `${prefix}_other_revision_publish`, templateKey, revisionId: otherRevision.id, sequence: 2, action: 'PUBLISH', testRunId: otherTest.id, actorUserId },
      { id: `${prefix}_latest`, templateKey, revisionId: targetRevision.id, sequence: 3, action: 'PUBLISH', testRunId: targetTest.id, actorUserId },
      { id: `${prefix}_rollback`, templateKey, revisionId: targetRevision.id, sequence: 4, action: 'ROLLBACK', actorUserId },
      { id: `${prefix}_boundary`, templateKey, revisionId: targetRevision.id, sequence: 5, action: 'PUBLISH', testRunId: targetTest.id, actorUserId },
      { id: `${prefix}_future`, templateKey, revisionId: targetRevision.id, sequence: 6, action: 'PUBLISH', testRunId: targetTest.id, actorUserId },
      // The separate foreign keys permit this corrupt row; the query must still retain template scope.
      { id: `${prefix}_other_template`, templateKey: otherTemplateKey, revisionId: targetRevision.id, sequence: 4, action: 'PUBLISH', testRunId: targetTest.id, actorUserId },
    ] });
    const before = await snapshot(templateKey);

    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      expect(await tx.$queryRaw<Array<{ readOnly: string }>>`
        SELECT current_setting('transaction_read_only') AS "readOnly"
      `).toEqual([{ readOnly: 'on' }]);
      const store = new PrismaAiPromptTemplateStore(tx);
      await expect(store.findPublishedRelease({ templateKey, revisionId: targetRevision.id, beforeSequence: 5 }))
        .resolves.toMatchObject({ id: `${prefix}_latest`, sequence: 3, action: 'PUBLISH', testRunId: targetTest.id });
      await expect(store.findPublishedRelease({ templateKey, revisionId: targetRevision.id, beforeSequence: 3 }))
        .resolves.toMatchObject({ id: `${prefix}_first`, sequence: 1 });
      await expect(store.findPublishedRelease({ templateKey, revisionId: targetRevision.id, beforeSequence: 1 }))
        .resolves.toBeNull();
      await expect(store.findPublishedRelease({ templateKey, revisionId: `${prefix}_missing`, beforeSequence: 5 }))
        .resolves.toBeNull();
    });

    expect(await snapshot(templateKey)).toEqual(before);
  });

  it('returns null for missing history in a database-enforced read-only transaction without creating a template', async () => {
    const templateKey = `${fixturePrefix()}.missing`;
    const before = await snapshot(templateKey);
    expect(before).toEqual({ template: null, revisions: [], testRuns: [], releases: [] });

    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const store = new PrismaAiPromptTemplateStore(tx);
      await expect(store.findPublishedRelease({ templateKey, revisionId: 'missing-revision', beforeSequence: 1 }))
        .resolves.toBeNull();
    });

    expect(await snapshot(templateKey)).toEqual(before);
  });

  it('recovers the original PASS-tested publication after a real domain publish and rollback without changing history', async () => {
    const prefix = fixturePrefix();
    const templateKey = `${prefix}.lifecycle`;
    await client.aiPromptTemplate.create({ data: { key: templateKey, label: 'Isolated publish lifecycle' } });
    // Only draft fixtures are inserted directly. PASS, PUBLISH and ROLLBACK use the real domain and CAS store.
    const originalRevision = await createRevision(templateKey, `${prefix}_original`);
    const newerRevision = await createRevision(templateKey, `${prefix}_newer`);
    const store = new PrismaAiPromptTemplateStore(client);
    const domain = new AiPromptTemplateService(store);
    const originalTest = await domain.recordTestRun({ revisionId: originalRevision.id, status: 'PASS', actorUserId });
    const originalPublish = await domain.publish({
      revisionId: originalRevision.id, testRunId: originalTest.id, expectedSequence: 0, actorUserId,
    });
    const newerTest = await domain.recordTestRun({ revisionId: newerRevision.id, status: 'PASS', actorUserId });
    await domain.publish({ revisionId: newerRevision.id, testRunId: newerTest.id, expectedSequence: 1, actorUserId });
    const rollback = await domain.rollback({ templateKey, targetRevisionId: originalRevision.id, expectedSequence: 2, actorUserId });
    expect(rollback).toMatchObject({ action: 'ROLLBACK', sequence: 3, testRunId: null });
    const before = await snapshot(templateKey);

    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const readStore = new PrismaAiPromptTemplateStore(tx);
      const publication = await readStore.findPublishedRelease({
        templateKey, revisionId: originalRevision.id, beforeSequence: rollback.sequence,
      });
      expect(publication).toEqual(originalPublish);
      expect(await readStore.getActiveRelease(templateKey)).toEqual(rollback);
      expect(await readStore.getRevision(originalRevision.id)).toMatchObject({ status: 'PUBLISHED', checksum: originalTest.revisionChecksum });
      expect(await readStore.getTestRun(publication!.testRunId!)).toEqual(originalTest);
    });

    expect(await snapshot(templateKey)).toEqual(before);
  });
});
