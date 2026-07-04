'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, RefreshCw, Loader2, ImageOff, Pencil, Check, X,
  Package, DollarSign, Boxes, Upload, AlertTriangle,
  Save, ImageIcon, Trash2, Plus, Clock, SlidersHorizontal, ExternalLink,
  Archive, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
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
  categoryTypeId?: string | null;
  categoryLabel?: string | null;
  commissionRate: string | null;
  minPrice: string | null;
  buyerPriceCny?: string | null;
  buyerSourcePlatform?: string | null;
  profitCny?: string | null;
  profitMarginPct?: string | null;
  profitTier?: ProductProfitFilter | null;
  ozonPriceIndexTier?: ProductProfitFilter | null;
  ozonPriceIndexColor?: 'red' | 'yellow' | 'green' | 'unknown' | null;
  marketingPrice?: string | null;
  competitorMinPrice?: string | null;
  competitorCurrency?: string | null;
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
type BatchPriceField = 'price' | 'oldPrice' | 'minPrice';
type BatchAction = 'price' | 'stock' | 'archive' | 'restore';
type ProductStatusFilter = 'current' | 'archived' | 'missing' | 'all';
type ProductProfitFilter = 'all' | 'unprofitable' | 'medium' | 'profitable' | 'very_profitable' | 'unknown';
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

const PROFIT_FILTER_OPTIONS: Array<{ value: ProductProfitFilter; label: string }> = [
  { value: 'all', label: '收益：全部' },
  { value: 'unprofitable', label: '不利' },
  { value: 'medium', label: '中等' },
  { value: 'profitable', label: '有利' },
  { value: 'very_profitable', label: '超级有利' },
  { value: 'unknown', label: '未计算' },
];

const OZON_PRICE_INDEX_FILTER_OPTIONS: Array<{ value: ProductProfitFilter; label: string }> = [
  { value: 'all', label: 'Ozon价格：全部' },
  { value: 'unprofitable', label: 'Ozon价格：不利' },
  { value: 'profitable', label: 'Ozon价格：有利' },
  { value: 'medium', label: 'Ozon价格：中等' },
  { value: 'very_profitable', label: 'Ozon价格：超级有利' },
  { value: 'unknown', label: 'Ozon价格：未检测' },
];

function getOzonPriceIndexFilterLabel(value: ProductProfitFilter): string {
  return OZON_PRICE_INDEX_FILTER_OPTIONS.find((option) => option.value === value)?.label.replace('Ozon价格：', '') ?? '全部';
}

const BATCH_PRICE_FIELDS: Record<BatchPriceField, { label: string; shortLabel: string }> = {
  price: { label: '销售价', shortLabel: '售价' },
  oldPrice: { label: '划线价', shortLabel: '划线' },
  minPrice: { label: '最低价', shortLabel: '最低' },
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function readStoredProductFilters(): {
  shopId?: string;
  warehouseId?: number | null;
  warehouseStockMode?: WarehouseStockMode;
  statusFilter?: ProductStatusFilter;
  profitFilter?: ProductProfitFilter;
  ozonPriceIndexFilter?: ProductProfitFilter;
  pageSize?: number;
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
    const profitFilter = ['all', 'unprofitable', 'medium', 'profitable', 'very_profitable', 'unknown'].includes(String(data.profitFilter || ''))
      ? data.profitFilter as ProductProfitFilter
      : undefined;
    const ozonPriceIndexFilter = ['all', 'unprofitable', 'medium', 'profitable', 'very_profitable', 'unknown'].includes(String(data.ozonPriceIndexFilter || ''))
      ? data.ozonPriceIndexFilter as ProductProfitFilter
      : undefined;
    const pageSize = Number(data.pageSize);
    const warehouseId = Number(data.warehouseId);
    return {
      shopId: typeof data.shopId === 'string' ? data.shopId : undefined,
      warehouseId: Number.isFinite(warehouseId) && warehouseId > 0 ? warehouseId : null,
      warehouseStockMode,
      statusFilter,
      profitFilter,
      ozonPriceIndexFilter,
      pageSize: PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : undefined,
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

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function compactCurrencySymbol(currency?: string | null): string {
  const code = String(currency || '').trim().toUpperCase();
  if (code === 'RUB') return '₽';
  if (code === 'USD') return '$';
  if (code === 'EUR') return '€';
  if (code === 'KZT') return '₸';
  return '¥';
}

function formatCompactMoney(
  value: unknown,
  currency?: string | null,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string | null {
  const num = toFiniteNumber(value);
  if (num == null) return null;
  return `${compactCurrencySymbol(currency)} ${num.toLocaleString('ru-RU', {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2,
  })}`;
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

function getOzonProductUrl(product: Product): string | null {
  const id = String(product.platformProductId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://www.ozon.ru/product/${id}`;
}

function ProfitBadge({ tier, marginPct }: { tier?: ProductProfitFilter | null; marginPct?: string | null }) {
  if (!tier || tier === 'all' || tier === 'unknown') return null;
  const config: Record<Exclude<ProductProfitFilter, 'all' | 'unknown'>, { label: string; className: string }> = {
    unprofitable: {
      label: '不利',
      className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
    },
    medium: {
      label: '中等',
      className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    },
    profitable: {
      label: '有利',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
    },
    very_profitable: {
      label: '超级有利',
      className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
    },
  };
  const item = config[tier as keyof typeof config];
  if (!item) return null;
  const margin = toFiniteNumber(marginPct);
  return (
    <span className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${item.className}`}>
      {item.label}
      {margin != null && <span className="ml-1 tabular-nums">{margin.toFixed(1)}%</span>}
    </span>
  );
}

function OzonPriceIndexBadge({ tier, competitorPrice }: { tier?: ProductProfitFilter | null; competitorPrice?: string | null }) {
  if (!tier || tier === 'all' || tier === 'unknown') return null;
  const config: Record<Exclude<ProductProfitFilter, 'all' | 'unknown'>, { label: string; className: string }> = {
    unprofitable: {
      label: 'Ozon不利',
      className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300',
    },
    medium: {
      label: 'Ozon中等',
      className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    },
    profitable: {
      label: 'Ozon有利',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
    },
    very_profitable: {
      label: 'Ozon超级有利',
      className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
    },
  };
  const item = config[tier as keyof typeof config];
  if (!item) return null;
  return (
    <span
      className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${item.className}`}
      title={competitorPrice ? `对手价格：${competitorPrice}` : undefined}
    >
      {item.label}
      {competitorPrice && <span className="ml-1 tabular-nums">{competitorPrice}</span>}
    </span>
  );
}

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
  const [priceForm, setPriceForm] = useState({ price: '', oldPrice: '', minPrice: '' });
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
  const [profitFilter, setProfitFilter] = useState<ProductProfitFilter>('all');
  const [ozonPriceIndexFilter, setOzonPriceIndexFilter] = useState<ProductProfitFilter>('all');
  const [statusCounts, setStatusCounts] = useState<ProductStatusCounts>(EMPTY_STATUS_COUNTS);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [priceFilterMenuOpen, setPriceFilterMenuOpen] = useState(false);
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
  const [pageSize, setPageSize] = useState(20);
  const [pageJumpInput, setPageJumpInput] = useState('');
  const priceFilterMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = readStoredProductFilters();
    if (!initialShopId && stored.shopId) setShopId(stored.shopId);
    if (stored.warehouseId) setSelectedWarehouseId(stored.warehouseId);
    if (stored.warehouseStockMode) setWarehouseStockMode(stored.warehouseStockMode);
    if (stored.statusFilter) setStatusFilter(stored.statusFilter);
    if (stored.profitFilter) setProfitFilter(stored.profitFilter);
    if (stored.ozonPriceIndexFilter) setOzonPriceIndexFilter(stored.ozonPriceIndexFilter);
    if (stored.pageSize) setPageSize(stored.pageSize);
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
      profitFilter,
      ozonPriceIndexFilter,
      pageSize,
      priceMin,
      priceMax,
      weightMin,
      weightMax,
      stockMin,
      stockMax,
    }));
  }, [filtersRestored, shopId, selectedWarehouseId, warehouseStockMode, statusFilter, profitFilter, ozonPriceIndexFilter, pageSize, priceMin, priceMax, weightMin, weightMax, stockMin, stockMax]);

  useEffect(() => {
    if (!priceFilterMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (priceFilterMenuRef.current?.contains(event.target as Node)) return;
      setPriceFilterMenuOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [priceFilterMenuOpen]);

  const loadProducts = useCallback(async () => {
    if (!filtersRestored || !shopId) return;
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(page * pageSize),
      limit: String(pageSize),
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
    if (profitFilter !== 'all') params.set('profitFilter', profitFilter);
    if (ozonPriceIndexFilter !== 'all') params.set('ozonPriceIndexFilter', ozonPriceIndexFilter);

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
  }, [filtersRestored, shopId, page, pageSize, search, selectedWarehouseId, warehouseStockMode, statusFilter, profitFilter, ozonPriceIndexFilter, priceMin, priceMax, weightMin, weightMax, stockMin, stockMax]);

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
    if (!priceForm.price.trim()) return;
    const res = await api.put(`/api/products/${productId}/price`, {
      price: priceForm.price,
      oldPrice: priceForm.oldPrice.trim() || undefined,
      minPrice: priceForm.minPrice.trim() || undefined,
    });
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

  async function handleArchiveProduct(productId: string, archive: boolean) {
    const res = await api.post('/api/products/archive', {
      productIds: [productId],
      archive,
    });
    if (res.code === 1) {
      toast({ title: res.msg });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
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

  function jumpToPage(rawValue: string) {
    const target = Number(rawValue);
    if (!Number.isFinite(target)) return;
    const nextPage = Math.min(totalPages - 1, Math.max(0, Math.trunc(target) - 1));
    setPage(nextPage);
    setPageJumpInput('');
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedCount = selected.size;
  const hasAdvancedFilters = warehouseStockMode !== 'all'
    || profitFilter !== 'all'
    || ozonPriceIndexFilter !== 'all'
    || Boolean(priceMin || priceMax || weightMin || weightMax || stockMin || stockMax);
  const selectedShop = shops.find((shop) => shop.id === shopId);
  const selectedShopLabel = selectedShop ? `[${selectedShop.platform}] ${selectedShop.name}` : '未选择店铺';
  const priceFilterLabel = getOzonPriceIndexFilterLabel(ozonPriceIndexFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">商品管理</h1>
          <p className="text-muted-foreground mt-1">查看、编辑价格/库存，批量操作商品</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3">
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
              className="h-8 min-w-[190px] rounded-md border border-input bg-background px-2.5 text-xs"
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
                className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">库存视图：全部仓库（总库存）</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>
                ))}
              </select>
            )}

            <form onSubmit={handleSearch} className="flex min-w-[280px] flex-1 items-center gap-2 md:max-w-xl">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索 SKU / Offer ID / 标题"
                  className="h-8 pl-8 text-xs"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-8">查询</Button>
            </form>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="default"
                className="h-8"
                onClick={handleSyncProducts}
                disabled={!shops.length}
                title="选择店铺后从 OZON 同步商品、状态、库存和上架时间"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                同步在线商品
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
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
                className="h-8"
                onClick={() => setStockSyncOpen(true)}
                disabled={!shopId}
                title="检查并推送本地库存到 OZON"
              >
                <Upload className="h-3.5 w-3.5" />
                库存推送
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={loadProducts} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-2">
            <div className="flex flex-wrap items-center gap-5" role="tablist" aria-label="商品状态筛选">
              {PRODUCT_STATUS_TABS.map((tab) => {
                const active = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => handleStatusTab(tab.value)}
                    className={`border-b-2 pb-1 text-sm font-medium transition-colors ${
                      active
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                      active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    }`}>
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
                className="h-8"
                onClick={() => setAdvancedFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                高级筛选
                {hasAdvancedFilters && <Badge variant="outline" className="ml-1 h-5 px-1.5 text-[10px]">已启用</Badge>}
              </Button>
              <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span title={selectedShopLabel}>{selectedShopLabel}</span>
                <span className="hidden sm:inline">·</span>
                <span>同步 {lastProductSyncAt ? formatDateTime(lastProductSyncAt) : '从未同步'}</span>
                <span className="hidden sm:inline">·</span>
                <span>当前 {total} 件</span>
              </div>
            </div>
          </div>

          {advancedFiltersOpen && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={profitFilter}
                  onChange={(e) => { setProfitFilter(e.target.value as ProductProfitFilter); setPage(0); setSelected(new Set()); }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  title="按售价、佣金和买手成本估算收益"
                >
                  {PROFIT_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <select
                  value={ozonPriceIndexFilter}
                  onChange={(e) => { setOzonPriceIndexFilter(e.target.value as ProductProfitFilter); setPage(0); setSelected(new Set()); }}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  title="按 Ozon 价格指数和对手价格筛选"
                >
                  {OZON_PRICE_INDEX_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
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
                      setProfitFilter('all');
                      setOzonPriceIndexFilter('all');
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
          <Table className="min-w-[1460px] table-fixed text-xs">
              <colgroup>
                <col className="w-[40px]" />
                <col className="w-[375px]" />
                <col className="w-[150px]" />
                <col className="w-[110px]" />
                <col className="w-[160px]" />
                <col className="w-[90px]" />
                <col className="w-[85px]" />
                <col className="w-[180px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selected.size === products.length && products.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">商品信息</TableHead>
                  <TableHead className="whitespace-nowrap">类目 / 佣金</TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
                  <TableHead className="whitespace-nowrap">
                    <div ref={priceFilterMenuRef} className="relative flex items-center justify-center">
                      <Button
                        type="button"
                        size="sm"
                        variant={ozonPriceIndexFilter === 'all' ? 'ghost' : 'secondary'}
                        className="h-7 gap-1 px-2 text-xs font-medium"
                        aria-label="按 Ozon 价格指数筛选"
                        aria-expanded={priceFilterMenuOpen}
                        onClick={() => setPriceFilterMenuOpen((open) => !open)}
                      >
                        价格
                        {ozonPriceIndexFilter !== 'all' && (
                          <span className="max-w-[64px] truncate text-[11px] text-primary">{priceFilterLabel}</span>
                        )}
                        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      {priceFilterMenuOpen && (
                        <div className="absolute left-1/2 top-full z-50 mt-2 w-40 -translate-x-1/2 rounded-lg border border-border bg-white p-1 text-slate-900 shadow-xl ring-1 ring-black/5 dark:bg-slate-950 dark:text-slate-100 dark:ring-white/10">
                          {OZON_PRICE_INDEX_FILTER_OPTIONS.map((option) => {
                            const selectedOption = option.value === ozonPriceIndexFilter;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-xs hover:bg-muted ${selectedOption ? 'bg-primary/10 text-primary' : 'text-slate-700 dark:text-slate-200'}`}
                                onClick={() => {
                                  setOzonPriceIndexFilter(option.value);
                                  setPriceFilterMenuOpen(false);
                                  setPage(0);
                                  setSelected(new Set());
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate">{getOzonPriceIndexFilterLabel(option.value)}</span>
                                {selectedOption && <Check className="h-3.5 w-3.5" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right">库存</TableHead>
                  <TableHead className="whitespace-nowrap text-right">重量</TableHead>
                  <TableHead className="whitespace-nowrap">Ozon / 同步</TableHead>
                  <TableHead className="whitespace-nowrap">时间</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-48 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Package className="h-10 w-10 opacity-50" />
                        <div>
                          {hasAdvancedFilters || search.trim()
                            ? '没有符合当前筛选条件的商品。请清空筛选后重试。'
                            : '暂无商品。请先在店铺管理中执行同步。'}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : products.map((p) => {
                  const mutable = isProductMutable(p);
                  const displaySku = getDisplaySku(p);
                  const ozonProductUrl = getOzonProductUrl(p);
                  const priceNumber = toFiniteNumber(p.price);
                  const commissionRate = toFiniteNumber(p.commissionRate);
                  const commissionAmount = priceNumber != null && commissionRate != null
                    ? priceNumber * commissionRate / 100
                    : null;
                  const salePrice = formatCompactMoney(p.price, p.currency);
                  const oldPrice = formatCompactMoney(p.oldPrice, p.currency);
                  const minPrice = formatCompactMoney(p.minPrice, p.currency);
                  const promoPrice = formatCompactMoney(p.marketingPrice ?? p.price, p.currency, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                  const buyerPrice = formatCompactMoney(p.buyerPriceCny, 'CNY');
                  const competitorPrice = formatCompactMoney(p.competitorMinPrice, p.competitorCurrency || p.currency);
                  return (
                  <TableRow key={p.id} className={selected.has(p.id) ? 'bg-muted/30' : ''}>
                    <TableCell className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-gray-300"
                      />
                    </TableCell>
                    <TableCell className="min-w-0 px-3 py-2">
                      <div className="flex min-w-0 items-start gap-3">
                        <button type="button" onClick={() => setPreviewProductId(p.id)} className="shrink-0">
                          <ProductImage src={p.images?.[0]} />
                        </button>
                        <div className="min-w-0 flex-1 space-y-1">
                          {ozonProductUrl ? (
                            <a
                              href={ozonProductUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block truncate text-sm font-medium leading-5 text-foreground hover:text-primary hover:underline"
                              title={p.title}
                            >
                              {p.title}
                            </a>
                          ) : (
                            <button
                              type="button"
                              className="block max-w-full truncate text-left text-sm font-medium leading-5 hover:text-primary hover:underline"
                              onClick={() => setPreviewProductId(p.id)}
                              title={p.title}
                            >
                              {p.title}
                            </button>
                          )}
                          <div className="flex min-w-0 items-center gap-x-2 overflow-hidden font-mono text-[11px] text-muted-foreground">
                            {displaySku ? <span>SKU {displaySku}</span> : <span>SKU 待生成</span>}
                            {p.offerId && <span className="min-w-0 truncate">Offer {p.offerId}</span>}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
                      <div className="space-y-1 text-[11px] leading-5">
                        {(p.categoryLabel || p.categoryId) && (
                          <div className="truncate text-muted-foreground" title={p.categoryLabel || p.categoryId || undefined}>
                            {p.categoryLabel || `类目 ${p.categoryId}${p.categoryTypeId ? ` / ${p.categoryTypeId}` : ''}`}
                          </div>
                        )}
                        {commissionRate != null && (
                          <div className="font-medium tabular-nums">
                            rFBS {commissionRate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%
                          </div>
                        )}
                        {commissionAmount != null && (
                          <div className="text-muted-foreground tabular-nums">
                            佣金 {p.currency || 'CNY'} {commissionAmount.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                          </div>
                        )}
                        {!p.categoryId && commissionRate == null && (
                          <div className="text-muted-foreground">待同步类目/佣金</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top">
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
                    <TableCell className="px-3 py-2 align-top">
                      {editingPrice === p.id ? (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-[42px_1fr] items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">售价</span>
                            <Input
                              className="h-7 text-xs"
                              value={priceForm.price}
                              onChange={(e) => setPriceForm((form) => ({ ...form, price: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') savePrice(p.id); if (e.key === 'Escape') setEditingPrice(null); }}
                              autoFocus
                            />
                          </div>
                          <div className="grid grid-cols-[42px_1fr] items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">划线</span>
                            <Input
                              className="h-7 text-xs"
                              value={priceForm.oldPrice}
                              onChange={(e) => setPriceForm((form) => ({ ...form, oldPrice: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') savePrice(p.id); if (e.key === 'Escape') setEditingPrice(null); }}
                            />
                          </div>
                          <div className="grid grid-cols-[42px_1fr] items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">最低</span>
                            <Input
                              className="h-7 text-xs"
                              value={priceForm.minPrice}
                              onChange={(e) => setPriceForm((form) => ({ ...form, minPrice: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') savePrice(p.id); if (e.key === 'Escape') setEditingPrice(null); }}
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => savePrice(p.id)}>
                              <Check className="h-3 w-3 text-emerald-600" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingPrice(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className={`group flex items-center justify-between gap-2 ${mutable ? '' : 'opacity-60'}`}>
                          <button
                            type="button"
                            className={`min-w-0 flex-1 space-y-1 text-left leading-4 ${mutable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                            onClick={() => {
                              if (!mutable) {
                                toast({ title: '商品不可操作，请先同步并确认仍在售', variant: 'destructive' });
                                return;
                              }
                              setEditingPrice(p.id);
                              setPriceForm({ price: p.price || '', oldPrice: p.oldPrice || '', minPrice: p.minPrice || '' });
                            }}
                          >
                            <div className="flex items-baseline gap-1 whitespace-nowrap">
                              <span className="text-muted-foreground">销售价:</span>
                              <span className="tabular-nums font-semibold text-foreground">{salePrice || '-'}</span>
                            </div>
                            <div className="flex items-baseline gap-1 whitespace-nowrap">
                              <span className="text-muted-foreground">划线价:</span>
                              <span className="tabular-nums text-muted-foreground line-through decoration-muted-foreground/70">
                                {oldPrice || '未设置'}
                              </span>
                            </div>
                            <div className="flex items-baseline gap-1 whitespace-nowrap">
                              <span className="text-muted-foreground">最低价:</span>
                              <span className="tabular-nums text-muted-foreground">{minPrice || '未设置'}</span>
                            </div>
                            <div className="flex items-baseline gap-1 whitespace-nowrap">
                              <span className="text-muted-foreground">促销后:</span>
                              <span className="tabular-nums font-medium text-rose-500">{promoPrice || '-'}</span>
                            </div>
                            {buyerPrice && (
                              <div className="flex items-baseline gap-1 whitespace-nowrap text-[10px] text-amber-600">
                                <span>买手价格:</span>
                                <span className="tabular-nums">{buyerPrice}</span>
                              </div>
                            )}
                            {p.profitTier && p.profitTier !== 'unknown' && (
                              <ProfitBadge tier={p.profitTier} marginPct={p.profitMarginPct} />
                            )}
                            {p.ozonPriceIndexTier && p.ozonPriceIndexTier !== 'unknown' && (
                              <OzonPriceIndexBadge tier={p.ozonPriceIndexTier} competitorPrice={competitorPrice} />
                            )}
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                            disabled={!mutable}
                            title="修改价格"
                            onClick={() => {
                              setEditingPrice(p.id);
                              setPriceForm({ price: p.price || '', oldPrice: p.oldPrice || '', minPrice: p.minPrice || '' });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right align-top">
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
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">
                      <div>{p.weight != null ? `${p.weight} g` : '-'}</div>
                      <div className="text-[11px] text-muted-foreground">{selectedWarehouseId ? '当前仓' : '总库存'}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top text-[11px] text-muted-foreground">
                      <div className="truncate font-mono" title={p.platformProductId || undefined}>
                        PID {p.platformProductId || '-'}
                      </div>
                      <div className="truncate" title={p.offerId || undefined}>Offer {p.offerId || '-'}</div>
                      <div>同步 {formatDateTime(p.lastOzonSyncAt)}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">
                      <div>创建 {formatDateTime(p.ozonCreatedAt || p.createdAt)}</div>
                      <div>更新 {formatDateTime(p.ozonUpdatedAt || p.updatedAt)}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right align-top">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setDetailProductId(p.id)}>
                          <Pencil className="h-3 w-3" />
                          编辑
                        </Button>
                        {ozonProductUrl && (
                          <a
                            href={ozonProductUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                            title="打开 Ozon 商品页"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          disabled={!p.platformProductId}
                          title={String(p.visibility || '').toUpperCase() === 'ARCHIVED' ? '恢复到 Ozon 在售列表' : '快捷归档到 Ozon'}
                          onClick={() => handleArchiveProduct(p.id, String(p.visibility || '').toUpperCase() !== 'ARCHIVED')}
                        >
                          <Archive className="h-3 w-3" />
                          {String(p.visibility || '').toUpperCase() === 'ARCHIVED' ? '恢复' : '归档'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                共 {total} 件
                {total > 0 && (
                  <>，显示 {page * pageSize + 1}-{Math.min(total, (page + 1) * pageSize)}</>
                )}
              </span>
              <label className="flex items-center gap-1.5">
                <span>每页</span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); setSelected(new Set()); }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size} 条</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(0)} disabled={page === 0}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
                const start = Math.min(Math.max(page - 2, 0), Math.max(totalPages - 5, 0));
                const pageNumber = start + index;
                return (
                  <Button
                    key={pageNumber}
                    size="sm"
                    variant={page === pageNumber ? 'default' : 'outline'}
                    className="h-8 min-w-8 px-2 text-xs tabular-nums"
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber + 1}
                  </Button>
                );
              })}
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
              <form
                className="ml-1 flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  jumpToPage(pageJumpInput);
                }}
              >
                <Input
                  value={pageJumpInput}
                  onChange={(e) => setPageJumpInput(e.target.value)}
                  className="h-8 w-16 text-xs"
                  inputMode="numeric"
                  placeholder={`${page + 1}/${totalPages}`}
                />
                <Button size="sm" variant="outline" className="h-8 px-2 text-xs" type="submit">跳转</Button>
              </form>
            </div>
          </div>
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
  const [priceField, setPriceField] = useState<BatchPriceField>('price');
  const [submitting, setSubmitting] = useState(false);
  const activeMode = BATCH_PRICE_MODES.find((item) => item.value === mode) || BATCH_PRICE_MODES[0]!;
  const activeField = BATCH_PRICE_FIELDS[priceField];
  const getFieldValue = (product: Product, field: BatchPriceField) => {
    if (field === 'oldPrice') return product.oldPrice;
    if (field === 'minPrice') return product.minPrice;
    return product.price;
  };
  const previewRows = products.map((product) => ({
    product,
    current: Number(getFieldValue(product, priceField)),
    next: calculateProductBatchPreview(getFieldValue(product, priceField), mode, value),
  }));
  const hasValidInput = value.trim() ? previewRows.some((row) => row.next != null) : false;

  useEffect(() => {
    if (!open) return;
    setValue('');
    setMode('set');
    setPriceField('price');
  }, [open]);

  function buildPriceItem(product: Product, nextValue: number) {
    const next = nextValue.toFixed(2);
    const currentPrice = toFiniteNumber(product.price);
    const currentOldPrice = toFiniteNumber(product.oldPrice);
    const currentMinPrice = toFiniteNumber(product.minPrice);
    if (priceField === 'price') {
      return {
        productId: product.id,
        price: next,
        oldPrice: (currentOldPrice ?? nextValue).toFixed(2),
        ...(currentMinPrice != null ? { minPrice: currentMinPrice.toFixed(2) } : {}),
      };
    }
    if (currentPrice == null || currentPrice <= 0) return null;
    if (priceField === 'oldPrice') {
      return {
        productId: product.id,
        price: currentPrice.toFixed(2),
        oldPrice: next,
        ...(currentMinPrice != null ? { minPrice: currentMinPrice.toFixed(2) } : {}),
      };
    }
    return {
      productId: product.id,
      price: currentPrice.toFixed(2),
      oldPrice: (currentOldPrice ?? currentPrice).toFixed(2),
      minPrice: next,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return;
    if (mode === 'discount' && numericValue >= 100) {
      toast({ title: '折扣比例必须小于 100%', variant: 'destructive' });
      return;
    }
    setSubmitting(true);

    const items = previewRows
      .map(({ product, next }) => (next == null ? null : buildPriceItem(product, next)))
      .filter((item): item is NonNullable<ReturnType<typeof buildPriceItem>> => item != null);

    if (!items.length) {
      setSubmitting(false);
      toast({ title: '没有可计算新价格的商品', variant: 'destructive' });
      return;
    }

    const res = await api.post('/api/products/batch-price', { items });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setValue('');
      setMode('set');
      setPriceField('price');
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
          <DialogDescription>将为选中的 {productIds.length} 件商品计算并同步售价、划线价或最低价</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>修改字段</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(BATCH_PRICE_FIELDS) as Array<[BatchPriceField, { label: string; shortLabel: string }]>).map(([field, item]) => (
                <Button
                  key={field}
                  type="button"
                  size="sm"
                  variant={priceField === field ? 'default' : 'outline'}
                  onClick={() => setPriceField(field)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
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
            <Label>{activeField.shortLabel} · {activeMode.inputLabel}</Label>
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
              <div className="mb-1 text-xs font-medium">{activeField.label}变更预览</div>
              <div className="max-h-44 space-y-1 overflow-y-auto text-xs">
                {previewRows.slice(0, 10).map(({ product, current, next }) => (
                  <div key={product.id} className="grid grid-cols-[1fr_auto] gap-3 rounded bg-background/70 px-2 py-1">
                    <div className="min-w-0">
                      <div className="truncate">{product.title}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">{product.offerId || product.sku || '-'}</div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div>{Number.isFinite(current) ? current.toFixed(2) : '-'} → {formatCompactMoney(next, product.currency) || '-'}</div>
                      {next == null && <div className="text-[10px] text-destructive">缺少有效当前{activeField.shortLabel}</div>}
                      {next != null && priceField !== 'price' && !toFiniteNumber(product.price) && (
                        <div className="text-[10px] text-destructive">缺少售价，无法提交</div>
                      )}
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
