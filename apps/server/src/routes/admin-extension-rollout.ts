import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import type { createExtensionRolloutAdminOptionsService } from '../services/extension-rollout-admin-options.js';

interface AdminExtensionRolloutRouteOptions {
  service: ReturnType<typeof createExtensionRolloutAdminOptionsService>;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

export async function adminExtensionRolloutRoutes(app: FastifyInstance, options: AdminExtensionRolloutRouteOptions) {
  app.addHook('preHandler', options.authenticate || authenticate);
  app.addHook('preHandler', requireSuperAdmin);
  app.addHook('preHandler', async (request, reply) => {
    if ((request as any).user?.tokenUse === 'account_session') return;
    return reply.status(403).send({ code: 0, errorCode: 'extension_rollout_account_session_required', msg: '扩展权限选项仅允许当前网页登录会话访问' });
  });

  app.get('/options', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const data = await options.service.list(request.query);
      return reply.send({ code: 1, msg: 'ok', data });
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      return reply.status(400).send({ code: 0, errorCode: 'extension_rollout_options_invalid_query', msg: '用户、店铺或设备选项查询参数无效' });
    }
  });
}
