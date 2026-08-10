import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import {
  createExtensionDeviceSessionService,
  EXTENSION_DEVICE_SCOPES,
  ExtensionDeviceSessionError,
  type ExtensionDeviceRevocationReason,
} from '../services/extension-device-session.js';
import {
  buildShopAnalyticsGraphsSnapshot,
  buildShopAnalyticsSummarySnapshot,
  ShopAnalyticsPayloadError,
  type ShopAnalyticsSnapshotData,
} from '../services/shop-analytics-snapshot.js';

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

export interface ExtensionDeviceAuthorizedShop {
  id: string;
  platform: string;
  name: string;
  status: string;
}

export interface ExtensionDeviceShopRepository {
  listAuthorizedShops(input: {
    ownerUserId: string;
    shopIds: string[];
  }): Promise<ExtensionDeviceAuthorizedShop[]>;
}

export interface ExtensionDeviceShopAnalyticsRepository {
  createSnapshot(input: {
    ownerUserId: string;
    shopId: string;
    snapshot: ShopAnalyticsSnapshotData;
  }): Promise<{ id: string; productCount: number } | null>;
}

export interface ExtensionDeviceRoutesOptions {
  sessionService: Pick<ExtensionDeviceSessionService, 'createPairingCode' | 'claimPairingCode' | 'refresh'>;
  managementRepository: ExtensionDeviceManagementRepository;
  /**
   * Optional device-authenticated read surface used by the extension after
   * pairing. Keeping it opt-in preserves the account-only route contract in
   * deployments that have not enabled scoped device auth.
   */
  authenticateDevice?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  shopRepository?: ExtensionDeviceShopRepository;
  authenticateShopAnalyticsDevice?: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown>;
  shopAnalyticsRepository?: ExtensionDeviceShopAnalyticsRepository;
  authenticateAccount?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
}

const pairingSchema = z.object({
  shopIds: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  scopes: z.array(z.enum(EXTENSION_DEVICE_SCOPES)).min(1).max(EXTENSION_DEVICE_SCOPES.length),
  deviceLabel: z.string().trim().min(1).max(120).optional(),
  resumeSessionId: z.string().trim().min(1).max(200).optional(),
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
const shopParamsSchema = z.object({ shopId: z.string().trim().min(1).max(200) });
const SHOP_ANALYTICS_BODY_LIMIT = 2 * 1024 * 1024;

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

function deviceContext(request: FastifyRequest): {
  ownerUserId: string;
  actorUserId: string;
  allowedShopIds: string[];
} | null {
  const device = (request as any).device as {
    ownerUserId?: unknown;
    actorUserId?: unknown;
    allowedShopIds?: unknown;
  } | undefined;
  if (!device
    || typeof device.ownerUserId !== 'string'
    || typeof device.actorUserId !== 'string'
    || device.actorUserId !== device.ownerUserId
    || !Array.isArray(device.allowedShopIds)) {
    return null;
  }
  const allowedShopIds = [...new Set(device.allowedShopIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
  return {
    ownerUserId: device.ownerUserId,
    actorUserId: device.actorUserId,
    allowedShopIds,
  };
}

function deviceShopContext(
  request: FastifyRequest,
  reply: FastifyReply,
  shopId: string,
): ReturnType<typeof deviceContext> {
  const device = deviceContext(request);
  if (!device) {
    reply.status(401).send({
      code: 0,
      errorCode: 'invalid_device_context',
      msg: '无效的设备令牌',
    });
    return null;
  }
  if (!device.allowedShopIds.includes(shopId)) {
    reply.status(404).send({
      code: 0,
      errorCode: 'device_shop_not_found',
      msg: '店铺未授权给该设备',
    });
    return null;
  }
  const scopes = (request as any).device?.scopes;
  if (!Array.isArray(scopes) || !scopes.includes('capture:write')) {
    reply.status(403).send({
      code: 0,
      errorCode: 'insufficient_scope',
      msg: '设备权限不足',
    });
    return null;
  }
  return device;
}

function invalidAnalyticsPayload(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    errorCode: 'invalid_analytics_payload',
    msg: '分析数据无效',
  });
}
export async function extensionDeviceRoutes(
  app: FastifyInstance,
  options: ExtensionDeviceRoutesOptions,
) {
  const authenticateAccount = options.authenticateAccount || authenticate;

  // A paired extension must not fall back to a tenant account token just to
  // populate its shop selector. This read-only endpoint is explicitly scoped
  // to the shop grants carried by the live device authorization.
  if (options.authenticateDevice && options.shopRepository) {
    app.get('/shops', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
      const device = deviceContext(request);
      if (!device) {
        return reply.status(401).send({
          code: 0,
          errorCode: 'invalid_device_context',
          msg: '无效的设备令牌',
        });
      }
      const data = await options.shopRepository!.listAuthorizedShops({
        ownerUserId: device.ownerUserId,
        shopIds: device.allowedShopIds,
      });
      reply.header('Cache-Control', 'no-store');
      return reply.send({ code: 1, msg: 'ok', data });
    });
  }

  if (options.authenticateShopAnalyticsDevice && options.shopAnalyticsRepository) {
    app.post('/shops/:shopId/analytics', {
      bodyLimit: SHOP_ANALYTICS_BODY_LIMIT,
      preHandler: [options.authenticateShopAnalyticsDevice],
    }, async (request, reply) => {
      const params = shopParamsSchema.safeParse(request.params);
      if (!params.success) return invalidInput(reply);
      const device = deviceShopContext(request, reply, params.data.shopId);
      if (!device) return reply;

      let snapshot: ShopAnalyticsSnapshotData;
      try {
        snapshot = buildShopAnalyticsSummarySnapshot(request.body);
      } catch (error) {
        if (error instanceof ShopAnalyticsPayloadError) return invalidAnalyticsPayload(reply);
        throw error;
      }
      const stored = await options.shopAnalyticsRepository!.createSnapshot({
        ownerUserId: device.ownerUserId,
        shopId: params.data.shopId,
        snapshot,
      });
      if (!stored) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      reply.header('Cache-Control', 'no-store');
      return reply.send({
        code: 1,
        msg: `已保存 ${snapshot.productCount} 条分析数据`,
        data: stored,
      });
    });

    app.post('/shops/:shopId/analytics-graphs', {
      bodyLimit: SHOP_ANALYTICS_BODY_LIMIT,
      preHandler: [options.authenticateShopAnalyticsDevice],
    }, async (request, reply) => {
      const params = shopParamsSchema.safeParse(request.params);
      if (!params.success) return invalidInput(reply);
      const device = deviceShopContext(request, reply, params.data.shopId);
      if (!device) return reply;

      let built: ReturnType<typeof buildShopAnalyticsGraphsSnapshot>;
      try {
        built = buildShopAnalyticsGraphsSnapshot(request.body);
      } catch (error) {
        if (error instanceof ShopAnalyticsPayloadError) return invalidAnalyticsPayload(reply);
        throw error;
      }
      const stored = await options.shopAnalyticsRepository!.createSnapshot({
        ownerUserId: device.ownerUserId,
        shopId: params.data.shopId,
        snapshot: built.snapshot,
      });
      if (!stored) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      reply.header('Cache-Control', 'no-store');
      return reply.send({
        code: 1,
        msg: `已保存 V${built.responseVersion} 数据: ${built.snapshot.productCount} 条SKU`,
        data: { id: stored.id },
      });
    });
  }

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
        ...(parsed.data.resumeSessionId
          ? { resumeSessionId: parsed.data.resumeSessionId }
          : {}),
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
