import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionErpSourceLaunchService,
  type ErpSourceLaunchGrantStore,
} from '../services/extension-erp-source-launch.js';

const now = new Date('2026-09-16T13:00:00.000Z');
const account = { ownerUserId: 'owner-a', actorUserId: 'owner-a', actorParentId: null, actorRole: 'ADMIN' };
const device = { ownerUserId: 'owner-a', actorUserId: 'owner-a', sessionId: 'device-a', deploymentId: 'com-production', allowedShopIds: ['shop-a'], scopes: ['listing:review', 'media:execute', 'listing:write'] };
const input = { deviceSessionId: 'device-a', shopId: 'shop-a', listingWorkflowId: 'draft-a', draftRevision: 7, draftVersion: 3, mode: 'WORKBENCH' as const, sourceMediaKeys: [], preferredSkuKey: '__ss_erp_product_only__' };
function setup() {
  const values = new Map<string, string>();
  const store: ErpSourceLaunchGrantStore = {
    put: vi.fn(async (key, value) => { if (values.has(key)) return false; values.set(key, value); return true; }),
    get: vi.fn(async key => values.get(key) ?? null),
    consume: vi.fn(async (key, expected) => { if (values.get(key) !== expected) return false; values.delete(key); return true; }),
  };
  const live = { sessionId: 'device-a', status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000), currentJti: 'jti-a', deploymentId: 'com-production', deviceId: 'browser-a', ownerUserId: 'owner-a', actorUserId: 'owner-a', scopes: [...device.scopes], ownerStatus: 'ACTIVE', actorStatus: 'ACTIVE', ownerRole: 'ADMIN', actorRole: 'ADMIN', actorParentId: null, shopGrants: [{ shopId: 'shop-a', status: 'ACTIVE' }] };
  const draft = { id: 'draft-a', ownerUserId: 'owner-a', shopId: 'shop-a', revision: 7, draftVersion: 3, supplyGoodsId: 'goods-a', sourceCaptureSnapshotId: 'snapshot-a', sourceCaptureCurrent: true, sourcePlatform: '1688', sourceProductId: 'qa-owned-source', selectedSkuKeys: ['__ss_erp_product_only__'], media: { assignments: [] }, stage: 'MEDIA_REVIEW', runState: 'ACTIVE' };
  const context = { id: draft.id, ownerUserId: draft.ownerUserId, shopId: draft.shopId, supplyGoodsId: draft.supplyGoodsId, snapshotId: draft.sourceCaptureSnapshotId, revision: draft.revision, draftVersion: draft.draftVersion, sourceMediaKeys: ['white-cup'] };
  const shop = { id: 'shop-a', userId: 'owner-a', platform: 'OZON', status: 'ACTIVE' };
  const dependencies = {
    store, apiOrigin: 'https://ss-erp.com', deploymentId: 'com-production',
    loadDevice: vi.fn(async () => live), loadDraft: vi.fn(async () => draft), loadShop: vi.fn(async () => shop),
    loadMediaContext: vi.fn(async () => context), isEnabled: vi.fn(async () => true),
    now: () => new Date(now), createToken: () => 'a'.repeat(43),
  };
  return { service: createExtensionErpSourceLaunchService(dependencies), dependencies, store, live, draft, context, shop, values };
}

describe('ERP account to paired-device source image launch', () => {
  it('rejects an insecure cloud API origin even when device and draft authority match', async () => {
    const f = setup();
    const service = createExtensionErpSourceLaunchService({ ...f.dependencies, apiOrigin: 'http://ss-erp.com' });
    await expect(service.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_UNAVAILABLE' });
    expect(f.store.put).not.toHaveBeenCalled();
  });
  it('rechecks shop ownership and active platform independently of an old device shop grant', async () => {
    for (const patch of [{ userId: 'owner-b' }, { platform: 'OTHER' }, { status: 'DISABLED' }]) {
      const f = setup(); Object.assign(f.shop, patch);
      await expect(f.service.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_FORBIDDEN' });
      expect(f.store.put).not.toHaveBeenCalled();
    }
  });
  it('issues an opaque short-lived grant and consumes it once for server-derived ERP_SOURCE context', async () => {
    const f = setup();
    const issued = await f.service.issue(account, input);
    expect(issued.provenance).toBe('ERP_SOURCE');
    expect(issued.expiresAt).toBe('2026-09-16T13:02:00.000Z');
    expect(JSON.stringify(issued)).not.toContain('owner-a');
    expect([...f.values.keys()][0]).not.toContain(issued.launchToken);
    const result = await f.service.consume(device, issued.launchToken);
    expect(result).toMatchObject({ provenance: 'ERP_SOURCE', ownerUserId: 'owner-a', deviceSessionId: 'device-a', mode: 'WORKBENCH', sourceMediaKeys: [], launchRequest: { sourcePlatform: '1688', sourceProductId: 'qa-owned-source', sourceCaptureSnapshotId: 'snapshot-a', supplyGoodsId: 'goods-a', shopId: 'shop-a', workflowId: 'draft-a', draftRevision: 7, draftVersion: 3 } });
    expect(result).not.toHaveProperty('launchToken');
    await expect(f.service.consume(device, issued.launchToken)).rejects.toMatchObject({ code: 'ERP_LAUNCH_GRANT_UNAVAILABLE' });
  });

  it('rejects Web owner B while the extension remains paired to owner A', async () => {
    const f = setup();
    await expect(f.service.issue({ ...account, ownerUserId: 'owner-b', actorUserId: 'owner-b' }, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_FORBIDDEN' });
    expect(f.store.put).not.toHaveBeenCalled();
  });

  it('rejects subaccounts, non-active devices, ungranted shops and missing device scopes', async () => {
    for (const change of [
      (f: ReturnType<typeof setup>) => { f.live.actorParentId = 'owner-a' as never; },
      (f: ReturnType<typeof setup>) => { f.live.status = 'REVOKED'; },
      (f: ReturnType<typeof setup>) => { f.live.ownerStatus = 'SUSPENDED'; },
      (f: ReturnType<typeof setup>) => { f.live.shopGrants = []; },
      (f: ReturnType<typeof setup>) => { f.live.scopes = ['listing:review']; },
      (f: ReturnType<typeof setup>) => { f.live.deploymentId = 'cn-production'; },
    ]) {
      const f = setup(); change(f);
      await expect(f.service.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_FORBIDDEN' });
      expect(f.store.put).not.toHaveBeenCalled();
    }
    const f = setup();
    await expect(f.service.issue({ ...account, actorUserId: 'child', actorParentId: 'owner-a' }, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_FORBIDDEN' });
  });

  it('rejects stale drafts, wrong owners/shops, stale captures and unowned selected source keys', async () => {
    for (const change of [
      (f: ReturnType<typeof setup>) => { f.draft.revision++; },
      (f: ReturnType<typeof setup>) => { f.draft.ownerUserId = 'owner-b'; },
      (f: ReturnType<typeof setup>) => { f.draft.shopId = 'shop-b'; },
      (f: ReturnType<typeof setup>) => { f.draft.sourceCaptureCurrent = false; },
      (f: ReturnType<typeof setup>) => { f.draft.runState = 'ARCHIVED'; },
      (f: ReturnType<typeof setup>) => { f.draft.stage = 'PUBLISHED'; },
    ]) {
      const f = setup(); change(f);
      await expect(f.service.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_CONTEXT_STALE' });
      expect(f.store.put).not.toHaveBeenCalled();
    }
    const f = setup();
    await expect(f.service.issue(account, { ...input, mode: 'INPAINT', sourceMediaKeys: ['foreign-media'] })).rejects.toMatchObject({ code: 'ERP_LAUNCH_CONTEXT_STALE' });
  });

  it('requires explicit feature readiness and never treats a missing gate as enabled', async () => {
    const f = setup(); f.dependencies.isEnabled.mockResolvedValue(false);
    await expect(f.service.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_DISABLED' });
    const unconfigured = createExtensionErpSourceLaunchService({ ...f.dependencies, isEnabled: undefined });
    await expect(unconfigured.issue(account, input)).rejects.toMatchObject({ code: 'ERP_LAUNCH_DISABLED' });
    expect(f.store.put).not.toHaveBeenCalled();
  });

  it('wrong device, owner and region cannot consume a grant or burn the legitimate launch', async () => {
    const f = setup(); const issued = await f.service.issue(account, input);
    for (const patch of [{ sessionId: 'other-device' }, { ownerUserId: 'owner-b', actorUserId: 'owner-b' }, { deploymentId: 'cn-production' }]) {
      await expect(f.service.consume({ ...device, ...patch }, issued.launchToken)).rejects.toMatchObject({ code: 'ERP_LAUNCH_FORBIDDEN' });
    }
    expect(f.store.consume).not.toHaveBeenCalled();
    await expect(f.service.consume(device, issued.launchToken)).resolves.toMatchObject({ provenance: 'ERP_SOURCE' });
  });

  it('rechecks current authority at consumption and refuses expired or disabled launches', async () => {
    for (const mutate of [
      (f: ReturnType<typeof setup>) => { f.draft.revision++; },
      (f: ReturnType<typeof setup>) => { f.live.status = 'REVOKED'; },
      (f: ReturnType<typeof setup>) => { f.dependencies.isEnabled.mockResolvedValue(false); },
    ]) {
      const f = setup(); const issued = await f.service.issue(account, input); mutate(f);
      await expect(f.service.consume(device, issued.launchToken)).rejects.toBeDefined();
      expect(f.store.consume).not.toHaveBeenCalled();
    }
    const f = setup(); const issued = await f.service.issue(account, input);
    const later = createExtensionErpSourceLaunchService({ ...f.dependencies, now: () => new Date(now.getTime() + 120_001) });
    await expect(later.consume(device, issued.launchToken)).rejects.toMatchObject({ code: 'ERP_LAUNCH_GRANT_UNAVAILABLE' });
  });

  it('allows only one winner when the same grant is consumed concurrently', async () => {
    const f = setup(); const issued = await f.service.issue(account, input);
    const results = await Promise.allSettled([f.service.consume(device, issued.launchToken), f.service.consume(device, issued.launchToken)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('binds the approved single-source INPAINT operation and discards client authority injection', async () => {
    const f = setup();
    await expect(f.service.issue(account, { ...input, ownerUserId: 'owner-b' })).rejects.toMatchObject({ code: 'ERP_LAUNCH_INVALID_REQUEST' });
    const issued = await f.service.issue(account, { ...input, mode: 'INPAINT', sourceMediaKeys: ['white-cup'] });
    await expect(f.service.consume(device, issued.launchToken)).resolves.toMatchObject({ mode: 'INPAINT', sourceMediaKeys: ['white-cup'] });
  });
});
