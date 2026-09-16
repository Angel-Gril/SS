import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isAllowedCorsOrigin } from '../lib/cors.js';
import {
  erpSourceLaunchRequestSchema, ExtensionErpSourceLaunchError,
  type createExtensionErpSourceLaunchService,
} from '../services/extension-erp-source-launch.js';

export interface ExtensionErpSourceLaunchRoutesOptions {
  authenticateAccount(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  service: ReturnType<typeof createExtensionErpSourceLaunchService>;
}

const consumeSchema = z.object({ launchToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : {};
function failure(reply: FastifyReply, error: unknown) {
  const known = error instanceof ExtensionErpSourceLaunchError;
  return reply.header('Cache-Control', 'no-store').code(known ? error.statusCode : 503).send({
    code: 0, errorCode: known ? error.code : 'ERP_LAUNCH_UNAVAILABLE',
    msg: '扩展启动授权不可用，请核对配对账号、店铺与草稿后重新打开',
  });
}

export async function extensionErpSourceLaunchRoutes(app: FastifyInstance, options: ExtensionErpSourceLaunchRoutesOptions) {
  app.post('/erp-launch-grants', {
    preHandler: [options.authenticateAccount], bodyLimit: 8 * 1024,
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!isAllowedCorsOrigin(request.headers.origin)) return failure(reply, new ExtensionErpSourceLaunchError('ERP_LAUNCH_FORBIDDEN', 403));
    const parsed = erpSourceLaunchRequestSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, new ExtensionErpSourceLaunchError('ERP_LAUNCH_INVALID_REQUEST', 400));
    const user = object((request as FastifyRequest & { user?: unknown }).user);
    try {
      const data = await options.service.issue({
        ownerUserId: user.userId, actorUserId: user.actorUserId,
        actorParentId: user.parentId ?? null, actorRole: user.role,
      }, parsed.data);
      return reply.code(201).send({ code: 1, data });
    } catch (error) { return failure(reply, error); }
  });
  app.post('/erp-launch-grants/consume', {
    preHandler: [options.authenticateDevice], bodyLimit: 1024,
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = consumeSchema.safeParse(request.body);
    if (!parsed.success) return failure(reply, new ExtensionErpSourceLaunchError('ERP_LAUNCH_INVALID_REQUEST', 400));
    try {
      const device = (request as FastifyRequest & { device?: unknown }).device;
      return reply.send({ code: 1, data: await options.service.consume(device, parsed.data.launchToken) });
    } catch (error) { return failure(reply, error); }
  });
}
