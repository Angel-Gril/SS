import { prisma } from '../lib/prisma.js';
import { readEffectiveFinanceTransactions } from './ozon-finance-accrual.js';

/**
 * 聚合指定用户/店铺的月度统计，写入 AccountMonthlyStat
 */
export async function aggregateMonthlyStats(userId: string, yearMonth: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCode: true },
  });
  const accountCode = user?.accountCode ?? null;

  const shops = await prisma.shop.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  const monthStart = new Date(yearMonth + '-01');
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  let accountMetrics = emptyMetrics();

  for (const shop of shops) {
    const snapshots = await prisma.orderCostSnapshot.findMany({
      where: { shopId: shop.id, yearMonth },
    });

    const orders = await prisma.order.findMany({
      where: { shopId: shop.id, createdAt: { gte: monthStart, lt: monthEnd } },
      select: { id: true, status: true, totalAmount: true },
    });

    const returns = await prisma.return.findMany({
      where: { shopId: shop.id, createdAt: { gte: monthStart, lt: monthEnd } },
      select: { amount: true },
    });

    // 从 finance transactions 聚合广告/罚款明细
    const txns = await readEffectiveFinanceTransactions(prisma, {
      shopId: shop.id, operationDate: { gte: monthStart, lt: monthEnd },
    });

    const metrics = buildMetrics(orders, returns, snapshots, txns);

    await prisma.accountMonthlyStat.upsert({
      where: {
        userId_accountCode_shopId_yearMonth: {
          userId, accountCode: accountCode ?? '', shopId: shop.id, yearMonth,
        },
      },
      create: {
        userId, accountCode, shopId: shop.id, yearMonth,
        currency: 'CNY', metrics, computedAt: new Date(),
      },
      update: { metrics, computedAt: new Date() },
    });

    // 累加到账户汇总
    mergeMetrics(accountMetrics, metrics);
  }

  // 账户级汇总（shopId = null -> 用空字符串占位 unique）
  await prisma.accountMonthlyStat.upsert({
    where: {
      userId_accountCode_shopId_yearMonth: {
        userId, accountCode: accountCode ?? '', shopId: '', yearMonth,
      },
    },
    create: {
      userId, accountCode, shopId: null, yearMonth,
      currency: 'CNY', metrics: accountMetrics, computedAt: new Date(),
    },
    update: { metrics: accountMetrics, computedAt: new Date() },
  });
}

function emptyMetrics() {
  return {
    allOrderCount: 0, allOrderAmount: 0,
    cancelledCount: 0, cancelledAmount: 0,
    returnedCount: 0, returnedAmount: 0,
    normalCount: 0, normalAmount: 0,
    deliveredCount: 0, deliveredAmount: 0,
    inTransitCount: 0, inTransitAmount: 0,
    cancelRate: 0, returnRate: 0,
    saleAmountCny: 0, commissionCny: 0,
    purchaseCostCny: 0, packageFeeCny: 0,
    shippingDomesticCny: 0, shippingLastMileCny: 0,
    shippingIntlCny: 0, shippingPostCny: 0,
    totalShippingCny: 0,
    adClickCny: 0, adCpaCny: 0, adReviewCny: 0,
    adQuickCny: 0, adPremiumCny: 0, adBrandCny: 0, totalAdCny: 0,
    penaltyIndexCny: 0, penaltyPickfailCny: 0,
    refundPartialCny: 0, disputeCny: 0, serviceOtherCny: 0, totalPenaltyCny: 0,
    otherFeeCny: 0,
    profitCny: 0, totalInvestment: 0,
    roiPct: 0, marginPct: 0,
  };
}

function buildMetrics(orders: any[], returns: any[], snapshots: any[], txns: any[]) {
  const m = emptyMetrics();

  m.allOrderCount = orders.length;
  for (const o of orders) {
    const amt = Number(o.totalAmount ?? 0);
    m.allOrderAmount += amt;
    if (o.status === 'cancelled') { m.cancelledCount++; m.cancelledAmount += amt; }
    else if (o.status === 'returned') { m.returnedCount++; m.returnedAmount += amt; }
    else if (o.status === 'delivered') { m.deliveredCount++; m.deliveredAmount += amt; }
    else if (['delivering', 'driver_pickup'].includes(o.status)) { m.inTransitCount++; m.inTransitAmount += amt; }
    else { m.normalCount++; m.normalAmount += amt; }
  }

  m.returnedCount += returns.length;
  for (const r of returns) m.returnedAmount += Number(r.amount ?? 0);

  m.cancelRate = m.allOrderCount > 0 ? round2(m.cancelledCount / m.allOrderCount * 100) : 0;
  m.returnRate = m.allOrderCount > 0 ? round2(m.returnedCount / m.allOrderCount * 100) : 0;

  for (const s of snapshots) {
    m.saleAmountCny += Number(s.saleAmountCny ?? 0);
    m.commissionCny += Number(s.commissionCny ?? 0);
    m.purchaseCostCny += Number(s.purchaseCostCny ?? 0);
    m.packageFeeCny += Number(s.packageFeeCny ?? 0);
    m.shippingDomesticCny += Number(s.shippingDomesticCny ?? 0);
    m.shippingLastMileCny += Number(s.shippingLastMileCny ?? 0);
    m.shippingIntlCny += Number(s.shippingIntlCny ?? 0);
    m.shippingPostCny += Number(s.shippingPostCny ?? 0);
    m.otherFeeCny += Number(s.otherFeeCny ?? 0);
    m.profitCny += Number(s.profitCny ?? 0);
  }

  // 从 finance transactions 拆广告/罚款明细
  for (const tx of txns) {
    const amt = tx.costAmountCny ?? Math.abs(Number(tx.amountCny));
    switch (tx.category) {
      case 'ad_click': m.adClickCny += amt; break;
      case 'ad_cpa': m.adCpaCny += amt; break;
      case 'ad_review': m.adReviewCny += amt; break;
      case 'ad_quick': m.adQuickCny += amt; break;
      case 'ad_premium': m.adPremiumCny += amt; break;
      case 'ad_brand': m.adBrandCny += amt; break;
      case 'penalty_index': m.penaltyIndexCny += amt; break;
      case 'penalty_pickfail': m.penaltyPickfailCny += amt; break;
      case 'refund_partial': m.refundPartialCny += amt; break;
      case 'dispute': m.disputeCny += amt; break;
      case 'service_other': m.serviceOtherCny += amt; break;
    }
  }

  m.totalAdCny = m.adClickCny + m.adCpaCny + m.adReviewCny + m.adQuickCny + m.adPremiumCny + m.adBrandCny;
  m.totalPenaltyCny = m.penaltyIndexCny + m.penaltyPickfailCny + m.refundPartialCny + m.disputeCny + m.serviceOtherCny;
  m.totalShippingCny = m.shippingDomesticCny + m.shippingLastMileCny + m.shippingIntlCny + m.shippingPostCny;
  m.totalInvestment = m.purchaseCostCny + m.packageFeeCny + m.totalShippingCny + m.totalAdCny + m.totalPenaltyCny + m.otherFeeCny + m.commissionCny;
  m.roiPct = m.totalInvestment > 0 ? round2(m.profitCny / m.totalInvestment * 100) : 0;
  m.marginPct = m.saleAmountCny > 0 ? round2(m.profitCny / m.saleAmountCny * 100) : 0;

  return m;
}

function mergeMetrics(target: any, source: any) {
  for (const key of Object.keys(target)) {
    if (typeof target[key] === 'number') target[key] += source[key] ?? 0;
  }
  // 重算比率
  target.cancelRate = target.allOrderCount > 0 ? round2(target.cancelledCount / target.allOrderCount * 100) : 0;
  target.returnRate = target.allOrderCount > 0 ? round2(target.returnedCount / target.allOrderCount * 100) : 0;
  target.roiPct = target.totalInvestment > 0 ? round2(target.profitCny / target.totalInvestment * 100) : 0;
  target.marginPct = target.saleAmountCny > 0 ? round2(target.profitCny / target.saleAmountCny * 100) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
