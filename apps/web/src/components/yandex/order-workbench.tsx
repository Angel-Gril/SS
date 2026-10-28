'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { compileYandexBoxInput, yandexCommandOutcome } from './workbench-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Action = 'PACK' | 'READY' | 'CONFIRM' | 'DELIVER' | 'PICKUP' | 'COMPLETE' | 'CANCEL' | 'TRACK';
type Item = { id: number; offerId: string; offerName: string; count: number; requiredInstanceTypes?: string[] | null };
type Box = { items: { id: number; fullCount: number; instances?: Record<string, string>[] }[] };
type Context = { pendingCommand?: Command | null; order: { orderId: number; status: string; substatus: string; items: Item[]; programType?: string; delivery: { serviceName: string; deliveryPartnerType: string; warehouseId?: string; tracks?: { trackCode?: string }[]; boxesLayout?: { boxId: number; items: { id: number; fullCount?: number; instances?: Record<string, string>[] | null }[] }[] } }; actions: Record<Action, boolean> & { label: boolean; reason?: string | null; cancelReasons?: string[] } };
type Command = { action: Action; confirm: true; idempotencyKey: string; boxes?: Box[]; cancelReason?: string; trackCode?: string; deliveryServiceId?: number };
const labels: Record<Action, string> = { PACK: '保存装箱', READY: '确认备货', CONFIRM: '确认 LaaS 订单', DELIVER: '发出配送', PICKUP: '到达自提点', COMPLETE: '确认送达', CANCEL: '取消订单', TRACK: '填写运单' };
const help: Record<Action, string> = { PACK: '每件商品的装箱数量合计必须等于订单数量，不会移除商品。修改装箱后请重新打印面单。', READY: '确认所有商品已完整装箱，平台要求的标记已通过验证，可准备交接。', CONFIRM: '确认接受这笔 LaaS 预留订单，后续配送由平台处理。', DELIVER: '仅在 DBS 订单已交给实际配送服务后确认发出。', PICKUP: '仅在 DBS 包裹已到达自提点、可供买家取货后确认。', COMPLETE: '仅在买家实际收到货物后确认送达。', CANCEL: '取消会影响平台订单，请核对实际原因后提交。', TRACK: '填写 DBS 订单实际承运商和运单号，不会创建物流订单。' };
const cancelLabels: Record<string, string> = { SHOP_FAILED: '卖家无法履约', USER_CHANGED_MIND: '买家改变主意', INCORRECT_PERSONAL_DATA: '买家信息不正确', PICKUP_EXPIRED: '超过自提保管期' };
export function YandexOrderWorkbench({ selection, onClose, onUpdated }: { selection: { id: string; shopId: string } | null; onClose: () => void; onUpdated: () => void }) {
  const [data, setData] = useState<Context | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action>('PACK'), [boxes, setBoxes] = useState<Record<number, number>[]>([]), [marks, setMarks] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('SHOP_FAILED'), [pending, setPending] = useState<Command | null>(null);
  const [trackCode, setTrackCode] = useState(''), [deliveryServiceId, setDeliveryServiceId] = useState('');
  const [services, setServices] = useState<{ id: number; name: string }[]>([]), [servicesError, setServicesError] = useState('');
  const inFlight = useRef(false);
  const [pdf, setPdf] = useState(''), [format, setFormat] = useState('A7');
  const generation = useRef(0), pdfRef = useRef(''), iframe = useRef<HTMLIFrameElement>(null);
  const path = selection ? `/api/yandex-market/${encodeURIComponent(selection.shopId)}/orders/${encodeURIComponent(selection.id)}` : '';
  const storageKey = `ss-erp:yandex-order:${selection?.shopId}:${selection?.id}`;
  function setPdfUrl(next: string) { if (pdfRef.current) URL.revokeObjectURL(pdfRef.current); pdfRef.current = next; setPdf(next); }
  async function refresh(version = generation.current) {
    const r = await api.get<Context>(path + '/workbench');
    if (version !== generation.current) return;
    if (r.code !== 1 || !r.data) throw Error(r.msg || '读取订单失败'); setData(r.data);
    if (r.data.pendingCommand) { setPending(r.data.pendingCommand); sessionStorage.setItem(storageKey, JSON.stringify(r.data.pendingCommand)); }
    setAction(current => r.data!.actions[current] ? current : (Object.keys(labels) as Action[]).find(key => r.data!.actions[key]) ?? 'PACK');
    setReason(current => r.data!.actions.cancelReasons?.includes(current) ? current : r.data!.actions.cancelReasons?.[0] ?? 'SHOP_FAILED');
    const loadedMarks: Record<string, string[]> = {};
    for (const box of r.data.order.delivery.boxesLayout ?? []) for (const item of box.items) for (const instance of item.instances ?? []) {
      for (const kind of ['cis', 'uin', 'rnpt', 'gtd']) if (instance[kind]) { const key = `${item.id}:${kind.toUpperCase()}`; (loadedMarks[key] ??= []).push(instance[kind]!); }
    }
    setMarks(Object.fromEntries(Object.entries(loadedMarks).map(([key, list]) => [key, list.join('\n')])));
    setBoxes(r.data.order.delivery.boxesLayout?.length ? r.data.order.delivery.boxesLayout.map(b => Object.fromEntries(b.items.map(i => [i.id, i.fullCount ?? 0]))) : [Object.fromEntries(r.data.order.items.map(i => [i.id, i.count]))]);
  }
  useEffect(() => {
    const version = ++generation.current; setData(null); setError(''); setNotice(''); setBusy('read'); setMarks({}); setAction('PACK'); setTrackCode(''); setDeliveryServiceId(''); setServices([]); setServicesError(''); setPdfUrl('');
    try { const value = selection ? sessionStorage.getItem(storageKey) : null; setPending(value ? JSON.parse(value) : null); } catch { setPending(null); }
    if (selection) {
      void refresh(version).catch(e => { if (generation.current === version) setError(e.message); }).finally(() => { if (generation.current === version) setBusy(''); });
      void api.get<{ services?: { id: number; name: string }[]; servicesError?: string; servicesUnavailable?: boolean }>(`/api/yandex-market/${encodeURIComponent(selection.shopId)}/logistics`).then(r => {
        if (generation.current !== version) return;
        setServices(r.data?.services ?? []); setServicesError(r.data?.servicesUnavailable ? '平台配送目录暂不可用，请稍后刷新或检查 API 权限' : r.data?.servicesError ?? (r.code !== 1 ? r.msg : ''));
      }).catch(() => { if (generation.current === version) setServicesError('配送服务目录暂不可用，请稍后刷新'); });
    }
    return () => { generation.current++; if (pdfRef.current) URL.revokeObjectURL(pdfRef.current); pdfRef.current = ''; };
  }, [selection?.id, selection?.shopId]);
  async function submit() {
    if (!data || !selection || inFlight.current) return; inFlight.current = true; const version = generation.current; setBusy('write'); setError(''); setNotice(''); setPdfUrl('');
    try {
      const command: Command = pending ?? { action, confirm: true, idempotencyKey: crypto.randomUUID(), ...(action === 'PACK' ? { boxes: compileYandexBoxInput(data.order.items, boxes, marks) } : {}), ...(action === 'CANCEL' ? { cancelReason: reason } : {}), ...(action === 'TRACK' ? { trackCode: trackCode.trim(), deliveryServiceId: Number(deliveryServiceId) } : {}) };
      sessionStorage.setItem(storageKey, JSON.stringify(command)); setPending(command);
      const r = await api.post<{ state: string }>(path + '/commands', command, { timeoutMs: 90000 });
      if (generation.current !== version) return;
      const outcome = yandexCommandOutcome(r);
      if (outcome !== 'PENDING') {
        sessionStorage.removeItem(storageKey); setPending(null);
        if (outcome !== 'SUCCEEDED') throw Error(r.msg || '平台未接受操作');
        setNotice(`${labels[command.action]}已完成。`); onUpdated();
        try { await refresh(version); } catch { setError('操作已完成，但读取最新订单失败；请点击刷新核对。'); }
      } else setNotice(r.msg || '平台仍在处理或结果待确认，使用原请求核对。');
    } catch (e) { if (generation.current === version) setError(e instanceof Error ? e.message : '结果待核对'); }
    finally { inFlight.current = false; if (generation.current === version) setBusy(''); }
  }
  async function previewLabel() {
    const version = generation.current; setBusy('label'); setError('');
    try {
      const r = await api.get<{ base64: string }>(path + `/label?format=${format}&encoding=base64`, { timeoutMs: 45000 });
      if (version !== generation.current) return; if (r.code !== 1 || !r.data?.base64) throw Error(r.msg || '读取面单失败');
      const bytes = Uint8Array.from(atob(r.data.base64), c => c.charCodeAt(0)); setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
    } catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : '面单读取失败'); }
    finally { if (version === generation.current) setBusy(''); }
  }
  let boxError = '';
  if (action === 'PACK' && data) try { compileYandexBoxInput(data.order.items, boxes, marks); } catch (e) { boxError = e instanceof Error ? e.message : '请检查装箱信息'; }
  const invalidTrack = action === 'TRACK' && (!trackCode.trim() || trackCode.trim().length > 200 || !services.some(service => String(service.id) === deliveryServiceId));
  return <Dialog open={!!selection} onOpenChange={open => { if (!open && busy !== 'write') onClose(); }}><DialogContent className="flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden"><DialogHeader className="pr-8"><DialogTitle>Yandex 订单处理 · {data?.order.orderId ?? ''}</DialogTitle><DialogDescription>读取当前平台状态后操作。箱子和面单使用 Yandex ID；交接不会创建 Ozon 物流订单。</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2"><Badge>{data?.order.programType || '读取中'}</Badge><span className="text-sm">{data?.order.status} / {data?.order.substatus}</span><Button variant="outline" size="sm" disabled={!!busy} onClick={() => { setBusy('read'); refresh().catch(e => setError(e.message)).finally(() => setBusy('')); }}>刷新订单</Button></div>
      {data && <><div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2"><span>配送服务：{data.order.delivery.serviceName}</span><span>配送安排：{data.order.delivery.deliveryPartnerType === 'YANDEX_MARKET' ? '平台安排' : data.order.delivery.deliveryPartnerType === 'SHOP' ? '卖家安排' : '待确认'}</span><span>仓库：{data.order.delivery.warehouseId || '平台未提供'}</span><span>运单：{data.order.delivery.tracks?.map(t => t.trackCode).filter(Boolean).join('、') || '暂无'}</span></div>
      {['FBS', 'EXPRESS'].includes(data.order.programType ?? '') && data.order.substatus === 'READY_TO_SHIP' && <p className="rounded-md bg-muted p-3 text-sm">已备货的订单请在“Yandex 店铺 → 仓库与物流 → 交接发运”按平台交接单处理。</p>}
      {data.actions.reason && <p className="text-sm text-muted-foreground">{data.actions.reason}</p>}
      <fieldset disabled={!!pending || !!busy} className="min-w-0 space-y-3"><div className="flex flex-wrap gap-2">{(Object.keys(labels) as Action[]).map(key => <Button key={key} size="sm" variant={action === key ? 'default' : 'outline'} disabled={!data.actions[key]} onClick={() => setAction(key)}>{labels[key]}</Button>)}</div>
      <p className="text-sm text-muted-foreground">{help[pending?.action ?? action]}</p>
      {action === 'PACK' && <div className="space-y-3">{boxes.map((box, index) => <div className="rounded-md border p-3" key={index}><div className="mb-2 flex items-center justify-between"><h3 className="font-medium">箱 {index + 1}</h3><Button size="sm" variant="ghost" disabled={boxes.length === 1} onClick={() => setBoxes(b => b.filter((_, i) => i !== index))}>移除空箱</Button></div>{data.order.items.map(item => <div key={item.id} className="mb-2 flex items-center gap-3"><Label htmlFor={`box-${index}-${item.id}`} className="min-w-0 flex-1 break-words">{item.offerName} · {item.offerId}（共{item.count}件）</Label><Input id={`box-${index}-${item.id}`} className="w-24" type="number" min="0" max={item.count} step="1" value={box[item.id] ?? 0} onChange={e => setBoxes(rows => rows.map((row, i) => i === index ? { ...row, [item.id]: Number(e.target.value) } : row))} /></div>)}</div>)}<Button size="sm" variant="outline" disabled={boxes.length >= 100} onClick={() => setBoxes(b => [...b, {}])}>添加箱子</Button>
      {data.order.items.filter(i => i.requiredInstanceTypes?.length).map(item => <div key={item.id} className="space-y-2"><p className="text-sm">{item.offerName} 的商品标记（每行一个）</p>{item.requiredInstanceTypes?.map(kind => <div key={kind}><Label htmlFor={`marks-${item.id}-${kind}`}>{kind}{kind === 'CIS_OPTIONAL' ? '（选填）' : '（必填）'}</Label><textarea id={`marks-${item.id}-${kind}`} className="min-h-20 w-full rounded-md border p-2 text-sm" value={marks[`${item.id}:${kind === 'CIS_OPTIONAL' ? 'CIS' : kind}`] ?? ''} onChange={e => setMarks(m => ({ ...m, [`${item.id}:${kind === 'CIS_OPTIONAL' ? 'CIS' : kind}`]: e.target.value }))} /></div>)}</div>)}{boxError && <p className="text-sm text-destructive">{boxError}</p>}</div>}
      {action === 'CANCEL' && <div><Label htmlFor="ym-cancel-reason">取消原因</Label><select id="ym-cancel-reason" className="h-10 w-full rounded-md border bg-background px-3" value={reason} onChange={e => setReason(e.target.value)}>{(data.actions.cancelReasons ?? ['SHOP_FAILED']).map(value => <option value={value} key={value}>{cancelLabels[value] ?? value}</option>)}</select></div>}
      {action === 'TRACK' && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="ym-track-service">配送服务</Label><select id="ym-track-service" className="h-10 w-full rounded-md border bg-background px-3" value={deliveryServiceId} onChange={e => setDeliveryServiceId(e.target.value)}><option value="">选择实际承运商</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>{servicesError && <p className="text-sm text-destructive">{servicesError}</p>}</div><div><Label htmlFor="ym-track-code">运单号</Label><Input id="ym-track-code" value={trackCode} maxLength={200} onChange={e => setTrackCode(e.target.value)} /></div></div>}
      </fieldset></>}
      <div className="flex flex-wrap gap-2"><Button disabled={!!busy || (!pending && (!data?.actions[action] || !!boxError || !!invalidTrack))} onClick={submit}>{pending ? '核对原请求' : labels[action]}</Button>{pending && <span className="self-center text-xs text-muted-foreground">当前订单操作结果未决，保留原请求核对。</span>}</div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3"><Label htmlFor="ym-label-format">面单尺寸</Label><select id="ym-label-format" className="h-9 rounded-md border bg-background px-2" value={format} onChange={e => { setFormat(e.target.value); setPdfUrl(''); }}><option>A7</option><option>A9</option><option value="A9_HORIZONTALLY">A9 横向</option><option>A4</option></select><Button size="sm" variant="outline" disabled={!!busy || !data?.actions.label} onClick={previewLabel}>预览面单</Button><Button size="sm" variant="outline" disabled={!pdf} onClick={() => iframe.current?.contentWindow?.print()}>打印</Button>{pdf && <a className="text-sm text-primary underline" href={pdf} download={`yandex-${data?.order.orderId}-${format}.pdf`}>下载 PDF</a>}</div>
      {pdf && <iframe ref={iframe} className="h-[50dvh] w-full rounded-md border" src={pdf} title="Yandex 面单预览" />}
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy === 'write' ? '正在提交或核对订单…' : '正在读取…'}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div></DialogContent></Dialog>;
}
