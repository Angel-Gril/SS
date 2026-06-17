'use client';

import { useEffect, useState } from 'react';
import { Loader2, Download, Upload, Sparkles, ShoppingCart, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface Shop { id: string; name: string; platform: string; }
interface BatchItem {
  id: string;
  sku: string | null;
  title: string;
  images: string[] | null;
  purchasePrice: string | null;
  status: string;
  metadata?: { watermarkApplied?: boolean; ozonAttributes?: any[]; descriptionCategoryId?: number; typeId?: number } | null;
}
interface ParsedLine { sku: string; targetPrice: number | null; raw: string; }

function parseSkuLines(text: string): { ok: ParsedLine[]; bad: string[] } {
  const ok: ParsedLine[] = [];
  const bad: string[] = [];
  for (const raw of text.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const parts = raw.split(/[,\s\t]+/).map((p) => p.trim()).filter(Boolean);
    const sku = parts[0];
    if (!sku || !/^\d{6,}$/.test(sku)) { bad.push(raw); continue; }
    const price = parts[1] ? parseFloat(parts[1]) : NaN;
    ok.push({ sku, targetPrice: Number.isFinite(price) && price > 0 ? price : null, raw });
  }
  return { ok, bad };
}

function sendToExtension(message: any, timeoutMs = 60000): Promise<any> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      resolve({ ok: false, error: '扩展未响应（请确认已安装并启用 SS ERP 扩展）' });
    }, timeoutMs);
  });
}

export default function BatchCollectPage() {
  const [skuInput, setSkuInput] = useState('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState<BatchItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const [enableWatermark, setEnableWatermark] = useState(false);
  const [wmTemplates, setWmTemplates] = useState<any[]>([]);
  const [wmTemplateId, setWmTemplateId] = useState<string>('');

  const [publishMode, setPublishMode] = useState<'follow' | 'clone'>('clone');
  const [followBrand, setFollowBrand] = useState(false);

  const [publishShopId, setPublishShopId] = useState('');
  const [publishCategoryId, setPublishCategoryId] = useState('');
  const [publishTypeId, setPublishTypeId] = useState('');
  const [publishWeight, setPublishWeight] = useState('500');
  const [publishWidth, setPublishWidth] = useState('100');
  const [publishHeight, setPublishHeight] = useState('100');
  const [publishDepth, setPublishDepth] = useState('100');
  const [publishMarkup, setPublishMarkup] = useState('30');
  const [publishing, setPublishing] = useState(false);
  const [inheriting, setInheriting] = useState(false);
  const [publishUseItemCategory, setPublishUseItemCategory] = useState(false);

  const [randomizeAvailable, setRandomizeAvailable] = useState(false);
  const [randomOfferIdEnabled, setRandomOfferIdEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      const sRes = await api.get<Shop[]>('/api/shops');
      if (sRes.code === 1 && sRes.data) setShops(sRes.data.filter((s) => s.platform === 'OZON'));
      const wRes = await api.get<any[]>('/api/watermark-templates');
      if (wRes.code === 1 && wRes.data) {
        setWmTemplates(wRes.data);
        const def = wRes.data.find((t) => t.isDefault);
        if (def) setWmTemplateId(def.id);
      }
      const rRes = await api.get<{ enabled: boolean; randomOfferId: boolean }>('/api/collect/randomize-config');
      if (rRes.code === 1 && rRes.data) {
        setRandomizeAvailable(rRes.data.enabled && rRes.data.randomOfferId);
      }
    })();
  }, []);

  async function fetchCollectedBySkus(skus: string[]): Promise<BatchItem[]> {
    const out: BatchItem[] = [];
    for (const sku of skus) {
      const params = new URLSearchParams({ search: sku, limit: '5', offset: '0' });
      const res = await api.get<{ rows: BatchItem[] }>(`/api/collect?${params}`);
      if (res.code === 1 && res.data?.rows) {
        const hit = res.data.rows.find((r) => r.sku === sku);
        if (hit) out.push(hit);
      }
    }
    return out;
  }

  async function handleCollect() {
    const { ok, bad } = parseSkuLines(skuInput);
    if (bad.length) {
      toast({ title: `${bad.length} 行格式错误`, description: bad.slice(0, 3).join('；'), variant: 'destructive' });
      return;
    }
    if (!ok.length) { toast({ title: '请输入 SKU 数据（每行: SKU,价格）', variant: 'destructive' }); return; }
    if (ok.length > 200) { toast({ title: '单次最多 200 条', variant: 'destructive' }); return; }

    setCollecting(true);
    setCollected([]);
    setErrors([]);

    const productIds = ok.map((p) => p.sku);
    const res = await sendToExtension({
      type: 'spb-self-hosted:fetch-ozon-product-to-erp',
      productIds,
      collectMode: 'balanced',
    }, 180000);

    if (!res?.ok) {
      setCollecting(false);
      toast({ title: res?.error || '扩展采集失败', variant: 'destructive' });
      return;
    }

    if (Array.isArray(res.data?.errors)) {
      setErrors(res.data.errors.map((e: any) => `${e.productId}: ${e.error}`));
    }

    const rows = await fetchCollectedBySkus(productIds);

    const priceMap = new Map(ok.map((p) => [p.sku, p.targetPrice]));
    const toUpdate = rows.filter((r) => r.sku && priceMap.get(r.sku) != null);
    for (const r of toUpdate) {
      const targetPrice = priceMap.get(r.sku!)!;
      await api.put(`/api/collect/${r.id}`, { purchasePrice: targetPrice });
      r.purchasePrice = String(targetPrice);
    }

    if (enableWatermark && rows.length) {
      const tpl = wmTemplates.find((t) => t.id === wmTemplateId);
      if (!tpl) {
        toast({ title: '未选择水印模板，已跳过水印', variant: 'destructive' });
      } else {
        const wmRes = await api.post('/api/collect/watermark', {
          ids: rows.map((r) => r.id),
          type: tpl.type,
          text: tpl.text || undefined,
          imageUrl: tpl.imageUrl || undefined,
          position: tpl.position,
          opacity: tpl.opacity,
          fontColor: tpl.fontColor,
          fontSize: tpl.fontSize,
          scale: tpl.scale,
        });
        if (wmRes.code === 1) {
          toast({ title: `已采集 ${rows.length} 件，水印已添加` });
        } else {
          toast({ title: `已采集 ${rows.length} 件，水印失败：${wmRes.msg}`, variant: 'destructive' });
        }
      }
    } else {
      toast({ title: `已采集 ${rows.length} 件商品` });
    }

    const refreshed = await fetchCollectedBySkus(productIds);
    setCollected(refreshed);
    setCollecting(false);
  }

  async function handleAutoInherit() {
    if (!collected.length) { toast({ title: '请先采集商品', variant: 'destructive' }); return; }
    setInheriting(true);
    const productIds = collected.map((c) => c.sku).filter((s): s is string => !!s && /^\d+$/.test(s));
    const res = await sendToExtension({ type: 'spb-self-hosted:get-listing-data', productIds });
    if (!res?.ok || !Array.isArray(res.data) || !res.data.length) {
      setInheriting(false);
      toast({ title: res?.error || '扩展未响应', variant: 'destructive' });
      return;
    }
    const first = res.data.find((d: any) => d.ok && d.descriptionCategoryId);
    if (!first) { setInheriting(false); toast({ title: '未能获取分类属性', variant: 'destructive' }); return; }

    const collectedBySku = new Map(collected.map((item) => [String(item.sku || ''), item]));
    let inheritedCount = 0;
    for (const row of res.data) {
      if (!row?.ok) continue;
      const item = collectedBySku.get(String(row.productId || ''));
      if (!item) continue;
      const categoryId = Number(row.descriptionCategoryId) || 0;
      const typeId = Number(row.typeId) || 0;
      if (!categoryId && !typeId && !row.weight && !row.height && !row.width && !row.depth) continue;
      await api.post('/api/collect/save-customization', {
        id: item.id,
        ...(categoryId ? { categoryId } : {}),
        ...(typeId ? { typeId } : {}),
        ...(row.weight ? { weightG: Number(row.weight) } : {}),
        ...(row.depth ? { lengthMm: Number(row.depth) } : {}),
        ...(row.width ? { widthMm: Number(row.width) } : {}),
        ...(row.height ? { heightMm: Number(row.height) } : {}),
      });
      if (categoryId && typeId) inheritedCount++;
    }

    setPublishUseItemCategory(inheritedCount > 0);
    if (inheritedCount > 0) {
      const refreshed = await fetchCollectedBySkus(productIds);
      if (refreshed.length) setCollected(refreshed);
    }
    if (first.descriptionCategoryId) setPublishCategoryId(String(first.descriptionCategoryId));
    if (first.weight) setPublishWeight(String(first.weight));
    if (first.height) setPublishHeight(String(first.height));
    if (first.depth) setPublishDepth(String(first.depth));
    if (first.width) setPublishWidth(String(first.width));
    if (first.typeId) {
      setPublishTypeId(String(first.typeId));
    } else if (first.descriptionCategoryId && publishShopId) {
      const typeRes = await api.post<{ autoTypeId: number | null; types: any[] }>('/api/collect/resolve-type-id', {
        shopId: publishShopId,
        descriptionCategoryId: first.descriptionCategoryId,
      });
      if (typeRes.code === 1 && typeRes.data?.autoTypeId) setPublishTypeId(String(typeRes.data.autoTypeId));
      else if (typeRes.code === 1 && typeRes.data?.types?.length) setPublishTypeId(String(typeRes.data.types[0].typeId));
    }
    setInheriting(false);
    toast({ title: inheritedCount > 1 ? `已分别继承 ${inheritedCount} 件商品的源分类/尺寸` : '已继承源商品分类/重量/尺寸' });
  }

  async function handlePublish() {
    if (!collected.length) { toast({ title: '请先采集商品', variant: 'destructive' }); return; }
    if (!publishShopId) { toast({ title: '请选择目标店铺', variant: 'destructive' }); return; }
    if (!publishCategoryId || !publishTypeId) {
      toast({ title: '请填写或继承分类/类型 ID', variant: 'destructive' });
      return;
    }
    setPublishing(true);
    const res = await api.post('/api/collect/publish-ozon', {
      ids: collected.map((c) => c.id),
      shopId: publishShopId,
      categoryId: Number(publishCategoryId),
      typeId: Number(publishTypeId),
      weight: Number(publishWeight) || 500,
      height: Number(publishHeight) || 100,
      depth: Number(publishDepth) || 100,
      width: Number(publishWidth) || 100,
      markupPct: Number(publishMarkup) || 0,
      mode: publishMode,
      followBrand,
      randomOfferId: randomizeAvailable ? randomOfferIdEnabled : undefined,
      useItemCategory: publishUseItemCategory,
      source: 'batch-collect-page',
    });
    setPublishing(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setCollected([]);
      setSkuInput('');
    } else {
      toast({ title: res.msg || '上架失败', variant: 'destructive' });
    }
  }

  function removeRow(id: string) {
    setCollected((prev) => prev.filter((r) => r.id !== id));
  }

  const previewParse = parseSkuLines(skuInput);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">SKU 批量采集</h1>
        <p className="text-muted-foreground text-sm mt-1">
          粘贴 SKU 和价格 → 扩展自动采集图片/标题/属性 → 应用价格 → 一键上架。专为新手设计，最简流程。
        </p>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-3">
          <Label className="text-sm font-medium">① 粘贴 SKU（每行格式：<code className="text-xs px-1 py-0.5 bg-muted rounded">SKU,目标价格</code>）</Label>
          <textarea
            className="w-full h-36 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y"
            placeholder={'1502334613,48.25\n1502333093,48.34\n1502333613,46.98'}
            value={skuInput}
            onChange={(e) => setSkuInput(e.target.value)}
            disabled={collecting}
          />
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <span>识别到 {previewParse.ok.length} 条有效，{previewParse.bad.length} 条格式错误</span>
            {previewParse.bad.length > 0 && (
              <span className="text-destructive">无效行：{previewParse.bad.slice(0, 2).join('；')}{previewParse.bad.length > 2 ? '…' : ''}</span>
            )}
            <span className="ml-auto">最多 200 条/次。价格为人民币，将作为采购价</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-4">
          <Label className="text-sm font-medium">② 处理选项</Label>

          <div className="flex items-start gap-3 p-3 rounded-md border bg-muted/30">
            <input
              type="checkbox"
              id="wm-toggle"
              checked={enableWatermark}
              onChange={(e) => setEnableWatermark(e.target.checked)}
              disabled={collecting}
              className="mt-1 h-4 w-4 rounded"
            />
            <div className="flex-1 space-y-2">
              <label htmlFor="wm-toggle" className="text-sm font-medium cursor-pointer">采集后自动添加水印</label>
              {enableWatermark && (
                <div>
                  <select
                    value={wmTemplateId}
                    onChange={(e) => setWmTemplateId(e.target.value)}
                    className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">选择水印模板</option>
                    {wmTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.isDefault ? '（默认）' : ''}</option>
                    ))}
                  </select>
                  {!wmTemplates.length && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      尚未创建水印模板，请先到 <a href="/image-processing" className="text-primary underline" target="_blank" rel="noreferrer">图片处理</a> 创建
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">上架模式</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPublishMode('clone')}
                disabled={collecting}
                className={`rounded-md border p-2 text-left transition ${publishMode === 'clone' ? 'border-primary bg-primary/5' : 'border-input hover:bg-background'}`}
              >
                <div className="text-sm font-medium">复制商品</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">拉源商品图片/描述/属性，1:1 复刻发布</div>
              </button>
              <button
                type="button"
                onClick={() => setPublishMode('follow')}
                disabled={collecting}
                className={`rounded-md border p-2 text-left transition ${publishMode === 'follow' ? 'border-primary bg-primary/5' : 'border-input hover:bg-background'}`}
              >
                <div className="text-sm font-medium">普通跟卖</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">仅发布基础字段，不拉源商品详情</div>
              </button>
            </div>
            {publishMode === 'clone' && (
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={followBrand}
                  onChange={(e) => setFollowBrand(e.target.checked)}
                  className="rounded mt-0.5"
                />
                <div>
                  <div className="text-sm">复制品牌字段</div>
                  <div className="text-[11px] text-muted-foreground">关闭可剥离品牌属性，降低品牌方投诉风险（默认关闭）</div>
                </div>
              </label>
            )}
            {randomizeAvailable && (
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={randomOfferIdEnabled}
                  onChange={(e) => setRandomOfferIdEnabled(e.target.checked)}
                  className="rounded mt-0.5"
                />
                <div>
                  <div className="text-sm">随机货号</div>
                  <div className="text-[11px] text-muted-foreground">基于源 SKU 生成随机后缀的 offer_id，避免同号冲突。关闭则使用 SKU+短随机后缀（管理员已全局开启随机化）</div>
                </div>
              </label>
            )}
          </div>

          <Button
            size="lg"
            className="w-full"
            onClick={handleCollect}
            disabled={collecting || !previewParse.ok.length}
          >
            {collecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
            {collecting ? '采集中...（依赖扩展请勿关闭）' : `开始采集 ${previewParse.ok.length} 件商品`}
          </Button>
        </CardContent>
      </Card>

      {/* 采集结果 + 上架 */}
      {collected.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">③ 采集结果（{collected.length} 件）</Label>
              <button
                type="button"
                onClick={() => setCollected([])}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                全部清空
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {collected.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-md border bg-muted/20">
                  {item.images?.[0] ? (
                    <img src={item.images[0]} alt="" className="h-12 w-12 rounded border object-cover shrink-0" />
                  ) : (
                    <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center shrink-0">
                      <ShoppingCart className="h-4 w-4 opacity-30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium line-clamp-1">{item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.sku && <span className="font-mono text-[10px] text-muted-foreground">SKU {item.sku}</span>}
                      {item.purchasePrice && <span className="text-[11px] text-primary tabular-nums">RMB {item.purchasePrice}</span>}
                      {item.metadata?.watermarkApplied && <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600 px-1 py-0">水印</Badge>}
                      {item.metadata?.ozonAttributes && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-600 px-1 py-0">属性</Badge>}
                      {item.metadata?.descriptionCategoryId && item.metadata?.typeId && <Badge variant="outline" className="text-[10px] border-green-300 text-green-700 px-1 py-0">源分类</Badge>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(item.id)}
                    className="p-1 rounded hover:bg-destructive/10"
                    title="从本次列表移除（不删数据库）"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                  </button>
                </div>
              ))}
            </div>

            {errors.length > 0 && (
              <div className="p-2 rounded border bg-destructive/5 text-destructive text-xs space-y-0.5 max-h-24 overflow-y-auto">
                <p className="font-medium">{errors.length} 件采集失败：</p>
                {errors.slice(0, 5).map((e, i) => <p key={i}>• {e}</p>)}
                {errors.length > 5 && <p>...等 {errors.length} 条</p>}
              </div>
            )}

            <div className="border-t pt-4 space-y-3">
              <Label className="text-sm font-medium">④ 上架配置</Label>

              <div className="space-y-2">
                <Label className="text-xs">目标店铺 *</Label>
                <select
                  value={publishShopId}
                  onChange={(e) => setPublishShopId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">选择 OZON 店铺</option>
                  {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleAutoInherit}
                disabled={inheriting || !publishShopId}
              >
                {inheriting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                从源商品继承分类/类型/重量/尺寸
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">分类 ID *</Label>
                  <Input value={publishCategoryId} onChange={(e) => { setPublishUseItemCategory(false); setPublishCategoryId(e.target.value); }} type="number" className="h-8 text-sm" placeholder="description_category_id" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">类型 ID *</Label>
                  <Input value={publishTypeId} onChange={(e) => { setPublishUseItemCategory(false); setPublishTypeId(e.target.value); }} type="number" className="h-8 text-sm" placeholder="type_id" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {publishUseItemCategory ? '已按每个 SKU 自己的源分类上架；缺少源分类的 SKU 会被服务端拦截。' : '多个不同类目的 SKU 请先点击继承，避免整批使用同一分类。'}
              </p>

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

              <div className="space-y-1">
                <Label className="text-xs">额外加价比例 %（在采购价基础上）</Label>
                <Input value={publishMarkup} onChange={(e) => setPublishMarkup(e.target.value)} type="number" className="h-8 text-sm" placeholder="0" />
                <p className="text-[11px] text-muted-foreground">卖价 = 采购价 × (1 + 加价% / 100)。已经在 ① 输入目标价时无需再加价</p>
              </div>

              <Button
                size="lg"
                className="w-full"
                onClick={handlePublish}
                disabled={publishing || !publishShopId || !publishCategoryId || !publishTypeId}
              >
                {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                {publishing ? '上架中...' : `一键上架 ${collected.length} 件到 OZON`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
