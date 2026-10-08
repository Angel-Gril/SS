import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { invalidateFeatureCache } from '../lib/feature-flags.js';
import { invalidateMaintenanceCache } from '../lib/maintenance.js';
import { logAudit, extractRequestMeta } from '../lib/audit-log.js';
import {
  SystemConfigSchema,
  SystemConfigMeta,
  ENCRYPTED_CONFIG_PREFIX,
  type SystemConfigKey,
  getDefaultValue,
  validateKey,
  coerceConfigValue,
  decryptConfigValue,
  decryptConfigValueStrict,
  encryptConfigValue,
  isSensitiveConfigKey,
} from '../config/system-config-schema.js';
import { createPrismaAiUsageStore, normalizeAiUsageDate } from '../services/ai-usage.js';
import {
  aiImageCredentialEndpointIdentity,
  isOfficialOpenAiImagesApiBase,
} from '../services/ai-image-providers.js';
import { AI_IMAGE_DONOR_GPT2_COUNT_MODEL, assertDonorGpt2ProviderModel } from '../services/ai-image-donor-gpt2-profile.js';
import { getRuntimeMode } from '../adapters/runtime-config.js';
import {
  AUTH_PROVIDER_PREFLIGHT_KEYS,
  requiresAuthProviderPreflight,
  validateAuthProviderActivation,
} from '../lib/auth-provider-activation.js';

const expectedRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  expectedRevision: expectedRevisionSchema,
  label: z.string().optional(),
  group: z.string().default('general'),
  description: z.string().optional(),
});

const batchUpdateSchema = z.object({
  items: z.array(z.object({
    key: z.string().min(1),
    value: z.string(),
    expectedRevision: expectedRevisionSchema,
  })).min(1).max(50),
});

const singleUpdateSchema = z.object({
  value: z.string(),
  expectedRevision: expectedRevisionSchema,
});

const PROTECTED_OZON_PUBLISHER_STAGE_KEYS = new Set<string>([
  'source_ozon_publisher_collect_publish_stage',
  'source_ozon_publisher_listing_batch_stage',
  'source_ozon_publisher_listing_import_by_sku_stage',
  'source_ozon_publisher_browser_one_click_stage',
  'source_ozon_publisher_extension_adapter_stage',
] as const satisfies readonly SystemConfigKey[]);

const AI_IMAGE_PROVIDER_CONFIG_FAMILIES = [
  { provider: 'ai_image_provider', baseUrl: 'ai_image_base_url', apiKey: 'ai_image_api_key', model: 'ai_image_model' },
  { provider: 'ai_image_suite_provider', baseUrl: 'ai_image_suite_base_url', apiKey: 'ai_image_suite_api_key', model: 'ai_image_suite_model' },
] as const satisfies readonly Record<'provider' | 'baseUrl' | 'apiKey' | 'model', SystemConfigKey>[];

const SECRET_FIELDS: string[] = [];

function isSecretKey(key: string): boolean {
  return isSensitiveConfigKey(key);
}

function maskSecretValue(key: string, value: string): string {
  if (!isSecretKey(key) || !value) return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && SECRET_FIELDS.length > 0) {
      for (const field of SECRET_FIELDS) {
        if (parsed[field] && typeof parsed[field] === 'string' && parsed[field].length > 0) {
          parsed[field] = '***MASKED***';
        }
      }
      return JSON.stringify(parsed);
    }
  } catch {
    // 非 JSON 字符串继续走整体掩码。
  }
  return value.length > 12 ? `${value.slice(0, 4)}***${value.slice(-4)}` : '***MASKED***';
}

function isMaskedSecretPlaceholder(value: string): boolean {
  return value === '***MASKED***' || /^.{4}\*{3}.{4}$/.test(value);
}

class SystemConfigMutationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'SystemConfigMutationError';
  }
}

class SystemConfigRevisionConflictError extends SystemConfigMutationError {
  constructor(readonly keys: string[]) {
    super(
      409,
      'system_config_revision_conflict',
      '配置已被其他会话更新，请刷新后重新确认',
    );
    this.name = 'SystemConfigRevisionConflictError';
  }
}

// 用户提交时如果某 secret 字段是 ***MASKED*** 占位符，保留原值
function mergeMaskedValue(key: string, newValue: string, oldValue: string): string {
  if (!isSecretKey(key)) return newValue;
  if (isMaskedSecretPlaceholder(newValue)) {
    if (!oldValue) throw new SystemConfigRevisionConflictError([key]);
    return oldValue;
  }
  if (!oldValue) return newValue;
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

function toPublicConfigValue(key: string, storedValue: string): string {
  return maskSecretValue(key, decryptConfigValue(key, storedValue));
}

async function preflightAuthProviderMutation(
  changes: ReadonlyMap<SystemConfigKey, string | null>,
  client: Pick<typeof prisma, 'systemConfig'> = prisma,
) {
  const changedKeys = new Set<SystemConfigKey>(changes.keys());
  if (!requiresAuthProviderPreflight(changedKeys)) return null;

  const records = await client.systemConfig.findMany({
    where: { key: { in: [...AUTH_PROVIDER_PREFLIGHT_KEYS] } },
    select: { key: true, value: true },
  });
  const values = new Map<SystemConfigKey, string>();
  const decryptFailures = new Set<SystemConfigKey>();
  for (const key of AUTH_PROVIDER_PREFLIGHT_KEYS) {
    const record = records.find((item) => item.key === key);
    if (!record) {
      values.set(key, String(getDefaultValue(key)));
      continue;
    }
    try {
      values.set(key, decryptConfigValueStrict(key, record.value));
    } catch {
      decryptFailures.add(key);
      values.set(key, '');
    }
  }
  const previousValues = new Map(values);
  for (const [key, value] of changes) {
    if (!values.has(key)) continue;
    if (value !== null) decryptFailures.delete(key);
    values.set(key, value === null ? String(getDefaultValue(key)) : value);
  }

  const humanProvider = (() => {
    const explicit = String(process.env.HUMAN_CHALLENGE_PROVIDER || '').trim();
    if (explicit) return explicit;
    if (String(process.env.FEATURE_TURNSTILE_LOGIN || '').trim() === 'true') {
      return 'cloudflare-turnstile';
    }
    const configured = String(values.get('auth_human_challenge_provider') || '').trim();
    if (configured === 'disabled' && values.get('feature_turnstile_login') === 'true') {
      return 'cloudflare-turnstile';
    }
    return configured;
  })();
  const activeHumanSecretKeys = humanProvider === 'builtin-pow'
    ? new Set<SystemConfigKey>(['auth_pow_signing_secret'])
    : humanProvider === 'cloudflare-turnstile'
      ? new Set<SystemConfigKey>(['auth_turnstile_secret_key'])
      : new Set<SystemConfigKey>();
  const envPowSecret = String(process.env.HUMAN_CHALLENGE_SIGNING_SECRET || '').trim();
  const envTurnstileSecret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  const activeHumanSecretDecryptFailure = [...decryptFailures].some((key) => {
    if (!activeHumanSecretKeys.has(key)) return false;
    if (key === 'auth_pow_signing_secret') return envPowSecret.length < 32;
    if (key === 'auth_turnstile_secret_key') return envTurnstileSecret.length === 0;
    return true;
  });
  if (activeHumanSecretDecryptFailure) {
    return {
      errorCode: 'system_config_human_challenge_not_ready' as const,
      msg: '人机验证敏感配置解密失败，请先停用当前服务商并刷新配置',
    };
  }

  const smsFeaturesDisabled = values.get('feature_sms_register') === 'false'
    && values.get('feature_sms_login') === 'false';
  const configuredSmsProvider = String(values.get('auth_sms_provider') || '').trim();
  const effectiveSmsProvider = configuredSmsProvider === 'env'
    ? String(process.env.SMS_PROVIDER || '').trim()
    : configuredSmsProvider;
  const activeSmsSecretPrefix = configuredSmsProvider === 'env'
    ? null
    : effectiveSmsProvider === 'tencent'
      ? 'auth_sms_tencent_'
      : effectiveSmsProvider === 'aliyun'
        ? 'auth_sms_aliyun_'
        : null;
  if (!smsFeaturesDisabled && activeSmsSecretPrefix
    && [...decryptFailures].some((key) => key.startsWith(activeSmsSecretPrefix))) {
    return {
      errorCode: 'system_config_sms_provider_not_ready' as const,
      msg: '短信服务敏感配置解密失败，请先关闭短信功能并刷新配置',
    };
  }
  return validateAuthProviderActivation({ values, previousValues, changedKeys });
}

function requireLiveAccountSession(request: FastifyRequest, reply: FastifyReply) {
  if ((request as any).user?.tokenUse === 'account_session') return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'system_config_account_session_required',
    msg: '系统配置修改需要当前账号会话',
  });
}

function rejectProtectedStageMutation(reply: FastifyReply, key: string) {
  return reply.status(409).send({
    code: 0,
    errorCode: 'system_config_rollout_stage_cas_required',
    msg: `发布阶段配置 ${key} 只能通过专用 CAS 接口修改`,
  });
}

function rejectRevisionRequired(reply: FastifyReply) {
  return reply.status(428).send({
    code: 0,
    errorCode: 'system_config_revision_required',
    msg: '缺少 expectedRevision，请刷新配置后重试',
  });
}

function isDatabaseRevisionConflict(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code || '');
  return ['P2002', 'P2034', '23505', '40001'].includes(code);
}

function sendMutationError(reply: FastifyReply, error: unknown) {
  if (error instanceof SystemConfigMutationError) {
    return reply.status(error.statusCode).send({
      code: 0,
      errorCode: error.errorCode,
      msg: error.message,
      ...(error instanceof SystemConfigRevisionConflictError ? { data: { keys: error.keys } } : {}),
    });
  }
  if (isDatabaseRevisionConflict(error)) {
    return reply.status(409).send({
      code: 0,
      errorCode: 'system_config_revision_conflict',
      msg: '配置已被其他会话更新，请刷新后重新确认',
    });
  }
  return null;
}

interface ConfigMutationInput {
  key: SystemConfigKey;
  value: string;
  expectedRevision: number;
  metadata?: {
    label: string;
    group: string;
    description: string;
  };
}

async function applyConfigMutations(
  client: Pick<typeof prisma, 'systemConfig'>,
  inputs: readonly ConfigMutationInput[],
) {
  const lookupKeys = new Set<SystemConfigKey>(inputs.map((item) => item.key));
  for (const family of AI_IMAGE_PROVIDER_CONFIG_FAMILIES) {
    if (inputs.some((item) => Object.values(family).some((key) => key === item.key))) {
      Object.values(family).forEach((key) => lookupKeys.add(key));
    }
  }
  const existingRows = await client.systemConfig.findMany({
    where: { key: { in: [...lookupKeys] } },
  });
  const existingByKey = new Map(existingRows.map((row) => [row.key, row]));
  const prepared = inputs.map((item) => {
    if (isSecretKey(item.key) && item.value.startsWith(ENCRYPTED_CONFIG_PREFIX)) {
      throw new SystemConfigMutationError(
        400,
        'system_config_invalid_value',
        `${item.key}: 不接受已加密格式的输入`,
      );
    }
    const existing = existingByKey.get(item.key) || null;
    let oldValue = '';
    let oldValueUnreadable = false;
    if (existing) {
      try {
        oldValue = decryptConfigValueStrict(item.key, existing.value);
      } catch {
        if (isMaskedSecretPlaceholder(item.value)) {
          throw new SystemConfigRevisionConflictError([item.key]);
        }
        oldValueUnreadable = true;
      }
    }
    const finalValue = mergeMaskedValue(item.key, item.value, oldValue);
    const validated = SystemConfigSchema[item.key].safeParse(coerceConfigValue(item.key, finalValue));
    if (!validated.success) {
      const errMsg = validated.error.errors[0]?.message || '值不符合要求';
      throw new SystemConfigMutationError(400, 'system_config_invalid_value', `${item.key}: ${errMsg}`);
    }
    const displayValue = String(validated.data);
    const metadataChanged = Boolean(item.metadata && existing && (
      existing.label !== item.metadata.label
      || existing.group !== item.metadata.group
      || existing.description !== item.metadata.description
    ));
    return {
      ...item,
      existing,
      oldValue,
      displayValue,
      storedValue: encryptConfigValue(item.key, displayValue),
      oldValueUnreadable,
      metadataChanged,
      changed: !existing || oldValueUnreadable || oldValue !== displayValue || metadataChanged,
    };
  });

  const changed = prepared.filter((item) => item.changed);
  const staleKeys = changed
    .filter((item) => item.existing
      ? item.existing.revision !== item.expectedRevision
      : item.expectedRevision !== 0)
    .map((item) => item.key);
  if (staleKeys.length > 0) throw new SystemConfigRevisionConflictError(staleKeys);

  for (const family of AI_IMAGE_PROVIDER_CONFIG_FAMILIES) {
    if (!changed.some((item) => Object.values(family).some((key) => key === item.key))) continue;
    const existingValue = (key: SystemConfigKey) => {
      const row = existingByKey.get(key);
      if (!row) return String(getDefaultValue(key));
      try {
        return decryptConfigValueStrict(key, row.value);
      } catch {
        throw new SystemConfigMutationError(
          409,
          'system_config_ai_image_config_unreadable',
          'AI 生图配置无法解密，请刷新后重新输入供应商参数和 API Key',
        );
      }
    };
    const nextValue = (key: SystemConfigKey) => prepared.find((item) => item.key === key)?.displayValue
      ?? existingValue(key);
    const previousProvider = existingValue(family.provider);
    const previousBaseUrl = existingValue(family.baseUrl);
    const previousApiKey = existingValue(family.apiKey);
    const nextProvider = nextValue(family.provider);
    const nextBaseUrl = nextValue(family.baseUrl);
    const nextModel = nextValue(family.model);
    if (nextProvider === 'inherit') continue;
    if (nextProvider === 'custom' && !nextBaseUrl.trim()) {
      throw new SystemConfigMutationError(
        422,
        'system_config_ai_image_provider_endpoint_mismatch',
        '自定义 OpenAI-compatible 网关必须填写明确的 Base URL',
      );
    }
    if (nextProvider === 'openai-images' && !isOfficialOpenAiImagesApiBase(nextBaseUrl)) {
      throw new SystemConfigMutationError(
        422,
        'system_config_ai_image_provider_endpoint_mismatch',
        'OpenAI Images 只允许官方 https://api.openai.com/v1；第三方中转请选择自定义网关',
      );
    }
    if (nextProvider !== 'disabled'
      && (nextModel !== nextModel.trim() || !nextModel.trim() || nextModel.length > 500)) {
      throw new SystemConfigMutationError(
        422,
        'system_config_ai_image_model_invalid',
        'AI 生图模型必须是 1-500 字符且不能包含首尾空格',
      );
    }
    if (nextProvider === 'custom' && nextModel === AI_IMAGE_DONOR_GPT2_COUNT_MODEL) {
      try { assertDonorGpt2ProviderModel(nextBaseUrl, nextModel); }
      catch {
        throw new SystemConfigMutationError(422, 'system_config_ai_image_provider_endpoint_mismatch',
          'gpt-image-2-count 只能绑定已验证的 https://ai.big-model-api.top/v1');
      }
    }
    const nextEndpoint = aiImageCredentialEndpointIdentity(nextProvider, nextBaseUrl);
    const previousEndpoint = aiImageCredentialEndpointIdentity(previousProvider, previousBaseUrl);
    const apiKeyInput = inputs.find((item) => item.key === family.apiKey);
    const apiKeyExplicitlyReentered = Boolean(
      apiKeyInput && !isMaskedSecretPlaceholder(apiKeyInput.value),
    );
    if (nextProvider !== 'disabled'
      && previousApiKey
      && nextEndpoint !== previousEndpoint
      && !apiKeyExplicitlyReentered) {
      throw new SystemConfigMutationError(
        422,
        'system_config_ai_image_api_key_reentry_required',
        'AI 生图 Base URL 已变化，请重新输入 API Key，旧密钥不会自动绑定到新端点',
      );
    }
  }

  const preflightFailure = await preflightAuthProviderMutation(
    new Map(changed.map((item) => [item.key, item.displayValue] as const)),
    client,
  );
  if (preflightFailure) {
    throw new SystemConfigMutationError(422, preflightFailure.errorCode, preflightFailure.msg);
  }

  for (const item of changed) {
    const meta = SystemConfigMeta[item.key];
    if (!item.existing) {
      const metadata = item.metadata || {
        label: meta.label,
        group: meta.group,
        description: meta.description,
      };
      await client.systemConfig.create({
        data: {
          key: item.key,
          value: item.storedValue,
          label: metadata.label,
          group: metadata.group,
          description: metadata.description,
          revision: 1,
        },
      });
      continue;
    }
    const metadataData = item.metadata
      ? {
        label: item.metadata.label,
        group: item.metadata.group,
        description: item.metadata.description,
      }
      : {};
    const updated = await client.systemConfig.updateMany({
      where: { key: item.key, revision: item.expectedRevision },
      data: { value: item.storedValue, revision: { increment: 1 }, ...metadataData },
    });
    if (updated.count !== 1) throw new SystemConfigRevisionConflictError([item.key]);
  }

  const configs = await client.systemConfig.findMany({
    where: { key: { in: inputs.map((item) => item.key) } },
  });
  const configByKey = new Map(configs.map((config) => [config.key, config]));
  return {
    configs: inputs.map((item) => configByKey.get(item.key)).filter((config) => config !== undefined),
    changed,
  };
}

// 从 schema 生成 DEFAULTS（启动时 seed）
const DEFAULTS = (Object.keys(SystemConfigSchema) as SystemConfigKey[]).map((key) => {
  const meta = SystemConfigMeta[key];
  const defaultValue = getDefaultValue(key);
  return {
    key,
    value: String(defaultValue),
    label: meta.label,
    group: meta.group,
    description: meta.description,
  };
});

export async function seedSystemConfig(
  client: Pick<typeof prisma, 'systemConfig'> = prisma,
) {
  // 清理已废弃的配置（storage 组已迁移到环境变量）
  await client.systemConfig.deleteMany({
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
    const existing = await client.systemConfig.findUnique({ where: { key: item.key } });
    if (!existing) {
      const safeCloudDefault = getRuntimeMode() === 'cloud'
        && (item.key === 'feature_sms_register' || item.key === 'feature_turnstile_login')
        ? 'false'
        : item.value;
      await client.systemConfig.create({ data: { ...item, value: safeCloudDefault } });
    } else if (
      !PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(item.key) &&
      (
        existing.label !== item.label ||
        existing.group !== item.group ||
        existing.description !== item.description
      )
    ) {
      await client.systemConfig.update({
        where: { key: item.key },
        data: {
          label: item.label,
          group: item.group,
          description: item.description,
        },
      });
    }
  }
}

export async function systemConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);
  app.addHook('preHandler', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    return requireLiveAccountSession(request, reply);
  });

  app.get('/', async (request, reply) => {
    const { group } = request.query as { group?: string };
    const where = group ? { group } : undefined;
    const configs = await prisma.systemConfig.findMany({ where, orderBy: [{ group: 'asc' }, { key: 'asc' }] });
    const masked = configs.map((c) => ({ ...c, value: toPublicConfigValue(c.key, c.value) }));
    return reply.send({ code: 1, msg: 'ok', data: masked });
  });

  app.get('/ai-usage/summary', async (request, reply) => {
    const query = request.query as { date?: string };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || ''))
      ? String(query.date)
      : normalizeAiUsageDate();
    const store = createPrismaAiUsageStore(prisma);
    const namespaces = ['category_term', 'product_title', 'product_description', 'image_text'];
    const total = await store.getDailySummary({ date });
    const byNamespace: Record<string, unknown> = {};
    for (const namespace of namespaces) {
      byNamespace[namespace] = await store.getDailySummary({ date, namespace });
    }
    return reply.send({ code: 1, msg: 'ok', data: { date, total, byNamespace } });
  });

  app.put('/batch', async (request, reply) => {
    const rawItems = (request.body as { items?: Array<Record<string, unknown>> } | null)?.items;
    const rawProtectedItem = Array.isArray(rawItems)
      ? rawItems.find((item) => typeof item?.key === 'string' && PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(item.key))
      : null;
    if (rawProtectedItem) return rejectProtectedStageMutation(reply, String(rawProtectedItem.key));
    if (Array.isArray(rawItems)
      && rawItems.some((item) => !Object.prototype.hasOwnProperty.call(item, 'expectedRevision'))) {
      return rejectRevisionRequired(reply);
    }
    const parsed = batchUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const duplicateKeys = parsed.data.items.filter((item, index, items) => items.findIndex((other) => other.key === item.key) !== index);
    if (duplicateKeys.length > 0) {
      return reply.status(400).send({ code: 0, msg: `配置项重复: ${duplicateKeys[0]?.key}` });
    }

    const protectedItem = parsed.data.items.find((item) => PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(item.key));
    if (protectedItem) return rejectProtectedStageMutation(reply, protectedItem.key);

    for (const item of parsed.data.items) {
      if (!validateKey(item.key)) {
        return reply.status(400).send({ code: 0, msg: `未知配置项: ${item.key}` });
      }
    }

    let result: Awaited<ReturnType<typeof applyConfigMutations>>;
    try {
      result = await prisma.$transaction(
        (tx) => applyConfigMutations(
          tx,
          parsed.data.items.map((item) => ({
            ...item,
            key: item.key as SystemConfigKey,
          })),
        ),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const response = sendMutationError(reply, error);
      if (response) return response;
      throw error;
    }

    const actor = (request as any).user;
    for (const item of result.changed) {
      await logAudit({
        actorId: actor.actorUserId || actor.userId,
        actorRole: actor.role,
        action: 'system_config_update',
        target: item.key,
        before: item.existing
          ? { value: item.oldValueUnreadable ? '***UNREADABLE***' : maskSecretValue(item.key, item.oldValue) }
          : null,
        after: { value: maskSecretValue(item.key, item.displayValue) },
        force: item.key === 'security_audit_log_enabled',
        ...extractRequestMeta(request),
      });
      invalidateConfigCaches(item.key);
    }

    return reply.send({
      code: 1,
      msg: '已批量保存',
      data: result.configs.map((config) => ({ ...config, value: toPublicConfigValue(config.key, config.value) })),
    });
  });

  app.get('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    if (!config) return reply.status(404).send({ code: 0, msg: '配置不存在' });
    return reply.send({ code: 1, msg: 'ok', data: { ...config, value: toPublicConfigValue(config.key, config.value) } });
  });

  app.put('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    if (PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(key)) {
      return rejectProtectedStageMutation(reply, key);
    }
    const body = request.body as { value?: unknown; expectedRevision?: unknown } | null;
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
      return rejectRevisionRequired(reply);
    }
    const parsed = singleUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    let result: Awaited<ReturnType<typeof applyConfigMutations>>;
    try {
      result = await prisma.$transaction(
        (tx) => applyConfigMutations(tx, [{
          key,
          value: parsed.data.value,
          expectedRevision: parsed.data.expectedRevision,
        }]),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const response = sendMutationError(reply, error);
      if (response) return response;
      throw error;
    }
    const config = result.configs[0];
    if (!config) throw new Error(`SystemConfig ${key} missing after update`);

    // 审计日志
    const actor = (request as any).user;
    const changed = result.changed[0];
    if (changed) {
      await logAudit({
        actorId: actor.actorUserId || actor.userId,
        actorRole: actor.role,
        action: 'system_config_update',
        target: key,
        before: changed.existing
          ? { value: changed.oldValueUnreadable ? '***UNREADABLE***' : maskSecretValue(key, changed.oldValue) }
          : null,
        after: { value: maskSecretValue(key, changed.displayValue) },
        force: key === 'security_audit_log_enabled',
        ...extractRequestMeta(request),
      });
    }

    if (changed) invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: toPublicConfigValue(config.key, config.value) } });
  });

  app.post('/', async (request, reply) => {
    const rawBody = request.body as Record<string, unknown> | null;
    if (typeof rawBody?.key === 'string' && PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(rawBody.key)) {
      return rejectProtectedStageMutation(reply, rawBody.key);
    }
    if (!rawBody || !Object.prototype.hasOwnProperty.call(rawBody, 'expectedRevision')) {
      return rejectRevisionRequired(reply);
    }
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { key } = parsed.data;
    if (PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(key)) {
      return rejectProtectedStageMutation(reply, key);
    }
    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    const meta = SystemConfigMeta[key];
    let result: Awaited<ReturnType<typeof applyConfigMutations>>;
    try {
      result = await prisma.$transaction(
        (tx) => applyConfigMutations(tx, [{
          key,
          value: parsed.data.value,
          expectedRevision: parsed.data.expectedRevision,
          metadata: {
            label: parsed.data.label || meta.label,
            group: parsed.data.group === 'general' ? meta.group : parsed.data.group,
            description: parsed.data.description || meta.description,
          },
        }]),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      const response = sendMutationError(reply, error);
      if (response) return response;
      throw error;
    }
    const config = result.configs[0];
    if (!config) throw new Error(`SystemConfig ${key} missing after upsert`);

    // 审计日志
    const actor = (request as any).user;
    const changed = result.changed[0];
    if (changed) {
      await logAudit({
        actorId: actor.actorUserId || actor.userId,
        actorRole: actor.role,
        action: 'system_config_update',
        target: key,
        before: changed.existing
          ? { value: changed.oldValueUnreadable ? '***UNREADABLE***' : maskSecretValue(key, changed.oldValue) }
          : null,
        after: { value: maskSecretValue(key, changed.displayValue) },
        force: key === 'security_audit_log_enabled',
        ...extractRequestMeta(request),
      });
    }

    if (changed) invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: toPublicConfigValue(config.key, config.value) } });
  });

  app.delete('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    if (PROTECTED_OZON_PUBLISHER_STAGE_KEYS.has(key)) {
      return rejectProtectedStageMutation(reply, key);
    }
    const body = request.body as { expectedRevision?: unknown } | null;
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
      return rejectRevisionRequired(reply);
    }
    const parsed = z.object({ expectedRevision: expectedRevisionSchema }).safeParse(body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    let deleted: {
      key: string;
      revision: number;
      oldValue: string;
      oldValueUnreadable: boolean;
    } | null = null;
    try {
      deleted = await prisma.$transaction(async (tx) => {
        const existing = await tx.systemConfig.findUnique({ where: { key } });
        if (!existing) {
          if (parsed.data.expectedRevision !== 0) throw new SystemConfigRevisionConflictError([key]);
          return null;
        }
        if (existing.revision !== parsed.data.expectedRevision) {
          throw new SystemConfigRevisionConflictError([key]);
        }
        let oldValue = '';
        let oldValueUnreadable = false;
        try {
          oldValue = decryptConfigValueStrict(key, existing.value);
        } catch {
          oldValueUnreadable = true;
          if (!requiresAuthProviderPreflight(new Set([key]))) {
            throw new SystemConfigMutationError(
              422,
              'system_config_sensitive_value_unreadable',
              '已保存的敏感配置无法解密，请刷新配置后重试',
            );
          }
        }
        const preflightFailure = await preflightAuthProviderMutation(new Map([[key, null]]), tx);
        if (preflightFailure) {
          throw new SystemConfigMutationError(422, preflightFailure.errorCode, preflightFailure.msg);
        }
        const result = await tx.systemConfig.deleteMany({
          where: { key, revision: parsed.data.expectedRevision },
        });
        if (result.count !== 1) throw new SystemConfigRevisionConflictError([key]);
        return {
          key: existing.key,
          revision: existing.revision,
          oldValue,
          oldValueUnreadable,
        };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      const response = sendMutationError(reply, error);
      if (response) return response;
      throw error;
    }

    if (!deleted) return reply.send({ code: 1, msg: '配置不存在，未执行删除' });

    const actor = (request as any).user;
    await logAudit({
      actorId: actor.actorUserId || actor.userId,
      actorRole: actor.role,
      action: 'system_config_delete',
      target: key,
      before: { value: deleted.oldValueUnreadable ? '***UNREADABLE***' : maskSecretValue(key, deleted.oldValue) },
      after: null,
      force: key === 'security_audit_log_enabled',
      ...extractRequestMeta(request),
    });

    invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.post('/seed', async (_request, reply) => {
    await seedSystemConfig();
    invalidateConfigCaches();
    return reply.send({ code: 1, msg: '默认配置已初始化' });
  });
}
