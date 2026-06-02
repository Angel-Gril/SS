import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { getRuntimeConfigForStorage } from '../adapters/runtime-config.js';
import { getConfig } from '../config/system-config-schema.js';
import { getSmsRuntimeConfig, getTurnstileRuntimeConfig } from '../lib/auth-challenge-config.js';
import { getSmsProvider } from '../lib/sms/index.js';

interface ConfiguredCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
}

type DiagnosticStepStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface DiagnosticStep {
  key: string;
  label: string;
  status: DiagnosticStepStatus;
  detail?: string;
  elapsedMs?: number;
  critical?: boolean;
}

function envIsSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function hasAll(values: string[]): boolean {
  return values.every((value) => String(value || '').trim().length > 0);
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{2,3})?\d{3}(\d{4})$/, '$1***$2');
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  return message.replace(/\s+/g, ' ').slice(0, 300);
}

function buildCdnProxyUrl(baseUrl: string, objectKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/cdn/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

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
    const [smsConfig, turnstileConfig] = await Promise.all([
      getSmsRuntimeConfig(),
      getTurnstileRuntimeConfig(),
    ]);
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
        key: 'sms',
        label: '短信服务',
        configured: smsConfig.provider === 'console' || (
          smsConfig.provider === 'tencent' &&
          hasAll([
            smsConfig.tencent.secretId,
            smsConfig.tencent.secretKey,
            smsConfig.tencent.sdkAppId,
            smsConfig.tencent.signName,
            smsConfig.tencent.templateId,
          ])
        ),
        source: smsConfig.source === 'system-config' ? 'db' : smsConfig.source,
        detail: smsConfig.provider === 'console'
          ? '当前为 console（仅开发/测试，不发送真实短信）'
          : smsConfig.provider === 'tencent'
            ? `provider=tencent, region=${smsConfig.tencent.region}, sdkAppId=${smsConfig.tencent.sdkAppId || '未填'}`
            : '未配置短信 provider',
      },
      {
        key: 'turnstile',
        label: 'Cloudflare Turnstile',
        configured: hasAll([turnstileConfig.secretKey]),
        source: turnstileConfig.source === 'system-config' ? 'db' : turnstileConfig.source === 'none' ? 'env' : turnstileConfig.source,
        detail: turnstileConfig.enabled
          ? `已启用，Site Key ${turnstileConfig.siteKey ? '已配置' : '未配置'}`
          : '后台开关已关闭，当前不会要求人机验证',
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
    const turnstileConfig = await getTurnstileRuntimeConfig();
    const secret = turnstileConfig.secretKey;
    if (!secret) return reply.send({ code: 0, msg: 'Turnstile Secret Key 未配置。请在系统设置 -> 短信与人机验证中填写，或配置 TURNSTILE_SECRET_KEY' });

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
        return reply.send({ code: 0, msg: 'Secret Key 无效，请检查后台配置或 TURNSTILE_SECRET_KEY' });
      }
      return reply.send({ code: 1, msg: 'Secret Key 已被 Cloudflare 接受（测试 token 被预期拒绝）', data: { errorCodes: codes } });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `连接 Cloudflare 失败: ${e?.message || 'unknown'}` });
    }
  });

  app.post('/test/sms', async (request, reply) => {
    const smsConfig = await getSmsRuntimeConfig();
    const body = request.body as { phone?: string };
    const phone = String(body?.phone || '').trim();

    if (!smsConfig.provider) {
      return reply.send({ code: 0, msg: '短信 provider 未配置。请在系统设置 -> 短信与人机验证中选择 tencent，或配置 SMS_PROVIDER' });
    }

    if (smsConfig.provider === 'console') {
      if (phone) {
        const provider = await getSmsProvider();
        await provider.send(phone, '123456');
      }
      return reply.send({ code: 1, msg: phone ? `console 测试短信已写入服务器日志（${maskPhone(phone)}）` : 'console provider 可用（仅开发/测试，不发送真实短信）' });
    }

    if (smsConfig.provider !== 'tencent') {
      return reply.send({ code: 0, msg: `provider=${smsConfig.provider} 测试尚未实现` });
    }

    const missing = [
      ['SecretId', smsConfig.tencent.secretId],
      ['SecretKey', smsConfig.tencent.secretKey],
      ['SDK AppId', smsConfig.tencent.sdkAppId],
      ['签名', smsConfig.tencent.signName],
      ['模板 ID', smsConfig.tencent.templateId],
    ].filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (missing.length > 0) {
      return reply.send({ code: 0, msg: `腾讯云 SMS 配置不完整：缺少 ${missing.join('、')}` });
    }

    try {
      const provider = await getSmsProvider();
      if (!phone) {
        return reply.send({ code: 1, msg: '腾讯云 SMS 配置已加载，凭证字段齐全。填写手机号可发送真实测试短信' });
      }

      if (smsConfig.testPhoneWhitelist.length > 0 && !smsConfig.testPhoneWhitelist.includes(phone)) {
        return reply.send({ code: 0, msg: `测试手机号不在白名单中：${maskPhone(phone)}` });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const result = await provider.send(phone, code);
      if (!result.ok) {
        return reply.send({ code: 0, msg: `测试短信发送失败：${result.err || 'unknown'}` });
      }
      return reply.send({ code: 1, msg: `测试短信已发送到 ${maskPhone(phone)}` });
    } catch (e: any) {
      return reply.send({ code: 0, msg: e?.message || '加载失败' });
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
      const { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const fullEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      const client = new S3Client({
        endpoint: fullEndpoint,
        region: region || 'auto',
        credentials: { accessKeyId, secretAccessKey: accessKeySecret },
        forcePathStyle: fullEndpoint.includes('localhost') || fullEndpoint.includes('minio'),
      });

      const steps: DiagnosticStep[] = [
        {
          key: 'config',
          label: '读取上传配置',
          status: 'pass',
          detail: `backend=${storageConfig.imageStorage}, source=${storageConfig.source}, bucket=${bucket}, region=${region || 'auto'}`,
        },
      ];
      const testKey = `system/attachments/tests/oss-health-${Date.now()}-${randomUUID()}.txt`;
      const testBody = `ss-erp oss health check\nkey=${testKey}\nat=${new Date().toISOString()}\n`;
      const proxyUrl = buildCdnProxyUrl(storageConfig.localBaseUrl, testKey);
      let uploaded = false;

      async function addStep(
        key: string,
        label: string,
        critical: boolean,
        fn: () => Promise<string | undefined>,
        warnOnly = false,
      ): Promise<boolean> {
        const startedAt = Date.now();
        try {
          const detail = await fn();
          steps.push({
            key,
            label,
            status: 'pass',
            detail,
            elapsedMs: Date.now() - startedAt,
            critical,
          });
          return true;
        } catch (error) {
          steps.push({
            key,
            label,
            status: warnOnly ? 'warn' : 'fail',
            detail: shortError(error),
            elapsedMs: Date.now() - startedAt,
            critical,
          });
          return warnOnly;
        }
      }

      await addStep(
        'headBucket',
        '桶访问诊断',
        false,
        async () => {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
          return 'Bucket 可访问';
        },
        true,
      );

      const putOk = await addStep(
        'putObject',
        '写入测试对象',
        true,
        async () => {
          await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: testKey,
            Body: Buffer.from(testBody, 'utf8'),
            ContentType: 'text/plain; charset=utf-8',
            CacheControl: 'no-store',
          }));
          uploaded = true;
          return `已写入 ${testKey}`;
        },
      );

      const getOk = putOk && await addStep(
        'getObject',
        '直接读取校验',
        true,
        async () => {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: testKey }));
          const body = result.Body
            ? Buffer.from(await result.Body.transformToByteArray()).toString('utf8')
            : '';
          if (body !== testBody) throw new Error('读取内容与写入内容不一致');
          return `读取成功，${Buffer.byteLength(body)} bytes`;
        },
      );

      if (!putOk) {
        steps.push({
          key: 'getObject',
          label: '直接读取校验',
          status: 'skip',
          detail: '写入失败，跳过读取',
          critical: true,
        });
        steps.push({
          key: 'proxyRead',
          label: 'CDN 代理读取',
          status: 'skip',
          detail: '写入失败，跳过代理读取',
          critical: true,
        });
      } else if (!getOk) {
        steps.push({
          key: 'proxyRead',
          label: 'CDN 代理读取',
          status: 'skip',
          detail: '直接读取失败，跳过代理读取',
          critical: true,
        });
      } else {
        await addStep(
          'proxyRead',
          'CDN 代理读取',
          true,
          async () => {
            const res = await fetch(proxyUrl, {
              headers: { 'user-agent': 'SS-ERP-OSS-HealthCheck/1.0' },
              signal: AbortSignal.timeout(8000),
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
            if (text !== testBody) throw new Error('代理读取内容与写入内容不一致');
            return `代理可读：${proxyUrl}`;
          },
        );
      }

      if (uploaded) {
        const deleteOk = await addStep(
          'deleteObject',
          '删除测试对象',
          true,
          async () => {
            await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
            uploaded = false;
            return '测试对象已删除';
          },
        );
        if (!deleteOk) {
          console.warn(`[system-status] OSS health check left test object: ${testKey}`);
        }
      } else {
        steps.push({
          key: 'deleteObject',
          label: '删除测试对象',
          status: 'skip',
          detail: '未写入测试对象，无需删除',
          critical: true,
        });
      }

      const criticalFailed = steps.some((step) => step.critical && step.status === 'fail');
      const warnCount = steps.filter((step) => step.status === 'warn').length;
      return reply.send({
        code: criticalFailed ? 0 : 1,
        msg: criticalFailed
          ? 'OSS/R2 完整链路测试失败，请查看失败步骤'
          : warnCount > 0
            ? 'OSS/R2 上传读取链路可用，但存在非关键诊断警告'
            : 'OSS/R2 完整链路测试通过',
        data: {
          endpoint: fullEndpoint,
          bucket,
          source: storageConfig.source,
          backend: storageConfig.imageStorage,
          proxyPath: `/api/cdn/${testKey}`,
          proxyUrl,
          testObjectDeleted: !uploaded,
          steps,
        },
      });
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
