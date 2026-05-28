'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface ServiceTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  fee: string;
  needInspection: boolean;
  isActive: boolean;
  sortOrder: number;
}

const COLORS = [
  { value: 'green', label: '绿色', class: 'bg-green-500' },
  { value: 'yellow', label: '黄色', class: 'bg-yellow-500' },
  { value: 'red', label: '红色', class: 'bg-red-500' },
  { value: 'purple', label: '紫色', class: 'bg-purple-500' },
  { value: 'blue', label: '蓝色', class: 'bg-blue-500' },
  { value: 'orange', label: '橙色', class: 'bg-orange-500' },
];

export default function ServiceTagsPage() {
  const [tags, setTags] = useState<ServiceTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<ServiceTag | null>(null);
  const [form, setForm] = useState({ name: '', color: 'green', description: '', fee: '0', needInspection: false, sortOrder: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchTags(); }, []);

  async function fetchTags() {
    setLoading(true);
    const res = await api.get<ServiceTag[]>('/api/admin/service-tags');
    if (res.code === 1 && res.data) setTags(res.data);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', color: 'green', description: '', fee: '0', needInspection: false, sortOrder: tags.length + 1 });
    setShowDialog(true);
  }

  function openEdit(tag: ServiceTag) {
    setEditing(tag);
    setForm({ name: tag.name, color: tag.color, description: tag.description || '', fee: tag.fee, needInspection: tag.needInspection, sortOrder: tag.sortOrder });
    setShowDialog(true);
  }
// PLACEHOLDER_CONTINUED

  async function handleSave() {
    if (!form.name.trim()) { toast({ title: '请输入标签名称', variant: 'destructive' }); return; }
    setSaving(true);
    const payload = { ...form, fee: parseFloat(form.fee) || 0, sortOrder: form.sortOrder || 0 };
    const res = editing
      ? await api.put(`/api/admin/service-tags/${editing.id}`, payload)
      : await api.post('/api/admin/service-tags', payload);
    setSaving(false);
    if (res.code === 1) { toast({ title: editing ? '更新成功' : '创建成功' }); setShowDialog(false); fetchTags(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  async function handleDelete(id: string) {
    const res = await api.delete(`/api/admin/service-tags/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchTags(); }
    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
  }

  const colorClass = (c: string) => COLORS.find((x) => x.value === c)?.class || 'bg-gray-400';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">服务标签设置</h1>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增标签</Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm text-muted-foreground">配置仓库服务类型和对应费用，用户下单时可选择</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tags.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无标签，点击上方按钮创建</p>
          ) : (
            <div className="space-y-2">
              {tags.filter((t) => t.isActive).map((tag) => (
                <div key={tag.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className={`w-4 h-4 rounded-full ${colorClass(tag.color)}`} />
                  <div className="flex-1">
                    <span className="font-medium">{tag.name}</span>
                    {tag.description && <span className="text-sm text-muted-foreground ml-2">{tag.description}</span>}
                  </div>
                  <span className="text-sm font-mono">{parseFloat(tag.fee) > 0 ? `¥${tag.fee}` : '免费'}</span>
                  {tag.needInspection && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">需验视</span>}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(tag)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(tag.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? '编辑标签' : '新增标签'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>标签名称 *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：拆包验视" />
            </div>
            <div className="space-y-2">
              <Label>颜色</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button key={c.value} onClick={() => setForm({ ...form, color: c.value })}
                    className={`w-8 h-8 rounded-full ${c.class} ${form.color === c.value ? 'ring-2 ring-offset-2 ring-primary' : 'opacity-60 hover:opacity-100'}`} />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="可选" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>服务费 (元)</Label>
                <Input value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} type="number" />
              </div>
              <div className="space-y-2">
                <Label>排序</Label>
                <Input value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} type="number" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.needInspection} onChange={(e) => setForm({ ...form, needInspection: e.target.checked })} className="h-4 w-4 rounded" />
              <span className="text-sm">需要验视流程（入库后需验视通过才能出库）</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
