'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2, Save, Tags } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { invalidImageUrls, splitImageInput, validImageUrls } from '@/lib/image-links';
import { formatDate } from '@/lib/utils';

interface Alibaba1688Variant {
  sku?: string | null;
  attrs?: Record<string, string> | null;
  price?: string | number | null;
  stock?: number | null;
  minOrderQty?: number | null;
  grossWeightGrams?: number | null;
}

interface Alibaba1688ListingItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceProductId: string | null;
  purchasePrice: string | null;
  currency: string;
  images: string[];
  variants: Alibaba1688Variant[];
  notes: string;
  supplierName: string | null;
  supplierLocation: string | null;
  supplierYears: number | string | null;
  monthlySales: number | string | null;
  categoryPath: string | null;
  grossWeightGrams: number | string | null;
  lengthMm: number | string | null;
  widthMm: number | string | null;
  heightMm: number | string | null;
  dimensionsText: string | null;
  minOrderQty: number | string | null;
  logisticsText: string | null;
  attributes: Record<string, string>;
  skuCount: number;
  categoryMappingStatus: string;
  listingPreparationStatus: string;
  listingPreparationIssues: string[];
  preparedTitleRu: string;
  targetPriceCny: string;
  listingNotes: string;
  ozonPriceCheckContext: OzonPriceCheckContext | null;
  priceCheckEstimate: PriceCheckEstimate | null;
  priceSuggestion: PriceSuggestion | null;
  createdAt: string;
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

interface PriceSuggestion {
  purchasePriceCny?: number | null;
  costPlusTargetCny?: number | null;
  ozonPriceRub?: number | null;
  ozonPriceCny?: number | null;
  cnyPerRub?: number | null;
  recommendedTargetPriceCny?: number | null;
  recommendationSource?: string | null;
}

type PreparationFilter = 'all' | 'draft' | 'ready';

const CJK_TEXT_RE = /[\u3400-\u9fff]/;

const preparationFilterOptions: Array<{ value: PreparationFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '待补资料' },
  { value: 'ready', label: '准备完成' },
];

function attrsText(attrs: Record<string, string>) {
  return Object.entries(attrs).slice(0, 6).map(([key, value]) => `${key}: ${value}`).join(' / ');
}

function supplierText(item: Alibaba1688ListingItem) {
  return [
    item.supplierName,
    item.supplierLocation,
    item.supplierYears ? `${item.supplierYears}年` : '',
  ].filter(Boolean).join(' · ');
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

function formatCny(value?: number | null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `¥${number.toFixed(number % 1 === 0 ? 0 : 2)}`;
}

function suggestionSummary(suggestion?: PriceSuggestion | null) {
  if (!suggestion) return '';
  return [
    suggestion.ozonPriceCny ? `Ozon折算 ${formatCny(suggestion.ozonPriceCny)}` : '',
    suggestion.costPlusTargetCny ? `成本倍率 ${formatCny(suggestion.costPlusTargetCny)}` : '',
  ].filter(Boolean).join(' · ');
}

function preparationStatusLabel(status?: string | null) {
  if (status === 'ready') return '准备完成';
  if (status === 'draft') return '准备草稿';
  return '仅采集';
}

function preparationIssueLabels(issues?: string[]) {
  const labels: Record<string, string> = {
    missing_prepared_title_ru: '待补俄语标题',
    prepared_title_contains_cjk: '标题含中文',
    missing_target_price_cny: '待补目标售价',
    missing_source_images: '待补商品图片',
  };
  return (issues || []).map((issue) => labels[issue] || issue);
}

function currentPreparationIssues(item: Alibaba1688ListingItem) {
  const title = item.preparedTitleRu.trim();
  const targetPrice = Number(item.targetPriceCny);
  const issues: string[] = [];
  if (!title) issues.push('missing_prepared_title_ru');
  else if (CJK_TEXT_RE.test(title)) issues.push('prepared_title_contains_cjk');
  if (!(Number.isFinite(targetPrice) && targetPrice > 0)) issues.push('missing_target_price_cny');
  if (!validImageUrls(item.images).length) issues.push('missing_source_images');
  return issues;
}

function currentPreparationStatus(item: Alibaba1688ListingItem) {
  return currentPreparationIssues(item).length ? 'draft' : 'ready';
}

function sourceDimensionsText(item: Alibaba1688ListingItem) {
  const length = Number(item.lengthMm);
  const width = Number(item.widthMm);
  const height = Number(item.heightMm);
  if (Number.isFinite(length) && length > 0 && Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return `货源尺寸: ${Math.round(length)} x ${Math.round(width)} x ${Math.round(height)} mm`;
  }
  return item.dimensionsText ? `货源尺寸: ${item.dimensionsText}` : '';
}

function sourcePackageText(item: Alibaba1688ListingItem) {
  const parts = [
    item.grossWeightGrams ? `毛重 ${item.grossWeightGrams}g` : '',
    item.minOrderQty ? `起订 ${item.minOrderQty}` : '',
    item.monthlySales ? `月销 ${item.monthlySales}` : '',
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

export default function Alibaba1688ListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') || '';
  const ids = useMemo(() => idsParam.split(',').map((id) => id.trim()).filter(Boolean), [idsParam]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Alibaba1688ListingItem[]>([]);
  const [preparationFilter, setPreparationFilter] = useState<PreparationFilter>('all');
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.post<Alibaba1688ListingItem[]>('/api/collect/1688/prefill', ids.length ? { ids } : {}).then((res) => {
      if (res.code === 1 && res.data) {
        setItems(res.data);
        setDirtyItemIds(new Set());
      } else {
        toast({ title: res.msg || '加载 1688 上架准备数据失败', variant: 'destructive' });
      }
      setLoading(false);
    });
  }, [ids.join(',')]);

  function markItemDirty(id: string) {
    setDirtyItemIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function updateItem(id: string, field: 'preparedTitleRu' | 'targetPriceCny' | 'listingNotes', value: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    markItemDirty(id);
  }

  function updateItemImages(id: string, value: string) {
    const images = splitImageInput(value);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, images } : item)));
    markItemDirty(id);
  }

  function applyTargetPrice(id: string, value?: number | null) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return;
    updateItem(id, 'targetPriceCny', String(number));
  }

  function applySuggestedPricesToEmpty() {
    if (!filteredItems.length) {
      toast({ title: '当前筛选下没有可填入售价的记录' });
      return;
    }
    const visibleIds = new Set(filteredItems.map((item) => item.id));
    let applied = 0;
    const appliedIds: string[] = [];
    const nextItems = items.map((item) => {
      if (!visibleIds.has(item.id)) return item;
      if (item.targetPriceCny.trim()) return item;
      const value = Number(item.priceSuggestion?.recommendedTargetPriceCny);
      if (!Number.isFinite(value) || value <= 0) return item;
      applied++;
      appliedIds.push(item.id);
      return { ...item, targetPriceCny: String(value) };
    });
    setItems(nextItems);
    if (appliedIds.length) {
      setDirtyItemIds((prev) => new Set([...prev, ...appliedIds]));
    }

    toast({
      title: applied ? `已填入当前筛选中的 ${applied} 个建议售价` : '当前筛选下没有可填入的空售价',
    });
  }

  const filteredItems = useMemo(
    () => items.filter((item) => preparationFilter === 'all' || currentPreparationStatus(item) === preparationFilter),
    [items, preparationFilter],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<PreparationFilter, number> = {
      all: items.length,
      draft: 0,
      ready: 0,
    };
    items.forEach((item) => {
      counts[currentPreparationStatus(item)] += 1;
    });
    return counts;
  }, [items]);

  async function handleSave() {
    const dirtyItems = items.filter((item) => dirtyItemIds.has(item.id));
    if (!dirtyItems.length) {
      toast({ title: '没有需要保存的修改' });
      return;
    }
    setSaving(true);
    const res = await api.post<{ saved: number; ready: number; draft: number; items?: Alibaba1688ListingItem[] }>('/api/collect/1688/save-preparation', {
      items: dirtyItems.map((item) => ({
        id: item.id,
        preparedTitleRu: item.preparedTitleRu,
        targetPriceCny: item.targetPriceCny,
        listingNotes: item.listingNotes,
        images: item.images,
      })),
    });
    setSaving(false);
    if (res.code === 1) {
      toast({ title: res.msg || '已保存 1688 上架准备草稿' });
      if (res.data?.items?.length) {
        const updatedItems = new Map(res.data.items.map((item) => [item.id, item]));
        setItems((prev) => prev.map((item) => updatedItems.get(item.id) || item));
        const savedIds = new Set(res.data.items.map((item) => item.id));
        setDirtyItemIds((prev) => {
          const next = new Set(prev);
          savedIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688 上架准备</h1>
          <p className="text-sm text-muted-foreground mt-1">暂无可准备的 1688 采集记录</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Button onClick={() => router.push('/collect/1688')}>
              <ArrowLeft className="h-4 w-4 mr-1" />返回 1688 采集上品
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688 上架准备</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ids.length ? `共 ${items.length} 件商品` : `最近 ${items.length} 条 1688 采集记录`} · 当前显示 {filteredItems.length} 条 · 待翻译 · 待类目映射 · 待属性生成
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={applySuggestedPricesToEmpty} disabled={!items.length}>
            填入当前空售价
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/collect/1688')}>
            <ArrowLeft className="h-4 w-4 mr-1" />返回采集
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !items.length}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            保存修改{dirtyItemIds.size ? `(${dirtyItemIds.size})` : ''}
          </Button>
        </div>
      </div>

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

      {filteredItems.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            当前筛选下暂无 1688 上架准备记录
          </CardContent>
        </Card>
      )}

      {filteredItems.map((item) => {
        const validImages = validImageUrls(item.images);
        const invalidImages = invalidImageUrls(item.images);

        return (
        <Card key={item.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="h-4 w-4" />
              <span className="truncate">{item.title}</span>
              <Badge variant="outline">1688</Badge>
              <Badge variant="secondary">类目映射待上架</Badge>
              {dirtyItemIds.has(item.id) && <Badge variant="outline">未保存</Badge>}
              <Badge variant={currentPreparationStatus(item) === 'ready' ? 'default' : 'outline'}>
                {preparationStatusLabel(currentPreparationStatus(item))}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="h-20 w-20 rounded-md border bg-muted/40 overflow-hidden shrink-0">
                {validImages[0] ? (
                  <img src={validImages[0]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <Tags className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2 text-sm">
                <div className="flex gap-3 flex-wrap text-muted-foreground">
                  <span>采购价: {item.purchasePrice ? `¥${item.purchasePrice}` : '未填写'}</span>
                  <span>Offer: {item.sourceProductId || '-'}</span>
                  <span>SKU: {item.skuCount || item.variants.length}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <div className="text-muted-foreground truncate">
                  {[supplierText(item), item.categoryPath, attrsText(item.attributes)].filter(Boolean).join(' · ') || '暂无供应商/类目/属性信息'}
                </div>
                {sourcePackageText(item) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {sourcePackageText(item)}
                  </div>
                )}
                {item.logisticsText && (
                  <div className="text-xs text-muted-foreground truncate">
                    物流: {item.logisticsText}
                  </div>
                )}
                {!!item.variants.length && (
                  <div className="mt-2 space-y-1">
                    {item.variants.slice(0, 4).map((variant, index) => (
                      <div key={`${variant.sku || 'sku'}-${index}`} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                        <span className="min-w-0 truncate">{variantSpecText(variant)}</span>
                        <span className="shrink-0 text-muted-foreground">{variantMetaText(variant)}</span>
                      </div>
                    ))}
                    {item.variants.length > 4 && (
                      <div className="text-xs text-muted-foreground">还有 {item.variants.length - 4} 个 SKU 未展开显示</div>
                    )}
                  </div>
                )}
                {item.ozonPriceCheckContext && (
                  <div className="text-xs text-muted-foreground truncate">
                    核价来源: {priceCheckText(item.ozonPriceCheckContext)}
                  </div>
                )}
                {priceCheckEstimateText(item.priceCheckEstimate) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {priceCheckEstimateText(item.priceCheckEstimate)}
                  </div>
                )}
                {suggestionSummary(item.priceSuggestion) && (
                  <div className="text-xs text-muted-foreground truncate">
                    建议售价: {suggestionSummary(item.priceSuggestion)}
                  </div>
                )}
                {sourceDimensionsText(item) && (
                  <div className="text-xs text-muted-foreground truncate">
                    {sourceDimensionsText(item)}
                  </div>
                )}
                {preparationIssueLabels(currentPreparationIssues(item)).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {preparationIssueLabels(currentPreparationIssues(item)).map((label) => (
                      <Badge key={label} variant="outline" className="text-amber-600 border-amber-300">
                        {label}
                      </Badge>
                    ))}
                  </div>
                )}
                {(item.sourceUrl || item.ozonPriceCheckContext?.sourceUrl) && (
                  <div className="flex flex-wrap gap-2">
                    {item.sourceUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />源页
                        </a>
                      </Button>
                    )}
                    {item.ozonPriceCheckContext?.sourceUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={item.ozonPriceCheckContext.sourceUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" />Ozon
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">俄语标题草稿</Label>
                <Input
                  value={item.preparedTitleRu}
                  onChange={(e) => updateItem(item.id, 'preparedTitleRu', e.target.value)}
                  placeholder="Мужские кроссовки"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">目标售价 CNY</Label>
                <Input
                  value={item.targetPriceCny}
                  onChange={(e) => updateItem(item.id, 'targetPriceCny', e.target.value)}
                  placeholder={item.priceSuggestion?.recommendedTargetPriceCny ? String(item.priceSuggestion.recommendedTargetPriceCny) : '199'}
                />
                {(item.priceSuggestion?.ozonPriceCny || item.priceSuggestion?.costPlusTargetCny) && (
                  <div className="flex flex-wrap gap-1">
                    {item.priceSuggestion?.ozonPriceCny && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyTargetPrice(item.id, item.priceSuggestion?.ozonPriceCny)}
                      >
                        填入Ozon折算 {formatCny(item.priceSuggestion.ozonPriceCny)}
                      </Button>
                    )}
                    {item.priceSuggestion?.costPlusTargetCny && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyTargetPrice(item.id, item.priceSuggestion?.costPlusTargetCny)}
                      >
                        填入成本倍率 {formatCny(item.priceSuggestion.costPlusTargetCny)}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">商品图片链接</Label>
                <textarea
                  className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                  value={item.images.join('\n')}
                  onChange={(e) => updateItemImages(item.id, e.target.value)}
                  placeholder="每行一个图片 URL"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{validImages.length ? `有效图片 ${validImages.length} 张` : '暂无有效图片'}</span>
                  {invalidImages.length > 0 && (
                    <span className="text-amber-600">有 {invalidImages.length} 条无效链接</span>
                  )}
                </div>
                {validImages.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {validImages.slice(0, 8).map((image, index) => (
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
                    {validImages.length > 8 && (
                      <div className="h-12 min-w-12 rounded border bg-muted/40 px-2 flex items-center justify-center text-xs text-muted-foreground">
                        +{validImages.length - 8}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">上架备注</Label>
                <Input
                  value={item.listingNotes}
                  onChange={(e) => updateItem(item.id, 'listingNotes', e.target.value)}
                  placeholder="尺码偏小，图片需重绘"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}
