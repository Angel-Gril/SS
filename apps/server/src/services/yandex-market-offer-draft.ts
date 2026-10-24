import { z } from 'zod';

const id = z.string().min(1).max(200);

export type YandexOfferDraftInput = {
  id: string;
  platformProductId?: string | null;
  sku?: string | null;
  offerId?: string | null;
  title?: string | null;
  description?: string | null;
  categoryId?: string | null;
  price?: unknown;
  currency?: string | null;
  stock?: number | null;
  images?: unknown;
  attributes?: unknown;
  variants?: unknown;
};

export type YandexOfferDraft = {
  sourceProductId: string;
  offer: {
    offerId: string;
    name: string;
    description: string;
    marketCategoryId: number | null;
    vendor: string | null;
    pictures: string[];
    barcodes: string[];
    price: string | null;
    currency: string;
    stock: number;
  };
  missingFields: string[];
  warnings: string[];
  ready: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}
function images(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => {
    if (typeof item === 'string') return item.trim();
    const row = record(item);
    return String(row.url || row.src || row.original || row.full || '').trim();
  }).filter(url => /^https?:\/\//iu.test(url))));
}
function attributeValue(attributes: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.map(item => String(item || '').trim()).find(Boolean);
      if (first) return first;
    }
  }
  return null;
}

/** Build a reviewable ERP-owned draft; this function never calls Yandex or Ozon. */
export function buildYandexOfferDraft(product: YandexOfferDraftInput): YandexOfferDraft {
  const sourceProductId = id.parse(product.id);
  const attributes = record(product.attributes);
  const variants = Array.isArray(product.variants) ? product.variants.map(record) : [];
  const variantBarcodes = variants.flatMap(variant => strings(variant.barcodes || variant.barcode));
  const barcodes = Array.from(new Set([
    ...strings(attributes.barcodes), ...strings(attributes.barcode), ...variantBarcodes,
    String(product.sku || '').trim(),
  ].filter(value => /^\d{8,32}$/u.test(value))));
  const name = String(product.title || '').trim();
  const description = String(product.description || '').trim();
  const vendor = attributeValue(attributes, ['vendor', 'brand', 'manufacturer']);
  const pictures = images(product.images);
  const marketCategoryId = product.categoryId && /^\d+$/u.test(product.categoryId) ? Number(product.categoryId) : null;
  const numericPrice = product.price == null || product.price === '' ? null : Number(product.price);
  const price = numericPrice != null && Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice.toFixed(2) : null;
  const missingFields = [
    !name && 'name', !description && 'description', !marketCategoryId && 'marketCategoryId',
    !pictures.length && 'pictures', !vendor && 'vendor', !barcodes.length && 'barcodes',
  ].filter((value): value is string => Boolean(value));
  const warnings: string[] = [];
  if (name && !/[А-Яа-яЁё]/u.test(name)) warnings.push('name_not_russian');
  if (description && !/[А-Яа-яЁё]/u.test(description)) warnings.push('description_not_russian');
  if (pictures.some(url => /1688|taobao|alicdn/iu.test(url))) warnings.push('picture_origin_may_require_erp_public_transfer');
  return {
    sourceProductId,
    offer: {
      offerId: `ss-ozon-${sourceProductId}`,
      name,
      description,
      marketCategoryId,
      vendor,
      pictures,
      barcodes,
      price,
      currency: String(product.currency || 'RUB').trim().toUpperCase(),
      stock: Number.isFinite(Number(product.stock)) ? Math.max(0, Math.floor(Number(product.stock))) : 0,
    },
    missingFields,
    warnings,
    ready: missingFields.length === 0,
  };
}
