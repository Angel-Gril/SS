import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queryResources: vi.fn(),
  smsConfig: {} as Record<string, any>,
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
  getTurnstileRuntimeConfig: vi.fn(async () => ({ enabled: false, source: 'none', siteKey: '', secretKey: '' })),
}));

vi.mock('../lib/sms/index.js', () => ({
  getSmsProvider: vi.fn(async () => ({ send: mocks.send })),
}));

vi.mock('../lib/sms/aliyun.js', () => ({
  queryApprovedAliyunSmsResources: mocks.queryResources,
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeMode: () => 'cloud',
  getRuntimeConfigForStorage: vi.fn(),
}));

import { systemStatusRoutes } from '../routes/system-status.js';

function aliyunConfig() {
  return {
    provider: 'aliyun',
    source: 'system-config',
    codeTtlSeconds: 300,
    rateLimitSeconds: 60,
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
  const app = Fastify();
  await app.register(systemStatusRoutes);
  return app;
}

describe('system status SMS diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.smsConfig = aliyunConfig();
    mocks.send.mockResolvedValue({ ok: true, bizId: 'test-biz-id' });
    mocks.queryResources.mockResolvedValue({ signs: [], templates: [], truncated: false });
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
      payload: { phone: '13800138000' },
    });

    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.send).toHaveBeenCalledWith('13800138000', expect.stringMatching(/^\d{6}$/), 'register');
  });
});
