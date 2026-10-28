import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yandexMarketRoutes } from '../routes/yandex-market.js';
import { YandexMarketApiError } from '../services/yandex-market-client.js';
import { createHash } from 'node:crypto';
import { prepareYandexDrafts } from '../services/yandex-market-catalog.js';

const mocks = vi.hoisted(() => ({
  user: { userId: 'owner-a', tokenUse: 'account_session' } as Record<string, unknown> | null,
  shop: { id: 'shop-a', userId: 'owner-a', platform: 'YANDEX', status: 'ACTIVE', clientId: '123', apiKeyEncrypted: 'encrypted-key', config: null } as Record<string, unknown>,
  findFirst: vi.fn(), update: vi.fn(), decrypt: vi.fn(() => 'synthetic-key'),
  products: vi.fn(), publishFind: vi.fn(), publishCreate: vi.fn(), publishUpdate: vi.fn(), publishMany: vi.fn(),
  campaigns: vi.fn(), campaign: vi.fn(), test: vi.fn(), updateOffers: vi.fn(), settings: vi.fn(), mappings: vi.fn(), cards: vi.fn(), tree: vi.fn(), parameters: vi.fn(),
  addSync: vi.fn(), addOrder: vi.fn(), syncJob: vi.fn(), businessSettings: vi.fn(), warehouses: vi.fn(), manage: vi.fn(), pricePreview: vi.fn(), orderContext: vi.fn(), orderPending: vi.fn(), orderCommand: vi.fn(), label: vi.fn(), services: vi.fn(), shipments: vi.fn(), shipment: vi.fn(), shipmentPending: vi.fn(), shipmentConfirm: vi.fn(), shipmentDocument: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({ authenticate: vi.fn(async (request: any, reply: any) => {
  if (!mocks.user) return reply.status(401).send({ code: 0, msg: '未登录' }); request.user = mocks.user;
}) }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findFirst: mocks.findFirst, update: mocks.update }, syncJob: { findFirst: mocks.syncJob }, product: { findMany: mocks.products }, yandexOfferPublishOperation: { findUnique: mocks.publishFind, create: mocks.publishCreate, update: mocks.publishUpdate, findMany: mocks.publishMany } } }));
vi.mock('../workers/product-sync.js', () => ({ addProductSyncJob: mocks.addSync }));
vi.mock('../workers/order-sync.js', () => ({ addOrderSyncJob: mocks.addOrder }));
vi.mock('../services/yandex-product-operations.js', () => ({ executeYandexProductOperation: mocks.manage, prepareYandexProductPricePreview: mocks.pricePreview }));
vi.mock('../services/yandex-shipment-operations.js', () => ({ readYandexShipments: mocks.shipments, readYandexShipmentContext: mocks.shipment, readYandexPendingShipmentCommand: mocks.shipmentPending, executeYandexShipmentConfirmation: mocks.shipmentConfirm, readYandexShipmentDocument: mocks.shipmentDocument }));
vi.mock('../services/yandex-order-operations.js', () => ({ readYandexOrderContext: mocks.orderContext, readYandexPendingOrderCommand: mocks.orderPending, executeYandexOrderOperation: mocks.orderCommand }));
vi.mock('../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));
vi.mock('../services/yandex-market-client.js', async (original) => ({
  ...await original<typeof import('../services/yandex-market-client.js')>(),
  YandexMarketClient: class { getCampaigns = mocks.campaigns; getCampaign = mocks.campaign; test = mocks.test; updateOfferMappings = mocks.updateOffers; getCampaignSettings = mocks.settings; getOfferMappings = mocks.mappings; getOfferCards = mocks.cards; getCategoryTree = mocks.tree; getCategoryParameters = mocks.parameters; getBusinessSettings = mocks.businessSettings; getShopWarehouses = mocks.warehouses; getOrderLabel = mocks.label; getDeliveryServices = mocks.services; },
}));

describe('Yandex Market route ownership and read-only connection boundary', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { userId: 'owner-a', tokenUse: 'account_session' };
    mocks.shop = { id: 'shop-a', userId: 'owner-a', platform: 'YANDEX', status: 'ACTIVE', clientId: '123', apiKeyEncrypted: 'encrypted-key', config: null };
    mocks.findFirst.mockResolvedValue(mocks.shop); mocks.update.mockResolvedValue(mocks.shop);
    mocks.products.mockResolvedValue([]); mocks.publishFind.mockResolvedValue(null); mocks.publishCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: 'publish-operation' }));
    mocks.publishUpdate.mockImplementation(async ({ data }: any) => ({ id: 'publish-operation', state: data.state, response: data.response || null }));
    mocks.publishMany.mockResolvedValue([]);
    mocks.campaigns.mockResolvedValue({ campaigns: [{ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' }], nextPageToken: null });
    mocks.campaign.mockResolvedValue({ id: '123', business: { id: '77' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' });
    mocks.settings.mockResolvedValue({}); mocks.mappings.mockResolvedValue({ offerMappings: [], nextPageToken: null }); mocks.cards.mockResolvedValue({ offerCards: [], nextPageToken: null });
    mocks.tree.mockResolvedValue({ id: 0, name: 'root', children: [{ id: 10, name: 'Товары' }] });
    mocks.parameters.mockResolvedValue({ categoryId: 10, parameters: [] });
    mocks.test.mockResolvedValue({ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' });
    mocks.addSync.mockResolvedValue({ id: 'queue-job', syncJobId: 'sync-1' });
    mocks.addOrder.mockResolvedValue({ id: 'order-queue-job', syncJobId: 'order-sync-1' });
    mocks.businessSettings.mockResolvedValue({ warehouseModel: 'WAREHOUSE', onlyDefaultPrice: true, currency: 'RUR' });
    mocks.warehouses.mockResolvedValue([{ id: 9, campaignId: 123, name: 'warehouse' }]);
    mocks.orderPending.mockResolvedValue(null); mocks.shipmentPending.mockResolvedValue(null); mocks.services.mockResolvedValue([]);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(apps.splice(0).map(app => app.close())); });
  async function call(url: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>): Promise<any> {
    const app = Fastify(); apps.push(app); await app.register(yandexMarketRoutes, { prefix: '/api/yandex-market' });
    return app.inject({ method, url, ...(method === 'POST' && payload !== undefined ? { payload } : {}) } as any);
  }
  it('exposes native first-mile read, confirmation and PDF through the authenticated shop owner', async () => {
    mocks.shipments.mockResolvedValue({ shipments: [{ id: '88', availableActions: [] }] });
    expect((await call('/api/yandex-market/shop-a/shipments?dateFrom=2026-10-01&dateTo=2026-10-20')).json()).toMatchObject({ code: 1, data: { shipments: [{ id: '88' }] } });
    mocks.shipmentConfirm.mockResolvedValue({ id: 'op', state: 'SUBMITTING', replayed: false });
    const r = await call('/api/yandex-market/shop-a/shipments/88/confirm', 'POST', { confirm: true, idempotencyKey: 'synthetic-confirm-key' });
    expect(r.json()).toMatchObject({ code: 1, data: { state: 'SUBMITTING' } });
    expect(mocks.shipmentConfirm).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-a', actorUserId: 'owner-a', shipmentId: '88' }));
    mocks.shipmentDocument.mockResolvedValue(Buffer.from('%PDF-1.4\nfixture'));
    expect((await call('/api/yandex-market/shop-a/shipments/88/document?type=ACT&encoding=base64')).json()).toMatchObject({ code: 1, data: { contentType: 'application/pdf' } });
    mocks.findFirst.mockResolvedValue(null);
    expect((await call('/api/yandex-market/shop-a/shipments/88')).statusCode).toBe(404);
  });
  it('previews product price changes without issuing a product write', async () => {
    mocks.pricePreview.mockResolvedValue({ previewHash: 'a'.repeat(64), targets: [] });
    const r = await call('/api/yandex-market/shop-a/product-price-preview', 'POST', { productIds: ['p'], priceChange: { mode: 'multiply', value: '1.1' } });
    expect(r.json()).toMatchObject({ code: 1, data: { targets: [] } }); expect(mocks.manage).not.toHaveBeenCalled();
  });

  it('uses only the effective owner and returns campaigns without credentials', async () => {
    const response = await call('/api/yandex-market/shop-a/campaigns');
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { campaigns: [{ id: '123' }] } });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'shop-a', userId: 'owner-a', platform: 'YANDEX', status: { not: 'DISABLED' } } });
    expect(response.body).not.toContain('synthetic-key'); expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-key');
  });

  it('queues an owned Yandex sync and only exposes that shop task status', async () => {
    const r = await call('/api/yandex-market/shop-a/sync-products', 'POST', {});
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ code: 1, data: { syncJobId: 'sync-1' } });
    expect(mocks.addSync).toHaveBeenCalledWith('shop-a');
    mocks.syncJob.mockResolvedValue({ id: 'sync-1', status: 'SUCCESS', result: { totalSynced: 2 } });
    expect((await call('/api/yandex-market/shop-a/sync-jobs/sync-1')).json().data.status).toBe('SUCCESS');
    expect(mocks.syncJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sync-1', shopId: 'shop-a', type: 'PRODUCT_PULL' } }));
  });
  it('queues an owned Yandex order sync without using the Ozon sync route', async () => {
    const r = await call('/api/yandex-market/shop-a/sync-orders', 'POST', { since: '2026-10-01T00:00:00.000Z' });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ code: 1, data: { syncJobId: 'order-sync-1' } });
    expect(mocks.addOrder).toHaveBeenCalledWith('shop-a', '2026-10-01T00:00:00.000Z', { trigger: 'manual' });
  });
  it('returns current order actions and streams a checked PDF without leaking credentials', async () => {
    mocks.orderContext.mockResolvedValue({ businessId: '77', nativeOrderId: '456', order: { orderId: 456 }, actions: { label: true, PACK: true } });
    const r = await call('/api/yandex-market/shop-a/orders/local-order/workbench');
    expect(r.json()).toMatchObject({ code: 1, data: { order: { orderId: 456 }, actions: { PACK: true } } }); expect(r.body).not.toContain('synthetic-key');
    mocks.label.mockResolvedValue(Buffer.from('%PDF-1.4 fixture'));
    const pdf = await call('/api/yandex-market/shop-a/orders/local-order/label?format=A7');
    expect(pdf.headers['content-type']).toContain('application/pdf'); expect(pdf.body).toContain('%PDF');
    expect(mocks.label).toHaveBeenCalledWith('123', '456', 'A7');
  });
  it('keeps accepted async order writes pending and rejects non-account callers', async () => {
    mocks.orderCommand.mockResolvedValue({ id: 'op', state: 'SUBMITTING', replayed: false });
    const r = await call('/api/yandex-market/shop-a/orders/local-order/commands', 'POST', { action: 'CANCEL', confirm: true, idempotencyKey: 'synthetic-order-key-123', cancelReason: 'SHOP_FAILED' });
    expect(r.json()).toMatchObject({ code: 1, data: { state: 'SUBMITTING' } });
    mocks.user = { userId: 'owner-a', tokenUse: 'extension_device' };
    expect((await call('/api/yandex-market/shop-a/orders/local-order/commands', 'POST', {})).statusCode).toBe(403);
  });
  it('keeps product management behind owned account sessions and reports UNKNOWN without unlocking', async () => {
    mocks.manage.mockResolvedValue({ id: 'op1', state: 'UNKNOWN', replayed: false });
    const r = await call('/api/yandex-market/shop-a/product-operations', 'POST', { action: 'STOCK' });
    expect(r.json()).toMatchObject({ code: 0, data: { state: 'UNKNOWN' } }); expect(r.json().meta).toBeUndefined();
    expect(mocks.manage).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-a', shop: mocks.shop }));
    mocks.manage.mockClear(); mocks.user = { userId: 'owner-a', tokenUse: 'extension_device' };
    expect((await call('/api/yandex-market/shop-a/product-operations', 'POST', {})).statusCode).toBe(403);
    expect(mocks.manage).not.toHaveBeenCalled();
  });

  it.each(['extension_device', 'legacy_extension', undefined])('rejects non account sessions %s', async tokenUse => {
    mocks.user = { userId: 'owner-a', tokenUse }; expect((await call('/api/yandex-market/shop-a/campaigns')).statusCode).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('rejects another tenant and non-Yandex shops before provider access', async () => {
    mocks.findFirst.mockResolvedValue(null); expect((await call('/api/yandex-market/shop-a/campaigns')).statusCode).toBe(404);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('marks a shop active only after a successful campaign test', async () => {
    const response = await call('/api/yandex-market/shop-a/test', 'POST');
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { id: '123' } });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'shop-a' }, data: expect.objectContaining({ status: 'ACTIVE', errorMessage: null, config: { yandexMarket: expect.objectContaining({ campaignId: '123', businessId: null, placementType: 'FBS', apiAvailability: 'AVAILABLE' }) } }) });
  });

  it('records a sanitized controlled failure and never writes a product', async () => {
    mocks.test.mockRejectedValue(new YandexMarketApiError(409, 'MANUALLY_DISABLED'));
    const response = await call('/api/yandex-market/shop-a/test', 'POST');
    expect(response.statusCode).toBe(409); expect(response.body).toContain('MANUALLY_DISABLED'); expect(response.body).not.toContain('synthetic-key');
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'shop-a' }, data: { status: 'ERROR', errorMessage: 'MANUALLY_DISABLED' } });
  });

  it('requires explicit confirmation and records a successful Yandex offer publication', async () => {
    const previous = process.env.YANDEX_MARKET_PUBLISH_ENABLED;
    process.env.YANDEX_MARKET_PUBLISH_ENABLED = 'true';
    const source = { id: 'ozon-source', userId: 'owner-a', platform: 'OZON', status: 'ACTIVE' };
    const product = { id: 'product-1', platformProductId: '9001', sku: '4601234567890', offerId: null, title: 'Кружка', description: 'Керамическая кружка', categoryId: '10', price: { toString: () => '199.9' }, currency: 'RUB', stock: 2, images: ['https://cdn.example/image.jpg'], attributes: { vendor: 'SS', barcodes: ['4601234567890'] }, variants: [] };
    mocks.shop.config = { yandexMarket: { businessId: '77' } };
    mocks.findFirst.mockImplementation(async ({ where }: any) => where.platform === 'OZON' ? source : mocks.shop);
    mocks.products.mockResolvedValue([product]);
    mocks.updateOffers.mockResolvedValue({ status: 'OK', results: [{ offerId: 'ss-ozon-product-1' }] });
    const payload = { sourceShopId: 'ozon-source', productIds: ['product-1'], confirm: true, idempotencyKey: 'yandex-publish-key-001' };
    const targets = [{ sourceProductId: 'product-1', marketCategoryId: 10 }];
    const preview = await call('/api/yandex-market/shop-a/drafts/preview', 'POST', { sourceShopId: 'ozon-source', productIds: ['product-1'], targets });
    expect(preview.statusCode).toBe(200);
    const response = await call('/api/yandex-market/shop-a/offers/publish', 'POST', { ...payload, targets, expectedDraftHash: preview.json().data.draftHash });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { state: 'SUCCEEDED', replayed: false } });
    expect(mocks.updateOffers).toHaveBeenCalledOnce(); expect(mocks.publishCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ state: 'SUBMITTING', businessId: '77' }) });
    if (previous === undefined) delete process.env.YANDEX_MARKET_PUBLISH_ENABLED; else process.env.YANDEX_MARKET_PUBLISH_ENABLED = previous;
  });

  it('keeps real Yandex writes disabled until the deployment owner enables them', async () => {
    const { payload } = await publishFixture();
    vi.stubEnv('YANDEX_MARKET_PUBLISH_ENABLED', 'false');
    const response = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(response.statusCode).toBe(403); expect(mocks.publishCreate).not.toHaveBeenCalled(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });

  it('exposes the durable journal without providing an automatic retry endpoint', async () => {
    mocks.publishMany.mockResolvedValue([{ id: 'publish-operation', state: 'UNKNOWN', sourceShopId: 'ozon-source', businessId: '77' }]);
    const response = await call('/api/yandex-market/shop-a/offers/publish-operations');
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: [{ id: 'publish-operation', state: 'UNKNOWN' }] });
  });

  it('reads catalogue and card errors only in the verified shop business, and preserves cursor', async () => {
    mocks.mappings.mockResolvedValue({ offerMappings: [{ offer: { offerId: 'erp-1' } }], nextPageToken: 'next' });
    const r = await call('/api/yandex-market/shop-a/offers/read', 'POST', { limit: 5, pageToken: 'previous' });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ code: 1, data: { nextPageToken: 'next' } });
    expect(mocks.mappings).toHaveBeenCalledWith('77', { limit: 5, pageToken: 'previous' });
    mocks.cards.mockResolvedValue({ offerCards: [{ offerId: 'erp-1', errors: [{ code: 'MISSING_PARAMETER' }] }], nextPageToken: null });
    expect((await call('/api/yandex-market/shop-a/offer-cards/read', 'POST', { offerIds: ['erp-1'] })).json()).toMatchObject({ code: 1, data: { offerCards: [{ errors: [{ code: 'MISSING_PARAMETER' }] }] } });
    expect(mocks.updateOffers).not.toHaveBeenCalled(); expect(mocks.publishCreate).not.toHaveBeenCalled();
  });

  it('rejects caller-supplied business scope and cross-user reads before provider calls', async () => {
    expect((await call('/api/yandex-market/shop-a/offers/read', 'POST', { businessId: 'other' })).statusCode).toBe(400);
    expect(mocks.mappings).not.toHaveBeenCalled();
    mocks.findFirst.mockResolvedValue(null);
    expect((await call('/api/yandex-market/shop-a/offer-cards/read', 'POST', {})).statusCode).toBe(404);
    expect(mocks.cards).not.toHaveBeenCalled();
  });

  it('does not trust a stale saved business mapping after changing the campaign', async () => {
    mocks.shop.config = { yandexMarket: { campaignId: '456', businessId: '99' } };
    expect((await call('/api/yandex-market/shop-a/offers/read', 'POST', {})).statusCode).toBe(409);
    expect(mocks.mappings).not.toHaveBeenCalled();
  });

  async function publishFixture() {
    vi.stubEnv('YANDEX_MARKET_PUBLISH_ENABLED', 'true');
    mocks.shop.config = { yandexMarket: { campaignId: '123', businessId: '77' } };
    mocks.findFirst.mockImplementation(async ({ where }: any) => where.platform === 'OZON' ? { id: 'ozon-source' } : mocks.shop);
    const product = { id: 'product-1', title: 'Кружка', description: 'Керамическая кружка', categoryId: '876', images: ['https://cdn.example/image.jpg'], attributes: { vendor: 'SS', barcodes: ['4601234567890'] } };
    mocks.products.mockResolvedValue([product]);
    const targets = [{ sourceProductId: 'product-1', marketCategoryId: 10 }];
    const prepared = await prepareYandexDrafts([product], targets, { getCategoryTree: mocks.tree, getCategoryParameters: mocks.parameters }, '77');
    return { product, payload: { sourceShopId: 'ozon-source', productIds: ['product-1'], targets, confirm: true, idempotencyKey: 'synthetic-key-publish-123', expectedDraftHash: prepared.draftHash } };
  }

  it('rejects a changed preview and invalid target leaf before reserving or publishing', async () => {
    const { product, payload } = await publishFixture();
    mocks.products.mockResolvedValue([{ ...product, description: 'Измененное описание' }]);
    const r = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(r.statusCode).toBe(409); expect(r.json().meta.notDispatched).toBe(true);
    expect(mocks.publishCreate).not.toHaveBeenCalled(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });

  it('does not report envelope OK as success when Yandex reports per-offer errors', async () => {
    const { payload } = await publishFixture();
    mocks.updateOffers.mockResolvedValue({ status: 'OK', results: [{ offerId: 'ss-ozon-product-1', errors: [{ code: 'INVALID_CATEGORY' }] }] });
    const r = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(r.json()).toMatchObject({ code: 0, data: { state: 'REJECTED', replayed: false } });
    expect(mocks.publishUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'REJECTED' }) }));
  });

  it('preserves UNKNOWN and replays the original command after source content changes without re-sending', async () => {
    const { payload } = await publishFixture();
    mocks.updateOffers.mockRejectedValue(new YandexMarketApiError(504, 'timeout'));
    expect((await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload)).json().data.state).toBe('UNKNOWN');
    const requestHash = createHash('sha256').update(JSON.stringify({ targetShopId: 'shop-a', ...payload })).digest('hex');
    mocks.publishFind.mockResolvedValue({ id: 'original-operation', requestHash, state: 'UNKNOWN', response: null });
    mocks.products.mockResolvedValue([]);
    const replay = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(replay.json()).toMatchObject({ code: 1, data: { id: 'original-operation', state: 'UNKNOWN', replayed: true } });
    expect(mocks.updateOffers).toHaveBeenCalledTimes(1);
    expect((await call('/api/yandex-market/shop-a/offers/publish', 'POST', { ...payload, targets: [] })).statusCode).toBe(409);
    expect(mocks.updateOffers).toHaveBeenCalledTimes(1);
  });

  it('will not expose a foreign source product in preview', async () => {
    const { payload } = await publishFixture(); mocks.products.mockResolvedValue([]);
    const r = await call('/api/yandex-market/shop-a/drafts/preview', 'POST', { sourceShopId: payload.sourceShopId, productIds: ['foreign'] });
    expect(r.statusCode).toBe(404); expect(mocks.updateOffers).not.toHaveBeenCalled();
    expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['foreign'] }, shopId: 'ozon-source' } }));
  });

  it('marks missing source products as not dispatched so the editor can unlock safely', async () => {
    const { payload } = await publishFixture(); mocks.products.mockResolvedValue([]);
    const r = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(r.statusCode).toBe(404); expect(r.json()).toMatchObject({ meta: { notDispatched: true } });
    expect(mocks.publishCreate).not.toHaveBeenCalled(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });

  it('keeps an unavailable target unresolved rather than claiming an old request never dispatched', async () => {
    const { payload } = await publishFixture(); mocks.findFirst.mockResolvedValue(null);
    const r = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(r.statusCode).toBe(404); expect(r.json().meta).toBeUndefined();
    expect(mocks.decrypt).not.toHaveBeenCalled(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });

  it('still returns the original UNKNOWN operation after the publish switch is disabled', async () => {
    const { payload } = await publishFixture();
    const requestHash = createHash('sha256').update(JSON.stringify({ targetShopId: 'shop-a', ...payload })).digest('hex');
    mocks.publishFind.mockResolvedValue({ id: 'original-operation', requestHash, state: 'UNKNOWN', response: null });
    vi.stubEnv('YANDEX_MARKET_PUBLISH_ENABLED', 'false');
    const r = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(r.json()).toMatchObject({ code: 1, data: { state: 'UNKNOWN', replayed: true } });
    expect(r.json().meta).toBeUndefined(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });
});
