'use client';

import { useEffect, useState } from 'react';
import { Globe, Loader2, Pencil, Plus, RefreshCw, TestTube2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { YandexProductTransfer } from '@/components/yandex/product-transfer';

type Shop = { id: string; name: string; platform: string; clientId: string | null; status: string; errorMessage: string | null; createdAt: string; productCount: number; orderCount: number };
type Campaign = { id: string; domain?: string | null; placementType?: string | null; apiAvailability?: string | null; business?: { id: string; name?: string | null } | null };

export default function YandexShopsPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShop, setEditShop] = useState<Shop | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [campaigns, setCampaigns] = useState<Record<string, Campaign[]>>({});
  const [ozonShops, setOzonShops] = useState<Shop[]>([]);

  async function load() {
    setLoading(true);
    const response = await api.get<Shop[]>('/api/shops');
    if (response.code === 1 && response.data) {
      setShops(response.data.filter(shop => shop.platform === 'YANDEX'));
      setOzonShops(response.data.filter(shop => shop.platform === 'OZON'));
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function test(shop: Shop) {
    setBusy(value => ({ ...value, [shop.id]: 'test' }));
    const response = await api.post<Campaign>(`/api/yandex-market/${encodeURIComponent(shop.id)}/test`);
    setBusy(value => { const next = { ...value }; delete next[shop.id]; return next; });
    toast({ title: response.code === 1 ? 'Yandex Market 连接成功' : '连接失败', description: response.msg, variant: response.code === 1 ? 'default' : 'destructive' });
    if (response.code === 1) void load();
  }

  async function readCampaigns(shop: Shop) {
    setBusy(value => ({ ...value, [shop.id]: 'read' }));
    const response = await api.get<{ campaigns: Campaign[] }>(`/api/yandex-market/${encodeURIComponent(shop.id)}/campaigns`);
    setBusy(value => { const next = { ...value }; delete next[shop.id]; return next; });
    if (response.code === 1 && response.data) setCampaigns(value => ({ ...value, [shop.id]: response.data!.campaigns }));
    else toast({ title: '读取 Yandex 店铺失败', description: response.msg, variant: 'destructive' });
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Yandex Market 店铺</h1><p className="mt-1 text-sm text-muted-foreground">管理 Yandex campaign、读取店铺状态，并为后续 Ozon → Yandex 商品映射准备目标店铺。</p></div><Button onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />添加店铺</Button></div>
    <Card><CardHeader><CardTitle className="text-base">接入说明</CardTitle><CardDescription>Yandex 使用 Api-Key；店铺 Client ID 字段保存 campaign ID，不是 Ozon Client ID。保存凭据后先测试连接，当前阶段不会自动发布商品或调用 Ozon。</CardDescription></CardHeader></Card>
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>店铺</TableHead><TableHead>Campaign ID</TableHead><TableHead>状态</TableHead><TableHead>最近读取</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
      {loading ? <TableRow><TableCell colSpan={5} className="h-40 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow> : !shops.length ? <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted-foreground"><Globe className="mx-auto mb-2 h-7 w-7" />还没有添加 Yandex Market 店铺</TableCell></TableRow> : shops.map(shop => <TableRow key={shop.id}><TableCell className="font-medium">{shop.name}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{shop.clientId || '—'}</TableCell><TableCell>{shop.status === 'ACTIVE' ? <Badge variant="success">正常</Badge> : <Badge variant="destructive" title={shop.errorMessage || ''}>{shop.status === 'ERROR' ? '异常' : '已停用'}</Badge>}</TableCell><TableCell className="text-sm text-muted-foreground">{campaigns[shop.id]?.length ? `已读取 ${campaigns[shop.id]?.length ?? 0} 个店铺` : '尚未读取'}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" title="编辑凭据" onClick={() => setEditShop(shop)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" title="测试连接" disabled={!!busy[shop.id]} onClick={() => void test(shop)}>{busy[shop.id] === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}</Button><Button size="sm" variant="ghost" title="读取店铺" disabled={!!busy[shop.id]} onClick={() => void readCampaigns(shop)}>{busy[shop.id] === 'read' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</Button></div></TableCell></TableRow>)}
    </TableBody></Table></CardContent></Card>
    {Object.entries(campaigns).map(([shopId, rows]) => <Card key={shopId}><CardHeader><CardTitle className="text-base">已读取的 Yandex 店铺</CardTitle><CardDescription>只读结果；发布和同步任务尚未启用。</CardDescription></CardHeader><CardContent><div className="grid gap-2 md:grid-cols-2">{rows.map(campaign => <div key={campaign.id} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">Campaign {campaign.id}</span><Badge variant={campaign.apiAvailability === 'AVAILABLE' ? 'success' : 'secondary'}>{campaign.apiAvailability || '未知'}</Badge></div><p className="mt-1 text-muted-foreground">{campaign.business?.name || '未返回商家名'} · {campaign.placementType || '未返回履约模式'}{campaign.domain ? ` · ${campaign.domain}` : ''}</p></div>)}</div></CardContent></Card>)}
    <Card><CardHeader><CardTitle className="text-base">Ozon → Yandex 商品搬运</CardTitle><CardDescription>选择来源商品，确认 Yandex 类目和商品内容后预览；目录、价格、库存和物流分别处理。</CardDescription></CardHeader><CardContent><YandexProductTransfer shops={[...shops, ...ozonShops]} /></CardContent></Card>
    <YandexShopDialog open={addOpen} onOpenChange={setAddOpen} onSuccess={load} /><YandexEditDialog shop={editShop} onClose={() => setEditShop(null)} onSuccess={load} />
  </div>;
}

function YandexShopDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (value: boolean) => void; onSuccess: () => void }) {
  const [name, setName] = useState(''); const [campaignId, setCampaignId] = useState(''); const [apiKey, setApiKey] = useState(''); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); const response = await api.post('/api/shops', { platform: 'YANDEX', name, clientId: campaignId, apiKey }); setSaving(false); if (response.code !== 1) { toast({ title: '添加失败', description: response.msg, variant: 'destructive' }); return; } toast({ title: 'Yandex 店铺已添加', description: '请先测试连接' }); setName(''); setCampaignId(''); setApiKey(''); onOpenChange(false); onSuccess(); }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>添加 Yandex Market 店铺</DialogTitle><DialogDescription>在 Yandex Market 卖家后台创建 Api-Key，并填写店铺的 campaign ID。</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="yandex-name">店铺名称</Label><Input id="yandex-name" value={name} onChange={event => setName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="yandex-campaign">Campaign ID</Label><Input id="yandex-campaign" inputMode="numeric" value={campaignId} onChange={event => setCampaignId(event.target.value)} placeholder="例如 123456" required /></div><div className="space-y-2"><Label htmlFor="yandex-key">Api-Key</Label><Input id="yandex-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" required /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存</Button></DialogFooter></form></DialogContent></Dialog>;
}

function YandexEditDialog({ shop, onClose, onSuccess }: { shop: Shop | null; onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState(''); const [campaignId, setCampaignId] = useState(''); const [apiKey, setApiKey] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { setName(shop?.name || ''); setCampaignId(shop?.clientId || ''); setApiKey(''); }, [shop]);
  async function save() { if (!shop) return; setSaving(true); const body: Record<string, string> = {}; if (name !== shop.name) body.name = name; if (campaignId !== shop.clientId) body.clientId = campaignId; if (apiKey.trim()) body.apiKey = apiKey.trim(); if (!Object.keys(body).length) { setSaving(false); onClose(); return; } const response = await api.put(`/api/shops/${shop.id}`, body); setSaving(false); if (response.code !== 1) { toast({ title: '保存失败', description: response.msg, variant: 'destructive' }); return; } toast({ title: 'Yandex 店铺已更新' }); onClose(); onSuccess(); }
  return <Dialog open={!!shop} onOpenChange={open => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>编辑 Yandex Market 店铺</DialogTitle><DialogDescription>API Key 不会回显；修改凭据后需要重新测试连接。</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>店铺名称</Label><Input value={name} onChange={event => setName(event.target.value)} /></div><div className="space-y-2"><Label>Campaign ID</Label><Input value={campaignId} onChange={event => setCampaignId(event.target.value)} inputMode="numeric" /></div><div className="space-y-2"><Label>Api-Key</Label><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} autoComplete="new-password" placeholder="留空则不修改" /></div></div><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}保存</Button></DialogFooter></DialogContent></Dialog>;
}
