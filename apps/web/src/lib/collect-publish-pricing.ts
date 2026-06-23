export function parsePositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function parseFiniteNumberOrDefault(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function calcPublishPreviewPrice(baseCny: unknown, markupPct: unknown, markupAmount: unknown): number | null {
  const base = parsePositiveNumber(baseCny);
  if (base == null) return null;
  const pct = parseFiniteNumberOrDefault(markupPct, 0);
  const fixed = parseFiniteNumberOrDefault(markupAmount, 0);
  return Math.max(1, Math.ceil(base * (1 + pct / 100) + fixed));
}

export function resolveVariantPublishPreviewPrice(input: {
  manualPrice?: unknown;
  variantPrice?: unknown;
  groupBasePrice?: unknown;
  markupPct?: unknown;
  markupAmount?: unknown;
}): { finalPrice: number | null; manual: boolean; source: 'manual' | 'variant' | 'group' | 'none' } {
  const manualPrice = parsePositiveNumber(input.manualPrice);
  if (manualPrice != null) {
    return { finalPrice: Math.ceil(manualPrice), manual: true, source: 'manual' };
  }

  const variantPrice = parsePositiveNumber(input.variantPrice);
  if (variantPrice != null) {
    return {
      finalPrice: calcPublishPreviewPrice(variantPrice, input.markupPct, input.markupAmount),
      manual: false,
      source: 'variant',
    };
  }

  const groupPrice = calcPublishPreviewPrice(input.groupBasePrice, input.markupPct, input.markupAmount);
  return {
    finalPrice: groupPrice,
    manual: false,
    source: groupPrice == null ? 'none' : 'group',
  };
}

export function formatPreviewPrice(value: number | null): string {
  return value == null ? '-' : `¥${value}`;
}
