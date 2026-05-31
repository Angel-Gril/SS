import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const cacheSchema = z.object({
  sku: z.string().trim().min(1),
  metrics: z.record(z.any()),
  source: z.enum(['seller-analytics', 'seller-search', 'public-api']),
});

const batchCacheSchema = z.object({
  items: z.array(z.object({
    sku: z.string().trim().min(1),
    metrics: z.record(z.any()),
    source: z.enum(['seller-analytics', 'seller-search', 'public-api']),
  })),
});

export function normalizeSkus(values: unknown[]): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  ).slice(0, 100);
}

export function dedupeCacheItems<T extends { sku: string }>(items: T[]): T[] {
  return Array.from(new Map((Array.isArray(items) ? items : []).map((item) => [item.sku, item])).values()).slice(0, 100);
}

export async function ozonAnalyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 存储 Premium 数据快照
  app.post('/cache', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = cacheSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: 0,
        msg: parsed.error.issues[0]?.message ?? '参数错误'
      });
    }

    const { sku, metrics, source } = parsed.data;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟过期

    await prisma.ozonAnalyticsCache.create({
      data: {
        userId,
        sku,
        metrics,
        source,
        expiresAt,
      },
    });

    return reply.send({ code: 1, msg: '已缓存' });
  });

  // 批量存储 Premium 数据
  app.post('/cache/batch', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = batchCacheSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        code: 0,
        msg: parsed.error.issues[0]?.message ?? '参数错误'
      });
    }

    const items = dedupeCacheItems(parsed.data.items);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    let saved = 0;
    for (const item of items) {
      try {
        await prisma.ozonAnalyticsCache.create({
          data: {
            userId,
            sku: item.sku,
            metrics: item.metrics,
            source: item.source,
            expiresAt,
          },
        });
        saved++;
      } catch (e) {
        console.warn(`[ozon-analytics] failed to cache sku=${item.sku}:`, e);
      }
    }

    return reply.send({ code: 1, msg: `已缓存 ${saved} 条数据`, data: { saved } });
  });

  // 读取缓存
  app.get('/cache', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { sku?: string };
    const sku = String(query.sku || '').trim();

    if (!sku) {
      return reply.status(400).send({ code: 0, msg: '缺少 sku 参数' });
    }

    const cache = await prisma.ozonAnalyticsCache.findFirst({
      where: {
        userId,
        sku,
        expiresAt: { gt: new Date() },
      },
      orderBy: { capturedAt: 'desc' },
    });

    if (!cache) {
      return reply.send({ code: 0, msg: '无缓存数据' });
    }

    return reply.send({
      code: 1,
      data: {
        sku: cache.sku,
        metrics: cache.metrics,
        source: cache.source,
        capturedAt: cache.capturedAt.toISOString(),
      }
    });
  });

  // 批量读取缓存
  app.post('/cache/batch-get', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { skus: string[] };

    if (!body?.skus?.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const skus = normalizeSkus(body.skus);
    if (!skus.length) {
      return reply.status(400).send({ code: 0, msg: '缺少 skus 参数' });
    }

    const caches = await prisma.ozonAnalyticsCache.findMany({
      where: {
        userId,
        sku: { in: skus },
        expiresAt: { gt: new Date() },
      },
      orderBy: { capturedAt: 'desc' },
    });

    // 每个 SKU 只返回最新的一条
    const result: Record<string, any> = {};
    for (const cache of caches) {
      if (!result[cache.sku]) {
        result[cache.sku] = {
          sku: cache.sku,
          metrics: cache.metrics,
          source: cache.source,
          capturedAt: cache.capturedAt.toISOString(),
        };
      }
    }

    return reply.send({ code: 1, data: result });
  });

  // 清理当前用户的过期缓存。全局清理应放到 worker/admin ops，避免普通用户影响其他账号数据。
  app.delete('/cache/expired', async (request, reply) => {
    const { userId } = (request as any).user;
    const deleted = await prisma.ozonAnalyticsCache.deleteMany({
      where: {
        userId,
        expiresAt: { lt: new Date() },
      },
    });

    return reply.send({
      code: 1,
      msg: `已清理 ${deleted.count} 条过期数据`,
      data: { deleted: deleted.count }
    });
  });
}
