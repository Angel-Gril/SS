import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  aiImageRoutes,
  resolveAiImageEditReadiness,
  resolveAiImageToImageReadiness,
} from '../routes/ai-images.js';
import type { AiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import { AiMediaApplicationMutationError } from '../services/ai-media-application-mutations.js';
import { AiImageJobError } from '../services/ai-image-jobs.js';
import { AiMediaWorkflowError, type AiMediaWorkflowRecord } from '../services/ai-media-workflows.js';
import { AiMediaContextError } from '../services/ai-media-context.js';

const workflow: AiMediaWorkflowRecord = {
  id: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
  operation: 'IMAGE_TO_IMAGE', status: 'QUEUED', reviewStatus: 'NOT_READY',
  revision: 1, currentAttempt: 1, contextType: 'collect', contextId: 'goods-1',
  contextSkuKey: null, contextSlotKey: null, contextDraftRevision: null,
  contextDraftVersion: null, idempotencyKey: 'workflow-idem-1',
  requestFingerprint: 'secret-fingerprint', selectedOutputAssetId: null,
  createdAt: new Date(), updatedAt: new Date(), completedAt: null,
  inputs: [{ id: 'input-1', assetId: 'asset-1', role: 'REFERENCE', ordinal: 0, assetUrl: '/images/source.png', mimeType: 'image/png', asset: { storageKey: 'secret-key' } }],
  jobs: [{
    id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', status: 'SUCCEEDED',
    operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-to-image-v1',
    requestedImageCount: 1, width: 1024, height: 1024, estimatedCostCents: 0,
    prompt: 'Keep product', costReservation: { status: 'RELEASED', maximumCostMinor: 99 },
    assets: [
      { id: 'output-1', kind: 'AI_GENERATED', url: '/output.png', storageKey: 'secret-output-key', storageBackend: 'oss' },
      { id: 'raw-output-1', kind: 'AI_PROVIDER_OUTPUT', url: '/provider-raw.png', storageKey: 'secret-raw-key', storageBackend: 'oss' },
    ],
  }], events: [],
};

const customEditEndpointSha256 =
  '889271d70d18282b00bbed393fc85cc923bc38817f3aea457379d58f98bd9d3b';
const otherEditEndpointSha256 =
  'a3d9c9d847e21f89d3a11ba60f2fcfa16546a2cb9d601c28c67ca7e079171fe2';

function customEditCapability(endpointSha256: string): AiImageProviderCapability {
  return {
    provider: 'custom', model: 'relay-image-v2',
    operations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    maxReferences: 4, supportsMask: true,
    inputTransport: 'multipart', resultMode: 'sync',
    evidenceLevel: 'sandbox-verified', evidence: 'exact custom edit evidence',
    sandboxEvidence: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].map((operation) => ({
      endpointSha256,
      operation: operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
      inputTransport: 'multipart' as const,
      resultMode: 'sync' as const,
    })),
  };
}

function jobRepository() {
  return {
    getById: vi.fn(async () => ({
      id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', status: 'SUCCEEDED',
      inputAssets: [{
        assetId: 'asset-1', role: 'REFERENCE', ordinal: 0, sha256: 'a'.repeat(64),
        storageBackend: 'oss', storageKey: 'owners/owner-1/private-source.png',
      }],
      assets: [{ id: 'output-1', kind: 'AI_GENERATED', url: '/output.png' }],
    })),
    createWithQuota: vi.fn(), requestCancellation: vi.fn(), recordApplication: vi.fn(async () => ({
      id: 'job-1', ownerUserId: 'owner-1', status: 'SUCCEEDED', appliedMode: 'append', assets: [],
    })),
    markRunning: vi.fn(), markRetrying: vi.fn(), markFailed: vi.fn(),
    markEnqueueFailed: vi.fn(async () => true), markCancelled: vi.fn(), complete: vi.fn(),
  } as any;
}

async function build(
  enabled = true,
  ownerUserId = 'owner-1',
  translationEnabled = false,
  translationProvider = 'fake',
  webMediaEnabled = true,
  production = false,
  translationStorageReady = true,
  translationStorageBackend: 'oss' | 'local' | 'ozon-cdn' = 'oss',
  translationStoragePublicHttps = true,
  fullEditEnabled = false,
  inpaintEnabled = false,
  editDailyLimit = 5,
  editMaskUploadAllowed = true,
  editMaskRateAllowed = true,
  editStorageReady = true,
  editStorageBackend: 'oss' | 'local' | 'ozon-cdn' = 'oss',
  existingWorkflowOperation: AiMediaWorkflowRecord['operation'] = 'IMAGE_TO_IMAGE',
  translationCategoryGlossaryJson = '{"version":1,"profiles":[]}',
  translationCategory: { categoryId: number; typeId: number } | null = null,
  editRuntime: {
    provider?: string;
    model?: string;
    baseUrl?: string;
    estimatedCostCents?: number;
    globalDailyBudgetCents?: number;
    dimensions?: { width: number; height: number };
    resolveProviderCapability?: (
      provider: string,
      model: string,
    ) => AiImageProviderCapability | null;
  } = {},
) {
  const mediaWorkflowService = {
    createImageToImage: vi.fn(async () => ({ workflow, jobId: 'job-1', replayed: false })),
    createImageTranslation: vi.fn(async (_input: any) => ({
      workflow: { ...workflow, operation: 'IMAGE_TRANSLATE' as const }, jobId: 'job-translation-1', replayed: false,
    })),
    createImageEdit: vi.fn(async (input: any) => ({
      workflow: { ...workflow, operation: input.operation }, jobId: 'job-edit-1', replayed: false,
    })),
    list: vi.fn(async (): Promise<any> => ({
      items: [workflow], priorityItems: [], priorityItemsTruncated: false,
      priorityNextCursor: null, nextCursor: null,
    })),
    listPriority: vi.fn(async (): Promise<any> => ({ items: [workflow], nextCursor: null })),
    get: vi.fn(async (_id: string, owner: string): Promise<AiMediaWorkflowRecord> => {
      if (owner !== 'owner-1') throw new AiMediaWorkflowError('NOT_FOUND', 'not found');
      const model = existingWorkflowOperation === 'IMAGE_TO_IMAGE'
        ? 'fake-image-to-image-v1'
        : existingWorkflowOperation === 'IMAGE_TRANSLATE'
          ? 'fake-image-translation-v1'
          : 'fake-image-edit-v1';
      return {
        ...workflow,
        operation: existingWorkflowOperation,
        jobs: (workflow.jobs || []).map((job) => ({
          ...job,
          operation: existingWorkflowOperation,
          provider: 'fake',
          model,
        })),
      };
    }),
    cancel: vi.fn(async () => ({ ...workflow, status: 'CANCELLED' as const })),
    retry: vi.fn(async () => ({ workflow, jobId: 'job-2', replayed: false })),
    review: vi.fn(async () => ({ ...workflow, status: 'SUCCEEDED' as const, reviewStatus: 'APPROVED' as const })),
  };
  const mediaContextService = {
    loadCollect: vi.fn(async () => ({
      target: { type: 'collect' as const, id: 'goods-1', label: 'Product' },
      snapshot: { id: 'snapshot-1', version: 1, captureHash: 'hash-1' },
      inputs: [{ sourceMediaKey: 'main-1', role: 'main', sourceUrl: 'https://source.example/main.jpg', assetId: 'asset-1', compatibleAssetIds: ['asset-1'], assetUrl: 'https://cdn.example/main.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000, editReady: false }],
    })),
    loadListingDraft: vi.fn(async (_ownerUserId: string, _draftId: string, scope: any) => ({
      target: {
        type: 'listing-draft' as const, id: 'draft-1', label: 'Draft product',
        revision: 7, draftVersion: 3, skuKey: scope?.skuKey ?? null,
        slotKey: scope?.slotKey ?? null, assignedAssetId: 'asset-1',
      },
      snapshot: { id: 'snapshot-1', version: 5, captureHash: 'hash-1' },
      selectedSkuKeys: ['sku-red'],
      inputs: [{
        sourceMediaKey: 'main-1', role: 'main', scope: 'PRODUCT', skuKeys: [],
        sourceUrl: 'https://source.example/main.jpg', assetId: 'asset-1',
        compatibleAssetIds: ['asset-1'], assetUrl: 'https://cdn.example/main.jpg',
        mimeType: 'image/jpeg', width: 1000, height: 1000, editReady: false,
      }],
    })),
    internalizeCollect: vi.fn(async () => ({ id: 'asset-1', url: 'https://cdn.example/main.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000 })),
    internalizeListingDraft: vi.fn(async () => ({
      id: 'asset-1', url: 'https://cdn.example/main.jpg', mimeType: 'image/jpeg',
      width: 1000, height: 1000, editReady: true,
    })),
  };
  const enqueue = vi.fn(async () => undefined);
  const enqueueTranslation = vi.fn(async () => undefined);
  const enqueueEdit = vi.fn(async () => undefined);
  const applyAssets = vi.fn(async (input: any) => ({
    jobId: input.jobId,
    mode: input.mode,
    targetType: input.targetType,
    targetId: input.targetId,
    images: [],
    mainImage: null,
    editedImages: [],
    targetUpdatedAt: new Date(),
    appliedAt: new Date(),
  }));
  const mutationTarget = {
    type: 'collect', id: 'goods-1', updatedAt: '2026-07-20T12:00:00.001Z',
    images: ['/output.png'], editedImages: ['/output.png'], mainImage: '/output.png',
  };
  const mutationApplication = {
    id: 'application-1', revision: 7, kind: 'APPLY', workflowId: 'workflow-1', jobId: 'job-1',
    assetId: 'output-1', targetType: 'collect', targetId: 'goods-1', targetSequence: 1,
    mode: 'append', operationKey: 'application-operation-1', rollbackEligible: true,
  };
  const applyWorkflowApplication = vi.fn(async () => ({
    contractVersion: 'ai-media-application-mutation/v1',
    application: mutationApplication, target: mutationTarget, replayed: false,
  }));
  const listWorkflowApplications = vi.fn(async () => ({
    contractVersion: 'ai-media-application-mutation/v1',
    items: [mutationApplication], frontier: mutationApplication, target: mutationTarget,
    nextBeforeSequence: null, recoveredOperation: null, legacyApplications: [],
  }));
  const listTargetApplications = vi.fn(async () => ({
    contractVersion: 'ai-media-application-mutation/v1',
    items: [mutationApplication], frontier: mutationApplication, target: mutationTarget,
    nextBeforeSequence: null, recoveredOperation: null, legacyApplications: [],
  }));
  const rollbackWorkflowApplication = vi.fn(async () => ({
    contractVersion: 'ai-media-application-mutation/v1',
    application: { ...mutationApplication, id: 'rollback-1', revision: 8, kind: 'ROLLBACK' },
    target: mutationTarget, replayed: false,
  }));
  const listingTarget = {
    type: 'listing-draft', id: 'draft-1', revision: 8, draftVersion: 4,
    sourceCaptureSnapshotId: 'snapshot-1', media: { assignments: [] },
  };
  const listingApplication = {
    id: 'listing-application-1', revision: 1, kind: 'APPLY',
    workflowId: 'workflow-1', jobId: 'job-1', assetId: 'output-1',
    outputAssetId: 'output-1', operation: 'IMAGE_TO_IMAGE', source: 'GENERATED',
    rollbackOfId: null, rolledBackById: null, targetType: 'listing-draft',
    targetId: 'draft-1', targetSequence: 1, mode: 'append',
    contextSkuKey: 'sku-red', contextSlotKey: 'hero',
    operationKey: 'listing-application-operation', workflowRevisionBefore: 1,
    workflowRevisionAfter: 2, targetRevisionBefore: 7, targetRevisionAfter: 8,
    targetDraftVersionBefore: 3, targetDraftVersionAfter: 4,
    createdAt: new Date().toISOString(), rollbackEligible: true, rollbackReason: 'READY',
  };
  const applyListingDraftApplication = vi.fn(async () => ({
    contractVersion: 'ai-media-listing-draft-application/v1',
    application: listingApplication, target: listingTarget, replayed: false,
  }));
  const listListingDraftApplications = vi.fn(async () => ({
    contractVersion: 'ai-media-listing-draft-application/v1',
    items: [listingApplication], frontier: listingApplication,
    recoveredOperation: null, nextBeforeSequence: null, target: listingTarget,
  }));
  const rollbackListingDraftApplication = vi.fn(async () => ({
    contractVersion: 'ai-media-listing-draft-application/v1',
    application: {
      ...listingApplication, id: 'listing-rollback-1', kind: 'ROLLBACK',
      rollbackOfId: listingApplication.id, targetSequence: 2,
    },
    target: { ...listingTarget, revision: 9, draftVersion: 5 }, replayed: false,
  }));
  const createEditMask = vi.fn(async (input: any, deps: any) => {
    const limit = await deps.checkUploadQuota(input.ownerUserId, input.maskBuffer.length);
    if (!limit.allowed) throw new AiImageJobError('EDIT_RESOURCE_QUOTA_EXCEEDED', limit.reason);
    return {
      asset: {
        id: 'mask-asset-1', url: '/uploads/mask.png', mimeType: 'image/png', width: 2, height: 2,
      },
      replayed: false,
      diagnostics: {
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        editPixelCount: 2, preservedPixelCount: 2, featheredPixelCount: 0,
      },
    };
  });
  const resolveEditPrompt = vi.fn(async ({ templateKey }: any) => ({
    templateKey,
    release: { id: 'edit-release-1', revisionId: 'edit-revision-1', sequence: 1 },
    checksum: 'b'.repeat(64),
    snapshot: { templateKey, sequence: 1 },
    resolvedPrompt: 'Frozen edit prompt',
    resolvedNegativePrompt: 'Frozen edit constraints',
  } as any));
  const getOwnedAssetDimensions = vi.fn(async () => (
    editRuntime.dimensions || { width: 1000, height: 1000 }
  ));
  const repository = jobRepository();
  const app = Fastify();
  await app.register(aiImageRoutes, {
    repository, mediaWorkflowService, mediaContextService, enqueue, enqueueTranslation, enqueueEdit, applyAssets,
    applyWorkflowApplication, listTargetApplications, listWorkflowApplications, rollbackWorkflowApplication,
    applyListingDraftApplication, listListingDraftApplications, rollbackListingDraftApplication,
    createEditMask: createEditMask as any,
    getEditSettings: async () => ({
      imageToImageEnabled: true,
      fullEditEnabled,
      inpaintEnabled,
      dailyLimit: editDailyLimit,
      provider: editRuntime.provider || 'fake',
      model: editRuntime.model || 'fake-image-edit-v1',
      baseUrl: editRuntime.baseUrl || '',
      estimatedCostCents: editRuntime.estimatedCostCents ?? 0,
      globalDailyBudgetCents: editRuntime.globalDailyBudgetCents ?? 0,
    }),
    checkEditMaskRequestRate: async () => editMaskRateAllowed
      ? ({ allowed: true })
      : ({ allowed: false, reason: 'Edit mask request rate exceeded' }),
    checkEditMaskUploadQuota: async () => editMaskUploadAllowed
      ? ({ allowed: true })
      : ({ allowed: false, reason: 'Edit mask upload quota exceeded' }),
    getEditStorageReadiness: async () => ({
      ready: editStorageReady,
      backend: editStorageBackend,
      reason: editStorageReady
        ? 'AI image edit storage is ready'
        : 'AI image edit requires owned local or OSS storage',
    }),
    getOwnedAssetDimensions,
    getTranslationSettings: async () => ({
      enabled: translationEnabled, provider: translationEnabled ? translationProvider : 'disabled',
      model: translationProvider === 'fake' ? 'fake-image-translation-v1' : 'qwen-mt-image',
      dailyLimit: 20, estimatedCostCents: 0, globalDailyBudgetCents: 100,
      categoryGlossaryJson: translationCategoryGlossaryJson,
    }),
    getTranslationCategory: async () => translationCategory,
    resolveTranslationPrompt: async () => ({
      templateKey: 'image-translation.base',
      release: { id: 'translation-release-1', revisionId: 'translation-revision-1', sequence: 1 },
      checksum: 'a'.repeat(64),
      snapshot: { templateKey: 'image-translation.base', sequence: 1 },
      resolvedPrompt: 'Frozen translation domain policy',
      resolvedNegativePrompt: 'Frozen terminology policy',
    } as any),
    resolveEditPrompt,
    resolveProviderCapability: editRuntime.resolveProviderCapability,
    getSourceListingWebMediaEnabled: async () => webMediaEnabled,
    getTranslationStorageReadiness: async () => ({
      ready: translationStorageReady,
      backend: translationStorageBackend,
      publicHttps: translationStoragePublicHttps,
      reason: translationStorageReady
        ? 'Image translation storage is ready'
        : 'Image translation requires OSS or local storage because no shop context is frozen',
    }),
    production,
    getMediaWorkflowEnabled: async () => enabled,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: ownerUserId, actorUserId: 'actor-1' };
    },
  });
  return {
    app, repository, mediaWorkflowService, mediaContextService,
    enqueue, enqueueTranslation, enqueueEdit, applyAssets, createEditMask,
    resolveEditPrompt, getOwnedAssetDimensions,
    applyWorkflowApplication, listTargetApplications, listWorkflowApplications, rollbackWorkflowApplication,
    applyListingDraftApplication, listListingDraftApplications, rollbackListingDraftApplication,
  };
}

describe('AI media workflow routes', () => {
  it('exposes owner-scoped listing draft apply, history and compensating rollback endpoints', async () => {
    const {
      app, applyListingDraftApplication, listListingDraftApplications,
      rollbackListingDraftApplication,
    } = await build();
    const applied = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/listing-draft-application',
      payload: {
        mode: 'append', operationKey: 'listing-application-operation',
        expectedWorkflowRevision: 1, expectedTargetRevision: 7,
        expectedTargetDraftVersion: 3,
      },
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/contexts/listing-draft/draft-1/applications?limit=10',
    });
    const rolledBack = await app.inject({
      method: 'POST',
      url: '/listing-draft-applications/listing-application-1/rollback',
      payload: {
        operationKey: 'listing-rollback-operation', expectedApplicationRevision: 1,
        expectedWorkflowRevision: 2, expectedTargetRevision: 8,
        expectedTargetDraftVersion: 4,
      },
    });

    expect(applied.statusCode).toBe(201);
    expect(listed.statusCode).toBe(200);
    expect(rolledBack.statusCode).toBe(201);
    expect(applyListingDraftApplication).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedTargetRevision: 7, expectedTargetDraftVersion: 3,
    }));
    expect(listListingDraftApplications).toHaveBeenCalledWith({
      targetId: 'draft-1', ownerUserId: 'owner-1', limit: 10,
    });
    expect(rollbackListingDraftApplication).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'listing-application-1', expectedTargetRevision: 8,
      expectedTargetDraftVersion: 4,
    }));
  });

  it('keeps listing draft history and rollback readable while dark but blocks new apply', async () => {
    const {
      app, applyListingDraftApplication, listListingDraftApplications,
      rollbackListingDraftApplication,
    } = await build(false, 'owner-1', false, 'fake', false);
    const apply = await app.inject({
      method: 'POST', url: '/workflows/workflow-1/listing-draft-application',
      payload: {
        mode: 'append', operationKey: 'listing-dark-application',
        expectedWorkflowRevision: 1, expectedTargetRevision: 7,
        expectedTargetDraftVersion: 3,
      },
    });
    const list = await app.inject({
      method: 'GET', url: '/contexts/listing-draft/draft-1/applications',
    });
    const rollback = await app.inject({
      method: 'POST', url: '/listing-draft-applications/listing-application-1/rollback',
      payload: {
        operationKey: 'listing-dark-rollback', expectedApplicationRevision: 1,
        expectedWorkflowRevision: 2, expectedTargetRevision: 8,
        expectedTargetDraftVersion: 4,
      },
    });

    expect(apply.statusCode).toBe(503);
    expect(applyListingDraftApplication).not.toHaveBeenCalled();
    expect(list.statusCode).toBe(200);
    expect(rollback.statusCode).toBe(201);
    expect(listListingDraftApplications).toHaveBeenCalledOnce();
    expect(rollbackListingDraftApplication).toHaveBeenCalledOnce();
  });

  it('advertises the versioned mutation contract and keeps reads and rollback available while dark', async () => {
    const { app } = await build(false, 'owner-1', false, 'fake', false);
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.applications).toEqual({
      contractVersion: 'ai-media-application-mutation/v1',
      readEnabled: true,
      applyEnabled: false,
      listingDraftApplyEnabled: false,
      rollbackEnabled: true,
      defaultMode: 'append',
      replaceOperations: ['IMAGE_TO_IMAGE'],
    });
  });

  it('keeps listing draft application fake-only in production without disabling reads or rollback', async () => {
    const { app } = await build(true, 'owner-1', false, 'fake', true, true);
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.applications).toMatchObject({
      readEnabled: true,
      applyEnabled: true,
      listingDraftApplyEnabled: false,
      rollbackEnabled: true,
    });
  });

  it('reports rolled-back listing draft applications from the immutable ledger', async () => {
    const { app, mediaWorkflowService } = await build();
    const appliedAt = new Date('2026-07-21T01:00:00.000Z');
    const rolledBackAt = new Date('2026-07-21T01:05:00.000Z');
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      contextType: 'listing-draft',
      contextId: 'draft-1',
      contextSkuKey: 'sku-red',
      contextSlotKey: 'sku:sku-red:hero',
      applicationMutations: [],
      listingDraftApplicationMutations: [{
        id: 'listing-application-1',
        mode: 'APPEND',
        workflowId: workflow.id,
        jobId: 'job-1',
        assetId: 'output-1',
        targetId: 'draft-1',
        contextSkuKey: 'sku-red',
        contextSlotKey: 'sku:sku-red:hero',
        createdAt: appliedAt,
        rolledBackBy: { id: 'listing-rollback-1', createdAt: rolledBackAt },
      }],
      jobs: [{
        ...workflow.jobs![0],
        appliedAt,
        appliedMode: 'append',
        applyTargetType: 'listing-draft',
        applyTargetId: 'draft-1',
      }],
    } as any);

    const response = await app.inject({ method: 'GET', url: '/workflows/workflow-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.application).toMatchObject({
      id: 'listing-application-1',
      state: 'ROLLED_BACK',
      targetType: 'listing-draft',
      targetId: 'draft-1',
      rolledBackAt: rolledBackAt.toISOString(),
      legacy: false,
    });
  });

  it('uses the mutation endpoints for apply, recovery reads and rollback', async () => {
    const {
      app, applyWorkflowApplication, listTargetApplications, listWorkflowApplications,
      rollbackWorkflowApplication,
    } = await build();
    const targetVersion = '2026-07-20T12:00:00.000Z';
    const applied = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/applications',
      payload: {
        mode: 'append', operationKey: 'application-operation-1',
        expectedWorkflowRevision: 1, expectedTargetUpdatedAt: targetVersion,
      },
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/workflows/workflow-1/applications?limit=10&operationKey=application-operation-1',
    });
    const targetListed = await app.inject({
      method: 'GET',
      url: '/applications?targetType=collect&targetId=goods-1&limit=10&operationKey=application-operation-1',
    });
    const rolledBack = await app.inject({
      method: 'POST',
      url: '/applications/application-1/rollback',
      payload: {
        operationKey: 'rollback-operation-1',
        expectedApplicationRevision: 7,
        expectedWorkflowRevision: 2, expectedTargetUpdatedAt: targetVersion,
      },
    });

    expect(applied.statusCode).toBe(201);
    expect(listed.statusCode).toBe(200);
    expect(targetListed.statusCode).toBe(200);
    expect(rolledBack.statusCode).toBe(201);
    expect(applied.json().data.application.revision).toBe(7);
    expect(listed.json().data).toMatchObject({
      items: [{ id: 'application-1', revision: 7 }],
      frontier: { id: 'application-1', revision: 7 },
    });
    expect(rolledBack.json().data.application).toMatchObject({
      id: 'rollback-1', revision: 8,
    });
    expect(applyWorkflowApplication).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'workflow-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    }));
    expect(listWorkflowApplications).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'workflow-1', operationKey: 'application-operation-1', limit: 10,
    }));
    expect(listTargetApplications).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', targetId: 'goods-1', limit: 10,
      operationKey: 'application-operation-1',
    });
    expect(rollbackWorkflowApplication).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'application-1', operationKey: 'rollback-operation-1',
      expectedApplicationRevision: 7,
    }));
  });

  it('keeps mutation reads and rollback available after rollout is disabled', async () => {
    const { app, applyWorkflowApplication, listTargetApplications, rollbackWorkflowApplication } = await build(
      false, 'owner-1', false, 'fake', false,
    );
    const targetVersion = '2026-07-20T12:00:00.000Z';
    const apply = await app.inject({ method: 'POST', url: '/workflows/workflow-1/applications', payload: {
      mode: 'append', operationKey: 'dark-apply-operation',
      expectedWorkflowRevision: 1, expectedTargetUpdatedAt: targetVersion,
    } });
    const list = await app.inject({
      method: 'GET', url: '/applications?targetType=collect&targetId=goods-1',
    });
    const rollback = await app.inject({ method: 'POST', url: '/applications/application-1/rollback', payload: {
      operationKey: 'dark-rollback-operation',
      expectedApplicationRevision: 1,
      expectedWorkflowRevision: 2, expectedTargetUpdatedAt: targetVersion,
    } });

    expect(apply.statusCode).toBe(503);
    expect(applyWorkflowApplication).not.toHaveBeenCalled();
    expect(list.statusCode).toBe(200);
    expect(rollback.statusCode).toBe(201);
    expect(listTargetApplications).toHaveBeenCalledOnce();
    expect(rollbackWorkflowApplication).toHaveBeenCalledOnce();
  });

  it('keeps target-scoped reads owner-bound while rollout is disabled', async () => {
    const { app, listTargetApplications } = await build(false, 'owner-2', false, 'fake', false);
    listTargetApplications.mockRejectedValueOnce(new AiMediaApplicationMutationError(
      'TARGET_NOT_FOUND',
      'Image application target not found',
    ));

    const response = await app.inject({
      method: 'GET',
      url: '/applications?targetType=collect&targetId=goods-1',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'TARGET_NOT_FOUND',
      msg: 'Image application target not found',
    });
    expect(listTargetApplications).toHaveBeenCalledWith({
      ownerUserId: 'owner-2',
      targetId: 'goods-1',
      limit: undefined,
      beforeSequence: undefined,
      operationKey: undefined,
    });
  });

  it('maps application provider readiness failures to a retryable 503', async () => {
    const { app, applyWorkflowApplication } = await build();
    applyWorkflowApplication.mockRejectedValueOnce(new AiMediaApplicationMutationError(
      'PROVIDER_NOT_READY',
      'Test-only AI media candidates cannot be applied in production',
    ));

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/applications',
      payload: {
        mode: 'append', operationKey: 'provider-not-ready-application',
        expectedWorkflowRevision: 1, expectedTargetUpdatedAt: '2026-07-20T12:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
  });

  it('requires explicit replace confirmation and blocks the legacy workflow apply route', async () => {
    const { app, applyWorkflowApplication, applyAssets } = await build();
    const replace = await app.inject({ method: 'POST', url: '/workflows/workflow-1/applications', payload: {
      mode: 'replace', operationKey: 'replace-without-confirmation',
      expectedWorkflowRevision: 1, expectedTargetUpdatedAt: '2026-07-20T12:00:00.000Z',
    } });
    const legacy = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
    } });

    expect(replace.statusCode).toBe(400);
    expect(applyWorkflowApplication).not.toHaveBeenCalled();
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
    expect(applyAssets).not.toHaveBeenCalled();
  });

  it('keeps manual edit capabilities dark by default', async () => {
    const { app } = await build();
    const response = await app.inject({ method: 'GET', url: '/capabilities' });
    expect(response.json().data.operations).toMatchObject({
      FULL_EDIT: { enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED' },
      INPAINT: { enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED' },
    });
  });

  it('creates an enabled fake-only manual edit with a frozen Prompt and dedicated queue', async () => {
    const { app, mediaWorkflowService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, true, true,
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'INPAINT',
      sourceAssetId: 'asset-1',
      maskAssetId: 'mask-asset-1',
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
      userPrompt: 'Remove the printed label',
      userNegativePrompt: '',
      idempotencyKey: 'manual-inpaint-idempotency',
      context: { type: 'collect', id: 'goods-1' },
    } });

    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageEdit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'INPAINT', sourceAssetId: 'asset-1', maskAssetId: 'mask-asset-1',
      width: 1000, height: 1000,
      templateKey: 'inpaint.base', templateReleaseId: 'edit-release-1',
      resolvedPrompt: 'Frozen edit prompt', dailyLimit: 5,
    }));
    expect(enqueueEdit).toHaveBeenCalledWith('job-edit-1');
  });

  it('forwards a listing-draft context unchanged when creating image-to-image work', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const context = {
      type: 'listing-draft', id: 'draft-1', revision: 7, draftVersion: 3,
      skuKey: 'sku-red', slotKey: 'sku-hero',
    } as const;
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Clean the background',
      idempotencyKey: 'listing-image-to-image-1', context,
    } });

    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      sourceAssetId: 'asset-1', context,
    }));
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('requires both frozen listing-draft version fields at the workflow boundary', async () => {
    const { app, mediaWorkflowService } = await build();
    const missingDraftVersion = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep the product',
      idempotencyKey: 'listing-image-to-image-2',
      context: { type: 'listing-draft', id: 'draft-1', revision: 7, skuKey: 'sku-red' },
    } });
    const missingRevision = await app.inject({ method: 'GET', url: '/contexts/listing-draft/draft-1?draftVersion=3' });

    expect(missingDraftVersion.statusCode).toBe(400);
    expect(missingRevision.statusCode).toBe(400);
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
  });

  it('rejects manual edit in production even when its dark flag is enabled', async () => {
    const { app, mediaWorkflowService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, true, true, 'oss', true, true, true,
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'FULL_EDIT', sourceAssetId: 'asset-1', userPrompt: 'Clean background',
      idempotencyKey: 'manual-full-edit-production', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(mediaWorkflowService.createImageEdit).not.toHaveBeenCalled();
    expect(enqueueEdit).not.toHaveBeenCalled();
  });

  it('fails edit capabilities and creation closed when storage is incompatible', async () => {
    const { app, mediaWorkflowService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true,
      true, true, 5, true, true, false, 'ozon-cdn',
    );
    const capabilities = await app.inject({ method: 'GET', url: '/capabilities' });
    expect(capabilities.json().data.operations).toMatchObject({
      FULL_EDIT: { ready: false, reasonCode: 'STORAGE_NOT_READY' },
      INPAINT: { ready: false, reasonCode: 'STORAGE_NOT_READY' },
    });

    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'FULL_EDIT', sourceAssetId: 'asset-1', userPrompt: 'Clean background',
      idempotencyKey: 'manual-full-edit-storage', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.createImageEdit).not.toHaveBeenCalled();
    expect(enqueueEdit).not.toHaveBeenCalled();
  });

  it('finalizes a mask only through the owner-scoped inpaint endpoint', async () => {
    const { app, createEditMask } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, false, true,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      payload: {
        sourceAssetId: 'asset-1',
        skuKey: 'sku-a',
        slotKey: 'hero',
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maskDataUrl: `data:image/png;base64,${Buffer.from('mask-mask-mask-mask').toString('base64')}`,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(createEditMask).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', contextId: 'goods-1',
      contextSkuKey: 'sku-a', contextSlotKey: 'hero',
      sourceAssetId: 'asset-1', maskBuffer: Buffer.from('mask-mask-mask-mask'),
    }), expect.any(Object));
    expect(response.json()).toMatchObject({
      code: 1, replayed: false,
      data: { id: 'mask-asset-1', maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1' },
    });
  });

  it('freezes listing-draft revision, SKU, and slot authority into an edit mask', async () => {
    const { app, createEditMask } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, false, true,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/contexts/listing-draft/draft-1/edit-masks',
      payload: {
        revision: 7,
        draftVersion: 3,
        sourceAssetId: 'asset-1',
        skuKey: 'sku-red',
        slotKey: 'sku-hero',
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maskDataUrl: `data:image/png;base64,${Buffer.from('mask-mask-mask-mask').toString('base64')}`,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(createEditMask).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'actor-1',
      contextType: 'listing-draft', contextId: 'draft-1',
      contextDraftRevision: 7, contextDraftVersion: 3,
      contextSkuKey: 'sku-red', contextSlotKey: 'sku-hero',
      sourceAssetId: 'asset-1', maskBuffer: Buffer.from('mask-mask-mask-mask'),
    }), expect.objectContaining({
      loadListingDraftContext: expect.any(Function),
    }));
  });

  it('rejects an edit mask before storage when the upload resource limit is exhausted', async () => {
    const { app, createEditMask } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, false, true, 5, false,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      payload: {
        sourceAssetId: 'asset-1',
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maskDataUrl: `data:image/png;base64,${Buffer.from('mask-mask-mask-mask').toString('base64')}`,
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'EDIT_RESOURCE_QUOTA_EXCEEDED' });
    expect(createEditMask).toHaveBeenCalledOnce();
  });

  it('rate-limits edit-mask requests before decode and mask validation', async () => {
    const { app, createEditMask } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true,
      false, true, 5, true, false,
    );
    const response = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      payload: {
        sourceAssetId: 'asset-1',
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maskDataUrl: `data:image/png;base64,${Buffer.from('mask-mask-mask-mask').toString('base64')}`,
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'EDIT_RESOURCE_RATE_LIMITED' });
    expect(createEditMask).not.toHaveBeenCalled();
  });

  it('blocks mask upload and edit retry before work when storage is incompatible', async () => {
    const { app, createEditMask, mediaWorkflowService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true,
      true, true, 5, true, true, false, 'ozon-cdn', 'FULL_EDIT',
    );
    const maskResponse = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      payload: {
        sourceAssetId: 'asset-1',
        maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
        maskDataUrl: `data:image/png;base64,${Buffer.from('mask-mask-mask-mask').toString('base64')}`,
      },
    });
    expect(maskResponse.statusCode).toBe(503);
    expect(maskResponse.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(createEditMask).not.toHaveBeenCalled();

    const retryResponse = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 1, idempotencyKey: 'manual-edit-retry-storage' },
    });
    expect(retryResponse.statusCode).toBe(503);
    expect(retryResponse.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueueEdit).not.toHaveBeenCalled();
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)(
    'rejects a historical paid %s retry with an unsupported canvas before quota or enqueue side effects',
    async (operation) => {
      const { app, mediaWorkflowService, enqueueEdit } = await build(
        true, 'owner-1', false, 'fake', true, false, true, 'oss', true,
        true, true,
      );
      mediaWorkflowService.get.mockResolvedValueOnce({
        ...workflow,
        operation,
        jobs: [{
          ...workflow.jobs![0],
          operation,
          provider: 'custom',
          model: 'gpt-image-1',
          width: 900,
          height: 1200,
          estimatedCostCents: 5,
        }],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/workflows/workflow-1/retry',
        payload: { expectedRevision: 1, idempotencyKey: `legacy-paid-${operation.toLowerCase()}` },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'UNSUPPORTED_PROVIDER_EDIT_DIMENSIONS' });
      expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
      expect(enqueueEdit).not.toHaveBeenCalled();
    },
  );

  it('rejects a historical paid image-to-image retry with an unsupported canvas before quota or enqueue side effects', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'IMAGE_TO_IMAGE',
      jobs: [{
        ...workflow.jobs![0],
        provider: 'custom',
        model: 'gpt-image-1',
        width: 900,
        height: 1200,
        estimatedCostCents: 5,
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 1, idempotencyKey: 'legacy-paid-image-to-image' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'UNSUPPORTED_PROVIDER_EDIT_DIMENSIONS' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('authenticates edit-mask requests before parsing their large JSON body', async () => {
    const app = Fastify();
    const rateCheck = vi.fn(async () => ({ allowed: true as const }));
    await app.register(aiImageRoutes, {
      authenticate: async (_request: FastifyRequest, reply: any) => reply.status(401).send({
        code: 0,
        msg: 'not signed in',
      }),
      checkEditMaskRequestRate: rateCheck,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid-json',
    });

    expect(response.statusCode).toBe(401);
    expect(rateCheck).not.toHaveBeenCalled();
  });

  it('rate-limits authenticated edit-mask requests before JSON parsing', async () => {
    const app = Fastify();
    const rateCheck = vi.fn(async () => ({
      allowed: false as const,
      reason: 'Edit mask request rate exceeded',
    }));
    await app.register(aiImageRoutes, {
      authenticate: async (request: FastifyRequest) => {
        (request as any).user = { userId: 'owner-1', actorUserId: 'actor-1' };
      },
      checkEditMaskRequestRate: rateCheck,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/edit-masks',
      headers: { 'content-type': 'application/json' },
      payload: '{invalid-json',
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'EDIT_RESOURCE_RATE_LIMITED' });
    expect(rateCheck).toHaveBeenCalledWith('owner-1');
  });

  it('reports owner-scoped Web operation readiness without exposing provider secrets', async () => {
    const { app } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        webMediaEnabled: true,
        webMediaReason: 'global',
        webMediaRevision: 'test-hook',
        workflowEnabled: true,
        workflowReason: 'tenant_allowed',
        workflowRevision: 0,
        operations: {
          IMAGE_TO_IMAGE: { enabled: true, ready: true, reasonCode: 'READY' },
          IMAGE_TRANSLATE: { enabled: true, ready: true, reasonCode: 'READY' },
        },
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('apiKey');
  });

  it('reports the workflow rollout blocker instead of collapsing it into a boolean', async () => {
    const { app } = await build(false, 'owner-1', true);
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      workflowEnabled: false,
      workflowReason: 'master_off',
      workflowRevision: 0,
    });
  });

  it('keeps paid image translation unavailable until sandbox evidence is verified', async () => {
    const { app } = await build(true, 'owner-1', true, 'dashscope-qwen-mt-image');
    const response = await app.inject({ method: 'GET', url: '/capabilities' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
    });
  });

  it('rejects paid image translation when storage is local instead of owned public HTTPS OSS', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'dashscope-qwen-mt-image',
      true,
      false,
      true,
      'local',
      false,
    );
    const capabilities = await app.inject({ method: 'GET', url: '/capabilities' });
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      idempotencyKey: 'paid-translation-local-storage', context: { type: 'collect', id: 'goods-1' },
    } });

    expect(capabilities.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
    });
    expect(create.statusCode).toBe(503);
    expect(create.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('reports and enforces an incompatible translation storage backend before enqueue', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'fake',
      true,
      false,
      false,
    );
    const capabilities = await app.inject({ method: 'GET', url: '/capabilities' });
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      idempotencyKey: 'translation-storage-off', context: { type: 'collect', id: 'goods-1' },
    } });

    expect(capabilities.json().data.operations.IMAGE_TRANSLATE).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'STORAGE_NOT_READY',
    });
    expect(create.statusCode).toBe(503);
    expect(create.json()).toMatchObject({ code: 'STORAGE_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('keeps the fake image-to-image lifecycle unavailable in production', () => {
    expect(resolveAiImageToImageReadiness({
      enabled: true, workflowEnabled: true, production: true,
    })).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      testOnly: true,
    });
    expect(resolveAiImageToImageReadiness({
      enabled: true, workflowEnabled: true, production: false,
    })).toMatchObject({
      ready: true,
      testOnly: true,
    });
  });

  it('keeps image-to-image dark behind its independent operation switch', () => {
    expect(resolveAiImageToImageReadiness({
      enabled: false, workflowEnabled: true, production: false,
    })).toMatchObject({
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
    });
    expect(resolveAiImageToImageReadiness({
      workflowEnabled: true, production: false,
    })).toMatchObject({
      enabled: false,
      ready: false,
      reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
    });
  });

  it('keeps characterized OpenAI input operations dark until exact sandbox evidence is promoted', () => {
    expect(resolveAiImageToImageReadiness({
      enabled: true,
      workflowEnabled: true,
      production: true,
      provider: 'openai-images',
      model: 'gpt-image-1',
      estimatedCostCents: 7,
      storageReadiness: { ready: true, backend: 'oss', reason: 'ready' },
    })).toMatchObject({
      enabled: true,
      ready: false,
      reasonCode: 'PROVIDER_NOT_READY',
      reason: expect.stringMatching(/sandbox/u),
    });
  });

  it('requires an exact custom Base and operation binding for standalone edit readiness', () => {
    const exactCapability = customEditCapability(customEditEndpointSha256);
    const mismatchedCapability = customEditCapability(otherEditEndpointSha256);
    const common = {
      workflowEnabled: true,
      production: true,
      provider: 'custom',
      model: 'relay-image-v2',
      baseUrl: 'https://relay.example/v1',
      estimatedCostCents: 9,
      storageReadiness: { ready: true, backend: 'oss' as const, reason: 'ready' },
    };

    expect(resolveAiImageToImageReadiness({
      ...common,
      enabled: true,
      resolveCapability: () => exactCapability,
    })).toMatchObject({ ready: true, reasonCode: 'READY' });
    expect(resolveAiImageToImageReadiness({
      ...common,
      enabled: true,
      resolveCapability: () => mismatchedCapability,
    })).toMatchObject({ ready: false, reasonCode: 'PROVIDER_NOT_READY' });

    for (const operation of ['FULL_EDIT', 'INPAINT'] as const) {
      const settings = {
        fullEditEnabled: true,
        inpaintEnabled: true,
        provider: common.provider,
        model: common.model,
        baseUrl: common.baseUrl,
        estimatedCostCents: common.estimatedCostCents,
      };
      expect(resolveAiImageEditReadiness(operation, settings, {
        workflowEnabled: true,
        production: true,
        storageReadiness: common.storageReadiness,
        resolveCapability: () => exactCapability,
      })).toMatchObject({ ready: true, reasonCode: 'READY' });
      expect(resolveAiImageEditReadiness(operation, settings, {
        workflowEnabled: true,
        production: true,
        storageReadiness: common.storageReadiness,
        resolveCapability: () => mismatchedCapability,
      })).toMatchObject({ ready: false, reasonCode: 'PROVIDER_NOT_READY' });
    }
  });

  it.each(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const)(
    'rejects %s with stale custom endpoint evidence before Prompt, reservation, or enqueue',
    async (operation) => {
      const result = await build(
        true, 'owner-1', false, 'fake', true, true, true, 'oss', true,
        true, true, 5, true, true, true, 'oss', 'IMAGE_TO_IMAGE',
        '{"version":1,"profiles":[]}', null,
        {
          provider: 'custom',
          model: 'relay-image-v2',
          baseUrl: 'https://relay.example/v1',
          estimatedCostCents: 9,
          globalDailyBudgetCents: 100,
          dimensions: { width: 1024, height: 1024 },
          resolveProviderCapability: () => customEditCapability(otherEditEndpointSha256),
        },
      );
      const shared = {
        operation,
        sourceAssetId: 'asset-1',
        idempotencyKey: `stale-custom-${operation.toLowerCase()}`,
        context: { type: 'collect', id: 'goods-1' },
      };
      const payload = operation === 'IMAGE_TO_IMAGE'
        ? { ...shared, prompt: 'Keep the product', count: 1, width: 1024, height: 1024 }
        : operation === 'FULL_EDIT'
          ? { ...shared, userPrompt: 'Replace the background' }
          : {
              ...shared,
              maskAssetId: 'mask-asset-1',
              maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
              userPrompt: 'Remove the label',
            };

      const response = await result.app.inject({ method: 'POST', url: '/workflows', payload });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
      expect(result.getOwnedAssetDimensions).not.toHaveBeenCalled();
      expect(result.resolveEditPrompt).not.toHaveBeenCalled();
      expect(result.mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
      expect(result.mediaWorkflowService.createImageEdit).not.toHaveBeenCalled();
      expect(result.enqueue).not.toHaveBeenCalled();
      expect(result.enqueueEdit).not.toHaveBeenCalled();
    },
  );

  it('does not review or apply historical fake workflow candidates in production', async () => {
    const { app, repository, mediaWorkflowService } = await build(
      true,
      'owner-1',
      true,
      'fake',
      true,
      true,
    );
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      jobs: [{ id: 'job-1', provider: 'fake', assets: [{ id: 'output-1', kind: 'AI_GENERATED', url: '/output.png' }] }],
    });
    const review = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    repository.getById.mockResolvedValueOnce({
      id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', operation: 'IMAGE_TO_IMAGE',
      provider: 'fake', status: 'SUCCEEDED', assets: [{ id: 'output-1', kind: 'AI_GENERATED', url: '/output.png' }],
    } as any);
    const apply = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
    } });

    expect(review.statusCode).toBe(503);
    expect(apply.statusCode).toBe(409);
    expect(review.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(apply.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('gates Web media create, retry and internalization by the owner rollout decision', async () => {
    const { app, mediaWorkflowService, mediaContextService, enqueue } = await build(
      true,
      'owner-1',
      true,
      'fake',
      false,
    );
    const create = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      idempotencyKey: 'web-media-disabled-create', context: { type: 'collect', id: 'goods-1' },
    } });
    const retry = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1, idempotencyKey: 'web-media-disabled-retry',
    } });
    const internalize = await app.inject({
      method: 'POST',
      url: '/contexts/collect/goods-1/internalize',
      payload: { sourceMediaKey: 'main-1' },
    });

    for (const response of [create, retry, internalize]) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'SOURCE_LISTING_WEB_MEDIA_DISABLED' });
    }
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(mediaContextService.internalizeCollect).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('creates and enqueues a gated IMAGE_TRANSLATE workflow with frozen language options', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: 'Translate concise product banner copy',
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
      idempotencyKey: 'translation-idem-1', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: expect.stringContaining('Frozen translation domain policy'),
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }], provider: 'fake',
      globalDailyBudgetCents: 100,
      templateKey: 'image-translation.base', templateReleaseId: 'translation-release-1',
    }));
    expect(enqueueTranslation).toHaveBeenCalledWith('job-translation-1');
  });

  it('merges the configured language-pair glossary before freezing a Web translation workflow', async () => {
    const glossaryJson = JSON.stringify({
      version: 1,
      profiles: [{
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
        terms: [
          { src: '容量', tgt: 'Объём' },
          { src: '材质', tgt: 'Материал' },
        ],
      }],
    });
    const { app, mediaWorkflowService } = await build(
      true, 'owner-1', true, 'fake', true, false, true, 'oss', true,
      false, false, 5, true, true, true, 'oss', 'IMAGE_TO_IMAGE', glossaryJson,
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      sourceLanguage: 'zh', targetLanguage: 'ru',
      terminologies: [
        { src: '容量', tgt: 'Вместимость' },
        { src: '颜色', tgt: 'Цвет' },
      ],
      idempotencyKey: 'translation-glossary-merge', context: { type: 'collect', id: 'goods-1' },
    } });

    expect(response.statusCode).toBe(202);
    const input = vi.mocked(mediaWorkflowService.createImageTranslation).mock.calls[0]?.[0] as any;
    expect(input.terminologies).toHaveLength(3);
    expect(input.terminologies).toEqual(expect.arrayContaining([
      { src: '容量', tgt: 'Вместимость' },
      { src: '材质', tgt: 'Материал' },
      { src: '颜色', tgt: 'Цвет' },
    ]));
    expect(input.terminologies).not.toContainEqual({ src: '容量', tgt: 'Объём' });
  });

  it('uses the trusted listing category to resolve an exact Web translation glossary', async () => {
    const glossaryJson = JSON.stringify({
      version: 1,
      profiles: [{
        sourceLanguage: 'zh', targetLanguage: 'ru', categoryId: 10, typeId: 20,
        terms: [{ src: '陶瓷杯', tgt: 'Керамическая кружка' }],
      }],
    });
    const { app, mediaWorkflowService } = await build(
      true, 'owner-1', true, 'fake', true, false, true, 'oss', true,
      false, false, 5, true, true, true, 'oss', 'IMAGE_TO_IMAGE', glossaryJson,
      { categoryId: 10, typeId: 20 },
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1',
      idempotencyKey: 'translation-category-glossary',
      context: { type: 'listing-draft', id: 'draft-1', revision: 7, draftVersion: 3 },
    } });

    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageTranslation).toHaveBeenCalledWith(expect.objectContaining({
      terminologies: [{ src: '陶瓷杯', tgt: 'Керамическая кружка' }],
    }));
  });

  it('does not create a translation workflow while its operation gate is disabled', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', false);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', idempotencyKey: 'translation-idem-off',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_OPERATION_DISABLED' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('keeps an adapter-characterized paid translation provider behind the sandbox gate', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(
      true,
      'owner-1',
      true,
      'dashscope-qwen-mt-image',
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', idempotencyKey: 'translation-idem-paid',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('rejects same-language translation and duplicate terminology before persistence', async () => {
    const { app, mediaWorkflowService } = await build(true, 'owner-1', true);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TRANSLATE', sourceAssetId: 'asset-1', sourceLanguage: 'zh', targetLanguage: 'ZH',
      terminologies: [{ src: 'A', tgt: 'a' }, { src: 'a', tgt: 'b' }],
      idempotencyKey: 'translation-idem-invalid', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(400);
    expect(mediaWorkflowService.createImageTranslation).not.toHaveBeenCalled();
  });

  it('creates and enqueues a feature-gated IMAGE_TO_IMAGE workflow', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-1',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceAssetId: 'asset-1',
    }));
    expect(enqueue).toHaveBeenCalledWith('job-1');
    expect(response.json().data).not.toHaveProperty('requestFingerprint');
    expect(JSON.stringify(response.json())).not.toContain('secret-key');
    expect(JSON.stringify(response.json())).not.toContain('secret-output-key');
    expect(JSON.stringify(response.json())).not.toContain('/provider-raw.png');
    expect(response.json().data.jobs[0]).toMatchObject({ costStatus: 'RELEASED' });
    expect(response.json().data.jobs[0]).not.toHaveProperty('costReservation');
    expect(JSON.stringify(response.json())).not.toContain('maximumCostMinor');
  });

  it('compensates a workflow that could not be enqueued', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue offline'));

    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-offline',
      context: { type: 'collect', id: 'goods-1' },
    } });

    expect(response.statusCode).toBe(503);
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
  });

  it('accepts ordered references while preserving the legacy single-reference request', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE',
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Keep product identity from both references',
      count: 1, width: 1024, height: 1024, idempotencyKey: 'workflow-idem-multi',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(202);
    expect(mediaWorkflowService.createImageToImage).toHaveBeenCalledWith(expect.objectContaining({
      sourceAssetId: undefined,
      references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
    }));
    expect(enqueue).toHaveBeenCalledWith('job-1');
  });

  it('rejects ambiguous legacy and references payloads', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1',
      references: [{ assetId: 'asset-2' }], prompt: 'Ambiguous inputs',
      idempotencyKey: 'workflow-idem-ambiguous', context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(400);
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns a conflict for duplicate immutable reference content', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    mediaWorkflowService.createImageToImage.mockRejectedValueOnce(
      Object.assign(new Error('Source references must have unique content'), { code: 'SOURCE_ASSET_DUPLICATE' }),
    );
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', references: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }],
      prompt: 'Use both views', idempotencyKey: 'workflow-idem-duplicate-content',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'SOURCE_ASSET_DUPLICATE' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fails closed when the workflow feature is disabled', async () => {
    const { app, mediaWorkflowService } = await build(false);
    const response = await app.inject({ method: 'POST', url: '/workflows', payload: {
      operation: 'IMAGE_TO_IMAGE', sourceAssetId: 'asset-1', prompt: 'Keep product',
      idempotencyKey: 'workflow-idem-1',
      context: { type: 'collect', id: 'goods-1' },
    } });
    expect(response.statusCode).toBe(503);
    expect(mediaWorkflowService.createImageToImage).not.toHaveBeenCalled();
  });

  it('does not create or enqueue a retry while the tenant rollout is disabled', async () => {
    const { app, mediaWorkflowService, enqueue } = await build(false);
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'retry-idem-disabled' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_WORKFLOW_DISABLED' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('checks the translation operation gate before creating a retry attempt', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', false);
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{ provider: 'fake', model: 'fake-image-translation-v1' }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'translation-retry-disabled' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_OPERATION_DISABLED' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('returns 429 when a translation retry exceeds its daily quota', async () => {
    const { app, mediaWorkflowService, enqueueTranslation } = await build(true, 'owner-1', true);
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{ provider: 'fake', model: 'fake-image-translation-v1', estimatedCostCents: 0 }],
    });
    mediaWorkflowService.retry.mockRejectedValueOnce(
      new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', 'quota exceeded'),
    );
    const response = await app.inject({
      method: 'POST', url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'translation-retry-quota' },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'IMAGE_TRANSLATION_QUOTA_EXCEEDED' });
    expect(enqueueTranslation).not.toHaveBeenCalled();
  });

  it('forwards and enforces the image generation daily limit on an edit retry', async () => {
    const { app, mediaWorkflowService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, true, false, 7,
    );
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'FULL_EDIT' as any,
      status: 'FAILED',
      jobs: (workflow.jobs || []).map((job) => ({
        ...job,
        operation: 'FULL_EDIT',
        model: 'fake-image-edit-v1',
      })),
    });
    mediaWorkflowService.retry.mockRejectedValueOnce(
      new AiMediaWorkflowError('AI_IMAGE_EDIT_QUOTA_EXCEEDED', 'quota exceeded'),
    );

    const response = await app.inject({
      method: 'POST', url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'edit-retry-daily-quota' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'AI_IMAGE_EDIT_QUOTA_EXCEEDED' });
    expect(mediaWorkflowService.retry).toHaveBeenCalledWith(expect.objectContaining({ dailyLimit: 7 }));
    expect(enqueueEdit).not.toHaveBeenCalled();
  });

  it('replays an accepted edit retry after the source snapshot changes', async () => {
    const { app, mediaWorkflowService, mediaContextService, enqueueEdit } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, true, false, 7,
    );
    const failed = {
      ...workflow,
      operation: 'FULL_EDIT' as any,
      status: 'FAILED' as const,
      inputs: [{ assetId: 'old-source', role: 'REFERENCE', ordinal: 0 }],
      jobs: (workflow.jobs || []).map((job) => ({
        ...job,
        operation: 'FULL_EDIT',
        model: 'fake-image-edit-v1',
      })),
    };
    mediaWorkflowService.get.mockResolvedValueOnce(failed);
    mediaWorkflowService.retry.mockResolvedValueOnce({
      workflow: { ...failed, status: 'QUEUED' as const },
      jobId: 'edit-job-replayed',
      replayed: true,
    });
    mediaContextService.loadCollect.mockRejectedValueOnce(new Error('source snapshot changed'));

    const response = await app.inject({
      method: 'POST', url: '/workflows/workflow-1/retry',
      payload: { expectedRevision: 2, idempotencyKey: 'edit-retry-response-loss' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, replayed: true });
    expect(mediaWorkflowService.retry).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'edit-retry-response-loss', dailyLimit: 7,
    }));
    expect(mediaContextService.loadCollect).not.toHaveBeenCalled();
    expect(enqueueEdit).not.toHaveBeenCalled();
  });

  it('reports a disabled read context without surfacing a transport error', async () => {
    const { app, mediaContextService } = await build(false);
    const response = await app.inject({ method: 'GET', url: '/contexts/collect/goods-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, msg: 'AI media workflow is disabled' });
    expect(mediaContextService.loadCollect).not.toHaveBeenCalled();
  });

  it('lists owner-scoped contextual workflow history', async () => {
    const { app, mediaWorkflowService } = await build();
    const response = await app.inject({ method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&limit=10&pageVersion=1' });
    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.list).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1', limit: 10,
      includePriority: true,
    });
    expect(response.json().data).toEqual({
      items: [expect.objectContaining({ id: 'workflow-1' })],
      priorityItems: [],
      priorityItemsTruncated: false,
      priorityNextCursor: null,
      nextCursor: null,
    });
  });

  it('forwards an opaque contextual cursor and rejects incomplete context filters', async () => {
    const { app, mediaWorkflowService } = await build();
    const cursor = 'eyJ2IjoxfQ';
    const response = await app.inject({
      method: 'GET',
      url: `/workflows?contextType=collect&contextId=goods-1&limit=10&pageVersion=1&cursor=${cursor}`,
    });
    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.list).toHaveBeenCalledWith(expect.objectContaining({
      cursor, includePriority: false,
    }));

    const missingId = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect&pageVersion=1',
    });
    expect(missingId.statusCode).toBe(400);
    expect(mediaWorkflowService.list).toHaveBeenCalledTimes(1);

    const unversionedCursor = await app.inject({
      method: 'GET',
      url: `/workflows?contextType=collect&contextId=goods-1&cursor=${cursor}`,
    });
    expect(unversionedCursor.statusCode).toBe(400);

    const unscopedPage = await app.inject({ method: 'GET', url: '/workflows?pageVersion=1' });
    expect(unscopedPage.statusCode).toBe(400);
  });

  it('continues the owner/context priority lane through its independent endpoint', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.listPriority.mockResolvedValueOnce({
      items: [workflow], nextCursor: 'priority-next',
    });
    const response = await app.inject({
      method: 'GET',
      url: '/workflows/priority?contextType=collect&contextId=goods-1&limit=100&cursor=priority-current',
    });

    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.listPriority).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
      limit: 100, cursor: 'priority-current',
    });
    expect(response.json().data).toEqual({
      items: [expect.objectContaining({ id: workflow.id })], nextCursor: 'priority-next',
    });

    const incomplete = await app.inject({
      method: 'GET', url: '/workflows/priority?contextType=collect',
    });
    expect(incomplete.statusCode).toBe(400);
    expect(mediaWorkflowService.listPriority).toHaveBeenCalledTimes(1);
  });

  it('preserves the legacy unversioned workflow array during rolling deploys', async () => {
    const { app, mediaWorkflowService } = await build();
    const response = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&limit=10',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([expect.objectContaining({ id: 'workflow-1' })]);
    expect(mediaWorkflowService.list).toHaveBeenCalledWith(expect.objectContaining({ includePriority: false }));

    mediaWorkflowService.list.mockClear();
    const partialLegacyFilter = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect',
    });
    expect(partialLegacyFilter.statusCode).toBe(200);
    expect(partialLegacyFilter.json().data).toEqual([expect.objectContaining({ id: 'workflow-1' })]);
    expect(mediaWorkflowService.list).toHaveBeenCalledWith(expect.objectContaining({
      contextType: 'collect', contextId: undefined, includePriority: false,
    }));
  });

  it('exposes only a current successful standalone edit final as an edit-ready candidate', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.list.mockResolvedValueOnce({ items: [{
      ...workflow,
      operation: 'FULL_EDIT', status: 'SUCCEEDED', reviewStatus: 'PENDING', suiteId: null,
      completedAt: new Date('2026-07-20T08:00:00.000Z'),
      currentAttempt: 1,
      inputs: [{
        id: 'candidate-input-1', assetId: 'source-asset-1', role: 'REFERENCE', ordinal: 0,
        asset: { kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: 'snapshot-1' },
      }],
      jobs: [{
        id: 'edit-job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1',
        workflowAttempt: 1, status: 'SUCCEEDED', operation: 'FULL_EDIT',
        assets: [{
          id: 'candidate-1', ownerUserId: 'owner-1', aiImageJobId: 'edit-job-1',
          kind: 'AI_GENERATED', sourceCaptureSnapshotId: 'snapshot-1',
          url: '/candidate.png', storageBackend: 'local', storageKey: 'candidate.png',
          mimeType: 'image/png', sizeBytes: 100, width: 900, height: 1200,
          sha256: 'a'.repeat(64), metadata: {
            outputRole: 'FINAL_CANDIDATE', pixelOrientationNormalized: true,
            editSourceContractVersion: 'ai-media-edit-source/v1',
          },
        }, {
          id: 'forged-candidate-1', ownerUserId: 'owner-1', aiImageJobId: 'another-job',
          kind: 'AI_GENERATED', sourceCaptureSnapshotId: 'snapshot-1',
          url: '/forged.png', storageBackend: 'local', storageKey: 'forged.png',
          mimeType: 'image/png', sizeBytes: 100, width: 900, height: 1200,
          sha256: 'b'.repeat(64), metadata: {
            outputRole: 'FINAL_CANDIDATE', pixelOrientationNormalized: true,
            editSourceContractVersion: 'ai-media-edit-source/v1',
          },
        }],
      }],
    } as any], nextCursor: null });

    const response = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&pageVersion=1',
    });

    expect(response.statusCode).toBe(200);
    const returnedWorkflow = response.json().data.items[0];
    expect(returnedWorkflow.inputs).toEqual([
      expect.objectContaining({ kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: 'snapshot-1' }),
    ]);
    expect(returnedWorkflow.jobs[0].assets[0]).toMatchObject({
      id: 'candidate-1', editReady: true, sourceCaptureSnapshotId: 'snapshot-1',
    });
    expect(returnedWorkflow.jobs[0].assets[1]).toMatchObject({
      id: 'forged-candidate-1', editReady: false,
    });
  });

  it.each([
    {
      label: 'failed workflow',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.status = 'FAILED'; },
    },
    {
      label: 'successful workflow without completion time',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.completedAt = null; },
    },
    {
      label: 'failed job',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.jobs[0].status = 'FAILED'; },
    },
    {
      label: 'historical attempt',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.currentAttempt = 2; },
    },
    {
      label: 'suite child',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.suiteId = 'suite-1'; },
    },
    {
      label: 'legacy candidate metadata',
      mutate: (candidateWorkflow: any) => {
        delete candidateWorkflow.jobs[0].assets[0].metadata.editSourceContractVersion;
      },
    },
    {
      label: 'mismatched job operation',
      mutate: (candidateWorkflow: any) => { candidateWorkflow.jobs[0].operation = 'IMAGE_TRANSLATE'; },
    },
  ])('marks a $label as not edit-ready in the public workflow DTO', async ({ mutate }) => {
    const { app, mediaWorkflowService } = await build();
    const candidateWorkflow: any = {
      ...workflow,
      operation: 'FULL_EDIT', status: 'SUCCEEDED', reviewStatus: 'PENDING', suiteId: null,
      completedAt: new Date('2026-07-20T08:00:00.000Z'),
      currentAttempt: 1,
      jobs: [{
        id: 'edit-job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1',
        workflowAttempt: 1, status: 'SUCCEEDED', operation: 'FULL_EDIT',
        assets: [{
          id: 'candidate-1', ownerUserId: 'owner-1', aiImageJobId: 'edit-job-1',
          kind: 'AI_GENERATED', sourceCaptureSnapshotId: 'snapshot-1',
          url: '/candidate.png', storageBackend: 'local', storageKey: 'candidate.png',
          mimeType: 'image/png', sizeBytes: 100, width: 900, height: 1200,
          sha256: 'a'.repeat(64), metadata: {
            outputRole: 'FINAL_CANDIDATE', pixelOrientationNormalized: true,
            editSourceContractVersion: 'ai-media-edit-source/v1',
          },
        }],
      }],
    };
    mutate(candidateWorkflow);
    mediaWorkflowService.list.mockResolvedValueOnce({ items: [candidateWorkflow], nextCursor: null });

    const response = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&pageVersion=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0].jobs[0].assets[0]).toMatchObject({
      id: 'candidate-1', editReady: false,
    });
  });

  it('does not expose trusted input storage coordinates from the job detail DTO', async () => {
    const { app } = await build();
    const response = await app.inject({ method: 'GET', url: '/jobs/job-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).not.toHaveProperty('inputAssets');
    expect(response.body).not.toContain('private-source.png');
  });

  it('returns safe translation metadata while keeping the frozen operation config private', async () => {
    const { app, mediaWorkflowService } = await build(true, 'owner-1', true);
    mediaWorkflowService.list.mockResolvedValueOnce({ items: [{
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      jobs: [{
        id: 'translation-job-1', operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED',
        operationConfig: {
          sourceLanguage: 'zh', targetLanguage: 'ru', policyVersion: 'ai-image-translation-policy/1.0',
          terminologies: [{ src: '钢琴黑', tgt: 'глянцевый черный' }],
          domainHint: 'private compiled provider policy',
        },
        assets: [],
      }],
    }], nextCursor: null });

    const response = await app.inject({ method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&pageVersion=1' });
    expect(response.json().data.items[0].jobs[0].translation).toEqual({
      sourceLanguage: 'zh', targetLanguage: 'ru', policyVersion: 'ai-image-translation-policy/1.0',
      terminologies: [{ src: '钢琴黑', tgt: 'глянцевый черный' }],
    });
    expect(response.json().data.items[0].jobs[0]).not.toHaveProperty('operationConfig');
    expect(JSON.stringify(response.json())).not.toContain('private compiled provider policy');
  });

  it('returns safe Provider reconciliation state without lease authority', async () => {
    const { app, mediaWorkflowService } = await build(true, 'owner-1', true);
    mediaWorkflowService.list.mockResolvedValueOnce({ items: [{
      ...workflow,
      operation: 'IMAGE_TRANSLATE' as any,
      status: 'FAILED' as any,
      jobs: [{
        id: 'translation-job-1', operation: 'IMAGE_TRANSLATE', status: 'FAILED',
        providerJobId: 'provider-task-1', errorCode: 'PROVIDER_RECOVERY_REQUIRED',
        costReservation: { status: 'SETTLED' },
        providerReconciliationStatus: 'PENDING', providerReconciliationRevision: 3,
        providerReconciliationAttemptCount: 1,
        providerReconciliationNextAt: new Date('2026-07-21T08:01:00.000Z'),
        providerReconciliationDeadlineAt: new Date('2026-07-22T08:00:00.000Z'),
        providerReconciliationLeaseOwner: 'worker-secret',
        providerReconciliationLeaseTokenHash: 'f'.repeat(64),
        providerReconciliationLeaseExpiresAt: new Date('2026-07-21T08:02:00.000Z'),
        providerReconciliationLastProviderStatus: 'RUNNING',
        providerReconciliationLastErrorCode: 'PROVIDER_TIMEOUT',
        providerReconciliationLastErrorMessage: 'temporary timeout',
        providerReconciledAt: null,
        assets: [],
      }],
    }], nextCursor: null });

    const response = await app.inject({
      method: 'GET', url: '/workflows?contextType=collect&contextId=goods-1&pageVersion=1',
    });
    const returned = response.json().data.items[0].jobs[0];

    expect(returned).toMatchObject({
      retryAllowed: false,
      providerReconciliation: {
        status: 'PENDING', revision: 3, attemptCount: 1,
        lastProviderStatus: 'RUNNING', lastErrorCode: 'PROVIDER_TIMEOUT',
        actionRequired: false,
      },
    });
    expect(returned).not.toHaveProperty('providerReconciliationLeaseOwner');
    expect(returned).not.toHaveProperty('providerReconciliationLeaseTokenHash');
    expect(returned).not.toHaveProperty('providerReconciliationLeaseExpiresAt');
    expect(response.body).not.toContain('worker-secret');
    expect(response.body).not.toContain('f'.repeat(64));
  });

  it('does not expose another tenant workflow', async () => {
    const { app } = await build(true, 'owner-2');
    const response = await app.inject({ method: 'GET', url: '/workflows/workflow-1' });
    expect(response.statusCode).toBe(404);
  });

  it('binds workflow detail recovery to the requested context', async () => {
    const { app } = await build();
    const current = await app.inject({
      method: 'GET',
      url: '/workflows/workflow-1?contextType=collect&contextId=goods-1',
    });
    expect(current.statusCode).toBe(200);

    const otherContext = await app.inject({
      method: 'GET',
      url: '/workflows/workflow-1?contextType=collect&contextId=goods-2',
    });
    expect(otherContext.statusCode).toBe(404);

    const incomplete = await app.inject({
      method: 'GET',
      url: '/workflows/workflow-1?contextType=collect',
    });
    expect(incomplete.statusCode).toBe(400);
  });

  it('uses workflow revision CAS for review and retry', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    const reviewed = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 3, outputAssetId: 'output-1', decision: 'APPROVE', note: 'usable',
    } });
    expect(reviewed.statusCode).toBe(200);
    expect(mediaWorkflowService.review).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));

    const retried = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 4, idempotencyKey: 'retry-idem-1',
    } });
    expect(retried.statusCode).toBe(202);
    expect(enqueue).toHaveBeenCalledWith('job-2');
  });

  it('validates an inpaint workflow against its source image without treating the mask as stale source media', async () => {
    const { app, mediaWorkflowService } = await build(
      true, 'owner-1', false, 'fake', true, false, true, 'oss', true, false, true,
    );
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'INPAINT' as any,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      inputs: [
        { assetId: 'asset-1', role: 'REFERENCE', ordinal: 0 },
        { assetId: 'mask-asset-1', role: 'MASK', ordinal: 0 },
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/review',
      payload: { expectedRevision: 2, outputAssetId: 'output-1', decision: 'APPROVE' },
    });

    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.review).toHaveBeenCalledWith(expect.objectContaining({
      id: 'workflow-1', outputAssetId: 'output-1', decision: 'APPROVE',
    }));
  });

  it('keeps a legacy workflow current after an edit companion becomes preferred', async () => {
    const { app, mediaWorkflowService, mediaContextService } = await build();
    mediaContextService.loadCollect.mockResolvedValueOnce({
      target: { type: 'collect', id: 'goods-1', label: 'Product' },
      snapshot: { id: 'snapshot-1', version: 1, captureHash: 'hash-1' },
      inputs: [{
        sourceMediaKey: 'main-1', role: 'main', sourceUrl: 'https://source.example/main.jpg',
        assetId: 'asset-edit-companion', compatibleAssetIds: ['asset-edit-companion', 'asset-legacy'],
        assetUrl: '/uploads/edit-source.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000,
        editReady: true,
      }],
    });
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'collect',
      contextId: 'goods-1',
      inputs: [{ assetId: 'asset-legacy', role: 'REFERENCE', ordinal: 0 }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/review',
      payload: { expectedRevision: 2, outputAssetId: 'output-1', decision: 'APPROVE' },
    });

    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.review).toHaveBeenCalledWith(expect.objectContaining({
      id: 'workflow-1', outputAssetId: 'output-1', decision: 'APPROVE',
    }));
  });

  it('keeps a chained edit current when its normalized candidate belongs to the current snapshot', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'FULL_EDIT' as any,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'collect',
      contextId: 'goods-1',
      inputs: [{
        assetId: 'candidate-1', role: 'REFERENCE', ordinal: 0,
        asset: {
          kind: 'AI_GENERATED', sourceCaptureSnapshotId: 'snapshot-1',
        },
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/review',
      payload: { expectedRevision: 2, outputAssetId: 'output-1', decision: 'APPROVE' },
    });

    expect(response.statusCode).toBe(200);
    expect(mediaWorkflowService.review).toHaveBeenCalled();
  });

  it('rejects a chained edit when its generated source belongs to an old snapshot', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      operation: 'FULL_EDIT' as any,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'collect',
      contextId: 'goods-1',
      inputs: [{
        assetId: 'candidate-old', role: 'REFERENCE', ordinal: 0,
        asset: {
          kind: 'AI_GENERATED', sourceCaptureSnapshotId: 'snapshot-old',
        },
      }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workflows/workflow-1/review',
      payload: { expectedRevision: 2, outputAssetId: 'output-1', decision: 'APPROVE' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('keeps suite child workflows behind the suite-level lifecycle contract', async () => {
    const { app, repository, mediaWorkflowService, enqueue, applyAssets } = await build();
    mediaWorkflowService.get.mockResolvedValue({ ...workflow, suiteId: 'suite-1' });
    repository.getById.mockResolvedValue({
      id: 'job-1',
      ownerUserId: 'owner-1',
      workflowId: 'workflow-1',
      status: 'SUCCEEDED',
      prompt: 'frozen suite prompt must not leak',
      workflow: { suiteSlot: { suiteId: 'suite-1', ownerUserId: 'owner-1' } },
      assets: [],
    });

    const jobDetail = await app.inject({ method: 'GET', url: '/jobs/job-1' });
    expect(jobDetail.statusCode).toBe(409);
    expect(jobDetail.json()).toMatchObject({ code: 'INVALID_STATE' });
    expect(jobDetail.body).not.toContain('frozen suite prompt');

    const detail = await app.inject({ method: 'GET', url: '/workflows/workflow-1' });
    expect(detail.statusCode).toBe(409);
    expect(detail.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(detail.body).not.toContain('prompt');

    const cancel = await app.inject({ method: 'POST', url: '/workflows/workflow-1/cancel', payload: {
      expectedRevision: 1,
    } });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.cancel).not.toHaveBeenCalled();

    const retry = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1, idempotencyKey: 'suite-child-retry-blocked',
    } });
    expect(retry.statusCode).toBe(409);
    expect(retry.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.retry).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    const review = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    expect(review.statusCode).toBe(409);
    expect(review.json()).toMatchObject({ code: 'WORKFLOW_CONFLICT' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();

    const apply = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
    } });
    expect(apply.statusCode).toBe(409);
    expect(apply.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
    expect(applyAssets).not.toHaveBeenCalled();
  });

  it('rejects retry when the frozen source capture snapshot is no longer current', async () => {
    const { app, mediaWorkflowService, enqueue } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'FAILED',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });
    mediaWorkflowService.retry.mockRejectedValueOnce(
      new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', 'source snapshot changed'),
    );

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 1,
      idempotencyKey: 'retry-stale-source',
    } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaWorkflowService.retry).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'retry-stale-source',
    }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('resolves and internalizes an owner-scoped collect image context', async () => {
    const { app, mediaContextService } = await build();
    const loaded = await app.inject({ method: 'GET', url: '/contexts/collect/goods-1' });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.inputs[0]).toMatchObject({ assetId: 'asset-1', sourceMediaKey: 'main-1' });
    expect(mediaContextService.loadCollect).toHaveBeenCalledWith('owner-1', 'goods-1');

    const internalized = await app.inject({
      method: 'POST', url: '/contexts/collect/goods-1/internalize', payload: {
        sourceMediaKey: 'main-1', purpose: 'EDIT',
      },
    });
    expect(internalized.statusCode).toBe(200);
    expect(mediaContextService.internalizeCollect).toHaveBeenCalledWith('owner-1', 'goods-1', 'main-1', 'EDIT');
  });

  it('resolves and internalizes an exact listing-draft revision, SKU, and slot', async () => {
    const { app, mediaContextService } = await build();
    const loaded = await app.inject({
      method: 'GET',
      url: '/contexts/listing-draft/draft-1?revision=7&draftVersion=3&skuKey=sku-red&slotKey=sku-hero',
    });

    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().data.target).toMatchObject({
      type: 'listing-draft', id: 'draft-1', revision: 7, draftVersion: 3,
      skuKey: 'sku-red', slotKey: 'sku-hero',
    });
    expect(mediaContextService.loadListingDraft).toHaveBeenCalledWith('owner-1', 'draft-1', {
      expectedRevision: 7, expectedDraftVersion: 3, skuKey: 'sku-red', slotKey: 'sku-hero',
    });

    const internalized = await app.inject({
      method: 'POST',
      url: '/contexts/listing-draft/draft-1/internalize',
      payload: {
        sourceMediaKey: 'main-1', purpose: 'EDIT', revision: 7, draftVersion: 3,
        skuKey: 'sku-red', slotKey: 'sku-hero',
      },
    });

    expect(internalized.statusCode).toBe(200);
    expect(internalized.json().data).toMatchObject({ id: 'asset-1', editReady: true });
    expect(mediaContextService.internalizeListingDraft).toHaveBeenCalledWith(
      'owner-1',
      'draft-1',
      'main-1',
      { expectedRevision: 7, expectedDraftVersion: 3, skuKey: 'sku-red', slotKey: 'sku-hero' },
      'EDIT',
    );
  });

  it('compensates a retry when the queue is unavailable', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue offline'));
    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 2, idempotencyKey: 'retry-idem-offline',
    } });
    expect(response.statusCode).toBe(503);
    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-2', expect.objectContaining({
      errorCode: 'QUEUE_UNAVAILABLE',
    }));
  });

  it('does not overwrite a retry already claimed by a worker when queue acknowledgement fails', async () => {
    const { app, repository, enqueue } = await build();
    enqueue.mockRejectedValueOnce(new Error('queue acknowledgement lost'));
    repository.markEnqueueFailed.mockResolvedValueOnce(false);

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/retry', payload: {
      expectedRevision: 2, idempotencyKey: 'retry-idem-claimed',
    } });

    expect(response.statusCode).toBe(202);
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('binds approved output application to the reviewed collect context', async () => {
    const { app, repository, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow, status: 'SUCCEEDED', reviewStatus: 'APPROVED',
      contextType: 'collect', contextId: 'goods-1', selectedOutputAssetId: 'output-1',
    });
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'other-goods',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
    expect(repository.recordApplication).not.toHaveBeenCalled();
  });

  it('rejects review when the source capture snapshot is no longer current', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'collect',
      contextId: 'goods-1',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('rechecks the frozen listing-draft authority before review', async () => {
    const { app, mediaWorkflowService, mediaContextService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      contextType: 'listing-draft',
      contextId: 'draft-1',
      contextSkuKey: 'sku-red',
      contextSlotKey: 'sku-hero',
      contextDraftRevision: 7,
      contextDraftVersion: 3,
      inputs: [{ assetId: 'asset-1', role: 'REFERENCE', ordinal: 0 }],
    });
    mediaContextService.loadListingDraft.mockRejectedValueOnce(
      new AiMediaContextError('STALE_MEDIA_CONTEXT', 409, 'draft pointer changed'),
    );

    const response = await app.inject({ method: 'POST', url: '/workflows/workflow-1/review', payload: {
      expectedRevision: 1, outputAssetId: 'output-1', decision: 'APPROVE',
    } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(mediaContextService.loadListingDraft).toHaveBeenCalledWith('owner-1', 'draft-1', {
      expectedRevision: 7, expectedDraftVersion: 3, skuKey: 'sku-red', slotKey: 'sku-hero',
    });
    expect(mediaWorkflowService.review).not.toHaveBeenCalled();
  });

  it('rejects replace application for translation candidates', async () => {
    const { app, repository } = await build();
    repository.getById.mockResolvedValueOnce({
      id: 'job-translation-1', ownerUserId: 'owner-1', workflowId: 'workflow-1',
      operation: 'IMAGE_TRANSLATE', status: 'SUCCEEDED', assets: [{ id: 'output-1', kind: 'AI_GENERATED', url: '/output.png' }],
    } as any);
    const response = await app.inject({ method: 'POST', url: '/jobs/job-translation-1/apply', payload: {
      mode: 'replace', targetType: 'collect', targetId: 'goods-1',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
  });

  it('rejects an approved candidate after its source capture snapshot changes', async () => {
    const { app, mediaWorkflowService } = await build();
    mediaWorkflowService.get.mockResolvedValueOnce({
      ...workflow,
      status: 'SUCCEEDED',
      reviewStatus: 'APPROVED',
      contextType: 'collect',
      contextId: 'goods-1',
      selectedOutputAssetId: 'output-1',
      inputs: [{ assetId: 'asset-from-old-snapshot', url: '/images/old-source.png' }],
    });

    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/apply', payload: {
      mode: 'append', targetType: 'collect', targetId: 'goods-1',
      expectedTargetUpdatedAt: '2026-07-19T00:00:00.000Z',
    } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'APPLICATION_MUTATION_REQUIRED' });
  });

  it('requires workflow cancellation for a workflow-backed child job', async () => {
    const { app, repository } = await build();
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/cancel' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'WORKFLOW_CANCEL_REQUIRED' });
    expect(repository.requestCancellation).not.toHaveBeenCalled();
  });

  it('does not reveal another tenant workflow child through the legacy cancellation endpoint', async () => {
    const { app, repository } = await build(true, 'owner-2');
    const response = await app.inject({ method: 'POST', url: '/jobs/job-1/cancel' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.requestCancellation).not.toHaveBeenCalled();
  });
});
