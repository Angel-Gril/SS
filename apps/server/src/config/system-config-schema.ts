import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import {
  AI_IMAGE_TRANSLATION_GLOSSARY_DEFAULT_JSON,
  aiImageTranslationGlossaryStringSchema,
} from '../services/ai-image-translation-glossary.js';
import {
  DEFAULT_EXTENSION_BYOK_ADMIN_POLICY_JSON,
  extensionByokAdminPolicyStringSchema,
} from '../services/extension-byok-admin-controls.js';

const sourceOzonPublisherEntrypointStage = z.enum(['off', 'shadow', 'v2']);

function isExactHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253 || value.endsWith('.')) return false;
  return value.split('.').every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  ));
}

const turnstileAllowedHostnamesSchema = z.string().max(2048).superRefine((value, ctx) => {
  const invalid = value.split(',').map((item) => item.trim()).filter(Boolean)
    .find((hostname) => !isExactHostname(hostname));
  if (invalid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `无效 hostname: ${invalid}；只能填写精确域名，不支持协议、端口、路径或通配符`,
    });
  }
});

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
  feature_extension_hosted_ai: z.boolean().default(false),
  feature_extension_byok_ai: z.boolean().default(false),
  feature_extension_byok_ingest: z.boolean().default(false),
  feature_extension_byok_publish: z.boolean().default(false),
  feature_new_listing_flow: z.boolean().default(false),
  feature_announcement_popup: z.boolean().default(true),
  feature_sms_register: z.boolean().default(true),
  feature_sms_login: z.boolean().default(false),
  feature_turnstile_login: z.boolean().default(true),
  feature_source_capture_v2: z.boolean().default(false),
  feature_source_listing_workflow: z.boolean().default(false),
  feature_source_ozon_mapping_v2_read: z.boolean().default(false),
  feature_source_ozon_mapping_v2_write: z.boolean().default(false),
  feature_source_ozon_publisher_v2: z.boolean().default(false),
  source_ozon_publisher_collect_publish_stage: sourceOzonPublisherEntrypointStage.default('off'),
  source_ozon_publisher_listing_batch_stage: sourceOzonPublisherEntrypointStage.default('off'),
  source_ozon_publisher_listing_import_by_sku_stage: sourceOzonPublisherEntrypointStage.default('off'),
  source_ozon_publisher_browser_one_click_stage: sourceOzonPublisherEntrypointStage.default('off'),
  source_ozon_publisher_extension_adapter_stage: sourceOzonPublisherEntrypointStage.default('off'),
  feature_source_network_capture: z.boolean().default(false),
  feature_ai_media_workflow_v2: z.boolean().default(false),
  feature_ai_media_image_to_image: z.boolean().default(false),
  feature_ai_media_suite: z.boolean().default(false),
  feature_ai_media_full_edit: z.boolean().default(false),
  feature_ai_media_inpaint: z.boolean().default(false),
  feature_ai_listing_copy_generation: z.boolean().default(false),
  feature_extension_product_vision: z.boolean().default(false),
  ai_media_workflow_v2_rollout_policy: z.string().max(100000).default('{"revision":0,"tenantIds":[]}'),
  feature_source_listing_web_media: z.boolean().default(false),
  feature_source_listing_extension_workbench: z.boolean().default(false),
  source_workflow_rollout_policy: z.string().max(100000).default('{}'),
  extension_byok_admin_policy: extensionByokAdminPolicyStringSchema
    .default(DEFAULT_EXTENSION_BYOK_ADMIN_POLICY_JSON),

  // ─── ai / translation ───
  ai_provider: z.enum(['disabled', 'custom']).default('disabled'),
  ai_base_url: z.string().default(''),
  ai_api_key: z.string().default(''),
  ai_model: z.string().default(''),
  ai_product_title_model: z.string().default(''),
  ai_product_description_model: z.string().default(''),
  ai_product_vision_model: z.string().max(200).default(''),
  ai_product_vision_provider: z.enum(['disabled', 'custom']).default('disabled'),
  ai_product_vision_base_url: z.string().max(4096).default(''),
  ai_product_vision_api_key: z.string().max(4096).default(''),
  ai_provider_label: z.string().default(''),
  ai_timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  ai_daily_budget_cents: z.number().int().min(0).max(10000000).default(0),
  ai_user_daily_category_translation_limit: z.number().int().min(0).max(100000).default(1000),
  ai_user_daily_product_generation_limit: z.number().int().min(0).max(100000).default(20),
  ai_user_daily_product_vision_limit: z.number().int().min(0).max(100000).default(10),
  ai_category_translation_enabled: z.boolean().default(false),
  ai_product_generation_enabled: z.boolean().default(false),
  ai_image_generation_enabled: z.boolean().default(false),
  ai_category_translation_prompt: z
    .string()
    .default(
      'Translate this Ozon category term from Russian to concise Simplified Chinese. Return only the translated term.',
    ),
  ai_product_title_prompt: z
    .string()
    .default(
      'Generate a Russian Ozon-localized product title from the source product profile. Start with the concrete product type, remove China-platform/live-stream/wholesale noise, and return JSON with title, searchTags, warnings, confidence.',
    ),
  ai_product_description_prompt: z
    .string()
    .default(
      'Generate Russian Ozon-localized product copy from the source product profile. Use only verified facts and return JSON with description, bulletPoints, searchTags, warnings, confidence.',
    ),
  ai_image_provider: z.enum(['disabled', 'dashscope-wanx', 'openai-images', 'custom']).default('disabled'),
  ai_image_base_url: z.string().default(''),
  ai_image_api_key: z.string().default(''),
  ai_image_model: z.string().default(''),
  ai_image_generation_cost_cents: z.number().int().min(0).max(100000).default(0),
  ai_image_text_to_image_model: z.string().max(500).default(''),
  ai_image_text_to_image_cost_cents: z.number().int().min(0).max(100000).default(0),
  ai_image_prompt: z
    .string()
    .default(
      'Generate or edit product images suitable for Ozon marketplace listing. Return image assets only.',
    ),
  ai_user_daily_image_generation_limit: z.number().int().min(0).max(100000).default(5),
  // Translation is deliberately isolated from generation credentials/model selection.
  // The provider remains disabled until its Unit 0B transport evidence is accepted.
  ai_image_translation_provider: z.enum(['disabled', 'dashscope-qwen-mt-image', 'fake']).default('disabled'),
  ai_image_translation_base_url: z.string().default(''),
  ai_image_translation_api_key: z.string().default(''),
  ai_image_translation_model: z.string().default('qwen-mt-image'),
  ai_image_translation_category_glossary_json: aiImageTranslationGlossaryStringSchema
    .default(AI_IMAGE_TRANSLATION_GLOSSARY_DEFAULT_JSON),
  ai_image_translation_cost_cents: z.number().int().min(0).max(100000).default(0),
  ai_user_daily_image_translation_limit: z.number().int().min(0).max(100000).default(20),

  // ─── auth / challenge ───
  auth_human_challenge_provider: z.enum(['disabled', 'cloudflare-turnstile', 'builtin-pow']).default('disabled'),
  auth_pow_signing_secret: z.string().default(''),
  auth_pow_difficulty: z.number().int().min(1).max(5).default(4),
  auth_pow_ttl_seconds: z.number().int().min(30).max(600).default(120),
  auth_turnstile_allowed_hostnames: turnstileAllowedHostnamesSchema.default(''),
  auth_sms_provider: z.enum(['env', 'console', 'tencent', 'aliyun']).default('env'),
  auth_sms_tencent_secret_id: z.string().default(''),
  auth_sms_tencent_secret_key: z.string().default(''),
  auth_sms_tencent_region: z.string().default('ap-guangzhou'),
  auth_sms_tencent_sdk_app_id: z.string().default(''),
  auth_sms_tencent_sign_name: z.string().default(''),
  auth_sms_tencent_template_id: z.string().default(''),
  auth_sms_aliyun_access_key_id: z.string().default(''),
  auth_sms_aliyun_access_key_secret: z.string().default(''),
  auth_sms_aliyun_credential_mode: z.enum(['auto', 'access_key', 'ecs_ram_role']).default('auto'),
  auth_sms_aliyun_role_name: z.string().default(''),
  auth_sms_aliyun_sign_name: z.string().default(''),
  auth_sms_aliyun_template_code: z.string().default(''),
  auth_sms_aliyun_template_param_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).default('code'),
  auth_sms_aliyun_register_template_code: z.string().default(''),
  auth_sms_aliyun_register_template_param_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).default('code'),
  auth_sms_aliyun_password_reset_template_code: z.string().default(''),
  auth_sms_aliyun_password_reset_template_param_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).default('code'),
  auth_sms_aliyun_sms_login_template_code: z.string().default(''),
  auth_sms_aliyun_sms_login_template_param_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/).default('code'),
  auth_sms_code_ttl_seconds: z.number().int().min(60).max(1800).default(300),
  auth_sms_rate_limit_seconds: z.number().int().min(30).max(600).default(60),
  auth_sms_daily_per_phone_limit: z.number().int().min(1).max(100).default(10),
  auth_sms_daily_per_ip_limit: z.number().int().min(1).max(100000).default(100),
  auth_sms_daily_global_limit: z.number().int().min(1).max(1000000).default(1000),
  auth_sms_test_phone_whitelist: z.string().default(''),
  auth_turnstile_site_key: z.string().default(''),
  auth_turnstile_secret_key: z.string().default(''),

  // ─── security ───
  security_login_max_attempts: z.number().int().min(1).max(100).default(5),
  security_admin_ip_whitelist: z.string().default(''),
  security_session_ttl_hours: z.number().int().min(1).max(720).default(168),
  security_admin_session_ttl_hours: z.number().int().min(1).max(168).default(24),
  security_audit_log_enabled: z.boolean().default(process.env.NODE_ENV === 'production'),

  // ─── listing / Ozon publish workers ───
  listing_task_refresh_interval_ms: z.number().int().min(5000).max(300000).default(30000),
  listing_task_refresh_batch_size: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(process.env.NODE_ENV === 'production' ? 30 : 10),
  listing_task_refresh_concurrency: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(process.env.NODE_ENV === 'production' ? 6 : 3),
  listing_task_refresh_lookback_hours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(process.env.NODE_ENV === 'production' ? 72 : 48),
  listing_ozon_api_timeout_ms: z.number().int().min(5000).max(60000).default(20000),
  // ─── upload ───
  upload_rate_limit_enabled: z.boolean().default(true),
  upload_rate_limit_per_minute: z.number().int().min(1).max(100).default(10),
  upload_daily_quota_enabled: z.boolean().default(true),
  upload_daily_quota_mb: z.number().int().min(100).max(10000).default(1024),
  upload_referer_check_enabled: z.boolean().default(true),
  upload_storage_backend: z.enum(['env', 'local', 'oss', 'ozon-cdn']).default('env'),
  upload_oss_provider: z
    .enum(['aliyun-oss', 'cloudflare-r2', 's3-compatible'])
    .default('s3-compatible'),
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
  retention_ozon_publisher_parity_days: z.number().int().min(30).max(3650).default(180),
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
  backup_schedule: z
    .string()
    .regex(/^[\d\s\*\/\-,]+$/)
    .default('0 3 * * *'),
  backup_local_keep_days: z.number().int().min(1).max(365).default(7),
  backup_remote_enabled: z.boolean().default(false),
  backup_remote_keep_days: z.number().int().min(1).max(3650).default(30),
  backup_remote_provider: z
    .enum(['s3', 'aliyun-oss', 'cloudflare-r2', 's3-compatible'])
    .default('s3-compatible'),
  backup_remote_bucket: z.string().default(''),
  backup_remote_endpoint: z.string().default(''),
  backup_remote_region: z.string().default('auto'),
  backup_remote_prefix: z.string().default('db/'),
  backup_remote_access_key_id: z.string().default(''),
  backup_remote_secret_access_key: z.string().default(''),

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
export type SystemConfigValue<K extends SystemConfigKey> = z.infer<(typeof SystemConfigSchema)[K]>;

// ─────────────────────────────────────────────────────────────────────────────
// 元数据：label、group、description、是否敏感
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigMeta {
  label: string;
  group: string;
  description: string;
  sensitive?: boolean;
  encrypted?: boolean;
}

export const SystemConfigMeta: Record<SystemConfigKey, ConfigMeta> = {
  feature_customer_chat: {
    label: '客服聊天功能',
    group: 'feature',
    description: '是否启用 OZON 店铺客服聊天集成',
  },
  feature_image_translate: {
    label: '图片翻译功能',
    group: 'feature',
    description: '是否启用图片 OCR + 翻译',
  },
  feature_oss_upload: {
    label: 'OSS 上传',
    group: 'feature',
    description: '是否启用 OSS 对象存储上传（关闭后走本地或 OZON CDN）',
  },
  feature_ozon_cdn_fallback: {
    label: 'OZON CDN 降级',
    group: 'feature',
    description: 'OSS 上传失败时自动降级到 OZON CDN',
  },
  feature_extension_list_overlay: {
    label: '扩展列表覆盖层',
    group: 'feature',
    description: '浏览器扩展在 OZON 商品列表页显示覆盖层',
  },
  feature_extension_hosted_ai: {
    label: '扩展托管 AI',
    group: 'ai',
    description: '允许扩展创建 ERP 托管计费的 AI 图片任务；默认关闭，仍受 Provider、费用和租户门禁约束',
  },
  feature_extension_byok_ai: {
    label: '扩展 BYOK 生图',
    group: 'ai',
    description: '允许扩展使用用户会话中的 API Key 调用已授权 Provider；默认关闭',
  },
  feature_extension_byok_ingest: {
    label: '扩展 BYOK 结果接收',
    group: 'ai',
    description: '允许将用户审核通过的 BYOK 图片交给 ERP 校验、标准化、存储并绑定草稿；默认关闭',
  },
  feature_extension_byok_publish: {
    label: '扩展 BYOK 上架发布',
    group: 'ai',
    description: '允许已接收并绑定草稿的 BYOK 图片进入现有 ERP/Ozon 发布流程；默认关闭',
  },
  feature_new_listing_flow: {
    label: '新版上架流程',
    group: 'feature',
    description: '启用新版上架流程（实验性）',
  },
  feature_announcement_popup: {
    label: '公告弹窗',
    group: 'feature',
    description: '是否在用户登录后弹出未读公告',
  },
  feature_sms_register: {
    label: '短信注册验证',
    group: 'auth',
    description: '云端模式注册时是否要求短信验证码',
  },
  feature_sms_login: {
    label: '短信验证码登录',
    group: 'auth',
    description: '云端模式是否允许已注册用户使用短信验证码登录；需先配置真实短信 provider',
  },
  feature_turnstile_login: {
    label: 'Turnstile 登录验证',
    group: 'auth',
    description: '云端模式登录/发送短信时是否要求 Cloudflare Turnstile 人机验证',
  },
  feature_source_capture_v2: {
    label: '来源采集 V2',
    group: 'feature',
    description: '启用证据化来源商品采集契约；rollout policy 可分阶段影子写、双读或切换为 V2-only',
  },
  feature_source_listing_workflow: {
    label: '来源商品草稿工作流',
    group: 'feature',
    description: '启用版本化来源商品草稿；具体租户由 rollout policy 控制',
  },
  feature_source_ozon_mapping_v2_read: {
    label: '来源类目映射 V2 读取',
    group: 'feature',
    description: '从租户隔离、已审核的来源类目映射表读取推荐历史；关闭时保留兼容读取路径',
  },
  feature_source_ozon_mapping_v2_write: {
    label: '来源类目映射 V2 写入',
    group: 'feature',
    description: '将服务端校验后的类目确认写入可审计映射表；可独立于读取开关进行影子写入',
  },
  feature_source_ozon_publisher_v2: {
    label: '来源商品发布 V2',
    group: 'feature',
    description: '启用统一 Ozon 发布边界并阻止命中试点的旧发布路径',
  },
  source_ozon_publisher_collect_publish_stage: {
    label: '采集页 Ozon 发布入口阶段',
    group: 'feature',
    description: 'off 使用旧入口；shadow 使用旧入口并记录差异；v2 仅在精确版本证据门禁通过后允许切换',
  },
  source_ozon_publisher_listing_batch_stage: {
    label: '批量上架入口阶段',
    group: 'feature',
    description: 'off 使用旧入口；shadow 使用旧入口并记录差异；v2 仅在精确版本证据门禁通过后允许切换',
  },
  source_ozon_publisher_listing_import_by_sku_stage: {
    label: 'SKU 跟卖入口阶段',
    group: 'feature',
    description: 'off 使用旧入口；shadow 使用旧入口并记录差异；v2 仅在精确版本证据门禁通过后允许切换',
  },
  source_ozon_publisher_browser_one_click_stage: {
    label: '浏览器一键上架入口阶段',
    group: 'feature',
    description: 'off 使用旧入口；shadow 使用旧入口并记录差异；v2 仅在精确版本证据门禁通过后允许切换',
  },
  source_ozon_publisher_extension_adapter_stage: {
    label: '扩展发布适配器阶段',
    group: 'feature',
    description: 'off 使用旧入口；shadow 使用旧入口并记录差异；v2 仅在精确版本证据门禁通过后允许切换',
  },
  feature_source_network_capture: {
    label: '国内平台网络证据采集',
    group: 'feature',
    description: '启用 PDD、淘宝和天猫的被动网络证据采集',
  },
  feature_ai_media_workflow_v2: {
    label: '来源商品 AI 媒体工作流',
    group: 'feature',
    description: 'AI 媒体工作流总开关；仅 rollout policy 明确允许的租户可新建任务',
  },
  feature_ai_media_image_to_image: {
    label: 'AI 以图生图',
    group: 'feature',
    description: '启用单图参考生成；默认关闭，且仍受 AI 媒体总开关、租户策略和 Provider 能力门禁约束',
  },
  feature_ai_media_suite: {
    label: 'AI 商品套图生成',
    group: 'feature',
    description: '启用已审核图片计划的套图预览与认领；默认关闭，且仍受 AI 媒体租户策略约束',
  },
  feature_ai_media_full_edit: {
    label: 'AI 全图编辑',
    group: 'feature',
    description: '启用手动全图编辑；默认关闭，且仍受 AI 媒体总开关、租户策略和 Provider 能力门禁约束',
  },
  feature_ai_media_inpaint: {
    label: 'AI 局部重绘',
    group: 'feature',
    description: '启用遮罩局部重绘；默认关闭，且仍受 AI 媒体总开关、租户策略和 Provider 能力门禁约束',
  },
  feature_ai_listing_copy_generation: {
    label: '来源商品 AI 文案生成',
    group: 'feature',
    description: 'AI 文案生成独立总开关；仍需 AI 媒体租户策略和文本 Provider 配置同时就绪',
  },
  feature_extension_product_vision: {
    label: '精铺看图分析', group: 'feature',
    description: '读取当前草稿来源图片，生成可编辑视觉描述；独立默认关闭，受 AI 租户策略、指定视觉模型和每日次数限制，不确认商品事实或自动上架',
  },
  ai_media_workflow_v2_rollout_policy: {
    label: 'AI 媒体工作流租户策略',
    group: 'feature',
    description: '默认按 tenantIds 精确放行；全量使用 {"revision":非负整数,"mode":"all","tenantIds":[]}，仍受总开关、身份、每日次数与预算限制',
  },
  feature_source_listing_web_media: {
    label: '来源商品 Web 工作台',
    group: 'feature',
    description: '启用来源商品到 Ozon 的 Web 工作台',
  },
  feature_source_listing_extension_workbench: {
    label: '来源商品扩展工作台',
    group: 'feature',
    description: '启用来源页面内的扩展工作台',
  },
  source_workflow_rollout_policy: {
    label: '来源工作流发布策略',
    group: 'feature',
    description: '按 owner、shop、device 和 platform 控制 off、pilot 或 global；采集使用 stage，草稿工作流使用 listingStage',
  },
  extension_byok_admin_policy: {
    label: '扩展 BYOK 管理策略',
    group: 'ai',
    description: '严格 JSON：发布模式、owner/shop/device 试点范围、允许的 Provider 来源/操作和最大并发；不允许保存密钥',
  },

  ai_provider: {
    label: 'AI 服务来源',
    group: 'ai',
    description: 'disabled 表示关闭；custom 表示 OpenAI-compatible 自定义接口',
  },
  ai_base_url: {
    label: 'AI Base URL',
    group: 'ai',
    description: 'OpenAI-compatible 接口地址，例如 https://api.deepseek.com/v1',
  },
  ai_api_key: {
    label: 'AI API Key',
    group: 'ai',
    description: 'AI 服务访问密钥',
    sensitive: true,
    encrypted: true,
  },
  ai_model: {
    label: 'AI 模型',
    group: 'ai',
    description: '例如 deepseek-chat、abab6.5s-chat、gpt-compatible model id',
  },
  ai_product_title_model: {
    label: '商品标题模型',
    group: 'ai',
    description: '可选。为空则使用 AI 模型；适合配置便宜快速模型生成标题/标签',
  },
  ai_product_description_model: {
    label: '商品描述/富内容模型',
    group: 'ai',
    description: '可选。为空则使用 AI 模型；适合配置更强模型生成描述、卖点和富内容',
  },
  ai_provider_label: {
    label: 'AI 服务名称',
    group: 'ai',
    description: '后台展示名称，例如 DeepSeek、MiniMax、沉浸式翻译网关',
  },
  ai_timeout_ms: {
    label: 'AI 超时（毫秒）',
    group: 'ai',
    description: '单次 AI 请求超时时间，默认 30000',
  },
  ai_daily_budget_cents: {
    label: 'AI 全局每日预算',
    group: 'ai',
    description: '按任务报价币种分别执行的全局每日预算（最小货币单位）：UTC 当日已结算费用 + 全部历史未决预留上限 + 新任务上限；不同币种不混加，0 禁止新付费任务',
  },
  ai_product_vision_model: {
    label: '商品视觉分析模型', group: 'ai',
    description: '明确支持图片输入的 OpenAI-compatible 模型；为空时看图分析不可用，不继承普通文字模型',
  },
  ai_product_vision_provider: {
    label: '看图分析服务', group: 'ai', description: '独立 disabled/custom 配置；不改变商品文字或图片生成服务',
  },
  ai_product_vision_base_url: {
    label: '看图分析 Base URL', group: 'ai', description: '支持多模态的 HTTPS OpenAI-compatible 地址，不继承普通文字服务地址',
  },
  ai_product_vision_api_key: {
    label: '看图分析 API Key', group: 'ai', description: '只用于独立看图服务，不转发文字或生图服务的密钥', sensitive: true, encrypted: true,
  },
  ai_user_daily_category_translation_limit: {
    label: '用户每日类目翻译额度',
    group: 'ai',
    description: '普通用户每日可触发的新类目翻译调用数；缓存命中不扣额度',
  },
  ai_user_daily_product_generation_limit: {
    label: '用户每日商品生成额度',
    group: 'ai',
    description: '普通用户每日可触发的新商品标题/描述生成次数；缓存命中不扣额度',
  },
  ai_category_translation_enabled: {
    label: '类目缺失自动翻译',
    group: 'ai',
    description: 'Ozon 类目刷新时自动翻译缺失词，优先读取系统词库/缓存',
  },
  ai_product_generation_enabled: {
    label: '商品内容生成',
    group: 'ai',
    description: '允许普通用户生成商品标题/描述草稿，受每日额度限制',
  },
  ai_image_generation_enabled: {
    label: 'AI 文生图',
    group: 'ai',
    description:
      '允许进入文生图任务前置检查；真实 Provider 还必须通过精确能力、成本和配置冻结门禁',
  },
  ai_user_daily_product_vision_limit: {
    label: '用户每日看图分析次数', group: 'ai',
    description: '每次最多五张来源图片；新请求原子占用次数，未知 Provider 结果保留占用，幂等回放不再次调用模型',
  },
  ai_category_translation_prompt: {
    label: '类目翻译提示词',
    group: 'ai',
    description: '用于短类目词翻译。必须只返回译文，不要解释',
  },
  ai_product_title_prompt: {
    label: '商品标题提示词',
    group: 'ai',
    description: '用于生成 Ozon 俄文商品标题草稿',
  },
  ai_product_description_prompt: {
    label: '商品描述提示词',
    group: 'ai',
    description: '用于生成 Ozon 俄文商品描述草稿',
  },
  ai_image_provider: {
    label: '生图服务来源',
    group: 'ai',
    description: 'disabled 表示关闭；配置已实现的服务协议、模型、密钥和单价后，正常任务按权限与额度执行',
  },
  ai_image_base_url: {
    label: '生图 Base URL',
    group: 'ai',
    description: '生图服务 HTTPS API 基址；官方服务使用官方地址，自定义服务按已实现的 OpenAI-compatible 文生图协议执行',
  },
  ai_image_api_key: {
    label: '生图 API Key',
    group: 'ai',
    description: '生图服务访问密钥',
    sensitive: true,
    encrypted: true,
  },
  ai_image_model: {
    label: '生图模型',
    group: 'ai',
    description: '填写该服务实际支持的模型 ID；操作能力由已实现的协议决定，任务确认时冻结端点、模型和价格',
  },
  ai_image_generation_cost_cents: {
    label: '生图单张费用（分）',
    group: 'ai',
    description: '填写已确认的单张价格；Wanx 使用人民币分（0.14元填14），其他现有通道沿用其报价币种。确认时冻结价格，成功按实际张数计费；0 禁止新付费任务',
  },
  ai_image_text_to_image_model: {
    label: '独立文生图模型',
    group: 'ai',
    description: '留空继承生图模型；填写后仅文生图使用此模型，仍使用同一服务和密钥，参考图、全图编辑及局部重绘保持原模型',
  },
  ai_image_text_to_image_cost_cents: {
    label: '独立文生图单张费用（分）',
    group: 'ai',
    description: '仅在独立文生图模型非空时使用；Wanx 使用人民币分，0 禁止新付费文生图，不回退到编辑单价',
  },
  ai_image_prompt: {
    label: '旧版生图提示词（兼容）',
    group: 'ai',
    description: '仅用于首次初始化版本化模板；管理员界面不再直接编辑此项',
  },
  ai_user_daily_image_generation_limit: {
    label: '用户每日生图额度',
    group: 'ai',
    description: '普通用户每日可触发的新文生图调用次数；缓存命中不扣额度',
  },
  ai_image_translation_provider: {
    label: '图片翻译服务来源',
    group: 'ai',
    description: 'disabled 表示关闭；dashscope-qwen-mt-image 仅在沙箱证据通过后启用，fake 仅供本地生命周期测试',
  },
  ai_image_translation_base_url: {
    label: '图片翻译 Base URL',
    group: 'ai',
    description: '图片翻译服务接口地址；生产必须使用 HTTPS 公网地址',
  },
  ai_image_translation_api_key: {
    label: '图片翻译 API Key',
    group: 'ai',
    description: '图片翻译服务访问密钥',
    sensitive: true,
    encrypted: true,
  },
  ai_image_translation_model: {
    label: '图片翻译模型',
    group: 'ai',
    description: '默认 qwen-mt-image；模型能力需先通过 Unit 0B 验证',
  },
  ai_image_translation_category_glossary_json: {
    label: '图片翻译品类术语表（JSON）',
    group: 'ai',
    description: '按源语言、目标语言和可选 Ozon categoryId/typeId 配置术语；保存时执行严格 JSON 校验',
  },
  ai_image_translation_cost_cents: {
    label: '图片翻译单张成本（分）',
    group: 'ai',
    description: '用于提交前成本预留和完成后对账；0 表示尚未配置已验证价格',
  },
  ai_user_daily_image_translation_limit: {
    label: '用户每日图片翻译额度',
    group: 'ai',
    description: '普通用户每日可触发的新图片翻译调用次数',
  },

  auth_human_challenge_provider: {
    label: '人机验证服务商',
    group: 'auth',
    description: 'disabled 关闭；cloudflare-turnstile 使用 Cloudflare；builtin-pow 使用内置浏览器工作量证明',
  },
  auth_pow_signing_secret: {
    label: '工作量证明签名密钥',
    group: 'auth',
    description: '内置工作量证明挑战的服务端签名密钥，至少 32 个字符',
    sensitive: true,
    encrypted: true,
  },
  auth_pow_difficulty: {
    label: '工作量证明难度',
    group: 'auth',
    description: 'SHA-256 十六进制摘要要求的前导零字符数，范围 1-5',
  },
  auth_pow_ttl_seconds: {
    label: '工作量证明有效期（秒）',
    group: 'auth',
    description: '单次人机验证挑战的有效期，范围 30-600 秒',
  },
  auth_turnstile_allowed_hostnames: {
    label: 'Turnstile 允许域名',
    group: 'auth',
    description: '逗号分隔的精确 hostname；Turnstile 模式下留空或非法会拒绝验证',
  },
  auth_sms_provider: {
    label: '短信服务来源',
    group: 'auth',
    description: 'env 表示跟随服务器环境变量；正式短信请选择 aliyun 或 tencent；console 仅用于开发/测试',
  },
  auth_sms_tencent_secret_id: {
    label: '腾讯云 SecretId',
    group: 'auth',
    description: '腾讯云账号 API SecretId',
    sensitive: true,
    encrypted: true,
  },
  auth_sms_tencent_secret_key: {
    label: '腾讯云 SecretKey',
    group: 'auth',
    description: '腾讯云账号 API SecretKey',
    sensitive: true,
    encrypted: true,
  },
  auth_sms_tencent_region: {
    label: '腾讯云短信 Region',
    group: 'auth',
    description: '默认 ap-guangzhou',
  },
  auth_sms_tencent_sdk_app_id: {
    label: '短信 SDK AppId',
    group: 'auth',
    description: '腾讯云短信应用的 SDK AppId',
  },
  auth_sms_tencent_sign_name: {
    label: '短信签名',
    group: 'auth',
    description: '腾讯云短信已审核通过的签名名称',
  },
  auth_sms_tencent_template_id: {
    label: '短信模板 ID',
    group: 'auth',
    description: '验证码模板 ID；当前模板变量顺序为 {1}=验证码',
  },
  auth_sms_aliyun_access_key_id: {
    label: '阿里云 AccessKey ID',
    group: 'auth',
    description: '仅授予短信 SendSms 所需最小权限的 AccessKey ID',
    sensitive: true,
    encrypted: true,
  },
  auth_sms_aliyun_access_key_secret: {
    label: '阿里云 AccessKey Secret',
    group: 'auth',
    description: '阿里云短信 AccessKey Secret',
    sensitive: true,
    encrypted: true,
  },
  auth_sms_aliyun_credential_mode: {
    label: '阿里云凭证来源',
    group: 'auth',
    description: 'auto 使用 SDK 默认凭证链；ecs_ram_role 使用阿里云 ECS 实例 RAM 角色；access_key 使用下方显式密钥',
  },
  auth_sms_aliyun_role_name: {
    label: '阿里云 ECS RAM 角色名',
    group: 'auth',
    description: '凭证来源为 ecs_ram_role 时可填写；留空由实例元数据自动发现',
  },
  auth_sms_aliyun_sign_name: {
    label: '阿里云短信签名',
    group: 'auth',
    description: '阿里云短信控制台已审核通过的签名名称',
  },
  auth_sms_aliyun_template_code: {
    label: '阿里云模板 Code',
    group: 'auth',
    description: '已审核通过的验证码模板 Code，例如 SMS_123456789',
  },
  auth_sms_aliyun_template_param_name: {
    label: '阿里云验证码变量名',
    group: 'auth',
    description: '旧版单模板的验证码变量名；仅在没有配置用途专用模板时使用',
  },
  auth_sms_aliyun_register_template_code: {
    label: '阿里云注册模板 Code',
    group: 'auth',
    description: '用户注册验证码专用模板；未填写时仅注册用途可回退旧版单模板',
  },
  auth_sms_aliyun_register_template_param_name: {
    label: '阿里云注册验证码变量名',
    group: 'auth',
    description: '注册模板中的验证码变量名，通常为 code',
  },
  auth_sms_aliyun_password_reset_template_code: {
    label: '阿里云找回密码模板 Code',
    group: 'auth',
    description: '找回密码验证码专用模板',
  },
  auth_sms_aliyun_password_reset_template_param_name: {
    label: '阿里云找回密码验证码变量名',
    group: 'auth',
    description: '找回密码模板中的验证码变量名，通常为 code',
  },
  auth_sms_aliyun_sms_login_template_code: {
    label: '阿里云短信登录模板 Code',
    group: 'auth',
    description: '短信验证码登录专用模板',
  },
  auth_sms_aliyun_sms_login_template_param_name: {
    label: '阿里云登录验证码变量名',
    group: 'auth',
    description: '登录模板中的验证码变量名，通常为 code',
  },
  auth_sms_code_ttl_seconds: {
    label: '验证码有效期（秒）',
    group: 'auth',
    description: '注册短信验证码有效期，默认 300 秒',
  },
  auth_sms_rate_limit_seconds: {
    label: '短信发送间隔（秒）',
    group: 'auth',
    description: '同一手机号两次发送验证码之间的最小间隔，默认 60 秒',
  },
  auth_sms_daily_per_phone_limit: {
    label: '每手机号每日短信上限',
    group: 'auth',
    description: '按 Asia/Shanghai 自然日统计，所有验证码用途合并计算，默认 10 条',
  },
  auth_sms_daily_per_ip_limit: {
    label: '每 IP 每日短信上限',
    group: 'auth',
    description: '按 Asia/Shanghai 自然日统计，所有验证码用途合并计算，默认 100 条',
  },
  auth_sms_daily_global_limit: {
    label: '全局每日短信熔断上限',
    group: 'auth',
    description: '当前 Redis 实例内所有真实短信发送尝试的每日总上限，与短信服务商无关，默认 1000 条',
  },
  auth_sms_test_phone_whitelist: {
    label: '测试手机号白名单',
    group: 'auth',
    description: '逗号分隔。填写后，接口与集成页面只能向白名单手机号发送测试短信',
  },
  auth_turnstile_site_key: {
    label: 'Turnstile Site Key',
    group: 'auth',
    description: '前端渲染 Cloudflare Turnstile 使用的公开 Site Key',
  },
  auth_turnstile_secret_key: {
    label: 'Turnstile Secret Key',
    group: 'auth',
    description: '后端校验 Cloudflare Turnstile 使用的 Secret Key',
    sensitive: true,
    encrypted: true,
  },

  security_login_max_attempts: {
    label: '登录失败锁定阈值',
    group: 'security',
    description: '同一 IP 登录失败次数达到该值后强制要求 Turnstile 人机验证（云端模式）',
  },
  security_admin_ip_whitelist: {
    label: '管理员 IP 白名单',
    group: 'security',
    description: '逗号分隔的 CIDR 列表（如 1.2.3.4/32,10.0.0.0/8）。留空表示不限制。生效需重启服务',
    sensitive: true,
  },
  security_session_ttl_hours: {
    label: '会话有效期（小时）',
    group: 'security',
    description: '默认 168（7天）。修改后只对新发放的 token 生效',
  },
  security_admin_session_ttl_hours: {
    label: '管理员会话有效期（小时）',
    group: 'security',
    description: '管理员独立登录入口的 token 有效期，默认 24 小时',
  },
  security_audit_log_enabled: {
    label: '审计日志',
    group: 'security',
    description: '记录管理员/超管的写操作；生产环境强制开启，写入失败会返回错误',
  },

  listing_task_refresh_interval_ms: {
    label: '上架状态刷新间隔（毫秒）',
    group: 'listing',
    description: '后台自动向 Ozon 查询上架任务状态的间隔。默认 30000，即 30 秒。',
  },
  listing_task_refresh_batch_size: {
    label: '每轮最多刷新任务数',
    group: 'listing',
    description: '每轮自动刷新最多处理多少个上架任务。VPS 推荐 30，任务量大且稳定后可提高。',
  },
  listing_task_refresh_concurrency: {
    label: '状态刷新并发数',
    group: 'listing',
    description: '同时刷新多少个上架任务。VPS 推荐从 6 起步，稳定后可调到 8-10。',
  },
  listing_task_refresh_lookback_hours: {
    label: '刷新任务回看时间（小时）',
    group: 'listing',
    description: '只自动刷新最近多少小时内的上架任务，避免长期历史任务占用队列。',
  },
  listing_ozon_api_timeout_ms: {
    label: 'Ozon 状态查询超时（毫秒）',
    group: 'listing',
    description: '单次 Ozon 状态查询/兜底查询的最长等待时间。网络稳定可保留 20000。',
  },
  upload_rate_limit_enabled: {
    label: '上传频率限制',
    group: 'upload',
    description: '是否启用单用户上传频率限制',
  },
  upload_rate_limit_per_minute: {
    label: '每分钟上传次数',
    group: 'upload',
    description: '单用户每分钟最多上传次数（默认 10 次）',
  },
  upload_daily_quota_enabled: {
    label: '每日上传配额',
    group: 'upload',
    description: '是否启用单用户每日上传流量配额',
  },
  upload_daily_quota_mb: {
    label: '每日上传配额（MB）',
    group: 'upload',
    description: '单用户每日最多上传流量（默认 1024MB = 1GB）',
  },
  upload_referer_check_enabled: {
    label: 'Referer 检查',
    group: 'upload',
    description: '是否检查 Referer 防止盗链（仅对 /cdn/* 路径生效）',
  },
  upload_storage_backend: {
    label: '图片/附件存储后端',
    group: 'upload',
    description: 'env 表示跟随服务器环境变量；对象存储请选择 oss',
  },
  upload_oss_provider: {
    label: '对象存储服务商',
    group: 'upload',
    description: '选择阿里云 OSS、Cloudflare R2 或其他 S3 兼容服务',
  },
  upload_oss_endpoint: {
    label: 'S3 API Endpoint',
    group: 'upload',
    description: '对象存储的 S3 兼容 API 地址',
    sensitive: true,
  },
  upload_oss_bucket: {
    label: 'Bucket',
    group: 'upload',
    description: '图片和附件使用的存储桶名称',
    sensitive: true,
  },
  upload_oss_access_key_id: {
    label: 'Access Key ID',
    group: 'upload',
    description: 'S3 兼容访问密钥 ID',
    sensitive: true,
  },
  upload_oss_access_key_secret: {
    label: 'Secret Access Key',
    group: 'upload',
    description: 'S3 兼容访问密钥 Secret',
    sensitive: true,
  },
  upload_oss_region: {
    label: 'Region',
    group: 'upload',
    description: '阿里云填写实际地域，Cloudflare R2 填写 auto',
  },
  upload_oss_cdn_domain: {
    label: '公网访问域名',
    group: 'upload',
    description:
      '可选。只填 Cloudflare R2 自定义域名或 r2.dev 公网域名；不要填 r2.cloudflarestorage.com S3 API endpoint。为空时走 /api/cdn 安全代理',
  },
  upload_ozon_cdn_relay_url: {
    label: 'OZON CDN 中转地址',
    group: 'upload',
    description: '可选。存储后端为 ozon-cdn 或 OSS 降级时使用',
  },
  upload_local_base_url: {
    label: '上传访问 Base URL',
    group: 'upload',
    description:
      'local 存储及 OSS /api/cdn 代理访问使用。云端通常填写 https://app.ss-erp.com；为空时云端默认使用 app.ss-erp.com',
  },

  retention_collect_archive_days: {
    label: '采集数据归档天数',
    group: 'retention',
    description: '超过此天数的采集记录标记为归档（第一阶段仅统计，不删除）',
  },
  retention_collect_min_keep: {
    label: '采集数据最少保留条数',
    group: 'retention',
    description: '即使超过归档天数，每个用户至少保留此数量的采集记录',
  },
  retention_cainiao_unbound_days: {
    label: '菜鸟未绑定缓存保留天数',
    group: 'retention',
    description: '未绑定到订单的菜鸟包裹缓存保留天数',
  },
  retention_cainiao_bound_days: {
    label: '菜鸟已绑定缓存保留天数',
    group: 'retention',
    description: '已绑定到订单的菜鸟包裹缓存保留天数',
  },
  retention_sync_success_days: {
    label: '成功同步任务保留天数',
    group: 'retention',
    description: '状态为 SUCCESS 的 SyncJob 记录保留天数',
  },
  retention_sync_failed_days: {
    label: '失败同步任务保留天数',
    group: 'retention',
    description: '状态为 FAILED 的 SyncJob 记录保留天数（便于排查问题）',
  },
  retention_ozon_publisher_parity_days: {
    label: 'Ozon 发布影子观测保留天数',
    group: 'retention',
    description: '脱敏的旧版/V2 发布载荷对比观测保留天数；差异审批与决策事件不会随观测清理',
  },
  retention_notification_read_days: {
    label: '已读通知保留天数',
    group: 'retention',
    description: '已读通知超过此天数后自动清理',
  },
  retention_notification_unread_days: {
    label: '未读通知保留天数',
    group: 'retention',
    description: '未读通知超过此天数后自动清理',
  },
  retention_temp_images_days: {
    label: '临时图片保留天数',
    group: 'retention',
    description: '临时上传目录中超过此天数的图片自动清理',
  },
  retention_cleanup_dry_run: {
    label: '清理 dry-run 模式',
    group: 'retention',
    description: '开启时只统计不删除，关闭后才真正执行清理',
  },

  retention_oss_raw_days: {
    label: 'OSS 原始图保留天数',
    group: 'retention',
    description: '用户采集的原始图片在 OSS/R2 中保留天数（默认 15 天）',
  },
  retention_oss_watermarked_days: {
    label: 'OSS 水印图保留天数',
    group: 'retention',
    description: '生成的水印图在 OSS/R2 中保留天数（默认 60 天）',
  },
  retention_oss_tmp_days: {
    label: 'OSS 临时图保留天数',
    group: 'retention',
    description: '失败任务的临时图在 OSS/R2 中保留天数（默认 7 天）',
  },
  retention_oss_attachments_days: {
    label: 'OSS 附件保留天数',
    group: 'retention',
    description: '公告/系统附件保留天数（0 表示永久保留）',
  },
  retention_oss_cleanup_enabled: {
    label: 'OSS 清理总开关',
    group: 'retention',
    description: '是否启用 OSS/R2 对象自动清理',
  },
  retention_oss_cleanup_dry_run: {
    label: 'OSS 清理 dry-run',
    group: 'retention',
    description: '开启时只统计不删除，关闭后才真正删除 OSS 对象',
  },

  backup_enabled: { label: '自动备份', group: 'backup', description: '是否启用定时数据库备份' },
  backup_schedule: {
    label: '备份 cron 表达式',
    group: 'backup',
    description: '备份执行时间（cron 格式），默认每天凌晨 3 点',
  },
  backup_local_keep_days: {
    label: '本地备份保留天数',
    group: 'backup',
    description: '本地备份文件超过此天数后自动清理',
  },
  backup_remote_enabled: {
    label: '远程备份',
    group: 'backup',
    description: '是否将备份上传到远程存储（S3 兼容）',
  },
  backup_remote_keep_days: {
    label: '远程备份保留天数',
    group: 'backup',
    description: '远程存储中超过此天数的备份自动清理',
  },
  backup_remote_provider: {
    label: '远程存储类型',
    group: 'backup',
    description: '选择阿里云 OSS、Cloudflare R2 或其他 S3 兼容存储；旧值 s3 继续兼容',
  },
  backup_remote_bucket: {
    label: '远程存储 Bucket',
    group: 'backup',
    description: '远程备份目标 bucket 名称',
  },
  backup_remote_endpoint: {
    label: '远程存储 Endpoint',
    group: 'backup',
    description: '远程备份 S3 兼容 endpoint URL',
  },
  backup_remote_region: {
    label: '远程存储 Region',
    group: 'backup',
    description: '远程备份存储区域',
  },
  backup_remote_prefix: {
    label: '远程存储路径前缀',
    group: 'backup',
    description: '远程备份文件在 bucket 中的路径前缀',
  },
  backup_remote_access_key_id: {
    label: '远程备份 Access Key ID',
    group: 'backup',
    description: '远程备份 bucket 专用访问密钥 ID',
    sensitive: true,
    encrypted: true,
  },
  backup_remote_secret_access_key: {
    label: '远程备份 Secret Access Key',
    group: 'backup',
    description: '远程备份 bucket 专用访问密钥 Secret',
    sensitive: true,
    encrypted: true,
  },

  maintenance_enabled: {
    label: '维护模式',
    group: 'maintenance',
    description: '开启后普通用户写接口返回 503，管理员仍可访问',
  },
  maintenance_message: {
    label: '维护提示信息',
    group: 'maintenance',
    description: '维护模式下返回给用户的提示文案',
  },
  maintenance_allow_admin: {
    label: '管理员免维护',
    group: 'maintenance',
    description: '维护模式下管理员是否可以继续访问',
  },
  maintenance_readonly: {
    label: '只读模式',
    group: 'maintenance',
    description: '维护模式下是否允许读接口通过（仅拦截写操作）',
  },

  version_web_check_interval_hours: {
    label: 'Web 版本检查间隔（小时）',
    group: 'version',
    description: '前端检查新版本的间隔时间',
  },
  version_extension_check_interval_hours: {
    label: '扩展版本检查间隔（小时）',
    group: 'version',
    description: '浏览器扩展检查新版本的间隔时间',
  },
  version_force_refresh_enabled: {
    label: '强制刷新',
    group: 'version',
    description: '检测到新版本时是否强制用户刷新页面',
  },

  randomize_enabled: {
    label: '货号/尺寸/重量随机化总开关',
    group: 'randomize',
    description: '总开关：关闭则所有随机化均不生效。打开后用户上品页可单独切换"随机货号"',
  },
  randomize_offer_id: {
    label: '允许随机货号',
    group: 'randomize',
    description:
      '允许在跟卖/复制时生成随机 offer_id（基于源 SKU + 随机后缀）。默认值是开启，用户端仍可单独关闭',
  },
  randomize_dimension_jitter_mm: {
    label: '尺寸浮动范围（mm）',
    group: 'randomize',
    description:
      '长/宽/高在原值 ±N mm 范围内随机浮动，避免被官方判定为重复商品。设为 0 关闭尺寸浮动',
  },
  randomize_weight_buckets: {
    label: '重量分档区间（g）',
    group: 'randomize',
    description:
      '逗号分隔的区间，每段写为"下限-上限"。原重量落在哪段就在该段内随机一个值。例：0-250 表示 0g 到 250g',
  },
  randomize_dimension_min_mm: {
    label: '尺寸最小值兜底（mm）',
    group: 'randomize',
    description: '随机浮动后小于此值则取此值，避免出现 0 或负数尺寸',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed Accessor：类型安全的读写接口
// ─────────────────────────────────────────────────────────────────────────────

export const ENCRYPTED_CONFIG_PREFIX = 'enc:v1:';

export function isSensitiveConfigKey(key: string): key is SystemConfigKey {
  return validateKey(key) && !!SystemConfigMeta[key].sensitive;
}

export function isEncryptedConfigKey(key: string): key is SystemConfigKey {
  if (!validateKey(key)) return false;
  const meta = SystemConfigMeta[key];
  const defaultValue = getDefaultValue(key);
  return !!(meta.encrypted || meta.sensitive) && typeof defaultValue === 'string';
}

export function decryptConfigValue(key: string, raw: string): string {
  if (!validateKey(key) || !raw.startsWith(ENCRYPTED_CONFIG_PREFIX)) return raw;
  try {
    return decryptConfigValueStrict(key, raw);
  } catch (error: any) {
    console.warn(`[SystemConfig] ${key} 解密失败，使用原始值: ${error?.message || error}`);
    return raw;
  }
}

/**
 * Decrypt a persisted config value without hiding corruption. Sensitive
 * callers use this path so an invalid `enc:v1:` value cannot become an
 * apparently valid fallback or default.
 */
export function decryptConfigValueStrict(key: string, raw: string): string {
  if (!validateKey(key) || !raw.startsWith(ENCRYPTED_CONFIG_PREFIX)) return raw;
  try {
    return decrypt(raw.slice(ENCRYPTED_CONFIG_PREFIX.length));
  } catch (error) {
    throw new Error(`[SystemConfig] ${key} 解密失败`, { cause: error });
  }
}

export function encryptConfigValue(key: string, value: string): string {
  if (!isEncryptedConfigKey(key) || value === '') return value;
  if (value.startsWith(ENCRYPTED_CONFIG_PREFIX)) return value;
  return `${ENCRYPTED_CONFIG_PREFIX}${encrypt(value)}`;
}

function parseValue<K extends SystemConfigKey>(key: K, raw: string): SystemConfigValue<K> {
  const schema = SystemConfigSchema[key];
  const decrypted = decryptConfigValue(key, raw);
  const parsed = schema.safeParse(coerceConfigValue(key, decrypted));
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
  return encryptConfigValue(key, String(value));
}

export async function getConfig<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
  const record = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!record) {
    const schema = SystemConfigSchema[key];
    return schema.parse(undefined) as SystemConfigValue<K>;
  }
  return parseValue(key, record.value);
}

/**
 * Read a security-sensitive setting without silently replacing an invalid
 * persisted value with its default. Callers can choose a fail-closed path.
 */
export async function getStrictConfig<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
  const record = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!record) {
    const schema = SystemConfigSchema[key];
    return schema.parse(undefined) as SystemConfigValue<K>;
  }
  const schema = SystemConfigSchema[key];
  return schema.parse(coerceConfigValue(key, decryptConfigValueStrict(key, record.value))) as SystemConfigValue<K>;
}

export interface SystemConfigRecordRevision {
  id: string;
  revision: number;
  updatedAt: Date;
}

type ConfigSnapshot<Keys extends readonly SystemConfigKey[]> = {
  [Key in Keys[number]]: SystemConfigValue<Key>;
};
type RevisionedConfigSnapshot<Keys extends readonly SystemConfigKey[]> = {
  values: ConfigSnapshot<Keys>;
  revisions: { [Key in Keys[number]]: SystemConfigRecordRevision | null };
};

/** Read values and optional non-secret revision metadata from one database statement. */
export function getStrictConfigSnapshot<const Keys extends readonly SystemConfigKey[]>(
  keys: Keys,
): Promise<ConfigSnapshot<Keys>>;
export function getStrictConfigSnapshot<const Keys extends readonly SystemConfigKey[]>(
  keys: Keys,
  options: { includeRevisions: true },
): Promise<RevisionedConfigSnapshot<Keys>>;
export async function getStrictConfigSnapshot<const Keys extends readonly SystemConfigKey[]>(
  keys: Keys,
  options?: { includeRevisions: true },
): Promise<ConfigSnapshot<Keys> | RevisionedConfigSnapshot<Keys>> {
  const uniqueKeys = [...new Set<SystemConfigKey>(keys)];
  if (!uniqueKeys.length || uniqueKeys.length !== keys.length) {
    throw new Error('[SystemConfig] strict snapshot keys must be unique and non-empty');
  }
  const records = await prisma.systemConfig.findMany({
    where: { key: { in: uniqueKeys } },
    select: {
      key: true, value: true,
      ...(options?.includeRevisions ? { id: true, revision: true, updatedAt: true } : {}),
    },
  });
  const values = new Map(records.map((record) => [record.key, record.value]));
  const snapshot: Partial<Record<SystemConfigKey, unknown>> = {};
  for (const key of uniqueKeys) {
    const schema = SystemConfigSchema[key];
    const raw = values.get(key);
    snapshot[key] = raw == null
      ? schema.parse(undefined)
      : schema.parse(coerceConfigValue(key, decryptConfigValueStrict(key, raw)));
  }
  const valuesSnapshot = snapshot as ConfigSnapshot<Keys>;
  if (!options?.includeRevisions) return valuesSnapshot;
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const revisions = Object.fromEntries(uniqueKeys.map((key) => {
    const record = recordsByKey.get(key);
    return [key, record ? { id: record.id, revision: record.revision, updatedAt: record.updatedAt } : null];
  })) as RevisionedConfigSnapshot<Keys>['revisions'];
  return { values: valuesSnapshot, revisions };
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
    create: {
      key,
      value: serialized,
      label: meta.label,
      group: meta.group,
      description: meta.description,
      ...(key === 'ai_image_api_key' ? { revision: 1 } : {}),
    },
    // Image jobs bind this revision; same-millisecond writes must also invalidate the old identity.
    update: { value: serialized, ...(key === 'ai_image_api_key' ? { revision: { increment: 1 } } : {}) },
  });
}

export async function getAllConfigs(): Promise<Record<string, string>> {
  const records = await prisma.systemConfig.findMany({ select: { key: true, value: true } });
  const result: Record<string, string> = {};
  for (const r of records) {
    result[r.key] = decryptConfigValue(r.key, r.value);
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
