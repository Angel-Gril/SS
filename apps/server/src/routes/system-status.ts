import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { getRuntimeConfigForStorage, getRuntimeMode } from '../adapters/runtime-config.js';
import { getConfig } from '../config/system-config-schema.js';
import { getSmsRuntimeConfig } from '../lib/auth-challenge-config.js';
import { isAliyunTemplateParamName } from '../lib/auth-provider-activation.js';
import { getHumanChallengeRuntimeConfig, type HumanChallengeRuntimeConfig } from '../lib/human-challenge.js';
import { getSmsProvider } from '../lib/sms/index.js';
import { queryApprovedAliyunSmsResources } from '../lib/sms/aliyun.js';
import {
  commitSmsSendQuota,
  getSmsGlobalQuotaSnapshot,
  getSmsQuotaDenialMessage,
  reserveSmsSendQuota,
  rollbackSmsSendQuota,
  SMS_QUOTA_HASH_TAG,
} from '../lib/sms/send-quota.js';
import { getBackupRuntimeConfig, testBackupRemoteStorage } from '../services/backup.service.js';
import {
  aiImageCredentialEndpointIdentity,
  testAiImageProviderConnection,
} from '../services/ai-image-providers.js';
import {
  classifyObjectStorageProbeFailure,
  inferObjectStorageProvider,
  resolveObjectStoragePublicUrl,
} from 'shared/object-storage';

interface ConfiguredCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
  warning?: string;
  testable?: boolean;
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

function mapRuntimeSource(source: 'env' | 'system-config' | 'mixed'): ConfiguredCheck['source'] {
  return source === 'system-config' ? 'db' : source;
}

export function buildHumanChallengeIntegrationCheck(
  config: HumanChallengeRuntimeConfig,
): ConfiguredCheck {
  const turnstileConfigured = config.provider === 'cloudflare-turnstile'
    && config.hostnameConfigValid
    && hasAll([config.turnstileSiteKey, config.turnstileSecretKey])
    && config.allowedHostnames.length > 0;
  const powConfigured = config.provider === 'builtin-pow'
    && config.signingSecret.length >= 32
    && config.difficulty >= 1
    && config.difficulty <= 5
    && config.ttlSeconds >= 30
    && config.ttlSeconds <= 600;

  return {
    key: 'turnstile',
    label: '人机验证',
    configured: config.providerConfigValid && (turnstileConfigured || powConfigured),
    source: mapRuntimeSource(config.source),
    testable: config.provider === 'cloudflare-turnstile',
    detail: !config.providerConfigValid
      ? 'HUMAN_CHALLENGE_PROVIDER 配置非法，认证已失败关闭'
      : config.provider === 'cloudflare-turnstile'
        ? !config.hostnameConfigValid
          ? 'Turnstile hostname 白名单配置非法，认证已失败关闭'
          : `已启用 Cloudflare Turnstile，Site Key ${config.turnstileSiteKey ? '已配置' : '未配置'}，hostname 白名单 ${config.allowedHostnames.length} 个`
        : config.provider === 'builtin-pow'
          ? `已启用内置 PoW，签名密钥 ${config.signingSecret.length >= 32 ? '已配置' : '未配置或不足 32 位'}，难度 ${config.difficulty}，有效期 ${config.ttlSeconds} 秒`
          : '人机验证已关闭',
  };
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\+?\d{2,3})?\d{3}(\d{4})$/, '$1***$2');
}

function maskedSecretValue(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}***${value.slice(-4)}` : '***MASKED***';
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  return message.replace(/\s+/g, ' ').slice(0, 300);
}

function buildCdnProxyUrl(baseUrl: string, objectKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/cdn/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

async function requireLiveAccountSession(request: FastifyRequest, reply: FastifyReply) {
  if ((request as any).user?.tokenUse === 'account_session') return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'system_status_account_session_required',
    msg: '系统诊断需要当前账号会话',
  });
}

async function getUploadOssDiagnostic() {
  const [backend, provider, endpoint, bucket, accessKeyId, accessKeySecret, region] = await Promise.all([
    getConfig('upload_storage_backend'),
    getConfig('upload_oss_provider'),
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
  const missing = required
    .filter((item) => !String(item.value || '').trim())
    .map((item) => item.label);
  const filled = required
    .filter((item) => String(item.value || '').trim())
    .map((item) => item.label);
  const hasAnyDbUploadConfig = backend !== 'env'
    || provider !== 's3-compatible'
    || [endpoint, bucket, accessKeyId, accessKeySecret].some((value) => String(value || '').trim())
    || (String(region || '').trim() !== '' && String(region || '').trim() !== 'auto');

  return {
    backend,
    provider,
    missing,
    filled,
    hasAnyDbUploadConfig,
    hasCompleteDbOssConfig: missing.length === 0,
  };
}

export async function systemStatusRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/integrations', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
    const rc = await getRuntimeConfigForStorage();
    const [
      smsConfig,
      humanChallengeConfig,
      savedHumanChallengeProvider,
      savedSmsProvider,
      featureSmsRegister,
      featureSmsLogin,
    ] = await Promise.all([
      getSmsRuntimeConfig(),
      getHumanChallengeRuntimeConfig(),
      getConfig('auth_human_challenge_provider'),
      getConfig('auth_sms_provider'),
      getConfig('feature_sms_register'),
      getConfig('feature_sms_login'),
    ]);
    const backupConfig = await getBackupRuntimeConfig();
    const smsQuota = await getSmsGlobalQuotaSnapshot(smsConfig.dailyGlobalLimit);
    const uploadOss = await getUploadOssDiagnostic();
    const ossConfigured = rc.oss !== null;
    const ozonRelay = !!rc.ozonCdnRelayUrl;
    const ossSource = mapRuntimeSource(rc.source);
    const effectiveStorageProvider = rc.imageStorage === 'oss' && rc.oss
      ? inferObjectStorageProvider(rc.oss.endpoint)
      : null;
    const ossDetail = ossConfigured
      ? `backend=${rc.imageStorage}, provider=${effectiveStorageProvider}`
      : [
          `backend=${rc.imageStorage}`,
          uploadOss.hasAnyDbUploadConfig
            ? `后台 R2 未完整：缺少 ${uploadOss.missing.join('、') || '无'}`
            : '后台 upload_* 未配置',
          '需在系统设置保存完整 R2 必填项后才会切换为 oss',
        ].join('；');
    const runtimeMode = getRuntimeMode();
    const aliyunRegisterTemplateCode = smsConfig.aliyun.registerTemplateCode || smsConfig.aliyun.templateCode;
    const aliyunRegisterTemplateParamName = smsConfig.aliyun.registerTemplateCode
      ? smsConfig.aliyun.registerTemplateParamName
      : smsConfig.aliyun.templateParamName;
    const aliyunCredentialSource = smsConfig.aliyun.credentialSource
      || (smsConfig.aliyun.credentialMode === 'ecs_ram_role'
        ? 'ecs_ram_role'
        : smsConfig.aliyun.accessKeyId || smsConfig.aliyun.accessKeySecret
          ? 'sms_env_access_key'
          : 'aliyun_default_chain');
    const aliyunDelegatesToDefaultChain = smsConfig.aliyun.credentialMode === 'auto'
      && !smsConfig.aliyun.accessKeyId
      && !smsConfig.aliyun.accessKeySecret;
    const aliyunCredentialWarning = smsConfig.provider === 'aliyun' && aliyunDelegatesToDefaultChain
      ? '阿里云 SDK 默认凭据链正在生效，实际凭据来源与可用性未验证；可能来自 ALIBABA_CLOUD_*、本机 profile 或 ECS 元数据'
      : null;
    const aliyunHasAnyAccessKey = Boolean(smsConfig.aliyun.accessKeyId || smsConfig.aliyun.accessKeySecret);
    const aliyunCredentialsConfigured = smsConfig.aliyun.credentialMode === 'access_key'
      ? hasAll([smsConfig.aliyun.accessKeyId, smsConfig.aliyun.accessKeySecret])
      : smsConfig.aliyun.credentialMode === 'auto' && aliyunHasAnyAccessKey
        ? hasAll([smsConfig.aliyun.accessKeyId, smsConfig.aliyun.accessKeySecret])
        : true;
    const aliyunRegisterConfigured = !featureSmsRegister || (
      hasAll([aliyunRegisterTemplateCode, aliyunRegisterTemplateParamName])
      && isAliyunTemplateParamName(aliyunRegisterTemplateParamName)
    );
    const aliyunPasswordResetConfigured = hasAll([
      smsConfig.aliyun.passwordResetTemplateCode,
      smsConfig.aliyun.passwordResetTemplateParamName,
    ]) && isAliyunTemplateParamName(smsConfig.aliyun.passwordResetTemplateParamName);
    const aliyunSmsLoginConfigured = !featureSmsLogin || (
      hasAll([
        smsConfig.aliyun.smsLoginTemplateCode,
        smsConfig.aliyun.smsLoginTemplateParamName,
      ]) && isAliyunTemplateParamName(smsConfig.aliyun.smsLoginTemplateParamName)
    );
    const aliyunConfigured = aliyunCredentialsConfigured
      && hasAll([smsConfig.aliyun.signName])
      && aliyunRegisterConfigured
      && aliyunPasswordResetConfigured
      && aliyunSmsLoginConfigured;
    const smsQuotaDetail = smsQuota.available
      ? `今日发送尝试 ${smsQuota.used}/${smsQuota.limit}，剩余 ${smsQuota.remaining}，Asia/Shanghai 次日重置`
      : '短信额度 Redis 状态不可用，真实发送将失败关闭';
    const smsConfigured =
      (smsConfig.provider === 'console' && runtimeMode !== 'cloud')
      || (smsConfig.provider === 'tencent'
        && hasAll([
          smsConfig.tencent.secretId,
          smsConfig.tencent.secretKey,
          smsConfig.tencent.sdkAppId,
          smsConfig.tencent.signName,
          smsConfig.tencent.templateId,
        ]))
      || (smsConfig.provider === 'aliyun' && aliyunConfigured);
    const humanChallengeCheck = buildHumanChallengeIntegrationCheck(humanChallengeConfig);
    const humanChallengeSource = mapRuntimeSource(humanChallengeConfig.source);
    const smsSource = mapRuntimeSource(smsConfig.source);
    const uploadStorageConfigured = rc.imageStorage !== 'oss' || ossConfigured;
    const runtimeSelections = {
      runtimeMode,
      humanChallenge: {
        savedProvider: savedHumanChallengeProvider,
        effectiveProvider: humanChallengeConfig.provider,
        source: humanChallengeSource,
        configured: humanChallengeCheck.configured,
        providerConfigValid: humanChallengeConfig.providerConfigValid,
        hostnameConfigValid: humanChallengeConfig.provider === 'cloudflare-turnstile'
          ? humanChallengeConfig.hostnameConfigValid
          : true,
        overridden: humanChallengeSource !== 'db'
          || savedHumanChallengeProvider !== humanChallengeConfig.provider,
      },
      sms: {
        savedProvider: savedSmsProvider,
        effectiveProvider: smsConfig.provider,
        source: smsSource,
        configured: smsConfigured,
        overridden: smsSource !== 'db' || savedSmsProvider !== smsConfig.provider,
        ...(smsConfig.provider === 'aliyun'
          ? {
              credentialSource: aliyunCredentialSource,
              warning: aliyunCredentialWarning,
            }
          : {}),
      },
      uploadStorage: {
        savedBackend: uploadOss.backend,
        savedProvider: uploadOss.provider,
        effectiveBackend: rc.imageStorage,
        effectiveProvider: effectiveStorageProvider,
        source: ossSource,
        configured: uploadStorageConfigured,
        overridden: ossSource !== 'db'
          || uploadOss.backend !== rc.imageStorage
          || (effectiveStorageProvider !== null && uploadOss.provider !== effectiveStorageProvider),
      },
    };

    const checks: ConfiguredCheck[] = [
      {
        key: 'sms',
        label: '短信服务',
        configured: smsConfigured,
        source: smsSource,
        warning: aliyunCredentialWarning || undefined,
        detail: `${
          smsConfig.provider === 'console'
            ? runtimeMode === 'cloud'
              ? 'cloud 模式禁止 console provider'
              : '当前为 console（仅开发/测试，不发送真实短信）'
            : smsConfig.provider === 'tencent'
              ? `provider=tencent, region=${smsConfig.tencent.region}, sdkAppId=${smsConfig.tencent.sdkAppId || '未填'}`
              : smsConfig.provider === 'aliyun'
                ? `provider=aliyun, credential=${smsConfig.aliyun.credentialMode}, credentialSource=${aliyunCredentialSource}, register=${aliyunRegisterTemplateCode || '未填'}, password-reset=${smsConfig.aliyun.passwordResetTemplateCode || '未填'}, sms-login=${smsConfig.aliyun.smsLoginTemplateCode || '未填'}${aliyunCredentialWarning ? `；警告：${aliyunCredentialWarning}` : ''}`
                : '未配置短信 provider'
        }；${smsQuotaDetail}`,
      },
      humanChallengeCheck,
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
        key: 'backup',
        label: '数据库备份 R2',
        configured: !!backupConfig.remote,
        source: backupConfig.remoteSource === 'system-config' ? 'db' : 'env',
        detail: backupConfig.remote
          ? `远程备份已配置，source=${backupConfig.remoteSource}`
          : backupConfig.remoteEnabled
            ? `远程备份未完整：缺少 ${backupConfig.remoteMissing.join('、') || '未知字段'}`
            : '未启用远程备份；可在系统设置 -> 备份策略中配置',
      },
      {
        key: 'ozon_cdn_relay',
        label: 'OZON CDN 中转',
        configured: ozonRelay,
        source: mapRuntimeSource(rc.source),
        detail: '可选，国内直连失败时用',
      },
    ];

    return reply.send({ code: 1, data: { checks, runtimeSelections } });
  });

  app.get('/ops', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
    const checks: Record<string, { status: string; detail?: string }> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.db = { status: 'ok' };
    } catch (e: any) {
      checks.db = { status: 'fail', detail: e?.message?.slice(0, 200) };
    }

    const redisDisabled =
      process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true';
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
      detail: runWorkers
        ? 'API 进程内运行 worker（开发/单机模式）'
        : '独立 worker 进程（推荐生产）',
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

  app.post('/test/turnstile', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
    const turnstileConfig = await getHumanChallengeRuntimeConfig();
    if (!turnstileConfig.providerConfigValid) {
      return reply.send({
        code: 0,
        errorCode: 'human_challenge_provider_invalid',
        msg: 'HUMAN_CHALLENGE_PROVIDER 配置非法，认证已失败关闭',
      });
    }
    if (turnstileConfig.provider !== 'cloudflare-turnstile') {
      return reply.send({ code: 0, msg: `当前人机验证 provider=${turnstileConfig.provider}，未启用 Turnstile` });
    }
    if (!turnstileConfig.hostnameConfigValid) {
      return reply.send({
        code: 0,
        errorCode: 'turnstile_hostname_config_invalid',
        msg: 'Turnstile hostname 白名单格式非法，线上校验将拒绝通过',
      });
    }
    if (turnstileConfig.allowedHostnames.length === 0) {
      return reply.send({
        code: 0,
        errorCode: 'turnstile_hostname_allowlist_empty',
        msg: 'Turnstile hostname 白名单为空，线上校验将拒绝通过',
      });
    }
    const secret = turnstileConfig.turnstileSecretKey;
    if (!secret)
      return reply.send({
        code: 0,
        msg: 'Turnstile Secret Key 未配置。请在系统设置 -> 短信与人机验证中填写，或配置 TURNSTILE_SECRET_KEY',
      });

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
        return reply.send({
          code: 0,
          msg: 'Secret Key 无效，请检查后台配置或 TURNSTILE_SECRET_KEY',
        });
      }
      return reply.send({
        code: 1,
        msg: 'Secret Key 已被 Cloudflare 接受（测试 token 被预期拒绝）',
        data: { errorCodes: codes },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `连接 Cloudflare 失败: ${e?.message || 'unknown'}` });
    }
  });

  app.post('/test/sms', async (request, reply) => {
    if ((request as any).user?.tokenUse !== 'account_session') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'sms_test_account_session_required',
        msg: '短信测试需要当前账号会话',
      });
    }
    const smsConfig = await getSmsRuntimeConfig();
    const body = request.body as { phone?: string };
    const phone = String(body?.phone || '').trim();

    if (!smsConfig.provider) {
      return reply.send({
        code: 0,
        msg: '短信 provider 未配置。请在系统设置 -> 短信与人机验证中选择 aliyun/tencent，或配置 SMS_PROVIDER',
      });
    }

    if (smsConfig.provider === 'console') {
      if (getRuntimeMode() === 'cloud') {
        return reply.send({ code: 0, msg: 'cloud 运行模式禁止使用 console provider' });
      }
      if (phone) {
        const provider = await getSmsProvider(smsConfig);
        await provider.send(phone, '123456', 'register');
      }
      return reply.send({
        code: 1,
        msg: phone
          ? `console 测试短信已写入服务器日志（${maskPhone(phone)}）`
          : 'console provider 可用（仅开发/测试，不发送真实短信）',
      });
    }

    if (smsConfig.provider !== 'tencent' && smsConfig.provider !== 'aliyun') {
      return reply.send({ code: 0, msg: `provider=${smsConfig.provider} 测试尚未实现` });
    }

    const providerLabel = smsConfig.provider === 'aliyun' ? '阿里云' : '腾讯云';
    const requiredFields = smsConfig.provider === 'aliyun'
      ? [
          ...(smsConfig.aliyun.credentialMode === 'access_key'
            ? [
                ['AccessKey ID', smsConfig.aliyun.accessKeyId],
                ['AccessKey Secret', smsConfig.aliyun.accessKeySecret],
              ]
            : smsConfig.aliyun.credentialMode === 'auto'
              && smsConfig.aliyun.accessKeyId !== smsConfig.aliyun.accessKeySecret
              ? [
                  ['AccessKey ID', smsConfig.aliyun.accessKeyId],
                  ['AccessKey Secret', smsConfig.aliyun.accessKeySecret],
                ]
              : []),
          ['签名', smsConfig.aliyun.signName],
          ['注册模板 Code', smsConfig.aliyun.registerTemplateCode || smsConfig.aliyun.templateCode],
          ['注册模板变量名', smsConfig.aliyun.registerTemplateCode
            ? smsConfig.aliyun.registerTemplateParamName
            : smsConfig.aliyun.templateParamName],
        ]
      : [
          ['SecretId', smsConfig.tencent.secretId],
          ['SecretKey', smsConfig.tencent.secretKey],
          ['SDK AppId', smsConfig.tencent.sdkAppId],
          ['签名', smsConfig.tencent.signName],
          ['模板 ID', smsConfig.tencent.templateId],
        ];
    const missing = requiredFields
      .filter(([, value]) => !String(value || '').trim())
      .map(([label]) => label);
    if (missing.length > 0) {
      return reply.send({ code: 0, msg: `${providerLabel} SMS 配置不完整：缺少 ${missing.join('、')}` });
    }

    try {
      const provider = await getSmsProvider(smsConfig);
      if (!phone) {
        return reply.send({
          code: 1,
          msg: `${providerLabel} SMS 配置已加载，凭证字段齐全。填写手机号可发送真实测试短信`,
        });
      }

      if (smsConfig.testPhoneWhitelist.length === 0) {
        return reply.send({ code: 0, msg: '发送真实测试短信前必须配置测试手机号白名单' });
      }
      if (!smsConfig.testPhoneWhitelist.includes(phone)) {
        return reply.send({ code: 0, msg: `测试手机号不在白名单中：${maskPhone(phone)}` });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const testCodeKey = `${SMS_QUOTA_HASH_TAG}:test-code:${randomUUID()}`;
      const quota = await reserveSmsSendQuota({
        phone,
        ip: request.ip,
        purpose: 'register',
        rateLimitSeconds: smsConfig.rateLimitSeconds,
        dailyPerPhoneLimit: smsConfig.dailyPerPhoneLimit,
        dailyPerIpLimit: smsConfig.dailyPerIpLimit,
        dailyGlobalLimit: smsConfig.dailyGlobalLimit,
        codeKey: testCodeKey,
        code,
        codeTtlSeconds: 60,
      });
      if (!quota.ok) {
        return reply.send({
          code: 0,
          errorCode: `sms_quota_${quota.reason}`,
          msg: getSmsQuotaDenialMessage(quota.reason),
        });
      }

      let result;
      try {
        result = await provider.send(phone, code, 'register');
      } catch (error) {
        await commitSmsSendQuota(quota.reservation).catch(() => undefined);
        await redis.del(testCodeKey).catch(() => undefined);
        throw error;
      }
      if (!result.ok) {
        if (result.failureKind === 'not_dispatched') {
          await rollbackSmsSendQuota(quota.reservation).catch(() => false);
        } else if (result.failureKind === 'rejected') {
          await rollbackSmsSendQuota(quota.reservation, { refundQuota: false }).catch(() => false);
        } else {
          await commitSmsSendQuota(quota.reservation).catch(() => undefined);
        }
        await redis.del(testCodeKey).catch(() => undefined);
        return reply.send({
          code: 0,
          errorCode: 'sms_provider_failed',
          msg: `测试短信发送失败：${result.err || 'unknown'}`,
        });
      }
      await commitSmsSendQuota(quota.reservation).catch(() => undefined);
      await redis.del(testCodeKey).catch(() => undefined);
      return reply.send({ code: 1, msg: `测试短信已发送到 ${maskPhone(phone)}` });
    } catch (e: any) {
      return reply.send({ code: 0, msg: e?.message || '加载失败' });
    }
  });

  app.post('/test/oss', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
    try {
      const storageConfig = await getRuntimeConfigForStorage();
      if (!storageConfig.oss) {
        const uploadOss = await getUploadOssDiagnostic();
        const missing =
          uploadOss.hasAnyDbUploadConfig && uploadOss.missing.length > 0
            ? `，当前后台缺少：${uploadOss.missing.join('、')}`
            : '';
        return reply.send({
          code: 0,
          msg: `OSS 未配置${missing}。请在超管设置 -> 上传与对象存储中补齐对象存储必填项并保存，或设置 OSS_ENDPOINT / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET`,
        });
      }

      const { endpoint, bucket, accessKeyId, accessKeySecret, region, cdnDomain } =
        storageConfig.oss;
      const {
        S3Client,
        HeadBucketCommand,
        GetBucketCorsCommand,
        PutObjectCommand,
        GetObjectCommand,
        DeleteObjectCommand,
      } = await import('@aws-sdk/client-s3');
      const fullEndpoint = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
      const provider = inferObjectStorageProvider(endpoint);
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
          detail: `backend=${storageConfig.imageStorage}, provider=${provider}, source=${storageConfig.source}, bucket=${bucket}, region=${region || 'auto'}`,
        },
      ];
      const testKey = `system/attachments/tests/oss-health-${Date.now()}-${randomUUID()}.txt`;
      const testBody = `ss-erp oss health check\nkey=${testKey}\nat=${new Date().toISOString()}\n`;
      const proxyUrl = buildCdnProxyUrl(storageConfig.localBaseUrl, testKey);
      const publicUrl = resolveObjectStoragePublicUrl({
        publicDomain: cdnDomain,
        proxyUrl,
        objectKey: testKey,
      });
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
        classifyObjectStorageProbeFailure(provider, 'headBucket') === 'warn',
      );

      await addStep(
        'cors',
        'CORS 配置检查',
        false,
        async () => {
          const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
          const rules = result.CORSRules || [];
          if (rules.length === 0) throw new Error('Bucket 尚未配置 CORS');
          const methods = new Set(rules.flatMap((rule) => rule.AllowedMethods || []));
          if (!methods.has('PUT') || !methods.has('GET')) throw new Error('CORS 缺少 PUT 或 GET');
          return `CORS 已配置，${rules.length} 条规则`;
        },
        true,
      );

      const putOk = await addStep('putObject', '写入测试对象', true, async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: testKey,
            Body: Buffer.from(testBody, 'utf8'),
            ContentType: 'text/plain; charset=utf-8',
            CacheControl: 'no-store',
          }),
        );
        uploaded = true;
        return `已写入 ${testKey}`;
      });

      const getOk =
        putOk &&
        (await addStep('getObject', '直接读取校验', true, async () => {
          const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: testKey }));
          const body = result.Body
            ? Buffer.from(await result.Body.transformToByteArray()).toString('utf8')
            : '';
          if (body !== testBody) throw new Error('读取内容与写入内容不一致');
          return `读取成功，${Buffer.byteLength(body)} bytes`;
        }));

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
          label: '公网匿名读取',
          status: 'skip',
          detail: '写入失败，跳过代理读取',
          critical: true,
        });
      } else if (!getOk) {
        steps.push({
          key: 'proxyRead',
          label: '公网匿名读取',
          status: 'skip',
          detail: '直接读取失败，跳过代理读取',
          critical: true,
        });
      } else {
        await addStep('proxyRead', '公网匿名读取', true, async () => {
          const res = await fetch(publicUrl, {
            headers: { 'user-agent': 'SS-ERP-OSS-HealthCheck/1.0' },
            signal: AbortSignal.timeout(8000),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
          if (text !== testBody) throw new Error('代理读取内容与写入内容不一致');
          return `公网可读：${publicUrl}`;
        });
      }

      if (uploaded) {
        const deleteOk = await addStep('deleteObject', '删除测试对象', true, async () => {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }));
          uploaded = false;
          return '测试对象已删除';
        });
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
          ? 'S3 对象存储完整链路测试失败，请查看失败步骤'
          : warnCount > 0
            ? 'S3 对象存储上传读取链路可用，但存在非关键诊断警告'
            : 'S3 对象存储完整链路测试通过',
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
      return reply.send({
        code: 0,
        msg: `OSS 连接失败: ${e?.message?.slice(0, 200) || 'unknown'}`,
      });
    }
  });

  app.post('/test/backup', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
    try {
      const result = await testBackupRemoteStorage();
      return reply.send({
        code: result.ok ? 1 : 0,
        msg: result.msg,
        data: result.data,
      });
    } catch (e: any) {
      return reply.send({
        code: 0,
        msg: `备份 R2 测试失败: ${e?.message?.slice(0, 200) || 'unknown'}`,
      });
    }
  });

  app.post('/test/ai-image', { preHandler: requireLiveAccountSession }, async (request, reply) => {
    const body = request.body && typeof request.body === 'object'
      ? request.body as Record<string, unknown>
      : {};
    const [savedProvider, savedBaseUrl, savedApiKey, savedModel] = await Promise.all([
      getConfig('ai_image_provider'),
      getConfig('ai_image_base_url'),
      getConfig('ai_image_api_key'),
      getConfig('ai_image_model'),
    ]);

    const submittedProvider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const provider = submittedProvider || savedProvider;
    const baseUrl = Object.hasOwn(body, 'baseUrl') ? String(body.baseUrl || '').trim() : savedBaseUrl;
    const model = Object.hasOwn(body, 'model') ? String(body.model || '') : savedModel;
    const submittedApiKey = Object.hasOwn(body, 'apiKey') ? String(body.apiKey || '').trim() : '';
    const maskedApiKey = (
      submittedApiKey.length >= 4
      && (
        /^[*•xX]+$/.test(submittedApiKey)
        || (Boolean(savedApiKey) && submittedApiKey === maskedSecretValue(savedApiKey))
      )
    );
    const submittedEndpoint = aiImageCredentialEndpointIdentity(provider, baseUrl);
    const savedEndpoint = aiImageCredentialEndpointIdentity(savedProvider, savedBaseUrl);
    const canReuseSavedApiKey = Boolean(
      savedApiKey
      && submittedEndpoint
      && submittedEndpoint === savedEndpoint,
    );
    const apiKey = submittedApiKey && !maskedApiKey
      ? submittedApiKey
      : canReuseSavedApiKey ? savedApiKey : '';

    if (provider === 'disabled') {
      return reply.send({ code: 0, msg: 'AI 生图供应商已禁用，未执行连接测试' });
    }
    if (!apiKey && savedApiKey && (maskedApiKey || !submittedApiKey) && !canReuseSavedApiKey) {
      return reply.send({
        code: 0,
        msg: 'AI 生图 Base URL 已变化；为避免向新端点泄露旧密钥，请重新输入 API Key',
      });
    }
    const missing = [
      !apiKey && 'API Key',
      !model && '模型',
      provider === 'custom' && !baseUrl && 'Base URL',
    ].filter(Boolean);
    if (missing.length) return reply.send({ code: 0, msg: `AI 生图配置不完整：缺少 ${missing.join('、')}` });
    try {
      const result = await testAiImageProviderConnection({ provider, baseUrl, apiKey, model });
      return reply.send({ code: 1, msg: result.detail, data: result });
    } catch (error: any) {
      return reply.send({ code: 0, msg: error?.message || 'AI 生图连接测试失败' });
    }
  });
  app.post('/test/sentry', { preHandler: requireLiveAccountSession }, async (_request, reply) => {
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

  app.get('/test/sms/aliyun-resources', async (request, reply) => {
    if ((request as any).user?.tokenUse !== 'account_session') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'sms_resources_account_session_required',
        msg: '短信资源查询需要当前账号会话',
      });
    }
    const smsConfig = await getSmsRuntimeConfig();
    if (smsConfig.provider !== 'aliyun') {
      return reply.send({ code: 0, msg: '当前短信 provider 不是 aliyun' });
    }

    try {
      const resources = await queryApprovedAliyunSmsResources(smsConfig.aliyun);
      return reply.send({ code: 1, data: resources });
    } catch (error) {
      return reply.send({ code: 0, msg: `查询阿里云签名/模板失败：${shortError(error)}` });
    }
  });
}
