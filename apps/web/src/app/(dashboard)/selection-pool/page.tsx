'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Archive,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface SelectionPoolItem {
  id: string;
  platform: string;
  sku: string;
  productId: string | null;
  title: string;
  url: string | null;
  image: string | null;
  priceRub: number | null;
  currency: string;
  source: string;
  ruleIds: string[];
  tags: string[];
  metrics: Record<string, unknown>;
  note: string | null;
  status: string;
  firstMatchedAt: string | null;
  lastMatchedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface SelectionPoolSummary {
  allCount: number;
  activeCount: number;
  removedCount: number;
  matched24hCount: number;
  tags: Array<{ tag: string; count: number }>;
}

interface SelectionPoolResponse {
  items: SelectionPoolItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: SelectionPoolSummary;
}

const STATUS_OPTIONS = [
  { value: 'active', label: '在池' },
  { value: 'removed', label: '已移出' },
  { value: 'all', label: '全部' },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

const EMPTY_SUMMARY: SelectionPoolSummary = {
  allCount: 0,
  activeCount: 0,
  removedCount: 0,
  matched24hCount: 0,
  tags: [],
};

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRub(value: unknown, currency = 'RUB'): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const prefix = currency.toUpperCase() === 'RUB' ? '₽' : currency.toUpperCase();
  return `${prefix} ${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`;
}

function metricValue(metrics: Record<string, unknown>, key: string): string | null {
  const value = metrics[key];
  if (value == null || value === '') return null;
  return String(value);
}

function metricChips(item: SelectionPoolItem): Array<[string, string]> {
  const metrics = item.metrics || {};
  const chips: Array<[string, string | null]> = [
    ['月销', metricValue(metrics, 'soldCount')],
    ['销售额', metricValue(metrics, 'soldSum')],
    ['跟卖', metricValue(metrics, 'sellerCount')],
    ['最低', metricValue(metrics, 'minFollowPriceRub')],
    ['广告', metricValue(metrics, 'adExpenseShare')],
    ['退取', metricValue(metrics, 'returnCancelRate')],
    ['利润', metricValue(metrics, 'profitMarginPct')],
    ['重量', metricValue(metrics, 'weightGrams')],
    ['模式', metricValue(metrics, 'salesSchema')],
  ];
  return chips.filter((chip): chip is [string, string] => !!chip[1]);
}

function buildOzonUrl(item: SelectionPoolItem): string | null {
  if (item.url) return item.url;
  const id = item.productId || item.sku;
  return id ? `https://www.ozon.ru/product/${id}/` : null;
}

export default function SelectionPoolPage() {
  const router = useRouter();
  const [items, setItems] = useState<SelectionPoolItem[]>([]);
  const [summary, setSummary] = useState<SelectionPoolSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [tag, setTag] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedItems = useMemo(
    () => items.filter((item) => selectedSkus.has(item.sku)),
    [items, selectedSkus],
  );

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams({
      platform: 'ozon',
      status,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (q.trim()) params.set('q', q.trim());
    if (tag) params.set('tag', tag);
    if (ruleId.trim()) params.set('ruleId', ruleId.trim());
    return params;
  }, [page, pageSize, q, ruleId, status, tag]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const res = await api.get<SelectionPoolResponse>(`/api/extension-config/product-selection/pool/items?${buildQuery().toString()}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
      setSummary(res.data.summary || EMPTY_SUMMARY);
      setSelectedSkus((current) => {
        const visible = new Set((res.data?.items || []).map((item) => item.sku));
        return new Set(Array.from(current).filter((sku) => visible.has(sku)));
      });
    } else {
      toast({ title: res.msg || '选品池加载失败', variant: 'destructive' });
    }
    setLoading(false);
  }, [buildQuery]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  function submitSearch() {
    setPage(1);
    setQ(qInput.trim());
  }

  function toggleSku(sku: string) {
    setSelectedSkus((current) => {
      const next = new Set(current);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    if (!checked) {
      setSelectedSkus(new Set());
      return;
    }
    setSelectedSkus(new Set(items.map((item) => item.sku)));
  }

  async function removeSkus(skus: string[]) {
    if (!skus.length) {
      toast({ title: '请先选择 SKU', variant: 'destructive' });
      return;
    }
    setRemoving(true);
    const results = await Promise.all(skus.map((sku) => api.delete(
      `/api/extension-config/product-selection/pool/items/${encodeURIComponent(sku)}?platform=ozon`,
    )));
    setRemoving(false);
    const failed = results.find((res) => res.code !== 1);
    if (failed) {
      toast({ title: failed.msg || '移出选品池失败', variant: 'destructive' });
      return;
    }
    toast({ title: `已移出 ${skus.length} 个 SKU` });
    setSelectedSkus(new Set());
    loadItems();
  }

  async function exportExcel() {
    setExporting(true);
    const result = await api.download(
      `/api/extension-config/product-selection/pool/items/export?${buildQuery().toString()}`,
      `selection_pool_${new Date().toISOString().slice(0, 10)}.xls`,
    );
    setExporting(false);
    if (!result.ok) toast({ title: result.msg || '导出失败', variant: 'destructive' });
  }

  function goToCollect() {
    const skus = (selectedItems.length ? selectedItems : items).map((item) => item.sku).filter(Boolean);
    if (!skus.length) {
      toast({ title: '没有可交接的 SKU', variant: 'destructive' });
      return;
    }
    router.push(`/collect?poolSkus=${encodeURIComponent(skus.join('\n'))}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-l-4 border-orange-500 bg-orange-50/40 py-2 pl-3 pr-3 dark:bg-orange-950/20 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-orange-700 dark:text-orange-400">ERP 选品池</h1>
          <p className="mt-1 text-sm text-muted-foreground">扩展规则命中的 Ozon SKU 会进入这里，统一筛选、导出和交接上架。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadItems} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={exporting || total === 0}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            导出Excel
          </Button>
          <Button size="sm" className="bg-orange-600 text-white hover:bg-orange-700" onClick={goToCollect} disabled={items.length === 0}>
            <Upload className="h-4 w-4" />
            去采集上架
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">在池 SKU</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary.activeCount}</div>
          </CardContent>
        </Card>
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">24小时命中</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary.matched24hCount}</div>
          </CardContent>
        </Card>
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">历史总数</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary.allCount}</div>
          </CardContent>
        </Card>
        <Card className="rounded-md">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">已移出</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{summary.removedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-md">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="flex min-w-[260px] flex-1 items-center gap-2">
                <Input
                  value={qInput}
                  onChange={(event) => setQInput(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && submitSearch()}
                  placeholder="搜索 SKU / 商品标题 / Product ID"
                  className="h-8"
                />
                <Button size="sm" variant="outline" onClick={submitSearch}>
                  <Search className="h-4 w-4" />
                  搜索
                </Button>
              </div>
              <select
                value={status}
                onChange={(event) => { setPage(1); setStatus(event.target.value); }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={tag}
                onChange={(event) => { setPage(1); setTag(event.target.value); }}
                className="h-8 min-w-[140px] rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">全部标签</option>
                {summary.tags.map((item) => (
                  <option key={item.tag} value={item.tag}>{item.tag} ({item.count})</option>
                ))}
              </select>
              <Input
                value={ruleId}
                onChange={(event) => { setPage(1); setRuleId(event.target.value); }}
                placeholder="规则ID"
                className="h-8 w-40"
              />
              <select
                value={pageSize}
                onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)); }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}/页</option>
                ))}
              </select>
            </div>
            {selectedSkus.size > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">已选 {selectedSkus.size}</Badge>
                <Button variant="outline" size="sm" onClick={() => removeSkus(Array.from(selectedSkus))} disabled={removing}>
                  {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  批量移出
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selectedSkus.size === items.length}
                      onChange={(event) => toggleAllVisible(event.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                  </TableHead>
                  <TableHead className="min-w-[120px]">SKU</TableHead>
                  <TableHead className="min-w-[320px]">商品</TableHead>
                  <TableHead className="w-28 text-right">价格</TableHead>
                  <TableHead className="min-w-[160px]">标签</TableHead>
                  <TableHead className="min-w-[260px]">命中规则/指标</TableHead>
                  <TableHead className="w-32">入池时间</TableHead>
                  <TableHead className="w-36 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      加载中
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                      <Archive className="mx-auto mb-2 h-5 w-5" />
                      暂无选品池数据
                    </TableCell>
                  </TableRow>
                )}
                {!loading && items.map((item) => {
                  const ozonUrl = buildOzonUrl(item);
                  return (
                    <TableRow key={`${item.platform}-${item.sku}`} data-state={selectedSkus.has(item.sku) ? 'selected' : undefined}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedSkus.has(item.sku)}
                          onChange={() => toggleSku(item.sku)}
                          className="h-4 w-4 rounded"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{item.sku}</div>
                        {item.productId && item.productId !== item.sku && (
                          <div className="mt-1 text-[11px] text-muted-foreground">PID {item.productId}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {item.image ? (
                            <img src={item.image} alt="" className="h-12 w-12 rounded-md border object-cover" />
                          ) : (
                            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                              <Archive className="h-4 w-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-medium">{item.title}</div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{item.source}</span>
                              <Badge variant={item.status === 'active' ? 'success' : 'secondary'} className="rounded px-1.5 py-0 text-[10px]">
                                {item.status === 'active' ? '在池' : '已移出'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatRub(item.priceRub, item.currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.tags.length ? item.tags.map((itemTag) => (
                            <Badge key={itemTag} variant="secondary" className="rounded px-1.5 py-0 text-[10px]">
                              {itemTag}
                            </Badge>
                          )) : <span className="text-xs text-muted-foreground">-</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {item.ruleIds.length > 0 && (
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              规则 {item.ruleIds.join(' / ')}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {metricChips(item).slice(0, 7).map(([label, value]) => (
                              <span key={label} className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-none">
                                {label} {value}
                              </span>
                            ))}
                            {metricChips(item).length === 0 && <span className="text-xs text-muted-foreground">-</span>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(item.lastMatchedAt || item.firstMatchedAt || item.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {ozonUrl && (
                            <Button asChild variant="ghost" size="icon" title="打开Ozon">
                              <a href={ozonUrl} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="移出选品池"
                            onClick={() => removeSkus([item.sku])}
                            disabled={removing || item.status !== 'active'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div>
              共 {total} 条，当前第 {page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
                上一页
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages || loading}>
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
