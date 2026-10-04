import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionSourceWorkbenchVideoRoutes } from '../routes/extension-source-workbench-video.js';
import { SourceListingVideoError } from '../services/source-listing-video.js';
import type { SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';

const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 2, draftVersion: 2 };
const input = { binding, skuKey: 'sku', mainUrl: 'https://cdn1.ozone.ru/s3/sc-temporary/video.mp4', richContentUrl: null, operationKey: 'video-operation-001' };
async function fixture(overrides: { scopes?: string[]; enabled?: boolean; revisionMismatch?: boolean; impersonation?: boolean } = {}) {
  const app = Fastify(); const read = vi.fn(async () => ({ binding, videoBindings: [] })) as any;
  const save = vi.fn(async () => ({ state: 'ready', binding, videoBindings: [], replayed: false })) as any;
  await app.register(extensionSourceWorkbenchVideoRoutes, { service: { read, save }, authenticateDevice: async request => {
    (request as any).device = { ownerUserId: 'owner', actorUserId: overrides.impersonation ? 'staff' : 'owner', sessionId: 'device',
      scopes: overrides.scopes || ['listing:review', 'listing:write', 'media:execute'], allowedShopIds: ['shop'] };
  }, featureFlags: { evaluate: async feature => ({ enabled: overrides.enabled !== false, legacyAllowed: false,
    listingStage: 'v2_only', captureStage: null, reason: 'pilot_match', revision: overrides.revisionMismatch && feature === 'SOURCE_LISTING_WORKFLOW' ? 'other' : 'r1' }) } as SourceWorkflowFeatureFlagEvaluator });
  return { app, read, save };
}
describe('device workbench official video routes', () => {
  it('reads only through server device context with no-store', async () => {
    const f = await fixture({ scopes: ['listing:review'] }); const response = await f.app.inject({ method: 'POST', url: '/read', payload: { binding } });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner', sessionId: 'device' }), { binding }); await f.app.close();
  });
  it('passes exact manual main/rich selections and operation key to save owner', async () => {
    const f = await fixture(); const response = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(response.statusCode).toBe(200); expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'device' }), input); await f.app.close();
  });
  it.each([{ enabled: false }, { revisionMismatch: true }])('keeps policy disabled or inconsistent %o closed', async options => {
    const f = await fixture(options); const response = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(response.statusCode).toBe(409); expect(f.save).not.toHaveBeenCalled(); await f.app.close();
  });
  it.each([{ scopes: ['listing:review'] }, { scopes: ['listing:review', 'listing:write'] }])('requires edit and media scopes %o', async ({ scopes }) => {
    const f = await fixture({ scopes }); const response = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(response.statusCode).toBe(403); expect(f.save).not.toHaveBeenCalled(); await f.app.close();
  });
  it('rejects account impersonation before service invocation', async () => {
    const f = await fixture({ impersonation: true }); const response = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(response.statusCode).toBe(401); expect(f.save).not.toHaveBeenCalled(); await f.app.close();
  });
  it('rejects caller identity, hash, approval and obsolete revision shape', async () => {
    const f = await fixture(); for (const payload of [{ ...input, ownerUserId: 'foreign' }, { ...input, approved: true },
      { ...input, binding: { ...binding, sourceCaptureHash: 'forged' } }, { ...input, binding: { ...binding, revision: 2 } }]) {
      expect((await f.app.inject({ method: 'POST', url: '/save', payload })).statusCode).toBe(400);
    }
    expect(f.save).not.toHaveBeenCalled(); await f.app.close();
  });
  it('preserves explicit unsupported-upload failure and redacts unexpected dependency failure', async () => {
    const f = await fixture(); f.save.mockRejectedValueOnce(new SourceListingVideoError('video_upload_required', 422, '先上传官方媒体'));
    const denied = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(denied.statusCode).toBe(422); expect(denied.json().errorCode).toBe('video_upload_required');
    f.save.mockRejectedValueOnce(new Error('private-key-and-cookie'));
    const failure = await f.app.inject({ method: 'POST', url: '/save', payload: input });
    expect(failure.statusCode).toBe(503); expect(failure.body).not.toContain('private-key'); await f.app.close();
  });
});
