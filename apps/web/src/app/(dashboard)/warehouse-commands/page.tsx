'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Loader, AlertCircle, GitCompare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface Command {
  id: string;
  shopId: string;
  commandType: string;
  status: string;
  operationId: string | null;
  errorMessage: string | null;
  acceptedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  template: {
    id: string;
    name: string;
    phone: string;
    latitude: number;
    longitude: number;
    warehouseType: string;
    firstMileType: string;
    dropOffPointId: string | null;
    workingDays: string[];
    coverageRegions: string[] | null;
    ozonOfficialPickupId: string | null;
  };
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive'; icon: any; color: string }> = {
  pending: { label: '待确认', variant: 'secondary', icon: Clock, color: 'text-orange-600' },
  running: { label: '执行中', variant: 'default', icon: Loader, color: 'text-blue-600' },
  success: { label: '成功', variant: 'default', icon: CheckCircle2, color: 'text-green-600' },
  failed: { label: '失败', variant: 'destructive', icon: XCircle, color: 'text-red-600' },
  rejected: { label: '已拒绝', variant: 'destructive', icon: XCircle, color: 'text-gray-500' },
};

export default function WarehouseCommandsUserPage() {
  const systemDialog = useSystemDialog();
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [shops, setShops] = useState<Map<string, string>>(new Map());
  const [compareShopId, setCompareShopId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [cmdRes, shopRes] = await Promise.all([
      api.get<Command[]>('/api/warehouse-commands'),
      api.get<any[]>('/api/shops?limit=200'),
    ]);
    if (cmdRes.code === 1 && cmdRes.data) setCommands(cmdRes.data);
    if (shopRes.code === 1 && shopRes.data) {
      const list = Array.isArray(shopRes.data) ? shopRes.data : (shopRes.data as any).rows || [];
      setShops(new Map(list.map((s: any) => [s.id, s.name])));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleAccept(id: string) {
    const cmd = commands.find((c) => c.id === id);
    const label = cmd?.commandType === 'update_delivery_method' ? '更新物流方式' : '创建/更新仓库';
    const confirmed = await systemDialog.confirm({
      title: '执行旧版仓库指令',
      message: `确认执行「${label}」？这是旧版自动执行流程；新流程建议按 Ozon 仓库物流模板在 Ozon 后台照填配置。`,
      confirmText: '继续执行',
    });
    if (!confirmed) return;
    setAcceptingId(id);
    const res = await api.post(`/api/warehouse-commands/${id}/accept`);
    setAcceptingId(null);
    if (res.code === 1) { toast({ title: '已提交旧版指令任务' }); load(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  async function handleReject(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '拒绝仓库指令',
      message: '确认拒绝该指令？',
      confirmText: '拒绝',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.post(`/api/warehouse-commands/${id}/reject`);
    if (res.code === 1) { toast({ title: '已拒绝' }); load(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  const pending = commands.filter((c) => c.status === 'pending');
  const others = commands.filter((c) => c.status !== 'pending');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">历史仓库指令</h1>
          <p className="text-muted-foreground mt-1">旧版 Ozon 仓库/物流自动执行记录，仅用于兼容历史任务。新流程请按管理员维护的 Ozon 仓库物流模板在 Ozon 后台照填配置。</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />刷新</Button>
        {shops.size > 0 && (
          <Button variant="outline" onClick={() => setCompareShopId([...shops.keys()][0] || null)}>
            <GitCompare className="h-4 w-4 mr-1" />对比 OZON 仓库
          </Button>
        )}
      </div>

      {pending.length > 0 && (
        <Card className="border-orange-300 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              有 {pending.length} 条待确认指令
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map((c) => (
              <div key={c.id} className="p-4 rounded-lg border bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {c.commandType === 'update_delivery_method' ? '更新物流方式' : '创建仓库'}
                      </Badge>
                      <span className="font-medium text-base">{c.template.name}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-sm">{shops.get(c.shopId) || c.shopId}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-muted-foreground">
                      <div>电话: {c.template.phone}</div>
                      <div>类型: {c.template.warehouseType === 'aggregator' ? 'Ozon Partners' : '自送/第三方'}</div>
                      {c.template.dropOffPointId && <div>代收点 ID: {c.template.dropOffPointId}</div>}
                      {c.template.firstMileType && <div>首公里: {c.template.firstMileType}</div>}
                      <div>坐标: {c.template.latitude.toFixed(4)}, {c.template.longitude.toFixed(4)}</div>
                      <div>下发时间: {new Date(c.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      onClick={() => handleAccept(c.id)}
                      disabled={acceptingId === c.id}
                      className="bg-orange-600 hover:bg-orange-700"
                    >
                      {acceptingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4 mr-1" />一键同步</>}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleReject(c.id)}>拒绝</Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">历史指令（{others.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : others.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无历史记录</p>
          ) : (
            <div className="space-y-2">
              {others.map((c) => {
                const st = (STATUS_CONFIG[c.status] || STATUS_CONFIG.pending)!;
                const Icon = st.icon;
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <Badge variant={st.variant}><Icon className={`h-3 w-3 mr-1 ${c.status === 'running' ? 'animate-spin' : ''}`} />{st.label}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{c.template.name} → {shops.get(c.shopId) || c.shopId}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(c.createdAt).toLocaleString()}
                        {c.finishedAt && ` · 完成于 ${new Date(c.finishedAt).toLocaleString()}`}
                      </div>
                      {c.errorMessage && <div className="text-xs text-destructive mt-1">{c.errorMessage}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {compareShopId && (
        <CompareDialog shopId={compareShopId} onClose={() => setCompareShopId(null)} />
      )}
    </div>
  );
}

function CompareDialog({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await api.get<any>(`/api/warehouse-commands/compare/${shopId}`);
      if (res.code === 1 && res.data) setData(res.data);
      setLoading(false);
    }
    load();
  }, [shopId]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>OZON 仓库对比</DialogTitle></DialogHeader>
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !data ? (
          <p className="text-center py-6 text-muted-foreground">加载失败</p>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="font-medium mb-2">模板匹配情况</h3>
              <div className="space-y-2">
                {data.templates?.map((t: any) => (
                  <div key={t.template.id} className="flex items-center gap-3 p-3 rounded-lg border">
                    <Badge variant={t.synced ? 'default' : 'destructive'}>
                      {t.synced ? '已同步' : '未同步'}
                    </Badge>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{t.template.name}</div>
                      {t.diff?.length > 0 && (
                        <div className="text-xs text-destructive mt-0.5">{t.diff.join('; ')}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-medium mb-2">OZON 当前仓库（{data.ozonWarehouses?.length || 0}）</h3>
              <div className="space-y-1">
                {data.ozonWarehouses?.map((w: any) => (
                  <div key={w.warehouse_id} className="flex items-center gap-2 p-2 rounded border text-sm">
                    <Badge variant="secondary">{w.status}</Badge>
                    <span>{w.name}</span>
                    <span className="text-muted-foreground ml-auto">ID: {w.warehouse_id}</span>
                  </div>
                ))}
              </div>
            </div>
            {data.unmatchedOzon?.length > 0 && (
              <div>
                <h3 className="font-medium mb-2 text-orange-600">未匹配模板的 OZON 仓库</h3>
                <div className="space-y-1">
                  {data.unmatchedOzon.map((w: any) => (
                    <div key={w.warehouse_id} className="p-2 rounded border text-sm text-muted-foreground">
                      {w.name} (ID: {w.warehouse_id})
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
