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
  EXTENSION_BYOK_WORKBENCH_LAUNCH_CONTEXT_VERSION,
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
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
} = {}) {
  const getReadiness = vi.fn(async () => options.readiness || decision());
  const app = Fastify();
  await app.register(extensionByokReadinessRoutes, {
    authenticateDevice: async (fastifyRequest: FastifyRequest) => {
      (fastifyRequest as any).device = {
        sessionId: 'session-1',
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        scopes: options.scopes || ['byok:media:ingest'],
        allowedShopIds: ['shop-1'],
      };
    },
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
    getReadiness,
    now: () => NOW,
  });
  return { app, getReadiness };
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

  it('resolves one exact empty SKU hero target without trusting a browser-selected slot', async () => {
    const { app } = await build();
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
        contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
        sourcePlatform: '1688', sourceProductId: 'product-1',
        sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
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

  it('accepts an exact empty selected-SKU hero or shared detail target', async () => {
    const { app } = await build();
    for (const target of [
      { skuKey: 'sku-2', slotKey: 'sku:sku-2:hero' },
      { skuKey: 'sku-1', slotKey: 'shared:detail:SCENE' },
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

  it('rejects stale identity, unsupported target shapes, stale order, and a wrong shared anchor', async () => {
    const { app } = await build();
    const cases: Array<{ overrides: Record<string, unknown>; expectedStatus: number }> = [
      { overrides: { sourceProductId: 'other-product' }, expectedStatus: 409 },
      { overrides: { sourceCaptureSnapshotId: 'snapshot-2' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-2', slotKey: 'sku:sku-1:hero' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-3', slotKey: 'sku:sku-3:hero' }, expectedStatus: 409 },
      { overrides: { slotKey: 'sku:sku-1:detail' }, expectedStatus: 409 },
      { overrides: { skuKey: 'sku-2', slotKey: 'shared:detail:SCENE' }, expectedStatus: 409 },
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
