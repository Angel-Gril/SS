import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { nextSuperAdminCode } from '../lib/account-code.js';

export async function setupRoutes(app: FastifyInstance) {
  const setupTokenConfigured = !!process.env.SETUP_TOKEN;

  // 引导状态：没有 ADMIN = 需要创建首个超级管理员
  app.get('/status', async () => {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    return {
      code: 1,
      msg: 'ok',
      data: {
        needsSetup: adminCount === 0,
        hasAdmin: adminCount > 0,
        setupTokenRequired: process.env.NODE_ENV === 'production' || setupTokenConfigured,
      },
    };
  });

  // 引导初始化：仅当系统没有 ADMIN 时允许，创建首个超级管理员。
  // 即使误开放注册导致已有普通用户，也不能把系统锁死在“无管理员”状态。
  app.post('/init', async (request, reply) => {
    const body = request.body as { phone?: string; password?: string; nickname?: string; setupToken?: string };

    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount > 0) {
      return reply.code(403).send({ code: 0, msg: '系统已初始化，无法重复运行引导' });
    }

    const providedSetupToken = body.setupToken || request.headers['x-setup-token'];
    if (process.env.NODE_ENV === 'production' && !process.env.SETUP_TOKEN) {
      return reply.code(500).send({ code: 0, msg: 'SETUP_TOKEN 未配置，拒绝公网初始化管理员' });
    }
    if (process.env.SETUP_TOKEN && providedSetupToken !== process.env.SETUP_TOKEN) {
      return reply.code(403).send({ code: 0, msg: '初始化令牌不正确' });
    }

    const phone = (body.phone || '').trim();
    const password = body.password || '';
    const nickname = (body.nickname || '系统管理员').trim();

    if (!/^\d{6,20}$/.test(phone)) {
      return reply.code(400).send({ code: 0, msg: '手机号格式不正确（仅数字，6-20 位）' });
    }
    if (password.length < 8) {
      return reply.code(400).send({ code: 0, msg: '密码至少 8 位' });
    }
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.code(409).send({ code: 0, msg: '该手机号已存在，请换一个手机号创建管理员' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let accountCode: string;
    try {
      accountCode = await nextSuperAdminCode();
    } catch (e: any) {
      return reply.status(400).send({ code: 0, msg: e.message || '超管账号编号分配失败' });
    }
    const admin = await prisma.user.create({
      data: {
        phone,
        passwordHash,
        nickname,
        role: 'ADMIN',
        isSuperAdmin: true,
        accountCode,
        balance: 10000,
        canInvite: true,
      },
      select: { id: true, phone: true, nickname: true, role: true, isSuperAdmin: true, accountCode: true },
    });

    return { code: 1, msg: '初始化完成', data: admin };
  });
}
