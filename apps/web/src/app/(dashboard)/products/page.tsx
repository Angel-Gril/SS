'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, RefreshCw, Loader2, ImageOff, Pencil, Check, X,
  Package, DollarSign, Boxes, Upload, AlertTriangle,
  Save, ImageIcon, Trash2, Plus, Clock, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';
import { formatOrderAmount } from '@/lib/utils';
import { getOzonAttrName } from '@/lib/ozon-attr-names';
import { OzonExtensionSyncStatus } from '@/components/ozon/extension-sync-status';
import { OzonSyncActionDialog } from '@/components/ozon/sync-action-dialog';

interface Product {
  id: string;
  platformProductId: string | null;
  sku: string | null;
  offerId: string | null;
  title: string;
  price: string | null;
  oldPrice: string | null;
  currency: string;
  stock: number;
  weight: number | null;
  images: string[] | null;
  status: string | null;
  visibility: string | null;
  ozonStatusName?: string | null;
  ozonStatusDescription?: string | null;
  ozonModerateStatus?: string | null;
  ozonStatusTone?: OzonStatusTone | null;
  warehouseStock?: number | null;
  syncStatus: string | null;
  categoryId: string | null;
  commissionRate: string | null;
  minPrice: string | null;
  ozonCreatedAt: string | null;
  ozonUpdatedAt: string | null;
  lastOzonSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductListResponse {
  total: number;
  rows: Product[];
  lastSyncAt: string | null;
  statusFilter: ProductStatusFilter;
  statusCounts?: ProductStatusCounts;
}

interface Shop {
  id: string;
  name: string;
  platform: string;
}

interface OzonWarehouse {
  warehouse_id: number;
  name: string;
}

type BatchPriceMode = 'set' | 'multiply' | 'discount' | 'increase';
type BatchAction = 'price' | 'stock' | 'archive' | 'restore';
type ProductStatusFilter = 'current' | 'archived' | 'missing' | 'all';
type OzonStatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'info';
type WarehouseStockMode = 'all' | 'in_stock' | 'out_of_stock';

const PRODUCT_FILTERS_STORAGE_KEY = 'ss-erp:products:filters';

interface ProductStatusCounts {
  current: number;
  archived: number;
  missing: number;
  all: number;
}

const EMPTY_STATUS_COUNTS: ProductStatusCounts = {
  current: 0,
  archived: 0,
  missing: 0,
  all: 0,
};

const PRODUCT_STATUS_TABS: Array<{ value: ProductStatusFilter; label: string }> = [
  { value: 'current', label: '当前商品' },
  { value: 'archived', label: '已归档' },
  { value: 'missing', label: '同步缺失' },
  { value: 'all', label: '全部记录' },
];

const BATCH_PRICE_MODES: { value: BatchPriceMode; label: string; inputLabel: string; placeholder: string }[] = [
  { value: 'set', label: '统一价', inputLabel: '新价格 (RUB)', placeholder: '输入统一价格' },
  { value: 'multiply', label: '倍率', inputLabel: '价格倍率', placeholder: '例如 2 表示翻倍' },
  { value: 'discount', label: '折扣', inputLabel: '折扣比例 %', placeholder: '例如 30 表示降价30%' },
  { value: 'increase', label: '加价%', inputLabel: '加价比例 %', placeholder: '例如 20 表示涨价20%' },
];

function readStoredProductFilters(): {
  shopId?: string;
  warehouseId?: number | null;
  warehouseStockMode?: WarehouseStockMode;
  statusFilter?: ProductStatusFilter;
  priceMin?: string;
  priceMax?: string;
  weightMin?: string;
  weightMax?: string;
  stockMin?: string;
  stockMax?: string;
} {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PRODUCT_FILTERS_STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, unknown>;
    const statusFilter = ['current', 'archived', 'missing', 'all'].includes(String(data.statusFilter || ''))
      ? data.statusFilter as ProductStatusFilter
      : undefined;
    const warehouseStockMode = ['all', 'in_stock', 'out_of_stock'].includes(String(data.warehouseStockMode || ''))
      ? data.warehouseStockMode as WarehouseStockMode
      : (data.warehouseInStockOnly === true ? 'in_stock' : undefined);
    const warehouseId = Number(data.warehouseId);
    return {
      shopId: typeof data.shopId === 'string' ? data.shopId : undefined,
      warehouseId: Number.isFinite(warehouseId) && warehouseId > 0 ? warehouseId : null,
      warehouseStockMode,
      statusFilter,
      priceMin: typeof data.priceMin === 'string' ? data.priceMin : undefined,
      priceMax: typeof data.priceMax === 'string' ? data.priceMax : undefined,
      weightMin: typeof data.weightMin === 'string' ? data.weightMin : undefined,
      weightMax: typeof data.weightMax === 'string' ? data.weightMax : undefined,
      stockMin: typeof data.stockMin === 'string' ? data.stockMin : undefined,
      stockMax: typeof data.stockMax === 'string' ? data.stockMax : undefined,
    };
  } catch {
    return {};
  }
}

function calculateProductBatchPreview(price: unknown, mode: BatchPriceMode, rawValue: string): number | null {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === 'set') return Math.round(value * 100) / 100;
  const base = Number(price);
  if (!Number.isFinite(base) || base <= 0) return null;
  if (mode === 'multiply') return Math.round(base * value * 100) / 100;
  if (mode === 'discount') return value >= 100 ? null : Math.round(base * (1 - value / 100) * 100) / 100;
  return Math.round(base * (1 + value / 100) * 100) / 100;
}

function formatRubPrice(value: number | null): string {
  return value == null ? '-' : `${value.toFixed(2)} RUB`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function isProductMutable(product: Product): boolean {
  const visibility = String(product.visibility || '').toUpperCase();
  const syncStatus = String(product.syncStatus || '').toUpperCase();
  return !!product.platformProductId && visibility !== 'ARCHIVED' && visibility !== 'MISSING' && syncStatus !== 'MISSING';
}

function getDisplaySku(product: { sku?: string | null }): string | null {
  const sku = String(product.sku || '').trim();
  return sku && sku !== '0' ? sku : null;
}

// PLACEHOLDER_INNER_COMPONENT

function ProductsPageInner() {
  const searchParams = useSearchParams();
  const initialShopId = searchParams.get('shopId') || '';

  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState(initialShopId);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [priceValue, setPriceValue] = useState('');
  const [stockValue, setStockValue] = useState('');
  const [batchPriceOpen, setBatchPriceOpen] = useState(false);
  const [batchStockOpen, setBatchStockOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [stockSyncOpen, setStockSyncOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<OzonWarehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [warehouseStockMode, setWarehouseStockMode] = useState<WarehouseStockMode>('all');
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>('current');
  const [statusCounts, setStatusCounts] = useState<ProductStatusCounts>(EMPTY_STATUS_COUNTS);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<BatchAction>('price');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState('');
  const [stockMin, setStockMin] = useState('');
  const [stockMax, setStockMax] = useState('');
  const [filtersRestored, setFiltersRestored] = useState(false);
  const [syncingCommissions, setSyncingCommissions] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [lastProductSyncAt, setLastProductSyncAt] = useState<string | null>(null);

  const limit = 20;

  useEffect(() => {
    const stored = readStoredProductFilters();
    if (!initialShopId && stored.shopId) setShopId(stored.shopId);
    if (stored.warehouseId) setSelectedWarehouseId(stored.warehouseId);
    if (stored.warehouseStockMode) setWarehouseStockMode(stored.warehouseStockMode);
    if (stored.statusFilter) setStatusFilter(stored.statusFilter);
    setPriceMin(stored.priceMin || '');
    setPriceMax(stored.priceMax || '');
    setWeightMin(stored.weightMin || '');
    setWeightMax(stored.weightMax || '');
    setStockMin(stored.stockMin || '');
    setStockMax(stored.stockMax || '');
    setFiltersRestored(true);
  }, []);

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        setShops(res.data);
        if (res.data.length > 0 && (!shopId || !res.data.some((shop) => shop.id === shopId))) {
          setShopId(res.data[0]!.id);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (shopId) {
      api.get<OzonWarehouse[]>(`/api/products/warehouses/${shopId}`).then((res) => {
        if (res.code === 1 && res.data) {
          setWarehouses(res.data);
          setSelectedWarehouseId((current) => {
            if (!current || res.data!.some((warehouse) => warehouse.warehouse_id === current)) return current;
            setWarehouseStockMode('all');
            return null;
          });
        }
      });
    }
  }, [shopId]);

  useEffect(() => {
    if (!filtersRestored) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PRODUCT_FILTERS_STORAGE_KEY, JSON.stringify({
      shopId,
      warehouseId: selectedWarehouseId,
      warehouseStockMode,
      statusFilter,
      priceMin,
      priceMax,
      weightMin,
      weightMax,
      stockMin,
      stockMax,
    }));
  }, [filtersRestored, shopId, selectedWarehouseId, warehouseStockMode, statusFilter, priceMin, priceMax, weightMin, weightMax, stockMin, stockMax]);

  const loadProducts = useCallback(async () => {
    if (!filtersRestored || !shopId) return;
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(page * limit),
      limit: String(limit),
      statusFilter,
    });
    if (search) params.set('search', search);
    if (selectedWarehouseId) params.set('warehouseId', String(selectedWarehouseId));
    if (priceMin.trim()) params.set('priceMin', priceMin.trim());
    if (priceMax.trim()) params.set('priceMax', priceMax.trim());
    if (weightMin.trim()) params.set('weightMin', weightMin.trim());
    if (weightMax.trim()) params.set('weightMax', weightMax.trim());
    if (stockMin.trim()) params.set('stockMin', stockMin.trim());
    if (stockMax.trim()) params.set('stockMax', stockMax.trim());
    if (warehouseStockMode !== 'all') params.set('warehouseStockMode', warehouseStockMode);

    const res = await api.get<ProductListResponse>(
      `/api/shops/${shopId}/products?${params}`,
    );
    if (res.code === 1 && res.data) {
      setProducts(res.data.rows);
      setTotal(res.data.total);
      setLastProductSyncAt(res.data.lastSyncAt);
      setStatusCounts(res.data.statusCounts || EMPTY_STATUS_COUNTS);
    }
    setLoading(false);
  }, [filtersRestored, shopId, page, search, selectedWarehouseId, warehouseStockMode, statusFilter, priceMin, priceMax, weightMin, weightMax, stockMin, stockMax]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.id)));
    }
  }

  async function savePrice(productId: string) {
    if (!priceValue.trim()) return;
    const res = await api.put(`/api/products/${productId}/price`, { price: priceValue });
    if (res.code === 1) {
      toast({ title: '价格已更新' });
      setEditingPrice(null);
      loadProducts();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  async function saveStock(productId: string) {
    const val = parseInt(stockValue);
    if (isNaN(val) || val < 0) return;
    const whId = selectedWarehouseId || (warehouses[0]?.warehouse_id);
    const body: { stock: number; warehouseId?: number } = { stock: val };
    if (whId) body.warehouseId = whId;
    const res = await api.put(`/api/products/${productId}/stock`, body);
    if (res.code === 1) {
      toast({ title: '库存已更新' });
      setEditingStock(null);
      loadProducts();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  async function handleArchive(archive: boolean) {
    if (selected.size === 0) return;
    const res = await api.post('/api/products/archive', {
      productIds: Array.from(selected),
      archive,
    });
    if (res.code === 1) {
      toast({ title: res.msg });
      setSelected(new Set());
      loadProducts();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  async function handleSyncCommissions() {
    setSyncingCommissions(true);
    const res = await api.post('/api/products/sync-commissions', {});
    setSyncingCommissions(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      loadProducts();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  async function handleSyncProducts() {
    setSyncDialogOpen(true);
  }

  function handleStatusTab(nextStatus: ProductStatusFilter) {
    if (nextStatus === statusFilter) return;
    setStatusFilter(nextStatus);
    setPage(0);
    setSelected(new Set());
  }

  function runBatchAction() {
    if (batchAction === 'price') {
      setBatchPriceOpen(true);
      return;
    }
    if (batchAction === 'stock') {
      setBatchStockOpen(true);
      return;
    }
    handleArchive(batchAction === 'archive');
  }

  const totalPages = Math.ceil(total / limit);
  const selectedCount = selected.size;
  const hasAdvancedFilters = warehouseStockMode !== 'all'
    || Boolean(priceMin || priceMax || weightMin || weightMax || stockMin || stockMax);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">商品管理</h1>
          <p className="text-muted-foreground mt-1">查看、编辑价格/库存，批量操作商品</p>
        </div>
      </div>

      <OzonExtensionSyncStatus dense />

      <Card>
        <CardContent className="p-3 md:p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={shopId}
              onChange={(e) => {
                setShopId(e.target.value);
                setPage(0);
                setSelected(new Set());
                setSelectedWarehouseId(null);
                setWarehouseStockMode('all');
              }}
              className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部店铺</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>
              ))}
            </select>

            {warehouses.length > 0 && (
              <select
                value={selectedWarehouseId || ''}
                onChange={(e) => {
                  const nextWarehouseId = e.target.value ? Number(e.target.value) : null;
                  setSelectedWarehouseId(nextWarehouseId);
                  if (!nextWarehouseId) setWarehouseStockMode('all');
                  setPage(0);
                  setSelected(new Set());
                }}
                className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">库存视图：全部仓库（总库存）</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>
                ))}
              </select>
            )}

            <form onSubmit={handleSearch} className="flex min-w-[260px] flex-1 items-center gap-2 md:max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索 SKU / Offer ID / 标题"
                  className="h-9 pl-9"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="outline">搜索</Button>
            </form>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncProducts}
                disabled={!shops.length}
                title="选择店铺后从 OZON 同步商品、状态、库存和上架时间"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                同步 OZON
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncCommissions}
                disabled={syncingCommissions}
                title="从 OZON 同步真实佣金率"
              >
                {syncingCommissions ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DollarSign className="h-3.5 w-3.5" />}
                同步佣金
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStockSyncOpen(true)}
                disabled={!shopId}
                title="检查并推送本地库存到 OZON"
              >
                <Upload className="h-3.5 w-3.5" />
                库存推送
              </Button>
              <Button size="sm" variant="outline" onClick={loadProducts} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                刷新本页
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="商品状态筛选">
              {PRODUCT_STATUS_TABS.map((tab) => {
                const active = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleStatusTab(tab.value)}
                    className={`h-8 rounded-md border px-3 text-xs font-medium transition-colors ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                    <span className={`ml-2 tabular-nums ${active ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {statusCounts[tab.value]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={advancedFiltersOpen || hasAdvancedFilters ? 'secondary' : 'outline'}
                onClick={() => setAdvancedFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                高级筛选
                {hasAdvancedFilters && <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px]">已启用</Badge>}
              </Button>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>最后同步：{lastProductSyncAt ? formatDateTime(lastProductSyncAt) : '从未同步'}</span>
                <span className="hidden sm:inline">·</span>
                <span>当前 {total} 件</span>
              </div>
            </div>
          </div>

          {advancedFiltersOpen && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={warehouseStockMode}
                  onChange={(e) => { setWarehouseStockMode(e.target.value as WarehouseStockMode); setPage(0); setSelected(new Set()); }}
                  disabled={!selectedWarehouseId}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                >
                  <option value="all">仓库库存：全部</option>
                  <option value="in_stock">该仓有库存</option>
                  <option value="out_of_stock">该仓无库存</option>
                </select>
                {!selectedWarehouseId && (
                  <span className="text-xs text-muted-foreground">选择具体仓库后可按该仓库存筛选</span>
                )}
                {hasAdvancedFilters && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setWarehouseStockMode('all');
                      setPriceMin('');
                      setPriceMax('');
                      setWeightMin('');
                      setWeightMax('');
                      setStockMin('');
                      setStockMax('');
                      setPage(0);
                      setSelected(new Set());
                    }}
                  >
                    清空筛选
                  </Button>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceMin}
                  onChange={(e) => { setPriceMin(e.target.value); setPage(0); }}
                  placeholder="最低售价"
                  className="h-9"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceMax}
                  onChange={(e) => { setPriceMax(e.target.value); setPage(0); }}
                  placeholder="最高售价"
                  className="h-9"
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={weightMin}
                  onChange={(e) => { setWeightMin(e.target.value); setPage(0); }}
                  placeholder="最低重量(g)"
                  className="h-9"
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={weightMax}
                  onChange={(e) => { setWeightMax(e.target.value); setPage(0); }}
                  placeholder="最高重量(g)"
                  className="h-9"
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={stockMin}
                  onChange={(e) => { setStockMin(e.target.value); setPage(0); }}
                  placeholder="最低库存"
                  className="h-9"
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={stockMax}
                  onChange={(e) => { setStockMax(e.target.value); setPage(0); }}
                  placeholder="最高库存"
                  className="h-9"
                />
              </div>
            </div>
          )}

          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">已选 {selectedCount} 件</span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={batchAction}
                  onChange={(e) => setBatchAction(e.target.value as BatchAction)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="price">批量改价</option>
                  <option value="stock">批量改库存</option>
                  <option value="archive">下架/归档</option>
                  <option value="restore">上架恢复</option>
                </select>
                <Button size="sm" onClick={runBatchAction}>
                  {batchAction === 'price' && <DollarSign className="h-3.5 w-3.5" />}
                  {batchAction === 'stock' && <Boxes className="h-3.5 w-3.5" />}
                  执行
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <X className="h-3.5 w-3.5" /> 取消选择
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && products.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
              暂无商品。请先在店铺管理中执行同步。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === products.length && products.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </TableHead>
                  <TableHead className="min-w-[360px]">商品 / Ozon 信息</TableHead>
                  <TableHead className="min-w-[150px] text-right">价格 / 佣金</TableHead>
                  <TableHead className="min-w-[120px] text-right">库存 / 规格</TableHead>
                  <TableHead className="min-w-[150px]">状态</TableHead>
                  <TableHead className="min-w-[145px]">时间</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const mutable = isProductMutable(p);
                  const displaySku = getDisplaySku(p);
                  return (
                  <TableRow key={p.id} className={selected.has(p.id) ? 'bg-muted/30' : ''}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-gray-300"
                      />
                    </TableCell>
                    <TableCell className="min-w-[360px]">
                      <div className="flex items-start gap-3">
                        <ProductImage src={p.images?.[0]} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p
                            className="line-clamp-2 cursor-pointer text-sm font-medium leading-5 hover:text-primary hover:underline"
                            onClick={() => setPreviewProductId(p.id)}
                          >
                            {p.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
                            {displaySku ? <span>SKU {displaySku}</span> : <span>SKU 待生成</span>}
                            {p.offerId && <span>Offer {p.offerId}</span>}
                            {p.platformProductId && <span>PID {p.platformProductId}</span>}
                          </div>
                          {p.categoryId && <div className="text-[11px] text-muted-foreground">类目 {p.categoryId}</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {editingPrice === p.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            className="w-24 h-7 text-xs"
                            value={priceValue}
                            onChange={(e) => setPriceValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') savePrice(p.id); if (e.key === 'Escape') setEditingPrice(null); }}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => savePrice(p.id)}>
                            <Check className="h-3 w-3 text-emerald-600" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingPrice(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className={`group inline-flex items-center gap-1 ${mutable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                          onClick={() => {
                            if (!mutable) {
                              toast({ title: '商品不可操作，请先同步并确认仍在售', variant: 'destructive' });
                              return;
                            }
                            setEditingPrice(p.id);
                            setPriceValue(p.price || '');
                          }}
                        >
                          <span className="tabular-nums font-medium">{p.price ? `${p.price} ${p.currency || 'USD'}` : '-'}</span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                        </div>
                      )}
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        <div>折前 {p.oldPrice ? `${p.oldPrice} ${p.currency || 'USD'}` : '-'}</div>
                        <div>
                          佣金 {p.price ? (
                            p.commissionRate ? (
                              <span title={`佣金率: ${p.commissionRate}%`}>
                                {(Number(p.price) * Number(p.commissionRate) / 100).toFixed(2)}
                                <span className="ml-1 opacity-60">({p.commissionRate}%)</span>
                              </span>
                            ) : (
                              <span className="opacity-60" title="估算值(15%)">
                                {(Number(p.price) * 0.15).toFixed(2)}~
                              </span>
                            )
                          ) : '-'}
                        </div>
                        {p.minPrice && <div>最低 {p.minPrice}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {editingStock === p.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            type="number"
                            className="w-20 h-7 text-xs"
                            value={stockValue}
                            onChange={(e) => setStockValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveStock(p.id); if (e.key === 'Escape') setEditingStock(null); }}
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => saveStock(p.id)}>
                            <Check className="h-3 w-3 text-emerald-600" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingStock(null)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className={`group inline-flex items-center gap-1 ${mutable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                          onClick={() => {
                            if (!mutable) {
                              toast({ title: '商品不可操作，请先同步并确认仍在售', variant: 'destructive' });
                              return;
                            }
                            setEditingStock(p.id);
                            setStockValue(String(p.warehouseStock ?? p.stock));
                          }}
                        >
                          <span className={`tabular-nums font-medium ${(p.warehouseStock ?? p.stock) <= 0 ? 'text-destructive' : ''}`}>
                            {p.warehouseStock ?? p.stock}
                          </span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                        </div>
                      )}
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        <div>{p.weight != null ? `${p.weight} g` : '重量 -'}</div>
                        <div>{selectedWarehouseId ? '当前仓库存' : '总库存'}</div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge
                        status={p.status}
                        visibility={p.visibility}
                        syncStatus={p.syncStatus}
                        ozonStatusName={p.ozonStatusName}
                        ozonStatusDescription={p.ozonStatusDescription}
                        ozonModerateStatus={p.ozonModerateStatus}
                        ozonStatusTone={p.ozonStatusTone}
                      />
                    </TableCell>
                    <TableCell className="align-top text-xs text-muted-foreground">
                      <div>创建 {formatDateTime(p.ozonCreatedAt || p.createdAt)}</div>
                      <div>更新 {formatDateTime(p.ozonUpdatedAt || p.updatedAt)}</div>
                      {p.lastOzonSyncAt && <div>同步 {formatDateTime(p.lastOzonSyncAt)}</div>}
                    </TableCell>
                    <TableCell className="align-top">
                      <button type="button" onClick={() => setDetailProductId(p.id)} className="text-xs text-primary hover:underline">编辑</button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一页</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <BatchPriceDialog
        open={batchPriceOpen}
        onOpenChange={setBatchPriceOpen}
        productIds={Array.from(selected)}
        products={products.filter((product) => selected.has(product.id))}
        onSuccess={() => { setSelected(new Set()); loadProducts(); }}
      />
      <BatchStockDialog
        open={batchStockOpen}
        onOpenChange={setBatchStockOpen}
        productIds={Array.from(selected)}
        warehouses={warehouses}
        defaultWarehouseId={selectedWarehouseId}
        onSuccess={() => { setSelected(new Set()); loadProducts(); }}
      />
      <ProductDetailDialog
        productId={detailProductId}
        onClose={() => setDetailProductId(null)}
        onUpdated={loadProducts}
        warehouses={warehouses}
      />
      <ProductPreviewDialog
        productId={previewProductId}
        onClose={() => setPreviewProductId(null)}
        onEdit={(id) => { setPreviewProductId(null); setDetailProductId(id); }}
      />
      <StockSyncDialog
        open={stockSyncOpen}
        shopId={shopId}
        warehouses={warehouses}
        onClose={() => setStockSyncOpen(false)}
        onSynced={loadProducts}
      />
      <OzonSyncActionDialog
        open={syncDialogOpen}
        onOpenChange={setSyncDialogOpen}
        defaultShopId={shopId}
        defaultTypes={['PRODUCT_PULL']}
        title="同步 Ozon 在线商品"
        onQueued={() => {
          loadProducts();
          window.setTimeout(loadProducts, 8000);
        }}
      />
    </div>
  );
}

function ProductImage({ src }: { src?: string }) {
  if (!src) {
    return (
      <div className="h-11 w-11 rounded-md border bg-muted flex items-center justify-center">
        <ImageOff className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="h-11 w-11 rounded-md border object-cover bg-muted"
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}

function StatusBadge({
  status,
  visibility,
  syncStatus,
  ozonStatusName,
  ozonStatusDescription,
  ozonModerateStatus,
  ozonStatusTone,
}: {
  status: string | null;
  visibility: string | null;
  syncStatus?: string | null;
  ozonStatusName?: string | null;
  ozonStatusDescription?: string | null;
  ozonModerateStatus?: string | null;
  ozonStatusTone?: OzonStatusTone | null;
}) {
  const visibilityKey = String(visibility || '').toLowerCase();
  const syncKey = String(syncStatus || '').toLowerCase();
  if (visibilityKey === 'missing' || syncKey === 'missing') {
    return <Badge variant="destructive" title="最近一次同步时 OZON 当前商品列表未返回该商品">同步缺失</Badge>;
  }
  if (visibilityKey === 'archived') return <Badge variant="secondary">已下架</Badge>;
  const label = ozonStatusName || ozonStatusDescription || status || '-';
  if (ozonStatusTone) {
    return <Badge variant={getStatusBadgeVariant(ozonStatusTone)} title={ozonStatusDescription || undefined}>{label}</Badge>;
  }
  const key = `${status || ''} ${ozonStatusName || ''} ${ozonStatusDescription || ''} ${ozonModerateStatus || ''}`.toLowerCase();
  if (key.includes('failed') || key.includes('reject') || key.includes('ошиб') || key.includes('отклон')) {
    return <Badge variant="destructive" title={ozonStatusDescription || undefined}>{label}</Badge>;
  }

  if (key.includes('moder') || key.includes('модерац') || key.includes('провер')) {
    return <Badge variant="warning" title={ozonStatusDescription || undefined}>{label}</Badge>;
  }
  if (key.includes('price_sent') || key.includes('processed') || key.includes('sale') || key.includes('прода') || key.includes('готов')) {
    return <Badge variant="success" title={ozonStatusDescription || undefined}>{label}</Badge>;
  }
  return <Badge variant="secondary" title={ozonStatusDescription || undefined}>{label}</Badge>;
}

function getStatusBadgeVariant(tone: OzonStatusTone): 'success' | 'warning' | 'destructive' | 'secondary' | 'default' {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'danger') return 'destructive';
  if (tone === 'info') return 'default';
  return 'secondary';
}

function BatchPriceDialog({ open, onOpenChange, productIds, products, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productIds: string[];
  products: Product[];
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<BatchPriceMode>('set');
  const [submitting, setSubmitting] = useState(false);
  const activeMode = BATCH_PRICE_MODES.find((item) => item.value === mode) || BATCH_PRICE_MODES[0]!;
  const previewRows = products.map((product) => ({
    product,
    current: Number(product.price),
    next: calculateProductBatchPreview(product.price, mode, value),
  }));
  const hasValidInput = previewRows.some((row) => row.next != null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;
    if (mode === 'discount' && numericValue >= 100) {
      toast({ title: '折扣比例必须小于 100%', variant: 'destructive' });
      return;
    }
    setSubmitting(true);

    const payload = mode === 'set'
      ? {
          items: productIds.map((id) => ({
            productId: id,
            price: numericValue.toFixed(2),
          })),
        }
      : {
          productIds,
          mode,
          value: numericValue,
        };

    const res = await api.post('/api/products/batch-price', payload);
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setValue('');
      setMode('set');
      onOpenChange(false);
      onSuccess();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量修改价格</DialogTitle>
          <DialogDescription>将为选中的 {productIds.length} 件商品计算并同步新价格</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {BATCH_PRICE_MODES.map((item) => (
              <Button
                key={item.value}
                type="button"
                size="sm"
                variant={mode === item.value ? 'default' : 'outline'}
                onClick={() => setMode(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label>{activeMode.inputLabel}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={activeMode.placeholder}
              required
            />
          </div>
          {value.trim() && (
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="mb-1 text-xs font-medium">价格变更预览</div>
              <div className="max-h-44 space-y-1 overflow-y-auto text-xs">
                {previewRows.slice(0, 10).map(({ product, current, next }) => (
                  <div key={product.id} className="grid grid-cols-[1fr_auto] gap-3 rounded bg-background/70 px-2 py-1">
                    <div className="min-w-0">
                      <div className="truncate">{product.title}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">{product.offerId || product.sku || '-'}</div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div>{Number.isFinite(current) ? current.toFixed(2) : '-'} → {formatRubPrice(next)}</div>
                      {next == null && <div className="text-[10px] text-destructive">缺少有效当前价</div>}
                    </div>
                  </div>
                ))}
              </div>
              {previewRows.length > 10 && (
                <div className="pt-1 text-[10px] text-muted-foreground">还有 {previewRows.length - 10} 件未展示</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting || !hasValidInput}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BatchStockDialog({ open, onOpenChange, productIds, warehouses, defaultWarehouseId, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productIds: string[];
  warehouses: OzonWarehouse[];
  defaultWarehouseId?: number | null;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const defaultWarehouse = defaultWarehouseId
      ? warehouses.find((warehouse) => warehouse.warehouse_id === defaultWarehouseId)
      : null;
    setWarehouseId(defaultWarehouse ? String(defaultWarehouse.warehouse_id) : (warehouses[0] ? String(warehouses[0].warehouse_id) : ''));
  }, [open, warehouses, defaultWarehouseId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stock = parseInt(value);
    if (isNaN(stock) || stock < 0) return;
    const selectedWarehouse = Number(warehouseId);
    if (!Number.isInteger(selectedWarehouse) || selectedWarehouse <= 0) {
      toast({ title: '请选择仓库', variant: 'destructive' });
      return;
    }
    setSubmitting(true);

    const items = productIds.map((id) => ({ productId: id, stock }));
    const res = await api.post('/api/products/batch-stock', {
      items,
      warehouseId: selectedWarehouse,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setValue('');
      onOpenChange(false);
      onSuccess();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }
  const canSubmit = !!value.trim() && !!warehouseId && warehouses.length > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量修改库存</DialogTitle>
          <DialogDescription>将为选中的 {productIds.length} 件商品在目标仓库设置新库存</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>目标仓库</Label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              disabled={!warehouses.length || submitting}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {!warehouses.length && <option value="">仓库加载中或未同步</option>}
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>
              ))}
            </select>
            {!warehouses.length && (
              <p className="text-xs text-muted-foreground">请先刷新仓库或等待仓库列表加载完成</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>新库存数量</Label>
            <Input
              type="number"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入统一库存数量"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductPreviewDialog({ productId, onClose, onEdit }: {
  productId: string | null;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId) { setDetail(null); return; }
    setLoading(true);
    api.get(`/api/products/${productId}/detail`).then((res: any) => {
      if (res.code === 1 && res.data) setDetail(res.data);
      setLoading(false);
    });
  }, [productId]);

  return (
    <Dialog open={!!productId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">商品预览</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              {detail.images?.[0] ? (
                <img src={detail.images[0]} alt="" className="h-24 w-24 rounded-md border object-cover shrink-0" />
              ) : (
                <div className="h-24 w-24 rounded-md border bg-muted flex items-center justify-center shrink-0">
                  <ImageOff className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-base leading-tight">{detail.title}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{detail.platform}</Badge>
                  <span>{detail.shopName}</span>
                  <StatusBadge status={detail.status} visibility={detail.visibility} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border rounded-md p-3 bg-muted/30">
              <div><span className="text-muted-foreground text-xs">价格</span><p className="font-medium">{detail.price ? `${detail.price} ${detail.currency}` : '—'}</p></div>
              <div><span className="text-muted-foreground text-xs">库存</span><p className="font-medium">{detail.stock ?? 0}</p></div>
              <div><span className="text-muted-foreground text-xs">SKU</span><p className="font-mono text-xs">{getDisplaySku(detail) || '待生成'}</p></div>
              <div><span className="text-muted-foreground text-xs">Offer ID</span><p className="font-mono text-xs">{detail.offerId || '—'}</p></div>
            </div>

            {detail.platformData && (
              <div className="border rounded-md p-3 bg-muted/20 space-y-2">
                <span className="text-xs font-medium text-muted-foreground">平台实时数据</span>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">实时价格</span>
                    <p className="font-medium">{detail.platformData.price} {detail.platformData.currency_code}</p>
                    {detail.platformData.old_price && detail.platformData.old_price !== '0.000000' && (
                      <p className="text-xs text-muted-foreground line-through">{detail.platformData.old_price}</p>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">平台状态</span>
                    <p className="font-medium">{detail.platformData.statuses?.status_name || detail.platformData.statuses?.status || '—'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">审核状态</span>
                    <p className="font-medium">{detail.platformData.statuses?.moderate_status || '—'}</p>
                  </div>
                  {detail.platformData.stocks?.stocks && detail.platformData.stocks.stocks.length > 0 && (
                    <div className="col-span-full">
                      <span className="text-muted-foreground text-xs">库存明细</span>
                      <div className="flex flex-wrap gap-3 mt-1">
                        {detail.platformData.stocks.stocks.map((s: any, i: number) => (
                          <span key={i} className="text-xs border rounded px-2 py-0.5">
                            {s.source === 'fbo' ? 'FBO' : s.source === 'fbs' ? 'FBS' : s.source}: 现有 {s.present} / 预留 {s.reserved}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground text-xs">创建时间</span>
                    <p className="text-xs">{detail.platformData.created_at ? new Date(detail.platformData.created_at).toLocaleDateString('zh-CN') : '—'}</p>
                  </div>
                  {detail.platformData.updated_at && (
                    <div>
                      <span className="text-muted-foreground text-xs">更新时间</span>
                      <p className="text-xs">{new Date(detail.platformData.updated_at).toLocaleDateString('zh-CN')}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {detail.images && detail.images.length > 1 && (
              <div>
                <span className="text-xs text-muted-foreground">图片 ({detail.images.length})</span>
                <div className="flex gap-2 mt-1.5 overflow-x-auto pb-2">
                  {detail.images.map((img: string, i: number) => (
                    <img key={i} src={img} alt="" className="h-16 w-16 rounded border object-cover shrink-0" />
                  ))}
                </div>
              </div>
            )}

            {detail.relatedOrders && detail.relatedOrders.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">近期订单 ({detail.relatedOrders.length})</span>
                <div className="mt-1.5 space-y-1">
                  {detail.relatedOrders.slice(0, 5).map((o: any) => (
                    <div key={o.id} className="flex items-center justify-between text-xs border rounded px-2 py-1.5">
                      <span className="font-mono">{o.postingNumber || o.platformOrderId}</span>
                      <Badge variant="secondary" className="text-[10px]">{o.status}</Badge>
                      <span>{(() => {
                        const f = formatOrderAmount(o.totalAmount, o.currency, o.totalAmountCny);
                        return <span title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>{f.display}</span>;
                      })()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {productId && <Button onClick={() => onEdit(productId)}><Pencil className="h-4 w-4" /> 编辑</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getAttrDisplayName(attr: { id: number; name?: string }): string {
  return getOzonAttrName(attr);
}

type EditTabKey = 'basic' | 'attributes' | 'description' | 'media';
const EDIT_TABS: { key: EditTabKey; label: string }[] = [
  { key: 'basic', label: '基本设置' },
  { key: 'attributes', label: '产品属性' },
  { key: 'description', label: '描述信息' },
  { key: 'media', label: '多媒体' },
];
function ProductDetailDialog({ productId, onClose, onUpdated, warehouses: parentWarehouses }: {
  productId: string | null;
  onClose: () => void;
  onUpdated: () => void;
  warehouses: OzonWarehouse[];
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<EditTabKey>('basic');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [editAttributes, setEditAttributes] = useState<{ id: number; name?: string; values: { value: string }[] }[]>([]);
  const [productWarehouses, setProductWarehouses] = useState<OzonWarehouse[]>([]);
  const [wmTemplates, setWmTemplates] = useState<{ id: string; name: string; type: string; text: string | null; imageUrl: string | null; position: string; opacity: number; fontSize: number | null; fontColor: string | null; scale: number | null; isDefault: boolean }[]>([]);
  const [wmSelectedTemplate, setWmSelectedTemplate] = useState('');
  const [wmProcessing, setWmProcessing] = useState(false);

  useEffect(() => {
    api.get<any[]>('/api/watermark-templates').then((res) => {
      if (res.code === 1 && res.data) {
        setWmTemplates(res.data);
        const def = res.data.find((t: any) => t.isDefault);
        if (def) setWmSelectedTemplate(def.id);
      }
    });
  }, []);

  useEffect(() => {
    if (!productId) { setDetail(null); setProductWarehouses([]); setActiveTab('basic'); return; }
    setLoading(true);
    api.get(`/api/products/${productId}/detail`).then((res: any) => {
      if (res.code === 1 && res.data) {
        const d = res.data;
        setDetail(d);
        setEditTitle(d.title || '');
        setEditPrice(d.price || '');
        setEditStock(String(d.stock ?? 0));
        setEditDescription(d.description || '');
        setEditImages(Array.isArray(d.images) ? d.images : []);
        setEditAttributes(Array.isArray(d.attributes) ? d.attributes : []);
        if (d.shop?.id || d.shopId) {
          api.get<OzonWarehouse[]>(`/api/products/warehouses/${d.shop?.id || d.shopId}`).then((whRes: any) => {
            if (whRes.code === 1 && whRes.data) setProductWarehouses(whRes.data);
          });
        }
      }
      setLoading(false);
    });
  }, [productId]);

  useEffect(() => {
    const missingNames = editAttributes.length > 0 && editAttributes.every((a) => !a.name);
    if (detail && (!editAttributes || editAttributes.length === 0 || missingNames) && detail.platformProductId && !refreshing) {
      refreshFromOzon(true);
    }
  }, [detail?.id]);

  async function refreshFromOzon(silent = false) {
    if (!detail?.platformProductId || !productId) return;
    setRefreshing(true);
    const res = await api.post<{ attributes: any[]; images: string[]; title?: string; description?: string }>(`/api/products/${productId}/refresh-attributes`);
    setRefreshing(false);
    if (res.code === 1 && res.data) {
      if (Array.isArray(res.data.attributes)) setEditAttributes(res.data.attributes);
      if (Array.isArray(res.data.images) && res.data.images.length) setEditImages(res.data.images);
      if (res.data.title) setEditTitle(res.data.title);
      if (res.data.description) setEditDescription(res.data.description);
      if (!silent) toast({ title: '已从 OZON 拉取最新数据' });
    } else if (!silent) {
      toast({ title: '刷新失败', description: res.msg, variant: 'destructive' });
    }
  }

  async function handleSave() {
    if (!productId) return;
    setSaving(true);
    const promises: Promise<any>[] = [];

    if (activeTab === 'basic') {
      if (editPrice !== detail?.price) {
        promises.push(api.put(`/api/products/${productId}/price`, { price: editPrice }));
      }
      if (editStock !== String(detail?.stock ?? 0)) {
        const val = parseInt(editStock);
        if (!isNaN(val) && val >= 0) {
          const wh = productWarehouses[0] || parentWarehouses[0];
          const body: { stock: number; warehouseId?: number } = { stock: val };
          if (wh) body.warehouseId = wh.warehouse_id;
          promises.push(api.put(`/api/products/${productId}/stock`, body));
        }
      }
      if (editTitle !== detail?.title) {
        promises.push(api.put(`/api/products/${productId}/attributes`, { title: editTitle }));
      }
    }
    if (activeTab === 'description') {
      promises.push(api.put(`/api/products/${productId}/attributes`, { title: editTitle, description: editDescription }));
    }
    if (activeTab === 'attributes' && editAttributes.length) {
      promises.push(api.put(`/api/products/${productId}/attributes`, { attributes: editAttributes }));
    }
    if (activeTab === 'media') {
      promises.push(api.post(`/api/products/${productId}/images`, { images: editImages }));
    }

    if (promises.length === 0) { setSaving(false); return; }
    const results = await Promise.all(promises);
    setSaving(false);
    const failed = results.find((r) => r.code !== 1);
    if (failed) {
      toast({ title: '保存失败', description: failed.msg, variant: 'destructive' });
    } else {
      toast({ title: '已保存' });
      onUpdated();
    }
  }

  function addImage() {
    if (!newImageUrl.trim()) return;
    setEditImages([...editImages, newImageUrl.trim()]);
    setNewImageUrl('');
  }
  function removeImage(index: number) { setEditImages(editImages.filter((_, i) => i !== index)); }
  function moveImage(index: number, direction: -1 | 1) {
    const arr = [...editImages];
    const target = index + direction;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target]!, arr[index]!];
    setEditImages(arr);
  }
  async function handleWatermarkAndReplace() {
    if (!productId) return;
    if (!wmSelectedTemplate) { toast({ title: '请选择水印模板', variant: 'destructive' }); return; }
    const tpl = wmTemplates.find((t) => t.id === wmSelectedTemplate);
    if (!tpl) { toast({ title: '模板不存在', variant: 'destructive' }); return; }
    const config = {
      type: tpl.type,
      text: tpl.text,
      imageUrl: tpl.imageUrl,
      position: tpl.position,
      opacity: tpl.opacity,
      fontSize: tpl.fontSize,
      fontColor: tpl.fontColor,
      scale: tpl.scale,
    };
    setWmProcessing(true);
    const res = await api.post<{ failed: number }>(`/api/products/${productId}/watermark-and-replace`, { config });
    setWmProcessing(false);
    if (res.code === 1) {
      toast({ title: res.msg || '已提交 OZON 替换' });
      // 刷新最新图片
      api.get(`/api/products/${productId}/detail`).then((r: any) => {
        if (r.code === 1 && r.data) setEditImages(Array.isArray(r.data.images) ? r.data.images : []);
      });
    } else {
      toast({ title: res.msg || '水印替换失败', variant: 'destructive' });
    }
  }
  async function handleLocalFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded: string[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) { toast({ title: `${file.name} 超过 20MB`, variant: 'destructive' }); continue; }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.post<{ url: string }>('/api/products/upload-file', { file: base64, filename: file.name, shopId: detail?.shopId });
      if (res.code === 1 && res.data?.url) uploaded.push(res.data.url);
      else toast({ title: `${file.name} 上传失败`, description: res.msg, variant: 'destructive' });
    }
    setUploading(false);
    if (uploaded.length) { setEditImages([...editImages, ...uploaded]); toast({ title: `已上传 ${uploaded.length} 张图片` }); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <Dialog open={!!productId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-0 shrink-0">
          <DialogTitle className="sr-only">编辑商品</DialogTitle>
          {detail && (
            <div className="flex gap-4 items-start">
              {detail.images?.[0] ? (
                <img src={detail.images[0]} alt="" className="h-14 w-14 rounded-md border object-cover shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-md border bg-muted flex items-center justify-center shrink-0">
                  <ImageOff className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-base leading-tight truncate">{detail.title}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{detail.platform}</Badge>
                  <span>{detail.shopName}</span>
                  {getDisplaySku(detail) ? <span>SKU: {getDisplaySku(detail)}</span> : <span>Ozon SKU 待生成</span>}
                  {detail.offerId && <span>Offer: {detail.offerId}</span>}
                  <StatusBadge status={detail.status} visibility={detail.visibility} />
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => refreshFromOzon(false)} disabled={refreshing} className="shrink-0">
                {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                从 OZON 刷新
              </Button>
            </div>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex justify-center items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : detail ? (
          <>
            <div className="flex items-center gap-1 px-6 pt-4 pb-2 border-b shrink-0">
              {EDIT_TABS.map((t) => (
                <Button key={t.key} size="sm" variant={activeTab === t.key ? 'default' : 'ghost'} onClick={() => setActiveTab(t.key)}>
                  {t.label}
                </Button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {activeTab === 'basic' && (
                <div className="space-y-5">
                  <div>
                    <Label className="text-sm">商品标题</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1.5" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm">价格 ({detail.currency})</Label>
                      <Input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                      {detail.oldPrice && <p className="text-xs text-muted-foreground">原价: {detail.oldPrice}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">库存数量</Label>
                      <Input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pt-2 border-t">
                    <div><Label className="text-muted-foreground text-xs">Product ID</Label><p className="mt-1 font-mono text-xs">{detail.platformProductId || '—'}</p></div>
                    <div><Label className="text-muted-foreground text-xs">可见性</Label><p className="mt-1">{detail.visibility || '—'}</p></div>
                    <div><Label className="text-muted-foreground text-xs">佣金率</Label><p className="mt-1">{detail.commissionRate ? `${detail.commissionRate}%` : '—'}</p></div>
                    <div><Label className="text-muted-foreground text-xs">最近同步</Label><p className="mt-1 text-xs">{new Date(detail.updatedAt).toLocaleString('zh-CN')}</p></div>
                  </div>
                </div>
              )}

              {activeTab === 'attributes' && (
                <div>
                  {refreshing && editAttributes.length === 0 ? (
                    <div className="text-sm text-muted-foreground flex items-center gap-2 py-12 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" /> 正在从 OZON 拉取属性...
                    </div>
                  ) : editAttributes.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-12 text-center space-y-3">
                      <p>暂无属性数据</p>
                      <Button size="sm" variant="outline" onClick={() => refreshFromOzon(false)} disabled={refreshing}>
                        <RefreshCw className="h-3.5 w-3.5" /> 从 OZON 拉取
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-medium">商品属性</span>
                        <Badge variant="secondary">{editAttributes.length} 项</Badge>
                      </div>
                      {editAttributes.map((attr, i) => (
                        <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-b-0">
                          <div className="w-40 shrink-0">
                            <span className="text-sm">{getAttrDisplayName(attr)}</span>
                            <p className="text-[10px] text-muted-foreground">ID: {attr.id}</p>
                          </div>
                          <Input
                            value={attr.values?.[0]?.value || ''}
                            onChange={(e) => {
                              const newAttrs = [...editAttributes];
                              newAttrs[i] = { ...attr, values: [{ value: e.target.value }] };
                              setEditAttributes(newAttrs);
                            }}
                            className="flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'description' && (
                <div>
                  <Label className="text-sm">商品描述</Label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full min-h-[350px] mt-1.5 rounded-md border border-input bg-background p-3 text-sm font-mono"
                    placeholder="商品详情描述（支持 HTML）"
                  />
                  <p className="text-xs text-muted-foreground mt-2">支持 HTML 标签，提交后由 OZON 渲染展示</p>
                </div>
              )}

              {activeTab === 'media' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-sm font-medium">图片管理</span>
                      <Badge variant="secondary">{editImages.length} 张</Badge>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                    <div className="text-xs font-medium">打水印并替换 OZON 图片</div>
                    <div className="flex items-center gap-2">
                      <select
                        value={wmSelectedTemplate}
                        onChange={(e) => setWmSelectedTemplate(e.target.value)}
                        className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">— 请选择水印模板 —</option>
                        {wmTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (默认)' : ''}</option>
                        ))}
                      </select>
                      <Button size="sm" onClick={handleWatermarkAndReplace} disabled={wmProcessing || !wmSelectedTemplate}>
                        {wmProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                        打水印并替换
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      处理后的水印图会自动上传到 OZON CDN 并替换源商品图片，OZON 端审核通过后即生效（通常 1-10 分钟）。
                    </p>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
                    {editImages.map((img, i) => (
                      <div key={i} className="relative group border rounded-md overflow-hidden aspect-square bg-muted">
                        <img src={img.startsWith('/') ? apiUrl(img) : img} alt={`图${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          {i > 0 && <button onClick={() => moveImage(i, -1)} className="text-white bg-white/20 rounded p-1 text-xs hover:bg-white/40">前移</button>}
                          {i < editImages.length - 1 && <button onClick={() => moveImage(i, 1)} className="text-white bg-white/20 rounded p-1 text-xs hover:bg-white/40">后移</button>}
                          <button onClick={() => removeImage(i)} className="text-red-300 bg-white/20 rounded p-1 hover:bg-red-500/50"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                        {i === 0 && <Badge className="absolute top-1 left-1 text-[10px]">主图</Badge>}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleLocalFileUpload(e.target.files)} />
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      本地上传
                    </Button>
                    <Input value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} placeholder="或输入图片 URL" className="flex-1" onKeyDown={(e) => e.key === 'Enter' && addImage()} />
                    <Button size="sm" variant="outline" onClick={addImage}><Plus className="h-4 w-4" /></Button>
                  </div>
                  <p className="text-xs text-muted-foreground">支持多选本地文件，单张不超过 20MB</p>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t px-6 py-3 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>关闭</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StockSyncDialog({ open, shopId, warehouses, onClose, onSynced }: {
  open: boolean;
  shopId: string;
  warehouses: OzonWarehouse[];
  onClose: () => void;
  onSynced: () => void;
}) {
  const [diffs, setDiffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checked, setChecked] = useState(0);

  useEffect(() => {
    if (!open || !shopId) return;
    setLoading(true);
    api.get(`/api/products/stock-diff?shopId=${shopId}`).then((res: any) => {
      if (res.code === 1 && res.data) {
        setDiffs(res.data.diffs || []);
        setChecked(res.data.checked || 0);
      }
      setLoading(false);
    });
  }, [open, shopId]);

  async function handleSyncAll() {
    const wh = warehouses[0];
    if (!wh) { toast({ title: '未找到仓库', variant: 'destructive' }); return; }
    setSyncing(true);
    const res = await api.post('/api/products/stock-sync-all', {
      shopId,
      warehouseId: wh.warehouse_id,
    });
    setSyncing(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      onSynced();
      onClose();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>库存推送到 OZON</DialogTitle>
          <DialogDescription>
            对比本地库存与 OZON 平台库存差异，一键推送同步
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已检查 {checked} 件商品</span>
              {diffs.length > 0 ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> {diffs.length} 件库存不一致
                </Badge>
              ) : (
                <Badge variant="success">库存一致</Badge>
              )}
            </div>

            {diffs.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>商品</TableHead>
                    <TableHead className="text-right">本地库存</TableHead>
                    <TableHead className="text-right">平台库存</TableHead>
                    <TableHead className="text-right">差异</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diffs.slice(0, 50).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm max-w-xs truncate">
                        <div>{d.title}</div>
                        <div className="text-xs text-muted-foreground">{d.offerId || d.sku}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{d.localStock}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.platformStock}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${d.diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {d.diff > 0 ? '+' : ''}{d.diff}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {diffs.length > 50 && (
              <p className="text-xs text-muted-foreground text-center">仅显示前 50 条差异</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button onClick={handleSyncAll} disabled={syncing || loading}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            推送全部本地库存到 OZON
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <ProductsPageInner />
    </Suspense>
  );
}
