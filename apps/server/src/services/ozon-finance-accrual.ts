import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

const SOURCE = 'OZON_ACCRUAL_V1';
const ROOT_PREFIX = 'accrual:v1:';
const SNAPSHOT_TYPE = 'OZON_ACCRUAL_DAY_SNAPSHOT';
const MAX_DAY_ACCRUALS = 100_000;
type RecordValue = Record<string, unknown>;
type FinanceDb = Pick<PrismaClient, '$transaction' | 'ozonFinanceTransaction'>;
type Converter = (amount: number, currency: string, date: Date) => Promise<{ amountCny: number; rate: number; source: string }>;
type Client = {
  getFinanceAccrualByDay(input: { date: string; last_id: string }): Promise<unknown>;
  getFinanceAccrualTypes(): Promise<unknown>;
};
type Component = { category: string; amount: number; currency: string; amountCny: number; exchangeRate: number; typeId?: number; typeName?: string };

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid Ozon finance ${label}`);
  return value as RecordValue;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid Ozon finance ${label}`);
  return value;
}

function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))
    && new Date(day).toISOString().slice(0, 10) === day && day >= '2022-01-01';
}

export function financeAccrualDates(from: string, to: string): string[] {
  const parse = (value: string) => {
    if (!validDay(value.slice(0, 10))) throw new Error('Invalid Ozon finance date');
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid Ozon finance date');
    return parsed;
  };
  const start = parse(from), end = parse(to);
  if (end < start) throw new Error('Invalid Ozon finance date range');
  const startDay = new Date(start.toISOString().slice(0, 10));
  const endDay = new Date(end.toISOString().slice(0, 10));
  const days = Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1;
  if (days > 366) throw new Error('Ozon finance date range exceeds 366 days');
  return Array.from({ length: days }, (_, i) => new Date(startDay.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

function officialId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  throw new Error('Invalid or imprecise Ozon finance accrual ID');
}

function money(value: unknown): { amount: number; currency: string } {
  const data = record(value, 'money');
  if (typeof data.amount !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(data.amount)
    || typeof data.currency !== 'string' || !/^[A-Z]{3}$/.test(data.currency)) throw new Error('Invalid Ozon finance money');
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999_999.99) throw new Error('Invalid Ozon finance amount');
  return { amount, currency: data.currency };
}

async function converted(value: unknown, date: string, convert: Converter) {
  const original = money(value);
  const result = await convert(original.amount, original.currency, new Date(date));
  if (['unknown_currency', 'invalid'].includes(result.source) || !Number.isFinite(result.amountCny)
    || !Number.isFinite(result.rate) || result.rate <= 0 || result.rate >= 1_000_000
    || Math.abs(result.amountCny) > 999_999_999_999.99) throw new Error('Ozon finance currency conversion unavailable');
  return { ...original, amountCny: result.amountCny, exchangeRate: result.rate };
}

// Names are supplied by the official dictionary; unknown numeric IDs remain explicit
// uncategorised service costs rather than being guessed from an old transaction ID.
const CATEGORY_BY_NAME: Record<string, string> = {
  MarketplaceMarketingActionCostItem: 'ad_click', MarketplaceServiceItemAdvertisementForOrder: 'ad_cpa',
  MarketplaceServiceItemReviewsBonus: 'ad_review', MarketplaceServiceItemQuickReview: 'ad_quick',
  MarketplaceServiceItemPremium: 'ad_premium', MarketplaceServiceItemBrandPromotion: 'ad_brand',
  OperationMarketplaceSaleCommission: 'commission', MarketplaceServiceItemDelivToCustomer: 'shipping_last',
  MarketplaceServiceItemDirectFlowTrans: 'shipping_intl', MarketplaceServiceItemReturnFlowTrans: 'shipping_intl',
  MarketplaceServiceItemDelivToCustomerPost: 'shipping_post', MarketplaceServiceItemFulfillment: 'fee_settle',
  OperationItemReturn: 'refund_partial', MarketplaceServiceItemReturnPartGoodsCustomer: 'refund_partial',
  MarketplaceServiceItemDisputeCompensation: 'dispute', MarketplaceServiceItemCancelledIndexPenalty: 'penalty_index',
  MarketplaceServiceItemPickupFail: 'penalty_pickfail', MarketplaceServiceItemOther: 'service_other',
};

function parseTypes(value: unknown) {
  const result = new Map<number, { name: string; description: string }>();
  for (const entry of array(record(value, 'types response').accrual_types, 'accrual types')) {
    const type = record(entry, 'accrual type');
    if (!Number.isInteger(type.id) || typeof type.name !== 'string' || typeof type.description !== 'string'
      || result.has(type.id as number)) throw new Error('Invalid Ozon finance accrual type');
    result.set(type.id as number, { name: type.name, description: type.description });
  }
  return result;
}

async function parseAccrual(value: unknown, date: string, convert: Converter, types: ReturnType<typeof parseTypes>) {
  const accrual = record(value, 'accrual');
  const id = officialId(accrual.accrual_id);
  if (accrual.date !== date) throw new Error('Ozon finance response date mismatch');
  const total = await converted(accrual.total_amount, date, convert);
  const components: Component[] = [];
  const add = async (value: unknown, category: string, typeId?: number) => {
    const typeName = typeId === undefined ? undefined : types.get(typeId)?.name;
    components.push({ ...await converted(value, date, convert), category, ...(typeId === undefined ? {} : { typeId }), ...(typeName ? { typeName } : {}) });
  };
  const addFee = async (value: unknown, fallbackCategory = 'service_other') => {
    const fee = record(value, 'fee');
    if (!Number.isInteger(fee.type_id)) throw new Error('Invalid Ozon finance fee type');
    const name = types.get(fee.type_id as number)?.name;
    await add(fee.accrued, name ? CATEGORY_BY_NAME[name] ?? fallbackCategory : fallbackCategory, fee.type_id as number);
  };
  let postingNumber: string | null = null;
  if (accrual.accrued_category === 'POSTING') {
    if (typeof accrual.unit_number !== 'string' || !accrual.unit_number) throw new Error('Missing Ozon finance posting number');
    postingNumber = accrual.unit_number;
    const posting = record(accrual.posting, 'posting');
    for (const value of array(posting.products, 'posting products')) {
      const product = record(value, 'posting product');
      if (product.commission != null) {
        const commission = record(product.commission, 'commission');
        // commission is final after discounts; sale_commission, sale_amount,
        // bonus and prices must not be added again as separate expenses.
        if (commission.commission != null) await add(commission.commission, 'commission');
      }
      if (product.delivery != null) {
        const delivery = record(product.delivery, 'delivery');
        const services = delivery.services == null ? [] : array(delivery.services, 'delivery services');
        if (services.length) for (const service of services) await addFee(service, 'shipping_last');
        else if (delivery.total_accrued != null) await add(delivery.total_accrued, 'shipping_last');
      }
    }
  } else if (accrual.accrued_category === 'ITEM') {
    for (const item of array(record(accrual.item_fees, 'item fees').fees, 'item fees')) {
      for (const fee of array(record(item, 'item fee').fees, 'item fee services')) await addFee(fee);
    }
  } else if (accrual.accrued_category === 'NON_ITEM') {
    await addFee(accrual.non_item_fee);
  } else if (accrual.accrued_category === 'CONTAINER_FEES') {
    for (const fee of array(record(accrual.container_fees, 'container fees').fees, 'container fees')) await addFee(fee);
  } else {
    throw new Error('Unsupported Ozon finance accrued category');
  }
  return { id, accrual, total, components, postingNumber };
}

export async function syncFinanceAccrualDay(input: {
  db: FinanceDb; client: Client; shopId: string; date: string; convert: Converter; accrualTypes?: unknown;
}) {
  const { db, client, shopId, date, convert } = input;
  if (!validDay(date)) throw new Error('Invalid Ozon finance date');
  const typesRaw = input.accrualTypes ?? await client.getFinanceAccrualTypes();
  const types = parseTypes(typesRaw);
  const accruals: Awaited<ReturnType<typeof parseAccrual>>[] = [];
  const ids = new Set<string>(), cursors = new Set<string>();
  let lastId = '';
  for (let page = 0; ; page++) {
    if (page >= 1000) throw new Error('Ozon finance pagination limit exceeded');
    const response = record(await client.getFinanceAccrualByDay({ date, last_id: lastId }), 'day response');
    const entries = array(response.accruals, 'accruals');
    if (typeof response.last_id !== 'string') throw new Error('Missing Ozon finance pagination cursor');
    for (const entry of entries) {
      const parsed = await parseAccrual(entry, date, convert, types);
      if (ids.has(parsed.id)) throw new Error('Duplicate Ozon finance accrual ID');
      ids.add(parsed.id);
      accruals.push(parsed);
      if (accruals.length > MAX_DAY_ACCRUALS) throw new Error('Ozon finance accrual count limit exceeded');
    }
    if (!entries.length || !response.last_id) break;
    if (cursors.has(response.last_id)) throw new Error('Ozon finance pagination cursor did not advance');
    cursors.add(response.last_id);
    lastId = response.last_id;
  }

  const generation = randomUUID();
  const operationDate = new Date(date);
  await db.$transaction(async tx => {
    for (const item of accruals) {
      const row = {
        operationType: SOURCE, operationTypeName: String(item.accrual.accrued_category),
        category: 'accrual_total', postingNumber: item.postingNumber, orderId: null,
        ...item.total, operationDate,
        raw: { source: SOURCE, kind: 'ACCRUAL', generation, date, accrual: item.accrual, components: item.components } as Prisma.InputJsonValue,
      };
      const operationId = ROOT_PREFIX + item.id;
      await tx.ozonFinanceTransaction.upsert({
        where: { shopId_operationId: { shopId, operationId } },
        create: { shopId, operationId, ...row }, update: row,
      });
    }
    // Internal completion metadata, never a supplier operation or a business
    // amount. The marker and all roots become visible in one SQL transaction.
    const operationId = `accrual-day:v1:${date}`;
    const marker = {
      operationType: SNAPSHOT_TYPE, operationTypeName: null, category: 'source_snapshot',
      postingNumber: null, orderId: null, amount: 0, currency: 'CNY', amountCny: 0, exchangeRate: 1, operationDate,
      raw: { source: SOURCE, kind: 'SNAPSHOT', generation, date, count: accruals.length,
        idsSha256: createHash('sha256').update([...ids].sort().join('\n')).digest('hex'), types: typesRaw } as Prisma.InputJsonValue,
    };
    await tx.ozonFinanceTransaction.upsert({
      where: { shopId_operationId: { shopId, operationId } },
      create: { shopId, operationId, ...marker }, update: marker,
    });
  }, { maxWait: 10_000, timeout: 120_000 });
  return { accrualsStored: accruals.length };
}

export type EffectiveFinanceTransaction = {
  operationId: string; operationDate: Date; category: string; amountCny: unknown; costAmountCny?: number;
};

export async function readEffectiveFinanceTransactions(
  db: Pick<PrismaClient, 'ozonFinanceTransaction'>,
  input: { shopId: string; orderId?: string | null; postingNumber?: string | null; operationDate?: Prisma.DateTimeFilter },
): Promise<EffectiveFinanceTransaction[]> {
  const postingFilters = [input.orderId ? { orderId: input.orderId } : null,
    input.postingNumber ? { postingNumber: input.postingNumber } : null].filter((value): value is NonNullable<typeof value> => value !== null);
  // One statement supplies both business rows and their publication marker,
  // so a concurrent complete-day refresh cannot mix generations in a read.
  const rows = await db.ozonFinanceTransaction.findMany({ where: {
    shopId: input.shopId,
    ...(input.operationDate ? { operationDate: input.operationDate } : {}),
    ...(postingFilters.length ? { OR: [{ OR: postingFilters }, { operationType: SNAPSHOT_TYPE }] } : {}),
  } });
  const completed = new Map<string, string>();
  for (const row of rows) {
    const raw = row.raw as RecordValue;
    if (row.operationType === SNAPSHOT_TYPE && raw?.source === SOURCE && raw.kind === 'SNAPSHOT'
      && typeof raw.date === 'string' && typeof raw.generation === 'string') completed.set(raw.date, raw.generation);
  }
  const result: EffectiveFinanceTransaction[] = [];
  for (const row of rows) {
    if (row.operationType === SNAPSHOT_TYPE) continue;
    const day = row.operationDate.toISOString().slice(0, 10);
    const raw = row.raw as RecordValue;
    if (row.operationId.startsWith(ROOT_PREFIX)) {
      if (raw?.source !== SOURCE || raw.kind !== 'ACCRUAL' || completed.get(day) !== raw.generation) continue;
      for (const [i, component] of array(raw.components, 'stored components').entries()) {
        const value = record(component, 'stored component');
        if (typeof value.amountCny !== 'number' || !Number.isFinite(value.amountCny) || typeof value.category !== 'string') {
          throw new Error('Invalid stored Ozon finance component');
        }
        result.push({ operationId: `${row.operationId}:component:${i}`, operationDate: row.operationDate,
          category: value.category, amountCny: value.amountCny, costAmountCny: -value.amountCny });
      }
    } else if (!completed.has(day)) result.push(row);
  }
  return result;
}
