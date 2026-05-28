import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

export async function setupRoutes(app: FastifyInstance) {
  // 引导状态：用户表为空 = 需要 setup
  app.get('/status', async () => {
    const userCount = await prisma.user.count();
    return { code: 1, msg: 'ok', data: { needsSetup: userCount === 0 } };
  });

  // 引导初始化：仅当用户表为空时允许，创建第一个 ADMIN
  app.post('/init', async (request, reply) => {
    const body = request.body as { phone?: string; password?: string; nickname?: string };

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return reply.code(403).send({ code: 0, msg: '系统已初始化，无法重复运行引导' });
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

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        phone,
        passwordHash,
        nickname,
        role: 'ADMIN',
        balance: 10000,
        canInvite: true,
      },
      select: { id: true, phone: true, nickname: true, role: true },
    });

    return { code: 1, msg: '初始化完成', data: admin };
  });
}
