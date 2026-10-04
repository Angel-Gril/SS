import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceProductCaptureV2Submission } from 'shared';
import { createPrismaSourceListingWatermarkService } from '../services/source-listing-watermark-prisma.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const submission = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describePostgres('Prisma deterministic watermark transaction', () => {
  let client: PrismaClient;
  beforeAll(() => {
    const url = new URL(databaseUrl); const schema = url.searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema) || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Watermark tests require an isolated local ai_media_test_* schema');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });
  async function fixture() {
    const prefix = `wm_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const ownerUserId = `${prefix}_owner`, shopId = `${prefix}_shop`, goodsId = `${prefix}_goods`, snapshotId = `${prefix}_snapshot`, subjectId = `${prefix}_subject`, sessionId = `${prefix}_session`;
    const now = new Date();
    await client.user.create({ data: { id: ownerUserId, phone: `${prefix}_phone`, passwordHash: 'isolated-test' } });
    await client.shop.create({ data: { id: shopId, userId: ownerUserId, platform: 'OZON', name: 'Watermark fixture', apiKeyEncrypted: 'isolated-test' } });
    await client.supplyGoods.create({ data: { id: goodsId, userId: ownerUserId, title: 'Watermark fixture', status: 'collected',
      metadata: { sourceCaptureV2: { subjectId, snapshotId, captureHash: submission.captureHash } } } });
    await client.sourceCaptureSubject.create({ data: { id: subjectId, ownerUserId, sourcePlatform: '1688', sourceProductId: '1000000000003', legacySupplyGoodsId: goodsId } });
    await client.sourceCaptureSnapshot.create({ data: { id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: submission.captureHash, payloadBytes: submission.payloadBytes, payload: submission.capture as unknown as Prisma.InputJsonValue,
      stageCounts: {}, provenance: {}, provenanceComplete: true, parserVersion: 'watermark-test', completeness: {}, truncations: [], hasEstimatedValues: false,
      profile: {}, profileHash: hash(prefix), actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'test', rolloutStage: 'v2_only', capturedAt: now } });
    const scopes = ['listing:write', 'media:execute'];
    await client.extensionDevicePairingCode.create({ data: { id: `${prefix}_pairing`, deploymentId: 'watermark-test', actorUserId: ownerUserId, ownerUserId,
      codeDigest: hash(prefix), shopIds: [shopId], scopes, status: 'CLAIMED', expiresAt: new Date(Date.now() + 3_600_000), claimedAt: now } });
    await client.extensionDeviceSession.create({ data: { id: sessionId, pairingCodeId: `${prefix}_pairing`, deploymentId: 'watermark-test', deviceId: `${prefix}_device`,
      actorUserId: ownerUserId, ownerUserId, scopes, currentJti: `${prefix}_jti`, expiresAt: new Date(Date.now() + 3_600_000) } });
    await client.extensionDeviceShopGrant.create({ data: { sessionId, shopId } });
    const workflow = createSourceListingWorkflowService({ repository: createPrismaSourceListingWorkflowRepository({ client: client as never }) });
    const draft = await workflow.createDraft({ ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId: goodsId,
      sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: submission.captureHash, selectedSkuKeys: ['sku-0'] });
    const source = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const uploadBuffer = vi.fn(async (_bytes: Buffer, filename: string) => ({ backend: 'oss' as const, filename, key: `fixture/${filename}`, url: `https://media.example/${filename}` }));
    const deleteUploaded = vi.fn(async () => {});
    let afterUpload: (() => Promise<void>) | null = null;
    const makeService = () => createPrismaSourceListingWatermarkService({ client, processing: {
      download: async url => ({ buffer: source, width: 300, height: 400, format: 'png', sourceUrl: url, finalUrl: url, contentType: 'image/png', redirectCount: 0 }),
      getStorage: async () => ({ backendType: 'oss', namespaceId: 'f'.repeat(64), deleteUploaded,
        uploadBuffer: async (...args) => { const uploaded = await uploadBuffer(args[0], args[1]); if (afterUpload) await afterUpload(); return uploaded; } }),
    } });
    const actor = { ownerUserId, actorUserId: ownerUserId, sessionId, scopes, allowedShopIds: [shopId] };
    const input = { contractVersion: 'extension-workbench-watermark/v1', snapshotId, supplyGoodsId: goodsId, shopId, listingWorkflowId: draft.id, draftRevision: 1, draftVersion: 1,
      items: [{ skuKey: null, slotKey: 'product-main', sourceMediaKey: 'media-main-0' }], config: { type: 'text', text: 'My Shop', opacity: 60, position: 'center' } };
    return { ownerUserId, shopId, goodsId, draft, sessionId, actor, input, uploadBuffer, deleteUploaded, makeService,
      setAfterUpload: (action: () => Promise<void>) => { afterUpload = action; } };
  }
  it('persists true pixels, deterministic asset kind, audit and CAS once; another instance replays without upload', async () => {
    const f = await fixture(); const service = f.makeService(); const preview = await service.preview(f.actor, f.input);
    const request = { ...f.input, idempotencyKey: 'watermark-postgres-request', previewHash: preview.previewHash };
    const result = await service.apply(f.actor, request); expect(result.draft.revision).toBe(2);
    expect(await client.mediaAsset.count({ where: { ownerUserId: f.ownerUserId, kind: 'IMAGE_PROCESSED' } })).toBe(1);
    expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(2);
    expect(await client.sourceListingWorkflowEvent.count({ where: { workflowId: f.draft.id, eventType: 'IMAGE_PROCESSING_APPLIED' } })).toBe(1);
    const replay = await f.makeService().apply(f.actor, request); expect(replay.replayed).toBe(true); expect(replay.draft).toEqual(result.draft);
    expect(f.uploadBuffer).toHaveBeenCalledTimes(1); expect(await client.aiImageJob.count({ where: { ownerUserId: f.ownerUserId } })).toBe(0);
  });
  it.each(['revoke', 'source-drift'])('rechecks %s after upload and rolls back every asset, draft and audit', async reason => {
    const f = await fixture(); const service = f.makeService(); const preview = await service.preview(f.actor, f.input);
    f.setAfterUpload(async () => {
      if (reason === 'revoke') await client.extensionDeviceShopGrant.update({ where: { sessionId_shopId: { sessionId: f.sessionId, shopId: f.shopId } }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'SCOPE_REVOKED' } });
      else await client.supplyGoods.update({ where: { id: f.goodsId }, data: { metadata: { sourceCaptureV2: { snapshotId: 'new-snapshot' } } } });
    });
    await expect(service.apply(f.actor, { ...f.input, idempotencyKey: 'watermark-postgres-request', previewHash: preview.previewHash })).rejects.toMatchObject({ code: 'watermark_context_stale' });
    expect(await client.mediaAsset.count({ where: { ownerUserId: f.ownerUserId } })).toBe(0); expect(f.deleteUploaded).toHaveBeenCalledTimes(1);
    expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(1);
  });
  it('a failure in the real draft insert atomically rolls back already-created media', async () => {
    const f = await fixture(); const service = f.makeService(); const preview = await service.preview(f.actor, f.input);
    if (!/^[a-z0-9-]+$/u.test(f.draft.id)) throw new Error('Unsafe isolated fixture ID');
    await client.$executeRawUnsafe(`CREATE FUNCTION watermark_fixture_fail() RETURNS trigger AS $$ BEGIN IF NEW."workflow_id" = '${f.draft.id}' AND NEW."revision" > 1 THEN RAISE EXCEPTION 'isolated watermark CAS failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await client.$executeRawUnsafe(`CREATE TRIGGER watermark_fixture_failure BEFORE INSERT ON "source_listing_draft_versions" FOR EACH ROW EXECUTE FUNCTION watermark_fixture_fail()`);
    try {
      await expect(service.apply(f.actor, { ...f.input, idempotencyKey: 'watermark-postgres-request', previewHash: preview.previewHash })).rejects.toThrow();
      expect(await client.mediaAsset.count({ where: { ownerUserId: f.ownerUserId } })).toBe(0);
      expect(await client.sourceListingDraftVersion.count({ where: { workflowId: f.draft.id } })).toBe(1);
      expect(await client.sourceListingWorkflowEvent.count({ where: { workflowId: f.draft.id, eventType: 'IMAGE_PROCESSING_APPLIED' } })).toBe(0);
    } finally { await client.$executeRawUnsafe('DROP TRIGGER watermark_fixture_failure ON "source_listing_draft_versions"'); await client.$executeRawUnsafe('DROP FUNCTION watermark_fixture_fail()'); }
  });
});
