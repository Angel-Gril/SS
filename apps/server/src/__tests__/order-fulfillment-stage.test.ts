import { describe, expect, it } from 'vitest';
import { resolveOrderFulfillmentStage, resolveOrderFulfillmentStatus, ORDER_FULFILLMENT_PIPELINE } from 'shared/order-fulfillment-stage';

describe('resolveOrderFulfillmentStage', () => {
  it('recognizes platform stock readiness without an ERP marker or domestic tracking', () => {
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_deliver' }).key).toBe('domestic_transit');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_packaging' }).key).toBe('purchased');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_deliver', subStatus: 'ship_failed' }).key).toBe('purchased');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_deliver', warehouseScanInAt: new Date() }).key).toBe('warehouse_processing');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_deliver', subStatus: 'posting_sent_by_seller' }).key).toBe('delivering');
  });
  it('does not let a legacy local Ozon marker substitute for platform readiness', () => {
    expect(resolveOrderFulfillmentStage({ shop: { platform: 'OZON' }, status: 'awaiting_packaging', stockPreparedAt: new Date() }).key).toBe('purchased');
    expect(resolveOrderFulfillmentStage({ shop: { platform: 'OZON' }, status: 'awaiting_deliver' }).key).toBe('domestic_transit');
    expect(resolveOrderFulfillmentStage({ platform: 'OTHER', stockPreparedAt: new Date() }).key).toBe('domestic_transit');
  });
  it('keeps a newly created posting at purchasing even with a future shipment deadline', () => {
    expect(resolveOrderFulfillmentStage({ platform: 'OZON', status: 'awaiting_packaging', subStatus: 'posting_created',
      inProcessAt: '2026-10-14T01:13:00Z', shipmentDate: '2026-10-19T13:00:00Z' }).key).toBe('purchased');
  });
  it('does not treat a generated international tracking number as shipped', () => {
    const stage = resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'pending',
    });
    expect(stage.key).toBe('domestic_transit');
    expect(stage.label).toBe('国内在途');

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      labelPrintedAt: new Date().toISOString(),
    }).label).toBe('国内在途');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_packaging', internationalTrackingNumber: 'OZON123', labelPrintedAt: new Date() }).key).toBe('purchased');
  });

  it('shows outbound dispatch only after a real shipping signal', () => {
    expect(resolveOrderFulfillmentStage({
      status: 'delivering',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'pending',
    }).key).toBe('delivering');

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'shipped',
    }).key).toBe('delivering');

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'shipped',
      warehouseScanOutAt: new Date().toISOString(),
    }).key).toBe('delivering');
  });

  it('tracks the domestic warehouse flow before international dispatch', () => {
    const firstStage = resolveOrderFulfillmentStage({});
    expect(firstStage.key).toBe('purchased');
    expect(firstStage.label).toBe('采购备货');

    expect(resolveOrderFulfillmentStage({
      inspectionStatus: 'pending',
    }).key).toBe('purchased');

    expect(resolveOrderFulfillmentStage({
      domesticTrackingNumber: 'SF123',
      domesticStatus: 'shipped',
    }).key).toBe('domestic_transit');

    expect(resolveOrderFulfillmentStage({
      domesticTrackingNumber: 'SF123',
      domesticStatus: 'received',
      warehouseScanInAt: new Date().toISOString(),
    }).key).toBe('warehouse_processing');

    expect(resolveOrderFulfillmentStage({
      domesticTrackingNumber: 'SF123',
      domesticStatus: 'received',
      warehouseScanInAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }).key).toBe('warehouse_processing');
  });

  it('uses warehouse processing for inspection, packing and label printing', () => {
    expect(resolveOrderFulfillmentStage({
      domesticTrackingNumber: 'SF123',
      domesticStatus: 'received',
      warehouseScanInAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    })).toMatchObject({
      key: 'warehouse_processing',
      label: '仓库处理',
    });

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      shipmentDate: new Date().toISOString(),
    })).toMatchObject({
      key: 'domestic_transit',
      label: '国内在途',
    });
  });

  it('keeps abnormal orders out of the normal flow', () => {
    expect(resolveOrderFulfillmentStage({
      status: 'cancelled',
      internationalStatus: 'shipped',
    }).key).toBe('abnormal');

    expect(resolveOrderFulfillmentStage({
      inspectionStatus: 'failed',
    }).key).toBe('abnormal');
  });

  it('merges warehouse and outbound stages while keeping normalized secondary statuses', () => {
    expect(ORDER_FULFILLMENT_PIPELINE.map(stage => stage.key)).toEqual([
      'purchased', 'domestic_transit', 'warehouse_processing', 'delivering', 'abnormal',
    ]);
    for (const status of ['awaiting_packaging', 'awaiting_deliver']) {
      const order = { status, warehouseScanInAt: new Date() };
      expect(resolveOrderFulfillmentStage(order).key).toBe('warehouse_processing');
      expect(resolveOrderFulfillmentStatus(order)).toBe(status);
    }
    expect(resolveOrderFulfillmentStage({ status: 'delivered' }).key).toBe('delivering');
    expect(resolveOrderFulfillmentStatus({ status: 'delivered' })).toBe('delivered');
    expect(resolveOrderFulfillmentStatus({ status: 'awaiting_deliver', internationalStatus: 'in_transit' })).toBe('delivering');
    expect(resolveOrderFulfillmentStatus({ status: 'cancelled', deliveredAt: new Date() })).toBe('cancelled');
    expect(resolveOrderFulfillmentStatus({ status: 'delivered', inspectionStatus: 'failed' })).toBe('exception');
  });

  it('uses confirmed stock readiness only before a real warehouse or outbound signal', () => {
    const stockPreparedAt = new Date();
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_deliver', stockPreparedAt }).key).toBe('domestic_transit');
    expect(resolveOrderFulfillmentStatus({ status: 'awaiting_deliver', stockPreparedAt })).toBeNull();
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_packaging', warehouseScanInAt: new Date(), stockPreparedAt }).key).toBe('warehouse_processing');
    expect(resolveOrderFulfillmentStage({ status: 'cancelled', stockPreparedAt }).key).toBe('abnormal');
    expect(resolveOrderFulfillmentStage({ internationalStatus: 'shipped', stockPreparedAt }).key).toBe('delivering');
  });

  it('does not mistake a domestic warehouse received substatus or deadline for international delivery', () => {
    expect(resolveOrderFulfillmentStage({ subStatus: 'warehouse_received', shipmentDate: new Date() }).key).toBe('purchased');
    expect(resolveOrderFulfillmentStage({ status: 'awaiting_packaging', shipmentDate: new Date(), internationalTrackingNumber: 'generated-label' }).key).toBe('purchased');
  });
});
