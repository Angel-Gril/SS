'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Loader2, Package, Truck, XCircle, Clock, Send, Ban, FileDown, Printer, Tag, AlertTriangle, Warehouse, Plane, ShoppingCart, ExternalLink, Palette, SlidersHorizontal, Save, Bookmark, RotateCcw, ChevronDown } from 'lucide-react';
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
import { cn, formatDate, formatCurrency, formatOrderAmount, convertToCny } from '@/lib/utils';
import { describeSubstatus, PHASE_COLORS } from '@/lib/ozon-substatus';
import { defaultTrackUrl } from '@/lib/tracking';
import { isOrderAwaitingSellerShipment, resolveOrderFulfillmentStage } from 'shared/order-fulfillment-stage';
import { OzonSyncActionDialog } from '@/components/ozon/sync-action-dialog';

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
  deliveredAt: string | null;
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
  userColorTags: string[] | null;
  serviceFee: number | null;
  inspectionStatus: string | null;
  warehouseScanInAt: string | null;
  warehouseScanOutAt: string | null;
  labelPrintedAt: string | null;
  stockPreparedAt: string | null;
  fulfillmentStage: string | null;
  fulfillmentStatus: string | null;
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

interface UserColorTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  sortOrder: number;
}

interface PipelineStage {
  key: string;
  label: string;
  count: number;
  children?: Array<{ key: string; label: string; count: number }>;
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

interface SavedOrderFilter {
  id: string;
  name: string;
  status: string;
  shopId: string;
  search: string;
  searchField: 'all' | 'posting' | 'tracking' | 'sku' | 'product' | 'purchase';
  serviceTagId: string;
  userColorTagId: string;
  shipmentUrgency: '' | 'overdue' | 'today' | 'tomorrow' | 'within3d';
  hasTracking: '' | 'yes' | 'no';
  subStatus: string;
  purchaseState: '' | 'linked' | 'unlinked';
  shippingMethod: string;
  sort: 'created_desc' | 'created_asc' | 'shipment_asc' | 'shipment_desc' | 'amount_desc' | 'amount_asc';
  startDate: string;
  endDate: string;
}

const SAVED_ORDER_FILTERS_KEY = 'savedOrderFilters';

function defaultOrderStartDate() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().slice(0, 10);
}

function defaultOrderEndDate() {
  return new Date().toISOString().slice(0, 10);
}

type ShipmentCountdownOrder = Pick<Order, 'status' | 'subStatus' | 'shipmentDate' | 'deliveringDate' | 'deliveredAt'>;

const PIPELINE_ICONS: Record<string, any> = {
  purchased: ShoppingCart,
  domestic_transit: Truck,
  received: Warehouse,
  warehouse_processing: Warehouse,
  delivering: Plane,
  abnormal: AlertTriangle,
};

const PIPELINE_LABELS: Record<string, string> = {
  purchased: '采购备货',
  domestic_transit: '国内在途',
  received: '到仓入库',
  warehouse_processing: '仓库处理',
  delivering: '出库发运',
  abnormal: '异常',
};

function getOzonProductUrl(item: any): string | null {
  const rawId = item?.sku ?? item?.product_id ?? item?.productId;
  const id = rawId == null ? '' : String(rawId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://www.ozon.ru/product/${id}`;
}

function formatCompactDate(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/**
 * Sum the CNY item prices captured with the order. This is the historical
 * product-price view, not a replacement for the order's financial total.
 */
function getCnyOrderItemTotal(items: unknown): number | null {
  if (!Array.isArray(items)) return null;
  let total = 0;
  let found = false;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const currency = String(row.currency_code ?? row.currency ?? '').trim().toUpperCase();
    const price = Number(row.price);
    const quantity = Number(row.quantity ?? 1);
    if (currency !== 'CNY' || !Number.isFinite(price) || !Number.isFinite(quantity)) continue;
    total += price * quantity;
    found = true;
  }
  return found ? Math.round(total * 100) / 100 : null;
}

function ProductImagePreview({ items }: { items: any[] }) {
  const [hover, setHover] = useState(false);
  if (!items || items.length === 0) return <span className="text-muted-foreground">-</span>;

  const firstItem = items[0];
  const imageUrl = firstItem?.image || firstItem?.primary_image || firstItem?.picture || firstItem?.images?.[0];

  return (
    <div className="flex w-full min-w-0 items-start gap-2">
      {imageUrl ? (
        <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <img src={imageUrl} alt="" className="w-11 h-11 rounded border object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {hover && (
            <div className="absolute z-50 left-12 top-0 p-1 bg-background border rounded-lg shadow-xl">
              <img src={imageUrl} alt="" className="w-[180px] h-[180px] rounded object-contain" />
              <div className="text-xs text-muted-foreground mt-1 px-1 truncate max-w-[180px]">{firstItem?.name}</div>
            </div>
          )}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 overflow-hidden space-y-1">
        {items.slice(0, 2).map((item: any, i: number) => (
          <div key={i} className="min-w-0">
            <div className="flex min-w-0 items-start gap-1.5">
              {getOzonProductUrl(item) ? (
                <a
                  href={getOzonProductUrl(item)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block min-w-0 flex-1 truncate text-xs font-medium leading-5 hover:text-primary hover:underline"
                  title={item.name}
                >
                  {item.name || '-'}
                </a>
              ) : (
                <div className="min-w-0 flex-1 truncate text-xs font-medium leading-5" title={item.name}>{item.name || '-'}</div>
              )}
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">x{item.quantity || 1}</span>
            </div>
            <div className="flex min-w-0 items-center gap-x-2 overflow-hidden text-[10px] text-muted-foreground">
              {(item.offer_id || item.offerId) && <span className="shrink-0">Offer {item.offer_id || item.offerId}</span>}
              {item.sku && <span className="min-w-0 truncate">SKU {item.sku}</span>}
              {item.price && <span className="shrink-0">{item.price} {item.currency_code || item.currency || 'RUB'}</span>}
            </div>
          </div>
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

function formatInternationalDisplayStatus(order: any): string {
  const stage = resolveOrderFulfillmentStage(order);
  if (order.fulfillmentStatus === 'delivered') return '已送达';
  if (stage.key === 'delivering') return '出库发运';
  if (stage.key === 'warehouse_processing') return '仓库处理';
  if (order.internationalTrackingNumber || order.trackingNumber) return '国际单已生成';
  return '待发出';
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
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncSinceDays, setSyncSinceDays] = useState(90);
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [pipelineActive, setPipelineActive] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [serviceTags, setServiceTags] = useState<ServiceTag[]>([]);
  const [userColorTags, setUserColorTags] = useState<UserColorTag[]>([]);
  const [tagDialogOrder, setTagDialogOrder] = useState<Order | null>(null);
  const [userTagDialogOrder, setUserTagDialogOrder] = useState<Order | null>(null);
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);
  const [batchUserTagDialogOpen, setBatchUserTagDialogOpen] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const [status, setStatus] = useState('');
  const [shopId, setShopId] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'posting' | 'tracking' | 'sku' | 'product' | 'purchase'>('all');
  const [serviceTagId, setServiceTagId] = useState('');
  const [userColorTagId, setUserColorTagId] = useState('');
  const [shipmentUrgency, setShipmentUrgency] = useState<'' | 'overdue' | 'today' | 'tomorrow' | 'within3d'>('');
  const [hasTracking, setHasTracking] = useState<'' | 'yes' | 'no'>('');
  const [subStatus, setSubStatus] = useState('');
  const [purchaseState, setPurchaseState] = useState<'' | 'linked' | 'unlinked'>('');
  const [shippingMethod, setShippingMethod] = useState('');
  const [sort, setSort] = useState<SavedOrderFilter['sort']>('created_desc');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savedOrderFilters, setSavedOrderFilters] = useState<SavedOrderFilter[]>([]);
  const [savedFilterName, setSavedFilterName] = useState('');
  const [startDate, setStartDate] = useState(defaultOrderStartDate);
  const [endDate, setEndDate] = useState(defaultOrderEndDate);
  const [page, setPage] = useState(0);
  const [shipOrder, setShipOrder] = useState<Order | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [labelOrder, setLabelOrder] = useState<Order | null>(null);
  const limit = 20;

  const loadPipeline = useCallback(async () => {
    const params = new URLSearchParams();
    if (shopId) params.set('shopId', shopId);
    if (search) params.set('search', search);
    if (search && searchField !== 'all') params.set('searchField', searchField);
    if (serviceTagId) params.set('serviceTagId', serviceTagId);
    if (userColorTagId) params.set('userColorTagId', userColorTagId);
    if (purchaseState) params.set('purchaseState', purchaseState);
    if (shippingMethod) params.set('shippingMethod', shippingMethod);
    if (hasTracking) params.set('hasTracking', hasTracking);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await api.get<{ stages: PipelineStage[] }>(`/api/orders/pipeline?${params}`);
    if (res.code === 1 && res.data) setPipeline(res.data.stages);
  }, [shopId, search, searchField, serviceTagId, userColorTagId, purchaseState, shippingMethod, hasTracking, startDate, endDate]);

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
    api.get<UserColorTag[]>('/api/user-service-tags').then((res) => {
      if (res.code === 1 && res.data) setUserColorTags(res.data);
    });
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVED_ORDER_FILTERS_KEY) || '[]');
      if (Array.isArray(parsed)) setSavedOrderFilters(parsed.slice(0, 20));
    } catch {}
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
    if (userColorTagId) params.set('userColorTagId', userColorTagId);
    if (shipmentUrgency) params.set('shipmentUrgency', shipmentUrgency);
    if (hasTracking) params.set('hasTracking', hasTracking);
    if (subStatus) params.set('subStatus', subStatus);
    if (purchaseState) params.set('purchaseState', purchaseState);
    if (shippingMethod) params.set('shippingMethod', shippingMethod);
    params.set('sort', sort);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (pipelineActive) params.set('fulfillmentStage', pipelineActive);
    if (pipelineStatus) params.set('fulfillmentStatus', pipelineStatus);

    const res = await api.get<{ total: number; rows: Order[] }>(`/api/orders?${params}`);
    if (res.code === 1 && res.data) {
      setOrders(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadOrders();
  }, [status, shopId, search, searchField, serviceTagId, userColorTagId, shipmentUrgency, hasTracking, subStatus, purchaseState, shippingMethod, sort, page, startDate, endDate, pipelineActive, pipelineStatus]);

  function handleSync(fullSync = false) {
    if (!shopId && shops.length === 0) {
      toast({ title: '请先添加店铺', variant: 'destructive' });
      return;
    }
    setSyncSinceDays(fullSync ? 365 : 90);
    setSyncDialogOpen(true);
  }

  async function markStockReady(order: Order) {
    try {
      const response = await api.put(`/api/orders/${order.id}/stock-ready`, { prepared: true });
      if (response.code !== 1) throw new Error(response.msg || '确认备货失败');
      toast({ title: '已确认备货', description: '订单已进入国内在途' });
      await Promise.all([loadOrders(), loadPipeline()]);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : '确认备货失败', variant: 'destructive' });
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  }

  function handlePipelineClick(stageKey: string) {
    const stage = pipeline.find(item => item.key === stageKey);
    if (pipelineActive === stageKey) {
      setPipelineActive(null);
      setPipelineStatus(null);
    } else {
      setPipelineActive(stageKey);
      setPipelineStatus(null);
      if (!stage?.children?.length) setPipelineStatus(null);
      setStatus('');
    }
    setPage(0);
  }

  function handlePipelineStatusClick(stageKey: string, childKey: string) {
    setPipelineActive(stageKey);
    setPipelineStatus(pipelineStatus === childKey ? null : childKey);
    setStatus('');
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

  function currentSavedFilter(name: string): SavedOrderFilter {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      status,
      shopId,
      search,
      searchField,
      serviceTagId,
      userColorTagId,
      shipmentUrgency,
      hasTracking,
      subStatus,
      purchaseState,
      shippingMethod,
      sort,
      startDate,
      endDate,
    };
  }

  function saveCurrentFilter() {
    const name = savedFilterName.trim() || `筛选方案 ${new Date().toLocaleDateString('zh-CN')}`;
    const next = [currentSavedFilter(name), ...savedOrderFilters.filter((item) => item.name !== name)].slice(0, 20);
    setSavedOrderFilters(next);
    localStorage.setItem(SAVED_ORDER_FILTERS_KEY, JSON.stringify(next));
    setSavedFilterName('');
    toast({ title: `已保存筛选：${name}` });
  }

  function applySavedFilter(filter: SavedOrderFilter) {
    setStatus(filter.status || '');
    setShopId(filter.shopId || '');
    setSearch(filter.search || '');
    setSearchInput(filter.search || '');
    setSearchField(filter.searchField || 'all');
    setServiceTagId(filter.serviceTagId || '');
    setUserColorTagId(filter.userColorTagId || '');
    setShipmentUrgency(filter.shipmentUrgency || '');
    setHasTracking(filter.hasTracking || '');
    setSubStatus(filter.subStatus || '');
    setPurchaseState(filter.purchaseState || '');
    setShippingMethod(filter.shippingMethod || '');
    setSort(filter.sort || 'created_desc');
    setStartDate(filter.startDate || defaultOrderStartDate());
    setEndDate(filter.endDate || defaultOrderEndDate());
    setPipelineActive(null);
    setPage(0);
  }

  function resetOrderFilters() {
    setStatus('');
    setShopId('');
    setSearch('');
    setSearchInput('');
    setSearchField('all');
    setServiceTagId('');
    setUserColorTagId('');
    setShipmentUrgency('');
    setHasTracking('');
    setSubStatus('');
    setPurchaseState('');
    setShippingMethod('');
    setSort('created_desc');
    setStartDate(defaultOrderStartDate());
    setEndDate(defaultOrderEndDate());
    setPipelineActive(null);
    setPage(0);
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
          <Button onClick={() => handleSync(false)} disabled={!shops.length}>
            <RefreshCw className="h-4 w-4" />
            同步订单
          </Button>
          <Button variant="outline" onClick={() => handleSync(true)} disabled={!shops.length} title="拉取最近一年所有订单">
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
          <StatMini label="今日订单" value={String(stats.todayOrders ?? 0)} />
          <StatMini label="今日销售额" value={formatCurrency(convertToCny(stats.todayRevenue ?? '0', 'RUB'), 'CNY')} />
        </div>
      )}

      {/* 打包发货流程进度条 */}
      {pipeline.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4 overflow-x-auto">
              <Button
                type="button"
                variant={!status && !pipelineActive ? 'default' : 'outline'}
                className="shrink-0"
                aria-pressed={!status && !pipelineActive}
                onClick={() => { setStatus(''); setPipelineActive(null); setPipelineStatus(null); setPage(0); }}
              >
                全部订单
              </Button>
              {pipeline.map((stage, idx) => {
                const Icon = PIPELINE_ICONS[stage.key] || Package;
                const isActive = pipelineActive === stage.key;
                return (
                  <div key={stage.key} className="flex flex-1 items-center">
                    <div
                      className={`flex shrink-0 flex-col items-center gap-2 px-3 py-2 rounded-lg transition-colors min-w-[96px] ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handlePipelineClick(stage.key)}
                        aria-pressed={isActive}
                        className="flex flex-col items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                      <span className={`text-sm whitespace-nowrap ${
                        isActive ? 'text-blue-600 font-medium dark:text-blue-400' : 'text-muted-foreground'
                      }`}>
                        {PIPELINE_LABELS[stage.key] || stage.label}
                      </span>
                      </button>
                      {isActive && stage.children?.length ? (
                        <div className="mt-1 flex items-center justify-center gap-2">
                          {stage.children.map((child) => (
                            <Button
                              key={child.key}
                              type="button"
                              onClick={() => handlePipelineStatusClick(stage.key, child.key)}
                              variant={pipelineStatus === child.key ? 'default' : 'outline'}
                              className="rounded-full px-3"
                              aria-pressed={pipelineStatus === child.key}
                            >
                              {child.label} {child.count > 0 ? `(${child.count})` : ''}
                            </Button>
                          ))}
                        </div>
                      ) : null}
                    </div>
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
              value={userColorTagId}
              onChange={(e) => { setUserColorTagId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="按个人标记筛选"
            >
              <option value="">个人标记</option>
              {userColorTags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>

            <select
              value={serviceTagId}
              onChange={(e) => { setServiceTagId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              title="按服务标签筛选"
            >
              <option value="">服务标签</option>
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

            <Button
              type="button"
              size="sm"
              variant={advancedOpen ? 'secondary' : 'outline'}
              onClick={() => setAdvancedOpen((value) => !value)}
              aria-expanded={advancedOpen}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              高级筛选
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')} />
            </Button>

            <span className="ml-auto text-sm text-muted-foreground">共 {total} 条</span>
          </div>

          {advancedOpen && (
            <div className="border-t pt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <select
                  value={subStatus}
                  onChange={(e) => { setSubStatus(e.target.value); setPage(0); }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  title="Ozon 子状态"
                >
                  <option value="">全部 Ozon 子状态</option>
                  <option value="posting_created">订单已创建</option>
                  <option value="posting_awaiting_passport_data">待护照信息</option>
                  <option value="posting_sent_by_seller">卖家已发货</option>
                  <option value="posting_canceled_by_client">买家已取消</option>
                </select>
                <select
                  value={purchaseState}
                  onChange={(e) => { setPurchaseState(e.target.value as SavedOrderFilter['purchaseState']); setPage(0); }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  title="采购单关联状态"
                >
                  <option value="">采购关联</option>
                  <option value="unlinked">未关联采购单</option>
                  <option value="linked">已关联采购单</option>
                </select>
                <Input
                  value={shippingMethod}
                  onChange={(e) => { setShippingMethod(e.target.value); setPage(0); }}
                  className="h-9"
                  placeholder="物流方式，如 FBS"
                />
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value as SavedOrderFilter['sort']); setPage(0); }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  title="排序"
                >
                  <option value="created_desc">下单时间：最新</option>
                  <option value="created_asc">下单时间：最早</option>
                  <option value="shipment_asc">发货截止：最近</option>
                  <option value="shipment_desc">发货截止：最晚</option>
                  <option value="amount_desc">订单金额：从高到低</option>
                  <option value="amount_asc">订单金额：从低到高</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Bookmark className="h-4 w-4 text-muted-foreground" />
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const filter = savedOrderFilters.find((item) => item.id === e.target.value);
                    if (filter) applySavedFilter(filter);
                    e.target.value = '';
                  }}
                  className="h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
                  title="已保存筛选"
                >
                  <option value="">已保存筛选</option>
                  {savedOrderFilters.map((filter) => (
                    <option key={filter.id} value={filter.id}>{filter.name}</option>
                  ))}
                </select>
                <Input
                  value={savedFilterName}
                  onChange={(e) => setSavedFilterName(e.target.value)}
                  className="h-9 w-[180px]"
                  placeholder="筛选方案名称"
                  maxLength={40}
                />
                <Button type="button" size="sm" variant="outline" onClick={saveCurrentFilter}>
                  <Save className="h-3.5 w-3.5" />
                  保存筛选
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={resetOrderFilters}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </Button>
                <span className="text-xs text-muted-foreground">
                  平台订单状态与 ERP 履约阶段分开筛选；未接入仓储时不会推断入库或出库。
                </span>
              </div>
            </div>
          )}

          {/* 批量操作栏 */}
          {selectedOrders.size > 0 && (
            <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-md">
              <span className="text-sm text-muted-foreground">已选 {selectedOrders.size} 项</span>
              <Button size="sm" variant="outline" onClick={() => setBatchUserTagDialogOpen(true)}>
                <Palette className="h-3.5 w-3.5" />
                批量个人标记
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBatchTagDialogOpen(true)}>
                <Tag className="h-3.5 w-3.5" />
                批量服务标签
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
          <Table className="min-w-[1280px] table-fixed text-xs">
              <colgroup>
                <col className="w-[38px]" />
                <col className="w-[135px]" />
                <col className="w-[330px]" />
                <col className="w-[104px]" />
                <col className="w-[86px]" />
                <col className="w-[100px]" />
                <col className="w-[104px]" />
                <col className="w-[165px]" />
                <col className="w-[115px]" />
                <col className="w-[103px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedOrders.size === orders.length && orders.length > 0}
                      onChange={toggleAllOrders}
                      className="rounded border-input"
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">订单 / 店铺</TableHead>
                  <TableHead className="whitespace-nowrap">商品信息</TableHead>
                  <TableHead className="whitespace-nowrap text-right" title="订单同步时的成交总额；商品栏中的单价保留商品自身币种">
                    订单成交额
                  </TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
                  <TableHead className="whitespace-nowrap">个人标记</TableHead>
                  <TableHead className="whitespace-nowrap">服务标签</TableHead>
                  <TableHead className="whitespace-nowrap">物流</TableHead>
                  <TableHead className="whitespace-nowrap">时间</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-48 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-48 text-center text-muted-foreground">
                      没有符合当前筛选条件的订单。请清空筛选后重试。
                    </TableCell>
                  </TableRow>
                ) : orders.map((order) => {
                  const canShip = order.status === 'awaiting_packaging' || order.status === 'awaiting_deliver';
                  const canCancel = order.status !== 'delivered' && order.status !== 'cancelled';
                  const orderTags = order.serviceTags || [];
                  const userTags = order.userColorTags || [];
                  const resolvedUserTags = userTags
                    .map((tagId) => userColorTags.find((t) => t.id === tagId))
                    .filter((tag): tag is UserColorTag => Boolean(tag));
                  const visibleUserTags = resolvedUserTags.slice(0, 1);
                  const hiddenUserTagCount = resolvedUserTags.length - visibleUserTags.length;
                  const resolvedServiceTags = orderTags
                    .map((tagId) => serviceTags.find((t) => t.id === tagId))
                    .filter((tag): tag is ServiceTag => Boolean(tag));
                  const visibleServiceTags = resolvedServiceTags.slice(0, 1);
                  const hiddenServiceTagCount = resolvedServiceTags.length - visibleServiceTags.length;
                  const primaryTracking = order.trackingNumber || order.internationalTrackingNumber || order.postingNumber;
                  const externalTrackNumber = order.trackingNumber || order.internationalTrackingNumber;
                  return (
                    <TableRow key={order.id} className="align-top">
                      <TableCell className="px-2.5 py-2">
                        <input
                          type="checkbox"
                          checked={selectedOrders.has(order.id)}
                          onChange={() => toggleOrderSelection(order.id)}
                          className="rounded border-input"
                        />
                      </TableCell>
                      <TableCell className="px-2.5 py-2 text-xs">
                        <button
                          type="button"
                          className="block max-w-full truncate font-mono text-left text-[12px] font-medium hover:text-primary hover:underline"
                          onClick={() => setDetailOrderId(order.id)}
                          title={order.postingNumber || order.platformOrderId}
                        >
                          {order.postingNumber || order.platformOrderId}
                        </button>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">{order.shop.platform}</Badge>
                          <span className="min-w-0 truncate text-muted-foreground" title={order.shop.name}>{order.shop.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 px-2.5 py-2">
                        {order.items && Array.isArray(order.items) ? (
                          <ProductImagePreview items={order.items as any[]} />
                        ) : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums font-medium">
                        {(() => {
                          const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                          const itemTotalCny = getCnyOrderItemTotal(order.items);
                          return (
                            <div className="space-y-0.5 leading-5" title={f.isApprox ? `原币 ${f.original}（估算汇率）` : `原币 ${f.original}`}>
                              <div>{f.display}</div>
                              {itemTotalCny != null && order.currency !== 'CNY' ? (
                                <div className="text-[11px] text-muted-foreground font-normal">
                                  下单商品价 {formatCurrency(itemTotalCny, 'CNY')}
                                </div>
                              ) : null}
                              {order.currency !== 'CNY' ? (
                                <div className="text-[11px] text-muted-foreground font-normal">
                                  {f.isApprox ? '≈ ' : ''}{f.original}
                                </div>
                              ) : null}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="px-2.5 py-2">
                        <div className="flex flex-col items-start gap-1 whitespace-nowrap">
                          <span className="text-[9px] font-medium uppercase text-muted-foreground">Ozon 状态</span>
                          <OrderStatusBadge status={order.status} className="h-5 px-1.5 text-[10px]" />
                          <ShipmentCountdownMini order={order} />
                        </div>
                      </TableCell>
                      <TableCell className="px-2.5 py-2">
                        <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                          {visibleUserTags.length > 0 ? (
                            <>
                              {visibleUserTags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-flex min-w-0 max-w-[76px] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                  style={{ backgroundColor: `${tag.color}1F`, color: tag.color }}
                                  title={tag.name}
                                >
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                                  <span className="truncate">{tag.name}</span>
                                </span>
                              ))}
                              {hiddenUserTagCount > 0 && (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{hiddenUserTagCount}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">未标记</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setUserTagDialogOrder(order)}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="设置个人标记"
                          >
                            <Palette className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="px-2.5 py-2">
                        <div className="flex min-w-0 items-center gap-1 whitespace-nowrap">
                          {visibleServiceTags.length > 0 ? (
                            <>
                              {visibleServiceTags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-flex min-w-0 max-w-[76px] items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                                  title={tag.name}
                                >
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                                  <span className="truncate">{tag.name}</span>
                                </span>
                              ))}
                              {hiddenServiceTagCount > 0 && (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{hiddenServiceTagCount}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">未设置</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setTagDialogOrder(order)}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="设置服务标签"
                          >
                            <Tag className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="px-2.5 py-2 text-xs">
                        {(() => {
                          const meta = describeSubstatus(order.subStatus);
                          const fulfillmentStage = resolveOrderFulfillmentStage(order);
                          const showStatus = order.subStatus && meta.phase !== 'unknown';
                          // 获取最新的物流时间
                          const latestTime = order.warehouseScanOutAt || order.deliveringDate || order.labelPrintedAt || order.shipmentDate || order.warehouseScanInAt || order.inProcessAt;
                          const formattedTime = latestTime ? new Date(latestTime).toLocaleString('zh-CN', {
                            year: '2-digit',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          }).replace(/\//g, '.') : null;

                          // 判断显示哪些跟踪链接
                          const hasDomesticTracking = !!order.domesticTrackingNumber;
                          const hasInternationalTracking = !!externalTrackNumber;

                          return (
                            <div className="min-w-0 space-y-1">
                              <div className="text-[9px] font-medium uppercase text-muted-foreground">ERP 履约</div>
                              <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                                <Badge variant={fulfillmentStage.variant} className="h-5 shrink-0 px-1.5 text-[10px]">{fulfillmentStage.label}</Badge>
                                {showStatus && formattedTime && (
                                  <span className="truncate text-[10px] text-muted-foreground">{formattedTime}</span>
                                )}
                              </div>
                              {showStatus && (
                                <div className="min-w-0 truncate text-[11px] font-medium" title={meta.text}>
                                  {meta.text}
                                </div>
                              )}
                              {primaryTracking && (
                                <a
                                  href={defaultTrackUrl(primaryTracking)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                  title="打开 Ozon 物流追踪"
                                >
                                  <span className="truncate">{primaryTracking}</span>
                                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                </a>
                              )}
                              {order.shippingMethod && (
                                <div className="truncate text-[10px] text-muted-foreground" title={order.shippingMethod}>{order.shippingMethod}</div>
                              )}
                              <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px]">
                                {/* 国内物流：显示菜鸟国际 */}
                                {hasDomesticTracking && (
                                  <a
                                    href={`https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(order.domesticTrackingNumber!)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex shrink-0 items-center gap-0.5 rounded border bg-background px-1 py-0.5 normal-case transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                    title="在菜鸟国际查询国内物流"
                                  >
                                    菜鸟国际
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                                {/* 国际物流：单号本身已经是 OZON Track 入口，这里只保留 17TRACK。 */}
                                {hasInternationalTracking && (
                                  <a
                                    href={`https://t.17track.net/zh-cn#nums=${encodeURIComponent(externalTrackNumber!)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex shrink-0 items-center gap-0.5 rounded border bg-background px-1 py-0.5 normal-case transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                                    title="在 17TRACK 查询国际物流"
                                  >
                                    17TRACK
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2.5 py-2 text-xs text-muted-foreground">
                        <div className="space-y-0.5 leading-5">
                          <div><span className="text-muted-foreground/80">创建</span> {formatCompactDate(order.createdAt)}</div>
                          {order.labelPrintedAt && <div><span className="text-muted-foreground/80">面单</span> {formatCompactDate(order.labelPrintedAt)}</div>}
                          {order.shipmentDate && <div><span className="text-muted-foreground/80">发货</span> {formatCompactDate(order.shipmentDate)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2.5 py-2 text-right">
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
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[10px]"
                            disabled={Boolean(order.stockPreparedAt) || order.status === 'cancelled' || order.status === 'delivered' || order.fulfillmentStage === 'warehouse_processing' || order.fulfillmentStage === 'delivering'}
                            title={order.stockPreparedAt ? '已确认备货' : '确认已备货，进入国内在途'}
                            onClick={() => void markStockReady(order)}
                          >
                            {order.stockPreparedAt ? '已备货' : '确认备货'}
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
      <UserColorTagDialog
        order={userTagDialogOrder}
        tags={userColorTags}
        onClose={() => setUserTagDialogOrder(null)}
        onSuccess={() => { setUserTagDialogOrder(null); loadOrders(); }}
      />
      <BatchServiceTagDialog
        open={batchTagDialogOpen}
        orderIds={Array.from(selectedOrders)}
        tags={serviceTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onSuccess={() => { setBatchTagDialogOpen(false); setSelectedOrders(new Set()); loadOrders(); }}
      />
      <BatchUserColorTagDialog
        open={batchUserTagDialogOpen}
        orderIds={Array.from(selectedOrders)}
        tags={userColorTags}
        onClose={() => setBatchUserTagDialogOpen(false)}
        onSuccess={() => { setBatchUserTagDialogOpen(false); setSelectedOrders(new Set()); loadOrders(); }}
      />
      <OzonSyncActionDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        defaultShopId={shopId}
        defaultTypes={['ORDER_PULL']}
        defaultSinceDays={syncSinceDays}
        title={syncSinceDays >= 365 ? '全量同步 Ozon 订单' : '同步 Ozon 订单'}
        onQueued={() => {
          loadOrders();
          loadPipeline();
          api.get<OrderStats>('/api/orders/stats').then((r) => {
            if (r.code === 1 && r.data) setStats(r.data);
          });
        }}
      />
    </div>
  );
}

function ShipmentCountdown({ order }: { order: ShipmentCountdownOrder }) {
  const [now, setNow] = useState(Date.now());
  const shipmentDate = order.shipmentDate;

  useEffect(() => {
    if (!shipmentDate) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [shipmentDate]);

  if (!shipmentDate) return null;
  if (!isOrderAwaitingSellerShipment(order)) return null;

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

function ShipmentCountdownMini({ order }: { order: ShipmentCountdownOrder }) {
  const shipmentDate = order.shipmentDate;
  if (!shipmentDate) return null;
  if (!isOrderAwaitingSellerShipment(order)) return null;

  const diff = new Date(shipmentDate).getTime() - Date.now();
  if (diff <= 0) {
    return <span className="whitespace-nowrap text-[10px] text-red-600 font-medium">已超时</span>;
  }
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const isUrgent = diff < 24 * 60 * 60 * 1000;
  const text = days > 0 ? `剩${days}天${hours}时` : `剩${hours}小时`;
  return <span className={`whitespace-nowrap text-[10px] font-medium ${isUrgent ? 'text-amber-600' : 'text-muted-foreground'}`}>{text}</span>;
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
                <span className="text-muted-foreground">订单成交额：</span>
                {(() => {
                  const f = formatOrderAmount(detail.totalAmount, detail.currency, detail.totalAmountCny);
                  const itemTotalCny = getCnyOrderItemTotal(detail.items);
                  return (
                    <span className="font-medium" title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                      <span>{f.display}</span>
                      {itemTotalCny != null && detail.currency !== 'CNY' ? (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          下单商品价 {formatCurrency(itemTotalCny, 'CNY')}
                        </span>
                      ) : null}
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
            <ShipmentCountdown order={detail} />

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
                <div><span className="text-muted-foreground">面单打印：</span>{detail.labelPrintedAt ? formatDate(detail.labelPrintedAt) : '-'}</div>
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
                  <div><span className="text-muted-foreground">国际状态：</span>{formatInternationalDisplayStatus(detail)}</div>
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
                        <TableCell className="text-right tabular-nums">
                          {it.price ? `${it.price} ${it.currency_code || it.currency || detail.currency}` : '-'}
                        </TableCell>
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
              <div><span className="text-muted-foreground">订单成交额：</span>{(() => {
                const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                const itemTotalCny = getCnyOrderItemTotal(order.items);
                return (
                  <span title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                    {f.display}
                    {itemTotalCny != null && order.currency !== 'CNY' ? (
                      <span className="ml-2 text-xs text-muted-foreground">下单商品价 {formatCurrency(itemTotalCny, 'CNY')}</span>
                    ) : null}
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

function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'default' }> = {
    awaiting_packaging: { label: '待打包', variant: 'warning' },
    awaiting_deliver: { label: '待发货', variant: 'warning' },
    delivering: { label: '配送中', variant: 'default' },
    delivered: { label: '已送达', variant: 'success' },
    cancelled: { label: '已取消', variant: 'destructive' },
  };
  const info = map[status] || { label: status, variant: 'secondary' as const };
  return <Badge variant={info.variant} className={cn('whitespace-nowrap', className)}>{info.label}</Badge>;
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

function UserColorTagDialog({ order, tags, onClose, onSuccess }: {
  order: Order | null;
  tags: UserColorTag[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSelectedTags(new Set(order?.userColorTags || []));
  }, [order?.id]);

  function toggleTag(tagId: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleSubmit() {
    if (!order) return;
    setSubmitting(true);
    const res = await api.put(`/api/orders/${order.id}/user-color-tags`, {
      tagIds: Array.from(selectedTags),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '个人标记已保存' });
      onSuccess();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>设置个人标记</DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted-foreground">订单号：</span>
              <span className="font-mono">{order.postingNumber || order.platformOrderId}</span>
            </div>
            {tags.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                暂无个人颜色标签，可先到“我的颜色标签”创建。
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors',
                      selectedTags.has(tag.id) ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
                    )}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="min-w-0 truncate font-medium">{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">个人标记只影响你自己的订单视图，不会进入仓库服务费和验视流程。</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function BatchUserColorTagDialog({ open, orderIds, tags, onClose, onSuccess }: {
  open: boolean;
  orderIds: string[];
  tags: UserColorTag[];
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

  async function handleSubmit() {
    if (orderIds.length === 0) return;
    setSubmitting(true);
    const res = await api.post('/api/orders/batch-user-color-tags', {
      orderIds,
      tagIds: Array.from(selectedTags),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg || '批量个人标记完成' });
      onSuccess();
    } else {
      toast({ title: res.msg || '操作失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量个人标记</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            将为 {orderIds.length} 个订单设置个人标记；不选择任何标签即清空个人标记。
          </div>
          {tags.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              暂无个人颜色标签，可先到“我的颜色标签”创建。
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors',
                    selectedTags.has(tag.id) ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
                  )}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="min-w-0 truncate font-medium">{tag.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || orderIds.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
