import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ configs: vi.fn(), shops: vi.fn(), jobs: vi.fn(), order: vi.fn(), product: vi.fn() }));
vi.mock('../config/system-config-schema.js', async original => ({ ...await original<typeof import('../config/system-config-schema.js')>(), getStrictConfigSnapshot: m.configs }));
vi.mock('../lib/prisma.js', () => ({ prisma: { shop: { findMany: m.shops }, syncJob: { findMany: m.jobs } } }));
vi.mock('../workers/order-sync.js', () => ({ addOrderSyncJob: m.order }));
vi.mock('../workers/product-sync.js', () => ({ addProductSyncJob: m.product }));
import { getDefaultValue, SystemConfigSchema, SystemConfigMeta } from '../config/system-config-schema.js';
import { dispatchShopAutoSync } from '../services/shop-auto-sync.js';
const now = new Date('2026-10-29T10:00:00Z');
describe('server owned automatic platform reads', () => {
  beforeEach(() => { vi.clearAllMocks(); m.configs.mockResolvedValue({ sync_auto_orders_enabled: true, sync_auto_orders_interval_minutes: 5, sync_auto_products_enabled: true, sync_auto_products_interval_minutes: 5 }); m.shops.mockResolvedValue([{ id: 's1' }]); m.jobs.mockResolvedValue([]); m.order.mockResolvedValue({ id: 'o' }); m.product.mockResolvedValue({ id: 'p' }); });
  it('defaults both streams on at five minutes with bounded admin configuration', () => {
    expect(getDefaultValue('sync_auto_orders_enabled' as any)).toBe(true);
    expect(getDefaultValue('sync_auto_products_interval_minutes' as any)).toBe(5);
    expect((SystemConfigSchema as any).sync_auto_orders_interval_minutes.safeParse(4).success).toBe(false);
    expect((SystemConfigMeta as any).sync_auto_orders_enabled.group).toBe('sync');
  });
  it('enqueues owned active supported shops through existing readers, including Yandex', async () => {
    expect(await dispatchShopAutoSync({ now })).toMatchObject({ queued: 2 });
    expect(m.shops).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', platform: { in: ['OZON', 'YANDEX'] }, user: { status: 'ACTIVE' } }) }));
    expect(m.order).toHaveBeenCalledWith('s1', undefined, expect.objectContaining({ trigger: 'scheduled', automaticIntervalMs: 300000 }));
    expect(m.product).toHaveBeenCalledWith('s1', expect.objectContaining({ trigger: 'scheduled', automaticIntervalMs: 300000 }));
  });
  it('does not poll a running/manual stream or recently completed stream again', async () => {
    m.jobs.mockResolvedValue([{ shopId: 's1', type: 'ORDER_PULL', status: 'RUNNING', createdAt: new Date(now.getTime() - 3600000), finishedAt: null }, { shopId: 's1', type: 'PRODUCT_PULL', status: 'SUCCESS', createdAt: new Date(now.getTime() - 600000), finishedAt: new Date(now.getTime() - 60000) }]);
    expect(await dispatchShopAutoSync({ now })).toMatchObject({ queued: 0 }); expect(m.order).not.toHaveBeenCalled(); expect(m.product).not.toHaveBeenCalled();
  });
  it('recovers a pending enqueue with its original reservation instead of leaving it stuck forever', async () => {
    m.jobs.mockResolvedValue([{ shopId: 's1', type: 'ORDER_PULL', status: 'PENDING', createdAt: new Date(now.getTime() - 60000), finishedAt: null }]);
    await dispatchShopAutoSync({ now }); expect(m.order).toHaveBeenCalledOnce();
  });
  it('honors independent disable/interval values and keeps a failed stream from hot looping', async () => {
    m.configs.mockResolvedValue({ sync_auto_orders_enabled: false, sync_auto_orders_interval_minutes: 5, sync_auto_products_enabled: true, sync_auto_products_interval_minutes: 15 });
    m.jobs.mockResolvedValue([{ shopId: 's1', type: 'PRODUCT_PULL', status: 'FAILED', createdAt: new Date(now.getTime() - 600000), finishedAt: new Date(now.getTime() - 600000) }]);
    await dispatchShopAutoSync({ now }); expect(m.order).not.toHaveBeenCalled(); expect(m.product).not.toHaveBeenCalled();
    m.configs.mockResolvedValue({ sync_auto_orders_enabled: false, sync_auto_orders_interval_minutes: 5, sync_auto_products_enabled: false, sync_auto_products_interval_minutes: 5 }); m.shops.mockClear();
    await dispatchShopAutoSync({ now }); expect(m.shops).not.toHaveBeenCalled();
  });
  it('keeps scheduling other shops on enqueue failure and fails closed on invalid settings', async () => {
    m.shops.mockResolvedValue([{ id: 's1' }, { id: 's2' }]); m.order.mockRejectedValueOnce(Error('queue unavailable'));
    expect(await dispatchShopAutoSync({ now })).toMatchObject({ queued: 3, failed: 1 });
    m.configs.mockRejectedValue(Error('invalid persisted settings')); m.shops.mockClear(); await expect(dispatchShopAutoSync({ now })).rejects.toThrow(); expect(m.shops).not.toHaveBeenCalled();
  });
});
