import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import {
  ExtensionWorkbenchListingPublishError,
  type ExtensionWorkbenchListingPublishService,
} from '../services/extension-workbench-listing-publish.js';
import {
  ExtensionByokPublishAuthorizationError,
} from '../services/extension-byok-publish-authorization.js';
import {
  ExtensionByokPublishStatusRepositoryError,
} from '../repositories/extension-byok-publish-status-repository.js';
import {
  ExtensionByokMediaProvenanceError,
} from '../services/extension-byok-media-provenance.js';
import {
  SourceListingWorkflowError,
} from '../services/source-listing-workflow.js';
import {
  OzonListingProductionCompileError,
} from '../services/ozon-listing-production-compile-adapter.js';

const BODY_LIMIT = 96 * 1024;

interface PublishDeviceContext {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionWorkbenchPublishRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: ExtensionWorkbenchListingPublishService;
}

function deviceContext(request: FastifyRequest): PublishDeviceContext | null {
  const value = (request as FastifyRequest & {
    device?: Partial<PublishDeviceContext>;
  }).device;
  if (!value
    || typeof value.sessionId !== 'string'
    || typeof value.tokenId !== 'string'
    || typeof value.ownerUserId !== 'string'
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes)
    || value.scopes.some((scope) => typeof scope !== 'string')
    || !Array.isArray(value.allowedShopIds)
    || value.allowedShopIds.some((shopId) => typeof shopId !== 'string')) {
    return null;
  }
  return value as PublishDeviceContext;
}

function errorResponse(
  reply: FastifyReply,
  statusCode: number,
  errorCode: string,
  message: string,
) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function safeKnownError(error: unknown): { statusCode: number; errorCode: string } | null {
  if (!(error instanceof ExtensionWorkbenchListingPublishError)
    && !(error instanceof ExtensionByokPublishAuthorizationError)
    && !(error instanceof ExtensionByokPublishStatusRepositoryError)
    && !(error instanceof ExtensionByokMediaProvenanceError)
    && !(error instanceof SourceListingWorkflowError)
    && !(error instanceof OzonListingProductionCompileError)) return null;
  const value = error as { statusCode?: unknown; code?: unknown } | null;
  const statusCode = Number(value?.statusCode);
  const code = typeof value?.code === 'string' ? value.code : '';
  if (!Number.isSafeInteger(statusCode)
    || statusCode < 400
    || statusCode > 599
    || !/^[A-Z][A-Z0-9_]{0,99}$/u.test(code)) return null;
  return { statusCode, errorCode: code.toLowerCase() };
}

function requestShopId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (typeof value.shopId === 'string') return value.shopId;
  const envelope = value.envelope;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  return typeof (envelope as Record<string, unknown>).shopId === 'string'
    ? String((envelope as Record<string, unknown>).shopId)
    : null;
}

async function routeContext(request: FastifyRequest, reply: FastifyReply) {
  const device = deviceContext(request);
  if (!device) {
    errorResponse(reply, 401, 'invalid_device_token', '无效的设备令牌');
    return null;
  }
  if (!device.scopes.includes('listing:publish')) {
    errorResponse(reply, 403, 'workbench_publish_scope_denied', '设备缺少商品发布权限');
    return null;
  }
  const shopId = requestShopId(request.body);
  if (!shopId || !device.allowedShopIds.includes(shopId)) {
    errorResponse(reply, 403, 'workbench_publish_shop_denied', '设备无权访问该店铺');
    return null;
  }
  return {
    sessionId: device.sessionId,
    ownerUserId: device.ownerUserId,
    actorUserId: device.actorUserId,
  };
}

async function handleFailure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const known = safeKnownError(error);
  if (known) {
    return errorResponse(reply, known.statusCode, known.errorCode, '工作台商品发布请求未通过校验');
  }
  request.log.error({ err: error }, 'extension workbench listing publish route failed');
  return errorResponse(
    reply,
    503,
    'extension_workbench_listing_publish_unavailable',
    '工作台商品发布暂不可用',
  );
}

export async function extensionWorkbenchPublishRoutes(
  app: FastifyInstance,
  options: ExtensionWorkbenchPublishRoutesOptions,
) {
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.post('/preview', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const actor = await routeContext(request, reply);
    if (!actor) return reply;
    try {
      const data = await options.service.preview(request.body, actor);
      return reply.send({ code: 1, data });
    } catch (error) {
      return handleFailure(request, reply, error);
    }
  });

  app.post('/prepare', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const actor = await routeContext(request, reply);
    if (!actor) return reply;
    try {
      const data = await options.service.prepare(request.body, actor);
      return reply.status(data.replayed ? 200 : 201).send({ code: 1, data });
    } catch (error) {
      return handleFailure(request, reply, error);
    }
  });

  app.post('/status', {
    bodyLimit: BODY_LIMIT,
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const actor = await routeContext(request, reply);
    if (!actor) return reply;
    try {
      const data = await options.service.status(request.body, actor);
      return reply.status(data.state === 'PENDING' ? 202 : 200).send({ code: 1, data });
    } catch (error) {
      return handleFailure(request, reply, error);
    }
  });
}
