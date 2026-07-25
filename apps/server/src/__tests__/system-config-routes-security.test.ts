import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tokenUse: 'account_session' as 'account_session' | 'legacy_extension' | undefined,
  isSuperAdmin: true,
  rows: new Map<string, Record<string, unknown>>(),
}));

const db = vi.hoisted(() => {
  type Row = Record<string, any>;
  type Rows = Map<string, Row>;

  const cloneRows = (source: Rows): Rows => new Map(
    [...source].map(([key, value]) => [key, { ...value }]),
  );
  const normalized = (row: Row): Row => ({ revision: 0, ...row });
  const rowsMatching = (rows: Rows, where: any): Row[] => [...rows.values()]
    .map(normalized)
    .filter((row) => {
      if (typeof where?.key === 'string' && row.key !== where.key) return false;
      if (Array.isArray(where?.key?.in) && !where.key.in.includes(row.key)) return false;
      if (typeof where?.revision === 'number' && row.revision !== where.revision) return false;
      return true;
    });
  const selectFields = (row: Row, select: Record<string, boolean> | undefined): Row => {
    if (!select) return row;
    return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
  };

  const findUnique = vi.fn(async ({ where, select }: any, rows: Rows = state.rows) => {
    const row = rows.get(where.key);
    return row ? selectFields(normalized(row), select) : null;
  });
  const findMany = vi.fn(async ({ where, select }: any = {}, rows: Rows = state.rows) => (
    rowsMatching(rows, where).map((row) => selectFields(row, select))
  ));
  const upsert = vi.fn(async ({ where, create, update }: any, rows: Rows = state.rows) => {
    const current = rows.get(where.key);
    const row = normalized({ ...(current ? current : create), ...(current ? update : {}), key: where.key });
    rows.set(where.key, row);
    return row;
  });
  const create = vi.fn(async ({ data }: any, rows: Rows = state.rows) => {
    if (rows.has(data.key)) {
      throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
    }
    const row = normalized(data);
    rows.set(data.key, row);
    return row;
  });
  const update = vi.fn(async ({ where, data }: any, rows: Rows = state.rows) => {
    const current = normalized(rows.get(where.key) ?? { key: where.key });
    const revision = typeof data.revision?.increment === 'number'
      ? current.revision + data.revision.increment
      : data.revision ?? current.revision;
    const row = { ...current, ...data, revision };
    rows.set(where.key, row);
    return row;
  });
  const updateMany = vi.fn(async ({ where, data }: any, rows: Rows = state.rows) => {
    const current = rowsMatching(rows, where)[0];
    if (!current) return { count: 0 };
    const revision = typeof data.revision?.increment === 'number'
      ? current.revision + data.revision.increment
      : data.revision ?? current.revision;
    rows.set(current.key, { ...current, ...data, revision });
    return { count: 1 };
  });
  const deleteMany = vi.fn(async ({ where }: any, rows: Rows = state.rows) => {
    const matches = rowsMatching(rows, where);
    matches.forEach((row) => rows.delete(row.key));
    return { count: matches.length };
  });
  const transaction = vi.fn(async (operation: any) => {
    if (Array.isArray(operation)) return Promise.all(operation);
    const snapshot = cloneRows(state.rows);
    const tx = {
      systemConfig: {
        findUnique: (args: any) => findUnique(args, snapshot),
        findMany: (args: any) => findMany(args, snapshot),
        upsert: (args: any) => upsert(args, snapshot),
        create: (args: any) => create(args, snapshot),
        update: (args: any) => update(args, snapshot),
        updateMany: (args: any) => updateMany(args, snapshot),
        deleteMany: (args: any) => deleteMany(args, snapshot),
      },
    };
    const result = await operation(tx);
    state.rows.clear();
    for (const [key, value] of snapshot) state.rows.set(key, value);
    return result;
  });

  return {
    findUnique,
    findMany,
    upsert,
    create,
    update,
    updateMany,
    deleteMany,
    transaction,
  };
});

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
      updateMany: db.updateMany,
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
    vi.stubEnv('RUNTIME_MODE', 'local');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', '');
    vi.stubEnv('FEATURE_TURNSTILE_LOGIN', '');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', '');
    vi.stubEnv('TURNSTILE_SITE_KEY', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
    vi.stubEnv('SMS_PROVIDER', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('seeds cloud auth switches off without overwriting an existing value or revision', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('feature_sms_register', {
      key: 'feature_sms_register',
      value: 'true',
      revision: 7,
      label: 'stale label',
      group: 'auth',
      description: 'stale description',
    });

    await seedSystemConfig();

    expect(state.rows.get('feature_sms_register')).toMatchObject({ value: 'true', revision: 7 });
    expect(state.rows.get('feature_turnstile_login')).toMatchObject({ value: 'false', revision: 0 });
  });

  it('preserves the existing super-admin authorization check ahead of the session gate', async () => {
    state.isSuperAdmin = false;
    const app = await appFor('legacy_extension');

    const response = await app.inject({
      method: 'PUT',
      url: '/feature_announcement_popup',
      payload: { value: 'false', expectedRevision: 0 },
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
      { method: 'PUT' as const, url: '/batch', payload: { items: [{ key: 'feature_announcement_popup', value: 'false', expectedRevision: 0 }] } },
      { method: 'PUT' as const, url: '/feature_announcement_popup', payload: { value: 'false', expectedRevision: 0 } },
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
          { key: 'feature_announcement_popup', value: 'false', expectedRevision: 0 },
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
      payload: { value: 'false', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { key: 'feature_announcement_popup', value: 'false', revision: 1 },
    });
    expect(state.rows.get('feature_announcement_popup')?.revision).toBe(1);
    expect(db.create).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects a stale single-key revision without overwriting the current value', async () => {
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup',
      value: 'true',
      revision: 2,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/feature_announcement_popup',
      payload: { value: 'false', expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_revision_conflict',
    });
    expect(state.rows.get('feature_announcement_popup')).toMatchObject({
      value: 'true',
      revision: 2,
    });
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rolls back every batch item when one expected revision is stale', async () => {
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup', value: 'true', revision: 2,
    });
    state.rows.set('auth_sms_daily_global_limit', {
      key: 'auth_sms_daily_global_limit', value: '1000', revision: 4,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'feature_announcement_popup', value: 'false', expectedRevision: 2 },
          { key: 'auth_sms_daily_global_limit', value: '900', expectedRevision: 3 },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_revision_conflict',
    });
    expect(state.rows.get('feature_announcement_popup')).toMatchObject({ value: 'true', revision: 2 });
    expect(state.rows.get('auth_sms_daily_global_limit')).toMatchObject({ value: '1000', revision: 4 });
    expect(db.create).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rolls back an earlier batch write when a later conditional update loses a race', async () => {
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup', value: 'true', revision: 2,
    });
    state.rows.set('auth_sms_daily_global_limit', {
      key: 'auth_sms_daily_global_limit', value: '1000', revision: 4,
    });
    const defaultUpdateMany = db.updateMany.getMockImplementation();
    if (!defaultUpdateMany) throw new Error('updateMany mock implementation missing');
    db.updateMany
      .mockImplementationOnce(defaultUpdateMany)
      .mockResolvedValueOnce({ count: 0 });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'feature_announcement_popup', value: 'false', expectedRevision: 2 },
          { key: 'auth_sms_daily_global_limit', value: '900', expectedRevision: 4 },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'system_config_revision_conflict' });
    expect(db.updateMany).toHaveBeenCalledTimes(2);
    expect(state.rows.get('feature_announcement_popup')).toMatchObject({ value: 'true', revision: 2 });
    expect(state.rows.get('auth_sms_daily_global_limit')).toMatchObject({ value: '1000', revision: 4 });
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {
      method: 'POST' as const,
      url: '/',
      payload: { key: 'feature_announcement_popup', value: 'false', expectedRevision: 1 },
    },
    {
      method: 'DELETE' as const,
      url: '/feature_announcement_popup',
      payload: { expectedRevision: 1 },
    },
  ])('rejects a stale revision for generic $method without mutating the row', async (request) => {
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup', value: 'true', revision: 2,
    });
    const app = await appFor('account_session');

    const response = await app.inject(request);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'system_config_revision_conflict' });
    expect(state.rows.get('feature_announcement_popup')).toMatchObject({ value: 'true', revision: 2 });
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('deletes a row only at the matching revision', async () => {
    state.rows.set('feature_announcement_popup', {
      key: 'feature_announcement_popup', value: 'true', revision: 2,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'DELETE',
      url: '/feature_announcement_popup',
      payload: { expectedRevision: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.has('feature_announcement_popup')).toBe(false);
    expect(audit).toHaveBeenCalledOnce();
    await app.close();
  });

  it.each([
    { method: 'PUT' as const, url: '/feature_announcement_popup', payload: { value: 'false' } },
    {
      method: 'PUT' as const,
      url: '/batch',
      payload: { items: [{ key: 'feature_announcement_popup', value: 'false' }] },
    },
    { method: 'POST' as const, url: '/', payload: { key: 'feature_announcement_popup', value: 'false' } },
    { method: 'DELETE' as const, url: '/feature_announcement_popup', payload: {} },
  ])('requires expectedRevision for $method $url', async (request) => {
    const app = await appFor('account_session');

    const response = await app.inject(request);

    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_revision_required',
    });
    expect(db.transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a masked secret when the source row no longer exists', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_sms_tencent_secret_key',
      payload: { value: 'old1***last', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_revision_conflict',
    });
    expect(state.rows.has('auth_sms_tencent_secret_key')).toBe(false);
    expect(db.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects raw encrypted-form input for sensitive settings', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_sms_tencent_secret_key',
      payload: { value: 'enc:v1:not-a-user-input', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, errorCode: 'system_config_invalid_value' });
    expect(db.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('never persists a stale masked secret placeholder as the new credential', async () => {
    state.rows.set('auth_sms_tencent_secret_key', {
      key: 'auth_sms_tencent_secret_key',
      value: 'current-secret-value-5678',
      revision: 5,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_sms_tencent_secret_key',
      payload: { value: 'old1***last', expectedRevision: 4 },
    });

    expect(response.statusCode).toBe(200);
    const { decryptConfigValue } = await import('../config/system-config-schema.js');
    expect(decryptConfigValue(
      'auth_sms_tencent_secret_key',
      String(state.rows.get('auth_sms_tencent_secret_key')?.value),
    )).toBe('current-secret-value-5678');
    expect(state.rows.get('auth_sms_tencent_secret_key')?.revision).toBe(5);
    expect(JSON.stringify(response.json())).not.toContain('old1***last');
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects rebinding a masked AI image secret to a different endpoint', async () => {
    state.rows.set('ai_image_provider', {
      key: 'ai_image_provider', value: 'custom', revision: 2,
    });
    state.rows.set('ai_image_base_url', {
      key: 'ai_image_base_url', value: 'https://old-relay.example/v1', revision: 3,
    });
    state.rows.set('ai_image_api_key', {
      key: 'ai_image_api_key', value: 'sk-saved-provider-key', revision: 4,
    });
    state.rows.set('ai_image_model', {
      key: 'ai_image_model', value: 'image-model-v2', revision: 1,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'ai_image_provider', value: 'custom', expectedRevision: 2 },
          { key: 'ai_image_base_url', value: 'https://new-relay.example/v1', expectedRevision: 3 },
          { key: 'ai_image_api_key', value: 'sk-s***-key', expectedRevision: 4 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: 'system_config_ai_image_api_key_reentry_required',
    });
    expect(state.rows.get('ai_image_base_url')?.value).toBe('https://old-relay.example/v1');
    expect(state.rows.get('ai_image_api_key')?.value).toBe('sk-saved-provider-key');
    await app.close();
  });

  it('allows correcting only the compatible Provider label without re-entering the secret', async () => {
    state.rows.set('ai_image_provider', {
      key: 'ai_image_provider', value: 'openai-images', revision: 2,
    });
    state.rows.set('ai_image_base_url', {
      key: 'ai_image_base_url', value: 'https://relay.example/v1', revision: 3,
    });
    state.rows.set('ai_image_api_key', {
      key: 'ai_image_api_key', value: 'sk-saved-provider-key', revision: 4,
    });
    state.rows.set('ai_image_model', {
      key: 'ai_image_model', value: 'image-model-v2', revision: 1,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'ai_image_provider', value: 'custom', expectedRevision: 2 },
          { key: 'ai_image_base_url', value: 'https://relay.example/v1', expectedRevision: 3 },
          { key: 'ai_image_api_key', value: 'sk-s***-key', expectedRevision: 4 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('ai_image_provider')?.value).toBe('custom');
    const { decryptConfigValue } = await import('../config/system-config-schema.js');
    expect(decryptConfigValue(
      'ai_image_api_key',
      String(state.rows.get('ai_image_api_key')?.value),
    )).toBe('sk-saved-provider-key');
    await app.close();
  });

  it('rejects a third-party endpoint labeled as official OpenAI', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'ai_image_provider', value: 'openai-images', expectedRevision: 0 },
          { key: 'ai_image_base_url', value: 'https://relay.example/v1', expectedRevision: 0 },
          { key: 'ai_image_api_key', value: 'sk-new-provider-key', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: 'system_config_ai_image_provider_endpoint_mismatch',
    });
    expect(state.rows.has('ai_image_provider')).toBe(false);
    await app.close();
  });

  it('rejects a custom Provider without an explicit Base URL', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'ai_image_provider', value: 'custom', expectedRevision: 0 },
          { key: 'ai_image_base_url', value: '', expectedRevision: 0 },
          { key: 'ai_image_api_key', value: 'sk-new-provider-key', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: 'system_config_ai_image_provider_endpoint_mismatch',
    });
    expect(state.rows.has('ai_image_provider')).toBe(false);
    await app.close();
  });

  it('rejects an active AI image model with surrounding whitespace', async () => {
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'ai_image_provider', value: 'custom', expectedRevision: 0 },
          { key: 'ai_image_base_url', value: 'https://relay.example/v1', expectedRevision: 0 },
          { key: 'ai_image_api_key', value: 'sk-new-provider-key', expectedRevision: 0 },
          { key: 'ai_image_model', value: ' gpt-image-1 ', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: 'system_config_ai_image_model_invalid',
    });
    expect(state.rows.has('ai_image_provider')).toBe(false);
    await app.close();
  });

  it('fails closed when an active Turnstile secret cannot be decrypted', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'cloudflare-turnstile', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'false', revision: 0,
    });
    state.rows.set('auth_turnstile_site_key', {
      key: 'auth_turnstile_site_key', value: 'site-key', revision: 1,
    });
    state.rows.set('auth_turnstile_secret_key', {
      key: 'auth_turnstile_secret_key', value: 'enc:v1:broken', revision: 3,
    });
    state.rows.set('auth_turnstile_allowed_hostnames', {
      key: 'auth_turnstile_allowed_hostnames', value: 'app.ss-erp.com', revision: 0,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_turnstile_site_key',
      payload: { value: 'new-site-key', expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_human_challenge_not_ready',
    });
    expect(state.rows.get('auth_turnstile_site_key')).toMatchObject({ value: 'site-key', revision: 1 });
    expect(db.updateMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows active Turnstile updates when a valid environment secret overrides unreadable DB ciphertext', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'environment-secret');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'cloudflare-turnstile', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'false', revision: 0,
    });
    state.rows.set('auth_turnstile_site_key', {
      key: 'auth_turnstile_site_key', value: 'site-key', revision: 1,
    });
    state.rows.set('auth_turnstile_secret_key', {
      key: 'auth_turnstile_secret_key', value: 'enc:v1:broken', revision: 3,
    });
    state.rows.set('auth_turnstile_allowed_hostnames', {
      key: 'auth_turnstile_allowed_hostnames', value: 'app.ss-erp.com', revision: 0,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_turnstile_site_key',
      payload: { value: 'new-site-key', expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('auth_turnstile_site_key')).toMatchObject({ value: 'new-site-key', revision: 2 });
    await app.close();
  });

  it('allows active PoW updates when a 32-character environment secret overrides unreadable DB ciphertext', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', 'environment-secret-at-least-32-characters-long');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'builtin-pow', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'false', revision: 0,
    });
    state.rows.set('auth_pow_signing_secret', {
      key: 'auth_pow_signing_secret', value: 'enc:v1:broken', revision: 3,
    });
    state.rows.set('auth_pow_difficulty', {
      key: 'auth_pow_difficulty', value: '4', revision: 1,
    });
    state.rows.set('auth_pow_ttl_seconds', {
      key: 'auth_pow_ttl_seconds', value: '120', revision: 1,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_pow_difficulty',
      payload: { value: '5', expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('auth_pow_difficulty')).toMatchObject({ value: '5', revision: 2 });
    await app.close();
  });

  it('does not treat a short PoW environment secret as a valid override', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', 'too-short');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'builtin-pow', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'false', revision: 0,
    });
    state.rows.set('auth_pow_signing_secret', {
      key: 'auth_pow_signing_secret', value: 'enc:v1:broken', revision: 3,
    });
    state.rows.set('auth_pow_difficulty', {
      key: 'auth_pow_difficulty', value: '4', revision: 1,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_pow_difficulty',
      payload: { value: '5', expectedRevision: 1 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_human_challenge_not_ready',
    });
    expect(state.rows.get('auth_pow_difficulty')).toMatchObject({ value: '4', revision: 1 });
    await app.close();
  });

  it('allows an explicit plaintext repair of an active malformed Turnstile secret', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'cloudflare-turnstile', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'false', revision: 0,
    });
    state.rows.set('auth_turnstile_site_key', {
      key: 'auth_turnstile_site_key', value: 'site-key', revision: 1,
    });
    state.rows.set('auth_turnstile_secret_key', {
      key: 'auth_turnstile_secret_key', value: 'enc:v1:broken', revision: 3,
    });
    state.rows.set('auth_turnstile_allowed_hostnames', {
      key: 'auth_turnstile_allowed_hostnames', value: 'app.ss-erp.com', revision: 0,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_turnstile_secret_key',
      payload: { value: 'replacement-secret', expectedRevision: 3 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { revision: 4 } });
    const { decryptConfigValueStrict } = await import('../config/system-config-schema.js');
    expect(decryptConfigValueStrict(
      'auth_turnstile_secret_key',
      String(state.rows.get('auth_turnstile_secret_key')?.value),
    )).toBe('replacement-secret');
    await app.close();
  });

  it('allows disabling human challenge while the active secret is unreadable', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', {
      key: 'auth_human_challenge_provider', value: 'cloudflare-turnstile', revision: 2,
    });
    state.rows.set('feature_turnstile_login', {
      key: 'feature_turnstile_login', value: 'true', revision: 1,
    });
    state.rows.set('auth_turnstile_secret_key', {
      key: 'auth_turnstile_secret_key', value: 'enc:v1:broken', revision: 3,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_human_challenge_provider', value: 'disabled', expectedRevision: 2 },
          { key: 'feature_turnstile_login', value: 'false', expectedRevision: 1 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('auth_human_challenge_provider')).toMatchObject({ value: 'disabled', revision: 3 });
    expect(state.rows.get('feature_turnstile_login')).toMatchObject({ value: 'false', revision: 2 });
    await app.close();
  });

  it('allows turning off all SMS features while the active provider secret is unreadable', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_sms_provider', { key: 'auth_sms_provider', value: 'aliyun', revision: 2 });
    state.rows.set('feature_sms_register', { key: 'feature_sms_register', value: 'true', revision: 1 });
    state.rows.set('feature_sms_login', { key: 'feature_sms_login', value: 'true', revision: 1 });
    state.rows.set('auth_sms_aliyun_access_key_secret', {
      key: 'auth_sms_aliyun_access_key_secret', value: 'enc:v1:broken', revision: 4,
    });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'feature_sms_register', value: 'false', expectedRevision: 1 },
          { key: 'feature_sms_login', value: 'false', expectedRevision: 1 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('feature_sms_register')).toMatchObject({ value: 'false', revision: 2 });
    expect(state.rows.get('feature_sms_login')).toMatchObject({ value: 'false', revision: 2 });
    await app.close();
  });

  it('rejects an unready builtin PoW activation inside the batch transaction', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', { key: 'auth_human_challenge_provider', value: 'disabled' });
    state.rows.set('feature_turnstile_login', { key: 'feature_turnstile_login', value: 'false' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_human_challenge_provider', value: 'builtin-pow', expectedRevision: 0 },
          { key: 'feature_announcement_popup', value: 'false', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_human_challenge_not_ready',
    });
    expect(response.json().msg).toMatch(/32/);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.create).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(state.rows.get('auth_human_challenge_provider')?.value).toBe('disabled');
    await app.close();
  });

  it('rejects a Turnstile activation without keys and hostname allowlist', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', { key: 'auth_human_challenge_provider', value: 'disabled' });
    state.rows.set('feature_turnstile_login', { key: 'feature_turnstile_login', value: 'false' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_human_challenge_provider',
      payload: { value: 'cloudflare-turnstile', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_human_challenge_not_ready',
    });
    expect(response.json().msg).toMatch(/Site Key|Secret Key|hostname/);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(state.rows.get('auth_human_challenge_provider')?.value).toBe('disabled');
    await app.close();
  });

  it('rejects an Aliyun activation when the required SMS fields are absent', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_sms_provider', { key: 'auth_sms_provider', value: 'env' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_sms_provider',
      payload: { value: 'aliyun', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_sms_provider_not_ready',
    });
    expect(response.json().msg).toMatch(/阿里云/);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(state.rows.get('auth_sms_provider')?.value).toBe('env');
    await app.close();
  });

  it('rejects a Tencent activation when the required SMS fields are absent', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_sms_provider', { key: 'auth_sms_provider', value: 'env' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_sms_provider',
      payload: { value: 'tencent', expectedRevision: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_sms_provider_not_ready',
    });
    expect(response.json().msg).toMatch(/腾讯云/);
    expect(db.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(state.rows.get('auth_sms_provider')?.value).toBe('env');
    await app.close();
  });

  it('allows disabling SMS challenges even when the selected provider is not ready', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_sms_provider', { key: 'auth_sms_provider', value: 'env' });
    state.rows.set('feature_sms_register', { key: 'feature_sms_register', value: 'true' });
    state.rows.set('feature_sms_login', { key: 'feature_sms_login', value: 'true' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'feature_sms_register', value: 'false', expectedRevision: 0 },
          { key: 'feature_sms_login', value: 'false', expectedRevision: 0 },
          { key: 'auth_sms_daily_global_limit', value: '900', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(state.rows.get('feature_sms_register')?.value).toBe('false');
    expect(state.rows.get('feature_sms_login')?.value).toBe('false');
    expect(state.rows.get('auth_sms_daily_global_limit')?.value).toBe('900');
    await app.close();
  });

  it('rejects an invalid Turnstile hostname even when both keys are present', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', { key: 'auth_human_challenge_provider', value: 'disabled' });
    state.rows.set('auth_turnstile_site_key', { key: 'auth_turnstile_site_key', value: 'site-key' });
    state.rows.set('auth_turnstile_secret_key', { key: 'auth_turnstile_secret_key', value: 'secret-key' });
    state.rows.set('auth_turnstile_allowed_hostnames', { key: 'auth_turnstile_allowed_hostnames', value: 'https://app.ss-erp.com' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_human_challenge_provider', value: 'cloudflare-turnstile', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'system_config_human_challenge_not_ready',
    });
    expect(response.json().msg).toMatch(/hostname/);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(db.create).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(state.rows.get('auth_human_challenge_provider')?.value).toBe('disabled');
    await app.close();
  });

  it('allows saving inactive PoW credentials before switching away from the current Turnstile selection', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_human_challenge_provider', { key: 'auth_human_challenge_provider', value: 'disabled' });
    state.rows.set('feature_turnstile_login', { key: 'feature_turnstile_login', value: 'true' });
    const app = await appFor('account_session');

    const credentials = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_pow_signing_secret', value: 'a-secure-pow-secret-with-at-least-32-characters', expectedRevision: 0 },
          { key: 'auth_pow_difficulty', value: '4', expectedRevision: 0 },
          { key: 'auth_pow_ttl_seconds', value: '120', expectedRevision: 0 },
        ],
      },
    });
    expect(credentials.statusCode).toBe(200);

    const activation = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_human_challenge_provider', value: 'builtin-pow', expectedRevision: 0 },
          { key: 'feature_turnstile_login', value: 'false', expectedRevision: 0 },
        ],
      },
    });
    expect(activation.statusCode).toBe(200);
    expect(state.rows.get('auth_human_challenge_provider')?.value).toBe('builtin-pow');
    await app.close();
  });

  it('rejects non-numeric PoW environment overrides before activation', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('HUMAN_CHALLENGE_POW_DIFFICULTY', 'not-a-number');
    state.rows.set('auth_human_challenge_provider', { key: 'auth_human_challenge_provider', value: 'disabled' });
    state.rows.set('feature_turnstile_login', { key: 'feature_turnstile_login', value: 'false' });
    state.rows.set('auth_pow_signing_secret', { key: 'auth_pow_signing_secret', value: 'a-secure-pow-secret-with-at-least-32-characters' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/auth_human_challenge_provider',
      payload: { value: 'builtin-pow', expectedRevision: 0 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().msg).toMatch(/难度/);
    expect(state.rows.get('auth_human_challenge_provider')?.value).toBe('disabled');
    await app.close();
  });

  it('accepts an atomic provider activation when all candidate credentials are present', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    state.rows.set('auth_sms_provider', { key: 'auth_sms_provider', value: 'env' });
    state.rows.set('feature_sms_register', { key: 'feature_sms_register', value: 'true' });
    state.rows.set('feature_sms_login', { key: 'feature_sms_login', value: 'false' });
    const app = await appFor('account_session');

    const response = await app.inject({
      method: 'PUT',
      url: '/batch',
      payload: {
        items: [
          { key: 'auth_sms_provider', value: 'aliyun', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_credential_mode', value: 'access_key', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_access_key_id', value: 'akid', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_access_key_secret', value: 'aksecret', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_sign_name', value: 'SS ERP', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_register_template_code', value: 'SMS_REGISTER', expectedRevision: 0 },
          { key: 'auth_sms_aliyun_password_reset_template_code', value: 'SMS_RESET', expectedRevision: 0 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(state.rows.get('auth_sms_provider')?.value).toBe('aliyun');
    expect(audit).toHaveBeenCalledTimes(7);
    await app.close();
  });
});
