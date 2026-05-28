'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Search, ShoppingCart, Package, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatOrderAmount } from '@/lib/utils';

interface SearchOrder {
  id: string;
  postingNumber: string | null;
  platformOrderId: string;
  status: string;
  totalAmount: string | null;
  totalAmountCny: string | null;
  currency: string;
  shop: { name: string };
}

interface SearchProduct {
  id: string;
  sku: string | null;
  offerId: string | null;
  title: string;
  price: string | null;
  currency: string;
  stock: number;
  images: string[] | null;
  shop: { name: string };
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<SearchOrder[]>([]);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setOrders([]); setProducts([]); return; }
    setLoading(true);
    const res = await api.get<{ orders: SearchOrder[]; products: SearchProduct[] }>(`/api/search?q=${encodeURIComponent(q)}`);
    if (res.code === 1 && res.data) {
      setOrders(res.data.orders);
      setProducts(res.data.products);
    }
    setLoading(false);
  }, []);

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function handleSelect(type: 'order' | 'product', id: string) {
    setOpen(false);
    setQuery('');
    if (type === 'order') router.push(`/orders?highlight=${id}`);
    else router.push(`/products?highlight=${id}`);
  }

  const hasResults = orders.length > 0 || products.length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-accent transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">搜索订单/商品...</span>
        <kbd className="hidden md:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
          Ctrl+K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-[15vh]">
          <div ref={containerRef} className="w-full max-w-lg bg-background rounded-xl border shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 border-b">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => handleInput(e.target.value)}
                placeholder="输入物流单号/订单号/SKU/商品名..."
                className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            {query.length >= 2 && (
              <div className="max-h-[400px] overflow-y-auto">
                {!loading && !hasResults && (
                  <div className="py-8 text-center text-sm text-muted-foreground">无匹配结果</div>
                )}

                {orders.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
                      订单 ({orders.length})
                    </div>
                    {orders.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => handleSelect('order', o.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent text-left transition-colors"
                      >
                        <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono truncate">{o.postingNumber || o.platformOrderId}</div>
                          <div className="text-xs text-muted-foreground">{o.shop.name} · {o.status}</div>
                        </div>
                        {o.totalAmount && (() => {
                          const f = formatOrderAmount(o.totalAmount, o.currency, o.totalAmountCny);
                          return (
                            <span className="text-xs tabular-nums text-muted-foreground" title={`原币 ${f.original}${f.isApprox ? '（估算汇率）' : ''}`}>
                              {f.display}
                            </span>
                          );
                        })()}
                      </button>
                    ))}
                  </div>
                )}

                {products.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
                      商品 ({products.length})
                    </div>
                    {products.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleSelect('product', p.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent text-left transition-colors"
                      >
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{p.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.sku || p.offerId} · {p.shop.name} · 库存:{p.stock}
                          </div>
                        </div>
                        {p.price && (
                          <span className="text-xs tabular-nums text-muted-foreground">{p.currency} {p.price}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
