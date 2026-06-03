import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  createEpayRechargeOrder,
  createManualRechargeOrder,
  serializePaymentProvider,
  serializeRechargeOrder,
  uploadManualRechargeProof,
} from '../services/recharge.js';
import { parseSupportedMethods } from '../services/epay-adapter.js';

const createRechargeSchema = z.object({
  amount: z.coerce.number().positive('充值金额必须大于0').max(1000000),
  paymentMethod: z.string().min(1).default('alipay'),
  paymentType: z.enum(['auto', 'manual']).default('auto'),
  providerId: z.string().optional(),
});

const proofSchema = z.object({
  proofImage: z.string().optional(),
  proofNote: z.string().optional(),
}).refine((data) => !!data.proofImage || !!data.proofNote, '请填写付款备注或上传付款凭证');

export async function rechargeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/payment-methods', async (_request, reply) => {
    const [providers, manualQrs] = await Promise.all([
      prisma.paymentProvider.findMany({
        where: { type: 'epay', isEnabled: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      }),
      prisma.manualPaymentQRCode.findMany({
        where: { isEnabled: true },
        orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        auto: providers.map((p) => ({
          ...serializePaymentProvider(p),
          supportedMethods: parseSupportedMethods(p.supportedMethods),
        })),
        manual: manualQrs.map((q) => ({
          id: q.id,
          method: q.method,
          name: q.name,
          accountName: q.accountName,
          minAmount: q.minAmount.toString(),
          maxAmount: q.maxAmount.toString(),
          qrcodeImage: q.qrcodeImage,
        })),
      },
    });
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createRechargeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    try {
      const order = parsed.data.paymentType === 'manual'
        ? await createManualRechargeOrder({ userId, amount: parsed.data.amount, paymentMethod: parsed.data.paymentMethod })
        : await createEpayRechargeOrder({
            userId,
            amount: parsed.data.amount,
            paymentMethod: parsed.data.paymentMethod,
            providerId: parsed.data.providerId,
          });
      return reply.send({ code: 1, msg: '订单已创建', data: order });
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error?.message || '创建充值订单失败' });
    }
  });

  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; status?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = { userId };
    if (query.status) where.status = query.status;

    const [total, rows] = await Promise.all([
      prisma.rechargeOrder.count({ where }),
      prisma.rechargeOrder.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { provider: true, manualQrCode: true },
      }),
    ]);
    return reply.send({ code: 1, msg: 'ok', data: { total, rows: rows.map(serializeRechargeOrder) } });
  });

  app.get('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const order = await prisma.rechargeOrder.findFirst({
      where: { id, userId },
      include: { provider: true, manualQrCode: true },
    });
    if (!order) return reply.status(404).send({ code: 0, msg: '充值订单不存在' });
    return reply.send({ code: 1, msg: 'ok', data: serializeRechargeOrder(order) });
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const order = await prisma.rechargeOrder.findFirst({ where: { id, userId } });
    if (!order) return reply.status(404).send({ code: 0, msg: '充值订单不存在' });
    if (order.isProcessed || order.status === 'paid') {
      return reply.status(400).send({ code: 0, msg: '已入账订单不能取消' });
    }
    const result = await prisma.rechargeOrder.updateMany({
      where: {
        id,
        userId,
        status: { in: ['pending', 'proof_submitted'] },
        isProcessed: false,
      },
      data: { status: 'cancelled' },
    });
    if (result.count !== 1) {
      const latest = await prisma.rechargeOrder.findFirst({ where: { id, userId } });
      return reply.status(400).send({ code: 0, msg: `当前状态不能取消：${latest?.status || 'unknown'}` });
    }
    const updated = await prisma.rechargeOrder.findUnique({
      where: { id },
      include: { provider: true, manualQrCode: true },
    });
    return reply.send({ code: 1, msg: '已取消', data: serializeRechargeOrder(updated) });
  });

  app.post('/:id/upload-proof', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = proofSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    try {
      const order = await uploadManualRechargeProof(id, userId, parsed.data);
      return reply.send({ code: 1, msg: '付款凭证已提交', data: order });
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error?.message || '提交失败' });
    }
  });
}
