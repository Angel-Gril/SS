import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemStatusRoutes } from '../routes/system-status.js';
import { signToken } from '../lib/auth.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
  ping: vi.fn(),
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

const systemConfigMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

const runtimeConfigMock = vi.hoisted(() => ({
  getRuntimeConfigForStorage: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../lib/email/index.js', () => ({ sendEmail: emailMock.sendEmail }));
vi.mock('../config/system-config-schema.js', () => ({ getConfig: systemConfigMock.getConfig }));
vi.mock('../adapters/runtime-config.js', () => ({ getRuntimeConfigForStorage: runtimeConfigMock.getRuntimeConfigForStorage }));

async function buildSystemStatusApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(systemStatusRoutes, { prefix: '/api/admin/system-status' });
  await app.ready();
  return app;
}

function adminAuthHeader() {
  return {
    authorization: `Bearer ${signToken({ userId: 'admin-1', role: 'ADMIN' })}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.exists.mockResolvedValue(1);
  redisMock.ping.mockResolvedValue('PONG');
  prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'admin-1',
    parentId: null,
    accountCode: '001',
    status: 'ACTIVE',
    role: 'ADMIN',
    isSuperAdmin: true,
  });
  emailMock.sendEmail.mockResolvedValue({ ok: true, bizId: 'email-admin-test-1' });
  systemConfigMock.getConfig.mockResolvedValue('');
  runtimeConfigMock.getRuntimeConfigForStorage.mockResolvedValue({
    imageStorage: 'local',
    source: 'env',
    oss: null,
    ozonCdnRelayUrl: null,
  });
});

describe('system status email test', () => {
  it('sends an admin email provider test message to the requested address', async () => {
    const app = await buildSystemStatusApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/system-status/test/email',
      headers: adminAuthHeader(),
      payload: { to: 'ops@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      msg: '邮件服务测试已发送',
      data: { bizId: 'email-admin-test-1' },
    });
    expect(emailMock.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ops@example.com',
      subject: 'SS ERP 邮件服务测试',
    }));
    await app.close();
  });

  it('rejects invalid admin email provider test addresses', async () => {
    const app = await buildSystemStatusApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/system-status/test/email',
      headers: adminAuthHeader(),
      payload: { to: 'not-email' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '请输入有效的收件邮箱' });
    expect(emailMock.sendEmail).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns provider failure details for admin email provider tests', async () => {
    const app = await buildSystemStatusApp();
    emailMock.sendEmail.mockResolvedValue({ ok: false, err: 'resend rejected' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/system-status/test/email',
      headers: adminAuthHeader(),
      payload: { to: 'ops@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 0, msg: 'resend rejected' });
    await app.close();
  });
});
