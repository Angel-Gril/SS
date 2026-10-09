import { resolveOrderFulfillmentStage, resolveOrderFulfillmentStatus, type OrderFulfillmentStageInput } from 'shared/order-fulfillment-stage';

type Queryable = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  warehouseLog: {
    findMany(args: unknown): Promise<Array<{ createdAt: Date }>>;
    create(args: unknown): Promise<{ createdAt: Date }>;
  };
};

type Database = Queryable & {
  $transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T>;
};

type StockOrderRow = OrderFulfillmentStageInput & {
  id: string;
  shopId: string;
  status: string | null;
  subStatus: string | null;
  domesticStatus: string | null;
  internationalStatus: string | null;
};

export type StockReadyResult =
  | { kind: 'not_found' }
  | { kind: 'immutable'; stage: ReturnType<typeof resolveOrderFulfillmentStage>['key'] }
  | { kind: 'marked'; id: string; stockPreparedAt: Date; replayed: boolean; stage: ReturnType<typeof resolveOrderFulfillmentStage>['key']; status: ReturnType<typeof resolveOrderFulfillmentStatus> };

/**
 * Durable owner for the purchasing-ready marker. The route only validates the
 * request and serializes this result; shop ownership, row locking, status
 * guards, audit identity and replay are kept here.
 */
export function createOrderStockReadyService(database: Database) {
  return {
    async mark(input: { orderId: string; ownerUserId: string; actorUserId: string }): Promise<StockReadyResult> {
      return database.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<StockOrderRow[]>`
          SELECT o.id, o.shop_id AS "shopId", o.status, o.sub_status AS "subStatus",
            o.domestic_status AS "domesticStatus", o.international_status AS "internationalStatus",
            o.domestic_tracking_number AS "domesticTrackingNumber",
            o.international_tracking_number AS "internationalTrackingNumber",
            o.delivering_date AS "deliveringDate", o.delivered_at AS "deliveredAt",
            o.inspection_status AS "inspectionStatus"
          FROM "orders" o
          JOIN "shops" s ON s.id = o.shop_id
          WHERE o.id = ${input.orderId} AND s.user_id = ${input.ownerUserId} AND s.status <> 'DISABLED'
          FOR UPDATE`;
        const order = rows[0];
        if (!order) return { kind: 'not_found' } as const;

        const existing = await tx.warehouseLog.findMany({
          where: { orderId: input.orderId, operationType: 'stock_ready' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        if (existing[0]) {
          const projection = { ...order, stockPreparedAt: existing[0].createdAt };
          return {
            kind: 'marked', id: order.id, stockPreparedAt: existing[0].createdAt, replayed: true,
            stage: resolveOrderFulfillmentStage(projection).key,
            status: resolveOrderFulfillmentStatus(projection),
          } as const;
        }

        // Physical warehouse / outbound facts are read inside the same lock.
        const logs = await tx.warehouseLog.findMany({
          where: { orderId: input.orderId, operationType: { in: ['scan_in', 'scan_out'] } },
          orderBy: { createdAt: 'asc' },
          select: { operationType: true, createdAt: true },
        }) as Array<{ operationType: string; createdAt: Date }>;
        const current = resolveOrderFulfillmentStage({
          ...order,
          warehouseScanInAt: logs.find(log => log.operationType === 'scan_in')?.createdAt ?? null,
          warehouseScanOutAt: logs.find(log => log.operationType === 'scan_out')?.createdAt ?? null,
        });
        if (current.key === 'abnormal' || current.key === 'warehouse_processing' || current.key === 'delivering') {
          return { kind: 'immutable', stage: current.key } as const;
        }

        const created = await tx.warehouseLog.create({
          data: { orderId: order.id, operationType: 'stock_ready', operatorId: input.actorUserId, note: '用户确认已备货' },
          select: { createdAt: true },
        });
        const projection = { ...order, stockPreparedAt: created.createdAt };
        return {
          kind: 'marked', id: order.id, stockPreparedAt: created.createdAt, replayed: false,
          stage: resolveOrderFulfillmentStage(projection).key,
          status: resolveOrderFulfillmentStatus(projection),
        } as const;
      });
    },
  };
}

export type OrderStockReadyService = ReturnType<typeof createOrderStockReadyService>;
