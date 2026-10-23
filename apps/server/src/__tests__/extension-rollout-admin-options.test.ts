import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createExtensionRolloutAdminOptionsService } from '../services/extension-rollout-admin-options.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const owner = { id: 'owner-a', nickname: 'Alpha', accountCode: 'A01', status: 'ACTIVE', phone: 'private-contact', passwordHash: 'secret' };
function setup() {
  const database = {
    user: { findMany: vi.fn(async (_query: unknown) => [owner]) },
    shop: { findMany: vi.fn(async (_query: unknown) => [{ id: 'shop-a', name: 'Alpha shop', platform: 'OZON', status: 'ACTIVE', userId: owner.id, apiKeyEncrypted: 'secret' }]) },
    extensionDeviceSession: { findMany: vi.fn(async (_query: unknown) => [{ id: 'device-a', ownerUserId: owner.id, status: 'ACTIVE', scopes: ['capture:write'], shopGrants: [{ shopId: 'shop-a' }], currentJti: 'secret' }]) },
  };
  return { database, service: createExtensionRolloutAdminOptionsService(database as unknown as Pick<PrismaClient, 'user' | 'shop' | 'extensionDeviceSession'>, () => now) };
}

describe('extension rollout options service', () => {
  it('returns minimal owner labels and does not query shops or devices without selected owners', async () => {
    const { database, service } = setup();
    const result = await service.list({ search: 'Alpha', limit: '10' });
    expect(result.owners).toEqual([{ id: 'owner-a', nickname: 'Alpha', accountCode: 'A01', status: 'ACTIVE' }]);
    expect(result.shops).toEqual([]);
    expect(result.devices).toEqual([]);
    expect(database.shop.findMany).not.toHaveBeenCalled();
    expect(database.extensionDeviceSession.findMany).not.toHaveBeenCalled();
  });

  it('queries only selected active owners and projects no credentials or personal contacts', async () => {
    const { database, service } = setup();
    const result = await service.list({ ownerUserIds: 'owner-a', limit: '10' });
    expect(result.shops).toEqual([{ id: 'shop-a', name: 'Alpha shop', platform: 'OZON', status: 'ACTIVE', ownerUserId: 'owner-a' }]);
    expect(result.devices).toEqual([{ id: 'device-a', ownerUserId: 'owner-a', status: 'ACTIVE', shopIds: ['shop-a'], scopes: ['capture:write'] }]);
    expect(database.shop.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { in: ['owner-a'] }, status: 'ACTIVE' }), take: 11 }));
    expect(database.extensionDeviceSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerUserId: { in: ['owner-a'] }, status: 'ACTIVE', expiresAt: { gt: now } }), take: 11 }));
    expect(JSON.stringify(result)).not.toMatch(/secret|private-contact|phone|passwordHash|apiKey|currentJti/);
  });

  it.each([
    { limit: 0 }, { limit: 501 }, { search: 'a'.repeat(101) },
    { ownerUserIds: Array.from({ length: 51 }, (_, i) => `owner-${i}`).join(',') },
    { ownerUserIds: ['owner-a'] }, { ownerUserIds: 'owner-a,,owner-b' }, { unexpected: 'value' },
  ])('rejects invalid or unbounded query %j before database access', async (query) => {
    const { database, service } = setup();
    await expect(service.list(query)).rejects.toThrow();
    expect(database.user.findMany).not.toHaveBeenCalled();
  });

  it('does not fetch shops or devices for nonexistent or disabled owners', async () => {
    const { database, service } = setup();
    database.user.findMany.mockResolvedValue([]);
    const result = await service.list({ ownerUserIds: 'missing-owner' });
    expect(result.shops).toEqual([]);
    expect(result.devices).toEqual([]);
    expect(database.shop.findMany).not.toHaveBeenCalled();
    expect(database.extensionDeviceSession.findMany).not.toHaveBeenCalled();
  });

  it('enforces active primary-owner lookup and finite minimal projections', async () => {
    const { database, service } = setup();
    await service.list({ ownerUserIds: 'owner-a,owner-b,owner-a', platform: 'OZON', limit: 1 });
    expect(database.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { parentId: null, status: 'ACTIVE' },
      take: 2,
      select: { id: true, nickname: true, accountCode: true, status: true },
    }));
    expect(database.user.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['owner-a', 'owner-b'] }, parentId: null, status: 'ACTIVE' },
      select: { id: true },
      take: 50,
    });
    expect(database.shop.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: { in: ['owner-a'] }, status: 'ACTIVE', platform: 'OZON' },
      select: { id: true, name: true, platform: true, status: true, userId: true },
      take: 2,
    }));
    const deviceQuery = database.extensionDeviceSession.findMany.mock.calls[0]?.[0] as any;
    expect(deviceQuery.select.shopGrants).toMatchObject({
      where: { status: 'ACTIVE', shop: { userId: { in: ['owner-a'] }, status: 'ACTIVE', platform: 'OZON' } },
      take: 50,
    });
    expect(Object.keys(deviceQuery.select).sort()).toEqual(['id', 'ownerUserId', 'scopes', 'shopGrants', 'status']);
  });

  it('marks truncated collections and never returns more than the requested limit', async () => {
    const { database, service } = setup();
    database.user.findMany.mockResolvedValueOnce([owner, { ...owner, id: 'owner-b' }]);
    database.shop.findMany.mockResolvedValue([{ id: 'shop-a', name: 'One', platform: 'OZON', status: 'ACTIVE', userId: owner.id, apiKeyEncrypted: 'secret' }, { id: 'shop-b', name: 'Two', platform: 'OZON', status: 'ACTIVE', userId: owner.id, apiKeyEncrypted: 'secret' }]);
    const result = await service.list({ ownerUserIds: 'owner-a', limit: 1 });
    expect(result.owners).toHaveLength(1);
    expect(result.shops).toHaveLength(1);
    expect(result.hasMore).toEqual({ owners: true, shops: true, devices: false });
  });

  it('reports missing selections without expanding to unrelated owner data', async () => {
    const { service } = setup();
    const result = await service.list({ ownerUserIds: 'owner-a,missing-owner' });
    expect(result.unavailableOwnerUserIds).toEqual(['missing-owner']);
    expect(result.shops.every((shop) => shop.ownerUserId === 'owner-a')).toBe(true);
  });
});
