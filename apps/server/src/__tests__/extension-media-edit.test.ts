import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionMediaEditRoutes } from '../routes/extension-media-edit.js';
import { resolveAiImageEditReadiness, resolveAiImageToImageReadiness } from '../routes/ai-images.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import { resolveExtensionMediaStandaloneReadiness } from '../services/extension-media-workflow-launch.js';

function enabledDecision() {
  return {
    enabled: true,
    legacyAllowed: false,
    captureStage: null,
    reason: 'pilot_match',
    revision: 'pilot-1',
  } as any;
}

const basePayload = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  revision: 11,
  draftVersion: 7,
  sourceMediaKey: 'media-main-1',
};

const wanxSettings = {
  generationEnabled: true,
  imageToImageEnabled: false,
  fullEditEnabled: true,
  inpaintEnabled: true,
  provider: 'dashscope-wanx',
  model: 'wanx2.1-imageedit',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  costPerImageCents: 14,
  globalDailyBudgetCents: 100,
};

function normalWanxReadiness(settings: Partial<typeof wanxSettings> = {}) {
  return resolveExtensionMediaStandaloneReadiness('INPAINT', { ...wanxSettings, ...settings }, {
    production: true,
    storageReadiness: { ready: true, backend: 'local', reason: 'owned test storage' },
    resolveImageToImageReadiness: resolveAiImageToImageReadiness,
    resolveAiImageEditReadiness,
  });
}

async function setup(input: {
  enabled?: boolean;
  aiMediaEnabled?: boolean;
  scopes?: string[];
  allowedShopIds?: string[];
  rateAllowed?: boolean;
  production?: boolean;
  readiness?: ReturnType<typeof normalWanxReadiness>;
  sourceMediaKeys?: string[];
  sourceAsset?: Partial<{
    id: string;
    url: string;
    mimeType: string;
    width: number;
    height: number;
  }>;
} = {}) {
  const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
    (request as any).device = {
      ownerUserId: 'owner-1', actorUserId: 'owner-1', sessionId: 'session-1',
      scopes: input.scopes || ['listing:review', 'media:execute'],
      allowedShopIds: input.allowedShopIds || ['shop-1'],
    };
  });
  const loadContext = vi.fn(async () => ({
    id: 'listing-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'goods-1', snapshotId: 'snapshot-1', revision: 11, draftVersion: 7,
    sourceMediaKeys: input.sourceMediaKeys || ['media-main-1', 'media-detail-1'],
  }));
  const internalizeSource = vi.fn(async () => ({
    id: 'source-asset-1',
    url: 'https://cdn.example.test/source-asset-1.png',
    mimeType: 'image/png', width: 1024, height: 1024,
    ...input.sourceAsset,
  }));
  const createMask = vi.fn(async () => ({
    replayed: false,
    asset: {
      id: 'mask-asset-1', url: 'https://cdn.example.test/mask-asset-1.png',
      mimeType: 'image/png', width: 1024, height: 1024,
    },
    diagnostics: {
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      editPixelCount: 100,
      preservedPixelCount: 900,
      featheredPixelCount: 25,
    },
  }));
  const checkMaskRequestRate = vi.fn(async () => input.rateAllowed === false
    ? { allowed: false as const, reason: 'too many mask uploads' }
    : { allowed: true as const });
  const evaluate = vi.fn(async () => input.enabled === false
    ? { ...enabledDecision(), enabled: false, reason: 'master_off' }
    : enabledDecision());
  const getMediaWorkflowDecision = vi.fn(async () => ({
    enabled: input.aiMediaEnabled ?? input.enabled !== false,
    reason: input.aiMediaEnabled === false ? 'tenant_not_allowed' : 'tenant_allowed',
    revision: 7,
  }));
  const getReadiness = vi.fn(async () => input.readiness ?? ({
    enabled: input.enabled !== false,
    ready: input.enabled !== false,
    reasonCode: input.enabled === false ? 'AI_MEDIA_OPERATION_DISABLED' : 'READY',
    reason: input.enabled === false ? 'disabled' : 'ready',
    testOnly: true,
  }));
  const app = Fastify();
  await app.register(extensionMediaEditRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice,
    featureFlags: {
      evaluate,
    } as any,
    getMediaWorkflowDecision,
    getReadiness,
    loadContext,
    internalizeSource,
    checkMaskRequestRate,
    createMask,
    production: input.production ?? false,
  });
  await app.ready();
  return {
    app, authenticateDevice, loadContext, internalizeSource,
    checkMaskRequestRate, createMask, evaluate, getMediaWorkflowDecision, getReadiness,
  };
}

describe('extension media edit routes', () => {
  it('freezes the validated draft target into source and mask requests', async () => {
    const state = await setup();
    const target = { skuKey: null, slotKey: 'product-main' };
    state.loadContext.mockResolvedValue({ ...(await state.loadContext()), target } as any);
    try {
      const source = await state.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/media-edit-source',
        payload: { ...basePayload, target } });
      expect(source.statusCode).toBe(200);
      const mask = await state.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: { ...basePayload, target, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } });
      expect(mask.statusCode).toBe(201);
      expect(state.loadContext).toHaveBeenLastCalledWith(expect.objectContaining({ target }));
      expect(state.internalizeSource).toHaveBeenLastCalledWith(expect.objectContaining({ target }));
      expect(state.createMask).toHaveBeenCalledWith(expect.objectContaining({
        contextSkuKey: null, contextSlotKey: 'product-main',
      }));
    } finally { await state.app.close(); }
  });
  it('rejects a target not confirmed by current draft authority before creating the mask', async () => {
    const state = await setup();
    try {
      const result = await state.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/media-edit-source',
        payload: { ...basePayload, target: { skuKey: null, slotKey: 'product-main' } } });
      expect(result.statusCode).toBe(409);
      expect(state.internalizeSource).not.toHaveBeenCalled();
    } finally { await state.app.close(); }
  });
  it('prepares one exact server-owned edit source for the extension mask editor', async () => {
    const state = await setup();
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          contractVersion: 'extension-media-edit-source/v1',
          sourceMediaKey: 'media-main-1',
          sourceAsset: {
            id: 'source-asset-1', url: 'https://cdn.example.test/source-asset-1.png',
            mimeType: 'image/png', width: 1024, height: 1024,
          },
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maxMaskBytes: 20 * 1024 * 1024,
        },
      });
      expect(state.internalizeSource).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
        sourceMediaKey: 'media-main-1', revision: 11, draftVersion: 7, role: 'EDIT',
      });
    } finally {
      await state.app.close();
    }
  });

  it('uploads one mask without accepting a client-supplied source asset id', async () => {
    const state = await setup();
    const mask = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24, 1),
    ]);
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: {
          ...basePayload,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: `data:image/png;base64,${mask.toString('base64')}`,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        code: 1,
        replayed: false,
        data: {
          contractVersion: 'extension-media-edit-mask/v1',
          sourceMediaKey: 'media-main-1',
          sourceAssetId: 'source-asset-1',
          maskAssetId: 'mask-asset-1',
          url: 'https://cdn.example.test/mask-asset-1.png',
          mimeType: 'image/png', width: 1024, height: 1024,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          editPixelCount: 100, preservedPixelCount: 900, featheredPixelCount: 25,
        },
      });
      expect(state.createMask).toHaveBeenCalledWith(expect.objectContaining({
        ownerUserId: 'owner-1', actorUserId: 'owner-1',
        contextType: 'listing-draft', contextId: 'listing-1',
        contextDraftRevision: 11, contextDraftVersion: 7,
        sourceAssetId: 'source-asset-1', maskBuffer: mask,
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      }));
    } finally {
      await state.app.close();
    }
  });

  it('rejects a client-supplied source asset id before context or storage access', async () => {
    const state = await setup();
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: {
          ...basePayload,
          sourceAssetId: 'attacker-selected-asset',
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      });
      expect(response.statusCode).toBe(400);
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('rejects a decoded mask above 20 MiB after the cheap authority check and before storage access', async () => {
    const state = await setup();
    const oversizedMask = Buffer.alloc(20 * 1024 * 1024 + 1, 1);
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: {
          ...basePayload,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: `data:image/png;base64,${oversizedMask.toString('base64')}`,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(state.loadContext).toHaveBeenCalledTimes(1);
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('rejects stale authority before decoding a malformed mask', async () => {
    const state = await setup({ sourceMediaKeys: ['other-media'] });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: {
          ...basePayload,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: `data:image/png;base64,${'!'.repeat(32)}`,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'media_edit_context_stale' });
      expect(state.loadContext).toHaveBeenCalledTimes(1);
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('fails dark, unauthorized, and rate-limited requests before storage writes', async () => {
    const states = [
      await setup({ enabled: false }),
      await setup({ scopes: ['listing:review'] }),
      await setup({ rateAllowed: false }),
    ];
    try {
      const dark = await states[0]!.app.inject({
        method: 'POST', url: '/api/extension-device/source-workbench/media-edit-source', payload: basePayload,
      });
      expect(dark.statusCode).toBe(503);
      const unauthorized = await states[1]!.app.inject({
        method: 'POST', url: '/api/extension-device/source-workbench/media-edit-source', payload: basePayload,
      });
      expect(unauthorized.statusCode).toBe(403);
      const limited = await states[2]!.app.inject({
        method: 'POST', url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: { ...basePayload, maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS, maskDataUrl: 'not parsed' },
      });
      expect(limited.statusCode).toBe(429);
      expect(states[2]!.checkMaskRequestRate).toHaveBeenCalledWith('owner-1');
      for (const state of states) {
        expect(state.createMask).not.toHaveBeenCalled();
      }
    } finally {
      await Promise.all(states.map((state) => state.app.close()));
    }
  });

  it('rejects editing when the canonical AI tenant policy denies the owner', async () => {
    const state = await setup({ aiMediaEnabled: false });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ errorCode: 'media_edit_disabled' });
      expect(state.getMediaWorkflowDecision).toHaveBeenCalledWith('owner-1');
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('admits a production edit source through the normal Wanx INPAINT readiness owner', async () => {
    const readiness = normalWanxReadiness();
    expect(readiness).toMatchObject({ enabled: true, ready: true, testOnly: false });
    const state = await setup({ production: true, readiness });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.sourceAsset.id).toBe('source-asset-1');
      expect(state.getReadiness).toHaveBeenCalledTimes(1);
      expect(state.getMediaWorkflowDecision).toHaveBeenCalledWith('owner-1');
      expect(state.evaluate).toHaveBeenCalledWith('SOURCE_LISTING_EXTENSION_WORKBENCH', {
        ownerUserId: 'owner-1', shopId: 'shop-1', deviceSessionId: 'session-1',
      });
      expect(state.internalizeSource).toHaveBeenCalledWith({
        ownerUserId: 'owner-1', listingWorkflowId: 'listing-1',
        sourceMediaKey: 'media-main-1', revision: 11, draftVersion: 7, role: 'EDIT',
      });
    } finally {
      await state.app.close();
    }
  });

  it('admits production masks while preserving owner replay status and source binding', async () => {
    const state = await setup({ production: true, readiness: normalWanxReadiness() });
    const mask = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24, 1),
    ]);
    try {
      for (const replayed of [false, true]) {
        if (replayed) {
          const previous = await state.createMask.mock.results[0]!.value;
          state.createMask.mockResolvedValueOnce({ ...previous, replayed: true });
        }
        const response = await state.app.inject({
          method: 'POST',
          url: '/api/extension-device/source-workbench/media-edit-mask',
          payload: {
            ...basePayload,
            maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
            maskDataUrl: `data:image/png;base64,${mask.toString('base64')}`,
          },
        });
        expect(response.statusCode).toBe(replayed ? 200 : 201);
        expect(response.json()).toMatchObject({
          code: 1, replayed,
          data: { sourceAssetId: 'source-asset-1', maskAssetId: 'mask-asset-1' },
        });
      }
      expect(state.getReadiness).toHaveBeenCalledTimes(2);
      expect(state.checkMaskRequestRate).toHaveBeenCalledTimes(2);
      expect(state.createMask).toHaveBeenLastCalledWith(expect.objectContaining({
        ownerUserId: 'owner-1', actorUserId: 'owner-1',
        contextId: 'listing-1', contextDraftRevision: 11, contextDraftVersion: 7,
        sourceAssetId: 'source-asset-1', maskBuffer: mask,
      }));
    } finally {
      await state.app.close();
    }
  });

  it.each([
    ['unknown Provider', { provider: 'unknown' }],
    ['unknown model', { model: 'unknown' }],
    ['text-only model', { model: 'wanx2.1-t2i-turbo' }],
    ['unregistered endpoint', { baseUrl: 'https://unregistered.example.test/api/v1' }],
    ['test-only capability', { testOnly: true }],
    ['missing price', { costPerImageCents: 0 }],
    ['missing daily budget', { globalDailyBudgetCents: 0 }],
  ])('rejects a ready claim with %s in production before parsing or storage', async (_name, change) => {
    const state = await setup({ production: true, readiness: { ...normalWanxReadiness(), ...change } });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: { invalid: true },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 0, errorCode: 'media_edit_provider_not_ready' });
      expect(state.getReadiness).toHaveBeenCalledTimes(1);
      expect(state.checkMaskRequestRate).not.toHaveBeenCalled();
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('requires INPAINT readiness even when the same Provider allows full-image editing', async () => {
    const settings = { ...wanxSettings, inpaintEnabled: false };
    expect(resolveAiImageEditReadiness('FULL_EDIT', {
      ...settings, estimatedCostCents: settings.costPerImageCents,
    }, { production: true })).toMatchObject({ ready: true });
    const state = await setup({ production: true, readiness: normalWanxReadiness(settings) });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ errorCode: 'AI_MEDIA_OPERATION_DISABLED' });
      expect(state.internalizeSource).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('fails closed for test-only readiness in production before rate or storage work', async () => {
    const state = await setup({ production: true });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'media_edit_provider_not_ready',
      });
      expect(state.evaluate).not.toHaveBeenCalled();
      expect(state.getReadiness).toHaveBeenCalledTimes(1);
      expect(state.checkMaskRequestRate).not.toHaveBeenCalled();
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('applies the production gate before malformed or oversized mask body processing', async () => {
    const state = await setup({ production: true });
    const oversizedBody = JSON.stringify({
      ...basePayload,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      maskDataUrl: 'x'.repeat(30 * 1024 * 1024 + 1),
    });
    try {
      for (const payload of [{ invalid: true }, oversizedBody]) {
        const response = await state.app.inject({
          method: 'POST',
          url: '/api/extension-device/source-workbench/media-edit-mask',
          ...(typeof payload === 'string'
            ? { payload, headers: { 'content-type': 'application/json' } }
            : { payload }),
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          code: 0,
          errorCode: 'media_edit_provider_not_ready',
        });
      }
      expect(state.authenticateDevice).toHaveBeenCalledTimes(2);
      expect(state.evaluate).not.toHaveBeenCalled();
      expect(state.getReadiness).toHaveBeenCalledTimes(2);
      expect(state.checkMaskRequestRate).not.toHaveBeenCalled();
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('retains mask body limits after the production Provider is admitted', async () => {
    const state = await setup({ production: true, readiness: normalWanxReadiness() });
    try {
      const malformed = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: { invalid: true },
      });
      expect(malformed.statusCode).toBe(400);
      const oversized = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ maskDataUrl: 'x'.repeat(30 * 1024 * 1024 + 1) }),
      });
      expect(oversized.statusCode).toBe(413);
      expect(state.loadContext).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it.each([
    { label: 'scope', options: { scopes: ['listing:review'] }, status: 403, code: 'command_scope_denied' },
    { label: 'shop', options: { allowedShopIds: ['other-shop'] }, status: 403, code: 'command_shop_denied' },
    { label: 'tenant', options: { aiMediaEnabled: false }, status: 503, code: 'media_edit_disabled' },
    { label: 'feature flags', options: { enabled: false }, status: 503, code: 'media_edit_disabled' },
    { label: 'rate', options: { rateAllowed: false }, status: 429, code: 'media_edit_rate_limited' },
    { label: 'source membership', options: { sourceMediaKeys: ['other-media'] }, status: 409, code: 'media_edit_context_stale' },
  ])('retains the $label boundary after production Provider admission', async ({ options, status, code }) => {
    const state = await setup({ ...options, production: true, readiness: normalWanxReadiness() });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-mask',
        payload: {
          ...basePayload,
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maskDataUrl: `data:image/png;base64,${Buffer.alloc(32, 1).toString('base64')}`,
        },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ errorCode: code });
      expect(state.internalizeSource).not.toHaveBeenCalled();
      expect(state.createMask).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('rejects a substituted device actor before reading Provider settings', async () => {
    const state = await setup({ production: true, readiness: normalWanxReadiness() });
    state.authenticateDevice.mockImplementationOnce(async (request) => {
      (request as any).device = {
        ownerUserId: 'owner-1', actorUserId: 'another-owner', sessionId: 'session-1',
        scopes: ['media:execute'], allowedShopIds: ['shop-1'],
      };
    });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: basePayload,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ errorCode: 'invalid_device_context' });
      expect(state.getReadiness).not.toHaveBeenCalled();
      expect(state.internalizeSource).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it('accepts a source media key at the shared 500-character contract limit', async () => {
    const sourceMediaKey = 'm'.repeat(500);
    const state = await setup({ sourceMediaKeys: [sourceMediaKey] });
    try {
      const response = await state.app.inject({
        method: 'POST',
        url: '/api/extension-device/source-workbench/media-edit-source',
        payload: { ...basePayload, sourceMediaKey },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.sourceMediaKey).toBe(sourceMediaKey);
    } finally {
      await state.app.close();
    }
  });

  it('rejects prepared sources outside the shared edit safety envelope', async () => {
    const overlongUrl = `https://cdn.example.test/${'x'.repeat(4096)}`;
    const states = [
      await setup({ sourceAsset: { width: 16_385, height: 1 } }),
      await setup({ sourceAsset: { width: 4_000, height: 3_001 } }),
      await setup({ sourceAsset: { width: 21, height: 1 } }),
      await setup({ sourceAsset: { url: overlongUrl } }),
    ];
    try {
      for (const state of states) {
        const response = await state.app.inject({
          method: 'POST',
          url: '/api/extension-device/source-workbench/media-edit-source',
          payload: basePayload,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          code: 0,
          errorCode: 'media_edit_source_invalid',
        });
      }
    } finally {
      await Promise.all(states.map((state) => state.app.close()));
    }
  });
});
