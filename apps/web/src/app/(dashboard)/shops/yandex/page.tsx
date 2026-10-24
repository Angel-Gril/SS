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
import { useSystemDialog } from '@/components/system-dialog-provider';

type Shop = { id: string; name: string; platform: string; clientId: string | null; status: string; errorMessage: string | null; createdAt: string; productCount: number; orderCount: number };
type Campaign = { id: string; domain?: string | null; placementType?: string | null; apiAvailability?: string | null; business?: { id: string; name?: string | null } | null };
type OzonProduct = { id: string; title: string; sku?: string | null; platformProductId?: string | null; price?: string | null; stock?: number | null };
type DraftPreview = { readyCount: number; blockedCount: number; drafts: Array<{ sourceProductId: string; offer: { offerId: string; name: string; pictures: string[] }; missingFields: string[]; warnings: string[]; ready: boolean }> };

export default function YandexShopsPage() {
  const systemDialog = useSystemDialog();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editShop, setEditShop] = useState<Shop | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [campaigns, setCampaigns] = useState<Record<string, Campaign[]>>({});
  const [ozonShops, setOzonShops] = useState<Shop[]>([]);
  const [sourceShopId, setSourceShopId] = useState('');
  const [targetShopId, setTargetShopId] = useState('');
  const [sourceProducts, setSourceProducts] = useState<OzonProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [preview, setPreview] = useState<DraftPreview | null>(null);

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

  useEffect(() => {
    setSourceProducts([]); setSelectedProducts([]); setPreview(null);
    if (!sourceShopId) return;
    void api.get<{ rows?: OzonProduct[] }>(`/api/shops/${encodeURIComponent(sourceShopId)}/products?limit=50&offset=0&statusFilter=current`).then(response => {
      if (response.code === 1 && response.data) setSourceProducts(response.data.rows || []);
      else toast({ title: '读取 Ozon 商品失败', description: response.msg, variant: 'destructive' });
    });
  }, [sourceShopId]);

  async function previewDrafts(targetShopId: string) {
    if (!sourceShopId || !selectedProducts.length) return;
    setBusy(value => ({ ...value, [`preview:${targetShopId}`]: 'preview' }));
    const response = await api.post<DraftPreview>(`/api/yandex-market/${encodeURIComponent(targetShopId)}/drafts/preview`, { sourceShopId, productIds: selectedProducts });
    setBusy(value => { const next = { ...value }; delete next[`preview:${targetShopId}`]; return next; });
    if (response.code === 1 && response.data) setPreview(response.data);
    else toast({ title: '草稿预览失败', description: response.msg, variant: 'destructive' });
  }

  async function publishDrafts() {
    if (!targetShopId || !sourceShopId || !selectedProducts.length) return;
    const confirmed = await systemDialog.confirm({ title: '提交 Yandex 商品目录', message: '将把已确认的 ERP 草稿提交到 Yandex 商品目录。当前部署默认关闭真实写入；只有发布 owner 明确启用后才会发送请求。', confirmText: '继续提交' });
    if (!confirmed) return;
    setBusy(value => ({ ...value, [`publish:${targetShopId}`]: 'publish' }));
    const response = await api.post(`/api/yandex-market/${encodeURIComponent(targetShopId)}/offers/publish`, { sourceShopId, productIds: selectedProducts, confirm: true, idempotencyKey: crypto.randomUUID() });
    setBusy(value => { const next = { ...value }; delete next[`publish:${targetShopId}`]; return next; });
    toast({ title: response.code === 1 ? 'Yandex 商品提交完成' : 'Yandex 商品未提交', description: response.msg, variant: response.code === 1 ? 'default' : 'destructive' });
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Yandex Market 店铺</h1><p className="mt-1 text-sm text-muted-foreground">管理 Yandex campaign、读取店铺状态，并为后续 Ozon → Yandex 商品映射准备目标店铺。</p></div><Button onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />添加店铺</Button></div>
    <Card><CardHeader><CardTitle className="text-base">接入说明</CardTitle><CardDescription>Yandex 使用 Api-Key；店铺 Client ID 字段保存 campaign ID，不是 Ozon Client ID。保存凭据后先测试连接，当前阶段不会自动发布商品或调用 Ozon。</CardDescription></CardHeader></Card>
    <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>店铺</TableHead><TableHead>Campaign ID</TableHead><TableHead>状态</TableHead><TableHead>最近读取</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
      {loading ? <TableRow><TableCell colSpan={5} className="h-40 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow> : !shops.length ? <TableRow><TableCell colSpan={5} className="h-40 text-center text-muted-foreground"><Globe className="mx-auto mb-2 h-7 w-7" />还没有添加 Yandex Market 店铺</TableCell></TableRow> : shops.map(shop => <TableRow key={shop.id}><TableCell className="font-medium">{shop.name}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{shop.clientId || '—'}</TableCell><TableCell>{shop.status === 'ACTIVE' ? <Badge variant="success">正常</Badge> : <Badge variant="destructive" title={shop.errorMessage || ''}>{shop.status === 'ERROR' ? '异常' : '已停用'}</Badge>}</TableCell><TableCell className="text-sm text-muted-foreground">{campaigns[shop.id]?.length ? `已读取 ${campaigns[shop.id]?.length ?? 0} 个店铺` : '尚未读取'}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" title="编辑凭据" onClick={() => setEditShop(shop)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" title="测试连接" disabled={!!busy[shop.id]} onClick={() => void test(shop)}>{busy[shop.id] === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}</Button><Button size="sm" variant="ghost" title="读取店铺" disabled={!!busy[shop.id]} onClick={() => void readCampaigns(shop)}>{busy[shop.id] === 'read' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</Button></div></TableCell></TableRow>)}
    </TableBody></Table></CardContent></Card>
    {Object.entries(campaigns).map(([shopId, rows]) => <Card key={shopId}><CardHeader><CardTitle className="text-base">已读取的 Yandex 店铺</CardTitle><CardDescription>只读结果；发布和同步任务尚未启用。</CardDescription></CardHeader><CardContent><div className="grid gap-2 md:grid-cols-2">{rows.map(campaign => <div key={campaign.id} className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">Campaign {campaign.id}</span><Badge variant={campaign.apiAvailability === 'AVAILABLE' ? 'success' : 'secondary'}>{campaign.apiAvailability || '未知'}</Badge></div><p className="mt-1 text-muted-foreground">{campaign.business?.name || '未返回商家名'} · {campaign.placementType || '未返回履约模式'}{campaign.domain ? ` · ${campaign.domain}` : ''}</p></div>)}</div></CardContent></Card>)}
    <Card><CardHeader><CardTitle className="text-base">Ozon → Yandex 商品草稿预览</CardTitle><CardDescription>从已同步到 ERP 的 Ozon 商品中选择，生成 Yandex 字段检查结果。真实写入默认关闭，只有部署 owner 启用后才会发送 Yandex 请求。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 md:grid-cols-[1fr_1fr]"><div className="space-y-1"><Label htmlFor="yandex-target">目标 Yandex 店铺</Label><select id="yandex-target" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={targetShopId} onChange={event => setTargetShopId(event.target.value)}><option value="">选择目标店铺</option>{shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></div><div className="space-y-1"><Label htmlFor="ozon-source">来源 Ozon 店铺</Label><select id="ozon-source" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={sourceShopId} onChange={event => setSourceShopId(event.target.value)}><option value="">选择来源店铺</option>{ozonShops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></div></div>{sourceShopId && <div className="max-h-64 overflow-auto rounded-md border">{sourceProducts.length ? sourceProducts.map(product => <label key={product.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"><input type="checkbox" checked={selectedProducts.includes(product.id)} onChange={event => setSelectedProducts(current => event.target.checked ? [...current, product.id] : current.filter(id => id !== product.id))} /><span className="min-w-0 flex-1 truncate">{product.title}</span><span className="text-xs text-muted-foreground">{product.sku || product.platformProductId || product.id}</span></label>) : <p className="p-4 text-sm text-muted-foreground">暂无已同步商品</p>}</div>}{selectedProducts.length > 0 && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!targetShopId || busy[`preview:${targetShopId}`] === 'preview'} onClick={() => void previewDrafts(targetShopId)}>{busy[`preview:${targetShopId}`] === 'preview' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}生成草稿预览</Button><Button disabled={!targetShopId || !preview || preview.blockedCount > 0 || busy[`publish:${targetShopId}`] === 'publish'} onClick={() => void publishDrafts()}>{busy[`publish:${targetShopId}`] === 'publish' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}提交到 Yandex</Button></div>}{preview && <div className="rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">可发布 {preview.readyCount} · 待补字段 {preview.blockedCount}</p><div className="mt-2 space-y-2">{preview.drafts.map(draft => <div key={draft.sourceProductId} className="rounded border bg-background p-2"><div className="flex items-center justify-between gap-2"><span className="truncate">{draft.offer.name || draft.sourceProductId}</span><Badge variant={draft.ready ? 'success' : 'destructive'}>{draft.ready ? '字段完整' : '待补字段'}</Badge></div>{draft.missingFields.length > 0 && <p className="mt-1 text-xs text-destructive">缺少：{draft.missingFields.join('、')}</p>}{draft.warnings.length > 0 && <p className="mt-1 text-xs text-muted-foreground">提示：{draft.warnings.join('、')}</p>}</div>)}</div></div>}</CardContent></Card>
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
