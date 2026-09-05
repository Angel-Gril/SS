import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HumanChallengeRuntimeConfig } from '../lib/human-challenge.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queryResources: vi.fn(),
  reserveQuota: vi.fn(),
  rollbackQuota: vi.fn(),
  commitQuota: vi.fn(),
  redisDel: vi.fn(),
  smsConfig: {} as Record<string, any>,
  humanChallengeConfig: {} as HumanChallengeRuntimeConfig,
  runtimeMode: 'cloud' as 'local' | 'cloud',
  storageRuntimeConfig: {} as Record<string, any>,
  configValues: {} as Record<string, unknown>,
  backupConfig: {} as Record<string, any>,
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = {
      tokenUse: request.headers['x-token-use'] || 'account_session',
      isSuperAdmin: true,
    };
  },
  requireSuperAdmin: async () => undefined,
}));

vi.mock('../lib/auth-challenge-config.js', () => ({
  getSmsRuntimeConfig: vi.fn(async () => mocks.smsConfig),
}));

vi.mock('../lib/human-challenge.js', () => ({
  getHumanChallengeRuntimeConfig: vi.fn(async () => mocks.humanChallengeConfig),
}));

vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: mocks.send })),
}));

vi.mock('../lib/sms/aliyun.js', () => ({
  queryApprovedAliyunSmsResources: mocks.queryResources,
}));

vi.mock('../lib/sms/send-quota.js', () => ({
  reserveSmsSendQuota: mocks.reserveQuota,
  rollbackSmsSendQuota: mocks.rollbackQuota,
  commitSmsSendQuota: mocks.commitQuota,
  getSmsQuotaDenialMessage: (reason: string) => `quota:${reason}`,
  SMS_QUOTA_HASH_TAG: '{sms-quota}',
  getSmsGlobalQuotaSnapshot: vi.fn(async () => ({
    available: true,
    used: 0,
    limit: 1000,
    remaining: 1000,
  })),
}));

vi.mock('../lib/redis.js', () => ({
  redis: { del: mocks.redisDel },
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeMode: () => mocks.runtimeMode,
  getRuntimeConfigForStorage: vi.fn(async () => mocks.storageRuntimeConfig),
}));

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: vi.fn(async (key: string) => mocks.configValues[key]),
}));

vi.mock('../services/backup.service.js', () => ({
  getBackupRuntimeConfig: vi.fn(async () => mocks.backupConfig),
  testBackupRemoteStorage: vi.fn(),
}));

import { buildHumanChallengeIntegrationCheck, systemStatusRoutes } from '../routes/system-status.js';

function aliyunConfig() {
  return {
    provider: 'aliyun',
    source: 'system-config',
    codeTtlSeconds: 300,
    rateLimitSeconds: 60,
    dailyPerPhoneLimit: 10,
    dailyPerIpLimit: 100,
    dailyGlobalLimit: 1000,
    testPhoneWhitelist: ['13800138000'],
    tencent: {},
    aliyun: {
      accessKeyId: '',
      accessKeySecret: '',
      credentialMode: 'ecs_ram_role',
      credentialSource: 'ecs_ram_role',
      roleName: 'ss-erp-sms',
      signName: '常青藤上云',
      templateCode: '',
      templateParamName: 'code',
      registerTemplateCode: 'SMS_REGISTER',
      registerTemplateParamName: 'code',
      passwordResetTemplateCode: 'SMS_PASSWORD_RESET',
      passwordResetTemplateParamName: 'code',
      smsLoginTemplateCode: 'SMS_LOGIN',
      smsLoginTemplateParamName: 'code',
    },
  };
}

async function createApp() {
  const app = Fastify({ trustProxy: '127.0.0.1' });
  await app.register(systemStatusRoutes);
  return app;
}

describe('system status SMS diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.smsConfig = aliyunConfig();
    mocks.humanChallengeConfig = {
      provider: 'disabled',
      providerConfigValid: true,
      difficulty: 4,
      ttlSeconds: 120,
      signingSecret: '',
      turnstileSiteKey: '',
      turnstileSecretKey: '',
      allowedHostnames: [],
      hostnameConfigValid: true,
      source: 'system-config',
    };
    mocks.runtimeMode = 'cloud';
    mocks.storageRuntimeConfig = {
      source: 'env',
      mode: 'cloud',
      imageStorage: 'oss',
      authSource: 'token',
      extensionSync: 'queue',
      oss: null,
      ozonCdnRelayUrl: undefined,
      ossFallbackToCdn: true,
      localBaseUrl: 'https://app.example.com',
    };
    mocks.configValues = {
      auth_human_challenge_provider: 'disabled',
      auth_sms_provider: 'env',
      upload_storage_backend: 'env',
      upload_oss_provider: 's3-compatible',
      upload_oss_endpoint: '',
      upload_oss_bucket: '',
      upload_oss_access_key_id: '',
      upload_oss_access_key_secret: '',
      upload_oss_region: 'auto',
    };
    mocks.backupConfig = {
      remote: null,
      remoteSource: 'none',
      remoteEnabled: false,
      remoteMissing: [],
    };
    mocks.send.mockResolvedValue({ ok: true, bizId: 'test-biz-id' });
    mocks.queryResources.mockResolvedValue({ signs: [], templates: [], truncated: false });
    mocks.reserveQuota.mockResolvedValue({
      ok: true,
      reservation: { token: 'reservation', markerKey: 'marker', keys: [], code: '123456' },
    });
    mocks.rollbackQuota.mockResolvedValue(true);
    mocks.commitQuota.mockResolvedValue(undefined);
    mocks.redisDel.mockResolvedValue(1);
  });

  it('queries approved Aliyun resources without sending an SMS', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/test/sms/aliyun-resources' });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.queryResources).toHaveBeenCalledWith(mocks.smsConfig.aliyun);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects resource discovery from a legacy extension token', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/test/sms/aliyun-resources',
      headers: { 'x-token-use': 'legacy_extension' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'sms_resources_account_session_required' });
    expect(mocks.queryResources).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rejects a legacy extension token before a paid SMS diagnostic can run', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test/sms',
      headers: { 'x-token-use': 'legacy_extension' },
      payload: { phone: '13800138000' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'sms_test_account_session_required' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    ['integrations', 'GET', '/integrations'],
    ['ops', 'GET', '/ops'],
    ['turnstile', 'POST', '/test/turnstile'],
    ['oss', 'POST', '/test/oss'],
    ['backup', 'POST', '/test/backup'],
    ['sentry', 'POST', '/test/sentry'],
  ])('rejects legacy extension tokens from the %s system diagnostic', async (_label, method, url) => {
    const app = await createApp();
    const response = await app.inject({
      method: method as 'GET' | 'POST',
      url,
      headers: { 'x-token-use': 'legacy_extension' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      errorCode: 'system_status_account_session_required',
    });
  });

  it('uses the registration purpose for a whitelisted real-send diagnostic', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test/sms',
      headers: { 'x-forwarded-for': '198.51.100.88, 203.0.113.20' },
      payload: { phone: '13800138000' },
    });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.reserveQuota).toHaveBeenCalledWith(expect.objectContaining({
      phone: '13800138000',
      ip: '203.0.113.20',
      purpose: 'register',
      dailyPerPhoneLimit: 10,
      dailyPerIpLimit: 100,
      dailyGlobalLimit: 1000,
    }));
    expect(mocks.send).toHaveBeenCalledWith('13800138000', expect.stringMatching(/^\d{6}$/), 'register');
    expect(mocks.commitQuota).toHaveBeenCalledTimes(1);
  });

  it('does not reserve quota for a configuration-only diagnostic', async () => {
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/test/sms', payload: {} });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.reserveQuota).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not call the provider when the daily fuse rejects a real test', async () => {
    mocks.reserveQuota.mockResolvedValueOnce({ ok: false, reason: 'global' });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test/sms',
      payload: { phone: '13800138000' },
    });

    expect(response.json()).toMatchObject({ code: 0, msg: 'quota:global' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('rolls back the reservation when a paid test send fails', async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, err: 'rejected', failureKind: 'rejected' });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test/sms',
      payload: { phone: '13800138000' },
    });

    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.rollbackQuota).toHaveBeenCalledWith(expect.anything(), { refundQuota: false });
    expect(mocks.commitQuota).not.toHaveBeenCalled();
  });

  it('does not refund a paid test attempt when delivery status is unknown', async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, err: 'timeout', failureKind: 'unknown' });
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/test/sms',
      payload: { phone: '13800138000' },
    });

    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.commitQuota).toHaveBeenCalledTimes(1);
    expect(mocks.rollbackQuota).not.toHaveBeenCalled();
  });

  it('reports an invalid Turnstile hostname allowlist before testing the secret', async () => {
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'cloudflare-turnstile',
      turnstileSecretKey: 'secret',
      hostnameConfigValid: false,
    };
    const app = await createApp();
    const response = await app.inject({ method: 'POST', url: '/test/turnstile' });

    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'turnstile_hostname_config_invalid',
    });
  });

  it('exposes active Turnstile hostname validity in the runtime selection snapshot', async () => {
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'cloudflare-turnstile',
      providerConfigValid: true,
      turnstileSiteKey: 'site-key',
      turnstileSecretKey: 'secret',
      allowedHostnames: [],
      hostnameConfigValid: false,
    };
    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections.humanChallenge).toMatchObject({
      effectiveProvider: 'cloudflare-turnstile',
      configured: false,
      providerConfigValid: true,
      hostnameConfigValid: false,
    });
  });

  it('reports a valid builtin PoW provider as configured without a Turnstile test action', () => {
    expect(buildHumanChallengeIntegrationCheck({
      ...mocks.humanChallengeConfig,
      provider: 'builtin-pow',
      signingSecret: 'a-secure-pow-secret-with-at-least-32-characters',
      difficulty: 4,
      ttlSeconds: 120,
    })).toMatchObject({
      key: 'turnstile',
      label: '人机验证',
      configured: true,
      testable: false,
    });
  });

  it('reports builtin PoW as unconfigured when its signing secret is too short', () => {
    expect(buildHumanChallengeIntegrationCheck({
      ...mocks.humanChallengeConfig,
      provider: 'builtin-pow',
      signingSecret: 'too-short',
      difficulty: 4,
      ttlSeconds: 120,
    })).toMatchObject({ configured: false, testable: false });
  });

  it('reports effective runtime selections without exposing storage credentials or locations', async () => {
    mocks.smsConfig = { ...mocks.smsConfig, source: 'env' };
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'builtin-pow',
      signingSecret: 'a-secure-pow-secret-with-at-least-32-characters',
      source: 'env',
    };
    mocks.storageRuntimeConfig = {
      ...mocks.storageRuntimeConfig,
      oss: {
        endpoint: 'https://oss-cn-shanghai.aliyuncs.com',
        bucket: 'private-production-bucket',
        accessKeyId: 'private-access-key-id',
        accessKeySecret: 'private-access-key-secret',
        region: 'cn-shanghai',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });
    const body = response.json();

    expect(body.data.runtimeSelections).toEqual({
      runtimeMode: 'cloud',
      humanChallenge: {
        savedProvider: 'disabled',
        effectiveProvider: 'builtin-pow',
        source: 'env',
        configured: true,
        providerConfigValid: true,
        hostnameConfigValid: true,
        overridden: true,
      },
      sms: {
        savedProvider: 'env',
        effectiveProvider: 'aliyun',
        source: 'env',
        configured: true,
        overridden: true,
        credentialSource: 'ecs_ram_role',
        warning: null,
      },
      uploadStorage: {
        savedBackend: 'env',
        savedProvider: 's3-compatible',
        effectiveBackend: 'oss',
        effectiveProvider: 'aliyun-oss',
        source: 'env',
        configured: true,
        overridden: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /oss-cn-shanghai|private-production-bucket|private-access-key-id|private-access-key-secret/,
    );
  });

  it('does not require Aliyun templates for registration or SMS login when those flows are disabled', async () => {
    mocks.configValues = {
      ...mocks.configValues,
      feature_sms_register: false,
      feature_sms_login: false,
    };
    mocks.smsConfig = {
      ...mocks.smsConfig,
      aliyun: {
        ...mocks.smsConfig.aliyun,
        templateCode: '',
        registerTemplateCode: '',
        smsLoginTemplateCode: '',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections.sms).toMatchObject({
      effectiveProvider: 'aliyun',
      configured: true,
    });
  });

  it('reports an invalid active Aliyun template variable as not configured', async () => {
    mocks.configValues = {
      ...mocks.configValues,
      feature_sms_register: true,
      feature_sms_login: false,
    };
    mocks.smsConfig = {
      ...mocks.smsConfig,
      aliyun: {
        ...mocks.smsConfig.aliyun,
        registerTemplateParamName: 'invalid-name',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections.sms).toMatchObject({
      effectiveProvider: 'aliyun',
      configured: false,
    });
  });

  it('reports pure database provenance for complete saved provider configurations', async () => {
    mocks.configValues = {
      ...mocks.configValues,
      auth_human_challenge_provider: 'builtin-pow',
      auth_sms_provider: 'aliyun',
      upload_storage_backend: 'oss',
      upload_oss_provider: 'aliyun-oss',
      upload_oss_endpoint: 'https://oss-cn-shanghai.aliyuncs.com',
      upload_oss_bucket: 'private-production-bucket',
      upload_oss_access_key_id: 'private-access-key-id',
      upload_oss_access_key_secret: 'private-access-key-secret',
      upload_oss_region: 'cn-shanghai',
    };
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'builtin-pow',
      signingSecret: 'a-secure-pow-secret-with-at-least-32-characters',
      source: 'system-config',
    };
    mocks.smsConfig = {
      ...mocks.smsConfig,
      source: 'system-config',
      aliyun: {
        ...mocks.smsConfig.aliyun,
        credentialMode: 'auto',
        credentialSource: 'db_access_key',
        accessKeyId: 'private-sms-access-key-id',
        accessKeySecret: 'private-sms-access-key-secret',
      },
    };
    mocks.storageRuntimeConfig = {
      ...mocks.storageRuntimeConfig,
      source: 'system-config',
      oss: {
        endpoint: 'https://oss-cn-shanghai.aliyuncs.com',
        bucket: 'private-production-bucket',
        accessKeyId: 'private-access-key-id',
        accessKeySecret: 'private-access-key-secret',
        region: 'cn-shanghai',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections).toMatchObject({
      humanChallenge: { source: 'db', configured: true, overridden: false },
      sms: {
        source: 'db',
        configured: true,
        overridden: false,
        credentialSource: 'db_access_key',
        warning: null,
      },
      uploadStorage: { source: 'db', configured: true, overridden: false },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/private-sms-access-key/);
  });

  it('warns when Aliyun auto mode delegates credentials to the unverified default chain', async () => {
    mocks.configValues = { ...mocks.configValues, auth_sms_provider: 'aliyun' };
    mocks.smsConfig = {
      ...mocks.smsConfig,
      source: 'mixed',
      aliyun: {
        ...mocks.smsConfig.aliyun,
        credentialMode: 'auto',
        credentialSource: 'aliyun_default_chain',
        roleName: '',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });
    const body = response.json();

    expect(body.data.runtimeSelections.sms).toMatchObject({
      source: 'mixed',
      overridden: true,
      credentialSource: 'aliyun_default_chain',
      warning: expect.stringMatching(/默认凭据链.*未验证/),
    });
    expect(body.data.checks.find((check: any) => check.key === 'sms')).toMatchObject({
      source: 'mixed',
      warning: expect.stringMatching(/默认凭据链.*未验证/),
    });
    expect(JSON.stringify(body)).not.toMatch(/ALIBABA_CLOUD_ACCESS_KEY_ID=/);
  });

  it('preserves mixed canonical provenance for active environment fallbacks', async () => {
    mocks.configValues = {
      ...mocks.configValues,
      auth_human_challenge_provider: 'builtin-pow',
      auth_sms_provider: 'aliyun',
      upload_storage_backend: 'oss',
      upload_oss_provider: 'aliyun-oss',
    };
    mocks.smsConfig = { ...mocks.smsConfig, source: 'mixed' };
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'builtin-pow',
      signingSecret: 'an-environment-pow-secret-with-at-least-32-characters',
      source: 'mixed',
    };
    mocks.storageRuntimeConfig = {
      ...mocks.storageRuntimeConfig,
      source: 'mixed',
      oss: {
        endpoint: 'https://oss-cn-shanghai.aliyuncs.com',
        bucket: 'environment-bucket',
        accessKeyId: 'environment-access-key-id',
        accessKeySecret: 'environment-access-key-secret',
        region: 'cn-shanghai',
      },
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections).toMatchObject({
      humanChallenge: { source: 'mixed', configured: true, overridden: true },
      sms: { source: 'mixed', configured: true, overridden: true },
      uploadStorage: { source: 'mixed', configured: true, overridden: true },
    });
  });

  it('reports invalid and unavailable challenge providers as unconfigured', async () => {
    mocks.smsConfig = { ...mocks.smsConfig, provider: '', source: 'env' };
    mocks.humanChallengeConfig = {
      ...mocks.humanChallengeConfig,
      provider: 'disabled',
      providerConfigValid: false,
      source: 'env',
    };

    const app = await createApp();
    const response = await app.inject({ method: 'GET', url: '/integrations' });

    expect(response.json().data.runtimeSelections).toMatchObject({
      humanChallenge: {
        effectiveProvider: 'disabled',
        source: 'env',
        configured: false,
        providerConfigValid: false,
        overridden: true,
      },
      sms: {
        effectiveProvider: '',
        source: 'env',
        configured: false,
        overridden: true,
      },
    });
  });
});
