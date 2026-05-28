'use client';

import { useState } from 'react';
import { ScanLine, Package, Printer, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface ScannedOrder {
  id: string;
  postingNumber: string;
  items: any[];
  status: string;
  shop: { name: string };
}

export default function ScanShipPage() {
  const [barcode, setBarcode] = useState('');
  const [scannedOrders, setScannedOrders] = useState<ScannedOrder[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!barcode.trim()) return;
    setLoading(true);

    const res = await api.get<{ total: number; rows: ScannedOrder[] }>(
      `/api/orders?search=${encodeURIComponent(barcode.trim())}&limit=1`
    );

    if (res.code === 1 && res.data?.rows.length) {
      const order = res.data.rows[0]!;
      if (!scannedOrders.find((o) => o.id === order.id)) {
        setScannedOrders((prev) => [order, ...prev]);
        toast({ title: '扫码成功', description: `订单 ${order.postingNumber} 已添加` });
      } else {
        toast({ title: '重复扫码', description: '该订单已在列表中', variant: 'destructive' });
      }
    } else {
      toast({ title: '未找到订单', description: `单号 ${barcode} 无匹配`, variant: 'destructive' });
    }

    setBarcode('');
    setLoading(false);
  }

  async function handleBatchPrint() {
    if (scannedOrders.length === 0) return;
    toast({ title: '打印任务已提交', description: `${scannedOrders.length} 个面单正在生成` });
  }

  async function handleBatchShip() {
    if (scannedOrders.length === 0) return;
    const ids = scannedOrders.map((o) => o.id);
    const res = await api.post<any>('/api/orders/batch-ship', { orderIds: ids });
    if (res.code === 1) {
      toast({ title: '批量发货成功', description: res.msg });
      setScannedOrders([]);
    } else {
      toast({ title: '发货失败', description: res.msg, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">扫码打单</h1>
        <p className="text-muted-foreground text-sm mt-1">扫描包裹条码，快速打印面单并发货</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-5 w-5" /> 扫码输入
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleScan} className="flex gap-3">
            <Input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="扫描或输入包裹号/订单号/物流单号"
              className="flex-1 text-lg h-12"
              autoFocus
            />
            <Button type="submit" size="lg" disabled={loading}>
              <ScanLine className="mr-2 h-5 w-5" /> 确认
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">已扫描 {scannedOrders.length} 单</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBatchPrint} disabled={scannedOrders.length === 0}>
            <Printer className="mr-2 h-4 w-4" /> 批量打印面单
          </Button>
          <Button onClick={handleBatchShip} disabled={scannedOrders.length === 0}>
            <Package className="mr-2 h-4 w-4" /> 批量发货
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {scannedOrders.map((order) => (
          <Card key={order.id}>
            <CardContent className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <p className="font-mono text-sm font-medium">{order.postingNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {order.shop?.name} · {Array.isArray(order.items) ? `${order.items.length} 件商品` : ''}
                  </p>
                </div>
              </div>
              <Badge>{order.status === 'awaiting_packaging' ? '待打包' : order.status === 'awaiting_deliver' ? '待发货' : order.status}</Badge>
            </CardContent>
          </Card>
        ))}
        {scannedOrders.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <ScanLine className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>扫描条码开始操作</p>
          </div>
        )}
      </div>
    </div>
  );
}
