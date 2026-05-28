'use client';

import { useEffect, useState } from 'react';
import {
  Warehouse, PackagePlus, PackageMinus, ClipboardList, Loader2, Plus, Search,
  RefreshCw, Store, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface InventoryItem {
  id: string;
  sku: string;
  productName: string;
  quantity: number;
  costPrice: string | null;
  location: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InventoryRecord {
  id: string;
  itemId: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  costPrice: string | null;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  item?: { sku: string; productName: string };
}

interface PlatformWarehouse {
  id: string;
  shopId: string;
  platformWarehouseId: string | null;
  name: string;
  type: string | null;
  status: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  firstMileType: string | null;
  dropOffPointId: string | null;
  dropOffTimeslotId: number | null;
  isKgt: boolean;
  isRfbs: boolean;
  workingDays: number[] | null;
  warehouseOptions: any;
  createdAt: string;
  updatedAt: string;
  deliveryMethods: DeliveryMethod[];
}

interface DeliveryMethod {
  id: string;
  platformMethodId: number;
  name: string;
  status: string | null;
  providerId: number | null;
  cutoff: string | null;
  slaCutIn: number | null;
  tplIntegrationType: string | null;
  dropOffPointAddress: string | null;
  dropOffPointName: string | null;
}

interface Shop {
  id: string;
  name: string;
  platform: string;
}

type TabType = 'platform' | 'items' | 'inbound' | 'outbound' | 'records';

export default function WarehousesPage() {
  const [tab, setTab] = useState<TabType>('platform');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogType, setDialogType] = useState<'add' | 'in' | 'out' | 'adjust'>('add');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState({ sku: '', productName: '', quantity: '0', costPrice: '', location: '', reason: '' });
  const limit = 20;

  useEffect(() => { if (tab !== 'platform') fetchData(); }, [tab, search, page]);

  async function fetchData() {
    setLoading(true);
    if (tab === 'items') {
      const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
      if (search) params.set('search', search);
      const res = await api.get<{ total: number; rows: InventoryItem[] }>(`/api/inventory?${params}`);
      if (res.code === 1 && res.data) { setItems(res.data.rows); setTotal(res.data.total); }
    } else {
      const typeMap: Record<string, string> = { inbound: 'IN', outbound: 'OUT', records: '' };
      const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
      if (typeMap[tab]) params.set('type', typeMap[tab]);
      if (search) params.set('search', search);
      const res = await api.get<{ total: number; rows: InventoryRecord[] }>(`/api/inventory/records?${params}`);
      if (res.code === 1 && res.data) { setRecords(res.data.rows); setTotal(res.data.total); }
    }
    setLoading(false);
  }

  function openDialog(type: 'add' | 'in' | 'out' | 'adjust', item?: InventoryItem) {
    setDialogType(type);
    setSelectedItem(item || null);
    setFormData({ sku: item?.sku || '', productName: item?.productName || '', quantity: '0', costPrice: item?.costPrice || '', location: item?.location || '', reason: '' });
    setShowDialog(true);
  }

  async function handleSubmit() {
    if (dialogType === 'add') {
      const res = await api.post('/api/inventory', {
        sku: formData.sku,
        productName: formData.productName,
        costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
        location: formData.location || undefined,
      });
      if (res.code === 1) { toast({ title: '添加成功' }); setShowDialog(false); fetchData(); }
      else toast({ title: '添加失败', description: res.msg, variant: 'destructive' });
    } else {
      const typeMap = { in: 'IN', out: 'OUT', adjust: 'ADJUST' } as const;
      const res = await api.post(`/api/inventory/${selectedItem?.id}/record`, {
        type: typeMap[dialogType],
        quantity: parseInt(formData.quantity, 10),
        costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
        reason: formData.reason || undefined,
      });
      if (res.code === 1) { toast({ title: '操作成功' }); setShowDialog(false); fetchData(); }
      else toast({ title: '操作失败', description: res.msg, variant: 'destructive' });
    }
  }

  const TABS = [
    { key: 'platform' as const, label: '平台仓库', icon: Store },
    { key: 'items' as const, label: '库存商品', icon: ClipboardList },
    { key: 'inbound' as const, label: '入库记录', icon: PackagePlus },
    { key: 'outbound' as const, label: '出库记录', icon: PackageMinus },
    { key: 'records' as const, label: '全部记录', icon: Warehouse },
  ];

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">仓库管理</h1>
          <p className="text-muted-foreground text-sm mt-1">库存管理、入库出库操作、盘点记录</p>
        </div>
        <Button onClick={() => openDialog('add')}>
          <Plus className="mr-2 h-4 w-4" /> 添加商品
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? 'default' : 'outline'}
            onClick={() => { setTab(t.key); setPage(0); }}
          >
            <t.icon className="mr-1.5 h-4 w-4" /> {t.label}
          </Button>
        ))}
      </div>

      {tab === 'platform' ? (
        <PlatformWarehousesTab />
      ) : (
      <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(0); }}>
              <Input placeholder="搜索 SKU / 商品名" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-64" />
              <Button type="submit" size="sm" variant="outline"><Search className="h-4 w-4" /></Button>
            </form>
            <span className="text-sm text-muted-foreground ml-auto">共 {total} 条</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tab === 'items' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>商品名称</TableHead>
                  <TableHead>库存数量</TableHead>
                  <TableHead>成本价</TableHead>
                  <TableHead>库位</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">暂无库存商品</TableCell></TableRow>
                ) : items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell>
                      <Badge variant={item.quantity > 0 ? 'default' : 'destructive'}>{item.quantity}</Badge>
                    </TableCell>
                    <TableCell>{item.costPrice ? `¥${item.costPrice}` : '-'}</TableCell>
                    <TableCell>{item.location || '-'}</TableCell>
                    <TableCell className="text-sm">{formatDate(item.updatedAt)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => openDialog('in', item)}>入库</Button>
                      <Button size="sm" variant="outline" onClick={() => openDialog('out', item)}>出库</Button>
                      <Button size="sm" variant="ghost" onClick={() => openDialog('adjust', item)}>盘点</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>数量</TableHead>
                  <TableHead>原因</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow>
                ) : records.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">暂无记录</TableCell></TableRow>
                ) : records.map((rec) => (
                  <TableRow key={rec.id}>
                    <TableCell className="font-mono text-xs">{rec.item?.sku || '-'}</TableCell>
                    <TableCell>{rec.item?.productName || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={rec.type === 'IN' ? 'default' : rec.type === 'OUT' ? 'secondary' : 'outline'}>
                        {rec.type === 'IN' ? '入库' : rec.type === 'OUT' ? '出库' : '盘点'}
                      </Badge>
                    </TableCell>
                    <TableCell className={rec.type === 'IN' ? 'text-green-600' : rec.type === 'OUT' ? 'text-red-600' : ''}>
                      {rec.type === 'IN' ? '+' : rec.type === 'OUT' ? '-' : ''}{rec.quantity}
                    </TableCell>
                    <TableCell>{rec.reason || '-'}</TableCell>
                    <TableCell>{rec.operator || '-'}</TableCell>
                    <TableCell className="text-sm">{formatDate(rec.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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

      {/* Dialog for add/in/out/adjust */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogType === 'add' ? '添加库存商品' : dialogType === 'in' ? '入库操作' : dialogType === 'out' ? '出库操作' : '库存盘点'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {dialogType === 'add' ? (
              <>
                <div>
                  <label className="text-sm font-medium">SKU</label>
                  <Input value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} placeholder="商品 SKU" />
                </div>
                <div>
                  <label className="text-sm font-medium">商品名称</label>
                  <Input value={formData.productName} onChange={(e) => setFormData({ ...formData, productName: e.target.value })} placeholder="商品名称" />
                </div>
                <div>
                  <label className="text-sm font-medium">成本价</label>
                  <Input type="number" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })} placeholder="可选" />
                </div>
                <div>
                  <label className="text-sm font-medium">库位</label>
                  <Input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="如 A-01-03" />
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-lg bg-muted">
                  <p className="text-sm"><span className="text-muted-foreground">商品:</span> {selectedItem?.productName}</p>
                  <p className="text-sm"><span className="text-muted-foreground">SKU:</span> {selectedItem?.sku}</p>
                  <p className="text-sm"><span className="text-muted-foreground">当前库存:</span> {selectedItem?.quantity}</p>
                </div>
                <div>
                  <label className="text-sm font-medium">{dialogType === 'adjust' ? '调整后数量' : '数量'}</label>
                  <Input type="number" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: e.target.value })} min="0" />
                </div>
                {dialogType !== 'adjust' && (
                  <div>
                    <label className="text-sm font-medium">成本价</label>
                    <Input type="number" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })} placeholder="可选" />
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium">原因/备注</label>
                  <Input value={formData.reason} onChange={(e) => setFormData({ ...formData, reason: e.target.value })} placeholder="如: 采购入库 / 订单出库" />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>取消</Button>
            <Button onClick={handleSubmit}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
      )}
    </div>
  );
}

function PlatformWarehousesTab() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [warehousesByShop, setWarehousesByShop] = useState<Record<string, PlatformWarehouse[]>>({});
  const [loading, setLoading] = useState(true);
  const [syncingShopId, setSyncingShopId] = useState<string | null>(null);
  const [editingWh, setEditingWh] = useState<{ shopId: string; wh: PlatformWarehouse } | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const shopsRes = await api.get<Shop[]>('/api/shops');
    if (shopsRes.code === 1 && shopsRes.data) {
      setShops(shopsRes.data);
      const warehouseMap: Record<string, PlatformWarehouse[]> = {};
      await Promise.all(
        shopsRes.data
          .filter((s) => s.platform === 'OZON')
          .map(async (shop) => {
            const whRes = await api.get<PlatformWarehouse[]>(`/api/shops/${shop.id}/warehouses`);
            if (whRes.code === 1 && whRes.data) {
              warehouseMap[shop.id] = whRes.data;
            }
          }),
      );
      setWarehousesByShop(warehouseMap);
    }
    setLoading(false);
  }

  async function handleSync(shopId: string) {
    setSyncingShopId(shopId);
    const res = await api.post(`/api/shops/${shopId}/sync-warehouses`, {});
    setSyncingShopId(null);
    if (res.code === 1) { toast({ title: res.msg }); loadData(); }
    else toast({ title: res.msg, variant: 'destructive' });
  }

  const ozonShops = shops.filter((s) => s.platform === 'OZON');

  if (loading) {
    return <Card><CardContent className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }

  if (ozonShops.length === 0) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground"><Warehouse className="h-10 w-10 mx-auto mb-3 opacity-50" />暂无 OZON 店铺，请先添加店铺</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {ozonShops.map((shop) => {
        const warehouses = warehousesByShop[shop.id] || [];
        return (
          <Card key={shop.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  {shop.name}
                  <Badge variant="outline" className="ml-2">{shop.platform}</Badge>
                </CardTitle>
                <Button size="sm" variant="outline" onClick={() => handleSync(shop.id)} disabled={syncingShopId === shop.id}>
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncingShopId === shop.id ? 'animate-spin' : ''}`} />
                  同步仓库
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {warehouses.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">暂无仓库数据，请点击"同步仓库"从 OZON 获取</div>
              ) : (
                <div className="space-y-3">
                  {warehouses.map((wh) => (
                    <div key={wh.id} className="border rounded-lg p-4 hover:bg-muted/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{wh.name}</span>
                            <Badge variant="outline" className="text-xs">{wh.type || '-'}</Badge>
                            <Badge variant={wh.status === 'created' ? 'default' : 'secondary'} className="text-xs">
                              {wh.status === 'created' ? '活跃' : wh.status || '-'}
                            </Badge>
                            {wh.isRfbs && <Badge className="text-xs bg-blue-100 text-blue-700">rFBS</Badge>}
                            {wh.isKgt && <Badge className="text-xs bg-purple-100 text-purple-700">大件</Badge>}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            <span>ID: {wh.platformWarehouseId}</span>
                            {wh.phone && <span>电话: {wh.phone}</span>}
                            {wh.latitude && wh.longitude && <span>坐标: {wh.latitude.toFixed(4)}, {wh.longitude.toFixed(4)}</span>}
                            {wh.firstMileType && <span>首公里: {wh.firstMileType}</span>}
                            {wh.dropOffPointId && <span>代收点: {wh.dropOffPointId}</span>}
                            {wh.workingDays && <span>工作日: {(wh.workingDays as number[]).join(',')}</span>}
                          </div>
                          {/* 物流方式 */}
                          {wh.deliveryMethods && wh.deliveryMethods.length > 0 && (
                            <div className="mt-3 border-t pt-2">
                              <span className="text-xs font-medium text-muted-foreground">物流方式：</span>
                              <div className="flex flex-wrap gap-2 mt-1">
                                {wh.deliveryMethods.map((dm) => (
                                  <div key={dm.id} className="text-xs border rounded px-2 py-1 bg-muted/30">
                                    <span className="font-medium">{dm.name}</span>
                                    <span className="text-muted-foreground ml-1">({dm.tplIntegrationType || dm.status})</span>
                                    {dm.dropOffPointName && <span className="text-muted-foreground ml-1">· {dm.dropOffPointName}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setEditingWh({ shopId: shop.id, wh })}>
                          <Pencil className="h-3.5 w-3.5 mr-1" />编辑
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {editingWh && (
        <WarehouseEditDialog
          shopId={editingWh.shopId}
          warehouse={editingWh.wh}
          onClose={() => setEditingWh(null)}
          onSuccess={() => { setEditingWh(null); loadData(); }}
        />
      )}
    </div>
  );
}

// PLACEHOLDER_EDIT_DIALOG

function WarehouseEditDialog({ shopId, warehouse, onClose, onSuccess }: {
  shopId: string;
  warehouse: PlatformWarehouse;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: warehouse.name,
    phone: warehouse.phone || '',
    latitude: warehouse.latitude?.toString() || '',
    longitude: warehouse.longitude?.toString() || '',
  });
  const [pushing, setPushing] = useState(false);

  async function handlePush() {
    setPushing(true);
    const body: any = {};
    if (form.name !== warehouse.name) body.name = form.name;
    if (form.phone !== (warehouse.phone || '')) body.phone = form.phone;
    const lat = parseFloat(form.latitude);
    const lon = parseFloat(form.longitude);
    if (!isNaN(lat) && !isNaN(lon) && (lat !== warehouse.latitude || lon !== warehouse.longitude)) {
      body.latitude = lat;
      body.longitude = lon;
    }
    if (Object.keys(body).length === 0) {
      toast({ title: '没有修改内容' });
      setPushing(false);
      return;
    }
    const res = await api.patch(`/api/shops/${shopId}/warehouses/${warehouse.id}/push`, body);
    setPushing(false);
    if (res.code === 1) { toast({ title: '已推送到 OZON' }); onSuccess(); }
    else toast({ title: res.msg || '推送失败', variant: 'destructive' });
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>编辑仓库 · {warehouse.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-muted text-xs space-y-1">
            <div>平台 ID: {warehouse.platformWarehouseId}</div>
            <div>类型: {warehouse.type} {warehouse.isRfbs ? '(rFBS)' : ''}</div>
            {warehouse.firstMileType && <div>首公里: {warehouse.firstMileType}</div>}
            {warehouse.dropOffPointId && <div>代收点 ID: {warehouse.dropOffPointId}</div>}
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">仓库名称</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">联系电话</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7(999)999-99-99" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">纬度</label>
                <Input value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} type="number" step="0.000001" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">经度</label>
                <Input value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} type="number" step="0.000001" />
              </div>
            </div>
          </div>
          {warehouse.deliveryMethods && warehouse.deliveryMethods.length > 0 && (
            <div className="border-t pt-3">
              <span className="text-sm font-medium">关联物流方式</span>
              <div className="mt-2 space-y-1">
                {warehouse.deliveryMethods.map((dm) => (
                  <div key={dm.id} className="flex items-center justify-between text-xs p-2 border rounded">
                    <div>
                      <span className="font-medium">{dm.name}</span>
                      <span className="text-muted-foreground ml-2">{dm.tplIntegrationType || ''}</span>
                      {dm.dropOffPointAddress && <span className="text-muted-foreground ml-2">· {dm.dropOffPointAddress}</span>}
                    </div>
                    <Badge variant="outline" className="text-xs">{dm.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handlePush} disabled={pushing}>
            {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : '推送到 OZON'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
