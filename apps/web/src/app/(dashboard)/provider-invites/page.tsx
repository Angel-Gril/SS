'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, X, Mailbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface InviteRow {
  id: string;
  providerId: string;
  feeOverride: string | null;
  createdAt: string;
  provider: {
    id: string;
    phone: string;
    nickname: string | null;
    accountCode: string | null;
    providerFee: string | null;
  } | null;
}

export default function ProviderInvitesPage() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await api.get<InviteRow[]>('/api/provider/invites');
    if (res.code === 1 && res.data) setInvites(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleAccept(id: string) {
    if (!confirm('接受邀请后，您的订单将由该代理打包发货并按其费率扣费。是否确认？')) return;
    setActingId(id);
    const res = await api.post(`/api/provider/clients/${id}/accept`);
    setActingId(null);
    if (res.code === 1) { toast({ title: '已接受邀请' }); void load(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  async function handleReject(id: string) {
    if (!confirm('拒绝邀请后，对方将无法再次邀请您。是否确认？')) return;
    setActingId(id);
    const res = await api.post(`/api/provider/clients/${id}/reject`);
    setActingId(null);
    if (res.code === 1) { toast({ title: '已拒绝邀请' }); void load(); }
    else toast({ title: res.msg || '操作失败', variant: 'destructive' });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">代理邀请</h1>
        <p className="text-muted-foreground text-sm mt-1">
          自建仓主邀请您加入其代理网络。接受后，您的订单将由代理仓打包发货，并按代理费率扣费。
        </p>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
      ) : invites.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <Mailbox className="h-8 w-8 mx-auto opacity-50" />
            <p className="text-sm">暂无待处理的代理邀请</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">待处理邀请（{invites.length}）</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {invites.map((inv) => {
              const fee = inv.feeOverride ?? inv.provider?.providerFee ?? '2.00';
              return (
                <div key={inv.id} className="flex items-center gap-4 p-4 border rounded-lg">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{inv.provider?.nickname || inv.provider?.phone || '未知用户'}</span>
                      {inv.provider?.accountCode && (
                        <Badge variant="outline" className="font-mono text-[10px]">{inv.provider.accountCode}</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      代理费率：<span className="text-foreground font-medium">¥{fee}</span> / 单
                      {inv.feeOverride && <span className="ml-2 text-orange-600 text-xs">（专属费率）</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      邀请时间：{formatDate(inv.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(inv.id)}
                      disabled={actingId === inv.id}
                    >
                      <X className="h-4 w-4" /> 拒绝
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAccept(inv.id)}
                      disabled={actingId === inv.id}
                    >
                      {actingId === inv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      接受
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
