import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionDeviceBrowserOneClickRoutes } from '../routes/extension-device-browser-one-click.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  patch: vi.fn(),
  shopFindFirst: vi.fn(),
  shopFindMany: vi.fn(),
  watermarkFindMany: vi.fn(),
}));

vi.mock('../routes/listing.js', () => ({
  createBrowserOneClickListingJobForActor: mocks.create,
  patchBrowserOneClickListingJobForActor: mocks.patch,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: { findFirst: mocks.shopFindFirst, findMany: mocks.shopFindMany },
    watermarkTemplate: { findMany: mocks.watermarkFindMany },
  },
}));

function device(scopes = ['capture:write', 'listing:publish'], sessionId = 'session-1') {
  return {
    sessionId,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes,
    allowedShopIds: ['shop-1'],
  };
}

async function buildApp(value = device()) {
  const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
    (request as any).device = value;
  });
  const app = Fastify();
  await app.register(extensionDeviceBrowserOneClickRoutes, {
    authenticateDevice,
    featureFlags: { evaluate: vi.fn() },
    sourceListingWorkflowAdapter: { prepare: vi.fn() },
  } as any);
  return { app, authenticateDevice };
}

describe('extension device browser one-click routes', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns live device scopes through an authenticated no-store status read', async () => {
    const { app } = await buildApp(device(['listing:publish'], 'session-live'));
    const response = await app.inject({
      method: 'POST',
      url: '/status/read',
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        sessionId: 'session-live',
        scopes: ['listing:publish'],
        allowedShopIds: ['shop-1'],
      },
    });
  });

  it('passes the exact owner, shop grants, and session binding to job creation', async () => {
    mocks.create.mockImplementation(async (_request: unknown, reply: any, actor: unknown) => (
      reply.send({ code: 1, data: { actor } })
    ));
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: { shopId: 'shop-1', sourceSkus: ['sku-1'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.actor).toEqual({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      role: 'USER',
      allowedShopIds: ['shop-1'],
      deviceSessionId: 'session-1',
    });
  });

  it('rejects job creation and mutation without listing:publish', async () => {
    const { app } = await buildApp(device(['capture:write']));
    const created = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: { shopId: 'shop-1', sourceSkus: ['sku-1'] },
    });
    const patched = await app.inject({
      method: 'POST',
      url: '/jobs/job-1',
      payload: { status: 'RUNNING' },
    });
    expect(created.statusCode).toBe(403);
    expect(patched.statusCode).toBe(403);
    expect(created.json()).toMatchObject({ errorCode: 'insufficient_scope' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('allows a paired capture device to read only its shop watermarks', async () => {
    mocks.shopFindFirst.mockResolvedValue({ name: 'BINI' });
    mocks.watermarkFindMany.mockResolvedValue([{ id: 'watermark-1', name: 'Default' }]);
    const { app } = await buildApp(device(['capture:write']));
    const response = await app.inject({
      method: 'POST',
      url: '/watermark-templates/read',
      payload: { shopId: 'shop-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: [{ id: 'watermark-1' }] });
    expect(mocks.watermarkFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        OR: [{ shopId: 'shop-1' }, { shopId: null }, { shopId: 'BINI' }],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('limits an unfiltered watermark read to global and device-granted shops', async () => {
    mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1', name: 'BINI' }]);
    mocks.watermarkFindMany.mockResolvedValue([{ id: 'watermark-1', name: 'Default' }]);
    const { app } = await buildApp(device(['capture:write']));
    const response = await app.inject({
      method: 'POST',
      url: '/watermark-templates/read',
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.shopFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['shop-1'] }, userId: 'owner-1' },
      select: { id: true, name: true },
    });
    expect(mocks.watermarkFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner-1',
        OR: [{ shopId: null }, { shopId: 'shop-1' }, { shopId: 'BINI' }],
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  });

  it('rejects watermark reads without capture:write', async () => {
    const { app } = await buildApp(device(['listing:publish']));
    const response = await app.inject({
      method: 'POST',
      url: '/watermark-templates/read',
      payload: { shopId: 'shop-1' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'insufficient_scope' });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();
    expect(mocks.watermarkFindMany).not.toHaveBeenCalled();
  });

  it('hides shops outside the live device grants before any database read', async () => {
    const { app } = await buildApp(device(['capture:write']));
    const response = await app.inject({
      method: 'POST',
      url: '/watermark-templates/read',
      payload: { shopId: 'shop-2' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ errorCode: 'device_shop_not_found' });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();
    expect(mocks.watermarkFindMany).not.toHaveBeenCalled();
  });
});
