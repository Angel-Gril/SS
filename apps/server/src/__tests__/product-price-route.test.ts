import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { productRoutes } from '../routes/product.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  productFindMany: vi.fn(),
  productUpdate: vi.fn(),
  decrypt: vi.fn((value: string) => value),
  updatePrices: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    product: {
      findMany: mocks.productFindMany,
      update: mocks.productUpdate,
    },
  },
}));

vi.mock('../lib/crypto.js', () => ({
  decrypt: mocks.decrypt,
}));

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: class {
    updatePrices = mocks.updatePrices;
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.ready();
  return app;
}

function productRow() {
  return {
    id: 'product-1',
    platformProductId: '100',
    offerId: 'offer-1',
    price: { toString: () => '120.00' },
    oldPrice: { toString: () => '150.00' },
    minPrice: { toString: () => '110.00' },
    currency: 'RUB',
    visibility: 'VISIBLE',
    syncStatus: 'SYNCED',
    shop: {
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      clientId: 'client-1',
      apiKeyEncrypted: 'key-1',
    },
  };
}

describe('product price route', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends and stores old price and minimum price in batch price updates', async () => {
    mocks.productFindMany.mockResolvedValue([productRow()]);
    mocks.updatePrices.mockResolvedValue({ result: [{ updated: true }] });
    mocks.productUpdate.mockResolvedValue({});

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/products/batch-price',
      payload: {
        items: [{
          productId: 'product-1',
          price: '122.00',
          oldPrice: '199.00',
          minPrice: '111.00',
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.updatePrices).toHaveBeenCalledWith([{
      product_id: 100,
      price: '122.00',
      old_price: '199.00',
      min_price: '111.00',
      currency_code: 'RUB',
    }]);
    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: {
        price: 122,
        oldPrice: 199,
        minPrice: 111,
      },
    });

    await app.close();
  });
});
