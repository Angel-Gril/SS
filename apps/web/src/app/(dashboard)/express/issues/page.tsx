'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Search, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Shop { id: string; name: string; platform: string; }
interface Issue {
  id: string;
  shopId: string;
  postingNumber: string | null;
  trackingNumber: string | null;
  type: string;
  status: string;
  title: string;
  description: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  shop: { name: string; platform: string };
}

const TYPE_LABELS: Record<string, string> = {
  lost: '丢件', damaged: '破损', delayed: '延误', wrong_item: '错发', other: '其他',
};
const STATUS_LABELS: Record<string, { label: string; variant: 'warning' | 'default' | 'success' | 'secondary' }> = {
  open: { label: '待处理', variant: 'warning' },
  processing: { label: '处理中', variant: 'default' },
  resolved: { label: '已解决', variant: 'success' },
  closed: { label: '已关闭', variant: 'secondary' },
};

export default function ExpressIssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const limit = 20;

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
  }, []);

  useEffect(() => { fetchData(); }, [search, page, statusFilter]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    const res = await api.get<{ total: number; rows: Issue[] }>(`/api/issues?${params}`);
    if (res.code === 1 && res.data) { setIssues(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  async function handleResolve(id: string) {
    const res = await api.put(`/api/issues/${id}`, { status: 'resolved' });
    if (res.code === 1) { toast({ title: '已标记为解决' }); fetchData(); }
    else toast({ title: res.msg, variant: 'destructive' });
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">异常件处理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理快递丢件、破损、延误等异常问题</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> 新建异常
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="processing">处理中</option>
              <option value="resolved">已解决</option>
              <option value="closed">已关闭</option>
            </select>
            <form className="flex gap-2 flex-1 max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索标题 / 单号" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="h-9" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>关联单号</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : issues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    暂无异常件记录。点击右上角"新建异常"添加。
                  </TableCell>
                </TableRow>
              ) : issues.map((issue) => {
                const st = STATUS_LABELS[issue.status] || { label: issue.status, variant: 'secondary' as const };
                return (
                  <TableRow key={issue.id}>
                    <TableCell className="font-medium text-sm max-w-xs truncate">{issue.title}</TableCell>
                    <TableCell><Badge variant="outline">{TYPE_LABELS[issue.type] || issue.type}</Badge></TableCell>
                    <TableCell className="text-sm">{issue.shop.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{issue.postingNumber || issue.trackingNumber || '-'}</TableCell>
                    <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(issue.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {(issue.status === 'open' || issue.status === 'processing') && (
                        <Button size="sm" variant="ghost" onClick={() => handleResolve(issue.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> 解决
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateIssueDialog
        open={createOpen}
        shops={shops}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); fetchData(); }}
      />
    </div>
  );
}

function CreateIssueDialog({ open, shops, onClose, onCreated }: {
  open: boolean;
  shops: Shop[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [shopId, setShopId] = useState('');
  const [type, setType] = useState('lost');
  const [title, setTitle] = useState('');
  const [postingNumber, setPostingNumber] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && shops.length > 0 && !shopId) setShopId(shops[0]!.id);
  }, [open, shops]);

  async function handleSubmit() {
    if (!shopId || !title) {
      toast({ title: '请填写必填项', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post('/api/issues', {
      shopId, type, title,
      postingNumber: postingNumber || undefined,
      description: description || undefined,
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '异常件已创建' });
      setTitle(''); setPostingNumber(''); setDescription('');
      onCreated();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>新建异常件</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">店铺 *</Label>
              <select value={shopId} onChange={(e) => setShopId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {shops.map((s) => <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">类型 *</Label>
              <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="lost">丢件</option>
                <option value="damaged">破损</option>
                <option value="delayed">延误</option>
                <option value="wrong_item">错发</option>
                <option value="other">其他</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">标题 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="简要描述问题" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">关联单号</Label>
            <Input value={postingNumber} onChange={(e) => setPostingNumber(e.target.value)} placeholder="订单号或物流单号" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">详细描述</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="详细说明异常情况..."
              className="w-full h-20 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !title || !shopId}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
