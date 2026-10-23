export type PromotionActionStatus = 'active' | 'upcoming' | 'finished' | 'unknown';

export interface PromotionAction {
  id: number;
  title: string;
  dateStart: string | null;
  dateEnd: string | null;
  participatingProductsCount: number;
  potentialProductsCount: number;
  status: PromotionActionStatus;
}

export interface PromotionProduct {
  productId: number;
  title: string;
  offerId: string | null;
  image: string | null;
  price: string | null;
  actionPrice: string | null;
  maxActionPrice: string | null;
  stock: number | null;
  currency?: string | null;
}

export interface PromotionProductsResult {
  products: PromotionProduct[];
  total: number;
  lastId?: string;
}

export interface LocalPromotionProduct {
  title?: string | null;
  offerId?: string | null;
  images?: unknown;
}

export interface PromotionDeactivateSummary {
  successCount: number;
  failureCount: number;
  failures: Array<{ productId: number; message: string }>;
}

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayFromResponse(value: unknown, keys: string[]): any[] {
  if (Array.isArray(value)) return value;
  const record = objectRecord(value);
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  const result = objectRecord(record.result);
  if (Array.isArray(record.result)) return record.result;
  for (const key of keys) {
    if (Array.isArray(result[key])) return result[key];
  }
  return [];
}

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function actionStatus(dateStart?: string | null, dateEnd?: string | null): PromotionActionStatus {
  const now = Date.now();
  const start = dateStart ? Date.parse(dateStart) : NaN;
  const end = dateEnd ? Date.parse(dateEnd) : NaN;
  if (Number.isFinite(end) && end < now) return 'finished';
  if (Number.isFinite(start) && start > now) return 'upcoming';
  if (Number.isFinite(start) || Number.isFinite(end)) return 'active';
  return 'unknown';
}

export function normalizePromotionActions(response: unknown): PromotionAction[] {
  return arrayFromResponse(response, ['actions', 'items']).map((raw) => {
    const item = objectRecord(raw);
    const id = numberOrZero(item.id ?? item.action_id);
    const dateStart = nullableString(item.date_start ?? item.dateStart ?? item.started_at);
    const dateEnd = nullableString(item.date_end ?? item.dateEnd ?? item.finished_at);
    return {
      id,
      title: nullableString(item.title ?? item.name) || String(id),
      dateStart,
      dateEnd,
      participatingProductsCount: numberOrZero(item.participating_products_count ?? item.participatingProductsCount ?? item.products_count),
      potentialProductsCount: numberOrZero(item.potential_products_count ?? item.potentialProductsCount ?? item.candidates_count),
      status: actionStatus(dateStart, dateEnd),
    };
  }).filter((item) => item.id > 0);
}

function firstImage(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return nullableString(value[0]);
}

function promotionMoney(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const money = objectRecord(value);
    if (typeof money.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(money.amount)
      || typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency)) throw new Error('OZON 活动价格格式无效');
    return money.amount;
  }
  return nullableString(value);
}

export function normalizePromotionProducts(
  response: unknown,
  localByProductId: Map<string, LocalPromotionProduct> = new Map(),
): PromotionProductsResult {
  const products = arrayFromResponse(response, ['products', 'items']).map((raw) => {
    const item = objectRecord(raw);
    const productId = numberOrZero(item.product_id ?? item.productId ?? item.id);
    const local = localByProductId.get(String(productId));
    return {
      productId,
      title: nullableString(item.name ?? item.title) || local?.title || String(productId),
      offerId: nullableString(item.offer_id ?? item.offerId) || local?.offerId || null,
      image: nullableString(item.image ?? item.primary_image ?? item.primaryImage) || firstImage(local?.images) || null,
      price: promotionMoney(item.price),
      actionPrice: promotionMoney(item.action_price ?? item.actionPrice),
      maxActionPrice: promotionMoney(item.max_action_price ?? item.maxActionPrice),
      ...(item.price?.currency ? { currency: item.price.currency } : {}),
      stock: item.stock == null ? null : numberOrZero(item.stock),
    };
  }).filter((item) => item.productId > 0);

  const root = objectRecord(response);
  const result = objectRecord(root.result);
  const total = numberOrZero(root.total ?? result.total) || products.length;
  return { products, total, ...(typeof root.last_id === 'string' ? { lastId: root.last_id } : {}) };
}

function itemErrorMessage(item: Record<string, any>): string | null {
  const errors = Array.isArray(item.errors) ? item.errors : [];
  const firstError = objectRecord(errors[0]);
  return nullableString(firstError.message ?? firstError.code ?? item.error ?? item.error_message);
}

export function summarizePromotionDeactivateResult(response: unknown, requestedProductIds: number[]): PromotionDeactivateSummary {
  const explicitIds = objectRecord(response).product_ids;
  if (Array.isArray(explicitIds)) {
    const accepted = new Set(explicitIds.map(String));
    const failures = requestedProductIds.filter(id => !accepted.has(String(id)))
      .map(productId => ({ productId, message: 'OZON 未确认该商品已移出活动' }));
    return { successCount: requestedProductIds.length - failures.length, failureCount: failures.length, failures };
  }
  const rows = arrayFromResponse(response, ['products', 'items']);
  if (!rows.length) {
    return { successCount: 0, failureCount: requestedProductIds.length, failures: requestedProductIds.map(productId => ({ productId, message: 'OZON 未返回移出活动结果' })) };
  }

  let successCount = 0;
  const failures: Array<{ productId: number; message: string }> = [];
  for (const raw of rows) {
    const item = objectRecord(raw);
    const productId = numberOrZero(item.product_id ?? item.productId ?? item.id);
    const message = itemErrorMessage(item);
    const updated = item.is_updated ?? item.updated ?? item.success ?? item.is_success;
    if (message || updated === false) {
      failures.push({ productId, message: message || 'OZON 未接受该商品移出活动' });
    } else {
      successCount++;
    }
  }
  return {
    successCount,
    failureCount: failures.length,
    failures,
  };
}
