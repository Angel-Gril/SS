import { readFileSync } from 'node:fs';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionByokReadinessRoutes } from '../routes/extension-byok-readiness.js';
import {
  EXTENSION_BYOK_READINESS_ATTESTATION_VERSION,
  EXTENSION_BYOK_READINESS_BINDING_VERSION,
  EXTENSION_BYOK_READINESS_REQUEST_VERSION,
  EXTENSION_BYOK_READINESS_TTL_MS,
} from '../services/extension-byok-readiness-attestation.js';
import {
  EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
  EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_CONTEXT_VERSION,
  EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_DECISION_VERSION,
} from '../services/extension-byok-workbench-launch.js';

const NOW = new Date('2026-07-25T15:00:00.000Z');

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_READINESS_REQUEST_VERSION,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 1,
    providerOrigin: 'https://relay.example',
    model: 'image-model-v1',
    operation: 'TEXT_TO_IMAGE',
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'extension-byok-readiness/v1',
    policyRevision: 734,
    mode: 'pilot',
    context: {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      deviceSessionId: 'session-1',
      providerOrigin: 'https://relay.example',
      operation: 'TEXT_TO_IMAGE',
    },
    maxConcurrency: 1,
    capabilities: {
      generation: { enabled: true, ready: true, reasonCode: 'READY' },
      ingest: { enabled: true, ready: true, reasonCode: 'READY' },
      publish: { enabled: false, ready: false, reasonCode: 'PUBLISH_DISABLED' },
    },
    ...overrides,
  } as any;
}

async function build(options: {
  scopes?: string[];
  draftRevision?: number;
  sourceCaptureCurrent?: boolean;
  assignmentCount?: number;
  assignments?: unknown[];
  selectedSkuKeys?: string[];
  readiness?: ReturnType<typeof decision>;
  boundSlotAuthorized?: boolean;
  boundSlotAssetId?: string;
  boundSlotAuthorizationThrows?: boolean;
} = {}) {
  const getReadiness = vi.fn(async () => options.readiness || decision());
  const authorizeBoundSlotLaunch = vi.fn(async (input: { assetId: string }) => {
    if (options.boundSlotAuthorizationThrows) throw new Error('authorization unavailable');
    return options.boundSlotAuthorized === true
      ? { authorized: true as const, assetId: options.boundSlotAssetId || input.assetId }
      : { authorized: false as const, assetId: null };
  });
  const app = Fastify();
  const attachDevice = async (fastifyRequest: FastifyRequest) => {
    (fastifyRequest as any).device = {
      sessionId: 'session-1',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      scopes: options.scopes || ['byok:media:ingest', 'listing:review'],
      allowedShopIds: ['shop-1'],
    };
  };
  const authenticateDevice = vi.fn(attachDevice);
  const authenticateLaunchDevice = vi.fn(attachDevice);
  await app.register(extensionByokReadinessRoutes, {
    authenticateDevice,
    authenticateLaunchDevice,
    loadShop: async () => ({
      id: 'shop-1', userId: 'owner-1', platform: 'OZON', status: 'ACTIVE',
    }),
    loadDraft: async () => ({
      id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      revision: options.draftRevision ?? 3, draftVersion: 4,
      supplyGoodsId: 'goods-1', sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureCurrent: options.sourceCaptureCurrent ?? true,
      sourcePlatform: '1688', sourceProductId: 'product-1',
      selectedSkuKeys: options.selectedSkuKeys || ['sku-1', 'sku-2'],
      media: {
        assignments: options.assignments || (options.assignmentCount === undefined
          ? [{
            scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:source',
            assetId: 'asset-1', source: 'SOURCE',
          }]
          : Array.from({ length: options.assignmentCount }, (_, index) => ({
            scope: 'SKU' as const,
            skuKey: `occupied-${index}`,
            slotKey: `sku:occupied-${index}:source`,
            assetId: `asset-${index}`,
            source: 'SOURCE' as const,
          }))),
      },
      stage: 'MEDIA', runState: 'DRAFT',
    }),
    authorizeBoundSlotLaunch,
    getReadiness,
    now: () => NOW,
  });
  return {
    app,
    getReadiness,
    authorizeBoundSlotLaunch,
    authenticateDevice,
    authenticateLaunchDevice,
  };
}

describe('extension BYOK readiness attestation route', () => {
  it('issues a short no-store attestation bound to authenticated device policy and current draft', async () => {
    const { app, getReadiness } = await build();
    const response = await app.inject({ method: 'POST', url: '/readiness', payload: request() });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_READINESS_ATTESTATION_VERSION,
        authenticated: true,
        expiresAt: new Date(NOW.getTime() + EXTENSION_BYOK_READINESS_TTL_MS).toISOString(),
        binding: {
          contractVersion: EXTENSION_BYOK_READINESS_BINDING_VERSION,
          ownerUserId: 'owner-1',
          deviceSessionId: 'session-1',
          shopId: 'shop-1',
          workflowId: 'workflow-1',
          draftRevision: 3,
          draftVersion: 4,
          sourcePlatform: '1688',
          sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1',
          supplyGoodsId: 'goods-1',
          skuKey: 'sku-1',
          slotKey: 'sku:sku-1:hero',
          assignmentMode: 'APPEND',
          assignmentOrdinal: 1,
          providerOrigin: 'https://relay.example',
          model: 'image-model-v1',
          operation: 'TEXT_TO_IMAGE',
          policyRevision: '734',
        },
        decision: {
          allowed: true,
          providerOrigin: 'https://relay.example',
          policyRevision: 734,
          maxConcurrency: 1,
        },
      },
    });
    expect(getReadiness).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      deviceSessionId: 'session-1',
      providerOrigin: 'https://relay.example',
      operation: 'TEXT_TO_IMAGE',
    });
    await app.close();
  });

  it('rejects a secret-shaped model before policy evaluation or attestation', async () => {
    const { app, getReadiness } = await build();
    const response = await app.inject({
      method: 'POST', url: '/readiness', payload: request({ model: 'sk-secret-model-value' }),
    });
    expect(response.statusCode).toBe(400);
    expect(getReadiness).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails before attestation for missing scope, stale draft, or disabled generation', async () => {
    const cases = [
      { options: { scopes: ['listing:review'] }, expected: 403 },
      { options: { draftRevision: 9 }, expected: 409 },
      {
        options: {
          readiness: decision({
            capabilities: {
              ...decision().capabilities,
              generation: { enabled: false, ready: false, reasonCode: 'GENERATION_DISABLED' },
            },
          }),
        },
        expected: 409,
      },
      { options: { readiness: decision({ maxConcurrency: 0 }) }, expected: 409 },
    ];
    for (const item of cases) {
      const { app } = await build(item.options);
      const response = await app.inject({ method: 'POST', url: '/readiness', payload: request() });
      expect(response.statusCode).toBe(item.expected);
      expect(response.headers['cache-control']).toBe('no-store');
      await app.close();
    }
  });

  it('allows provider settings readiness without accepting a partial draft identity', async () => {
    const { app } = await build();
    const settings = await app.inject({
      method: 'POST',
      url: '/readiness',
      payload: request({
        workflowId: null,
        draftRevision: null,
        draftVersion: null,
        sourcePlatform: null,
        sourceProductId: null,
        sourceCaptureSnapshotId: null,
        supplyGoodsId: null,
        skuKey: null,
        slotKey: null,
        assignmentMode: null,
        assignmentOrdinal: null,
      }),
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().data.binding).toMatchObject({
      workflowId: null, draftRevision: null, draftVersion: null,
      sourcePlatform: null, sourceProductId: null, sourceCaptureSnapshotId: null,
      supplyGoodsId: null, skuKey: null, slotKey: null,
      assignmentMode: null, assignmentOrdinal: null,
    });
    const partial = await app.inject({
      method: 'POST',
      url: '/readiness',
      payload: request({ workflowId: null }),
    });
    expect(partial.statusCode).toBe(400);
    await app.close();
  });

  it('keeps v1 compatible for one exact empty SKU hero target', async () => {
    const { app } = await build({ selectedSkuKeys: ['sku-1'] });
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688',
        sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1',
        supplyGoodsId: 'goods-1',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        draftRevision: 3,
        draftVersion: 4,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
        sourcePlatform: '1688',
        sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1',
        supplyGoodsId: 'goods-1',
        shopId: 'shop-1',
        workflowId: 'workflow-1',
        draftRevision: 3,
        draftVersion: 4,
        skuKey: 'sku-1',
        slotKey: 'sku:sku-1:hero',
        assignmentMode: 'APPEND',
        assignmentOrdinal: 1,
      },
    });
    await app.close();
  });

  it('intentionally keeps legacy v1 multi-SKU launch fail-closed', async () => {
    const { app } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('byok_workbench_launch_slot_unavailable');
    await app.close();
  });

  it('does not reinterpret an occupied generated hero for legacy v1 or v2 clients', async () => {
    const { app, authorizeBoundSlotLaunch } = await build({
      selectedSkuKeys: ['sku-1'],
      boundSlotAuthorized: true,
      assignments: [{
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'asset-generated-1', source: 'GENERATED',
      }],
    });
    for (const contractVersion of [
      EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
      EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/workbench-launch',
        payload: {
          contractVersion,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
          ...(contractVersion === EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2
            ? { preferredSkuKey: 'sku-1', selectionKind: 'HINT' }
            : {}),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().errorCode).toBe('byok_workbench_launch_slot_unavailable');
    }
    expect(authorizeBoundSlotLaunch).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps v1 multi-SKU launch fail-closed when only one hero remains empty', async () => {
    const { app } = await build({
      assignments: [{
        scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
        assetId: 'asset-hero-2', source: 'SOURCE',
      }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('byok_workbench_launch_slot_unavailable');
    await app.close();
  });

  it('returns a v2 explicit-choice decision for multiple empty SKU heroes', async () => {
    const { app } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: null,
        selectionKind: 'HINT',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
        state: 'CHOICE_REQUIRED',
        binding: {
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        },
        skuKeys: ['sku-1', 'sku-2'],
      },
    });
    await app.close();
  });

  it('returns a v2 ready decision for a unique empty hero or an exact preferred SKU', async () => {
    const unique = await build({
      assignments: [{
        scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
        assetId: 'asset-hero-2', source: 'SOURCE',
      }],
    });
    const uniqueResponse = await unique.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: null,
        selectionKind: 'HINT',
      },
    });
    expect(uniqueResponse.statusCode).toBe(200);
    expect(uniqueResponse.json().data).toMatchObject({
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
      state: 'READY',
      context: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
        skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 1,
      },
    });
    await unique.app.close();

    const preferred = await build();
    const preferredResponse = await preferred.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-2',
        selectionKind: 'EXPLICIT',
      },
    });
    expect(preferredResponse.statusCode).toBe(200);
    expect(preferredResponse.json().data).toMatchObject({
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
      state: 'READY',
      context: { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
    });

    const hintedResponse = await preferred.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-1',
        selectionKind: 'HINT',
      },
    });
    expect(hintedResponse.statusCode).toBe(200);
    expect(hintedResponse.json().data).toMatchObject({
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
      state: 'READY',
      context: { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
    });
    await preferred.app.close();
  });

  it('allows an authorized generated hero to reopen only for review and publish', async () => {
    const { app, authorizeBoundSlotLaunch, getReadiness } = await build({
      selectedSkuKeys: ['sku-1'],
      boundSlotAuthorized: true,
      assignments: [
        {
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:source',
          assetId: 'asset-source-1', source: 'SOURCE',
        },
        {
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
          assetId: 'asset-generated-1', source: 'GENERATED',
        },
      ],
    });
    const payload = {
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
      sourcePlatform: '1688' as const,
      sourceProductId: 'product-1', sourceCaptureSnapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1', shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4,
      preferredSkuKey: 'sku-1', selectionKind: 'HINT' as const,
      supportedLaunchModes: ['GENERATE', 'REVIEW_PUBLISH_ONLY'] as const,
    };
    const response = await app.inject({ method: 'POST', url: '/workbench-launch', payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      contractVersion: EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_DECISION_VERSION,
      state: 'REVIEW_PUBLISH_ONLY',
      context: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_REVIEW_LAUNCH_CONTEXT_VERSION,
        launchMode: 'REVIEW_PUBLISH_ONLY',
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assignmentOrdinal: 1, assetId: 'asset-generated-1', source: 'GENERATED',
      },
    });
    expect(authorizeBoundSlotLaunch).toHaveBeenCalledOnce();
    expect(authorizeBoundSlotLaunch).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', requestingDeviceSessionId: 'session-1',
      sourcePlatform: '1688', sourceProductId: 'product-1',
      sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
      shopId: 'shop-1', workflowId: 'workflow-1',
      draftRevision: 3, draftVersion: 4,
      skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
      assignmentOrdinal: 1, assetId: 'asset-generated-1', source: 'GENERATED',
    });

    const readiness = await app.inject({
      method: 'POST',
      url: '/readiness',
      payload: request({ assignmentOrdinal: 1 }),
    });
    expect(readiness.statusCode).toBe(409);
    expect(readiness.json().errorCode).toBe('byok_readiness_target_stale');
    expect(getReadiness).toHaveBeenCalledOnce();
    await app.close();
  });

  it('uses request v3 as capability negotiation while preserving empty-slot generation', async () => {
    const { app, authorizeBoundSlotLaunch } = await build({ selectedSkuKeys: ['sku-1'] });
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-1', selectionKind: 'HINT',
        supportedLaunchModes: ['GENERATE', 'REVIEW_PUBLISH_ONLY'],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_DECISION_VERSION,
      state: 'READY',
      context: { skuKey: 'sku-1', assignmentMode: 'APPEND' },
    });
    expect(authorizeBoundSlotLaunch).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects malformed request v3 launch capability negotiation before authorization', async () => {
    for (const supportedLaunchModes of [
      undefined,
      ['REVIEW_PUBLISH_ONLY', 'GENERATE'],
      ['GENERATE'],
      ['GENERATE', 'REVIEW_PUBLISH_ONLY', 'OTHER'],
    ]) {
      const { app, authorizeBoundSlotLaunch } = await build({
        selectedSkuKeys: ['sku-1'],
        boundSlotAuthorized: true,
        assignments: [{
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
          assetId: 'asset-generated-1', source: 'GENERATED',
        }],
      });
      const response = await app.inject({
        method: 'POST',
        url: '/workbench-launch',
        payload: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
          preferredSkuKey: 'sku-1', selectionKind: 'HINT',
          ...(supportedLaunchModes === undefined ? {} : { supportedLaunchModes }),
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errorCode).toBe('byok_workbench_launch_request_invalid');
      expect(authorizeBoundSlotLaunch).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('rejects an unapproved, non-generated, mismatched, or stale occupied hero', async () => {
    const cases = [
      {
        name: 'unapproved generated asset',
        options: {
          selectedSkuKeys: ['sku-1', 'sku-2'],
          assignments: [{
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-generated-1', source: 'GENERATED',
          }],
        },
        draftRevision: 3,
        selectionKind: 'HINT' as const,
        authorizerCalls: 1,
        expectedErrorCode: 'byok_workbench_launch_slot_unavailable',
      },
      {
        name: 'non-generated asset',
        options: {
          selectedSkuKeys: ['sku-1'], boundSlotAuthorized: true,
          assignments: [{
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-source-1', source: 'SOURCE',
          }],
        },
        draftRevision: 3,
        authorizerCalls: 0,
        expectedErrorCode: 'byok_workbench_launch_slot_unavailable',
      },
      {
        name: 'mismatched authorized asset',
        options: {
          selectedSkuKeys: ['sku-1'], boundSlotAuthorized: true,
          boundSlotAssetId: 'asset-generated-other',
          assignments: [{
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-generated-1', source: 'GENERATED',
          }],
        },
        draftRevision: 3,
        authorizerCalls: 1,
        expectedErrorCode: 'byok_workbench_launch_slot_unavailable',
      },
      {
        name: 'authorization dependency failure',
        options: {
          selectedSkuKeys: ['sku-1'], boundSlotAuthorizationThrows: true,
          assignments: [{
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-generated-1', source: 'GENERATED',
          }],
        },
        draftRevision: 3,
        authorizerCalls: 1,
        expectedErrorCode: 'byok_workbench_launch_slot_unavailable',
      },
      {
        name: 'mismatched SKU binding',
        options: {
          selectedSkuKeys: ['sku-1'], boundSlotAuthorized: true,
          assignments: [{
            scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-generated-1', source: 'GENERATED',
          }],
        },
        draftRevision: 3,
        authorizerCalls: 0,
        expectedErrorCode: 'byok_workbench_launch_slot_unavailable',
      },
      {
        name: 'stale draft binding',
        options: {
          selectedSkuKeys: ['sku-1'], draftRevision: 4, boundSlotAuthorized: true,
          assignments: [{
            scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
            assetId: 'asset-generated-1', source: 'GENERATED',
          }],
        },
        draftRevision: 3,
        authorizerCalls: 0,
        expectedErrorCode: 'byok_workbench_launch_context_stale',
      },
    ];
    for (const testCase of cases) {
      const { app, authorizeBoundSlotLaunch } = await build(testCase.options);
      const response = await app.inject({
        method: 'POST',
        url: '/workbench-launch',
        payload: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V3,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1',
          draftRevision: testCase.draftRevision, draftVersion: 4,
          preferredSkuKey: 'sku-1',
          selectionKind: 'selectionKind' in testCase ? testCase.selectionKind : 'EXPLICIT',
          supportedLaunchModes: ['GENERATE', 'REVIEW_PUBLISH_ONLY'],
        },
      });
      expect(response.statusCode, testCase.name).toBe(409);
      expect(response.json().errorCode, testCase.name)
        .toBe(testCase.expectedErrorCode);
      expect(authorizeBoundSlotLaunch, testCase.name)
        .toHaveBeenCalledTimes(testCase.authorizerCalls);
      await app.close();
    }
  });

  it('turns an invalid automatic SKU hint into an explicit current choice', async () => {
    for (const item of [
      { options: {}, preferredSkuKey: 'sku-3', expectedSkuKeys: ['sku-1', 'sku-2'] },
      {
        options: {
          assignments: [{
            scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
            assetId: 'asset-hero-2', source: 'SOURCE',
          }],
        },
        preferredSkuKey: 'sku-2',
        expectedSkuKeys: ['sku-1'],
      },
    ]) {
      const { app } = await build(item.options);
      const response = await app.inject({
        method: 'POST', url: '/workbench-launch',
        payload: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
          preferredSkuKey: item.preferredSkuKey,
          selectionKind: 'HINT',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        state: 'CHOICE_REQUIRED', skuKeys: item.expectedSkuKeys,
      });
      await app.close();
    }
  });

  it('rejects v2 launch authority after revision, version, or snapshot changes', async () => {
    for (const overrides of [
      { draftRevision: 5 },
      { draftVersion: 6 },
      { sourceCaptureSnapshotId: 'snapshot-2' },
    ]) {
      const { app } = await build();
      for (const url of ['/workbench-launch', '/workbench-batch-launch']) {
        const response = await app.inject({
          method: 'POST', url,
          payload: {
            contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
            sourcePlatform: '1688', sourceProductId: 'product-1',
            sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
            shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
            preferredSkuKey: 'sku-1',
            selectionKind: 'EXPLICIT',
            ...overrides,
          },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json().errorCode).toBe('byok_workbench_launch_context_stale');
      }
      await app.close();
    }
  });

  it('rejects stale explicit choices and non-strict v2 requests', async () => {
    const cases = [
      { options: {}, preferredSkuKey: 'sku-3', extra: {}, selectionKind: 'EXPLICIT', status: 409 },
      {
        options: {
          assignments: [{
            scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
            assetId: 'asset-hero-2', source: 'SOURCE',
          }],
        },
        preferredSkuKey: 'sku-2',
        extra: {},
        selectionKind: 'EXPLICIT',
        status: 409,
      },
      {
        options: {}, preferredSkuKey: 'sku-2', extra: { skuKey: 'sku-2' },
        selectionKind: 'HINT', status: 400,
      },
    ];
    for (const item of cases) {
      const { app } = await build(item.options);
      const response = await app.inject({
        method: 'POST', url: '/workbench-launch',
        payload: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
          preferredSkuKey: item.preferredSkuKey,
          selectionKind: item.selectionKind,
          ...item.extra,
        },
      });
      expect(response.statusCode).toBe(item.status);
      await app.close();
    }

    const missingPreferred = await build();
    const missingResponse = await missingPreferred.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(missingResponse.statusCode).toBe(400);
    await missingPreferred.app.close();

    const legacyExtra = await build();
    const legacyExtraResponse = await legacyExtra.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: null,
      },
    });
    expect(legacyExtraResponse.statusCode).toBe(400);
    await legacyExtra.app.close();
  });

  it('rejects a secret-bearing preferred SKU identifier', async () => {
    const { app } = await build();
    const response = await app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: `sk-${'a'.repeat(32)}`,
        selectionKind: 'HINT',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe('byok_workbench_launch_request_invalid');
    expect(response.body).not.toContain(`sk-${'a'.repeat(32)}`);
    await app.close();
  });

  it('returns all server-authorized batch slots with one contiguous append base', async () => {
    const { app } = await build({
      assignments: [{
        scope: 'PRODUCT', slotKey: 'shared:detail:SCENE',
        assetId: 'asset-scene', source: 'GENERATED',
      }],
    });
    const response = await app.inject({
      method: 'POST',
      url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-1',
        selectionKind: 'EXPLICIT',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({
      code: 1,
      data: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        anchorSkuKey: 'sku-1',
        firstAssignmentOrdinal: 1,
        targets: [
          { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
          { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
          { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
          { skuKey: 'sku-1', slotKey: 'shared:detail:SPEC' },
          { skuKey: 'sku-1', slotKey: 'shared:detail:PACKAGING' },
        ],
      },
    });
    expect(response.body).not.toContain('providerOrigin');
    await app.close();
  });

  it('intentionally keeps legacy v1 multi-SKU batch launch fail-closed', async () => {
    const { app } = await build({
      assignments: [{
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'asset-hero-1', source: 'SOURCE',
      }],
    });
    const response = await app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('byok_workbench_launch_slot_unavailable');
    await app.close();
  });

  it('keeps v1 single-SKU detail-only batch continuation when its hero is occupied', async () => {
    const { app } = await build({
      selectedSkuKeys: ['sku-1'],
      assignments: [{
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'asset-hero-1', source: 'SOURCE',
      }],
    });
    const response = await app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      anchorSkuKey: 'sku-1',
      firstAssignmentOrdinal: 1,
      targets: [
        { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
        { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
        { skuKey: 'sku-1', slotKey: 'shared:detail:SPEC' },
        { skuKey: 'sku-1', slotKey: 'shared:detail:PACKAGING' },
      ],
    });
    await app.close();
  });

  it('uses the exact v2 preferred SKU as batch anchor and first hero target', async () => {
    const { app } = await build();
    const response = await app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-2',
        selectionKind: 'EXPLICIT',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      contractVersion: EXTENSION_BYOK_WORKBENCH_BATCH_LAUNCH_CONTEXT_VERSION,
      anchorSkuKey: 'sku-2',
      targets: [
        { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
        { skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' },
        { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE' },
        { skuKey: 'sku-2', slotKey: 'shared:detail:DETAIL' },
        { skuKey: 'sku-2', slotKey: 'shared:detail:SPEC' },
        { skuKey: 'sku-2', slotKey: 'shared:detail:PACKAGING' },
      ],
    });
    await app.close();
  });

  it('caps a 500-SKU batch at the client target limit', async () => {
    const selectedSkuKeys = Array.from({ length: 500 }, (_, index) => `sku-${index}`);
    const { app } = await build({ assignments: [], selectedSkuKeys });
    const response = await app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
        preferredSkuKey: 'sku-250',
        selectionKind: 'EXPLICIT',
      },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.anchorSkuKey).toBe('sku-250');
    expect(data.targets).toHaveLength(500);
    expect(data.targets[0]).toEqual({ skuKey: 'sku-250', slotKey: 'sku:sku-250:hero' });
    expect(new Set(data.targets.map((target: { slotKey: string }) => target.slotKey)).size).toBe(500);
    expect(data.targets.every((target: { slotKey: string }) => target.slotKey.endsWith(':hero')))
      .toBe(true);
    await app.close();
  });

  it('fails closed for a v2 batch without an exact available preferred SKU', async () => {
    for (const item of [
      {
        preferredSkuKey: null,
        options: { selectedSkuKeys: ['sku-1'] },
      },
      { preferredSkuKey: 'sku-3', options: {} },
      {
        preferredSkuKey: 'sku-2',
        options: {
          assignments: [{
            scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
            assetId: 'asset-hero-2', source: 'SOURCE',
          }],
        },
      },
    ]) {
      const { app } = await build(item.options);
      const response = await app.inject({
        method: 'POST', url: '/workbench-batch-launch',
        payload: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION_V2,
          sourcePlatform: '1688', sourceProductId: 'product-1',
          sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
          shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
          preferredSkuKey: item.preferredSkuKey,
          selectionKind: 'EXPLICIT',
        },
      });
      expect(response.statusCode).toBe(409);
      await app.close();
    }
  });

  it('authorizes pure launch with listing review but keeps readiness on BYOK ingest scope', async () => {
    const listingReview = await build({ scopes: ['listing:review'], selectedSkuKeys: ['sku-1'] });
    const launch = await listingReview.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(launch.statusCode).toBe(200);
    expect(listingReview.authenticateLaunchDevice).toHaveBeenCalledTimes(1);
    expect(listingReview.authenticateDevice).not.toHaveBeenCalled();
    const batchLaunch = await listingReview.app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(batchLaunch.statusCode).toBe(200);
    const readiness = await listingReview.app.inject({
      method: 'POST', url: '/readiness', payload: request(),
    });
    expect(readiness.statusCode).toBe(403);
    expect(listingReview.authenticateDevice).toHaveBeenCalledTimes(1);
    await listingReview.app.close();

    const ingestOnly = await build({ scopes: ['byok:media:ingest'], selectedSkuKeys: ['sku-1'] });
    const deniedLaunch = await ingestOnly.app.inject({
      method: 'POST', url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(deniedLaunch.statusCode).toBe(403);
    const deniedBatchLaunch = await ingestOnly.app.inject({
      method: 'POST', url: '/workbench-batch-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(deniedBatchLaunch.statusCode).toBe(403);
    await ingestOnly.app.close();
  });

  it('registers distinct launch and BYOK execution scope authenticators in the real server', () => {
    const serverEntry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(serverEntry).toMatch(
      /extensionByokReadinessRoutes[\s\S]{0,1200}authenticateDevice:[\s\S]{0,300}requiredScopes:\s*\['byok:media:ingest'\][\s\S]{0,500}authenticateLaunchDevice:[\s\S]{0,300}requiredScopes:\s*\['listing:review'\]/u,
    );
  });

  it('accepts an exact empty selected-SKU hero or shared detail target', async () => {
    const { app } = await build();
    for (const target of [
      { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
      { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
      { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE' },
      { skuKey: 'sku-1', slotKey: 'shared:detail:DETAIL' },
      { skuKey: 'sku-1', slotKey: 'shared:detail:SPEC' },
      { skuKey: 'sku-1', slotKey: 'shared:detail:PACKAGING' },
    ]) {
      const response = await app.inject({
        method: 'POST', url: '/readiness', payload: request(target),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.binding).toMatchObject({
        ...target,
        assignmentMode: 'APPEND',
        assignmentOrdinal: 1,
      });
    }
    await app.close();
  });

  it('rejects stale identity, unsupported target shapes, stale order, and an unselected anchor', async () => {
    const { app } = await build();
    const cases: Array<{ overrides: Record<string, unknown>; expectedStatus: number }> = [
      { overrides: { sourceProductId: 'other-product' }, expectedStatus: 409 },
      { overrides: { sourceCaptureSnapshotId: 'snapshot-2' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-2', slotKey: 'sku:sku-1:hero' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-3', slotKey: 'sku:sku-3:hero' }, expectedStatus: 409 },
      { overrides: { slotKey: 'sku:sku-1:detail' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-3', slotKey: 'shared:detail:SCENE' }, expectedStatus: 409 },
      { overrides: { slotKey: 'shared:detail:OTHER' }, expectedStatus: 409 },
      { overrides: { slotKey: 'group:all:detail:SCENE' }, expectedStatus: 409 },
      { overrides: { assignmentMode: 'REPLACE' }, expectedStatus: 400 },
      { overrides: { assignmentOrdinal: 0 }, expectedStatus: 409 },
    ];
    for (const { overrides, expectedStatus } of cases) {
      const response = await app.inject({
        method: 'POST', url: '/readiness', payload: request(overrides),
      });
      expect(response.statusCode).toBe(expectedStatus);
    }
    await app.close();
  });

  it('rejects an occupied shared detail target', async () => {
    const { app } = await build({
      assignments: [{
        scope: 'PRODUCT', slotKey: 'shared:detail:SCENE',
        assetId: 'asset-scene', source: 'GENERATED',
      }],
    });
    const response = await app.inject({
      method: 'POST', url: '/readiness',
      payload: request({ slotKey: 'shared:detail:SCENE' }),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('byok_readiness_target_stale');
    await app.close();
  });

  it('rejects launch and readiness after a newer source capture supersedes the bound snapshot', async () => {
    const { app } = await build({ sourceCaptureCurrent: false });
    const launch = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(launch.statusCode).toBe(409);
    const readiness = await app.inject({
      method: 'POST', url: '/readiness', payload: request(),
    });
    expect(readiness.statusCode).toBe(409);
    await app.close();
  });

  it('rejects launch when 500 assignments leave no representable append ordinal', async () => {
    const { app } = await build({ assignmentCount: 500 });
    const launch = await app.inject({
      method: 'POST',
      url: '/workbench-launch',
      payload: {
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
      },
    });
    expect(launch.statusCode).toBe(409);
    expect(launch.json().errorCode).toBe('byok_workbench_launch_slot_unavailable');
    await app.close();
  });
});
