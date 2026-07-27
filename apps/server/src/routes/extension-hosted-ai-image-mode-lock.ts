import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ExtensionHostedAiImageModeLockError,
  type ExtensionHostedAiImageModeLockService,
} from '../services/extension-hosted-ai-image-mode-lock.js';

const identifier = z.string().min(1).max(200).refine((value) => value === value.trim());
const modeLockQuery = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.coerce.number().int().min(1),
  draftVersion: z.coerce.number().int().min(1),
}).strict();

interface HostedModeLockDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionHostedAiImageModeLockRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<ExtensionHostedAiImageModeLockService, 'get'>;
}

function deviceContext(request: FastifyRequest): HostedModeLockDevice | null {
  const candidate = (request as any).device as Partial<HostedModeLockDevice> | undefined;
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
  return candidate as HostedModeLockDevice;
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function modeLockError(reply: FastifyReply, error: ExtensionHostedAiImageModeLockError) {
  return routeError(
    reply,
    error.statusCode,
    error.code.toLowerCase(),
    error.code === 'HOSTED_AI_IMAGE_MODE_LOCK_INVALID_REQUEST'
      ? '参数错误'
      : error.code === 'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN'
        ? '设备无权读取该托管生图状态'
        : error.code === 'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_NOT_FOUND'
          ? '托管生图上下文不存在'
          : error.code === 'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_STALE'
            ? '商品草稿或来源素材已变化，请刷新后重试'
            : 'ERP 托管执行方式状态暂不可用',
  );
}

export async function extensionHostedAiImageModeLockRoutes(
  app: FastifyInstance,
  options: ExtensionHostedAiImageModeLockRoutesOptions,
) {
  app.get('/hosted-mode-lock', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = modeLockQuery.safeParse(request.query);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    if (!device.scopes.includes('listing:review')) {
      return routeError(reply, 403, 'command_scope_denied', '设备缺少商品审核权限');
    }
    if (!device.allowedShopIds.includes(parsed.data.shopId)) {
      return routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    try {
      const data = await options.service.get({
        identity: {
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          deviceSessionId: device.sessionId,
        },
        binding: parsed.data,
      });
      reply.header('Cache-Control', 'no-store');
      return reply.send({ code: 1, data });
    } catch (error) {
      if (error instanceof ExtensionHostedAiImageModeLockError) {
        return modeLockError(reply, error);
      }
      request.log.error({ err: error }, 'extension hosted AI image mode lock lookup failed');
      return routeError(
        reply,
        503,
        'hosted_ai_image_mode_lock_unavailable',
        'ERP 托管执行方式状态暂不可用',
      );
    }
  });
}
