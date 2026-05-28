'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, Crosshair, Search } from 'lucide-react';
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
}

const typeLabel = (t: string) => (t === 'collect' ? '集运点' : t === 'dispatch' ? '发运点' : t);

// __CONTINUE_HERE__

export default function OzonPickupPointsPage() {
  const [items, setItems] = useState<PickupPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | 'collect' | 'dispatch'>('');

  useEffect(() => { fetchList(); }, []);

  async function fetchList() {
    setLoading(true);
    const res = await api.get<PickupPoint[]>('/api/ozon-pickup-points');
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

  const matched = items.filter((it) => {
    if (typeFilter && it.type !== typeFilter) return false;
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return [it.city, it.province, it.name, it.address].some(
      (v) => (v || '').toLowerCase().includes(k),
    );
  });

  const cityMatched = (it: PickupPoint) =>
    keyword && (it.city.toLowerCase().includes(keyword.toLowerCase())
      || (it.province || '').toLowerCase().includes(keyword.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">OZON 揽收点</h1>
        <p className="text-muted-foreground mt-1">
          自建仓主请把货物送至距离最近的 OZON 中国境内集运点 / 发运点
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-[2fr_auto_auto_auto] gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">城市 / 省份 / 站点关键字</label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="如：义乌、广州、深圳" />
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
            <Button variant="outline" onClick={locate} disabled={locating} title="使用浏览器定位">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Crosshair className="h-4 w-4 mr-1" />定位</>}
            </Button>
            <Button onClick={fetchList} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Search className="h-4 w-4 mr-1" />刷新</>}
            </Button>
          </div>
        </CardContent>
      </Card>
{/* __LIST_HERE__ */}

      <Card>
        <CardHeader><CardTitle className="text-base">揽收点列表（{matched.length}）</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : matched.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">没有匹配的揽收点</p>
          ) : (
            <div className="space-y-2">
              {matched.map((it) => {
                const hit = cityMatched(it);
                return (
                  <div key={it.id} className={`flex items-start gap-3 p-3 rounded-lg border ${hit ? 'border-orange-300 bg-orange-50/30' : ''}`}>
                    <MapPin className={`h-4 w-4 shrink-0 mt-0.5 ${hit ? 'text-orange-600' : 'text-muted-foreground'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{it.name}</span>
                        <Badge variant={it.type === 'collect' ? 'default' : 'secondary'}>{typeLabel(it.type)}</Badge>
                        <Badge variant="outline">{it.province ? `${it.province} · ` : ''}{it.city}</Badge>
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



