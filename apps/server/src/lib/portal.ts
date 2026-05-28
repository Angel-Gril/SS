import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from './prisma.js';

export interface PortalContext {
  userId: string;
  role: string;
  portal: string;
  tenantType: string;
}

export async function resolvePortalContext(request: FastifyRequest): Promise<PortalContext> {
  const { userId, role } = (request as any).user;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activePortal: true, tenantType: true },
  });
  return {
    userId,
    role,
    portal: user?.activePortal || 'user',
    tenantType: user?.tenantType || 'transit',
  };
}

export function requirePortal(portal: 'user' | 'warehouse') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await resolvePortalContext(request);
    (request as any).portalCtx = ctx;
    if (ctx.role === 'ADMIN') return;
    if (ctx.portal !== portal) {
      return reply.status(403).send({ code: 0, msg: `当前处于${ctx.portal === 'user' ? '用户' : '仓库'}端，请切换后操作` });
    }
  };
}

export function requireSoloWarehouse() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = await resolvePortalContext(request);
    (request as any).portalCtx = ctx;
    if (ctx.role === 'ADMIN') return;
    if (ctx.tenantType !== 'solo') {
      return reply.status(403).send({ code: 0, msg: '仅个人卖家可访问独立仓库端' });
    }
    if (ctx.portal !== 'warehouse') {
      return reply.status(403).send({ code: 0, msg: '请先切换到仓库端' });
    }
  };
}
