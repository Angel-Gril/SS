'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type PlatformFilter = 'all' | '1688' | 'pdd' | 'taobao' | 'tmall';

interface SourceCollectItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  sourceProductId: string | null;
  sku: string | null;
  images: string[] | null;
  purchasePrice: string | null;
  currency: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  variants?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
}

const platformTabs: Array<{ key: PlatformFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: '1688', label: '1688' },
  { key: 'pdd', label: 'PDD' },
  { key: 'taobao', label: '淘宝' },
  { key: 'tmall', label: '天猫' },
];

function normalizePlatform(value: unknown): PlatformFilter | 'other' {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('1688')) return '1688';
  if (text.includes('pdd') || text.includes('pinduoduo') || text.includes('yangkeduo')) return 'pdd';
  if (text.includes('tmall') || text.includes('天猫')) return 'tmall';
  if (text.includes('taobao') || text.includes('淘宝')) return 'taobao';
  return 'other';
}

function platformLabel(value: unknown): string {
  const platform = normalizePlatform(value);
  if (platform === 'pdd') return 'PDD';
  if (platform === 'taobao') return '淘宝';
  if (platform === 'tmall') return '天猫';
  if (platform === '1688') return '1688';
  return String(value || '货源');
}

function sourceVideoCount(item: SourceCollectItem): number {
  const videos = item.metadata?.sourceVideos;
  return Array.isArray(videos) ? videos.length : 0;
}

function sourceImageCount(item: SourceCollectItem): number {
  return Array.isArray(item.images) ? item.images.length : 0;
}

function variantCount(item: SourceCollectItem): number {
  return Array.isArray(item.variants) ? item.variants.length : 0;
}

function sourceAttributeCount(item: SourceCollectItem): number {
  const attrs = item.metadata?.sourceAttributes;
  return Array.isArray(attrs) ? attrs.length : 0;
}

function sourceDisplayTitle(item: SourceCollectItem): string {
  const metaTitle = item.metadata?.sourceTitleRaw;
  return String(metaTitle || item.title || '未命名货源商品');
}

function sourceCategoryText(item: SourceCollectItem): string {
  const categoryPath = item.metadata?.categoryPath;
  if (Array.isArray(categoryPath) && categoryPath.length) {
    return categoryPath.map((part) => String(part)).filter(Boolean).join(' / ');
  }
  return String(item.metadata?.categoryName || '');
}

function isSourceCollectItem(item: SourceCollectItem): boolean {
  return ['1688', 'pdd', 'taobao', 'tmall'].includes(normalizePlatform(item.sourcePlatform));
}

export default function SourceCollectPage() {
  const [items, setItems] = useState<SourceCollectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [error, setError] = useState('');

  async function loadItems() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '50', sourceGroup: 'source' });
    if (search.trim()) params.set('search', search.trim());
    const res = await api.get<{ total: number; rows: SourceCollectItem[] }>(`/api/collect?${params}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.rows.filter(isSourceCollectItem));
    } else {
      setError(res.msg || '读取货源采集列表失败');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => platform === 'all' || normalizePlatform(item.sourcePlatform) === platform);
  }, [items, platform]);

  const counts = useMemo(() => {
    return platformTabs.reduce<Record<string, number>>((acc, tab) => {
      acc[tab.key] = tab.key === 'all'
        ? items.length
        : items.filter((item) => normalizePlatform(item.sourcePlatform) === tab.key).length;
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688商品采集</h1>
          <div className="text-sm text-muted-foreground mt-1">货源商品采集、翻译、类目映射和上架准备</div>
        </div>
        <Button variant="outline" onClick={loadItems} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {platformTabs.map((tab) => (
                <Button
                  key={tab.key}
                  type="button"
                  variant={platform === tab.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPlatform(tab.key)}
                >
                  {tab.label}
                  <span className="ml-2 text-xs opacity-70">{counts[tab.key] || 0}</span>
                </Button>
              ))}
            </div>
            <div className="flex gap-2 md:w-80">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') loadItems();
                  }}
                  className="pl-9"
                  placeholder="标题 / SKU / 商品ID"
                />
              </div>
              <Button variant="outline" onClick={loadItems}>搜索</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/70">
                <tr>
                  <th className="text-left px-3 py-2 min-w-72">商品</th>
                  <th className="text-left px-3 py-2 w-24">平台</th>
                  <th className="text-left px-3 py-2 w-28">采购价</th>
                  <th className="text-left px-3 py-2 w-32">素材</th>
                  <th className="text-left px-3 py-2 w-28">状态</th>
                  <th className="text-left px-3 py-2 w-36">采集时间</th>
                  <th className="text-left px-3 py-2 w-20">来源</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                      读取中
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">暂无货源采集记录</td>
                  </tr>
                ) : filteredItems.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium line-clamp-2">{sourceDisplayTitle(item)}</div>
                      {sourceCategoryText(item) ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{sourceCategoryText(item)}</div>
                      ) : null}
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.sourceProductId || item.sku || item.id}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge variant="outline">{platformLabel(item.sourcePlatform)}</Badge>
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.purchasePrice ? `¥${item.purchasePrice}` : '-'}
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                      图 {sourceImageCount(item)} / 视频 {sourceVideoCount(item)} / SKU {variantCount(item)} / 属性 {sourceAttributeCount(item)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge variant={item.status === 'collected' ? 'secondary' : 'outline'}>{item.status}</Badge>
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.sourceUrl ? (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
