import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ExtensionAiImageSuiteProjectionError,
  projectExtensionAiImageSuite,
  type ExtensionAiImageSuiteProjectionState,
} from '../services/extension-ai-image-suite-projection.js';

interface ExtensionAiImageSuiteDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

const identifier = z.string().min(1).max(200).refine((value) => value === value.trim());
const projectionQuery = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.coerce.number().int().min(1),
  draftVersion: z.coerce.number().int().min(1),
}).strict();

export interface ExtensionAiImageSuiteRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  loadState(input: {
    ownerUserId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
  }): Promise<ExtensionAiImageSuiteProjectionState | null>;
  loadTrustedPreviewOrigins(input: {
    ownerUserId: string;
    shopId: string;
  }): Promise<string[]>;
  allowInsecureLocalPreview?: boolean;
}

function deviceContext(request: FastifyRequest): ExtensionAiImageSuiteDevice | null {
  const candidate = (request as any).device as Partial<ExtensionAiImageSuiteDevice> | undefined;
  if (!candidate
    || typeof candidate.ownerUserId !== 'string'
    || !candidate.ownerUserId
    || candidate.actorUserId !== candidate.ownerUserId
    || typeof candidate.sessionId !== 'string'
    || !candidate.sessionId
    || !Array.isArray(candidate.scopes)
    || !candidate.scopes.every((scope) => typeof scope === 'string')
    || !Array.isArray(candidate.allowedShopIds)
    || !candidate.allowedShopIds.every((shopId) => typeof shopId === 'string')) return null;
  return candidate as ExtensionAiImageSuiteDevice;
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

export async function extensionAiImageSuiteRoutes(
  app: FastifyInstance,
  options: ExtensionAiImageSuiteRoutesOptions,
) {
  app.get('/ai-image-suite', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = projectionQuery.safeParse(request.query);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    if (!device.scopes.includes('listing:review')) {
      return routeError(reply, 403, 'command_scope_denied', '设备缺少商品审核权限');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    reply.header('Cache-Control', 'no-store');
    const loaderInput = {
      ownerUserId: device.ownerUserId,
      ...parsed.data,
    };
    try {
      const [state, trustedPreviewOrigins] = await Promise.all([
        options.loadState(loaderInput),
        options.loadTrustedPreviewOrigins({
          ownerUserId: device.ownerUserId,
          shopId: parsed.data.shopId,
        }),
      ]);
      if (!state) {
        return routeError(reply, 404, 'ai_image_suite_context_not_found', 'AI 生图上下文不存在');
      }
      const data = projectExtensionAiImageSuite({
        requested: parsed.data,
        state,
        ownerUserId: device.ownerUserId,
        scopes: device.scopes,
        trustedPreviewOrigins,
        allowInsecureLocalPreview: options.allowInsecureLocalPreview,
      });
      return reply.send({ code: 1, data });
    } catch (error) {
      if (error instanceof ExtensionAiImageSuiteProjectionError) {
        return routeError(
          reply,
          error.statusCode,
          error.code === 'STALE_CONTEXT' ? 'ai_image_suite_context_stale' : 'invalid_request',
          error.message,
        );
      }
      request.log.error({ err: error }, 'extension AI image suite projection failed');
      return routeError(reply, 503, 'ai_image_suite_projection_unavailable', 'AI 生图状态暂不可用');
    }
  });
}
