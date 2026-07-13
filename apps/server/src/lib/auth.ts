import jwt, { type SignOptions } from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from './redis.js';
import { prisma } from './prisma.js';
import { isLegacyExtensionTokenIssuanceEnabled } from './extension-device-auth.js';

const DEV_JWT_FALLBACK = 'dev-secret-change-me';

function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET || '';
  if (!raw || raw === DEV_JWT_FALLBACK) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET 未配置，拒绝签发/校验 token');
    }
    if (!resolveJwtSecret.warned) {
      resolveJwtSecret.warned = true;
      console.error('[auth] JWT_SECRET 未配置，使用 dev fallback（仅限开发环境）');
    }
    return DEV_JWT_FALLBACK;
  }
  if (raw.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET 长度不足 16 字符，拒绝启动');
    }
    if (!resolveJwtSecret.warned) {
      resolveJwtSecret.warned = true;
      console.error(`[auth] JWT_SECRET 长度仅 ${raw.length} 字符（推荐 32+），仅限开发环境`);
    }
  }
  return raw;
}
resolveJwtSecret.warned = false as boolean;

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'];
const ACCOUNT_DEPLOYMENT_ID = process.env.SS_ERP_DEPLOYMENT_ID?.trim() || 'local-dev';
const ACCOUNT_JWT_ISSUER = process.env.AUTH_JWT_ISSUER?.trim() || 'ss-erp-local';
const ACCOUNT_JWT_AUDIENCE = `ss-erp-account:${ACCOUNT_DEPLOYMENT_ID}`;

export interface JwtPayload {
  userId: string;
  role: string;
  authVersion?: number;
}

export interface AuthContext extends JwtPayload {
  // userId 字段已被替换为 effectiveUserId（数据归属用户）
  // 根账号自身 = actor；二级子账号 = 父账号 ID
  // 所有数据 query（shops/orders/products 等）使用 userId 即可自动穿透
  effectiveUserId: string;
  actorUserId: string; // 实际登录的账号 ID，给 parentId/operatorId/审计用
  parentId: string | null;
  isSubAccount: boolean;
  accountCode: string | null;
  isSuperAdmin: boolean;
}

const MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type AccountTokenUse = 'account_session' | 'legacy_extension';

function signAccountToken(
  payload: JwtPayload,
  tokenUse: AccountTokenUse,
  expiresIn: SignOptions['expiresIn'],
): string {
  return jwt.sign({
    ...payload,
    authVersion: payload.authVersion ?? 0,
    typ: 'account',
    tokenUse,
    deploymentId: ACCOUNT_DEPLOYMENT_ID,
  }, JWT_SECRET, {
    algorithm: 'HS256',
    issuer: ACCOUNT_JWT_ISSUER,
    audience: ACCOUNT_JWT_AUDIENCE,
    expiresIn,
  });
}

export function signToken(payload: JwtPayload, expiresIn?: SignOptions['expiresIn']): string {
  return signAccountToken(payload, 'account_session', expiresIn || JWT_EXPIRES_IN);
}

export function signLegacyExtensionToken(
  payload: JwtPayload,
  expiresIn: SignOptions['expiresIn'] = '30d',
): string {
  if (!isLegacyExtensionTokenIssuanceEnabled()) {
    throw new Error('Legacy extension token issuance is disabled');
  }
  return signAccountToken(payload, 'legacy_extension', expiresIn);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('Invalid account token');

  const claims = decoded as typeof decoded & Record<string, unknown>;
  if (typeof claims.userId !== 'string' || typeof claims.role !== 'string') {
    throw new Error('Invalid account token');
  }

  if (claims.typ === 'account') {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const issuedAt = claims.iat;
    const expiresAt = claims.exp;
    const authVersion = claims.authVersion === undefined ? 0 : claims.authVersion;
    if ((claims.tokenUse !== 'account_session' && claims.tokenUse !== 'legacy_extension')
      || claims.deploymentId !== ACCOUNT_DEPLOYMENT_ID
      || claims.iss !== ACCOUNT_JWT_ISSUER
      || !audiences.includes(ACCOUNT_JWT_AUDIENCE)
      || !Number.isSafeInteger(issuedAt)
      || !Number.isSafeInteger(expiresAt)
      || Number(expiresAt) <= Number(issuedAt)
      || !Number.isSafeInteger(authVersion)
      || Number(authVersion) < 0) {
      throw new Error('Invalid account token');
    }
    const legacyEnabled = isLegacyExtensionTokenIssuanceEnabled();
    const lifetimeSeconds = Number(expiresAt) - Number(issuedAt);
    if (claims.tokenUse === 'legacy_extension'
      || lifetimeSeconds > MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS) {
      if (!legacyEnabled) throw new Error('Invalid account token');
    }
    return { ...claims, authVersion: Number(authVersion) } as unknown as JwtPayload;
  }

  const isUntypedLegacyToken = claims.typ == null && claims.tokenUse == null;
  if (!isLegacyExtensionTokenIssuanceEnabled() || !isUntypedLegacyToken) {
    throw new Error('Invalid account token');
  }
  return { ...claims, authVersion: 0 } as unknown as JwtPayload;
}

/** Compatibility hook: security-critical account context is read live for every request. */
export function clearAuthContextCache(_userId: string) {
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = extractToken(request);
  if (!token) {
    return reply.status(401).send({ code: 0, msg: '未登录' });
  }

  try {
    const payload = verifyToken(token);
    const sessionKey = `session:${payload.userId}:${token.slice(-8)}`;
    const exists = await redis.exists(sessionKey);
    if (!exists) {
      return reply.status(401).send({ code: 0, msg: '会话已过期' });
    }


    const live = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, parentId: true, parent: { select: { status: true } }, accountCode: true, status: true, isSuperAdmin: true, role: true, authVersion: true },
    });
    if (!live || live.status === 'SUSPENDED' || (live.parentId && live.parent?.status !== 'ACTIVE')) {
      return reply.status(403).send({ code: 0, msg: '账号不可用' });
    }
    if ((payload.authVersion === undefined ? 0 : payload.authVersion) !== live.authVersion) {
      return reply.status(401).send({ code: 0, msg: '会话已失效' });
    }


    // 关键：把 user.userId 替换成 effectiveUserId，让所有现有路由的 where: { userId } 自动穿透到父账号
    // actorUserId 保留登录账号 ID，给需要审计/操作日志/parentId 等场景用
    (request as any).user = {
      ...payload,
      userId: live.parentId || live.id,
      actorUserId: payload.userId,
      role: live.role,
      effectiveUserId: live.parentId || live.id,
      parentId: live.parentId,
      authVersion: live.authVersion,
      isSubAccount: !!live.parentId,
      accountCode: live.accountCode,
      isSuperAdmin: live.role === 'ADMIN' && live.isSuperAdmin,
    } as AuthContext & { actorUserId: string };
  } catch {
    return reply.status(401).send({ code: 0, msg: '无效的令牌' });
  }
}

export function extractToken(request: FastifyRequest): string | null {
  // 优先从 HttpOnly cookie 读取（Web 端）
  const cookieToken = (request.cookies as Record<string, string | undefined>)?.sserp_token;
  if (cookieToken) return cookieToken;

  // 回退到 Authorization header（扩展/打印代理）
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

  return null;
}

export async function storeSession(userId: string, token: string, ttl?: number) {
  const sessionKey = `session:${userId}:${token.slice(-8)}`;
  const seconds = ttl || Number(process.env.SESSION_TTL_SECONDS) || 604800;
  await redis.set(sessionKey, '1', 'EX', seconds);
}

export async function removeSession(userId: string, token: string) {
  const sessionKey = `session:${userId}:${token.slice(-8)}`;
  await redis.del(sessionKey);
}

export async function removeAllSessions(userId: string) {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      `session:${userId}:*`,
      'COUNT',
      100,
    ) as [string, string[]];
    if (keys.length > 0) await redis.del(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');
}

const AUTH_COOKIE_NAME = 'sserp_token';
const AUTH_COOKIE_SECURE =
  process.env.AUTH_COOKIE_SECURE !== undefined
    ? process.env.AUTH_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
const AUTH_COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: AUTH_COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
};

export function setAuthCookie(reply: FastifyReply, token: string, maxAgeSeconds?: number) {
  reply.setCookie(AUTH_COOKIE_NAME, token, {
    ...AUTH_COOKIE_OPTIONS,
    ...(typeof maxAgeSeconds === 'number' ? { maxAge: maxAgeSeconds } : {}),
  });
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS);
}

/**
 * 角色权限检查中间件工厂
 * 用法: app.addHook('preHandler', requireRole('ADMIN', 'STAFF'))
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({ code: 0, msg: '无权限访问' });
    }
  };
}

/**
 * 超级管理员权限检查中间件
 * 用法: app.addHook('preHandler', requireSuperAdmin)
 * 必须先经过 authenticate
 */
export async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  if (!user || user.role !== 'ADMIN' || !user.isSuperAdmin) {
    return reply.status(403).send({ code: 0, msg: '需要超级管理员权限' });
  }
}
