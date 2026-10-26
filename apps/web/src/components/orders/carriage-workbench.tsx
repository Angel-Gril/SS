'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Download, Loader2, Plus, RefreshCw, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSystemDialog } from '@/components/system-dialog-provider';

type Shop = { id: string; name: string; platform: string; status: string };
type Warehouse = { id: string; name: string; platformWarehouseId: string };
type Container = { container_id: string; warehouse_id: string; status: string; cargo_type: string; sort_type: string;
  available_actions: string[]; count_of_postings?: number; weight?: number; parent_container_id?: string | null; related_container_ids?: string[];
  postings?: { posting_number: string; available_actions?: string[] }[] };
type Operation = { id: string; kind: string; status: string; activeScope: string | null; taskId?: string | null; idempotencyKey: string;
  message?: string | null; result?: { container_ids?: string[]; error_postings?: { posting_number: string; error_message: string }[]; error_containers?: { container_id: string; error_message: string }[] } };
type Command = { kind: string; idempotencyKey: string; [key: string]: unknown };
const selectClass = 'h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const statuses: Record<string, string> = { new: '待装箱', formed: '已组包', approved: '已确认', acceptance_in_progress: '平台验收中', cancelled: '已取消', finished: '已完成', approve_enqueued: '排队确认', approve_in_process: '确认中', approve_failed: '确认失败', added: '已装托盘', cancellation_enqueded: '取消中' };
const operationNames: Record<string, string> = { create: '新建货位', fill: '加入订单', remove: '移除订单', approve: '确认组包', cancel: '取消组包', place: '装入托盘', unplace: '移出托盘' };
const operationStatuses: Record<string, string> = { DISPATCHING: '提交中', PENDING: '平台处理中', UNKNOWN: '结果待核对', SUCCEEDED: '已完成', PARTIAL: '部分失败', FAILED: '未完成', CLOSED_UNKNOWN: '人工关闭 · 结果未知' };

/** One shop/warehouse workspace; commands carry a stable key until server acknowledgement. */
export function CarriageWorkbench() {
  const systemDialog = useSystemDialog();
  const [shops, setShops] = useState<Shop[]>([]), [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shopId, setShopId] = useState(''), [warehouseId, setWarehouseId] = useState(''), [sortType, setSortType] = useState('sort');
  const [containers, setContainers] = useState<Container[]>([]), [selected, setSelected] = useState<Container | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]), [cursor, setCursor] = useState('');
  const [scan, setScan] = useState(''), [childId, setChildId] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [createOpen, setCreateOpen] = useState(false);
  const [cargoType, setCargoType] = useState('box'), [count, setCount] = useState(1);
  const [pendingCommand, setPendingCommand] = useState<Command | null>(null);
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }));
  const epoch = useRef(0), dispatching = useRef(false), pdfUrl = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scopeKey = shopId && warehouseId ? `ss-erp-carriage-pending:${shopId}:${warehouseId}` : '';
  const params = useCallback(() => new URLSearchParams({ shopId, warehouseId }).toString(), [shopId, warehouseId]);
  const locked = operations.some(op => op.activeScope !== null);
  const can = (action: string) => Boolean(selected?.available_actions.includes(action)) && !busy && !locked && !pendingCommand;
  function showError(e: unknown) { setError(e instanceof Error ? e.message : '请求失败，请刷新核对'); }

  useEffect(() => {
    let active = true;
    api.get<Shop[]>('/api/shops').then(res => {
      if (!active) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setShops(res.data.filter(shop => shop.platform === 'OZON' && shop.status === 'ACTIVE'));
    }).catch(e => { if (active) showError(e); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true; setWarehouses([]); setWarehouseId('');
    if (shopId) api.get<Warehouse[]>(`/api/shops/${shopId}/warehouses`).then(res => {
      if (!active) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setWarehouses(res.data);
    }).catch(e => { if (active) showError(e); });
    return () => { active = false; };
  }, [shopId]);
  useEffect(() => {
    epoch.current++; setLoading(false); setBusy(false); setSelected(null); setContainers([]); setOperations([]); setCursor(''); setError(''); setScan(''); setChildId('');
    setPreview(null); if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); pdfUrl.current = null;
    try { setPendingCommand(scopeKey ? JSON.parse(localStorage.getItem(scopeKey) || 'null') : null); }
    catch { setPendingCommand(null); }
    return () => { epoch.current++; };
  }, [shopId, warehouseId, sortType, scopeKey, range.from, range.to]);
  useEffect(() => () => { if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); }, []);

  const refresh = useCallback(async (nextCursor = '') => {
    if (!shopId || !warehouseId) return;
    const current = epoch.current; setLoading(true); setError('');
    const query = new URLSearchParams({ shopId, warehouseId, sortType, from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z`, ...(nextCursor ? { cursor: nextCursor } : {}) });
    try {
      // Keep recovery available even if the platform list endpoint is temporarily unavailable.
      const local = await api.get<Operation[]>(`/api/ozon-carriage/operations?${params()}`);
      if (current !== epoch.current) return;
      if (local.code === 1 && local.data) setOperations(local.data);
      const res = await api.get<{ containers: Container[]; cursor?: string; operations: Operation[] }>(`/api/ozon-carriage?${query}`);
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setContainers(list => nextCursor ? [...list, ...res.data!.containers.filter(c => !list.some(existing => existing.container_id === c.container_id))] : res.data!.containers);
      setCursor(res.data.cursor || ''); setOperations(res.data.operations);
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { if (current === epoch.current) setLoading(false); }
  }, [shopId, warehouseId, sortType, range, params]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function selectContainer(containerId: string) {
    const current = epoch.current; setBusy(true); setError('');
    try {
      const res = await api.get<Container>(`/api/ozon-carriage/${encodeURIComponent(containerId)}?${params()}`);
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setSelected(res.data); setScan('');
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function submit(command: Command) {
    if (dispatching.current) return;
    dispatching.current = true; const current = epoch.current; setBusy(true); setError('');
    try {
      // Persist before transport, so an interrupted browser cannot generate a second command key.
      localStorage.setItem(scopeKey, JSON.stringify(command)); setPendingCommand(command);
      const res = await api.post<Operation>('/api/ozon-carriage/commands', { shopId, warehouseId, command });
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) {
        // Keep the original key for ambiguous HTTP/DB failures as well as disconnected transport.
        if ((res.meta as { notDispatched?: boolean } | undefined)?.notDispatched === true) {
          localStorage.removeItem(scopeKey); setPendingCommand(null);
        }
        throw new Error(res.msg);
      }
      localStorage.removeItem(scopeKey); setPendingCommand(null); setCreateOpen(false); setScan('');
      setOperations(list => [res.data!, ...list.filter(row => row.id !== res.data!.id)]);
      if (res.data.message) setError(res.data.message);
      await refresh();
      const containerId = res.data.result?.container_ids?.[0] || selected?.container_id;
      if (containerId) await selectContainer(containerId);
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { dispatching.current = false; if (current === epoch.current) setBusy(false); }
  }
  async function run(kind: string, extra: Record<string, unknown> = {}) {
    if (!shopId || !warehouseId || busy || locked || pendingCommand) return;
    const current = epoch.current;
    if (['approve', 'cancel'].includes(kind)) {
      const confirmed = await systemDialog.confirm({ title: kind === 'approve' ? '确认当前组包' : '取消当前组包',
        message: kind === 'approve' ? '将当前货位中的订单提交给 Ozon 确认。确认组包不代表已实际发运。' : '将向 Ozon 取消该货位，请确认无需继续使用。',
        confirmText: kind === 'approve' ? '确认组包' : '取消组包', tone: kind === 'cancel' ? 'destructive' : 'default' });
      if (!confirmed) return;
    }
    if (current !== epoch.current) return;
    await submit({ kind, idempotencyKey: crypto.randomUUID(), ...(kind !== 'create' ? { containerId: selected?.container_id } : {}), ...extra });
  }
  async function recover(operation: Operation) {
    const current = epoch.current; setBusy(true); setError('');
    try {
      const res = await api.post<Operation>(`/api/ozon-carriage/operations/${operation.id}/recover`, { shopId, warehouseId });
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setOperations(list => list.map(row => row.id === operation.id ? res.data! : row));
      if (!res.data.taskId && res.data.activeScope) setError('此操作未取得平台任务编号，无法自动判断结果。请核对 Ozon 原记录，当前仓库已阻止重复提交。');
      if (selected) await selectContainer(selected.container_id);
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function openPdf(kind: 'label' | 'document') {
    if (!selected) return;
    const current = epoch.current; setBusy(true); setError('');
    try {
      const res = await api.get<{ base64: string }>(`/api/ozon-carriage/${selected.container_id}/${kind}/preview?${params()}`);
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      const bytes = Uint8Array.from(atob(res.data.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); pdfUrl.current = url;
      setPreview({ url, name: `container-${selected.container_id}-${kind}.pdf` });
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  async function closeUnknown(operation: Operation) {
    const current = epoch.current;
    const note = await systemDialog.prompt({ title: '人工核对后关闭跟踪', message: '请先在 Ozon 核对原请求和货位清单，再填写至少10字的核对说明。此操作只解除 ERP 跟踪锁，不会取消原请求，平台仍可能已建箱或加单；后续操作需避免重复。', confirmText: '确认已核对并关闭', tone: 'destructive' });
    if (note === null || current !== epoch.current) return;
    if (note.trim().length < 10) { setError('请填写至少10字的核对说明'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post<Operation>(`/api/ozon-carriage/operations/${operation.id}/close-unknown`, { shopId, warehouseId, acknowledged: true, note });
      if (current !== epoch.current) return;
      if (res.code !== 1 || !res.data) throw new Error(res.msg);
      setOperations(list => list.map(row => row.id === operation.id ? res.data! : row));
    } catch (e) { if (current === epoch.current) showError(e); }
    finally { if (current === epoch.current) setBusy(false); }
  }
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">组包交仓</h1><p className="mt-1 text-sm text-muted-foreground">所有本人 ACTIVE Ozon 店铺均可进入。将已备货订单装箱、确认组包并打印货签；具体操作由 Ozon 当前仓库、订单状态和可用动作实时决定。</p></div>
      <Button variant="outline" onClick={() => refresh()} disabled={loading || busy || !warehouseId}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新</Button>
    </header>
    <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-5">
      <div className="space-y-1"><Label htmlFor="carriage-shop">店铺</Label><select id="carriage-shop" className={`${selectClass} w-full`} value={shopId} onChange={e => setShopId(e.target.value)} disabled={busy}><option value="">选择店铺</option>{shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="carriage-warehouse">仓库</Label><select id="carriage-warehouse" className={`${selectClass} w-full`} value={warehouseId} onChange={e => setWarehouseId(e.target.value)} disabled={!shopId || busy}><option value="">选择仓库</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="carriage-sort">分拣类型</Label><select id="carriage-sort" className={`${selectClass} w-full`} value={sortType} onChange={e => setSortType(e.target.value)} disabled={busy}><option value="sort">可分拣</option><option value="non-sort">不可分拣</option></select></div>
      <div className="space-y-1"><Label htmlFor="carriage-from">创建日期起</Label><Input id="carriage-from" type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} disabled={busy} /></div>
      <div className="space-y-1"><Label htmlFor="carriage-to">创建日期止</Label><Input id="carriage-to" type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} disabled={busy} /></div>
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {pendingCommand && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><span>上次提交的响应尚未确认，请先核对原请求。</span><Button variant="outline" disabled={busy} onClick={() => submit(pendingCommand)}>核对原提交</Button></div>}
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <section className="min-w-0 space-y-3" aria-label="货位列表">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">箱子与托盘</h2><Button disabled={!warehouseId || busy || locked || !!pendingCommand} onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-4 w-4" />新建货位</Button></div>
        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>货位编号</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>订单数</TableHead></TableRow></TableHeader><TableBody>
          {!containers.length && <TableRow><TableCell colSpan={4} className="py-12 text-center text-muted-foreground">{loading ? '正在读取…' : warehouseId ? '当前范围没有货位，可调整日期或新建。' : '先选择店铺和仓库。'}</TableCell></TableRow>}
          {containers.map(c => <TableRow key={c.container_id} className={selected?.container_id === c.container_id ? 'bg-muted/70' : ''}><TableCell><button className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => selectContainer(c.container_id)} disabled={busy}>{c.container_id}</button></TableCell><TableCell>{c.cargo_type === 'pallet' ? '托盘' : '箱子'}</TableCell><TableCell><Badge variant="secondary">{statuses[c.status] || c.status}</Badge></TableCell><TableCell>{c.count_of_postings ?? '—'}</TableCell></TableRow>)}
        </TableBody></Table></div>
        {cursor && <Button variant="outline" className="w-full" disabled={loading || busy} onClick={() => refresh(cursor)}>加载更多货位</Button>}
      </section>
      <section className="min-w-0 space-y-4 rounded-lg border p-4" aria-label="货位详情">
        {!selected ? <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-muted-foreground"><Box className="h-8 w-8" /><p>选择一个货位查看订单和可用操作</p></div> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="break-all font-semibold">{selected.cargo_type === 'pallet' ? '托盘' : '箱子'} {selected.container_id}</h2><p className="mt-1 text-sm text-muted-foreground">{statuses[selected.status] || selected.status} · {selected.postings?.length ?? selected.count_of_postings ?? 0} 个订单{selected.weight !== undefined ? ` · ${selected.weight} kg` : ''}</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={() => selectContainer(selected.container_id)}>刷新详情</Button></div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const values = scan.split(/[\s,，]+/u).filter(Boolean); if (values.length) void run('fill', { postingNumbers: values }); }}>
            <Input aria-label="扫描订单号" value={scan} onChange={e => setScan(e.target.value)} placeholder="扫描发货单号，每批最多30单" disabled={!can('place_posting_into_container')} /><Button type="submit" disabled={!can('place_posting_into_container') || !scan.trim()}><ScanLine className="mr-1 h-4 w-4" />加入</Button>
          </form>
          <div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>箱内订单</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
            {!selected.postings?.length && <TableRow><TableCell colSpan={2} className="py-6 text-center text-muted-foreground">当前货位没有订单</TableCell></TableRow>}
            {selected.postings?.map(p => <TableRow key={p.posting_number}><TableCell className="break-all font-mono text-xs">{p.posting_number}</TableCell><TableCell className="text-right"><Button size="sm" variant="ghost" disabled={!can('remove_posting_from_container')} onClick={() => run('remove', { postingNumbers: [p.posting_number] })}>移除</Button></TableCell></TableRow>)}
          </TableBody></Table></div>
          {selected.cargo_type === 'pallet' && <div className="space-y-2"><p className="text-sm text-muted-foreground">箱子：{selected.related_container_ids?.join('、') || '暂无'}</p><div className="flex flex-wrap gap-2"><Input className="min-w-32 flex-1" aria-label="箱子编号" placeholder="输入箱子编号" value={childId} onChange={e => setChildId(e.target.value)} /><Button variant="outline" disabled={!can('place_box_into_pallet') || !childId} onClick={() => run('place', { childContainerId: childId })}>装入托盘</Button><Button variant="outline" disabled={!can('remove_box_from_pallet') || !childId} onClick={() => run('unplace', { childContainerId: childId })}>移出托盘</Button></div></div>}
          <div className="flex flex-wrap gap-2 border-t pt-4"><Button disabled={!can('approve')} onClick={() => run('approve')}>确认组包</Button><Button variant="outline" disabled={!can('get_label_container')} onClick={() => openPdf('label')}>预览货签</Button><Button variant="outline" disabled={!can('get_documents')} onClick={() => openPdf('document')}>交接文件</Button><Button variant="ghost" className="text-destructive" disabled={!can('delete')} onClick={() => run('cancel')}>取消组包</Button></div>
          <p className="text-xs text-muted-foreground">按钮以 Ozon 当前允许的动作为准。普通订单小面单仍在订单详情中单独打印。</p>
        </>}
      </section>
    </div>
    {!!operations.length && <section className="space-y-3"><h2 className="font-semibold">最近操作</h2><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>操作</TableHead><TableHead>状态</TableHead><TableHead>结果</TableHead><TableHead className="text-right">核对</TableHead></TableRow></TableHeader><TableBody>{operations.map(op => <TableRow key={op.id}><TableCell>{operationNames[op.kind] || op.kind}</TableCell><TableCell><Badge variant={['FAILED', 'PARTIAL', 'UNKNOWN', 'CLOSED_UNKNOWN'].includes(op.status) ? 'destructive' : 'secondary'}>{operationStatuses[op.status] || op.status}</Badge></TableCell><TableCell className="max-w-md whitespace-normal break-words text-xs">{op.message || op.result?.container_ids?.join('、') || (op.taskId ? `任务 ${op.taskId}` : '—')}{op.result?.error_postings?.map((e, i) => <p key={i}>{e.posting_number}：{e.error_message}</p>)}{op.result?.error_containers?.map((e, i) => <p key={i}>{e.container_id}：{e.error_message}</p>)}</TableCell><TableCell className="text-right">{op.activeScope && <div className="flex flex-wrap justify-end gap-1"><Button variant="outline" size="sm" disabled={busy} onClick={() => recover(op)}>读取结果</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => closeUnknown(op)}>核对后关闭</Button></div>}</TableCell></TableRow>)}</TableBody></Table></div></section>}
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>新建箱子或托盘</DialogTitle><DialogDescription>将在当前仓库创建独立货位，之后再扫描加入订单。</DialogDescription></DialogHeader><div className="grid gap-4"><div className="space-y-1"><Label htmlFor="cargo-type">货位类型</Label><select id="cargo-type" className={`${selectClass} w-full`} value={cargoType} onChange={e => setCargoType(e.target.value)} disabled={busy}><option value="box">箱子</option><option value="pallet">托盘</option></select></div><div className="space-y-1"><Label htmlFor="cargo-count">数量（1–100）</Label><Input id="cargo-count" type="number" min={1} max={100} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy} /></div></div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy || locked || !!pendingCommand || !Number.isInteger(count) || count < 1 || count > 100} onClick={() => run('create', { cargoType, sortType, count })}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}创建货位</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!preview} onOpenChange={open => { if (!open) { setPreview(null); if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); pdfUrl.current = null; } }}><DialogContent className="flex h-[85vh] max-w-5xl flex-col"><DialogHeader className="pr-8"><DialogTitle>组包文件预览</DialogTitle><DialogDescription>核对货位后下载或打印。</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{preview && <Button asChild variant="outline"><a href={preview.url} download={preview.name}><Download className="mr-1 h-4 w-4" />下载 PDF</a></Button>}<Button disabled={!preview} onClick={() => frame.current?.contentWindow?.print()}>打印</Button></div>{preview && <iframe ref={frame} title="组包货签 PDF" src={preview.url} className="min-h-0 w-full flex-1 rounded-md border" />}</DialogContent></Dialog>
  </div>;
}
