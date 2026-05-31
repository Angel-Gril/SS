'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, RefreshCw, Loader2, ImageOff, Pencil, Check, X,
  Archive, ArchiveRestore, Package, DollarSign, Boxes, Upload, AlertTriangle,
  Save, ImageIcon, Trash2, Plus,
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
  images: string[] | null;
  status: string | null;
  visibility: string | null;
  syncStatus: string | null;
  categoryId: string | null;
  commissionRate: string | null;
  minPrice: string | null;
  updatedAt: string;
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
  const [syncingCommissions, setSyncingCommissions] = useState(false);

  const limit = 20;

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        setShops(res.data);
        if (!shopId && res.data.length > 0) setShopId(res.data[0]!.id);
      }
    });
  }, []);

  useEffect(() => {
    if (shopId) {
      api.get<OzonWarehouse[]>(`/api/products/warehouses/${shopId}`).then((res) => {
        if (res.code === 1 && res.data) setWarehouses(res.data);
      });
    }
  }, [shopId]);

  const loadProducts = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(page * limit),
      limit: String(limit),
    });
    if (search) params.set('search', search);

    const res = await api.get<{ total: number; rows: Product[] }>(
      `/api/shops/${shopId}/products?${params}`,
    );
    if (res.code === 1 && res.data) {
      setProducts(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }, [shopId, page, search]);

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

  const totalPages = Math.ceil(total / limit);
  const selectedCount = selected.size;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">商品管理</h1>
          <p className="text-muted-foreground mt-1">查看、编辑价格/库存，批量操作商品</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={shopId}
              onChange={(e) => { setShopId(e.target.value); setPage(0); setSelected(new Set()); }}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部店铺</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>
              ))}
            </select>

            {warehouses.length > 1 && (
              <select
                value={selectedWarehouseId || ''}
                onChange={(e) => setSelectedWarehouseId(e.target.value ? Number(e.target.value) : null)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">默认仓库</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>
                ))}
              </select>
            )}

            <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索 SKU / Offer ID / 标题"
                  className="pl-9"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="outline">搜索</Button>
            </form>

            <div className="ml-auto flex items-center gap-2">
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
                刷新
              </Button>
              <span className="text-sm text-muted-foreground">共 {total} 件商品</span>
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
              <span className="text-sm font-medium">已选 {selectedCount} 件</span>
              <Button size="sm" variant="outline" onClick={() => setBatchPriceOpen(true)}>
                <DollarSign className="h-3.5 w-3.5" /> 批量改价
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBatchStockOpen(true)}>
                <Boxes className="h-3.5 w-3.5" /> 批量改库存
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleArchive(true)}>
                <Archive className="h-3.5 w-3.5" /> 下架
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleArchive(false)}>
                <ArchiveRestore className="h-3.5 w-3.5" /> 上架
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="h-3.5 w-3.5" /> 取消
              </Button>
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
                  <TableHead className="w-14">图片</TableHead>
                  <TableHead>商品标题</TableHead>
                  <TableHead>SKU / Offer ID</TableHead>
                  <TableHead className="text-right">买家价</TableHead>
                  <TableHead className="text-right">折扣前价</TableHead>
                  <TableHead className="text-right">佣金</TableHead>
                  <TableHead className="text-right">库存</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id} className={selected.has(p.id) ? 'bg-muted/30' : ''}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-gray-300"
                      />
                    </TableCell>
                    <TableCell><ProductImage src={p.images?.[0]} /></TableCell>
                    <TableCell className="max-w-xs">
                      <p
                        className="line-clamp-2 font-medium text-sm cursor-pointer hover:text-primary hover:underline"
                        onClick={() => setPreviewProductId(p.id)}
                      >
                        {p.title}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="space-y-0.5">
                        {p.sku && <div>SKU: {p.sku}</div>}
                        {p.offerId && <div className="text-muted-foreground">{p.offerId}</div>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
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
                          className="group cursor-pointer inline-flex items-center gap-1"
                          onClick={() => { setEditingPrice(p.id); setPriceValue(p.price || ''); }}
                        >
                          <span className="tabular-nums font-medium">{p.price ? `${p.price} ${p.currency || 'USD'}` : '-'}</span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums text-xs">
                      {p.oldPrice ? `${p.oldPrice} ${p.currency || 'USD'}` : '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {p.price ? (
                        p.commissionRate ? (
                          <span title={`佣金率: ${p.commissionRate}%`}>
                            {(Number(p.price) * Number(p.commissionRate) / 100).toFixed(2)}
                            <span className="ml-1 text-[10px] opacity-60">({p.commissionRate}%)</span>
                          </span>
                        ) : (
                          <span className="opacity-50" title="估算值(15%)">
                            {(Number(p.price) * 0.15).toFixed(2)}
                            <span className="ml-1 text-[10px]">~</span>
                          </span>
                        )
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
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
                          className="group cursor-pointer inline-flex items-center gap-1"
                          onClick={() => { setEditingStock(p.id); setStockValue(String(p.stock)); }}
                        >
                          <span className={`tabular-nums font-medium ${p.stock <= 0 ? 'text-destructive' : ''}`}>
                            {p.stock}
                          </span>
                          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} visibility={p.visibility} /></TableCell>
                    <TableCell>
                      <button type="button" onClick={() => setDetailProductId(p.id)} className="text-xs text-primary hover:underline">编辑</button>
                    </TableCell>
                  </TableRow>
                ))}
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
        onSuccess={() => { setSelected(new Set()); loadProducts(); }}
      />
      <BatchStockDialog
        open={batchStockOpen}
        onOpenChange={setBatchStockOpen}
        productIds={Array.from(selected)}
        warehouses={warehouses}
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

function StatusBadge({ status, visibility }: { status: string | null; visibility: string | null }) {
  if (visibility === 'archived') return <Badge variant="secondary">已下架</Badge>;
  if (status === 'price_sent') return <Badge variant="success">在售</Badge>;
  if (status === 'processed') return <Badge variant="success">已处理</Badge>;
  if (status === 'moderating') return <Badge variant="warning">审核中</Badge>;
  if (status === 'failed_moderation') return <Badge variant="destructive">审核失败</Badge>;
  return <Badge variant="secondary">{status || '-'}</Badge>;
}

function BatchPriceDialog({ open, onOpenChange, productIds, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productIds: string[];
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);

    const items = productIds.map((id) => ({
      productId: id,
      price: value,
    }));

    const res = await api.post('/api/products/batch-price', { items });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量修改价格</DialogTitle>
          <DialogDescription>将为选中的 {productIds.length} 件商品设置新价格</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>新价格 (RUB)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="输入统一价格"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BatchStockDialog({ open, onOpenChange, productIds, warehouses, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productIds: string[];
  warehouses: OzonWarehouse[];
  onSuccess: () => void;
}) {
  const [value, setValue] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) {
      setWarehouseId(String(warehouses[0]!.warehouse_id));
    }
  }, [warehouses]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const stock = parseInt(value);
    if (isNaN(stock) || stock < 0) return;
    if (!warehouseId) {
      toast({ title: '请选择仓库', variant: 'destructive' });
      return;
    }
    setSubmitting(true);

    const items = productIds.map((id) => ({ productId: id, stock }));
    const res = await api.post('/api/products/batch-stock', {
      items,
      warehouseId: Number(warehouseId),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量修改库存</DialogTitle>
          <DialogDescription>将为选中的 {productIds.length} 件商品设置新库存</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>目标仓库</Label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>
              ))}
            </select>
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
            <Button type="submit" disabled={submitting}>
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
              <div><span className="text-muted-foreground text-xs">SKU</span><p className="font-mono text-xs">{detail.sku || '—'}</p></div>
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
                  {detail.sku && <span>SKU: {detail.sku}</span>}
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
