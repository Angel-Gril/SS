import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  paymentProvider: {
    findUnique: vi.fn(),
  },
  rechargeOrder: {
    findUnique: vi.fn(),
  },
  paymentNotifyLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const txMock = vi.hoisted(() => ({
  userAccount: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  transaction: {
    create: vi.fn(),
  },
  rechargeOrder: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/crypto.js', () => ({
  decrypt: vi.fn((value: string) => value),
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

const D = Prisma.Decimal;

function signedNotify(overrides: Record<string, string> = {}) {
  const base = {
    pid: '1001',
    trade_no: 'epay-trade-1',
    out_trade_no: '202606030001',
    type: 'alipay',
    name: 'SS ERP余额充值',
    money: '100.00',
    trade_status: 'TRADE_SUCCESS',
    param: 'order-1',
    ...overrides,
  };
  return { ...base, sign_type: 'MD5' } as Record<string, string>;
}

describe('epay adapter', () => {
  it('calculates easy-pay compatible MD5 signatures with sorted non-empty params', async () => {
    const { calculateEpaySign } = await import('../services/epay-adapter.js');

    const params = {
      sign_type: 'MD5',
      sign: 'ignored',
      notify_url: 'https://app.ss-erp.com/api/payments/notify/epay',
      return_url: 'https://app.ss-erp.com/finance',
      type: 'alipay',
      pid: '1001',
      out_trade_no: '202606030001',
      money: '100.00',
      name: 'SS ERP余额充值',
      empty: '',
    };

    expect(calculateEpaySign(params, 'secret')).toBe('cd708aad216fd44d33ae2e6a27ccc1d0');
  });
});

describe('recharge payment notify handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: any) => callback(txMock));
    prismaMock.paymentProvider.findUnique.mockResolvedValue({
      id: 'provider-1',
      type: 'epay',
      name: '彩虹易支付',
      isEnabled: true,
      merchantId: '1001',
      merchantKeyEncrypted: 'secret',
    });
    txMock.userAccount.upsert.mockResolvedValue({
      id: 'account-1',
      userId: 'user-1',
      balance: new D('120.00'),
      creditLimit: new D(0),
      billingMode: 'prepaid',
      frozenAmount: new D(0),
    });
    txMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      providerId: 'provider-1',
      orderNo: '202606030001',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      status: 'pending',
      isProcessed: false,
    });
    txMock.rechargeOrder.updateMany.mockResolvedValue({ count: 1 });
  });

  it('credits a pending recharge after signature, status, provider, and amount checks pass', async () => {
    const { calculateEpaySign } = await import('../services/epay-adapter.js');
    const rawParams = signedNotify();
    rawParams.sign = calculateEpaySign(rawParams, 'secret');
    prismaMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      providerId: 'provider-1',
      orderNo: '202606030001',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      status: 'pending',
      isProcessed: false,
    });

    const { handleEpayNotify } = await import('../services/recharge.js');

    await expect(handleEpayNotify({ providerId: 'provider-1', rawParams, ip: '127.0.0.1' })).resolves.toMatchObject({
      success: true,
      response: 'success',
    });
    expect(txMock.userAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: { balance: { increment: new D('100.00') } },
      create: {
        userId: 'user-1',
        balance: new D('100.00'),
        creditLimit: 0,
        billingMode: 'prepaid',
        frozenAmount: 0,
      },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-1',
        type: 'recharge',
        amount: new D('100.00'),
        balanceAfter: new D('120.00'),
        orderId: 'order-1',
        module: 'recharge',
      }),
    });
    expect(txMock.rechargeOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'paid',
        isProcessed: true,
        platformOrderNo: 'epay-trade-1',
      }),
    });
  });

  it('does not credit when another transaction already claimed the pending order', async () => {
    const { calculateEpaySign } = await import('../services/epay-adapter.js');
    const rawParams = signedNotify();
    rawParams.sign = calculateEpaySign(rawParams, 'secret');
    prismaMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      providerId: 'provider-1',
      orderNo: '202606030001',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      status: 'pending',
      isProcessed: false,
    });
    txMock.rechargeOrder.updateMany.mockResolvedValue({ count: 0 });
    txMock.rechargeOrder.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        userId: 'user-1',
        providerId: 'provider-1',
        orderNo: '202606030001',
        amount: new D('100.00'),
        fee: new D('0.00'),
        actualAmount: new D('100.00'),
        status: 'pending',
        isProcessed: false,
      })
      .mockResolvedValueOnce({
        id: 'order-1',
        userId: 'user-1',
        providerId: 'provider-1',
        orderNo: '202606030001',
        amount: new D('100.00'),
        fee: new D('0.00'),
        actualAmount: new D('100.00'),
        status: 'processing',
        isProcessed: false,
      });

    const { handleEpayNotify } = await import('../services/recharge.js');

    await expect(handleEpayNotify({ providerId: 'provider-1', rawParams, ip: '127.0.0.1' })).resolves.toMatchObject({
      success: false,
      response: 'process error',
      message: 'invalid order status: processing',
    });
    expect(txMock.userAccount.upsert).not.toHaveBeenCalled();
    expect(txMock.transaction.create).not.toHaveBeenCalled();
  });

  it('does not credit the account twice when the same paid order is notified again', async () => {
    const { calculateEpaySign } = await import('../services/epay-adapter.js');
    const rawParams = signedNotify();
    rawParams.sign = calculateEpaySign(rawParams, 'secret');
    prismaMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      providerId: 'provider-1',
      orderNo: '202606030001',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      status: 'paid',
      isProcessed: true,
    });

    const { handleEpayNotify } = await import('../services/recharge.js');

    await expect(handleEpayNotify({ providerId: 'provider-1', rawParams, ip: '127.0.0.1' })).resolves.toMatchObject({
      success: true,
      response: 'success',
      message: 'already processed',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.userAccount.upsert).not.toHaveBeenCalled();
  });

  it('rejects a validly signed notify when the paid amount differs from the recharge order', async () => {
    const { calculateEpaySign } = await import('../services/epay-adapter.js');
    const rawParams = signedNotify({ money: '99.99' });
    rawParams.sign = calculateEpaySign(rawParams, 'secret');
    prismaMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      providerId: 'provider-1',
      orderNo: '202606030001',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      status: 'pending',
      isProcessed: false,
    });

    const { handleEpayNotify } = await import('../services/recharge.js');

    await expect(handleEpayNotify({ providerId: 'provider-1', rawParams, ip: '127.0.0.1' })).resolves.toMatchObject({
      success: false,
      response: 'amount error',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.paymentNotifyLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signValid: true,
        isSuccess: false,
        errorMessage: expect.stringContaining('Amount mismatch'),
      }),
    });
  });

  it('credits a proof-submitted manual recharge only through admin approval', async () => {
    txMock.userAccount.upsert.mockResolvedValue({
      id: 'account-1',
      userId: 'user-1',
      balance: new D('220.00'),
      creditLimit: new D(0),
      billingMode: 'prepaid',
      frozenAmount: new D(0),
    });
    prismaMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'manual-order-1',
      userId: 'user-1',
      providerId: 'provider-manual',
      orderNo: '202606030002',
      amount: new D('200.00'),
      fee: new D('0.00'),
      actualAmount: new D('200.00'),
      paymentType: 'manual',
      status: 'proof_submitted',
      isProcessed: false,
    });
    txMock.rechargeOrder.findUnique.mockResolvedValue({
      id: 'manual-order-1',
      userId: 'user-1',
      providerId: 'provider-manual',
      orderNo: '202606030002',
      amount: new D('200.00'),
      fee: new D('0.00'),
      actualAmount: new D('200.00'),
      paymentType: 'manual',
      status: 'proof_submitted',
      isProcessed: false,
    });

    const { approveManualRecharge } = await import('../services/recharge.js');

    await expect(approveManualRecharge('manual-order-1', 'admin-1')).resolves.toMatchObject({
      success: true,
      message: 'ok',
    });
    expect(txMock.userAccount.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: { balance: { increment: new D('200.00') } },
      create: {
        userId: 'user-1',
        balance: new D('200.00'),
        creditLimit: 0,
        billingMode: 'prepaid',
        frozenAmount: 0,
      },
    });
    expect(txMock.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'account-1',
        type: 'recharge',
        amount: new D('200.00'),
        balanceAfter: new D('220.00'),
        orderId: 'manual-order-1',
        operator: 'admin-1',
        module: 'recharge',
      }),
    });
  });
});

describe('recharge response serialization', () => {
  it('masks nested payment provider merchant keys before returning recharge orders', async () => {
    const { serializeRechargeOrder } = await import('../services/recharge.js');

    const serialized = serializeRechargeOrder({
      id: 'order-1',
      amount: new D('100.00'),
      fee: new D('0.00'),
      actualAmount: new D('100.00'),
      provider: {
        id: 'provider-1',
        name: '彩虹易支付',
        merchantKeyEncrypted: 'encrypted-secret',
        minAmount: new D('10.00'),
        maxAmount: new D('5000.00'),
      },
    });

    expect(serialized.provider.merchantKeyEncrypted).toBe('***MASKED***');
    expect(serialized.provider.minAmount).toBe('10');
    expect(serialized.amount).toBe('100');
  });
});
