'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Search, Pencil, KeyRound, Ban, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface UserRow {
  id: string;
  phone: string;
  nickname: string | null;
  accountCode: string | null;
  role: string;
  status: string;
  canInvite: boolean;
  inviteLimit: number;
  inviteCount: number;
  parentId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  tenantType?: string;
  perOrderFee?: string | null;
  customColorEnabled?: boolean;
  canPublishAddress?: boolean;
}

const ROLE_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  ADMIN: { label: '管理员', variant: 'default' },
  USER: { label: '用户', variant: 'secondary' },
  STAFF: { label: '员工', variant: 'secondary' },
};

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  ACTIVE: { label: '正常', variant: 'default' },
  SUSPENDED: { label: '已禁用', variant: 'destructive' },
  PENDING: { label: '待激活', variant: 'secondary' },
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const limit = 20;
// PLACEHOLDER_USERS_PAGE_BODY

  async function loadUsers() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: UserRow[] }>(`/api/admin/users?${params}`);
    if (res.code === 1 && res.data) {
      setUsers(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, [page]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    loadUsers();
  }

  async function toggleStatus(user: UserRow) {
    const newStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const res = await api.put(`/api/admin/users/${user.id}`, { status: newStatus });
    if (res.code === 1) { toast({ title: newStatus === 'ACTIVE' ? '已启用' : '已禁用' }); loadUsers(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground mt-1">管理系统用户、角色分配和裂变权限</p>
        </div>
        <Button onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" />创建用户</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">用户列表</CardTitle>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索手机号/昵称" className="w-48" />
            <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
          </form>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">暂无数据</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>昵称</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>裂变</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-sm tabular-nums">{u.accountCode || '-'}</TableCell>
                    <TableCell className="font-medium">{u.nickname || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{u.phone}</TableCell>
                    <TableCell><Badge variant={ROLE_MAP[u.role]?.variant || 'secondary'}>{ROLE_MAP[u.role]?.label || u.role}</Badge></TableCell>
                    <TableCell><Badge variant={STATUS_MAP[u.status]?.variant || 'secondary'}>{STATUS_MAP[u.status]?.label || u.status}</Badge></TableCell>
                    <TableCell className="text-sm">{u.canInvite ? `${u.inviteCount}/${u.inviteLimit}` : '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditTarget(u)} title="编辑"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetTarget(u)} title="重置密码"><KeyRound className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleStatus(u)} title={u.status === 'ACTIVE' ? '禁用' : '启用'}>
                          {u.status === 'ACTIVE' ? <Ban className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle className="h-3.5 w-3.5 text-green-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一页</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && <CreateUserDialog onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); loadUsers(); }} />}
      {editTarget && <EditUserDialog user={editTarget} onClose={() => setEditTarget(null)} onSuccess={() => { setEditTarget(null); loadUsers(); }} />}
      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} onSuccess={() => { setResetTarget(null); }} />}
    </div>
  );
}
// PLACEHOLDER_DIALOGS_SECTION

function CreateUserDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ phone: '', password: '', role: 'USER', nickname: '', canInvite: false, inviteLimit: 0 });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.phone || !form.password) { toast({ title: '请填写手机号和密码', variant: 'destructive' }); return; }
    setSubmitting(true);
    const res = await api.post('/api/admin/users', { ...form, inviteLimit: form.canInvite ? form.inviteLimit : 0 });
    setSubmitting(false);
    if (res.code === 1) { toast({ title: '创建成功' }); onSuccess(); }
    else toast({ title: res.msg || '创建失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>创建用户</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>手机号 *</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="11位手机号" maxLength={11} required />
            </div>
            <div className="space-y-2">
              <Label>密码 *</Label>
              <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} type="password" placeholder="至少6位" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>角色</Label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="USER">用户</option>
                <option value="STAFF">员工</option>
                <option value="ADMIN">管理员</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} placeholder="可选" />
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.canInvite} onChange={(e) => setForm({ ...form, canInvite: e.target.checked })} className="h-4 w-4 rounded" />
              <span className="text-sm">允许裂变</span>
            </label>
            {form.canInvite && (
              <div className="space-y-2">
                <Label>裂变上限</Label>
                <Input value={form.inviteLimit} onChange={(e) => setForm({ ...form, inviteLimit: parseInt(e.target.value) || 0 })} type="number" min="0" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '创建'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose, onSuccess }: { user: UserRow; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    role: user.role,
    nickname: user.nickname || '',
    canInvite: user.canInvite,
    inviteLimit: user.inviteLimit,
    tenantType: user.tenantType || 'transit',
    perOrderFee: user.perOrderFee || '',
    customColorEnabled: user.customColorEnabled || false,
    canPublishAddress: user.canPublishAddress || false,
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const payload: any = {
      role: form.role,
      nickname: form.nickname,
      canInvite: form.canInvite,
      inviteLimit: form.canInvite ? form.inviteLimit : 0,
      tenantType: form.tenantType,
      customColorEnabled: form.customColorEnabled,
      canPublishAddress: form.canPublishAddress,
      // "自建仓主授权" 隐含 isTransitProvider；两者同步切换
      isTransitProvider: form.canPublishAddress,
    };
    if (form.tenantType === 'solo') {
      payload.perOrderFee = parseFloat(form.perOrderFee || '0') || 0;
    } else {
      payload.perOrderFee = null;
    }
    const res = await api.put(`/api/admin/users/${user.id}`, payload);
    setSubmitting(false);
    if (res.code === 1) { toast({ title: '更新成功' }); onSuccess(); }
    else toast({ title: res.msg || '更新失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>编辑用户 - {user.nickname || user.phone}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>角色</Label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="USER">用户</option>
                <option value="STAFF">员工</option>
                <option value="ADMIN">管理员</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>昵称</Label>
              <Input value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.canInvite} onChange={(e) => setForm({ ...form, canInvite: e.target.checked })} className="h-4 w-4 rounded" />
              <span className="text-sm">允许裂变</span>
            </label>
            {form.canInvite && (
              <div className="space-y-2">
                <Label>裂变上限</Label>
                <Input value={form.inviteLimit} onChange={(e) => setForm({ ...form, inviteLimit: parseInt(e.target.value) || 0 })} type="number" min="0" />
              </div>
            )}
          </div>

          <div className="space-y-3 pt-3 border-t">
            <div className="text-sm font-medium text-muted-foreground">用户类型与计费</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>用户类型</Label>
                <select
                  value={form.tenantType}
                  onChange={(e) => setForm({ ...form, tenantType: e.target.value })}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="transit">中转用户（走平台仓）</option>
                  <option value="solo">个人卖家（自打包/自发）</option>
                </select>
              </div>
              {form.tenantType === 'solo' && (
                <div className="space-y-2">
                  <Label>每单服务费 (元)</Label>
                  <Input
                    value={form.perOrderFee}
                    onChange={(e) => setForm({ ...form, perOrderFee: e.target.value })}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="如：1.50"
                  />
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.customColorEnabled}
                onChange={(e) => setForm({ ...form, customColorEnabled: e.target.checked })}
                className="h-4 w-4 rounded"
              />
              <span className="text-sm">允许自定义颜色标签（个人可见，不影响平台流水）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.canPublishAddress}
                onChange={(e) => setForm({ ...form, canPublishAddress: e.target.checked })}
                className="h-4 w-4 rounded"
              />
              <span className="text-sm">允许向下线发布国内中转仓地址（自建仓主授权）</span>
            </label>
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

function ResetPasswordDialog({ user, onClose, onSuccess }: { user: UserRow; onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast({ title: '密码至少6位', variant: 'destructive' }); return; }
    setSubmitting(true);
    const res = await api.post(`/api/admin/users/${user.id}/reset-password`, { password });
    setSubmitting(false);
    if (res.code === 1) { toast({ title: '密码已重置' }); onSuccess(); }
    else toast({ title: res.msg || '重置失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>重置密码 - {user.nickname || user.phone}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>新密码</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="至少6位" required minLength={6} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '确认重置'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
