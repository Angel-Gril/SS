'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2, Plus, UserCheck, UserX, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface InviteInfo {
  canInvite: boolean;
  inviteLimit: number;
  inviteCount: number;
  remaining: number;
  accountCode: string | null;
  isSubAccount: boolean;
}

interface InvitedAccount {
  id: string;
  phone: string;
  nickname: string | null;
  accountCode: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function SubAccountsPage() {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [list, setList] = useState<InvitedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [infoRes, listRes] = await Promise.all([
      api.get<InviteInfo>('/api/invite/info'),
      api.get<InvitedAccount[]>('/api/invite/list'),
    ]);
    if (infoRes.code === 1 && infoRes.data) setInfo(infoRes.data);
    if (listRes.code === 1 && listRes.data) setList(listRes.data);
    setLoading(false);
  }

  if (loading) {
    return <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  // 二级子账号无法管理子账号
  if (info?.isSubAccount) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">子账号管理</h1>
          <p className="text-muted-foreground text-sm mt-1">分发二级子账号供下级代理使用</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Info className="h-8 w-8 mx-auto opacity-50" />
            <p className="text-sm">您当前是二级子账号，无法再次裂变</p>
            <p className="text-xs">如需管理子账号请联系主账号</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // __CONTINUE_HERE__
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">子账号管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            主账号 ID: <code className="font-mono px-1.5 py-0.5 rounded bg-muted">{info?.accountCode || '—'}</code>
            <span className="ml-3">子账号沿用 <code className="font-mono">{info?.accountCode}-N</code> 的格式</span>
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={!info?.canInvite || (info?.remaining ?? 0) <= 0}
        >
          <Plus className="h-4 w-4" /> 创建子账号
        </Button>
      </div>

      {!info?.canInvite ? (
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            您还未开通子账号裂变权限。如需开通，请联系平台管理员。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-2 text-sm">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            裂变配额：<span className="font-medium">{info.inviteCount}</span> / {info.inviteLimit}
            <span className="ml-2 text-muted-foreground">剩余 {info.remaining} 个</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">子账号列表</CardTitle></CardHeader>
        <CardContent className="p-0">
          {list.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">暂无子账号</p>
              <p className="text-xs mt-1">子账号继承主账号全部数据与功能，但不能再次裂变</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号 ID</TableHead>
                  <TableHead>昵称</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead>创建时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-sm">{u.accountCode || '—'}</TableCell>
                    <TableCell className="font-medium">{u.nickname || '—'}</TableCell>
                    <TableCell className="font-mono text-sm">{u.phone}</TableCell>
                    <TableCell>
                      {u.status === 'ACTIVE' ? (
                        <Badge variant="success" className="gap-1"><UserCheck className="h-3 w-3" />正常</Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1"><UserX className="h-3 w-3" />已停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastLoginAt ? formatDate(u.lastLoginAt) : '从未登录'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateSubDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); void load(); }}
      />
    </div>
  );
}

function CreateSubDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!/^1\d{10}$/.test(phone)) {
      toast({ title: '请输入有效的 11 位手机号', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: '密码至少 6 位', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post<{ accountCode: string }>('/api/invite/create', { phone, password, nickname });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: `子账号 ${res.data?.accountCode} 已创建` });
      setPhone(''); setPassword(''); setNickname('');
      onCreated();
    } else {
      toast({ title: res.msg || '创建失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>创建子账号</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          子账号继承主账号全部数据和功能权限，但无法再次裂变下级账号。
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">昵称</Label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="可选，默认按手机号生成" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">手机号 *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 位手机号，将作为登录账号" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">初始密码 *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !phone || !password}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
