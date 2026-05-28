'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface FeeTemplate {
  id: string;
  name: string;
  type: string;
  fee: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

const TYPE_OPTIONS = [
  { value: 'packing', label: '打包费' },
  { value: 'shipping', label: '快递费' },
  { value: 'other', label: '其他' },
];

const typeLabel = (t: string) => TYPE_OPTIONS.find((o) => o.value === t)?.label || t;

export default function FeeTemplatesPage() {
  const [templates, setTemplates] = useState<FeeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<FeeTemplate | null>(null);
  const [form, setForm] = useState({ name: '', type: 'shipping', fee: '0', description: '', isDefault: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTemplates(); }, []);

  async function fetchTemplates() {
    setLoading(true);
    const res = await api.get<FeeTemplate[]>('/api/admin/fee-templates');
    if (res.code === 1 && res.data) setTemplates(res.data);
    setLoading(false);
  }
// PLACEHOLDER_FEE_TEMPLATES_ACTIONS

  function openCreate() {
    setEditing(null);
    setForm({ name: '', type: 'shipping', fee: '0', description: '', isDefault: false });
    setShowDialog(true);
  }

  function openEdit(t: FeeTemplate) {
    setEditing(t);
    setForm({ name: t.name, type: t.type, fee: t.fee, description: t.description || '', isDefault: t.isDefault });
    setShowDialog(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast({ title: '请输入模板名称', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = { ...form, fee: parseFloat(form.fee) || 0 };
    const res = editing
      ? await api.put(`/api/admin/fee-templates/${editing.id}`, payload)
      : await api.post('/api/admin/fee-templates', payload);
    setSaving(false);
    if (res.code === 1) { toast({ title: editing ? '更新成功' : '创建成功' }); setShowDialog(false); fetchTemplates(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除该模板？')) return;
    const res = await api.delete(`/api/admin/fee-templates/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchTemplates(); }
    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">费用模板管理</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增模板</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm text-muted-foreground">管理打包费、快递费等费用模板，设为默认后出库时自动应用</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : templates.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无模板，点击上方按钮创建</p>
          ) : (
            <div className="space-y-2">
              {templates.filter((t) => t.isActive).map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="flex-1">
                    <span className="font-medium">{t.name}</span>
                    {t.description && <span className="text-sm text-muted-foreground ml-2">{t.description}</span>}
                  </div>
                  <Badge variant="secondary">{typeLabel(t.type)}</Badge>
                  <span className="text-sm font-mono font-medium">{parseFloat(t.fee) > 0 ? `¥${t.fee}` : '免费'}</span>
                  {t.isDefault && <Badge variant="default" className="gap-1"><Check className="h-3 w-3" />默认</Badge>}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? '编辑模板' : '新增模板'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>模板名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：标准打包费" />
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>费用 (元)</Label>
              <Input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} type="number" step="0.01" min="0" />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="可选" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="h-4 w-4 rounded" />
              <span className="text-sm">设为默认（同类型仅一个默认，出库时自动应用）</span>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
