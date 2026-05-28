'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send, RefreshCw, Trash2, CheckCircle2, XCircle, Clock, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface Template {
  id: string;
  name: string;
  isRecommended: boolean;
}

interface Shop {
  id: string;
  name: string;
  userId: string;
  user: { phone: string; nickname: string | null };
}

interface Command {
  id: string;
  shopId: string;
  templateId: string;
  commandType: string;
  status: string;
  operationId: string | null;
  errorMessage: string | null;
  createdBy: string;
  acceptedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  template: { id: string; name: string };
  shop: Shop | null;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive'; icon: any }> = {
  pending: { label: '待用户接受', variant: 'secondary', icon: Clock },
  running: { label: '执行中', variant: 'default', icon: Loader },
  success: { label: '成功', variant: 'default', icon: CheckCircle2 },
  failed: { label: '失败', variant: 'destructive', icon: XCircle },
  rejected: { label: '已拒绝', variant: 'destructive', icon: XCircle },
};

export default function WarehouseCommandsAdminPage() {
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showDispatch, setShowDispatch] = useState(false);

  async function load() {
    setLoading(true);
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    const res = await api.get<Command[]>(`/api/admin/warehouse/commands${qs}`);
    if (res.code === 1 && res.data) setCommands(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, [statusFilter]);

  async function handleRevoke(id: string) {
    if (!confirm('确认撤回该指令？')) return;
    const res = await api.delete(`/api/admin/warehouse/commands/${id}`);
    if (res.code === 1) { toast({ title: '已撤回' }); load(); }
    else toast({ title: res.msg || '撤回失败', variant: 'destructive' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">仓库指令</h1>
          <p className="text-muted-foreground mt-1">下发仓库切换指令给用户，用户接受后由 OZON 异步执行</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />刷新</Button>
          <Button onClick={() => setShowDispatch(true)}><Send className="h-4 w-4 mr-1" />下发指令</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">指令列表（{commands.length}）</CardTitle>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部状态</option>
              <option value="pending">待接受</option>
              <option value="running">执行中</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="rejected">已拒绝</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : commands.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无指令</p>
          ) : (
            <div className="space-y-2">
              {commands.map((c) => {
                const st = (STATUS_CONFIG[c.status] || STATUS_CONFIG.pending)!;
                const Icon = st.icon;
                return (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={st.variant}><Icon className="h-3 w-3 mr-1" />{st.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {c.commandType === 'update_delivery_method' ? '物流方式' : '仓库'}
                        </Badge>
                        <span className="font-medium">{c.template.name}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-sm">{c.shop?.name || c.shopId}</span>
                        <span className="text-xs text-muted-foreground">
                          ({c.shop?.user.nickname || c.shop?.user.phone || '-'})
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5 flex gap-3">
                        <span>下发: {new Date(c.createdAt).toLocaleString()}</span>
                        {c.acceptedAt && <span>接受: {new Date(c.acceptedAt).toLocaleString()}</span>}
                        {c.finishedAt && <span>完成: {new Date(c.finishedAt).toLocaleString()}</span>}
                        {c.operationId && <span className="font-mono">op_id: {c.operationId.slice(0, 8)}…</span>}
                      </div>
                      {c.errorMessage && (
                        <div className="text-xs text-destructive mt-1">错误: {c.errorMessage}</div>
                      )}
                    </div>
                    {(c.status === 'pending' || c.status === 'rejected' || c.status === 'failed') && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRevoke(c.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showDispatch && (
        <DispatchDialog onClose={() => setShowDispatch(false)} onSuccess={() => { setShowDispatch(false); load(); }} />
      )}
    </div>
  );
}

function DispatchDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shops, setShops] = useState<{ id: string; name: string; userPhone: string; nickname: string | null }[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [commandType, setCommandType] = useState<'create_warehouse' | 'update_delivery_method'>('create_warehouse');
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

  useEffect(() => {
    async function init() {
      const [tplRes, shopRes] = await Promise.all([
        api.get<Template[]>('/api/admin/warehouse/templates'),
        api.get<any[]>('/api/shops?platform=OZON&limit=500'),
      ]);
      if (tplRes.code === 1 && tplRes.data) {
        setTemplates(tplRes.data);
        const def = tplRes.data.find((t) => t.isRecommended) || tplRes.data[0];
        if (def) setTemplateId(def.id);
      }
      if (shopRes.code === 1 && shopRes.data) {
        const list = (Array.isArray(shopRes.data) ? shopRes.data : (shopRes.data as any).rows || [])
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            userPhone: s.user?.phone || s.userPhone || '',
            nickname: s.user?.nickname || null,
          }));
        setShops(list);
      }
      setLoading(false);
    }
    init();
  }, []);

  function toggleShop(id: string) {
    setSelectedShops((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!templateId) { toast({ title: '请选择模板', variant: 'destructive' }); return; }
    if (selectedShops.length === 0) { toast({ title: '请至少选择一个店铺', variant: 'destructive' }); return; }
    if (isScheduled && !scheduledAt) { toast({ title: '请选择定时时间', variant: 'destructive' }); return; }
    setSubmitting(true);
    const endpoint = isScheduled
      ? '/api/admin/warehouse/commands/schedule'
      : '/api/admin/warehouse/commands/dispatch';
    const payload: any = { templateId, shopIds: selectedShops, commandType };
    if (isScheduled) payload.scheduledAt = scheduledAt;
    const res = await api.post(endpoint, payload);
    setSubmitting(false);
    if (res.code === 1) { toast({ title: res.msg || '已下发' }); onSuccess(); }
    else toast({ title: res.msg || '下发失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>下发仓库切换指令</DialogTitle></DialogHeader>
        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>选择模板</Label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">-- 请选择 --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.isRecommended ? '★ ' : ''}{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>指令类型</Label>
              <select
                value={commandType}
                onChange={(e) => setCommandType(e.target.value as any)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="create_warehouse">创建/同步仓库</option>
                <option value="update_delivery_method">更新物流方式</option>
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>选择店铺（已选 {selectedShops.length}/{shops.length}）</Label>
                <button
                  type="button"
                  className="text-xs text-orange-600 hover:underline"
                  onClick={() => setSelectedShops(selectedShops.length === shops.length ? [] : shops.map((s) => s.id))}
                >
                  {selectedShops.length === shops.length ? '取消全选' : '全选'}
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                {shops.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">无可选店铺</p>
                ) : shops.map((s) => (
                  <label key={s.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30">
                    <input
                      type="checkbox"
                      checked={selectedShops.includes(s.id)}
                      onChange={() => toggleShop(s.id)}
                      className="h-4 w-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.nickname || ''} {s.userPhone}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span className="text-sm">定时下发</span>
              </label>
              {isScheduled && (
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isScheduled ? '安排定时下发' : `下发到 ${selectedShops.length} 个店铺`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
