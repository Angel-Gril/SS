import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const rechargeSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  amount: z.coerce.number().positive('充值金额必须大于0').max(1000000),
  description: z.string().optional(),
});

const deductSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  amount: z.coerce.number().positive('扣款金额必须大于0'),
  type: z.enum(['deduct_service', 'deduct_shipping', 'adjustment']),
  orderId: z.string().optional(),
  description: z.string().optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /api/account — 获取当前用户账户信息（不存在则自动创建）
  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;

    let account = await prisma.userAccount.findUnique({ where: { userId } });
    if (!account) {
      account = await prisma.userAccount.create({
        data: { userId, balance: 0, creditLimit: 0, billingMode: 'prepaid', frozenAmount: 0 },
      });
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        id: account.id,
        userId: account.userId,
        balance: account.balance.toString(),
        creditLimit: account.creditLimit.toString(),
        billingMode: account.billingMode,
        frozenAmount: account.frozenAmount.toString(),
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
    });
  });

  // GET /api/account/transactions — 交易流水列表
  app.get('/transactions', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; type?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const account = await prisma.userAccount.findUnique({ where: { userId } });
    if (!account) {
      return reply.send({ code: 1, msg: 'ok', data: { total: 0, rows: [] } });
    }

    const where: Record<string, unknown> = { accountId: account.id };
    if (query.type) where.type = query.type;

    const [total, rows] = await Promise.all([
      prisma.transaction.count({ where: where as any }),
      prisma.transaction.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount.toString(),
          balanceAfter: r.balanceAfter.toString(),
          orderId: r.orderId,
          description: r.description,
          operator: r.operator,
          createdAt: r.createdAt,
        })),
      },
    });
  });

  // POST /api/account/recharge — 充值（管理员操作）
  app.post('/recharge', async (request, reply) => {
    const { role, userId: operatorId } = (request as any).user;
    if (role !== 'ADMIN') {
      return reply.status(403).send({ code: 0, msg: '无权限' });
    }

    const parsed = rechargeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { userId, amount, description } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      let account = await tx.userAccount.findUnique({ where: { userId } });
      if (!account) {
        account = await tx.userAccount.create({
          data: { userId, balance: 0, creditLimit: 0, billingMode: 'prepaid', frozenAmount: 0 },
        });
      }

      const newBalance = account.balance.add(amount);
      await tx.userAccount.update({ where: { id: account.id }, data: { balance: newBalance } });

      const txn = await tx.transaction.create({
        data: {
          accountId: account.id,
          type: 'recharge',
          amount: amount,
          balanceAfter: newBalance,
          description: description || '管理员充值',
          operator: operatorId,
        },
      });

      return { balance: newBalance.toString(), transactionId: txn.id };
    });

    return reply.send({ code: 1, msg: '充值成功', data: result });
  });

  // POST /api/account/deduct — 手动扣款（管理员）
  app.post('/deduct', async (request, reply) => {
    const { role, userId: operatorId } = (request as any).user;
    if (role !== 'ADMIN') {
      return reply.status(403).send({ code: 0, msg: '无权限' });
    }

    const parsed = deductSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { userId, amount, type, orderId, description } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.userAccount.findUnique({ where: { userId } });
      if (!account) {
        throw new Error('用户账户不存在');
      }

      const newBalance = account.balance.sub(amount);
      await tx.userAccount.update({ where: { id: account.id }, data: { balance: newBalance } });

      const txn = await tx.transaction.create({
        data: {
          accountId: account.id,
          type,
          amount: -amount,
          balanceAfter: newBalance,
          orderId: orderId || null,
          description: description || '管理员手动扣款',
          operator: operatorId,
        },
      });

      return { balance: newBalance.toString(), transactionId: txn.id };
    });

    return reply.send({ code: 1, msg: '扣款成功', data: result });
  });

  // GET /api/account/fee-templates — 获取当前适用的费用模板
  app.get('/fee-templates', async (_request, reply) => {
    const templates = await prisma.feeTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({
      code: 1,
      msg: 'ok',
      data: templates.map((t) => ({ ...t, fee: t.fee.toString() })),
    });
  });
}

