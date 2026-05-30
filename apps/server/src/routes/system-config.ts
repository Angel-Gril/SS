import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { invalidateFeatureCache } from '../lib/feature-flags.js';
import { invalidateMaintenanceCache } from '../lib/maintenance.js';

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  label: z.string().optional(),
  group: z.string().default('general'),
  description: z.string().optional(),
});

const SECRET_FIELDS: string[] = [];
const SECRET_KEYS = new Set<string>();

function maskSecretValue(key: string, value: string): string {
  if (!SECRET_KEYS.has(key) || !value) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      for (const field of SECRET_FIELDS) {
        if (parsed[field] && typeof parsed[field] === 'string' && parsed[field].length > 0) {
          parsed[field] = '***MASKED***';
        }
      }
      return JSON.stringify(parsed);
    }
  } catch {
    // 非 JSON 字符串：整体掩码（保留前 4 后 4）
    if (value.length > 12) {
      return `${value.slice(0, 4)}***${value.slice(-4)}`;
    }
    return '***MASKED***';
  }
  return value;
}

// 用户提交时如果某 secret 字段是 ***MASKED*** 占位符，保留原值
function mergeMaskedValue(key: string, newValue: string, oldValue: string): string {
  if (!SECRET_KEYS.has(key) || !oldValue) return newValue;
  try {
    const next = JSON.parse(newValue);
    const prev = JSON.parse(oldValue);
    if (next && prev && typeof next === 'object' && typeof prev === 'object') {
      for (const field of SECRET_FIELDS) {
        if (next[field] === '***MASKED***' && prev[field]) {
          next[field] = prev[field];
        }
      }
      return JSON.stringify(next);
    }
  } catch {
    // ignore
  }
  return newValue;
}

function invalidateConfigCaches(key?: string) {
  if (!key || key.startsWith('feature_')) invalidateFeatureCache(key);
  if (!key || key.startsWith('maintenance_')) invalidateMaintenanceCache();
}

const DEFAULTS: Array<{ key: string; value: string; label: string; group: string; description: string }> = [
  // ─── feature ───
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
    key: 'feature_oss_upload',
    value: 'true',
    label: 'OSS 上传',
    group: 'feature',
    description: '是否启用 OSS 对象存储上传（关闭后走本地或 OZON CDN）',
  },
  {
    key: 'feature_ozon_cdn_fallback',
    value: 'true',
    label: 'OZON CDN 降级',
    group: 'feature',
    description: 'OSS 上传失败时自动降级到 OZON CDN',
  },
  {
    key: 'feature_extension_list_overlay',
    value: 'true',
    label: '扩展列表覆盖层',
    group: 'feature',
    description: '浏览器扩展在 OZON 商品列表页显示覆盖层',
  },
  {
    key: 'feature_new_listing_flow',
    value: 'false',
    label: '新版上架流程',
    group: 'feature',
    description: '启用新版上架流程（实验性）',
  },
  {
    key: 'feature_announcement_popup',
    value: 'true',
    label: '公告弹窗',
    group: 'feature',
    description: '是否在用户登录后弹出未读公告',
  },
  {
    key: 'feature_sms_register',
    value: 'true',
    label: '短信注册',
    group: 'feature',
    description: '是否允许通过短信验证码注册新账号',
  },
  {
    key: 'feature_turnstile_login',
    value: 'true',
    label: 'Turnstile 登录验证',
    group: 'feature',
    description: '登录时是否要求 Cloudflare Turnstile 人机验证',
  },
  // ─── security ───
  {
    key: 'security_login_max_attempts',
    value: '5',
    label: '登录失败锁定阈值',
    group: 'security',
    description: '同一 IP 登录失败次数达到该值后强制要求 Turnstile 人机验证（云端模式）',
  },
  {
    key: 'security_admin_ip_whitelist',
    value: '',
    label: '管理员 IP 白名单',
    group: 'security',
    description: '逗号分隔的 CIDR 列表（如 1.2.3.4/32,10.0.0.0/8）。留空表示不限制。生效需重启服务',
  },
  {
    key: 'security_session_ttl_hours',
    value: '168',
    label: '会话有效期（小时）',
    group: 'security',
    description: '默认 168（7天）。修改后只对新发放的 token 生效',
  },
  {
    key: 'security_admin_session_ttl_hours',
    value: '24',
    label: '管理员会话有效期（小时）',
    group: 'security',
    description: '管理员独立登录入口的 token 有效期，默认 24 小时',
  },
  {
    key: 'security_audit_log_enabled',
    value: 'false',
    label: '审计日志（计划中）',
    group: 'security',
    description: '记录管理员/超管的写操作。Phase B5 任务，启用前需先建表',
  },
  // ─── retention ───
  {
    key: 'retention_collect_archive_days',
    value: '365',
    label: '采集数据归档天数',
    group: 'retention',
    description: '超过此天数的采集记录标记为归档（第一阶段仅统计，不删除）',
  },
  {
    key: 'retention_collect_min_keep',
    value: '200',
    label: '采集数据最少保留条数',
    group: 'retention',
    description: '即使超过归档天数，每个用户至少保留此数量的采集记录',
  },
  {
    key: 'retention_cainiao_unbound_days',
    value: '30',
    label: '菜鸟未绑定缓存保留天数',
    group: 'retention',
    description: '未绑定到订单的菜鸟包裹缓存保留天数',
  },
  {
    key: 'retention_cainiao_bound_days',
    value: '180',
    label: '菜鸟已绑定缓存保留天数',
    group: 'retention',
    description: '已绑定到订单的菜鸟包裹缓存保留天数',
  },
  {
    key: 'retention_sync_success_days',
    value: '30',
    label: '成功同步任务保留天数',
    group: 'retention',
    description: '状态为 SUCCESS 的 SyncJob 记录保留天数',
  },
  {
    key: 'retention_sync_failed_days',
    value: '180',
    label: '失败同步任务保留天数',
    group: 'retention',
    description: '状态为 FAILED 的 SyncJob 记录保留天数（便于排查问题）',
  },
  {
    key: 'retention_notification_read_days',
    value: '90',
    label: '已读通知保留天数',
    group: 'retention',
    description: '已读通知超过此天数后自动清理',
  },
  {
    key: 'retention_notification_unread_days',
    value: '365',
    label: '未读通知保留天数',
    group: 'retention',
    description: '未读通知超过此天数后自动清理',
  },
  {
    key: 'retention_temp_images_days',
    value: '30',
    label: '临时图片保留天数',
    group: 'retention',
    description: '临时上传目录中超过此天数的图片自动清理',
  },
  {
    key: 'retention_cleanup_dry_run',
    value: 'true',
    label: '清理 dry-run 模式',
    group: 'retention',
    description: '开启时只统计不删除，关闭后才真正执行清理',
  },
  // ─── backup ───
  {
    key: 'backup_enabled',
    value: 'true',
    label: '自动备份',
    group: 'backup',
    description: '是否启用定时数据库备份',
  },
  {
    key: 'backup_schedule',
    value: '0 3 * * *',
    label: '备份 cron 表达式',
    group: 'backup',
    description: '备份执行时间（cron 格式），默认每天凌晨 3 点',
  },
  {
    key: 'backup_local_keep_days',
    value: '7',
    label: '本地备份保留天数',
    group: 'backup',
    description: '本地备份文件超过此天数后自动清理',
  },
  {
    key: 'backup_remote_enabled',
    value: 'false',
    label: '远程备份',
    group: 'backup',
    description: '是否将备份上传到远程存储（S3 兼容）',
  },
  {
    key: 'backup_remote_keep_days',
    value: '30',
    label: '远程备份保留天数',
    group: 'backup',
    description: '远程存储中超过此天数的备份自动清理',
  },
  {
    key: 'backup_remote_provider',
    value: 's3',
    label: '远程存储类型',
    group: 'backup',
    description: '远程备份存储类型（目前仅支持 s3 兼容）',
  },
  {
    key: 'backup_remote_bucket',
    value: '',
    label: '远程存储 Bucket',
    group: 'backup',
    description: '远程备份目标 bucket 名称',
  },
  {
    key: 'backup_remote_endpoint',
    value: '',
    label: '远程存储 Endpoint',
    group: 'backup',
    description: '远程备份 S3 兼容 endpoint URL',
  },
  {
    key: 'backup_remote_region',
    value: 'auto',
    label: '远程存储 Region',
    group: 'backup',
    description: '远程备份存储区域',
  },
  {
    key: 'backup_remote_prefix',
    value: 'db/',
    label: '远程存储路径前缀',
    group: 'backup',
    description: '远程备份文件在 bucket 中的路径前缀',
  },
  // ─── maintenance ───
  {
    key: 'maintenance_enabled',
    value: 'false',
    label: '维护模式',
    group: 'maintenance',
    description: '开启后普通用户写接口返回 503，管理员仍可访问',
  },
  {
    key: 'maintenance_message',
    value: '系统维护中，请稍后再试',
    label: '维护提示信息',
    group: 'maintenance',
    description: '维护模式下返回给用户的提示文案',
  },
  {
    key: 'maintenance_allow_admin',
    value: 'true',
    label: '管理员免维护',
    group: 'maintenance',
    description: '维护模式下管理员是否可以继续访问',
  },
  {
    key: 'maintenance_readonly',
    value: 'true',
    label: '只读模式',
    group: 'maintenance',
    description: '维护模式下是否允许读接口通过（仅拦截写操作）',
  },
  // ─── version ───
  {
    key: 'version_web_check_interval_hours',
    value: '8',
    label: 'Web 版本检查间隔（小时）',
    group: 'version',
    description: '前端检查新版本的间隔时间',
  },
  {
    key: 'version_extension_check_interval_hours',
    value: '8',
    label: '扩展版本检查间隔（小时）',
    group: 'version',
    description: '浏览器扩展检查新版本的间隔时间',
  },
  {
    key: 'version_force_refresh_enabled',
    value: 'false',
    label: '强制刷新',
    group: 'version',
    description: '检测到新版本时是否强制用户刷新页面',
  },
  // ─── randomize ───
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
  // 清理已废弃的配置（storage 组已迁移到环境变量）
  await prisma.systemConfig.deleteMany({
    where: {
      key: {
        in: [
          'ozon_cdn_cookie', 'ozon_cdn_company_id',
          'image_storage_backend', 'oss_config', 'ozon_cdn_relay_url',
          'local_base_url', 'integration_oss_fallback_to_cdn',
        ],
      },
    },
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
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/', async (request, reply) => {
    const { group } = request.query as { group?: string };
    const where = group ? { group } : undefined;
    const configs = await prisma.systemConfig.findMany({ where, orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    const masked = configs.map((c) => ({ ...c, value: maskSecretValue(c.key, c.value) }));
    return reply.send({ code: 1, msg: 'ok', data: masked });
  });

  app.get('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    if (!config) return reply.status(404).send({ code: 0, msg: '配置不存在' });
    return reply.send({ code: 1, msg: 'ok', data: { ...config, value: maskSecretValue(config.key, config.value) } });
  });

  app.put('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = request.body as { value: string };
    if (typeof body?.value !== 'string') {
      return reply.status(400).send({ code: 0, msg: '缺少 value 字段' });
    }
    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    const finalValue = mergeMaskedValue(key, body.value, existing?.value || '');
    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: finalValue, group: 'general' },
      update: { value: finalValue },
    });
    invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: maskSecretValue(config.key, config.value) } });
  });

  app.post('/', async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const existing = await prisma.systemConfig.findUnique({ where: { key: parsed.data.key } });
    const finalValue = mergeMaskedValue(parsed.data.key, parsed.data.value, existing?.value || '');
    const config = await prisma.systemConfig.upsert({
      where: { key: parsed.data.key },
      create: { ...parsed.data, value: finalValue },
      update: { ...parsed.data, value: finalValue },
    });
    invalidateConfigCaches(parsed.data.key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: maskSecretValue(config.key, config.value) } });
  });

  app.delete('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    await prisma.systemConfig.deleteMany({ where: { key } });
    invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.post('/seed', async (_request, reply) => {
    await seedSystemConfig();
    invalidateConfigCaches();
    return reply.send({ code: 1, msg: '默认配置已初始化' });
  });
}
