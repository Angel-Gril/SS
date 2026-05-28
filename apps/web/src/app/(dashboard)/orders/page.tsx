'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2, Package, Truck, CheckCircle, XCircle, Clock, Send, Ban, FileDown, Printer, Tag, AlertTriangle, Warehouse, Eye, Plane, ShoppingCart, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate, formatCurrency, formatOrderAmount, convertToCny } from '@/lib/utils';
import { TRACK_PROVIDERS } from '@/lib/tracking';
import { describeSubstatus, PHASE_COLORS } from '@/lib/ozon-substatus';

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
  shippingMethod: string | null;
  inProcessAt: string | null;
  shipmentDate: string | null;
  deliveringDate: string | null;
  createdAt: string;
  domesticTrackingNumber: string | null;
  domesticCarrier: string | null;
  domesticStatus: string | null;
  internationalTrackingNumber: string | null;
  internationalCarrier: string | null;
  internationalStatus: string | null;
  purchaseOrderId: string | null;
  purchasePlatform: string | null;
  serviceTags: string[] | null;
  serviceFee: number | null;
  inspectionStatus: string | null;
  shop: { name: string; platform: string };
}

interface ServiceTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  fee: string;
  needInspection: boolean;
}

interface PipelineStage {
  key: string;
  label: string;
  count: number;
}

interface OrderStats {
  total: number;
  byStatus: Record<string, number>;
  todayOrders: number;
  todayRevenue: string;
}

interface Shop {
  id: string;
  name: string;
  platform: string;
}

const STATUS_TABS = [
  { key: '', label: '全部', icon: Package },
  { key: 'awaiting_packaging', label: '待打包', icon: Clock },
  { key: 'awaiting_deliver', label: '待发货', icon: Package },
  { key: 'delivering', label: '配送中', icon: Truck },
  { key: 'delivered', label: '已送达', icon: CheckCircle },
  { key: 'cancelled', label: '已取消', icon: XCircle },
];

const PIPELINE_ICONS: Record<string, any> = {
  purchased: ShoppingCart,
  domestic_transit: Truck,
  received: Warehouse,
  inspecting: Eye,
  awaiting_label: Printer,
  delivering: Plane,
  abnormal: AlertTriangle,
};

function ProductImagePreview({ items }: { items: any[] }) {
  const [hover, setHover] = useState(false);
  if (!items || items.length === 0) return <span className="text-muted-foreground">-</span>;

  const firstItem = items[0];
  const imageUrl = firstItem?.image || firstItem?.primary_image || firstItem?.picture || firstItem?.images?.[0];

  return (
    <div className="flex items-center gap-2">
      {imageUrl ? (
        <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <img src={imageUrl} alt="" className="w-10 h-10 rounded border object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {hover && (
            <div className="absolute z-50 left-12 top-0 p-1 bg-background border rounded-lg shadow-xl">
              <img src={imageUrl} alt="" className="w-[180px] h-[180px] rounded object-contain" />
              <div className="text-xs text-muted-foreground mt-1 px-1 truncate max-w-[180px]">{firstItem?.name}</div>
            </div>
          )}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        {items.slice(0, 2).map((item: any, i: number) => (
          <div key={i} className="text-xs truncate">{item.name} x{item.quantity}</div>
        ))}
        {items.length > 2 && <div className="text-xs text-muted-foreground">+{items.length - 2} 件</div>}
      </div>
    </div>
  );
}

const PROGRESS_STEPS = [
  { key: 'created', label: '已创建' },
  { key: 'in_process', label: '处理中' },
  { key: 'packed', label: '已打包' },
  { key: 'shipped', label: '已发货' },
  { key: 'delivering', label: '运输中' },
  { key: 'delivered', label: '已送达' },
];

function getProgressStep(order: any): number {
  if (order.status === 'cancelled') return -1;
  if (order.deliveredAt || order.status === 'delivered') return 5;
  if (order.deliveringDate || order.status === 'delivering') return 4;
  if (order.shipmentDate || order.status === 'awaiting_deliver') return 3;
  if (order.status === 'awaiting_packaging') return 2;
  if (order.inProcessAt) return 1;
  return 0;
}

function OrderProgressBar({ order }: { order: any }) {
  const currentStep = getProgressStep(order);
  if (currentStep === -1) {
    return (
      <div className="flex items-center gap-2 py-2 px-3 bg-red-50 dark:bg-red-950/30 rounded-md">
        <XCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive font-medium">订单已取消</span>
      </div>
    );
  }

  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        {PROGRESS_STEPS.map((step, idx) => (
          <div key={step.key} className="flex items-center flex-1 last:flex-initial">
            <div className="flex flex-col items-center gap-1">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full border-2 text-xs font-bold transition-all ${
                idx <= currentStep
                  ? idx === currentStep
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-emerald-500 bg-emerald-500 text-white'
                  : 'border-muted-foreground/30 bg-background text-muted-foreground'
              }`}>
                {idx < currentStep ? '✓' : idx + 1}
              </div>
              <span className={`text-[10px] whitespace-nowrap ${
                idx <= currentStep
                  ? idx === currentStep ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground'
              }`}>{step.label}</span>
            </div>
            {idx < PROGRESS_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1.5 rounded-full ${idx < currentStep ? 'bg-emerald-500' : 'bg-muted'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [pipelineActive, setPipelineActive] = useState<string | null>(null);
  const [serviceTags, setServiceTags] = useState<ServiceTag[]>([]);
  const [tagDialogOrder, setTagDialogOrder] = useState<Order | null>(null);
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const [status, setStatus] = useState('');
  const [shopId, setShopId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'posting' | 'tracking' | 'sku' | 'product' | 'purchase'>('all');
  const [serviceTagId, setServiceTagId] = useState('');
  const [shipmentUrgency, setShipmentUrgency] = useState<'' | 'overdue' | 'today' | 'tomorrow' | 'within3d'>('');
  const [hasTracking, setHasTracking] = useState<'' | 'yes' | 'no'>('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(0);
  const [shipOrder, setShipOrder] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [labelOrder, setLabelOrder] = useState<Order | null>(null);
  const limit = 20;

  const loadPipeline = useCallback(async () => {
    const res = await api.get<{ stages: PipelineStage[] }>('/api/orders/pipeline');
    if (res.code === 1 && res.data) setPipeline(res.data.stages);
  }, []);

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
    api.get<OrderStats>('/api/orders/stats').then((res) => {
      if (res.code === 1 && res.data) setStats(res.data);
    });
    loadPipeline();
    api.get<ServiceTag[]>('/api/orders/service-tags').then((res) => {
      if (res.code === 1 && res.data) setServiceTags(res.data);
    });
  }, [loadPipeline]);

  async function loadOrders() {
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(page * limit),
      limit: String(limit),
    });
    if (status) params.set('status', status);
    if (shopId) params.set('shopId', shopId);
    if (search) params.set('search', search);
    if (search && searchField !== 'all') params.set('searchField', searchField);
    if (serviceTagId) params.set('serviceTagId', serviceTagId);
    if (shipmentUrgency) params.set('shipmentUrgency', shipmentUrgency);
    if (hasTracking) params.set('hasTracking', hasTracking);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const res = await api.get<{ total: number; rows: Order[] }>(`/api/orders?${params}`);
    if (res.code === 1 && res.data) {
      setOrders(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, [status, shopId, search, searchField, serviceTagId, shipmentUrgency, hasTracking, page, startDate, endDate]);

  async function handleSync(fullSync = false) {
    if (!shopId && shops.length === 0) {
      toast({ title: '请先添加店铺', variant: 'destructive' });
      return;
    }
    const targetShopId = shopId || shops[0]?.id;
    if (!targetShopId) return;

    setSyncing(true);
    const body: Record<string, string> = { shopId: targetShopId };
    if (fullSync) {
      body.since = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    }
    const res = await api.post<{ created: number; updated: number; total: number }>('/api/orders/sync', body);
    setSyncing(false);

    if (res.code === 1) {
      toast({
        title: '同步完成',
        description: res.msg,
      });
      // 刷新数据
      loadOrders();
      loadPipeline();
      api.get<OrderStats>('/api/orders/stats').then((r) => {
        if (r.code === 1 && r.data) setStats(r.data);
      });
    } else {
      toast({
        title: '同步失败',
        description: res.msg,
        variant: 'destructive',
      });
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  }

  function handlePipelineClick(stageKey: string) {
    if (pipelineActive === stageKey) {
      setPipelineActive(null);
      setStatus('');
    } else {
      setPipelineActive(stageKey);
      // 映射 pipeline stage 到 status 筛选
      const stageStatusMap: Record<string, string> = {
        purchased: '',
        domestic_transit: '',
        received: '',
        inspecting: '',
        awaiting_label: 'awaiting_deliver',
        delivering: 'delivering',
        abnormal: 'cancelled',
      };
      const mappedStatus = stageStatusMap[stageKey] ?? '';
      setStatus(mappedStatus);
    }
    setPage(0);
  }

  function toggleOrderSelection(orderId: string) {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleAllOrders() {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map((o) => o.id)));
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">订单管理</h1>
          <p className="text-muted-foreground mt-1">查看和处理所有平台订单</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => handleSync(false)} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? '同步中...' : '同步订单'}
          </Button>
          <Button variant="outline" onClick={() => handleSync(true)} disabled={syncing} title="拉取最近一年所有订单">
            全量同步
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams();
              if (shopId) params.set('shopId', shopId);
              if (startDate) params.set('startDate', startDate);
              if (endDate) params.set('endDate', endDate);
              api.download(`/api/export/orders?${params}`, `orders_${new Date().toISOString().slice(0, 10)}.csv`);
            }}
          >
            <FileDown className="h-4 w-4" /> 导出
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <StatMini label="总订单" value={String(stats.total)} />
          <StatMini label="待打包" value={String(stats.byStatus['awaiting_packaging'] || 0)} highlight />
          <StatMini label="今日订单" value={String(stats.todayOrders)} />
          <StatMini label="今日销售额" value={formatCurrency(convertToCny(stats.todayRevenue, 'RUB'), 'CNY')} />
        </div>
      )}

      {/* 打包发货流程进度条 */}
      {pipeline.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between overflow-x-auto">
              {pipeline.map((stage, idx) => {
                const Icon = PIPELINE_ICONS[stage.key] || Package;
                const isActive = pipelineActive === stage.key;
                return (
                  <div key={stage.key} className="flex items-center flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => handlePipelineClick(stage.key)}
                      className={`flex flex-col items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer min-w-[72px] ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className={`relative flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors ${
                        isActive
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-muted-foreground/30 bg-background text-muted-foreground'
                      }`}>
                        <Icon className="h-4 w-4" />
                        {stage.count > 0 && (
                          <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1 ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : stage.key === 'abnormal'
                                ? 'bg-red-500 text-white'
                                : 'bg-orange-500 text-white'
                          }`}>
                            {stage.count > 99 ? '99+' : stage.count}
                          </span>
                        )}
                      </div>
                      <span className={`text-xs whitespace-nowrap ${
                        isActive ? 'text-blue-600 font-medium dark:text-blue-400' : 'text-muted-foreground'
                      }`}>
                        {stage.label}
                      </span>
                    </button>
                    {idx < pipeline.length - 1 && (
                      <div className="flex-1 h-px bg-border mx-1 min-w-[12px]" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_TABS.map((tab) => (
              <Button
                key={tab.key}
                size="sm"
                variant={status === tab.key && !pipelineActive ? 'default' : 'outline'}
                onClick={() => { setStatus(tab.key); setPipelineActive(null); setPage(0); }}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {stats && tab.key && stats.byStatus[tab.key] ? (
                  <span className="ml-1 text-xs opacity-70">({stats.byStatus[tab.key]})</span>
                ) : null}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={shopId}
              onChange={(e) => { setShopId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部店铺</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>
              ))}
            </select>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
              className="h-9 w-36"
              title="开始日期"
            />
            <span className="text-muted-foreground text-sm">至</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
              className="h-9 w-36"
              title="结束日期"
            />

            <form onSubmit={handleSearch} className="flex items-center gap-1 flex-1 max-w-md">
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as any)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                title="搜索范围"
              >
                <option value="all">全字段</option>
                <option value="posting">订单号</option>
                <option value="tracking">物流单号</option>
                <option value="sku">SKU</option>
                <option value="product">产品名</option>
                <option value="purchase">采购单号</option>
              </select>
              <Input
                placeholder={
                  searchField === 'sku' ? '输入 SKU' :
                  searchField === 'product' ? '输入产品名关键词' :
                  searchField === 'tracking' ? '输入物流单号' :
                  searchField === 'purchase' ? '输入采购单号' :
                  searchField === 'posting' ? '输入订单号' :
                  '搜索订单号 / 物流单号 / SKU / 产品 / 采购单号'
                }
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9"
              />
              <Button type="submit" size="sm" variant="outline">搜索</Button>
            </form>

            <select
              value={serviceTagId}
              onChange={(e) => { setServiceTagId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="按服务标签筛选"
            >
              <option value="">全部标签</option>
              {serviceTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <select
              value={shipmentUrgency}
              onChange={(e) => { setShipmentUrgency(e.target.value as any); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="发货截止"
            >
              <option value="">发货截止</option>
              <option value="overdue">已超时</option>
              <option value="today">今日截止</option>
              <option value="tomorrow">明日截止</option>
              <option value="within3d">3 日内</option>
            </select>

            <select
              value={hasTracking}
              onChange={(e) => { setHasTracking(e.target.value as any); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="物流单号"
            >
              <option value="">物流单号</option>
              <option value="yes">已有单号</option>
              <option value="no">未填单号</option>
            </select>

            <span className="ml-auto text-sm text-muted-foreground">共 {total} 条</span>
          </div>

          {/* 批量操作栏 */}
          {selectedOrders.size > 0 && (
            <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-md">
              <span className="text-sm text-muted-foreground">已选 {selectedOrders.size} 项</span>
              <Button size="sm" variant="outline" onClick={() => setBatchTagDialogOpen(true)}>
                <Tag className="h-3.5 w-3.5" />
                批量打标签
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedOrders(new Set())}>
                取消选择
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && orders.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              暂无订单数据。请先同步订单。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedOrders.size === orders.length && orders.length > 0}
                      onChange={toggleAllOrders}
                      className="rounded border-input"
                    />
                  </TableHead>
                  <TableHead>订单号</TableHead>
                  <TableHead>店铺</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>标签</TableHead>
                  <TableHead>物流</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const canShip = order.status === 'awaiting_packaging' || order.status === 'awaiting_deliver';
                  const canCancel = order.status !== 'delivered' && order.status !== 'cancelled';
                  const orderTags = order.serviceTags || [];
                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedOrders.has(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          className="rounded border-input"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <button
                          type="button"
                          className="text-left hover:text-primary hover:underline"
                          onClick={() => setDetailOrderId(order.id)}
                        >
                          {order.postingNumber || order.platformOrderId}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge variant="outline">{order.shop.platform}</Badge>
                        <span className="ml-1.5">{order.shop.name}</span>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {order.items && Array.isArray(order.items) ? (
                          <ProductImagePreview items={order.items as any[]} />
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {(() => {
                          const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                          return (
                            <div title={f.isApprox ? `原币 ${f.original}（估算汇率）` : `原币 ${f.original}`}>
                              <div>{f.display}</div>
                              {order.currency !== 'CNY' ? (
                                <div className="text-xs text-muted-foreground font-normal">
                                  {f.isApprox ? '≈ ' : ''}{f.original}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <OrderStatusBadge status={order.status} />
                          <ShipmentCountdownMini shipmentDate={order.shipmentDate} status={order.status} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {orderTags.length > 0 ? (
                            orderTags.map((tagId) => {
                              const tag = serviceTags.find((t) => t.id === tagId);
                              if (!tag) return null;
                              return (
                                <span
                                  key={tagId}
                                  className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                                  {tag.name}
                                </span>
                              );
                            })
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setTagDialogOrder(order)}
                            className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            title="打标签"
                          >
                            <Tag className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {(() => {
                          const meta = describeSubstatus(order.subStatus);
                          const showStatus = order.subStatus && meta.phase !== 'unknown';
                          // 获取最新的物流时间
                          const latestTime = order.deliveringDate || order.shipmentDate || order.inProcessAt;
                          const formattedTime = latestTime ? new Date(latestTime).toLocaleString('zh-CN', {
                            year: '2-digit',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          }).replace(/\//g, '.') : null;

                          // 判断显示哪些跟踪链接
                          const hasDomesticTracking = !!order.domesticTrackingNumber;
                          const hasInternationalTracking = !!order.trackingNumber;

                          return (
                            <div className="space-y-1">
                              {showStatus && (
                                <div className="text-xs">
                                  <div className="font-medium">{meta.text}</div>
                                  {formattedTime && (
                                    <div className="text-muted-foreground">{formattedTime}</div>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                {/* 国内物流：显示菜鸟国际 */}
                                {hasDomesticTracking && (
                                  <a
                                    href={`https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(order.domesticTrackingNumber!)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors normal-case"
                                    title="在菜鸟国际查询国内物流"
                                  >
                                    菜鸟国际
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                                {/* 国际物流：显示 OZON Track 和 17TRACK */}
                                {hasInternationalTracking && (
                                  <>
                                    <a
                                      href={`https://tracking.ozon.ru/?track=${encodeURIComponent(order.trackingNumber!)}&local=zh-Hans`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors normal-case"
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
                                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border bg-background hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors normal-case"
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
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(order.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={!canShip}
                            title={canShip ? '发货' : '当前状态不可发货'}
                            onClick={() => setShipOrder(order)}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={!order.postingNumber || order.shop.platform !== 'OZON'}
                            title="面单预览/打印"
                            onClick={() => setLabelOrder(order)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={!canCancel}
                            title={canCancel ? '取消订单' : '当前状态不可取消'}
                            onClick={() => setCancelOrder(order)}
                          >
                            <Ban className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">
                第 {page + 1} / {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                  上一页
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ShipOrderDialog
        order={shipOrder}
        onClose={() => setShipOrder(null)}
        onSuccess={() => { setShipOrder(null); loadOrders(); }}
      />
      <CancelOrderDialog
        order={cancelOrder}
        onClose={() => setCancelOrder(null)}
        onSuccess={() => { setCancelOrder(null); loadOrders(); }}
      />
      <OrderDetailDialog
        orderId={detailOrderId}
        onClose={() => setDetailOrderId(null)}
      />
      <LabelPreviewDialog
        order={labelOrder}
        onClose={() => setLabelOrder(null)}
      />
      <ServiceTagDialog
        order={tagDialogOrder}
        tags={serviceTags}
        onClose={() => setTagDialogOrder(null)}
        onSuccess={() => { setTagDialogOrder(null); loadOrders(); }}
      />
      <BatchServiceTagDialog
        open={batchTagDialogOpen}
        orderIds={Array.from(selectedOrders)}
        tags={serviceTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onSuccess={() => { setBatchTagDialogOpen(false); setSelectedOrders(new Set()); loadOrders(); }}
      />
    </div>
  );
}

function ShipmentCountdown({ shipmentDate, status }: { shipmentDate: string | null; status: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!shipmentDate) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [shipmentDate]);

  if (!shipmentDate) return null;
  const needsShip = status === 'awaiting_packaging' || status === 'awaiting_deliver';
  if (!needsShip) return null;

  const deadline = new Date(shipmentDate).getTime();
  const diff = deadline - now;
  if (diff <= 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <span className="text-sm font-medium text-red-700 dark:text-red-300">已超时！请立即发货</span>
      </div>
    );
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const isUrgent = diff < 24 * 60 * 60 * 1000;
  const bgClass = isUrgent
    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
    : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800';
  const textClass = isUrgent
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-blue-700 dark:text-blue-300';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${bgClass}`}>
      <Clock className="h-4 w-4 shrink-0" />
      <span className={`text-sm font-medium ${textClass}`}>
        发货剩余 {days > 0 ? `${days}天` : ''}{hours}小时{minutes}分钟
      </span>
      <span className="text-xs text-muted-foreground ml-auto">
        截止 {new Date(shipmentDate).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function ShipmentCountdownMini({ shipmentDate, status }: { shipmentDate: string | null; status: string }) {
  if (!shipmentDate) return null;
  const needsShip = status === 'awaiting_packaging' || status === 'awaiting_deliver';
  if (!needsShip) return null;

  const diff = new Date(shipmentDate).getTime() - Date.now();
  if (diff <= 0) {
    return <span className="text-[10px] text-red-600 font-medium">已超时</span>;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const isUrgent = diff < 24 * 60 * 60 * 1000;
  const text = days > 0 ? `剩${days}天${hours}时` : `剩${hours}小时`;
  return <span className={`text-[10px] font-medium ${isUrgent ? 'text-amber-600' : 'text-muted-foreground'}`}>{text}</span>;
}

function OrderDetailDialog({ orderId, onClose }: {
  orderId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId) { setDetail(null); return; }
    setLoading(true);
    api.get(`/api/orders/${orderId}`).then((res: any) => {
      if (res.code === 1 && res.data) setDetail(res.data);
      setLoading(false);
    });
  }, [orderId]);

  const items: any[] = detail?.items || [];
  const buyer = detail?.buyerInfo as any;
  const shipping = detail?.shippingInfo as any;

  return (
    <Dialog open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>订单详情</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">订单号：</span>
                <span className="font-mono">{detail.postingNumber || detail.platformOrderId}</span>
              </div>
              <div>
                <span className="text-muted-foreground">状态：</span>
                <OrderStatusBadge status={detail.status} />
                {detail.subStatus && <span className="ml-2 text-xs text-muted-foreground">({detail.subStatus})</span>}
              </div>
              <div>
                <span className="text-muted-foreground">店铺：</span>
                <Badge variant="outline">{detail.shop?.platform}</Badge>
                <span className="ml-1.5">{detail.shop?.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">金额：</span>
                {(() => {
                  const f = formatOrderAmount(detail.totalAmount, detail.currency, detail.totalAmountCny);
                  return (
                    <span className="font-medium" title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                      {f.display}
                      {detail.currency !== 'CNY' ? (
                        <span className="ml-1 text-xs text-muted-foreground font-normal">
                          ({f.isApprox ? '≈ ' : ''}{f.original})
                        </span>
                      ) : null}
                    </span>
                  );
                })()}
              </div>
              <div>
                <span className="text-muted-foreground">物流单号：</span>
                <span className="font-mono">{detail.trackingNumber || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">物流方式：</span>
                <span>{detail.shippingMethod || '-'}</span>
              </div>
            </div>

            {/* 发货倒计时 */}
            <ShipmentCountdown shipmentDate={detail.shipmentDate} status={detail.status} />

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">发货流程</div>
              <div className="px-4 py-2">
                <OrderProgressBar order={detail} />
              </div>
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">物流追踪</div>
              <TrackingTimeline orderId={detail.id} postingNumber={detail.postingNumber} trackingNumber={detail.trackingNumber} />
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">时间线</div>
              <div className="p-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">创建：</span>{formatDate(detail.createdAt)}</div>
                <div><span className="text-muted-foreground">受理：</span>{detail.inProcessAt ? formatDate(detail.inProcessAt) : '-'}</div>
                <div><span className="text-muted-foreground">发货：</span>{detail.shipmentDate ? formatDate(detail.shipmentDate) : '-'}</div>
                <div><span className="text-muted-foreground">配送：</span>{detail.deliveringDate ? formatDate(detail.deliveringDate) : '-'}</div>
                <div><span className="text-muted-foreground">送达：</span>{detail.deliveredAt ? formatDate(detail.deliveredAt) : '-'}</div>
                <div><span className="text-muted-foreground">更新：</span>{detail.updatedAt ? formatDate(detail.updatedAt) : '-'}</div>
              </div>
            </div>

            {(detail.domesticTrackingNumber || detail.internationalTrackingNumber || detail.purchaseOrderId) && (
              <div className="border rounded-md">
                <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">物流绑定</div>
                <div className="p-3 grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">国内快递：</span>{detail.domesticCarrier ? `${detail.domesticCarrier} ${detail.domesticTrackingNumber}` : '-'}</div>
                  <div><span className="text-muted-foreground">国内状态：</span>{detail.domesticStatus === 'shipped' ? '已发出' : detail.domesticStatus === 'received' ? '已签收' : '待发货'}</div>
                  <div><span className="text-muted-foreground">国际物流：</span>{detail.internationalCarrier ? `${detail.internationalCarrier} ${detail.internationalTrackingNumber}` : '-'}</div>
                  <div><span className="text-muted-foreground">国际状态：</span>{detail.internationalStatus === 'shipped' ? '运输中' : detail.internationalStatus === 'delivered' ? '已送达' : '待发出'}</div>
                  {detail.purchaseOrderId && <div><span className="text-muted-foreground">采购单号：</span>{detail.purchaseOrderId}</div>}
                  {detail.purchasePlatform && <div><span className="text-muted-foreground">采购平台：</span>{detail.purchasePlatform}</div>}
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="border rounded-md">
                <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40">商品明细 ({items.length})</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>商品名</TableHead>
                      <TableHead>SKU / Offer</TableHead>
                      <TableHead className="text-right">数量</TableHead>
                      <TableHead className="text-right">单价</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm max-w-md truncate">{it.name || '-'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>{it.sku || '-'}</div>
                          {it.offer_id && <div className="text-muted-foreground">{it.offer_id}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{it.quantity ?? 1}</TableCell>
                        <TableCell className="text-right tabular-nums">{it.price ? `${it.price} ${detail.currency}` : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {(buyer || shipping) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {buyer && (
                  <div className="border rounded-md p-3 text-sm space-y-1.5">
                    <div className="text-xs font-medium mb-1">买家信息</div>
                    <div className="text-xs"><span className="text-muted-foreground">姓名：</span><span>{buyer.name || '匿名买家'}</span></div>
                    {buyer.phone && (
                      <div className="text-xs"><span className="text-muted-foreground">电话：</span><span className="font-mono">{buyer.phone}</span></div>
                    )}
                    <div className="text-[10px] text-muted-foreground pt-1 border-t mt-1.5">OZON 出于隐私保护，可能仅返回首字母或脱敏号码</div>
                  </div>
                )}
                {shipping && (
                  <div className="border rounded-md p-3 text-sm space-y-1.5">
                    <div className="text-xs font-medium mb-1">收货信息</div>
                    {(shipping.region || shipping.city || shipping.district) && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">地区：</span>
                        <span>{[shipping.region, shipping.city, shipping.district].filter(Boolean).join(' / ')}</span>
                      </div>
                    )}
                    {shipping.address_tail && (
                      <div className="text-xs"><span className="text-muted-foreground">详细：</span><span>{shipping.address_tail}</span></div>
                    )}
                    {shipping.zip_code && (
                      <div className="text-xs"><span className="text-muted-foreground">邮编：</span><span className="font-mono">{shipping.zip_code}</span></div>
                    )}
                    {shipping.deliveryMethod && (
                      <div className="text-xs"><span className="text-muted-foreground">配送：</span><span>{shipping.deliveryMethod}</span></div>
                    )}
                    {shipping.warehouse && (
                      <div className="text-xs"><span className="text-muted-foreground">仓库：</span><span>{shipping.warehouse}</span></div>
                    )}
                    {shipping.tplProvider && (
                      <div className="text-xs"><span className="text-muted-foreground">承运商：</span><span>{shipping.tplProvider}</span></div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LabelPreviewDialog({ order, onClose }: {
  order: Order | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState('label.pdf');

  useEffect(() => {
    if (!order) { setPdfUrl(null); setError(null); return; }
    setLoading(true);
    setError(null);
    api.get(`/api/orders/${order.id}/label?format=base64`).then((res: any) => {
      if (res.code === 1 && res.data?.base64) {
        const binary = atob(res.data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: res.data.contentType || 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
        setFilename(res.data.filename || 'label.pdf');
      } else {
        setError(res.msg || '获取面单失败');
      }
      setLoading(false);
    }).catch(() => {
      setError('网络错误');
      setLoading(false);
    });

    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [order?.id]);

  function handlePrint() {
    const iframe = document.getElementById('label-preview-iframe') as HTMLIFrameElement;
    if (iframe?.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  }

  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>面单预览 — {order?.postingNumber}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={!pdfUrl}>
                <FileDown className="h-4 w-4" /> 下载
              </Button>
              <Button size="sm" onClick={handlePrint} disabled={!pdfUrl}>
                <Printer className="h-4 w-4" /> 打印
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 rounded-md border overflow-hidden bg-muted">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">正在从 OZON 获取面单...</p>
                <p className="text-xs text-muted-foreground">首次生成可能需要 10-20 秒</p>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-2 max-w-md px-4">
                <div className="text-destructive font-medium">{error}</div>
                <p className="text-xs text-muted-foreground">
                  面单仅在订单已发货（awaiting_deliver）后可用。如果订单仍在"待打包"状态，请先执行发货操作。
                </p>
              </div>
            </div>
          ) : pdfUrl ? (
            <iframe
              id="label-preview-iframe"
              src={pdfUrl}
              className="w-full h-full border-0"
              title="面单预览"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShipOrderDialog({ order, onClose, onSuccess }: {
  order: Order | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setTrackingNumber(order?.trackingNumber || '');
  }, [order?.id]);

  async function handleSubmit() {
    if (!order) return;
    setSubmitting(true);
    const res = await api.post(`/api/orders/${order.id}/ship`, { trackingNumber: trackingNumber || undefined });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '发货成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '发货失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>订单发货</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">订单号：</span><span className="font-mono">{order.postingNumber || order.platformOrderId}</span></div>
              <div><span className="text-muted-foreground">店铺：</span>{order.shop.name}</div>
              <div><span className="text-muted-foreground">金额：</span>{(() => {
                const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                return (
                  <span title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                    {f.display}
                    {order.currency !== 'CNY' ? <span className="ml-1 text-xs text-muted-foreground">({f.isApprox ? '≈ ' : ''}{f.original})</span> : null}
                  </span>
                );
              })()}</div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">物流单号 (可选)</Label>
              <Input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} placeholder="留空则使用现有单号" />
            </div>
            <p className="text-xs text-muted-foreground">
              系统将根据订单中的商品自动生成 OZON FBS 发货包裹。
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            确认发货
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelOrderDialog({ order, onClose, onSuccess }: {
  order: Order | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reasons, setReasons] = useState<{ id: number; title: string }[]>([]);
  const [reasonId, setReasonId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingReasons, setLoadingReasons] = useState(false);

  useEffect(() => {
    if (!order) { setReasons([]); setReasonId(''); setMessage(''); return; }
    setLoadingReasons(true);
    api.get(`/api/orders/cancel-reasons?shopId=${order.shopId}`).then((res: any) => {
      if (res.code === 1 && res.data) {
        setReasons(res.data);
        if (res.data.length > 0) setReasonId(String(res.data[0].id));
      }
      setLoadingReasons(false);
    });
  }, [order?.id]);

  async function handleSubmit() {
    if (!order || !reasonId) return;
    setSubmitting(true);
    const res = await api.post(`/api/orders/${order.id}/cancel`, {
      reasonId: Number(reasonId),
      message: message || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '订单已取消' });
      onSuccess();
    } else {
      toast({ title: res.msg || '取消失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>取消订单</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">订单号：</span>
              <span className="font-mono">{order.postingNumber || order.platformOrderId}</span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">取消原因 *</Label>
              {loadingReasons ? (
                <div className="h-9 flex items-center text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> 加载原因列表...
                </div>
              ) : (
                <select
                  value={reasonId}
                  onChange={(e) => setReasonId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {reasons.length === 0 && <option value="">未获取到取消原因</option>}
                  {reasons.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">备注 (可选)</Label>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="额外说明" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={submitting || !reasonId}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
            确认取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrackingTimeline({ orderId, postingNumber, trackingNumber }: { orderId: string; postingNumber: string | null; trackingNumber: string | null }) {
  const [events, setEvents] = useState<{ id: string; substatus: string; statusText: string; occurredAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/orders/${orderId}/tracking`).then((res: any) => {
      if (res.code === 1 && res.data?.events) setEvents(res.data.events);
      setLoading(false);
    });
  }, [orderId]);

  if (loading) {
    return <div className="p-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  }

  return (
    <div className="p-3 space-y-2">
      {trackingNumber && (
        <div className="flex items-center gap-2 text-xs pb-2 border-b">
          <span className="text-muted-foreground">运单号：</span>
          <span className="font-mono">{trackingNumber}</span>
          {postingNumber && (
            <a
              href={`https://tracking.ozon.ru/?track=${encodeURIComponent(postingNumber)}&local=zh-Hans`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
            >
              OZON Track <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
      {events.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-2">暂无物流事件</div>
      ) : (
        <div className="relative pl-4 space-y-2">
          <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />
          {events.map((ev, i) => {
            const meta = describeSubstatus(ev.substatus);
            return (
              <div key={ev.id} className="relative flex items-start gap-2">
                <div className={`absolute left-[-13px] top-1 w-2.5 h-2.5 rounded-full border-2 ${i === 0 ? 'bg-primary border-primary' : 'bg-background border-muted-foreground/40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${i === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>{ev.statusText}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${PHASE_COLORS[meta.phase]}`}>{meta.phase === 'in_transit' ? '运输中' : meta.phase === 'delivered' ? '已完成' : ''}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">{formatDate(ev.occurredAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'default' }> = {
    awaiting_packaging: { label: '待打包', variant: 'warning' },
    awaiting_deliver: { label: '待发货', variant: 'warning' },
    delivering: { label: '配送中', variant: 'default' },
    delivered: { label: '已送达', variant: 'success' },
    cancelled: { label: '已取消', variant: 'destructive' },
  };
  const info = map[status] || { label: status, variant: 'secondary' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function StatMini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-bold ${highlight ? 'text-amber-600 dark:text-amber-400' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceTagDialog({ order, tags, onClose, onSuccess }: {
  order: Order | null;
  tags: ServiceTag[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order?.serviceTags) {
      setSelectedTags(new Set(order.serviceTags));
    } else {
      setSelectedTags(new Set());
    }
  }, [order?.id]);

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const totalFee = tags
    .filter((t) => selectedTags.has(t.id))
    .reduce((sum, t) => sum + parseFloat(t.fee), 0);

  async function handleSubmit() {
    if (!order) return;
    setSubmitting(true);
    const res = await api.put(`/api/orders/${order.id}/service-tags`, {
      tagIds: Array.from(selectedTags),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '标签设置成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '设置失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>设置服务标签</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">订单号：</span>
              <span className="font-mono">{order.postingNumber || order.platformOrderId}</span>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">选择标签</Label>
              <div className="grid grid-cols-2 gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`flex items-center gap-2 p-2 rounded-md border text-left text-sm transition-colors ${
                      selectedTags.has(tag.id)
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-input hover:bg-muted'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{tag.name}</div>
                      <div className="text-xs text-muted-foreground">{tag.fee} 元</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {totalFee > 0 && (
              <div className="p-2 bg-muted/50 rounded-md text-sm">
                <span className="text-muted-foreground">服务费合计：</span>
                <span className="font-medium">{totalFee.toFixed(2)} 元</span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchServiceTagDialog({ open, orderIds, tags, onClose, onSuccess }: {
  open: boolean;
  orderIds: string[];
  tags: ServiceTag[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setSelectedTags(new Set());
  }, [open]);

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const totalFee = tags
    .filter((t) => selectedTags.has(t.id))
    .reduce((sum, t) => sum + parseFloat(t.fee), 0);

  async function handleSubmit() {
    if (selectedTags.size === 0) {
      toast({ title: '请至少选择一个标签', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post('/api/orders/batch-service-tags', {
      orderIds,
      tagIds: Array.from(selectedTags),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg || '批量打标签完成' });
      onSuccess();
    } else {
      toast({ title: res.msg || '操作失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量打标签</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            将为 {orderIds.length} 个订单设置标签
          </div>
          <div className="space-y-2">
            <Label className="text-xs">选择标签</Label>
            <div className="grid grid-cols-2 gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={`flex items-center gap-2 p-2 rounded-md border text-left text-sm transition-colors ${
                    selectedTags.has(tag.id)
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{tag.name}</div>
                    <div className="text-xs text-muted-foreground">{tag.fee} 元</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {totalFee > 0 && (
            <div className="p-2 bg-muted/50 rounded-md text-sm">
              <span className="text-muted-foreground">每单服务费：</span>
              <span className="font-medium">{totalFee.toFixed(2)} 元</span>
              <span className="text-muted-foreground ml-2">({orderIds.length} 单共 {(totalFee * orderIds.length).toFixed(2)} 元)</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || selectedTags.size === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
            确认打标签
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
