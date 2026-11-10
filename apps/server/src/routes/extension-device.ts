import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
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
import { ExtensionDeviceShopConfigConflictError } from '../services/extension-device-shop-prisma.js';
import {
  directListingSyncSchema,
  type DirectListingSyncPayload,
  type DirectListingSyncResult,
} from '../services/direct-listing-sync.js';
import {
  productSelectionRuleSchema,
  toggleProductSelectionRuleSchema,
  createPrismaProductSelectionRuleRepository,
  type ProductSelectionRuleRepository,
} from '../services/product-selection-rule.js';

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
  clientId?: string | null;
  companyId?: string | null;
}

export interface ExtensionDeviceShopRepository {
  listAuthorizedShops(input: {
    ownerUserId: string;
    shopIds: string[];
  }): Promise<ExtensionDeviceAuthorizedShop[]>;
  readOzonCdnAuth?(input: {
    ownerUserId: string;
    shopId: string;
  }): Promise<ExtensionDeviceOzonCdnAuthStatus | null>;
  updateOzonCdnAuth?(input: {
    ownerUserId: string;
    shopId: string;
    cookie?: string;
    companyId?: string;
    clearCookie?: true;
  }): Promise<ExtensionDeviceOzonCdnAuthStatus | null>;
}

export interface ExtensionDeviceOzonCdnAuthStatus {
  hasCookie: boolean;
  companyId: string | null;
  updatedAt: string | null;
}

export interface ExtensionDeviceShopAnalyticsRepository {
  createSnapshot(input: {
    ownerUserId: string;
    shopId: string;
    snapshot: ShopAnalyticsSnapshotData;
  }): Promise<{ id: string; productCount: number } | null>;
}

export interface ExtensionDeviceCollectBatchResult {
  statusCode: number;
  body: Record<string, unknown>;
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
  authenticateCollectDevice?: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown>;
  authenticateProductSelectionDevice?: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown>;
  productSelectionRepository?: ProductSelectionRuleRepository;
  shopAnalyticsRepository?: ExtensionDeviceShopAnalyticsRepository;
  collectBatch?: (input: {
    ownerUserId: string;
    actorUserId: string;
    body: {
      items: unknown[];
      collectPhase?: string;
      ephemeralListing?: boolean;
      ephemeralListingSource?: string;
    };
    log?: { warn: (metadata: unknown, message: string) => void };
  }) => Promise<ExtensionDeviceCollectBatchResult>;
  /**
   * 扩展直连生图的结果托管：扩展把图片字节交给 ERP，由存储 owner 落到对象存储
   * （失败时按配置回退到 Ozon 登录态上传），返回可用于上架的 https 链接。
   */
  storeImage?: (input: {
    ownerUserId: string;
    dataUrl: string;
    filename?: string;
    shopId?: string;
  }) => Promise<
    | { ok: true; data: { url: string; filename: string; backend: string } }
    | { ok: false; statusCode: number; msg: string }
  >;
  /** 扩展直连上架完成后的最终数据同步；只记录结果，不触发 Ozon 写入。 */
  syncDirectListing?: (input: {
    ownerUserId: string;
    payload: DirectListingSyncPayload;
  }) => Promise<DirectListingSyncResult>;
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
const OZON_CDN_COOKIE_MAX_LENGTH = 64 * 1024;
const OZON_CDN_AUTH_BODY_LIMIT = OZON_CDN_COOKIE_MAX_LENGTH + 1024;
function hasOzonCdnControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
const ozonCdnCompanyIdSchema = z.union([
  z.string().trim().min(1).max(200).refine((value) => !hasOzonCdnControlCharacter(value)),
  z.number().int().safe().positive().transform(String),
]);
const ozonCdnAuthSchema = z.object({
  cookie: z.string()
    .trim()
    .min(1)
    .max(OZON_CDN_COOKIE_MAX_LENGTH)
    .refine((value) => !hasOzonCdnControlCharacter(value))
    .optional(),
  companyId: ozonCdnCompanyIdSchema.optional(),
  clearCookie: z.literal(true).optional(),
}).strict()
  .refine((value) => value.cookie !== undefined || value.companyId !== undefined || value.clearCookie)
  .refine((value) => !(value.cookie !== undefined && value.clearCookie));
export function extensionDeviceClaimRateLimitKey(request: FastifyRequest): string {
  return request.ip;
}


const idParamsSchema = z.object({ id: z.string().trim().min(1).max(200) });
const shopParamsSchema = z.object({ shopId: z.string().trim().min(1).max(200) });
const SHOP_ANALYTICS_BODY_LIMIT = 2 * 1024 * 1024;
const DEVICE_IMAGE_BODY_LIMIT = 30 * 1024 * 1024;
const DIRECT_LISTING_BODY_LIMIT = 512 * 1024;
const deviceImageSchema = z.object({
  dataUrl: z.string().min(1),
  filename: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._-]+$/u).optional(),
  shopId: z.string().trim().min(1).max(200).optional(),
}).strict();

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
  requiredScope: 'capture:write' | null = 'capture:write',
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
  if (requiredScope && (!Array.isArray(scopes) || !scopes.includes(requiredScope))) {
    reply.status(403).send({
      code: 0,
      errorCode: 'insufficient_scope',
      msg: '设备权限不足',
    });
    return null;
  }
  return device;
}

function deviceScopeContext(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredScope: string | null = null,
): ReturnType<typeof deviceContext> {
  const device = deviceContext(request);
  if (!device) {
    reply.status(401).send({ code: 0, errorCode: 'invalid_device_context', msg: '无效的设备令牌' });
    return null;
  }
  const scopes = (request as any).device?.scopes;
  if (requiredScope && (!Array.isArray(scopes) || !scopes.includes(requiredScope))) {
    reply.status(403).send({ code: 0, errorCode: 'insufficient_scope', msg: '设备权限不足' });
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

function invalidOzonCdnAuthPayload(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    errorCode: 'invalid_ozon_cdn_auth_payload',
    msg: 'Ozon CDN 认证数据无效',
  });
}

function ozonCdnAuthResponseData(status: ExtensionDeviceOzonCdnAuthStatus) {
  return {
    hasCookie: status.hasCookie === true,
    companyId: typeof status.companyId === 'string' ? status.companyId : null,
    updatedAt: typeof status.updatedAt === 'string' ? status.updatedAt : null,
  };
}

function authorizedShopResponseData(shop: ExtensionDeviceAuthorizedShop) {
  return {
    id: shop.id,
    platform: shop.platform,
    name: shop.name,
    status: shop.status,
    clientId: typeof shop.clientId === 'string' ? shop.clientId : null,
    companyId: typeof shop.companyId === 'string' ? shop.companyId : null,
  };
}
export async function extensionDeviceRoutes(
  app: FastifyInstance,
  options: ExtensionDeviceRoutesOptions,
) {
  const authenticateAccount = options.authenticateAccount || authenticate;
  const authenticateProductSelectionDevice = options.authenticateProductSelectionDevice
    || options.authenticateDevice;
  const productSelectionRepository = options.productSelectionRepository
    || createPrismaProductSelectionRuleRepository(prisma);

  if (authenticateProductSelectionDevice) {
    const preHandler = [authenticateProductSelectionDevice];
    app.get('/product-selection/rules', { preHandler }, async (request, reply) => {
      const device = deviceScopeContext(request, reply, 'listing:review');
      if (!device) return reply;
      reply.header('Cache-Control', 'no-store');
      return reply.send({
        code: 1,
        msg: 'ok',
        data: { rules: await productSelectionRepository.listRules(device.ownerUserId) },
      });
    });
    app.post('/product-selection/rules', { preHandler }, async (request, reply) => {
      const device = deviceScopeContext(request, reply, 'listing:write');
      if (!device) return reply;
      const parsed = productSelectionRuleSchema.safeParse(request.body);
      if (!parsed.success) return invalidInput(reply);
      return reply.send({
        code: 1,
        msg: '已保存',
        data: { rule: await productSelectionRepository.saveRule(device.ownerUserId, parsed.data) },
      });
    });
    app.post('/product-selection/rules/:id/toggle', { preHandler }, async (request, reply) => {
      const device = deviceScopeContext(request, reply, 'listing:write');
      if (!device) return reply;
      const id = String((request.params as any).id || '').trim();
      const parsed = toggleProductSelectionRuleSchema.safeParse(request.body || {});
      if (!id || !parsed.success) return invalidInput(reply);
      const result = await productSelectionRepository.toggleRule(device.ownerUserId, id, parsed.data.enabled);
      if (!result) return reply.status(404).send({ code: 0, errorCode: 'rule_not_found', msg: '规则不存在' });
      return reply.send({ code: 1, msg: '已更新', data: result });
    });
    app.post('/product-selection/rules/:id/delete', { preHandler }, async (request, reply) => {
      const device = deviceScopeContext(request, reply, 'listing:write');
      if (!device) return reply;
      const id = String((request.params as any).id || '').trim();
      if (!id) return invalidInput(reply);
      await productSelectionRepository.deleteRule(device.ownerUserId, id);
      return reply.send({ code: 1, msg: '已删除', data: { id } });
    });
  }

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
      return reply.send({ code: 1, msg: 'ok', data: data.map(authorizedShopResponseData) });
    });
  }

  if (options.authenticateCollectDevice && options.collectBatch) {
    const collectBatch = options.collectBatch;
    app.post('/collect/batch', {
      bodyLimit: 10 * 1024 * 1024,
      preHandler: [options.authenticateCollectDevice],
    }, async (request, reply) => {
      const device = deviceContext(request);
      if (!device) {
        return reply.status(401).send({
          code: 0,
          errorCode: 'invalid_device_context',
          msg: '无效的设备令牌',
        });
      }
      const scopes = (request as any).device?.scopes;
      if (!Array.isArray(scopes) || !scopes.includes('capture:write')) {
        return reply.status(403).send({
          code: 0,
          errorCode: 'insufficient_scope',
          msg: '设备权限不足',
        });
      }
      const body = request.body as {
        items?: unknown;
        collectPhase?: unknown;
        ephemeralListing?: unknown;
        ephemeralListingSource?: unknown;
      };
      if (!body || !Array.isArray(body.items)) {
        return reply.status(400).send({ code: 0, errorCode: 'invalid_collect_payload', msg: '请提供商品数据' });
      }
      const result = await collectBatch({
        ownerUserId: device.ownerUserId,
        actorUserId: device.actorUserId,
        body: {
          items: body.items,
          ...(typeof body.collectPhase === 'string' ? { collectPhase: body.collectPhase } : {}),
          ...(typeof body.ephemeralListing === 'boolean' ? { ephemeralListing: body.ephemeralListing } : {}),
          ...(typeof body.ephemeralListingSource === 'string' ? { ephemeralListingSource: body.ephemeralListingSource } : {}),
        },
        log: request.log,
      });
      return reply.status(result.statusCode).send(result.body);
    });
  }

  if (options.authenticateCollectDevice && options.storeImage) {
    const storeImage = options.storeImage;
    app.post('/images', {
      bodyLimit: DEVICE_IMAGE_BODY_LIMIT,
      preHandler: [options.authenticateCollectDevice],
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const device = deviceScopeContext(request, reply, 'capture:write');
      if (!device) return reply;
      const parsed = deviceImageSchema.safeParse(request.body);
      if (!parsed.success) return invalidInput(reply);
      if (parsed.data.shopId && !device.allowedShopIds.includes(parsed.data.shopId)) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      const result = await storeImage({ ownerUserId: device.ownerUserId, ...parsed.data });
      if (!result.ok) {
        return reply.status(result.statusCode).send({
          code: 0,
          errorCode: 'image_upload_rejected',
          msg: result.msg,
        });
      }
      return reply.send({ code: 1, msg: 'ok', data: result.data });
    });
  }

  if (options.authenticateCollectDevice && options.syncDirectListing) {
    const syncDirectListing = options.syncDirectListing;
    app.post('/direct-listings', {
      bodyLimit: DIRECT_LISTING_BODY_LIMIT,
      preHandler: [options.authenticateCollectDevice],
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const device = deviceScopeContext(request, reply, 'capture:write');
      if (!device) return reply;
      const parsed = directListingSyncSchema.safeParse(request.body);
      if (!parsed.success) return invalidInput(reply);
      if (parsed.data.shopId && !device.allowedShopIds.includes(parsed.data.shopId)) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      const data = await syncDirectListing({ ownerUserId: device.ownerUserId, payload: parsed.data });
      return reply.send({ code: 1, msg: 'ok', data });
    });
  }

  const readOzonCdnAuth = options.shopRepository?.readOzonCdnAuth;
  if (options.authenticateDevice && readOzonCdnAuth) {
    app.get('/shops/:shopId/ozon-cdn-auth', {
      preHandler: [options.authenticateDevice],
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = shopParamsSchema.safeParse(request.params);
      if (!params.success) return invalidInput(reply);
      const device = deviceShopContext(request, reply, params.data.shopId, null);
      if (!device) return reply;

      const status = await readOzonCdnAuth({
        ownerUserId: device.ownerUserId,
        shopId: params.data.shopId,
      });
      if (!status) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      return reply.send({ code: 1, msg: 'ok', data: ozonCdnAuthResponseData(status) });
    });
  }

  const updateOzonCdnAuth = options.shopRepository?.updateOzonCdnAuth;
  if (options.authenticateShopAnalyticsDevice && updateOzonCdnAuth) {
    app.put('/shops/:shopId/ozon-cdn-auth', {
      bodyLimit: OZON_CDN_AUTH_BODY_LIMIT,
      preHandler: [options.authenticateShopAnalyticsDevice],
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const params = shopParamsSchema.safeParse(request.params);
      if (!params.success) return invalidInput(reply);
      const parsed = ozonCdnAuthSchema.safeParse(request.body);
      if (!parsed.success) return invalidOzonCdnAuthPayload(reply);
      const device = deviceShopContext(request, reply, params.data.shopId);
      if (!device) return reply;

      let status;
      try {
        status = await updateOzonCdnAuth({
          ownerUserId: device.ownerUserId,
          shopId: params.data.shopId,
          ...parsed.data,
        });
      } catch (error) {
        if (error instanceof ExtensionDeviceShopConfigConflictError) {
          return reply.status(409).send({
            code: 0,
            errorCode: 'ozon_cdn_auth_conflict',
            msg: '店铺配置已变化，请重新同步',
          });
        }
        throw error;
      }
      if (!status) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'device_shop_not_found',
          msg: '店铺未授权给该设备',
        });
      }
      return reply.send({
        code: 1,
        msg: '已保存',
        data: ozonCdnAuthResponseData(status),
      });
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
