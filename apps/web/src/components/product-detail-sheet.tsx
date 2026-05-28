'use client';

import { useEffect, useState } from 'react';
import { Loader2, ImageOff, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate, formatOrderAmount } from '@/lib/utils';
import { getOzonAttrName } from '@/lib/ozon-attr-names';

function getAttrDisplayName(attr: any): string {
  return getOzonAttrName(attr);
}

interface RelatedOrder {
  id: string;
  platformOrderId: string;
  postingNumber: string | null;
  status: string;
  totalAmount: string | null;
  totalAmountCny: string | null;
  currency: string;
  inProcessAt: string | null;
}

interface ProductDetail {
  id: string;
  title: string;
  sku: string | null;
  offerId: string | null;
  price: string | null;
  oldPrice: string | null;
  currency: string;
  stock: number;
  images: string[] | null;
  attributes: any[] | null;
  status: string | null;
  visibility: string | null;
  shopName: string;
  platform: string;
  updatedAt: string;
  relatedOrders: RelatedOrder[];
}

function ImageCarousel({ images }: { images: string[] }) {
  const [current, setCurrent] = useState(0);

  if (images.length === 0) {
    return (
      <div className="w-full h-64 rounded-lg border bg-muted flex items-center justify-center">
        <ImageOff className="h-10 w-10 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative w-full h-64 rounded-lg border bg-muted overflow-hidden">
      <img src={images[current]} alt="" className="w-full h-full object-contain" />
      {images.length > 1 && (
        <>
          <button
            onClick={() => setCurrent((c) => (c - 1 + images.length) % images.length)}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCurrent((c) => (c + 1) % images.length)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white rounded-full p-1"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {images.map((_, i) => (
              <span key={i} className={`block w-2 h-2 rounded-full ${i === current ? 'bg-white' : 'bg-white/50'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ProductDetailSheet({
  productId,
  open,
  onOpenChange,
}: {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productId || !open) { setDetail(null); return; }
    setLoading(true);
    api.get<ProductDetail>(`/api/products/${productId}/detail`).then((res) => {
      if (res.code === 1 && res.data) setDetail(res.data);
      setLoading(false);
    });
  }, [productId, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>商品详情</SheetTitle>
          <SheetDescription>查看商品完整信息及关联订单</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : detail ? (
          <div className="mt-6 space-y-6">
            <ImageCarousel images={detail.images || []} />

            <div className="space-y-3">
              <h3 className="font-medium text-base leading-tight">{detail.title}</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">SKU:</span> <span className="font-mono">{detail.sku || '-'}</span></div>
                <div><span className="text-muted-foreground">Offer ID:</span> <span className="font-mono">{detail.offerId || '-'}</span></div>
                <div>
                  <span className="text-muted-foreground">价格:</span>{' '}
                  <span className="font-medium">{detail.price ? `${detail.currency} ${detail.price}` : '-'}</span>
                  {detail.oldPrice && <span className="ml-2 text-muted-foreground line-through text-xs">{detail.oldPrice}</span>}
                </div>
                <div>
                  <span className="text-muted-foreground">库存:</span>{' '}
                  <span className={`font-medium ${detail.stock <= 0 ? 'text-destructive' : ''}`}>{detail.stock}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">状态:</span>{' '}
                  <Badge variant={detail.visibility === 'archived' ? 'secondary' : 'success'}>
                    {detail.visibility === 'archived' ? '已下架' : (detail.status || '在售')}
                  </Badge>
                </div>
                <div><span className="text-muted-foreground">店铺:</span> {detail.shopName} ({detail.platform})</div>
              </div>
            </div>

            {detail.attributes && Array.isArray(detail.attributes) && detail.attributes.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">商品属性</h4>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-1/3">属性名</TableHead>
                        <TableHead>属性值</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.attributes.slice(0, 20).map((attr: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm text-muted-foreground">
                            {getAttrDisplayName(attr)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {attr.value || attr.attribute_value || (Array.isArray(attr.values) ? attr.values.map((v: any) => v.value || v).join(', ') : String(Object.values(attr)[0] ?? '-'))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-medium">关联订单 (最近10条)</h4>
              {detail.relatedOrders && detail.relatedOrders.length > 0 ? (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>订单号</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                        <TableHead>时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.relatedOrders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-xs">{order.postingNumber || order.platformOrderId}</TableCell>
                          <TableCell><Badge variant="secondary">{order.status}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {order.totalAmount ? (() => {
                              const f = formatOrderAmount(order.totalAmount, order.currency, order.totalAmountCny);
                              return <span title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>{f.display}</span>;
                            })() : '-'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {order.inProcessAt ? formatDate(order.inProcessAt) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-6 text-center text-muted-foreground text-sm border rounded-lg">
                  <Package className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  暂无关联订单
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground pt-2 border-t">
              最后更新: {formatDate(detail.updatedAt)}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
