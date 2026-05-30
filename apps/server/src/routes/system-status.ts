import type { FastifyInstance } from 'fastify';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

interface ConfiguredCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
}

function envIsSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

async function dbConfigPresent(key: string): Promise<boolean> {
  const cfg = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  return !!(cfg?.value && cfg.value.trim().length > 0);
}

export async function systemStatusRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/integrations', async (_request, reply) => {
    const ossConfigured = await dbConfigPresent('oss_config');
    const ozonRelay = await dbConfigPresent('ozon_cdn_relay_url');

    const checks: ConfiguredCheck[] = [
      {
        key: 'sms',
        label: '短信服务',
        configured:
          envIsSet('SMS_PROVIDER') &&
          process.env.SMS_PROVIDER !== 'console' &&
          envIsSet('SMS_TENCENT_SECRET_ID') &&
          envIsSet('SMS_TENCENT_SECRET_KEY') &&
          envIsSet('SMS_TENCENT_SDK_APP_ID') &&
          envIsSet('SMS_TENCENT_SIGN_NAME') &&
          envIsSet('SMS_TENCENT_TEMPLATE_ID'),
        source: 'env',
        detail: process.env.SMS_PROVIDER === 'console' ? '当前为 console（仅开发）' : (process.env.SMS_PROVIDER || '未配置'),
      },
      {
        key: 'turnstile',
        label: 'Cloudflare Turnstile',
        configured: envIsSet('TURNSTILE_SECRET_KEY'),
        source: 'env',
      },
      {
        key: 'sentry',
        label: 'Sentry',
        configured: envIsSet('SENTRY_DSN'),
        source: 'env',
      },
      {
        key: 'oss',
        label: 'OSS 对象存储',
        configured: ossConfigured,
        source: 'db',
      },
      {
        key: 'ozon_cdn_relay',
        label: 'OZON CDN 中转',
        configured: ozonRelay,
        source: 'db',
        detail: '可选，国内直连失败时用',
      },
    ];

    return reply.send({ code: 1, data: { checks } });
  });

  app.get('/ops', async (_request, reply) => {
    const checks: Record<string, { status: string; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = { status: 'ok' };
    } catch (e: any) {
      checks.db = { status: 'fail', detail: e?.message?.slice(0, 200) };
    }

    const redisDisabled = process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true';
    if (redisDisabled) {
      checks.redis = { status: 'disabled' };
    } else {
      try {
        await redis.ping();
        checks.redis = { status: 'ok' };
      } catch (e: any) {
        checks.redis = { status: 'fail', detail: e?.message?.slice(0, 200) };
      }
    }

    const runWorkers = process.env.RUN_WORKERS !== '0' && process.env.RUN_WORKERS !== 'false';
    checks.workers = {
      status: runWorkers ? 'in-process' : 'separated',
      detail: runWorkers ? 'API 进程内运行 worker（开发/单机模式）' : '独立 worker 进程（推荐生产）',
    };

    const runtimeMode = process.env.RUNTIME_MODE || 'local';
    checks.runtime = { status: runtimeMode };

    const corsOrigin = process.env.CORS_ORIGIN || '';
    checks.cors = {
      status: corsOrigin ? 'configured' : 'unset',
      detail: corsOrigin || '未配置 CORS_ORIGIN',
    };

    return reply.send({
      code: 1,
      data: {
        checks,
        version: process.env.APP_VERSION || 'dev',
        nodeEnv: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  });

  app.post('/test/turnstile', async (_request, reply) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) return reply.send({ code: 0, msg: 'TURNSTILE_SECRET_KEY 未配置' });

    try {
      const body = new URLSearchParams({ secret, response: 'XXXX.DUMMY.TOKEN.XXXX' });
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(5000),
      });
      const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] };
      const codes = data['error-codes'] || [];
      if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
        return reply.send({ code: 0, msg: 'Secret Key 无效，请检查 TURNSTILE_SECRET_KEY' });
      }
      return reply.send({ code: 1, msg: 'Secret Key 已被 Cloudflare 接受（测试 token 被预期拒绝）', data: { errorCodes: codes } });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `连接 Cloudflare 失败: ${e?.message || 'unknown'}` });
    }
  });

  app.post('/test/sms', async (_request, reply) => {
    const provider = process.env.SMS_PROVIDER || '';
    if (!provider || provider === 'console') {
      return reply.send({ code: 0, msg: 'SMS_PROVIDER 未配置或为 console（仅开发用）' });
    }
    if (provider !== 'tencent') {
      return reply.send({ code: 0, msg: `provider=${provider} 测试尚未实现` });
    }
    try {
      const { TencentSmsProvider } = await import('../lib/sms/tencent.js');
      new TencentSmsProvider();
      return reply.send({ code: 1, msg: '腾讯云 SMS 配置已加载，凭证字段齐全（实际发送需触发注册流程）' });
    } catch (e: any) {
      return reply.send({ code: 0, msg: e?.message || '加载失败' });
    }
  });

  app.post('/test/oss', async (_request, reply) => {
    try {
      const cfg = await prisma.systemConfig.findUnique({ where: { key: 'oss_config' } });
      if (!cfg?.value) return reply.send({ code: 0, msg: 'OSS 未配置' });

      const parsed = JSON.parse(cfg.value);
      if (!parsed.endpoint || !parsed.bucket || !parsed.accessKeyId || !parsed.accessKeySecret) {
        return reply.send({ code: 0, msg: 'OSS 配置不完整（endpoint/bucket/accessKey 必填）' });
      }

      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const endpoint = parsed.endpoint.startsWith('http') ? parsed.endpoint : `https://${parsed.endpoint}`;
      const client = new S3Client({
        endpoint,
        region: parsed.region || 'auto',
        credentials: { accessKeyId: parsed.accessKeyId, secretAccessKey: parsed.accessKeySecret },
        forcePathStyle: endpoint.includes('localhost') || endpoint.includes('minio'),
      });

      await client.send(new HeadBucketCommand({ Bucket: parsed.bucket }));
      return reply.send({ code: 1, msg: `OSS 连接成功（bucket=${parsed.bucket}）` });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `OSS 连接失败: ${e?.message?.slice(0, 200) || 'unknown'}` });
    }
  });

  app.post('/test/sentry', async (_request, reply) => {
    if (!process.env.SENTRY_DSN) return reply.send({ code: 0, msg: 'SENTRY_DSN 未配置' });
    try {
      const { Sentry } = await import('../lib/sentry.js');
      const id = Sentry.captureMessage('[ss-erp] system-status test event', 'info');
      await Sentry.flush(2000);
      return reply.send({ code: 1, msg: `已发送测试事件到 Sentry（id=${id || 'unknown'}）` });
    } catch (e: any) {
      return reply.send({ code: 0, msg: e?.message || '发送失败' });
    }
  });
}
