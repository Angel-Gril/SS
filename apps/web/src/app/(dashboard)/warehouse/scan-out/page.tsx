'use client';

import { useState } from 'react';
import { ScanLine, CheckCircle2, XCircle, Printer, PackageCheck, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api, apiUrl } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { useScannerInput, playBeep } from '@/lib/scanner';

interface ScanOutResult {
  id: string;
  postingNumber: string;
  platformOrderId: string;
  internationalTrackingNumber: string | null;
  internationalCarrier: string | null;
  items: any;
  buyerInfo: any;
  shippingInfo: any;
  shop: { name: string; platform: string };
  status: string;
  labelUrl: string;
  scannedAt: string;
}

export default function ScanOutPage() {
  const [barcode, setBarcode] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<ScanOutResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanOutResult[]>([]);
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
    setMatchedOrder(null);
    setLastError(null);

    const res = await api.post<ScanOutResult>('/api/warehouse/scan-out', {
      trackingNumber: code,
      shippingFee: shippingFee ? Number(shippingFee) : undefined,
    });

    if (res.code === 1 && res.data) {
      const order = { ...res.data, scannedAt: new Date().toISOString() };
      setMatchedOrder(order);
      setHistory((prev) => [order, ...prev].slice(0, 20));
      setFlash('success');
      playBeep('success');
      toast({ title: '出库成功', description: `订单 ${order.postingNumber || order.platformOrderId} 已标记出库` });
    } else {
      setLastError(res.msg);
      setFlash('error');
      playBeep('error');
      toast({ title: '出库失败', description: res.msg, variant: 'destructive' });
    }

    setBarcode('');
    setLoading(false);
    refocus();
    setTimeout(() => setFlash(null), 1500);
  }

  async function printLabel(orderId: string) {
    setPrinting(true);
    try {
      const res = await fetch(apiUrl(`/api/orders/${orderId}/label`), {
        credentials: 'include',
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        toast({ title: '面单下载失败', description: data.msg || '无法获取面单', variant: 'destructive' });
        setPrinting(false);
        return;
      }
      if (!res.ok) {
        toast({ title: '面单下载失败', description: `HTTP ${res.status}`, variant: 'destructive' });
        setPrinting(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 5000);
      };
      toast({ title: '打印面单', description: '面单已发送到打印机' });
    } catch (err: any) {
      toast({ title: '打印失败', description: err.message || '网络错误', variant: 'destructive' });
    }
    setPrinting(false);
  }

  function handleConfirmAndNext() {
    setMatchedOrder(null);
    setLastError(null);
    refocus();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">扫码出库</h1>
        <p className="text-muted-foreground mt-1">扫描国际物流单号或OZON订单号，打印面单并标记出库</p>
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
              placeholder="扫描国际物流单号或OZON订单号"
              className="flex-1 text-xl h-14 font-mono"
              autoFocus
              disabled={loading}
            />
            <Input
              value={shippingFee}
              onChange={(e) => setShippingFee(e.target.value)}
              placeholder="快递费(可选)"
              className="w-32 h-14 text-center"
              type="number"
              step="0.01"
              min="0"
              disabled={loading}
            />
            {loading && <Loader2 className="h-6 w-6 animate-spin self-center text-muted-foreground" />}
          </form>
        </CardContent>
      </Card>

      {/* 匹配结果 + 操作按钮 */}
      {matchedOrder && (
        <Card className="border-green-200 bg-green-50/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0 mt-1" />
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-green-700">出库成功</span>
                  <Badge className="bg-green-100 text-green-700">{matchedOrder.shop?.name}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">OZON 订单号：</span>
                    <span className="font-mono font-medium">{matchedOrder.postingNumber || matchedOrder.platformOrderId}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">国际单号：</span>
                    <span className="font-mono font-medium">{matchedOrder.internationalTrackingNumber || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">物流公司：</span>
                    <span>{matchedOrder.internationalCarrier || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">商品数量：</span>
                    <span>{Array.isArray(matchedOrder.items) ? matchedOrder.items.length : 0} 件</span>
                  </div>
                </div>
                {Array.isArray(matchedOrder.items) && matchedOrder.items.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    商品：{matchedOrder.items.map((it: any) => it.name || it.offer_id || it.sku).filter(Boolean).join(', ')}
                  </div>
                )}
                {/* 操作按钮 */}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => printLabel(matchedOrder.id)}
                    disabled={printing}
                    variant="outline"
                    size="lg"
                    className="text-base"
                  >
                    {printing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Printer className="mr-2 h-5 w-5" />}
                    打印面单
                  </Button>
                  <Button
                    onClick={handleConfirmAndNext}
                    size="lg"
                    className="text-base"
                  >
                    <PackageCheck className="mr-2 h-5 w-5" /> 继续扫码
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 错误提示 */}
      {lastError && !matchedOrder && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <XCircle className="h-8 w-8 text-red-500 shrink-0" />
              <div>
                <span className="text-lg font-bold text-red-700">
                  {lastError.includes('余额不足') ? '余额不足' : '匹配失败'}
                </span>
                <p className="text-sm text-red-600 mt-1">{lastError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 今日出库记录 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> 今日出库记录 ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ScanLine className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg">等待扫码...</p>
              <p className="text-sm mt-1">扫描国际物流单号或OZON订单号开始出库操作</p>
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
                        {item.internationalTrackingNumber || '-'} · {item.shop?.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => printLabel(item.id)}
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{formatDate(item.scannedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
