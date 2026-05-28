import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  label: z.string().optional(),
  group: z.string().default('general'),
  description: z.string().optional(),
});

const DEFAULTS: Array<{ key: string; value: string; label: string; group: string; description: string }> = [
  {
    key: 'image_storage_backend',
    value: 'local',
    label: '图片存储后端',
    group: 'storage',
    description: '可选：local（本地）/ ozon-cdn（OZON 临时CDN）/ oss（对象存储）。OZON CDN 的 cookie 和 company_id 由各店铺单独配置（通过浏览器扩展同步），不在此处全局设置',
  },
  {
    key: 'oss_config',
    value: '',
    label: 'OSS 配置 (JSON)',
    group: 'storage',
    description: 'S3 兼容存储配置。JSON: { endpoint, bucket, accessKeyId, accessKeySecret, region, cdnDomain?, pathPrefix? }。支持阿里云/腾讯云/CF R2/AWS/MinIO',
  },
  {
    key: 'ozon_cdn_relay_url',
    value: '',
    label: 'OZON CDN 中转地址',
    group: 'storage',
    description: 'CF Worker 反代地址（如 https://your-worker.workers.dev）。设置后 OZON CDN 上传走此中转，解决国内直连 upload.seller.ozon.ru 不通的问题。留空则直连',
  },
  {
    key: 'local_base_url',
    value: 'http://localhost:3001',
    label: '本地服务公网地址',
    group: 'storage',
    description: '本地存储模式下，OZON 服务器拉图用的地址（需公网可达，本地测试用 ngrok）',
  },
  {
    key: 'feature_customer_chat',
    value: 'false',
    label: '客服聊天功能',
    group: 'feature',
    description: '是否启用 OZON 店铺客服聊天集成',
  },
  {
    key: 'feature_image_translate',
    value: 'false',
    label: '图片翻译功能',
    group: 'feature',
    description: '是否启用图片 OCR + 翻译',
  },
  {
    key: 'randomize_enabled',
    value: 'false',
    label: '货号/尺寸/重量随机化总开关',
    group: 'randomize',
    description: '总开关：关闭则所有随机化均不生效。打开后用户上品页可单独切换"随机货号"',
  },
  {
    key: 'randomize_offer_id',
    value: 'true',
    label: '允许随机货号',
    group: 'randomize',
    description: '允许在跟卖/复制时生成随机 offer_id（基于源 SKU + 随机后缀）。默认值是开启，用户端仍可单独关闭',
  },
  {
    key: 'randomize_dimension_jitter_mm',
    value: '10',
    label: '尺寸浮动范围（mm）',
    group: 'randomize',
    description: '长/宽/高在原值 ±N mm 范围内随机浮动，避免被官方判定为重复商品。设为 0 关闭尺寸浮动',
  },
  {
    key: 'randomize_weight_buckets',
    value: '0-250,250-500,500-1000,1000-2000,2000-5000',
    label: '重量分档区间（g）',
    group: 'randomize',
    description: '逗号分隔的区间，每段写为"下限-上限"。原重量落在哪段就在该段内随机一个值。例：0-250 表示 0g 到 250g',
  },
  {
    key: 'randomize_dimension_min_mm',
    value: '10',
    label: '尺寸最小值兜底（mm）',
    group: 'randomize',
    description: '随机浮动后小于此值则取此值，避免出现 0 或负数尺寸',
  },
];

export async function seedSystemConfig() {
  // 清理已废弃的全局 OZON CDN 认证配置（改为按店铺存储）
  await prisma.systemConfig.deleteMany({
    where: { key: { in: ['ozon_cdn_cookie', 'ozon_cdn_company_id'] } },
  });

  for (const item of DEFAULTS) {
    const existing = await prisma.systemConfig.findUnique({ where: { key: item.key } });
    if (!existing) {
      await prisma.systemConfig.create({ data: item });
    }
  }
}

export async function systemConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/', async (request, reply) => {
    const { group } = request.query as { group?: string };
    const where = group ? { group } : undefined;
    const configs = await prisma.systemConfig.findMany({ where, orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    return reply.send({ code: 1, msg: 'ok', data: configs });
  });

  app.get('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    if (!config) return reply.status(404).send({ code: 0, msg: '配置不存在' });
    return reply.send({ code: 1, msg: 'ok', data: config });
  });

  app.put('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value: string };
    if (typeof body?.value !== 'string') {
      return reply.status(400).send({ code: 0, msg: '缺少 value 字段' });
    }
    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: body.value, group: 'general' },
      update: { value: body.value },
    });
    return reply.send({ code: 1, msg: '已保存', data: config });
  });

  app.post('/', async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const config = await prisma.systemConfig.upsert({
      where: { key: parsed.data.key },
      create: parsed.data,
      update: parsed.data,
    });
    return reply.send({ code: 1, msg: '已保存', data: config });
  });

  app.delete('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    await prisma.systemConfig.deleteMany({ where: { key } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.post('/seed', async (_request, reply) => {
    await seedSystemConfig();
    return reply.send({ code: 1, msg: '默认配置已初始化' });
  });
}
