import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionMediaLaunchRoutes } from '../routes/extension-media-launch.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';

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
  aiMediaEnabled?: boolean;
  scopes?: string[];
  allowedShopIds?: string[];
  ready?: boolean;
  capabilityRevision?: string;
  operationCapabilities?: Record<string, Record<string, unknown>>;
  loadContextError?: Error;
  context?: Record<string, unknown> | null;
  preview?: Record<string, unknown>;
} = {}) {
  const evaluate = vi.fn(async (feature: string) => (
    feature === 'SOURCE_LISTING_EXTENSION_WORKBENCH'
      ? decision(input.extensionEnabled !== false)
      : decision(input.mediaEnabled !== false)
  ));
  const getMediaWorkflowDecision = vi.fn(async () => ({
    enabled: input.aiMediaEnabled ?? input.mediaEnabled !== false,
    reason: input.aiMediaEnabled === false ? 'tenant_not_allowed' : 'tenant_allowed',
    revision: 7,
  }));
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
  const getCapabilities = vi.fn(async () => input.operationCapabilities || ({
    IMAGE_TO_IMAGE: {
      enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
      revision: 'image-to-image-1', testOnly: true, operation: 'IMAGE_TO_IMAGE',
      maxReferences: 4,
    },
    IMAGE_TRANSLATE: {
      enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
      revision: 'translation-1', testOnly: true, operation: 'IMAGE_TRANSLATE',
      sourceLanguage: 'zh', targetLanguage: 'ru',
    },
    FULL_EDIT: {
      enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
      reason: 'disabled', revision: 'full-edit-1', testOnly: true, operation: 'FULL_EDIT',
    },
    INPAINT: {
      enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
      revision: 'inpaint-1', testOnly: true, operation: 'INPAINT',
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS, maxMaskBytes: 20 * 1024 * 1024,
    },
  }));
  const loadPreview = vi.fn(async () => input.preview || ({
    bytes: Buffer.from('preview-bytes'),
    mimeType: 'image/jpeg',
    width: 640,
    height: 480,
    sha256: createHash('sha256').update('preview-bytes').digest('hex'),
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
    getMediaWorkflowDecision,
    loadContext: loadContext as any,
    loadPreview: loadPreview as any,
    getCapability,
    getCapabilities: getCapabilities as any,
  });
  await app.ready();
  return {
    app, evaluate, getMediaWorkflowDecision, loadContext, loadPreview,
    getCapability, getCapabilities,
  };
}

const url = '/api/extension-device/source-workbench/media-launch'
  + '?snapshotId=snapshot-1&supplyGoodsId=goods-1&shopId=shop-1'
  + '&listingWorkflowId=listing-1&revision=11&draftVersion=7';

const previewBody = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  revision: 11,
  draftVersion: 7,
  skuKey: 'sku-red',
  sourceMediaKey: 'media-1',
  purpose: 'THUMBNAIL',
};

describe('extension media launch route', () => {
  it('returns only normalized source preview bytes for the exact live draft and SKU', async () => {
    const state = await setup();
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-preview',
        payload: previewBody,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers).toMatchObject({
        'cache-control': 'no-store',
        'content-type': 'image/jpeg',
        'content-length': String(Buffer.byteLength('preview-bytes')),
        'x-content-type-options': 'nosniff',
        'x-ss-erp-content-sha256': createHash('sha256').update('preview-bytes').digest('hex'),
        'x-ss-erp-image-width': '640',
        'x-ss-erp-image-height': '480',
      });
      expect(response.rawPayload).toEqual(Buffer.from('preview-bytes'));
      expect(state.loadPreview).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        listingWorkflowId: 'listing-1',
        revision: 11,
        draftVersion: 7,
        skuKey: 'sku-red',
        sourceMediaKey: 'media-1',
        purpose: 'THUMBNAIL',
      });
      expect(response.body).not.toContain('source.example');
    } finally {
      await state.app.close();
    }
  });

  it('fails closed when a source preview key, device scope, or output metadata is invalid', async () => {
    const wrongSource = await setup();
    const noScope = await setup({ scopes: ['listing:review'] });
    const malformed = await setup({
      preview: {
        bytes: Buffer.from('preview-bytes'), mimeType: 'text/html',
        width: 640, height: 480, sha256: 'a'.repeat(64),
      },
    });
    try {
      const wrongSourceResponse = await wrongSource.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-preview',
        payload: { ...previewBody, sourceMediaKey: 'media-foreign' },
      });
      expect(wrongSourceResponse.statusCode).toBe(409);
      expect(wrongSourceResponse.json()).toMatchObject({
        errorCode: 'media_preview_context_stale',
      });
      expect(wrongSource.loadPreview).not.toHaveBeenCalled();

      expect((await noScope.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-preview',
        payload: previewBody,
      })).statusCode).toBe(403);

      const malformedResponse = await malformed.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-preview',
        payload: previewBody,
      });
      expect(malformedResponse.statusCode).toBe(503);
      expect(malformedResponse.json()).toMatchObject({
        errorCode: 'media_preview_unavailable',
      });
    } finally {
      await Promise.all([wrongSource.app.close(), noScope.app.close(), malformed.app.close()]);
    }
  });

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
            revision: 'pilot-1|7', testOnly: true, operation: 'IMAGE_TRANSLATE',
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

  it('returns the v2 standalone operation matrix without changing the legacy response', async () => {
    const state = await setup();
    try {
      const response = await state.app.inject({ method: 'GET', url: `${url}&contractVersion=2` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          contractVersion: 'extension-media-launch/v2',
          revision: 'pilot-1|7|image-to-image-1|translation-1|full-edit-1|inpaint-1',
          operations: {
            IMAGE_TO_IMAGE: {
              enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
              revision: 'image-to-image-1', testOnly: true, operation: 'IMAGE_TO_IMAGE',
              maxReferences: 4,
            },
            IMAGE_TRANSLATE: {
              enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
              revision: 'translation-1', testOnly: true, operation: 'IMAGE_TRANSLATE',
              sourceLanguage: 'zh', targetLanguage: 'ru',
            },
            FULL_EDIT: {
              enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
              reason: 'disabled', revision: 'full-edit-1', testOnly: true, operation: 'FULL_EDIT',
            },
            INPAINT: {
              enabled: true, ready: true, reasonCode: 'READY', reason: 'ready',
              revision: 'inpaint-1', testOnly: true, operation: 'INPAINT',
              maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS, maxMaskBytes: 20 * 1024 * 1024,
            },
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
      expect(state.getCapability).not.toHaveBeenCalled();
      expect(state.getCapabilities).toHaveBeenCalledOnce();
      expect(state.loadContext).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
        shopId: 'shop-1', listingWorkflowId: 'listing-1', revision: 11, draftVersion: 7,
      });
    } finally {
      await state.app.close();
    }
  });

  it('projects source role and SKU scope without exposing the remote source URL', async () => {
    const state = await setup({ context: {
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1',
      revision: 11, draftVersion: 7, sourceMediaKeys: ['media-1', 'media-2'],
      sourceInputs: [{
        sourceMediaKey: 'media-1', role: 'product_main', scope: 'PRODUCT', skuKeys: [],
      }, {
        sourceMediaKey: 'media-2', role: 'sku', scope: 'SKU', skuKeys: ['sku-red'],
      }],
    } });
    try {
      const response = await state.app.inject({ method: 'GET', url: `${url}&contractVersion=2` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.context.sourceInputs).toEqual([{
        sourceMediaKey: 'media-1', role: 'product_main', scope: 'PRODUCT', skuKeys: [],
      }, {
        sourceMediaKey: 'media-2', role: 'sku', scope: 'SKU', skuKeys: ['sku-red'],
      }]);
      expect(response.body).not.toContain('http');
    } finally {
      await state.app.close();
    }
  });

  it('keeps v2 tenant context dark when no standalone operation is ready', async () => {
    const disabled = Object.fromEntries([
      'IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE', 'FULL_EDIT', 'INPAINT',
    ].map((operation) => [operation, {
      enabled: false, ready: false, reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
      reason: 'disabled', revision: `${operation.toLowerCase()}-off`, testOnly: true, operation,
    }]));
    const state = await setup({ operationCapabilities: disabled });
    try {
      const response = await state.app.inject({ method: 'GET', url: `${url}&contractVersion=2` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        contractVersion: 'extension-media-launch/v2',
        operations: disabled,
        context: null,
      });
      expect(state.loadContext).not.toHaveBeenCalled();
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

  it('uses the canonical AI tenant decision instead of the source rollout policy', async () => {
    const state = await setup({ aiMediaEnabled: false });
    try {
      const response = await state.app.inject({ method: 'GET', url: `${url}&contractVersion=2` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.context).toBeNull();
      expect(state.getMediaWorkflowDecision).toHaveBeenCalledWith('owner-1');
      expect(state.evaluate).not.toHaveBeenCalledWith(
        'AI_MEDIA_WORKFLOW_V2',
        expect.anything(),
      );
      expect(state.loadContext).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('fails closed for a missing execution scope, wrong shop, or stale context', async () => {
    const noScope = await setup({ scopes: ['listing:review'] });
    const wrongShop = await setup({ allowedShopIds: [] });
    const stale = await setup({ context: null });
    const wrongSupplyGoods = await setup({ context: {
      id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
      supplyGoodsId: 'goods-2', snapshotId: 'snapshot-1',
      revision: 11, draftVersion: 7, sourceMediaKeys: ['media-1'],
    } });
    try {
      expect((await noScope.app.inject({ method: 'GET', url })).statusCode).toBe(403);
      expect((await wrongShop.app.inject({ method: 'GET', url })).statusCode).toBe(403);
      const staleResponse = await stale.app.inject({ method: 'GET', url });
      expect(staleResponse.statusCode).toBe(409);
      expect(staleResponse.json()).toMatchObject({ errorCode: 'media_create_context_stale' });
      expect((await wrongSupplyGoods.app.inject({ method: 'GET', url })).statusCode).toBe(409);
    } finally {
      await Promise.all([
        noScope.app.close(), wrongShop.app.close(), stale.app.close(), wrongSupplyGoods.app.close(),
      ]);
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
      for (const requestUrl of [url, `${url}&contractVersion=2`]) {
        const response = await state.app.inject({ method: 'GET', url: requestUrl });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ errorCode: 'media_context_unavailable' });
      }
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
      for (const requestUrl of [url, `${url}&contractVersion=2`]) {
        const response = await state.app.inject({ method: 'GET', url: requestUrl });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ errorCode: 'media_create_context_stale' });
      }
    } finally {
      await state.app.close();
    }
  });

  it('loads one request-level config and storage snapshot for the v2 capability matrix', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const registrationStart = source.indexOf('await app.register(extensionMediaLaunchRoutes');
    const capabilitiesStart = source.indexOf(
      'getCapabilities: async ({ workflowDecision }) => {',
      registrationStart,
    );
    const capabilitiesEnd = source.indexOf(
      '\n  });\n  await app.register(extensionMediaEditRoutes',
      capabilitiesStart,
    );
    expect(registrationStart).toBeGreaterThanOrEqual(0);
    expect(capabilitiesStart).toBeGreaterThan(registrationStart);
    expect(capabilitiesEnd).toBeGreaterThan(capabilitiesStart);
    const block = source.slice(capabilitiesStart, capabilitiesEnd);
    for (const key of [
      'feature_ai_media_image_to_image',
      'feature_ai_media_full_edit',
      'feature_ai_media_inpaint',
      'feature_image_translate',
      'ai_image_translation_provider',
      'ai_image_translation_model',
      'ai_user_daily_image_translation_limit',
      'ai_image_translation_cost_cents',
      'ai_image_base_url',
    ]) {
      expect(block.match(new RegExp(`getConfig\\('${key}'\\)`, 'gu'))).toHaveLength(1);
    }
    expect(block.match(/getRuntimeConfigForStorage\(\)/gu)).toHaveLength(1);
    expect(block).not.toMatch(/getExtensionStandaloneReadiness/u);
    expect(block).toMatch(/resolveAiImageToImageReadiness/u);
    expect(block).toMatch(/baseUrl: imageBaseUrl/u);
    expect(block).toMatch(/resolveAiImageEditReadiness\('FULL_EDIT'/u);
    expect(block).toMatch(/resolveAiImageEditReadiness\('INPAINT'/u);
    expect(block).toMatch(/baseUrl: imageBaseUrl,[\s\S]*resolveAiImageEditReadiness\('FULL_EDIT'/u);
    expect(block).toMatch(/resolveExtensionMediaTranslationReadiness/u);
  });

  it('binds standalone edit launch readiness to the active Provider Base', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('const getExtensionStandaloneReadiness');
    const end = source.indexOf('const extensionMediaWorkflowLauncher', start);
    const block = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain("getConfig('ai_image_base_url')");
    expect(block).toMatch(/resolveAiImageToImageReadiness\(\{[\s\S]*baseUrl,/u);
    expect(block).toMatch(/resolveAiImageEditReadiness\(operation, \{[\s\S]*baseUrl,/u);
  });
});
