import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { invalidateFeatureCache } from '../lib/feature-flags.js';
import { invalidateMaintenanceCache } from '../lib/maintenance.js';
import { logAudit, extractRequestMeta } from '../lib/audit-log.js';
import {
  SystemConfigSchema,
  SystemConfigMeta,
  type SystemConfigKey,
  getDefaultValue,
  validateKey,
  coerceConfigValue,
} from '../config/system-config-schema.js';

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  label: z.string().optional(),
  group: z.string().default('general'),
  description: z.string().optional(),
});

const SECRET_FIELDS: string[] = [];

function isSecretKey(key: string): boolean {
  return validateKey(key) && !!SystemConfigMeta[key].sensitive;
}

function maskSecretValue(key: string, value: string): string {
  if (!isSecretKey(key) || !value) return value;
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
  if (!isSecretKey(key) || !oldValue) return newValue;
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
    if (newValue === '***MASKED***' || newValue === maskSecretValue(key, oldValue)) {
      return oldValue;
    }
    // ignore
  }
  return newValue;
}

function invalidateConfigCaches(key?: string) {
  if (!key || key.startsWith('feature_')) invalidateFeatureCache(key);
  if (!key || key.startsWith('maintenance_')) invalidateMaintenanceCache();
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

    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    const finalValue = mergeMaskedValue(key, body.value, existing?.value || '');

    // Schema 校验
    const schema = SystemConfigSchema[key];
    const coerced = coerceConfigValue(key, finalValue);
    const validated = schema.safeParse(coerced);
    if (!validated.success) {
      const errMsg = validated.error.errors[0]?.message || '值不符合要求';
      return reply.status(400).send({ code: 0, msg: `${key}: ${errMsg}` });
    }

    const meta = SystemConfigMeta[key];
    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: finalValue, label: meta.label, group: meta.group, description: meta.description },
      update: { value: finalValue },
    });

    // 审计日志
    const actor = (request as any).user;
    await logAudit({
      actorId: actor.actorUserId || actor.userId,
      actorRole: actor.role,
      action: 'system_config_update',
      target: key,
      before: existing ? { value: maskSecretValue(key, existing.value) } : null,
      after: { value: maskSecretValue(key, finalValue) },
      force: key === 'security_audit_log_enabled',
      ...extractRequestMeta(request),
    });

    invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: maskSecretValue(config.key, config.value) } });
  });

  app.post('/', async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { key } = parsed.data;
    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    const finalValue = mergeMaskedValue(key, parsed.data.value, existing?.value || '');

    // Schema 校验
    const schema = SystemConfigSchema[key];
    const coerced = coerceConfigValue(key, finalValue);
    const validated = schema.safeParse(coerced);
    if (!validated.success) {
      const errMsg = validated.error.errors[0]?.message || '值不符合要求';
      return reply.status(400).send({ code: 0, msg: `${key}: ${errMsg}` });
    }

    const meta = SystemConfigMeta[key];
    const config = await prisma.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: finalValue,
        label: parsed.data.label || meta.label,
        group: parsed.data.group === 'general' ? meta.group : parsed.data.group,
        description: parsed.data.description || meta.description,
      },
      update: {
        value: finalValue,
        label: parsed.data.label || meta.label,
        group: parsed.data.group === 'general' ? meta.group : parsed.data.group,
        description: parsed.data.description || meta.description,
      },
    });

    // 审计日志
    const actor = (request as any).user;
    await logAudit({
      actorId: actor.actorUserId || actor.userId,
      actorRole: actor.role,
      action: 'system_config_update',
      target: key,
      before: existing ? { value: maskSecretValue(key, existing.value) } : null,
      after: { value: maskSecretValue(key, finalValue) },
      force: key === 'security_audit_log_enabled',
      ...extractRequestMeta(request),
    });

    invalidateConfigCaches(key);
    return reply.send({ code: 1, msg: '已保存', data: { ...config, value: maskSecretValue(config.key, config.value) } });
  });

  app.delete('/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!validateKey(key)) {
      return reply.status(400).send({ code: 0, msg: `未知配置项: ${key}` });
    }

    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    await prisma.systemConfig.deleteMany({ where: { key } });

    const actor = (request as any).user;
    await logAudit({
      actorId: actor.actorUserId || actor.userId,
      actorRole: actor.role,
      action: 'system_config_delete',
      target: key,
      before: existing ? { value: maskSecretValue(key, existing.value) } : null,
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
