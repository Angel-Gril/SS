import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRuntimeConfig, getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const syncCookieSchema = z.object({
  shopId: z.string().min(1),
  cookie: z.string().min(1),
  companyId: z.union([z.string(), z.number()]).optional(),
});

function buildExtensionRuntimePayload(config: Awaited<ReturnType<typeof getRuntimeConfigForStorage>>) {
  return {
    mode: config.mode,
    source: config.source,
    authSource: config.authSource,
    tokenRequired: config.authSource === 'token',
    localBaseUrl: config.localBaseUrl,
    capabilities: {
      imageUpload: config.imageStorage,
      sync: config.extensionSync,
      ozonCdnDirect: config.mode === 'local',
      serverSideUpload: config.mode === 'cloud',
      queuedTasks: config.extensionSync === 'queue',
      cookieSync: config.mode === 'local',
      presignedUpload: config.imageStorage === 'oss',
    },
    endpoints: {
      collect: '/api/collect',
      import1688: '/api/supply/1688/import',
      imagePresign: '/api/images/presign',
      imageUploadBase64: '/api/images/upload-base64',
      syncCookie: '/api/extension/sync-cookie',
    },
  };
}

export async function extensionConfigRoutes(app: FastifyInstance) {
  // 扩展启动时调用，获取当前运行模式和能力
  app.get('/runtime', { preHandler: [authenticate] }, async (_request, reply) => {
    const config = await getRuntimeConfigForStorage();
    return reply.send({ code: 1, data: buildExtensionRuntimePayload(config) });
  });

  // 扩展上报本地 cookie（仅 local 模式接受）
  app.post('/sync-cookie', { preHandler: [authenticate] }, async (request, reply) => {
    const config = getRuntimeConfig();
    if (config.mode === 'cloud') {
      return reply.status(400).send({
        code: 0,
        msg: '云端模式不接受本地 cookie 同步，请使用 API token',
      });
    }

    const parsed = syncCookieSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { shopId, cookie, companyId } = parsed.data;
    const { userId } = (request as any).user;

    // 本地模式：只允许同步当前账号名下店铺，存到现有 OZON CDN 配置字段。
    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId }, select: { config: true } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    const existingConfig = (shop?.config as Record<string, unknown>) || {};
    const updatedAt = new Date().toISOString();
    const newConfig = {
      ...existingConfig,
      ozonCdnCookie: cookie,
      ...(companyId != null ? { ozonCompanyId: String(companyId) } : {}),
      ozonCdnUpdatedAt: updatedAt,
    };
    await prisma.shop.update({
      where: { id: shopId },
      data: { config: newConfig },
    });

    return reply.send({
      code: 1,
      msg: 'cookie 已同步',
      data: {
        hasCookie: true,
        companyId: newConfig.ozonCompanyId || null,
        updatedAt,
      },
    });
  });
}
