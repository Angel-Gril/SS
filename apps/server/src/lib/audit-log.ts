import { prisma } from './prisma.js';
import { getConfig } from '../config/system-config-schema.js';
import type { Prisma, UserRole } from '@prisma/client';

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
