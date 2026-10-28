'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

type Product = { id: string; title: string; price?: string | null; oldPrice?: string | null; stock: number; platformStockKnown?: boolean };
type Context = { onlyDefaultPrice: boolean; currency: string; warehouseModel: string; warehouses: { id: number; name: string; groupInfo?: { name: string } | null }[] };
type Command = { action: string; productIds: string[]; confirm: true; idempotencyKey: string; price?: string; oldPrice?: string; stock?: number; warehouseId?: number; allowBusinessPrice: boolean; allowWarehouseGroup: boolean };

export function YandexProductManager({ shopId, products, selectedIds, editingId, onEditingClose, onUpdated }: {
  shopId: string; products: Product[]; selectedIds: string[]; editingId: string | null; onEditingClose: () => void; onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(''), [context, setContext] = useState<Context | null>(null);
  const [action, setAction] = useState('PRICE'), [price, setPrice] = useState(''), [oldPrice, setOldPrice] = useState(''), [stock, setStock] = useState('');
  const [warehouse, setWarehouse] = useState(''), [businessConsent, setBusinessConsent] = useState(false), [error, setError] = useState('');
  const [groupConsent, setGroupConsent] = useState(false);
  const [pending, setPending] = useState<Command | null>(null), [job, setJob] = useState(''), [jobState, setJobState] = useState('');
  const epoch = useRef(0); const key = `ss-erp:yandex-products:${shopId}`;
  const ids = editingId ? [editingId] : selectedIds;
  useEffect(() => {
    epoch.current++; setContext(null); setError(''); setBusy(''); setOpen(false); setJob(''); setJobState('');
    try { const value = sessionStorage.getItem(key); setPending(value ? JSON.parse(value) : null); } catch { setPending(null); }
    return () => { epoch.current++; };
  }, [shopId, key]);
  useEffect(() => { if (editingId) setOpen(true); }, [editingId]);
  useEffect(() => {
    if (!open) return;
    const version = epoch.current; setContext(null); setBusinessConsent(false); setGroupConsent(false); setError('');
    const single = ids.length === 1 ? products.find(p => p.id === ids[0]) : null;
    setPrice(single?.price ?? ''); setOldPrice(single?.oldPrice ?? ''); setStock(single && single.platformStockKnown !== false ? String(single.stock) : '');
    void api.get<Context>(`/api/yandex-market/${encodeURIComponent(shopId)}/product-context`).then(r => {
      if (epoch.current !== version) return;
      if (r.code === 1 && r.data) { setContext(r.data); setWarehouse(String(r.data.warehouses[0]?.id ?? '')); }
      else setError(r.msg || '读取 Yandex 操作范围失败');
    });
  }, [open, shopId]);
  useEffect(() => {
    if (!job) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await api.get<{ status: string; result?: { totalSynced?: number }; errorMessage?: string }>(`/api/yandex-market/${encodeURIComponent(shopId)}/sync-jobs/${encodeURIComponent(job)}`);
      if (cancelled) return;
      if (r.code !== 1 || !r.data) { setError(r.msg || '同步进度读取失败，可稍后刷新核对'); return; }
      setJobState(r.data.status);
      if (r.data.status === 'SUCCESS') { setJob(''); onUpdated(); toast({ title: `Yandex 同步完成：${r.data.result?.totalSynced ?? 0} 件` }); }
      else if (r.data.status === 'FAILED') { setJob(''); setError(r.data.errorMessage || '同步失败，原数据保留'); }
      else timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [job, shopId]);
  async function sync() {
    const version = epoch.current; setBusy('sync'); setError('');
    try {
      const r = await api.post<{ syncJobId: string }>(`/api/yandex-market/${encodeURIComponent(shopId)}/sync-products`, {});
      if (epoch.current !== version) return;
      if (r.code !== 1 || !r.data?.syncJobId) throw Error(r.msg || '同步任务创建失败');
      setJob(r.data.syncJobId); setJobState('PENDING');
    } catch (e) { if (epoch.current === version) setError(e instanceof Error ? e.message : '同步失败'); }
    finally { if (epoch.current === version) setBusy(''); }
  }
  async function submit() {
    const request: Command = pending ?? { action, productIds: ids, confirm: true, idempotencyKey: crypto.randomUUID(), allowBusinessPrice: businessConsent, allowWarehouseGroup: groupConsent,
      ...(action === 'PRICE' ? { price, ...(oldPrice.trim() ? { oldPrice } : {}) } : {}),
      ...(action === 'STOCK' ? { stock: Number(stock), warehouseId: Number(warehouse) } : {}),
    };
    const version = epoch.current; setError(''); setBusy('submit');
    try {
      // If local persistence fails, the command is never sent.
      sessionStorage.setItem(key, JSON.stringify(request)); setPending(request);
      const r = await api.post<{ state: string }>(`/api/yandex-market/${encodeURIComponent(shopId)}/product-operations`, request, { timeoutMs: 120000 });
      if (epoch.current !== version) return;
      if (['SUCCEEDED', 'REJECTED'].includes(r.data?.state ?? '') || (r.meta as { notDispatched?: boolean } | undefined)?.notDispatched === true) {
        sessionStorage.removeItem(key); setPending(null);
        if (r.data?.state === 'SUCCEEDED') { toast({ title: r.msg || 'Yandex 已接受，请同步读回核对' }); setOpen(false); onEditingClose(); onUpdated(); }
        else setError(r.msg || '平台拒绝操作');
      } else setError(r.msg || '结果未确认，保留原请求；请核对，不要新建请求。');
    } catch (e) { if (epoch.current === version) setError(e instanceof Error ? e.message : '结果未确认，请核对原请求'); }
    finally { if (epoch.current === version) setBusy(''); }
  }
  const selectedGroup = context?.warehouses.find(w => String(w.id) === warehouse)?.groupInfo;
  const invalid = !context || !ids.length || (action === 'PRICE' && (!Number(price) || (context.onlyDefaultPrice && !businessConsent))) || (action === 'STOCK' && (!warehouse || stock.trim() === '' || !Number.isInteger(Number(stock)) || Number(stock) < 0 || (!!selectedGroup && !groupConsent)));
  return <div className="flex max-w-full flex-wrap items-center gap-2">
    <Button size="sm" onClick={sync} disabled={!!busy || !!job}>{job ? `Yandex 同步中 · ${jobState}` : '同步 Yandex 商品/库存'}</Button>
    <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!selectedIds.length || !!busy || !!pending}>管理所选商品</Button>
    {pending && <Button size="sm" variant="outline" disabled={!!busy} onClick={submit}>核对上次 Yandex 操作</Button>}
    {error && !open && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (!value) onEditingClose(); } }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Yandex 商品管理</DialogTitle><DialogDescription>已选 {ids.length} 件。平台接受后可能延迟生效，请同步读回确认。隐藏与恢复展示不会删除目录商品。</DialogDescription></DialogHeader>
      <fieldset disabled={!!pending || !!busy} className="min-w-0 space-y-3">
        <div><Label htmlFor="ym-action">操作</Label><select id="ym-action" className="h-10 w-full rounded-md border bg-background px-3" value={action} onChange={e => setAction(e.target.value)}><option value="PRICE">修改售价</option><option value="STOCK">修改可售库存</option><option value="HIDE">隐藏商品</option><option value="SHOW">恢复展示</option></select></div>
        {action === 'PRICE' && <><div><Label htmlFor="ym-price">售价（{context?.currency ?? '—'}）</Label><Input id="ym-price" type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div><div><Label htmlFor="ym-old-price">划线价（选填）</Label><Input id="ym-old-price" type="number" step="0.01" value={oldPrice} onChange={e => setOldPrice(e.target.value)} /></div>{context?.onlyDefaultPrice && <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="checkbox" checked={businessConsent} onChange={e => setBusinessConsent(e.target.checked)} /><span>此柜台使用共用价格。我确认本次价格对同一 Yandex 柜台的所有店铺生效。</span></label>}</>}
        {action === 'STOCK' && <><div><Label htmlFor="ym-warehouse">Yandex 仓库</Label><select id="ym-warehouse" className="h-10 w-full rounded-md border bg-background px-3" value={warehouse} onChange={e => { setWarehouse(e.target.value); setGroupConsent(false); }}><option value="">选择仓库</option>{context?.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div><div><Label htmlFor="ym-stock">可售数量（不含冻结）</Label><Input id="ym-stock" type="number" min="0" step="1" value={stock} onChange={e => setStock(e.target.value)} /></div></>}
        {action === 'STOCK' && selectedGroup && <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="checkbox" checked={groupConsent} onChange={e => setGroupConsent(e.target.checked)} /><span>我确认库存对共享仓库组「{selectedGroup.name}」内的仓库同步生效。</span></label>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={!!busy} onClick={() => { setOpen(false); onEditingClose(); }}>关闭</Button><Button disabled={!!busy || (!pending && invalid)} onClick={submit}>{pending ? '核对原请求' : '确认提交 Yandex'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
