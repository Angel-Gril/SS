'use client';

import { useEffect, useState } from 'react';
import { Loader2, Package, Truck, CheckCircle2, DollarSign, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface ProviderOrder {
  id: string;
  postingNumber: string;
  status: string;
  items: any[];
  totalAmount: string;
  domesticTrackingNumber: string | null;
  domesticStatus: string | null;
  inspectionStatus: string | null;
  createdAt: string;
  shop: { name: string; userId: string };
}

export default function ProviderWarehousePage() {
  const [orders, setOrders] = useState<ProviderOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'inspection' | 'shipped'>('pending');
  const [billingId, setBillingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const statusMap = { pending: 'awaiting_packaging', inspection: 'inspection', shipped: 'delivering' };
    const res = await api.get<{ total: number; rows: ProviderOrder[] }>(
      `/api/provider/warehouse/orders?status=${statusMap[tab]}&limit=50`
    );
    if (res.code === 1 && res.data) setOrders(res.data.rows || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [tab]);

  async function handleBill(orderId: string) {
    if (!confirm('确认对该订单计费？将扣除子用户余额并记入您的收入')) return;
    setBillingId(orderId);
    const res = await api.post<{ clientFee: number; platformCut: number; providerIncome: number }>(
      '/api/provider/warehouse/bill-order',
      { orderId }
    );
    setBillingId(null);
    if (res.code === 1 && res.data) {
      toast({ title: `计费完成：收入 ¥${res.data.providerIncome}（扣平台 ¥${res.data.platformCut}）` });
      load();
    } else {
      toast({ title: res.msg || '计费失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">代理仓库端</h1>
          <p className="text-muted-foreground mt-1">处理子用户订单的入库、验视、出库与计费</p>
        </div>
        <Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />刷新</Button>
      </div>

      <div className="flex gap-2">
        {(['pending', 'inspection', 'shipped'] as const).map((t) => (
          <Button key={t} variant={tab === t ? 'default' : 'outline'} size="sm" onClick={() => setTab(t)}>
            {t === 'pending' && <Package className="h-3.5 w-3.5 mr-1" />}
            {t === 'inspection' && <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
            {t === 'shipped' && <Truck className="h-3.5 w-3.5 mr-1" />}
            {t === 'pending' ? '待打包' : t === 'inspection' ? '待验视' : '已发出'}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">订单列表（{orders.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : orders.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">暂无订单</p>
          ) : (
            <div className="space-y-2">
              {orders.map((o) => (
                <div key={o.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{o.postingNumber}</span>
                      <Badge variant="secondary">{o.status}</Badge>
                      {o.inspectionStatus && <Badge variant="outline">{o.inspectionStatus}</Badge>}
                      <span className="text-xs text-muted-foreground">店铺: {o.shop.name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                      <span>{(o.items as any[])?.length || 0} 件</span>
                      <span>¥{o.totalAmount}</span>
                      {o.domesticTrackingNumber && <span>国内单号: {o.domesticTrackingNumber}</span>}
                      <span>{new Date(o.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBill(o.id)}
                    disabled={billingId === o.id}
                  >
                    {billingId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><DollarSign className="h-3.5 w-3.5 mr-1" />计费</>}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
