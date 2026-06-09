import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userRoutes } from '../routes/user.js';
import { signToken } from '../lib/auth.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  shop: {
    count: vi.fn(),
  },
  order: {
    count: vi.fn(),
  },
  warehouse: {
    count: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
  scan: vi.fn(),
  del: vi.fn(),
}));

const emailMock = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../lib/email/index.js', () => ({ sendEmail: emailMock.sendEmail }));

async function buildUserApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(userRoutes, { prefix: '/api/user' });
  await app.ready();
  return app;
}

function authHeader() {
  return {
    authorization: `Bearer ${createToken()}`,
  };
}

function createToken() {
  return signToken({ userId: 'user-1', role: 'USER' });
}

beforeEach(async () => {
  vi.clearAllMocks();
  redisMock.exists.mockResolvedValue(1);
  redisMock.scan.mockResolvedValue(['0', ['session:user-1:aaaa', 'session:user-1:bbbb']]);
  redisMock.del.mockResolvedValue(2);
  prismaMock.user.findUnique.mockImplementation(async (args: any) => {
    if (args?.select?.id && args?.select?.passwordHash) {
      return {
        id: 'user-1',
        passwordHash: await bcrypt.hash('OldPass123', 4),
        status: 'ACTIVE',
      };
    }
    return {
      id: 'user-1',
      parentId: null,
      accountCode: '101',
      status: 'ACTIVE',
      isSuperAdmin: false,
      role: 'USER',
    };
  });
  prismaMock.shop.count.mockResolvedValue(0);
  prismaMock.order.count.mockResolvedValue(0);
  prismaMock.warehouse.count.mockResolvedValue(0);
  emailMock.sendEmail.mockResolvedValue({ ok: true, bizId: 'email-test-1' });
});

describe('user change password', () => {
  it('rejects incorrect old password', async () => {
    const app = await buildUserApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/user/change-password',
      headers: authHeader(),
      payload: {
        oldPassword: 'WrongPass123',
        newPassword: 'NewPass123',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '原密码错误' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('updates password and clears existing sessions', async () => {
    const app = await buildUserApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/user/change-password',
      headers: authHeader(),
      payload: {
        oldPassword: 'OldPass123',
        newPassword: 'NewPass123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, msg: '密码已修改，请重新登录' });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: expect.any(String) },
    });
    const nextHash = prismaMock.user.update.mock.calls[0]?.[0].data.passwordHash;
    await expect(bcrypt.compare('NewPass123', nextHash)).resolves.toBe(true);
    expect(redisMock.scan).toHaveBeenCalledWith('0', 'MATCH', 'session:user-1:*', 'COUNT', 100);
    expect(redisMock.del).toHaveBeenCalledWith('session:user-1:aaaa', 'session:user-1:bbbb');
    await app.close();
  });
});

describe('user profile', () => {
  it('returns actor email in user profile', async () => {
    const app = await buildUserApp();
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.balance) {
        return {
          balance: { toString: () => '10000' },
          tenantType: 'SELLER',
          perOrderFee: null,
          customColorEnabled: true,
          canPublishAddress: true,
          isTransitProvider: false,
          activePortal: 'user',
          accountCode: '101',
          nickname: '系统管理员',
          _count: { shops: 0 },
        };
      }
      if (args?.select?.phone) {
        return {
          id: 'user-1',
          phone: '13800000000',
          email: 'seller@example.com',
          nickname: '系统管理员',
          avatar: null,
          role: 'USER',
          status: 'ACTIVE',
          isSuperAdmin: false,
          accountCode: '101',
          createdAt: new Date('2026-06-09T00:00:00.000Z'),
          lastLoginAt: null,
        };
      }
      return {
        id: 'user-1',
        parentId: null,
        accountCode: '101',
        status: 'ACTIVE',
        isSuperAdmin: false,
        role: 'USER',
      };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/user/me',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        id: 'user-1',
        email: 'seller@example.com',
      },
    });
    await app.close();
  });

  it('updates actor email and nickname from account settings', async () => {
    const app = await buildUserApp();
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      phone: '13800000000',
      email: 'seller@example.com',
      nickname: '松鼠卖家',
      avatar: null,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/user/profile',
      headers: authHeader(),
      payload: {
        email: '  seller@example.com  ',
        nickname: '  松鼠卖家  ',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      msg: '资料已保存',
      data: {
        email: 'seller@example.com',
        nickname: '松鼠卖家',
      },
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        email: 'seller@example.com',
        nickname: '松鼠卖家',
      },
      select: {
        id: true,
        phone: true,
        email: true,
        nickname: true,
        avatar: true,
      },
    });
    await app.close();
  });

  it('clears actor notification email when profile email is empty', async () => {
    const app = await buildUserApp();
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      phone: '13800000000',
      email: null,
      nickname: '系统管理员',
      avatar: null,
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/user/profile',
      headers: authHeader(),
      payload: {
        email: '',
        nickname: '系统管理员',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        email: null,
      },
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
      data: expect.objectContaining({ email: null }),
    }));
    await app.close();
  });

  it('rejects invalid profile email without updating the user', async () => {
    const app = await buildUserApp();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/user/profile',
      headers: authHeader(),
      payload: {
        email: 'not-an-email',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('user test email', () => {
  it('sends a test email to the actor notification email', async () => {
    const app = await buildUserApp();
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.email) {
        return {
          id: 'user-1',
          email: 'seller@example.com',
          nickname: '松鼠卖家',
          status: 'ACTIVE',
        };
      }
      return {
        id: 'user-1',
        parentId: null,
        accountCode: '101',
        status: 'ACTIVE',
        isSuperAdmin: false,
        role: 'USER',
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/user/test-email',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      msg: '测试邮件已发送',
      data: { bizId: 'email-test-1' },
    });
    expect(emailMock.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'seller@example.com',
      subject: 'SS ERP 测试邮件',
    }));
    await app.close();
  });

  it('rejects test email when the actor has no notification email', async () => {
    const app = await buildUserApp();
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.email) {
        return {
          id: 'user-1',
          email: null,
          nickname: '系统管理员',
          status: 'ACTIVE',
        };
      }
      return {
        id: 'user-1',
        parentId: null,
        accountCode: '101',
        status: 'ACTIVE',
        isSuperAdmin: false,
        role: 'USER',
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/user/test-email',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '请先填写通知邮箱' });
    expect(emailMock.sendEmail).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a clear error when the email provider fails', async () => {
    const app = await buildUserApp();
    prismaMock.user.findUnique.mockImplementation(async (args: any) => {
      if (args?.select?.email) {
        return {
          id: 'user-1',
          email: 'seller@example.com',
          nickname: '松鼠卖家',
          status: 'ACTIVE',
        };
      }
      return {
        id: 'user-1',
        parentId: null,
        accountCode: '101',
        status: 'ACTIVE',
        isSuperAdmin: false,
        role: 'USER',
      };
    });
    emailMock.sendEmail.mockResolvedValue({ ok: false, err: 'SMTP refused' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/user/test-email',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 0, msg: 'SMTP refused' });
    await app.close();
  });
});

describe('user onboarding status', () => {
  it('reports first step when user has no shops', async () => {
    const app = await buildUserApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/user/onboarding-status',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        hasShop: false,
        hasOrder: false,
        hasWarehouse: false,
        completed: false,
        nextStep: 'add-shop',
      },
    });
    await app.close();
  });

  it('reports completed onboarding when shop, order and warehouse exist', async () => {
    const app = await buildUserApp();
    prismaMock.shop.count.mockResolvedValue(1);
    prismaMock.order.count.mockResolvedValue(3);
    prismaMock.warehouse.count.mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/api/user/onboarding-status',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        hasShop: true,
        hasOrder: true,
        hasWarehouse: true,
        completed: true,
        nextStep: null,
      },
    });
    await app.close();
  });
});
