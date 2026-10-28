'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';

export function YandexOrderSyncActionDialog({ shopId, open, onOpenChange, sinceDays = 90, onQueued }: { shopId: string; open: boolean; onOpenChange: (open: boolean) => void; sinceDays?: number; onQueued?: () => void }) {
  const [days, setDays] = useState(String(sinceDays)), [busy, setBusy] = useState(false), [job, setJob] = useState(''), [state, setState] = useState(''), [error, setError] = useState('');
  useEffect(() => { if (open) { setDays(String(sinceDays)); setError(''); setState(''); } }, [open, sinceDays]);
  useEffect(() => {
    if (!job) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const r = await api.get<{ status: string; result?: { created?: number; updated?: number; orders?: number }; errorMessage?: string }>(`/api/yandex-market/${encodeURIComponent(shopId)}/sync-order-jobs/${encodeURIComponent(job)}`);
      if (stopped) return;
      if (r.code !== 1 || !r.data) { setError(r.msg || '订单同步进度读取失败'); setJob(''); return; }
      setState(r.data.status);
      if (r.data.status === 'SUCCESS') { setJob(''); toast({ title: `Yandex 订单同步完成：${r.data.result?.orders ?? 0} 单` }); onQueued?.(); onOpenChange(false); }
      else if (r.data.status === 'FAILED') { setJob(''); setError(r.data.errorMessage || '订单同步失败，原数据保留'); }
      else timer = setTimeout(poll, 2000);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [job, shopId]);
  async function submit() {
    const count = Number(days); if (!Number.isInteger(count) || count < 1 || count > 365) { setError('同步范围需为1到365天'); return; }
    setBusy(true); setError('');
    try { const r = await api.post<{ syncJobId: string }>(`/api/yandex-market/${encodeURIComponent(shopId)}/sync-orders`, { since: new Date(Date.now() - count * 86400000).toISOString() }); if (r.code !== 1 || !r.data?.syncJobId) throw Error(r.msg || '订单同步任务创建失败'); setJob(r.data.syncJobId); setState('PENDING'); }
    catch (e) { setError(e instanceof Error ? e.message : '订单同步失败'); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy && !job) onOpenChange(value); }}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>同步 Yandex 订单</DialogTitle><DialogDescription>只读取真实 Yandex 订单、状态、配送服务和轨迹，保存到 ERP。不会调用 Ozon，也不会发货、取消或创建面单。</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor="yandex-order-sync-days">同步最近天数</Label><Input id="yandex-order-sync-days" type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} disabled={busy || !!job} /></div>{job && <p role="status" className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />正在同步：{state}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy || !!job} onClick={() => onOpenChange(false)}>关闭</Button><Button disabled={busy || !!job} onClick={submit}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}开始读取</Button></DialogFooter></DialogContent></Dialog>;
}
