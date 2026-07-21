import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionSourceWorkbenchRoutes } from '../routes/extension-source-workbench.js';
import {
  createExtensionSourceWorkbenchService,
  ExtensionSourceWorkbenchError,
} from '../services/extension-source-workbench.js';

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
  const evaluate = vi.fn(async () => decision(input.enabled !== false));
  const app = Fastify();
  await app.register(extensionSourceWorkbenchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: async (request: FastifyRequest) => {
      if (input.withDevice === false) return;
      (request as any).device = {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        sessionId: 'session-1',
        scopes: ['listing:review'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1', 'shop-2'],
      };
    },
    featureFlags: { evaluate },
    service: { loadStatus },
  });
  await app.ready();
  return { app, loadStatus, evaluate };
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
      expect(loadStatus).toHaveBeenCalledWith(expect.objectContaining({ allowedShopIds: [] }));
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
});

describe('extension source workbench status service', () => {
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
          contextSkuKey: 'sku-1',
          contextSlotKey: 'hero',
          selectedOutputAssetId: null,
          updatedAt: new Date('2026-07-21T02:00:00.000Z'),
        }]),
      },
    };
    const service = createExtensionSourceWorkbenchService({ client: client as never });

    const result = await service.loadStatus({
      ownerUserId: 'owner-1',
      allowedShopIds: ['shop-1'],
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
        suiteSlot: { is: null },
        OR: [{
          contextType: 'collect',
          contextId: 'goods-1',
          inputs: { some: { asset: { is: { sourceCaptureSnapshotId: 'snapshot-1' } } } },
        }, {
          contextType: 'listing-draft',
          contextId: 'draft-1',
          contextDraftRevision: 8,
          contextDraftVersion: 3,
        }],
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
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    });
    expect(result.media.actionableCount).toBe(2);
    expect(result.media.items.map((item) => [item.id, item.actionable])).toEqual([
      ['pending', true],
      ['approved', true],
      ['applied', false],
      ['rejected', false],
    ]);
  });
});
