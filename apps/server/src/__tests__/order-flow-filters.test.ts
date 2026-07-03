import { describe, expect, it } from 'vitest';
import {
  buildOrderCreatedAtRange,
  filterOrderIdsByFulfillmentStage,
  filterOrderIdsByShipmentUrgency,
} from '../routes/order.js';
import { isOrderAwaitingSellerShipment } from 'shared/order-fulfillment-stage';

describe('order flow filters', () => {
  it('treats the end date as an inclusive local day', () => {
    const range = buildOrderCreatedAtRange('2026-06-08', '2026-06-22');

    expect(range).toEqual({
      gte: new Date('2026-06-08T00:00:00.000Z'),
      lt: new Date('2026-06-23T00:00:00.000Z'),
    });
  });

  it('filters order ids by the computed fulfillment stage', () => {
    const now = new Date('2026-06-23T00:00:00.000Z');
    const orders = [
      { id: 'needs-purchase', status: 'awaiting_packaging', inProcessAt: now },
      { id: 'domestic', domesticTrackingNumber: 'SF123', domesticStatus: 'shipped' },
      { id: 'received', domesticTrackingNumber: 'SF456', domesticStatus: 'received' },
      { id: 'warehouse-aged', domesticTrackingNumber: 'SF789', domesticStatus: 'received' },
      { id: 'warehouse-label', status: 'awaiting_deliver', internationalTrackingNumber: 'OZON123' },
      { id: 'outbound', status: 'delivering', internationalTrackingNumber: 'OZON456' },
    ];
    const logs = [
      { orderId: 'received', operationType: 'scan_in', createdAt: new Date('2026-06-22T23:45:00.000Z') },
      { orderId: 'warehouse-aged', operationType: 'scan_in', createdAt: new Date('2026-06-22T23:00:00.000Z') },
      { orderId: 'outbound', operationType: 'scan_out', createdAt: new Date('2026-06-22T23:30:00.000Z') },
    ];

    expect(filterOrderIdsByFulfillmentStage(orders, logs, 'warehouse_processing', now)).toEqual([
      'warehouse-aged',
      'warehouse-label',
    ]);
    expect(filterOrderIdsByFulfillmentStage(orders, logs, 'purchased', now)).toEqual(['needs-purchase']);
    expect(filterOrderIdsByFulfillmentStage(orders, logs, 'received', now)).toEqual(['received']);
  });

  it('does not treat Ozon-dispatched postings as still awaiting seller shipment', () => {
    const overdueDeadline = new Date('2026-06-23T08:00:00.000Z');

    expect(isOrderAwaitingSellerShipment({
      status: 'awaiting_deliver',
      shipmentDate: overdueDeadline,
    })).toBe(true);

    expect(isOrderAwaitingSellerShipment({
      status: 'awaiting_deliver',
      subStatus: 'posting_sent_by_seller',
      shipmentDate: overdueDeadline,
    })).toBe(false);

    expect(isOrderAwaitingSellerShipment({
      status: 'awaiting_deliver',
      subStatus: 'posting_in_cariage',
      shipmentDate: overdueDeadline,
    })).toBe(false);

    expect(isOrderAwaitingSellerShipment({
      status: 'awaiting_deliver',
      shipmentDate: overdueDeadline,
      deliveringDate: new Date('2026-06-23T09:00:00.000Z'),
    })).toBe(false);
  });

  it('filters shipment urgency using official Ozon dispatch signals', () => {
    const now = new Date('2026-06-23T01:00:00.000Z');
    const orders = [
      { id: 'still-awaiting', status: 'awaiting_deliver', shipmentDate: new Date('2026-06-23T00:00:00.000Z') },
      { id: 'sent-by-seller', status: 'awaiting_deliver', subStatus: 'posting_sent_by_seller', shipmentDate: new Date('2026-06-23T00:00:00.000Z') },
      { id: 'in-carriage-typo', status: 'awaiting_deliver', subStatus: 'posting_in_cariage', shipmentDate: new Date('2026-06-23T00:00:00.000Z') },
      { id: 'has-delivering-date', status: 'awaiting_deliver', shipmentDate: new Date('2026-06-23T00:00:00.000Z'), deliveringDate: new Date('2026-06-23T00:30:00.000Z') },
      { id: 'today-deadline', status: 'awaiting_deliver', shipmentDate: new Date('2026-06-23T08:00:00.000Z') },
      { id: 'tomorrow-deadline', status: 'awaiting_deliver', shipmentDate: new Date('2026-06-24T08:00:00.000Z') },
    ];

    expect(filterOrderIdsByShipmentUrgency(orders, 'overdue', now)).toEqual(['still-awaiting']);
    expect(filterOrderIdsByShipmentUrgency(orders, 'today', now)).toEqual(['today-deadline']);
    expect(filterOrderIdsByShipmentUrgency(orders, 'tomorrow', now)).toEqual(['tomorrow-deadline']);
  });
});
