'use client';

import { useEffect, useState } from 'react';
import { Copy, Loader2, MapPin, Crosshair, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface PickupPoint {
  id: string;
  city: string;
  province: string | null;
  type: 'collect' | 'dispatch';
  name: string;
  address: string;
  contact: string | null;
  phone: string | null;
  workingHours: string | null;
  note: string | null;
  source?: string | null;
  externalId?: string | null;
  providerId?: number | null;
  providerName?: string | null;
}

const typeLabel = (t: string) => (t === 'collect' ? '集运点' : t === 'dispatch' ? '发运点' : t);

const sourceLabel = (source: string | null | undefined) => (source === 'ozon_seller' ? 'Ozon可选池' : 'ERP自建');

export default function OzonPickupPointsPage() {
  const [items, setItems] = useState<PickupPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'collect' | 'dispatch'>('');

  const [providerFilter, setProviderFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { fetchList(); }, keyword || typeFilter || providerFilter || sourceFilter ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [keyword, typeFilter, providerFilter, sourceFilter]);

  async function fetchList() {
    setLoading(true);
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());
    if (typeFilter) params.set('type', typeFilter);
    if (providerFilter) params.set('providerId', providerFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    const query = params.toString();
    const res = await api.get<PickupPoint[]>(`/api/ozon-pickup-points${query ? `?${query}` : ''}`);
    if (res.code === 1 && res.data) setItems(res.data);
    setLoading(false);
  }

  // 浏览器定位 → OSM Nominatim 反查 → 自动填中文城市
  async function locate() {
    if (!navigator.geolocation) {
      toast({ title: '浏览器不支持定位', variant: 'destructive' });
      return;
    }
    setLocating(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      const { latitude, longitude } = pos.coords;
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=zh-CN`;
      const r = await fetch(url, { headers: { 'User-Agent': 'ss-erp/1.0' } });
      const j = await r.json();
      const c = j?.address?.city || j?.address?.town || j?.address?.county || j?.address?.state || '';
      // 中文城市名常带"市"后缀，去掉以提高匹配率
      const clean = (c || '').replace(/市$/, '');
      if (!clean) {
        toast({ title: '定位成功但未识别到城市，请手动输入', variant: 'destructive' });
      } else {
        setKeyword(clean);
        toast({ title: `已定位到：${clean}` });
      }
    } catch (e: any) {
      toast({ title: e?.message || '定位失败', variant: 'destructive' });
    } finally {
      setLocating(false);
    }
  }

  const providerOptions = [...new Map(items
    .filter((it) => it.providerId)
    .map((it) => [String(it.providerId), it.providerName || `Provider ${it.providerId}`] as const))]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN', { numeric: true }));

  const matched = items.filter((it) => {
    if (typeFilter && it.type !== typeFilter) return false;
    if (providerFilter && String(it.providerId || '') !== providerFilter) return false;
    if (sourceFilter && it.source !== sourceFilter) return false;
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return [it.city, it.province, it.name, it.address].some(
      (v) => (v || '').toLowerCase().includes(k),
    ) || [it.providerName, it.externalId].some(
      (v) => (v || '').toLowerCase().includes(k),
    );
  });

  const cityMatched = (it: PickupPoint) =>
    keyword && (it.city.toLowerCase().includes(keyword.toLowerCase())
      || (it.province || '').toLowerCase().includes(keyword.toLowerCase()));


  const ranked = [...matched].sort((a, b) => {
    const cityScore = Number(Boolean(cityMatched(b))) - Number(Boolean(cityMatched(a)));
    if (cityScore) return cityScore;
    const sourceScore = Number(a.source === 'ozon_seller') - Number(b.source === 'ozon_seller');
    if (sourceScore) return sourceScore;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });

  async function copyPoint(it: PickupPoint) {
    const text = [
      it.name,
      it.address,
      it.providerName ? `承运商: ${it.providerName}` : '',
      it.externalId ? `Ozon发运点ID: ${it.externalId}` : '',
      it.phone ? `电话: ${it.phone}` : '',
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: '已复制发运点信息' });
    } catch (error: any) {
      toast({ title: error?.message || '复制失败', variant: 'destructive' });
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">OZON 发运点池查询</h1>
        <p className="text-muted-foreground mt-1">
          用自己的仓库地址、城市或承运商筛选 Ozon 可选发运点池，同时查看 ERP 自建点，便于在 Ozon 后台配置仓库物流。
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,2fr)_minmax(120px,auto)_minmax(140px,auto)_minmax(160px,auto)_auto_auto] gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">仓库地址 / 城市 / 站点关键字</label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="如：厦门海沧、义乌、广州、CEL" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">类型</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                <option value="collect">集运点</option>
                <option value="dispatch">发运点</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">来源</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                <option value="ozon_seller">Ozon可选池</option>
                <option value="manual">ERP自建</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">承运商</label>
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                {providerOptions.map((provider) => (
                  <option key={provider.value} value={provider.value}>{provider.label}</option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={locate} disabled={locating} title="使用浏览器定位">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Crosshair className="h-4 w-4 mr-1" />定位</>}
            </Button>
            <Button onClick={fetchList} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />刷新</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">可选发运点 / ERP自建点（{ranked.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : ranked.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">没有匹配的揽收点</p>
          ) : (
            <div className="space-y-2">
              {ranked.map((it) => {
                const hit = cityMatched(it);
                return (
                  <div key={it.id} className={`flex items-start gap-3 p-3 rounded-lg border ${hit ? 'border-orange-300 bg-orange-50/30' : ''}`}>
                    <MapPin className={`h-4 w-4 shrink-0 mt-0.5 ${hit ? 'text-orange-600' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{it.name}</span>
                        <Badge variant={it.type === 'collect' ? 'default' : 'secondary'}>{typeLabel(it.type)}</Badge>
                        <Badge variant="outline">{it.province ? `${it.province} · ` : ''}{it.city}</Badge>
                        <Badge variant="outline">{sourceLabel(it.source)}</Badge>
                        {it.providerName && <Badge variant="outline">{it.providerName}</Badge>}
                        {it.externalId && <Badge variant="outline">ID {it.externalId}</Badge>}
                        {hit && <Badge variant="outline" className="text-orange-600 border-orange-300">同城</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">{it.address}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                        {it.contact && <span>联系人：{it.contact}</span>}
                        {it.phone && <span>电话：{it.phone}</span>}
                        {it.workingHours && <span>{it.workingHours}</span>}
                      </div>
                      {it.note && <div className="text-xs text-muted-foreground mt-1">备注：{it.note}</div>}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyPoint(it)}
                      title="复制发运点信息"
                      className="shrink-0"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

