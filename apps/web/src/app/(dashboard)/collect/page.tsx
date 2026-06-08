'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Loader2, Search, Trash2, ExternalLink, Upload, Edit2, Save, ArrowRight, Download, Sparkles, Image as ImageIcon, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { formatVariantAttrs } from '@/lib/ozon-attr-names';
import { sourcePlatformLabel } from '@/lib/source-platforms';

interface VariantSku {
  sku?: string;
  attrs?: Record<string, string>;
  price?: number | string | null;
  images?: string[];
  stock?: number | null;
}

interface CollectedItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  sku: string | null;
  sourceProductId: string | null;
  images: string[] | null;
  purchasePrice: string | null;
  currency: string;
  originalPrice: string | null;
  originalCurrency: string | null;
  exchangeRateUsed: string | null;
  priceNeedsReview: boolean;
  notes: string | null;
  status: string;
  createdAt: string;
  metadata?: { watermarkApplied?: boolean; ozonAttributes?: any[]; [key: string]: any } | null;
  variants?: VariantSku[] | null;
  modelId?: string | null;
}

function hasCjkText(value?: string | null) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

const DOMESTIC_SUPPLY_SOURCE_PLATFORMS = new Set(['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd']);

function isDomesticSupplySourcePlatform(sourcePlatform?: string | null) {
  return !!sourcePlatform && DOMESTIC_SUPPLY_SOURCE_PLATFORMS.has(sourcePlatform.toLowerCase());
}

interface Shop { id: string; name: string; platform: string; }

export default function CollectPage() {
  const router = useRouter();
  const [items, setItems] = useState<CollectedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [markupPct, setMarkupPct] = useState('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [publishShopId, setPublishShopId] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [publishCategoryId, setPublishCategoryId] = useState('');
  const [publishTypeId, setPublishTypeId] = useState('');
  const [publishWeight, setPublishWeight] = useState('500');
  const [publishHeight, setPublishHeight] = useState('100');
  const [publishDepth, setPublishDepth] = useState('100');
  const [publishWidth, setPublishWidth] = useState('100');
  const [publishMarkup, setPublishMarkup] = useState('200');
  const [publishMarkupAmount, setPublishMarkupAmount] = useState('0');
  const [publishMode, setPublishMode] = useState<'follow' | 'clone'>('clone');
  const [publishFollowBrand, setPublishFollowBrand] = useState(true);
  const [inheriting, setInheriting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichShopId, setEnrichShopId] = useState('');
  const [showEnrichDialog, setShowEnrichDialog] = useState(false);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editItemData, setEditItemData] = useState({ title: '', publishTitle: '', sku: '', purchasePrice: '', currency: 'CNY', sourceUrl: '', notes: '' });
  const [savingItem, setSavingItem] = useState(false);
  const [editImagesId, setEditImagesId] = useState<string | null>(null);
  const [editImagesText, setEditImagesText] = useState('');
  const [savingImages, setSavingImages] = useState(false);
  const [showOzonFetch, setShowOzonFetch] = useState(false);
  const [ozonFetchShopId, setOzonFetchShopId] = useState('');
  const [ozonFetchInput, setOzonFetchInput] = useState('');
  const [ozonFetching, setOzonFetching] = useState(false);
  const [ozonFetchResults, setOzonFetchResults] = useState<any[] | null>(null);
  const [showExtFetch, setShowExtFetch] = useState(false);
  const [extFetchInput, setExtFetchInput] = useState('');
  const [extFetching, setExtFetching] = useState(false);
  const [extFetchResults, setExtFetchResults] = useState<any[] | null>(null);
  const [expandedVariantIds, setExpandedVariantIds] = useState<Set<string>>(new Set());
  const [variantPriceOverrides, setVariantPriceOverrides] = useState<Record<string, Record<string, string>>>({});
  const [extFetchErrors, setExtFetchErrors] = useState<string[]>([]);
  const [showWatermarkDialog, setShowWatermarkDialog] = useState(false);
  const [watermarking, setWatermarking] = useState(false);
  const [wmType, setWmType] = useState<'text' | 'image'>('text');
  const [wmText, setWmText] = useState('SS ERP');
  const [wmImageUrl, setWmImageUrl] = useState('');
  const [wmPosition, setWmPosition] = useState<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center' | 'tile'>('bottom-right');
  const [wmOpacity, setWmOpacity] = useState('50');
  const [wmFontColor, setWmFontColor] = useState('#ffffff');
  const [wmFontSize, setWmFontSize] = useState<string>('');
  const [wmScale, setWmScale] = useState('25');
  const [wmTemplates, setWmTemplates] = useState<any[]>([]);
  const [wmSelectedTemplate, setWmSelectedTemplate] = useState<string>('');
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page, statusFilter]);
  useEffect(() => { loadShops(); loadWmTemplates(); }, []);

  // 监听扩展 popup/侧栏采集完成的广播（content-script erp-collect-bridge 转发过来）
  useEffect(() => {
    function onExtBroadcast(event: MessageEvent) {
      if (event.source !== window) return;
      const d: any = event.data;
      if (!d || d.direction !== 'ss-erp:from-extension' || !d.broadcast) return;
      const evt = d.event;
      if (!evt || evt.type !== 'ss-erp:collect-completed') return;
      toast({ title: `扩展采集完成：${evt.collected} 件${evt.errorCount ? `，${evt.errorCount} 件失败` : ''}` });
      fetchData();
    }
    window.addEventListener('message', onExtBroadcast);
    return () => window.removeEventListener('message', onExtBroadcast);
  }, []);

  async function loadWmTemplates() {
    const res = await api.get<any[]>('/api/watermark-templates');
    if (res.code === 1 && res.data) setWmTemplates(res.data);
  }

  function applyWmTemplate(templateId: string) {
    setWmSelectedTemplate(templateId);
    const tpl = wmTemplates.find((t) => t.id === templateId);
    if (tpl) {
      setWmType(tpl.type);
      setWmText(tpl.text || '');
      setWmImageUrl(tpl.imageUrl || '');
      setWmPosition(tpl.position);
      setWmOpacity(String(tpl.opacity));
      if (tpl.fontColor) setWmFontColor(tpl.fontColor);
      if (tpl.fontSize) setWmFontSize(String(tpl.fontSize));
      if (tpl.scale) setWmScale(String(tpl.scale));
    }
  }

  async function loadShops() {
    const res = await api.get<Shop[]>('/api/shops');
    if (res.code === 1 && res.data) setShops(res.data);
  }

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    const res = await api.get<{ total: number; rows: CollectedItem[] }>(`/api/collect?${params}`);
    if (res.code === 1 && res.data) { setItems(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await api.delete(`/api/collect/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchData(); }
    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
  }

  async function handleDeleteVariant(itemId: string, sku?: string) {
    if (!sku) { toast({ title: '该变体缺少 SKU，无法删除', variant: 'destructive' }); return; }
    if (!window.confirm(`确认删除变体 SKU ${sku}？`)) return;
    const res = await api.delete(`/api/collect/${itemId}/variants/${encodeURIComponent(sku)}`);
    if (res.code === 1) {
      toast({ title: '已删除变体' });
      setVariantPriceOverrides((prev) => {
        const next = { ...prev };
        if (next[itemId]) {
          const perItem = { ...next[itemId] };
          delete perItem[sku];
          next[itemId] = perItem;
        }
        return next;
      });
      fetchData();
    } else {
      toast({ title: res.msg || '删除变体失败', variant: 'destructive' });
    }
  }

  async function handleSavePrice(id: string) {
    const price = parseFloat(editPrice);
    if (isNaN(price)) { toast({ title: '请输入有效价格', variant: 'destructive' }); return; }
    const res = await api.put(`/api/collect/${id}`, { purchasePrice: price });
    if (res.code === 1) { toast({ title: '价格已更新' }); setEditingId(null); fetchData(); }
    else toast({ title: res.msg || '更新失败', variant: 'destructive' });
  }

  async function handleBatchMarkup() {
    if (!selectedIds.size) { toast({ title: '请先选择商品', variant: 'destructive' }); return; }
    const pct = parseFloat(markupPct);
    if (isNaN(pct)) { toast({ title: '请输入加价百分比', variant: 'destructive' }); return; }
    const batchItems = items.filter((i) => selectedIds.has(i.id) && i.purchasePrice).map((i) => ({ id: i.id, price: parseFloat(i.purchasePrice!) }));
    const res = await api.post('/api/collect/batch-price', { items: batchItems, markupPct: pct });
    if (res.code === 1) { toast({ title: res.msg }); setSelectedIds(new Set()); fetchData(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  async function handleOzonFetch() {
    if (!ozonFetchShopId) { toast({ title: '请选择店铺', variant: 'destructive' }); return; }
    if (!ozonFetchInput.trim()) { toast({ title: '请输入商品链接或SKU', variant: 'destructive' }); return; }
    setOzonFetching(true);
    setOzonFetchResults(null);
    const res = await api.post<{ products: any[]; saved: number }>('/api/collect/ozon-fetch', {
      shopId: ozonFetchShopId,
      input: ozonFetchInput,
      saveToCollect: true,
    });
    setOzonFetching(false);
    if (res.code === 1 && res.data) {
      setOzonFetchResults(res.data.products);
      toast({ title: res.msg });
      fetchData();
    } else {
      toast({ title: res.msg || '采集失败', variant: 'destructive' });
    }
  }

  function sendToExtension(message: any): Promise<any> {
    return new Promise((resolve) => {
      const requestId = Date.now() + '-' + Math.random().toString(36).slice(2);
      function onMessage(event: MessageEvent) {
        if (event.source !== window) return;
        if (!event.data || event.data.direction !== 'ss-erp:from-extension') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', onMessage);
        resolve(event.data.response);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ direction: 'ss-erp:to-extension', requestId, message }, '*');
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, error: '扩展未响应，请确认已安装并启用 SS ERP 扩展' });
      }, 30000);
    });
  }

  async function handleExtFetch() {
    if (!extFetchInput.trim()) { toast({ title: '请输入商品链接或Product ID', variant: 'destructive' }); return; }
    const lines = extFetchInput.trim().split('\n').map((s) => s.trim()).filter(Boolean);
    const productIds: string[] = [];
    for (const line of lines) {
      const match = line.match(/[-/](\d{6,})\/?(\?|$)/);
      if (match) { productIds.push(match[1]!); continue; }
      if (/^\d{6,}$/.test(line)) { productIds.push(line); continue; }
      toast({ title: `无法解析: ${line.slice(0, 40)}`, variant: 'destructive' });
      return;
    }
    if (!productIds.length) { toast({ title: '未解析到有效的 Product ID', variant: 'destructive' }); return; }

    setExtFetching(true);
    setExtFetchResults(null);
    setExtFetchErrors([]);

    const res = await sendToExtension({
      type: 'spb-self-hosted:fetch-ozon-product-to-erp',
      productIds,
    });

    setExtFetching(false);
    if (res.ok) {
      setExtFetchResults(res.data?.collected ? Array(res.data.collected).fill(null) : []);
      const errors = res.data?.errors?.map((e: any) => `${e.productId}: ${e.error}`) || [];
      setExtFetchErrors(errors);
      toast({ title: `成功采集 ${res.data?.collected || 0} 件商品` });
      fetchData();
    } else {
      toast({ title: res.error || '扩展采集失败', variant: 'destructive' });
    }
  }

  async function handleWatermark() {
    if (!selectedIds.size) { toast({ title: '请先选择商品', variant: 'destructive' }); return; }
    setWatermarking(true);
    const res = await api.post('/api/collect/watermark', {
      ids: Array.from(selectedIds),
      type: wmType,
      text: wmText,
      imageUrl: wmImageUrl || undefined,
      position: wmPosition,
      opacity: Number(wmOpacity) || 50,
      fontColor: wmFontColor,
      fontSize: wmFontSize ? Number(wmFontSize) : undefined,
      scale: wmScale ? Number(wmScale) : undefined,
    });
    setWatermarking(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setShowWatermarkDialog(false);
      fetchData();
    } else {
      toast({ title: res.msg || '水印处理失败', variant: 'destructive' });
    }
  }

  async function handlePublish() {
    if (!selectedIds.size) { toast({ title: '请先选择商品', variant: 'destructive' }); return; }
    if (!publishShopId) { toast({ title: '请选择目标店铺', variant: 'destructive' }); return; }
    if (!publishCategoryId) { toast({ title: '请输入 OZON 分类 ID', variant: 'destructive' }); return; }
    if (!publishTypeId) { toast({ title: '请输入 OZON 类型 ID (type_id)', variant: 'destructive' }); return; }
    setPublishing(true);

    // 收集变体价格覆盖：仅选中且确实有 override 的项才传
    const priceOverrides: Record<string, Record<string, number>> = {};
    for (const id of selectedIds) {
      const overrides = variantPriceOverrides[id];
      if (!overrides) continue;
      const cleaned: Record<string, number> = {};
      for (const [sku, val] of Object.entries(overrides)) {
        const num = parseFloat(val);
        if (Number.isFinite(num) && num > 0) cleaned[sku] = num;
      }
      if (Object.keys(cleaned).length) priceOverrides[id] = cleaned;
    }

    const res = await api.post('/api/collect/publish-ozon', {
      ids: Array.from(selectedIds),
      shopId: publishShopId,
      categoryId: Number(publishCategoryId),
      typeId: Number(publishTypeId),
      weight: Number(publishWeight) || 500,
      height: Number(publishHeight) || 100,
      depth: Number(publishDepth) || 100,
      width: Number(publishWidth) || 100,
      markupPct: Number(publishMarkup) || 200,
      markupAmount: Number(publishMarkupAmount) || 0,
      mode: publishMode,
      followBrand: publishFollowBrand,
      source: 'collect-page',
      ...(Object.keys(priceOverrides).length ? { priceOverrides } : {}),
    });
    setPublishing(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setSelectedIds(new Set());
      setShowPublishDialog(false);
      fetchData();
    } else {
      const errorMsg = res.msg || '上架失败';
      toast({
        title: '上架失败',
        description: errorMsg,
        variant: 'destructive',
        duration: 8000,
      });
      console.error('[publish-ozon] error:', errorMsg);
    }
  }

  async function handleAutoInherit() {
    if (!selectedIds.size) {
      toast({ title: '请先选择商品', variant: 'destructive' });
      return;
    }
    setInheriting(true);

    const selected = items.filter((i) => selectedIds.has(i.id));
    const productIds = selected
      .map((i) => i.sku)
      .filter((s): s is string => !!s && /^\d+$/.test(s));

    if (!productIds.length) {
      setInheriting(false);
      toast({ title: '所选商品无有效的数字 SKU（product_id）', variant: 'destructive' });
      return;
    }

    const res = await sendToExtension({
      type: 'spb-self-hosted:get-listing-data',
      productIds,
    });

    if (!res.ok || !Array.isArray(res.data) || !res.data.length) {
      setInheriting(false);
      toast({ title: res.error || '扩展未响应，请确认已打开 seller.ozon.ru', variant: 'destructive' });
      return;
    }

    const first = res.data.find((d: any) => d.ok && d.descriptionCategoryId);
    if (!first) {
      setInheriting(false);
      const err = res.data[0]?.error || '未能获取分类属性';
      toast({ title: `继承失败: ${err}`, variant: 'destructive' });
      return;
    }

    if (first.descriptionCategoryId) setPublishCategoryId(String(first.descriptionCategoryId));
    if (first.weight) setPublishWeight(String(first.weight));
    if (first.height) setPublishHeight(String(first.height));
    if (first.depth) setPublishDepth(String(first.depth));
    if (first.width) setPublishWidth(String(first.width));

    if (first.typeId) {
      setPublishTypeId(String(first.typeId));
      setInheriting(false);
      toast({ title: '已从源商品继承属性（通过扩展）' });
      return;
    }

    // type_id 不在 bundle 里，通过 Seller API 分类树查询
    if (first.descriptionCategoryId && publishShopId) {
      const typeRes = await api.post<{ types: { typeId: number; typeName: string }[]; autoTypeId: number | null }>('/api/collect/resolve-type-id', {
        shopId: publishShopId,
        descriptionCategoryId: first.descriptionCategoryId,
      });
      if (typeRes.code === 1 && typeRes.data?.autoTypeId) {
        setPublishTypeId(String(typeRes.data.autoTypeId));
        setInheriting(false);
        toast({ title: '已从源商品继承属性（含自动匹配 type_id）' });
        return;
      } else if (typeRes.code === 1 && typeRes.data?.types?.length) {
        setPublishTypeId(String(typeRes.data.types[0]!.typeId));
        setInheriting(false);
        toast({ title: `已继承分类，type_id 有 ${typeRes.data.types.length} 个选项，已选第一个` });
        return;
      }
    }

    setInheriting(false);
    toast({ title: '已继承分类/重量/尺寸，type_id 需手动从分类树获取' });
  }

  function handleGoToListing() {
    const selected = items.filter((i) => selectedIds.has(i.id));
    const listingData = selected.map((i) => ({
      offerId: i.sku || '',
      title: i.title,
      price: i.purchasePrice || '',
      images: (i.images || []).join('\n'),
    }));
    sessionStorage.setItem('listing_prefill', JSON.stringify(listingData));
    // 走改款表单：直接把 supplyGoods ids 传过去（含完整属性、变体、图片）
    const ids = selected.map((i) => i.id).join(',');
    router.push(`/listing?ids=${encodeURIComponent(ids)}`);
  }

  async function handleEnrich() {
    if (!selectedIds.size) { toast({ title: '请先选择商品', variant: 'destructive' }); return; }
    const selectedHasDomesticSupply = items
      .filter((i) => selectedIds.has(i.id))
      .some((i) => isDomesticSupplySourcePlatform(i.sourcePlatform));
    if (selectedHasDomesticSupply) {
      toast({ title: '货源记录不能使用 Ozon 补全信息入口，请走货源上架准备流程', variant: 'destructive' });
      return;
    }
    setEnriching(true);

    const selected = items.filter((i) => selectedIds.has(i.id));
    const productIds = selected
      .map((i) => i.sku)
      .filter((s): s is string => !!s && /^\d+$/.test(s));

    if (!productIds.length) {
      setEnriching(false);
      toast({ title: '所选商品无有效的数字 SKU', variant: 'destructive' });
      return;
    }

    const res = await sendToExtension({
      type: 'spb-self-hosted:fetch-ozon-product-batch',
      productIds,
    });

    if (!res.ok || !Array.isArray(res.data)) {
      setEnriching(false);
      toast({ title: res.error || '扩展补全失败', variant: 'destructive' });
      return;
    }

    let enriched = 0;
    for (const r of res.data) {
      if (!r.ok || !r.data) continue;
      const item = selected.find((i) => i.sku === String(r.data.productId));
      if (!item) continue;
      await api.put(`/api/collect/${item.id}`, {
        title: r.data.title,
        images: r.data.images,
        sourceUrl: r.data.url,
      });
      enriched++;
    }

    setEnriching(false);
    setShowEnrichDialog(false);
    setSelectedIds(new Set());
    toast({ title: `已通过扩展补全 ${enriched} 件商品` });
    fetchData();
  }

  function openEditItem(item: CollectedItem) {
    setEditItemId(item.id);
    setEditItemData({
      title: item.title,
      publishTitle: item.metadata?.publishTitleRu || '',
      sku: item.sku || '',
      purchasePrice: item.purchasePrice || '',
      currency: item.currency || 'CNY',
      sourceUrl: item.sourceUrl || '',
      notes: item.notes || '',
    });
  }

  async function handleSaveItem() {
    if (!editItemId) return;
    const item = editItemId ? items.find((item) => item.id === editItemId) || null : null;
    const isEditingDomesticSupply = isDomesticSupplySourcePlatform(item?.sourcePlatform);
    setSavingItem(true);
    const body: Record<string, unknown> = {
      title: editItemData.title,
      publishTitle: editItemData.publishTitle,
      currency: editItemData.currency,
      notes: editItemData.notes,
    };
    if (!isEditingDomesticSupply) {
      body.sku = editItemData.sku;
      body.sourceUrl = editItemData.sourceUrl;
    }
    if (editItemData.purchasePrice && !isNaN(parseFloat(editItemData.purchasePrice))) {
      body.purchasePrice = parseFloat(editItemData.purchasePrice);
    }
    const res = await api.put(`/api/collect/${editItemId}`, body);
    setSavingItem(false);
    if (res.code === 1) {
      toast({ title: '已保存' });
      setEditItemId(null);
      fetchData();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function toggleAll() {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.id)));
  }

  const totalPages = Math.ceil(total / limit);
  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const selectedHasDomesticSupply = selectedItems.some((i) => isDomesticSupplySourcePlatform(i.sourcePlatform));
  const selectedAllDomesticSupply = selectedItems.length > 0 && selectedItems.every((i) => isDomesticSupplySourcePlatform(i.sourcePlatform));
  const editingItem = editItemId ? items.find((item) => item.id === editItemId) || null : null;
  const editingIsDomesticSupply = isDomesticSupplySourcePlatform(editingItem?.sourcePlatform);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SKU采集跟卖</h1>
          <p className="text-muted-foreground text-sm mt-1">扩展采集 → 改价 → 一键上架到 OZON</p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => setShowExtFetch(true)}>
            <Download className="h-4 w-4 mr-1" />扩展采集
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowOzonFetch(true)}>
            <Download className="h-4 w-4 mr-1" />OZON采集(自家)
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">已选 {selectedIds.size} 件</span>
              <Input placeholder="加价%" value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} className="h-8 w-24" type="number" />
              <Button size="sm" variant="outline" onClick={handleBatchMarkup}>批量加价</Button>
              {!selectedHasDomesticSupply && (
                <Button size="sm" variant="outline" onClick={() => setShowEnrichDialog(true)}>
                  <Sparkles className="h-4 w-4 mr-1" />从OZON补全信息
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowWatermarkDialog(true)}>
                <ImageIcon className="h-4 w-4 mr-1" />打水印
              </Button>
              <div className="flex items-center gap-2 ml-auto">
                {selectedAllDomesticSupply && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const ids = selectedItems.map((i) => i.id).join(',');
                      router.push(`/listing/1688?ids=${encodeURIComponent(ids)}`);
                    }}
                  >
                    <ArrowRight className="h-4 w-4 mr-1" />货源上架准备
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedHasDomesticSupply) {
                      toast({ title: '货源记录需要先走货源上架准备流程，不能使用 Ozon 改款入口', variant: 'destructive' });
                      return;
                    }
                    handleGoToListing();
                  }}
                >
                  <ArrowRight className="h-4 w-4 mr-1" />SKU 采集改款
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (selectedHasDomesticSupply) {
                      toast({ title: '货源记录仅保存货源信息，上架前需要先完成翻译、类目映射和属性生成', variant: 'destructive' });
                      return;
                    }
                    setShowPublishDialog(true);
                  }}
                >
                  <Upload className="h-4 w-4 mr-1" />一键上架OZON
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* CARD LIST */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">全部状态</option>
              <option value="collected">已采集</option>
              <option value="listed">已上架</option>
            </select>
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索商品名 / SKU" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <div className="flex items-center gap-2 ml-auto">
              <input type="checkbox" checked={items.length > 0 && selectedIds.size === items.length} onChange={toggleAll} className="h-4 w-4 rounded" />
              <span className="text-sm text-muted-foreground">全选</span>
              <span className="text-sm text-muted-foreground ml-2">共 {total} 条</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>暂无数据，使用扩展采集或批量导入SKU</p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`relative rounded-lg border p-3 sm:p-4 transition-colors ${selectedIds.has(item.id) ? 'border-primary/50 bg-primary/5' : 'hover:bg-muted/30'}`}
                >
                  <div className="flex gap-3 sm:gap-4">
                    {/* Checkbox */}
                    <div className="flex items-start pt-1">
                      <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="h-4 w-4 rounded" />
                    </div>

                    {/* Image */}
                    <div className="shrink-0">
                      {item.images && item.images.length > 0 ? (
                        <img
                          src={item.images[0]}
                          alt=""
                          className="h-20 w-20 rounded-md border object-cover cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => window.open(item.images![0], '_blank')}
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-md border bg-muted flex items-center justify-center">
                          <ShoppingCart className="h-6 w-6 opacity-30" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:gap-4">
                      {/* Title + SKU + Platform */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start gap-2">
                          {item.sourceUrl ? (
                            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium line-clamp-2 hover:text-primary hover:underline transition-colors">
                              {item.title}
                              <ExternalLink className="h-3 w-3 inline ml-1 opacity-50" />
                            </a>
                          ) : (
                            <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.sku && <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">SKU: {item.sku}</span>}
                          {item.sourceProductId && item.sourceProductId !== item.sku && (
                            <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {isDomesticSupplySourcePlatform(item.sourcePlatform) ? '货源商品ID' : 'Ozon Product ID'}: {item.sourceProductId}
                            </span>
                          )}
                          {item.sourcePlatform && (
                            <Badge variant="outline" className="text-xs font-normal">{sourcePlatformLabel(item.sourcePlatform)}</Badge>
                          )}
                          {(item.metadata?.titleNeedsReview || hasCjkText(item.metadata?.publishTitleRu || item.title)) && (
                            <Badge variant="destructive" className="text-xs font-normal">上架标题需检查</Badge>
                          )}
                          {item.variants && item.variants.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedVariantIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(item.id)) next.delete(item.id);
                                  else next.add(item.id);
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100 transition-colors"
                              title={item.modelId ? `model_id: ${item.modelId}` : '多变体商品'}
                            >
                              <Layers className="h-3 w-3" />
                              {item.variants.length} 个变体
                              {expandedVariantIds.has(item.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</p>
                      </div>

                      {/* Price + Status + Actions */}
                      <div className="flex items-center gap-3 mt-2 sm:mt-0 sm:flex-col sm:items-end sm:justify-between sm:min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <Badge variant={item.status === 'collected' ? 'warning' : item.status === 'listed' ? 'success' : 'secondary'}>
                            {item.status === 'collected' ? '已采集' : item.status === 'listed' ? '已上架' : item.status}
                          </Badge>
                          {item.metadata?.watermarkApplied && (
                            <Badge variant="outline" className="text-xs border-blue-300 text-blue-600">水印</Badge>
                          )}
                          {item.metadata?.ozonAttributes && (
                            <Badge variant="outline" className="text-xs border-orange-300 text-orange-600">属性完整</Badge>
                          )}
                        </div>
                        <div>
                          {editingId === item.id ? (
                            <div className="flex items-center gap-1">
                              <Input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="h-7 w-20 text-xs" type="number" autoFocus />
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleSavePrice(item.id)}><Save className="h-3 w-3" /></Button>
                            </div>
                          ) : (
                            <span
                              className="text-sm font-semibold tabular-nums cursor-pointer hover:text-primary transition-colors"
                              onClick={() => { setEditingId(item.id); setEditPrice(item.purchasePrice || ''); }}
                              title={
                                item.priceNeedsReview
                                  ? `待核价：原始 ${item.originalCurrency || '?'} ${item.originalPrice || '?'}（按汇率 ${item.exchangeRateUsed || '?'} 估算 CNY）`
                                  : item.originalCurrency && item.originalCurrency !== 'CNY'
                                    ? `原始 ${item.originalCurrency} ${item.originalPrice}（按汇率 ${item.exchangeRateUsed || '?'} 换算）`
                                    : item.currency && item.currency !== 'CNY'
                                      ? `数据库 currency=${item.currency}（异常，应为 CNY）`
                                      : undefined
                              }
                            >
                              {item.purchasePrice ? (
                                <>
                                  RMB {item.purchasePrice}
                                  {item.priceNeedsReview && (
                                    <span className="ml-1 text-[10px] px-1 rounded bg-orange-100 text-orange-700">待核价</span>
                                  )}
                                  {item.originalCurrency && item.originalCurrency !== 'CNY' && !item.priceNeedsReview && (
                                    <span className="ml-1 text-[10px] text-muted-foreground">({item.originalCurrency} {item.originalPrice})</span>
                                  )}
                                  {item.currency && item.currency !== 'CNY' && (
                                    <span className="ml-1 text-[10px] text-destructive">⚠{item.currency}</span>
                                  )}
                                </>
                              ) : '-'}
                              <Edit2 className="h-3 w-3 inline ml-1 opacity-40" />
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-auto sm:ml-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditItem(item)} title="编辑商品信息">
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                            setEditImagesId(item.id);
                            setEditImagesText((item.images || []).join('\n'));
                          }} title="编辑图片">
                            <ImageIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(item.id)} title="删除">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  {item.variants && item.variants.length > 0 && expandedVariantIds.has(item.id) && (
                    <div className="mt-3 pt-3 border-t border-dashed">
                      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                        <Layers className="h-3 w-3" />
                        变体明细（共 {item.variants.length} 个 SKU{item.modelId ? `，model ${item.modelId}` : ''}）
                      </div>
                      <div className="space-y-1.5">
                        {item.variants.map((v, idx) => {
                          const attrText = (v.attrs && Object.keys(v.attrs).length ? formatVariantAttrs(v.attrs) : '')
                            || (v.sku || `变体 #${idx + 1}`);
                          const variantKey = v.sku || String(idx);
                          const overrideValue = variantPriceOverrides[item.id]?.[variantKey] ?? '';
                          return (
                            <div key={idx} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted/40">
                              {v.images?.[0] && (
                                <img src={v.images[0]} alt="" className="h-8 w-8 rounded object-cover border shrink-0" />
                              )}
                              <span className="flex-1 min-w-0 truncate">{attrText}</span>
                              {v.sku && <span className="font-mono text-[10px] text-muted-foreground">{v.sku}</span>}
                              <Input
                                type="number"
                                placeholder={v.price != null ? String(v.price) : '组价'}
                                value={overrideValue}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setVariantPriceOverrides((prev) => ({
                                    ...prev,
                                    [item.id]: { ...(prev[item.id] || {}), [variantKey]: val },
                                  }));
                                }}
                                className="h-7 w-20 text-xs"
                              />
                              {v.stock != null && (
                                <span className="text-[10px] text-muted-foreground">库存 {v.stock}</span>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0"
                                onClick={() => handleDeleteVariant(item.id, v.sku)}
                                title="删除该变体"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 mt-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>一键上架到 OZON</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 选中商品的图片预览 */}
            {selectedIds.size > 0 && (
              <div className="rounded-md border p-2 bg-muted/30">
                <div className="text-xs text-muted-foreground mb-2">将上架 {selectedIds.size} 件商品</div>
                <div className="flex gap-1.5 flex-wrap max-h-24 overflow-y-auto">
                  {items.filter((i) => selectedIds.has(i.id)).slice(0, 12).map((it) => (
                    it.images?.[0] ? (
                      <img key={it.id} src={it.images[0]} alt="" title={it.title}
                        className="h-12 w-12 rounded border object-cover" />
                    ) : (
                      <div key={it.id} title={it.title}
                        className="h-12 w-12 rounded border bg-muted flex items-center justify-center">
                        <ShoppingCart className="h-4 w-4 opacity-30" />
                      </div>
                    )
                  ))}
                  {selectedIds.size > 12 && (
                    <div className="h-12 w-12 rounded border bg-muted/50 flex items-center justify-center text-xs text-muted-foreground">
                      +{selectedIds.size - 12}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>目标店铺 *</Label>
              <select value={publishShopId} onChange={(e) => setPublishShopId(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">选择店铺</option>
                {shops.filter((s) => s.platform === 'OZON').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">上货模式</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPublishMode('clone')}
                    className={`rounded-md border p-2 text-left transition ${publishMode === 'clone' ? 'border-primary bg-primary/5' : 'border-input hover:bg-background'}`}
                  >
                    <div className="text-sm font-medium">复制商品</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">拉源商品图片/描述/属性，1:1 复刻发布</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPublishMode('follow')}
                    className={`rounded-md border p-2 text-left transition ${publishMode === 'follow' ? 'border-primary bg-primary/5' : 'border-input hover:bg-background'}`}
                  >
                    <div className="text-sm font-medium">普通跟卖</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">仅发布基础字段，不拉源商品详情</div>
                  </button>
                </div>
              </div>
              {publishMode === 'clone' && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishFollowBrand}
                    onChange={(e) => setPublishFollowBrand(e.target.checked)}
                    className="rounded mt-0.5"
                  />
                  <div>
                    <div className="text-sm">复制品牌字段</div>
                    <div className="text-[11px] text-muted-foreground">关闭后将剥离品牌属性（attr 85），降低品牌方投诉风险</div>
                  </div>
                </label>
              )}
            </div>

            {/* 一键继承源商品属性 */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleAutoInherit}
              disabled={inheriting || !publishShopId || !selectedIds.size}
            >
              {inheriting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
              从源商品继承分类/重量/尺寸
            </Button>

            <div className="space-y-2">
              <Label>OZON 分类 ID *</Label>
              <Input value={publishCategoryId} onChange={(e) => setPublishCategoryId(e.target.value)} placeholder="description_category_id" type="number" />
            </div>
            <div className="space-y-2">
              <Label>OZON 类型 ID (type_id) *</Label>
              <Input value={publishTypeId} onChange={(e) => setPublishTypeId(e.target.value)} placeholder="从分类树获取的 type_id" type="number" />
              <p className="text-xs text-muted-foreground">点击上方按钮自动从 OZON 源商品继承，或手动从分类树获取（最后一级）</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">重量(g)</Label>
                <Input value={publishWeight} onChange={(e) => setPublishWeight(e.target.value)} type="number" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">长(mm)</Label>
                <Input value={publishDepth} onChange={(e) => setPublishDepth(e.target.value)} type="number" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">宽(mm)</Label>
                <Input value={publishWidth} onChange={(e) => setPublishWidth(e.target.value)} type="number" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">高(mm)</Label>
                <Input value={publishHeight} onChange={(e) => setPublishHeight(e.target.value)} type="number" className="h-8 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">加价比例 %</Label>
                <Input value={publishMarkup} onChange={(e) => setPublishMarkup(e.target.value)} type="number" className="h-8 text-sm" placeholder="200" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">固定加价 CNY</Label>
                <Input value={publishMarkupAmount} onChange={(e) => setPublishMarkupAmount(e.target.value)} type="number" className="h-8 text-sm" placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-end pb-0.5">
                <p className="text-xs text-muted-foreground">卖价 = 采购价 × (1 + 加价%/100) + 固定加价；变体单独填写价格时按最终售价处理</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">将上架 {selectedIds.size} 件商品到 OZON（货币: CNY）</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPublishDialog(false)}>取消</Button>
              <Button onClick={handlePublish} disabled={publishing || !publishShopId || !publishCategoryId || !publishTypeId}>
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                确认上架
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑图片弹窗 */}
      <Dialog open={!!editImagesId} onOpenChange={(o) => { if (!o) setEditImagesId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑商品图片</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">每行一个图片URL，支持 http/https 链接</p>
            <textarea
              value={editImagesText}
              onChange={(e) => setEditImagesText(e.target.value)}
              placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"
              className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none font-mono"
            />
            {editImagesText.trim() && (
              <div className="flex gap-2 flex-wrap">
                {editImagesText.split('\n').filter((u) => u.trim().startsWith('http')).slice(0, 5).map((url, i) => (
                  <img key={i} src={url.trim()} alt="" className="h-12 w-12 rounded border object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditImagesId(null)}>取消</Button>
              <Button
                disabled={savingImages}
                onClick={async () => {
                  if (!editImagesId) return;
                  setSavingImages(true);
                  const images = editImagesText.split('\n').map((u) => u.trim()).filter((u) => u.startsWith('http'));
                  const res = await api.put(`/api/collect/${editImagesId}`, { images });
                  setSavingImages(false);
                  if (res.code === 1) {
                    toast({ title: '图片已更新' });
                    setEditImagesId(null);
                    fetchData();
                  } else {
                    toast({ title: '更新失败', description: res.msg, variant: 'destructive' });
                  }
                }}
              >
                {savingImages && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 扩展采集弹窗（任意商品） */}
      <Dialog open={showExtFetch} onOpenChange={(o) => { if (!o) { setShowExtFetch(false); setExtFetchResults(null); setExtFetchErrors([]); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>扩展采集（任意商品）</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              通过浏览器扩展采集任意 OZON 商品的完整数据（标题/图片/价格/属性），无需店铺凭证。需要：1) 已安装 SS ERP 扩展 2) 浏览器已打开 ozon.ru 页面
            </p>
            <div className="space-y-2">
              <Label>商品链接 / Product ID（每行一个）</Label>
              <textarea
                value={extFetchInput}
                onChange={(e) => setExtFetchInput(e.target.value)}
                placeholder={"https://www.ozon.ru/product/xxx-2515213005/\n2515213005\n每行一个链接或纯数字ID"}
                className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
              />
            </div>

            {extFetchResults && (
              <div className="p-3 rounded border bg-orange-50 text-orange-800 text-sm">
                已成功采集 {extFetchResults.length} 件商品并保存到采集列表
              </div>
            )}

            {extFetchErrors.length > 0 && (
              <div className="p-3 rounded border bg-red-50 text-red-700 text-xs space-y-1">
                {extFetchErrors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowExtFetch(false); setExtFetchResults(null); setExtFetchErrors([]); }}>
                {extFetchResults ? '关闭' : '取消'}
              </Button>
              {!extFetchResults && (
                <Button onClick={handleExtFetch} disabled={extFetching || !extFetchInput.trim()}>
                  {extFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                  {extFetching ? '采集中...' : '开始采集'}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* OZON 采集弹窗 */}
      <Dialog open={showOzonFetch} onOpenChange={(o) => { if (!o) { setShowOzonFetch(false); setOzonFetchResults(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>OZON 商品采集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择店铺 *</Label>
              <select
                value={ozonFetchShopId}
                onChange={(e) => setOzonFetchShopId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">选择OZON店铺</option>
                {shops.filter((s) => s.platform === 'OZON').map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>商品链接 / SKU / Product ID / Offer ID</Label>
              <textarea
                value={ozonFetchInput}
                onChange={(e) => setOzonFetchInput(e.target.value)}
                placeholder={"https://www.ozon.ru/product/xxx-123456\n1502334613\noffer-id-001\n每行一个，支持混合输入"}
                className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
              />
              <p className="text-xs text-muted-foreground">支持 OZON 商品链接、纯数字(product_id)、或 offer_id，每行一个</p>
            </div>

            {/* 采集结果预览 */}
            {ozonFetchResults && ozonFetchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                <p className="text-sm font-medium text-orange-700">已采集 {ozonFetchResults.length} 件商品:</p>
                {ozonFetchResults.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded border bg-muted/30">
                    {p.images?.[0] ? (
                      <img src={p.images[0]} alt="" className="h-10 w-10 rounded border object-cover shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center shrink-0">
                        <ShoppingCart className="h-4 w-4 opacity-30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {p.id} | {p.currency_code} {p.price}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ozonFetchResults && ozonFetchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">未找到商品数据</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowOzonFetch(false); setOzonFetchResults(null); }}>
                {ozonFetchResults ? '关闭' : '取消'}
              </Button>
              {!ozonFetchResults && (
                <Button onClick={handleOzonFetch} disabled={ozonFetching || !ozonFetchShopId || !ozonFetchInput.trim()}>
                  {ozonFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                  采集
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 从OZON补全信息弹窗 */}
      <Dialog open={showEnrichDialog} onOpenChange={(o) => { if (!o) setShowEnrichDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />从OZON补全商品信息
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              选择来源 OZON 店铺，系统将自动调用 OZON API 拉取选中商品的图片、名称、价格等完整信息。
            </p>
            <div className="space-y-2">
              <Label>来源店铺 *</Label>
              <select
                value={enrichShopId}
                onChange={(e) => setEnrichShopId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">选择OZON店铺</option>
                {shops.filter((s) => s.platform === 'OZON').map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              将补全 {selectedIds.size} 件商品（仅对 SKU 为纯数字 product_id 的商品有效）
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowEnrichDialog(false)}>取消</Button>
              <Button onClick={handleEnrich} disabled={enriching || !enrichShopId}>
                {enriching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                开始补全
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑商品弹窗 */}
      <Dialog open={!!editItemId} onOpenChange={(o) => { if (!o) setEditItemId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑商品信息</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">商品标题</Label>
              <Input value={editItemData.title} onChange={(e) => setEditItemData({ ...editItemData, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">上架标题（俄文，发送给 OZON）</Label>
              <Input value={editItemData.publishTitle} onChange={(e) => setEditItemData({ ...editItemData, publishTitle: e.target.value })} placeholder="Оригинальное русское название товара" />
              <p className="text-[11px] text-muted-foreground">商品标题可中文展示；上架标题不能含中文，否则后端会阻止上架。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {editingIsDomesticSupply ? (
                <div className="space-y-1">
                  <Label className="text-xs">货源商品ID</Label>
                  <Input value={editingItem?.sourceProductId || ''} disabled={editingIsDomesticSupply} className="bg-muted text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Ozon SKU / Product ID</Label>
                  <Input value={editItemData.sku} onChange={(e) => setEditItemData({ ...editItemData, sku: e.target.value })} />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">货币</Label>
                <Input value="CNY（人民币）" disabled className="bg-muted text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">采购价</Label>
              <Input
                type="number"
                value={editItemData.purchasePrice}
                onChange={(e) => setEditItemData({ ...editItemData, purchasePrice: e.target.value })}
              />
            </div>
            {editingIsDomesticSupply ? (
              <div className="space-y-1">
                <Label className="text-xs">商品链接</Label>
                <Input value={editItemData.sourceUrl} disabled={editingIsDomesticSupply} className="bg-muted text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">商品链接</Label>
                <Input value={editItemData.sourceUrl} onChange={(e) => setEditItemData({ ...editItemData, sourceUrl: e.target.value })} placeholder="https://..." />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">备注</Label>
              <textarea
                value={editItemData.notes}
                onChange={(e) => setEditItemData({ ...editItemData, notes: e.target.value })}
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                maxLength={2000}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditItemId(null)}>取消</Button>
              <Button onClick={handleSaveItem} disabled={savingItem}>
                {savingItem ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* 水印设置弹窗 */}
      <Dialog open={showWatermarkDialog} onOpenChange={setShowWatermarkDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>批量打水印</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">将对已选 {selectedIds.size} 件商品的图片添加水印</div>
            {wmTemplates.length > 0 && (
              <div>
                <Label>从模板选择</Label>
                <select
                  value={wmSelectedTemplate}
                  onChange={(e) => applyWmTemplate(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1"
                >
                  <option value="">— 自定义配置 —</option>
                  {wmTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.isDefault ? ' (默认)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  在 <a href="/image-processing" className="text-primary underline" target="_blank" rel="noreferrer">图片处理</a> 页面管理模板
                </p>
              </div>
            )}
            <div>
              <Label>水印类型</Label>
              <select value={wmType} onChange={(e) => setWmType(e.target.value as any)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1">
                <option value="text">文字水印</option>
                <option value="image">图片水印</option>
              </select>
            </div>
            {wmType === 'text' && (
              <div>
                <Label>水印文字</Label>
                <Input value={wmText} onChange={(e) => setWmText(e.target.value)} placeholder="输入水印文字（支持中俄文）" className="mt-1" />
                <button
                  type="button"
                  onClick={() => {
                    const shop = shops[0];
                    if (shop) setWmText(shop.name);
                  }}
                  className="text-[11px] text-primary mt-1 hover:underline"
                >
                  使用店铺名作为水印
                </button>
              </div>
            )}
            {wmType === 'image' && (
              <div>
                <Label>水印图片 URL</Label>
                <Input value={wmImageUrl} onChange={(e) => setWmImageUrl(e.target.value)} placeholder="https://..." className="mt-1" />
              </div>
            )}
            <div>
              <Label>位置</Label>
              <select value={wmPosition} onChange={(e) => setWmPosition(e.target.value as any)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mt-1">
                <option value="bottom-right">右下角</option>
                <option value="bottom-left">左下角</option>
                <option value="top-right">右上角</option>
                <option value="top-left">左上角</option>
                <option value="center">居中</option>
                <option value="tile">平铺</option>
              </select>
            </div>
            {wmType === 'text' && (
              <>
                <div>
                  <Label>字体颜色</Label>
                  <div className="flex gap-2 mt-1">
                    <input type="color" value={wmFontColor} onChange={(e) => setWmFontColor(e.target.value)} className="h-9 w-14 rounded border border-input" />
                    <Input value={wmFontColor} onChange={(e) => setWmFontColor(e.target.value)} className="flex-1" />
                  </div>
                </div>
                <div>
                  <Label>字号 (留空自动)</Label>
                  <Input type="number" value={wmFontSize} onChange={(e) => setWmFontSize(e.target.value)} placeholder="自动" className="mt-1" />
                </div>
              </>
            )}
            {wmType === 'image' && (
              <div>
                <Label>水印图占比 ({wmScale}%)</Label>
                <input type="range" min="5" max="80" value={wmScale} onChange={(e) => setWmScale(e.target.value)} className="w-full mt-1" />
              </div>
            )}
            <div>
              <Label>透明度 ({wmOpacity}%)</Label>
              <input type="range" min="10" max="100" value={wmOpacity} onChange={(e) => setWmOpacity(e.target.value)} className="w-full mt-1" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowWatermarkDialog(false)}>取消</Button>
              <Button onClick={handleWatermark} disabled={watermarking}>
                {watermarking ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ImageIcon className="h-4 w-4 mr-1" />}
                开始处理
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
