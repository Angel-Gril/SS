'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface InspectionOrder {
  id: string;
  postingNumber: string | null;
  platformOrderId: string;
  domesticTrackingNumber: string | null;
  domesticCarrier: string | null;
  items: any[] | null;
  serviceTags: string[] | null;
  serviceFee: string | null;
  createdAt: string;
  updatedAt: string;
  shop: { name: string };
}

export default function InspectionPage() {
  const [orders, setOrders] = useState<InspectionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchQueue(); }, []);

  async function fetchQueue() {
    setLoading(true);
    const res = await api.get<InspectionOrder[]>('/api/warehouse/inspection-queue');
    if (res.code === 1 && res.data) setOrders(res.data);
    setLoading(false);
  }

  async function handleInspection(orderId: string, status: 'passed' | 'failed') {
    setSubmitting(true);
    const res = await api.post('/api/warehouse/inspection', { orderId, status, note: note || undefined });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: res.msg });
      setActiveId(null);
      setNote('');
      fetchQueue();
    } else {
      toast({ title: res.msg || '操作失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">验视处理</h1>
        <Badge variant="secondary" className="text-base px-3 py-1">待验视: {orders.length}</Badge>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : orders.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground text-lg">暂无待验视包裹</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.id} className={activeId === order.id ? 'ring-2 ring-primary' : ''}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{order.postingNumber || order.platformOrderId}</span>
                      <Badge variant="outline">{order.shop.name}</Badge>
                    </div>
                    {order.domesticTrackingNumber && (
                      <p className="text-sm text-muted-foreground">国内单号: {order.domesticCarrier} {order.domesticTrackingNumber}</p>
                    )}
                    {order.items && (
                      <p className="text-sm">{(order.items as any[]).map((i: any) => i.name || i.offer_id).join(', ')}</p>
                    )}
                  </div>
                  <Button size="sm" variant={activeId === order.id ? 'secondary' : 'outline'} onClick={() => setActiveId(activeId === order.id ? null : order.id)}>
                    <Camera className="h-4 w-4 mr-1" />验视
                  </Button>
                </div>

                {activeId === order.id && (
                  <div className="mt-4 pt-4 border-t space-y-3">
                    <Input placeholder="验视备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" />
                    <div className="flex gap-3">
                      <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={submitting} onClick={() => handleInspection(order.id, 'passed')}>
                        <CheckCircle className="h-4 w-4 mr-1" />验视通过
                      </Button>
                      <Button className="flex-1" variant="destructive" disabled={submitting} onClick={() => handleInspection(order.id, 'failed')}>
                        <XCircle className="h-4 w-4 mr-1" />验视不通过
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
