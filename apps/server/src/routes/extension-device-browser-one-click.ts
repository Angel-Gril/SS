import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  createBrowserOneClickListingJobForActor,
  patchBrowserOneClickListingJobForActor,
  readBrowserOneClickListingJobForActor,
  type BrowserOneClickActor,
} from './listing.js';
import {
  getDefaultLegacySourceListingWorkflowAdapter,
  type LegacySourceListingWorkflowAdapter,
} from './source-listing-workflow-compat.js';
import {
  sourceWorkflowFeatureFlags,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import type { OzonPublisherEntrypointRolloutService } from '../services/ozon-publisher-entrypoint-rollout.js';
import type { createSourceCaptureService } from '../services/source-capture.js';

const jobParamsSchema = z.object({ id: z.string().trim().min(1).max(200) }).strict();
const watermarkReadSchema = z.object({
  shopId: z.string().trim().min(1).max(200).optional(),
}).strict();

interface DeviceContext {
  sessionId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

type DeviceScope = 'capture:write' | 'listing:publish';

export interface ExtensionDeviceBrowserOneClickRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  sourceListingWorkflowAdapter?: LegacySourceListingWorkflowAdapter;
  sourceCaptureService?: ReturnType<typeof createSourceCaptureService>;
  publisherRollout?: OzonPublisherEntrypointRolloutService;
}

function deviceContext(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScopes: DeviceScope[] | null = ['capture:write', 'listing:publish'],
): DeviceContext | null {
  const device = (request as FastifyRequest & {
    device?: Partial<DeviceContext>;
  }).device;
  if (!device
    || typeof device.sessionId !== 'string'
    || typeof device.ownerUserId !== 'string'
    || device.actorUserId !== device.ownerUserId
    || !Array.isArray(device.scopes)
    || device.scopes.some((scope) => typeof scope !== 'string')
    || !Array.isArray(device.allowedShopIds)
    || device.allowedShopIds.some((shopId) => typeof shopId !== 'string')) {
    reply.status(401).send({
      code: 0,
      errorCode: 'invalid_device_context',
      msg: '无效的设备令牌',
    });
    return null;
  }
  const missingScope = requiredScopes?.find((scope) => !device.scopes!.includes(scope));
  if (missingScope) {
    reply.status(403).send({
      code: 0,
      errorCode: 'insufficient_scope',
      missingScope,
      msg: missingScope === 'listing:publish'
        ? '设备缺少 Ozon 上架授权'
        : '设备缺少来源读取授权',
    });
    return null;
  }
  return device as DeviceContext;
}

function listingActor(device: DeviceContext): BrowserOneClickActor {
  return {
    ownerUserId: device.ownerUserId,
    actorUserId: device.actorUserId,
    role: 'USER',
    allowedShopIds: device.allowedShopIds,
    deviceSessionId: device.sessionId,
  };
}

export async function extensionDeviceBrowserOneClickRoutes(
  app: FastifyInstance,
  options: ExtensionDeviceBrowserOneClickRoutesOptions,
) {
  const handlers = {
    featureFlags: options.featureFlags || sourceWorkflowFeatureFlags,
    sourceListingWorkflowAdapter: options.sourceListingWorkflowAdapter
      || getDefaultLegacySourceListingWorkflowAdapter(),
    sourceCaptureService: options.sourceCaptureService,
    publisherRollout: options.publisherRollout,
  };

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post('/status/read', {
    bodyLimit: 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const device = deviceContext(request, reply, null);
    if (!device) return reply;
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        sessionId: device.sessionId,
        scopes: device.scopes,
        allowedShopIds: device.allowedShopIds,
      },
    });
  });

  app.post('/jobs', {
    bodyLimit: 1024 * 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const device = deviceContext(request, reply);
    if (!device) return reply;
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    if (!String(body.clientRequestId || '').trim()) {
      return reply.status(400).send({
        code: 0,
        errorCode: 'browser_one_click_idempotency_key_required',
        terminal: true,
        msg: '设备创建一键上架任务必须提供幂等请求键',
      });
    }
    return createBrowserOneClickListingJobForActor(
      request,
      reply,
      listingActor(device),
      handlers,
    );
  });

  app.post('/jobs/:id', {
    bodyLimit: 1024 * 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
    }
    const device = deviceContext(request, reply);
    if (!device) return reply;
    return patchBrowserOneClickListingJobForActor(
      request,
      reply,
      listingActor(device),
      handlers,
    );
  });

  app.post('/jobs/:id/read', {
    bodyLimit: 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
    }
    const device = deviceContext(request, reply);
    if (!device) return reply;
    return readBrowserOneClickListingJobForActor(
      request,
      reply,
      listingActor(device),
    );
  });

  app.post('/watermark-templates/read', {
    bodyLimit: 1024,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = watermarkReadSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
    }
    const device = deviceContext(request, reply, ['capture:write']);
    if (!device) return reply;
    const shopId = parsed.data.shopId;
    if (shopId && !device.allowedShopIds.includes(shopId)) {
      return reply.status(404).send({
        code: 0,
        errorCode: 'device_shop_not_found',
        msg: '店铺未授权给该设备',
      });
    }
    const where: Record<string, unknown> = { userId: device.ownerUserId };
    if (shopId) {
      const selectedShop = await prisma.shop.findFirst({
        where: { id: shopId, userId: device.ownerUserId },
        select: { name: true },
      });
      if (!selectedShop) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      const bindings: Array<{ shopId: string | null }> = [{ shopId }, { shopId: null }];
      const legacyShopName = String(selectedShop.name || '').trim();
      if (legacyShopName && legacyShopName !== shopId) bindings.push({ shopId: legacyShopName });
      where.OR = bindings;
    } else {
      const grantedShops = device.allowedShopIds.length > 0
        ? await prisma.shop.findMany({
          where: {
            id: { in: device.allowedShopIds },
            userId: device.ownerUserId,
          },
          select: { id: true, name: true },
        })
        : [];
      const grantedBindings = new Set<string>();
      for (const grantedShop of grantedShops) {
        grantedBindings.add(grantedShop.id);
        const legacyShopName = String(grantedShop.name || '').trim();
        if (legacyShopName) grantedBindings.add(legacyShopName);
      }
      where.OR = [
        { shopId: null },
        ...Array.from(grantedBindings, (grantedShopId) => ({ shopId: grantedShopId })),
      ];
    }
    const data = await prisma.watermarkTemplate.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data });
  });
}
