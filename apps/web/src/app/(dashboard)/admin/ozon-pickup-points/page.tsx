'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface PickupPoint {
  id: string;
  city: string;
  province: string | null;
  type: 'collect' | 'dispatch';
  name: string;
  address: string;
  contact: string | null;
  phone: string | null;
  workingHours: string | null;
  note: string | null;
  isActive: boolean;
  sortOrder: number;
  source?: string | null;
  externalId?: string | null;
  providerId?: number | null;
  providerName?: string | null;
  syncedAt?: string | null;
  createdAt: string;
}

interface ShopOption {
  id: string;
  name: string;
  platform: string;
}

const TYPE_OPTIONS = [
  { value: 'collect', label: '集运点' },
  { value: 'dispatch', label: '发运点' },
];

const typeLabel = (t: string) => TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

const emptyForm = {
  city: '',
  province: '',
  type: 'collect' as 'collect' | 'dispatch',
  name: '',
  address: '',
  contact: '',
  phone: '',
  workingHours: '',
  note: '',
  isActive: true,
  sortOrder: 0,
};

export default function AdminOzonPickupPointsPage() {
  const systemDialog = useSystemDialog();
  const [items, setItems] = useState<PickupPoint[]>([]);
  const [shops, setShops] = useState<ShopOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<PickupPoint | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncShopId, setSyncShopId] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  useEffect(() => {
    fetchList();
    fetchShops();
  }, []);

  async function fetchList() {
    setLoading(true);
    const res = await api.get<PickupPoint[]>('/api/ozon-pickup-points?includeInactive=1');
    if (res.code === 1 && res.data) setItems(res.data);
    setLoading(false);
  }

  async function fetchShops() {
    const res = await api.get<ShopOption[] | { rows?: ShopOption[] }>('/api/shops?limit=200');
    if (res.code !== 1 || !res.data) return;
    const rows = Array.isArray(res.data) ? res.data : (res.data.rows || []);
    const ozonShops = rows.filter((shop) => shop.platform === 'OZON');
    setShops(ozonShops);
    setSyncShopId((current) => current || ozonShops[0]?.id || '');
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowDialog(true);
  }

  function openEdit(item: PickupPoint) {
    setEditing(item);
    setForm({
      city: item.city,
      province: item.province || '',
      type: item.type,
      name: item.name,
      address: item.address,
      contact: item.contact || '',
      phone: item.phone || '',
      workingHours: item.workingHours || '',
      note: item.note || '',
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
    setShowDialog(true);
  }

  async function save() {
    if (!form.city || !form.name || !form.address) {
      toast({ title: '城市/名称/地址必填', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      city: form.city,
      province: form.province || undefined,
      type: form.type,
      name: form.name,
      address: form.address,
      contact: form.contact || undefined,
      phone: form.phone || undefined,
      workingHours: form.workingHours || undefined,
      note: form.note || undefined,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
    };
    const res = editing
      ? await api.put(`/api/ozon-pickup-points/${editing.id}`, payload)
      : await api.post('/api/ozon-pickup-points', payload);
    setSaving(false);
    if (res.code === 1) {
      toast({ title: editing ? '已更新' : '已创建' });
      setShowDialog(false);
      fetchList();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  async function remove(item: PickupPoint) {
    const confirmed = await systemDialog.confirm({
      title: '删除揽收点',
      message: `确认删除 ${item.city} · ${item.name}？`,
      confirmText: '删除',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.delete(`/api/ozon-pickup-points/${item.id}`);
    if (res.code === 1) {
      toast({ title: '已删除' });
      fetchList();
    } else {
      toast({ title: res.msg || '删除失败', variant: 'destructive' });
    }
  }

  async function syncOzonDropoffPoints() {
    if (!syncShopId) {
      toast({ title: '请选择 Ozon 店铺', variant: 'destructive' });
      return;
    }
    setSyncing(true);
    const res = await api.post<{
      created: number;
      updated: number;
      totalPoints: number;
      providerCount: number;
      providerErrors?: { providerId: number; message: string }[];
    }>('/api/ozon-pickup-points/sync-ozon-dropoffs', { shopId: syncShopId });
    setSyncing(false);
    if (res.code === 1 && res.data) {
      toast({
        title: '同步Ozon发运点完成',
        description: `发运点 ${res.data.totalPoints} 个，provider ${res.data.providerCount} 个，新建 ${res.data.created}，更新 ${res.data.updated}`,
      });
      fetchList();
    } else {
      toast({ title: res.msg || '同步Ozon发运点失败', variant: 'destructive' });
    }
  }

  const filtered = filterKeyword
    ? items.filter((i) => {
      const keyword = filterKeyword.toLowerCase();
      return [i.city, i.province, i.name, i.address, i.contact, i.phone, i.providerName, i.externalId]
        .some((value) => String(value || '').toLowerCase().includes(keyword));
    })
    : items;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">OZON 发运点同步</h1>
          <p className="text-muted-foreground mt-1">从 Ozon Seller 读取店铺可见的中国境内发运点 / 揽收点 / 仓库地址。同步记录和手工记录都会保存到数据库，所有用户可查看启用状态的记录。</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增手工点</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Ozon接口同步
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            选择已同步登录态的 Ozon 店铺，一键读取该账号在 Ozon 后台可见的中国发运点/揽收点/仓库地址，并写入本系统供用户搜索选择。
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Ozon 店铺</Label>
              <select
                value={syncShopId}
                onChange={(event) => setSyncShopId(event.target.value)}
                className="h-9 min-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
              >
                {shops.length ? shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>{shop.name}</option>
                )) : <option value="">无可同步店铺</option>}
              </select>
            </div>
            <Button onClick={syncOzonDropoffPoints} disabled={syncing || !syncShopId}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              从Ozon读取发运点/揽收点
            </Button>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            需要该店铺已保存 Ozon 登录 cookie 和 company_id；同步失败时先到店铺页更新登录态，再回到这里重试。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">已保存发运点/揽收点</CardTitle>
            <Input
              placeholder="按城市/省份/名称/地址/provider/发运点ID过滤"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              className="max-w-md"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((it) => (
                <div key={it.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{it.name}</span>
                      <Badge variant={it.type === 'collect' ? 'default' : 'secondary'}>{typeLabel(it.type)}</Badge>
                      <Badge variant="outline">{it.province ? `${it.province} · ` : ''}{it.city}</Badge>
                      {it.source === 'ozon_seller' && <Badge variant="outline">Ozon同步</Badge>}
                      {it.providerName && <Badge variant="outline">{it.providerName}</Badge>}
                      {it.externalId && <Badge variant="outline">ID {it.externalId}</Badge>}
                      {!it.isActive && <Badge variant="outline" className="text-muted-foreground">已停用</Badge>}
                      {it.sortOrder !== 0 && <span className="text-xs text-muted-foreground">序 {it.sortOrder}</span>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">{it.address}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                      {it.contact && <span>联系人：{it.contact}</span>}
                      {it.phone && <span>电话：{it.phone}</span>}
                      {it.workingHours && <span>{it.workingHours}</span>}
                    </div>
                    {it.note && <div className="text-xs text-muted-foreground mt-1">备注：{it.note}</div>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(it)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(it)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(v) => !v && setShowDialog(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? '编辑揽收点' : '新增揽收点'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>城市 *</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="如：义乌" />
              </div>
              <div className="space-y-1">
                <Label>省份</Label>
                <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="如：浙江" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>类型 *</Label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as 'collect' | 'dispatch' })}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>排序（小在前）</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>站点名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：义乌国际物流中心 OZON 集运点" />
            </div>
            <div className="space-y-1">
              <Label>详细地址 *</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="详细到门牌号" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>联系人</Label><Input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
              <div className="space-y-1"><Label>电话</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="space-y-1">
              <Label>工作时间</Label>
              <Input value={form.workingHours} onChange={(e) => setForm({ ...form, workingHours: e.target.value })} placeholder="周一至周六 09:00-18:00" />
            </div>
            <div className="space-y-1">
              <Label>备注（资费/限重等）</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              <span>启用（用户可见）</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
