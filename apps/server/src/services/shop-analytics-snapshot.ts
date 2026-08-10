import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const MAX_ANALYTICS_ITEMS = 2_000;
const MAX_TOTAL_SALES = 999_999_999_999.99;
const MAX_TOTAL_ORDERS = 2_147_483_647;

const analyticsRecordSchema = z.record(z.string(), z.unknown());
const periodSchema = z.string().trim().min(1).max(16);
const dateSchema = z.string().trim().regex(
  /^\d{4}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)?$/u,
);

const summarySchema = z.object({
  items: z.array(analyticsRecordSchema).min(1).max(MAX_ANALYTICS_ITEMS),
  period: periodSchema.optional(),
}).passthrough();

const graphsSchema = z.object({
  version: z.string().min(1).max(32).optional(),
  period: periodSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  prevFrom: dateSchema.optional(),
  prevTo: dateSchema.optional(),
  graphData: analyticsRecordSchema.nullable().optional(),
  tableData: analyticsRecordSchema.nullable().optional(),
  totals: analyticsRecordSchema.nullable().optional(),
  recommendations: analyticsRecordSchema.nullable().optional(),
  salesFunnel: analyticsRecordSchema.nullable().optional(),
}).passthrough().refine(
  (value) => value.graphData != null || value.tableData != null,
  { message: 'At least one graph or table payload is required' },
);

export interface ShopAnalyticsSnapshotData {
  period: string;
  data: Prisma.InputJsonValue;
  productCount: number;
  totalSales: number;
  totalOrders: number;
}

export interface ShopAnalyticsGraphsSnapshotBuild {
  snapshot: ShopAnalyticsSnapshotData;
  responseVersion: '1' | '3';
}

export class ShopAnalyticsPayloadError extends Error {
  constructor(message = 'Invalid shop analytics payload') {
    super(message);
    this.name = 'ShopAnalyticsPayloadError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ANALYTICS_ITEMS) throw new ShopAnalyticsPayloadError();
  return value.map((item) => {
    const parsed = record(item);
    if (!parsed) throw new ShopAnalyticsPayloadError();
    return parsed;
  });
}

function metric(value: unknown, integer: boolean): number {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isSafeInteger(parsed))) {
    throw new ShopAnalyticsPayloadError();
  }
  return parsed;
}

function assertTotals(totalSales: number, totalOrders: number): void {
  if (!Number.isFinite(totalSales)
    || totalSales < 0
    || totalSales > MAX_TOTAL_SALES
    || !Number.isSafeInteger(totalOrders)
    || totalOrders < 0
    || totalOrders > MAX_TOTAL_ORDERS) {
    throw new ShopAnalyticsPayloadError();
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ShopAnalyticsPayloadError();
  return parsed.data;
}

export function buildShopAnalyticsSummarySnapshot(body: unknown): ShopAnalyticsSnapshotData {
  const parsed = parseOrThrow(summarySchema, body);
  const totalSales = parsed.items.reduce(
    (sum, item) => sum + metric(item.soldSum, false),
    0,
  );
  const totalOrders = parsed.items.reduce(
    (sum, item) => sum + metric(item.soldCount, true),
    0,
  );
  assertTotals(totalSales, totalOrders);

  return {
    period: parsed.period || '30d',
    data: { type: 'what_to_sell', items: parsed.items } as Prisma.InputJsonValue,
    productCount: parsed.items.length,
    totalSales,
    totalOrders,
  };
}

export function buildShopAnalyticsGraphsSnapshot(body: unknown): ShopAnalyticsGraphsSnapshotBuild {
  const parsed = parseOrThrow(graphsSchema, body);
  const isV3 = parsed.version === 'v3';
  let productCount = 0;
  let totalSales = 0;
  let totalOrders = 0;

  if (isV3) {
    const tableItems = records(record(parsed.tableData)?.items);
    productCount = tableItems.length;
    totalOrders = tableItems.reduce((sum, item) => {
      const metrics = record(item.metrics);
      return sum + metric(metrics?.orderedUnits, true);
    }, 0);
    const itemRevenue = tableItems.reduce((sum, item) => {
      const metrics = record(item.metrics);
      return sum + metric(metrics?.revenue, false);
    }, 0);
    const totalMetrics = record(record(parsed.totals)?.metrics);
    const statedRevenue = metric(totalMetrics?.revenue, false);
    totalSales = statedRevenue || itemRevenue;
  } else {
    const tableItems = records(record(record(parsed.tableData)?.result)?.data);
    productCount = tableItems.length;
    totalSales = tableItems.reduce((sum, item) => {
      const metrics = Array.isArray(item.metrics) ? item.metrics : [];
      return sum + metric(metrics[4], false);
    }, 0);
    totalOrders = tableItems.reduce((sum, item) => {
      const metrics = Array.isArray(item.metrics) ? item.metrics : [];
      return sum + metric(metrics[0], true);
    }, 0);
  }
  assertTotals(totalSales, totalOrders);

  return {
    responseVersion: isV3 ? '3' : '1',
    snapshot: {
      period: parsed.period || '30d',
      data: {
        type: 'graphs',
        version: parsed.version || 'legacy',
        dateFrom: parsed.dateFrom || null,
        dateTo: parsed.dateTo || null,
        prevFrom: parsed.prevFrom || null,
        prevTo: parsed.prevTo || null,
        graphData: parsed.graphData || null,
        tableData: parsed.tableData || null,
        totals: parsed.totals || null,
        recommendations: parsed.recommendations || null,
        salesFunnel: parsed.salesFunnel || null,
      } as Prisma.InputJsonValue,
      productCount,
      totalSales,
      totalOrders,
    },
  };
}
