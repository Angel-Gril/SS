import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaExtensionDeviceShopRepository,
  extensionDeviceOzonCdnAuthStatus,
  ExtensionDeviceShopConfigConflictError,
} from '../services/extension-device-shop-prisma.js';

describe('extension device shop Prisma repository', () => {
  it('projects only device-safe shop identity used for exact Ozon company matching', async () => {
    const findMany = vi.fn(async () => [{
      id: 'shop-1',
      platform: 'OZON',
      name: 'BINI',
      status: 'ACTIVE',
      clientId: 'client-1',
      config: {
        ozonCompanyId: 'company-1',
        ozonCdnCookie: 'must-not-leak',
        privateSetting: 'must-not-leak',
      },
    }]);
    const repository = createPrismaExtensionDeviceShopRepository({
      shop: { findMany },
    } as never);

    const shops = await repository.listAuthorizedShops({
      ownerUserId: 'owner-1',
      shopIds: ['shop-1'],
    });

    expect(shops).toEqual([{
      id: 'shop-1',
      platform: 'OZON',
      name: 'BINI',
      status: 'ACTIVE',
      clientId: 'client-1',
      companyId: 'company-1',
    }]);
    expect(JSON.stringify(shops)).not.toContain('must-not-leak');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'owner-1',
        id: { in: ['shop-1'] },
        platform: 'OZON',
      }),
    }));
  });

  it('never projects the stored Cookie through the auth status', () => {
    const status = extensionDeviceOzonCdnAuthStatus({
      ozonCdnCookie: 'session=secret',
      ozonCompanyId: 123,
      ozonCdnUpdatedAt: '2026-08-11T05:00:00.000Z',
    });

    expect(status).toEqual({
      hasCookie: true,
      companyId: '123',
      updatedAt: '2026-08-11T05:00:00.000Z',
    });
    expect(JSON.stringify(status)).not.toContain('session=secret');
  });

  it('re-reads and merges config after a concurrent update instead of overwriting it', async () => {
    const firstUpdatedAt = new Date('2026-08-11T05:00:00.000Z');
    const secondUpdatedAt = new Date('2026-08-11T05:00:01.000Z');
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ config: { notificationMode: 'old' }, updatedAt: firstUpdatedAt })
      .mockResolvedValueOnce({ config: { notificationMode: 'new' }, updatedAt: secondUpdatedAt });
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const repository = createPrismaExtensionDeviceShopRepository({
      shop: { findFirst, updateMany },
    } as never);

    const result = await repository.updateOzonCdnAuth({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      cookie: 'session=secret',
      companyId: 'company-1',
    });

    expect(result).toMatchObject({ hasCookie: true, companyId: 'company-1' });
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0]![0].where.updatedAt).toBe(firstUpdatedAt);
    expect(updateMany.mock.calls[1]![0].where.updatedAt).toBe(secondUpdatedAt);
    expect(updateMany.mock.calls[0]![0].data.updatedAt.getTime()).toBeGreaterThan(
      firstUpdatedAt.getTime(),
    );
    expect(updateMany.mock.calls[1]![0].data.updatedAt.getTime()).toBeGreaterThan(
      secondUpdatedAt.getTime(),
    );
    expect(updateMany.mock.calls[1]![0].data.config).toMatchObject({
      notificationMode: 'new',
      ozonCdnCookie: 'session=secret',
      ozonCompanyId: 'company-1',
    });
  });

  it('fails without a write after the owner-bound shop disappears', async () => {
    const updateMany = vi.fn();
    const repository = createPrismaExtensionDeviceShopRepository({
      shop: { findFirst: vi.fn(async () => null), updateMany },
    } as never);

    await expect(repository.updateOzonCdnAuth({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      cookie: 'session=secret',
    })).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('fails with a stable conflict after the bounded CAS retries are exhausted', async () => {
    const findFirst = vi.fn(async () => ({
      config: { notificationMode: 'current' },
      updatedAt: new Date('2026-08-11T05:00:00.000Z'),
    }));
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const repository = createPrismaExtensionDeviceShopRepository({
      shop: { findFirst, updateMany },
    } as never);

    await expect(repository.updateOzonCdnAuth({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      cookie: 'session=secret',
    })).rejects.toBeInstanceOf(ExtensionDeviceShopConfigConflictError);
    expect(findFirst).toHaveBeenCalledTimes(3);
    expect(updateMany).toHaveBeenCalledTimes(3);
  });
});
