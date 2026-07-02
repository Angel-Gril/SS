import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('searches pickup points by name, address, provider and external id', async () => {
    mocks.pickupFindMany.mockResolvedValue([]);

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
