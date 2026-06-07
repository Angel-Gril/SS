'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, ListChecks, Loader2, PackagePlus, RefreshCw, Save, ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { sourceDataIssueText } from '@/lib/1688-source-issues';
import { api } from '@/lib/api';
import { invalidImageUrls, splitImageInput, validImageUrls } from '@/lib/image-links';
import { previewText } from '@/lib/text-preview';
import { formatDate } from '@/lib/utils';

interface Alibaba1688Variant {
  sku?: string | null;
  attrs?: Record<string, string> | null;
  price?: string | number | null;
  stock?: number | null;
  minOrderQty?: number | null;
  grossWeightGrams?: number | null;
  images?: string[] | null;
}

interface Collected1688Item {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceProductId: string | null;
  images: string[] | null;
  variants?: Alibaba1688Variant[] | null;
  purchasePrice: string | null;
  currency: string;
  createdAt: string;
  metadata?: {
    supplierName?: string | null;
    supplierLocation?: string | null;
    supplierYears?: number | string | null;
    monthlySales?: number | string | null;
    description?: string | null;
    categoryPath?: string | null;
    grossWeightGrams?: number | string | null;
    lengthMm?: number | string | null;
    widthMm?: number | string | null;
    heightMm?: number | string | null;
    dimensionsText?: string | null;
    minOrderQty?: number | string | null;
    logisticsText?: string | null;
    attributes?: Record<string, string>;
    skuCount?: number;
    sourceDataIssues?: string[];
    categoryMappingStatus?: string;
    listingPreparationStatus?: string | null;
    listingPreparationIssues?: string[];
    ozonPriceCheckContext?: OzonPriceCheckContext | null;
    priceCheckEstimate?: PriceCheckEstimate | null;
  } | null;
}

interface OzonPriceCheckContext {
  title?: string | null;
  productId?: string | null;
  sourceUrl?: string | null;
  price?: string | null;
  currency?: string | null;
}

interface PriceCheckEstimate {
  ozonPriceRub?: number | null;
  purchasePriceRub?: number | null;
  roughSpreadRub?: number | null;
  cnyPerRub?: number | null;
}

interface FormState {
  title: string;
  sourceUrl: string;
  priceText: string;
  imageText: string;
  supplierName: string;
  supplierLocation: string;
  supplierYears: string;
  monthlySales: string;
  categoryPath: string;
  grossWeightGrams: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  dimensionsText: string;
  minOrderQty: string;
  logisticsText: string;
  description: string;
  attributesText: string;
  skuText: string;
  notes: string;
}

type PreparationFilter = 'all' | 'collected_only' | 'draft' | 'ready';

const emptyForm: FormState = {
  title: '',
  sourceUrl: '',
  priceText: '',
  imageText: '',
  supplierName: '',
  supplierLocation: '',
  supplierYears: '',
  monthlySales: '',
  categoryPath: '',
  grossWeightGrams: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
  dimensionsText: '',
  minOrderQty: '',
  logisticsText: '',
  description: '',
  attributesText: '',
  skuText: '',
  notes: '',
};

const preparationFilterOptions: Array<{ value: PreparationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'collected_only', label: '仅采集' },
  { value: 'draft', label: '准备草稿' },
  { value: 'ready', label: '准备完成' },
];

function parseSkuText(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[|\t]/).map((part) => part.trim());
      return {
        skuId: parts[0] || `sku-${index + 1}`,
        specText: parts[1] || '',
        price: parts[2] || '',
        stock: parts[3] ? Number(parts[3]) : null,
        minOrderQty: parts[4] ? Number(parts[4]) : null,
        grossWeightGrams: parts[5] ? Number(parts[5]) : null,
        imageUrl: parts[6] || undefined,
      };
    });
}

function attributePreview(metadata?: Collected1688Item['metadata']) {
  const attrs = metadata?.attributes || {};
  return Object.entries(attrs).slice(0, 4).map(([key, value]) => `${key}: ${value}`).join(' / ');
}

function supplierText(metadata?: Collected1688Item['metadata']) {
  if (!metadata) return '';
  return [
    metadata.supplierName,
    metadata.supplierLocation,
    metadata.supplierYears ? `${metadata.supplierYears}年` : '',
  ].filter(Boolean).join(' · ');
}

function preparationStatusLabel(status?: string | null) {
  if (status === 'draft') return '准备草稿';
  if (status === 'ready') return '准备完成';
  return '仅采集';
}

function preparationStatus(item: Collected1688Item): PreparationFilter {
  const status = item.metadata?.listingPreparationStatus;
  if (status === 'draft' || status === 'ready') return status;
  return 'collected_only';
}

function preparationIssueText(issues?: string[]) {
  if (!issues?.length) return '';
  const labels: Record<string, string> = {
    missing_prepared_title_ru: '待补俄语标题',
    prepared_title_contains_cjk: '标题含中文',
    missing_target_price_cny: '待补目标售价',
    missing_source_images: '待补商品图片',
  };
  return issues.map((issue) => labels[issue] || issue).join(' / ');
}

function priceCheckText(context?: OzonPriceCheckContext | null) {
  if (!context) return '';
  const title = context.title || context.productId || 'Ozon 商品';
  const price = context.price ? `${context.price} ${context.currency || 'RUB'}` : '';
  return price ? `${title} · 售价 ${price}` : title;
}

function priceCheckEstimateText(estimate?: PriceCheckEstimate | null) {
  if (!estimate || estimate.roughSpreadRub == null || estimate.purchasePriceRub == null) return '';
  const spread = Number(estimate.roughSpreadRub);
  const purchaseRub = Number(estimate.purchasePriceRub);
  if (!Number.isFinite(spread) || !Number.isFinite(purchaseRub)) return '';
  const sign = spread > 0 ? '+' : '';
  return `核价粗差: ${sign}${spread.toFixed(2)} RUB · 采购折算 ${purchaseRub.toFixed(2)} RUB`;
}

function sourceDimensionsText(metadata?: Collected1688Item['metadata']) {
  if (!metadata) return '';
  const length = Number(metadata.lengthMm);
  const width = Number(metadata.widthMm);
  const height = Number(metadata.heightMm);
  if (Number.isFinite(length) && length > 0 && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `货源尺寸: ${Math.round(length)} x ${Math.round(width)} x ${Math.round(height)} mm`;
  }
  return metadata.dimensionsText ? `货源尺寸: ${metadata.dimensionsText}` : '';
}

function sourcePackageText(metadata?: Collected1688Item['metadata']) {
  if (!metadata) return '';
  const parts = [
    metadata.grossWeightGrams ? `毛重 ${metadata.grossWeightGrams}g` : '',
    metadata.minOrderQty ? `起订 ${metadata.minOrderQty}` : '',
    metadata.monthlySales ? `月销 ${metadata.monthlySales}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

function variantSpecText(variant: Alibaba1688Variant) {
  const attrs = variant.attrs || {};
  const text = Object.values(attrs).filter(Boolean).join(' / ');
  return text || variant.sku || '默认规格';
}

function variantMetaText(variant: Alibaba1688Variant) {
  return [
    variant.price != null && variant.price !== '' ? `¥${variant.price}` : '',
    variant.stock != null ? `库存 ${variant.stock}` : '',
    variant.minOrderQty != null ? `起订 ${variant.minOrderQty}` : '',
    variant.grossWeightGrams != null ? `${variant.grossWeightGrams}g` : '',
  ].filter(Boolean).join(' · ');
}

function variantImageUrl(variant: Alibaba1688Variant) {
  return validImageUrls(variant.images || [])[0] || '';
}

export default function Collect1688Page() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Collected1688Item[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preparationFilter, setPreparationFilter] = useState<PreparationFilter>('all');

  useEffect(() => {
    fetchRecent();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function fetchRecent() {
    setLoading(true);
    const params = new URLSearchParams({ sourcePlatform: '1688', limit: '20', offset: '0' });
    const res = await api.get<{ rows: Collected1688Item[] }>(`/api/collect?${params}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.rows);
      setSelectedIds(new Set());
    } else {
      toast({ title: res.msg || '加载 1688 采集记录失败', variant: 'destructive' });
    }
    setLoading(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    if (filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredItems.forEach((item) => next.delete(item.id));
        return next;
      });
      return;
    }
    setSelectedIds((prev) => new Set([...prev, ...filteredItems.map((item) => item.id)]));
  }

  function selectReadyVisible() {
    const readyIds = filteredItems.filter((item) => preparationStatus(item) === 'ready').map((item) => item.id);
    if (!readyIds.length) {
      toast({ title: '当前筛选下没有准备完成的记录' });
      return;
    }
    setSelectedIds(new Set(readyIds));
  }

  function goToPreparation(ids: string[]) {
    const normalized = ids.map((id) => id.trim()).filter(Boolean);
    if (!normalized.length) {
      toast({ title: '请先选择 1688 采集记录', variant: 'destructive' });
      return;
    }
    router.push(`/listing/1688?ids=${encodeURIComponent(normalized.join(','))}`);
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      toast({ title: '请输入商品标题', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const res = await api.post<{ id: string }>('/api/collect/1688', {
      title: form.title,
      sourceUrl: form.sourceUrl || undefined,
      priceText: form.priceText || undefined,
      imageText: form.imageText || undefined,
      supplierName: form.supplierName || undefined,
      supplierLocation: form.supplierLocation || undefined,
      supplierYears: form.supplierYears || undefined,
      monthlySales: form.monthlySales || undefined,
      categoryPath: form.categoryPath || undefined,
      grossWeightGrams: form.grossWeightGrams || undefined,
      lengthMm: form.lengthMm || undefined,
      widthMm: form.widthMm || undefined,
      heightMm: form.heightMm || undefined,
      dimensionsText: form.dimensionsText || undefined,
      minOrderQty: form.minOrderQty || undefined,
      logisticsText: form.logisticsText || undefined,
      description: form.description || undefined,
      attributesText: form.attributesText || undefined,
      skuItems: form.skuText.trim() ? parseSkuText(form.skuText) : undefined,
      notes: form.notes || undefined,
      currency: 'CNY',
    });
    setSaving(false);

    if (res.code === 1) {
      toast({ title: res.msg || '1688 商品已保存' });
      setForm(emptyForm);
      fetchRecent();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  const selectedCount = selectedIds.size;
  const filteredItems = useMemo(
    () => items.filter((item) => preparationFilter === 'all' || preparationStatus(item) === preparationFilter),
    [items, preparationFilter],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<PreparationFilter, number> = {
      all: items.length,
      collected_only: 0,
      draft: 0,
      ready: 0,
    };
    items.forEach((item) => {
      counts[preparationStatus(item)] += 1;
    });
    return counts;
  }, [items]);
  const allVisibleSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
  const formImageLinks = useMemo(() => splitImageInput(form.imageText), [form.imageText]);
  const validFormImages = useMemo(() => validImageUrls(formImageLinks), [formImageLinks]);
  const invalidFormImages = useMemo(() => invalidImageUrls(formImageLinks), [formImageLinks]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688 采集上品</h1>
          <p className="text-sm text-muted-foreground mt-1">保存货源商品信息，类目映射、翻译和属性生成在上架准备阶段执行。</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {selectedCount > 0 && (
            <Button size="sm" onClick={() => goToPreparation(Array.from(selectedIds))}>
              <ListChecks className="h-4 w-4 mr-1" />批量上架准备({selectedCount})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchRecent} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">刷新</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/collect')}>
            <ShoppingCart className="h-4 w-4 mr-1" />采集列表
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PackagePlus className="h-4 w-4" /> 新增 1688 采集记录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">商品标题 *</Label>
              <Input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="1688 商品标题" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">1688 商品链接</Label>
              <Input value={form.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="https://detail.1688.com/offer/..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">采购价</Label>
              <Input value={form.priceText} onChange={(e) => update('priceText', e.target.value)} placeholder="¥25.80" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">供应商</Label>
              <Input value={form.supplierName} onChange={(e) => update('supplierName', e.target.value)} placeholder="工厂/店铺名称" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">供应商地区</Label>
              <Input value={form.supplierLocation} onChange={(e) => update('supplierLocation', e.target.value)} placeholder="浙江 金华" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">经营年限</Label>
              <Input value={form.supplierYears} onChange={(e) => update('supplierYears', e.target.value)} placeholder="6" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">月销量</Label>
              <Input value={form.monthlySales} onChange={(e) => update('monthlySales', e.target.value)} placeholder="3000" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">1688 类目路径</Label>
              <Input value={form.categoryPath} onChange={(e) => update('categoryPath', e.target.value)} placeholder="鞋类 > 男鞋 > 运动鞋" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">毛重(g)</Label>
              <Input value={form.grossWeightGrams} onChange={(e) => update('grossWeightGrams', e.target.value)} placeholder="650" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">长(mm)</Label>
              <Input value={form.lengthMm} onChange={(e) => update('lengthMm', e.target.value)} placeholder="320" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">宽(mm)</Label>
              <Input value={form.widthMm} onChange={(e) => update('widthMm', e.target.value)} placeholder="220" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">高(mm)</Label>
              <Input value={form.heightMm} onChange={(e) => update('heightMm', e.target.value)} placeholder="110" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">起订量</Label>
              <Input value={form.minOrderQty} onChange={(e) => update('minOrderQty', e.target.value)} placeholder="2" />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label className="text-xs">尺寸原文</Label>
              <Input value={form.dimensionsText} onChange={(e) => update('dimensionsText', e.target.value)} placeholder="32x22x11cm" />
            </div>
            <div className="space-y-1 md:col-span-4">
              <Label className="text-xs">物流说明</Label>
              <Input value={form.logisticsText} onChange={(e) => update('logisticsText', e.target.value)} placeholder="广东发货，快递费按地区计算" />
            </div>
            <div className="space-y-1 md:col-span-4">
              <Label className="text-xs">商品描述</Label>
              <textarea
                className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="商品详情、包装说明、材质说明等"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">图片链接</Label>
              <textarea
                className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                value={form.imageText}
                onChange={(e) => update('imageText', e.target.value)}
                placeholder="每行一个图片 URL"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{validFormImages.length ? `有效图片 ${validFormImages.length} 张` : '暂无有效图片'}</span>
                {invalidFormImages.length > 0 && (
                  <span className="text-amber-600">有 {invalidFormImages.length} 条无效链接</span>
                )}
              </div>
              {validFormImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {validFormImages.slice(0, 8).map((image, index) => (
                    <a
                      key={`${image}-${index}`}
                      href={image}
                      target="_blank"
                      rel="noreferrer"
                      className="h-12 w-12 rounded border bg-muted/40 overflow-hidden"
                    >
                      <img src={image} alt="" className="h-full w-full object-cover" />
                    </a>
                  ))}
                  {validFormImages.length > 8 && (
                    <div className="h-12 min-w-12 rounded border bg-muted/40 px-2 flex items-center justify-center text-xs text-muted-foreground">
                      +{validFormImages.length - 8}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">商品属性</Label>
              <textarea
                className="w-full h-28 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                value={form.attributesText}
                onChange={(e) => update('attributesText', e.target.value)}
                placeholder={'材质：棉\n颜色：黑色\n风格：休闲'}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">SKU 明细</Label>
              <textarea
                className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                value={form.skuText}
                onChange={(e) => update('skuText', e.target.value)}
                placeholder={'skuId | 规格 | 价格 | 库存 | 起订量 | 毛重(g) | SKU图片URL\nsku-red-42 | 红色 / 42 | 26.5 | 120 | 2 | 650 | https://img.example.com/sku-red.jpg'}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">备注</Label>
              <Input value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="采集补充说明" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSubmit} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              保存采集记录
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">最近 1688 采集记录</CardTitle>
            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {preparationFilterOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={preparationFilter === option.value ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPreparationFilter(option.value)}
                    >
                      {option.label}({statusCounts[option.value]})
                    </Button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={selectReadyVisible}>
                  选择准备完成
                </Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 rounded"
                  />
                  全选当前筛选
                </label>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />加载中
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无 1688 采集记录</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">当前筛选下暂无记录</div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => (
                <div key={item.id} className="rounded-md border p-3 flex gap-3">
                  <div className="flex items-start pt-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      className="h-4 w-4 rounded"
                      aria-label={`选择 ${item.title}`}
                    />
                  </div>
                  <div className="h-16 w-16 rounded border bg-muted/40 overflow-hidden shrink-0">
                    {item.images?.[0] ? (
                      <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                        <PackagePlus className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="font-medium text-sm truncate max-w-[620px]">{item.title}</h2>
                      <Badge variant="outline">1688</Badge>
                      <Badge variant="secondary">类目映射待上架</Badge>
                      <Badge variant="outline">{preparationStatusLabel(item.metadata?.listingPreparationStatus)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>采购价: {item.purchasePrice ? `¥${item.purchasePrice}` : '未填写'}</span>
                      <span>Offer: {item.sourceProductId || '-'}</span>
                      <span>SKU: {item.metadata?.skuCount || 0}</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                    {(supplierText(item.metadata) || item.metadata?.categoryPath || attributePreview(item.metadata)) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {[supplierText(item.metadata), item.metadata?.categoryPath, attributePreview(item.metadata)].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {sourcePackageText(item.metadata) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {sourcePackageText(item.metadata)}
                      </div>
                    )}
                    {item.metadata?.logisticsText && (
                      <div className="text-xs text-muted-foreground truncate">
                        物流: {item.metadata.logisticsText}
                      </div>
                    )}
                    {previewText(item.metadata?.description) && (
                      <div className="text-xs text-muted-foreground truncate">
                        描述: {previewText(item.metadata?.description)}
                      </div>
                    )}
                    {!!item.variants?.length && (
                      <div className="mt-2 space-y-1">
                        {item.variants.slice(0, 3).map((variant, index) => {
                          const image = variantImageUrl(variant);
                          return (
                            <div key={`${variant.sku || 'sku'}-${index}`} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                              <div className="min-w-0 flex items-center gap-2">
                                {image && (
                                  <span aria-label="SKU 图片" className="h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted/40">
                                    <img src={image} alt="" className="h-full w-full object-cover" />
                                  </span>
                                )}
                                <span className="min-w-0 truncate">{variantSpecText(variant)}</span>
                              </div>
                              <span className="shrink-0 text-muted-foreground">{variantMetaText(variant)}</span>
                            </div>
                          );
                        })}
                        {item.variants.length > 3 && (
                          <div className="text-xs text-muted-foreground">还有 {item.variants.length - 3} 个 SKU 未展开显示</div>
                        )}
                      </div>
                    )}
                    {item.metadata?.ozonPriceCheckContext && (
                      <div className="text-xs text-muted-foreground truncate">
                        核价来源: {priceCheckText(item.metadata.ozonPriceCheckContext)}
                      </div>
                    )}
                    {priceCheckEstimateText(item.metadata?.priceCheckEstimate) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {priceCheckEstimateText(item.metadata?.priceCheckEstimate)}
                      </div>
                    )}
                    {sourceDimensionsText(item.metadata) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {sourceDimensionsText(item.metadata)}
                      </div>
                    )}
                    {preparationIssueText(item.metadata?.listingPreparationIssues) && (
                      <div className="text-xs text-amber-600 truncate">
                        准备缺项: {preparationIssueText(item.metadata?.listingPreparationIssues)}
                      </div>
                    )}
                    {sourceDataIssueText(item.metadata?.sourceDataIssues) && (
                      <div className="text-xs text-amber-600 truncate">
                        货源缺项: {sourceDataIssueText(item.metadata?.sourceDataIssues)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button size="sm" onClick={() => goToPreparation([item.id])}>
                      <ArrowRight className="h-4 w-4 mr-1" />上架准备
                    </Button>
                    {item.metadata?.ozonPriceCheckContext?.sourceUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={item.metadata.ozonPriceCheckContext.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />Ozon
                        </a>
                      </Button>
                    )}
                    {item.sourceUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />源页
                        </a>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => router.push('/collect')}>
                      采集列表
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
