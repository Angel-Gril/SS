import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrismaExtensionByokMediaProvenanceRepository,
} from '../repositories/extension-byok-media-provenance-repository.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createPrismaExtensionByokIngestRateLimiter } from '../services/extension-byok-ingest-rate-limit.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

describePostgres('extension BYOK media provenance PostgreSQL hardening', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('executes the database identifier guard without storing URL or credential-shaped labels', async () => {
    const rows = await client.$queryRawUnsafe<Array<{
      safePlain: boolean;
      urlWithQuery: boolean;
      dataUrl: boolean;
      authorization: boolean;
      fragment: boolean;
      rawOpenAiKey: boolean;
    }>>(`
      SELECT
        "extension_byok_identifier_safe"('gpt-image-1') AS "safePlain",
        "extension_byok_identifier_safe"('https://relay.example/v1?api_key=secret') AS "urlWithQuery",
        "extension_byok_identifier_safe"('data:image/png;base64,secret') AS "dataUrl",
        "extension_byok_identifier_safe"('Authorization: Bearer secret') AS "authorization",
        "extension_byok_identifier_safe"('sku-1#secret') AS "fragment",
        "extension_byok_identifier_safe"('sk-proj-secret') AS "rawOpenAiKey"
    `);
    expect(rows[0]).toEqual({
      safePlain: true,
      urlWithQuery: false,
      dataUrl: false,
      authorization: false,
      fragment: false,
      rawOpenAiKey: false,
    });
  });

  it('installs the media asset trigger and binds it to BYOK provenance references', async () => {
    const rows = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_functiondef('protect_referenced_media_asset_identity()'::regprocedure)
        AS definition
    `);
    expect(rows[0]?.definition).toMatch(/extension_byok_media_provenance/u);

    const triggers = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_triggerdef(trigger_row.oid) AS definition
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = 'media_assets'::regclass
        AND trigger_row.tgname = 'media_assets_referenced_identity_immutable'
        AND NOT trigger_row.tgisinternal
    `);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.definition).toMatch(/protect_referenced_media_asset_identity/u);
  });

  it('keeps publish identity validation in the database trigger', async () => {
    const rows = await client.$queryRawUnsafe<Array<{ definition: string }>>(`
      SELECT pg_get_functiondef(
        'validate_extension_byok_media_provenance_authority()'::regprocedure
      ) AS definition
    `);
    expect(rows[0]?.definition).toMatch(/extension_command_receipts/u);
    expect(rows[0]?.definition).toMatch(/extension_command_grants/u);
    expect(rows[0]?.definition).toMatch(/command_grant.*idempotency_key.*intent.*idempotency_key/isu);
    expect(rows[0]?.definition).toMatch(/actor_user_id.*command_session.*actor_user_id/isu);
    expect(rows[0]?.definition).toMatch(/command_session.*id.*NEW.*device_session_id/isu);
    expect(rows[0]?.definition).toMatch(/bound_draft_revision/iu);
    expect(rows[0]?.definition).toMatch(/assignment_ordinal/iu);
    expect(rows[0]?.definition).toMatch(/publish intent no longer contains the bound assignment/iu);
  });

  it('persists immutable source-to-bound draft and absolute order authority', async () => {
    const columns = await client.$queryRawUnsafe<Array<{ columnName: string; nullable: string }>>(`
      SELECT "column_name" AS "columnName", "is_nullable" AS nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'extension_byok_media_provenance'
        AND column_name IN (
          'bound_draft_revision', 'bound_draft_version', 'assignment_ordinal',
          'assignment_sha256', 'policy_revision'
        )
      ORDER BY column_name
    `);
    expect(columns).toEqual([
      { columnName: 'assignment_ordinal', nullable: 'NO' },
      { columnName: 'assignment_sha256', nullable: 'NO' },
      { columnName: 'bound_draft_revision', nullable: 'NO' },
      { columnName: 'bound_draft_version', nullable: 'NO' },
      { columnName: 'policy_revision', nullable: 'NO' },
    ]);
  });

  it('accepts one real source-to-bound generated assignment through the PostgreSQL trigger', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const ownerUserId = `byok_owner_${suffix}`;
    const goodsId = `byok_goods_${suffix}`;
    const subjectId = `byok_subject_${suffix}`;
    const snapshotId = `byok_snapshot_${suffix}`;
    const shopId = `byok_shop_${suffix}`;
    const assetId = `byok_asset_${suffix}`;
    const pairingId = `byok_pairing_${suffix}`;
    const sessionId = `byok_session_${suffix}`;
    const now = new Date();
    const resultSha256 = 'a'.repeat(64);
    await client.user.create({
      data: { id: ownerUserId, phone: `byok_${suffix}`, passwordHash: 'integration-test' },
    });
    await client.supplyGoods.create({ data: {
      id: goodsId, userId: ownerUserId, title: 'BYOK binding fixture',
      sourcePlatform: '1688', sourceProductId: `byok_product_${suffix}`,
    } });
    await client.sourceCaptureSubject.create({ data: {
      id: subjectId, ownerUserId, sourcePlatform: '1688',
      sourceProductId: `byok_product_${suffix}`, legacySupplyGoodsId: goodsId,
    } });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: 'b'.repeat(64), payloadBytes: 2, payload: {}, stageCounts: {},
      provenance: {}, provenanceComplete: true, parserVersion: 'integration', completeness: {},
      truncations: [], hasEstimatedValues: false, profile: {}, profileHash: 'c'.repeat(64),
      actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration',
      rolloutStage: 'v2_only', capturedAt: now,
    } });
    await client.shop.create({ data: {
      id: shopId, userId: ownerUserId, platform: 'OZON', name: 'BYOK shop',
      apiKeyEncrypted: 'integration-test',
    } });
    const listing = createSourceListingWorkflowService({
      repository: createPrismaSourceListingWorkflowRepository({ client: client as any }),
    });
    const sourceDraft = await listing.createDraft({
      ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId: goodsId,
      sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: 'b'.repeat(64),
      selectedSkuKeys: ['sku-1'],
    });
    await client.mediaAsset.create({ data: {
      id: assetId, ownerUserId, aiImageJobId: null, kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: snapshotId, sourceMediaKey: `extension-byok:${'d'.repeat(64)}`,
      sourceUrl: null, url: `https://cdn.example/${assetId}.png`, storageBackend: 'oss',
      storageKey: `users/${ownerUserId}/${assetId}.png`, mimeType: 'image/png',
      sizeBytes: 100, width: 10, height: 10, sha256: resultSha256,
      metadata: {
        ingestContractVersion: 'byok-generated-asset-ingest/v1',
        normalizerVersion: 'byok-generated-asset-normalizer/v1',
        generatedAssetSource: 'EXTENSION_BYOK', executionMode: 'BYOK',
        outputRole: 'BYOK_ACCEPTED', pixelOrientationNormalized: true,
        idempotencyKeySha256: 'e'.repeat(64), requestHash: 'f'.repeat(64),
        providerResultSha256: '1'.repeat(64), providerResultMimeType: 'image/png',
        providerResultSizeBytes: 120, normalizedSha256: resultSha256,
      },
    } });
    const boundDraft = await listing.setMediaAssignments({
      draftId: sourceDraft.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: sourceDraft.revision,
      assignments: [{
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId, source: 'GENERATED',
      }],
    });
    await client.extensionDevicePairingCode.create({ data: {
      id: pairingId, deploymentId: 'integration', actorUserId: ownerUserId, ownerUserId,
      codeDigest: '2'.repeat(64), shopIds: [shopId], scopes: ['byok:media:ingest'],
      status: 'CLAIMED', expiresAt: new Date(now.getTime() + 60_000), claimedAt: now,
    } });
    await client.extensionDeviceSession.create({ data: {
      id: sessionId, pairingCodeId: pairingId, deploymentId: 'integration',
      deviceId: `device_${suffix}`, actorUserId: ownerUserId, ownerUserId,
      scopes: ['byok:media:ingest'], currentJti: `jti_${suffix}`,
      expiresAt: new Date(now.getTime() + 60_000),
    } });
    const ingestRateLimiter = createPrismaExtensionByokIngestRateLimiter(client as never);
    await expect(ingestRateLimiter.consume({
      id: `byok_rate_1_${suffix}`, ownerUserId, deviceSessionId: sessionId, limit: 2,
    })).resolves.toMatchObject({ kind: 'allowed', remaining: 1 });
    await expect(ingestRateLimiter.consume({
      id: `byok_rate_2_${suffix}`, ownerUserId, deviceSessionId: sessionId, limit: 2,
    })).resolves.toMatchObject({ kind: 'allowed', remaining: 0 });
    await expect(ingestRateLimiter.consume({
      id: `byok_rate_3_${suffix}`, ownerUserId, deviceSessionId: sessionId, limit: 2,
    })).resolves.toMatchObject({ kind: 'rate_limited' });
    const persistedRateEvents = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS "count" FROM "extension_byok_ingest_rate_events" WHERE "device_session_id" = $1',
      sessionId,
    );
    expect(Number(persistedRateEvents[0]?.count || 0)).toBe(3);
    const provenanceId = `byok_provenance_${suffix}`;
    const assignmentSha256 = '3'.repeat(64);
    const endpointOriginSha256 = '4'.repeat(64);
    const promptSha256 = '5'.repeat(64);
    const idempotencyKey = `byok-provenance-${suffix}`;
    const requestHash = 'f'.repeat(64);
    await client.$executeRawUnsafe(`
      INSERT INTO "extension_byok_media_provenance" (
        "id", "contract_version", "execution_mode", "owner_user_id", "actor_user_id",
        "device_session_id", "shop_id", "workflow_id", "draft_revision", "draft_version",
        "bound_draft_revision", "bound_draft_version", "sku_key", "slot_key",
        "assignment_ordinal", "assignment_sha256", "policy_revision",
        "endpoint_origin_sha256", "model", "operation", "provider_request_id_sha256",
        "prompt_sha256", "negative_prompt_sha256", "source_sha256", "reference_sha256s",
        "mask_sha256", "result_sha256", "asset_id", "result_mime_type", "result_width",
        "result_height", "idempotency_key", "request_hash", "publish_intent_id",
        "publish_receipt_id", "erp_ai_charge_cents", "created_at", "updated_at"
      ) VALUES (
        $1, 'extension-byok-media-provenance/v1', 'BYOK', $2, $2, $3, $4, $5, $6, $7,
        $8, $9, 'sku-1', 'sku:sku-1:hero', 0, $10, 7, $11, 'image-model-v1',
        'TEXT_TO_IMAGE', NULL, $12, NULL, NULL, ARRAY[]::text[], NULL, $13, $14,
        'image/png', 10, 10, $15, $16, NULL, NULL, 0, $17, $17
      )
    `,
    provenanceId, ownerUserId, sessionId, shopId, sourceDraft.id,
    sourceDraft.revision, sourceDraft.draftVersion,
    boundDraft.revision, boundDraft.draftVersion, assignmentSha256, endpointOriginSha256,
    promptSha256, resultSha256, assetId,
    idempotencyKey, requestHash, now);

    const replay = await new PrismaExtensionByokMediaProvenanceRepository(client).createOrReplay({
      contractVersion: 'extension-byok-media-provenance/v1',
      executionMode: 'BYOK',
      ownerUserId,
      actorUserId: ownerUserId,
      deviceSessionId: sessionId,
      shopId,
      workflowId: sourceDraft.id,
      draftRevision: sourceDraft.revision,
      draftVersion: sourceDraft.draftVersion,
      boundDraftRevision: boundDraft.revision,
      boundDraftVersion: boundDraft.draftVersion,
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assignmentOrdinal: 0,
      assignmentSha256,
      policyRevision: 7,
      endpointOriginSha256,
      model: 'image-model-v1',
      operation: 'TEXT_TO_IMAGE',
      providerRequestIdSha256: null,
      promptSha256,
      negativePromptSha256: null,
      sourceSha256: null,
      referenceSha256s: [],
      maskSha256: null,
      resultSha256,
      assetId,
      resultMimeType: 'image/png',
      resultWidth: 10,
      resultHeight: 10,
      idempotencyKey,
      requestHash,
      publishIntentId: null,
      publishReceiptId: null,
      erpAiChargeCents: 0,
    });
    expect(replay).toMatchObject({ kind: 'replayed', provenance: { id: provenanceId } });

    const [reservationCount, settlementCount] = await Promise.all([
      client.aiCostReservation.count({ where: { ownerUserId } }),
      client.aiCostSettlement.count({ where: { ownerUserId } }),
    ]);
    expect({ reservationCount, settlementCount }).toEqual({
      reservationCount: 0,
      settlementCount: 0,
    });
    await expect(client.$executeRawUnsafe(
      'UPDATE "extension_byok_media_provenance" SET "execution_mode" = $2 WHERE "id" = $1',
      provenanceId,
      'ERP_HOSTED',
    )).rejects.toThrow(/BYOK media provenance identity is immutable|execution_mode/iu);
    const rows = await client.$queryRawUnsafe<Array<{
      boundDraftRevision: number;
      assignmentOrdinal: number;
      erpAiChargeCents: number;
    }>>(`
      SELECT "bound_draft_revision" AS "boundDraftRevision",
             "assignment_ordinal" AS "assignmentOrdinal",
             "erp_ai_charge_cents" AS "erpAiChargeCents"
      FROM "extension_byok_media_provenance" WHERE "id" = $1
    `, provenanceId);
    expect(rows).toEqual([{
      boundDraftRevision: boundDraft.revision,
      assignmentOrdinal: 0,
      erpAiChargeCents: 0,
    }]);
  });
});
