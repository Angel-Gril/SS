'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface AddressTemplate {
  id: string;
  hostUserId: string | null;
  name: string;
  recipient: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  address: string;
  zipCode: string | null;
  isDefault: boolean;
}

interface Me {
  id: string;
  role: string;
  canPublishAddress?: boolean;
}

const EMPTY_FORM = {
  name: '', recipient: '', phone: '', province: '', city: '', district: '', address: '', zipCode: '', isDefault: false,
};

export default function DomesticAddressesPage() {
  const [list, setList] = useState<AddressTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [addrRes, meRes] = await Promise.all([
      api.get<AddressTemplate[]>('/api/domestic-addresses'),
      api.get<Me>('/api/user/me'),
    ]);
    if (addrRes.code === 1 && addrRes.data) setList(addrRes.data);
    if (meRes.code === 1 && meRes.data) setMe(meRes.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function handleCopyDefault() {
    const res = await api.post<{ text: string }>('/api/domestic-addresses/copy-default');
    if (res.code === 1 && res.data) {
      await navigator.clipboard.writeText(res.data.text);
      toast({ title: '已复制到剪贴板' });
    } else {
      toast({ title: res.msg || '复制失败', variant: 'destructive' });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确认删除？')) return;
    const res = await api.delete(`/api/domestic-addresses/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); load(); }
    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setDialogOpen(true);
  }
  function openEdit(a: AddressTemplate) {
    setEditingId(a.id);
    setForm({
      name: a.name, recipient: a.recipient, phone: a.phone,
      province: a.province, city: a.city, district: a.district,
      address: a.address, zipCode: a.zipCode || '', isDefault: a.isDefault,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name || !form.recipient || !form.phone || !form.province || !form.city || !form.district || !form.address) {
      toast({ title: '请填写完整地址信息', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = { ...form, zipCode: form.zipCode || undefined };
    const res = editingId
      ? await api.put(`/api/domestic-addresses/${editingId}`, payload)
      : await api.post('/api/domestic-addresses', payload);
    setSaving(false);
    if (res.code === 1) {
      toast({ title: editingId ? '已更新' : '已创建' });
      setDialogOpen(false);
      load();
    } else {
      toast({ title: res.msg || '保存失败', variant: 'destructive' });
    }
  }

  const isAdmin = me?.role === 'ADMIN';
  const canPublish = isAdmin || me?.canPublishAddress === true;

  // 来源徽标：null=平台 / 自己=我发布 / 其他=上级仓主
  function sourceBadge(a: AddressTemplate) {
    if (a.hostUserId === null) return <Badge variant="outline" className="text-blue-600 border-blue-300">平台下发</Badge>;
    if (a.hostUserId === me?.id) return <Badge variant="outline" className="text-green-600 border-green-300">我发布</Badge>;
    return <Badge variant="outline" className="text-purple-600 border-purple-300">上级仓主</Badge>;
  }

  function canMutate(a: AddressTemplate) {
    if (isAdmin) return true;
    return a.hostUserId !== null && a.hostUserId === me?.id;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">国内收货地址</h1>
          <p className="text-muted-foreground mt-1">
            {isAdmin
              ? '管理平台中转仓地址；自建仓主可在此发布自家地址给下线'
              : canPublish
                ? '管理你为下线用户发布的中转仓地址'
                : '一键复制中转仓收货地址，用于 1688/淘宝/拼多多 发货'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopyDefault}><Copy className="h-4 w-4 mr-1" />一键复制默认地址</Button>
          {canPublish && (
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新建地址</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">地址模板（{list.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : list.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无地址模板</p>
          ) : (
            <div className="space-y-2">
              {list.map((a) => (
                <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{a.name}</span>
                      {sourceBadge(a)}
                      {a.isDefault && <Badge className="bg-orange-500"><Star className="h-3 w-3 mr-1" />默认</Badge>}
                    </div>
                    <div className="text-sm mt-1">
                      <div>{a.recipient} · {a.phone}</div>
                      <div className="text-muted-foreground">{a.province}{a.city}{a.district} {a.address}</div>
                      {a.zipCode && <div className="text-muted-foreground">邮编: {a.zipCode}</div>}
                    </div>
                  </div>
                  {canMutate(a) && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(a.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑地址' : '新建地址'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>地址名称（如"上海仓-顺丰"）</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>收货人</Label>
                <Input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>手机</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>省</Label>
                <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>市</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>区</Label>
                <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>详细地址</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>邮编（可选）</Label>
              <Input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="h-4 w-4 rounded"
              />
              <span className="text-sm">设为默认地址（用于一键复制）</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
