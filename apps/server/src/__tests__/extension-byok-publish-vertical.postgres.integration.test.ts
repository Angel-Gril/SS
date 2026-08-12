import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  authenticateExtensionDevice,
  resolveExtensionDeviceAuthConfig,
} from '../lib/extension-device-auth.js';
import {
  createPrismaExtensionByokPublishProvenanceReader,
} from '../repositories/extension-byok-media-provenance-repository.js';
import {
  createPrismaExtensionByokPublishStatusRepository,
} from '../repositories/extension-byok-publish-status-repository.js';
import {
  createPrismaExtensionByokGeneratedAssetCommitter,
} from '../repositories/extension-byok-generated-asset-commit-prisma.js';
import { extensionByokPublishRoutes } from '../routes/extension-byok-publish.js';
import {
  createSourceWorkflowCommandResolver,
  extensionCommandGrantRoutes,
} from '../routes/extension-command-grants.js';
import {
  BYOK_GENERATED_ASSET_INGEST_VERSION,
  BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
} from '../services/byok-generated-asset-ingest.js';
import {
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  createExtensionByokListingPublishService,
  EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
} from '../services/extension-byok-listing-publish.js';
import {
  EXTENSION_BYOK_POLICY_VERSION,
} from '../services/extension-byok-policy.js';
import {
  createExtensionByokPublishAuthorizer,
} from '../services/extension-byok-publish-authorization.js';
import {
  createExtensionCommandGrantService,
  digestExtensionCommandGrantToken,
  hashExtensionCommandRequest,
} from '../services/extension-command-grants.js';
import {
  createPrismaExtensionCommandGrantStore,
} from '../services/extension-command-grants-prisma.js';
import {
  createExtensionDeviceSessionService,
} from '../services/extension-device-session.js';
import {
  createPrismaExtensionDeviceSessionRepository,
} from '../services/extension-device-session-prisma.js';
import {
  createExtensionWorkbenchByokPublishProvenanceService,
} from '../services/extension-workbench-byok-publish-provenance.js';
import {
  createOzonListingPublisher,
} from '../services/ozon-listing-publisher.js';
import {
  createPrismaOzonPublishAttemptRepository,
} from '../services/ozon-publish-attempt-prisma.js';
import {
  hashOzonPublishJson,
} from '../services/ozon-publish-attempts.js';
import {
  createPrismaSourceListingWorkflowRepository,
} from '../services/source-listing-workflow-prisma.js';
import {
  createSourceListingWorkflowService,
  hashOzonListingPublishState,
} from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const commandSecret = 'byok-publish-postgres-command-secret-0123456789';
const providerOrigin = 'https://provider.example';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validationReport() {
  return {
    schemaVersion: 'ozon-attribute-validation/v1',
    schemaRevision: 'schema-1',
    normalizedAttributes: [],
    fieldDecisions: [],
    operationReadiness: {
      ozonImport: { status: 'READY', issues: [] },
      inventoryActivation: { status: 'READY', issues: [] },
      costingAutoPricing: { status: 'READY', issues: [] },
    },
  };
}

describePostgres('extension BYOK publish PostgreSQL vertical closure', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    const schema = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('ingests, revalidates, confirms, publishes, and links one zero-cost receipt', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `byok_publish_owner_${suffix}`;
    const shopId = `byok_publish_shop_${suffix}`;
    const goodsId = `byok_publish_goods_${suffix}`;
    const subjectId = `byok_publish_subject_${suffix}`;
    const snapshotId = `byok_publish_snapshot_${suffix}`;
    const sourceAssetId = `source_publish_asset_${suffix}`;
    const byokAssetId = `byok_publish_asset_${suffix}`;
    const executionIntentId = `byok_publish_intent_${suffix}`;
    const catalogSnapshotId = `byok_publish_catalog_${suffix}`;
    const catalogRevision = 'c'.repeat(64);
    const resultSha256 = 'a'.repeat(64);
    const now = new Date();

    await client.user.create({
      data: { id: ownerUserId, phone: `byok_publish_${suffix}`, passwordHash: 'integration-test' },
    });
    await client.shop.create({
      data: {
        id: shopId, userId: ownerUserId, platform: 'OZON', name: 'BYOK publish shop',
        apiKeyEncrypted: 'integration-test',
      },
    });
    await client.ozonCategoryCatalogSnapshot.create({
      data: {
        id: catalogSnapshotId,
        shopId,
        schemaVersion: 'ozon-category-catalog/v1',
        revision: catalogRevision,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
        complete: true,
        defaultTreeComplete: true,
        zhHansTreeComplete: true,
        isCurrent: true,
      },
    });
    await client.supplyGoods.create({
      data: {
        id: goodsId, userId: ownerUserId, title: 'BYOK publish fixture',
        sourcePlatform: '1688', sourceProductId: `source_${suffix}`,
      },
    });
    await client.sourceCaptureSubject.create({
      data: {
        id: subjectId, ownerUserId, sourcePlatform: '1688',
        sourceProductId: `source_${suffix}`, legacySupplyGoodsId: goodsId,
      },
    });
    await client.sourceCaptureSnapshot.create({ data: {
      id: snapshotId, subjectId, version: 1, schemaVersion: 'source-product-capture-v2',
      captureHash: 'b'.repeat(64), payloadBytes: 2, payload: {}, stageCounts: {},
      provenance: {}, provenanceComplete: true, parserVersion: 'integration', completeness: {},
      truncations: [], hasEstimatedValues: false, profile: {}, profileHash: 'c'.repeat(64),
      actorUserId: ownerUserId, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'integration',
      rolloutStage: 'v2_only', capturedAt: now,
    } });
    await client.mediaAsset.create({ data: {
      id: sourceAssetId, ownerUserId, kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId, sourceMediaKey: 'main',
      sourceUrl: 'https://source.example/main.png', url: `/uploads/${sourceAssetId}.png`,
      storageBackend: 'local', storageKey: `${sourceAssetId}.png`, mimeType: 'image/png',
      sizeBytes: 68, width: 1, height: 1, sha256: 'd'.repeat(64),
      metadata: { pixelOrientationNormalized: true },
    } });

    const deviceRepository = createPrismaExtensionDeviceSessionRepository({
      client,
      consumePairingClaimAttemptBudget: async () => true,
    });
    const authConfig = resolveExtensionDeviceAuthConfig({
      NODE_ENV: 'test',
      SS_ERP_DEPLOYMENT_ID: 'byok-publish-postgres',
      AUTH_JWT_ISSUER: 'ss-erp-byok-publish-postgres',
      EXTENSION_DEVICE_JWT_SECRET: 'byok-publish-device-secret-0123456789012345',
    });
    const deviceService = createExtensionDeviceSessionService({
      repository: deviceRepository,
      authConfig,
    });
    const pairing = await deviceService.createPairingCode({
      actorUserId: ownerUserId,
      ownerUserId,
      actorParentId: null,
      shopIds: [shopId],
      scopes: ['byok:media:ingest'],
    });
    const ingestClaimed = await deviceService.claimPairingCode({
      code: pairing.code,
      deviceId: `device_${suffix}`,
      deploymentId: authConfig.deploymentId,
    });

    const workflow = createSourceListingWorkflowService({
      repository: createPrismaSourceListingWorkflowRepository({ client: client as never }),
    });
    const created = await workflow.createDraft({
      ownerUserId, actorUserId: ownerUserId, shopId, supplyGoodsId: goodsId,
      sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: 'b'.repeat(64),
      selectedSkuKeys: ['sku-1'],
    });
    const categorized = await workflow.setCategory({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: created.revision,
      category: { categoryId: 10, typeId: 20, catalogRevision },
    });
    const candidate = await workflow.addAiCopyCandidate({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: categorized.revision, titleRu: 'Товар для продажи',
      descriptionRu: 'Описание товара.', sourcePromptVersion: 'copy-v1',
    });
    const copied = await workflow.applyAiCopyCandidate({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: candidate.draft.revision, candidateId: candidate.candidate.id,
      operationKey: `apply-${created.id}`,
    });
    const withSourceMedia = await workflow.setMediaAssignments({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: copied.revision,
      assignments: [{
        scope: 'PRODUCT', slotKey: 'product:hero', assetId: sourceAssetId, source: 'SOURCE',
      }],
    });
    const priced = await workflow.setPricing({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: withSourceMedia.revision,
      value: {
        contractVersion: 'ozon-listing-pricing/v1',
        items: [{
          skuKey: 'sku-1', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0',
        }],
      },
    });
    const readyBeforeIngest = await workflow.recordValidationResult({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: priced.revision, status: 'VALID', report: validationReport(),
      blockers: [], warnings: [],
    });

    const ingestCommand: ExtensionByokMediaIngestResolvedCommand = {
      schemaVersion: EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
      providerOrigin,
      providerOperation: 'TEXT_TO_IMAGE',
      requestMode: 'json',
      model: 'fixture-image-model',
      executionIntentId,
      providerIdempotencyKey: 'provider-attempt-0001',
      providerRequestHash: 'd'.repeat(64),
      providerRequestIdSha256: null,
      promptSha256: 'e'.repeat(64),
      negativePromptSha256: null,
      draftRevision: readyBeforeIngest.revision,
      skuKey: 'sku-1',
      slotKey: 'sku:sku-1:hero',
      assignmentOrdinal: 1,
      assignmentMode: 'APPEND',
      replaceConfirmed: false,
      resultSha256,
      resultMimeType: 'image/png',
      resultSizeBytes: 68,
      sourceSha256: null,
      referenceSha256s: [],
      maskSha256: null,
      readiness: { contractVersion: 'extension-byok-readiness/v1', policyRevision: 7 },
      authority: { sourceCaptureSnapshotId: snapshotId },
    };
    await client.extensionByokExecutionIntent.create({
      data: {
        id: executionIntentId,
        contractVersion: 'extension-byok-execution-intent/v1',
        executionMode: 'BYOK',
        ownerUserId,
        actorUserId: ownerUserId,
        deviceSessionId: ingestClaimed.session.id,
        shopId,
        listingWorkflowId: created.id,
        draftRevision: ingestCommand.draftRevision,
        draftVersion: readyBeforeIngest.draftVersion,
        sourceCaptureSnapshotId: snapshotId,
        supplyGoodsId: goodsId,
        skuKey: ingestCommand.skuKey,
        slotKey: ingestCommand.slotKey,
        assignmentMode: ingestCommand.assignmentMode,
        assignmentOrdinal: ingestCommand.assignmentOrdinal,
        policyRevision: ingestCommand.readiness.policyRevision,
        providerOriginSha256: sha256(ingestCommand.providerOrigin),
        model: ingestCommand.model,
        operation: ingestCommand.providerOperation,
        requestMode: ingestCommand.requestMode,
        providerIdempotencyKey: ingestCommand.providerIdempotencyKey,
        providerRequestHash: ingestCommand.providerRequestHash,
        requestHash: sha256(`${executionIntentId}:request`),
      },
    });
    await client.extensionByokExecutionIntent.update({
      where: { id: executionIntentId },
      data: {
        outcome: 'SUCCEEDED',
        resultSha256,
        outcomeUpdatedAt: new Date(),
      },
    });
    const ingestIdempotencyKey = `byok-ingest-${suffix}`;
    const ingestRequestHash = hashExtensionCommandRequest({
      operation: 'BYOK_MEDIA_INGEST', shopId, workflowId: created.id,
      draftVersion: readyBeforeIngest.draftVersion, command: ingestCommand,
    });
    const commandService = createExtensionCommandGrantService({
      store: createPrismaExtensionCommandGrantStore({ client }),
      secret: commandSecret,
    });
    const ingestGrant = await commandService.issue({
      sessionId: ingestClaimed.session.id,
      tokenId: ingestClaimed.session.currentJti,
      ownerUserId,
      shopId,
      operation: 'BYOK_MEDIA_INGEST',
      workflowId: created.id,
      draftVersion: readyBeforeIngest.draftVersion,
      idempotencyKey: ingestIdempotencyKey,
      requestHash: ingestRequestHash,
    });
    const committed = await createPrismaExtensionByokGeneratedAssetCommitter(client as never)({
      binding: {
        sessionId: ingestClaimed.session.id,
        tokenId: ingestClaimed.session.currentJti,
        ownerUserId,
        shopId,
        operation: 'BYOK_MEDIA_INGEST',
        workflowId: created.id,
        draftVersion: readyBeforeIngest.draftVersion,
        idempotencyKey: ingestIdempotencyKey,
        requestHash: ingestRequestHash,
      },
      tokenDigest: digestExtensionCommandGrantToken(commandSecret, ingestGrant.token),
      receiptId: `byok-ingest-receipt-${suffix}`,
      actorUserId: ownerUserId,
      now: new Date(),
      command: ingestCommand,
      asset: {
        id: byokAssetId,
        ownerUserId,
        aiImageJobId: null,
        kind: 'AI_GENERATED',
        sourceCaptureSnapshotId: snapshotId,
        sourceMediaKey: `extension-byok:${resultSha256}`,
        sourceUrl: null,
        url: `https://cdn.example/${byokAssetId}.png`,
        storageBackend: 'oss',
        storageKey: `users/${ownerUserId}/${byokAssetId}.png`,
        mimeType: 'image/png',
        sizeBytes: 68,
        width: 1,
        height: 1,
        sha256: resultSha256,
        metadata: {
          ingestContractVersion: BYOK_GENERATED_ASSET_INGEST_VERSION,
          normalizerVersion: BYOK_GENERATED_ASSET_NORMALIZER_VERSION,
          generatedAssetSource: 'EXTENSION_BYOK', executionMode: 'BYOK',
          outputRole: 'BYOK_ACCEPTED', pixelOrientationNormalized: true,
          idempotencyKeySha256: sha256(ingestIdempotencyKey),
          requestHash: ingestRequestHash,
          providerResultSha256: resultSha256,
          providerResultMimeType: 'image/png', providerResultSizeBytes: 68,
          normalizedSha256: resultSha256,
        },
      },
      stagingId: null,
    });
    expect(committed.replayed).toBe(false);

    const intermediatePairing = await deviceService.createPairingCode({
      actorUserId: ownerUserId,
      ownerUserId,
      actorParentId: null,
      shopIds: [shopId],
      scopes: ['byok:media:ingest'],
    });
    const intermediateClaimed = await deviceService.claimPairingCode({
      code: intermediatePairing.code,
      deviceId: `device_${suffix}`,
      deploymentId: authConfig.deploymentId,
    });
    expect(intermediateClaimed.session.id).not.toBe(ingestClaimed.session.id);
    expect(await client.extensionDeviceSession.findUnique({
      where: { id: intermediateClaimed.session.id },
      select: { replacesSessionId: true },
    })).toEqual({ replacesSessionId: ingestClaimed.session.id });

    const publishPairing = await deviceService.createPairingCode({
      actorUserId: ownerUserId,
      ownerUserId,
      actorParentId: null,
      shopIds: [shopId],
      scopes: ['byok:media:ingest', 'listing:publish'],
    });
    const publishClaimed = await deviceService.claimPairingCode({
      code: publishPairing.code,
      deviceId: `device_${suffix}`,
      deploymentId: authConfig.deploymentId,
    });
    expect(publishClaimed.session.id).not.toBe(ingestClaimed.session.id);
    const replacementLineage = await client.extensionDeviceSession.findUnique({
      where: { id: publishClaimed.session.id },
      select: { replacesSessionId: true },
    });
    expect(replacementLineage).toEqual({ replacesSessionId: intermediateClaimed.session.id });

    const boundDraft = await workflow.getDraft({ draftId: created.id, ownerUserId });
    expect(boundDraft).toMatchObject({
      revision: committed.receipt.boundDraftRevision,
      draftVersion: committed.receipt.boundDraftVersion,
      validation: { status: 'STALE' },
    });
    const readyToPublish = await workflow.recordValidationResult({
      draftId: created.id, ownerUserId, actorUserId: ownerUserId,
      expectedRevision: boundDraft.revision, status: 'VALID', report: validationReport(),
      blockers: [], warnings: [],
    });
    expect(readyToPublish).toMatchObject({
      stage: 'READY_TO_PUBLISH',
      draftVersion: committed.receipt.boundDraftVersion,
    });
    expect(readyToPublish.revision).toBeGreaterThan(committed.receipt.boundDraftRevision);

    const policy = {
      contractVersion: EXTENSION_BYOK_POLICY_VERSION,
      revision: 7,
      mode: 'pilot' as const,
      generationEnabled: true,
      ingestEnabled: true,
      publishEnabled: true,
      ownerUserIds: [ownerUserId],
      shopIds: [shopId],
      deviceSessionIds: [publishClaimed.session.id],
      allowedOrigins: [providerOrigin],
      allowedOperations: ['TEXT_TO_IMAGE' as const],
      maxConcurrency: 1,
    };
    const publishAuthorizer = createExtensionByokPublishAuthorizer({
      loadPolicy: async () => policy,
      ...createPrismaExtensionByokPublishProvenanceReader(client),
    });
    const provenanceService = createExtensionWorkbenchByokPublishProvenanceService(client);
    const statusRepository = createPrismaExtensionByokPublishStatusRepository(client);
    const loadAcceptedProvenance = async (provenanceId: string) => {
      const row = await client.extensionByokMediaProvenance.findFirst({
        where: { id: provenanceId, ownerUserId },
        include: { asset: { select: { sha256: true } } },
      });
      if (!row || row.executionMode !== 'BYOK' || row.asset.sha256 !== row.resultSha256) return null;
      return {
        id: row.id, executionMode: row.executionMode, ownerUserId: row.ownerUserId,
        actorUserId: row.actorUserId, deviceSessionId: row.deviceSessionId,
        shopId: row.shopId, workflowId: row.workflowId, draftRevision: row.draftRevision,
        draftVersion: row.draftVersion, boundDraftRevision: row.boundDraftRevision,
        boundDraftVersion: row.boundDraftVersion, skuKey: row.skuKey, slotKey: row.slotKey,
        assignmentOrdinal: row.assignmentOrdinal, assignmentSha256: row.assignmentSha256,
        assetId: row.assetId, normalizedSha256: row.asset.sha256,
        publishIntentId: row.publishIntentId, publishReceiptId: row.publishReceiptId,
        erpAiChargeCents: row.erpAiChargeCents,
      };
    };
    const publishService = createExtensionByokListingPublishService({
      loadDraft: ({ workflowId, ownerUserId: owner }) => workflow.getDraft({
        draftId: workflowId, ownerUserId: owner,
      }),
      loadAcceptedProvenance: ({ provenanceId }) => loadAcceptedProvenance(provenanceId),
      authorizePublish: publishAuthorizer,
      recordPublishIntent: (input) => workflow.recordPublishIntent(input),
      findPublishStatus: (input) => statusRepository.findStatus(input),
      linkPublish: (input) => provenanceService.linkStatus(input),
    });
    const authenticate = authenticateExtensionDevice({
      config: authConfig,
      loadAuthorization: (sessionId) => deviceRepository.loadAuthorization(sessionId),
    });
    const resolver = createSourceWorkflowCommandResolver({
      featureFlags: {
        evaluate: async () => ({
          enabled: true, legacyAllowed: false, revision: 'postgres-fixture', reason: 'enabled',
        }),
      } as never,
      authorizeByokPublish: publishAuthorizer,
      loadShop: async ({ shopId: requestedShopId, ownerUserId: owner }) => {
        const shop = await client.shop.findFirst({
          where: { id: requestedShopId, userId: owner },
          select: { id: true, userId: true, platform: true, status: true },
        });
        return shop && { ...shop, platform: String(shop.platform), status: String(shop.status) };
      },
      loadDraft: async ({ workflowId, ownerUserId: owner }) => {
        try {
          return await workflow.getDraft({ draftId: workflowId, ownerUserId: owner });
        } catch {
          return null;
        }
      },
    });
    const attemptRepository = createPrismaOzonPublishAttemptRepository({ client: client as never });
    let markSubmitStarted!: () => void;
    let releaseSubmit!: () => void;
    const submitStarted = new Promise<void>((resolve) => { markSubmitStarted = resolve; });
    const submitRelease = new Promise<void>((resolve) => { releaseSubmit = resolve; });
    const submitImportOnce = vi.fn(async () => {
      markSubmitStarted();
      await submitRelease;
      return { result: { task_id: '9007199254740997' } };
    });
    const ozonPublisher = createOzonListingPublisher({
      workflow: {
        getDraft: (input) => workflow.getDraft({
          draftId: input.draftId,
          ownerUserId: input.ownerUserId,
        }),
        recordPublishIntent: (input) => workflow.recordPublishIntent(input),
      },
      attempts: attemptRepository,
      compile: async ({ draft }) => {
        const catalogSnapshot = { revision: catalogRevision };
        const attributeSchemaSnapshot = { fields: [] };
        const offerId = `byok-fixture-${suffix}`;
        const requestPayload = { items: [{ offer_id: offerId }] };
        return {
          publisherContractVersion: 'ozon-listing-publisher/v1',
          endpoint: '/v3/product/import' as const,
          draftStateHash: hashOzonListingPublishState(draft),
          catalogSnapshotId,
          catalogRevision,
          catalogSnapshot,
          catalogSnapshotHash: hashOzonPublishJson(catalogSnapshot),
          attributeSchemaSnapshot,
          attributeSchemaHash: hashOzonPublishJson(attributeSchemaSnapshot),
          requestPayload,
          requestPayloadHash: hashOzonPublishJson(requestPayload),
          offerTrace: [{ ordinal: 0, offerId, skuKey: 'sku-1' }],
        };
      },
      submitImportOnce,
      authorizeDraftMediaPublish: publishAuthorizer,
      workerId: `byok-publish-worker-${suffix}`,
      leaseMs: 60_000,
    });
    const executeOzonPublish = vi.fn(async (input: {
      deviceSessionId: string;
      ownerUserId: string;
      actorUserId: string;
      shopId: string;
      workflowId: string;
      draftVersion: number;
      idempotencyKey: string;
      command: Record<string, unknown>;
    }) => {
      const expectedRevision = Number(input.command.draftRevision);
      const publishIntentId = String(input.command.publishIntentId || '').trim();
      if (!Number.isSafeInteger(expectedRevision) || !publishIntentId) {
        throw new Error('Ozon publish command identity is invalid');
      }
      return ozonPublisher.publish({
        draftId: input.workflowId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedRevision,
        idempotencyKey: input.idempotencyKey,
        requestingDeviceSessionId: input.deviceSessionId,
      });
    });
    const app = Fastify();
    await app.register(extensionByokPublishRoutes, {
      prefix: '/api/extension-device/byok-publish',
      authenticateDevice: authenticateExtensionDevice({
        config: authConfig,
        requiredScopes: ['listing:publish'],
        loadAuthorization: (sessionId) => deviceRepository.loadAuthorization(sessionId),
      }),
      service: publishService,
    });
    await app.register(extensionCommandGrantRoutes, {
      prefix: '/api/extension-device',
      authenticateDevice: authenticate,
      service: createExtensionCommandGrantService({
        store: createPrismaExtensionCommandGrantStore({ client }),
        secret: commandSecret,
      }),
      resolveCommand: resolver,
      executeOzonPublish,
    });
    const authHeaders = { authorization: `Bearer ${publishClaimed.accessToken}` };
    const binding = {
      contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
      shopId,
      workflowId: created.id,
      sourceDraftRevision: committed.receipt.draftRevision,
      sourceDraftVersion: committed.receipt.draftVersion,
      boundDraftRevision: committed.receipt.boundDraftRevision,
      boundDraftVersion: committed.receipt.boundDraftVersion,
      assetId: committed.receipt.assetId,
      provenanceId: committed.receipt.provenanceId,
      normalizedSha256: committed.receipt.normalizedSha256,
      skuKey: committed.receipt.skuKey,
      slotKey: committed.receipt.slotKey,
      assignmentOrdinal: committed.receipt.assignmentOrdinal,
      assignmentSha256: committed.receipt.assignmentSha256,
    };
    const preview = await app.inject({
      method: 'POST', url: '/api/extension-device/byok-publish/preview',
      headers: authHeaders, payload: binding,
    });
    expect(preview.statusCode).toBe(200);
    const idempotencyKey = `publish-operation-${suffix}`;
    const prepared = await app.inject({
      method: 'POST', url: '/api/extension-device/byok-publish/prepare',
      headers: authHeaders,
      payload: { ...binding, previewHash: preview.json().data.previewHash, idempotencyKey },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().data.envelope.command.draftRevision).toBe(readyToPublish.revision + 1);
    const replayedPrepare = await app.inject({
      method: 'POST', url: '/api/extension-device/byok-publish/prepare',
      headers: authHeaders,
      payload: { ...binding, previewHash: preview.json().data.previewHash, idempotencyKey },
    });
    expect(replayedPrepare.statusCode).toBe(200);
    expect(replayedPrepare.json().data).toEqual({ ...prepared.json().data, replayed: true });

    const envelope = prepared.json().data.envelope;
    const grant = await app.inject({
      method: 'POST', url: '/api/extension-device/command-grants',
      headers: authHeaders, payload: envelope,
    });
    expect(grant.statusCode).toBe(201);
    const executePayload = {
      shopId: envelope.shopId,
      workflowId: envelope.workflowId,
      draftVersion: envelope.draftVersion,
      idempotencyKey: envelope.idempotencyKey,
      command: envelope.command,
    };
    const executeHeaders = {
      ...authHeaders,
      'x-ss-erp-command-grant': grant.json().data.grantToken,
    };
    const firstExecutePromise = app.inject({
      method: 'POST', url: '/api/extension-device/ozon-publish/execute',
      headers: executeHeaders, payload: executePayload,
    });
    const firstBoundary = await Promise.race([
      submitStarted.then(() => ({ kind: 'submitting' as const })),
      firstExecutePromise.then((response) => ({ kind: 'completed' as const, response })),
    ]);
    if (firstBoundary.kind === 'completed') {
      const body = firstBoundary.response.json();
      const attemptDiagnostic = await client.ozonPublishAttempt.findUnique({
        where: { publishIntentId: envelope.command.publishIntentId },
        select: { lastErrorCode: true, lastErrorMessage: true },
      });
      throw new Error(JSON.stringify({
        stage: 'before_provider_submission',
        status: firstBoundary.response.statusCode,
        code: body.code,
        errorCode: body.errorCode || null,
        receiptStatus: body.data?.receipt?.status || null,
        failureCode: body.data?.receipt?.failureCode || null,
        attemptErrorCode: attemptDiagnostic?.lastErrorCode || null,
        attemptErrorMessage: attemptDiagnostic?.lastErrorMessage || null,
      }));
    }
    let duplicateExecute;
    try {
      duplicateExecute = await app.inject({
        method: 'POST', url: '/api/extension-device/ozon-publish/execute',
        headers: executeHeaders, payload: executePayload,
      });
    } finally {
      releaseSubmit();
    }
    const firstExecute = await firstExecutePromise;
    const responseDiagnostics = [firstExecute, duplicateExecute].map((response) => {
      const body = response.json();
      return {
        status: response.statusCode,
        code: body.code,
        errorCode: body.errorCode || null,
        receiptStatus: body.data?.receipt?.status || null,
        failureCode: body.data?.receipt?.failureCode || null,
        replay: body.data?.replay ?? null,
      };
    });
    expect([firstExecute.statusCode, duplicateExecute.statusCode]
      .every((status) => [200, 202].includes(status)), JSON.stringify(responseDiagnostics)).toBe(true);
    expect(executeOzonPublish).toHaveBeenCalledTimes(1);
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
    const completedReplay = await app.inject({
      method: 'POST', url: '/api/extension-device/ozon-publish/execute',
      headers: executeHeaders, payload: executePayload,
    });
    expect(completedReplay.statusCode).toBe(200);
    expect(completedReplay.json()).toMatchObject({
      code: 1,
      data: { receipt: { status: 'SUCCEEDED' }, replay: true },
    });
    expect(executeOzonPublish).toHaveBeenCalledTimes(1);
    expect(submitImportOnce).toHaveBeenCalledTimes(1);

    const status = await app.inject({
      method: 'POST', url: '/api/extension-device/byok-publish/status',
      headers: authHeaders,
      payload: {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        previewHash: prepared.json().data.previewHash,
        requestHash: prepared.json().data.requestHash,
        provenanceId: committed.receipt.provenanceId,
        envelope,
      },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      code: 1, data: { state: 'SUCCEEDED', receiptId: expect.any(String), failureCode: null },
    });

    const [intentCount, publishGrantCount, publishReceiptCount, provenanceRow, attemptRow] = await Promise.all([
      client.sourceListingPublishIntent.count({ where: { ownerUserId, idempotencyKey } }),
      client.extensionCommandGrant.count({
        where: { sessionId: publishClaimed.session.id, idempotencyKey, operation: 'OZON_PUBLISH' },
      }),
      client.extensionCommandReceipt.count({
        where: { grant: { sessionId: publishClaimed.session.id, idempotencyKey } },
      }),
      client.extensionByokMediaProvenance.findUnique({
        where: { id: committed.receipt.provenanceId },
        select: { publishIntentId: true, publishReceiptId: true, erpAiChargeCents: true },
      }),
      client.ozonPublishAttempt.findUnique({
        where: { publishIntentId: envelope.command.publishIntentId },
        select: {
          state: true,
          reconciliationState: true,
          ozonTaskId: true,
          acceptanceSource: true,
          submitStartedAt: true,
          submittedAt: true,
        },
      }),
    ]);
    expect({ intentCount, publishGrantCount, publishReceiptCount }).toEqual({
      intentCount: 1, publishGrantCount: 1, publishReceiptCount: 1,
    });
    expect(provenanceRow).toEqual({
      publishIntentId: envelope.command.publishIntentId,
      publishReceiptId: status.json().data.receiptId,
      erpAiChargeCents: 0,
    });
    expect(attemptRow).toMatchObject({
      state: 'SUBMITTED',
      reconciliationState: 'PENDING',
      ozonTaskId: '9007199254740997',
      acceptanceSource: 'OZON_TASK_RESPONSE',
      submitStartedAt: expect.any(Date),
      submittedAt: expect.any(Date),
    });
    const [reservationCount, settlementCount] = await Promise.all([
      client.aiCostReservation.count({ where: { ownerUserId } }),
      client.aiCostSettlement.count({ where: { ownerUserId } }),
    ]);
    expect({ reservationCount, settlementCount }).toEqual({
      reservationCount: 0, settlementCount: 0,
    });
    await app.close();
  }, 60_000);
});
