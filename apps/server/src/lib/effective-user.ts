import type { FastifyRequest } from 'fastify';
import type { AuthContext } from './auth.js';

/**
 * 取出请求当前的 AuthContext（authenticate 中间件填充）
 * 任何在 preHandler 之后的 handler 都可以调用
 */
export function getAuth(request: FastifyRequest): AuthContext {
  const auth = (request as any).user as AuthContext | undefined;
  if (!auth) {
    throw new Error('AuthContext missing — authenticate hook must run first');
  }
  return auth;
}

/**
 * 取数据归属用户 ID：根账号 = 自身；二级子账号 = 父账号
 * 所有 prisma 查询的 userId 字段（shops/supply_goods/orders 通过 shop 关联等）都用这个
 */
export function getEffectiveUserId(request: FastifyRequest): string {
  return getAuth(request).effectiveUserId;
}

/**
 * 取实际登录用户 ID（用于审计、操作日志、个人 session 操作、子账号 parentId）
 * 大多数业务查询应使用 getEffectiveUserId 而不是这个
 */
export function getActorUserId(request: FastifyRequest): string {
  return getAuth(request).actorUserId;
}
