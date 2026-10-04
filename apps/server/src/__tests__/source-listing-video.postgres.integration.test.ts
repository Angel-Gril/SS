import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OzonNormalizedAttributeSchema, SourceProductCaptureV2Submission } from 'shared';
import { createPrismaSourceListingVideoService } from '../services/source-listing-video-prisma.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const describePostgres = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && databaseUrl ? describe : describe.skip;
const submission = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describePostgres('Prisma official draft video transaction', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl); const schema = url.searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema) || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Video tests require an isolated local ai_media_test_* schema');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });
  async function fixture() {
    const prefix = `video_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ownerUserId = `${prefix}_owner`, shopId = `${prefix}_shop`, goodsId = `${prefix}_goods`, snapshotId = `${prefix}_snapshot`, subjectId = `${prefix}_subject`, sessionId = `${prefix}_session`;
    const now = new Date();
    await client.user.create({ data: { id: ownerUserId, phone: `${prefix}_phone`, passwordHash: 'isolated-test' } });
    await client.shop.create({ data: { id: shopId, userId: ownerUserId, platform: 'OZON', name: 'Video fixture', apiKeyEncrypted: 'isolated-test' } });
    await client.supplyGoods.create({ data: { id: goodsId, userId: ownerUserId, title: 'Video fixture', status: 'collected',
      metadata: { sourceCaptureV2: { subjectId, snapshotId, captureHash: submission.captureHash } } } });
    await client.sourceCaptureSubject.create({ data: { id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: '1000000000004', legacySupplyGoodsId: goodsId } });
    await client.sourceCaptureSnapshot.create({ data: { id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: submission.captureHash, payloadBytes: submission.payloadBytes, payload: submission.capture as unknown as Prisma.InputJsonValue,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'video-test', completeness: {}, truncations: [], hasEstimatedValues: false,
      profile: {}, profileHash: hash(prefix), actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'test', rolloutStage: 'v2_only', capturedAt: now } });
    const scopes = ['listing:review', 'listing:write', 'media:execute'];
    await client.extensionDevicePairingCode.create({ data: { id: `${prefix}_pairing`, deploymentId: 'video-test', actorUserId: ownerUserId, ownerUserId,
      codeDigest: hash(prefix), shopIds: [shopId], scopes, status: 'CLAIMED', expiresAt: new Date(Date.now() + 3_600_000), claimedAt: now } });
    await client.extensionDeviceSession.create({ data: { id: sessionId, pairingCodeId: `${prefix}_pairing`, deploymentId: 'video-test', deviceId: `${prefix}_device`,
      actorUserId: ownerUserId, ownerUserId, scopes, currentJti: `${prefix}_jti`, expiresAt: new Date(Date.now() + 3_600_000) } });
    await client.extensionDeviceShopGrant.create({ data: { sessionId, shopId } });
    const repository = createPrismaSourceListingWorkflowRepository({ client: client as never });
    const workflow = createSourceListingWorkflowService({ repository });
    const created = await workflow.createDraft({ ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId: goodsId,
      sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: submission.captureHash, selectedSkuKeys: ['sku-0'] });
    const draft = await workflow.setCategory({ draftId: created.id, ownerUserId, actorUserId: ownerUserId, expectedRevision: 1,
      category: { categoryId: 1, typeId: 2, catalogRevision: 'video-test' } });
    const schema: OzonNormalizedAttributeSchema = { schemaVersion: 'ozon-attribute-schema/v1', shopId, descriptionCategoryId: 1, typeId: 2,
      language: 'DEFAULT', catalogRevision: 'video-test', definitionsHash: 'a'.repeat(64), fields: [21841, 22336].map(attributeId => ({ attributeId,
        name: 'Видео', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE', required: false,
        dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'MEDIA', editorMode: 'MEDIA_WORKBENCH', aiSuggestionAllowed: false })) };
    let afterSchema: (() => Promise<void>) | undefined;
    const makeService = () => createPrismaSourceListingVideoService({ client, loadSchema: async () => { if (afterSchema) await afterSchema(); return schema; } });
    const actor = { ownerUserId, actorUserId: ownerUserId, sessionId, scopes, allowedShopIds: [shopId] };
    const input = { binding: { snapshotId, supplyGoodsId: goodsId, shopId, listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion },
      skuKey: 'sku-0', mainUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/clip.mp4', richContentUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/clip.mp4', operationKey: 'video-postgres-request' };
    return { ownerUserId, shopId, goodsId, sessionId, draft, actor, input, repository, makeService,
      setAfterSchema: (value: () => Promise<void>) => { afterSchema = value; } };
  }
  it('writes one immutable version and audit; restart replay writes no extra media/job/receipt', async () => {
    const f = await fixture(); const first = await f.makeService().save(f.actor, f.input);
    const replay = await f.makeService().save(f.actor, f.input);
    expect(replay).toEqual({ ...first, replayed: true }); expect(first.binding.draftRevision).toBe(3);
    expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(3);
    expect(await client.sourceListingWorkflowEvent.count({ where: { workflowId: f.draft.id, eventType: 'VIDEO_BINDING_CHANGED' } })).toBe(1);
    expect(await client.mediaAsset.count({ where: { ownerUserId: f.ownerUserId } })).toBe(0);
    expect(await client.aiImageJob.count({ where: { ownerUserId: f.ownerUserId } })).toBe(0);
    expect((await f.makeService().read(f.actor, { binding: first.binding })).videoBindings).toHaveLength(2);
  });
  it.each(['revoke', 'source-drift'] as const)('rechecks %s after schema preparation before CAS', async reason => {
    const f = await fixture(); f.setAfterSchema(async () => {
      if (reason === 'revoke') await client.extensionDeviceSession.update({ where: { id: f.sessionId }, data: { scopes: ['listing:review'] } });
      else await client.supplyGoods.update({ where: { id: f.goodsId }, data: { metadata: { sourceCaptureV2: { snapshotId: 'new' } } } });
    });
    await expect(f.makeService().save(f.actor, f.input)).rejects.toMatchObject({ code: 'video_context_stale' });
    expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(2);
    expect(await client.sourceListingWorkflowEvent.count({ where: { workflowId: f.draft.id, eventType: 'VIDEO_BINDING_CHANGED' } })).toBe(0);
  });
  it('keeps a concurrent revision winner and refuses stale video replacement', async () => {
    const f = await fixture(); f.setAfterSchema(async () => {
      await f.repository.compareAndSwap({ draftId: f.draft.id, ownerUserId: f.ownerUserId, actorUserId: f.ownerUserId,
        expectedRevision: 2, next: { ...f.draft, revision: 3, draftVersion: 3 } });
    });
    await expect(f.makeService().save(f.actor, f.input)).rejects.toMatchObject({ code: 'video_context_stale' });
    expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(3);
    expect(await client.sourceListingWorkflowEvent.count({ where: { workflowId: f.draft.id, eventType: 'VIDEO_BINDING_CHANGED' } })).toBe(0);
  });
});
