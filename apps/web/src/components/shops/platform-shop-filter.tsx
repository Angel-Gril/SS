'use client';

import { Store } from 'lucide-react';
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
  const visibleShops = platform ? shops.filter((shop) => shop.platform.toUpperCase() === platform) : shops;
  const selectClass = cn(
    'rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
    compact ? 'h-8 px-2.5 text-xs' : 'h-9',
  );

  function handlePlatformChange(next: ShopPlatformFilter) {
    onPlatformChange(next);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label="平台和店铺范围">
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
      <select
        aria-label="店铺"
        value={shopId}
        onChange={(event) => onShopChange(event.target.value)}
        className={cn(selectClass, compact ? 'min-w-[170px]' : 'min-w-[210px]')}
        disabled={disabled || visibleShops.length === 0}
      >
        {allowAllShops && <option value="">{platform ? `全部${shopPlatformLabel(platform)}店铺` : shopPlaceholder}</option>}
        {!allowAllShops && <option value="">选择店铺</option>}
        {visibleShops.map((shop) => (
          <option key={shop.id} value={shop.id}>
            {shop.name}{shop.status && shop.status !== 'ACTIVE' ? ` · ${shop.status === 'DISABLED' ? '已停用' : '待验证'}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
