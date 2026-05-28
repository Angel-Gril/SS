import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';

const createStaffSchema = z.object({
  phone: z.string().min(5).max(20),
  password: z.string().min(6).max(50),
  nickname: z.string().min(1).max(50),
});

export async function staffRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 二级账号不允许管理员工（员工属于根账号）
  app.addHook('preHandler', async (request, reply) => {
    const auth = (request as any).user;
    if (auth?.isSubAccount) {
      return reply.status(403).send({ code: 0, msg: '二级子账号无法管理员工' });
    }
  });

  app.get('/', async (request) => {
    // userId 已是 effectiveUserId（即根账号 ID）
    const { userId } = (request as any).user;

    const staff = await prisma.user.findMany({
      where: { parentId: userId },
      select: {
        id: true,
        phone: true,
        nickname: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { code: 1, msg: 'ok', data: staff };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createStaffSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const existing = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    const staff = await prisma.user.create({
      data: {
        phone: parsed.data.phone,
        passwordHash,
        nickname: parsed.data.nickname,
        role: 'STAFF',
        parentId: userId,
      },
    });

    return reply.send({
      code: 1,
      msg: '员工账号已创建',
      data: { id: staff.id, phone: staff.phone, nickname: staff.nickname },
    });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { nickname?: string; status?: string; password?: string };

    const staff = await prisma.user.findFirst({ where: { id, parentId: userId } });
    if (!staff) {
      return reply.status(404).send({ code: 0, msg: '员工不存在' });
    }

    const data: Record<string, unknown> = {};
    if (body.nickname) data.nickname = body.nickname;
    if (body.status === 'ACTIVE' || body.status === 'SUSPENDED') data.status = body.status;
    if (body.password && body.password.length >= 6) {
      data.passwordHash = await bcrypt.hash(body.password, 10);
    }

    await prisma.user.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '已更新' });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const staff = await prisma.user.findFirst({ where: { id, parentId: userId } });
    if (!staff) {
      return reply.status(404).send({ code: 0, msg: '员工不存在' });
    }

    await prisma.user.delete({ where: { id } });
    return reply.send({ code: 1, msg: '员工已删除' });
  });
}
