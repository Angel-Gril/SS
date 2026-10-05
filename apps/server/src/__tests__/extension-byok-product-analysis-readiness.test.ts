import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionByokProductAnalysisReadinessRoutes } from '../routes/extension-byok-product-analysis-readiness.js';
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const body = { binding, providerOrigin: 'https://models.example.com', model: 'vision-model' };
async function harness(overrides: Record<string, unknown> = {}) {
  const app = Fastify();
  const getReadiness = vi.fn(async (context: import('../services/extension-byok-policy.js').ExtensionByokProductAnalysisContext) => ({ contractVersion: 'extension-byok-product-analysis-readiness/v1' as const,
    context, policyRevision: 4, mode: 'pilot' as const, maxConcurrency: 1, analysis: { enabled: true, ready: true, reasonCode: 'READY' as const } }));
  await app.register(extensionByokProductAnalysisReadinessRoutes, {
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner',
      sessionId: 'device', allowedShopIds: ['shop'], scopes: ['listing:review', 'media:execute'], ...overrides }; },
    loadDraft: async () => ({ id: 'draft', shopId: 'shop', sourceCaptureSnapshotId: 'snapshot', supplyGoodsId: 'goods',
      revision: 1, draftVersion: 1, stage: 'CATEGORY_REVIEW', runState: 'ACTIVE' }),
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'READY', listingStage: 'v2_only' }) },
    getReadiness,
  });
  return { app, getReadiness };
}
describe('device scoped BYOK analysis readiness', () => {
  it('uses authenticated device and bound draft rather than caller identity', async () => {
    const { app, getReadiness } = await harness();
    const response = await app.inject({ method: 'POST', url: '/product-analysis-readiness', payload: body });
    expect(response.statusCode).toBe(200);
    expect(getReadiness).toHaveBeenCalledWith({ ownerUserId: 'owner', shopId: 'shop', deviceSessionId: 'device',
      providerOrigin: body.providerOrigin, model: body.model });
    expect(response.json().data.analysis.ready).toBe(true);
    const spoofed = await app.inject({ method: 'POST', url: '/product-analysis-readiness', payload: { ...body, apiKey: 'forged' } });
    expect(spoofed.statusCode).toBe(400);
    await app.close();
  });
  it.each([{ allowedShopIds: ['other'] }, { actorUserId: 'other' }, { scopes: ['listing:review'] }])('denies out of scope devices', async (override) => {
    const { app, getReadiness } = await harness(override);
    const response = await app.inject({ method: 'POST', url: '/product-analysis-readiness', payload: body });
    expect(response.statusCode).toBe(403); expect(getReadiness).not.toHaveBeenCalled(); await app.close();
  });
  it('rejects stale draft revisions before returning an analysis permit', async () => {
    const { app, getReadiness } = await harness();
    const response = await app.inject({ method: 'POST', url: '/product-analysis-readiness', payload: { ...body, binding: { ...binding, draftRevision: 2 } } });
    expect(response.statusCode).toBe(409); expect(getReadiness).not.toHaveBeenCalled(); await app.close();
  });
});
