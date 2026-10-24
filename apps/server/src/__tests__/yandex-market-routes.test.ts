import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { yandexMarketRoutes } from '../routes/yandex-market.js';
import { YandexMarketApiError } from '../services/yandex-market-client.js';

const mocks = vi.hoisted(() => ({
  user: { userId: 'owner-a', tokenUse: 'account_session' } as Record<string, unknown> | null,
  shop: { id: 'shop-a', userId: 'owner-a', platform: 'YANDEX', status: 'ACTIVE', clientId: '123', apiKeyEncrypted: 'encrypted-key', config: null } as Record<string, unknown>,
  findFirst: vi.fn(), update: vi.fn(), decrypt: vi.fn(() => 'synthetic-key'),
  products: vi.fn(), publishFind: vi.fn(), publishCreate: vi.fn(), publishUpdate: vi.fn(), publishMany: vi.fn(),
  campaigns: vi.fn(), campaign: vi.fn(), test: vi.fn(), updateOffers: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({ authenticate: vi.fn(async (request: any, reply: any) => {
  if (!mocks.user) return reply.status(401).send({ code: 0, msg: '未登录' }); request.user = mocks.user;
}) }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findFirst: mocks.findFirst, update: mocks.update }, product: { findMany: mocks.products }, yandexOfferPublishOperation: { findUnique: mocks.publishFind, create: mocks.publishCreate, update: mocks.publishUpdate, findMany: mocks.publishMany } } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));
vi.mock('../services/yandex-market-client.js', async (original) => ({
  ...await original<typeof import('../services/yandex-market-client.js')>(),
  YandexMarketClient: class { getCampaigns = mocks.campaigns; getCampaign = mocks.campaign; test = mocks.test; updateOfferMappings = mocks.updateOffers; },
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
    mocks.campaign.mockResolvedValue({ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' });
    mocks.test.mockResolvedValue({ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' });
  });
  afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
  async function call(url: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>): Promise<any> {
    const app = Fastify(); apps.push(app); await app.register(yandexMarketRoutes, { prefix: '/api/yandex-market' });
    return app.inject({ method, url, ...(method === 'POST' && payload !== undefined ? { payload } : {}) } as any);
  }

  it('uses only the effective owner and returns campaigns without credentials', async () => {
    const response = await call('/api/yandex-market/shop-a/campaigns');
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { campaigns: [{ id: '123' }] } });
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'shop-a', userId: 'owner-a', platform: 'YANDEX', status: { not: 'DISABLED' } } });
    expect(response.body).not.toContain('synthetic-key'); expect(mocks.decrypt).toHaveBeenCalledWith('encrypted-key');
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
    const response = await call('/api/yandex-market/shop-a/offers/publish', 'POST', payload);
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: { state: 'SUCCEEDED', replayed: false } });
    expect(mocks.updateOffers).toHaveBeenCalledOnce(); expect(mocks.publishCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ state: 'SUBMITTING', businessId: '77' }) });
    if (previous === undefined) delete process.env.YANDEX_MARKET_PUBLISH_ENABLED; else process.env.YANDEX_MARKET_PUBLISH_ENABLED = previous;
  });

  it('keeps real Yandex writes disabled until the deployment owner enables them', async () => {
    delete process.env.YANDEX_MARKET_PUBLISH_ENABLED;
    const response = await call('/api/yandex-market/shop-a/offers/publish', 'POST', { sourceShopId: 'ozon-source', productIds: ['product-1'], confirm: true, idempotencyKey: 'yandex-publish-key-002' });
    expect(response.statusCode).toBe(403); expect(mocks.publishCreate).not.toHaveBeenCalled(); expect(mocks.updateOffers).not.toHaveBeenCalled();
  });

  it('exposes the durable journal without providing an automatic retry endpoint', async () => {
    mocks.publishMany.mockResolvedValue([{ id: 'publish-operation', state: 'UNKNOWN', sourceShopId: 'ozon-source', businessId: '77' }]);
    const response = await call('/api/yandex-market/shop-a/offers/publish-operations');
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ code: 1, data: [{ id: 'publish-operation', state: 'UNKNOWN' }] });
  });
});
