'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface Shop {
  id: string;
  name: string;
  platform: string;
  status: string;
}

interface ProbeResult {
  status: number;
  ok: boolean;
  durationMs: number;
  body?: any;
  error?: string;
}

const PRESETS: Array<{ label: string; endpoint: string; payload: any; note?: string }> = [
  {
    label: '列出物流方式（v2）',
    endpoint: '/v2/delivery-method/list',
    payload: { limit: 50, offset: 0, filter: {} },
    note: '已知可用：拉店铺已配的物流方式',
  },
  {
    label: '物流方式详情（carriage）',
    endpoint: '/v2/carriage/delivery/list',
    payload: { limit: 50, statuses: { statuses: ['NEW', 'AWAITING_DELIVER', 'DELIVERING'] } },
    note: '已知可用：含 dropoff_address / warehouse_id / 承运商名',
  },
  {
    label: '搜索 Drop-off 点（中国）',
    endpoint: '/v1/warehouse/fbs/create/drop-off/list',
    payload: { search: { address: 'shanghai', types: ['PPZ'] }, warehouse_id: 0 },
    note: '已知可用：按地址搜代收点',
  },
  {
    label: '列出退货点',
    endpoint: '/v1/warehouse/fbs/create/return-point/list',
    payload: {
      coordinates: { latitude: 0, longitude: 0 },
      country_code: 'CN',
      last_id: 0,
      limit: 50,
      search: { address: '', types: ['PVZ'] },
      selected_dropoff_point_id: 0,
    },
    note: '已知可用',
  },
  {
    label: '【未确认】创建物流方式 v1',
    endpoint: '/v1/delivery/method/create',
    payload: { warehouse_id: 0, name: 'test method' },
    note: '⚠️ 文档未列出，待测',
  },
  {
    label: '【未确认】列出承运商服务',
    endpoint: '/v1/delivery/method/carrier-services',
    payload: { warehouse_id: 0, cargo_type: 'EXTRA_SMALL' },
    note: '⚠️ 文档未列出，待测',
  },
  {
    label: '【未确认】物流方式服务可选',
    endpoint: '/v1/delivery/services/list',
    payload: {},
    note: '⚠️ 文档未列出，待测',
  },
  {
    label: '物流方式列表 v1',
    endpoint: '/v1/delivery-method/list',
    payload: { limit: 50, offset: 0, filter: {} },
    note: '兼容性测试',
  },
];

export default function OzonProbePage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState('');
  const [endpoint, setEndpoint] = useState(PRESETS[0]!.endpoint);
  const [payloadText, setPayloadText] = useState(JSON.stringify(PRESETS[0]!.payload, null, 2));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [history, setHistory] = useState<Array<{ endpoint: string; result: ProbeResult; at: string }>>([]);

  useEffect(() => {
    api.get<any[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) {
        const list = Array.isArray(res.data) ? res.data : (res.data as any).rows || [];
        const ozon = list.filter((s: Shop) => s.platform === 'OZON');
        setShops(ozon);
        const first = ozon.find((s: Shop) => s.status === 'ACTIVE') || ozon[0];
        if (first) setShopId(first.id);
      }
    });
  }, []);

  function loadPreset(p: typeof PRESETS[number]) {
    setEndpoint(p.endpoint);
    setPayloadText(JSON.stringify(p.payload, null, 2));
    setResult(null);
  }

  async function runProbe() {
    if (!shopId) { toast({ title: '请选择店铺', variant: 'destructive' }); return; }
    if (!endpoint) { toast({ title: '请输入端点', variant: 'destructive' }); return; }
    let payload: any = {};
    try { payload = payloadText ? JSON.parse(payloadText) : {}; }
    catch (e: any) { toast({ title: 'payload JSON 格式错误: ' + e.message, variant: 'destructive' }); return; }

    setLoading(true);
    setResult(null);
    const res = await api.post<ProbeResult>('/api/admin/warehouse/ozon/probe', {
      shopId, endpoint, payload,
    });
    setLoading(false);
    if (res.code === 1 && res.data) {
      setResult(res.data);
      setHistory((h) => [{ endpoint, result: res.data!, at: new Date().toLocaleTimeString() }, ...h.slice(0, 19)]);
    } else {
      toast({ title: res.msg || '调用失败', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">OZON 接口探测</h1>
        <p className="text-muted-foreground mt-1">用任意已连接店铺的凭证调用任意 OZON 端点，验证接口可行性</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader>
            <CardTitle className="text-base">请求配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>使用店铺凭证</Label>
                <select className="w-full h-9 rounded-md border px-3 text-sm" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                  <option value="">请选择 OZON 店铺</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status !== 'ACTIVE' ? '（未激活）' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>端点路径</Label>
                <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="/v1/..." className="font-mono text-xs" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Payload (JSON)</Label>
              <textarea
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="w-full min-h-[180px] font-mono text-xs rounded-md border bg-background px-3 py-2"
              />
            </div>

            <Button onClick={runProbe} disabled={loading} className="w-full">
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              发送请求
            </Button>
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">预设</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => loadPreset(p)}
                  className="w-full text-left p-2 rounded-md hover:bg-muted text-xs border"
                >
                  <div className="font-medium">{p.label}</div>
                  <code className="text-[10px] text-muted-foreground">{p.endpoint}</code>
                  {p.note && <div className="text-[10px] text-muted-foreground mt-0.5">{p.note}</div>}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-8">
          <CardHeader>
            <CardTitle className="text-base">响应</CardTitle>
          </CardHeader>
          <CardContent>
            {!result ? (
              <p className="text-sm text-muted-foreground">点击"发送请求"后查看响应</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant={result.ok ? 'default' : 'destructive'} className={result.ok ? 'bg-green-600' : ''}>
                    {result.ok ? '✓ 成功' : '✗ 失败'}
                  </Badge>
                  <Badge variant="outline">HTTP {result.status}</Badge>
                  <Badge variant="outline">{result.durationMs}ms</Badge>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(result.body, null, 2));
                    toast({ title: '已复制响应' });
                  }}>
                    <Copy className="h-3 w-3 mr-1" />复制
                  </Button>
                </div>
                {result.error && (
                  <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-3 text-xs">
                    <div className="font-semibold text-red-700 dark:text-red-400 mb-1">错误信息</div>
                    <div className="text-red-600 dark:text-red-400 font-mono break-all">{result.error}</div>
                  </div>
                )}
                <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-[500px] font-mono">
                  {JSON.stringify(result.body, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-4">
          <CardHeader>
            <CardTitle className="text-base">本会话历史（{history.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无历史</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="text-xs border rounded p-2 hover:bg-muted/30 cursor-pointer" onClick={() => setResult(h.result)}>
                    <div className="flex items-center justify-between mb-0.5">
                      <Badge variant={h.result.ok ? 'default' : 'destructive'} className={h.result.ok ? 'bg-green-600 text-[10px] h-4' : 'text-[10px] h-4'}>
                        {h.result.status || 'ERR'}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{h.at}</span>
                    </div>
                    <code className="text-[10px] break-all">{h.endpoint}</code>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
