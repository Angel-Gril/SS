import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shopRoutes } from '../routes/shop.js';
import { warehouseLogisticsScopeChanged } from '../services/logistics-scope-invalidation.js';

const mocks = vi.hoisted(() => {
  const mockFn = () => vi.fn<(...args: any[]) => any>();
  const shopFindFirst = mockFn();
  const shopFindMany = mockFn();
  const shopUpdate = mockFn();
  const shopDelete = mockFn();
  const warehouseDeleteMany = mockFn();
  const legacyDeleteMany = vi.fn(async (..._args: any[]) => ({ count: 0 }));
  const warehouseFindUnique = mockFn();
  const warehouseUpsert = mockFn();
  const warehouseFindFirst = mockFn();
  const warehouseUpdate = mockFn();
  const warehouseTemplateFindUnique = mockFn();
  const deliveryMethodFindUnique = mockFn();
  const deliveryMethodUpsert = mockFn();
  const deliveryMethodFindMany = mockFn();
  const deliveryMethodUpdateMany = mockFn();
  const getWarehouseList = mockFn();
  const listDeliveryMethods = mockFn();
  const getWarehouseCoordinates = mockFn();
  const updateWarehouseErfbs = mockFn();
  const updateAggregatorDeliveryMethod = mockFn();
  const updateNonIntegratedDeliveryMethod = mockFn();
  const executeRaw = vi.fn(async (..._args: any[]) => 1);
  const updateFbsWarehouse = mockFn();
  const testConnection = mockFn();
  const transaction = vi.fn(async (
    operation: (tx: unknown) => Promise<unknown>,
    _options?: unknown,
  ) =>
    operation({
      shop: { update: shopUpdate },
      warehouse: { findUnique: warehouseFindUnique, upsert: warehouseUpsert, update: warehouseUpdate },
      shopDeliveryMethod: {
        findUnique: deliveryMethodFindUnique,
        findMany: deliveryMethodFindMany,
        upsert: deliveryMethodUpsert,
        updateMany: deliveryMethodUpdateMany,
      },
      $executeRawUnsafe: executeRaw,
    }),
  );
  return {
    authenticate: vi.fn(async (request: any) => {
      request.user = { userId: 'tenant-1' };
    }),
    shopFindFirst,
    shopFindMany,
    shopUpdate,
    shopDelete,
    warehouseDeleteMany,
    legacyDeleteMany,
    warehouseFindUnique,
    warehouseUpsert,
    deliveryMethodFindUnique,
    warehouseFindFirst,
    warehouseTemplateFindUnique,
    warehouseUpdate,
    deliveryMethodFindMany,
    deliveryMethodUpdateMany,
    deliveryMethodUpsert,
    getWarehouseList,
    listDeliveryMethods,
    getWarehouseCoordinates,
    executeRaw,
    transaction,
    updateWarehouseErfbs,
    updateAggregatorDeliveryMethod,
    updateNonIntegratedDeliveryMethod,
    updateFbsWarehouse,
    testConnection,
    decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
  };
});

vi.mock('../lib/auth.js', () => ({ authenticate: mocks.authenticate }));
vi.mock('../lib/crypto.js', () => ({
  decrypt: mocks.decrypt,
  encrypt: mocks.encrypt,
}));
vi.mock('../services/ozon-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ozon-client.js')>();
  return {
    ...actual,
    getOzonWarehouseCoordinates: mocks.getWarehouseCoordinates,
    OzonClient: class {
      testConnection = mocks.testConnection;
      getWarehouseList = mocks.getWarehouseList;
      listDeliveryMethods = mocks.listDeliveryMethods;
      updateWarehouseErfbs = mocks.updateWarehouseErfbs;
      updateAggregatorDeliveryMethod = mocks.updateAggregatorDeliveryMethod;
      updateNonIntegratedDeliveryMethod = mocks.updateNonIntegratedDeliveryMethod;
      updateFbsWarehouse = mocks.updateFbsWarehouse;
    },
  };
});

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
      findMany: mocks.shopFindMany,
      update: mocks.shopUpdate,
      delete: mocks.shopDelete,
    },
    expressIssue: { deleteMany: mocks.legacyDeleteMany },
    return: { deleteMany: mocks.legacyDeleteMany },
    syncJob: { deleteMany: mocks.legacyDeleteMany },
    order: { deleteMany: mocks.legacyDeleteMany },
    product: { deleteMany: mocks.legacyDeleteMany },
    warehouse: {
      findUnique: mocks.warehouseFindUnique,
      upsert: mocks.warehouseUpsert,
      findFirst: mocks.warehouseFindFirst,
      update: mocks.warehouseUpdate,
      deleteMany: mocks.warehouseDeleteMany,
    },
    warehouseTemplate: { findUnique: mocks.warehouseTemplateFindUnique },
    shopDeliveryMethod: {
      findUnique: mocks.deliveryMethodFindUnique,
      findMany: mocks.deliveryMethodFindMany,
      upsert: mocks.deliveryMethodUpsert,
      updateMany: mocks.deliveryMethodUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(shopRoutes, { prefix: '/api/shops' });
  await app.ready();
  return app;
}

function shopRow() {
  return {
    id: 'shop-1',
    userId: 'tenant-1',
    platform: 'OZON',
    name: 'Pilot shop',
    clientId: 'client-old',
    apiKeyEncrypted: 'encrypted:key-old',
    apiSecretEncrypted: 'encrypted:secret-old',
    status: 'ACTIVE',
  };
}

describe('shop logistics scope invalidation routes', () => {
  beforeEach(() => {
    mocks.shopFindFirst.mockResolvedValue(shopRow());
    mocks.shopFindMany.mockResolvedValue([]);
    mocks.shopUpdate.mockResolvedValue(shopRow());
    mocks.executeRaw.mockResolvedValue(1);
    mocks.warehouseFindUnique.mockResolvedValue(null);
    mocks.warehouseUpsert.mockImplementation(async ({ create }: any) => ({ id: 'warehouse-1', ...create }));
    mocks.deliveryMethodFindUnique.mockResolvedValue(null);
    mocks.deliveryMethodUpsert.mockImplementation(async ({ create }: any) => ({ id: 'method-1', ...create }));
    mocks.deliveryMethodFindMany.mockResolvedValue([]);
    mocks.deliveryMethodUpdateMany.mockResolvedValue({ count: 0 });
    mocks.getWarehouseList.mockResolvedValue([]);
    mocks.listDeliveryMethods.mockResolvedValue([]);
    mocks.getWarehouseCoordinates.mockReturnValue({ latitude: null, longitude: null });
    mocks.warehouseFindFirst.mockResolvedValue(null);
    mocks.warehouseUpdate.mockResolvedValue(null);
    mocks.updateWarehouseErfbs.mockResolvedValue({ operation_id: 'operation-1' });
    mocks.updateAggregatorDeliveryMethod.mockResolvedValue({ operation_id: 'operation-2' });
    mocks.updateNonIntegratedDeliveryMethod.mockResolvedValue({ operation_id: 'operation-2' });
    mocks.warehouseTemplateFindUnique.mockResolvedValue(null);
    mocks.updateFbsWarehouse.mockResolvedValue({ operation_id: 'operation-3' });
    mocks.testConnection.mockResolvedValue({ success: true, name: 'Pilot shop' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('atomically invalidates logistics distribution when Ozon credentials change', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/shops/shop-1',
      payload: { apiKey: 'key-new' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('shop_ozon_company_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('logistics_rule_assignments');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(sql).toContain('SCOPE_REVOKED');
    expect(sql).toContain('logistics_scope_bootstraps');
    expect(sql).toContain('logistics_company_probes');
    expect(sql).toContain('"activated_at" = NULL');
    expect(sql).toContain("'CANDIDATE'");
    expect(sql).toContain("'invalidated'");
    expect(mocks.shopUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'shop-1' },
      data: expect.objectContaining({
        apiKeyEncrypted: 'encrypted:key-new',
        status: 'ERROR',
      }),
    }));
    expect(mocks.decrypt).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns only write-only credential state from shop details', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/shops/shop-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        id: 'shop-1',
        clientId: 'client-old',
        apiKeyConfigured: true,
      },
    });
    expect(response.json().data).not.toHaveProperty('apiKey');
    expect(response.body).not.toContain('key-old');
    expect(mocks.decrypt).not.toHaveBeenCalled();

    await app.close();
  });

  it('soft-retires a shop and revokes distribution without hard-deleting referenced scope', async () => {
    mocks.shopDelete.mockResolvedValue(shopRow());
    mocks.warehouseDeleteMany.mockResolvedValue({ count: 1 });

    const app = await buildApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/shops/shop-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(mocks.shopUpdate).toHaveBeenCalledWith({
      where: { id: 'shop-1' },
      data: expect.objectContaining({ status: 'DISABLED' }),
    });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('extension_device_shop_grants');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(sql).toContain('SHOP_UNLINKED');
    expect(mocks.shopDelete).not.toHaveBeenCalled();
    expect(mocks.warehouseDeleteMany).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not let a disabled shop connection test reactivate a retired logistics scope', async () => {
    mocks.shopFindFirst.mockImplementation(async ({ where }: any) =>
      where.status ? null : { ...shopRow(), status: 'DISABLED' },
    );

    const app = await buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/shops/shop-1/test' });

    expect(response.statusCode).toBe(404);
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(mocks.shopUpdate).not.toHaveBeenCalled();

    await app.close();
  });
  it('atomically invalidates one warehouse scope when its coordinates or status change', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Xiamen warehouse',
      warehouse_type: 'FBS',
      status: 'inactive',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 24.500001,
      longitude: 118.100001,
    });
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseUpsert.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      status: 'inactive',
      latitude: 24.500001,
      longitude: 118.100001,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.transaction).toHaveBeenCalled();
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('warehouse_ozon_origin_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('logistics_rule_assignments');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(mocks.executeRaw.mock.calls.some((call) => call.includes('warehouse-1'))).toBe(true);
    expect(sql).toContain('logistics_scope_bootstraps');

    await app.close();
  });
  it('persists normalized CN and Xiamen from the real RETS OpenAPI address shape', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1020005015663520,
      name: 'RETS',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
      address_info: {
        address: 'China, 361000, Fujian Sheng, Xiamen, Hai cang qu,hai hong lu 86 hao,huiqi, 1430',
        latitude: 24.480107,
        longitude: 118.085348,
      },
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 24.480107,
      longitude: 118.085348,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.warehouseUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        countryCode: 'CN',
        city: 'Xiamen',
        zipCode: '361000',
      }),
      create: expect.objectContaining({
        countryCode: 'CN',
        city: 'Xiamen',
        zipCode: '361000',
      }),
    }));

    await app.close();
  });

  it('persists a coherent Shenzhen warehouse instead of clearing its structured address', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1002,
      name: 'Shenzhen warehouse',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
      address_info: {
        address: 'China, 518000, Guangdong Sheng, Shenzhen, Nanshan qu',
        latitude: 22.5431,
        longitude: 114.0579,
      },
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 22.5431,
      longitude: 114.0579,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.warehouseUpsert.mock.calls[0]?.[0].update).toMatchObject({
      countryCode: 'CN',
      city: 'Shenzhen',
      zipCode: '518000',
    });

    await app.close();
  });

  it('preserves existing structured address fields when OpenAPI evidence is incomplete', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Warehouse without address evidence',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
      address_info: {
        address: 'China, Fujian Sheng, Xiamen',
      },
    }]);
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      platformWarehouseId: '1001',
      countryCode: 'CN',
      city: 'Xiamen',
      zipCode: '361000',
      status: 'active',
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    const upsert = mocks.warehouseUpsert.mock.calls[0]?.[0];
    expect(upsert.update).not.toHaveProperty('countryCode');
    expect(upsert.update).not.toHaveProperty('city');
    expect(upsert.update).not.toHaveProperty('zipCode');

    await app.close();
  });

  it('clears stale trusted address fields when OpenAPI city and coordinates conflict', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Conflicting warehouse',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
      address_info: {
        address: 'China, Guangdong Sheng, Shenzhen',
        latitude: 24.480107,
        longitude: 118.085348,
      },
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      platformWarehouseId: '1001',
      countryCode: 'CN',
      city: 'Xiamen',
      zipCode: '361000',
      status: 'active',
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.warehouseUpsert.mock.calls[0]?.[0].update).toMatchObject({
      countryCode: null,
      city: null,
      zipCode: null,
    });

    await app.close();
  });

  it('invalidates the warehouse release when a delivery provider or method changes', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Xiamen warehouse',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseUpsert.mockResolvedValue({
      id: 'warehouse-1',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.listDeliveryMethods.mockResolvedValue([{
      id: 37,
      warehouse_id: 1001,
      name: 'China Post',
      status: 'active',
      provider_id: 159,
      provider_name: 'Provider B',
      tpl_dropoff_point_id: null,
      cutoff: null,
      sla_cut_in: null,
      tpl_integration_type: 'non_integrated',
      tpl_dropoff_point: null,
    }]);
    mocks.deliveryMethodFindUnique.mockResolvedValue({
      id: 'method-1',
      name: 'China Post',
      status: 'active',
      providerId: 158,
      providerName: 'Provider A',
      tplDropoffPointId: null,
      cutoff: null,
      slaCutIn: null,
      tplIntegrationType: 'non_integrated',
      dropOffPointAddress: null,
      dropOffPointName: null,
    });
    mocks.deliveryMethodUpsert.mockResolvedValue({ id: 'method-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('shop_delivery_method_rule_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('logistics_rule_assignments');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(sql).not.toContain('warehouse_ozon_origin_bindings');

    await app.close();
  });
  it('invalidates the warehouse origin scope after coordinates are pushed manually', async () => {
    mocks.warehouseFindFirst.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      name: 'Xiamen warehouse',
      phone: null,
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.updateWarehouseErfbs.mockResolvedValue({ operation_id: 'operation-1' });
    mocks.warehouseUpdate.mockResolvedValue({
      id: 'warehouse-1',
      status: 'active',
      latitude: 24.500001,
      longitude: 118.100001,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/shops/shop-1/warehouses/warehouse-1/push',
      payload: { latitude: 24.500001, longitude: 118.100001 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('warehouse_ozon_origin_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateWarehouseErfbs.mock.invocationCallOrder[0]!,
    );

    await app.close();
  });
  it('revokes the old warehouse release immediately after a delivery-method push', async () => {
    mocks.warehouseFindFirst.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      type: 'FBS',
      isRfbs: false,
    });
    mocks.updateNonIntegratedDeliveryMethod.mockResolvedValue({ operation_id: 'operation-2' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/shops/shop-1/warehouses/warehouse-1/delivery-method/push',
      payload: {
        delivery_method: {
          delivery_method_id: 37,
          provider_id: 159,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('shop_delivery_method_rule_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(sql).not.toContain('warehouse_ozon_origin_bindings');
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateNonIntegratedDeliveryMethod.mock.invocationCallOrder[0]!,
    );

    await app.close();
  });
  it('invalidates origin evidence when an existing warehouse template changes coordinates', async () => {
    mocks.warehouseTemplateFindUnique.mockResolvedValue({
      id: 'template-1',
      warehouseType: 'fbs',
      workingDays: [],
      workingHourFrom: '09:00',
      workingHourTo: '18:00',
      holidays: [],
      warehouseOptions: {},
      returnMethod: 'COURIER',
      returnZipCode: null,
    });
    mocks.warehouseFindFirst.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.updateFbsWarehouse.mockResolvedValue({ operation_id: 'operation-3' });
    mocks.warehouseUpdate.mockResolvedValue({ id: 'warehouse-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/warehouses/apply-template',
      payload: {
        templateId: 'template-1',
        warehouseId: 'warehouse-1',
        name: 'Xiamen warehouse',
        phone: '13800000000',
        countryCode: 'CN',
        city: 'Xiamen',
        street: 'Hub road',
        zipCode: '361000',
        building: '1',
        latitude: 24.500001,
        longitude: 118.100001,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('warehouse_ozon_origin_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('extension_device_assignment_grants');
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateFbsWarehouse.mock.invocationCallOrder[0]!,
    );

    await app.close();
  });
  it('hides soft-retired shops from the active shop list', async () => {
    mocks.shopFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/shops' });

    expect(response.statusCode).toBe(200);
    expect(mocks.shopFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: 'tenant-1',
        status: { not: 'DISABLED' },
      },
    }));

    await app.close();
  });
  it('invalidates the warehouse release when an existing method disappears from Ozon', async () => {
    mocks.getWarehouseList.mockResolvedValue([{
      warehouse_id: 1001,
      name: 'Xiamen warehouse',
      warehouse_type: 'FBS',
      status: 'active',
      is_rfbs: false,
      is_kgt: false,
      first_mile_type: null,
      working_days: [],
      phone: null,
    }]);
    mocks.getWarehouseCoordinates.mockReturnValue({
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseFindUnique.mockResolvedValue({
      id: 'warehouse-1',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.warehouseUpsert.mockResolvedValue({ id: 'warehouse-1', status: 'active' });
    mocks.listDeliveryMethods.mockResolvedValue([]);
    mocks.deliveryMethodFindMany.mockResolvedValue([{
      id: 'method-1',
      platformMethodId: 37,
      status: 'active',
    }]);
    mocks.deliveryMethodUpdateMany.mockResolvedValue({ count: 1 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/sync-warehouses',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1 });
    expect(mocks.deliveryMethodUpdateMany).toHaveBeenCalledWith({
      where: {
        warehouseId: 'warehouse-1',
        platformMethodId: { in: [37] },
      },
      data: { status: 'missing' },
    });
    const sql = mocks.executeRaw.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).toContain('shop_delivery_method_rule_bindings');
    expect(sql).toContain('logistics_rule_channels');
    expect(sql).toContain('extension_device_assignment_grants');

    await app.close();
  });
  it('clears an optional API secret and invalidates the old credential scope', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/shops/shop-1',
      payload: { apiSecret: '' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.transaction).toHaveBeenCalled();
    expect(mocks.shopUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'shop-1' },
      data: expect.objectContaining({
        apiSecretEncrypted: null,
        status: 'ERROR',
      }),
    }));
    expect(mocks.executeRaw).toHaveBeenCalled();

    await app.close();
  });

  it('does not call Ozon when fail-closed warehouse invalidation cannot commit', async () => {
    mocks.warehouseFindFirst.mockResolvedValue({
      id: 'warehouse-1',
      shopId: 'shop-1',
      platformWarehouseId: '1001',
      name: 'Xiamen warehouse',
      status: 'active',
      latitude: 24.480107,
      longitude: 118.085348,
    });
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/shops/shop-1/warehouses/warehouse-1/push',
      payload: { latitude: 24.500001, longitude: 118.100001 },
    });

    expect(response.statusCode).toBe(502);
    expect(mocks.updateWarehouseErfbs).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('warehouse logistics scope facts', () => {
  const baseline = {
    platformWarehouseId: '1001',
    name: 'Xiamen warehouse',
    status: 'active',
    countryCode: 'CN',
    city: 'Xiamen',
    street: 'Hub road',
    zipCode: '361000',
    latitude: 24.480107,
    longitude: 118.085348,
  };

  it.each([
    ['platform warehouse id', { platformWarehouseId: '1002' }],
    ['city', { city: 'Shenzhen' }],
    ['street', { street: 'Another road' }],
    ['zip code', { zipCode: '518000' }],
  ])('invalidates when the %s changes', (_label, patch) => {
    expect(warehouseLogisticsScopeChanged(baseline, { ...baseline, ...patch })).toBe(true);
  });
});
