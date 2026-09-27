import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionSourceWorkbenchRoutes } from '../routes/extension-source-workbench.js';
import {
  createExtensionSourceWorkbenchService,
  decodeExtensionSourceMediaHistoryCursor,
  encodeExtensionSourceMediaHistoryCursor,
  ExtensionSourceWorkbenchError,
} from '../services/extension-source-workbench.js';

const NOW = new Date('2026-07-22T02:00:00.000Z');

function capability(enabled = true) {
  return {
    enabled,
    legacyAllowed: !enabled,
    captureStage: null,
    reason: enabled ? 'pilot_match' as const : 'master_off' as const,
    revision: enabled ? 'pilot-history-1' : 'master-off',
  };
}

function historyResult() {
  return {
    contractVersion: 'extension-source-media-history/v1' as const,
    context: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
    },
    snapshot: { id: 'snapshot-1', version: 4, capturedAt: NOW.toISOString() },
    items: [],
    nextCursor: null,
  };
}

async function routeApp(input: {
  enabled?: boolean;
  allowedShopIds?: string[];
  loadMediaHistory?: () => Promise<ReturnType<typeof historyResult>>;
}) {
  const loadStatus = vi.fn();
  const createDraft = vi.fn();
  const loadMediaHistory = vi.fn(input.loadMediaHistory || (async () => historyResult()));
  const evaluate = vi.fn(async () => capability(input.enabled !== false));
  const app = Fastify();
  await app.register(extensionSourceWorkbenchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: async (request: FastifyRequest) => {
      (request as any).device = {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', sessionId: 'session-1',
        scopes: ['listing:review'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1'],
      };
    },
    featureFlags: { evaluate },
    service: { loadStatus, loadMediaHistory, createDraft },
  });
  await app.ready();
  return { app, evaluate, loadMediaHistory };
}

const HISTORY_URL = '/api/extension-device/source-workbench/media-history'
  + '?snapshotId=snapshot-1&supplyGoodsId=goods-1&shopId=shop-1'
  + '&listingWorkflowId=listing-1&revision=11&draftVersion=7&limit=10';

describe('extension source media history route', () => {
  it('loads a no-store owner/device/shop scoped history only after rollout', async () => {
    const { app, evaluate, loadMediaHistory } = await routeApp({});
    try {
      const response = await app.inject({ method: 'GET', url: HISTORY_URL });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          capability: { enabled: true, reason: 'pilot_match', revision: 'pilot-history-1' },
          history: historyResult(),
        },
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      });
      expect(loadMediaHistory).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', allowedShopIds: ['shop-1'],
        snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
        listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7, limit: 10,
      });
    } finally {
      await app.close();
    }
  });

  it('does not read tenant history while dark and rejects an ungranted shop', async () => {
    const dark = await routeApp({ enabled: false });
    try {
      const response = await dark.app.inject({ method: 'GET', url: HISTORY_URL });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { capability: { enabled: false }, history: null } });
      expect(dark.loadMediaHistory).not.toHaveBeenCalled();
    } finally {
      await dark.app.close();
    }

    const denied = await routeApp({ allowedShopIds: ['shop-2'] });
    try {
      const response = await denied.app.inject({ method: 'GET', url: HISTORY_URL });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ errorCode: 'command_shop_denied' });
      expect(denied.loadMediaHistory).not.toHaveBeenCalled();
    } finally {
      await denied.app.close();
    }
  });

  it('returns a distinct conflict for stale current authority and rejects loose queries', async () => {
    const stale = await routeApp({
      loadMediaHistory: async () => {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_STALE', 409, 'Listing draft is no longer current',
        );
      },
    });
    try {
      const response = await stale.app.inject({ method: 'GET', url: HISTORY_URL });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'source_workbench_stale' });
      const loose = await stale.app.inject({ method: 'GET', url: `${HISTORY_URL}&ownerUserId=owner-2` });
      expect(loose.statusCode).toBe(400);
    } finally {
      await stale.app.close();
    }
  });
});

function scope(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
    ...overrides,
  } as any;
}

function workflow(id: string, updatedAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    id,
    operation: 'IMAGE_TRANSLATE',
    status: 'SUCCEEDED',
    reviewStatus: 'APPROVED',
    revision: 4,
    contextSkuKey: null,
    contextSlotKey: 'product:gallery:1',
    selectedOutputAssetId: 'asset-valid',
    selectedOutputAsset: {
      id: 'asset-valid', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
      sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
      url: 'https://cdn.example/translated.png', mimeType: 'image/png',
      width: 900, height: 1200,
    },
    createdAt: new Date(updatedAt.getTime() - 60_000),
    updatedAt,
    jobs: [{
      id: 'job-1',
      assets: [
        {
          id: 'asset-valid', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://cdn.example/translated.png', mimeType: 'image/png',
          width: 900, height: 1200, storageKey: 'must-not-leak',
        },
        {
          id: 'asset-foreign', ownerUserId: 'owner-2', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://cdn.example/foreign.png', mimeType: 'image/png', width: 1, height: 1,
        },
        {
          id: 'asset-provider', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          kind: 'AI_PROVIDER_OUTPUT', storageBackend: 'oss',
          url: 'https://provider.example/private.png?token=secret', mimeType: 'image/png',
        },
        {
          id: 'asset-http', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          kind: 'AI_GENERATED', storageBackend: 'local',
          url: 'http://remote.example/insecure.png', mimeType: 'image/png',
        },
        {
          id: 'asset-private', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://127.0.0.1/private.png', mimeType: 'image/png',
        },
        {
          id: 'asset-credentials', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://user:pass@cdn.example/private.png', mimeType: 'image/png',
        },
        {
          id: 'asset-signed', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://cdn.example/private.png?token=secret', mimeType: 'image/png',
        },
        {
          id: 'asset-other-origin', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
          url: 'https://other.example/output.png', mimeType: 'image/png',
        },
      ],
    }],
    listingDraftApplicationMutations: [{
      id: 'application-1', mode: 'APPEND', targetId: 'listing-1',
      contextSkuKey: null, contextSlotKey: 'product:gallery:1', createdAt: NOW,
      rolledBackBy: null,
    }],
    resolvedPrompt: 'must-not-leak',
    providerJobId: 'must-not-leak',
    ...overrides,
  };
}

describe('extension source media history service', () => {
  it('returns bounded durable outputs and application state without sensitive provider data', async () => {
    const rows = [
      workflow('workflow-2', new Date('2026-07-22T02:00:00.000Z')),
      workflow('workflow-1', new Date('2026-07-22T01:00:00.000Z')),
    ];
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 4, capturedAt: NOW,
        subject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      sourceListingWorkflow: { findMany: vi.fn(async () => [{ id: 'listing-1', shopId: 'shop-1' }]) },
      aiMediaWorkflow: { findMany: vi.fn(async () => rows) },
    };
    const service = createExtensionSourceWorkbenchService({
      client: client as never,
      loadAllowedPreviewOrigins: async () => ['https://cdn.example/media'],
    });
    const result = await service.loadMediaHistory({
      ...scope(), allowedShopIds: ['shop-1'], limit: 1,
    });

    expect(result.contractVersion).toBe('extension-source-media-history/v1');
    expect(result.items).toEqual([expect.objectContaining({
      id: 'workflow-2', selectedOutputAssetId: 'asset-valid',
      outputs: [{
        id: 'asset-valid', url: 'https://cdn.example/translated.png',
        mimeType: 'image/png', width: 900, height: 1200,
      }],
      application: expect.objectContaining({ state: 'APPLIED', mode: 'append' }),
    })]);
    expect(result.nextCursor).toEqual(expect.any(String));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('provider.example');
    expect(serialized).not.toContain('remote.example');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('other.example');
    expect(client.aiMediaWorkflow.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'owner-1', suiteSlot: { is: null }, contextType: 'listing-draft',
        contextId: 'listing-1', contextDraftRevision: 11, contextDraftVersion: 7,
      }),
      take: 2,
    }));
  });

  it('keeps the selected output inside the bounded four-image projection', async () => {
    const assets = Array.from({ length: 4 }, (_, index) => ({
      id: `asset-${index + 1}`, ownerUserId: 'owner-1', aiImageJobId: 'job-1',
      sourceCaptureSnapshotId: 'snapshot-1', kind: 'AI_GENERATED', storageBackend: 'oss',
      url: `https://cdn.example/output-${index + 1}.png`, mimeType: 'image/png',
      width: 100, height: 100,
    }));
    const selected = {
      ...assets[0], id: 'asset-selected', url: 'https://cdn.example/selected.png',
    };
    const row = workflow('workflow-selected', NOW, {
      selectedOutputAssetId: selected.id,
      selectedOutputAsset: selected,
      jobs: [{ id: 'job-1', assets }],
      listingDraftApplicationMutations: [],
    });
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 4, capturedAt: NOW,
        subject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      sourceListingWorkflow: { findMany: vi.fn(async () => [{ id: 'listing-1', shopId: 'shop-1' }]) },
      aiMediaWorkflow: { findMany: vi.fn(async () => [row]) },
    };
    const service = createExtensionSourceWorkbenchService({
      client: client as never,
      loadAllowedPreviewOrigins: async () => ['https://cdn.example'],
    });
    const result = await service.loadMediaHistory({
      ...scope(), allowedShopIds: ['shop-1'], limit: 10,
    });

    expect(result.items[0]?.outputs).toHaveLength(4);
    expect(result.items[0]?.outputs.map((output) => output.id)).toContain('asset-selected');
    expect(result.items[0]?.selectedOutputAssetId).toBe('asset-selected');
  });

  it.each([
    ['empty', []],
    ['invalid', [
      'https://cdn.example/path?signature=secret',
      'https://localhost./media',
      'https://user:pass@cdn.example/media',
    ]],
  ])('fails closed for an %s preview origin allowlist', async (_label, origins) => {
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 4, capturedAt: NOW,
        subject: { snapshots: [{ id: 'snapshot-1' }] },
      })) },
      sourceListingWorkflow: {
        findMany: vi.fn(async () => [{ id: 'listing-1', shopId: 'shop-1' }]),
      },
      aiMediaWorkflow: {
        findMany: vi.fn(async () => [workflow('workflow-no-origin', NOW)]),
      },
    };
    const service = createExtensionSourceWorkbenchService({
      client: client as never,
      loadAllowedPreviewOrigins: async () => origins,
    });
    const result = await service.loadMediaHistory({
      ...scope(), allowedShopIds: ['shop-1'], limit: 10,
    });

    expect(result.items[0]?.outputs).toEqual([]);
    expect(result.items[0]?.selectedOutputAssetId).toBeNull();
  });

  it('binds canonical keyset cursors to the exact owner/snapshot/draft authority', async () => {
    const cursor = encodeExtensionSourceMediaHistoryCursor(scope(), {
      updatedAt: NOW,
      id: 'workflow-1',
    });
    expect(decodeExtensionSourceMediaHistoryCursor(scope(), cursor)).toEqual({
      updatedAt: NOW,
      id: 'workflow-1',
    });
    expect(() => decodeExtensionSourceMediaHistoryCursor(
      scope({ ownerUserId: 'owner-2' }), cursor,
    )).toThrow(/cursor is invalid/u);
    expect(() => decodeExtensionSourceMediaHistoryCursor(
      scope({ draftVersion: 8 }), cursor,
    )).toThrow(/cursor is invalid/u);
  });

  it('stops before listing/media reads for stale snapshots or ungranted shops', async () => {
    const client = {
      sourceCaptureSnapshot: { findFirst: vi.fn(async () => ({
        id: 'snapshot-1', version: 4, capturedAt: NOW,
        subject: { snapshots: [{ id: 'snapshot-new' }] },
      })) },
      sourceListingWorkflow: { findMany: vi.fn() },
      aiMediaWorkflow: { findMany: vi.fn() },
    };
    const service = createExtensionSourceWorkbenchService({
      client: client as never,
      loadAllowedPreviewOrigins: async () => ['https://cdn.example'],
    });
    await expect(service.loadMediaHistory({
      ...scope(), allowedShopIds: ['shop-1'],
    })).rejects.toMatchObject({ code: 'SOURCE_WORKBENCH_STALE', statusCode: 409 });
    expect(client.sourceListingWorkflow.findMany).not.toHaveBeenCalled();
    expect(client.aiMediaWorkflow.findMany).not.toHaveBeenCalled();

    await expect(service.loadMediaHistory({
      ...scope(), allowedShopIds: ['shop-2'],
    })).rejects.toMatchObject({ code: 'SOURCE_WORKBENCH_NOT_FOUND', statusCode: 404 });
  });
});
