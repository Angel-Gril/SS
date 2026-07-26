import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionByokPublishRoutes } from '../routes/extension-byok-publish.js';
import {
  createExtensionByokListingPublishService,
  EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
  type ExtensionByokListingPublishStatusResult,
} from '../services/extension-byok-listing-publish.js';
import { ExtensionByokPublishAuthorizationError } from '../services/extension-byok-publish-authorization.js';

const SHA = {
  normalized: 'a'.repeat(64),
  assignment: 'b'.repeat(64),
  payload: 'c'.repeat(64),
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    revision: 8,
    draftVersion: 6,
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
          assetId: 'byok-asset-1', source: 'GENERATED',
        },
        {
          scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
          assetId: 'source-2', source: 'REVIEWED',
        },
      ],
    },
    validation: { status: 'VALID', report: { operationReadiness: { ozonImport: { status: 'READY', issues: [] } } } },
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

function provenance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provenance-1',
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 7,
    draftVersion: 5,
    boundDraftRevision: 8,
    boundDraftVersion: 6,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 1,
    assignmentSha256: SHA.assignment,
    operation: 'TEXT_TO_IMAGE',
    assetId: 'byok-asset-1',
    normalizedSha256: SHA.normalized,
    publishIntentId: null,
    publishReceiptId: null,
    erpAiChargeCents: 0,
    ...overrides,
  } as any;
}

function previewRequest(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    sourceDraftRevision: 7,
    sourceDraftVersion: 5,
    boundDraftRevision: 8,
    boundDraftVersion: 6,
    assetId: 'byok-asset-1',
    provenanceId: 'provenance-1',
    normalizedSha256: SHA.normalized,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentOrdinal: 1,
    assignmentSha256: SHA.assignment,
    ...overrides,
  };
}

async function build(options: {
  scopes?: string[];
  allowedShopIds?: string[];
  currentDraft?: ReturnType<typeof draft>;
  accepted?: ReturnType<typeof provenance> | null;
  authorizeError?: Error;
  status?: ExtensionByokListingPublishStatusResult;
} = {}) {
  let current = structuredClone(options.currentDraft || draft());
  let storedIntent: any = null;
  const accepted = options.accepted === undefined ? provenance() : options.accepted;
  const authorizePublish = vi.fn(async () => {
    if (options.authorizeError) throw options.authorizeError;
    return { byokAssetIds: ['byok-asset-1'], policyRevision: 11 };
  });
  const recordPublishIntent = vi.fn(async (input: any) => {
    if (!storedIntent) {
      storedIntent = {
        id: 'publish-intent-1', draftId: current.id, ownerUserId: current.ownerUserId,
        shopId: current.shopId, draftVersion: current.draftVersion,
        revision: current.revision + 1, idempotencyKey: input.idempotencyKey,
        payloadHash: SHA.payload, actorUserId: input.actorUserId,
        createdAt: '2026-07-26T08:00:00.000Z',
      };
      current = {
        ...current,
        revision: current.revision + 1,
        stage: 'PUBLISH_INTENT_RECORDED',
        publishTaskIds: [storedIntent.id],
      };
      return { draft: structuredClone(current), intent: storedIntent, idempotent: false };
    }
    if (storedIntent.idempotencyKey !== input.idempotencyKey) throw new Error('unexpected key');
    return { draft: structuredClone(current), intent: storedIntent, idempotent: true };
  });
  const findPublishStatus = vi.fn(async () => options.status || ({ kind: 'not_committed' } as const));
  const linkPublish = vi.fn(async () => ({ idempotent: false }));
  const service = createExtensionByokListingPublishService({
    loadDraft: async () => structuredClone(current),
    loadAcceptedProvenance: async () => accepted && structuredClone(accepted),
    authorizePublish,
    recordPublishIntent,
    findPublishStatus,
    linkPublish,
  });
  const app = Fastify();
  await app.register(extensionByokPublishRoutes, {
    authenticateDevice: async (request: FastifyRequest) => {
      (request as any).device = {
        sessionId: 'session-1', tokenId: 'token-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
        scopes: options.scopes || ['listing:publish'],
        allowedShopIds: options.allowedShopIds || ['shop-1'],
      };
    },
    service,
  });
  return {
    app, service, authorizePublish, recordPublishIntent, findPublishStatus, linkPublish,
    getCurrent: () => current,
    setCurrent: (value: ReturnType<typeof draft>) => { current = structuredClone(value); },
  };
}

describe('extension BYOK publish routes', () => {
  it('marks authentication failures as non-cacheable before any route handler runs', async () => {
    const app = Fastify();
    await app.register(extensionByokPublishRoutes, {
      authenticateDevice: async (_request, reply) => reply.status(401).send({
        code: 0, errorCode: 'invalid_device_token', msg: 'invalid',
      }),
      service: {} as never,
    });
    const response = await app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('returns an exact ordered preview and prepares one closed existing-publisher envelope', async () => {
    const built = await build();
    const preview = await built.app.inject({ method: 'POST', url: '/preview', payload: previewRequest() });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.json()).toMatchObject({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        previewHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        selectedSkuKeys: ['sku-1', 'sku-2'],
        orderedMedia: [
          { ordinal: 0, scope: 'PRODUCT', skuKey: null, slotKey: 'product:gallery:0', assetId: 'source-1', source: 'SOURCE' },
          { ordinal: 1, scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'byok-asset-1', source: 'GENERATED' },
          { ordinal: 2, scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero', assetId: 'source-2', source: 'REVIEWED' },
        ],
      },
    });
    const previewData = preview.json().data;
    const prepareBody = {
      ...previewRequest(), previewHash: previewData.previewHash,
      idempotencyKey: 'publish-operation-0001',
    };
    const first = await built.app.inject({ method: 'POST', url: '/prepare', payload: prepareBody });
    const replay = await built.app.inject({ method: 'POST', url: '/prepare', payload: prepareBody });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        previewHash: previewData.previewHash,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        replayed: false,
        envelope: {
          operation: 'OZON_PUBLISH',
          shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 6,
          idempotencyKey: 'publish-operation-0001',
          command: {
            schemaVersion: 'ozon-publish-command/v1', draftRevision: 9,
            publishIntentId: 'publish-intent-1', selectedSkuKeys: ['sku-1', 'sku-2'],
          },
        },
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual({ ...first.json().data, replayed: true });
    expect(built.recordPublishIntent).toHaveBeenCalledTimes(2);
    expect(built.authorizePublish).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', shopId: 'shop-1', workflowId: 'workflow-1',
      requestingDeviceSessionId: 'session-1',
    }));
    expect(JSON.stringify(first.json())).not.toMatch(/credential|authorization|result|url|secret/iu);
    await built.app.close();
  });

  it('publishes the revalidated successor while keeping provenance bound to the ingest revision', async () => {
    const built = await build({ currentDraft: draft({ revision: 9 }) });
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(preview.statusCode).toBe(200);

    const prepared = await built.app.inject({
      method: 'POST', url: '/prepare',
      payload: {
        ...previewRequest(), previewHash: preview.json().data.previewHash,
        idempotencyKey: 'publish-revalidated-0001',
      },
    });

    expect(prepared.statusCode).toBe(201);
    expect(built.recordPublishIntent).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 9,
      idempotencyKey: 'publish-revalidated-0001',
    }));
    expect(prepared.json()).toMatchObject({
      data: { envelope: { command: { draftRevision: 10 } } },
    });
    await built.app.close();
  });

  it('invalidates confirmation when the revalidated draft revision changes after preview', async () => {
    const built = await build({ currentDraft: draft({ revision: 9 }) });
    const preview = await built.app.inject({
      method: 'POST', url: '/preview', payload: previewRequest(),
    });
    expect(preview.statusCode).toBe(200);

    built.setCurrent(draft({ revision: 10 }));
    const prepared = await built.app.inject({
      method: 'POST', url: '/prepare',
      payload: {
        ...previewRequest(), previewHash: preview.json().data.previewHash,
        idempotencyKey: 'publish-revalidated-0001',
      },
    });

    expect(prepared.statusCode).toBe(409);
    expect(prepared.json()).toMatchObject({
      errorCode: 'extension_byok_listing_publish_preview_conflict',
    });
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('fails closed for scope/shop, stale accepted identity, stage, policy, and preview hash mismatch', async () => {
    const cases = [
      { build: { scopes: ['listing:review'] }, override: {}, expected: 403 },
      { build: { allowedShopIds: ['shop-2'] }, override: {}, expected: 403 },
      { build: { currentDraft: draft({ draftVersion: 7 }) }, override: {}, expected: 409 },
      { build: { currentDraft: draft({ stage: 'VALIDATION' }) }, override: {}, expected: 409 },
      { build: { accepted: provenance({ assignmentOrdinal: 0 }) }, override: {}, expected: 409 },
      {
        build: {
          authorizeError: new ExtensionByokPublishAuthorizationError(
            'EXTENSION_BYOK_PUBLISH_DISABLED', 'disabled', 409, 'PUBLISH_DISABLED',
          ),
        },
        override: {}, expected: 409,
      },
    ] as const;
    for (const item of cases) {
      const built = await build(item.build as any);
      const response = await built.app.inject({
        method: 'POST', url: '/preview', payload: previewRequest(item.override),
      });
      expect(response.statusCode).toBe(item.expected);
      expect(response.headers['cache-control']).toBe('no-store');
      await built.app.close();
    }

    const built = await build();
    const response = await built.app.inject({
      method: 'POST', url: '/prepare',
      payload: {
        ...previewRequest(), previewHash: 'f'.repeat(64), idempotencyKey: 'publish-operation-0001',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(built.recordPublishIntent).not.toHaveBeenCalled();
    await built.app.close();
  });

  it('returns only safe authoritative status projections and links provenance once a receipt exists', async () => {
    for (const status of [
      { kind: 'not_committed' } as const,
      { kind: 'pending', receiptId: 'receipt-1' } as const,
      { kind: 'succeeded', receiptId: 'receipt-1' } as const,
      { kind: 'failed', receiptId: 'receipt-1', failureCode: 'OZON_REJECTED' } as const,
    ]) {
      const built = await build({ status });
      const preview = await built.app.inject({ method: 'POST', url: '/preview', payload: previewRequest() });
      const prepared = await built.app.inject({
        method: 'POST', url: '/prepare',
        payload: {
          ...previewRequest(), previewHash: preview.json().data.previewHash,
          idempotencyKey: 'publish-operation-0001',
        },
      });
      const prepareData = prepared.json().data;
      const response = await built.app.inject({
        method: 'POST', url: '/status',
        payload: {
          contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
          previewHash: prepareData.previewHash,
          requestHash: prepareData.requestHash,
          provenanceId: 'provenance-1',
          envelope: prepareData.envelope,
        },
      });
      expect(response.statusCode).toBe(status.kind === 'pending' ? 202 : 200);
      expect(response.json()).toEqual({
        code: 1,
        data: {
          contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
          state: status.kind.toUpperCase(),
          receiptId: 'receiptId' in status ? status.receiptId : null,
          failureCode: 'failureCode' in status ? status.failureCode : null,
        },
      });
      expect(JSON.stringify(response.json())).not.toMatch(/result|taskId|url|credential|secret/iu);
      expect(built.linkPublish).toHaveBeenCalledTimes(status.kind === 'not_committed' ? 0 : 1);
      if (status.kind !== 'not_committed') {
        expect(built.linkPublish).toHaveBeenCalledWith({
          provenanceId: 'provenance-1', ownerUserId: 'owner-1',
          publishIntentId: 'publish-intent-1', publishReceiptId: 'receipt-1',
        });
      }
      await built.app.close();
    }
  });

  it('recovers the authoritative receipt after the listing draft has advanced past its publish intent', async () => {
    const built = await build({ status: { kind: 'succeeded', receiptId: 'receipt-1' } });
    const preview = await built.app.inject({ method: 'POST', url: '/preview', payload: previewRequest() });
    const prepared = await built.app.inject({
      method: 'POST', url: '/prepare',
      payload: {
        ...previewRequest(), previewHash: preview.json().data.previewHash,
        idempotencyKey: 'publish-operation-0001',
      },
    });
    const authorizationCalls = built.authorizePublish.mock.calls.length;
    built.setCurrent(draft({
      revision: 10,
      stage: 'PUBLISHED',
      runState: 'COMPLETED',
      publishTaskIds: ['publish-intent-1'],
    }));

    const response = await built.app.inject({
      method: 'POST', url: '/status',
      payload: {
        contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
        previewHash: prepared.json().data.previewHash,
        requestHash: prepared.json().data.requestHash,
        provenanceId: 'provenance-1',
        envelope: prepared.json().data.envelope,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      contractVersion: EXTENSION_BYOK_LISTING_PUBLISH_VERSION,
      state: 'SUCCEEDED', receiptId: 'receipt-1', failureCode: null,
    });
    expect(built.authorizePublish).toHaveBeenCalledTimes(authorizationCalls);
    expect(built.linkPublish).toHaveBeenCalledWith({
      provenanceId: 'provenance-1', ownerUserId: 'owner-1',
      publishIntentId: 'publish-intent-1', publishReceiptId: 'receipt-1',
    });
    await built.app.close();
  });
});
