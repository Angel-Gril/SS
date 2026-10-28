'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { yandexCommandOutcome } from './workbench-input';

type Warehouse = { id: number; name: string; groupInfo?: { id: number; name: string } | null };
type Logistics = { placementType?: string; apiAvailability?: string; warehouses: Warehouse[]; services?: { id: number; name: string }[]; servicesError?: string; servicesUnavailable?: boolean; settings: { warehouseModel?: string; onlyDefaultPrice?: boolean } };
type Shipment = { pendingCommand?: { confirm: true; idempotencyKey: string } | null; id: string | number; status: string; shipmentDate?: string; availableActions: string[]; orderIds: (number | string)[]; warehouse?: { id?: string | number; name?: string }; palletCount?: number };
type Pending = { shipmentId: string; body: { confirm: true; idempotencyKey: string } };
type DocumentType = 'ACT' | 'INBOUND_ACT' | 'DISCREPANCY_ACT' | 'TRANSPORTATION_WAYBILL';
const documentLabels: Record<DocumentType, string> = { ACT: '交接单 PDF', INBOUND_ACT: '入库清单 PDF', DISCREPANCY_ACT: '差异清单 Excel', TRANSPORTATION_WAYBILL: '运输单 Excel' };
const today = () => new Date().toISOString().slice(0, 10);

export function YandexLogisticsWorkbench({ shop, onClose }: { shop: { id: string; name: string } | null; onClose: () => void }) {
  const [context, setContext] = useState<Logistics | null>(null), [shipments, setShipments] = useState<Shipment[]>([]), [selected, setSelected] = useState<Shipment | null>(null);
  const [dateFrom, setDateFrom] = useState(today), [dateTo, setDateTo] = useState(today), [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('ACT'), [downloadName, setDownloadName] = useState('');
  const [confirmed, setConfirmed] = useState(false), [pdf, setPdf] = useState('');
  const generation = useRef(0), inFlight = useRef(false), pdfRef = useRef(''), iframe = useRef<HTMLIFrameElement>(null);
  const base = shop ? `/api/yandex-market/${encodeURIComponent(shop.id)}` : '';
  const storageKey = `ss-erp:yandex-shipment:${shop?.id}`;
  function setPdfUrl(value: string) { if (pdfRef.current) URL.revokeObjectURL(pdfRef.current); pdfRef.current = value; setPdf(value); }
  async function readContext(version = generation.current) {
    const r = await api.get<Logistics>(base + '/logistics');
    if (version !== generation.current) return;
    if (r.code !== 1 || !r.data) throw Error(r.msg || '读取仓库与物流失败'); setContext(r.data);
  }
  useEffect(() => {
    const version = ++generation.current; setContext(null); setShipments([]); setSelected(null); setError(''); setNotice(''); setBusy('read'); setConfirmed(false); setPdfUrl(''); setNextPageToken(null);
    try { const value = shop ? sessionStorage.getItem(storageKey) : null; setPending(value ? JSON.parse(value) : null); } catch { setPending(null); }
    if (shop) void readContext(version).catch(e => { if (generation.current === version) setError(e.message); }).finally(() => { if (generation.current === version) setBusy(''); });
    return () => { generation.current++; if (pdfRef.current) URL.revokeObjectURL(pdfRef.current); pdfRef.current = ''; };
  }, [shop?.id]);
  async function readShipments(pageToken?: string) {
    const version = generation.current; setBusy('read'); setError('');
    try {
      const q = new URLSearchParams({ dateFrom, dateTo }); if (pageToken) q.set('pageToken', pageToken);
      const r = await api.get<{ shipments: Shipment[]; nextPageToken?: string | null }>(`${base}/shipments?${q}`);
      if (generation.current !== version) return;
      if (r.code !== 1 || !r.data) throw Error(r.msg || '读取交接单失败');
      setShipments(current => pageToken ? [...current, ...r.data!.shipments.filter(row => !current.some(old => String(old.id) === String(row.id)))] : r.data!.shipments);
      setNextPageToken(r.data.nextPageToken ?? null); if (!pageToken) { setSelected(null); setConfirmed(false); setPdfUrl(''); }
      if (!r.data.shipments.length && !pageToken) setNotice('此日期范围内没有交接单。'); else setNotice('');
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : '读取交接单失败'); }
    finally { if (generation.current === version) setBusy(''); }
  }
  async function selectShipment(id: string | number) {
    const version = generation.current; setBusy('detail'); setError(''); setConfirmed(false); setSelected(null); setPdfUrl('');
    try {
      const r = await api.get<Shipment>(`${base}/shipments/${encodeURIComponent(String(id))}`);
      if (generation.current !== version) return;
      if (r.code !== 1 || !r.data) throw Error(r.msg || '读取交接单详情失败'); setSelected(r.data);
      if (r.data.pendingCommand) { const saved = { shipmentId: String(r.data.id), body: r.data.pendingCommand }; setPending(saved); sessionStorage.setItem(storageKey, JSON.stringify(saved)); }
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : '读取详情失败'); }
    finally { if (generation.current === version) setBusy(''); }
  }
  async function confirmShipment() {
    if ((!selected && !pending) || !shop || inFlight.current) return;
    const version = generation.current; inFlight.current = true; setBusy('write'); setError(''); setNotice(''); setPdfUrl('');
    try {
      const command: Pending = pending ?? { shipmentId: String(selected!.id), body: { confirm: true, idempotencyKey: crypto.randomUUID() } };
      sessionStorage.setItem(storageKey, JSON.stringify(command)); setPending(command);
      const r = await api.post<{ state: string }>(`${base}/shipments/${encodeURIComponent(command.shipmentId)}/confirm`, command.body, { timeoutMs: 90000 });
      if (generation.current !== version) return;
      const outcome = yandexCommandOutcome(r);
      if (outcome !== 'PENDING') {
        sessionStorage.removeItem(storageKey); setPending(null); setConfirmed(false);
        if (outcome !== 'SUCCEEDED') throw Error(r.msg || '平台未接受交接确认');
        setNotice('交接确认已完成。');
        const fresh = await api.get<Shipment>(`${base}/shipments/${encodeURIComponent(command.shipmentId)}`);
        if (generation.current !== version) return;
        if (fresh.code === 1 && fresh.data) setSelected(fresh.data); else setError('交接已确认，但详情刷新失败，请重新读取。');
      } else setNotice(r.msg || '交接结果待确认，请核对原请求，勿重复提交。');
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : '交接结果待核对'); }
    finally { inFlight.current = false; if (generation.current === version) setBusy(''); }
  }
  async function previewDocument() {
    if (!selected) return; const version = generation.current; setBusy('document'); setError(''); setPdfUrl('');
    try {
      const r = await api.get<{ base64: string; filename?: string }>(`${base}/shipments/${encodeURIComponent(String(selected.id))}/document?type=${documentType}&encoding=base64`, { timeoutMs: 45000 });
      if (generation.current !== version) return;
      if (r.code !== 1 || !r.data?.base64) throw Error(r.msg || '平台尚未提供交接文件');
      const spreadsheet = ['DISCREPANCY_ACT', 'TRANSPORTATION_WAYBILL'].includes(documentType);
      setPdfUrl(URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data.base64), c => c.charCodeAt(0))], { type: spreadsheet ? 'application/vnd.ms-excel' : 'application/pdf' })));
      setDownloadName(r.data.filename ?? `yandex-shipment-${selected.id}-${documentType}.${spreadsheet ? 'xlsx' : 'pdf'}`);
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : '读取交接文件失败'); }
    finally { if (generation.current === version) setBusy(''); }
  }
  const firstMile = ['FBS', 'EXPRESS'].includes(context?.placementType ?? '');
  const canConfirm = selected?.status === 'OUTBOUND_READY_FOR_CONFIRMATION' && selected.availableActions.includes('CONFIRM') && !!selected.orderIds.length;
  const spreadsheet = ['DISCREPANCY_ACT', 'TRANSPORTATION_WAYBILL'].includes(documentType);
  return <Dialog open={!!shop} onOpenChange={open => { if (!open && busy !== 'write') onClose(); }}><DialogContent className="flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden"><DialogHeader className="pr-8"><DialogTitle>{shop?.name} · 仓库与物流</DialogTitle><DialogDescription>查看平台仓库、配送服务及交接发运。交接单使用 Yandex 原生数据。</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2"><Badge>{context?.placementType || '履约模式待读取'}</Badge><Badge variant="secondary">{context?.apiAvailability || 'API 状态待读取'}</Badge><Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setBusy('read'); readContext().catch(e => setError(e.message)).finally(() => setBusy('')); }}>刷新配置</Button></div>
      {context && <><section className="space-y-2"><h3 className="font-medium">平台仓库</h3><p className="text-xs text-muted-foreground">库存模式：{context.settings.warehouseModel || '平台未提供'}。{context.settings.onlyDefaultPrice ? '当前使用商家通用价格。' : '当前允许店铺独立价格。'}</p><div className="grid gap-2 sm:grid-cols-2">{context.warehouses.map(w => <div className="rounded-md border p-3 text-sm" key={w.id}><p className="font-medium">{w.name}</p><p className="text-muted-foreground">仓库 {w.id}{w.groupInfo ? ` · 共享仓库组：${w.groupInfo.name}` : ''}</p></div>)}</div>{!context.warehouses.length && <p className="text-sm text-muted-foreground">平台没有返回此店铺的仓库；请检查平台配置和 API 权限。</p>}</section>
      <details className="rounded-md border p-3"><summary className="cursor-pointer text-sm font-medium">配送服务目录（{context.services?.length ?? 0}）</summary><p className="my-2 text-xs text-muted-foreground">目录用于识别承运商，不代表当前店铺已获准使用全部服务。</p>{context.servicesUnavailable && <p role="alert" className="text-sm text-destructive">平台配送目录暂不可用，请刷新或检查 API 权限。</p>}{context.servicesError && <p role="alert" className="text-sm text-destructive">{context.servicesError}</p>}<ul className="grid max-h-48 gap-x-4 overflow-y-auto text-sm sm:grid-cols-2">{context.services?.map(service => <li key={service.id}>{service.name} <span className="text-xs text-muted-foreground">#{service.id}</span></li>)}</ul></details>
      <section className="space-y-3"><h3 className="font-medium">交接发运</h3>{!firstMile ? <p className="text-sm text-muted-foreground">当前履约模式不使用 FBS 交接单。DBS 配送和运单请在订单“处理订单”中操作；平台仓配订单以平台物流为准。</p> : <><p className="text-sm text-muted-foreground">平台形成交接单后，读取详情并核对订单。实际交接后再确认；备货、装箱和每单面单在订单页完成。</p><div className="flex flex-wrap items-end gap-3"><div><Label htmlFor="ym-shipment-from">发运起始日</Label><Input id="ym-shipment-from" type="date" value={dateFrom} disabled={!!busy} onChange={e => setDateFrom(e.target.value)} /></div><div><Label htmlFor="ym-shipment-to">发运结束日</Label><Input id="ym-shipment-to" type="date" value={dateTo} disabled={!!busy} onChange={e => setDateTo(e.target.value)} /></div><Button variant="outline" disabled={!!busy || !dateFrom || !dateTo || dateFrom > dateTo} onClick={() => void readShipments()}>读取交接单</Button></div>
      <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>交接单</TableHead><TableHead>发运日</TableHead><TableHead>平台状态</TableHead><TableHead>订单数</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{shipments.map(row => <TableRow key={row.id}><TableCell>{row.id}</TableCell><TableCell>{row.shipmentDate || '未提供'}</TableCell><TableCell><Badge variant="secondary">{row.status}</Badge></TableCell><TableCell>{row.orderIds.length}</TableCell><TableCell><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void selectShipment(row.id)}>查看详情</Button></TableCell></TableRow>)}{!shipments.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">请选择日期读取平台交接单</TableCell></TableRow>}</TableBody></Table></div>{nextPageToken && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void readShipments(nextPageToken)}>读取下一页</Button>}
      {selected && <div className="space-y-3 rounded-md border p-3"><div className="flex flex-wrap gap-2"><h4 className="font-medium">交接单 {selected.id}</h4><Badge variant="secondary">{selected.status}</Badge>{selected.warehouse && <span className="text-sm">仓库：{selected.warehouse.name || selected.warehouse.id}</span>}{selected.palletCount !== undefined && <span className="text-sm">托盘数：{selected.palletCount}</span>}</div><p className="break-all text-sm">订单：{selected.orderIds.join('、') || '平台未提供订单，请先核对'}</p>{canConfirm && !pending && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={!!busy} onChange={e => setConfirmed(e.target.checked)} />已核对这些订单，并已按平台要求完成实际交接</label>}<div className="flex flex-wrap gap-2"><Button disabled={!!busy || !!pending || !canConfirm || !confirmed} onClick={() => void confirmShipment()}>确认交接发运</Button><Label className="sr-only" htmlFor="ym-shipment-document">交接文件类型</Label><select id="ym-shipment-document" className="h-10 rounded-md border bg-background px-3 text-sm" value={documentType} disabled={!!busy} onChange={e => { setDocumentType(e.target.value as DocumentType); setPdfUrl(''); }}>{(Object.keys(documentLabels) as DocumentType[]).map(type => <option key={type} value={type} disabled={!selected.availableActions.includes(`DOWNLOAD_${type}`)}>{documentLabels[type]}</option>)}</select><Button variant="outline" disabled={!!busy || !selected.availableActions.includes(`DOWNLOAD_${documentType}`)} onClick={() => void previewDocument()}>{spreadsheet ? '读取 Excel' : '预览交接文件'}</Button><Button variant="outline" disabled={!pdf || spreadsheet} onClick={() => iframe.current?.contentWindow?.print()}>打印</Button>{pdf && <a className="self-center text-sm text-primary underline" href={pdf} download={downloadName}>{spreadsheet ? '下载 Excel' : '下载 PDF'}</a>}</div>{!canConfirm && <p className="text-xs text-muted-foreground">平台未提供确认交接动作，或订单清单不完整；仅可读取与预览。</p>}</div>}
      </>}</section></>}
      {pending && <div className="space-y-2 rounded-md border border-amber-300 p-3 text-sm"><p>交接单 {pending.shipmentId} 的请求尚未确认；保留原请求，避免重复交接。</p><Button variant="outline" disabled={!!busy} onClick={() => void confirmShipment()}>核对原交接请求</Button></div>}
      {pdf && !spreadsheet && <iframe ref={iframe} src={pdf} title="Yandex 交接单预览" className="h-[50dvh] w-full rounded-md border" />}
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy === 'write' ? '正在提交或核对交接…' : '正在读取平台数据…'}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div></DialogContent></Dialog>;
}
