'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

interface Metrics {
  allOrderCount: number;
  allOrderAmount: number;
  cancelledCount: number;
  cancelledAmount: number;
  returnedCount: number;
  returnedAmount: number;
  normalCount: number;
  deliveredCount: number;
  inTransitCount: number;
  cancelRate: number;
  returnRate: number;
  saleAmountCny: number;
  commissionCny: number;
  purchaseCostCny: number;
  packageFeeCny: number;
  shippingDomesticCny: number;
  shippingLastMileCny: number;
  shippingIntlCny: number;
  shippingPostCny: number;
  totalShippingCny: number;
  adClickCny: number;
  adCpaCny: number;
  adReviewCny: number;
  adQuickCny: number;
  adPremiumCny: number;
  adBrandCny: number;
  totalAdCny: number;
  penaltyIndexCny: number;
  penaltyPickfailCny: number;
  refundPartialCny: number;
  disputeCny: number;
  serviceOtherCny: number;
  totalPenaltyCny: number;
  otherFeeCny: number;
  profitCny: number;
  totalInvestment: number;
  roiPct: number;
  marginPct: number;
}

interface ShopRow {
  shopId: string;
  shopName: string;
  platform: string;
  metrics: Metrics;
  computedAt: string;
}

interface AccountStatsResponse {
  yearMonth: string;
  accountSummary: { metrics: Metrics; computedAt: string } | null;
  shops: ShopRow[];
}

const N = (v: any) => Number(v ?? 0);
const fmt = (v: number) => formatCurrency(Math.round(v * 100) / 100, 'CNY');

function getRecentMonths(count = 6): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

function HoverDetail({ label, value, items }: { label: string; value: number; items: { name: string; amount: number }[] }) {
  return (
    <div className="group relative">
      <span className="cursor-help underline decoration-dotted">{fmt(value)}</span>
      <div className="invisible group-hover:visible absolute z-50 right-0 top-full mt-1 bg-white dark:bg-zinc-900 text-foreground border border-border rounded-md shadow-xl p-3 min-w-[220px] text-xs">
        <div className="font-medium mb-1.5">{label} 明细</div>
        {items.map((it) => (
          <div key={it.name} className="flex justify-between gap-3 py-0.5">
            <span className="text-muted-foreground">{it.name}</span>
            <span className="tabular-nums">{fmt(it.amount)}</span>
          </div>
        ))}
        <div className="border-t mt-1.5 pt-1.5 flex justify-between font-medium">
          <span>合计</span>
          <span className="tabular-nums">{fmt(value)}</span>
        </div>
      </div>
    </div>
  );
}

export default function OrderStatsPage() {
  const [yearMonth, setYearMonth] = useState(getRecentMonths(1)[0]);
  const [data, setData] = useState<AccountStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedShops, setExpandedShops] = useState<Set<string>>(new Set());

  useEffect(() => { fetchData(); }, [yearMonth]);

  async function fetchData() {
    setLoading(true);
    const res = await api.get<AccountStatsResponse>(`/api/orders/analytics/account-stats?yearMonth=${yearMonth}`);
    if (res.code === 1 && res.data) setData(res.data);
    setLoading(false);
  }

  async function handleRecompute() {
    setRecomputing(true);
    const res = await api.post<{ shopCount: number }>('/api/orders/analytics/recompute', { yearMonth });
    if (res.code === 1) {
      toast({ title: '重算任务已提交', description: `${res.data?.shopCount} 个店铺，预计 1-3 分钟后查看结果` });
    } else {
      toast({ title: '提交失败', description: res.msg, variant: 'destructive' });
    }
    setRecomputing(false);
  }

  async function handleFinanceSync() {
    setSyncing(true);
    const res = await api.post<{ shops: string[] }>('/api/orders/analytics/finance-sync', { days: 30 });
    if (res.code === 1) {
      toast({ title: '同步任务已提交', description: `正在同步 ${res.data?.shops.length} 个店铺的 OZON 财务流水` });
    } else {
      toast({ title: '提交失败', description: res.msg, variant: 'destructive' });
    }
    setSyncing(false);
  }

  function toggleExpand(shopId: string) {
    const next = new Set(expandedShops);
    if (next.has(shopId)) next.delete(shopId); else next.add(shopId);
    setExpandedShops(next);
  }

  const summary = data?.accountSummary?.metrics;
  const shops = data?.shops ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">订单费用统计</h1>
          <p className="text-muted-foreground text-sm mt-1">按账户/店铺分组的月度财务报表（金额已换算为 CNY）</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            {getRecentMonths(12).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={handleFinanceSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            同步财务流水
          </Button>
          <Button size="sm" variant="outline" onClick={handleRecompute} disabled={recomputing}>
            {recomputing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            重算本月
          </Button>
        </div>
      </div>

      {loading ? (
        <Card><CardContent className="py-20 text-center text-muted-foreground">加载中...</CardContent></Card>
      ) : !summary ? (
        <Card>
          <CardContent className="py-20 text-center space-y-3">
            <p className="text-muted-foreground">{yearMonth} 暂无统计数据</p>
            <p className="text-xs text-muted-foreground">请先点击"同步财务流水"拉取 OZON 数据，再点击"重算本月"生成报表</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard label="销售额" value={fmt(N(summary.saleAmountCny))} />
            <SummaryCard label="销售单数" value={String(summary.allOrderCount)} sub={`正常 ${summary.normalCount} · 完成 ${summary.deliveredCount}`} />
            <SummaryCard label="退货率" value={`${N(summary.returnRate).toFixed(2)}%`} sub={`${summary.returnedCount} 单`} />
            <SummaryCard label="利润" value={fmt(N(summary.profitCny))} highlight={N(summary.profitCny) >= 0 ? 'positive' : 'negative'} />
            <SummaryCard label="利润率" value={`${N(summary.marginPct).toFixed(2)}%`} sub={`ROI ${N(summary.roiPct).toFixed(2)}%`} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">店铺明细</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2.5 sticky left-0 bg-muted/50 z-10 min-w-[160px]">店铺</th>
                    <th className="text-right px-3 py-2.5">销售额</th>
                    <th className="text-right px-3 py-2.5">单数</th>
                    <th className="text-right px-3 py-2.5">退货率</th>
                    <th className="text-right px-3 py-2.5">销售佣金</th>
                    <th className="text-right px-3 py-2.5">进货</th>
                    <th className="text-right px-3 py-2.5">打包</th>
                    <th className="text-right px-3 py-2.5">总物流费</th>
                    <th className="text-right px-3 py-2.5">广告费</th>
                    <th className="text-right px-3 py-2.5">罚款</th>
                    <th className="text-right px-3 py-2.5 font-semibold">利润</th>
                    <th className="text-right px-3 py-2.5">利润率</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.length === 0 ? (
                    <tr><td colSpan={12} className="text-center py-8 text-muted-foreground">暂无店铺数据</td></tr>
                  ) : shops.map((shop) => {
                    const m = shop.metrics;
                    const expanded = expandedShops.has(shop.shopId);
                    return (
                      <>
                        <tr key={shop.shopId} className="border-t hover:bg-muted/30">
                          <td className="px-3 py-2.5 sticky left-0 bg-background hover:bg-muted/30 z-10">
                            <button onClick={() => toggleExpand(shop.shopId)} className="flex items-center gap-1.5 font-medium">
                              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {shop.shopName}
                              <Badge variant="outline" className="text-[10px] ml-1">{shop.platform}</Badge>
                            </button>
                          </td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(m.saleAmountCny))}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{m.allOrderCount}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{N(m.returnRate).toFixed(2)}%</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(m.commissionCny))}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(m.purchaseCostCny))}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(m.packageFeeCny))}</td>
                          <td className="text-right px-3 py-2.5 tabular-nums">
                            <HoverDetail
                              label="物流费"
                              value={N(m.totalShippingCny)}
                              items={[
                                { name: '线下物流', amount: N(m.shippingDomesticCny) },
                                { name: '尾程配送 (66)', amount: N(m.shippingLastMileCny) },
                                { name: '国际配送 (67)', amount: N(m.shippingIntlCny) },
                                { name: '邮政配送 (30)', amount: N(m.shippingPostCny) },
                              ]}
                            />
                          </td>
                          <td className="text-right px-3 py-2.5 tabular-nums">
                            <HoverDetail
                              label="广告费"
                              value={N(m.totalAdCny)}
                              items={[
                                { name: '点击付费 (41)', amount: N(m.adClickCny) },
                                { name: '按订单付费 (54)', amount: N(m.adCpaCny) },
                                { name: '评论积分 (47)', amount: N(m.adReviewCny) },
                                { name: '快速评价 (96)', amount: N(m.adQuickCny) },
                                { name: 'Premium 订阅 (52)', amount: N(m.adPremiumCny) },
                                { name: '品牌推广 (3)', amount: N(m.adBrandCny) },
                              ]}
                            />
                          </td>
                          <td className="text-right px-3 py-2.5 tabular-nums">
                            <HoverDetail
                              label="罚款"
                              value={N(m.totalPenaltyCny)}
                              items={[
                                { name: '错误指数超标 (93)', amount: N(m.penaltyIndexCny) },
                                { name: '配货不全 (77)', amount: N(m.penaltyPickfailCny) },
                                { name: '部分赔偿 (10)', amount: N(m.refundPartialCny) },
                                { name: '赔偿争议 (25)', amount: N(m.disputeCny) },
                                { name: '其他服务 (14)', amount: N(m.serviceOtherCny) },
                              ]}
                            />
                          </td>
                          <td className={`text-right px-3 py-2.5 tabular-nums font-semibold ${N(m.profitCny) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {fmt(N(m.profitCny))}
                          </td>
                          <td className={`text-right px-3 py-2.5 tabular-nums ${N(m.marginPct) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {N(m.marginPct).toFixed(2)}%
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t bg-muted/20">
                            <td colSpan={12} className="px-3 py-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                                <DetailItem label="所有订单" value={`${m.allOrderCount} 单 / ${fmt(N(m.allOrderAmount))}`} />
                                <DetailItem label="取消" value={`${m.cancelledCount} 单 / ${fmt(N(m.cancelledAmount))}`} />
                                <DetailItem label="退货" value={`${m.returnedCount} 单 / ${fmt(N(m.returnedAmount))}`} />
                                <DetailItem label="正常" value={`${m.normalCount} 单`} />
                                <DetailItem label="完成" value={`${m.deliveredCount} 单`} />
                                <DetailItem label="在途" value={`${m.inTransitCount} 单`} />
                                <DetailItem label="取消率" value={`${N(m.cancelRate).toFixed(2)}%`} />
                                <DetailItem label="退货率" value={`${N(m.returnRate).toFixed(2)}%`} />
                                <DetailItem label="总投入" value={fmt(N(m.totalInvestment))} />
                                <DetailItem label="投产比 (ROI)" value={`${N(m.roiPct).toFixed(2)}%`} />
                                <DetailItem label="其它费用" value={fmt(N(m.otherFeeCny))} />
                                <DetailItem label="计算时间" value={new Date(shop.computedAt).toLocaleString('zh-CN')} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
                {shops.length > 0 && summary && (
                  <tfoot className="bg-muted/50 font-medium border-t-2">
                    <tr>
                      <td className="px-3 py-2.5 sticky left-0 bg-muted/50">账户汇总</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.saleAmountCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{summary.allOrderCount}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{N(summary.returnRate).toFixed(2)}%</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.commissionCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.purchaseCostCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.packageFeeCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.totalShippingCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.totalAdCny))}</td>
                      <td className="text-right px-3 py-2.5 tabular-nums">{fmt(N(summary.totalPenaltyCny))}</td>
                      <td className={`text-right px-3 py-2.5 tabular-nums font-bold ${N(summary.profitCny) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmt(N(summary.profitCny))}
                      </td>
                      <td className={`text-right px-3 py-2.5 tabular-nums ${N(summary.marginPct) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {N(summary.marginPct).toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>

          {data?.accountSummary?.computedAt && (
            <p className="text-xs text-muted-foreground text-right">
              数据更新于 {new Date(data.accountSummary.computedAt).toLocaleString('zh-CN')}
              · 利润 = 销售额 - 佣金 - 进货 - 打包 - 总物流费 - 广告费 - 罚款 - 其它
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: 'positive' | 'negative' }) {
  const valueColor = highlight === 'positive' ? 'text-green-600' : highlight === 'negative' ? 'text-red-600' : '';
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-xl font-bold tabular-nums ${valueColor}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
