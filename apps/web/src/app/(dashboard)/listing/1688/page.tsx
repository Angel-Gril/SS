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
import { formatDate } from '@/lib/utils';

interface Alibaba1688ListingItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceProductId: string | null;
  purchasePrice: string | null;
  currency: string;
  images: string[];
  variants: Array<{ sku?: string; attrs?: Record<string, string>; price?: string | number | null; stock?: number | null }>;
  notes: string;
  supplierName: string | null;
  categoryPath: string | null;
  attributes: Record<string, string>;
  skuCount: number;
  categoryMappingStatus: string;
  listingPreparationStatus: string;
  preparedTitleRu: string;
  targetPriceCny: string;
  listingNotes: string;
  ozonPriceCheckContext: OzonPriceCheckContext | null;
  priceCheckEstimate: PriceCheckEstimate | null;
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

function attrsText(attrs: Record<string, string>) {
  return Object.entries(attrs).slice(0, 6).map(([key, value]) => `${key}: ${value}`).join(' / ');
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

export default function Alibaba1688ListingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idsParam = searchParams.get('ids') || '';
  const ids = useMemo(() => idsParam.split(',').map((id) => id.trim()).filter(Boolean), [idsParam]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<Alibaba1688ListingItem[]>([]);

  useEffect(() => {
    if (!ids.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.post<Alibaba1688ListingItem[]>('/api/collect/1688/prefill', { ids }).then((res) => {
      if (res.code === 1 && res.data) {
        setItems(res.data);
      } else {
        toast({ title: res.msg || '加载 1688 上架准备数据失败', variant: 'destructive' });
      }
      setLoading(false);
    });
  }, [ids.join(',')]);

  function updateItem(id: string, field: 'preparedTitleRu' | 'targetPriceCny' | 'listingNotes', value: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  async function handleSave() {
    if (!items.length) return;
    setSaving(true);
    const res = await api.post<{ saved: number }>('/api/collect/1688/save-preparation', {
      items: items.map((item) => ({
        id: item.id,
        preparedTitleRu: item.preparedTitleRu,
        targetPriceCny: item.targetPriceCny,
        listingNotes: item.listingNotes,
      })),
    });
    setSaving(false);
    if (res.code === 1) {
      toast({ title: res.msg || '已保存 1688 上架准备草稿' });
      router.push('/collect/1688');
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

  if (!ids.length) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688 上架准备</h1>
          <p className="text-sm text-muted-foreground mt-1">未选择商品</p>
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
          <p className="text-sm text-muted-foreground mt-1">共 {items.length} 件商品 · 待翻译 · 待类目映射 · 待属性生成</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push('/collect/1688')}>
            <ArrowLeft className="h-4 w-4 mr-1" />返回采集
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !items.length}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            保存草稿
          </Button>
        </div>
      </div>

      {items.map((item) => (
        <Card key={item.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="h-4 w-4" />
              <span className="truncate">{item.title}</span>
              <Badge variant="outline">1688</Badge>
              <Badge variant="secondary">类目映射待上架</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="h-20 w-20 rounded-md border bg-muted/40 overflow-hidden shrink-0">
                {item.images[0] ? (
                  <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
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
                  {[item.supplierName, item.categoryPath, attrsText(item.attributes)].filter(Boolean).join(' · ') || '暂无供应商/类目/属性信息'}
                </div>
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
                  placeholder="199"
                />
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
      ))}
    </div>
  );
}
