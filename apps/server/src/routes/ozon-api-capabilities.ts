import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { decrypt } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { OzonClient } from '../services/ozon-client.js';
import { OzonApiCapabilitiesError, readOzonApiCapabilities } from '../services/ozon-api-capabilities.js';

/**
 * Read-only shop credential diagnostics. This route deliberately does not use
 * the ADMIN role as a cross-user scope: the effective account must own the shop.
 */
export async function ozonApiCapabilitiesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/:shopId', {
    preHandler: authenticate,
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user as {
      effectiveUserId?: string;
      tokenUse?: string;
    } | undefined;
    if (!user || user.tokenUse !== 'account_session' || !user.effectiveUserId) {
      return reply.status(403).send({ code: 0, errorCode: 'account_session_required', msg: '仅允许网页登录会话执行店铺诊断' });
    }
    const { shopId } = request.params as { shopId?: string };
    if (!shopId || shopId.length > 100) {
      return reply.status(400).send({ code: 0, msg: '店铺参数无效' });
    }
    const shop = await prisma.shop.findFirst({
      where: { id: shopId, userId: user.effectiveUserId, platform: 'OZON', status: 'ACTIVE' },
      select: { id: true, clientId: true, apiKeyEncrypted: true },
    });
    if (!shop) return reply.status(404).send({ code: 0, msg: '可诊断的 OZON 店铺不存在' });
    if (!shop.clientId || !shop.apiKeyEncrypted) return reply.status(400).send({ code: 0, msg: '店铺凭证未配置' });

    try {
      const data = await readOzonApiCapabilities(new OzonClient({
        clientId: shop.clientId,
        apiKey: decrypt(shop.apiKeyEncrypted),
      }));
      return reply.send({ code: 1, msg: 'ok', data });
    } catch (error) {
      if (error instanceof OzonApiCapabilitiesError) {
        return reply.status(502).send({ code: 0, errorCode: error.code, msg: error.message });
      }
      request.log.warn({ code: 'OZON_CAPABILITIES_UNAVAILABLE', shopId: shop.id }, 'Ozon API capability diagnostic failed');
      return reply.status(502).send({ code: 0, errorCode: 'OZON_CAPABILITIES_UNAVAILABLE', msg: '暂时无法读取 Ozon 授权信息，请稍后重试' });
    }
  });
}
