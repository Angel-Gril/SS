import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionAiImageSuiteRoutes } from '../routes/extension-ai-image-suite.js';

const query = 'snapshotId=snapshot-1&supplyGoodsId=goods-1&shopId=shop-1'
  + '&listingWorkflowId=listing-1&draftRevision=11&draftVersion=7';

function state() {
  return {
    executionReady: true,
    authority: {
      snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
      listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
    },
    plan: {
      id: 'plan-1', revision: 3, reviewStatus: 'APPROVED', staleAt: null,
      contextType: 'collect', contextId: 'goods-1',
      currentVersionId: 'plan-version-1', approvedVersionId: 'plan-version-1', skuKey: null,
      approvedVersion: {
        id: 'plan-version-1',
        sourceCaptureSnapshotId: 'snapshot-1',
        planPayload: {
          slots: [{
            slotKey: 'sku:sku-1:hero',
            ownership: { level: 'sku', key: 'sku-1' },
          }],
          compatibilityGroups: [],
        },
      },
      preview: {
        planId: 'plan-1', planVersionId: 'plan-version-1', planRevision: 3,
        previewHash: 'a'.repeat(64), pricingVersion: 'pricing-v1', itemCount: 1,
        estimatedCostCents: 9, maximumCostCents: 12,
        slots: [{
          ordinal: 0,
          slotKey: 'sku:sku-1:hero',
          goal: 'HERO',
          ownership: { level: 'sku', key: 'sku-1' },
          estimatedCostCents: 9,
          maximumCostCents: 12,
        }],
      },
    },
    suite: null,
  };
}

async function setup(input: {
  scopes?: string[];
  allowedShopIds?: string[];
  withDevice?: boolean;
  loaded?: ReturnType<typeof state> | null;
} = {}) {
  const loadState = vi.fn(async () => input.loaded === undefined ? state() : input.loaded);
  const loadTrustedPreviewOrigins = vi.fn(async () => ['https://erp.example']);
  const app = Fastify();
  await app.register(extensionAiImageSuiteRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: async (request: FastifyRequest) => {
      if (input.withDevice === false) return;
      (request as any).device = {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', sessionId: 'session-1',
        scopes: input.scopes ?? ['listing:review', 'media:execute'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1'],
      };
    },
    loadState,
    loadTrustedPreviewOrigins,
  });
  await app.ready();
  return { app, loadState, loadTrustedPreviewOrigins };
}

describe('extension AI image suite route', () => {
  it('returns a no-store projection from an exact device-owned listing authority', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: `/api/extension-device/source-workbench/ai-image-suite?${query}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          contractVersion: 'extension-ai-image-suite-projection/v1',
          context: {
            snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
            listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
          },
          plan: { id: 'plan-1', allowedActions: ['START'] },
          suite: null,
        },
      });
      expect(fixture.loadState).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        deviceSessionId: 'session-1',
        snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
        listingWorkflowId: 'listing-1', draftRevision: 11, draftVersion: 7,
      });
      expect(fixture.loadTrustedPreviewOrigins).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', shopId: 'shop-1',
      });
    } finally {
      await fixture.app.close();
    }
  });

  it('rejects missing review scope, denied shops, and loose queries before loading tenant state', async () => {
    const noScope = await setup({ scopes: ['media:execute'] });
    const wrongShop = await setup({ allowedShopIds: [] });
    const looseQuery = await setup();
    try {
      const scopeResponse = await noScope.app.inject({
        method: 'GET', url: `/api/extension-device/source-workbench/ai-image-suite?${query}`,
      });
      const shopResponse = await wrongShop.app.inject({
        method: 'GET', url: `/api/extension-device/source-workbench/ai-image-suite?${query}`,
      });
      const looseResponse = await looseQuery.app.inject({
        method: 'GET',
        url: `/api/extension-device/source-workbench/ai-image-suite?${query}&provider=client-value`,
      });

      expect(scopeResponse.statusCode).toBe(403);
      expect(scopeResponse.json()).toMatchObject({ errorCode: 'command_scope_denied' });
      expect(shopResponse.statusCode).toBe(403);
      expect(shopResponse.json()).toMatchObject({ errorCode: 'command_shop_denied' });
      expect(looseResponse.statusCode).toBe(400);
      expect(noScope.loadState).not.toHaveBeenCalled();
      expect(wrongShop.loadState).not.toHaveBeenCalled();
      expect(looseQuery.loadState).not.toHaveBeenCalled();
    } finally {
      await Promise.all([noScope.app.close(), wrongShop.app.close(), looseQuery.app.close()]);
    }
  });

  it('fails stale when the authoritative snapshot or listing draft binding changes', async () => {
    const mismatched = state();
    mismatched.authority.draftVersion = 8;
    const fixture = await setup({ loaded: mismatched });
    try {
      const response = await fixture.app.inject({
        method: 'GET', url: `/api/extension-device/source-workbench/ai-image-suite?${query}`,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'ai_image_suite_context_stale' });
    } finally {
      await fixture.app.close();
    }
  });

  it('keeps execution actions dark for a review-only device', async () => {
    const fixture = await setup({ scopes: ['listing:review'] });
    try {
      const response = await fixture.app.inject({
        method: 'GET', url: `/api/extension-device/source-workbench/ai-image-suite?${query}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.plan.allowedActions).toEqual([]);
      expect(response.json().data.plan.commands).toEqual({});
    } finally {
      await fixture.app.close();
    }
  });
});
