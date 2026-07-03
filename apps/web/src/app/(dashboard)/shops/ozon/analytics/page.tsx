'use client';

import { useEffect, useState, useMemo } from 'react';
import { Loader2, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, ShoppingCart, Package, BarChart3, LineChart, Tag, Percent, WarehouseIcon, RefreshCw, Megaphone, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

interface Shop {
  id: string;
  platform: string;
  name: string;
}

interface AnalyticsItem {
  sku: number;
  name: string;
  image?: string;
  article?: string;
  soldCount: number;
  soldSum: number;
  salesDynamics: number;
  avgPrice: number;
  minSellerPrice: number;
  convToCartPdp: number;
  views: number;
  searchViews?: number;
  searchPosition?: number;
  stock: number;
  brand: string;
  category1: string;
  category3: string;
  sellerName: string;
  salesSchema: string;
  avgDeliveryDays: number;
  nullableCreateDate: string;
  variantId: number;
  cancellations?: number;
  returns?: number;
}

interface SnapshotHistory {
  id: string;
  period: string;
  productCount: number;
  totalSales: string | null;
  totalOrders: number | null;
  syncedAt: string;
}

interface AnalyticsData {
  latest: {
    id: string;
    shopId: string;
    period: string;
    data: AnalyticsItem[] | { type: string; items: AnalyticsItem[] };
    productCount: number;
    totalSales: string | null;
    totalOrders: number | null;
    syncedAt: string;
  } | null;
  history: SnapshotHistory[];
}

type SortKey = 'soldCount' | 'soldSum' | 'convToCartPdp' | 'views' | 'stock' | 'avgPrice';

type ActiveTab = 'what_to_sell' | 'graphs' | 'promotions';

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || /^(-|—|не число|nan|not a number)$/i.test(text)) return null;
    const normalized = text.replace(/\s+/g, '').replace(/%/g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function numericOrZero(value: unknown): number {
  return toFiniteNumber(value) ?? 0;
}

function formatMetric(value: unknown, options?: Intl.NumberFormatOptions): string {
  const num = toFiniteNumber(value);
  return num == null ? '-' : num.toLocaleString('ru-RU', options);
}

function formatPercentMetric(value: unknown): string {
  const num = toFiniteNumber(value);
  return num == null ? '-' : `${num.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

interface GraphsSnapshotData {
  type: 'graphs';
  version?: 'legacy' | 'v3';
  dateFrom: string;
  dateTo: string;
  prevFrom?: string;
  prevTo?: string;
  // Legacy format
  graph?: Array<{ dimensions: string[]; metrics: number[] }>;
  table?: Array<{ dimensions: string[]; metrics: number[] }>;
  metrics?: string[];
  // V3 format
  graphData?: {
    items?: Array<{ points?: Array<{ metrics?: { revenue?: number; revenueV2?: any }; date?: string }>; prevPoints?: any[] }>;
    skuItems?: any[];
  };
  tableData?: {
    items?: Array<{
      productInfo?: { sku?: string; name?: string; article?: string; image?: string };
      metrics?: Record<string, number>;
    }>;
    nextOffset?: string;
  };
  totals?: { metrics?: Record<string, number> };
  recommendations?: { items?: Array<{ sku: string; recommendation: string }> } | null;
  salesFunnel?: { metricsData?: Array<{ dayMetrics?: { value?: number; difference?: number; compareValue?: number }; date?: string }> } | null;
}

interface GraphsSnapshot {
  id: string;
  shopId: string;
  period: string;
  data: GraphsSnapshotData;
  productCount: number;
  totalSales: string | null;
  totalOrders: number | null;
  syncedAt: string;
}

interface PromotionAction {
  id: number;
  title: string;
  dateStart: string | null;
  dateEnd: string | null;
  participatingProductsCount: number;
  potentialProductsCount: number;
  status: 'active' | 'upcoming' | 'finished' | 'unknown';
}

interface PromotionProduct {
  productId: number;
  title: string;
  offerId: string | null;
  image: string | null;
  price: string | null;
  actionPrice: string | null;
  maxActionPrice: string | null;
  stock: number | null;
}

interface PromotionProductsData {
  products: PromotionProduct[];
  total: number;
}

function SortableHead({ label, sortKey, currentKey, dir, onSort }: {
  label: string;
  sortKey: V3SortKey;
  currentKey: V3SortKey;
  dir: SortDir;
  onSort: (key: V3SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  return (
    <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </TableHead>
  );
}

function SimpleBarChart({ data, color, label }: { data: number[]; color: string; label: string }) {
  if (!data.length) return null;
  const maxValue = Math.max(...data, 1);
  const height = 120;
  const barWidth = Math.max(4, Math.floor(600 / data.length) - 2);
  const svgWidth = data.length * (barWidth + 2);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${svgWidth} ${height}`}
        preserveAspectRatio="none"
        className="rounded"
      >
        {data.map((v, i) => (
          <rect
            key={i}
            x={i * (barWidth + 2)}
            y={height - (v / maxValue) * height}
            width={barWidth}
            height={(v / maxValue) * height}
            fill={color}
            rx={1}
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>min: {Math.min(...data).toLocaleString()}</span>
        <span>max: {Math.max(...data).toLocaleString()}</span>
      </div>
    </div>
  );
}

type V3SortKey = 'searchPosition' | 'searchViews' | 'orderedUnits' | 'revenue' | 'pdpViews' | 'convPdpViewsToCart' | 'cancelledUnits' | 'returnedUnits';
type SortDir = 'asc' | 'desc';

function GraphsTab({ shopId }: { shopId: string }) {
  const [graphsData, setGraphsData] = useState<GraphsSnapshot | null>(null);
  const [loadingGraphs, setLoadingGraphs] = useState(false);
  const [v3SortKey, setV3SortKey] = useState<V3SortKey>('orderedUnits');
  const [v3SortDir, setV3SortDir] = useState<SortDir>('desc');

  useEffect(() => {
    if (!shopId) return;
    setLoadingGraphs(true);
    api.get<GraphsSnapshot>(`/api/shops/${shopId}/analytics-graphs`).then((res) => {
      if (res.code === 1 && res.data) {
        setGraphsData(res.data);
      } else {
        setGraphsData(null);
      }
      setLoadingGraphs(false);
    });
  }, [shopId]);

  if (loadingGraphs) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!graphsData) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <LineChart className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">暂无经营图表数据</p>
          <p className="text-sm text-muted-foreground mt-1">
            请在浏览器扩展中点击"同步经营图表"将数据推送到 ERP
          </p>
        </CardContent>
      </Card>
    );
  }

  const snapData = graphsData.data;
  const isV3 = snapData?.version === 'v3';
  const totalRevenue = graphsData.totalSales ? Number(graphsData.totalSales) : 0;
  const totalOrders = graphsData.totalOrders || 0;

  // V3 format rendering
  if (isV3) {
    const v3Table = snapData.tableData?.items || [];
    const v3Recommendations = snapData.recommendations?.items || [];
    const v3Funnel = snapData.salesFunnel?.metricsData || [];
    const v3Totals = snapData.totals?.metrics || {};

    const toggleSort = (key: V3SortKey) => {
      if (v3SortKey === key) {
        setV3SortDir(v3SortDir === 'desc' ? 'asc' : 'desc');
      } else {
        setV3SortKey(key);
        setV3SortDir('desc');
      }
    };

    const sortedV3Table = [...v3Table].sort((a, b) => {
      const aVal = Number((a.metrics as any)?.[v3SortKey]) || 0;
      const bVal = Number((b.metrics as any)?.[v3SortKey]) || 0;
      return v3SortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

    // Revenue time series from graphData
    const revenuePoints = snapData.graphData?.items?.[0]?.points || [];
    const dailyRevenue = revenuePoints.map((p) => Number(p.metrics?.revenue) || 0);

    // Funnel revenue series
    const funnelRevenue = v3Funnel.map((d) => Number(d.dayMetrics?.value) || 0);

    return (
      <div className="space-y-6">
        {graphsData.syncedAt && (
          <p className="text-sm text-muted-foreground">
            最后同步: {formatDate(graphsData.syncedAt)} | 周期: {snapData?.dateFrom} ~ {snapData?.dateTo}
            {snapData?.prevFrom && <span className="ml-2 text-xs">(环比: {snapData.prevFrom} ~ {snapData.prevTo})</span>}
          </p>
        )}

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">总收入</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">
                {totalRevenue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">总订单量</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{totalOrders.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">搜索曝光</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{(v3Totals.searchViews || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">平均搜索位</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{v3Totals.searchPosition || '-'}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">SKU 数</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{v3Table.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dailyRevenue.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <SimpleBarChart data={dailyRevenue} color="#10b981" label="每日收入趋势" />
              </CardContent>
            </Card>
          )}
          {funnelRevenue.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <SimpleBarChart data={funnelRevenue} color="#6366f1" label="销售漏斗 - 7天收入" />
              </CardContent>
            </Card>
          )}
        </div>

        {/* AI Recommendations */}
        {v3Recommendations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI 运营建议</CardTitle>
              <p className="text-xs text-muted-foreground">基于 Ozon 算法分析，建议对以下商品采取行动</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">图片</TableHead>
                      <TableHead className="min-w-[200px]">商品</TableHead>
                      <TableHead>收入</TableHead>
                      <TableHead>订单</TableHead>
                      <TableHead>建议</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v3Recommendations.map((rec, idx) => {
                      const matchedItem = v3Table.find(item => String(item.productInfo?.sku) === String(rec.sku));
                      const info = matchedItem?.productInfo || {};
                      const metrics = matchedItem?.metrics || {} as Record<string, number>;
                      return (
                        <TableRow key={idx}>
                          <TableCell>
                            {info.image ? (
                              <img src={info.image} alt="" className="w-10 h-10 rounded object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[250px]">
                            <div className="truncate text-sm font-medium" title={info.name || ''}>
                              {info.name || rec.sku}
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">{rec.sku}</div>
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {((metrics as any).revenue || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {((metrics as any).orderedUnits || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              rec.recommendation === 'increase_discount' ? 'bg-amber-100 text-amber-800' :
                              rec.recommendation === 'add_to_promo' ? 'bg-blue-100 text-blue-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {rec.recommendation === 'increase_discount' ? '建议加大折扣' :
                               rec.recommendation === 'add_to_promo' ? '建议参加活动' :
                               rec.recommendation}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {rec.recommendation === 'add_to_promo' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(`https://seller.ozon.ru/app/promotion/add?sku=${rec.sku}`, '_blank')}
                                >
                                  <Tag className="h-3 w-3 mr-1" />
                                  参加活动
                                </Button>
                              )}
                              {rec.recommendation === 'increase_discount' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(`https://seller.ozon.ru/app/products/${rec.sku}/edit#price`, '_blank')}
                                >
                                  <Percent className="h-3 w-3 mr-1" />
                                  改价
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => window.open(`https://seller.ozon.ru/app/products/${rec.sku}/edit#stock`, '_blank')}
                              >
                                <WarehouseIcon className="h-3 w-3 mr-1" />
                                库存
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* V3 SKU Table */}
        {v3Table.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SKU 明细 (V3 - 含搜索排名)</CardTitle>
              <p className="text-xs text-muted-foreground">点击列标题排序</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">#</TableHead>
                      <TableHead className="min-w-[180px]">商品</TableHead>
                      <SortableHead label="搜索位" sortKey="searchPosition" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="搜索曝光" sortKey="searchViews" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="订单数" sortKey="orderedUnits" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="收入" sortKey="revenue" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="PDP浏览" sortKey="pdpViews" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="加购率" sortKey="convPdpViewsToCart" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="取消" sortKey="cancelledUnits" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                      <SortableHead label="退货" sortKey="returnedUnits" currentKey={v3SortKey} dir={v3SortDir} onSort={toggleSort} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedV3Table.map((item, idx) => {
                      const info = item.productInfo || {};
                      const m = item.metrics || {};
                      return (
                        <TableRow key={idx}>
                          <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="max-w-[250px]">
                            <div className="flex items-center gap-2">
                              {info.image ? (
                                <img src={info.image} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                              ) : null}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium" title={info.name || ''}>
                                  {info.name || info.sku || '-'}
                                </div>
                                <div className="text-xs text-muted-foreground font-mono">{info.sku || ''}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">{(m as any).searchPosition ?? '-'}</TableCell>
                          <TableCell className="tabular-nums">{((m as any).searchViews || 0).toLocaleString()}</TableCell>
                          <TableCell className="tabular-nums">{((m as any).orderedUnits || 0).toLocaleString()}</TableCell>
                          <TableCell className="tabular-nums">{((m as any).revenue || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</TableCell>
                          <TableCell className="tabular-nums">{((m as any).pdpViews || 0).toLocaleString()}</TableCell>
                          <TableCell className="tabular-nums">{((m as any).convPdpViewsToCart || 0).toFixed(2)}%</TableCell>
                          <TableCell className="tabular-nums">{(m as any).cancelledUnits || 0}</TableCell>
                          <TableCell className="tabular-nums">{(m as any).returnedUnits || 0}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Legacy format rendering
  const graphItems = snapData?.graph || [];
  const tableItems = snapData?.table || [];

  const dailyOrders = graphItems.map((item) => Number(item.metrics?.[0]) || 0);
  const dailyRevenue = graphItems.map((item) => Number(item.metrics?.[1]) || 0);
  const dailyViews = graphItems.map((item) => Number(item.metrics?.[2]) || 0);
  const dailyConversion = graphItems.map((item) => Number(item.metrics?.[4]) || 0);

  return (
    <div className="space-y-6">
      {graphsData.syncedAt && (
        <p className="text-sm text-muted-foreground">
          最后同步: {formatDate(graphsData.syncedAt)} | 周期: {snapData?.dateFrom?.slice(0, 10)} ~ {snapData?.dateTo?.slice(0, 10)}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">总收入</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {totalRevenue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">总订单量</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{totalOrders.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SKU 数</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{tableItems.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">图表天数</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{graphItems.length}</div>
          </CardContent>
        </Card>
      </div>

      {graphItems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4">
              <SimpleBarChart data={dailyOrders} color="#6366f1" label="每日订单量" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <SimpleBarChart data={dailyRevenue} color="#10b981" label="每日收入" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <SimpleBarChart data={dailyViews} color="#f59e0b" label="每日曝光量" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <SimpleBarChart data={dailyConversion} color="#ec4899" label="每日加购转化率" />
            </CardContent>
          </Card>
        </div>
      )}

      {tableItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SKU 明细</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">#</TableHead>
                    <TableHead className="min-w-[120px]">SKU</TableHead>
                    <TableHead>订单数</TableHead>
                    <TableHead>浏览量</TableHead>
                    <TableHead>PDP浏览</TableHead>
                    <TableHead>加购率</TableHead>
                    <TableHead>收入</TableHead>
                    <TableHead>取消</TableHead>
                    <TableHead>退货</TableHead>
                    <TableHead>类目位置</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableItems.map((item, idx) => {
                    const dims = item.dimensions || [];
                    const mets = item.metrics || [];
                    return (
                      <TableRow key={idx}>
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate" title={dims[0] || ''}>
                          {dims[0] || '-'}
                        </TableCell>
                        <TableCell className="tabular-nums">{Number(mets[0] || 0).toLocaleString()}</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[1] || 0).toLocaleString()}</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[2] || 0).toLocaleString()}</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[3] || 0).toFixed(2)}%</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[4] || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[5] || 0)}</TableCell>
                        <TableCell className="tabular-nums">{Number(mets[6] || 0)}</TableCell>
                        <TableCell className="tabular-nums">{mets[7] != null ? Number(mets[7]) : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatPromotionDate(value: string | null): string {
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

function PromotionStatusBadge({ status }: { status: PromotionAction['status'] }) {
  if (status === 'active') return <Badge variant="success">进行中</Badge>;
  if (status === 'upcoming') return <Badge variant="warning">即将开始</Badge>;
  if (status === 'finished') return <Badge variant="secondary">已结束</Badge>;
  return <Badge variant="outline">未知</Badge>;
}

function parseActionIdInput(value: string): number | null {
  const matches = value.match(/\d+/g);
  const raw = matches?.[matches.length - 1];
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function PromotionsTab({ shopId }: { shopId: string }) {
  const [actions, setActions] = useState<PromotionAction[]>([]);
  const [selectedActionId, setSelectedActionId] = useState<number | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [productsData, setProductsData] = useState<PromotionProductsData | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [loadingActions, setLoadingActions] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function loadActions() {
    if (!shopId) return;
    setLoadingActions(true);
    const res = await api.get<{ actions: PromotionAction[] }>(`/api/shops/${shopId}/promotions/actions`);
    setLoadingActions(false);
    if (res.code !== 1) {
      setActions([]);
      toast({ title: res.msg || '促销活动读取失败', variant: 'destructive' });
      return;
    }
    const nextActions = res.data?.actions || [];
    setActions(nextActions);
    const preferred = nextActions.find((action) => action.participatingProductsCount > 0) || nextActions[0];
    if (preferred) {
      setSelectedActionId(preferred.id);
      setActionInput(String(preferred.id));
    } else {
      setSelectedActionId(null);
      setProductsData(null);
      setSelectedProductIds(new Set());
    }
  }

  async function loadProducts(actionId = selectedActionId) {
    if (!shopId || !actionId) return;
    setLoadingProducts(true);
    setSelectedProductIds(new Set());
    const res = await api.get<PromotionProductsData>(`/api/shops/${shopId}/promotions/actions/${actionId}/products?limit=100&offset=0`);
    setLoadingProducts(false);
    if (res.code !== 1) {
      setProductsData(null);
      toast({ title: res.msg || '活动商品读取失败', variant: 'destructive' });
      return;
    }
    setProductsData(res.data || { products: [], total: 0 });
  }

  useEffect(() => {
    setActions([]);
    setSelectedActionId(null);
    setActionInput('');
    setProductsData(null);
    setSelectedProductIds(new Set());
    loadActions();
  }, [shopId]);

  useEffect(() => {
    if (selectedActionId) loadProducts(selectedActionId);
  }, [selectedActionId]);

  function toggleProduct(productId: number) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleAll() {
    const products = productsData?.products || [];
    if (!products.length) return;
    setSelectedProductIds((prev) => (
      prev.size === products.length ? new Set() : new Set(products.map((product) => product.productId))
    ));
  }

  async function deactivateSelected() {
    if (!shopId || !selectedActionId || !selectedProductIds.size) return;
    setSubmitting(true);
    const res = await api.post<{
      successCount: number;
      failureCount: number;
      failures: Array<{ productId: number; message: string }>;
    }>(`/api/shops/${shopId}/promotions/actions/${selectedActionId}/deactivate-products`, {
      productIds: Array.from(selectedProductIds),
    });
    setSubmitting(false);
    if (res.code !== 1) {
      toast({ title: res.msg || '移出活动失败', variant: 'destructive' });
      return;
    }
    toast({ title: res.msg || '已提交' });
    setSelectedProductIds(new Set());
    await loadProducts(selectedActionId);
  }

  const selectedAction = actions.find((action) => action.id === selectedActionId) || null;
  const products = productsData?.products || [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-3 sm:grid-cols-[minmax(220px,360px)_minmax(180px,260px)]">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Ozon 活动列表</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedActionId || ''}
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    setSelectedActionId(nextId || null);
                    if (nextId) setActionInput(String(nextId));
                  }}
                  disabled={loadingActions}
                >
                  <option value="">自动同步后选择活动</option>
                  {actions.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.title} ({action.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">备用 ID / Ozon 链接</span>
                <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={actionInput}
                  onChange={(e) => setActionInput(e.target.value)}
                  placeholder="粘贴 seller.ozon.ru 活动链接或活动 ID"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadActions}
                disabled={loadingActions}
                className="gap-1"
              >
                {loadingActions ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新活动
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const actionId = parseActionIdInput(actionInput);
                  if (!actionId) {
                    toast({ title: '活动 ID 无效', variant: 'destructive' });
                    return;
                  }
                  setSelectedActionId(actionId);
                  loadProducts(actionId);
                }}
                className="gap-1"
              >
                <Megaphone className="h-4 w-4" />
                定位活动
              </Button>
              {selectedActionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`https://seller.ozon.ru/app/highlights/${selectedActionId}`, '_blank')}
                  className="gap-1"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ozon
                </Button>
              )}
            </div>
          </div>
          {selectedAction && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <PromotionStatusBadge status={selectedAction.status} />
              <span>{formatPromotionDate(selectedAction.dateStart)} - {formatPromotionDate(selectedAction.dateEnd)}</span>
              <span>已参与 {selectedAction.participatingProductsCount}</span>
              <span>可加入 {selectedAction.potentialProductsCount}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">活动商品</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">共 {productsData?.total ?? products.length} 件</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={!selectedProductIds.size || submitting}
            onClick={deactivateSelected}
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            移出活动 ({selectedProductIds.size})
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loadingProducts ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedActionId ? (
            <div className="py-12 text-center">
              <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">请选择促销活动</p>
            </div>
          ) : !products.length ? (
            <div className="py-12 text-center">
              <Megaphone className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">暂无已参与商品</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={products.length > 0 && selectedProductIds.size === products.length}
                        onChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className="w-[64px]">图片</TableHead>
                    <TableHead className="min-w-[260px]">商品</TableHead>
                    <TableHead>Product ID</TableHead>
                    <TableHead className="text-right">原价</TableHead>
                    <TableHead className="text-right">活动价</TableHead>
                    <TableHead className="text-right">最高活动价</TableHead>
                    <TableHead className="text-right">库存</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.productId} className={selectedProductIds.has(product.productId) ? 'bg-muted/30' : ''}>
                      <TableCell>
                        <input
                          type="checkbox"
                          className="rounded border-gray-300"
                          checked={selectedProductIds.has(product.productId)}
                          onChange={() => toggleProduct(product.productId)}
                        />
                      </TableCell>
                      <TableCell>
                        {product.image ? (
                          <img src={product.image} alt="" className="h-10 w-10 rounded object-cover border" />
                        ) : (
                          <div className="h-10 w-10 rounded border bg-muted flex items-center justify-center">
                            <Package className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <div className="line-clamp-2 text-sm font-medium" title={product.title}>{product.title}</div>
                        {product.offerId && <div className="text-xs text-muted-foreground font-mono">{product.offerId}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{product.productId}</TableCell>
                      <TableCell className="text-right tabular-nums">{product.price || '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{product.actionPrice || '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{product.maxActionPrice || '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">{product.stock ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ShopAnalyticsContent() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<string>('');
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('soldCount');
  const [sortAsc, setSortAsc] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('what_to_sell');

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        const ozonShops = res.data.filter((s) => s.platform === 'OZON');
        setShops(ozonShops);
        if (ozonShops.length > 0 && ozonShops[0]) {
          setSelectedShopId(ozonShops[0].id);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedShopId) return;
    setLoading(true);
    api.get<AnalyticsData>(`/api/shops/${selectedShopId}/analytics`).then((res) => {
      if (res.code === 1 && res.data) {
        setAnalytics(res.data);
      } else {
        setAnalytics(null);
      }
      setLoading(false);
    });
  }, [selectedShopId]);

  const rawData = analytics?.latest?.data;
  const items: AnalyticsItem[] = Array.isArray(rawData)
    ? rawData
    : (rawData && typeof rawData === 'object' && Array.isArray((rawData as any).items))
      ? (rawData as any).items
      : [];

  const sortedItems = useMemo(() => {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => {
      const aVal = numericOrZero(a[sortKey]);
      const bVal = numericOrZero(b[sortKey]);
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [items, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const totalSales = numericOrZero(analytics?.latest?.totalSales);
  const totalOrders = analytics?.latest?.totalOrders || 0;
  const productCount = analytics?.latest?.productCount || 0;
  const validCartRates = items
    .map((item) => toFiniteNumber(item.convToCartPdp))
    .filter((value): value is number => value != null);
  const avgCartRate = validCartRates.length
    ? (validCartRates.reduce((sum, value) => sum + value, 0) / validCartRates.length).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    : '-';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">店铺分析</h1>
          <p className="text-muted-foreground mt-1">
            查看 OZON 店铺商品销售分析数据（30天）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedShopId}
            onChange={(e) => setSelectedShopId(e.target.value)}
          >
            <option value="" disabled>选择店铺</option>
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'what_to_sell'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('what_to_sell')}
        >
          商品分析 (What to Sell)
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'graphs'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('graphs')}
        >
          经营图表 (Graphs)
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'promotions'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setActiveTab('promotions')}
        >
          促销活动
        </button>
      </div>

      {activeTab === 'graphs' && selectedShopId ? (
        <GraphsTab shopId={selectedShopId} />
      ) : activeTab === 'promotions' && selectedShopId ? (
        <PromotionsTab shopId={selectedShopId} />
      ) : (
        <>
      {analytics?.latest && (
        <p className="text-sm text-muted-foreground">
          最后同步: {formatDate(analytics.latest.syncedAt)}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !analytics?.latest ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">暂无分析数据</p>
            <p className="text-sm text-muted-foreground mt-1">
              请在浏览器扩展中点击"同步店铺分析"将数据推送到 ERP
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">总销售额</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {totalSales.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} RUB
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">总订单数</CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">
                  {totalOrders.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">商品数</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{productCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">平均加购率</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{avgCartRate === '-' ? '-' : `${avgCartRate}%`}</div>
              </CardContent>
            </Card>
          </div>

          {/* Products Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">SKU</TableHead>
                      <TableHead className="min-w-[200px]">商品名称</TableHead>
                      <TableHead>
                        <SortButton label="30天销量" sortKey="soldCount" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>
                        <SortButton label="销售额" sortKey="soldSum" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>
                        <SortButton label="均价" sortKey="avgPrice" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>
                        <SortButton label="加购率" sortKey="convToCartPdp" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>
                        <SortButton label="曝光量" sortKey="views" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>
                        <SortButton label="库存" sortKey="stock" current={sortKey} onClick={handleSort} />
                      </TableHead>
                      <TableHead>类目</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedItems.map((item) => (
                      <TableRow key={item.sku || item.variantId}>
                        <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                        <TableCell className="max-w-[300px]">
                          <div className="flex items-center gap-2">
                            {item.image ? (
                              <img src={item.image} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                            ) : null}
                            <span className="truncate" title={item.name}>{item.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatMetric(item.soldCount, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatMetric(item.soldSum, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatMetric(item.avgPrice, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatPercentMetric(item.convToCartPdp)}</TableCell>
                        <TableCell className="tabular-nums">
                          {formatMetric(item.views, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatMetric(item.stock, { maximumFractionDigits: 0 })}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" title={`${item.category1} > ${item.category3}`}>
                          {item.category3 || item.category1}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* History */}
          {analytics.history.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">历史快照</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>同步时间</TableHead>
                      <TableHead>周期</TableHead>
                      <TableHead className="text-right">商品数</TableHead>
                      <TableHead className="text-right">总销售额</TableHead>
                      <TableHead className="text-right">总订单数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.history.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{formatDate(h.syncedAt)}</TableCell>
                        <TableCell>{h.period}</TableCell>
                        <TableCell className="text-right tabular-nums">{h.productCount}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMetric(h.totalSales, { maximumFractionDigits: 0 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{h.totalOrders ?? '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  current,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  onClick: (key: SortKey) => void;
}) {
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={() => onClick(sortKey)}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${current === sortKey ? 'text-foreground' : 'text-muted-foreground/50'}`} />
    </button>
  );
}

export default function ShopAnalyticsPage() {
  return <ShopAnalyticsContent />;
}
