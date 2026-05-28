'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, UserPlus, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface ClientRow {
  id: string;
  providerId: string;
  clientId: string;
  status: string;
  feeOverride: string | null;
  createdAt: string;
  client: { phone: string; nickname: string | null; status: string } | null;
}

export default function ProviderPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<ClientRow[]>([]);

  async function load() {
    setLoading(true);
    const res = await api.get<ClientRow[]>('/api/provider/clients');
    if (res.code === 1 && res.data) {
      setClients(res.data.filter((c) => c.status === 'active'));
      setPendingInvites(res.data.filter((c) => c.status === 'pending'));
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">代理管理</h1>
          <p className="text-muted-foreground mt-1">管理子用户、设置费率、查看代理收入</p>
        </div>
        <Button onClick={() => setShowInvite(true)}><UserPlus className="h-4 w-4 mr-1" />邀请子用户</Button>
      </div>

      {pendingInvites.length > 0 && (
        <Card className="border-orange-200">
          <CardHeader><CardTitle className="text-base text-orange-700">待接受邀请（{pendingInvites.length}）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pendingInvites.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded border">
                <Badge variant="secondary">待接受</Badge>
                <span className="text-sm">{c.client?.nickname || c.client?.phone || c.clientId}</span>
                <span className="text-xs text-muted-foreground ml-auto">{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">子用户列表（{clients.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : clients.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无子用户</p>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  <div className="flex-1">
                    <span className="font-medium">{c.client?.nickname || c.client?.phone || c.clientId}</span>
                    {c.feeOverride && <span className="text-sm text-orange-600 ml-2">费率: ¥{c.feeOverride}/单</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showInvite && <InviteDialog onClose={() => setShowInvite(false)} onSuccess={() => { setShowInvite(false); load(); }} />}
    </div>
  );
}

function InviteDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [userId, setUserId] = useState('');
  const [fee, setFee] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) { toast({ title: '请输入用户 ID', variant: 'destructive' }); return; }
    setSubmitting(true);
    const res = await api.post('/api/provider/clients/invite', {
      clientUserId: userId.trim(),
      feeOverride: fee ? parseFloat(fee) : undefined,
    });
    setSubmitting(false);
    if (res.code === 1) { toast({ title: '邀请已发送' }); onSuccess(); }
    else toast({ title: res.msg || '邀请失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>邀请子用户</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>用户 ID *</Label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="目标用户的 ID" required />
          </div>
          <div className="space-y-2">
            <Label>自定义费率（可选，留空使用默认）</Label>
            <Input value={fee} onChange={(e) => setFee(e.target.value)} type="number" step="0.01" min="0" placeholder="如：2.50" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '发送邀请'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
