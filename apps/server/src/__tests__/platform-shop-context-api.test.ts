import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportRoutes } from '../routes/export.js';
import { orderAnalyticsRoutes } from '../routes/order/analytics.js';
import { financeRoutes } from '../routes/finance.js';
import { issueRoutes } from '../routes/issue.js';
import { returnRoutes } from '../routes/return.js';

const mocks = vi.hoisted(() => ({
  shops: vi.fn(), orders: vi.fn(), count: vi.fn(), aggregate: vi.fn(), supply: vi.fn(),
  returns: vi.fn(), issues: vi.fn(), returnCount: vi.fn(), issueCount: vi.fn(), groups: vi.fn(),
}));
vi.mock('../lib/auth.js', () => ({ authenticate: async (request: any) => {
  request.user = { userId: 'owner', role: request.headers['x-role'] || 'USER' };
} }));
vi.mock('../lib/prisma.js', () => ({ prisma: {
  shop: { findMany: mocks.shops }, order: { findMany: mocks.orders, count: mocks.count, aggregate: mocks.aggregate },
  supplyGoods: { findMany: mocks.supply },
  return: { findMany: mocks.returns, count: mocks.returnCount, groupBy: mocks.groups },
  expressIssue: { findMany: mocks.issues, count: mocks.issueCount, groupBy: mocks.groups },
} }));

const shops = [
  { id: 'ozon-a', userId: 'owner', name: 'A', platform: 'OZON', status: 'ACTIVE' },
  { id: 'yandex-a', userId: 'owner', name: 'A', platform: 'YANDEX', status: 'ACTIVE' },
  { id: 'yandex-b', userId: 'owner', name: 'B', platform: 'YANDEX', status: 'ACTIVE' },
  { id: 'disabled', userId: 'owner', name: 'retired', platform: 'OZON', status: 'DISABLED' },
  { id: 'foreign', userId: 'other', name: 'other', platform: 'YANDEX', status: 'ACTIVE' },
];
const apps: ReturnType<typeof Fastify>[] = [];
async function appFor() {
  const app = Fastify(); apps.push(app);
  await app.register(exportRoutes, { prefix: '/api/export' });
  await app.register(orderAnalyticsRoutes, { prefix: '/api/orders' });
  await app.register(financeRoutes, { prefix: '/api/finance' });
  await app.register(returnRoutes, { prefix: '/api/returns' });
  await app.register(issueRoutes, { prefix: '/api/issues' });
  return app;
}
beforeEach(() => {
  mocks.shops.mockImplementation(async ({ where }: any) => shops.filter(shop =>
    (!where.userId || shop.userId === where.userId)
    && (!where.platform || shop.platform === where.platform)
    && (!where.status || shop.status !== where.status.not)
    && (!where.id || (typeof where.id === 'string' ? shop.id === where.id : where.id.in.includes(shop.id)))));
  mocks.orders.mockResolvedValue([]); mocks.returns.mockResolvedValue([]); mocks.issues.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0); mocks.returnCount.mockResolvedValue(0); mocks.issueCount.mockResolvedValue(0);
  mocks.aggregate.mockResolvedValue({ _sum: { totalAmount: null } });
  mocks.supply.mockResolvedValue([]); mocks.groups.mockResolvedValue([]);
});
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.resetAllMocks(); });

describe('operational platform and shop scope', () => {
  it.each(['USER', 'ADMIN'])('keeps platform and retired-shop predicates in %s order exports', async role => {
    const app = await appFor();
    const response = await app.inject({ url: '/api/export/orders?platform=YANDEX', headers: { 'x-role': role } });
    expect(response.statusCode).toBe(200);
    expect(mocks.orders.mock.calls[0]![0].where.shop).toEqual({ status: { not: 'DISABLED' }, platform: 'YANDEX' });
    if (role === 'USER') expect(mocks.orders.mock.calls[0]![0].where.shopId.in).not.toContain('foreign');
  });
  it('uses both selected platform and shop for order summary totals', async () => {
    const app = await appFor();
    const response = await app.inject('/api/orders/stats?platform=YANDEX&shopId=yandex-a');
    expect(response.statusCode).toBe(200);
    expect(mocks.count.mock.calls[0]![0].where.shopId).toEqual({ in: ['yandex-a'] });
  });
  it.each(['/api/orders/stats', '/api/finance/profit', '/api/returns', '/api/returns/stats', '/api/issues', '/api/issues/stats'])('rejects invalid platform before reading shops: %s', async endpoint => {
    const app = await appFor();
    expect((await app.inject(`${endpoint}?platform=UNKNOWN`)).statusCode).toBe(400);
    expect(mocks.shops).not.toHaveBeenCalled();
  });
  it.each(['/api/returns', '/api/issues'])('never broadens a conflicting shop/platform selection: %s', async endpoint => {
    const app = await appFor();
    const response = await app.inject(`${endpoint}?platform=YANDEX&shopId=ozon-a`);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.total).toBe(0);
    const read = endpoint === '/api/returns' ? mocks.returns : mocks.issues;
    if (read.mock.calls.length) expect(read.mock.calls[0]![0].where.shopId).toEqual({ in: [] });
  });
  it.each(['/api/returns/stats', '/api/issues/stats'])('keeps totals within the selected shop: %s', async endpoint => {
    const app = await appFor(); await app.inject(`${endpoint}?platform=YANDEX&shopId=yandex-a`);
    const count = endpoint.startsWith('/api/returns') ? mocks.returnCount : mocks.issueCount;
    expect(count.mock.calls[0]![0].where.shopId).toEqual({ in: ['yandex-a'] });
  });
  it('excludes retired stores from profit and never broadens a foreign selection', async () => {
    const app = await appFor(); await app.inject('/api/finance/profit?platform=OZON');
    expect(mocks.orders.mock.calls[0]![0].where.shopId).toEqual({ in: ['ozon-a'] });
    mocks.orders.mockClear(); await app.inject('/api/finance/profit?shopId=foreign');
    expect(mocks.orders.mock.calls[0]![0].where.shopId).toEqual({ in: [] });
  });
});
