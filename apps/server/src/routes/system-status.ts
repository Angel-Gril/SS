import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { getConfig } from '../config/system-config-schema.js';
import { sendEmail } from '../lib/email/index.js';

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

const emailTestSchema = z.object({
  to: z.string().trim().email('请输入有效的收件邮箱'),
});

async function getUploadOssDiagnostic() {
  const [
    backend,
    endpoint,
    bucket,
    accessKeyId,
    accessKeySecret,
    region,
  ] = await Promise.all([
    getConfig('upload_storage_backend'),
    getConfig('upload_oss_endpoint'),
    getConfig('upload_oss_bucket'),
    getConfig('upload_oss_access_key_id'),
    getConfig('upload_oss_access_key_secret'),
    getConfig('upload_oss_region'),
  ]);

  const required = [
    { key: 'upload_oss_endpoint', label: 'Endpoint', value: endpoint },
    { key: 'upload_oss_bucket', label: 'Bucket', value: bucket },
    { key: 'upload_oss_access_key_id', label: 'Access Key ID', value: accessKeyId },
    { key: 'upload_oss_access_key_secret', label: 'Secret Access Key', value: accessKeySecret },
    { key: 'upload_oss_region', label: 'Region', value: region },
  ];
  const missing = required.filter((item) => !String(item.value || '').trim()).map((item) => item.label);
  const filled = required.filter((item) => String(item.value || '').trim()).map((item) => item.label);
  const hasAnyDbUploadConfig = backend !== 'env' || filled.length > 0;

  return {
    backend,
    missing,
    filled,
    hasAnyDbUploadConfig,
    hasCompleteDbOssConfig: missing.length === 0,
  };
}

export async function systemStatusRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/integrations', async (_request, reply) => {
    const rc = await getRuntimeConfigForStorage();
    const uploadOss = await getUploadOssDiagnostic();
    const ossConfigured = rc.oss !== null;
    const ozonRelay = !!rc.ozonCdnRelayUrl;
    const ossSource = rc.source === 'system-config'
      ? 'db'
      : uploadOss.hasAnyDbUploadConfig
        ? 'mixed'
        : 'env';
    const ossDetail = ossConfigured
      ? `backend=${rc.imageStorage}, bucket=${rc.oss!.bucket}`
      : [
          `backend=${rc.imageStorage}`,
          uploadOss.hasAnyDbUploadConfig
            ? `后台 R2 未完整：缺少 ${uploadOss.missing.join('、') || '无'}`
            : '后台 upload_* 未配置',
          '需在系统设置保存完整 R2 必填项后才会切换为 oss',
        ].join('；');

    const checks: ConfiguredCheck[] = [
      {
        key: 'email',
        label: '邮件服务',
        configured:
          process.env.EMAIL_PROVIDER === 'resend' &&
          envIsSet('EMAIL_FROM') &&
          envIsSet('EMAIL_API_KEY'),
        source: 'env',
        detail: process.env.EMAIL_PROVIDER === 'console' ? '当前为 console（仅开发）' : (process.env.EMAIL_PROVIDER || '未配置'),
      },
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
        source: ossSource,
        detail: ossDetail,
      },
      {
        key: 'ozon_cdn_relay',
        label: 'OZON CDN 中转',
        configured: ozonRelay,
        source: rc.source === 'system-config' ? 'db' : 'env',
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

  app.post('/test/email', async (request, reply) => {
    const parsed = emailTestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    try {
      const result = await sendEmail({
        to: parsed.data.to,
        subject: 'SS ERP 邮件服务测试',
        text: '这是一封 SS ERP 邮件服务配置测试。如果您收到本邮件，说明当前邮件 provider 可以正常发送系统邮件。',
        html: [
          '<!doctype html>',
          '<html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6">',
          '<h2 style="margin:0 0 12px">SS ERP 邮件服务测试</h2>',
          '<p>如果您收到本邮件，说明当前邮件 provider 可以正常发送系统邮件。</p>',
          '<p style="color:#64748b;font-size:12px;margin-top:24px">SS ERP 系统通知</p>',
          '</body></html>',
        ].join(''),
      });

      if (!result.ok) {
        return reply.send({ code: 0, msg: result.err || '邮件服务测试失败' });
      }
      return reply.send({ code: 1, msg: '邮件服务测试已发送', data: { bizId: result.bizId ?? null } });
    } catch (e: any) {
      return reply.send({ code: 0, msg: e?.message || '邮件服务测试失败' });
    }
  });

  app.post('/test/oss', async (_request, reply) => {
    try {
      const storageConfig = await getRuntimeConfigForStorage();
      if (!storageConfig.oss) {
        const uploadOss = await getUploadOssDiagnostic();
        const missing = uploadOss.hasAnyDbUploadConfig && uploadOss.missing.length > 0
          ? `，当前后台缺少：${uploadOss.missing.join('、')}`
          : '';
        return reply.send({ code: 0, msg: `OSS 未配置${missing}。请在超管设置 -> 上传与对象存储中补齐 R2 必填项并保存，或设置 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET` });
      }

      const { endpoint, bucket, accessKeyId, accessKeySecret, region } = storageConfig.oss;
      const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const fullEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      const client = new S3Client({
        endpoint: fullEndpoint,
        region: region || 'auto',
        credentials: { accessKeyId, secretAccessKey: accessKeySecret },
        forcePathStyle: fullEndpoint.includes('localhost') || fullEndpoint.includes('minio'),
      });

      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return reply.send({ code: 1, msg: `OSS 连接成功（bucket=${bucket}）` });
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
