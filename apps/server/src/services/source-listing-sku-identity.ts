import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';

export { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedKey(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).normalize('NFKC').trim()
    : '';
}

function captureSkuRows(payload: unknown): unknown[] | null {
  const record = recordValue(payload);
  if (!record) return null;
  const capture = recordValue(record.capture) || record;
  return Array.isArray(capture.skus) ? capture.skus : null;
}

export function isProductOnlySourceCapture(payload: unknown): boolean {
  const rows = captureSkuRows(payload);
  return rows != null && rows.length === 0;
}

/**
 * Maps client-visible aliases to immutable capture-owned keys. The reserved product-only key is
 * deliberately unavailable as soon as the snapshot contains any real SKU row.
 */
export function capturedSourceSkuAliases(payload: unknown): Map<string, string | null> {
  const rows = captureSkuRows(payload);
  if (!rows) return new Map();
  if (rows.length === 0) {
    return new Map([[SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY, SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]]);
  }

  const capturedSkus: Array<{ key: string; sourceSkuId: string }> = [];
  const canonicalKeys = new Map<string, string | null>();
  for (const raw of rows) {
    const sku = recordValue(raw);
    if (!sku) continue;
    const key = normalizedKey(sku.key);
    if (!key || key === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY) continue;
    const sourceSkuId = normalizedKey(sku.sourceSkuId);
    capturedSkus.push({ key, sourceSkuId });
    if (!canonicalKeys.has(key)) canonicalKeys.set(key, key);
    else canonicalKeys.set(key, null);
  }

  // Canonical keys own their namespace. Legacy aliases may not shadow them, while canonical keys
  // that collapse under normalization remain unavailable because they cannot identify one row.
  const aliases = new Map(canonicalKeys);
  for (const { key, sourceSkuId } of capturedSkus) {
    if (!sourceSkuId || sourceSkuId === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY) continue;
    if (canonicalKeys.has(sourceSkuId)) continue;
    const target = canonicalKeys.get(key);
    if (!target) {
      aliases.set(sourceSkuId, null);
    } else if (!aliases.has(sourceSkuId)) {
      aliases.set(sourceSkuId, target);
    } else if (aliases.get(sourceSkuId) !== target) {
      aliases.set(sourceSkuId, null);
    }
  }
  return aliases;
}
