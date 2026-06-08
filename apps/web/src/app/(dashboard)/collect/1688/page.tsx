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
import { normalizeSourcePlatform, sourcePlatformLabel } from '@/lib/source-platforms';
import { previewText } from '@/lib/text-preview';
import { formatDate } from '@/lib/utils';

interface Alibaba1688Variant {
  sku?: string | null;
  sourceSkuId?: string | null;
  sourcePlatform?: string | null;
  ozonSku?: string | null;
  ozonProductId?: string | null;
  ozonOfferId?: string | null;
  attrs?: Record<string, string> | null;
  price?: string | number | null;
  stock?: number | null;
  minOrderQty?: number | null;
  grossWeightGrams?: number | null;
  images?: string[] | null;
  imageUrl?: string | null;
}

interface Collected1688Item {
  id: string;
  title: string;
  status: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
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
    listingStatus?: string | null;
    lastListingTaskId?: number | string | null;
    lastListingJobId?: string | null;
    lastListingOfferIds?: string[];
    lastListingSubmittedAt?: string | null;
    lastListingRefreshedAt?: string | null;
    lastListingResultStatus?: string | null;
    lastListingFailedCount?: number | string | null;
    lastListingImportedCount?: number | string | null;
    lastListingPendingCount?: number | string | null;
    lastListingResultItems?: Array<{
      offerId?: string | null;
      productId?: string | null;
      status?: string | null;
      sourcePlatform?: string | null;
      sourceSkuId?: string | null;
      ozonSku?: string | null;
      ozonProductId?: string | null;
      ozonOfferId?: string | null;
      errors?: Array<{
        code?: string | null;
        state?: string | null;
        level?: string | null;
        field?: string | null;
        description?: string | null;
        message?: string | null;
      }>;
    }>;
    ozonPriceCheckContext?: OzonPriceCheckContext | null;
    priceCheckEstimate?: PriceCheckEstimate | null;
  } | null;
}

type ListingResultItem = NonNullable<NonNullable<Collected1688Item['metadata']>['lastListingResultItems']>[number];

interface OzonPriceCheckContext {
  title?: string | null;
  productId?: string | null;
  sku?: string | null;
  ozonSku?: string | null;
  offerId?: string | null;
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
  sourcePlatform: string;
  sourceProductId: string;
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
  sourcePlatform: '1688',
  sourceProductId: '',
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

function parseSkuSourceTrace(parts: string[]) {
  const legacyPlatform = normalizeSourcePlatform(parts[8]);
  const isLegacyPlatformColumn = !!legacyPlatform && !parts[9] && !parts[10];
  return {
    ozonProductId: isLegacyPlatformColumn ? undefined : parts[8] || undefined,
    ozonOfferId: isLegacyPlatformColumn ? undefined : parts[9] || undefined,
    sourcePlatform: isLegacyPlatformColumn ? legacyPlatform : normalizeSourcePlatform(parts[10]),
  };
}

function parseOptionalSkuNumber(value: string | undefined) {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceSkuIdForEditableRow(parts: string[]) {
  return parts[0] || '';
}

function parseSkuText(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[|\t]/).map((part) => part.trim());
      const sourceTrace = parseSkuSourceTrace(parts);
      const sourceSkuId = sourceSkuIdForEditableRow(parts);
      return {
        skuId: sourceSkuId,
        sourceSkuId: sourceSkuId,
        specText: parts[1] || '',
        price: parts[2] || '',
        stock: parseOptionalSkuNumber(parts[3]),
        minOrderQty: parseOptionalSkuNumber(parts[4]),
        grossWeightGrams: parseOptionalSkuNumber(parts[5]),
        imageUrl: parts[6] || undefined,
        ozonSku: parts[7] || undefined,
        ozonProductId: sourceTrace.ozonProductId,
        ozonOfferId: sourceTrace.ozonOfferId,
        sourcePlatform: sourceTrace.sourcePlatform,
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

function listingResultStatus(item: Collected1688Item) {
  const metadataStatus = item.metadata?.lastListingResultStatus || item.metadata?.listingStatus;
  if (metadataStatus) return metadataStatus;
  if (item.status === 'listing_failed') return 'failed';
  if (item.status === 'listed') return 'submitted';
  return '';
}

function listingStatusText(item: Collected1688Item) {
  const status = listingResultStatus(item);
  if (status === 'imported') return '上架成功';
  if (status === 'partial_failed') return '部分失败';
  if (status === 'failed') return '上架失败';
  if (status === 'pending') return '导入中';
  if (status === 'submitted') return '已提交上架';
  return '';
}

function listingStatusBadgeVariant(item: Collected1688Item): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  const status = listingResultStatus(item);
  if (status === 'imported') return 'success';
  if (status === 'partial_failed' || status === 'pending') return 'warning';
  if (status === 'failed') return 'destructive';
  return 'default';
}

function canSelectForListing(item: Collected1688Item) {
  const status = listingResultStatus(item);
  return status !== 'submitted' && status !== 'pending' && status !== 'imported';
}

function listingResultSummaryText(metadata?: Collected1688Item['metadata']) {
  if (!metadata?.lastListingRefreshedAt) return '';
  const imported = Number(metadata.lastListingImportedCount ?? 0);
  const failed = Number(metadata.lastListingFailedCount ?? 0);
  const pending = Number(metadata.lastListingPendingCount ?? 0);
  const parts = [
    Number.isFinite(imported) ? `成功 ${imported}` : '',
    Number.isFinite(failed) ? `失败 ${failed}` : '',
    Number.isFinite(pending) && pending > 0 ? `处理中 ${pending}` : '',
  ].filter(Boolean);
  return [
    parts.length ? `Ozon 结果: ${parts.join(' / ')}` : 'Ozon 结果已刷新',
    formatDate(metadata.lastListingRefreshedAt),
  ].filter(Boolean).join(' · ');
}

function listingResultFailureItems(metadata?: Collected1688Item['metadata']) {
  const items = Array.isArray(metadata?.lastListingResultItems) ? metadata.lastListingResultItems : [];
  return items
    .filter((item) => String(item.status || '').toLowerCase() === 'failed' || !!item.errors?.length)
    .slice(0, 3);
}

function listingResultItemErrorText(item: ListingResultItem) {
  const errors = Array.isArray(item.errors) ? item.errors : [];
  const text = errors
    .map((error) => [
      error.field ? `字段 ${error.field}` : '',
      error.code || error.state || '',
      error.message || error.description || '',
    ].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('；');
  return text || 'Ozon 未返回详细错误';
}

function resultSourceSkuLabel(item: ListingResultItem) {
  return item.sourcePlatform ? `${sourcePlatformLabel(item.sourcePlatform)} SKU` : '货源 SKU';
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
  return issues.map((issue) => labels[issue] || sourceDataIssueText([issue]) || issue).join(' / ');
}

function priceCheckText(context?: OzonPriceCheckContext | null) {
  if (!context) return '';
  const sku = context.sku || context.ozonSku || '';
  const productId = context.productId || '';
  const title = context.title || sku || productId || 'Ozon 商品';
  const price = context.price ? `${context.price} ${context.currency || 'RUB'}` : '';
  return [
    title,
    sku ? `Ozon SKU ${sku}` : '',
    !sku && productId ? `Ozon Product ID ${productId}` : '',
    price ? `售价 ${price}` : '',
  ].filter(Boolean).join(' · ');
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

function sourceSkuLabel(variant: Alibaba1688Variant) {
  return variant.sourcePlatform ? `${sourcePlatformLabel(variant.sourcePlatform)} SKU` : '货源 SKU';
}

function variantMetaText(variant: Alibaba1688Variant) {
  return [
    variant.sourceSkuId ? `${sourceSkuLabel(variant)} ${variant.sourceSkuId}` : '',
    variant.ozonSku ? `Ozon SKU ${variant.ozonSku}` : '',
    variant.ozonProductId ? `Ozon Product ID ${variant.ozonProductId}` : '',
    variant.ozonOfferId ? `Ozon Offer ID ${variant.ozonOfferId}` : '',
    variant.price != null && variant.price !== '' ? `¥${variant.price}` : '',
    variant.stock != null ? `库存 ${variant.stock}` : '',
    variant.minOrderQty != null ? `起订 ${variant.minOrderQty}` : '',
    variant.grossWeightGrams != null ? `${variant.grossWeightGrams}g` : '',
  ].filter(Boolean).join(' · ');
}

function variantImageUrl(variant: Alibaba1688Variant) {
  return validImageUrls([...(variant.images || []), variant.imageUrl || ''])[0] || '';
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
    const params = new URLSearchParams({ sourcePlatform: 'domestic-supply', limit: '20', offset: '0' });
    const res = await api.get<{ rows: Collected1688Item[] }>(`/api/collect?${params}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.rows);
      setSelectedIds(new Set());
    } else {
      toast({ title: res.msg || '加载货源采集记录失败', variant: 'destructive' });
    }
    setLoading(false);
  }

  function toggleSelected(id: string) {
    const item = items.find((row) => row.id === id);
    if (item && !canSelectForListing(item)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    const selectableItems = filteredItems.filter(canSelectForListing);
    if (!selectableItems.length) {
      toast({ title: '当前筛选下没有可重新上架准备的记录' });
      return;
    }
    if (selectableItems.every((item) => selectedIds.has(item.id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableItems.forEach((item) => next.delete(item.id));
        return next;
      });
      return;
    }
    setSelectedIds((prev) => new Set([...prev, ...selectableItems.map((item) => item.id)]));
  }

  function selectReadyVisible() {
    const readyIds = filteredItems
      .filter((item) => preparationStatus(item) === 'ready' && canSelectForListing(item))
      .map((item) => item.id);
    if (!readyIds.length) {
      toast({ title: '当前筛选下没有可重新上架准备的完成记录' });
      return;
    }
    setSelectedIds(new Set(readyIds));
  }

  function goToPreparation(ids: string[]) {
    const normalized = ids.map((id) => id.trim()).filter(Boolean);
    if (!normalized.length) {
      toast({ title: '请先选择货源采集记录', variant: 'destructive' });
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
      sourcePlatform: form.sourcePlatform,
      sourceProductId: form.sourceProductId || undefined,
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
      toast({ title: res.msg || '货源商品已保存' });
      setForm(emptyForm);
      fetchRecent();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

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
  const formImageLinks = useMemo(() => splitImageInput(form.imageText), [form.imageText]);
  const validFormImages = useMemo(() => validImageUrls(formImageLinks), [formImageLinks]);
  const invalidFormImages = useMemo(() => invalidImageUrls(formImageLinks), [formImageLinks]);
  const selectableFilteredItems = useMemo(() => filteredItems.filter(canSelectForListing), [filteredItems]);
  const selectedListingIds = useMemo(
    () => items
      .filter((item) => selectedIds.has(item.id) && canSelectForListing(item))
      .map((item) => item.id),
    [items, selectedIds],
  );
  const selectedCount = selectedListingIds.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">货源采集上品</h1>
          <p className="text-sm text-muted-foreground mt-1">保存货源商品信息，类目映射、翻译和属性生成在上架准备阶段执行。</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {selectedCount > 0 && (
            <Button size="sm" onClick={() => goToPreparation(selectedListingIds)}>
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
            <PackagePlus className="h-4 w-4" /> 新增货源采集记录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">商品标题 *</Label>
              <Input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="货源商品标题" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">货源平台</Label>
              <select
                value={form.sourcePlatform}
                onChange={(e) => update('sourcePlatform', e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="1688">1688</option>
                <option value="taobao">淘宝</option>
                <option value="tmall">天猫</option>
                <option value="jd">京东</option>
                <option value="pinduoduo">拼多多</option>
                <option value="pdd">拼多多(PDD)</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">货源商品ID</Label>
              <Input value={form.sourceProductId} onChange={(e) => update('sourceProductId', e.target.value)} placeholder="1688 offerId / 淘宝 itemId / 京东 wareId / 拼多多 goodsId" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">货源商品链接</Label>
              <Input value={form.sourceUrl} onChange={(e) => update('sourceUrl', e.target.value)} placeholder="https://detail.1688.com/offer/... / 淘宝 / 天猫 / 京东 / 拼多多商品链接" />
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
              <Label className="text-xs">货源类目路径</Label>
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
              <Label className="text-xs">货源 SKU 明细</Label>
              <textarea
                className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
                value={form.skuText}
                onChange={(e) => update('skuText', e.target.value)}
                placeholder={'货源 SKU ID | 规格 | 采购价 | 库存 | 起订量 | 毛重(g) | 货源 SKU 图片 URL | Ozon SKU | Ozon Product ID | Ozon Offer ID | 货源平台\nsku-red-42 | 红色 / 42 | 26.5 | 120 | 2 | 650 | https://img.example.com/sku-red.jpg | ozon-sku-42 | ozon-product-42 | ozon-offer-42 | 1688'}
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
            <CardTitle className="text-base">最近货源采集记录</CardTitle>
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
                    checked={selectableFilteredItems.length > 0 && selectableFilteredItems.every((item) => selectedIds.has(item.id))}
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
            <div className="py-10 text-center text-sm text-muted-foreground">暂无货源采集记录</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">当前筛选下暂无记录</div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const failedListingItems = listingResultFailureItems(item.metadata);
                return (
                <div key={item.id} className="rounded-md border p-3 flex gap-3">
                  <div className="flex items-start pt-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      disabled={!canSelectForListing(item)}
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
                      <Badge variant="outline">{sourcePlatformLabel(item.sourcePlatform)}</Badge>
                      <Badge variant="secondary">待上架准备</Badge>
                      <Badge variant="outline">{preparationStatusLabel(item.metadata?.listingPreparationStatus)}</Badge>
                      {listingStatusText(item) && <Badge variant={listingStatusBadgeVariant(item)}>{listingStatusText(item)}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>采购价: {item.purchasePrice ? `¥${item.purchasePrice}` : '未填写'}</span>
                      <span>货源商品ID: {item.sourceProductId || '-'}</span>
                      <span>货源 SKU: {item.metadata?.skuCount || 0}</span>
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
                    {item.metadata?.lastListingTaskId && (
                      <div className="text-xs text-emerald-700 dark:text-emerald-400 truncate">
                        最近上架: Task {item.metadata.lastListingTaskId}
                        {item.metadata.lastListingOfferIds?.length ? ` · offer ${item.metadata.lastListingOfferIds.length} 个` : ''}
                        {item.metadata.lastListingSubmittedAt ? ` · ${formatDate(item.metadata.lastListingSubmittedAt)}` : ''}
                        {item.metadata.lastListingRefreshedAt ? ` · 刷新 ${formatDate(item.metadata.lastListingRefreshedAt)}` : ''}
                      </div>
                    )}
                    {listingResultSummaryText(item.metadata) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {listingResultSummaryText(item.metadata)}
                      </div>
                    )}
                    {failedListingItems.length > 0 && (
                      <div className="rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive space-y-1">
                        <div className="font-medium">失败明细</div>
                        {failedListingItems.map((resultItem, index) => (
                          <div key={`${resultItem.offerId || resultItem.sourceSkuId || 'failed'}-${index}`} className="min-w-0">
                            <div className="truncate">
                              offer {resultItem.offerId || '-'}
                              {resultItem.sourceSkuId ? ` · ${resultSourceSkuLabel(resultItem)} ${resultItem.sourceSkuId}` : ''}
                              {resultItem.ozonSku ? ` · Ozon SKU ${resultItem.ozonSku}` : ''}
                              {resultItem.productId ? ` · Product ${resultItem.productId}` : ''}
                            </div>
                            <div className="truncate">{listingResultItemErrorText(resultItem)}</div>
                          </div>
                        ))}
                        {(item.metadata?.lastListingResultItems?.length || 0) > failedListingItems.length && (
                          <div className="text-destructive/80">更多结果请查看货源上架记录详情</div>
                        )}
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
                    <Button size="sm" onClick={() => goToPreparation([item.id])} disabled={!canSelectForListing(item)}>
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
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
