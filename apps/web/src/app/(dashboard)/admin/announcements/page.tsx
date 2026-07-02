'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { RichTextEditor } from '@/components/rich-text-editor';
import { AnnouncementAttachments, type Attachment } from '@/components/announcement-attachments';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'NOTICE' | 'UPDATE' | 'ALERT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  targetRole: 'ALL' | 'USER' | 'ADMIN' | 'STAFF';
  attachments?: { name: string; url: string; size?: number }[] | null;
  forcePopup: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  creator?: { nickname: string | null };
  _count?: { reads: number };
}

interface FormState {
  title: string;
  content: string;
  type: 'NOTICE' | 'UPDATE' | 'ALERT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  targetRole: 'ALL' | 'USER' | 'ADMIN' | 'STAFF';
  forcePopup: boolean;
  expiresAt: string;
  attachments: Attachment[];
}

const emptyForm: FormState = {
  title: '',
  content: '',
  type: 'NOTICE',
  priority: 'NORMAL',
  targetRole: 'ALL',
  forcePopup: false,
  expiresAt: '',
  attachments: [],
};

export default function AdminAnnouncementsPage() {
  const systemDialog = useSystemDialog();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    const res = await api.get<{ items: Announcement[]; total: number }>('/api/announcements/admin/list');
    if (res.code === 1 && res.data) setItems(res.data.items);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(item: Announcement) {
    setEditing(item);
    setForm({
      title: item.title,
      content: item.content,
      type: item.type,
      priority: item.priority,
      targetRole: item.targetRole,
      forcePopup: item.forcePopup,
      expiresAt: item.expiresAt ? item.expiresAt.slice(0, 16) : '',
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
    });
    setShowForm(true);
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.content.trim()) {
      toast({ title: '标题和内容不能为空', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      };
      const res = editing
        ? await api.patch(`/api/announcements/admin/${editing.id}`, payload)
        : await api.post('/api/announcements/admin/create', payload);
      if (res.code === 1) {
        toast({ title: editing ? '已更新' : '已发布' });
        setShowForm(false);
        fetchData();
      } else {
        toast({ title: res.msg || '操作失败', variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await systemDialog.confirm({
      title: '删除公告',
      message: '确认删除该公告？已读记录会一并删除。',
      confirmText: '删除',
      tone: 'destructive',
    });
    if (!confirmed) return;
    const res = await api.delete(`/api/announcements/admin/${id}`);
    if (res.code === 1) {
      toast({ title: '已删除' });
      fetchData();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">公告管理</h1>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> 新建公告
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">暂无公告</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">{item.title}</span>
                    <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                    <Badge variant="outline" className="text-[10px]">{item.priority}</Badge>
                    <Badge variant="outline" className="text-[10px]">{item.targetRole}</Badge>
                    {item.forcePopup && <Badge variant="default" className="text-[10px]">强制弹窗</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    <span>发布于 {item.publishedAt ? formatDate(item.publishedAt) : '草稿'}</span>
                    {item.expiresAt && <span>过期 {formatDate(item.expiresAt)}</span>}
                    <span>已读 {item._count?.reads || 0}</span>
                    <span>{item.creator?.nickname || '系统'}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑公告' : '新建公告'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>标题</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
            </div>
            <div>
              <Label>内容</Label>
              <RichTextEditor
                value={form.content}
                onChange={(html) => setForm({ ...form, content: html })}
                placeholder="支持加粗、列表、链接、图片粘贴等富文本格式"
                minHeight={240}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>类型</Label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="NOTICE">通知</option>
                  <option value="UPDATE">更新</option>
                  <option value="ALERT">警告</option>
                </select>
              </div>
              <div>
                <Label>优先级</Label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="NORMAL">普通</option>
                  <option value="IMPORTANT">重要</option>
                  <option value="CRITICAL">紧急</option>
                </select>
              </div>
              <div>
                <Label>目标角色</Label>
                <select value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value as any })}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="ALL">全部</option>
                  <option value="USER">用户</option>
                  <option value="ADMIN">管理员</option>
                  <option value="STAFF">仓库员</option>
                </select>
              </div>
            </div>
            <div>
              <Label>过期时间（可选）</Label>
              <Input type="datetime-local" value={form.expiresAt}
                     onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </div>
            <AnnouncementAttachments
              value={form.attachments}
              onChange={(next) => setForm({ ...form, attachments: next })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.forcePopup}
                     onChange={(e) => setForm({ ...form, forcePopup: e.target.checked })} />
              强制弹窗（用户登录后必须阅读才能关闭）
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? '处理中...' : (editing ? '更新' : '发布')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
