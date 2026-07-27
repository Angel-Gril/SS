import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaExtensionHostedAiImagePlanBindingStore,
  type ExtensionHostedAiImagePlanBindingPrismaClient,
} from '../services/extension-hosted-ai-image-plan-binding-prisma.js';
import { createExtensionHostedAiImagePlanBindingRecord } from '../services/extension-hosted-ai-image-plan.js';
import {
  createPrismaExtensionHostedAiImageAuthorityLoader,
  type ExtensionHostedAiImageAuthorityPrismaClient,
} from '../services/extension-hosted-ai-image-authority-prisma.js';
import type { ExtensionHostedCandidatePreviewBinding } from '../services/extension-hosted-ai-image-suite-candidate-preview.js';
import { AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION } from '../services/ai-image-suite-output-normalizer.js';
import {
  createPrismaHostedSuiteListingDraftAssignmentRepository,
  type HostedSuiteListingDraftAssignmentPrismaClient,
} from '../services/hosted-suite-listing-draft-assignment-prisma.js';
import {
  createHostedSuiteListingDraftAssignmentRequestHash,
  createHostedSuiteListingDraftAssignmentService,
  type AssignHostedSuiteOutputToListingDraftInput,
  type HostedSuiteListingDraftAssignmentRepository,
} from '../services/hosted-suite-listing-draft-assignment.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const ASSIGNMENT_TIME = new Date('2026-07-27T12:00:00.000Z');
const CAPTURE_TIME = new Date('2026-07-27T11:00:00.000Z');
const SOURCE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

function digest(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(item).sort().map((key) => [key, canonicalJson(item[key])]),
  );
}

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

function dedicatedDatabaseUrl(label: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('application_name', label.slice(0, 63));
  return url.toString();
}

interface HostedAssignmentFixture {
  ownerUserId: string;
  listingWorkflowId: string;
  jobIds: [string, string];
  candidateBindings: [
    ExtensionHostedCandidatePreviewBinding,
    ExtensionHostedCandidatePreviewBinding,
  ];
  input: AssignHostedSuiteOutputToListingDraftInput;
}

async function seedHostedAssignmentFixture(
  client: PrismaClient,
  label: string,
): Promise<HostedAssignmentFixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const prefix = `hosted_assign_${label}_${suffix}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const goodsId = `${prefix}_goods`;
  const subjectId = `${prefix}_subject`;
  const snapshotId = `${prefix}_snapshot`;
  const sourceAssetId = `${prefix}_source_asset`;
  const pairingCodeId = `${prefix}_pairing`;
  const deviceSessionId = `${prefix}_session`;
  const planId = `${prefix}_plan`;
  const planningRunId = `${prefix}_run`;
  const planVersionId = `${prefix}_version`;
  const suiteId = `${prefix}_suite`;
  const workflowIds = [0, 1].map((ordinal) => `${prefix}_workflow_${ordinal}`) as [string, string];
  const jobIds = [0, 1].map((ordinal) => `${prefix}_job_${ordinal}`) as [string, string];
  const reservationIds = [0, 1].map((ordinal) => `${prefix}_reservation_${ordinal}`) as [string, string];
  const settlementIds = [0, 1].map((ordinal) => `${prefix}_settlement_${ordinal}`) as [string, string];
  const outputAssetIds = [0, 1].map((ordinal) => `${prefix}_output_${ordinal}`) as [string, string];
  const suiteSlotIds = [0, 1].map((ordinal) => `${prefix}_slot_${ordinal}`) as [string, string];
  const skuKeys = ['sku-1', 'sku-2'] as const;
  const slotKeys = ['sku:sku-1:hero', 'sku:sku-2:hero'] as const;
  const candidateMediaKeys = ['candidate-1', 'candidate-2'];
  const captureHash = digest(`${prefix}:capture`);
  const sourceProfileHash = digest(`${prefix}:profile`);
  const sourceSha256 = digest(SOURCE_BYTES);

  await client.user.create({
    data: {
      id: ownerUserId,
      phone: `${prefix}_phone`,
      passwordHash: 'integration-test',
    },
  });
  await client.shop.create({
    data: {
      id: shopId,
      userId: ownerUserId,
      platform: 'OZON',
      name: `${prefix} shop`,
      apiKeyEncrypted: 'integration-test',
    },
  });
  await client.supplyGoods.create({
    data: {
      id: goodsId,
      userId: ownerUserId,
      title: `${prefix} goods`,
      sourcePlatform: '1688',
      sourceProductId: `${prefix}_product`,
    },
  });
  await client.sourceCaptureSubject.create({
    data: {
      id: subjectId,
      ownerUserId,
      sourcePlatform: '1688',
      sourceProductId: `${prefix}_product`,
      legacySupplyGoodsId: goodsId,
    },
  });
  await client.sourceCaptureSnapshot.create({
    data: {
      id: snapshotId,
      subjectId,
      version: 1,
      schemaVersion: 'source-product-capture-v2',
      captureHash,
      payloadBytes: 2,
      payload: {},
      stageCounts: {},
      provenance: {},
      provenanceComplete: true,
      parserVersion: 'hosted-assignment-integration',
      completeness: {},
      truncations: [],
      hasEstimatedValues: false,
      profile: {},
      profileHash: sourceProfileHash,
      actorUserId: ownerUserId,
      ingestChannel: 'WEB_ACCOUNT',
      rolloutRevision: 'hosted-assignment-integration',
      rolloutStage: 'v2_only',
      capturedAt: CAPTURE_TIME,
    },
  });
  await client.mediaAsset.create({
    data: {
      id: sourceAssetId,
      ownerUserId,
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey: `${prefix}_source_media`,
      sourceUrl: `https://source.example/${prefix}.png`,
      url: `/uploads/${sourceAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${sourceAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: SOURCE_BYTES.length,
      width: 1,
      height: 1,
      sha256: sourceSha256,
      metadata: { pixelOrientationNormalized: true },
    },
  });

  let listingIdSequence = 0;
  const listingService = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({
      client: client as never,
      now: () => CAPTURE_TIME,
      createId: () => `${prefix}_listing_row_${++listingIdSequence}`,
    }),
    now: () => CAPTURE_TIME,
    idFactory: (kind) => `${prefix}_${kind}_${++listingIdSequence}`,
  });
  const draft = await listingService.createDraft({
    ownerUserId,
    actorUserId: ownerUserId,
    shopId,
    supplyGoodsId: goodsId,
    sourceCaptureSnapshotId: snapshotId,
    sourceCaptureHash: captureHash,
    selectedSkuKeys: [...skuKeys],
  });
  const mediaReviewDraft = structuredClone(draft);
  mediaReviewDraft.stage = 'MEDIA_REVIEW';
  await client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "source_listing_workflows" DISABLE TRIGGER USER',
    );
    await tx.$executeRawUnsafe(
      'ALTER TABLE "source_listing_draft_versions" DISABLE TRIGGER USER',
    );
    try {
      await tx.$executeRawUnsafe(
        `UPDATE "source_listing_draft_versions"
         SET "stage" = 'MEDIA_REVIEW', "payload" = $1::jsonb, "payload_hash" = $2
         WHERE "workflow_id" = $3 AND "owner_user_id" = $4 AND "revision" = $5`,
        JSON.stringify(mediaReviewDraft),
        digest(JSON.stringify(canonicalJson(mediaReviewDraft))),
        draft.id,
        ownerUserId,
        draft.revision,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "source_listing_workflows" SET "stage" = 'MEDIA_REVIEW'
         WHERE "id" = $1 AND "owner_user_id" = $2`,
        draft.id,
        ownerUserId,
      );
    } finally {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "source_listing_draft_versions" ENABLE TRIGGER USER',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE "source_listing_workflows" ENABLE TRIGGER USER',
      );
    }
  });

  await client.extensionDevicePairingCode.create({
    data: {
      id: pairingCodeId,
      deploymentId: 'hosted-assignment-integration',
      actorUserId: ownerUserId,
      ownerUserId,
      codeDigest: digest(`${prefix}:pairing`),
      shopIds: [shopId],
      scopes: ['media:read', 'listing:write'],
      status: 'CLAIMED',
      expiresAt: new Date(ASSIGNMENT_TIME.getTime() + 86_400_000),
      claimedAt: CAPTURE_TIME,
    },
  });
  await client.extensionDeviceSession.create({
    data: {
      id: deviceSessionId,
      pairingCodeId,
      deploymentId: 'hosted-assignment-integration',
      deviceId: `${prefix}_device`,
      actorUserId: ownerUserId,
      ownerUserId,
      scopes: ['media:read', 'listing:write'],
      currentJti: `${prefix}_jti`,
      expiresAt: new Date(ASSIGNMENT_TIME.getTime() + 86_400_000),
    },
  });
  await client.extensionDeviceShopGrant.create({
    data: { sessionId: deviceSessionId, shopId, status: 'ACTIVE', grantedAt: CAPTURE_TIME },
  });

  const planInputSnapshot = {
    source: { subjectId, snapshotId },
    context: { type: 'collect', id: goodsId },
    skus: skuKeys.map((skuKey) => ({ skuKey })),
    candidates: candidateMediaKeys.map((id) => ({ id })),
  };
  const planPayload = {
    compatibilityGroups: [],
    slots: skuKeys.map((skuKey, ordinal) => ({
      slotKey: slotKeys[ordinal],
      ownership: { level: 'sku', key: skuKey },
    })),
  };
  const triggerTables = [
    'ai_media_plans',
    'ai_media_planning_runs',
    'ai_media_plan_versions',
    'ai_media_suites',
    'ai_media_workflows',
    'ai_image_jobs',
    'ai_cost_reservations',
    'ai_cost_settlements',
    'media_assets',
    'ai_media_workflow_inputs',
    'ai_media_suite_slots',
    'ai_media_suite_events',
  ];
  await client.$transaction(async (tx) => {
    for (const table of triggerTables) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
    }
    try {
      const planFingerprint = digest(`${prefix}:plan-request`);
      const inputFingerprint = digest(`${prefix}:plan-input`);
      await tx.aiMediaPlan.create({
        data: {
          id: planId,
          ownerUserId,
          actorUserId: ownerUserId,
          sourceSubjectId: subjectId,
          contextType: 'collect',
          contextId: goodsId,
          idempotencyKey: `${prefix}_plan_key`,
          requestFingerprint: planFingerprint,
          revision: 6,
          latestVersion: 0,
          reviewStatus: 'NOT_READY',
        },
      });
      await tx.aiMediaPlanningRun.create({
        data: {
          id: planningRunId,
          planId,
          ownerUserId,
          sourceSubjectId: subjectId,
          actorUserId: ownerUserId,
          sourceCaptureSnapshotId: snapshotId,
          attempt: 1,
          revision: 1,
          mode: 'RULE_BASED',
          engineVersion: 'hosted-assignment-integration',
          status: 'SUCCEEDED',
          idempotencyKey: `${prefix}_run_key`,
          requestFingerprint: planFingerprint,
          sourceCaptureHash: captureHash,
          sourceProfileHash,
          inputFingerprint,
          inputSnapshot: planInputSnapshot,
          inputHash: digest(`${prefix}:input-hash`),
          inputBytes: JSON.stringify(planInputSnapshot).length,
          completedAt: new Date(CAPTURE_TIME.getTime() + 60_000),
        },
      });
      await tx.aiMediaPlanVersion.create({
        data: {
          id: planVersionId,
          planId,
          ownerUserId,
          sourceSubjectId: subjectId,
          version: 1,
          planningRunId,
          sourceCaptureSnapshotId: snapshotId,
          sourceCaptureHash: captureHash,
          sourceProfileHash,
          sourceSchemaVersion: 'source-product-capture-v2',
          selectedSkuHash: digest(JSON.stringify(skuKeys)),
          inputAssetSetHash: digest(JSON.stringify(candidateMediaKeys)),
          inputFingerprint,
          planSchemaVersion: 'hosted-assignment-integration',
          plannerVersion: 'hosted-assignment-integration',
          mode: 'RULE_BASED',
          inputSnapshot: planInputSnapshot,
          inputHash: digest(`${prefix}:input-hash`),
          curation: {},
          curationHash: digest(`${prefix}:curation`),
          visionEvidence: {},
          visionEvidenceHash: digest(`${prefix}:vision`),
          planPayload,
          planHash: digest(JSON.stringify(planPayload)),
          planBytes: JSON.stringify(planPayload).length,
          provenance: {},
          provenanceHash: digest(`${prefix}:provenance`),
          actorUserId: ownerUserId,
        },
      });
      await tx.aiMediaPlan.update({
        where: { id: planId },
        data: {
          latestVersion: 1,
          currentVersionId: planVersionId,
          approvedVersionId: planVersionId,
          reviewStatus: 'APPROVED',
          reviewedByUserId: ownerUserId,
          reviewedAt: new Date(CAPTURE_TIME.getTime() + 120_000),
        },
      });
      await tx.aiMediaSuite.create({
        data: {
          id: suiteId,
          ownerUserId,
          actorUserId: ownerUserId,
          planId,
          planVersionId,
          sourceSubjectId: subjectId,
          sourceCaptureSnapshotId: snapshotId,
          sourceCaptureHash: captureHash,
          sourceProfileHash,
          sourceSchemaVersion: 'source-product-capture-v2',
          contextType: 'collect',
          contextId: goodsId,
          status: 'SUCCEEDED',
          revision: 9,
          idempotencyKey: `${prefix}_suite_key`,
          requestFingerprint: digest(`${prefix}:suite-request`),
          previewHash: digest(`${prefix}:suite-preview`),
          provider: 'custom',
          model: 'image-model-v1',
          providerConfigHash: digest(`${prefix}:provider-config`),
          pricingVersion: 'hosted-assignment-integration',
          itemCount: 2,
          estimatedCostCents: 37,
          maximumCostCents: 37,
          concurrencyLimit: 1,
          completedAt: new Date(CAPTURE_TIME.getTime() + 300_000),
        },
      });

      for (const [ordinal, skuKey] of skuKeys.entries()) {
        const requestFingerprint = digest(`${prefix}:job:${ordinal}`);
        const actualCostMinor = 18 + ordinal;
        const outputSha256 = digest(`${prefix}:output:${ordinal}`);
        await tx.aiMediaWorkflow.create({
          data: {
            id: workflowIds[ordinal]!,
            ownerUserId,
            actorUserId: ownerUserId,
            operation: 'IMAGE_TO_IMAGE',
            status: 'SUCCEEDED',
            reviewStatus: 'NOT_READY',
            revision: 1,
            currentAttempt: 1,
            contextType: 'collect',
            contextId: goodsId,
            contextSkuKey: skuKey,
            contextSlotKey: slotKeys[ordinal],
            idempotencyKey: `${prefix}_workflow_key_${ordinal}`,
            requestFingerprint,
            completedAt: new Date(CAPTURE_TIME.getTime() + 180_000),
          },
        });
        await tx.aiImageJob.create({
          data: {
            id: jobIds[ordinal]!,
            executionMode: 'ERP_HOSTED',
            ownerUserId,
            actorUserId: ownerUserId,
            status: 'SUCCEEDED',
            operation: 'IMAGE_TO_IMAGE',
            workflowId: workflowIds[ordinal]!,
            workflowAttempt: 1,
            provider: 'custom',
            model: 'image-model-v1',
            prompt: `Hosted assignment prompt ${ordinal}`,
            requestFingerprint,
            requestedImageCount: 1,
            width: 900,
            height: 1_200,
            attemptCount: 1,
            maxAttempts: 1,
            progress: 100,
            idempotencyKey: `${prefix}_job_key_${ordinal}`,
            providerDispatchedAt: new Date(CAPTURE_TIME.getTime() + 120_000),
            estimatedCostCents: actualCostMinor,
            actualCostCents: actualCostMinor,
            billedUnits: 1,
            startedAt: new Date(CAPTURE_TIME.getTime() + 120_000),
            completedAt: new Date(CAPTURE_TIME.getTime() + 180_000),
          },
        });
        await tx.aiMediaWorkflowInput.create({
          data: {
            id: `${prefix}_workflow_input_${ordinal}`,
            workflowId: workflowIds[ordinal]!,
            ownerUserId,
            assetId: sourceAssetId,
            role: 'REFERENCE',
            ordinal: 0,
            assetSha256: sourceSha256,
            assetUrl: `/uploads/${sourceAssetId}.png`,
            mimeType: 'image/png',
            width: 1,
            height: 1,
          },
        });
        await tx.aiCostReservation.create({
          data: {
            id: reservationIds[ordinal]!,
            ownerUserId,
            actorUserId: ownerUserId,
            workflowId: workflowIds[ordinal]!,
            jobId: jobIds[ordinal]!,
            idempotencyKey: `${prefix}_reservation_key_${ordinal}`,
            requestFingerprint,
            provider: 'custom',
            model: 'image-model-v1',
            operation: 'IMAGE_TO_IMAGE',
            currency: 'USD',
            estimatedCostMinor: actualCostMinor,
            maximumCostMinor: actualCostMinor,
            status: 'SETTLED',
            settledAt: new Date(CAPTURE_TIME.getTime() + 210_000),
          },
        });
        await tx.aiCostSettlement.create({
          data: {
            id: settlementIds[ordinal]!,
            reservationId: reservationIds[ordinal]!,
            ownerUserId,
            actorUserId: ownerUserId,
            kind: ordinal === 0 ? 'CHARGE' : 'RECONCILED_CHARGE',
            idempotencyKey: `${prefix}_settlement_key_${ordinal}`,
            requestFingerprint,
            actualCostMinor,
            billedUnits: 1,
          },
        });
        await tx.mediaAsset.create({
          data: {
            id: outputAssetIds[ordinal]!,
            ownerUserId,
            aiImageJobId: jobIds[ordinal]!,
            kind: 'AI_GENERATED',
            sourceCaptureSnapshotId: snapshotId,
            url: `/uploads/${outputAssetIds[ordinal]}.png`,
            storageBackend: 'oss',
            storageKey: `owners/${ownerUserId}/ai/${suiteId}/output-${ordinal}.png`,
            mimeType: 'image/png',
            sizeBytes: 128_000,
            width: 900,
            height: 1_200,
            sha256: outputSha256,
            metadata: {
              version: 'ai-image-suite-output/v1',
              normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
              suiteId,
              slotId: suiteSlotIds[ordinal],
              attempt: 1,
              providerOutputAssetId: `${prefix}_provider_output_${ordinal}`,
              sourceCaptureSnapshotId: snapshotId,
            },
          },
        });
        await tx.aiMediaWorkflow.update({
          where: { id: workflowIds[ordinal]! },
          data: {
            reviewStatus: 'APPROVED',
            revision: 3 + ordinal,
            selectedOutputAssetId: outputAssetIds[ordinal]!,
            reviewedByUserId: ownerUserId,
            reviewedAt: new Date(CAPTURE_TIME.getTime() + 240_000),
          },
        });
        await tx.aiMediaSuiteSlot.create({
          data: {
            id: suiteSlotIds[ordinal]!,
            suiteId,
            ownerUserId,
            ordinal,
            slotKey: slotKeys[ordinal]!,
            goal: 'hero',
            ownershipLevel: 'sku',
            ownershipKey: skuKey,
            slotSnapshot: {},
            slotHash: digest(`${prefix}:slot:${ordinal}`),
            referencesSnapshot: [],
            referencesHash: digest(`${prefix}:references:${ordinal}`),
            diagnostics: {},
            status: 'SUCCEEDED',
            childWorkflowId: workflowIds[ordinal]!,
            attempt: 1,
            revision: 4 + ordinal,
            estimatedCostCents: actualCostMinor,
            maximumCostCents: actualCostMinor,
          },
        });
      }
      const aggregatePayload = {
        version: 'ai-image-suite-execution-event/v1',
        suiteId,
        ownerUserId,
        actorUserId: ownerUserId,
        beforeRevision: 8,
        afterRevision: 9,
        beforeStatus: 'RUNNING',
        afterStatus: 'SUCCEEDED',
        counts: {
          planned: 0,
          queued: 0,
          running: 0,
          succeeded: 2,
          failed: 0,
          cancelRequested: 0,
          cancelled: 0,
          total: 2,
          active: 0,
        },
      };
      await tx.aiMediaSuiteEvent.create({
        data: {
          id: `${prefix}_suite_event_9`,
          suiteId,
          ownerUserId,
          revision: 9,
          actorUserId: ownerUserId,
          eventKey: `${suiteId}:execution:9`,
          eventType: 'SUITE_CHILD_SUCCEEDED',
          payload: aggregatePayload,
          payloadHash: digest(JSON.stringify(aggregatePayload)),
        },
      });
    } finally {
      for (const table of [...triggerTables].reverse()) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      }
    }
  }, { timeout: 30_000 });

  const binding = createExtensionHostedAiImagePlanBindingRecord({
    planId,
    identity: {
      ownerUserId,
      actorUserId: ownerUserId,
      deviceSessionId,
    },
    binding: {
      snapshotId,
      supplyGoodsId: goodsId,
      shopId,
      listingWorkflowId: draft.id,
      draftRevision: draft.revision,
      draftVersion: draft.draftVersion,
    },
    selectedSkuKeys: [...skuKeys],
    candidateMediaKeys,
  });
  const bindingStore = createPrismaExtensionHostedAiImagePlanBindingStore(
    client as unknown as ExtensionHostedAiImagePlanBindingPrismaClient,
    { createId: () => `${prefix}_binding` },
  );
  await expect(bindingStore.bind(binding)).resolves.toMatchObject({ kind: 'bound' });

  return {
    ownerUserId,
    listingWorkflowId: draft.id,
    jobIds,
    candidateBindings: skuKeys.map((_skuKey, ordinal) => ({
      snapshotId,
      supplyGoodsId: goodsId,
      shopId,
      listingWorkflowId: draft.id,
      draftRevision: draft.revision,
      draftVersion: draft.draftVersion,
      planId,
      planVersionId,
      planRevision: 6,
      suiteId,
      suiteRevision: 9,
      slotId: suiteSlotIds[ordinal]!,
      slotRevision: 4 + ordinal,
      workflowId: workflowIds[ordinal]!,
      workflowRevision: 3 + ordinal,
      outputAssetId: outputAssetIds[ordinal]!,
    })) as [ExtensionHostedCandidatePreviewBinding, ExtensionHostedCandidatePreviewBinding],
    input: {
      ownerUserId,
      actorUserId: ownerUserId,
      deviceSessionId,
      shopId,
      listingWorkflowId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion,
      sourceCaptureSnapshotId: snapshotId,
      assignmentStartOrdinal: 0,
      planId,
      planVersionId,
      expectedPlanRevision: 6,
      suiteId,
      expectedSuiteRevision: 9,
      idempotencyKey: `${prefix}_assignment_key`,
      items: skuKeys.map((skuKey, ordinal) => ({
        skuKey,
        slotKey: slotKeys[ordinal]!,
        suiteSlotId: suiteSlotIds[ordinal]!,
        expectedSuiteSlotRevision: 4 + ordinal,
        childWorkflowId: workflowIds[ordinal]!,
        expectedChildWorkflowRevision: 3 + ordinal,
        outputAssetId: outputAssetIds[ordinal]!,
      })),
    },
  };
}

function preserveFailedTransactionState(
  repository: HostedSuiteListingDraftAssignmentRepository,
): HostedSuiteListingDraftAssignmentRepository {
  return {
    async transaction<T>(operation: Parameters<HostedSuiteListingDraftAssignmentRepository['transaction']>[0]) {
      const envelope = await repository.transaction(async (transaction) => {
        try {
          return { ok: true as const, value: await operation(transaction) };
        } catch (error) {
          return { ok: false as const, error };
        }
      });
      if (!envelope.ok) throw envelope.error;
      return envelope.value as T;
    },
  };
}

function assignmentService(
  client: PrismaClient,
  preserveFailure = false,
) {
  const repository = createPrismaHostedSuiteListingDraftAssignmentRepository(
    client as unknown as HostedSuiteListingDraftAssignmentPrismaClient,
  );
  return createHostedSuiteListingDraftAssignmentService(
    preserveFailure ? preserveFailedTransactionState(repository) : repository,
    { now: () => ASSIGNMENT_TIME },
  );
}

async function persistedState(client: PrismaClient, fixture: HostedAssignmentFixture) {
  const [ledger, versions, workflow, jobs] = await Promise.all([
    client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM "extension_hosted_ai_image_listing_assignments"
       WHERE "owner_user_id" = $1`,
      fixture.ownerUserId,
    ),
    client.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM "source_listing_draft_versions"
       WHERE "workflow_id" = $1 AND "owner_user_id" = $2`,
      fixture.listingWorkflowId,
      fixture.ownerUserId,
    ),
    client.sourceListingWorkflow.findUniqueOrThrow({
      where: { id: fixture.listingWorkflowId },
      select: { currentRevision: true, currentDraftVersion: true },
    }),
    client.aiImageJob.findMany({
      where: { id: { in: fixture.jobIds } },
      orderBy: { id: 'asc' },
      select: { id: true, appliedAt: true, applyTargetId: true },
    }),
  ]);
  return {
    ledgerCount: ledger[0]?.count || 0,
    draftVersionCount: versions[0]?.count || 0,
    workflow,
    jobs,
  };
}

async function waitForLockWaiters(
  observer: PrismaClient,
  applicationNames: [string, string],
): Promise<number> {
  let waiting = 0;
  for (let attempt = 0; attempt < 100 && waiting !== 2; attempt += 1) {
    const rows = await observer.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count"
       FROM pg_stat_activity
       WHERE "application_name" IN ($1, $2) AND "wait_event_type" = 'Lock'`,
      applicationNames[0],
      applicationNames[1],
    );
    waiting = rows[0]?.count || 0;
    if (waiting !== 2) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return waiting;
}

describePostgres('hosted suite listing-draft assignment PostgreSQL atomicity', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasourceUrl: databaseUrl });
    await client.$connect();
    const schemas = await client.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS "schema"',
    );
    expect(schemas[0]?.schema).toBe(expectedSchema);
    const migrations = await client.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName"
       FROM "_prisma_migrations"
       WHERE "migration_name" = '20260727100000_add_extension_hosted_ai_image_plan_bindings'
         AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
    );
    expect(migrations).toHaveLength(1);
    const constraints = await client.$queryRawUnsafe<Array<{
      deferrable: boolean;
      initiallyDeferred: boolean;
    }>>(
      `SELECT "condeferrable" AS "deferrable", "condeferred" AS "initiallyDeferred"
       FROM pg_constraint
       WHERE "conname" = 'extension_hosted_listing_assignment_bound_draft_fkey'`,
    );
    expect(constraints).toEqual([{ deferrable: true, initiallyDeferred: true }]);
  }, 30_000);

  afterAll(async () => client?.$disconnect());

  it('commits two slots once through the deferred draft fence and replays the exact batch', async () => {
    const fixture = await seedHostedAssignmentFixture(client, 'success');
    const service = assignmentService(client);
    let candidateGraphRow: unknown = null;
    const authorityClient: ExtensionHostedAiImageAuthorityPrismaClient = {
      async $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T> {
        const rows = await client.$queryRawUnsafe<unknown[]>(query, ...values);
        if (query.includes('AS "settledCostEvidence"')) candidateGraphRow = rows[0] || null;
        return rows as T;
      },
    };
    const authorityLoader = createPrismaExtensionHostedAiImageAuthorityLoader(authorityClient);

    const reconciledPreviewAuthority = await authorityLoader.loadCandidateAuthority({
      ownerUserId: fixture.ownerUserId,
      deviceSessionId: fixture.input.deviceSessionId,
      binding: fixture.candidateBindings[1],
    });
    expect(
      reconciledPreviewAuthority,
      `Candidate graph row: ${JSON.stringify(candidateGraphRow)}`,
    ).not.toBeNull();
    expect(reconciledPreviewAuthority).toMatchObject({
      binding: fixture.candidateBindings[1],
      job: { costReservationStatus: 'SETTLED' },
      output: { id: fixture.input.items[1]!.outputAssetId },
    });

    const committed = await service.assign(fixture.input);
    expect(committed).toMatchObject({
      replayed: false,
      sourceDraftRevision: 1,
      sourceDraftVersion: 1,
      boundDraftRevision: 2,
      boundDraftVersion: 2,
      assignments: [
        { assignmentOrdinal: 0, assignmentScope: 'SKU', skuKey: 'sku-1' },
        { assignmentOrdinal: 1, assignmentScope: 'SKU', skuKey: 'sku-2' },
      ],
    });
    const afterCommit = await persistedState(client, fixture);
    expect(afterCommit).toMatchObject({
      ledgerCount: 2,
      draftVersionCount: 2,
      workflow: { currentRevision: 2, currentDraftVersion: 2 },
    });
    expect(afterCommit.jobs).toHaveLength(2);
    expect(afterCommit.jobs.every((job) => job.appliedAt instanceof Date
      && job.applyTargetId === fixture.listingWorkflowId)).toBe(true);
    const rows = await client.$queryRawUnsafe<Array<{
      batchItemOrdinal: number;
      assignmentOrdinal: number;
      settlementKind: string;
    }>>(
      `SELECT assignment."batch_item_ordinal" AS "batchItemOrdinal",
              assignment."assignment_ordinal" AS "assignmentOrdinal",
              settlement."kind"::text AS "settlementKind"
       FROM "extension_hosted_ai_image_listing_assignments" assignment
       JOIN "ai_cost_settlements" settlement ON settlement."id" = assignment."settlement_id"
       WHERE assignment."owner_user_id" = $1
       ORDER BY assignment."batch_item_ordinal"`,
      fixture.ownerUserId,
    );
    expect(rows).toEqual([
      { batchItemOrdinal: 0, assignmentOrdinal: 0, settlementKind: 'CHARGE' },
      { batchItemOrdinal: 1, assignmentOrdinal: 1, settlementKind: 'RECONCILED_CHARGE' },
    ]);

    await expect(service.assign(fixture.input)).resolves.toMatchObject({ replayed: true });
    expect(await persistedState(client, fixture)).toEqual(afterCommit);
  }, 30_000);

  it('uses the savepoint to undo the ledger, draft, and first job when the second job fence fails', async () => {
    const fixture = await seedHostedAssignmentFixture(client, 'job_fence');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const functionName = `hosted_assignment_skip_job_${suffix}`;
    const triggerName = `hosted_assignment_skip_job_trigger_${suffix}`;
    await client.$executeRawUnsafe(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $body$
      BEGIN
        IF NEW."id" = '${fixture.jobIds[1]}'
          AND OLD."applied_at" IS NULL AND NEW."applied_at" IS NOT NULL THEN
          RETURN NULL;
        END IF;
        RETURN NEW;
      END;
      $body$ LANGUAGE plpgsql
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF "applied_at" ON "ai_image_jobs"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `);
    try {
      await expect(assignmentService(client, true).assign(fixture.input)).rejects.toMatchObject({
        code: 'HOSTED_LISTING_ASSIGNMENT_CAS_CONFLICT',
      });
      expect(await persistedState(client, fixture)).toMatchObject({
        ledgerCount: 0,
        draftVersionCount: 1,
        workflow: { currentRevision: 1, currentDraftVersion: 1 },
        jobs: [{ appliedAt: null }, { appliedAt: null }],
      });
    } finally {
      await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "ai_image_jobs"`);
      await client.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
  }, 30_000);

  it('rolls back a real partial ON CONFLICT batch without leaving a losing row', async () => {
    const fixture = await seedHostedAssignmentFixture(client, 'on_conflict');
    const indexName = `hosted_assignment_one_row_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await client.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${indexName}"
      ON "extension_hosted_ai_image_listing_assignments" ((1))
      WHERE "owner_user_id" = '${fixture.ownerUserId}'
    `);
    try {
      await expect(assignmentService(client, true).assign(fixture.input)).rejects.toMatchObject({
        code: 'HOSTED_LISTING_ASSIGNMENT_CAS_CONFLICT',
      });
      expect(await persistedState(client, fixture)).toMatchObject({
        ledgerCount: 0,
        draftVersionCount: 1,
        workflow: { currentRevision: 1, currentDraftVersion: 1 },
        jobs: [{ appliedAt: null }, { appliedAt: null }],
      });
    } finally {
      await client.$executeRawUnsafe(`DROP INDEX IF EXISTS "${indexName}"`);
    }
  }, 30_000);

  it('serializes concurrent different-key batches to one complete winner', async () => {
    const fixture = await seedHostedAssignmentFixture(client, 'different_key_race');
    const raceSuffix = randomUUID().replaceAll('-', '').slice(0, 8);
    const applicationNames: [string, string] = [
      `hosted_assignment_a_${raceSuffix}`,
      `hosted_assignment_b_${raceSuffix}`,
    ];
    const gate = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(`hosted_gate_${raceSuffix}`) });
    const first = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(applicationNames[0]) });
    const second = new PrismaClient({ datasourceUrl: dedicatedDatabaseUrl(applicationNames[1]) });
    await Promise.all([gate.$connect(), first.$connect(), second.$connect()]);
    let releaseGate = () => {};
    let signalGateReady = () => {};
    const gateRelease = new Promise<void>((resolve) => { releaseGate = resolve; });
    const gateReady = new Promise<void>((resolve) => { signalGateReady = resolve; });
    const gateTransaction = gate.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT 1 FROM "source_listing_workflows"
         WHERE "id" = $1 AND "owner_user_id" = $2 FOR UPDATE`,
        fixture.listingWorkflowId,
        fixture.ownerUserId,
      );
      signalGateReady();
      await gateRelease;
    }, { timeout: 15_000 });
    let pending: Promise<PromiseSettledResult<unknown>[]> | null = null;
    let results: PromiseSettledResult<unknown>[];
    try {
      await gateReady;
      pending = Promise.allSettled([
        assignmentService(first).assign({
          ...fixture.input,
          idempotencyKey: `${fixture.input.idempotencyKey}_a`,
        }),
        assignmentService(second).assign({
          ...fixture.input,
          idempotencyKey: `${fixture.input.idempotencyKey}_b`,
        }),
      ]);
      expect(await waitForLockWaiters(client, applicationNames)).toBe(2);
      releaseGate();
      await gateTransaction;
      results = await pending;
    } finally {
      releaseGate();
      await gateTransaction.catch(() => undefined);
      await pending?.catch(() => undefined);
      await Promise.all([gate.$disconnect(), first.$disconnect(), second.$disconnect()]);
    }

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const state = await persistedState(client, fixture);
    expect(state).toMatchObject({
      ledgerCount: 2,
      draftVersionCount: 2,
      workflow: { currentRevision: 2, currentDraftVersion: 2 },
    });
    expect(state.jobs.every((job) => job.appliedAt instanceof Date)).toBe(true);
    const batches = await client.$queryRawUnsafe<Array<{
      idempotencyKey: string;
      requestHash: string;
      rowCount: number;
    }>>(
      `SELECT "idempotency_key" AS "idempotencyKey", "request_hash" AS "requestHash",
              COUNT(*)::int AS "rowCount"
       FROM "extension_hosted_ai_image_listing_assignments"
       WHERE "owner_user_id" = $1
       GROUP BY "idempotency_key", "request_hash"`,
      fixture.ownerUserId,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.rowCount).toBe(2);
    const possibleHashes = ['a', 'b'].map((key) => createHostedSuiteListingDraftAssignmentRequestHash({
      ...fixture.input,
      idempotencyKey: `${fixture.input.idempotencyKey}_${key}`,
    }));
    expect(possibleHashes).toContain(batches[0]?.requestHash);
  }, 30_000);
});
