'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, PackagePlus, RefreshCw, Save, ShoppingCart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Collected1688Item {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceProductId: string | null;
  images: string[] | null;
  purchasePrice: string | null;
  currency: string;
  createdAt: string;
  metadata?: {
    supplierName?: string | null;
    categoryPath?: string | null;
    attributes?: Record<string, string>;
    skuCount?: number;
    categoryMappingStatus?: string;
  } | null;
}

interface FormState {
  title: string;
  sourceUrl: string;
  priceText: string;
  imageText: string;
  supplierName: string;
  categoryPath: string;
  attributesText: string;
  skuText: string;
  notes: string;
}

const emptyForm: FormState = {
  title: '',
  sourceUrl: '',
  priceText: '',
  imageText: '',
  supplierName: '',
  categoryPath: '',
  attributesText: '',
  skuText: '',
  notes: '',
};

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
      };
    });
}

function attributePreview(metadata?: Collected1688Item['metadata']) {
  const attrs = metadata?.attributes || {};
  return Object.entries(attrs).slice(0, 4).map(([key, value]) => `${key}: ${value}`).join(' / ');
}

export default function Collect1688Page() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Collected1688Item[]>([]);

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
    } else {
      toast({ title: res.msg || '加载 1688 采集记录失败', variant: 'destructive' });
    }
    setLoading(false);
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
      categoryPath: form.categoryPath || undefined,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688 采集上品</h1>
          <p className="text-sm text-muted-foreground mt-1">保存货源商品信息，类目映射、翻译和属性生成在上架准备阶段执行。</p>
        </div>
        <div className="flex gap-2">
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
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">1688 类目路径</Label>
              <Input value={form.categoryPath} onChange={(e) => update('categoryPath', e.target.value)} placeholder="鞋类 > 男鞋 > 运动鞋" />
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
                placeholder={'skuId | 规格 | 价格 | 库存 | 起订量\nsku-red-42 | 红色 / 42 | 26.5 | 120 | 2'}
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
          <CardTitle className="text-base">最近 1688 采集记录</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />加载中
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无 1688 采集记录</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-md border p-3 flex gap-3">
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
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>采购价: {item.purchasePrice ? `¥${item.purchasePrice}` : '未填写'}</span>
                      <span>Offer: {item.sourceProductId || '-'}</span>
                      <span>SKU: {item.metadata?.skuCount || 0}</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                    {(item.metadata?.supplierName || item.metadata?.categoryPath || attributePreview(item.metadata)) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {[item.metadata?.supplierName, item.metadata?.categoryPath, attributePreview(item.metadata)].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
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
