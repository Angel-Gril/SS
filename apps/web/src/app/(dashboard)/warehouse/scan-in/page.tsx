'use client';

import { useState } from 'react';
import { ScanLine, CheckCircle2, XCircle, Package, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useScannerInput, playBeep } from '@/lib/scanner';

interface ScanResult {
  id: string;
  postingNumber: string;
  platformOrderId: string;
  domesticTrackingNumber: string;
  domesticCarrier: string;
  items: any;
  buyerInfo: any;
  shippingInfo: any;
  shop: { name: string; platform: string };
  status: string;
  scannedAt: string;
}

export default function ScanInPage() {
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; order?: ScanResult; msg?: string } | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);
  const { inputRef, isDuplicate, handlers, refocus } = useScannerInput();

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (handlers.isComposing()) return;
    const code = barcode.trim();
    if (!code) return;
    if (isDuplicate(code)) {
      setBarcode('');
      toast({ title: '重复扫描', description: '同一单号 1.5 秒内已扫描过，已忽略', variant: 'destructive' });
      playBeep('error');
      return;
    }
    setLoading(true);
    setLastResult(null);

    const res = await api.post<ScanResult>('/api/warehouse/scan-in', { trackingNumber: code });

    if (res.code === 1 && res.data) {
      const order = { ...res.data, scannedAt: new Date().toISOString() };
      setLastResult({ success: true, order });
      setHistory((prev) => [order, ...prev].slice(0, 20));
      setFlash('success');
      playBeep('success');
      toast({ title: '入库成功', description: `订单 ${order.postingNumber || order.platformOrderId} 已标记入库` });
    } else {
      setLastResult({ success: false, msg: res.msg });
      setFlash('error');
      playBeep('error');
      toast({ title: '入库失败', description: res.msg, variant: 'destructive' });
    }

    setBarcode('');
    setLoading(false);
    refocus();
    setTimeout(() => setFlash(null), 1500);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">扫码入库</h1>
        <p className="text-muted-foreground mt-1">扫描国内快递单号，自动匹配订单并标记入库</p>
      </div>

      {/* 扫码输入区 */}
      <Card className={
        flash === 'success' ? 'ring-2 ring-green-500 transition-all' :
        flash === 'error' ? 'ring-2 ring-red-500 transition-all' : 'transition-all'
      }>
        <CardContent className="pt-6">
          <form onSubmit={handleScan} className="flex gap-3">
            <Input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onCompositionStart={handlers.onCompositionStart}
              onCompositionEnd={handlers.onCompositionEnd}
              placeholder="扫描国内快递单号"
              className="flex-1 text-xl h-14 font-mono"
              autoFocus
              disabled={loading}
            />
            {loading && <Loader2 className="h-6 w-6 animate-spin self-center text-muted-foreground" />}
          </form>
        </CardContent>
      </Card>

      {/* 最近一次扫码结果 */}
      {lastResult && (
        <Card className={lastResult.success ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'}>
          <CardContent className="pt-6">
            {lastResult.success && lastResult.order ? (
              <div className="flex items-start gap-4">
                <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0 mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-green-700">入库成功</span>
                    <Badge className="bg-green-100 text-green-700">{lastResult.order.shop?.name}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">OZON 订单号：</span>
                      <span className="font-mono font-medium">{lastResult.order.postingNumber || lastResult.order.platformOrderId}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">快递单号：</span>
                      <span className="font-mono font-medium">{lastResult.order.domesticTrackingNumber}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">快递公司：</span>
                      <span>{lastResult.order.domesticCarrier || '-'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">商品数量：</span>
                      <span>{Array.isArray(lastResult.order.items) ? lastResult.order.items.length : 0} 件</span>
                    </div>
                  </div>
                  {Array.isArray(lastResult.order.items) && lastResult.order.items.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                      商品：{lastResult.order.items.map((it: any) => it.name || it.offer_id || it.sku).filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <XCircle className="h-8 w-8 text-red-500 shrink-0" />
                <div>
                  <span className="text-lg font-bold text-red-700">匹配失败</span>
                  <p className="text-sm text-red-600 mt-1">{lastResult.msg}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 今日入库记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-5 w-5" /> 今日入库记录 ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ScanLine className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg">等待扫码...</p>
              <p className="text-sm mt-1">扫描国内快递单号开始入库操作</p>
            </div>
          ) : (
            <div className="divide-y">
              {history.map((item, idx) => (
                <div key={`${item.id}-${idx}`} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-mono text-sm font-medium">{item.postingNumber || item.platformOrderId}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.domesticTrackingNumber} · {item.shop?.name}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(item.scannedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
