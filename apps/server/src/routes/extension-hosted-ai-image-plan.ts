import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AI_MEDIA_GALLERY_GOALS } from '../services/ai-media-planning.js';
import {
  ExtensionHostedAiImagePlanError,
  type ExtensionHostedAiImagePlanService,
} from '../services/extension-hosted-ai-image-plan.js';

export const EXTENSION_HOSTED_AI_IMAGE_PLAN_CREATE_VERSION =
  'extension-hosted-ai-image-plan-create/v1' as const;
export const EXTENSION_HOSTED_AI_IMAGE_PLAN_REVIEW_VERSION =
  'extension-hosted-ai-image-plan-review/v1' as const;

const identifier = z.string().min(1).max(200).refine((value) => value === value.trim());
const operationKey = z.string().min(8).max(128).refine((value) => value === value.trim());
const binding = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
}).strict();
const bindingQuery = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.coerce.number().int().min(1),
  draftVersion: z.coerce.number().int().min(1),
}).strict();
const createBody = z.object({
  contractVersion: z.literal(EXTENSION_HOSTED_AI_IMAGE_PLAN_CREATE_VERSION),
  context: binding,
  idempotencyKey: operationKey,
  galleryGoals: z.array(z.enum(AI_MEDIA_GALLERY_GOALS)).min(1).max(AI_MEDIA_GALLERY_GOALS.length)
    .refine((goals) => new Set(goals).size === goals.length).optional(),
}).strict();
const planParams = z.object({ planId: identifier }).strict();
const reviewBody = z.object({
  contractVersion: z.literal(EXTENSION_HOSTED_AI_IMAGE_PLAN_REVIEW_VERSION),
  context: binding,
  expectedRevision: z.number().int().min(1),
  operationKey,
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(2_000).nullable(),
}).strict();

interface HostedPlanDevice {
  ownerUserId: string;
  actorUserId: string;
  sessionId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionHostedAiImagePlanRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: {
    create(
      input: Parameters<ExtensionHostedAiImagePlanService['create']>[0],
    ): Promise<{ replayed: boolean; data: unknown }>;
    get(
      input: Parameters<ExtensionHostedAiImagePlanService['get']>[0],
    ): Promise<{ replayed: boolean; data: unknown }>;
    getCurrent(
      input: Parameters<ExtensionHostedAiImagePlanService['getCurrent']>[0],
    ): Promise<{ replayed: boolean; data: unknown }>;
    review(
      input: Parameters<ExtensionHostedAiImagePlanService['review']>[0],
    ): Promise<{ replayed: boolean; data: unknown }>;
  };
}

function deviceContext(request: FastifyRequest): HostedPlanDevice | null {
  const candidate = (request as any).device as Partial<HostedPlanDevice> | undefined;
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
  return candidate as HostedPlanDevice;
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function lifecycleError(reply: FastifyReply, error: ExtensionHostedAiImagePlanError) {
  return routeError(
    reply,
    error.statusCode,
    error.code.toLowerCase(),
    error.code === 'HOSTED_AI_IMAGE_PLAN_FORBIDDEN'
      ? '设备无权访问该托管生图计划'
      : error.code === 'HOSTED_AI_IMAGE_PLAN_REQUEST_CONFLICT'
        ? '该草稿已创建不同目标的计划，请刷新查看现有计划'
      : error.code === 'HOSTED_AI_IMAGE_PLAN_CONTEXT_STALE'
        || error.code === 'HOSTED_AI_IMAGE_PLAN_SKU_AMBIGUOUS'
        ? '商品草稿或来源素材已变化，请刷新后重试'
        : error.code === 'HOSTED_AI_IMAGE_PLAN_NOT_FOUND'
          ? 'ERP 托管生图计划不存在'
          : error.code === 'HOSTED_AI_IMAGE_PLAN_INVALID_REQUEST'
            ? '参数错误'
            : 'ERP 托管生图计划暂不可用',
  );
}

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  shopId: string,
  requireExecute: boolean,
) {
  const device = deviceContext(request);
  if (!device) {
    routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    return null;
  }
  if (!device.scopes.includes('listing:review')
    || (requireExecute && !device.scopes.includes('media:execute'))) {
    routeError(reply, 403, 'command_scope_denied', '设备缺少托管生图权限');
    return null;
  }
  if (!device.allowedShopIds.includes(shopId)) {
    routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    return null;
  }
  return {
    ownerUserId: device.ownerUserId,
    actorUserId: device.actorUserId,
    deviceSessionId: device.sessionId,
  };
}

function success(reply: FastifyReply, statusCode: number, result: {
  replayed: boolean;
  data: unknown;
}) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(statusCode).send({ code: 1, replayed: result.replayed, data: result.data });
}

async function run(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<{ replayed: boolean; data: unknown }>,
  statusCode: number,
) {
  try {
    return success(reply, statusCode, await operation());
  } catch (error) {
    if (error instanceof ExtensionHostedAiImagePlanError) return lifecycleError(reply, error);
    request.log.error({ err: error }, 'extension hosted AI image plan operation failed');
    return routeError(
      reply,
      503,
      'hosted_ai_image_plan_unavailable',
      'ERP 托管生图计划暂不可用',
    );
  }
}

export async function extensionHostedAiImagePlanRoutes(
  app: FastifyInstance,
  options: ExtensionHostedAiImagePlanRoutesOptions,
) {
  app.post('/plans', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const identity = authorize(request, reply, parsed.data.context.shopId, true);
    if (!identity) return reply;
    return run(request, reply, () => options.service.create({
      identity,
      binding: parsed.data.context,
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.galleryGoals === undefined ? {} : { galleryGoals: parsed.data.galleryGoals }),
    }), 202);
  });

  app.get('/plans/current', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = bindingQuery.safeParse(request.query);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const identity = authorize(request, reply, parsed.data.shopId, false);
    if (!identity) return reply;
    return run(request, reply, () => options.service.getCurrent({
      identity,
      binding: parsed.data,
    }), 200);
  });

  app.get('/plans/:planId', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsedParams = planParams.safeParse(request.params);
    const parsedQuery = bindingQuery.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      return routeError(reply, 400, 'invalid_request', '参数错误');
    }
    const identity = authorize(request, reply, parsedQuery.data.shopId, false);
    if (!identity) return reply;
    return run(request, reply, () => options.service.get({
      identity,
      binding: parsedQuery.data,
      planId: parsedParams.data.planId,
    }), 200);
  });

  app.post('/plans/:planId/review', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const parsedParams = planParams.safeParse(request.params);
    const parsedBody = reviewBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) {
      return routeError(reply, 400, 'invalid_request', '参数错误');
    }
    const identity = authorize(request, reply, parsedBody.data.context.shopId, false);
    if (!identity) return reply;
    return run(request, reply, () => options.service.review({
      identity,
      binding: parsedBody.data.context,
      planId: parsedParams.data.planId,
      expectedRevision: parsedBody.data.expectedRevision,
      operationKey: parsedBody.data.operationKey,
      decision: parsedBody.data.decision,
      note: parsedBody.data.note,
    }), 200);
  });
}
