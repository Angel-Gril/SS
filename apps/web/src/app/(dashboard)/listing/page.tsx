'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, Upload, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { ImageManager } from '@/components/image-manager';
import { ListingJobList } from '@/components/listing-job-list';
import { formatVariantAttrs } from '@/lib/ozon-attr-names';

interface Shop { id: string; name: string; platform: string; }

interface VariantData {
  sku: string;
  attrs: Record<string, string>;
  price?: string | null;
  stock?: number;
  images?: string[];
}

interface CloneItem {
  id: string;
  title: string;
  description: string;
  sku: string | null;
  sourceUrl: string | null;
  purchasePrice: string | null;
  currency: string;
  images: string[];
  variants: VariantData[];
  modelId: string | null;
  categoryId: number | null;
  typeId: number | null;
  weightG: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  hasOzonAttributes: boolean;
}

interface WatermarkTemplate { id: string; name: string; config: any; }

export default function ListingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const idsParam = searchParams.get('ids') || '';
  const ids = useMemo(() => idsParam.split(',').filter(Boolean), [idsParam]);

  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState('');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CloneItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [markupPct, setMarkupPct] = useState('30');
  const [inheritCategory, setInheritCategory] = useState(true);
  const [followBrand, setFollowBrand] = useState(false);
  const [watermarkTemplates, setWatermarkTemplates] = useState<WatermarkTemplate[]>([]);

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        const ozonShops = res.data.filter((s) => s.platform === 'OZON');
        setShops(ozonShops);
        if (ozonShops.length > 0) setShopId(ozonShops[0]!.id);
      }
    });
    api.get<WatermarkTemplate[]>('/api/watermark-templates').then((res) => {
      if (res.code === 1 && res.data) setWatermarkTemplates(res.data);
    });
  }, []);

  useEffect(() => {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.post<CloneItem[]>('/api/collect/clone-prefill', { ids }).then((res) => {
      if (res.code === 1 && res.data) {
        setItems(res.data);
      } else {
        toast({ title: res.msg || '加载失败', variant: 'destructive' });
      }
      setLoading(false);
    });
  }, [ids.join(',')]);

  function updateItem<K extends keyof CloneItem>(id: string, field: K, value: CloneItem[K]) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function updateVariant(itemId: string, variantSku: string, field: 'price' | 'stock', value: string | number) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== itemId) return it;
      return {
        ...it,
        variants: it.variants.map((v) => (v.sku === variantSku ? { ...v, [field]: value } : v)),
      };
    }));
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!shopId) {
      toast({ title: '请选择店铺', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: '没有商品可上架', variant: 'destructive' });
      return;
    }
    // 校验：每个商品都必须有图、有标题、有分类/类型
    for (const it of items) {
      if (!it.title) { toast({ title: `${it.sku || it.id} 标题不能为空`, variant: 'destructive' }); return; }
      if (!it.images.length) { toast({ title: `${it.title} 至少要有一张图`, variant: 'destructive' }); return; }
      if (!it.categoryId || !it.typeId) {
        toast({ title: `${it.title} 缺少分类/类型 ID（请重新采集源商品）`, variant: 'destructive' });
        return;
      }
    }

    setSubmitting(true);
    try {
      // 1. 先把改动写回 supplyGoods
      for (const it of items) {
        await api.post('/api/collect/save-customization', {
          id: it.id,
          title: it.title,
          description: it.description,
          images: it.images,
          weightG: it.weightG,
          lengthMm: it.lengthMm,
          widthMm: it.widthMm,
          heightMm: it.heightMm,
          categoryId: it.categoryId,
          typeId: it.typeId,
          variants: it.variants.map((v) => ({ sku: v.sku, price: v.price ?? undefined, stock: v.stock })),
        });
      }
      // 2. 调 publish-ozon 走复制路径。inheritCategory=true 时不传 categoryId/typeId，让后端用每个 item 自己 metadata 里的；
      //    inheritCategory=false 时表示用户在表单里手填了，已经在 save-customization 里写到 metadata，后端读取时也是 metadata 优先
      const res = await api.post<{ taskId?: string }>('/api/collect/publish-ozon', {
        ids: items.map((it) => it.id),
        shopId,
        categoryId: items[0]!.categoryId || 0,
        typeId: items[0]!.typeId || 0,
        markupPct: Number(markupPct) || 0,
        mode: 'clone',
        followBrand,
        source: 'listing-page',
      });
      if (res.code === 1) {
        toast({ title: '已提交上架任务，请到本页底部「改款上架记录」查看进度' });
        router.push('/collect');
      } else {
        const errorMsg = res.msg || '上架失败';
        toast({
          title: '上架失败',
          description: errorMsg,
          variant: 'destructive',
          duration: 8000,
        });
        console.error('[publish-ozon listing] error:', errorMsg);
      }
    } catch (e: any) {
      toast({ title: `提交失败：${e.message}`, variant: 'destructive' });
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (ids.length === 0) {
    return (
      <div className="space-y-4">
        <div className="border-l-4 border-orange-500 pl-3 py-1 bg-orange-50/40 dark:bg-orange-950/20 rounded-r">
          <h1 className="text-2xl font-semibold tracking-tight text-orange-700 dark:text-orange-400">Ozon 采集改款</h1>
          <p className="text-muted-foreground mt-1 text-sm">基于已采集的商品改款上架（独立新品，offer_id 自动新生成）</p>
        </div>
        <Card className="border-orange-200 dark:border-orange-900">
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <p className="text-sm">请先到 商品采集与上架 选择要改款的 Ozon 商品，点击「Ozon 采集改款」按钮跳转</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => router.push('/collect')} className="bg-orange-600 hover:bg-orange-700 text-white">
                <ArrowLeft className="h-4 w-4 mr-1" /> 去 商品采集与上架
              </Button>
              <Button variant="outline" onClick={() => router.push('/collect/1688')}>
                货源采集上品
              </Button>
              <Button variant="outline" onClick={() => router.push('/listing/1688')}>
                货源上架准备
              </Button>
            </div>
          </CardContent>
        </Card>
        <ListingJobList entryFilter="listing-page" title="改款上架记录" accentEmerald limit={30} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-l-4 border-orange-500 pl-3 py-1 bg-orange-50/40 dark:bg-orange-950/20 rounded-r">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-orange-700 dark:text-orange-400">Ozon 采集改款</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            共 {items.length} 件商品 · 走商品复制路径（offer_id 自动新生成，对 OZON 是独立新品）
          </p>
        </div>
        <div className="flex items-center gap-2 pr-3">
          <Button variant="outline" size="sm" onClick={() => router.push('/collect')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
        </div>
      </div>

      {/* 全局参数 */}
      <Card className="border-orange-200 dark:border-orange-900">
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">目标店铺 *</Label>
              <select
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {shops.length === 0 && <option value="">请先添加 OZON 店铺</option>}
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">加价比例 %</Label>
              <Input value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} className="h-8 text-sm" type="number" />
              <p className="text-[10px] text-muted-foreground">卖价 = 采购价(RMB) × (1 + 加价%)，最终上架货币 CNY，全程不做汇率换算</p>
            </div>
            <div className="space-y-1 flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={inheritCategory} onChange={(e) => setInheritCategory(e.target.checked)} className="accent-orange-600" />
                继承源商品分类/类型 ID
              </label>
            </div>
            <div className="space-y-1 flex items-end">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={followBrand} onChange={(e) => setFollowBrand(e.target.checked)} className="accent-orange-600" />
                复制源品牌字段
              </label>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !shopId} className="w-full h-9 bg-orange-600 hover:bg-orange-700 text-white">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="ml-1.5">提交上架（{items.length} 件商品）</span>
          </Button>
        </CardContent>
      </Card>

      {/* 商品列表 */}
      {items.map((item) => {
        const isExpanded = expanded.has(item.id);
        const hasVariants = item.variants.length > 0;
        return (
          <Card key={item.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="text-muted-foreground">源 SKU:</span>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{item.sku || '—'}</code>
                {item.modelId && <Badge variant="secondary">model_id: {item.modelId}</Badge>}
                {hasVariants && <Badge variant="outline">{item.variants.length} 个变体（N合1上架）</Badge>}
                {!item.hasOzonAttributes && <Badge variant="destructive">⚠ 缺 OZON 属性，建议先「从OZON补全信息」</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 标题 + 采购价 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1 md:col-span-2">
                  <Label className="text-xs">商品标题 * (将作为 OZON name)</Label>
                  <Input
                    value={item.title}
                    onChange={(e) => updateItem(item.id, 'title', e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    采购价 (RMB)
                    {item.currency && item.currency !== 'CNY' && (
                      <span className="ml-1 text-[10px] text-destructive">⚠ 数据库 currency={item.currency}，请到「SKU 采集跟卖」页修正</span>
                    )}
                  </Label>
                  <Input
                    value={item.purchasePrice || ''}
                    readOnly
                    className="h-8 text-sm bg-muted"
                  />
                </div>
              </div>

              {/* 分类/类型 ID */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">
                    分类 ID (description_category_id) <span className="text-destructive">*</span>
                    {inheritCategory && <span className="ml-2 text-orange-600 text-[10px]">已从源继承</span>}
                  </Label>
                  <Input
                    type="number"
                    value={item.categoryId || ''}
                    onChange={(e) => updateItem(item.id, 'categoryId', Number(e.target.value) || null)}
                    readOnly={inheritCategory}
                    placeholder="必填，OZON 分类 ID"
                    className={`h-8 text-sm ${inheritCategory ? 'bg-muted' : ''}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">
                    类型 ID (type_id) <span className="text-destructive">*</span>
                    {inheritCategory && <span className="ml-2 text-orange-600 text-[10px]">已从源继承</span>}
                  </Label>
                  <Input
                    type="number"
                    value={item.typeId || ''}
                    onChange={(e) => updateItem(item.id, 'typeId', Number(e.target.value) || null)}
                    readOnly={inheritCategory}
                    placeholder="必填，OZON 类型 ID"
                    className={`h-8 text-sm ${inheritCategory ? 'bg-muted' : ''}`}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">商品描述</Label>
                <textarea
                  value={item.description}
                  onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                  className="w-full h-16 rounded-md border border-input bg-background px-3 py-2 text-sm resize-y"
                  placeholder="商品描述（可选，留空则继承源商品）"
                />
              </div>

              {/* 尺寸重量 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">重量 (g)</Label>
                  <Input
                    type="number"
                    value={item.weightG}
                    onChange={(e) => updateItem(item.id, 'weightG', Number(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">长 (mm)</Label>
                  <Input
                    type="number"
                    value={item.lengthMm}
                    onChange={(e) => updateItem(item.id, 'lengthMm', Number(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">宽 (mm)</Label>
                  <Input
                    type="number"
                    value={item.widthMm}
                    onChange={(e) => updateItem(item.id, 'widthMm', Number(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">高 (mm)</Label>
                  <Input
                    type="number"
                    value={item.heightMm}
                    onChange={(e) => updateItem(item.id, 'heightMm', Number(e.target.value) || 0)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              {/* 图片管理 */}
              <div className="space-y-1">
                <Label className="text-xs">商品图片 * (主图为第一张)</Label>
                <ImageManager
                  images={item.images}
                  onChange={(next) => updateItem(item.id, 'images', next)}
                  shopId={shopId}
                  itemId={item.id}
                  watermarkTemplates={watermarkTemplates}
                />
              </div>

              {/* 变体表格 */}
              {hasVariants && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {item.variants.length} 个变体（点击{isExpanded ? '收起' : '展开'}调整价格/库存）
                  </button>
                  {isExpanded && (
                    <div className="border rounded-md overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left px-2 py-1.5">SKU</th>
                            <th className="text-left px-2 py-1.5">变体属性</th>
                            <th className="text-left px-2 py-1.5 w-32">价格 (源, CNY)</th>
                            <th className="text-left px-2 py-1.5 w-24">库存</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.variants.map((v) => (
                            <tr key={v.sku} className="border-t">
                              <td className="px-2 py-1.5 font-mono">{v.sku}</td>
                              <td className="px-2 py-1.5">
                                {formatVariantAttrs(v.attrs) || '—'}
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  value={v.price ?? ''}
                                  onChange={(e) => updateVariant(item.id, v.sku, 'price', e.target.value)}
                                  className="h-7 text-xs"
                                  placeholder="留空走全局加价"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <Input
                                  type="number"
                                  value={v.stock || 0}
                                  onChange={(e) => updateVariant(item.id, v.sku, 'stock', Number(e.target.value) || 0)}
                                  className="h-7 text-xs"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <ListingJobList entryFilter="listing-page" title="改款上架记录" accentEmerald limit={30} />
    </div>
  );
}
