import { z } from 'zod';

type OzonInt64 = number | string;
interface OzonReturnDateRange { time_from: string; time_to: string }
export interface OzonReturnsListParams {
  filter?: {
    logistic_return_date?: OzonReturnDateRange;
    storage_tariffication_start_date?: OzonReturnDateRange;
    visual_status_change_moment?: OzonReturnDateRange;
    order_id?: OzonInt64;
    posting_numbers?: string[];
    product_name?: string;
    offer_id?: string;
    visual_status_name?: string;
    warehouse_id?: OzonInt64;
    barcode?: string;
    return_schema?: 'FBS' | 'FBO';
    compensation_status_id?: number;
  };
  last_id?: OzonInt64;
  limit: number;
}
export interface OzonReturn {
  id: OzonInt64;
  posting_number?: string;
  return_reason_name?: string;
  product?: {
    sku?: OzonInt64;
    offer_id?: string;
    name?: string;
    quantity?: number;
    price?: { price?: string | number; currency_code?: string };
  };
  storage?: { arrived_moment?: string; [key: string]: unknown };
  logistic?: { return_date?: string; final_moment?: string; barcode?: string; [key: string]: unknown };
  visual?: { status?: { id?: number; display_name?: string; sys_name?: string }; change_moment?: string };
  [key: string]: unknown;
}

export const returnSyncInputSchema = z.object({
  shopId: z.string().trim().min(1).max(200),
  since: z.string().datetime({ offset: true }).optional(),
});

function returnId(value: OzonInt64): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('OZON 退货 ID 数值精度不安全');
  const id = String(value);
  if (!/^[1-9]\d*$/.test(id) || id.length > 19 || BigInt(id) > 9223372036854775807n) {
    throw new Error('OZON 退货 ID 无效');
  }
  return id;
}

function returnDate(value: string | undefined): Date | null {
  if (!value) return null;
  if (!z.string().datetime({ offset: true }).safeParse(value).success) throw new Error('OZON 退货日期无效');
  return new Date(value);
}

export function mapOzonReturn(item: OzonReturn) {
  const platformReturnId = returnId(item.id);
  const rawAmount = item.product?.price?.price;
  const amount = rawAmount == null ? null : String(rawAmount);
  if (rawAmount != null && ((typeof rawAmount !== 'string' && typeof rawAmount !== 'number')
    || !/^\d{1,10}(\.\d{1,2})?$/.test(amount!))) {
    throw new Error('OZON 退货金额无效或超过存储精度');
  }
  const currency = item.product?.price?.currency_code;
  if (amount != null && (!currency || !/^[A-Z]{3}$/.test(currency))) throw new Error('OZON 退货金额缺少有效币种');
  const quantity = item.product?.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) throw new Error('OZON 退货数量无效');
  const status = item.visual?.status?.sys_name || 'unknown';
  return {
    platformReturnId,
    postingNumber: item.posting_number ?? null,
    status,
    reason: item.return_reason_name ?? null,
    product: item.product ?? null,
    quantity,
    amount: amount ?? null,
    currency: currency ?? 'RUB',
    // Being at the return pickup point is not warehouse arrival or seller receipt.
    returnedToWarehouse: status === 'ReturnedToOzon' || status === 'ReceivedBySeller',
    acceptedAt: returnDate(item.storage?.arrived_moment),
    returnedAt: returnDate(item.logistic?.return_date),
    raw: item,
  };
}

interface ReturnsClient {
  getReturnsList(params: OzonReturnsListParams): Promise<{ returns: OzonReturn[]; has_next: boolean }>;
}

/** Pull status changes in one fixed time window. An incomplete scan never reports SUCCESS. */
export async function syncOzonReturns(
  client: ReturnsClient,
  since: string | undefined,
  save: (row: ReturnType<typeof mapOzonReturn>) => Promise<unknown>,
): Promise<number> {
  const timeTo = new Date();
  const timeFrom = since ? new Date(since) : new Date(timeTo.getTime() - 30 * 24 * 3600 * 1000);
  if (!Number.isFinite(timeFrom.getTime()) || timeFrom > timeTo) throw new Error('退货同步开始时间无效或晚于当前时间');
  const filter = { visual_status_change_moment: { time_from: timeFrom.toISOString(), time_to: timeTo.toISOString() } };
  let lastId: OzonInt64 = 0;
  let count = 0;
  const seenIds = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = await client.getReturnsList({ filter, last_id: lastId, limit: 500 });
    if (!Array.isArray(result.returns) || typeof result.has_next !== 'boolean') throw new Error('OZON 退货响应格式无效');
    if (result.returns.length > 500) throw new Error('OZON 退货单页超出数量限制');
    if (result.returns.length === 0 && result.has_next) throw new Error('OZON 退货分页为空但仍有下一页');
    const rows = result.returns.map(mapOzonReturn);
    for (const row of rows) {
      if (seenIds.has(row.platformReturnId)) throw new Error('OZON 退货分页未推进或出现重复 ID');
      seenIds.add(row.platformReturnId);
    }
    for (const row of rows) {
      await save(row);
      count++;
    }
    if (!result.has_next) return count;
    const last = result.returns.at(-1)!;
    lastId = typeof last.id === 'number' ? last.id : returnId(last.id);
  }
  throw new Error(`退货同步达到 20 页上限，已保存 ${count} 条，仍有后续记录；本次同步未完成，请缩小日期范围`);
}
