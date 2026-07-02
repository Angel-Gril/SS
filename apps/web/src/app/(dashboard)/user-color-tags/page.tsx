'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface UserTag {
  id: string;
  name: string;
  color: string;
  description: string | null;
  sortOrder: number;
}

interface MyProfile {
  customColorEnabled: boolean;
}

const PRESET_COLORS = [
  '#ea580c', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#ef4444', '#64748b',
];

export default function UserColorTagsPage() {
  const systemDialog = useSystemDialog();
  const [tags, setTags] = useState<UserTag[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserTag | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  async function load() {
    setLoading(true);
    const [profileRes, tagsRes] = await Promise.all([
      api.get<MyProfile>('/api/user/me'),
      api.get<UserTag[]>('/api/user-service-tags'),
    ]);
    if (profileRes.code === 1 && profileRes.data) {
      setEnabled(profileRes.data.customColorEnabled !== false);
    }
    if (tagsRes.code === 1 && tagsRes.data) setTags(tagsRes.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setShowDialog(true);
  }
  function openEdit(t: UserTag) {
    setEditing(t);
    setShowDialog(true);
  }
  async function handleDelete(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '删除颜色标签',
      message: '确认删除该标签？',
      confirmText: '删除',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.delete(`/api/user-service-tags/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); load(); }
    else toast({ title: res.msg || '删除失败', variant: 'destructive' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">我的颜色标签</h1>
          <p className="text-muted-foreground mt-1">仅自己可见的订单标签，用于个人订单分类管理</p>
        </div>
        {enabled && <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增标签</Button>}
      </div>

      {!enabled && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-orange-600 shrink-0" />
            <div className="text-sm">
              <div className="font-medium">未开通自定义颜色权限</div>
              <div className="text-muted-foreground mt-0.5">请联系管理员为您的账号开通"允许自定义颜色标签"权限</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">标签列表（{tags.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tags.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">{enabled ? '暂无标签，点击上方按钮创建' : '暂无标签'}</p>
          ) : (
            <div className="space-y-2">
              {tags.map((t) => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="w-5 h-5 rounded-full shrink-0 border" style={{ backgroundColor: t.color }} />
                  <div className="flex-1">
                    <span className="font-medium">{t.name}</span>
                    {t.description && <span className="text-sm text-muted-foreground ml-2">{t.description}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{t.color}</span>
                  {enabled && (
                    <>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showDialog && (
        <TagDialog
          tag={editing}
          onClose={() => setShowDialog(false)}
          onSuccess={() => { setShowDialog(false); load(); }}
        />
      )}
    </div>
  );
}

function TagDialog({ tag, onClose, onSuccess }: { tag: UserTag | null; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    name: tag?.name || '',
    color: tag?.color || PRESET_COLORS[0]!,
    description: tag?.description || '',
    sortOrder: tag?.sortOrder ?? 0,
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast({ title: '请输入标签名称', variant: 'destructive' }); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(form.color)) { toast({ title: '颜色格式错误（需 #RRGGBB）', variant: 'destructive' }); return; }
    setSubmitting(true);
    const res = tag
      ? await api.put(`/api/user-service-tags/${tag.id}`, form)
      : await api.post('/api/user-service-tags', form);
    setSubmitting(false);
    if (res.code === 1) { toast({ title: tag ? '已更新' : '已创建' }); onSuccess(); }
    else toast({ title: res.msg || '保存失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{tag ? '编辑标签' : '新增标签'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>标签名称 *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={20} required />
          </div>
          <div className="space-y-2">
            <Label>颜色 *</Label>
            <div className="grid grid-cols-8 gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`w-9 h-9 rounded-md border-2 transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-orange-500 scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="#RRGGBB" className="font-mono" />
          </div>
          <div className="space-y-2">
            <Label>描述（可选）</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>排序</Label>
            <Input value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} type="number" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
