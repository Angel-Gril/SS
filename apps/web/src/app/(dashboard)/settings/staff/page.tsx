'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Staff {
  id: string;
  phone: string;
  nickname: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { fetchStaff(); }, []);

  async function fetchStaff() {
    setLoading(true);
    const res = await api.get<Staff[]>('/api/staff');
    if (res.code === 1 && res.data) setStaff(res.data);
    setLoading(false);
  }

  async function toggleStatus(id: string, current: string) {
    const newStatus = current === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await api.put(`/api/staff/${id}`, { status: newStatus });
    if (res.code === 1) { toast({ title: '已更新' }); fetchStaff(); }
    else toast({ title: res.msg, variant: 'destructive' });
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除该员工账号？此操作不可恢复。')) return;
    const res = await api.delete(`/api/staff/${id}`);
    if (res.code === 1) { toast({ title: '已删除' }); fetchStaff(); }
    else toast({ title: res.msg, variant: 'destructive' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">员工管理</h1>
          <p className="text-muted-foreground text-sm mt-1">添加和管理子账号，员工可使用独立账号登录系统</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> 添加员工
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : staff.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              暂无员工账号。点击"添加员工"创建子账号。
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>昵称</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.nickname || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{s.phone}</TableCell>
                    <TableCell><Badge variant="outline">员工</Badge></TableCell>
                    <TableCell>
                      {s.status === 'ACTIVE' ? (
                        <Badge variant="success">正常</Badge>
                      ) : (
                        <Badge variant="destructive">已停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.lastLoginAt ? formatDate(s.lastLoginAt) : '从未登录'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title={s.status === 'ACTIVE' ? '停用' : '启用'}
                          onClick={() => toggleStatus(s.id, s.status)}
                        >
                          {s.status === 'ACTIVE' ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(s.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateStaffDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); fetchStaff(); }} />
    </div>
  );
}

function CreateStaffDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!phone || !password || !nickname) {
      toast({ title: '请填写所有字段', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.post('/api/staff', { phone, password, nickname });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '员工账号已创建' });
      setPhone(''); setPassword(''); setNickname('');
      onCreated();
    } else {
      toast({ title: res.msg, variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>添加员工</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">昵称 *</Label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="员工姓名" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">手机号 *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="用于登录的手机号" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">密码 *</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少6位" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !phone || !password || !nickname}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
