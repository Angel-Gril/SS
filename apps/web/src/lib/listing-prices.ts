export interface ListingPriceVariant {
  sku?: string | null;
  price?: string | number | null;
  suggestedSalePriceCny?: number | string | null;
}

export interface ListingPriceItem {
  id: string;
  sourcePlatform?: string | null;
  publishPriceCny?: number | string | null;
  variants?: ListingPriceVariant[] | null;
}

export type ListingPriceOverrides = Record<string, Record<string, number>>;

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function getListingVariantPriceKey(itemId: string, variantSku: string): string {
  return JSON.stringify([itemId, variantSku]);
}

export function buildListingPriceOverrides(
  items: ListingPriceItem[],
  options: { editedVariantPriceKeys?: Set<string> } = {},
): ListingPriceOverrides {
  const overrides: ListingPriceOverrides = {};

  for (const item of items) {
    const itemOverrides: Record<string, number> = {};
    const basePrice = positiveNumber(item.publishPriceCny);
    if (basePrice) itemOverrides._base = basePrice;

    if (item.sourcePlatform === '1688') {
      for (const variant of item.variants || []) {
        const sku = String(variant.sku || '').trim();
        if (!sku) continue;

        const hasSuggestedPrice = positiveNumber(variant.suggestedSalePriceCny) !== null;
        const wasEdited = options.editedVariantPriceKeys?.has(getListingVariantPriceKey(item.id, sku)) || false;
        if (!hasSuggestedPrice && !wasEdited) continue;

        const price = positiveNumber(variant.price);
        if (price) itemOverrides[sku] = price;
      }
    }

    if (Object.keys(itemOverrides).length) {
      overrides[item.id] = itemOverrides;
    }
  }

  return overrides;
}
