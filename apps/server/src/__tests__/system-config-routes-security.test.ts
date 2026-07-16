import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tokenUse: 'account_session' as 'account_session' | 'legacy_extension' | undefined,
  isSuperAdmin: true,
  rows: new Map<string, Record<string, unknown>>(),
}));

const db = vi.hoisted(() => ({
  findUnique: vi.fn(async ({ where }: { where: { key: string } }) => state.rows.get(where.key) ?? null),
  findMany: vi.fn(async () => Array.from(state.rows.values())),
  upsert: vi.fn(async ({ where, create, update }: any) => {
    const current = state.rows.get(where.key);
    const row = { ...(current ? current : create), ...(current ? update : {}), key: where.key };
    state.rows.set(where.key, row);
    return row;
  }),
  create: vi.fn(async ({ data }: any) => {
    state.rows.set(data.key, data);
    return data;
  }),
  update: vi.fn(async ({ where, data }: any) => {
    const row = { ...(state.rows.get(where.key) ?? { key: where.key }), ...data };
    state.rows.set(where.key, row);
    return row;
  }),
  deleteMany: vi.fn(async ({ where }: any) => {
    const deleted = typeof where.key === 'string' && state.rows.delete(where.key) ? 1 : 0;
    return { count: deleted };
  }),
  transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
}));

const audit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../lib/auth.js', () => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = {
      userId: 'admin-1',
      actorUserId: 'admin-1',
      role: 'ADMIN',
      isSuperAdmin: state.isSuperAdmin,
      ...(state.tokenUse ? { tokenUse: state.tokenUse } : {}),
    };
  }),
  requireSuperAdmin: vi.fn(async (request: any, reply: any) => {
    if (!request.user?.isSuperAdmin) {
      return reply.status(403).send({ code: 0, msg: 'super admin required' });
    }
  }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: db.findUnique,
      findMany: db.findMany,
      upsert: db.upsert,
      create: db.create,
      update: db.update,
      deleteMany: db.deleteMany,
    },
    $transaction: db.transaction,
  },
}));

vi.mock('../lib/feature-flags.js', () => ({ invalidateFeatureCache: vi.fn() }));
vi.mock('../lib/maintenance.js', () => ({ invalidateMaintenanceCache: vi.fn() }));
vi.mock('../lib/audit-log.js', () => ({
  logAudit: audit,
  extractRequestMeta: vi.fn(() => ({})),
}));
vi.mock('../services/ai-usage.js', () => ({
  normalizeAiUsageDate: vi.fn(() => '2026-07-16'),
  createPrismaAiUsageStore: vi.fn(() => ({ getDailySummary: vi.fn() })),
}));

import { seedSystemConfig, systemConfigRoutes } from '../routes/system-config.js';

const PROTECTED_KEYS = [
  'source_ozon_publisher_collect_publish_stage',
  'source_ozon_publisher_listing_batch_stage',
  'source_ozon_publisher_listing_import_by_sku_stage',
  'source_ozon_publisher_browser_one_click_stage',
  'source_ozon_publisher_extension_adapter_stage',
] as const;

async function appFor(tokenUse: 'account_session' | 'legacy_extension' | undefined) {
  state.tokenUse = tokenUse;
  const app = Fastify();
  await app.register(systemConfigRoutes);
  return app;
}

describe('SystemConfig route mutation security', () => {
  beforeEach(() => {
    state.tokenUse = 'account_session';
    state.isSuperAdmin = true;
    state.rows.clear();
    vi.clearAllMocks();
  });

  it('does not update CAS-protected rollout rows while refreshing ordinary metadata', async () => {
    for (const key of PROTECTED_KEYS) {
      state.rows.set(key, {
        key,
        value: 'off',
        label: 'migration-owned label',
        group: 'source_workflow',
        description: 'migration-owned description',
      });
    }
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup',
      value: 'false',
      label: 'stale label',
      group: 'stale group',
      description: 'stale description',
    });

    await seedSystemConfig();

    const updatedKeys = db.update.mock.calls.map(([input]) => input.where.key as string);
    expect(updatedKeys).toContain('feature_announcement_popup');
    expect(updatedKeys).not.toEqual(expect.arrayContaining([...PROTECTED_KEYS]));
  });

  it('preserves the existing super-admin authorization check ahead of the session gate', async () => {
    state.isSuperAdmin = false;
    const app = await appFor('legacy_extension');

    const response = await app.inject({
      method: 'PUT',
      url: '/feature_announcement_popup',
      payload: { value: 'false' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 0, msg: 'super admin required' });
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ['legacy_extension' as const, undefined],
    [undefined, 'Bearer accepted-untyped-legacy-token'],
  ])('requires a typed live account session for every mutation endpoint (%s)', async (tokenUse, authorization) => {
    const app = await appFor(tokenUse);
    const requests = [
      { method: 'PUT' as const, url: '/batch', payload: { items: [{ key: 'feature_announcement_popup', value: 'false' }] } },
      { method: 'PUT' as const, url: '/feature_announcement_popup', payload: { value: 'false' } },
      { method: 'POST' as const, url: '/', payload: { key: 'feature_announcement_popup', value: 'false' } },
      { method: 'DELETE' as const, url: '/feature_announcement_popup' },
      { method: 'POST' as const, url: '/seed' },
    ];

    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: authorization ? { authorization } : undefined,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'system_config_account_session_required',
      });
    }

    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('keeps protected rollout stages readable to generic super-admin credentials', async () => {
    state.rows.set(PROTECTED_KEYS[0], { key: PROTECTED_KEYS[0], value: 'off' });
    const app = await appFor('legacy_extension');

    const response = await app.inject({ method: 'GET', url: `/${PROTECTED_KEYS[0]}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { key: PROTECTED_KEYS[0], value: 'off' } });
    await app.close();
  });

  it.each(PROTECTED_KEYS)('rejects generic single-key updates for protected stage %s', async (key) => {
    const app = await appFor('account_session');

    const response = await app.inject({ method: 'PUT', url: `/${key}`, payload: { value: 'shadow' } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_rollout_stage_cas_required',
    });
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a batch containing a protected stage atomically', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'feature_announcement_popup', value: 'false' },
          { key: PROTECTED_KEYS[1], value: 'shadow' },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_rollout_stage_cas_required',
    });
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    { method: 'POST' as const, url: '/', payload: { key: PROTECTED_KEYS[2], value: 'v2' } },
    { method: 'DELETE' as const, url: `/${PROTECTED_KEYS[3]}` },
  ])('rejects protected stage mutations through $method $url', async (request) => {
    const app = await appFor('account_session');

    const response = await app.inject(request);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_rollout_stage_cas_required',
    });
    expect(db.findUnique).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
    expect(db.deleteMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows an account session to update non-protected configuration', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/feature_announcement_popup',
      payload: { value: 'false' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { key: 'feature_announcement_popup', value: 'false' },
    });
    expect(db.upsert).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledOnce();
    await app.close();
  });
});
