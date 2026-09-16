import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionErpSourceLaunchRoutes } from '../routes/extension-erp-source-launch.js';
import { ExtensionErpSourceLaunchError } from '../services/extension-erp-source-launch.js';

const body = { deviceSessionId: 'device-a', shopId: 'shop-a', listingWorkflowId: 'draft-a', draftRevision: 7, draftVersion: 3, mode: 'WORKBENCH', sourceMediaKeys: [], preferredSkuKey: '__ss_erp_product_only__' };
async function setup(authenticated = true) {
  const app = Fastify();
  const service = { issue: vi.fn(async () => ({ contractVersion: 'extension-erp-source-launch/v1' as const, provenance: 'ERP_SOURCE' as const, apiOrigin: 'https://ss-erp.com', launchToken: 'a'.repeat(43), expiresAt: '2026-09-16T13:02:00.000Z' })), consume: vi.fn(async () => ({ provenance: 'ERP_SOURCE' as const })) };
  await app.register(extensionErpSourceLaunchRoutes, {
    prefix: '/api/extension-device', service: service as never,
    authenticateAccount: async (request, reply) => {
      if (!authenticated) return reply.code(401).send({ code: 0 });
      (request as any).user = { userId: 'live-web-owner', actorUserId: 'live-web-owner', parentId: null, role: 'ADMIN' };
    },
    authenticateDevice: async (request, reply) => {
      if (!authenticated) return reply.code(401).send({ code: 0 });
      (request as any).device = { ownerUserId: 'paired-owner', actorUserId: 'paired-owner', sessionId: 'device-a', deploymentId: 'com-production', scopes: ['listing:review','media:execute'], allowedShopIds: ['shop-a'] };
    },
  });
  return { app, service };
}
describe('ERP source launch HTTP boundaries', () => {
  it('rejects a foreign browser Origin before issuing any launch grant', async () => {
    const { app, service } = await setup();
    const result = await app.inject({ method: 'POST', url: '/api/extension-device/erp-launch-grants', headers: { origin: 'https://foreign.example' }, payload: body });
    expect(result.statusCode).toBe(403); expect(service.issue).not.toHaveBeenCalled(); await app.close();
  });
  it('takes the issuing owner only from authenticated account context and marks the grant no-store', async () => {
    const { app, service } = await setup();
    const result = await app.inject({ method: 'POST', url: '/api/extension-device/erp-launch-grants', payload: body });
    expect(result.statusCode).toBe(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(service.issue).toHaveBeenCalledWith({ ownerUserId: 'live-web-owner', actorUserId: 'live-web-owner', actorParentId: null, actorRole: 'ADMIN' }, body);
    await app.close();
  });
  it('both issue and consume require their own authentication before reaching the owner', async () => {
    const { app, service } = await setup(false);
    for (const [path,payload] of [['erp-launch-grants',body],['erp-launch-grants/consume',{launchToken:'a'.repeat(43)}]] as const) {
      const result = await app.inject({ method:'POST',url:'/api/extension-device/'+path,payload });
      expect(result.statusCode).toBe(401);
    }
    expect(service.issue).not.toHaveBeenCalled(); expect(service.consume).not.toHaveBeenCalled(); await app.close();
  });
  it('rejects client owner, role and arbitrary URL/context fields rather than forwarding authority', async () => {
    const { app, service } = await setup();
    for (const patch of [{ownerUserId:'other-owner'},{role:'ADMIN'},{url:'https://example.invalid'},{context:{ownerUserId:'other'}}]) {
      expect((await app.inject({method:'POST',url:'/api/extension-device/erp-launch-grants',payload:{...body,...patch}})).statusCode).toBe(400);
    }
    expect(service.issue).not.toHaveBeenCalled(); await app.close();
  });
  it('consumes only the opaque grant using the live paired-device context', async () => {
    const { app, service } = await setup();
    const result = await app.inject({method:'POST',url:'/api/extension-device/erp-launch-grants/consume',payload:{launchToken:'a'.repeat(43)}});
    expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(service.consume).toHaveBeenCalledWith(expect.objectContaining({ownerUserId:'paired-owner',sessionId:'device-a'}),'a'.repeat(43));
    expect((await app.inject({method:'POST',url:'/api/extension-device/erp-launch-grants/consume',payload:{launchToken:'a'.repeat(43),ownerUserId:'live-web-owner'}})).statusCode).toBe(400);
    await app.close();
  });
  it('returns only bounded error codes and never echoes a grant or dependency error', async () => {
    const { app, service } = await setup();
    service.issue.mockRejectedValueOnce(new ExtensionErpSourceLaunchError('ERP_LAUNCH_FORBIDDEN',403));
    expect((await app.inject({method:'POST',url:'/api/extension-device/erp-launch-grants',payload:body})).statusCode).toBe(403);
    service.consume.mockRejectedValueOnce(new Error('synthetic-private-grant-value'));
    const result = await app.inject({method:'POST',url:'/api/extension-device/erp-launch-grants/consume',payload:{launchToken:'a'.repeat(43)}});
    expect(result.statusCode).toBe(503); expect(result.body).not.toContain('synthetic-private-grant-value');
    expect(result.body).not.toContain('a'.repeat(43)); await app.close();
  });
});
