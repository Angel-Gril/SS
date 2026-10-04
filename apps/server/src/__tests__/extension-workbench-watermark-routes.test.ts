import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionWorkbenchWatermarkRoutes } from '../routes/extension-workbench-watermark.js';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';

const request = { contractVersion: 'extension-workbench-watermark/v1', snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop',
  listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1,
  items: [{ skuKey: 'sku', slotKey: 'sku:sku:hero', sourceMediaKey: 'source' }],
  config: { type: 'text', text: 'My Shop', position: 'bottom-right', opacity: 60 } };
async function fixture(overrides: { scope?: string[]; enabled?: boolean; revisionMismatch?: boolean } = {}) {
  const app = Fastify(); const preview = vi.fn(async () => ({ previewHash: 'a'.repeat(64), items: [] })) as never;
  const apply = vi.fn(async () => ({})) as never;
  const templates = vi.fn(async () => ({ contractVersion: 'extension-workbench-watermark/v1', templates: [] })) as never;
  await app.register(extensionWorkbenchWatermarkRoutes, { service: { preview, apply, templates },
    authenticateDevice: async req => { (req as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'session',
      scopes: overrides.scope || ['listing:write', 'media:execute'], allowedShopIds: ['shop'] }; },
    featureFlags: { evaluate: async feature => ({ enabled: overrides.enabled !== false, legacyAllowed: false,
      listingStage: 'v2_only', captureStage: null, reason: 'pilot_match', revision: overrides.revisionMismatch && feature === 'SOURCE_LISTING_WORKFLOW' ? 'other' : 'r1' }) } as SourceWorkflowFeatureFlagEvaluator });
  return { app, preview, apply, templates };
}
describe('extension workbench watermark routes', () => {
  it('lists image templates using the same exact device/draft binding and no-store policy', async () => {
    const f = await fixture(); const { items: _items, config: _config, ...binding } = request;
    const response = await f.app.inject({ method: 'POST', url: '/templates', payload: binding });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(f.templates).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner', sessionId: 'session' }), binding);
    await f.app.close();
  });
  it('accepts a template ID, not a caller image URL, for image watermark preview', async () => {
    const f = await fixture(); const input = { ...request, config: { type: 'image', templateId: 'logo', position: 'center', opacity: 50, scale: 25 } };
    const response = await f.app.inject({ method: 'POST', url: '/preview', payload: input });
    expect(response.statusCode).toBe(200); expect(f.preview).toHaveBeenCalledWith(expect.anything(), input);
    const rejected = await f.app.inject({ method: 'POST', url: '/preview', payload: { ...input, config: { ...input.config, imageUrl: 'https://foreign.example/logo.png' } } });
    expect(rejected.statusCode).toBe(400); expect(f.preview).toHaveBeenCalledTimes(1); await f.app.close();
  });
  it('passes only server-established device identity through no-store bounded routes', async () => {
    const f = await fixture(); const response = await f.app.inject({ method: 'POST', url: '/preview', payload: request });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(f.preview).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner', sessionId: 'session' }), request); await f.app.close();
  });
  it.each([{ enabled: false }, { revisionMismatch: true }])('keeps dark and incoherent rollout policies closed %o', async overrides => {
    const f = await fixture(overrides); const response = await f.app.inject({ method: 'POST', url: '/preview', payload: request });
    expect(response.statusCode).toBe(409); expect(f.preview).not.toHaveBeenCalled(); await f.app.close();
  });
  it('requires both existing scopes before invoking image processing', async () => {
    const f = await fixture({ scope: ['listing:write'] }); const response = await f.app.inject({ method: 'POST', url: '/preview', payload: request });
    expect(response.statusCode).toBe(403); expect(f.preview).not.toHaveBeenCalled(); await f.app.close();
  });
  it('rejects raw URLs or impersonation fields in the closed request', async () => {
    const f = await fixture(); const response = await f.app.inject({ method: 'POST', url: '/apply', payload: { ...request,
      ownerUserId: 'foreign', previewHash: 'a'.repeat(64), idempotencyKey: 'watermark-test-request', url: 'http://127.0.0.1/private' } });
    expect(response.statusCode).toBe(400); expect(f.apply).not.toHaveBeenCalled(); await f.app.close();
  });
});
