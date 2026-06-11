export type BatchPriceMode = 'set' | 'multiply' | 'discount' | 'increase';

export interface BatchPriceChange {
  mode: BatchPriceMode;
  value: number;
}

function formatPrice(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function calculateBatchPrice(currentPrice: unknown, change: BatchPriceChange): string | null {
  const value = Number(change.value);
  if (!Number.isFinite(value) || value <= 0) return null;

  if (change.mode === 'set') return formatPrice(value);

  const base = Number(currentPrice);
  if (!Number.isFinite(base) || base <= 0) return null;

  if (change.mode === 'multiply') return formatPrice(base * value);
  if (change.mode === 'discount') return value >= 100 ? null : formatPrice(base * (1 - value / 100));
  if (change.mode === 'increase') return formatPrice(base * (1 + value / 100));
  return null;
}
