'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Star, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ShopPlatform = 'OZON' | 'YANDEX' | 'KASPI' | 'WILDBERRIES';
export type ShopPlatformFilter = '' | ShopPlatform;

export interface PlatformShopOption {
  id: string;
  name: string;
  platform: string;
  status?: string | null;
}

export const SHOP_PLATFORM_OPTIONS: Array<{ value: ShopPlatformFilter; label: string }> = [
  { value: '', label: '全部平台' },
  { value: 'OZON', label: 'Ozon' },
  { value: 'YANDEX', label: 'Yandex Market' },
  { value: 'KASPI', label: 'Kaspi' },
  { value: 'WILDBERRIES', label: 'Wildberries' },
];

export function shopPlatformLabel(platform?: string | null): string {
  const normalized = String(platform || '').trim().toUpperCase();
  return SHOP_PLATFORM_OPTIONS.find((option) => option.value === normalized)?.label ?? (normalized || '未知平台');
}

interface PlatformShopFilterProps {
  shops: PlatformShopOption[];
  platform: ShopPlatformFilter;
  shopId: string;
  onPlatformChange: (platform: ShopPlatformFilter) => void;
  onShopChange: (shopId: string) => void;
  className?: string;
  compact?: boolean;
  shopPlaceholder?: string;
  allowAllShops?: boolean;
  disabled?: boolean;
}

export function PlatformShopFilter({
  shops,
  platform,
  shopId,
  onPlatformChange,
  onShopChange,
  className,
  compact = false,
  shopPlaceholder = '全部店铺',
  allowAllShops = true,
  disabled = false,
}: PlatformShopFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [site, setSite] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const visibleShops = platform ? shops.filter((shop) => shop.platform.toUpperCase() === platform) : shops;
  const selectedShop = visibleShops.find(shop => shop.id === shopId);
  const allLabel = platform ? `全部${shopPlatformLabel(platform)}店铺` : shopPlaceholder;
  const matchingShops = visibleShops.filter(shop => `${shop.name} ${shopPlatformLabel(shop.platform)}`.toLowerCase().includes(search.toLowerCase().trim()));
  const sortedShops = [...matchingShops].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ss-erp:favorite-shops') || '[]');
      if (Array.isArray(stored)) setFavorites(stored.filter(value => typeof value === 'string').slice(0, 100));
    } catch {}
    const hostname = location.hostname;
    setSite(hostname.endsWith('ss-erp.com') ? 'COM 站点' : hostname.endsWith('ss-erp.cn') ? 'CN 站点' : '');
  }, []);
  useEffect(() => { setOpen(false); setSearch(''); }, [platform, shopId]);
  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  function choose(id: string) { onShopChange(id); setOpen(false); setSearch(''); trigger.current?.focus(); }
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id].slice(-100);
    setFavorites(next);
    try { localStorage.setItem('ss-erp:favorite-shops', JSON.stringify(next)); } catch {}
  }
  const selectClass = cn(
    'rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
    compact ? 'h-8 px-2.5 text-xs' : 'h-9',
  );

  function handlePlatformChange(next: ShopPlatformFilter) {
    onPlatformChange(next);
  }

  return (
    <div ref={root} className={cn('flex max-w-full flex-wrap items-center gap-2', className)} aria-label="平台和店铺范围">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Store className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">平台</span>
      </div>
      <select
        aria-label="平台"
        value={platform}
        onChange={(event) => handlePlatformChange(event.target.value as ShopPlatformFilter)}
        className={cn(selectClass, compact ? 'min-w-[120px]' : 'min-w-[142px]')}
        disabled={disabled}
      >
        {SHOP_PLATFORM_OPTIONS.filter((option) => option.value === '' || shops.some((shop) => shop.platform.toUpperCase() === option.value)).map((option) => (
          <option key={option.value || 'all'} value={option.value}>{option.label}</option>
        ))}
      </select>
      <div className="relative min-w-0 max-w-full">
      <button
        ref={trigger}
        type="button"
        aria-label="店铺"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setSearch(''); setOpen(value => !value); }}
        className={cn(selectClass, 'flex max-w-full items-center justify-between gap-2 text-left', compact ? 'w-[170px]' : 'w-[210px]')}
        disabled={disabled || visibleShops.length === 0}
      >
        <span className="truncate">{selectedShop?.name || (allowAllShops ? allLabel : '选择店铺')}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </button>
      {open && <div role="dialog" aria-label="选择店铺" className="absolute left-0 top-full z-40 mt-1 w-[min(320px,calc(100vw-48px))] rounded-md border bg-background p-2 shadow-lg">
        <input ref={searchInput} aria-label="搜索店铺" placeholder="搜索店铺名称" value={search} onChange={event => setSearch(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <div className="mt-1 max-h-64 overflow-y-auto">
          {allowAllShops && !search && <button type="button" className="w-full rounded px-2 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose('')}>{allLabel}</button>}
          {!allowAllShops && !search && <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose('')}>暂不选择店铺</button>}
          {sortedShops.map(shop => <div key={shop.id} className={cn('flex items-center rounded hover:bg-muted', shopId === shop.id && 'bg-primary/10')}>
            <button type="button" aria-label={`选择 ${shop.name} ${shopPlatformLabel(shop.platform)}`} className="min-w-0 flex-1 rounded px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(shop.id)}>
              <span className="block truncate">{shop.name}</span>
              <span className="text-[10px] text-muted-foreground">{shopPlatformLabel(shop.platform)} · {shop.status === 'ACTIVE' ? '连接正常' : shop.status === 'DISABLED' ? '已停用' : shop.status === 'ERROR' ? '连接异常' : shop.status ? '待验证' : '状态未提供'}</span>
            </button>
            <button type="button" aria-label={`${favorites.includes(shop.id) ? '取消收藏' : '收藏'} ${shop.name} ${shopPlatformLabel(shop.platform)}`} aria-pressed={favorites.includes(shop.id)} className="m-1 rounded p-2 text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => toggleFavorite(shop.id)}><Star className={cn('h-4 w-4', favorites.includes(shop.id) && 'fill-primary text-primary')} /></button>
          </div>)}
          {!sortedShops.length && <p className="p-3 text-sm text-muted-foreground">没有匹配的店铺</p>}
        </div>
      </div>}
      </div>
      {selectedShop && <span className="flex max-w-full items-center gap-1 truncate text-[10px] text-muted-foreground" aria-label="当前店铺上下文"><span>{shopPlatformLabel(selectedShop.platform)}</span>{site && <span>· {site}</span>}<span>· {selectedShop.status === 'ACTIVE' ? '连接正常' : selectedShop.status === 'ERROR' ? '连接异常' : selectedShop.status ? '待验证' : '状态未提供'}</span></span>}
    </div>
  );
}
