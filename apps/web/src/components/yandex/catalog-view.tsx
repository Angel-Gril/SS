'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Row = { offerId?: string; name?: string; cardStatus?: string; errors?: { code?: string; message?: string }[]; warnings?: { code?: string; message?: string }[]; offer?: { offerId: string; name?: string; cardStatus?: string }; mapping?: { marketCategoryName?: string } };
const statusName: Record<string, string> = { HAS_CARD_CAN_UPDATE: '卡片已建立', HAS_CARD_CAN_UPDATE_ERRORS: '卡片有内容错误', HAS_CARD_CAN_NOT_UPDATE: '卡片由平台维护', NO_CARD_NEED_CONTENT: '需补充内容', NO_CARD_MARKET_WILL_CREATE: '平台正在建卡' };

export function YandexCatalogView({ shopId }: { shopId: string }) {
  const [kind, setKind] = useState<'offers' | 'offer-cards'>('offers');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(() => { epoch.current += 1; setRows(null); setNext(null); setError(''); setBusy(false); return () => { epoch.current += 1; }; }, [shopId]);

  async function read(type: typeof kind, pageToken?: string) {
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      const r = await api.post<{ offerMappings?: Row[]; offerCards?: Row[]; nextPageToken: string | null }>(`/api/yandex-market/${encodeURIComponent(shopId)}/${type}/read`, { limit: 50, ...(pageToken ? { pageToken } : {}) }, { timeoutMs: 30000 });
      if (current !== epoch.current) return;
      if (r.code !== 1 || !r.data) throw new Error(r.msg || '读取失败');
      setKind(type); setRows(type === 'offers' ? r.data.offerMappings ?? [] : r.data.offerCards ?? []); setNext(r.data.nextPageToken);
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : '读取失败'); }
    finally { if (current === epoch.current) setBusy(false); }
  }

  return <section className="space-y-3" aria-labelledby="yandex-catalog-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="yandex-catalog-heading" className="font-semibold">Yandex 商品目录</h2><div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={!shopId || busy} onClick={() => read('offers')}>读取目录</Button>
      <Button variant="outline" disabled={!shopId || busy} onClick={() => read('offer-cards')}>读取卡片与错误</Button>
    </div></div>
    {busy && <p role="status" className="text-sm text-muted-foreground">正在读取 Yandex…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {rows !== null && <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>商品 / SKU</TableHead><TableHead>类目</TableHead><TableHead>状态</TableHead><TableHead>待处理问题</TableHead></TableRow></TableHeader><TableBody>
      {!rows.length ? <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">该页没有商品</TableCell></TableRow> : rows.map((row, i) => <TableRow key={row.offerId ?? row.offer?.offerId ?? i}>
        <TableCell className="max-w-sm whitespace-normal break-words"><div>{row.name ?? row.offer?.name}</div><div className="text-xs text-muted-foreground">{row.offerId ?? row.offer?.offerId}</div></TableCell>
        <TableCell>{row.mapping?.marketCategoryName ?? '—'}</TableCell>
        <TableCell><Badge variant={row.errors?.length || row.cardStatus?.includes('ERRORS') ? 'destructive' : 'secondary'}>{statusName[row.cardStatus ?? row.offer?.cardStatus ?? ''] ?? row.cardStatus ?? row.offer?.cardStatus ?? '待平台处理'}</Badge></TableCell>
        <TableCell className="max-w-sm whitespace-normal break-words text-xs">{[...(row.errors ?? []), ...(row.warnings ?? [])].map((item, j) => <p key={j}>{item.message || item.code}</p>)}{!row.errors?.length && !row.warnings?.length && '—'}</TableCell>
      </TableRow>)}
    </TableBody></Table></div>}
    {rows !== null && <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => read(kind)}>回到第一页</Button><Button size="sm" variant="outline" disabled={busy || !next} onClick={() => next && read(kind, next)}>下一页</Button></div>}
  </section>;
}
