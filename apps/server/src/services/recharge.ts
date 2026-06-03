import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { getRuntimeConfig } from '../adapters/runtime-config.js';
import {
  buildEpaySubmitUrl,
  calculateEpaySign,
  normalizeEpayMethod,
  parseSupportedMethods,
  verifyEpaySign,
  type EpayParams,
} from './epay-adapter.js';

const D = Prisma.Decimal;

export interface EpayNotifyInput {
  providerId: string;
  rawParams: Record<string, any>;
  ip: string;
  userAgent?: string;
}

export interface NotifyResult {
  success: boolean;
  response: string;
  message: string;
}

export interface CreateRechargeInput {
  userId: string;
  amount: number | string | Prisma.Decimal;
  paymentMethod: string;
  providerId?: string;
}

function nowPlusMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function normalizeAmount(value: number | string | Prisma.Decimal): Prisma.Decimal {
  const amount = new D(value);
  if (amount.lessThanOrEqualTo(0)) throw new Error('充值金额必须大于 0');
  return new D(amount.toFixed(2));
}

function amountString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function generateOrderNo(): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `${stamp}${random}`;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function decryptProviderKey(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return decrypt(value);
  } catch {
    // Backward compatibility for providers created before encrypted storage.
    return value;
  }
}

export function encryptProviderKey(value: string): string {
  return encrypt(value);
}

function maskProvider(provider: any) {
  return {
    ...provider,
    merchantKeyEncrypted: provider.merchantKeyEncrypted ? '***MASKED***' : '',
    minAmount: provider.minAmount?.toString?.() ?? provider.minAmount,
    maxAmount: provider.maxAmount?.toString?.() ?? provider.maxAmount,
    dailyLimit: provider.dailyLimit?.toString?.() ?? null,
    feeRate: provider.feeRate?.toString?.() ?? null,
    feeFixed: provider.feeFixed?.toString?.() ?? null,
  };
}

export function serializePaymentProvider(provider: any) {
  return maskProvider(provider);
}

export function serializeRechargeOrder(order: any) {
  if (!order) return null;
  return {
    ...order,
    provider: order.provider ? serializePaymentProvider(order.provider) : order.provider,
    amount: order.amount?.toString?.() ?? order.amount,
    fee: order.fee?.toString?.() ?? order.fee,
    actualAmount: order.actualAmount?.toString?.() ?? order.actualAmount,
  };
}

export function calculateRechargeAmounts(amountInput: number | string | Prisma.Decimal, provider: any) {
  const amount = normalizeAmount(amountInput);
  const feeRate = provider.feeRate ? new D(provider.feeRate) : new D(0);
  const feeFixed = provider.feeFixed ? new D(provider.feeFixed) : new D(0);
  const fee = new D(amount.mul(feeRate).add(feeFixed).toFixed(2));
  const actualAmount = provider.feePayer === 'user' ? amount.sub(fee) : amount;
  if (actualAmount.lessThanOrEqualTo(0)) throw new Error('到账金额必须大于 0');
  return { amount, fee, actualAmount: new D(actualAmount.toFixed(2)) };
}

async function resolvePublicBaseUrl(): Promise<string> {
  return getRuntimeConfig().localBaseUrl.replace(/\/+$/, '');
}

function resolveWebBaseUrl(apiBaseUrl: string): string {
  const explicit = process.env.PUBLIC_WEB_BASE_URL || process.env.NEXT_PUBLIC_WEB_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const userHostname = process.env.NEXT_PUBLIC_USER_HOSTNAME;
  if (userHostname) return `https://${userHostname}`.replace(/\/+$/, '');
  return apiBaseUrl;
}

async function getProviderForRecharge(providerId: string | undefined, amount: Prisma.Decimal, method: string) {
  const where: any = providerId
    ? { id: providerId }
    : {
        type: 'epay',
        isEnabled: true,
        minAmount: { lte: amount },
        maxAmount: { gte: amount },
      };

  const provider = providerId
    ? await prisma.paymentProvider.findUnique({ where })
    : await prisma.paymentProvider.findFirst({ where, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] });

  if (!provider || !provider.isEnabled) throw new Error('支付网关未启用');
  if (provider.type !== 'epay') throw new Error('请选择自动充值网关');
  if (amount.lessThan(provider.minAmount) || amount.greaterThan(provider.maxAmount)) {
    throw new Error(`充值金额需在 ${provider.minAmount.toString()}-${provider.maxAmount.toString()} 元之间`);
  }
  const supported = parseSupportedMethods(provider.supportedMethods);
  if (!supported.includes(method)) throw new Error(`该支付网关不支持 ${method}`);
  return provider;
}

async function assertProviderDailyLimit(provider: any, amount: Prisma.Decimal) {
  if (!provider.dailyLimit) return;
  const result = await prisma.rechargeOrder.aggregate({
    where: {
      providerId: provider.id,
      status: { in: ['pending', 'proof_submitted', 'paid'] },
      createdAt: { gte: startOfToday() },
    },
    _sum: { amount: true },
  });
  const used = result._sum.amount || new D(0);
  if (used.add(amount).greaterThan(provider.dailyLimit)) {
    throw new Error(`支付通道今日额度不足，剩余额度 ${new D(provider.dailyLimit).sub(used).toFixed(2)} 元`);
  }
}

async function assertManualQrDailyLimit(qrCode: any, amount: Prisma.Decimal) {
  if (!qrCode.dailyLimit) return;
  const result = await prisma.rechargeOrder.aggregate({
    where: {
      manualQrCodeId: qrCode.id,
      status: { in: ['pending', 'proof_submitted', 'paid'] },
      createdAt: { gte: startOfToday() },
    },
    _sum: { amount: true },
  });
  const used = result._sum.amount || new D(0);
  if (used.add(amount).greaterThan(qrCode.dailyLimit)) {
    throw new Error(`该收款码今日额度不足，剩余额度 ${new D(qrCode.dailyLimit).sub(used).toFixed(2)} 元`);
  }
}

export async function createEpayRechargeOrder(input: CreateRechargeInput) {
  const paymentMethod = normalizeEpayMethod(input.paymentMethod);
  const amount = normalizeAmount(input.amount);
  const provider = await getProviderForRecharge(input.providerId, amount, paymentMethod);
  const key = decryptProviderKey(provider.merchantKeyEncrypted);
  if (!provider.gatewayUrl || !provider.merchantId || !key) {
    throw new Error('支付网关配置不完整');
  }
  await assertProviderDailyLimit(provider, amount);
  const { fee, actualAmount } = calculateRechargeAmounts(amount, provider);
  const apiBaseUrl = await resolvePublicBaseUrl();
  const webBaseUrl = resolveWebBaseUrl(apiBaseUrl);
  const orderNo = generateOrderNo();
  const expireAt = nowPlusMinutes(Number((provider.config as any)?.orderExpireMinutes || 30));

  const order = await prisma.rechargeOrder.create({
    data: {
      userId: input.userId,
      providerId: provider.id,
      orderNo,
      amount,
      fee,
      actualAmount,
      paymentMethod,
      paymentType: 'auto',
      status: 'pending',
      expireAt,
    },
  });

  const payUrl = buildEpaySubmitUrl(
    provider.gatewayUrl,
    {
      pid: provider.merchantId,
      type: paymentMethod,
      out_trade_no: orderNo,
      notify_url: `${apiBaseUrl}/api/payments/notify/epay/${provider.id}`,
      return_url: `${webBaseUrl}/finance?recharge=${order.id}`,
      name: 'SS ERP余额充值',
      money: amountString(amount),
      param: order.id,
    },
    key,
  );

  const updated = await prisma.rechargeOrder.update({
    where: { id: order.id },
    data: { payUrl },
    include: { provider: true, manualQrCode: true },
  });
  return serializeRechargeOrder(updated);
}

async function createNotifyLog(params: {
  providerId: string;
  orderId?: string | null;
  rawParams: Record<string, any>;
  ip: string;
  userAgent?: string;
  signValid?: boolean;
  expectedSign?: string;
  receivedSign?: string;
  isSuccess: boolean;
  errorMessage?: string | null;
  response: string;
}) {
  await prisma.paymentNotifyLog.create({
    data: {
      providerId: params.providerId,
      orderId: params.orderId || null,
      rawParams: params.rawParams,
      ip: params.ip,
      userAgent: params.userAgent || null,
      signValid: params.signValid,
      expectedSign: params.expectedSign,
      receivedSign: params.receivedSign,
      isSuccess: params.isSuccess,
      errorMessage: params.errorMessage || null,
      response: params.response,
    },
  });
}

function getNotifyAmount(rawParams: Record<string, any>): Prisma.Decimal | null {
  try {
    return new D(String(rawParams.money ?? '0')).toDecimalPlaces(2);
  } catch {
    return null;
  }
}

async function creditRechargeOrderInTransaction(tx: any, current: any, operator: string, description: string) {
  const account = await tx.userAccount.upsert({
    where: { userId: current.userId },
    update: { balance: { increment: current.actualAmount } },
    create: {
      userId: current.userId,
      balance: current.actualAmount,
      creditLimit: 0,
      billingMode: 'prepaid',
      frozenAmount: 0,
    },
  });
  await tx.transaction.create({
    data: {
      accountId: account.id,
      type: 'recharge',
      amount: current.actualAmount,
      balanceAfter: account.balance,
      orderId: current.id,
      description,
      operator,
      module: 'recharge',
    },
  });
  return account.balance;
}

async function claimRechargeOrderForProcessing(tx: any, orderId: string, allowedStatuses: string[]) {
  const result = await tx.rechargeOrder.updateMany({
    where: {
      id: orderId,
      status: { in: allowedStatuses },
      isProcessed: false,
    },
    data: { status: 'processing' },
  });
  return result.count === 1;
}

export async function handleEpayNotify(input: EpayNotifyInput): Promise<NotifyResult> {
  const provider = await prisma.paymentProvider.findUnique({ where: { id: input.providerId } });
  if (!provider || provider.type !== 'epay') {
    return { success: false, response: 'provider error', message: 'provider not found' };
  }

  const key = decryptProviderKey(provider.merchantKeyEncrypted);
  const verify = verifyEpaySign(input.rawParams as EpayParams, key);
  const orderNo = String(input.rawParams.out_trade_no || '');
  const order = orderNo ? await prisma.rechargeOrder.findUnique({ where: { orderNo } }) : null;

  if (!verify.valid) {
    await createNotifyLog({
      providerId: provider.id,
      orderId: order?.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: false,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: false,
      errorMessage: 'Invalid signature',
      response: 'sign error',
    });
    return { success: false, response: 'sign error', message: 'invalid signature' };
  }

  if (!order) {
    await createNotifyLog({
      providerId: provider.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: true,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: false,
      errorMessage: `Order not found: ${orderNo}`,
      response: 'order not found',
    });
    return { success: false, response: 'order not found', message: 'order not found' };
  }

  if (order.providerId !== provider.id) {
    await createNotifyLog({
      providerId: provider.id,
      orderId: order.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: true,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: false,
      errorMessage: `Provider mismatch: expect ${order.providerId}, got ${provider.id}`,
      response: 'provider mismatch',
    });
    return { success: false, response: 'provider mismatch', message: 'provider mismatch' };
  }

  if (String(input.rawParams.trade_status || '') !== 'TRADE_SUCCESS') {
    await createNotifyLog({
      providerId: provider.id,
      orderId: order.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: true,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: false,
      errorMessage: `Unsupported trade status: ${String(input.rawParams.trade_status || '')}`,
      response: 'trade status error',
    });
    return { success: false, response: 'trade status error', message: 'trade status error' };
  }

  if (order.isProcessed && order.status === 'paid') {
    await createNotifyLog({
      providerId: provider.id,
      orderId: order.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: true,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: true,
      response: 'success',
    });
    return { success: true, response: 'success', message: 'already processed' };
  }

  const notifyAmount = getNotifyAmount(input.rawParams);
  if (!notifyAmount || notifyAmount.toFixed(2) !== order.amount.toFixed(2)) {
    await createNotifyLog({
      providerId: provider.id,
      orderId: order.id,
      rawParams: input.rawParams,
      ip: input.ip,
      userAgent: input.userAgent,
      signValid: true,
      expectedSign: verify.expectedSign,
      receivedSign: verify.receivedSign,
      isSuccess: false,
      errorMessage: `Amount mismatch: expect ${order.amount.toFixed(2)}, got ${notifyAmount?.toFixed(2) || String(input.rawParams.money || '')}`,
      response: 'amount error',
    });
    return { success: false, response: 'amount error', message: 'amount mismatch' };
  }

  const txResult = await prisma.$transaction(async (tx) => {
    const current = await tx.rechargeOrder.findUnique({ where: { id: order.id } });
    if (!current) return { ok: false, message: 'order not found' };
    if (current.isProcessed && current.status === 'paid') return { ok: true, message: 'already processed' };
    if (current.status !== 'pending') return { ok: false, message: `invalid order status: ${current.status}` };
    const claimed = await claimRechargeOrderForProcessing(tx, current.id, ['pending']);
    if (!claimed) {
      const latest = await tx.rechargeOrder.findUnique({ where: { id: current.id } });
      if (latest?.isProcessed && latest.status === 'paid') return { ok: true, message: 'already processed' };
      return { ok: false, message: `invalid order status: ${latest?.status || 'unknown'}` };
    }

    await creditRechargeOrderInTransaction(tx, current, 'payment:epay', `在线充值到账 - 订单号：${current.orderNo}`);
    await tx.rechargeOrder.update({
      where: { id: current.id },
      data: {
        status: 'paid',
        platformOrderNo: String(input.rawParams.trade_no || ''),
        paidAt: new Date(),
        isProcessed: true,
      },
    });
    return { ok: true, message: 'ok' };
  });

  await createNotifyLog({
    providerId: provider.id,
    orderId: order.id,
    rawParams: input.rawParams,
    ip: input.ip,
    userAgent: input.userAgent,
    signValid: true,
    expectedSign: verify.expectedSign,
    receivedSign: verify.receivedSign,
    isSuccess: txResult.ok,
    errorMessage: txResult.ok ? null : txResult.message,
    response: txResult.ok ? 'success' : 'process error',
  });

  if (!txResult.ok) return { success: false, response: 'process error', message: txResult.message };
  return { success: true, response: 'success', message: txResult.message };
}

export async function createManualRechargeOrder(input: CreateRechargeInput) {
  const paymentMethod = normalizeEpayMethod(input.paymentMethod || 'manual');
  const amount = normalizeAmount(input.amount);
  const qrCodes = await prisma.manualPaymentQRCode.findMany({
    where: {
      method: paymentMethod,
      isEnabled: true,
      minAmount: { lte: amount },
      maxAmount: { gte: amount },
    },
    orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
  });
  if (qrCodes.length === 0) throw new Error('暂无可用人工收款码');

  const totalWeight = qrCodes.reduce((sum: number, qr: any) => sum + Math.max(1, Number(qr.weight || 1)), 0);
  let cursor = Math.floor(Math.random() * totalWeight);
  let qrCode = qrCodes[0]!;
  for (const qr of qrCodes) {
    cursor -= Math.max(1, Number(qr.weight || 1));
    if (cursor < 0) {
      qrCode = qr;
      break;
    }
  }
  await assertManualQrDailyLimit(qrCode, amount);

  let provider = await prisma.paymentProvider.findFirst({ where: { type: 'manual' }, orderBy: { createdAt: 'asc' } });
  if (!provider) {
    provider = await prisma.paymentProvider.create({
      data: {
        type: 'manual',
        name: '人工充值',
        isEnabled: true,
        priority: 0,
        supportedMethods: ['alipay', 'wxpay'],
        minAmount: 1,
        maxAmount: 100000,
      },
    });
  }

  const order = await prisma.rechargeOrder.create({
    data: {
      userId: input.userId,
      providerId: provider.id,
      manualQrCodeId: qrCode.id,
      orderNo: generateOrderNo(),
      amount,
      fee: 0,
      actualAmount: amount,
      paymentMethod,
      paymentType: 'manual',
      status: 'pending',
      qrcodeUrl: qrCode.qrcodeImage,
      expireAt: nowPlusMinutes(24 * 60),
    },
    include: { provider: true, manualQrCode: true },
  });

  return serializeRechargeOrder(order);
}

export async function uploadManualRechargeProof(orderId: string, userId: string, proof: { proofImage?: string; proofNote?: string }) {
  const order = await prisma.rechargeOrder.findFirst({ where: { id: orderId, userId, paymentType: 'manual' } });
  if (!order) throw new Error('充值订单不存在');
  if (!['pending', 'proof_submitted'].includes(order.status) || order.isProcessed) {
    throw new Error('当前订单状态不能提交凭证');
  }
  const updated = await prisma.rechargeOrder.update({
    where: { id: order.id },
    data: {
      proofImage: proof.proofImage || order.proofImage,
      proofNote: proof.proofNote || order.proofNote,
      status: 'proof_submitted',
    },
    include: { provider: true, manualQrCode: true },
  });
  return serializeRechargeOrder(updated);
}

export async function approveManualRecharge(orderId: string, reviewerId: string): Promise<{ success: boolean; message: string }> {
  const order = await prisma.rechargeOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('充值订单不存在');
  if (order.paymentType !== 'manual') throw new Error('只能审核人工充值订单');

  return prisma.$transaction(async (tx) => {
    const current = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
    if (!current) throw new Error('充值订单不存在');
    if (current.isProcessed && current.status === 'paid') return { success: true, message: 'already processed' };
    if (current.paymentType !== 'manual') throw new Error('只能审核人工充值订单');
    if (!['pending', 'proof_submitted'].includes(current.status)) {
      throw new Error(`当前状态无法审核：${current.status}`);
    }
    const claimed = await claimRechargeOrderForProcessing(tx, current.id, ['pending', 'proof_submitted']);
    if (!claimed) {
      const latest = await tx.rechargeOrder.findUnique({ where: { id: current.id } });
      if (latest?.isProcessed && latest.status === 'paid') return { success: true, message: 'already processed' };
      throw new Error(`当前状态无法审核：${latest?.status || 'unknown'}`);
    }

    await creditRechargeOrderInTransaction(tx, current, reviewerId, `人工充值审核入账 - 订单号：${current.orderNo}`);
    await tx.rechargeOrder.update({
      where: { id: current.id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        isProcessed: true,
        reviewerId,
        reviewedAt: new Date(),
      },
    });
    return { success: true, message: 'ok' };
  });
}

export async function rejectManualRecharge(orderId: string, reviewerId: string, reason: string) {
  const order = await prisma.rechargeOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('充值订单不存在');
  if (order.paymentType !== 'manual') throw new Error('只能审核人工充值订单');
  if (order.isProcessed || order.status === 'paid') throw new Error('已入账订单不能拒绝');
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.rechargeOrder.updateMany({
      where: {
        id: orderId,
        paymentType: 'manual',
        status: { in: ['pending', 'proof_submitted'] },
        isProcessed: false,
      },
      data: {
        status: 'rejected',
        reviewerId,
        reviewedAt: new Date(),
        rejectReason: reason || '管理员拒绝',
      },
    });
    if (claimed.count !== 1) {
      const latest = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
      throw new Error(`当前状态无法拒绝：${latest?.status || 'unknown'}`);
    }
    return tx.rechargeOrder.findUnique({
      where: { id: orderId },
      include: { provider: true, manualQrCode: true },
    });
  });
  return serializeRechargeOrder(updated);
}

export async function expirePendingRechargeOrders(now = new Date()) {
  const result = await prisma.rechargeOrder.updateMany({
    where: {
      status: { in: ['pending', 'proof_submitted'] },
      isProcessed: false,
      expireAt: { lt: now },
    },
    data: { status: 'timeout' },
  });
  return result.count;
}

export { calculateEpaySign };
