'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Copy, Loader2, RefreshCw, RotateCw, Search, Settings2 } from 'lucide-react';
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
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';
import { OzonSyncActionDialog } from '@/components/ozon/sync-action-dialog';

type SyncType = 'PRODUCT_PULL' | 'PRODUCT_PUSH' | 'ORDER_PULL' | 'STOCK_PUSH' | 'IMAGE_RESIZE' | 'RETURN_PULL';
type SyncStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

interface SyncShop {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastSyncAt: string | null;
  notificationEnabled: boolean;
  notifyPath: string | null;
}

interface SyncRun {
  id: string;
  shopId: string;
  shopName: string;
  platform: string;
  type: SyncType;
  status: SyncStatus;
  trigger: string;
  eventType: string | null;
  eventKey: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const typeLabel: Record<string, string> = {
  PRODUCT_PULL: '商品同步',
  PRODUCT_PUSH: '上品提交',
  ORDER_PULL: '订单同步',
  STOCK_PUSH: '库存推送',
  IMAGE_RESIZE: '图片处理',
  RETURN_PULL: '退货同步',
};

const statusLabel: Record<SyncStatus, string> = {
  PENDING: '排队中',
  RUNNING: '同步中',
  SUCCESS: '成功',
  FAILED: '失败',
};

const statusVariant: Record<SyncStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  RUNNING: 'secondary',
  SUCCESS: 'default',
  FAILED: 'destructive',
};

export default function OzonSyncCenterPage() {
  const [shops, setShops] = useState<SyncShop[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [shopId, setShopId] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [trigger, setTrigger] = useState('');

  const loadShops = useCallback(async () => {
    const res = await api.get<{ rows: SyncShop[] }>('/api/ozon-sync/shops');
    if (res.code === 1 && res.data?.rows) setShops(res.data.rows);
  }, []);

  const loadRuns = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (shopId) params.set('shopId', shopId);
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (trigger) params.set('trigger', trigger);

    setLoading(true);
    const res = await api.get<{ total: number; rows: SyncRun[] }>(`/api/ozon-sync/runs?${params}`);
    if (res.code === 1 && res.data) {
      setRuns(res.data.rows);
      setTotal(res.data.total);
    } else {
      toast({ title: res.msg || '读取同步记录失败', variant: 'destructive' });
    }
    setLoading(false);
  }, [shopId, type, status, trigger]);

  useEffect(() => {
    loadShops();
  }, [loadShops]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const health = useMemo(() => {
    const running = runs.filter((run) => run.status === 'RUNNING' || run.status === 'PENDING').length;
    const failed = runs.filter((run) => run.status === 'FAILED').length;
    const notifyReady = shops.filter((shop) => shop.notificationEnabled).length;
    return { running, failed, notifyReady };
  }, [runs, shops]);

  async function rotateToken(shop: SyncShop) {
    const res = await api.post<{ token: string; notifyPath: string }>(`/api/ozon-sync/shops/${shop.id}/notification-token`);
    if (res.code !== 1 || !res.data) {
      toast({ title: res.msg || '生成通知地址失败', variant: 'destructive' });
      return;
    }
    toast({ title: '通知地址已生成' });
    await loadShops();
  }

  async function copyUrl(path: string) {
    await navigator.clipboard.writeText(apiUrl(path));
    toast({ title: '通知 URL 已复制' });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ozon 同步中心</h1>
          <p className="mt-1 text-sm text-muted-foreground">统一查看商品、订单、上品和库存同步记录，配置 Ozon 通知触发。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => { loadShops(); loadRuns(); }} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <RotateCw className="h-4 w-4" />
            一键同步
          </Button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Ozon 店铺" value={shops.length} hint="当前账号可见" />
        <MetricCard title="通知已配置" value={health.notifyReady} hint="可由 Ozon 事件触发" />
        <MetricCard title="进行中" value={health.running} hint="排队或运行中" />
        <MetricCard title="最近失败" value={health.failed} hint="当前筛选下失败记录" danger={health.failed > 0} />
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Ozon 通知地址
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {shops.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">暂无 Ozon 店铺，请先绑定店铺。</div>
          ) : shops.map((shop) => (
            <div key={shop.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{shop.name}</span>
                    <Badge variant={shop.status === 'ACTIVE' ? 'secondary' : 'destructive'}>{shop.status}</Badge>
                    {shop.notificationEnabled && <Badge variant="outline">通知已配置</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    上次同步：{shop.lastSyncAt ? new Date(shop.lastSyncAt).toLocaleString('zh-CN') : '暂无'}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => rotateToken(shop)}>
                  {shop.notificationEnabled ? '重置' : '生成'}
                </Button>
              </div>
              {shop.notifyPath && (
                <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate text-xs">{apiUrl(shop.notifyPath)}</code>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyUrl(shop.notifyPath!)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-4 w-4" />
              同步记录
            </div>
            <select value={shopId} onChange={(event) => setShopId(event.target.value)} className="h-8 min-w-[180px] rounded-md border border-input bg-background px-2 text-sm">
              <option value="">全部店铺</option>
              {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>
            <select value={type} onChange={(event) => setType(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">全部类型</option>
              {Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">全部状态</option>
              {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={trigger} onChange={(event) => setTrigger(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">全部来源</option>
              <option value="manual">手动</option>
              <option value="ozon_notification">Ozon 通知</option>
            </select>
            <Button size="sm" variant="outline" onClick={loadRuns}>
              <Search className="h-3.5 w-3.5" />
              查询
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">共 {total} 条</span>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[150px]">时间</TableHead>
                  <TableHead>店铺</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead className="min-w-[220px]">错误/事件</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">暂无同步记录</TableCell>
                  </TableRow>
                ) : runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{new Date(run.createdAt).toLocaleString('zh-CN')}</div>
                      {run.finishedAt && <div>完成 {new Date(run.finishedAt).toLocaleTimeString('zh-CN')}</div>}
                    </TableCell>
                    <TableCell className="font-medium">{run.shopName}</TableCell>
                    <TableCell>{typeLabel[run.type] || run.type}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[run.status]}>{statusLabel[run.status] || run.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {run.trigger === 'ozon_notification' ? 'Ozon 通知' : run.trigger === 'manual' ? '手动' : run.trigger}
                    </TableCell>
                    <TableCell className="text-sm">{run.resultSummary || '-'}</TableCell>
                    <TableCell className="max-w-[320px]">
                      {run.errorMessage ? (
                        <div className="line-clamp-2 text-xs text-destructive">{run.errorMessage}</div>
                      ) : (
                        <div className="space-y-0.5 text-xs text-muted-foreground">
                          {run.eventType && <div>事件：{run.eventType}</div>}
                          {run.eventKey && <div>对象：{run.eventKey}</div>}
                          {!run.eventType && '-'}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <OzonSyncActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultTypes={['PRODUCT_PULL', 'ORDER_PULL']}
        onQueued={loadRuns}
      />
    </div>
  );
}

function MetricCard({ title, value, hint, danger }: { title: string; value: number; hint: string; danger?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${danger ? 'text-destructive' : ''}`}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
