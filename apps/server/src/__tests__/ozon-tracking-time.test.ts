import { describe, expect, it } from 'vitest';
import { resolveOzonTrackingEventTime } from '../lib/ozon-substatus.js';

describe('Ozon tracking observation time', () => {
  const observed = new Date('2026-10-14T02:00:00Z');
  it('uses order acceptance time for creation instead of the shipment deadline', () => {
    expect(resolveOzonTrackingEventTime({ substatus: 'posting_created', in_process_at: '2026-10-14T01:13:00Z',
      shipment_date: '2026-10-19T13:00:00Z' }, observed)).toEqual(new Date('2026-10-14T01:13:00Z'));
  });
  it('does not use a deadline or acceptance time as the assembly event time', () => {
    expect(resolveOzonTrackingEventTime({ substatus: 'posting_awaiting_deliver', in_process_at: '2026-10-14T01:13:00Z',
      shipment_date: '2026-10-19T13:00:00Z' }, observed)).toEqual(observed);
  });
  it('uses actual dispatch or delivery timestamps for their own events', () => {
    expect(resolveOzonTrackingEventTime({ substatus: 'posting_sent_by_seller', delivering_date: '2026-10-14T01:40:00Z' }, observed)).toEqual(new Date('2026-10-14T01:40:00Z'));
    expect(resolveOzonTrackingEventTime({ substatus: 'posting_delivered', delivered_at: '2026-10-14T01:55:00Z' }, observed)).toEqual(new Date('2026-10-14T01:55:00Z'));
  });
});
