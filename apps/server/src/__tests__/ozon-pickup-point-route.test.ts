import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ozonPickupPointRoutes } from '../routes/ozon-pickup-point.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'admin-1', role: 'ADMIN' };
  }),
  requireRole: vi.fn(() => async () => undefined),
  pickupFindMany: vi.fn(),
  pickupFindFirst: vi.fn(),
  pickupCreate: vi.fn(),
  pickupUpdate: vi.fn(),
  pickupUpdateMany: vi.fn(),
  pickupCount: vi.fn(),
  pickupGroupBy: vi.fn(),
  shopFindFirst: vi.fn(),
  fetchSellerDropoffs: vi.fn(),
  ozonListDeliveryMethods: vi.fn(),
  decrypt: vi.fn((value: string) => value),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
  requireRole: mocks.requireRole,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
    },
    ozonPickupPoint: {
      findMany: mocks.pickupFindMany,
      findFirst: mocks.pickupFindFirst,
      create: mocks.pickupCreate,
      update: mocks.pickupUpdate,
      updateMany: mocks.pickupUpdateMany,
      count: mocks.pickupCount,
      groupBy: mocks.pickupGroupBy,
      delete: vi.fn(),
    },
  },
}));

vi.mock('../services/ozon-seller-dropoff-points.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/ozon-seller-dropoff-points.js')>();
  return {
    ...actual,
    fetchOzonSellerDropoffPoints: mocks.fetchSellerDropoffs,
  };
});

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: class {
    listDeliveryMethods = mocks.ozonListDeliveryMethods;
  },
}));

vi.mock('../lib/crypto.js', () => ({
  decrypt: mocks.decrypt,
}));

async function buildApp() {
  const app = Fastify();
  await app.register(ozonPickupPointRoutes, { prefix: '/api/ozon-pickup-points' });
  await app.ready();
  return app;
}

describe('ozon pickup point routes', () => {
  beforeEach(() => {
    mocks.pickupFindMany.mockResolvedValue([]);
    mocks.pickupCount.mockResolvedValue(0);
    mocks.pickupGroupBy.mockResolvedValue([]);
    mocks.pickupUpdateMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('searches pickup points by name, address, provider and external id', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?q=RETS&type=dispatch',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        type: 'dispatch',
        OR: expect.arrayContaining([
          { city: { contains: 'RETS', mode: 'insensitive' } },
          { name: { contains: 'RETS', mode: 'insensitive' } },
          { address: { contains: 'RETS', mode: 'insensitive' } },
          { providerName: { contains: 'RETS', mode: 'insensitive' } },
          { externalId: { contains: 'RETS', mode: 'insensitive' } },
        ]),
      }),
    }));

    await app.close();
  });

  it('filters pickup points by provider and source', async () => {
    mocks.pickupFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?q=厦门&providerId=1164&source=ozon_seller',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        providerId: 1164,
        source: 'ozon_seller',
      }),
    }));

    await app.close();
  });

  it('keeps inactive pickup points hidden from non-admin users even when includeInactive is requested', async () => {
    mocks.authenticate.mockImplementationOnce(async (request: any) => {
      request.user = { userId: 'user-1', role: 'USER' };
    });
    mocks.pickupFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?includeInactive=1',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true }),
    }));

    await app.close();
  });

  it('syncs Ozon seller drop-off points from a shop cookie and company id', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.fetchSellerDropoffs.mockResolvedValue({
      methods: [],
      providers: [{ providerId: 1079, providerName: 'RETS' }],
      providerErrors: [],
      points: [
        {
          externalId: '5802718',
          name: 'RETS广州中心仓',
          address: '广东省广州市白云区龙归街南村3号',
          providerId: 1079,
          providerName: 'RETS',
          boundMethodIds: [32672640],
        },
      ],
    });
    mocks.pickupFindFirst.mockResolvedValue(null);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/sync-ozon-dropoffs',
      payload: { shopId: 'shop-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.fetchSellerDropoffs).toHaveBeenCalledWith(expect.objectContaining({
      cookie: 'sid=demo',
      companyId: '4494016',
    }));
    expect(mocks.pickupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'ozon_seller',
        externalId: '5802718',
        providerId: 1079,
        shopId: 'shop-1',
        city: '广州',
      }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 1,
        updated: 0,
        totalPoints: 1,
        providerCount: 1,
      },
    });

    await app.close();
  });

  it('syncs bound Ozon drop-off points from official delivery methods before using private seller endpoints', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      clientId: 'client',
      apiKeyEncrypted: 'encrypted-key',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.ozonListDeliveryMethods.mockResolvedValueOnce([
      {
        id: 26168680,
        name: 'CEL Standard Budget',
        warehouse_id: 1020005012470660,
        provider_id: 1164,
        provider_name: 'CEL',
        tpl_dropoff_point: {
          code: 'CEL0030AN',
          name: 'CEL福建厦门集货仓',
          address: '厦门市海沧区东孚街道凤山西路6号1层',
        },
      },
      {
        id: 26168681,
        name: 'CEL Standard Budget PUDO',
        warehouse_id: 1020005012470660,
        provider_id: 1164,
        provider_name: 'CEL',
        tpl_dropoff_point: {
          code: 'CEL0030AN',
          name: 'CEL福建厦门集货仓',
          address: '厦门市海沧区东孚街道凤山西路6号1层',
        },
      },
    ]);
    mocks.pickupFindFirst.mockResolvedValue(null);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/sync-ozon-dropoffs',
      payload: { shopId: 'shop-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.fetchSellerDropoffs).not.toHaveBeenCalled();
    expect(mocks.pickupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'ozon_seller',
        externalId: 'CEL0030AN',
        providerId: 1164,
        providerName: 'CEL',
        shopId: 'shop-1',
        city: '厦门',
      }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 1,
        updated: 0,
        totalPoints: 1,
        providerCount: 1,
        methodCount: 2,
      },
    });

    await app.close();
  });

  it('returns an actionable message when Ozon blocks server-side seller API requests', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.fetchSellerDropoffs.mockRejectedValue(new Error(
      'Ozon Seller API HTTP 403: {"challengeURL":"https://seller.ozon.ru/challenge.html?incidentId=fab_chlg_demo"}',
    ));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/sync-ozon-dropoffs',
      payload: { shopId: 'shop-1' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      code: 0,
      msg: expect.stringContaining('Ozon Seller 触发浏览器验证'),
    });

    await app.close();
  });

  it('imports browser-fetched Ozon seller drop-off points from the extension', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindFirst.mockResolvedValue(null);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [{ id: 32672640, name: 'FBS', providerId: 1079, providerName: 'RETS', tplDropoffPointId: 5802718 }],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [],
        points: [
          {
            externalId: '5802718',
            name: 'RETS广州中心仓',
            address: '广东省广州市白云区龙归街南村3号',
            providerId: 1079,
            providerName: 'RETS',
            boundMethodIds: [32672640],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.fetchSellerDropoffs).not.toHaveBeenCalled();
    expect(mocks.pickupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        source: 'ozon_seller',
        externalId: '5802718',
        providerId: 1079,
        shopId: 'shop-1',
        city: '广州',
      }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 1,
        updated: 0,
        totalPoints: 1,
        providerCount: 1,
      },
    });

    await app.close();
  });

  it('marks previously synced Ozon seller points missing from the latest import as inactive', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindMany.mockResolvedValue([]);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });
    mocks.pickupUpdateMany.mockResolvedValue({ count: 7 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [],
        points: [
          {
            externalId: '5802718',
            name: 'RETS广州中心仓',
            address: '广东省广州市白云区龙归街南村3号',
            providerId: 1079,
            providerName: 'RETS',
            boundMethodIds: [],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        source: 'ozon_seller',
        shopId: 'shop-1',
        isActive: true,
        OR: [{ syncedAt: null }, { syncedAt: { lt: expect.any(Date) } }],
      }),
      data: expect.objectContaining({
        isActive: false,
      }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        deactivated: 7,
      },
    });

    await app.close();
  });

  it('does not deactivate existing Ozon seller points when provider fetches have errors', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindMany.mockResolvedValue([]);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [{ providerId: 1268, message: 'HTTP 429' }],
        points: [
          {
            externalId: '5802718',
            name: 'RETS广州中心仓',
            address: '广东省广州市白云区龙归街南村3号',
            providerId: 1079,
            providerName: 'RETS',
            boundMethodIds: [],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupUpdateMany).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        deactivated: 0,
        providerErrors: [{ providerId: 1268, message: 'HTTP 429' }],
      },
    });

    await app.close();
  });

  it('touches unchanged Ozon seller points without rewriting full row data', async () => {
    const point = {
      externalId: '5802718',
      name: 'RETS广州中心仓',
      address: '广东省广州市白云区龙归街南村3号',
      providerId: 1079,
      providerName: 'RETS',
      boundMethodIds: [],
    };
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindMany.mockResolvedValue([
      {
        id: 'existing-1',
        externalId: point.externalId,
        providerId: point.providerId,
        isActive: true,
        syncHash: pickupPointSyncHash({
          city: '广州',
          province: '广东',
          type: 'dispatch',
          name: point.name,
          address: point.address,
          contact: null,
          phone: null,
          workingHours: null,
          note: 'Ozon provider 1079 RETS; 未匹配当前物流方式',
          isActive: true,
          sortOrder: 100,
          source: 'ozon_seller',
          externalId: point.externalId,
          providerId: point.providerId,
          providerName: point.providerName,
          shopId: 'shop-1',
          rawData: point,
        }),
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [],
        points: [point],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupUpdate).not.toHaveBeenCalled();
    expect(mocks.pickupCreate).not.toHaveBeenCalled();
    expect(mocks.pickupUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['existing-1'] } },
      data: { syncedAt: expect.any(Date) },
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 0,
        updated: 0,
        unchanged: 1,
      },
    });

    await app.close();
  });

  it('rewrites existing Ozon seller points when their synced content changes', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindMany.mockResolvedValue([
      {
        id: 'existing-1',
        externalId: '5802718',
        providerId: 1079,
        isActive: true,
        syncHash: 'old-hash',
      },
    ]);
    mocks.pickupUpdate.mockResolvedValue({ id: 'existing-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [],
        points: [
          {
            externalId: '5802718',
            name: 'RETS广州新仓',
            address: '广东省广州市白云区龙归街南村3号',
            providerId: 1079,
            providerName: 'RETS',
            boundMethodIds: [],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        name: 'RETS广州新仓',
        syncHash: expect.any(String),
      }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 0,
        updated: 1,
        unchanged: 0,
      },
    });

    await app.close();
  });

  it('imports browser-fetched Ozon seller drop-off points with string drop-off codes', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindFirst.mockResolvedValue(null);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [{
          id: 26168680,
          name: 'CEL Standard Budget',
          providerId: 1164,
          providerName: 'CEL',
          tplDropoffPointId: 'CEL0030AN',
        }],
        providers: [{ providerId: 1164, providerName: 'CEL' }],
        providerErrors: [],
        points: [
          {
            externalId: 'CEL0030AN',
            name: 'CEL福建厦门集货仓',
            address: '厦门市海沧区东孚街道凤山西路6号1层 联系人：张三 19560457781',
            providerId: 1164,
            providerName: 'CEL',
            boundMethodIds: [26168680],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        externalId: 'CEL0030AN',
        providerId: 1164,
        city: '厦门',
        address: '厦门市海沧区东孚街道凤山西路6号1层',
        contact: '张三',
        phone: '19560457781',
      }),
    }));

    await app.close();
  });

  it('paginates pickup point lists and omits raw data from list rows', async () => {
    mocks.pickupCount.mockResolvedValue(9741);
    mocks.pickupFindMany.mockResolvedValue([
      {
        id: 'point-1',
        city: '厦门',
        province: '福建',
        type: 'dispatch',
        name: 'CEL福建厦门集货仓',
        address: '厦门市海沧区东孚街道凤山西路6号1层',
        contact: null,
        phone: null,
        workingHours: null,
        note: null,
        isActive: true,
        sortOrder: 100,
        source: 'ozon_seller',
        externalId: 'CEL0030AN',
        providerId: 1164,
        providerName: 'CEL',
        shopId: 'shop-1',
        syncedAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?q=厦门&page=3&pageSize=50&source=ozon_seller',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isActive: true,
        source: 'ozon_seller',
      }),
    }));
    expect(mocks.pickupFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 100,
      take: 50,
      select: expect.objectContaining({
        id: true,
        city: true,
        providerName: true,
      }),
    }));
    const findArgs = mocks.pickupFindMany.mock.calls[0]?.[0];
    expect(findArgs).toBeTruthy();
    expect(Object.keys(findArgs!.select)).not.toContain('rawData');
    expect(response.json()).toMatchObject({
      code: 1,
      data: [expect.objectContaining({ id: 'point-1' })],
      meta: {
        page: 3,
        pageSize: 50,
        total: 9741,
        totalPages: 195,
        hasNext: true,
      },
    });

    await app.close();
  });

  it('groups Ozon seller service variants by warehouse address for operator search', async () => {
    const sharedAddress = '福建省三明市三元区列东街道高岩路26号梅狮新村-76栋';
    mocks.pickupFindMany.mockResolvedValue([
      {
        id: 'point-1',
        city: '三明',
        province: '福建',
        type: 'dispatch',
        name: 'GW-SANMING01',
        address: sharedAddress,
        contact: null,
        phone: null,
        workingHours: null,
        note: 'Ozon provider 1050 GUOO Standard Extra Small; 未匹配当前物流方式',
        isActive: true,
        sortOrder: 100,
        source: 'ozon_seller',
        externalId: '179998800',
        providerId: 1050,
        providerName: 'GUOO Standard Extra Small',
        shopId: 'shop-1',
        syncedAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
      {
        id: 'point-2',
        city: '三明',
        province: '福建',
        type: 'dispatch',
        name: 'GW-SANMING01',
        address: sharedAddress,
        contact: null,
        phone: null,
        workingHours: null,
        note: 'Ozon provider 1051 GUOO Economy Extra Small; 未匹配当前物流方式',
        isActive: true,
        sortOrder: 100,
        source: 'ozon_seller',
        externalId: '179998799',
        providerId: 1051,
        providerName: 'GUOO Economy Extra Small',
        shopId: 'shop-1',
        syncedAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
      {
        id: 'point-3',
        city: '三明',
        province: '福建',
        type: 'dispatch',
        name: 'GW-SANMING01',
        address: sharedAddress,
        contact: null,
        phone: null,
        workingHours: null,
        note: 'Ozon provider 1244 GUOO Economy Budget; 未匹配当前物流方式',
        isActive: true,
        sortOrder: 100,
        source: 'ozon_seller',
        externalId: '179998802',
        providerId: 1244,
        providerName: 'GUOO Economy Budget',
        shopId: 'shop-1',
        syncedAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?view=warehouse&q=三明&page=1&pageSize=20&source=ozon_seller',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      code: 1,
      data: [
        expect.objectContaining({
          city: '三明',
          address: sharedAddress,
          serviceCount: 3,
          carriers: ['GUOO'],
          services: expect.arrayContaining([
            expect.objectContaining({
              id: 'point-2',
              providerName: 'GUOO Economy Extra Small',
              carrierName: 'GUOO',
              serviceLevel: 'Economy',
              weightTier: 'Extra Small',
            }),
            expect.objectContaining({
              id: 'point-3',
              providerName: 'GUOO Economy Budget',
              carrierName: 'GUOO',
              serviceLevel: 'Economy',
              weightTier: 'Budget',
            }),
            expect.objectContaining({
              id: 'point-1',
              providerName: 'GUOO Standard Extra Small',
              carrierName: 'GUOO',
              serviceLevel: 'Standard',
              weightTier: 'Extra Small',
            }),
          ]),
        }),
      ],
      meta: expect.objectContaining({
        total: 1,
        totalRows: 3,
        totalPages: 1,
        hasNext: false,
      }),
    });
    expect(body.data).toHaveLength(1);

    await app.close();
  });

  it('normalizes imported Ozon contact suffixes when listing existing rows', async () => {
    mocks.pickupFindMany.mockResolvedValue([
      {
        id: 'point-1',
        city: '义乌',
        province: null,
        type: 'dispatch',
        name: '【义乌山颂揽收仓】',
        address: '【义乌山颂揽收仓】后宅街道城北路L10号3号电梯5楼502 冉文欣',
        contact: null,
        phone: '13157045678',
        workingHours: null,
        note: 'Ozon provider 1093 ZTO Express Extra Small; 未匹配当前物流方式',
        isActive: true,
        sortOrder: 100,
        source: 'ozon_seller',
        externalId: '175612499',
        providerId: 1093,
        providerName: 'ZTO Express Extra Small',
        shopId: 'shop-1',
        syncedAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points?view=warehouse&q=义乌&page=1&pageSize=20&source=ozon_seller',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: [
        expect.objectContaining({
          address: '【义乌山颂揽收仓】后宅街道城北路L10号3号电梯5楼502',
          contact: '冉文欣',
          phone: '13157045678',
          services: [
            expect.objectContaining({
              address: '【义乌山颂揽收仓】后宅街道城北路L10号3号电梯5楼502',
              contact: '冉文欣',
            }),
          ],
        }),
      ],
    });

    await app.close();
  });

  it('returns provider options without loading all pickup points', async () => {
    mocks.pickupGroupBy.mockResolvedValue([
      { providerId: 1079, providerName: 'RETS Standard Extra Small', _count: { _all: 19 } },
      { providerId: 1079, providerName: null, _count: { _all: 3 } },
      { providerId: 1164, providerName: 'CEL', _count: { _all: 32 } },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-pickup-points/providers?source=ozon_seller',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupGroupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['providerId', 'providerName'],
      where: expect.objectContaining({
        isActive: true,
        source: 'ozon_seller',
        providerId: { not: null },
      }),
    }));
    expect(mocks.pickupFindMany).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      code: 1,
      data: [
        { providerId: 1164, providerName: 'CEL', count: 32 },
        { providerId: 1079, providerName: 'RETS Standard Extra Small', count: 22 },
      ],
    });

    await app.close();
  });

  it('accepts a full browser-fetched Ozon seller drop-off import payload over the default body limit', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });
    mocks.pickupFindFirst.mockResolvedValue(null);
    mocks.pickupCreate.mockResolvedValue({ id: 'point-1' });

    const longAddress = '广东省广州市白云区龙归街南村龙河西南横二路3号'.repeat(60);
    const points = Array.from({ length: 500 }, (_, index) => ({
      externalId: `large-${index}`,
      name: `发运点 ${index}`,
      address: `${longAddress}-${index}`,
      providerId: 1079,
      providerName: 'RETS',
      boundMethodIds: [],
    }));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [{ providerId: 1079, providerName: 'RETS' }],
        providerErrors: [],
        points,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupCreate).toHaveBeenCalledTimes(points.length);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: points.length,
        totalPoints: points.length,
      },
    });

    await app.close();
  });

  it('accepts an empty browser-fetched drop-off list when the seller account has no visible points', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '4494016',
        methods: [],
        providers: [],
        providerErrors: [],
        points: [],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.pickupCreate).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        created: 0,
        updated: 0,
        totalPoints: 0,
      },
    });

    await app.close();
  });

  it('rejects extension imports when the active Ozon company does not match the selected shop', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      config: { ozonCdnCookie: 'sid=demo', ozonCompanyId: '4494016' },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-pickup-points/import-ozon-dropoffs',
      payload: {
        shopId: 'shop-1',
        companyId: '9999999',
        methods: [],
        providers: [],
        providerErrors: [],
        points: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 0,
      msg: expect.stringContaining('当前 Ozon Seller 店铺'),
    });
    expect(mocks.pickupCreate).not.toHaveBeenCalled();

    await app.close();
  });
});

function pickupPointSyncHash(data: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(data)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
