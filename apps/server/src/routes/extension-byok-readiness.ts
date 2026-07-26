import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ExtensionByokReadinessDecision } from '../services/extension-byok-policy.js';
import {
  createExtensionByokReadinessAttestation,
  ExtensionByokReadinessAttestationError,
  parseExtensionByokReadinessRequest,
} from '../services/extension-byok-readiness-attestation.js';

interface ReadinessDevice {
  sessionId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionByokReadinessRoutesOptions {
  authenticateDevice(request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<{
    id: string;
    ownerUserId: string;
    shopId: string;
    revision: number;
    draftVersion: number;
  } | null>;
  getReadiness(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
    providerOrigin: string;
    operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
  }): Promise<ExtensionByokReadinessDecision>;
  now?: () => Date;
}

function routeError(reply: FastifyReply, status: number, code: string, message: string) {
  reply.header('Cache-Control', 'no-store');
  return reply.status(status).send({ code: 0, errorCode: code, msg: message });
}

function deviceContext(request: FastifyRequest): ReadinessDevice | null {
  const value = (request as any).device as Partial<ReadinessDevice> | undefined;
  if (!value
    || typeof value.sessionId !== 'string'
    || typeof value.ownerUserId !== 'string'
    || value.actorUserId !== value.ownerUserId
    || !Array.isArray(value.scopes)
    || !value.scopes.includes('byok:media:ingest')
    || !Array.isArray(value.allowedShopIds)) return null;
  return value as ReadinessDevice;
}

export async function extensionByokReadinessRoutes(
  app: FastifyInstance,
  options: ExtensionByokReadinessRoutesOptions,
) {
  app.post('/readiness', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const device = deviceContext(request);
    if (!device) return routeError(reply, 403, 'byok_readiness_scope_denied', '设备缺少 BYOK 权限');
    let parsed;
    try {
      parsed = parseExtensionByokReadinessRequest(request.body);
    } catch (error) {
      if (error instanceof ExtensionByokReadinessAttestationError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'BYOK readiness 请求无效');
      }
      throw error;
    }
    if (!device.allowedShopIds.includes(parsed.shopId)) {
      return routeError(reply, 403, 'byok_readiness_shop_denied', '设备无权访问该店铺');
    }
    try {
      const [shop, draft, decision] = await Promise.all([
        options.loadShop({ shopId: parsed.shopId, ownerUserId: device.ownerUserId }),
        parsed.workflowId
          ? options.loadDraft({ workflowId: parsed.workflowId, ownerUserId: device.ownerUserId })
          : Promise.resolve(null),
        options.getReadiness({
          ownerUserId: device.ownerUserId,
          shopId: parsed.shopId,
          deviceSessionId: device.sessionId,
          providerOrigin: parsed.providerOrigin,
          operation: parsed.operation,
        }),
      ]);
      if (!shop
        || shop.id !== parsed.shopId
        || shop.userId !== device.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE') {
        return routeError(reply, 403, 'byok_readiness_shop_denied', '店铺不可用于 BYOK');
      }
      if (parsed.workflowId && (!draft
        || draft.id !== parsed.workflowId
        || draft.ownerUserId !== device.ownerUserId
        || draft.shopId !== parsed.shopId
        || draft.revision !== parsed.draftRevision
        || draft.draftVersion !== parsed.draftVersion)) {
        return routeError(reply, 409, 'byok_readiness_draft_stale', '商品草稿已变化');
      }
      const attestation = createExtensionByokReadinessAttestation({
        ownerUserId: device.ownerUserId,
        deviceSessionId: device.sessionId,
        request: parsed,
        decision,
        now: (options.now || (() => new Date()))(),
      });
      return reply.send({ code: 1, data: attestation });
    } catch (error) {
      if (error instanceof ExtensionByokReadinessAttestationError) {
        return routeError(reply, error.statusCode, error.code.toLowerCase(), 'BYOK Provider 尚未就绪');
      }
      request.log.error({ err: error }, 'extension BYOK readiness failed');
      return routeError(reply, 503, 'byok_readiness_unavailable', 'BYOK readiness 暂不可用');
    }
  });
}
