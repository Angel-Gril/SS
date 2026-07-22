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
}));

vi.mock('../lib/redis.js', () => ({
  redis: { del: mocks.redisDel },
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeMode: () => 'cloud',
  getRuntimeConfigForStorage: vi.fn(),
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
  const app = Fastify({ trustProxy: 1 });
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
});
