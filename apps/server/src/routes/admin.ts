import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate, clearAuthContextCache, removeAllSessions, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { generateAccountCode, nextAdminCode, nextSuperAdminCode } from '../lib/account-code.js';
import { logAudit, extractRequestMeta } from '../lib/audit-log.js';
import { revokeExtensionDeviceSessionsForUserInTransaction } from '../services/extension-device-session-prisma.js';

const createTagSchema = z.object({
  name: z.string().min(1, '标签名称不能为空'),
  color: z.string().min(1, '颜色不能为空'),
  description: z.string().optional(),
  fee: z.coerce.number().min(0, '费用不能为负'),
  needInspection: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
});

const updateTagSchema = createTagSchema.partial();

const updateAccountSchema = z.object({
  billingMode: z.enum(['prepaid', 'monthly']).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
});

const adminRechargeSchema = z.object({
  amount: z.coerce.number().positive('充值金额必须大于0').max(1000000),
  description: z.string().optional(),
});

// 费用模板 schemas
const createFeeTemplateSchema = z.object({
  name: z.string().min(1, '模板名称不能为空'),
  type: z.enum(['packing', 'shipping', 'other']),
  fee: z.coerce.number().min(0, '费用不能为负'),
  description: z.string().optional(),
  isDefault: z.boolean().default(false),
});

const updateFeeTemplateSchema = createFeeTemplateSchema.partial();

// 用户管理 schemas
const createUserSchema = z.object({
  phone: z.string().min(11, '手机号格式不正确').max(11),
  password: z.string().min(6, '密码至少6位'),
  role: z.enum(['ADMIN', 'USER', 'STAFF']).default('USER'),
  nickname: z.string().optional(),
  canInvite: z.boolean().default(false),
  inviteLimit: z.coerce.number().int().min(0).default(0),
  isSuperAdmin: z.boolean().optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'USER', 'STAFF']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  nickname: z.string().optional(),
  canInvite: z.boolean().optional(),
  inviteLimit: z.coerce.number().int().min(0).optional(),
  tenantType: z.enum(['transit', 'solo']).optional(),
  perOrderFee: z.coerce.number().min(0).max(999.99).nullable().optional(),
  customColorEnabled: z.boolean().optional(),
  canPublishAddress: z.boolean().optional(),
  isTransitProvider: z.boolean().optional(),
  isSuperAdmin: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6, '密码至少6位'),
});

async function ensureCanModifyUser(actor: any, target: { isSuperAdmin: boolean }) {
  if (target.isSuperAdmin && !actor?.isSuperAdmin) {
    throw new Error('只有超级管理员可以修改超管账户');
  }
}

async function ensureNotRemovingLastActiveSuperAdmin(
  targetId: string,
  existing: { role: string; status: string; isSuperAdmin: boolean },
  next: { role?: string; status?: string; isSuperAdmin?: boolean },
) {
  if (existing.role !== 'ADMIN' || existing.status !== 'ACTIVE' || !existing.isSuperAdmin) return;

  const nextRole = next.role ?? existing.role;
  const nextStatus = next.status ?? existing.status;
  const nextIsSuperAdmin = next.isSuperAdmin ?? existing.isSuperAdmin;
  const remainsActiveSuperAdmin = nextRole === 'ADMIN' && nextStatus === 'ACTIVE' && nextIsSuperAdmin;
  if (remainsActiveSuperAdmin) return;

  const remaining = await prisma.user.count({
    where: {
      id: { not: targetId },
      role: 'ADMIN',
      status: 'ACTIVE',
      isSuperAdmin: true,
    },
  });
  if (remaining === 0) {
    throw new Error('不能移除最后一个可用的超级管理员');
  }
}

export function getPermanentUserDeletionError(
  actor: { actorUserId?: string; userId?: string; role?: string; isSuperAdmin?: boolean } | null | undefined,
  target: { id: string; role: string; isSuperAdmin: boolean },
): string | null {
  if (!actor?.isSuperAdmin) return '只有超级管理员可以永久删除账户';
  const actorId = actor.actorUserId || actor.userId;
  if (actorId && actorId === target.id) return '不能删除当前登录账户';
  if (target.role === 'ADMIN' && target.isSuperAdmin) {
    return '不能永久删除超级管理员，请先撤销超管权限或禁用账户';
  }
  return null;
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('ADMIN'));

  // GET /api/admin/service-tags — 获取所有标签配置
  app.get('/service-tags', async (_request, reply) => {
    const tags = await prisma.serviceTagConfig.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return reply.send({
      code: 1,
      msg: 'ok',
      data: tags.map((t) => ({ ...t, fee: t.fee.toString() })),
    });
  });

  // POST /api/admin/service-tags — 创建标签
  app.post('/service-tags', async (request, reply) => {
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const tag = await prisma.serviceTagConfig.create({
      data: {
        name: parsed.data.name,
        color: parsed.data.color,
        description: parsed.data.description,
        fee: parsed.data.fee,
        needInspection: parsed.data.needInspection,
        sortOrder: parsed.data.sortOrder,
      },
    });

    return reply.send({ code: 1, msg: '创建成功', data: { ...tag, fee: tag.fee.toString() } });
  });

  // PUT /api/admin/service-tags/:id — 更新标签
  app.put('/service-tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const existing = await prisma.serviceTagConfig.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '标签不存在' });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.color !== undefined) data.color = parsed.data.color;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.fee !== undefined) data.fee = parsed.data.fee;
    if (parsed.data.needInspection !== undefined) data.needInspection = parsed.data.needInspection;
    if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;

    const tag = await prisma.serviceTagConfig.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '更新成功', data: { ...tag, fee: (tag.fee as any).toString() } });
  });

  // DELETE /api/admin/service-tags/:id — 软删除标签
  app.delete('/service-tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.serviceTagConfig.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '标签不存在' });
    }

    await prisma.serviceTagConfig.update({ where: { id }, data: { isActive: false } });
    return reply.send({ code: 1, msg: '删除成功' });
  });

  // GET /api/admin/accounts — 所有用户账户列表
  app.get('/accounts', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') {
      return reply.status(403).send({ code: 0, msg: '无权限' });
    }

    const query = request.query as { offset?: string; limit?: string; search?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    const users = await prisma.user.findMany({
      where: query.search
        ? { OR: [{ phone: { contains: query.search } }, { nickname: { contains: query.search, mode: 'insensitive' } }] }
        : undefined,
      skip: offset,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        nickname: true,
        role: true,
        accountCode: true,
        parentId: true,
        account: true,
      },
    });

    const total = await prisma.user.count({
      where: query.search
        ? { OR: [{ phone: { contains: query.search } }, { nickname: { contains: query.search, mode: 'insensitive' } }] }
        : undefined,
    });

    const rows = users.map((u) => ({
      userId: u.id,
      phone: u.phone,
      nickname: u.nickname,
      role: u.role,
      accountCode: u.accountCode,
      parentId: u.parentId,
      isSubAccount: !!u.parentId,
      balance: u.account?.balance.toString() ?? '0',
      creditLimit: u.account?.creditLimit.toString() ?? '0',
      billingMode: u.account?.billingMode ?? 'prepaid',
      frozenAmount: u.account?.frozenAmount.toString() ?? '0',
    }));

    return reply.send({ code: 1, msg: 'ok', data: { total, rows } });
  });

  // PUT /api/admin/accounts/:userId — 修改用户账户设置
  app.put('/accounts/:userId', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') {
      return reply.status(403).send({ code: 0, msg: '无权限' });
    }

    const { userId } = request.params as { userId: string };
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    let account = await prisma.userAccount.findUnique({ where: { userId } });
    if (!account) {
      account = await prisma.userAccount.create({
        data: { userId, balance: 0, creditLimit: 0, billingMode: 'prepaid', frozenAmount: 0 },
      });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.billingMode !== undefined) data.billingMode = parsed.data.billingMode;
    if (parsed.data.creditLimit !== undefined) data.creditLimit = parsed.data.creditLimit;

    const updated = await prisma.userAccount.update({ where: { id: account.id }, data });

    return reply.send({
      code: 1,
      msg: '更新成功',
      data: {
        balance: updated.balance.toString(),
        creditLimit: updated.creditLimit.toString(),
        billingMode: updated.billingMode,
        frozenAmount: updated.frozenAmount.toString(),
      },
    });
  });

  // POST /api/admin/accounts/:userId/recharge — 给用户充值
  app.post('/accounts/:userId/recharge', async (request, reply) => {
    const { role, userId: operatorId } = (request as any).user;
    if (role !== 'ADMIN') {
      return reply.status(403).send({ code: 0, msg: '无权限' });
    }

    const { userId } = request.params as { userId: string };
    const parsed = adminRechargeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { amount, description } = parsed.data;

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

  // ==================== 费用模板管理 ====================

  // GET /api/admin/fee-templates — 获取所有费用模板
  app.get('/fee-templates', async (_request, reply) => {
    const templates = await prisma.feeTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({
      code: 1,
      msg: 'ok',
      data: templates.map((t) => ({ ...t, fee: t.fee.toString() })),
    });
  });

  // POST /api/admin/fee-templates — 创建费用模板
  app.post('/fee-templates', async (request, reply) => {
    const parsed = createFeeTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    // 如果设为默认，取消同类型其他默认
    if (parsed.data.isDefault) {
      await prisma.feeTemplate.updateMany({
        where: { type: parsed.data.type, isDefault: true },
        data: { isDefault: false },
      });
    }

    const template = await prisma.feeTemplate.create({ data: parsed.data });
    return reply.send({ code: 1, msg: '创建成功', data: { ...template, fee: template.fee.toString() } });
  });

  // PUT /api/admin/fee-templates/:id — 更新费用模板
  app.put('/fee-templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateFeeTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const existing = await prisma.feeTemplate.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '模板不存在' });
    }

    // 如果设为默认，取消同类型其他默认
    if (parsed.data.isDefault) {
      const targetType = parsed.data.type || existing.type;
      await prisma.feeTemplate.updateMany({
        where: { type: targetType, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const template = await prisma.feeTemplate.update({ where: { id }, data: parsed.data });
    return reply.send({ code: 1, msg: '更新成功', data: { ...template, fee: template.fee.toString() } });
  });

  // DELETE /api/admin/fee-templates/:id — 软删除费用模板
  app.delete('/fee-templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.feeTemplate.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '模板不存在' });
    }
    await prisma.feeTemplate.update({ where: { id }, data: { isActive: false } });
    return reply.send({ code: 1, msg: '删除成功' });
  });

  // ==================== 用户管理 ====================

  // GET /api/admin/users — 用户列表
  app.get('/users', async (request, reply) => {
    const query = request.query as { offset?: string; limit?: string; search?: string; role?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    const where: any = {};
    if (query.search) {
      where.OR = [
        { phone: { contains: query.search } },
        { nickname: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.role) where.role = query.role;

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          nickname: true,
          accountCode: true,
          role: true,
          status: true,
          canInvite: true,
          inviteLimit: true,
          inviteCount: true,
          parentId: true,
          tenantType: true,
          perOrderFee: true,
          customColorEnabled: true,
          canPublishAddress: true,
          isSuperAdmin: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
    ]);

    return reply.send({ code: 1, msg: 'ok', data: { total, rows: users } });
  });

  // POST /api/admin/users — 创建用户
  app.post('/users', async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const actor = (request as any).user;
    const { phone, password, role, nickname, canInvite, inviteLimit, isSuperAdmin } = parsed.data;

    if (isSuperAdmin && !actor?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: '只有超级管理员可以创建超级管理员' });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let accountCode: string;
    try {
      accountCode = role === 'ADMIN'
        ? (isSuperAdmin ? await nextSuperAdminCode() : await nextAdminCode())
        : await generateAccountCode(null);
    } catch (e: any) {
      return reply.status(400).send({ code: 0, msg: e.message || '账号编号分配失败' });
    }
    const user = await prisma.user.create({
      data: {
        phone,
        passwordHash,
        role: role as any,
        nickname: nickname || `用户${phone.slice(-4)}`,
        canInvite,
        inviteLimit,
        accountCode,
        isSuperAdmin: role === 'ADMIN' && !!isSuperAdmin,
      },
    });

    return reply.send({
      code: 1,
      msg: '创建成功',
      data: { id: user.id, phone: user.phone, nickname: user.nickname, role: user.role, accountCode: user.accountCode, isSuperAdmin: user.isSuperAdmin },
    });
  });

  // PUT /api/admin/users/:id — 修改用户信息
  app.put('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const actor = (request as any).user;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }

    if (parsed.data.isSuperAdmin !== undefined && !actor?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: '只有超级管理员可以授予/撤销超管权限' });
    }
    try {
      await ensureCanModifyUser(actor, existing);
    } catch (e: any) {
      return reply.status(403).send({ code: 0, msg: e.message });
    }

    const data: any = {};
    if (parsed.data.role !== undefined) data.role = parsed.data.role;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.nickname !== undefined) data.nickname = parsed.data.nickname;
    if (parsed.data.canInvite !== undefined) data.canInvite = parsed.data.canInvite;
    if (parsed.data.inviteLimit !== undefined) data.inviteLimit = parsed.data.inviteLimit;
    if (parsed.data.tenantType !== undefined) data.tenantType = parsed.data.tenantType;
    if (parsed.data.perOrderFee !== undefined) data.perOrderFee = parsed.data.perOrderFee;
    if (parsed.data.customColorEnabled !== undefined) data.customColorEnabled = parsed.data.customColorEnabled;
    if (parsed.data.canPublishAddress !== undefined) data.canPublishAddress = parsed.data.canPublishAddress;
    if (parsed.data.isTransitProvider !== undefined) data.isTransitProvider = parsed.data.isTransitProvider;
    if (parsed.data.isSuperAdmin !== undefined) {
      const targetRole = parsed.data.role !== undefined ? parsed.data.role : existing.role;
      data.isSuperAdmin = targetRole === 'ADMIN' && parsed.data.isSuperAdmin;
    } else if (parsed.data.role !== undefined && parsed.data.role !== 'ADMIN' && existing.isSuperAdmin) {
      data.isSuperAdmin = false;
    }

    try {
      await ensureNotRemovingLastActiveSuperAdmin(id, existing, data);
    } catch (e: any) {
      return reply.status(400).send({ code: 0, msg: e.message });
    }

    const suspending = data.status === 'SUSPENDED';
    let childUserIds: string[] = [];
    const user = suspending
      ? await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id },
          data: { ...data, authVersion: { increment: 1 } },
        });
        await revokeExtensionDeviceSessionsForUserInTransaction(tx, id, 'ACCOUNT_SUSPENDED');
        const childUsers = await tx.user.findMany({
          where: { parentId: id },
          select: { id: true },
        });
        if (childUsers.length > 0) {
          await tx.user.updateMany({
            where: { parentId: id },
            data: { authVersion: { increment: 1 } },
          });
        }
        childUserIds = childUsers.map((child) => child.id);
        for (const childId of childUserIds) {
          await revokeExtensionDeviceSessionsForUserInTransaction(tx, childId, 'ACCOUNT_SUSPENDED');
        }
        return updated;
      }, { isolationLevel: 'Serializable' })
      : await prisma.user.update({ where: { id }, data });

    if (suspending) {
      for (const affectedUserId of [id, ...childUserIds]) {
        clearAuthContextCache(affectedUserId);
        await removeAllSessions(affectedUserId).catch(() => {
          request.log.warn({ userId: affectedUserId }, 'Account suspension could not purge cached web sessions');
        });
      }
    }

    // 审计日志：记录敏感字段变更
    const sensitiveChanges: Record<string, any> = {};
    if (data.role !== undefined) sensitiveChanges.role = { before: existing.role, after: data.role };
    if (data.status !== undefined) sensitiveChanges.status = { before: existing.status, after: data.status };
    if (data.isSuperAdmin !== undefined) sensitiveChanges.isSuperAdmin = { before: existing.isSuperAdmin, after: data.isSuperAdmin };
    if (data.canInvite !== undefined) sensitiveChanges.canInvite = { before: existing.canInvite, after: data.canInvite };

    if (Object.keys(sensitiveChanges).length > 0) {
      await logAudit({
        actorId: actor.actorUserId || actor.userId,
        actorRole: actor.role,
        action: 'user_permission_change',
        target: id,
        before: { phone: existing.phone, ...Object.fromEntries(Object.entries(sensitiveChanges).map(([k, v]) => [k, v.before])) },
        after: { phone: user.phone, ...Object.fromEntries(Object.entries(sensitiveChanges).map(([k, v]) => [k, v.after])) },
        ...extractRequestMeta(request),
      });
    }

    clearAuthContextCache(id);
    return reply.send({
      code: 1,
      msg: '更新成功',
      data: {
        id: user.id, phone: user.phone, nickname: user.nickname, role: user.role, status: user.status,
        canInvite: user.canInvite, inviteLimit: user.inviteLimit,
        tenantType: user.tenantType, perOrderFee: user.perOrderFee?.toString() ?? null,
        customColorEnabled: user.customColorEnabled,
        canPublishAddress: user.canPublishAddress,
        isSuperAdmin: user.isSuperAdmin,
      },
    });
  });

  // POST /api/admin/users/:id/reset-password — 重置密码
  app.post('/users/:id/reset-password', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }
    const actor = (request as any).user;
    try {
      await ensureCanModifyUser(actor, existing);
    } catch (e: any) {
      return reply.status(403).send({ code: 0, msg: e.message });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await revokeExtensionDeviceSessionsForUserInTransaction(tx, id, 'PASSWORD_RESET');
    }, { isolationLevel: 'Serializable' });
    await removeAllSessions(id).catch(() => {
      request.log.warn({ userId: id }, 'Password reset could not purge cached web sessions');
    });
    clearAuthContextCache(id);
    return reply.send({ code: 1, msg: '密码已重置' });
  });

  // DELETE /api/admin/users/:id — 禁用用户
  app.delete('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }
    const actor = (request as any).user;
    try {
      await ensureCanModifyUser(actor, existing);
      await ensureNotRemovingLastActiveSuperAdmin(id, existing, { status: 'SUSPENDED' });
    } catch (e: any) {
      return reply.status(existing.isSuperAdmin && !actor?.isSuperAdmin ? 403 : 400).send({ code: 0, msg: e.message });
    }
    let childUserIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { status: 'SUSPENDED', authVersion: { increment: 1 } },
      });
      await revokeExtensionDeviceSessionsForUserInTransaction(tx, id, 'ACCOUNT_SUSPENDED');
      const childUsers = await tx.user.findMany({
        where: { parentId: id },
        select: { id: true },
      });
      if (childUsers.length > 0) {
        await tx.user.updateMany({
          where: { parentId: id },
          data: { authVersion: { increment: 1 } },
        });
      }
      childUserIds = childUsers.map((child) => child.id);
      for (const childId of childUserIds) {
        await revokeExtensionDeviceSessionsForUserInTransaction(tx, childId, 'ACCOUNT_SUSPENDED');
      }
    }, { isolationLevel: 'Serializable' });
    for (const affectedUserId of [id, ...childUserIds]) {
      clearAuthContextCache(affectedUserId);
      await removeAllSessions(affectedUserId).catch(() => {
        request.log.warn({ userId: affectedUserId }, 'Account suspension could not purge cached web sessions');
      });
    }
    return reply.send({ code: 1, msg: '用户已禁用' });
  });

  // DELETE /api/admin/users/:id/permanent — 永久删除普通管理员/用户
  app.delete('/users/:id/permanent', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = (request as any).user;
    const existing = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phone: true,
        nickname: true,
        role: true,
        status: true,
        isSuperAdmin: true,
      },
    });
    if (!existing) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }

    const guardError = getPermanentUserDeletionError(actor, existing);
    if (guardError) {
      return reply.status(403).send({ code: 0, msg: guardError });
    }

    const createdAnnouncements = await prisma.announcement.count({ where: { createdBy: id } });
    if (createdAnnouncements > 0) {
      return reply.status(409).send({ code: 0, msg: '该账户创建过公告，不能直接删除；请先保留账户并禁用，或转移公告创建者' });
    }

    try {
      await prisma.user.delete({ where: { id } });
    } catch (e: any) {
      if (e?.code === 'P2003') {
        return reply.status(409).send({ code: 0, msg: '该账户存在无法级联清理的关联数据，不能直接删除；请先禁用账户' });
      }
      throw e;
    }

    clearAuthContextCache(id);
    await logAudit({
      actorId: actor.actorUserId || actor.userId,
      actorRole: actor.role,
      action: 'user_delete',
      target: id,
      before: {
        id: existing.id,
        phone: existing.phone,
        nickname: existing.nickname,
        role: existing.role,
        status: existing.status,
        isSuperAdmin: existing.isSuperAdmin,
      },
      after: null,
      ...extractRequestMeta(request),
    });
    return reply.send({ code: 1, msg: '账户已永久删除' });
  });

  // === ShopBillingConfig CRUD ===

  app.get('/shop-billing-configs', async (_request, reply) => {
    const list = await prisma.shopBillingConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ code: 1, msg: 'ok', data: list.map((c) => ({ ...c, perOrderFee: c.perOrderFee.toString() })) });
  });

  app.post('/shop-billing-configs', async (request, reply) => {
    const body = request.body as { shopId: string; perOrderFee: number };
    if (!body?.shopId || body.perOrderFee == null) {
      return reply.status(400).send({ code: 0, msg: '缺少 shopId 或 perOrderFee' });
    }
    const config = await prisma.shopBillingConfig.upsert({
      where: { shopId: body.shopId },
      create: { shopId: body.shopId, perOrderFee: body.perOrderFee },
      update: { perOrderFee: body.perOrderFee, isActive: true },
    });
    return reply.send({ code: 1, msg: '已保存', data: { ...config, perOrderFee: config.perOrderFee.toString() } });
  });

  app.delete('/shop-billing-configs/:shopId', async (request, reply) => {
    const { shopId } = request.params as { shopId: string };
    await prisma.shopBillingConfig.deleteMany({ where: { shopId } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  // === SoloSeller 计费报表 ===

  app.get('/solo-billing', async (request, reply) => {
    const { month, userId } = request.query as { month?: string; userId?: string };
    const where: any = {};
    if (month) where.month = month;
    if (userId) where.userId = userId;
    const snapshots = await prisma.soloBillingSnapshot.findMany({
      where,
      orderBy: [{ month: 'desc' }, { totalFee: 'desc' }],
      take: 200,
    });
    const userIds = [...new Set(snapshots.map((s) => s.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, phone: true, nickname: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));
    return reply.send({
      code: 1,
      msg: 'ok',
      data: snapshots.map((s) => ({
        ...s,
        totalFee: s.totalFee.toString(),
        user: userMap.get(s.userId) || null,
      })),
    });
  });
}

// 数据迁移：
// 1. 系统无超管时，把最早 ADMIN 提升为超管
// 2. 回填超管 accountCode（NULL 或不在 1-10 区段）→ nextSuperAdminCode
// 3. 回填普通管理员 accountCode（不在 11-100 区段）→ nextAdminCode
// 二级子账号（accountCode = parentCode-N）级联同步
export async function seedSuperAdmin() {
  const superCount = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', isSuperAdmin: true } });
  if (superCount === 0) {
    const earliestAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, phone: true, accountCode: true },
    });
    if (earliestAdmin) {
      await prisma.user.update({ where: { id: earliestAdmin.id }, data: { isSuperAdmin: true } });
      console.log(`[seed] 已将最早的管理员 ${earliestAdmin.phone}(${earliestAdmin.accountCode || 'no-code'}) 提升为超级管理员`);
    }
  }

  const superAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', isSuperAdmin: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, phone: true, accountCode: true },
  });
  for (const u of superAdmins) {
    if (isCodeInRange(u.accountCode, 1, 10)) continue;
    try {
      const newCode = await nextSuperAdminCode();
      await reassignAccountCodeWithChildren(u.id, u.accountCode, newCode);
      console.log(`[seed] 回填超管 ${u.phone} accountCode: ${u.accountCode || 'null'} → ${newCode}`);
    } catch (e: any) {
      console.error(`[seed] 超管 ${u.phone} 回填 accountCode 失败:`, e.message);
    }
  }

  const plainAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', isSuperAdmin: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true, phone: true, accountCode: true },
  });
  for (const u of plainAdmins) {
    if (isCodeInRange(u.accountCode, 11, 100)) continue;
    try {
      const newCode = await nextAdminCode();
      await reassignAccountCodeWithChildren(u.id, u.accountCode, newCode);
      console.log(`[seed] 回填管理员 ${u.phone} accountCode: ${u.accountCode || 'null'} → ${newCode}`);
    } catch (e: any) {
      console.error(`[seed] 管理员 ${u.phone} 回填 accountCode 失败:`, e.message);
    }
  }
}

function isCodeInRange(code: string | null, start: number, end: number): boolean {
  if (!code || !/^\d+$/.test(code)) return false;
  const n = parseInt(code, 10);
  return n >= start && n <= end;
}

async function reassignAccountCodeWithChildren(userId: string, oldCode: string | null, newCode: string) {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { accountCode: newCode } });
    if (oldCode) {
      const children = await tx.user.findMany({
        where: { parentId: userId, accountCode: { startsWith: `${oldCode}-` } },
        select: { id: true, accountCode: true },
      });
      for (const child of children) {
        const tail = child.accountCode!.slice(oldCode.length + 1);
        await tx.user.update({ where: { id: child.id }, data: { accountCode: `${newCode}-${tail}` } });
      }
    }
  });
}

// 初始化默认标签数据
export async function seedServiceTags() {
  const count = await prisma.serviceTagConfig.count();
  if (count > 0) return;

  await prisma.serviceTagConfig.createMany({
    data: [
      { name: '正常发货', color: 'green', description: '标准发货流程', fee: 0, needInspection: false, sortOrder: 1 },
      { name: '精细打包', color: 'yellow', description: '额外加固包装', fee: 5, needInspection: false, sortOrder: 2 },
      { name: '拆包验视', color: 'red', description: '拆开包裹检查内容物', fee: 10, needInspection: true, sortOrder: 3 },
      { name: '拍照验货', color: 'purple', description: '拍照记录商品状态', fee: 8, needInspection: true, sortOrder: 4 },
      { name: '合包发货', color: 'blue', description: '多个包裹合并发出', fee: 3, needInspection: false, sortOrder: 5 },
    ],
  });
}
