import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminExtensionRolloutRoutes } from '../routes/admin-extension-rollout.js';
import { ZodError } from 'zod';
import type { ExtensionRolloutAdminOptions } from '../services/extension-rollout-admin-options.js';
import { SOURCE_WORKFLOW_FEATURES } from '../services/source-workflow-feature-flags.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function createApp(identity: Record<string, unknown> | null = {
  role: 'ADMIN', isSuperAdmin: true, tokenUse: 'account_session',
}) {
  const app = Fastify();
  apps.push(app);
  const list = vi.fn(async (_query: unknown): Promise<ExtensionRolloutAdminOptions> => ({
    owners: [], shops: [], devices: [], features: SOURCE_WORKFLOW_FEATURES,
    unavailableOwnerUserIds: [], hasMore: { owners: false, shops: false, devices: false },
  }));
  await app.register(adminExtensionRolloutRoutes, {
    prefix: '/api/admin/extension-rollout', service: { list },
    authenticate: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!identity) return reply.status(401).send({ code: 0 });
      (request as any).user = identity;
    },
  });
  return { app, list };
}

describe('extension rollout admin options authorization', () => {
  it('serves options only to a super administrator account session and disables caching', async () => {
    const { app, list } = await createApp();
    const response = await app.inject('/api/admin/extension-rollout/options?search=shop&ownerUserIds=owner-a&limit=10');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ code: 1, data: { shops: [] } });
    expect(list).toHaveBeenCalledWith({ search: 'shop', ownerUserIds: 'owner-a', limit: '10' });
  });

  it.each([
    ['unauthenticated', null, 401],
    ['ordinary user', { role: 'USER', isSuperAdmin: false, tokenUse: 'account_session' }, 403],
    ['administrator', { role: 'ADMIN', isSuperAdmin: false, tokenUse: 'account_session' }, 403],
    ['legacy extension token', { role: 'ADMIN', isSuperAdmin: true, tokenUse: 'legacy_extension' }, 403],
  ])('rejects %s without querying options', async (_label, identity, status) => {
    const { app, list } = await createApp(identity);
    const response = await app.inject('/api/admin/extension-rollout/options');
    expect(response.statusCode).toBe(status);
    expect(list).not.toHaveBeenCalled();
  });

  it('maps owner validation failures to an uncached 400 response', async () => {
    const { app, list } = await createApp();
    list.mockRejectedValueOnce(new ZodError([{ code: 'custom', path: ['limit'], message: 'invalid' }]));
    const response = await app.inject('/api/admin/extension-rollout/options?limit=501');
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ code: 0, errorCode: 'extension_rollout_options_invalid_query' });
  });
});
