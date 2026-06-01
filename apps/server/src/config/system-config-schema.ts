import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema 定义：所有 SystemConfig key 的类型、默认值、校验规则
// ─────────────────────────────────────────────────────────────────────────────

export const SystemConfigSchema = {
  // ─── feature ───
  feature_customer_chat: z.boolean().default(false),
  feature_image_translate: z.boolean().default(false),
  feature_oss_upload: z.boolean().default(true),
  feature_ozon_cdn_fallback: z.boolean().default(true),
  feature_extension_list_overlay: z.boolean().default(true),
  feature_new_listing_flow: z.boolean().default(false),
  feature_announcement_popup: z.boolean().default(true),
  feature_sms_register: z.boolean().default(true),
  feature_turnstile_login: z.boolean().default(true),

  // ─── security ───
  security_login_max_attempts: z.number().int().min(1).max(100).default(5),
  security_admin_ip_whitelist: z.string().default(''),
  security_session_ttl_hours: z.number().int().min(1).max(720).default(168),
  security_admin_session_ttl_hours: z.number().int().min(1).max(168).default(24),
  security_audit_log_enabled: z.boolean().default(false),

  // ─── upload ───
  upload_rate_limit_enabled: z.boolean().default(true),
  upload_rate_limit_per_minute: z.number().int().min(1).max(100).default(10),
  upload_daily_quota_enabled: z.boolean().default(true),
  upload_daily_quota_mb: z.number().int().min(100).max(10000).default(1024),
  upload_referer_check_enabled: z.boolean().default(true),
  upload_storage_backend: z.enum(['env', 'local', 'oss', 'ozon-cdn']).default('env'),
  upload_oss_endpoint: z.string().default(''),
  upload_oss_bucket: z.string().default(''),
  upload_oss_access_key_id: z.string().default(''),
  upload_oss_access_key_secret: z.string().default(''),
  upload_oss_region: z.string().default('auto'),
  upload_oss_cdn_domain: z.string().default(''),
  upload_ozon_cdn_relay_url: z.string().default(''),
  upload_local_base_url: z.string().default(''),

  // ─── retention ───
  retention_collect_archive_days: z.number().int().min(30).max(3650).default(365),
  retention_collect_min_keep: z.number().int().min(0).max(10000).default(200),
  retention_cainiao_unbound_days: z.number().int().min(1).max(365).default(30),
  retention_cainiao_bound_days: z.number().int().min(1).max(3650).default(180),
  retention_sync_success_days: z.number().int().min(1).max(365).default(30),
  retention_sync_failed_days: z.number().int().min(1).max(3650).default(180),
  retention_notification_read_days: z.number().int().min(1).max(3650).default(90),
  retention_notification_unread_days: z.number().int().min(1).max(3650).default(365),
  retention_temp_images_days: z.number().int().min(1).max(365).default(30),
  retention_cleanup_dry_run: z.boolean().default(true),

  // ─── OSS 对象生命周期 ───
  retention_oss_raw_days: z.number().int().min(1).max(365).default(15),
  retention_oss_watermarked_days: z.number().int().min(1).max(365).default(60),
  retention_oss_tmp_days: z.number().int().min(1).max(365).default(7),
  retention_oss_attachments_days: z.number().int().min(0).max(3650).default(0),
  retention_oss_cleanup_enabled: z.boolean().default(false),
  retention_oss_cleanup_dry_run: z.boolean().default(true),

  // ─── backup ───
  backup_enabled: z.boolean().default(true),
  backup_schedule: z.string().regex(/^[\d\s\*\/\-,]+$/).default('0 3 * * *'),
  backup_local_keep_days: z.number().int().min(1).max(365).default(7),
  backup_remote_enabled: z.boolean().default(false),
  backup_remote_keep_days: z.number().int().min(1).max(3650).default(30),
  backup_remote_provider: z.enum(['s3']).default('s3'),
  backup_remote_bucket: z.string().default(''),
  backup_remote_endpoint: z.string().default(''),
  backup_remote_region: z.string().default('auto'),
  backup_remote_prefix: z.string().default('db/'),

  // ─── maintenance ───
  maintenance_enabled: z.boolean().default(false),
  maintenance_message: z.string().default('系统维护中，请稍后再试'),
  maintenance_allow_admin: z.boolean().default(true),
  maintenance_readonly: z.boolean().default(true),

  // ─── version ───
  version_web_check_interval_hours: z.number().int().min(1).max(168).default(8),
  version_extension_check_interval_hours: z.number().int().min(1).max(168).default(8),
  version_force_refresh_enabled: z.boolean().default(false),

  // ─── randomize ───
  randomize_enabled: z.boolean().default(false),
  randomize_offer_id: z.boolean().default(true),
  randomize_dimension_jitter_mm: z.number().int().min(0).max(100).default(10),
  randomize_weight_buckets: z.string().default('0-250,250-500,500-1000,1000-2000,2000-5000'),
  randomize_dimension_min_mm: z.number().int().min(1).max(1000).default(10),
} as const;

export type SystemConfigKey = keyof typeof SystemConfigSchema;
export type SystemConfigValue<K extends SystemConfigKey> = z.infer<typeof SystemConfigSchema[K]>;

// ─────────────────────────────────────────────────────────────────────────────
// 元数据：label、group、description、是否敏感
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigMeta {
  label: string;
  group: string;
  description: string;
  sensitive?: boolean;
}

export const SystemConfigMeta: Record<SystemConfigKey, ConfigMeta> = {
  feature_customer_chat: { label: '客服聊天功能', group: 'feature', description: '是否启用 OZON 店铺客服聊天集成' },
  feature_image_translate: { label: '图片翻译功能', group: 'feature', description: '是否启用图片 OCR + 翻译' },
  feature_oss_upload: { label: 'OSS 上传', group: 'feature', description: '是否启用 OSS 对象存储上传（关闭后走本地或 OZON CDN）' },
  feature_ozon_cdn_fallback: { label: 'OZON CDN 降级', group: 'feature', description: 'OSS 上传失败时自动降级到 OZON CDN' },
  feature_extension_list_overlay: { label: '扩展列表覆盖层', group: 'feature', description: '浏览器扩展在 OZON 商品列表页显示覆盖层' },
  feature_new_listing_flow: { label: '新版上架流程', group: 'feature', description: '启用新版上架流程（实验性）' },
  feature_announcement_popup: { label: '公告弹窗', group: 'feature', description: '是否在用户登录后弹出未读公告' },
  feature_sms_register: { label: '短信注册', group: 'feature', description: '是否允许通过短信验证码注册新账号' },
  feature_turnstile_login: { label: 'Turnstile 登录验证', group: 'feature', description: '登录时是否要求 Cloudflare Turnstile 人机验证' },

  security_login_max_attempts: { label: '登录失败锁定阈值', group: 'security', description: '同一 IP 登录失败次数达到该值后强制要求 Turnstile 人机验证（云端模式）' },
  security_admin_ip_whitelist: { label: '管理员 IP 白名单', group: 'security', description: '逗号分隔的 CIDR 列表（如 1.2.3.4/32,10.0.0.0/8）。留空表示不限制。生效需重启服务', sensitive: true },
  security_session_ttl_hours: { label: '会话有效期（小时）', group: 'security', description: '默认 168（7天）。修改后只对新发放的 token 生效' },
  security_admin_session_ttl_hours: { label: '管理员会话有效期（小时）', group: 'security', description: '管理员独立登录入口的 token 有效期，默认 24 小时' },
  security_audit_log_enabled: { label: '审计日志', group: 'security', description: '记录管理员/超管的写操作（需先建表）' },

  upload_rate_limit_enabled: { label: '上传频率限制', group: 'upload', description: '是否启用单用户上传频率限制' },
  upload_rate_limit_per_minute: { label: '每分钟上传次数', group: 'upload', description: '单用户每分钟最多上传次数（默认 10 次）' },
  upload_daily_quota_enabled: { label: '每日上传配额', group: 'upload', description: '是否启用单用户每日上传流量配额' },
  upload_daily_quota_mb: { label: '每日上传配额（MB）', group: 'upload', description: '单用户每日最多上传流量（默认 1024MB = 1GB）' },
  upload_referer_check_enabled: { label: 'Referer 检查', group: 'upload', description: '是否检查 Referer 防止盗链（仅对 /cdn/* 路径生效）' },
  upload_storage_backend: { label: '图片/附件存储后端', group: 'upload', description: 'env 表示跟随服务器环境变量；云端 R2 测试请选择 oss' },
  upload_oss_endpoint: { label: 'R2/OSS Endpoint', group: 'upload', description: 'S3 兼容 endpoint，例如 https://<account-id>.r2.cloudflarestorage.com', sensitive: true },
  upload_oss_bucket: { label: 'R2/OSS Bucket', group: 'upload', description: '图片/附件上传使用的 bucket 名称', sensitive: true },
  upload_oss_access_key_id: { label: 'R2/OSS Access Key ID', group: 'upload', description: 'S3 兼容访问密钥 ID', sensitive: true },
  upload_oss_access_key_secret: { label: 'R2/OSS Secret Access Key', group: 'upload', description: 'S3 兼容访问密钥 Secret', sensitive: true },
  upload_oss_region: { label: 'R2/OSS Region', group: 'upload', description: 'Cloudflare R2 通常填写 auto' },
  upload_oss_cdn_domain: { label: 'R2/OSS 公网访问域名', group: 'upload', description: '可选。为空时返回 S3 endpoint 路径；填写后返回该域名下的对象 URL' },
  upload_ozon_cdn_relay_url: { label: 'OZON CDN 中转地址', group: 'upload', description: '可选。存储后端为 ozon-cdn 或 OSS 降级时使用' },
  upload_local_base_url: { label: '本地上传 Base URL', group: 'upload', description: '存储后端为 local 时使用。为空则跟随 LOCAL_BASE_URL 环境变量' },

  retention_collect_archive_days: { label: '采集数据归档天数', group: 'retention', description: '超过此天数的采集记录标记为归档（第一阶段仅统计，不删除）' },
  retention_collect_min_keep: { label: '采集数据最少保留条数', group: 'retention', description: '即使超过归档天数，每个用户至少保留此数量的采集记录' },
  retention_cainiao_unbound_days: { label: '菜鸟未绑定缓存保留天数', group: 'retention', description: '未绑定到订单的菜鸟包裹缓存保留天数' },
  retention_cainiao_bound_days: { label: '菜鸟已绑定缓存保留天数', group: 'retention', description: '已绑定到订单的菜鸟包裹缓存保留天数' },
  retention_sync_success_days: { label: '成功同步任务保留天数', group: 'retention', description: '状态为 SUCCESS 的 SyncJob 记录保留天数' },
  retention_sync_failed_days: { label: '失败同步任务保留天数', group: 'retention', description: '状态为 FAILED 的 SyncJob 记录保留天数（便于排查问题）' },
  retention_notification_read_days: { label: '已读通知保留天数', group: 'retention', description: '已读通知超过此天数后自动清理' },
  retention_notification_unread_days: { label: '未读通知保留天数', group: 'retention', description: '未读通知超过此天数后自动清理' },
  retention_temp_images_days: { label: '临时图片保留天数', group: 'retention', description: '临时上传目录中超过此天数的图片自动清理' },
  retention_cleanup_dry_run: { label: '清理 dry-run 模式', group: 'retention', description: '开启时只统计不删除，关闭后才真正执行清理' },

  retention_oss_raw_days: { label: 'OSS 原始图保留天数', group: 'retention', description: '用户采集的原始图片在 OSS/R2 中保留天数（默认 15 天）' },
  retention_oss_watermarked_days: { label: 'OSS 水印图保留天数', group: 'retention', description: '生成的水印图在 OSS/R2 中保留天数（默认 60 天）' },
  retention_oss_tmp_days: { label: 'OSS 临时图保留天数', group: 'retention', description: '失败任务的临时图在 OSS/R2 中保留天数（默认 7 天）' },
  retention_oss_attachments_days: { label: 'OSS 附件保留天数', group: 'retention', description: '公告/系统附件保留天数（0 表示永久保留）' },
  retention_oss_cleanup_enabled: { label: 'OSS 清理总开关', group: 'retention', description: '是否启用 OSS/R2 对象自动清理' },
  retention_oss_cleanup_dry_run: { label: 'OSS 清理 dry-run', group: 'retention', description: '开启时只统计不删除，关闭后才真正删除 OSS 对象' },

  backup_enabled: { label: '自动备份', group: 'backup', description: '是否启用定时数据库备份' },
  backup_schedule: { label: '备份 cron 表达式', group: 'backup', description: '备份执行时间（cron 格式），默认每天凌晨 3 点' },
  backup_local_keep_days: { label: '本地备份保留天数', group: 'backup', description: '本地备份文件超过此天数后自动清理' },
  backup_remote_enabled: { label: '远程备份', group: 'backup', description: '是否将备份上传到远程存储（S3 兼容）' },
  backup_remote_keep_days: { label: '远程备份保留天数', group: 'backup', description: '远程存储中超过此天数的备份自动清理' },
  backup_remote_provider: { label: '远程存储类型', group: 'backup', description: '远程备份存储类型（目前仅支持 s3 兼容）' },
  backup_remote_bucket: { label: '远程存储 Bucket', group: 'backup', description: '远程备份目标 bucket 名称', sensitive: true },
  backup_remote_endpoint: { label: '远程存储 Endpoint', group: 'backup', description: '远程备份 S3 兼容 endpoint URL', sensitive: true },
  backup_remote_region: { label: '远程存储 Region', group: 'backup', description: '远程备份存储区域' },
  backup_remote_prefix: { label: '远程存储路径前缀', group: 'backup', description: '远程备份文件在 bucket 中的路径前缀' },

  maintenance_enabled: { label: '维护模式', group: 'maintenance', description: '开启后普通用户写接口返回 503，管理员仍可访问' },
  maintenance_message: { label: '维护提示信息', group: 'maintenance', description: '维护模式下返回给用户的提示文案' },
  maintenance_allow_admin: { label: '管理员免维护', group: 'maintenance', description: '维护模式下管理员是否可以继续访问' },
  maintenance_readonly: { label: '只读模式', group: 'maintenance', description: '维护模式下是否允许读接口通过（仅拦截写操作）' },

  version_web_check_interval_hours: { label: 'Web 版本检查间隔（小时）', group: 'version', description: '前端检查新版本的间隔时间' },
  version_extension_check_interval_hours: { label: '扩展版本检查间隔（小时）', group: 'version', description: '浏览器扩展检查新版本的间隔时间' },
  version_force_refresh_enabled: { label: '强制刷新', group: 'version', description: '检测到新版本时是否强制用户刷新页面' },

  randomize_enabled: { label: '货号/尺寸/重量随机化总开关', group: 'randomize', description: '总开关：关闭则所有随机化均不生效。打开后用户上品页可单独切换"随机货号"' },
  randomize_offer_id: { label: '允许随机货号', group: 'randomize', description: '允许在跟卖/复制时生成随机 offer_id（基于源 SKU + 随机后缀）。默认值是开启，用户端仍可单独关闭' },
  randomize_dimension_jitter_mm: { label: '尺寸浮动范围（mm）', group: 'randomize', description: '长/宽/高在原值 ±N mm 范围内随机浮动，避免被官方判定为重复商品。设为 0 关闭尺寸浮动' },
  randomize_weight_buckets: { label: '重量分档区间（g）', group: 'randomize', description: '逗号分隔的区间，每段写为"下限-上限"。原重量落在哪段就在该段内随机一个值。例：0-250 表示 0g 到 250g' },
  randomize_dimension_min_mm: { label: '尺寸最小值兜底（mm）', group: 'randomize', description: '随机浮动后小于此值则取此值，避免出现 0 或负数尺寸' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed Accessor：类型安全的读写接口
// ─────────────────────────────────────────────────────────────────────────────

function parseValue<K extends SystemConfigKey>(key: K, raw: string): SystemConfigValue<K> {
  const schema = SystemConfigSchema[key];
  const parsed = schema.safeParse(coerceConfigValue(key, raw));
  if (!parsed.success) {
    console.warn(`[SystemConfig] ${key} 解析失败，使用默认值:`, parsed.error.errors);
    return schema.parse(undefined); // 触发 default
  }
  return parsed.data as SystemConfigValue<K>;
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() === '') return raw;
  const num = Number(raw);
  if (!Number.isNaN(num)) return num;
  return raw;
}

export { coerceValue };

export function coerceConfigValue<K extends SystemConfigKey>(key: K, raw: string): unknown {
  const defaultValue = getDefaultValue(key);
  if (typeof defaultValue === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }
  if (typeof defaultValue === 'number') {
    if (raw.trim() === '') return raw;
    const num = Number(raw);
    return Number.isNaN(num) ? raw : num;
  }
  return raw;
}

function serializeValue<K extends SystemConfigKey>(key: K, value: SystemConfigValue<K>): string {
  return String(value);
}

export async function getConfig<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
  const record = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!record) {
    const schema = SystemConfigSchema[key];
    return schema.parse(undefined) as SystemConfigValue<K>;
  }
  return parseValue(key, record.value);
}

export async function setConfig<K extends SystemConfigKey>(
  key: K,
  value: SystemConfigValue<K>,
): Promise<void> {
  const schema = SystemConfigSchema[key];
  const validated = schema.parse(value);
  const serialized = serializeValue(key, validated as SystemConfigValue<K>);
  const meta = SystemConfigMeta[key];

  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: serialized, label: meta.label, group: meta.group, description: meta.description },
    update: { value: serialized },
  });
}

export async function getAllConfigs(): Promise<Record<string, string>> {
  const records = await prisma.systemConfig.findMany({ select: { key: true, value: true } });
  const result: Record<string, string> = {};
  for (const r of records) {
    result[r.key] = r.value;
  }
  return result;
}

export function getDefaultValue<K extends SystemConfigKey>(key: K): SystemConfigValue<K> {
  const schema = SystemConfigSchema[key];
  return schema.parse(undefined) as SystemConfigValue<K>;
}

export function validateKey(key: string): key is SystemConfigKey {
  return key in SystemConfigSchema;
}
