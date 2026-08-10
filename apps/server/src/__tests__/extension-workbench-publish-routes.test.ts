import { readFileSync } from 'node:fs';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionWorkbenchPublishRoutes } from '../routes/extension-workbench-publish.js';
import {
  createExtensionWorkbenchListingPublishService,
  EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
  type ExtensionWorkbenchListingPublishStatusResult,
} from '../services/extension-workbench-listing-publish.js';
import {
  OzonListingProductionCompileError,
} from '../services/ozon-listing-production-compile-adapter.js';
import {
  ExtensionWorkbenchByokPublishProvenanceError,
} from '../services/extension-workbench-byok-publish-provenance.js';

const SHA = { payload: 'c'.repeat(64) };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    revision: 12,
    draftVersion: 9,
    stage: 'READY_TO_PUBLISH',
    runState: 'ACTIVE',
    selectedSkuKeys: ['sku-1', 'sku-2'],
    publishTaskIds: [],
    media: {
      assignments: [
        {
          scope: 'PRODUCT', slotKey: 'product:gallery:0', assetId: 'source-1', source: 'SOURCE',
        },
        {
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
          assetId: 'hosted-asset-1', source: 'GENERATED',
        },
        {
          scope: 'PRODUCT', slotKey: 'shared:detail:SCENE',
          assetId: 'byok-asset-1', source: 'EDITED',
        },
        {
          scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
          assetId: 'byok-asset-2', source: 'GENERATED',
        },
      ],
    },
    validation: {
      status: 'VALID',
      report: { operationReadiness: { ozonImport: { status: 'READY', issues: [] } } },
    },
    blockers: [],
    warnings: [],
    freshness: {
      category: { state: 'CURRENT', reason: null },
      attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null },
      media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null },
      validation: { state: 'CURRENT', reason: null },
    },
    ...overrides,
  } as any;
}

function selectedMedia() {
  return [
    {
      scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'hosted-asset-1',
    },
    {
      scope: 'PRODUCT', skuKey: null, slotKey: 'shared:detail:SCENE', assetId: 'byok-asset-1',
    },
    {
      scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero', assetId: 'byok-asset-2',
    },
  ];
}

function previewRequest(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
    executionMode: 'ERP_HOSTED',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    basisDraftRevision: 10,
    basisDraftVersion: 7,
    selectedMedia: selectedMedia(),
    ...overrides,
  };
}

async function build(options: {
  currentDraft?: ReturnType<typeof draft>;
  scopes?: string[];
  allowedShopIds?: string[];
  status?: ExtensionWorkbenchListingPublishStatusResult;
  preflightError?: Error;
  provenanceError?: Error;
} = {}) {
  let current = structuredClone(options.currentDraft || draft());
  let storedIntent: any = null;
  const authorizePublish = vi.fn(async () => ({
    byokAssetIds: ['byok-asset-1', 'byok-asset-2'],
    policyRevision: 14,
  }));
  const preflightPublishAuthority = vi.fn(async () => {
    if (options.preflightError) throw options.preflightError;
  });
  const recordPublishIntent = vi.fn(async (input: any) => {
    if (!storedIntent) {
      storedIntent = {
        id: 'publish-intent-1',
        draftId: current.id,
        ownerUserId: current.ownerUserId,
        actorUserId: input.actorUserId,
        shopId: current.shopId,
        draftVersion: current.draftVersion,
        revision: current.revision + 1,
        idempotencyKey: input.idempotencyKey,
        payloadHash: SHA.payload,
        createdAt: '2026-07-28T08:00:00.000Z',
      };
      current = {
        ...current,
        revision: current.revision + 1,
        stage: 'PUBLISH_INTENT_RECORDED',
        publishTaskIds: [storedIntent.id],
      };
      return { draft: structuredClone(current), intent: storedIntent, idempotent: false };
    }
    return { draft: structuredClone(current), intent: storedIntent, idempotent: true };
  });
  const findPublishStatus = vi.fn(async () => (
    options.status || { kind: 'not_committed' } as const
  ));
  const assertReusableByokAssets = vi.fn(async () => {
    if (options.provenanceError) throw options.provenanceError;
    return { provenanceCount: 2, rejectedHistoryCount: 0 };
  });
  const linkPublishedByokAssets = vi.fn(async () => ({ linked: true }));
  const service = createExtensionWorkbenchListingPublishService({
    loadDraft: async () => structuredClone(current),
    authorizePublish,
    assertReusableByokAssets,
    preflightPublishAuthority,
    recordPublishIntent,
    findPublishStatus,
    linkPublishedByokAssets,
  });
  const app = Fastify();
  await app.register(extensionWorkbenchPublishRoutes, {
    authenticateDevice: async (request: FastifyRequest) => {
      (request as any).device = {
        sessionId: 'session-1',
        tokenId: 'token-1',
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        scopes: options.scopes || ['listing:publish'],
        allowedShopIds: options.allowedShopIds || ['shop-1'],
      };
    },
    service,
  });
  return {
    app,
    service,
    authorizePublish,
    assertReusableByokAssets,
    preflightPublishAuthority,
    recordPublishIntent,
    findPublishStatus,
    linkPublishedByokAssets,
  };
}

describe('extension workbench publish routes', () => {
  it('registers one device-scoped unified publish route in the server composition root', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source.match(/app\.register\(extensionWorkbenchPublishRoutes/gu)).toHaveLength(1);
    expect(source).toContain("prefix: '/api/extension-device/workbench-publish'");
    expect(source).toContain("requiredScopes: ['listing:publish']");
    expect(source.indexOf('if (isExtensionDeviceAuthEnabled())')).toBeLessThan(
      source.indexOf('app.register(extensionWorkbenchPublishRoutes'),
    );
  });

  it.each(['ERP_HOSTED', 'BYOK'] as const)(
    'returns the same authoritative ordered draft preview for %s',
    async (executionMode) => {
      const built = await build();
      const response = await built.app.inject({
        method: 'POST',
        url: '/preview',
        payload: previewRequest({ executionMode }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
          executionMode,
          currentDraftRevision: 12,
          currentDraftVersion: 9,
          previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          selectedSkuKeys: ['sku-1', 'sku-2'],
          selectedMedia: selectedMedia(),
          orderedMedia: [
            {
              ordinal: 0, scope: 'PRODUCT', skuKey: null,
              slotKey: 'product:gallery:0', assetId: 'source-1', source: 'SOURCE',
            },
            {
              ordinal: 1, scope: 'SKU', skuKey: 'sku-1',
              slotKey: 'sku:sku-1:hero', assetId: 'hosted-asset-1', source: 'GENERATED',
            },
            {
              ordinal: 2, scope: 'PRODUCT', skuKey: null,
              slotKey: 'shared:detail:SCENE', assetId: 'byok-asset-1', source: 'EDITED',
            },
            {
              ordinal: 3, scope: 'SKU', skuKey: 'sku-2',
              slotKey: 'sku:sku-2:hero', assetId: 'byok-asset-2', source: 'GENERATED',
            },
          ],
        },
      });
      expect(built.authorizePublish).toHaveBeenCalledWith(expect.objectContaining({
        requestingDeviceSessionId: 'session-1',
        assignments: expect.arrayContaining([
          expect.objectContaining({ assetId: 'hosted-asset-1' }),
          expect.objectContaining({ assetId: 'byok-asset-1' }),
          expect.objectContaining({ assetId: 'byok-asset-2' }),
        ]),
      }));
      await built.app.close();
    },
  );

  it.each([
    ['local-only asset', selectedMedia().map((row, index) => (
      index === 0 ? { ...row, assetId: 'br_local_only' } : row
    ))],
    ['reordered slots', [selectedMedia()[1], selectedMedia()[0], selectedMedia()[2]]],
    ['unknown slot', selectedMedia().map((row, index) => (
      index === 1 ? { ...row, slotKey: 'shared:detail:UNKNOWN' } : row
    ))],
    ['unbound asset', selectedMedia().map((row, index) => (
      index === 2 ? { ...row, assetId: 'unbound-asset' } : row
    ))],
  ])('rejects %s before creating a publish intent', async (_label, media) => {
    const built = await build();
    const response = await built.app.inject({
      method: 'POST',
      url: '/preview',
      payload: previewRequest({ selectedMedia: media }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('extension_workbench_listing_publish_media_conflict');
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('rejects stale, invalid, or blocked drafts before authorization', async () => {
    for (const currentDraft of [
      draft({ revision: 9 }),
      draft({ validation: { status: 'INVALID', report: null } }),
      draft({ blockers: [{ code: 'MISSING_FACT' }] }),
      draft({ freshness: { ...draft().freshness, media: { state: 'STALE', reason: 'changed' } } }),
    ]) {
      const built = await build({ currentDraft });
      const response = await built.app.inject({
        method: 'POST', url: '/preview', payload: previewRequest(),
      });
      expect(response.statusCode).toBe(409);
      expect(built.authorizePublish).not.toHaveBeenCalled();
      await built.app.close();
    }
  });

  it('freezes one existing publisher envelope and replays the same intent', async () => {
    const built = await build();
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    const previewHash = preview.json().data.previewHash;
    const payload = {
      ...previewRequest(),
      previewHash,
      idempotencyKey: 'workbench-publish-operation-0001',
    };
    const first = await built.app.inject({ method: 'POST', url: '/prepare', payload });
    built.preflightPublishAuthority.mockRejectedValue(new Error('authority unavailable after intent'));
    const replay = await built.app.inject({ method: 'POST', url: '/prepare', payload });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({
      contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
      previewHash,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      replayed: false,
      envelope: {
        operation: 'OZON_PUBLISH',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        draftVersion: 9,
        idempotencyKey: 'workbench-publish-operation-0001',
        command: {
          schemaVersion: 'ozon-publish-command/v1',
          draftRevision: 13,
          publishIntentId: 'publish-intent-1',
          selectedSkuKeys: ['sku-1', 'sku-2'],
        },
      },
    });
    expect(replay.json().data.replayed).toBe(true);
    expect(built.preflightPublishAuthority).toHaveBeenCalledTimes(1);
    expect(built.recordPublishIntent).toHaveBeenCalledTimes(2);
    await built.app.close();
  });

  it('preflights production authority once after preview confirmation and before intent persistence', async () => {
    const built = await build();
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(built.preflightPublishAuthority).not.toHaveBeenCalled();

    const prepared = await built.app.inject({
      method: 'POST',
      url: '/prepare',
      payload: {
        ...previewRequest(),
        previewHash: preview.json().data.previewHash,
        idempotencyKey: 'workbench-publish-preflight-0001',
      },
    });

    expect(prepared.statusCode).toBe(201);
    expect(built.preflightPublishAuthority).toHaveBeenCalledTimes(1);
    expect(built.preflightPublishAuthority).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      draft: expect.objectContaining({
        id: 'workflow-1',
        revision: 12,
        stage: 'READY_TO_PUBLISH',
      }),
    });
    expect(built.preflightPublishAuthority.mock.invocationCallOrder[0]).toBeLessThan(
      built.recordPublishIntent.mock.invocationCallOrder[0]!,
    );
    await built.app.close();
  });

  it('checks linked BYOK history during preview and prepare before persisting an intent', async () => {
    const built = await build();
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(preview.statusCode).toBe(200);
    expect(built.assertReusableByokAssets).toHaveBeenNthCalledWith(1, {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      assetIds: ['byok-asset-1', 'byok-asset-2'],
    });

    const prepared = await built.app.inject({
      method: 'POST',
      url: '/prepare',
      payload: {
        ...previewRequest(),
        previewHash: preview.json().data.previewHash,
        idempotencyKey: 'workbench-provenance-preflight-0001',
      },
    });
    expect(prepared.statusCode).toBe(201);
    expect(built.assertReusableByokAssets).toHaveBeenCalledTimes(2);
    expect(built.assertReusableByokAssets.mock.invocationCallOrder[1]).toBeLessThan(
      built.recordPublishIntent.mock.invocationCallOrder[0]!,
    );
    await built.app.close();
  });

  it('returns a safe conflict and records no intent for unsafe BYOK publish history', async () => {
    const built = await build({
      provenanceError: new ExtensionWorkbenchByokPublishProvenanceError(),
    });
    const response = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'extension_workbench_listing_publish_provenance_conflict',
      msg: '工作台商品发布请求未通过校验',
    });
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it.each([
    new OzonListingProductionCompileError(
      'OZON_LISTING_PRODUCTION_VALIDATION_STALE',
      'Authoritative validation is stale',
    ),
    new OzonListingProductionCompileError(
      'OZON_LISTING_PRODUCTION_AUTHORITY_UNAVAILABLE',
      'Production authority is unavailable',
    ),
  ])('preserves production preflight failure $code without recording an intent', async (error) => {
    const built = await build({ preflightError: error });
    const actor = {
      sessionId: 'session-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    };
    const preview = await built.service.preview(previewRequest(), actor);

    await expect(built.service.prepare({
      ...previewRequest(),
      previewHash: preview.previewHash,
      idempotencyKey: 'workbench-publish-preflight-failure-0001',
    }, actor)).rejects.toBe(error);
    expect(built.preflightPublishAuthority).toHaveBeenCalledTimes(1);
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('returns a safe typed production preflight code without persisting an intent', async () => {
    const built = await build({
      preflightError: new OzonListingProductionCompileError(
        'OZON_LISTING_PRODUCTION_CATALOG_STALE',
        'sensitive upstream detail',
      ),
    });
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    const response = await built.app.inject({
      method: 'POST',
      url: '/prepare',
      payload: {
        ...previewRequest(),
        previewHash: preview.json().data.previewHash,
        idempotencyKey: 'workbench-publish-preflight-stale-0001',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'ozon_listing_production_catalog_stale',
      msg: '工作台商品发布请求未通过校验',
    });
    expect(response.body).not.toContain('sensitive upstream detail');
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('returns a pending receipt without linking BYOK provenance', async () => {
    const built = await build({
      status: { kind: 'pending', receiptId: 'receipt-1' },
    });
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest({ executionMode: 'BYOK' }),
    });
    const prepared = await built.app.inject({
      method: 'POST',
      url: '/prepare',
      payload: {
        ...previewRequest({ executionMode: 'BYOK' }),
        previewHash: preview.json().data.previewHash,
        idempotencyKey: 'workbench-publish-operation-0002',
      },
    });
    const data = prepared.json().data;
    const status = await built.app.inject({
      method: 'POST',
      url: '/status',
      payload: {
        contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
        previewHash: data.previewHash,
        requestHash: data.requestHash,
        envelope: data.envelope,
      },
    });
    expect(status.statusCode).toBe(202);
    expect(status.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
        state: 'PENDING',
        receiptId: 'receipt-1',
        failureCode: null,
      },
    });
    expect(built.findPublishStatus).toHaveBeenCalledTimes(1);
    expect(built.linkPublishedByokAssets).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('links every selected BYOK asset after a terminal successful receipt', async () => {
    const built = await build({
      status: { kind: 'succeeded', receiptId: 'receipt-1' },
    });
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest({ executionMode: 'BYOK' }),
    });
    const prepared = await built.app.inject({
      method: 'POST',
      url: '/prepare',
      payload: {
        ...previewRequest({ executionMode: 'BYOK' }),
        previewHash: preview.json().data.previewHash,
        idempotencyKey: 'workbench-publish-operation-0003',
      },
    });
    const data = prepared.json().data;
    const status = await built.app.inject({
      method: 'POST',
      url: '/status',
      payload: {
        contractVersion: EXTENSION_WORKBENCH_LISTING_PUBLISH_VERSION,
        previewHash: data.previewHash,
        requestHash: data.requestHash,
        envelope: data.envelope,
      },
    });

    expect(status.statusCode).toBe(200);
    expect(status.json().data.state).toBe('SUCCEEDED');
    expect(built.linkPublishedByokAssets).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      assetIds: ['source-1', 'hosted-asset-1', 'byok-asset-1', 'byok-asset-2'],
      publishIntentId: 'publish-intent-1',
      publishReceiptId: 'receipt-1',
      requestHash: data.requestHash,
    });
    await built.app.close();
  });

  it('enforces listing scope and shop grants before service work', async () => {
    for (const options of [
      { scopes: ['byok:media:ingest'] },
      { allowedShopIds: ['shop-other'] },
    ]) {
      const built = await build(options);
      const response = await built.app.inject({
        method: 'POST', url: '/preview', payload: previewRequest(),
      });
      expect(response.statusCode).toBe(403);
      expect(built.authorizePublish).not.toHaveBeenCalled();
      await built.app.close();
    }
  });
});
