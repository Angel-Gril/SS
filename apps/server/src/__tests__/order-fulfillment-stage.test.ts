import { describe, expect, it } from 'vitest';
import { resolveOrderFulfillmentStage } from 'shared/order-fulfillment-stage';

describe('resolveOrderFulfillmentStage', () => {
  it('does not treat a generated international tracking number as shipped', () => {
    const stage = resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'pending',
    });
    expect(stage.key).toBe('awaiting_label');
    expect(stage.label).toBe('国际单已生成');

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      labelPrintedAt: new Date().toISOString(),
    }).label).toBe('打印面单');
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
    }).key).toBe('awaiting_label');

    expect(resolveOrderFulfillmentStage({
      status: 'awaiting_deliver',
      internationalTrackingNumber: 'OZON123',
      internationalStatus: 'shipped',
      warehouseScanOutAt: new Date().toISOString(),
    }).key).toBe('delivering');
  });

  it('tracks the domestic warehouse flow before international dispatch', () => {
    expect(resolveOrderFulfillmentStage({}).key).toBe('purchased');

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
    }).key).toBe('received');

    expect(resolveOrderFulfillmentStage({
      domesticTrackingNumber: 'SF123',
      domesticStatus: 'received',
      warehouseScanInAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    }).key).toBe('inspecting');
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
});
