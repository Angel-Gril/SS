'use client';

import { useEffect, useState } from 'react';
import { Loader2, TrendingUp, TrendingDown, DollarSign, Percent, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PlatformShopFilter, type ShopPlatformFilter, shopPlatformLabel } from '@/components/shops/platform-shop-filter';

interface Shop { id: string; name: string; platform: string; }

interface ProfitRow {
  id: string;
  postingNumber: string | null;
  shopName: string;
  platform?: string;
  revenue: string;
  purchaseCost: string;
  commission: string;
  shipping: string;
  profit: string;
  margin: string;
  createdAt: string;
}

interface ProfitSummary {
  totalRevenue: string;
  totalCost: string;
  totalCommission: string;
  totalShipping: string;
  totalProfit: string;
  avgMargin: string;
  orderCount: number;
}

export default function ProfitPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [platform, setPlatform] = useState<ShopPlatformFilter>('');
  const [shopId, setShopId] = useState('');
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [summary, setSummary] = useState<ProfitSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const [commissionRate, setCommissionRate] = useState('15');
  const [exchangeRate, setExchangeRate] = useState('0.078');
  const [shippingCost, setShippingCost] = useState('0');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
  }, []);

  async function calculate() {
    setLoading(true);
    const params = new URLSearchParams({
      commissionRate: String(Number(commissionRate) / 100),
      exchangeRate,
      shippingCost,
      startDate,
      endDate,
    });
    if (platform) params.set('platform', platform);
    if (shopId) params.set('shopId', shopId);
    const res = await api.get<{ summary: ProfitSummary; rows: ProfitRow[] }>(`/api/finance/profit?${params}`);
    if (res.code === 1 && res.data) {
      setSummary(res.data.summary);
      setRows(res.data.rows);
    }
    setLoading(false);
  }

  useEffect(() => { calculate(); }, [platform, shopId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">利润分析</h1>
        <p className="text-muted-foreground text-sm mt-1">按订单计算利润，支持自定义佣金率、汇率和物流费用</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">平台 / 店铺</Label>
              <PlatformShopFilter
                shops={shops}
                platform={platform}
                shopId={shopId}
                compact
                onPlatformChange={(next) => { setPlatform(next); if (next && shops.find((shop) => shop.id === shopId)?.platform !== next) setShopId(''); }}
                onShopChange={setShopId}
                className="items-stretch"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">开始日期</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">结束日期</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">佣金率 (%)</Label>
              <Input type="number" step="0.1" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">汇率 (RUB→CNY)</Label>
              <Input type="number" step="0.001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} className="h-9" />
            </div>
            <Button onClick={calculate} disabled={loading} className="h-9">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
              计算
            </Button>
          </div>
          <div className="mt-2">
            <div className="space-y-1">
              <Label className="text-xs">默认物流费 (CNY/单)</Label>
              <Input type="number" step="0.1" value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} className="h-9 w-40" />
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard icon={DollarSign} label="总营收 (CNY)" value={`¥ ${summary.totalRevenue}`} />
          <StatCard icon={TrendingDown} label="总成本 (CNY)" value={`¥ ${summary.totalCost}`} sub={`佣金 ¥${summary.totalCommission} + 物流 ¥${summary.totalShipping}`} />
          <StatCard
            icon={TrendingUp}
            label="总利润 (CNY)"
            value={`¥ ${summary.totalProfit}`}
            highlight={Number(summary.totalProfit) > 0 ? 'green' : 'red'}
          />
          <StatCard icon={Percent} label="平均利润率" value={`${summary.avgMargin}%`} sub={`${summary.orderCount} 笔订单`} />
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">订单利润明细</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>订单号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead className="text-right">营收(CNY)</TableHead>
                <TableHead className="text-right">采购成本</TableHead>
                <TableHead className="text-right">佣金</TableHead>
                <TableHead className="text-right">物流</TableHead>
                <TableHead className="text-right">利润</TableHead>
                <TableHead className="text-right">利润率</TableHead>
                <TableHead>日期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-48 text-center text-muted-foreground">
                    暂无数据，请调整筛选条件后点击"计算"
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const profitNum = Number(r.profit);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.postingNumber || '-'}</TableCell>
                      <TableCell className="text-sm"><div>{r.shopName}</div><div className="text-[10px] text-muted-foreground">{shopPlatformLabel(r.platform)}</div></TableCell>
                      <TableCell className="text-right tabular-nums">{r.revenue}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.purchaseCost}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.commission}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.shipping}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${profitNum >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {r.profit}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={Number(r.margin) >= 20 ? 'success' : Number(r.margin) >= 0 ? 'warning' : 'destructive'}>
                          {r.margin}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, highlight }: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  highlight?: 'green' | 'red';
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className={`text-xl font-bold ${highlight === 'green' ? 'text-green-600' : highlight === 'red' ? 'text-red-600' : ''}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
