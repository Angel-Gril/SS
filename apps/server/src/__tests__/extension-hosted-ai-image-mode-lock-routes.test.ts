import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionHostedAiImageModeLockRoutes } from '../routes/extension-hosted-ai-image-mode-lock.js';
import { ExtensionHostedAiImageModeLockError } from '../services/extension-hosted-ai-image-mode-lock.js';

const context = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

function query(extra: Record<string, string> = {}) {
  return new URLSearchParams({
    ...Object.fromEntries(Object.entries(context).map(([key, value]) => [key, String(value)])),
    ...extra,
  }).toString();
}

async function setup(input: {
  scopes?: string[];
  allowedShopIds?: string[];
  withDevice?: boolean;
} = {}) {
  const service = {
    get: vi.fn(async () => ({
      contractVersion: 'extension-hosted-ai-image-mode-lock/v1' as const,
      context,
      state: 'NO_SUITE' as const,
      hostedExecutionEnabled: false,
    })),
  };
  const app = Fastify();
  await app.register(extensionHostedAiImageModeLockRoutes, {
    authenticateDevice: async (request: FastifyRequest) => {
      if (input.withDevice === false) return;
      (request as any).device = {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        sessionId: 'device-session-1',
        scopes: input.scopes ?? ['listing:review'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1'],
      };
    },
    service,
  });
  await app.ready();
  return { app, service };
}

describe('extension hosted AI image mode lock routes', () => {
  it('returns a no-store read-only status from server-derived device identity', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: `/hosted-mode-lock?${query()}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 1,
        data: {
          contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
          context,
          state: 'NO_SUITE',
          hostedExecutionEnabled: false,
        },
      });
      expect(fixture.service.get).toHaveBeenCalledWith({
        identity: {
          ownerUserId: 'owner-1',
          actorUserId: 'owner-1',
          deviceSessionId: 'device-session-1',
        },
        binding: context,
      });
    } finally {
      await fixture.app.close();
    }
  });

  it('requires review scope and exact shop authority but not media execute scope', async () => {
    const allowed = await setup({ scopes: ['listing:review'] });
    const noReview = await setup({ scopes: ['media:execute'] });
    const wrongShop = await setup({ allowedShopIds: [] });
    try {
      const [allowedResponse, scopeResponse, shopResponse] = await Promise.all([
        allowed.app.inject({ method: 'GET', url: `/hosted-mode-lock?${query()}` }),
        noReview.app.inject({ method: 'GET', url: `/hosted-mode-lock?${query()}` }),
        wrongShop.app.inject({ method: 'GET', url: `/hosted-mode-lock?${query()}` }),
      ]);
      expect(allowedResponse.statusCode).toBe(200);
      expect(scopeResponse.statusCode).toBe(403);
      expect(shopResponse.statusCode).toBe(403);
      expect(noReview.service.get).not.toHaveBeenCalled();
      expect(wrongShop.service.get).not.toHaveBeenCalled();
    } finally {
      await Promise.all([allowed.app.close(), noReview.app.close(), wrongShop.app.close()]);
    }
  });

  it('rejects missing device context and extra query fields before service execution', async () => {
    const noDevice = await setup({ withDevice: false });
    const extraField = await setup();
    try {
      const [deviceResponse, queryResponse] = await Promise.all([
        noDevice.app.inject({ method: 'GET', url: `/hosted-mode-lock?${query()}` }),
        extraField.app.inject({
          method: 'GET',
          url: `/hosted-mode-lock?${query({ provider: 'attacker' })}`,
        }),
      ]);
      expect(deviceResponse.statusCode).toBe(401);
      expect(queryResponse.statusCode).toBe(400);
      expect(noDevice.service.get).not.toHaveBeenCalled();
      expect(extraField.service.get).not.toHaveBeenCalled();
    } finally {
      await Promise.all([noDevice.app.close(), extraField.app.close()]);
    }
  });

  it('maps unavailable state without exposing internal details', async () => {
    const fixture = await setup();
    fixture.service.get.mockRejectedValueOnce(new ExtensionHostedAiImageModeLockError(
      'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
      503,
      'database connection secret',
    ));
    try {
      const response = await fixture.app.inject({
        method: 'GET',
        url: `/hosted-mode-lock?${query()}`,
      });

      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({
        code: 0,
        errorCode: 'hosted_ai_image_mode_lock_unavailable',
        msg: 'ERP 托管执行方式状态暂不可用',
      });
      expect(response.body).not.toContain('database connection secret');
    } finally {
      await fixture.app.close();
    }
  });
});
