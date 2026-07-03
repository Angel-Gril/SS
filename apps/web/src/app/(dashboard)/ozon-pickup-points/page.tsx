'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Loader2, MapPin, Crosshair, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface PickupPointService {
  id: string;
  name: string;
  address: string;
  contact: string | null;
  phone: string | null;
  workingHours: string | null;
  note: string | null;
  isActive?: boolean;
  sortOrder?: number;
  source?: string | null;
  externalId?: string | null;
  providerId?: number | null;
  providerName?: string | null;
  carrierName?: string | null;
  serviceLevel?: string | null;
  weightTier?: string | null;
}

interface PickupPointGroup {
  id: string;
  city: string;
  province: string | null;
  type: 'collect' | 'dispatch';
  name: string;
  address: string;
  contact: string | null;
  phone: string | null;
  workingHours: string | null;
  source?: string | null;
  shopId?: string | null;
  isActive?: boolean;
  serviceCount: number;
  activeServiceCount?: number;
  carriers: string[];
  serviceLevels: string[];
  weightTiers: string[];
  services: PickupPointService[];
}

interface ProviderOption {
  providerId: number;
  providerName: string;
  carrierName?: string | null;
  serviceLevel?: string | null;
  weightTier?: string | null;
  count: number;
}

interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
}

const typeLabel = (t: string) => (t === 'collect' ? '集运点' : t === 'dispatch' ? '发运点' : t);

const sourceLabel = (source: string | null | undefined) => (source === 'ozon_seller' ? 'Ozon可选池' : 'ERP自建');
const PAGE_SIZE = 100;

export default function OzonPickupPointsPage() {
  const [items, setItems] = useState<PickupPointGroup[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1, hasNext: false });
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'collect' | 'dispatch'>('');

  const [carrierFilter, setCarrierFilter] = useState('');
  const [serviceLevelFilter, setServiceLevelFilter] = useState('');
  const [weightTierFilter, setWeightTierFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [keyword, typeFilter, carrierFilter, serviceLevelFilter, weightTierFilter, sourceFilter]);

  useEffect(() => {
    setCarrierFilter('');
    setServiceLevelFilter('');
    setWeightTierFilter('');
    fetchProviders();
  }, [typeFilter, sourceFilter]);

  useEffect(() => {
    const hasFilter = keyword || typeFilter || carrierFilter || serviceLevelFilter || weightTierFilter || sourceFilter;
    const timer = window.setTimeout(() => { fetchList(); }, hasFilter ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [keyword, typeFilter, carrierFilter, serviceLevelFilter, weightTierFilter, sourceFilter, page]);

  async function fetchList() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('view', 'warehouse');
    if (keyword.trim()) params.set('q', keyword.trim());
    if (typeFilter) params.set('type', typeFilter);
    if (carrierFilter) params.set('carrier', carrierFilter);
    if (serviceLevelFilter) params.set('serviceLevel', serviceLevelFilter);
    if (weightTierFilter) params.set('weightTier', weightTierFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    const query = params.toString();
    const res = await api.get<PickupPointGroup[]>(`/api/ozon-pickup-points${query ? `?${query}` : ''}`);
    if (res.code === 1 && res.data) {
      setItems(res.data);
      setMeta((res.meta as PageMeta | undefined) || { page, pageSize: PAGE_SIZE, total: res.data.length, totalPages: 1, hasNext: false });
    }
    setLoading(false);
  }

  async function fetchProviders() {
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    const query = params.toString();
    const res = await api.get<ProviderOption[]>(`/api/ozon-pickup-points/providers${query ? `?${query}` : ''}`);
    if (res.code === 1 && res.data) setProviders(res.data);
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

  const cityMatched = (it: PickupPointGroup) =>
    keyword && (it.city.toLowerCase().includes(keyword.toLowerCase())
      || (it.province || '').toLowerCase().includes(keyword.toLowerCase()));


  const ranked = [...items].sort((a, b) => {
    const cityScore = Number(Boolean(cityMatched(b))) - Number(Boolean(cityMatched(a)));
    if (cityScore) return cityScore;
    const sourceScore = Number(a.source === 'ozon_seller') - Number(b.source === 'ozon_seller');
    if (sourceScore) return sourceScore;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
  });

  const carrierOptions = aggregateProviderOptions(providers, 'carrierName');
  const serviceLevelOptions = aggregateProviderOptions(providers, 'serviceLevel');
  const weightTierOptions = aggregateProviderOptions(providers, 'weightTier');

  async function copyPoint(it: PickupPointGroup) {
    const services = it.services
      .map((service) => {
        const id = service.externalId ? `ID ${service.externalId}` : '';
        return [service.providerName, service.serviceLevel, service.weightTier, id].filter(Boolean).join(' / ');
      })
      .slice(0, 20);
    const text = [
      it.name,
      it.address,
      it.carriers.length ? `物流商: ${it.carriers.join(', ')}` : '',
      services.length ? `服务: ${services.join('; ')}` : '',
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
          <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,2fr)_minmax(110px,auto)_minmax(120px,auto)_minmax(140px,auto)_minmax(120px,auto)_minmax(140px,auto)_auto_auto] gap-3 items-end">
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
              <label className="text-xs text-muted-foreground">物流商</label>
              <select
                value={carrierFilter}
                onChange={(e) => setCarrierFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                {carrierOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}（{option.count}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">服务</label>
              <select
                value={serviceLevelFilter}
                onChange={(e) => setServiceLevelFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                {serviceLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}（{option.count}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">重量/规格</label>
              <select
                value={weightTierFilter}
                onChange={(e) => setWeightTierFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">全部</option>
                {weightTierOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}（{option.count}）
                  </option>
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
        <CardHeader><CardTitle className="text-base">可选仓点 / ERP自建点（{meta.total}）</CardTitle></CardHeader>
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
                        {it.carriers.slice(0, 3).map((carrier) => <Badge key={carrier} variant="outline">{carrier}</Badge>)}
                        <Badge variant="outline">{it.serviceCount} 个服务</Badge>
                        {hit && <Badge variant="outline" className="text-orange-600 border-orange-300">同城</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">{it.address}</div>
                      <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                        {it.contact && <span>联系人：{it.contact}</span>}
                        {it.phone && <span>电话：{it.phone}</span>}
                        {it.workingHours && <span>{it.workingHours}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {it.services.slice(0, 12).map((service) => (
                          <span
                            key={service.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                            title={service.providerName || undefined}
                          >
                            <span className="font-medium">{service.providerName || service.carrierName || '未命名服务'}</span>
                            {service.weightTier && <span className="text-muted-foreground">{service.weightTier}</span>}
                            {service.externalId && <span className="text-muted-foreground">ID {service.externalId}</span>}
                          </span>
                        ))}
                        {it.services.length > 12 && (
                          <span className="inline-flex items-center rounded-md border bg-muted px-2 py-1 text-xs text-muted-foreground">
                            +{it.services.length - 12} 个
                          </span>
                        )}
                      </div>
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
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>第 {meta.page} / {meta.totalPages} 页，每页 {meta.pageSize} 条</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={loading || meta.page <= 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((value) => value + 1)}
                disabled={loading || !meta.hasNext}
              >
                下一页<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function aggregateProviderOptions(
  providers: ProviderOption[],
  field: 'carrierName' | 'serviceLevel' | 'weightTier',
): { value: string; count: number }[] {
  const map = new Map<string, number>();
  for (const provider of providers) {
    const value = String(provider[field] || '').trim();
    if (!value) continue;
    map.set(value, (map.get(value) || 0) + provider.count);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, 'zh-Hans-CN', { numeric: true }));
}
