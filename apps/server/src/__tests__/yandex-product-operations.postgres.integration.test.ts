import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { executeYandexProductOperation, prepareYandexProductPricePreview } from '../services/yandex-product-operations.js';
import { projectYandexProduct, syncYandexProducts } from '../services/yandex-product-sync.js';
import { encrypt } from '../lib/crypto.js';
vi.mock('../services/yandex-api-budget.js', () => ({ acquireYandexApiPermit: vi.fn().mockResolvedValue(undefined), recordYandexApiCooldown: vi.fn().mockResolvedValue(undefined) }));

const enabled = process.env.RUN_YANDEX_POSTGRES_TESTS === '1';
const suite = enabled ? describe : describe.skip;
const prefix = 'yandex_' + randomUUID().replaceAll('-', '');
const ownerUserId = prefix + '_owner', shopId = prefix + '_shop', productId = prefix + '_product';
const shop = { id: shopId, status: 'ACTIVE', clientId: '123', config: { yandexMarket: { campaignId: '123', businessId: '77' } } };
function input(key: string, writer: (...args: any[]) => Promise<unknown>) {
  return { shop, ownerUserId, actorUserId: ownerUserId, body: { action: 'PRICE', productIds: [productId], price: '12.00', confirm: true, idempotencyKey: prefix + key },
    client: { getCampaign: vi.fn().mockResolvedValue({ id: '123', business: { id: '77' }, apiAvailability: 'AVAILABLE' }), getCampaignOffers: vi.fn().mockResolvedValue({ offers: [{ offerId: '000-A', status: 'PUBLISHED' }], nextPageToken: null }), getBusinessSettings: vi.fn().mockResolvedValue({ currency: 'RUR', warehouseModel: 'CAMPAIGN', onlyDefaultPrice: false }), getShopWarehouses: vi.fn(), getStocks: vi.fn(), updateProductPrices: writer, updateProductStocks: vi.fn(), setProductHidden: vi.fn() } };
}

suite('Yandex product journal on PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^yandex_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') || '')) throw Error('An isolated local yandex_test_* schema is required');
    await prisma.user.create({ data: { id: ownerUserId, phone: prefix, passwordHash: 'synthetic-hash' } });
    await prisma.shop.create({ data: { id: shopId, userId: ownerUserId, platform: 'YANDEX', name: 'isolated shop', apiKeyEncrypted: 'synthetic-encrypted', clientId: '123', status: 'ACTIVE' } });
    await prisma.product.create({ data: { id: productId, shopId, platformProductId: '000-A', offerId: '000-A', sku: '000-A', title: 'Товар', currency: 'RUB' } });
  });
  afterAll(async () => {
    await prisma.yandexOfferPublishOperation.deleteMany({ where: { ownerUserId } });
    await prisma.product.deleteMany({ where: { shopId } }); await prisma.shop.delete({ where: { id: shopId } }); await prisma.user.delete({ where: { id: ownerUserId } }); await prisma.$disconnect();
  });
  it('stores a tagged command and replays it without a second platform call', async () => {
    const writer = vi.fn().mockResolvedValue({ status: 'OK' }), f = input('same', writer);
    const first = await executeYandexProductOperation(f); expect(first.state).toBe('SUCCEEDED');
    expect(await executeYandexProductOperation(f)).toMatchObject({ id: first.id, state: 'SUCCEEDED', replayed: true });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(await prisma.yandexOfferPublishOperation.findUnique({ where: { id: first.id } })).toMatchObject({ sourceShopId: shopId, requestPayload: { kind: 'PRODUCT_MANAGEMENT', offerIds: ['000-A'] } });
  });
  it('uses the database lock and JSON offer IDs to block a concurrent second command', async () => {
    let notify!: () => void, finish!: (r: unknown) => void;
    const called = new Promise<void>(resolve => { notify = resolve; });
    const provider = new Promise(resolve => { finish = resolve; });
    const writer = vi.fn().mockImplementation(() => { notify(); return provider; });
    const first = executeYandexProductOperation(input('first-concurrent', writer));
    await called;
    try { await expect(executeYandexProductOperation(input('second-concurrent', writer))).rejects.toThrow('未确认'); }
    finally { finish({ status: 'OK' }); }
    expect((await first).state).toBe('SUCCEEDED'); expect(writer).toHaveBeenCalledTimes(1);
  });
  it('persists per-offer relative price targets and reconciles exactly those after transport failure', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('synthetic unknown outcome')), f = input('relative-persistent', writer);
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }], nextPageToken: null });
    const priceChange = { mode: 'multiply', value: '1.5' };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: [productId], priceChange } });
    const command = { ...f, body: { action: 'PRICE', productIds: [productId], confirm: true, idempotencyKey: prefix + 'relative-persistent', priceChange, pricePreviewHash: preview.previewHash } };
    const initial = await executeYandexProductOperation(command); expect(initial.state).toBe('UNKNOWN');
    const stored = await prisma.yandexOfferPublishOperation.findUniqueOrThrow({ where: { id: initial.id } });
    expect(stored.requestPayload).toMatchObject({ kind: 'PRODUCT_MANAGEMENT', priceTargets: [{ productId, offerId: '000-A', previousPrice: 12, price: { value: 18, currencyId: 'RUR' } }] });
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 18, currencyId: 'RUR' } }], nextPageToken: null });
    expect(await executeYandexProductOperation(command)).toMatchObject({ id: initial.id, state: 'SUCCEEDED', replayed: true, reconciled: true });
    expect(writer).toHaveBeenCalledTimes(1);
    expect((await prisma.yandexOfferPublishOperation.findUniqueOrThrow({ where: { id: initial.id } })).state).toBe('SUCCEEDED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).price).toBeNull();
  });
  it('preserves a true unknown response across another request and leaves local price untouched', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('synthetic transport failure'));
    const f = input('unknown', writer); const result = await executeYandexProductOperation(f);
    expect(result.state).toBe('UNKNOWN'); expect((await executeYandexProductOperation(f)).state).toBe('UNKNOWN');
    await expect(executeYandexProductOperation(input('unknown-new-key', writer))).rejects.toThrow('未确认');
    expect(writer).toHaveBeenCalledTimes(1);
    expect((await prisma.product.findUnique({ where: { id: productId } }))?.price).toBeNull();
  });
  it('persists a complete source snapshot and leaves it intact if a later stock read fails', async () => {
    const bound = await prisma.shop.update({ where: { id: shopId }, data: { apiKeyEncrypted: encrypt('synthetic-yandex-key'), config: shop.config } });
    let failStock = false;
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      let result: unknown;
      const p = url.pathname;
      if (p === '/v2/campaigns/123') return new Response(JSON.stringify({ campaign: { id: 123, business: { id: 77 }, apiAvailability: 'AVAILABLE' } }));
      if (p.endsWith('/settings')) result = { settings: { warehouseModel: 'CAMPAIGN', onlyDefaultPrice: false, currency: 'RUR' } };
      else if (p.endsWith('/warehouses')) result = { warehouses: [{ id: 9, name: 'warehouse', campaignId: 123 }] };
      else if (p.endsWith('/offer-mappings')) result = { offerMappings: [{ offer: { offerId: '000-A', name: 'Товар', description: 'Описание', pictures: ['https://cdn.example/a.jpg'] }, mapping: { marketCategoryId: 61516298, marketCategoryName: 'Листовые чаи' } }] };
      else if (p.endsWith('/offers/stocks')) { if (failStock) throw Error('synthetic stock read failed'); result = { warehouses: [{ warehouseId: 9, offers: [{ offerId: '000-A', stocks: [{ type: 'AVAILABLE', count: 3 }] }] }] }; }
      else if (p.endsWith('/offers')) result = { offers: [{ offerId: '000-A', status: 'PUBLISHED', basicPrice: { value: 25, currencyId: 'RUR' } }] };
      else throw Error('Unexpected external path');
      return new Response(JSON.stringify({ status: 'OK', result }));
    }));
    try {
      expect(await syncYandexProducts(bound)).toBe(1);
      const saved = await prisma.product.findUnique({ where: { id: productId } });
      expect(saved).toMatchObject({ sku: '000-A', stock: 3, title: 'Товар', lastOzonSyncAt: null, categoryId: '61516298' });
      expect(projectYandexProduct(saved!)).toMatchObject({ categoryLabel: 'Листовые чаи' });
      expect(saved?.price?.toString()).toBe('25');
      failStock = true; await expect(syncYandexProducts(bound)).rejects.toThrow();
      expect((await prisma.product.findUnique({ where: { id: productId } }))?.stock).toBe(3);
    } finally { vi.unstubAllGlobals(); }
  });
});
