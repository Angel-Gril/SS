'use client';

import { useEffect, useState } from 'react';
import { Loader2, Truck, Search, Link2, Globe, MapPin, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { resolveOrderFulfillmentStage } from 'shared/order-fulfillment-stage';

interface Order {
  id: string;
  shopId: string;
  platformOrderId: string;
  postingNumber: string | null;
  status: string;
  subStatus: string | null;
  totalAmount: string;
  currency: string;
  items: any[] | null;
  trackingNumber: string | null;
  inProcessAt: string | null;
  shipmentDate: string | null;
  deliveringDate: string | null;
  deliveredAt: string | null;
  createdAt: string;
  domesticTrackingNumber: string | null;
  domesticCarrier: string | null;
  domesticStatus: string | null;
  internationalTrackingNumber: string | null;
  internationalCarrier: string | null;
  internationalStatus: string | null;
  purchaseOrderId: string | null;
  purchasePlatform: string | null;
  inspectionStatus: string | null;
  warehouseScanInAt: string | null;
  warehouseScanOutAt: string | null;
  labelPrintedAt: string | null;
  shop: { name: string; platform: string };
}
interface Shop {
  id: string;
  name: string;
  platform: string;
}

interface CainiaoPackage {
  id: string;
  trackingNumber: string;
  carrier: string | null;
  carrierCode: string | null;
  status: string | null;
  statusDesc: string | null;
  updateTime: string | null;
  sender: string | null;
  receiver: string | null;
  boundToOrderId: string | null;
  syncedAt: string;
}

const DOMESTIC_CARRIERS = ['顺丰', '圆通', '中通', '韵达', '极兔', '申通', '百世', 'EMS', '邮政', '其他'];
const PURCHASE_PLATFORMS = [
  { value: '1688', label: '1688' },
  { value: 'taobao', label: '淘宝' },
  { value: 'pinduoduo', label: '拼多多' },
  { value: 'other', label: '其他' },
];

export default function LogisticsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [shopId, setShopId] = useState('');
  const [page, setPage] = useState(0);
  const [domesticDialog, setDomesticDialog] = useState<Order | null>(null);
  const [internationalDialog, setInternationalDialog] = useState<Order | null>(null);
  const [logisticsDetail, setLogisticsDetail] = useState<Order | null>(null);
  const limit = 20;

  useEffect(() => {
    api.get<Shop[]>('/api/shops').then((res) => {
      if (res.code === 1 && res.data) setShops(res.data);
    });
  }, []);

  useEffect(() => { loadOrders(); }, [search, shopId, page]);

  async function loadOrders() {
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(page * limit),
      limit: String(limit),
    });
    if (shopId) params.set('shopId', shopId);
    if (search) params.set('search', search);
    const res = await api.get<{ total: number; rows: Order[] }>(`/api/orders?${params}`);
    if (res.code === 1 && res.data) {
      setOrders(res.data.rows);
      setTotal(res.data.total);
    }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">物流绑定</h1>
        <p className="text-muted-foreground mt-1">绑定国内快递单号和国际物流单号到订单</p>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={shopId}
              onChange={(e) => { setShopId(e.target.value); setPage(0); }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">全部店铺</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>[{s.platform}] {s.name}</option>
              ))}
            </select>

            <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }} className="flex items-center gap-2 flex-1 max-w-sm">
              <Input
                placeholder="搜索订单号/国内单号/国际单号"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9"
              />
              <Button type="submit" size="sm" variant="outline">
                <Search className="h-4 w-4" />
              </Button>
            </form>

            <span className="ml-auto text-sm text-muted-foreground">共 {total} 条</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && orders.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">暂无订单数据</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>订单号</TableHead>
                  <TableHead>店铺</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>国内物流</TableHead>
                  <TableHead>国际物流</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">
                      {order.postingNumber || order.platformOrderId}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline">{order.shop.platform}</Badge>
                      <span className="ml-1">{order.shop.name}</span>
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      {order.items && Array.isArray(order.items) ? (
                        <div className="flex items-center gap-2">
                          {(() => {
                            const img = (order.items as any[])[0]?.primary_image || (order.items as any[])[0]?.image;
                            return img ? (
                              <img src={img} alt="" className="w-9 h-9 rounded border object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : null;
                          })()}
                          <div className="min-w-0">
                            <div className="text-xs truncate">{(order.items as any[])[0]?.name || '-'}</div>
                            {(order.items as any[]).length > 1 && <div className="text-xs text-muted-foreground">+{(order.items as any[]).length - 1} 件</div>}
                          </div>
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {order.domesticTrackingNumber ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-blue-500" />
                            <span className="text-xs font-mono">{order.domesticTrackingNumber}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{order.domesticCarrier}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">未绑定</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.internationalTrackingNumber ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1">
                            <Globe className="h-3 w-3 text-green-500" />
                            <span className="text-xs font-mono">{order.internationalTrackingNumber}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{order.internationalCarrier}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">未绑定</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LogisticsStatusBadge order={order} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setDomesticDialog(order)}
                        >
                          <MapPin className="h-3 w-3" />
                          国内
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setInternationalDialog(order)}
                        >
                          <Globe className="h-3 w-3" />
                          国际
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="查看物流详情"
                          onClick={() => setLogisticsDetail(order)}
                        >
                          <Truck className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一页</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <DomesticTrackingDialog
        order={domesticDialog}
        onClose={() => setDomesticDialog(null)}
        onSuccess={() => { setDomesticDialog(null); loadOrders(); }}
      />
      <InternationalTrackingDialog
        order={internationalDialog}
        onClose={() => setInternationalDialog(null)}
        onSuccess={() => { setInternationalDialog(null); loadOrders(); }}
      />
      <LogisticsDetailDialog
        order={logisticsDetail}
        onClose={() => setLogisticsDetail(null)}
      />
    </div>
  );
}
function DomesticTrackingDialog({ order, onClose, onSuccess }: {
  order: Order | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('顺丰');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [purchasePlatform, setPurchasePlatform] = useState('');
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<'manual' | 'cainiao'>('manual');
  const [cainiaoPackages, setCainiaoPackages] = useState<CainiaoPackage[]>([]);
  const [loadingCainiao, setLoadingCainiao] = useState(false);

  useEffect(() => {
    if (order) {
      setTrackingNumber(order.domesticTrackingNumber || '');
      setCarrier(order.domesticCarrier || '顺丰');
      setPurchaseOrderId(order.purchaseOrderId || '');
      setPurchasePlatform(order.purchasePlatform || '');
      setPurchaseAmount('');
      setTab('manual');
      setCainiaoPackages([]);
    }
  }, [order?.id]);

  async function loadCainiaoPackages() {
    setLoadingCainiao(true);
    const res = await api.get<CainiaoPackage[]>('/api/logistics/cainiao-packages?bound=false');
    if (res.code === 1 && res.data) setCainiaoPackages(res.data);
    setLoadingCainiao(false);
  }

  function selectCainiaoPackage(pkg: CainiaoPackage) {
    setTrackingNumber(pkg.trackingNumber);
    setCarrier(pkg.carrier || '其他');
    setTab('manual');
    toast({ title: `已选择包裹 ${pkg.trackingNumber}` });
  }

  async function bindCainiaoDirectly(pkg: CainiaoPackage) {
    if (!order) return;
    setSubmitting(true);
    const res = await api.post(`/api/logistics/cainiao-packages/${pkg.id}/bind`, { orderId: order.id });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '菜鸟包裹绑定成功' });
      onSuccess();
    } else {
      toast({ title: (res as any).msg || '绑定失败', variant: 'destructive' });
    }
  }

  async function handleSubmit() {
    if (!order || !trackingNumber.trim()) {
      toast({ title: '请填写国内快递单号', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const body: Record<string, unknown> = {
      domesticTrackingNumber: trackingNumber.trim(),
      domesticCarrier: carrier,
    };
    if (purchaseOrderId) body.purchaseOrderId = purchaseOrderId;
    if (purchasePlatform) body.purchasePlatform = purchasePlatform;
    if (purchaseAmount && !isNaN(Number(purchaseAmount))) {
      body.purchaseAmount = Number(purchaseAmount);
    }

    const res = await api.put(`/api/orders/${order.id}/domestic-tracking`, body);
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '国内快递单号绑定成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '绑定失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-500" />
            绑定国内快递单号
          </DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm space-y-1 p-3 bg-muted/50 rounded-md">
              <div><span className="text-muted-foreground">订单号：</span><span className="font-mono">{order.postingNumber || order.platformOrderId}</span></div>
              <div><span className="text-muted-foreground">店铺：</span>{order.shop.name}</div>
            </div>

            {/* Tab 切换 */}
            <div className="flex border-b">
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'manual' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab('manual')}
              >
                手动填写
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1 ${tab === 'cainiao' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => { setTab('cainiao'); if (cainiaoPackages.length === 0) loadCainiaoPackages(); }}
              >
                <Package className="h-3.5 w-3.5" />
                从菜鸟选择
              </button>
            </div>

            {tab === 'manual' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">快递公司 *</Label>
                  <select
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {DOMESTIC_CARRIERS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">快递单号 *</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="输入国内快递单号"
                  />
                </div>

                <div className="border-t pt-3 space-y-3">
                  <div className="text-xs font-medium text-muted-foreground">采购信息 (可选)</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">采购平台</Label>
                      <select
                        value={purchasePlatform}
                        onChange={(e) => setPurchasePlatform(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">请选择</option>
                        {PURCHASE_PLATFORMS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">采购金额 (CNY)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={purchaseAmount}
                        onChange={(e) => setPurchaseAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">采购单号</Label>
                    <Input
                      value={purchaseOrderId}
                      onChange={(e) => setPurchaseOrderId(e.target.value)}
                      placeholder="供应商订单号"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {loadingCainiao ? (
                  <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : cainiaoPackages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    暂无未绑定的菜鸟包裹
                    <div className="mt-2">
                      <Button size="sm" variant="outline" onClick={loadCainiaoPackages}>刷新</Button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-[300px] overflow-y-auto space-y-1">
                    {cainiaoPackages.map((pkg) => (
                      <div key={pkg.id} className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50 transition-colors">
                        <div className="space-y-0.5">
                          <div className="text-xs font-mono font-medium">{pkg.trackingNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {pkg.carrier || '未知快递'} {pkg.statusDesc ? `· ${pkg.statusDesc}` : ''} {pkg.updateTime ? `· ${pkg.updateTime}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => selectCainiaoPackage(pkg)}>
                            填入
                          </Button>
                          <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => bindCainiaoDirectly(pkg)} disabled={submitting}>
                            绑定
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          {tab === 'manual' && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              确认绑定
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function InternationalTrackingDialog({ order, onClose, onSuccess }: {
  order: Order | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      setTrackingNumber(order.internationalTrackingNumber || '');
      setCarrier(order.internationalCarrier || '');
    }
  }, [order?.id]);

  async function handleSubmit() {
    if (!order || !trackingNumber.trim() || !carrier.trim()) {
      toast({ title: '请填写完整的国际物流信息', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const res = await api.put(`/api/orders/${order.id}/international-tracking`, {
      internationalTrackingNumber: trackingNumber.trim(),
      internationalCarrier: carrier.trim(),
    });
    setSubmitting(false);
    if (res.code === 1) {
      toast({ title: '国际物流单号绑定成功' });
      onSuccess();
    } else {
      toast({ title: res.msg || '绑定失败', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-green-500" />
            绑定国际物流单号
          </DialogTitle>
        </DialogHeader>
        {order && (
          <div className="space-y-4">
            <div className="text-sm space-y-1 p-3 bg-muted/50 rounded-md">
              <div><span className="text-muted-foreground">订单号：</span><span className="font-mono">{order.postingNumber || order.platformOrderId}</span></div>
              <div><span className="text-muted-foreground">店铺：</span>{order.shop.name}</div>
              {order.domesticTrackingNumber && (
                <div><span className="text-muted-foreground">国内单号：</span><span className="font-mono">{order.domesticTrackingNumber}</span> ({order.domesticCarrier})</div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">国际物流公司 *</Label>
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="如: CDEK, DPD, Boxberry, SPSR 等"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">国际物流单号 *</Label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="输入国际物流单号"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            确认绑定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogisticsDetailDialog({ order, onClose }: {
  order: Order | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!order) { setDetail(null); return; }
    setLoading(true);
    api.get(`/api/orders/${order.id}/logistics`).then((res: any) => {
      if (res.code === 1 && res.data) setDetail(res.data);
      setLoading(false);
    });
  }, [order?.id]);

  return (
    <Dialog open={!!order} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>物流详情</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="text-sm p-3 bg-muted/50 rounded-md">
              <div><span className="text-muted-foreground">订单号：</span><span className="font-mono">{detail.postingNumber || detail.platformOrderId}</span></div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-muted-foreground">履约阶段：</span>
                <LogisticsStatusBadge order={detail as Order} />
              </div>
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-blue-50 dark:bg-blue-950/30 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> 采购 & 国内物流
              </div>
              <div className="p-3 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground text-xs">采购平台：</span>{detail.purchase?.platform || '-'}</div>
                  <div><span className="text-muted-foreground text-xs">采购单号：</span><span className="font-mono text-xs">{detail.purchase?.orderId || '-'}</span></div>
                  <div><span className="text-muted-foreground text-xs">采购金额：</span>{detail.purchase?.amount ? `CNY ${detail.purchase.amount}` : '-'}</div>
                </div>
                <div className="border-t pt-2 grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground text-xs">快递公司：</span>{detail.domestic?.carrier || '-'}</div>
                  <div><span className="text-muted-foreground text-xs">快递单号：</span><span className="font-mono text-xs">{detail.domestic?.trackingNumber || '-'}</span></div>
                  <div><span className="text-muted-foreground text-xs">状态：</span><DomesticStatusBadge status={detail.domestic?.status} /></div>
                </div>
              </div>
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-green-50 dark:bg-green-950/30 flex items-center gap-1">
                <Globe className="h-3 w-3" /> 国际物流
              </div>
              <div className="p-3 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground text-xs">物流公司：</span>{detail.international?.carrier || '-'}</div>
                  <div><span className="text-muted-foreground text-xs">物流单号：</span><span className="font-mono text-xs">{detail.international?.trackingNumber || '-'}</span></div>
                  <div><span className="text-muted-foreground text-xs">状态：</span><InternationalStatusBadge order={detail} /></div>
                </div>
              </div>
            </div>

            <div className="border rounded-md">
              <div className="px-3 py-2 text-xs font-medium border-b bg-muted/40 flex items-center gap-1">
                <Truck className="h-3 w-3" /> 平台物流 (OZON)
              </div>
              <div className="p-3 space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground text-xs">物流方式：</span>{detail.platform?.shippingMethod || '-'}</div>
                  <div><span className="text-muted-foreground text-xs">平台单号：</span><span className="font-mono text-xs">{detail.platform?.trackingNumber || '-'}</span></div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LogisticsStatusBadge({ order }: { order: Order }) {
  const stage = resolveOrderFulfillmentStage(order);
  return <Badge variant={stage.variant}>{stage.label}</Badge>;
}

function DomesticStatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' }> = {
    pending: { label: '待发货', variant: 'secondary' },
    shipped: { label: '已发出', variant: 'warning' },
    received: { label: '已签收', variant: 'success' },
  };
  const info = map[status || 'pending'] || { label: status || '-', variant: 'secondary' as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function InternationalStatusBadge({ order }: { order: any }) {
  const stage = resolveOrderFulfillmentStage(order);
  if (stage.key === 'delivered') return <Badge variant="success">已送达</Badge>;
  if (stage.key === 'delivering') return <Badge variant="success">出库发运</Badge>;
  if (stage.key === 'warehouse_processing') return <Badge variant={stage.variant}>{stage.label}</Badge>;
  if (order.internationalTrackingNumber || order.trackingNumber || order.international?.trackingNumber) {
    return <Badge variant="warning">国际单已生成</Badge>;
  }
  return <Badge variant="secondary">待发出</Badge>;
}
