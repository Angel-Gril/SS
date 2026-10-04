import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionHostedAiImagePlanRoutes } from '../routes/extension-hosted-ai-image-plan.js';
import { ExtensionHostedAiImagePlanError } from '../services/extension-hosted-ai-image-plan.js';

const context = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

function responseData() {
  return {
    replayed: false,
    data: {
      contractVersion: 'extension-hosted-ai-image-plan/v1',
      policyRevision: 1,
      context,
      plan: { id: 'plan-1', revision: 3, reviewStatus: 'PENDING' },
    },
  };
}

async function setup(input: {
  scopes?: string[];
  allowedShopIds?: string[];
  withDevice?: boolean;
} = {}) {
  const service = {
    create: vi.fn(async () => responseData()),
    get: vi.fn(async () => responseData()),
    getCurrent: vi.fn(async () => responseData()),
    review: vi.fn(async () => responseData()),
  };
  const app = Fastify();
  await app.register(extensionHostedAiImagePlanRoutes, {
    authenticateDevice: async (request: FastifyRequest) => {
      if (input.withDevice === false) return;
      (request as any).device = {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        sessionId: 'session-1',
        scopes: input.scopes ?? ['listing:review', 'media:execute'],
        allowedShopIds: input.allowedShopIds ?? ['shop-1'],
      };
    },
    service,
  });
  await app.ready();
  return { app, service };
}

describe('extension hosted AI image plan routes', () => {
  it('accepts a bounded creative brief while retaining server-derived identity', async () => {
    const fixture = await setup();
    const creativeBrief = { prompt: '浅灰背景，柔和侧光', negativePrompt: '不要道具' };
    try {
      const response = await fixture.app.inject({ method: 'POST', url: '/plans', payload: {
        contractVersion: 'extension-hosted-ai-image-plan-create/v1', context,
        idempotencyKey: 'client-brief-operation-1', creativeBrief,
      } });
      expect(response.statusCode).toBe(202);
      expect(fixture.service.create).toHaveBeenCalledWith(expect.objectContaining({ binding: context, creativeBrief,
        identity: { ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1' } }));
    } finally { await fixture.app.close(); }
  });

  it.each([null, { prompt: 'x'.repeat(301) }, { prompt: 'scene', verifiedFacts: ['fabricated'] },
    { prompt: 'https://private.example' }, { prompt: 'Authorization: Bearer hidden' }])(
    'rejects invalid creative brief %j at the HTTP boundary', async (creativeBrief) => {
      const fixture = await setup();
      try {
        const response = await fixture.app.inject({ method: 'POST', url: '/plans', payload: {
          contractVersion: 'extension-hosted-ai-image-plan-create/v1', context,
          idempotencyKey: 'client-brief-operation-1', creativeBrief,
        } });
        expect(response.statusCode).toBe(400);
        expect(fixture.service.create).not.toHaveBeenCalled();
      } finally { await fixture.app.close(); }
    },
  );

  it.each([[], ['scene']].map((value) => [value]))('accepts explicit gallery goals %j through the authenticated create contract', async (galleryGoals) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({
        method: 'POST', url: '/plans', payload: {
          contractVersion: 'extension-hosted-ai-image-plan-create/v1', context,
          idempotencyKey: 'client-gallery-operation-1', galleryGoals,
        },
      });
      expect(response.statusCode).toBe(202);
      expect(fixture.service.create).toHaveBeenCalledWith(expect.objectContaining({
        binding: context, galleryGoals,
        identity: { ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1' },
      }));
    } finally {
      await fixture.app.close();
    }
  });

  it.each([null, ['scene', 'scene'], ['hero'], ['SCENE'], 'scene', ['scene', 1]].map((value) => [value]))(
    'rejects invalid gallery goals %j at the HTTP boundary', async (galleryGoals) => {
      const fixture = await setup();
      try {
        const response = await fixture.app.inject({
          method: 'POST', url: '/plans', payload: {
            contractVersion: 'extension-hosted-ai-image-plan-create/v1', context,
            idempotencyKey: 'client-gallery-operation-1', galleryGoals,
          },
        });
        expect(response.statusCode).toBe(400);
        expect(fixture.service.create).not.toHaveBeenCalled();
      } finally {
        await fixture.app.close();
      }
    },
  );

  it('creates a plan with server-derived device identity and no-store semantics', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({
        method: 'POST',
        url: '/plans',
        payload: {
          contractVersion: 'extension-hosted-ai-image-plan-create/v1',
          context,
          idempotencyKey: 'client-create-operation-1',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({ code: 1, data: { context, plan: { id: 'plan-1' } } });
      expect(fixture.service.create).toHaveBeenCalledWith({
        identity: {
          ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'session-1',
        },
        binding: context,
        idempotencyKey: 'client-create-operation-1',
      });
    } finally {
      await fixture.app.close();
    }
  });

  it.each(['ownerUserId', 'provider', 'model', 'pricing', 'outputUrl'])(
    'rejects client-controlled %s before invoking the lifecycle service',
    async (field) => {
      const fixture = await setup();
      try {
        const response = await fixture.app.inject({
          method: 'POST',
          url: '/plans',
          payload: {
            contractVersion: 'extension-hosted-ai-image-plan-create/v1',
            context,
            idempotencyKey: 'client-create-operation-1',
            [field]: field === 'pricing' ? { maximumCostCents: 1 } : 'attacker-value',
          },
        });
        expect(response.statusCode).toBe(400);
        expect(fixture.service.create).not.toHaveBeenCalled();
      } finally {
        await fixture.app.close();
      }
    },
  );

  it('requires review plus execute scope for create and exact shop authority for every action', async () => {
    const noExecute = await setup({ scopes: ['listing:review'] });
    const noReview = await setup({ scopes: ['media:execute'] });
    const wrongShop = await setup({ allowedShopIds: [] });
    const payload = {
      contractVersion: 'extension-hosted-ai-image-plan-create/v1',
      context,
      idempotencyKey: 'client-create-operation-1',
    };
    try {
      const [executeResponse, reviewResponse, shopResponse] = await Promise.all([
        noExecute.app.inject({ method: 'POST', url: '/plans', payload }),
        noReview.app.inject({ method: 'POST', url: '/plans', payload }),
        wrongShop.app.inject({ method: 'POST', url: '/plans', payload }),
      ]);
      expect(executeResponse.statusCode).toBe(403);
      expect(reviewResponse.statusCode).toBe(403);
      expect(shopResponse.statusCode).toBe(403);
      expect(noExecute.service.create).not.toHaveBeenCalled();
      expect(noReview.service.create).not.toHaveBeenCalled();
      expect(wrongShop.service.create).not.toHaveBeenCalled();
    } finally {
      await Promise.all([noExecute.app.close(), noReview.app.close(), wrongShop.app.close()]);
    }
  });

  it('reads exact current/specific plans and reviews through separate strict contracts', async () => {
    const fixture = await setup();
    const query = new URLSearchParams(Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, String(value)]),
    )).toString();
    try {
      const current = await fixture.app.inject({ method: 'GET', url: `/plans/current?${query}` });
      const specific = await fixture.app.inject({ method: 'GET', url: `/plans/plan-1?${query}` });
      const review = await fixture.app.inject({
        method: 'POST',
        url: '/plans/plan-1/review',
        payload: {
          contractVersion: 'extension-hosted-ai-image-plan-review/v1',
          context,
          expectedRevision: 3,
          operationKey: 'client-review-operation-1',
          decision: 'APPROVE',
          note: null,
        },
      });

      expect(current.statusCode).toBe(200);
      expect(specific.statusCode).toBe(200);
      expect(review.statusCode).toBe(200);
      expect(fixture.service.getCurrent).toHaveBeenCalledWith(expect.objectContaining({
        identity: expect.objectContaining({ deviceSessionId: 'session-1' }), binding: context,
      }));
      expect(fixture.service.get).toHaveBeenCalledWith(expect.objectContaining({
        planId: 'plan-1', binding: context,
      }));
      expect(fixture.service.review).toHaveBeenCalledWith(expect.objectContaining({
        planId: 'plan-1', expectedRevision: 3, decision: 'APPROVE', note: null,
      }));
    } finally {
      await fixture.app.close();
    }
  });

  it('maps fail-closed lifecycle errors without leaking internals', async () => {
    const fixture = await setup();
    fixture.service.create.mockRejectedValueOnce(new ExtensionHostedAiImagePlanError(
      'HOSTED_AI_IMAGE_PLAN_POLICY_DISABLED',
      503,
      'internal policy detail',
    ));
    try {
      const response = await fixture.app.inject({
        method: 'POST',
        url: '/plans',
        payload: {
          contractVersion: 'extension-hosted-ai-image-plan-create/v1',
          context,
          idempotencyKey: 'client-create-operation-1',
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        code: 0,
        errorCode: 'hosted_ai_image_plan_policy_disabled',
        msg: 'ERP 托管生图计划暂不可用',
      });
      expect(response.body).not.toContain('internal policy detail');
    } finally {
      await fixture.app.close();
    }
  });
});
