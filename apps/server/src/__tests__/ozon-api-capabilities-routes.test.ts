import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ozonApiCapabilitiesRoutes } from '../routes/ozon-api-capabilities.js';
import { OzonApiCapabilitiesError } from '../services/ozon-api-capabilities.js';

const mocks = vi.hoisted(() => ({
  user: { effectiveUserId: 'account-a', tokenUse: 'account_session', role: 'USER' } as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
  findFirst: vi.fn(),
  decrypt: vi.fn(() => 'synthetic-private-key'),
  read: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({ authenticate: vi.fn(async (request, reply) => {
  if (!mocks.user) return reply.status(401).send({ code: 0, msg: '未登录' });
  request.user = mocks.user;
}) }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findFirst: mocks.findFirst } } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));
vi.mock('../services/ozon-api-capabilities.js', async (original) => ({
  ...await original<typeof import('../services/ozon-api-capabilities.js')>(),
  readOzonApiCapabilities: mocks.read,
}));

describe('Ozon API capability route ownership', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { effectiveUserId: 'account-a', tokenUse: 'account_session', role: 'USER' };
    mocks.rows = [{ id: 'shop-a', userId: 'account-a', platform: 'OZON', status: 'ACTIVE', clientId: 'synthetic-client', apiKeyEncrypted: 'encrypted-private-key' }];
    mocks.findFirst.mockImplementation(async ({ where }) => mocks.rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null);
    mocks.decrypt.mockReturnValue('synthetic-private-key');
    mocks.read.mockResolvedValue({ expiryStatus: 'unknown', carriageBusinessEligibility: 'unverified', features: [] });
  });
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
  async function call() {
    const app = Fastify();
    apps.push(app);
    await app.register(ozonApiCapabilitiesRoutes, { prefix: '/api/ozon-api-capabilities' });
    return app.inject({ method: 'POST', url: '/api/ozon-api-capabilities/shop-a' });
  }

  it('uses the effective account owner and returns no saved credentials', async () => {
    mocks.user = { effectiveUserId: 'account-a', userId: 'child-a', tokenUse: 'account_session', role: 'USER' };
    const response = await call();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { carriageBusinessEligibility: 'unverified' } });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'shop-a', userId: 'account-a', platform: 'OZON', status: 'ACTIVE' },
      select: { id: true, clientId: true, apiKeyEncrypted: true },
    });
    expect(response.body).not.toContain('private-key');
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it.each(['legacy_extension', 'extension_device', undefined])('rejects non-web token use %s before reading credentials', async (tokenUse) => {
    mocks.user = { effectiveUserId: 'account-a', tokenUse };
    expect((await call()).statusCode).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('rejects a missing authenticated session', async () => {
    mocks.user = null;
    expect((await call()).statusCode).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
  it('does not let ADMIN diagnose another owner’s shop', async () => {
    mocks.user = { effectiveUserId: 'admin-account', tokenUse: 'account_session', role: 'ADMIN', isSuperAdmin: true };
    expect((await call()).statusCode).toBe(404);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'DISABLED' }, { status: 'ERROR' }, { platform: 'KASPI' }, { userId: 'account-b' },
  ])('rejects an unavailable shop %s without calling Ozon', async (change) => {
    Object.assign(mocks.rows[0]!, change);
    expect((await call()).statusCode).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects missing credentials before constructing a request', async () => {
    mocks.rows[0]!.clientId = null;
    expect((await call()).statusCode).toBe(400);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('reports official lookup failure using a stable sanitized code', async () => {
    mocks.read.mockRejectedValue(new OzonApiCapabilitiesError('OZON_CAPABILITIES_INVALID_RESPONSE'));
    const response = await call();
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({ code: 0, errorCode: 'OZON_CAPABILITIES_INVALID_RESPONSE' });
    expect(response.body).not.toContain('private-key');
  });

  it('bounds repeated checks before additional credential reads or Ozon requests', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(rateLimit);
    await app.register(ozonApiCapabilitiesRoutes, { prefix: '/api/ozon-api-capabilities' });
    for (let count = 0; count < 6; count += 1) {
      expect((await app.inject({ method: 'POST', url: '/api/ozon-api-capabilities/shop-a' })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/api/ozon-api-capabilities/shop-a' })).statusCode).toBe(429);
    expect(mocks.read).toHaveBeenCalledTimes(6);
  });

  it('does not log raw errors from credential or transport boundaries', async () => {
    const app = Fastify();
    apps.push(app);
    const warn = vi.spyOn(app.log, 'warn');
    await app.register(ozonApiCapabilitiesRoutes, { prefix: '/api/ozon-api-capabilities' });
    mocks.decrypt.mockImplementationOnce(() => { throw new Error('synthetic-private-key in failure'); });
    const response = await app.inject({ method: 'POST', url: '/api/ozon-api-capabilities/shop-a' });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('synthetic-private-key');
    expect(warn).toHaveBeenCalledWith({ code: 'OZON_CAPABILITIES_UNAVAILABLE', shopId: 'shop-a' }, expect.any(String));
  });
});
