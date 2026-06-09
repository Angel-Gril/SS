'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Calculator, ExternalLink, Loader2, PackageCheck, RefreshCw, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { buildCollect1688PreviewSignature, getCollect1688SaveAction, isCollect1688PreviewStale } from '@/lib/collect-1688';
import { formatDate } from '@/lib/utils';

interface PricingResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalizedWeightG: number;
  totalBaseCostCny: number;
  suggestedSalePriceCny: number;
  suggestedSalePriceRub: number;
  estimatedCommissionCny: number;
  estimatedProfitCny: number;
  estimatedMarginPct: number;
  costLines: { key: string; label: string; amountCny: number }[];
}

interface CategoryMapping {
  id: string;
  targetCategoryId: number;
  targetTypeId: number;
  targetCategoryName: string | null;
  targetCategoryPath: string | null;
  defaultWeightG: number | null;
  defaultLengthMm: number | null;
  defaultWidthMm: number | null;
  defaultHeightMm: number | null;
}

interface PreviewData {
  sourceProductId: string | null;
  saveMode: 'create' | 'update';
  existingSupplyGood: {
    id: string;
    title: string;
    sourceProductId: string | null;
    updatedAt: string | null;
  } | null;
  pricing: PricingResult;
  mapping: CategoryMapping | null;
}

interface SupplyItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourceProductId: string | null;
  supplier: string | null;
  purchasePrice: string | null;
  currency: string;
  sku: string | null;
  createdAt: string;
  updatedAt: string;
}

const initialForm = {
  sourceUrl: '',
  title: '',
  sourceCategoryName: '',
  supplier: '',
  sku: '',
  purchasePriceCny: '20',
  domesticShippingCny: '5',
  weightG: '500',
  packageFeeCny: '2',
  commissionPct: '12',
  logisticsFeeCny: '18',
  exchangeRateRubToCny: '0.08',
  targetMarginPct: '30',
  notes: '',
};

export default function Collect1688Page() {
  const [form, setForm] = useState(initialForm);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewSignature, setPreviewSignature] = useState<string | null>(null);
  const [recent, setRecent] = useState<SupplyItem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const saveAction = getCollect1688SaveAction(preview);

  useEffect(() => { loadRecent(); }, []);

  function updateField(key: keyof typeof initialForm, value: string) {
    const next = { ...form, [key]: value };
    if (isCollect1688PreviewStale(next, previewSignature)) {
      setPreview(null);
      setPreviewSignature(null);
    }
    setForm(next);
  }

  function buildPayload() {
    return {
      sourceUrl: form.sourceUrl || undefined,
      title: form.title,
      sourceCategoryName: form.sourceCategoryName || undefined,
      supplier: form.supplier || undefined,
      sku: form.sku || undefined,
      purchasePriceCny: Number(form.purchasePriceCny),
      domesticShippingCny: Number(form.domesticShippingCny || 0),
      weightG: Number(form.weightG || 0),
      packageFeeCny: Number(form.packageFeeCny || 0),
      commissionPct: Number(form.commissionPct || 0),
      logisticsFeeCny: Number(form.logisticsFeeCny || 0),
      exchangeRateRubToCny: Number(form.exchangeRateRubToCny),
      targetMarginPct: Number(form.targetMarginPct || 30),
      notes: form.notes || undefined,
    };
  }

  async function loadRecent() {
    setLoadingRecent(true);
    const params = new URLSearchParams({ sourcePlatform: '1688', limit: '8', sort: 'updatedAt' });
    const res = await api.get<{ rows: SupplyItem[] }>(`/api/supply?${params}`);
    if (res.code === 1 && res.data) setRecent(res.data.rows);
    setLoadingRecent(false);
  }

  async function handlePreview() {
    if (!form.title.trim()) {
      toast({ title: '请填写商品名称', variant: 'destructive' });
      return;
    }
    setPreviewing(true);
    const signature = buildCollect1688PreviewSignature(form);
    const res = await api.post<PreviewData>('/api/supply/1688/preview', buildPayload());
    setPreviewing(false);
    if (res.code === 1 && res.data) {
      setPreview(res.data);
      setPreviewSignature(signature);
      toast({ title: '核价完成' });
    } else {
      toast({ title: res.msg || '核价失败', variant: 'destructive' });
    }
  }

  async function handleSave() {
    if (!preview) {
      await handlePreview();
      return;
    }
    setSaving(true);
    const res = await api.post<SupplyItem>('/api/supply/1688/import', buildPayload());
    setSaving(false);
    if (res.code === 1) {
      toast({ title: res.msg || '1688货源已保存' });
      setPreview(null);
      setPreviewSignature(null);
      await loadRecent();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688手工补录</h1>
          <p className="text-muted-foreground text-sm mt-1">扩展采集异常时的兜底入口；主流程请在 1688 商品页使用扩展浮层完成核价和采集。</p>
        </div>
        <Button variant="outline" onClick={loadRecent} disabled={loadingRecent} className="w-full sm:w-auto">
          {loadingRecent ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新货源
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-orange-600" />
              <span className="font-medium">手工核价输入</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="商品名称 *" value={form.title} onChange={(v) => updateField('title', v)} placeholder="透明手机壳" />
              <Field label="1688 链接" value={form.sourceUrl} onChange={(v) => updateField('sourceUrl', v)} placeholder="https://detail.1688.com/offer/..." />
              <Field label="来源类目" value={form.sourceCategoryName} onChange={(v) => updateField('sourceCategoryName', v)} placeholder="手机壳" />
              <Field label="供应商" value={form.supplier} onChange={(v) => updateField('supplier', v)} placeholder="义乌供应商" />
              <Field label="本地 SKU" value={form.sku} onChange={(v) => updateField('sku', v)} placeholder="可选" />
              <Field label="备注" value={form.notes} onChange={(v) => updateField('notes', v)} placeholder="采购备注" />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <NumberField label="采购价 CNY" value={form.purchasePriceCny} onChange={(v) => updateField('purchasePriceCny', v)} />
              <NumberField label="国内运费" value={form.domesticShippingCny} onChange={(v) => updateField('domesticShippingCny', v)} />
              <NumberField label="重量 g" value={form.weightG} onChange={(v) => updateField('weightG', v)} />
              <NumberField label="包装费" value={form.packageFeeCny} onChange={(v) => updateField('packageFeeCny', v)} />
              <NumberField label="佣金 %" value={form.commissionPct} onChange={(v) => updateField('commissionPct', v)} />
              <NumberField label="跨境物流费" value={form.logisticsFeeCny} onChange={(v) => updateField('logisticsFeeCny', v)} />
              <NumberField label="RUB->CNY 汇率" value={form.exchangeRateRubToCny} onChange={(v) => updateField('exchangeRateRubToCny', v)} step="0.0001" />
              <NumberField label="目标利润率 %" value={form.targetMarginPct} onChange={(v) => updateField('targetMarginPct', v)} />
            </div>

            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button onClick={handlePreview} disabled={previewing}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                计算核价
              </Button>
              <Button variant="outline" onClick={handleSave} disabled={saving || previewing}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saveAction.buttonLabel}
              </Button>
              <Button variant="ghost" asChild>
                <Link href="/supply/goods">查看货源管理</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <PricingPanel preview={preview} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-orange-600" />
              <span className="font-medium">最近更新的 1688 货源</span>
            </div>
            <Badge variant="outline">{recent.length} 条</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">采购价</TableHead>
                  <TableHead>更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRecent ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></TableCell></TableRow>
                ) : recent.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">暂无 1688 货源</TableCell></TableRow>
                ) : recent.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-md">
                      <div className="font-medium truncate">{item.title}</div>
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                          {item.sourceProductId || '源链接'} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell>{item.supplier || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">{item.sku || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.purchasePrice ? `${item.currency} ${item.purchasePrice}` : '-'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden">
            {loadingRecent ? (
              <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : recent.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">暂无 1688 货源</div>
            ) : (
              <div className="divide-y">
                {recent.map((item) => (
                  <div key={item.id} className="p-4 space-y-3">
                    <div>
                      <div className="font-medium text-sm leading-5 break-words">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDate(item.updatedAt)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">供应商</div>
                        <div className="mt-0.5 truncate">{item.supplier || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">SKU</div>
                        <div className="mt-0.5 truncate font-mono text-xs">{item.sku || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">采购价</div>
                        <div className="mt-0.5 font-medium tabular-nums">{item.purchasePrice ? `${item.currency} ${item.purchasePrice}` : '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">1688 ID</div>
                        <div className="mt-0.5 truncate">{item.sourceProductId || '-'}</div>
                      </div>
                    </div>
                    {item.sourceUrl && (
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        查看源链接 <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}

function NumberField({ label, value, onChange, step = '0.01' }: { label: string; value: string; onChange: (value: string) => void; step?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function PricingPanel({ preview }: { preview: PreviewData | null }) {
  if (!preview) {
    return (
      <Card>
        <CardHeader className="pb-3"><span className="font-medium">核价结果</span></CardHeader>
        <CardContent className="text-sm text-muted-foreground py-12 text-center">
          填写左侧信息后点击计算核价。
        </CardContent>
      </Card>
    );
  }

  const p = preview.pricing;
  const saveAction = getCollect1688SaveAction(preview);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">核价结果</span>
          <Badge variant={p.ok ? 'success' : 'destructive'}>{p.ok ? '可保存' : '需修正'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="建议售价 CNY" value={`¥${p.suggestedSalePriceCny}`} strong />
          <Metric label="建议售价 RUB" value={`₽${p.suggestedSalePriceRub}`} strong />
          <Metric label="预计利润" value={`¥${p.estimatedProfitCny}`} />
          <Metric label="预计利润率" value={`${p.estimatedMarginPct}%`} />
        </div>

        <div className="rounded-md border">
          {p.costLines.map((line) => (
            <div key={line.key} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-b-0">
              <span className="text-muted-foreground">{line.label}</span>
              <span className="font-medium tabular-nums">¥{line.amountCny}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2 text-sm bg-muted/40">
            <span className="text-muted-foreground">基础成本合计</span>
            <span className="font-semibold tabular-nums">¥{p.totalBaseCostCny}</span>
          </div>
        </div>

        <div className={saveAction.variant === 'update'
          ? 'rounded-md border border-amber-200 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20 dark:border-amber-900'
          : 'rounded-md border border-sky-200 bg-sky-50/70 p-3 text-sm dark:bg-sky-950/20 dark:border-sky-900'}
        >
          <div className={saveAction.variant === 'update'
            ? 'font-medium text-amber-700 dark:text-amber-300'
            : 'font-medium text-sky-700 dark:text-sky-300'}
          >
            {saveAction.panelTitle}
          </div>
          <div className="text-muted-foreground mt-1">{saveAction.panelDescription}</div>
          {preview.existingSupplyGood && (
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground">原货源</span>
                <div className="mt-0.5 truncate font-medium">{preview.existingSupplyGood.title}</div>
              </div>
              <div>
                <span className="text-muted-foreground">1688 ID</span>
                <div className="mt-0.5 font-mono">{preview.existingSupplyGood.sourceProductId || '-'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">最近更新</span>
                <div className="mt-0.5">{preview.existingSupplyGood.updatedAt ? formatDate(preview.existingSupplyGood.updatedAt) : '-'}</div>
              </div>
            </div>
          )}
        </div>

        {preview.mapping ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-sm dark:bg-emerald-950/20 dark:border-emerald-900">
            <div className="font-medium text-emerald-700 dark:text-emerald-300">已命中类目映射</div>
            <div className="text-muted-foreground mt-1">
              OZON 类目 {preview.mapping.targetCategoryId} / type {preview.mapping.targetTypeId}
              {preview.mapping.targetCategoryName ? ` · ${preview.mapping.targetCategoryName}` : ''}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-sm dark:bg-amber-950/20 dark:border-amber-900">
            <div className="font-medium text-amber-700 dark:text-amber-300">未命中类目映射</div>
            <div className="text-muted-foreground mt-1">可先保存货源，或到类目映射页面维护默认 OZON 类目。</div>
          </div>
        )}

        {p.warnings.length > 0 && (
          <div className="space-y-1 text-sm text-amber-700 dark:text-amber-300">
            {p.warnings.map((warning) => <div key={warning}>• {warning}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? 'text-xl font-semibold mt-1 tabular-nums' : 'text-base font-medium mt-1 tabular-nums'}>{value}</div>
    </div>
  );
}
