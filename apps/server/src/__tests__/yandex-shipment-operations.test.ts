import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ find: vi.fn(), pending: vi.fn(), create: vi.fn(), update: vi.fn(), shop: vi.fn(), tx: vi.fn(), lock: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { yandexOfferPublishOperation: { findUnique: m.find, findFirst: m.pending, update: m.update }, $transaction: m.tx } }));
import { readYandexShipments, readYandexShipmentContext, executeYandexShipmentConfirmation, readYandexShipmentDocument, readYandexPendingShipmentCommand } from '../services/yandex-shipment-operations.js';
import { yandexShipmentResponseSchema, yandexShipmentsResponseSchema, yandexShipmentDateRange } from '../services/yandex-shipment-contract.js';

function shipment(status = 'OUTBOUND_READY_FOR_CONFIRMATION') {
  return { id: '555', status, shipmentDate: '2026-10-29', availableActions: status === 'OUTBOUND_READY_FOR_CONFIRMATION' ? ['CONFIRM'] : ['DOWNLOAD_ACT'], orderIds: ['456'], plannedCount: 1, draftCount: 1, factCount: 0, signature: { signed: false } };
}
function fixture() {
  return { shop: { id: 'shop', userId: 'owner', status: 'ACTIVE', clientId: '123', apiKeyEncrypted: 'synthetic-encrypted', config: { yandexMarket: { campaignId: '123', businessId: '77' } } },
    ownerUserId: 'owner', actorUserId: 'actor', shipmentId: '555', body: { confirm: true, idempotencyKey: 'synthetic-shipment-key' },
    client: { getCampaign: vi.fn().mockResolvedValue({ id: '123', business: { id: '77' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' }), getShipment: vi.fn().mockResolvedValue(shipment()), getShipments: vi.fn().mockResolvedValue({ shipments: [shipment()], nextPageToken: null }), getOrdersByIds: vi.fn().mockResolvedValue([{ orderId: 456, campaignId: 123, fake: false }]), confirmShipment: vi.fn().mockResolvedValue({ status: 'OK' }), getShipmentDocument: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45])) } };
}
describe('Yandex native first-mile shipments', () => {
  beforeEach(() => { vi.clearAllMocks(); m.find.mockResolvedValue(null); m.pending.mockResolvedValue(null); m.shop.mockResolvedValue({ id: 'shop' }); m.create.mockImplementation(async ({ data }) => ({ ...data, id: 'operation' })); m.update.mockResolvedValue({}); m.tx.mockImplementation(async fn => fn({ $executeRaw: m.lock, shop: { findFirst: m.shop }, yandexOfferPublishOperation: { findUnique: m.find, findFirst: m.pending, create: m.create } })); });
  it('parses list and detail status from their distinct official response shapes', () => {
    const base = { id: 555, planIntervalFrom: '2026-10-29T08:00:00+03:00', planIntervalTo: '2026-10-29T10:00:00+03:00', orderIds: [456], draftCount: 1, plannedCount: 1, factCount: 0, signature: { signed: false } };
    const list = yandexShipmentsResponseSchema.parse({ status: 'OK', result: { shipments: [{ ...base, status: 'OUTBOUND_CONFIRMED' }] } });
    expect(list.shipments[0]).toMatchObject({ id: '555', status: 'OUTBOUND_CONFIRMED', shipmentDate: '2026-10-29', orderIds: ['456'], availableActions: [] });
    expect(yandexShipmentResponseSchema.parse({ status: 'OK', result: { ...base, currentStatus: { status: 'OUTBOUND_READY_FOR_CONFIRMATION' }, availableActions: ['CONFIRM'] } })).toMatchObject({ id: '555', status: 'OUTBOUND_READY_FOR_CONFIRMATION', availableActions: ['CONFIRM'] });
  });
  it('bounds calendar date ranges and rejects fake dates before API use', () => {
    expect(yandexShipmentDateRange.parse({ dateFrom: '2026-10-01', dateTo: '2026-10-29' })).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-29' });
    expect(() => yandexShipmentDateRange.parse({ dateFrom: '2026-02-30', dateTo: '2026-03-02' })).toThrow();
    expect(() => yandexShipmentDateRange.parse({ dateFrom: '2026-01-01', dateTo: '2026-10-29' })).toThrow();
  });
  it('rejects wrong owner, non-FBS fulfillment and changed native shipment IDs', async () => {
    const f = fixture(); f.ownerUserId = 'other'; await expect(readYandexShipmentContext(f)).rejects.toThrow('店铺'); expect(f.client.getShipment).not.toHaveBeenCalled();
    f.ownerUserId = 'owner'; f.client.getCampaign.mockResolvedValue({ id: '123', business: { id: '77' }, placementType: 'FBY', apiAvailability: 'AVAILABLE' });
    await expect(readYandexShipmentContext(f)).rejects.toThrow('履约'); expect(f.client.getShipment).not.toHaveBeenCalled();
    f.client.getCampaign.mockResolvedValue({ id: '123', business: { id: '77' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' }); f.client.getShipment.mockResolvedValue({ ...shipment(), id: '666' });
    await expect(readYandexShipmentContext(f)).rejects.toThrow('归属');
  });
  it('never confirms before the platform exposes CONFIRM or with foreign membership', async () => {
    const f = fixture(); f.client.getShipment.mockResolvedValue({ ...shipment(), availableActions: [] });
    await expect(executeYandexShipmentConfirmation(f)).rejects.toThrow('确认'); expect(m.create).not.toHaveBeenCalled();
    f.client.getShipment.mockResolvedValue(shipment()); f.client.getOrdersByIds.mockResolvedValue([{ orderId: 456, campaignId: 999, fake: false }]);
    await expect(executeYandexShipmentConfirmation(f)).rejects.toThrow('订单'); expect(f.client.confirmShipment).not.toHaveBeenCalled();
  });
  it('journals before dispatch and requires the native confirmed state after HTTP acceptance', async () => {
    const f = fixture();
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'SUBMITTING', replayed: false });
    expect(m.create.mock.calls[0]![0].data).toMatchObject({ requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: ['555'], orderIds: ['456'] } });
    expect(f.client.confirmShipment).toHaveBeenCalledWith('123', '555');
  });
  it('records success only after confirmed readback and durable outcome persistence', async () => {
    const f = fixture(); f.client.getShipment.mockResolvedValueOnce(shipment()).mockResolvedValueOnce(shipment('OUTBOUND_CONFIRMED'));
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'SUCCEEDED' });
    m.update.mockRejectedValue(new Error('synthetic database failure'));
    f.client.getShipment.mockResolvedValueOnce(shipment()).mockResolvedValueOnce(shipment('OUTBOUND_CONFIRMED'));
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'UNKNOWN' });
  });
  it('keeps unknown requests locked and reconciles without a second confirm', async () => {
    const f = fixture(); f.client.confirmShipment.mockRejectedValue(new Error('synthetic transport timeout'));
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'UNKNOWN' });
    const saved = { ...m.create.mock.calls[0]![0].data, id: 'operation', state: 'UNKNOWN' }; m.find.mockResolvedValue(saved);
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'UNKNOWN', replayed: true });
    f.client.getShipment.mockResolvedValue(shipment('OUTBOUND_CONFIRMED'));
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'SUCCEEDED', replayed: true }); expect(f.client.confirmShipment).toHaveBeenCalledTimes(1);
    m.update.mockRejectedValue(new Error('synthetic database failure'));
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'UNKNOWN', replayed: true });
  });
  it('blocks overlapping pending order/shipment operations and rechecks shop credentials', async () => {
    const f = fixture(); m.pending.mockResolvedValue({ id: 'older' });
    await expect(executeYandexShipmentConfirmation(f)).rejects.toThrow('未确认'); expect(f.client.confirmShipment).not.toHaveBeenCalled();
    m.pending.mockResolvedValue(null); m.shop.mockResolvedValue(null);
    await expect(executeYandexShipmentConfirmation(f)).rejects.toThrow('凭据'); expect(m.create).not.toHaveBeenCalled();
  });
  it('only fetches fixed document types when the live shipment allows them', async () => {
    const f = fixture(); await expect(readYandexShipmentDocument({ ...f, documentType: 'ACT' })).rejects.toThrow('文档');
    f.client.getShipment.mockResolvedValue(shipment('OUTBOUND_CONFIRMED'));
    expect(await readYandexShipmentDocument({ ...f, documentType: 'ACT' })).toBeInstanceOf(Uint8Array); expect(f.client.getShipmentDocument).toHaveBeenCalledWith('123', '555', 'ACT');
    await expect(readYandexShipmentDocument({ ...f, documentType: 'http://localhost' })).rejects.toThrow();
  });
  it('rejects an incomplete or repeated page sequence rather than returning a partial shipment list', async () => {
    const f = fixture(); f.client.getShipments.mockResolvedValue({ shipments: [shipment()], nextPageToken: 'same' });
    await expect(readYandexShipments({ ...f, range: { dateFrom: '2026-10-01', dateTo: '2026-10-29' } })).rejects.toThrow('分页');
  });
  it('restores only an original pending command scoped to the owned native shipment', async () => {
    const f = fixture(); m.pending.mockResolvedValue({ requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: ['555'], command: f.body } });
    expect(await readYandexPendingShipmentCommand(f)).toEqual(f.body);
    expect(m.pending).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerUserId: 'owner', shopId: 'shop', state: { in: ['SUBMITTING', 'UNKNOWN'] }, AND: expect.any(Array) }), orderBy: { createdAt: 'desc' } }));
    m.pending.mockResolvedValue({ requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: ['555'], command: { ...f.body, confirm: false } } });
    expect(await readYandexPendingShipmentCommand(f)).toBeNull();
    m.pending.mockResolvedValue({ requestPayload: { kind: 'ORDER_MANAGEMENT', shipmentIds: ['555'], command: f.body } });
    expect(await readYandexPendingShipmentCommand(f)).toBeNull();
    m.pending.mockResolvedValue({ requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: ['666'], command: f.body } });
    expect(await readYandexPendingShipmentCommand(f)).toBeNull();
    await expect(readYandexPendingShipmentCommand({ ...f, ownerUserId: 'other' })).rejects.toThrow('店铺');
  });
});
