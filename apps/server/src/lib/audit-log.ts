import { prisma } from './prisma.js';
import { getConfig } from '../config/system-config-schema.js';
import type { Prisma, UserRole } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface AuditLogEntry {
  actorId?: string | null;
  actorRole: UserRole;
  action: string;
  target?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  force?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_FIELD_RE = /(password|token|secret|apikey|api_key|accesskey|access_key|authorization|cookie|captcha|turnstile)/i;
const EXCLUDED_AUDIT_PATH_PREFIXES = [
  '/api/auth/',
  '/api/admin/auth/',
  '/api/admin/audit-logs',
];

export function maskAuditPayload(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => maskAuditPayload(item));
  if (typeof value !== 'object') return value;

  const masked: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      masked[key] = '***MASKED***';
    } else {
      masked[key] = maskAuditPayload(inner);
    }
  }
  return masked;
}

interface AuditRequestLike {
  method: string;
  url: string;
  body?: unknown;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: {
    actorUserId?: string;
    userId?: string;
    role?: UserRole;
  };
}

export function shouldAuditHttpRequest(input: {
  method: string;
  url: string;
  statusCode: number;
  user?: unknown;
}): boolean {
  if (!WRITE_METHODS.has(input.method.toUpperCase())) return false;
  if (input.statusCode < 200 || input.statusCode >= 400) return false;
  if (!input.user) return false;
  const pathname = input.url.split('?')[0] || input.url;
  return !EXCLUDED_AUDIT_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function buildHttpAuditEntry(request: AuditRequestLike, statusCode: number): AuditLogEntry {
  const user = request.user || {};
  return {
    actorId: user.actorUserId || user.userId || null,
    actorRole: user.role || 'USER',
    action: `http_${request.method.toLowerCase()}`,
    target: request.url.split('?')[0] || request.url,
    after: {
      statusCode,
      body: maskAuditPayload(request.body),
    },
    ...extractRequestMeta(request),
  };
}

/**
 * 记录审计日志（仅当 security_audit_log_enabled=true 时写入）
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const enabled = await getConfig('security_audit_log_enabled');
  if (!enabled && !entry.force) return;

  try {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      actorId: entry.actorId || undefined,
      actorRole: entry.actorRole,
      action: entry.action,
      target: entry.target,
      before: entry.before ? JSON.parse(JSON.stringify(entry.before)) : null,
      after: entry.after ? JSON.parse(JSON.stringify(entry.after)) : null,
      ip: entry.ip,
      userAgent: entry.userAgent,
    };

    await prisma.auditLog.create({
      data,
    });
  } catch (error) {
    console.error('[audit] failed to write audit log:', error);
  }
}

export function registerAuditHook(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    const user = (request as any).user;
    if (!shouldAuditHttpRequest({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      user,
    })) {
      return;
    }

    await logAudit(buildHttpAuditEntry({
      method: request.method,
      url: request.url,
      body: request.body,
      ip: request.ip,
      headers: request.headers,
      user,
    } as FastifyRequest & AuditRequestLike, reply.statusCode));
  });
}

/**
 * 从 Fastify request 提取 IP 和 User-Agent
 */
export function extractRequestMeta(request: { ip?: string; headers: Record<string, string | string[] | undefined> }) {
  return {
    ip: request.ip,
    userAgent: Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0]
      : request.headers['user-agent'],
  };
}
