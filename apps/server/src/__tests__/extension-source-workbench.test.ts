import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionSourceWorkbenchRoutes } from '../routes/extension-source-workbench.js';
import {
  createExtensionSourceWorkbenchService,
  ExtensionSourceWorkbenchError,
} from '../services/extension-source-workbench.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';

function decision(enabled: boolean) {
  return {
    enabled,
    legacyAllowed: !enabled,
    captureStage: null,
    reason: enabled ? 'pilot_match' as const : 'master_off' as const,
    revision: enabled ? 'pilot-7' : 'master-off',
  };
}

async function buildRouteApp(input: {
  enabled?: boolean;
  withDevice?: boolean;
  allowedShopIds?: string[];
  scopes?: string[];
}) {
  const loadStatus = vi.fn(async () => ({
    contractVersion: 'extension-source-workbench-status/v1' as const,
    snapshot: {
      id: 'snapshot-1',
      version: 4,
      capturedAt: '2026-07-21T00:00:00.000Z',
      current: true,
    },
    listing: { items: [], truncated: false },
    media: { items: [], truncated: false, actionableCount: 0 },
  }));
  const loadMediaHistory = vi.fn(async () => ({
    contractVersion: 'extension-source-media-history/v1' as const,
    context: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', revision: 1, draftVersion: 1,
    },
    snapshot: { id: 'snapshot-1', version: 4, capturedAt: '2026-07-21T00:00:00.000Z' },
    items: [],
    nextCursor: null,
  }));
  const createDraft = vi.fn(async () => ({
    id: 'draft-1', shopId: 'shop-1', stage: 'CATEGORY_REVIEW', status: 'ACTIVE',
    runState: 'ACTIVE', revision: 1, draftVersion: 1, selectedSkuCount: 1,
    mediaAssignmentCount: 0, validationStatus: 'NOT_RUN', blockerCount: 0,
    warningCount: 0, blockers: [], warnings: [], updatedAt: '2026-07-21T03:00:00.000Z',
  }));
  const evaluate = vi.fn(async (feature: string) => ({
    ...decision(input.enabled !== false),
    ...(feature === 'SOURCE_LISTING_WORKFLOW'
      ? { listingStage: input.enabled === false ? 'off' as const : 'dual_read' as const }
      : {}),
  }));
  const app = Fastify();
  await app.register(extensionSourceWorkbenchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: async (request: FastifyRequest) => {
      if (input.withDevice === false) return;
      (request as any).device = {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        sessionId: 'session-1',
        scopes: input.scopes ?? ['listing:review', 'media:execute'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1', 'shop-2'],
      };
    },
    featureFlags: { evaluate },
    service: { loadStatus, loadMediaHistory, createDraft },
  });
  await app.ready();
  return { app, loadStatus, loadMediaHistory, createDraft, evaluate };
}

describe('extension source workbench route', () => {
  it('loads a device-scoped, exact-snapshot summary when the rollout matches', async () => {
    const { app, loadStatus, evaluate } = await buildRouteApp({});
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-7' },
          status: expect.objectContaining({
            contractVersion: 'extension-source-workbench-status/v1',
          }),
        },
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: 'owner-1',
        deviceSessionId: 'session-1',
      });
      expect(loadStatus).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        allowedShopIds: ['shop-1', 'shop-2'],
        canExecuteMedia: true,
        snapshotId: 'snapshot-1',
        supplyGoodsId: 'goods-1',
      });
    } finally {
      await app.close();
    }
  });

  it('returns a dark capability without reading tenant data while disabled', async () => {
    const { app, loadStatus } = await buildRouteApp({ enabled: false });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        code: 1,
        data: {
          capability: { enabled: false, reason: 'master_off', revision: 'master-off' },
          status: null,
        },
      });
      expect(loadStatus).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps a live device session valid when every shop grant has been removed', async () => {
    const { app, loadStatus } = await buildRouteApp({ allowedShopIds: [] });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
      });
      expect(response.statusCode).toBe(200);
      expect(loadStatus).toHaveBeenCalledWith(expect.objectContaining({
        allowedShopIds: [], canExecuteMedia: true,
      }));
    } finally {
      await app.close();
    }
  });

  it('fails closed without a live device identity and rejects loose queries', async () => {
    const { app, loadStatus } = await buildRouteApp({ withDevice: false });
    try {
      const unauthorized = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
      });
      expect(unauthorized.statusCode).toBe(401);
      expect(unauthorized.json()).toMatchObject({ errorCode: 'invalid_device_context' });

      const invalid = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1&ownerUserId=owner-2',
      });
      expect(invalid.statusCode).toBe(400);
      expect(loadStatus).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps media actions disabled for a read-only device session', async () => {
    const { app, loadStatus } = await buildRouteApp({ scopes: ['listing:review'] });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/extension-device/source-workbench/status?snapshotId=snapshot-1&supplyGoodsId=goods-1',
      });
      expect(response.statusCode).toBe(200);
      expect(loadStatus).toHaveBeenCalledWith(expect.objectContaining({ canExecuteMedia: false }));
    } finally {
      await app.close();
    }
  });

  it('creates an owned draft through the existing workflow owner for an exact write-scoped shop', async () => {
    const { app, createDraft, evaluate } = await buildRouteApp({
      scopes: ['listing:review', 'listing:write'],
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/drafts',
        payload: {
          snapshotId: 'snapshot-1',
          supplyGoodsId: 'goods-1',
          shopId: 'shop-1',
          selectedSkuKeys: ['sku-1'],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: expect.objectContaining({ id: 'draft-1', revision: 1, draftVersion: 1 }),
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_WORKFLOW', {
        ownerUserId: 'owner-1', shopId: 'shop-1', platform: 'OZON',
      });
      expect(createDraft).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
        snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', selectedSkuKeys: ['sku-1'],
      });
    } finally {
      await app.close();
    }
  });

  it('rejects draft creation without write scope, an exact shop grant, or an enabled listing stage', async () => {
    const readOnly = await buildRouteApp({ scopes: ['listing:review'] });
    const wrongShop = await buildRouteApp({
      scopes: ['listing:review', 'listing:write'], allowedShopIds: ['shop-2'],
    });
    const dark = await buildRouteApp({
      enabled: false, scopes: ['listing:review', 'listing:write'],
    });
    const request = {
      method: 'POST' as const,
      url: '/api/extension-device/source-workbench/drafts',
      payload: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1', selectedSkuKeys: ['sku-1'] },
    };
    try {
      expect((await readOnly.app.inject(request)).statusCode).toBe(403);
      expect((await wrongShop.app.inject(request)).statusCode).toBe(403);
      expect((await dark.app.inject(request)).statusCode).toBe(409);
      expect(readOnly.createDraft).not.toHaveBeenCalled();
      expect(wrongShop.createDraft).not.toHaveBeenCalled();
      expect(dark.createDraft).not.toHaveBeenCalled();
    } finally {
      await Promise.all([readOnly.app.close(), wrongShop.app.close(), dark.app.close()]);
    }
  });
});

describe('extension source workbench status service', () => {
  it('delegates draft identity to the ownership resolver and existing workflow owner', async () => {
    const ownership = {
      assertOwnedTarget: vi.fn(async () => ({
        shopId: 'shop-canonical',
        supplyGoodsId: 'goods-canonical',
        sourceCaptureSnapshotId: 'snapshot-canonical',
        sourceCaptureHash: 'capture-hash-canonical',
        selectedSkuKeys: ['sku-canonical'],
      })),
    };
    const workflow = {
      createDraft: vi.fn(async () => ({
        id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-canonical',
        supplyGoodsId: 'goods-canonical', sourceCaptureSnapshotId: 'snapshot-canonical',
        sourceCaptureHash: 'capture-hash-canonical', selectedSkuKeys: ['sku-canonical'],
        stage: 'CATEGORY_REVIEW', status: 'ACTIVE', runState: 'ACTIVE', revision: 1,
        draftVersion: 1, media: { assignments: [] }, validation: { status: 'NOT_RUN' },
        blockers: [], warnings: [], updatedAt: '2026-07-21T03:00:00.000Z',
      })),
    };
    const service = createExtensionSourceWorkbenchService({
      ownership: ownership as never,
      workflow: workflow as never,
    });

    const result = await service.createDraft({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-requested',
      snapshotId: 'snapshot-requested', supplyGoodsId: 'goods-requested',
      selectedSkuKeys: ['sku-alias'],
    });

    expect(ownership.assertOwnedTarget).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', shopId: 'shop-requested', supplyGoodsId: 'goods-requested',
      sourceCaptureSnapshotId: 'snapshot-requested', selectedSkuKeys: ['sku-alias'],
    });
    expect(workflow.createDraft).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-canonical',
      supplyGoodsId: 'goods-canonical', sourceCaptureSnapshotId: 'snapshot-canonical',
      sourceCaptureHash: 'capture-hash-canonical', selectedSkuKeys: ['sku-canonical'],
    });
    expect(result).toMatchObject({
      id: 'draft-1', shopId: 'shop-canonical', revision: 1, draftVersion: 1,
      selectedSkuCount: 1, mediaAssignmentCount: 0,
    });
    expect(JSON.stringify(result)).not.toContain('capture-hash-canonical');
  });

  it('returns bounded fields and queries only the current listing revision and draft version', async () => {
    const client = {
      sourceCaptureSnapshot: {
        findFirst: vi.fn(async () => ({
          id: 'snapshot-1',
          version: 4,
          capturedAt: new Date('2026-07-21T00:00:00.000Z'),
          subject: { snapshots: [{ id: 'snapshot-1' }] },
        })),
      },
      sourceListingWorkflow: {
        findMany: vi.fn(async () => [{
          id: 'draft-1',
          shopId: 'shop-1',
          stage: 'MEDIA_REVIEW',
          status: 'ACTIVE',
          currentRevision: 8,
          currentDraftVersion: 3,
          selectedSkuKeys: ['sku-1', 'sku-2'],
          updatedAt: new Date('2026-07-21T01:00:00.000Z'),
          currentDraft: {
            payload: {
              runState: 'ACTIVE',
              blockers: [{ code: 'media_missing', message: 'Need an image', fieldPath: '/media' }],
              warnings: [{ code: 'copy_review', message: 'Review copy' }],
              media: { assignments: [{ assetId: 'asset-1' }] },
              validation: { status: 'BLOCKED', secret: 'must-not-leak' },
              copy: { candidates: [{ resolvedPrompt: 'private prompt' }] },
            },
          },
        }]),
      },
      aiMediaWorkflow: {
        findMany: vi.fn(async () => [{
          id: 'media-1',
          operation: 'IMAGE_TRANSLATE',
          status: 'RUNNING',
          reviewStatus: 'NOT_READY',
          revision: 2,
          contextType: 'listing-draft',
          contextId: 'draft-1',
          contextDraftRevision: 8,
          contextDraftVersion: 3,
          contextSkuKey: 'sku-1',
          contextSlotKey: 'hero',
          selectedOutputAssetId: null,
          jobs: [{
            provider: 'fake', providerJobId: null,
            providerReconciliationStatus: 'NOT_REQUIRED',
            costReservation: { status: 'RELEASED' },
          }],
          updatedAt: new Date('2026-07-21T02:00:00.000Z'),
        }]),
      },
    };
    const service = createExtensionSourceWorkbenchService({ client: client as never });

    const result = await service.loadStatus({
      ownerUserId: 'owner-1',
      allowedShopIds: ['shop-1'],
      canExecuteMedia: true,
      snapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
    });

    expect(result).toEqual({
      contractVersion: 'extension-source-workbench-status/v1',
      snapshot: {
        id: 'snapshot-1', version: 4,
        capturedAt: '2026-07-21T00:00:00.000Z', current: true,
      },
      listing: {
        truncated: false,
        items: [{
          id: 'draft-1', shopId: 'shop-1', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
          runState: 'ACTIVE', revision: 8, draftVersion: 3, selectedSkuCount: 2,
          mediaAssignmentCount: 1, validationStatus: 'BLOCKED', blockerCount: 1,
          warningCount: 1,
          blockers: [{ code: 'media_missing', message: 'Need an image', fieldPath: '/media' }],
          warnings: [{ code: 'copy_review', message: 'Review copy', fieldPath: null }],
          updatedAt: '2026-07-21T01:00:00.000Z',
        }],
      },
      media: {
        truncated: false,
        actionableCount: 1,
        items: [{
          id: 'media-1', operation: 'IMAGE_TRANSLATE', status: 'RUNNING',
          reviewStatus: 'NOT_READY', revision: 2, contextType: 'listing-draft',
          contextId: 'draft-1', contextSkuKey: 'sku-1', contextSlotKey: 'hero',
          hasSelectedOutput: false, actionable: true,
          commandContext: {
            shopId: 'shop-1', listingWorkflowId: 'draft-1',
            draftRevision: 8, draftVersion: 3,
          },
          allowedActions: ['CANCEL'],
          updatedAt: '2026-07-21T02:00:00.000Z',
        }],
      },
    });
    expect(client.sourceListingWorkflow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerUserId: 'owner-1', shopId: { in: ['shop-1'] } }),
    }));
    expect(client.aiMediaWorkflow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1',
        OR: [{ suiteSlot: { is: null }, OR: [{
          contextType: 'collect', contextId: 'goods-1',
          inputs: { some: { asset: { is: { sourceCaptureSnapshotId: 'snapshot-1' } } } },
        }, { contextType: 'listing-draft', contextId: 'draft-1', contextDraftRevision: 8, contextDraftVersion: 3 }] },
        { suiteSlot: { is: { suite: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILURE'] } } } }, contextType: 'collect', contextId: 'goods-1' }],
      }),
    }));
    expect(client.aiMediaWorkflow.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          contextType: 'listing-draft',
          contextId: 'draft-1',
        }]),
      }),
    }));
    expect(client.aiMediaWorkflow.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          contextType: 'listing-draft',
          contextId: 'draft-1',
          contextDraftRevision: 7,
          contextDraftVersion: 3,
        }]),
      }),
    }));
    expect(client.aiMediaWorkflow.findMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{
          contextType: 'listing-draft',
          contextId: 'draft-1',
          contextDraftRevision: 8,
          contextDraftVersion: 2,
        }]),
      }),
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private prompt');
    expect(serialized).not.toContain('must-not-leak');
  });

  it('does not disclose a foreign or mismatched capture', async () => {
    const service = createExtensionSourceWorkbenchService({
      client: {
        sourceCaptureSnapshot: { findFirst: vi.fn(async () => null) },
        sourceListingWorkflow: { findMany: vi.fn() },
        aiMediaWorkflow: { findMany: vi.fn() },
      } as never,
    });
    await expect(service.loadStatus({
      ownerUserId: 'owner-2',
      allowedShopIds: ['shop-1'],
      canExecuteMedia: true,
      snapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
    })).rejects.toEqual(expect.objectContaining<Partial<ExtensionSourceWorkbenchError>>({
      code: 'SOURCE_WORKBENCH_NOT_FOUND',
      statusCode: 404,
    }));
  });

  it('counts pending review and unapplied approvals as actionable without suite children', async () => {
    const base = {
      id: 'media-1', operation: 'IMAGE_TO_IMAGE', status: 'SUCCEEDED',
      reviewStatus: 'PENDING', revision: 1, contextType: 'collect', contextId: 'goods-1',
      contextSkuKey: null, contextSlotKey: null, selectedOutputAssetId: 'asset-1',
      updatedAt: new Date('2026-07-21T02:00:00.000Z'),
    };
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 1, capturedAt: new Date(),
        subject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      sourceListingWorkflow: { findMany: vi.fn(async () => []) },
      aiMediaWorkflow: { findMany: vi.fn(async () => [
        { ...base, id: 'pending', selectedOutputAsset: null },
        {
          ...base, id: 'approved', reviewStatus: 'APPROVED',
          selectedOutputAsset: { aiImageJob: { appliedAt: null } },
        },
        {
          ...base, id: 'applied', reviewStatus: 'APPROVED',
          selectedOutputAsset: { aiImageJob: { appliedAt: new Date() } },
        },
        {
          ...base, id: 'rejected', reviewStatus: 'REJECTED',
          selectedOutputAsset: { aiImageJob: { appliedAt: null } },
        },
      ]) },
    };
    const service = createExtensionSourceWorkbenchService({ client: client as never });
    const result = await service.loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: ['shop-1'],
      canExecuteMedia: true,
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    });
    expect(result.media.actionableCount).toBe(2);
    expect(result.media.items.map((item) => [item.id, item.actionable])).toEqual([
      ['pending', true],
      ['approved', true],
      ['applied', false],
      ['rejected', false],
    ]);
    expect(result.media.items.every((item) => (
      item.commandContext === null && item.allowedActions.length === 0
    ))).toBe(true);
  });

  it('keeps unregistered translation and read-only media commands disabled', async () => {
    const row = {
      id: 'media-1', operation: 'IMAGE_TRANSLATE', status: 'FAILED',
      reviewStatus: 'NOT_READY', revision: 2, contextType: 'listing-draft',
      contextId: 'draft-1', contextDraftRevision: 8, contextDraftVersion: 3,
      contextSkuKey: null, contextSlotKey: 'hero', selectedOutputAssetId: null,
      updatedAt: new Date('2026-07-21T02:00:00.000Z'),
      jobs: [{
        provider: 'dashscope-qwen-mt-image', providerJobId: null,
        providerReconciliationStatus: 'NOT_REQUIRED', costReservation: { status: 'RELEASED' },
      }],
    };
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 1, capturedAt: new Date(),
        subject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      sourceListingWorkflow: { findMany: vi.fn(async () => [{
        id: 'draft-1', shopId: 'shop-1', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
        currentRevision: 8, currentDraftVersion: 3, selectedSkuKeys: [],
        updatedAt: new Date(), currentDraft: { payload: {} },
      }]) },
      aiMediaWorkflow: { findMany: vi.fn(async () => [row]) },
    };
    const service = createExtensionSourceWorkbenchService({ client: client as never });
    const paid = await service.loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: ['shop-1'], canExecuteMedia: true,
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    });
    expect(paid.media.items[0]).toMatchObject({ commandContext: null, allowedActions: [] });

    row.jobs = [{
      provider: 'fake', providerJobId: null,
      providerReconciliationStatus: 'NOT_REQUIRED', costReservation: { status: 'RELEASED' },
    }];
    const readOnly = await service.loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: ['shop-1'], canExecuteMedia: false,
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    });
    expect(readOnly.media.items[0]).toMatchObject({ commandContext: null, allowedActions: [] });
  });
});

function normalJobRuntime(version: 'v1' | 'v3' = 'v3', provider = 'openai-images', model = 'gpt-image-1') {
  return createAiImageProviderRuntimeContract({
    provider, model,
    baseUrl: provider === 'openai-images' ? 'https://api.openai.com/v1' : 'https://relay.example/v1',
    costPerImageCents: 7,
    ...(version === 'v3' ? { currency: 'USD' as const } : {}),
  }, { count: 1, width: 1024, height: 1024 });
}

function normalMediaStatusFixture(input: {
  provider?: string;
  model?: string;
  operation?: string;
  operationConfig?: unknown;
  status?: string;
  costStatus?: string;
  providerJobId?: string;
  providerReconciliationStatus?: string;
  errorCode?: string;
  canExecuteMedia?: boolean;
  production?: boolean;
  contextDraftRevision?: number;
}) {
  const job: Record<string, unknown> = {
    provider: input.provider ?? 'openai-images', model: input.model ?? 'gpt-image-1',
    operationConfig: input.operationConfig,
    providerJobId: input.providerJobId ?? null,
    providerReconciliationStatus: input.providerReconciliationStatus ?? 'NOT_REQUIRED',
    errorCode: input.errorCode ?? null,
    costReservation: { status: input.costStatus ?? 'RELEASED' },
  };
  const client = {
    sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
      id: 'snapshot-1', version: 1, capturedAt: new Date('2026-07-21T00:00:00.000Z'),
      subject: { snapshots: [{ id: 'snapshot-1' }] },
    })) },
    sourceListingWorkflow: { findMany: vi.fn(async () => [{
      id: 'draft-1', shopId: 'shop-1', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
      currentRevision: 8, currentDraftVersion: 3, selectedSkuKeys: [],
      updatedAt: new Date('2026-07-21T01:00:00.000Z'), currentDraft: { payload: {} },
    }]) },
    aiMediaWorkflow: { findMany: vi.fn(async (query: any) => [{
      id: 'media-normal', operation: input.operation ?? 'IMAGE_TO_IMAGE', status: input.status ?? 'FAILED',
      reviewStatus: 'NOT_READY', revision: 2, contextType: 'listing-draft', contextId: 'draft-1',
      contextDraftRevision: input.contextDraftRevision ?? 8, contextDraftVersion: 3,
      contextSkuKey: 'sku-1', contextSlotKey: 'hero', selectedOutputAssetId: null,
      updatedAt: new Date('2026-07-21T02:00:00.000Z'),
      // Respect the database projection: an unselected frozen contract cannot reach admission.
      jobs: [Object.fromEntries(Object.keys(query.select.jobs.select).map((key) => [key, job[key]]))],
    }]) },
  };
  const service = createExtensionSourceWorkbenchService({ client, production: input.production ?? true });
  return {
    load: () => service.loadStatus({
      ownerUserId: 'owner-1', allowedShopIds: ['shop-1'],
      canExecuteMedia: input.canExecuteMedia ?? true,
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    }),
  };
}

describe('extension source workbench normal task commands', () => {
  it.each([
    { version: 'v1' as const, nested: false, operation: 'IMAGE_TO_IMAGE', status: 'RUNNING', action: 'CANCEL' },
    { version: 'v3' as const, nested: false, operation: 'IMAGE_TO_IMAGE', status: 'FAILED', action: 'RETRY' },
    { version: 'v1' as const, nested: true, operation: 'FULL_EDIT', status: 'FAILED', action: 'RETRY' },
    { version: 'v3' as const, nested: true, operation: 'INPAINT', status: 'RUNNING', action: 'CANCEL' },
  ])('exposes $action for a normal OpenAI $version $operation task', async (testCase) => {
    const runtime = normalJobRuntime(testCase.version);
    const result = await normalMediaStatusFixture({
      operation: testCase.operation, status: testCase.status,
      costStatus: testCase.status === 'RUNNING' ? 'RESERVED' : 'RELEASED',
      operationConfig: testCase.nested ? { providerRuntime: runtime } : runtime,
    }).load();
    expect(result.media.items[0]).toMatchObject({
      commandContext: { shopId: 'shop-1', listingWorkflowId: 'draft-1', draftRevision: 8, draftVersion: 3 },
      allowedActions: [testCase.action],
    });
    expect(JSON.stringify(result)).not.toContain(runtime.baseUrlSha256);
    expect(result.media.items[0]).not.toHaveProperty('operationConfig');
  });

  it.each([
    { name: 'a different endpoint', operationConfig: { ...normalJobRuntime(), baseUrlSha256: 'a'.repeat(64) } },
    { name: 'missing frozen runtime', operationConfig: undefined },
    { name: 'malformed frozen runtime', operationConfig: { providerRuntime: { contractVersion: 'invalid' } } },
    { name: 'unregistered custom edit', provider: 'custom', model: 'unregistered-edit-model', operationConfig: normalJobRuntime('v3', 'custom', 'unregistered-edit-model') },
    { name: 'production fake', provider: 'fake', model: 'fake', operationConfig: undefined },
    { name: 'an unsupported operation', operation: 'IMAGE_TRANSLATE', operationConfig: normalJobRuntime() },
    { name: 'a mismatched frozen identity', model: 'other-model', operationConfig: normalJobRuntime() },
    { name: 'a read-only device', canExecuteMedia: false, operationConfig: normalJobRuntime() },
    { name: 'a stale draft revision', contextDraftRevision: 7, operationConfig: normalJobRuntime() },
  ])('keeps commands closed for $name', async ({ name: _name, ...input }) => {
    const result = await normalMediaStatusFixture(input).load();
    expect(result.media.items[0]).toMatchObject({ commandContext: null, allowedActions: [] });
  });

  it.each([
    { costStatus: 'RESERVED' },
    { costStatus: 'UNKNOWN_OUTCOME' },
    { costStatus: 'SUBMISSION_UNCERTAIN' },
    { providerJobId: 'accepted-provider-task' },
    { errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN' },
    { providerReconciliationStatus: 'MANUAL_REVIEW' },
  ])('does not expose retry while a normal task has pending cost or Provider outcome: %j', async (pending) => {
    const result = await normalMediaStatusFixture({ ...pending, operationConfig: normalJobRuntime() }).load();
    expect(result.media.items[0]).toMatchObject({ commandContext: null, allowedActions: [] });
  });
});
