'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ScanLine,
  Printer,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  Wifi,
  WifiOff,
  ListChecks,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api, getApiBase } from '@/lib/api';
import {
  PrintAgentConfig,
  DEFAULT_PRINT_AGENT_CONFIG,
  checkAgent,
  fetchLabelBlob,
  printViaBrowser,
  printViaAgent,
} from '@/lib/print-agent';
import { formatDate } from '@/lib/utils';

interface PrintHistoryItem {
  id: string;
  orderId: string;
  postingNumber: string;
  printedAt: string;
  success: boolean;
  errorMsg?: string;
  trackingNumber?: string | null;
  shop?: { name: string; platform: string };
}

interface OrderForPrint {
  id: string;
  postingNumber: string;
  platformOrderId: string;
  status: string;
  internationalTrackingNumber: string | null;
  shop: { name: string; platform: string };
  items: any;
}

type PrintMode = 'browser' | 'agent';

export default function PrintPage() {
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>('browser');
  const [agentConfig, setAgentConfig] = useState<PrintAgentConfig>(DEFAULT_PRINT_AGENT_CONFIG);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<PrintHistoryItem[]>([]);
  const [flash, setFlash] = useState<'success' | 'error' | null>(null);

  // Batch print state
  const [batchOrders, setBatchOrders] = useState<OrderForPrint[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [loadingOrders, setLoadingOrders] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    loadPrintableOrders();
    loadPrintHistory();
  }, []);

  // Check agent status when mode changes
  useEffect(() => {
    if (printMode === 'agent') {
      checkAgentStatus();
    }
  }, [printMode, agentConfig.url]);

  async function checkAgentStatus() {
    const online = await checkAgent(agentConfig.url);
    setAgentOnline(online);
  }

  async function loadPrintableOrders() {
    setLoadingOrders(true);
    const res = await api.get<{ total: number; rows: OrderForPrint[] }>(
      '/api/orders?status=awaiting_deliver&limit=100',
    );
    if (res.code === 1 && res.data) {
      setBatchOrders(res.data.rows);
    }
    setLoadingOrders(false);
  }

  async function loadPrintHistory() {
    const res = await api.get<{ rows: Array<{
      id: string;
      orderId: string;
      postingNumber: string;
      printedAt: string;
      trackingNumber: string | null;
      shop: { name: string; platform: string };
    }> }>('/api/orders/label-print-logs?limit=50');
    if (res.code === 1 && res.data) {
      setHistory(res.data.rows.map((item) => ({
        ...item,
        success: true,
      })));
    }
  }

  /** Scan and auto-print */
  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const code = barcode.trim();
    if (!code) return;
    setLoading(true);

    try {
      // Find order by postingNumber or tracking number
      const res = await api.get<{ total: number; rows: OrderForPrint[] }>(
        `/api/orders?search=${encodeURIComponent(code)}&limit=1`,
      );

      if (res.code !== 1 || !res.data?.rows?.length) {
        throw new Error('未找到匹配的订单');
      }

      const order = res.data.rows[0]!;
      await doPrint(order.id, order.postingNumber || order.platformOrderId);

      setFlash('success');
      setTimeout(() => setFlash(null), 1500);
    } catch (err: any) {
      setFlash('error');
      addHistory('', code, false, err.message);
      toast({ title: '打印失败', description: err.message, variant: 'destructive' });
      setTimeout(() => setFlash(null), 1500);
    }

    setBarcode('');
    setLoading(false);
    inputRef.current?.focus();
  }

  async function doPrint(orderId: string, postingNumber: string) {
    const blob = await fetchLabelBlob(orderId, null, getApiBase());

    if (printMode === 'agent' && agentConfig.enabled) {
      const online = await checkAgent(agentConfig.url);
      if (online) {
        const success = await printViaAgent(agentConfig.url, blob);
        if (success) {
          addHistory(orderId, postingNumber, true);
          loadPrintHistory();
          toast({ title: '打印成功', description: `${postingNumber} 已通过代理打印` });
          return;
        }
      }
      // Fallback to browser
      toast({ title: '代理不可用', description: '回退到浏览器打印' });
    }

    await printViaBrowser(blob);
    addHistory(orderId, postingNumber, true);
    loadPrintHistory();
    toast({ title: '打印成功', description: `${postingNumber} 已发送到打印机` });
  }

  function addHistory(orderId: string, postingNumber: string, success: boolean, errorMsg?: string) {
    setHistory((prev) => [
      { id: crypto.randomUUID(), orderId, postingNumber, printedAt: new Date().toISOString(), success, errorMsg },
      ...prev,
    ].slice(0, 50));
  }

  /** Batch print selected orders */
  async function handleBatchPrint() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      toast({ title: '请选择订单', variant: 'destructive' });
      return;
    }

    setBatchPrinting(true);
    setBatchProgress({ current: 0, total: ids.length });

    for (let i = 0; i < ids.length; i++) {
      const orderId = ids[i]!;
      const order = batchOrders.find((o) => o.id === orderId);
      const postingNumber = order?.postingNumber || order?.platformOrderId || orderId;

      setBatchProgress({ current: i + 1, total: ids.length });

      try {
        await doPrint(orderId, postingNumber);
      } catch (err: any) {
        addHistory(orderId, postingNumber, false, err.message);
      }

      // Wait 2s between prints to avoid browser popup blocking
      if (i < ids.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    setBatchPrinting(false);
    setSelectedIds(new Set());
    toast({ title: '批量打印完成', description: `已打印 ${ids.length} 个面单` });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === batchOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(batchOrders.map((o) => o.id)));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">面单打印</h1>
          <p className="text-muted-foreground mt-1">扫码自动打印面单，或批量选择订单打印</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Print mode toggle */}
          <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
            <button
              onClick={() => { setPrintMode('browser'); setAgentConfig((c) => ({ ...c, enabled: false })); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                printMode === 'browser' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Printer className="inline h-4 w-4 mr-1" />
              浏览器打印
            </button>
            <button
              onClick={() => { setPrintMode('agent'); setAgentConfig((c) => ({ ...c, enabled: true })); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                printMode === 'agent' ? 'bg-background shadow text-foreground' : 'text-muted-foreground'
              }`}
            >
              {agentOnline ? <Wifi className="inline h-4 w-4 mr-1 text-green-500" /> : <WifiOff className="inline h-4 w-4 mr-1" />}
              本地代理
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(!showSettings)}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Agent settings panel */}
      {showSettings && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium whitespace-nowrap">代理地址:</label>
              <Input
                value={agentConfig.url}
                onChange={(e) => setAgentConfig((c) => ({ ...c, url: e.target.value }))}
                placeholder="http://localhost:9100"
                className="max-w-xs"
              />
              <Button variant="outline" size="sm" onClick={checkAgentStatus}>
                检测连接
              </Button>
              {agentOnline !== null && (
                <Badge variant={agentOnline ? 'default' : 'destructive'}>
                  {agentOnline ? '在线' : '离线'}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              本地打印代理需要单独安装运行。当代理离线时自动回退到浏览器打印。
            </p>
          </CardContent>
        </Card>
      )}

      {/* Scan input */}
      <Card className={
        flash === 'success' ? 'ring-2 ring-green-500 transition-all' :
        flash === 'error' ? 'ring-2 ring-red-500 transition-all' : 'transition-all'
      }>
        <CardContent className="pt-6">
          <form onSubmit={handleScan} className="flex gap-3">
            <div className="relative flex-1">
              <ScanLine className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="扫描 postingNumber 或国际单号 → 自动打印面单"
                className="pl-12 text-xl h-16 font-mono"
                autoFocus
                disabled={loading || batchPrinting}
              />
            </div>
            <Button type="submit" size="lg" className="h-16 px-8 text-lg" disabled={loading || batchPrinting || !barcode.trim()}>
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Printer className="h-6 w-6 mr-2" />}
              {loading ? '' : '打印'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">扫码后自动查找订单并打印面单，无需额外点击</p>
        </CardContent>
      </Card>

      {/* Batch print section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              批量打印 - 待发货订单 ({batchOrders.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={loadPrintableOrders} disabled={loadingOrders}>
                {loadingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : '刷新'}
              </Button>
              <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                {selectedIds.size === batchOrders.length && batchOrders.length > 0 ? '取消全选' : '全选'}
              </Button>
              <Button
                onClick={handleBatchPrint}
                disabled={batchPrinting || selectedIds.size === 0}
                size="sm"
              >
                {batchPrinting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    打印中 {batchProgress.current}/{batchProgress.total}
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4 mr-1" />
                    批量打印 ({selectedIds.size})
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {batchOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>暂无待发货订单</p>
            </div>
          ) : (
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {batchOrders.map((order) => (
                <label
                  key={order.id}
                  className="flex items-center gap-4 px-6 py-3 hover:bg-muted/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    className="h-5 w-5 rounded border-gray-300"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-medium truncate">
                      {order.postingNumber || order.platformOrderId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {order.shop?.name} · {order.internationalTrackingNumber || '无国际单号'}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {order.status === 'awaiting_deliver' ? '待发货' : order.status}
                  </Badge>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Printer className="h-5 w-5" />
            最近打印记录 ({history.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ScanLine className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg">等待打印...</p>
              <p className="text-sm mt-1">扫描单号或选择订单开始打印面单</p>
            </div>
          ) : (
            <div className="divide-y max-h-[300px] overflow-y-auto">
              {history.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    {item.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                    )}
                    <div>
                      <p className="font-mono text-sm font-medium">{item.postingNumber}</p>
                      {item.success && (
                        <p className="text-xs text-muted-foreground">
                          {item.shop?.name || '未知店铺'} · {item.trackingNumber || '无物流单号'}
                        </p>
                      )}
                      {item.errorMsg && (
                        <p className="text-xs text-red-500">{item.errorMsg}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.success && item.orderId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => doPrint(item.orderId, item.postingNumber).catch(() => {})}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">面单打印时间：{formatDate(item.printedAt)}</span>
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
