import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { executeYandexShipmentConfirmation } from '../services/yandex-shipment-operations.js';

const enabled = process.env.RUN_YANDEX_POSTGRES_TESTS === '1', suite = enabled ? describe : describe.skip;
const prefix = 'yandex_' + randomUUID().replaceAll('-', '');
const ownerUserId = prefix + '_owner', shopId = prefix + '_shop';
const shop = { id: shopId, userId: ownerUserId, status: 'ACTIVE' as const, clientId: '123', apiKeyEncrypted: 'synthetic-encrypted', config: { yandexMarket: { campaignId: '123', businessId: '77' } } };
const shipment = { id: '555', status: 'OUTBOUND_READY_FOR_CONFIRMATION', shipmentDate: '2026-10-29', availableActions: ['CONFIRM'], orderIds: ['456'], plannedCount: 1, draftCount: 1, factCount: 0, signature: { signed: false } };
function input(key: string, writer = vi.fn().mockResolvedValue({ status: 'OK' as const })) {
  return { shop, ownerUserId, actorUserId: ownerUserId, shipmentId: '555', body: { confirm: true, idempotencyKey: prefix + key },
    client: { getCampaign: vi.fn().mockResolvedValue({ id: '123', business: { id: '77' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' }), getShipment: vi.fn().mockResolvedValue(shipment),
      getOrdersByIds: vi.fn().mockResolvedValue([{ orderId: 456, campaignId: 123, fake: false }]), getShipments: vi.fn(), confirmShipment: writer, getShipmentDocument: vi.fn() } };
}
suite('Yandex shipment command journal on PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^yandex_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') || '')) throw Error('An isolated local yandex_test_* schema is required');
    await prisma.user.create({ data: { id: ownerUserId, phone: prefix, passwordHash: 'synthetic-hash' } });
    await prisma.shop.create({ data: { ...shop, platform: 'YANDEX', name: 'isolated shipment shop' } });
  });
  beforeEach(async () => { await prisma.yandexOfferPublishOperation.deleteMany({ where: { ownerUserId } }); });
  afterAll(async () => {
    await prisma.yandexOfferPublishOperation.deleteMany({ where: { ownerUserId } });
    await prisma.shop.delete({ where: { id: shopId } }); await prisma.user.delete({ where: { id: ownerUserId } }); await prisma.$disconnect();
  });
  it('persists a tagged reservation and reconciles acceptance by native confirmed state without another POST', async () => {
    const f = input('replay'); const first = await executeYandexShipmentConfirmation(f);
    expect(first.state).toBe('SUBMITTING');
    expect(await prisma.yandexOfferPublishOperation.findUnique({ where: { id: first.id } })).toMatchObject({ state: 'SUBMITTING', requestPayload: { kind: 'SHIPMENT_MANAGEMENT', shipmentIds: ['555'], orderIds: ['456'] } });
    f.client.getShipment.mockResolvedValue({ ...shipment, status: 'OUTBOUND_CONFIRMED', availableActions: ['DOWNLOAD_ACT'] });
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ id: first.id, state: 'SUCCEEDED', replayed: true });
    expect(f.client.confirmShipment).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent confirmations with different keys for the same native shipment', async () => {
    let notify!: () => void, finish!: (value: { status: 'OK' }) => void;
    const started = new Promise<void>(resolve => { notify = resolve; }), provider = new Promise<{ status: 'OK' }>(resolve => { finish = resolve; });
    const writer = vi.fn().mockImplementation(() => { notify(); return provider; });
    const first = executeYandexShipmentConfirmation(input('concurrent-first', writer)); await started;
    try { await expect(executeYandexShipmentConfirmation(input('concurrent-second', writer))).rejects.toThrow('未确认'); }
    finally { finish({ status: 'OK' }); }
    expect((await first).state).toBe('SUBMITTING'); expect(writer).toHaveBeenCalledTimes(1);
  });
  it('blocks confirmation when an order-management operation for a member is unresolved', async () => {
    await prisma.yandexOfferPublishOperation.create({ data: { id: randomUUID(), ownerUserId, actorUserId: ownerUserId, shopId, sourceShopId: shopId, businessId: '77', idempotencyKey: prefix + 'order-pending', requestHash: 'a'.repeat(64), state: 'UNKNOWN', requestPayload: { kind: 'ORDER_MANAGEMENT', orderIds: ['456'] } } });
    const f = input('member-pending'); await expect(executeYandexShipmentConfirmation(f)).rejects.toThrow('未确认'); expect(f.client.confirmShipment).not.toHaveBeenCalled();
  });
  it('keeps an unknown provider result durable and rejects a changed body under the same key', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('synthetic transport timeout')), f = input('unknown', writer);
    const first = await executeYandexShipmentConfirmation(f); expect(first.state).toBe('UNKNOWN');
    expect(await executeYandexShipmentConfirmation(f)).toMatchObject({ state: 'UNKNOWN', replayed: true });
    await expect(executeYandexShipmentConfirmation({ ...f, shipmentId: '556' })).rejects.toThrow('幂等键');
    expect(writer).toHaveBeenCalledTimes(1);
    expect((await prisma.yandexOfferPublishOperation.findUnique({ where: { id: first.id } }))?.state).toBe('UNKNOWN');
  });
});
