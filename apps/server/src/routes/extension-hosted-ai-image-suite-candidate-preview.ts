import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ExtensionHostedCandidatePreviewError,
  type ExtensionHostedCandidatePreviewDevice,
  type ExtensionHostedCandidatePreviewService,
} from '../services/extension-hosted-ai-image-suite-candidate-preview.js';

const identifier = z.string().min(1).max(200).refine((value) => (
  value === value.trim() && value === value.normalize('NFKC')
));
const bindingSchema = z.object({
  snapshotId: identifier,
  supplyGoodsId: identifier,
  shopId: identifier,
  listingWorkflowId: identifier,
  draftRevision: z.number().int().min(1),
  draftVersion: z.number().int().min(1),
  planId: identifier,
  planVersionId: identifier,
  planRevision: z.number().int().min(1),
  suiteId: identifier,
  suiteRevision: z.number().int().min(1),
  slotId: identifier,
  slotRevision: z.number().int().min(1),
  workflowId: identifier,
  workflowRevision: z.number().int().min(1),
  outputAssetId: identifier,
}).strict();
const issueSchema = z.object({ binding: bindingSchema }).strict();
const consumeSchema = z.object({
  binding: bindingSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();

interface PreviewRouteDevice extends ExtensionHostedCandidatePreviewDevice {
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionHostedCandidatePreviewRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: Pick<ExtensionHostedCandidatePreviewService, 'issue' | 'consume'>;
}

function deviceContext(request: FastifyRequest): PreviewRouteDevice | null {
  const value = (request as any).device as Partial<PreviewRouteDevice> | undefined;
  if (!value
    || typeof value.deploymentId !== 'string' || !value.deploymentId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || typeof value.deviceId !== 'string' || !value.deviceId
    || typeof value.ownerUserId !== 'string' || !value.ownerUserId
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes) || !value.scopes.every((scope) => typeof scope === 'string')
    || !Array.isArray(value.allowedShopIds)
    || !value.allowedShopIds.every((shopId) => typeof shopId === 'string')) return null;
  return value as PreviewRouteDevice;
}

function routeError(reply: FastifyReply, statusCode: number, errorCode: string, msg: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg });
}

function previewError(reply: FastifyReply, error: ExtensionHostedCandidatePreviewError) {
  const publicError = {
    HOSTED_CANDIDATE_PREVIEW_INVALID_REQUEST: {
      errorCode: 'hosted_candidate_preview_invalid_request',
      msg: '候选预览请求无效',
    },
    HOSTED_CANDIDATE_PREVIEW_NOT_AVAILABLE: {
      errorCode: 'hosted_candidate_preview_not_available',
      msg: '当前 ERP 托管候选不可预览',
    },
    HOSTED_CANDIDATE_PREVIEW_TOKEN_INVALID: {
      errorCode: 'hosted_candidate_preview_token_invalid',
      msg: '候选预览凭证无效或已过期',
    },
    HOSTED_CANDIDATE_PREVIEW_STORAGE_UNAVAILABLE: {
      errorCode: 'hosted_candidate_preview_unavailable',
      msg: '候选预览暂不可用',
    },
    HOSTED_CANDIDATE_PREVIEW_SERVICE_UNAVAILABLE: {
      errorCode: 'hosted_candidate_preview_unavailable',
      msg: '候选预览暂不可用',
    },
  }[error.code];
  return routeError(reply, error.statusCode, publicError.errorCode, publicError.msg);
}

function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  shopId: string,
): PreviewRouteDevice | null {
  const device = deviceContext(request);
  if (!device) {
    routeError(reply, 401, 'invalid_device_context', '无效的扩展设备身份');
    return null;
  }
  if (!device.scopes.includes('listing:review')) {
    routeError(reply, 403, 'command_scope_denied', '设备缺少商品审核权限');
    return null;
  }
  if (!device.allowedShopIds.includes(shopId)) {
    routeError(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    return null;
  }
  return device;
}

function serviceDevice(device: PreviewRouteDevice): ExtensionHostedCandidatePreviewDevice {
  return {
    deploymentId: device.deploymentId,
    sessionId: device.sessionId,
    deviceId: device.deviceId,
    ownerUserId: device.ownerUserId,
    actorUserId: device.actorUserId,
  };
}

function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
}

async function applyNoStore(_request: FastifyRequest, reply: FastifyReply) {
  noStore(reply);
}

export async function extensionHostedCandidatePreviewRoutes(
  app: FastifyInstance,
  options: ExtensionHostedCandidatePreviewRoutesOptions,
) {
  app.post('/ai-image-suite/candidate-preview', {
    preHandler: [applyNoStore, options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = issueSchema.safeParse(request.body);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = authorize(request, reply, parsed.data.binding.shopId);
    if (!device) return reply;
    try {
      const data = await options.service.issue({
        device: serviceDevice(device),
        binding: parsed.data.binding,
      });
      return reply.send({ code: 1, data });
    } catch (error) {
      if (error instanceof ExtensionHostedCandidatePreviewError) return previewError(reply, error);
      request.log.error({ err: error }, 'hosted candidate preview token issue failed');
      return routeError(reply, 503, 'hosted_candidate_preview_unavailable', '候选预览暂不可用');
    }
  });

  app.post('/ai-image-suite/candidate-preview/consume', {
    preHandler: [applyNoStore, options.authenticateDevice],
  }, async (request, reply) => {
    const parsed = consumeSchema.safeParse(request.body);
    if (!parsed.success) return routeError(reply, 400, 'invalid_request', '参数错误');
    const device = authorize(request, reply, parsed.data.binding.shopId);
    if (!device) return reply;
    try {
      const result = await options.service.consume({
        device: serviceDevice(device),
        binding: parsed.data.binding,
        token: parsed.data.token,
      });
      reply.header('Content-Type', result.output.mimeType);
      reply.header('Content-Length', String(result.bytes.length));
      reply.header('Cross-Origin-Resource-Policy', 'same-origin');
      return reply.send(result.bytes);
    } catch (error) {
      if (error instanceof ExtensionHostedCandidatePreviewError) return previewError(reply, error);
      request.log.error({ err: error }, 'hosted candidate preview consume failed');
      return routeError(reply, 503, 'hosted_candidate_preview_unavailable', '候选预览暂不可用');
    }
  });
}
