import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import {
  createExtensionDeviceSessionService,
  EXTENSION_DEVICE_SCOPES,
  ExtensionDeviceSessionError,
  type ExtensionDeviceRevocationReason,
} from '../services/extension-device-session.js';

type ExtensionDeviceSessionService = ReturnType<typeof createExtensionDeviceSessionService>;

export interface ExtensionDeviceManagementSession {
  id: string;
  deviceId: string;
  deviceLabel: string | null;
  status: string;
  shopIds: string[];
  scopes: string[];
  expiresAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
}

export interface ExtensionDeviceManagementRepository {
  cancelPairingCode(input: {
    pairingCodeId: string;
    ownerUserId: string;
    actorUserId: string;
  }): Promise<boolean>;
  listSessions(ownerUserId: string): Promise<ExtensionDeviceManagementSession[]>;
  revokeSession(input: {
    sessionId: string;
    ownerUserId: string;
    actorUserId: string;
    reason: ExtensionDeviceRevocationReason;
  }): Promise<boolean>;
}

export interface ExtensionDeviceRoutesOptions {
  sessionService: Pick<ExtensionDeviceSessionService, 'createPairingCode' | 'claimPairingCode' | 'refresh'>;
  managementRepository: ExtensionDeviceManagementRepository;
  authenticateAccount?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

const pairingSchema = z.object({
  shopIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  scopes: z.array(z.enum(EXTENSION_DEVICE_SCOPES)).min(1).max(EXTENSION_DEVICE_SCOPES.length),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
}).strict();

const claimSchema = z.object({
  code: z.string().trim().min(20).max(200),
  deviceId: z.string().trim().min(1).max(200),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
  deploymentId: z.string().trim().min(1).max(128),
}).strict();

const refreshSchema = z.object({
  refreshToken: z.string().trim().min(32).max(1000),
}).strict();
export function extensionDeviceClaimRateLimitKey(request: FastifyRequest): string {
  return request.ip;
}


const idParamsSchema = z.object({ id: z.string().trim().min(1).max(200) });

const claimRateLimitConfig = {
  rateLimit: {
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: extensionDeviceClaimRateLimitKey,
  },
};

function invalidInput(reply: FastifyReply) {
  return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '参数错误' });
}

function sendSessionError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ExtensionDeviceSessionError)) throw error;
  return reply.status(error.statusCode).send({
    code: 0,
    errorCode: error.code,
    msg: error.message,
  });
}

function accountContext(request: FastifyRequest) {
  const user = (request as any).user as {
    userId: string;
    actorUserId: string;
    parentId: string | null;
    role: string;
  };
  return {
    ownerUserId: user.userId,
    actorUserId: user.actorUserId,
    actorParentId: user.parentId ?? null,
    actorRole: user.role,
  };
}


function ownerAccountContext(request: FastifyRequest, reply: FastifyReply) {
  const account = accountContext(request);
  if (account.actorParentId !== null
    || account.actorUserId !== account.ownerUserId
    || !['USER', 'ADMIN'].includes(account.actorRole)) {
    reply.status(403).send({
      code: 0, errorCode: 'pairing_owner_required', msg: '需要租户所有者权限',
    });
    return null;
  }
  return account;
}
export async function extensionDeviceRoutes(
  app: FastifyInstance,
  options: ExtensionDeviceRoutesOptions,
) {
  const authenticateAccount = options.authenticateAccount || authenticate;

  app.post('/pairing-codes', { preHandler: [authenticateAccount] }, async (request, reply) => {
    const parsed = pairingSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply);
    try {
      const account = ownerAccountContext(request, reply);
      if (!account) return reply;
      const result = await options.sessionService.createPairingCode({
        ...account,
        shopIds: parsed.data.shopIds,
        scopes: parsed.data.scopes,
        deviceLabel: parsed.data.deviceLabel,
      });
      return reply.status(201).send({ code: 1, msg: '配对码已创建', data: result });
    } catch (error) {
      return sendSessionError(reply, error);
    }
  });

  app.delete('/pairing-codes/:id', { preHandler: [authenticateAccount] }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) return invalidInput(reply);
    const account = ownerAccountContext(request, reply);
    if (!account) return reply;
    const canceled = await options.managementRepository.cancelPairingCode({
      pairingCodeId: parsed.data.id,
      ownerUserId: account.ownerUserId,
      actorUserId: account.actorUserId,
    });
    if (!canceled) {
      return reply.status(404).send({ code: 0, errorCode: 'pairing_not_found', msg: '配对码不存在' });
    }
    return reply.send({ code: 1, msg: '配对码已取消' });
  });

  app.post('/pairing-claims', { config: claimRateLimitConfig }, async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply);
    try {
      const result = await options.sessionService.claimPairingCode(parsed.data);
      return reply.status(201).send({ code: 1, msg: '设备配对成功', data: result });
    } catch (error) {
      return sendSessionError(reply, error);
    }
  });

  app.post('/refresh', { config: claimRateLimitConfig }, async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) return invalidInput(reply);
    try {
      const result = await options.sessionService.refresh(parsed.data);
      return reply.send({ code: 1, msg: '设备令牌已刷新', data: result });
    } catch (error) {
      return sendSessionError(reply, error);
    }
  });

  app.get('/sessions', { preHandler: [authenticateAccount] }, async (request, reply) => {
    const account = ownerAccountContext(request, reply);
    if (!account) return reply;
    const sessions = await options.managementRepository.listSessions(account.ownerUserId);
    return reply.send({ code: 1, msg: 'ok', data: sessions });
  });

  app.delete('/sessions/:id', { preHandler: [authenticateAccount] }, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) return invalidInput(reply);
    const account = ownerAccountContext(request, reply);
    if (!account) return reply;
    const revoked = await options.managementRepository.revokeSession({
      sessionId: parsed.data.id,
      ownerUserId: account.ownerUserId,
      actorUserId: account.actorUserId,
      reason: 'OWNER_REVOKED',
    });
    if (!revoked) {
      return reply.status(404).send({ code: 0, errorCode: 'device_session_not_found', msg: '设备会话不存在' });
    }
    return reply.send({ code: 1, msg: '设备已撤销' });
  });
}
