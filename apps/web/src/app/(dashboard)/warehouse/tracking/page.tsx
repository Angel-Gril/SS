'use client';

import { useEffect, useState } from 'react';
import { Truck, Loader2, Search, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Order {
  id: string;
  postingNumber: string | null;
  platformOrderId: string;
  trackingNumber: string | null;
  domesticTrackingNumber: string | null;
  shippingMethod: string | null;
  status: string;
  subStatus: string | null;
  shipmentDate: string | null;
  deliveringDate: string | null;
  inProcessAt: string | null;
  createdAt: string;
  shop: { name: string; platform: string };
}

export default function TrackingPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => { fetchData(); }, [search, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ status: 'delivering', offset: String(page * limit), limit: String(limit) });
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: Order[] }>(`/api/orders?${params}`);
    if (res.code === 1 && res.data) { setOrders(res.data.rows); setTotal(res.data.total); }
    setLoading(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast({ title: '已复制', description: text });
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">物流单号</h1>
        <p className="text-muted-foreground text-sm mt-1">查看和管理已发货订单的物流信息</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索物流单号/订单号" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-64" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条运输中</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>包裹号</TableHead>
                <TableHead>物流单号</TableHead>
                <TableHead>物流方式</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>发货时间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>查物流</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
              ) : orders.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">暂无运输中的订单</TableCell></TableRow>
              ) : orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">{order.postingNumber || order.platformOrderId}</span>
                      <button onClick={() => copyToClipboard(order.postingNumber || order.platformOrderId)} className="text-muted-foreground hover:text-foreground">
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    {order.trackingNumber ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{order.trackingNumber}</span>
                        <button onClick={() => copyToClipboard(order.trackingNumber!)} className="text-muted-foreground hover:text-foreground">
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    ) : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>{order.shippingMethod || '-'}</TableCell>
                  <TableCell><Badge variant="outline">{order.shop.name}</Badge></TableCell>
                  <TableCell className="text-sm">{order.shipmentDate ? formatDate(order.shipmentDate) : '-'}</TableCell>
                  <TableCell><Badge variant="secondary"><Truck className="mr-1 h-3 w-3" />运输中</Badge></TableCell>
                  <TableCell>
                    {(() => {
                      const hasDomestic = !!order.domesticTrackingNumber;
                      const hasInternational = !!order.trackingNumber;

                      if (!hasDomestic && !hasInternational) {
                        return <span className="text-xs text-muted-foreground">无单号</span>;
                      }

                      return (
                        <div className="flex items-center gap-1 flex-wrap">
                          {hasDomestic && (
                            <a
                              href={`https://global.cainiao.com/detail.htm?mailNoList=${encodeURIComponent(order.domesticTrackingNumber!)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border bg-muted/40 hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                              title={`在菜鸟国际查询 ${order.domesticTrackingNumber}`}
                            >
                              菜鸟国际
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                          {hasInternational && (
                            <>
                              <a
                                href={`https://tracking.ozon.ru/?track=${encodeURIComponent(order.trackingNumber!)}&local=zh-Hans`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border bg-muted/40 hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                                title={`在 OZON 查询 ${order.trackingNumber}`}
                              >
                                OZON Track
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              <a
                                href={`https://t.17track.net/zh-cn#nums=${encodeURIComponent(order.trackingNumber!)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded border bg-muted/40 hover:bg-primary/5 hover:border-primary/40 hover:text-primary transition-colors"
                                title={`在 17TRACK 查询 ${order.trackingNumber}`}
                              >
                                17TRACK
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
