import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productRoutes } from '../routes/product.js';

const mocks = vi.hoisted(() => {
  const mockFn = () => vi.fn<(...args: any[]) => any>();
  const productFindFirst = mockFn();
  const productUpdate = mockFn();
  const warehouseFindFirst = mockFn();
  const warehouseFindUnique = mockFn();
  const warehouseUpsert = mockFn();
  const getWarehouseList = mockFn();
  const updateStock = mockFn();
  const executeRaw = vi.fn(async (..._args: any[]) => 1);
  const transaction = vi.fn(async (
    operation: (tx: unknown) => Promise<unknown>,
    _options?: unknown,
  ) => operation({
    warehouse: {
      findUnique: warehouseFindUnique,
      upsert: warehouseUpsert,
    },
    $executeRawUnsafe: executeRaw,
  }));

  return {
    authenticate: vi.fn(async (request: any) => {
      request.user = { userId: 'tenant-1' };
    }),
    productFindFirst,
    productUpdate,
    warehouseFindFirst,
    warehouseFindUnique,
    warehouseUpsert,
    getWarehouseList,
    updateStock,
    executeRaw,
    transaction,
    decrypt: vi.fn((value: string) => value),
  };
});

vi.mock('../lib/auth.js', () => ({ authenticate: mocks.authenticate }));
vi.mock('../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    product: {
      findFirst: mocks.productFindFirst,
      update: mocks.productUpdate,
    },
    warehouse: {
      findFirst: mocks.warehouseFindFirst,
      findUnique: mocks.warehouseFindUnique,
      upsert: mocks.warehouseUpsert,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('../services/ozon-client.js', () => ({
  OzonClient: class {
    getWarehouseList = mocks.getWarehouseList;
    updateStock = mocks.updateStock;
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(productRoutes, { prefix: '/api/products' });
  await app.ready();
  return app;
}

describe('product warehouse logistics scope invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.productFindFirst.mockResolvedValue({
      id: 'product-1',
      platformProductId: '10001',
      offerId: 'offer-1',
      visibility: 'VISIBLE',
      syncStatus: 'SYNCED',
      shop: {
        id: 'shop-1',
        userId: 'tenant-1',
        platform: 'OZON',
        clientId: 'client-1',
        apiKeyEncrypted: 'key-1',
      },
    });
    mocks.productUpdate.mockResolvedValue({ id: 'product-1' });
    mocks.warehouseFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'warehouse-1', platformWarehouseId: '1001', status: 'active' });
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      status: 'inactive',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseUpsert.mockResolvedValue({
      id: 'warehouse-1',
      platformWarehouseId: '1001',
      status: 'active',
    });
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Xiamen warehouse',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
    }]);
    mocks.updateStock.mockResolvedValue({
      result: [{ updated: true, errors: [] }],
    });
  });

  it('invalidates an existing logistics scope when stock auto-detection refreshes warehouse status', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/products/product-1/stock',
      payload: { stock: 3 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.transaction).toHaveBeenCalled();
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('warehouse_ozon_origin_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('extension_device_assignment_grants');

    await app.close();
  });
});
