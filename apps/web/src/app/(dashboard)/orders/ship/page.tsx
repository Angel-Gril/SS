'use client';

import { useEffect, useState } from 'react';
import {
  Package, Truck, Printer, AlertTriangle, RefreshCw,
  Loader2, Search, Clock, Link2,
  ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate, formatCurrency, formatOrderAmount } from '@/lib/utils';
import { describeSubstatus } from '@/lib/ozon-substatus';

interface Order {
  id: string;
  shopId: string;
  platformOrderId: string;
  postingNumber: string | null;
  status: string;
  subStatus: string | null;
  totalAmount: string;
  totalAmountCny: string | null;
  currency: string;
  items: any[] | null;
  trackingNumber: string | null;
  domesticTrackingNumber: string | null;
  shippingMethod: string | null;
  inProcessAt: string | null;
  shipmentDate: string | null;
  deliveringDate: string | null;
  createdAt: string;
  shop: { name: string; platform: string };
}

interface Shop { id: string; name: string; platform: string; }
interface OrderStats { total: number; byStatus: Record<string, number>; }

interface CainiaoPackage {
  id: string;
  trackingNumber: string;
  carrier: string | null;
  carrierCode: string | null;
  status: string | null;
  statusDesc: string | null;
  updateTime: string | null;
  sender: string | null;
  receiver: string | null;
  boundToOrderId: string | null;
  syncedAt: string;
}

type PipelineStage = 'awaiting_packaging' | 'awaiting_deliver' | 'delivering' | 'cancelled';

const PIPELINE_STAGES = [
  { key: 'awaiting_packaging' as const, label: '待备货', icon: Clock, color: 'bg-orange-100 text-orange-600' },
  { key: 'awaiting_deliver' as const, label: '待发货', icon: Printer, color: 'bg-blue-100 text-blue-600' },
  { key: 'delivering' as const, label: '运输中', icon: Truck, color: 'bg-green-100 text-green-600' },
  { key: 'cancelled' as const, label: '异常/取消', icon: AlertTriangle, color: 'bg-red-100 text-red-600' },
];

export default function ShipOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [stage, setStage] = useState<PipelineStage>('awaiting_packaging');
  const [shopId, setShopId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const limit = 20;

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
    fetchStats();
  }, []);

  useEffect(() => { fetchOrders(); }, [stage, shopId, search, page]);

  async function fetchStats() {
    const res = await api.get<OrderStats>('/api/orders/stats');
    if (res.code === 1 && res.data) setStats(res.data);
  }

  async function fetchOrders() {
    setLoading(true);
    setSelected(new Set());
    const params = new URLSearchParams({
      status: stage,
      offset: String(page * limit),
      limit: String(limit),
    });
    if (shopId) params.set('shopId', shopId);
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: Order[] }>(`/api/orders?${params}`);
    if (res.code === 1 && res.data) { setOrders(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleSync() {
    if (shops.length === 0) return;
    setSyncing(true);
    for (const shop of shops) {
      await api.post('/api/orders/sync', { shopId: shop.id });
    }
    toast({ title: '同步任务已提交', description: `${shops.length} 个店铺正在同步订单` });
    setSyncing(false);
    setTimeout(() => { fetchOrders(); fetchStats(); }, 5000);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleAll() {
    if (selected.size === orders.length) setSelected(new Set());
    else setSelected(new Set(orders.map((o) => o.id)));
  }

  async function handleBatchShip() {
    if (selected.size === 0) return;
    setShipping(true);
    const res = await api.post<{ results: { orderId: string; success: boolean; msg: string }[] }>(
      '/api/orders/batch-ship', { orderIds: Array.from(selected) }
    );
    if (res.code === 1) {
      const ok = res.data?.results.filter((r) => r.success).length ?? 0;
      toast({ title: '批量发货完成', description: `${ok}/${selected.size} 单成功` });
      setSelected(new Set());
      fetchOrders();
      fetchStats();
    } else {
      toast({ title: '操作失败', description: res.msg, variant: 'destructive' });
    }
    setShipping(false);
  }

  async function handleSingleShip(orderId: string) {
    const res = await api.post(`/api/orders/${orderId}/ship`, {});
    if (res.code === 1) { toast({ title: '发货成功' }); fetchOrders(); fetchStats(); }
    else toast({ title: '发货失败', description: res.msg, variant: 'destructive' });
  }

  function getShipmentCountdown(shipmentDate: string | null): string {
    if (!shipmentDate) return '-';
    const diff = new Date(shipmentDate).getTime() - Date.now();
    if (diff <= 0) return '已超时';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    return `${days}天${hours}小时`;
  }

  const [bindOrderId, setBindOrderId] = useState<string | null>(null);
  const [bindTrackingNumber, setBindTrackingNumber] = useState('');
  const [bindCarrier, setBindCarrier] = useState('顺丰');
  const [bindPurchaseId, setBindPurchaseId] = useState('');
  const [bindPurchasePlatform, setBindPurchasePlatform] = useState('1688');
  const [bindSubmitting, setBindSubmitting] = useState(false);
  const [bindTab, setBindTab] = useState<'manual' | 'cainiao'>('manual');
  const [cainiaoPackages, setCainiaoPackages] = useState<CainiaoPackage[]>([]);
  const [loadingCainiao, setLoadingCainiao] = useState(false);

  const DOMESTIC_CARRIERS = ['顺丰', '圆通', '中通', '韵达', '极兔', '申通', '百世', 'EMS', '邮政', '其他'];

  async function loadCainiaoPackages() {
    setLoadingCainiao(true);
    const res = await api.get<CainiaoPackage[]>('/api/logistics/cainiao-packages?bound=false');
    if (res.code === 1 && res.data) setCainiaoPackages(res.data);
    setLoadingCainiao(false);
  }

  function selectCainiaoPackage(pkg: CainiaoPackage) {
    setBindTrackingNumber(pkg.trackingNumber);
    setBindCarrier(pkg.carrier || '其他');
    setBindTab('manual');
    toast({ title: `已选择包裹 ${pkg.trackingNumber}` });
  }

  async function bindCainiaoDirectly(pkg: CainiaoPackage) {
    if (!bindOrderId) return;
    setBindSubmitting(true);
    const res = await api.post(`/api/logistics/cainiao-packages/${pkg.id}/bind`, { orderId: bindOrderId });
    setBindSubmitting(false);
    if (res.code === 1) {
      toast({ title: '菜鸟包裹绑定成功' });
      setBindOrderId(null);
      setBindTrackingNumber('');
      setBindPurchaseId('');
      fetchOrders();
    } else {
      toast({ title: (res as any).msg || '绑定失败', variant: 'destructive' });
    }
  }

  async function handleBindDomestic() {
    if (!bindOrderId || !bindTrackingNumber) return;
    setBindSubmitting(true);
    const res = await api.put(`/api/orders/${bindOrderId}/domestic-tracking`, {
      domesticTrackingNumber: bindTrackingNumber,
      domesticCarrier: bindCarrier,
      purchaseOrderId: bindPurchaseId || undefined,
      purchasePlatform: bindPurchasePlatform || undefined,
    });
    setBindSubmitting(false);
    if (res.code === 1) {
      toast({ title: '国内物流绑定成功' });
      setBindOrderId(null);
      setBindTrackingNumber('');
      setBindPurchaseId('');
      fetchOrders();
    } else {
      toast({ title: '绑定失败', description: res.msg, variant: 'destructive' });
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">打包发货</h1>
          <p className="text-muted-foreground text-sm mt-1">订单处理流水线 — 同步、备货、打包、发货</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            同步订单
          </Button>
          {stage === 'awaiting_packaging' && (
            <Button onClick={handleBatchShip} disabled={shipping || selected.size === 0}>
              {shipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
              批量备货 ({selected.size})
            </Button>
          )}
          {stage === 'awaiting_deliver' && (
            <Button onClick={handleBatchShip} disabled={shipping || selected.size === 0}>
              {shipping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              批量发货 ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline stages */}
      <div className="grid grid-cols-4 gap-3">
        {PIPELINE_STAGES.map((s) => {
          const count = stats?.byStatus[s.key] ?? 0;
          const isActive = stage === s.key;
          return (
            <button
              key={s.key}
              onClick={() => { setStage(s.key); setPage(0); }}
              className={`relative p-4 rounded-lg border-2 transition-all text-left ${
                isActive ? 'border-primary bg-primary/5' : 'border-transparent bg-card hover:border-muted-foreground/20'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${s.color}`}>
                  <s.icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-2xl font-bold">{count}</p>
                </div>
              </div>
              {isActive && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-primary rounded-t" />}
            </button>
          );
        })}
      </div>

      {/* Filters + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={shopId}
              onChange={(e) => { setShopId(e.target.value); setPage(0); }}
            >
              <option value="">全部店铺</option>
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="包裹号/订单号/物流单号" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-56" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 单</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {(stage === 'awaiting_packaging' || stage === 'awaiting_deliver') && (
                  <TableHead className="w-10">
                    <input type="checkbox" checked={orders.length > 0 && selected.size === orders.length} onChange={toggleAll} className="rounded" />
                  </TableHead>
                )}
                <TableHead>包裹号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>商品信息</TableHead>
                <TableHead>金额</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>物流</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : orders.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">当前阶段暂无订单</TableCell></TableRow>
              ) : orders.map((order) => {
                const isExpanded = expandedRows.has(order.id);
                const items = Array.isArray(order.items) ? order.items : [];
                const colSpan = (stage === 'awaiting_packaging' || stage === 'awaiting_deliver') ? 8 : 7;
                const totalWeight = items.reduce((sum, it: any) => sum + (Number(it.weight ?? it.weight_g ?? 0) * (Number(it.quantity) || 1)), 0);
                return (
                <>
                <TableRow key={order.id} className={isExpanded ? 'bg-muted/30' : ''}>
                  {(stage === 'awaiting_packaging' || stage === 'awaiting_deliver') && (
                    <TableCell><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} className="rounded" /></TableCell>
                  )}
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleExpand(order.id)}
                      className="flex items-center gap-1 hover:text-primary transition-colors group"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span className="font-mono text-xs font-medium group-hover:underline">{order.postingNumber || order.platformOrderId}</span>
                    </button>
                    <div className="text-xs text-muted-foreground mt-0.5 ml-4">
                      {stage === 'awaiting_packaging' ? '待备货' : stage === 'awaiting_deliver' ? '待发货' : stage === 'delivering' ? '运输中' : '已取消'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{order.shop.name}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[220px]">
                      {Array.isArray(order.items) && order.items.length > 0 ? (
                        <div className="flex items-center gap-2">
                          {(() => {
                            const img = order.items[0]?.primary_image || order.items[0]?.image;
                            return img ? (
                              <img src={img} alt="" className="w-9 h-9 rounded border object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : null;
                          })()}
                          <div className="min-w-0 text-xs">
                            <span className="font-medium line-clamp-1">{order.items[0]?.name?.slice(0, 30) || order.items[0]?.offer_id}</span>
                            {order.items.length > 1 && <span className="text-muted-foreground"> +{order.items.length - 1}件</span>}
                          </div>
                        </div>
                      ) : '-'}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{(() => {
                    const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                    return (
                      <span title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                        {f.display}
                        {order.currency !== 'CNY' ? <span className="ml-1 text-xs text-muted-foreground font-normal">({f.isApprox ? '≈ ' : ''}{f.original})</span> : null}
                      </span>
                    );
                  })()}</TableCell>
                  <TableCell>
                    <div className="text-xs space-y-0.5">
                      <div>下单: {formatDate(order.createdAt)}</div>
                      {order.shipmentDate && (
                        <div className={`font-medium ${getShipmentCountdown(order.shipmentDate) === '已超时' ? 'text-red-500' : 'text-orange-500'}`}>
                          剩余: {getShipmentCountdown(order.shipmentDate)}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs space-y-1">
                      {(() => {
                        const meta = describeSubstatus(order.subStatus);
                        const showStatus = order.subStatus && meta.phase !== 'unknown';
                        const latestTime = order.deliveringDate || order.shipmentDate || order.inProcessAt;
                        const formattedTime = latestTime ? new Date(latestTime).toLocaleString('zh-CN', {
                          year: '2-digit',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        }).replace(/\//g, '.') : null;

                        const hasDomesticTracking = !!order.domesticTrackingNumber;
                        const hasInternationalTracking = !!order.trackingNumber;

                        return (
                          <>
                            {showStatus && (
                              <div>
                                <div className="font-medium">{meta.text}</div>
                                {formattedTime && (
                                  <div className="text-muted-foreground">{formattedTime}</div>
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                              {hasDomesticTracking && (
                                <a
                                  href={`https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(order.domesticTrackingNumber!)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                                  title="在菜鸟国际查询国内物流"
                                >
                                  菜鸟国际
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                              {hasInternationalTracking && (
                                <>
                                  <a
                                    href={`https://tracking.ozon.ru/?track=${encodeURIComponent(order.trackingNumber!)}&local=zh-Hans`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                                    title="在 OZON 查询国际物流"
                                  >
                                    OZON Track
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                  <a
                                    href={`https://t.17track.net/zh-cn#nums=${encodeURIComponent(order.trackingNumber!)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                                    title="在 17TRACK 查询国际物流"
                                  >
                                    17TRACK
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                </>
                              )}
                            </div>
                            {!showStatus && !hasDomesticTracking && !hasInternationalTracking && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      {stage === 'awaiting_packaging' && (
                        <Button size="sm" variant="outline" onClick={() => handleSingleShip(order.id)}>
                          <Package className="h-3.5 w-3.5 mr-1" /> 备货
                        </Button>
                      )}
                      {stage === 'awaiting_deliver' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setBindOrderId(order.id); setBindTrackingNumber(''); setBindPurchaseId(''); }}>
                            <Link2 className="h-3.5 w-3.5 mr-1" /> 绑定物流
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleSingleShip(order.id)}>
                            <Truck className="h-3.5 w-3.5 mr-1" /> 发货
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${order.id}-detail`} className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={colSpan} className="py-3">
                      <div className="px-6 space-y-3">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>订单号: <span className="font-mono text-foreground">{order.platformOrderId}</span></span>
                          {totalWeight > 0 && <span>合计重量: <span className="text-foreground">{totalWeight}g</span></span>}
                          <span>SKU 数量: <span className="text-foreground">{items.length}</span></span>
                        </div>
                        {items.length > 0 ? (
                          <div className="rounded-md border bg-background overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/40">
                                <tr className="text-left">
                                  <th className="p-2 font-medium w-14">图片</th>
                                  <th className="p-2 font-medium">商品名称</th>
                                  <th className="p-2 font-medium w-32">offer_id / SKU</th>
                                  <th className="p-2 font-medium w-20 text-right">数量</th>
                                  <th className="p-2 font-medium w-24 text-right">单价</th>
                                  <th className="p-2 font-medium w-28 text-right">小计</th>
                                  <th className="p-2 font-medium w-12"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((it: any, idx: number) => {
                                  const img = it.primary_image || it.image;
                                  const qty = Number(it.quantity) || 1;
                                  const price = Number(it.price) || 0;
                                  const sourceUrl = it.sku ? `https://www.ozon.ru/product/${it.sku}` : null;
                                  return (
                                    <tr key={idx} className="border-t">
                                      <td className="p-2">
                                        {img ? (
                                          <img src={img} alt="" className="w-10 h-10 rounded border object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        ) : <div className="w-10 h-10 rounded border bg-muted" />}
                                      </td>
                                      <td className="p-2">
                                        <div className="font-medium">{it.name || it.name_ru || it.title || '-'}</div>
                                        {it.name_zh && <div className="text-muted-foreground text-[11px] mt-0.5">中: {it.name_zh}</div>}
                                      </td>
                                      <td className="p-2 font-mono text-[11px] text-muted-foreground">
                                        <div>{it.offer_id || '-'}</div>
                                        {it.sku && <div>SKU {it.sku}</div>}
                                      </td>
                                      <td className="p-2 text-right">{qty}</td>
                                      <td className="p-2 text-right">{formatCurrency(String(price), order.currency)}</td>
                                      <td className="p-2 text-right font-medium">{formatCurrency(String(price * qty), order.currency)}</td>
                                      <td className="p-2 text-center">
                                        {sourceUrl && (
                                          <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center text-muted-foreground hover:text-primary" title="查看 Ozon 商品页">
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground py-2">该订单无商品明细</div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </>
                );
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 绑定国内物流弹窗 */}
      <Dialog open={!!bindOrderId} onOpenChange={(o) => { if (!o) setBindOrderId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>绑定国内物流单号</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Tab 切换 */}
            <div className="flex border-b">
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${bindTab === 'manual' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => setBindTab('manual')}
              >
                手动填写
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 ${bindTab === 'cainiao' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setBindTab('cainiao'); if (cainiaoPackages.length === 0) loadCainiaoPackages(); }}
              >
                <Package className="h-3.5 w-3.5" />
                从菜鸟选择
              </button>
            </div>

            {bindTab === 'manual' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">快递公司 *</Label>
                  <select value={bindCarrier} onChange={(e) => setBindCarrier(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {DOMESTIC_CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">快递单号 *</Label>
                  <Input value={bindTrackingNumber} onChange={(e) => setBindTrackingNumber(e.target.value)} placeholder="输入国内快递单号" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">采购单号（可选）</Label>
                  <Input value={bindPurchaseId} onChange={(e) => setBindPurchaseId(e.target.value)} placeholder="1688/淘宝/拼多多订单号" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">采购平台</Label>
                  <select value={bindPurchasePlatform} onChange={(e) => setBindPurchasePlatform(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="1688">1688</option>
                    <option value="taobao">淘宝</option>
                    <option value="pinduoduo">拼多多</option>
                    <option value="other">其他</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {loadingCainiao ? (
                  <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : cainiaoPackages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    暂无未绑定的菜鸟包裹
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={loadCainiaoPackages}>刷新</Button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-1">
                    {cainiaoPackages.map((pkg) => (
                      <div key={pkg.id} className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50 transition-colors">
                        <div className="space-y-0.5">
                          <div className="text-xs font-mono font-medium">{pkg.trackingNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {pkg.carrier || '未知快递'} {pkg.statusDesc ? `· ${pkg.statusDesc}` : ''} {pkg.updateTime ? `· ${pkg.updateTime}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => selectCainiaoPackage(pkg)}>
                            填入
                          </Button>
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => bindCainiaoDirectly(pkg)} disabled={bindSubmitting}>
                            绑定
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindOrderId(null)}>取消</Button>
            {bindTab === 'manual' && (
              <Button onClick={handleBindDomestic} disabled={bindSubmitting || !bindTrackingNumber}>
                {bindSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                确认绑定
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
