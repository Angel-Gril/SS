import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  approveManualRecharge,
  encryptProviderKey,
  rejectManualRecharge,
  serializePaymentProvider,
  serializeRechargeOrder,
} from '../services/recharge.js';
import { buildSignedEpayParams, parseSupportedMethods } from '../services/epay-adapter.js';
import { extractRequestMeta, logAudit } from '../lib/audit-log.js';

const providerSchema = z.object({
  type: z.enum(['epay', 'manual']).default('epay'),
  name: z.string().min(1, '网关名称不能为空'),
  isEnabled: z.boolean().default(false),
  priority: z.coerce.number().int().default(0),
  gatewayUrl: z.string().optional(),
  merchantId: z.string().optional(),
  merchantKey: z.string().optional(),
  supportedMethods: z.array(z.string()).default(['alipay', 'wxpay']),
  minAmount: z.coerce.number().min(0.01).default(10),
  maxAmount: z.coerce.number().min(0.01).default(10000),
  dailyLimit: z.coerce.number().min(0).nullable().optional(),
  feeRate: z.coerce.number().min(0).max(1).nullable().optional(),
  feeFixed: z.coerce.number().min(0).nullable().optional(),
  feePayer: z.enum(['user', 'platform']).default('platform'),
  config: z.record(z.any()).optional(),
});

const qrSchema = z.object({
  method: z.string().min(1),
  name: z.string().min(1),
  qrcodeImage: z.string().min(1),
  accountName: z.string().optional(),
  minAmount: z.coerce.number().min(0.01).default(10),
  maxAmount: z.coerce.number().min(0.01).default(10000),
  dailyLimit: z.coerce.number().min(0).nullable().optional(),
  weight: z.coerce.number().int().min(1).default(100),
  isEnabled: z.boolean().default(true),
});

const rejectSchema = z.object({
  reason: z.string().min(1, '请填写拒绝原因'),
});

function providerData(parsed: z.infer<typeof providerSchema>, merchantKeyEncrypted?: string | null) {
  const data: any = {
    type: parsed.type,
    name: parsed.name,
    isEnabled: parsed.isEnabled,
    priority: parsed.priority,
    gatewayUrl: parsed.gatewayUrl || null,
    merchantId: parsed.merchantId || null,
    supportedMethods: parsed.supportedMethods,
    minAmount: parsed.minAmount,
    maxAmount: parsed.maxAmount,
    dailyLimit: parsed.dailyLimit ?? null,
    feeRate: parsed.feeRate ?? null,
    feeFixed: parsed.feeFixed ?? null,
    feePayer: parsed.feePayer,
    config: parsed.config || {},
  };
  if (parsed.merchantKey && parsed.merchantKey !== '***MASKED***') {
    data.merchantKeyEncrypted = encryptProviderKey(parsed.merchantKey);
  } else if (merchantKeyEncrypted !== undefined) {
    data.merchantKeyEncrypted = merchantKeyEncrypted;
  }
  return data;
}

function paymentProviderAuditView(provider: any) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    isEnabled: provider.isEnabled,
    priority: provider.priority,
    supportedMethods: parseSupportedMethods(provider.supportedMethods),
    minAmount: provider.minAmount?.toString?.() ?? provider.minAmount,
    maxAmount: provider.maxAmount?.toString?.() ?? provider.maxAmount,
    dailyLimit: provider.dailyLimit?.toString?.() ?? null,
    feeRate: provider.feeRate?.toString?.() ?? null,
    feeFixed: provider.feeFixed?.toString?.() ?? null,
    feePayer: provider.feePayer,
  };
}

function paymentQrAuditView(qr: any) {
  return {
    id: qr.id,
    method: qr.method,
    name: qr.name,
    isEnabled: qr.isEnabled,
    minAmount: qr.minAmount?.toString?.() ?? qr.minAmount,
    maxAmount: qr.maxAmount?.toString?.() ?? qr.maxAmount,
    dailyLimit: qr.dailyLimit?.toString?.() ?? null,
    weight: qr.weight,
  };
}

function auditActor(request: any) {
  const actor = request.user || {};
  return {
    actorId: actor.actorUserId || actor.userId,
    actorRole: actor.role,
    ...extractRequestMeta(request),
  };
}

export async function adminPaymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/providers', async (_request, reply) => {
    const rows = await prisma.paymentProvider.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    return reply.send({
      code: 1,
      msg: 'ok',
      data: rows.map((p) => ({ ...serializePaymentProvider(p), supportedMethods: parseSupportedMethods(p.supportedMethods) })),
    });
  });

  app.post('/providers', async (request, reply) => {
    const parsed = providerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const provider = await prisma.paymentProvider.create({ data: providerData(parsed.data) });
    await logAudit({
      ...auditActor(request),
      action: 'payment_provider_create',
      target: provider.id,
      after: paymentProviderAuditView(provider),
    });
    return reply.send({ code: 1, msg: '创建成功', data: serializePaymentProvider(provider) });
  });

  app.put('/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.paymentProvider.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '支付网关不存在' });
    const parsed = providerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const provider = await prisma.paymentProvider.update({
      where: { id },
      data: providerData(parsed.data, existing.merchantKeyEncrypted),
    });
    await logAudit({
      ...auditActor(request),
      action: 'payment_provider_update',
      target: provider.id,
      before: paymentProviderAuditView(existing),
      after: paymentProviderAuditView(provider),
    });
    return reply.send({ code: 1, msg: '已保存', data: serializePaymentProvider(provider) });
  });

  app.post('/providers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = await prisma.paymentProvider.findUnique({ where: { id } });
    if (!provider) return reply.status(404).send({ code: 0, msg: '支付网关不存在' });
    if (provider.type !== 'epay') return reply.status(400).send({ code: 0, msg: '仅易支付网关支持签名测试' });
    if (!provider.gatewayUrl || !provider.merchantId || !provider.merchantKeyEncrypted) {
      return reply.status(400).send({ code: 0, msg: '网关地址、PID 或 KEY 未配置' });
    }
    const { decrypt } = await import('../lib/crypto.js');
    let key = '';
    try {
      key = decrypt(provider.merchantKeyEncrypted);
    } catch {
      key = provider.merchantKeyEncrypted;
    }
    const sample = buildSignedEpayParams({
      pid: provider.merchantId,
      type: 'alipay',
      out_trade_no: 'TEST_ORDER',
      notify_url: 'https://example.com/notify',
      return_url: 'https://example.com/return',
      name: 'SS ERP测试订单',
      money: '0.01',
    }, key);
    return reply.send({ code: 1, msg: '签名生成正常', data: { sign: sample.sign, signType: sample.sign_type } });
  });

  app.get('/qrcodes', async (_request, reply) => {
    const rows = await prisma.manualPaymentQRCode.findMany({ orderBy: [{ isEnabled: 'desc' }, { weight: 'desc' }, { createdAt: 'desc' }] });
    return reply.send({
      code: 1,
      msg: 'ok',
      data: rows.map((q) => ({
        ...q,
        minAmount: q.minAmount.toString(),
        maxAmount: q.maxAmount.toString(),
        dailyLimit: q.dailyLimit?.toString() ?? null,
      })),
    });
  });

  app.post('/qrcodes', async (request, reply) => {
    const parsed = qrSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const qr = await prisma.manualPaymentQRCode.create({ data: parsed.data });
    await logAudit({
      ...auditActor(request),
      action: 'payment_qrcode_create',
      target: qr.id,
      after: paymentQrAuditView(qr),
    });
    return reply.send({ code: 1, msg: '创建成功', data: qr });
  });

  app.put('/qrcodes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.manualPaymentQRCode.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '收款码不存在' });
    const parsed = qrSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const qr = await prisma.manualPaymentQRCode.update({ where: { id }, data: parsed.data });
    await logAudit({
      ...auditActor(request),
      action: 'payment_qrcode_update',
      target: qr.id,
      before: paymentQrAuditView(existing),
      after: paymentQrAuditView(qr),
    });
    return reply.send({ code: 1, msg: '已保存', data: qr });
  });

  app.get('/recharges', async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string; status?: string; search?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { orderNo: { contains: query.search } },
        { platformOrderNo: { contains: query.search } },
        { user: { phone: { contains: query.search } } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.rechargeOrder.count({ where }),
      prisma.rechargeOrder.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          provider: true,
          manualQrCode: true,
          user: { select: { id: true, phone: true, nickname: true, accountCode: true } },
          reviewer: { select: { id: true, phone: true, nickname: true, accountCode: true } },
        },
      }),
    ]);
    return reply.send({ code: 1, msg: 'ok', data: { total, rows: rows.map(serializeRechargeOrder) } });
  });

  app.post('/recharges/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = (request as any).user;
    let result;
    try {
      result = await approveManualRecharge(id, actor.actorUserId || actor.userId);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error?.message || '审核失败' });
    }
    await logAudit({
      ...auditActor(request),
      action: 'manual_recharge_approve',
      target: id,
      after: { status: 'paid', idempotent: result.message === 'already processed' },
    });
    return reply.send({ code: 1, msg: '审核通过', data: result });
  });

  app.post('/recharges/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = (request as any).user;
    const parsed = rejectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    let order;
    try {
      order = await rejectManualRecharge(id, actor.actorUserId || actor.userId, parsed.data.reason);
    } catch (error: any) {
      return reply.status(400).send({ code: 0, msg: error?.message || '审核失败' });
    }
    await logAudit({
      ...auditActor(request),
      action: 'manual_recharge_reject',
      target: id,
      after: { status: 'rejected' },
    });
    return reply.send({ code: 1, msg: '已拒绝', data: order });
  });

  app.get('/notify-logs', async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string; success?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = {};
    if (query.success === 'true') where.isSuccess = true;
    if (query.success === 'false') where.isSuccess = false;
    const [total, rows] = await Promise.all([
      prisma.paymentNotifyLog.count({ where }),
      prisma.paymentNotifyLog.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { provider: true, order: true },
      }),
    ]);
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          ...r,
          provider: r.provider ? serializePaymentProvider(r.provider) : null,
          order: r.order ? serializeRechargeOrder(r.order) : null,
        })),
      },
    });
  });
}
