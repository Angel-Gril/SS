import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionMediaLaunchRoutes } from '../routes/extension-media-launch.js';

function decision(enabled: boolean, reason = enabled ? 'pilot_match' : 'master_off') {
  return {
    enabled,
    legacyAllowed: !enabled,
    captureStage: null,
    reason,
    revision: enabled ? 'pilot-1' : 'master-off',
  } as any;
}

async function setup(input: {
  extensionEnabled?: boolean;
  mediaEnabled?: boolean;
  scopes?: string[];
  allowedShopIds?: string[];
  ready?: boolean;
  capabilityRevision?: string;
  loadContextError?: Error;
  context?: Record<string, unknown> | null;
} = {}) {
  const evaluate = vi.fn(async (feature: string) => (
    feature === 'SOURCE_LISTING_EXTENSION_WORKBENCH'
      ? decision(input.extensionEnabled !== false)
      : decision(input.mediaEnabled !== false)
  ));
  const loadContext = vi.fn(async () => {
    if (input.loadContextError) throw input.loadContextError;
    return input.context === undefined ? ({
    id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1',
    revision: 11, draftVersion: 7, sourceMediaKeys: ['media-1', 'media-2'],
    }) : input.context;
  });
  const getCapability = vi.fn(async () => ({
    enabled: input.ready !== false,
    ready: input.ready !== false,
    reasonCode: input.ready !== false ? 'READY' : 'PROVIDER_NOT_READY',
    reason: input.ready !== false ? 'ready' : 'provider unavailable',
    revision: input.capabilityRevision || 'pilot-1', testOnly: true as const,
    operation: 'IMAGE_TRANSLATE' as const,
    sourceLanguage: 'zh' as const, targetLanguage: 'ru' as const,
  }));
  const app = Fastify();
  await app.register(extensionMediaLaunchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: async (request: FastifyRequest) => {
      (request as any).device = {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', sessionId: 'session-1',
        scopes: input.scopes ?? ['listing:review', 'media:execute'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1'],
      };
    },
    featureFlags: { evaluate },
    loadContext: loadContext as any,
    getCapability,
  });
  await app.ready();
  return { app, evaluate, loadContext, getCapability };
}

const url = '/api/extension-device/source-workbench/media-launch'
  + '?snapshotId=snapshot-1&supplyGoodsId=goods-1&shopId=shop-1'
  + '&listingWorkflowId=listing-1&revision=11&draftVersion=7';

describe('extension media launch route', () => {
  it('returns only bounded source media keys for an exact fake-only launch context', async () => {
    const state = await setup();
    try {
      const response = await state.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          capability: {
            enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
            revision: 'pilot-1', testOnly: true, operation: 'IMAGE_TRANSLATE',
            sourceLanguage: 'zh', targetLanguage: 'ru',
          },
          context: {
            id: 'listing-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
            snapshotId: 'snapshot-1', revision: 11, draftVersion: 7,
            sourceInputs: [{ sourceMediaKey: 'media-1' }, { sourceMediaKey: 'media-2' }],
            requested: {
              snapshotId: 'snapshot-1', listingWorkflowId: 'listing-1',
              revision: 11, draftVersion: 7,
            },
          },
        },
      });
      expect(state.loadContext).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
      });
    } finally {
      await state.app.close();
    }
  });

  it('does not read tenant context while any rollout or fake capability is dark', async () => {
    for (const options of [
      { extensionEnabled: false },
      { mediaEnabled: false },
      { ready: false },
    ]) {
      const state = await setup(options);
      try {
        const response = await state.app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(200);
        expect(response.json().data.context).toBeNull();
        expect(state.loadContext).not.toHaveBeenCalled();
      } finally {
        await state.app.close();
      }
    }
  });

  it('fails closed for a missing execution scope, wrong shop, or stale context', async () => {
    const noScope = await setup({ scopes: ['listing:review'] });
    const wrongShop = await setup({ allowedShopIds: [] });
    const stale = await setup({ context: null });
    try {
      expect((await noScope.app.inject({ method: 'GET', url })).statusCode).toBe(403);
      expect((await wrongShop.app.inject({ method: 'GET', url })).statusCode).toBe(403);
      const staleResponse = await stale.app.inject({ method: 'GET', url });
      expect(staleResponse.statusCode).toBe(409);
      expect(staleResponse.json()).toMatchObject({ errorCode: 'media_create_context_stale' });
    } finally {
      await Promise.all([noScope.app.close(), wrongShop.app.close(), stale.app.close()]);
    }
  });

  it('returns a bounded capability revision when feature revisions are long', async () => {
    const state = await setup({ capabilityRevision: 'capability-' + 'c'.repeat(240) });
    try {
      const response = await state.app.inject({ method: 'GET', url });
      const revision = response.json().data.capability.revision;
      expect(response.statusCode).toBe(200);
      expect(revision.length).toBeLessThanOrEqual(200);
      expect(revision).toContain('|sha256:');
    } finally {
      await state.app.close();
    }
  });

  it('does not turn infrastructure context failures into stale-context responses', async () => {
    const state = await setup({ loadContextError: new Error('database unavailable') });
    try {
      const response = await state.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ errorCode: 'media_context_unavailable' });
    } finally {
      await state.app.close();
    }
  });

  it('maps an explicitly stale context exception to the refresh response', async () => {
    const state = await setup({
      loadContextError: Object.assign(new Error('draft revision changed'), {
        code: 'STALE_MEDIA_CONTEXT',
      }),
    });
    try {
      const response = await state.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'media_create_context_stale' });
    } finally {
      await state.app.close();
    }
  });
});
