import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildOzonStableServiceKey } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createExtensionListingLogisticsPricingService } from '../services/extension-listing-logistics-pricing.js';
import { extensionListingLogisticsPricingRoutes } from '../routes/extension-listing-logistics-pricing.js';

const now = new Date('2026-10-05T00:00:00.000Z');
const serviceKey = buildOzonStableServiceKey({ providerId: 'provider', description: 'parcel', templateType: 'global', weightType: 'weight', batteryMode: 'no-battery' });
const assignment = { assignmentId: 'assignment', shopId: 'shop', shopName: 'Current shop', companyId: 'company',
  warehouseId: 'warehouse', warehouseName: 'Warehouse', originCountryUid: 'china', originCityUid: 'xiamen', originLabel: 'Xiamen',
  destinationCountryUid: 'russia', destinationLocationUid: 'moscow', destinationLabel: 'Moscow', releaseSequence: 1, effectiveReleaseAvailable: true };
const selection = { assignmentId: assignment.assignmentId, companyId: assignment.companyId, warehouseId: assignment.warehouseId,
  originCountryUid: assignment.originCountryUid, originCityUid: assignment.originCityUid,
  destinationCountryUid: assignment.destinationCountryUid, destinationLocationUid: assignment.destinationLocationUid };
function effective() {
  const formula = { stableServiceKey: serviceKey, calculationRule: { ruleId: 'rule', serviceId: serviceKey, providerId: 'provider',
    displayName: 'Parcel', carrierName: 'Carrier', priority: 10, deliveryPromise: '10 days', conditionNote: '',
    conditions: { weightRangeG: [1, 20000], priceRangeCNY: ['0', '0'], priceRangeRUB: ['0', '0'],
      maxDimsCm: [100, 100, 100], longestSideCm: 100, battery: 'disallowed', chargeMode: 'actual', volumetricDivisor: 12000, volumeDivisorMm3: 0 },
    pricing: { type: 'linear', baseFee: '10', stepSize: 100, stepFee: '1', minBillableUnits: 0 } } };
  const scope = { deploymentId: 'deployment', schemaMajor: 1, tenantId: 'owner', shopId: 'shop', warehouseId: 'warehouse', ozonCompanyId: 'company',
    originCountryUid: 'china', originCityUid: 'xiamen', destinationCountryUid: 'russia', destinationLocationUid: 'moscow' };
  const revisionScope = { ...scope, apiOrigin: 'https://api.example.com', erpWarehouseId: scope.warehouseId, platformWarehouseId: 'platform-warehouse' };
  delete (revisionScope as { warehouseId?: string }).warehouseId;
  return { state: 'allowed' as const, assignmentId: 'assignment', scopeKey: 'bound-scope', releaseId: 'release', releaseSequence: 1,
    contentChecksum: 'a'.repeat(64), effectiveChecksum: 'b'.repeat(64), minExtensionVersion: '1.0.0', validUntil: '2026-10-06T00:00:00.000Z', staleUntil: '2026-10-07T00:00:00.000Z',
    bundle: { scope, assignment: { id: 'assignment', destinationCountryUid: 'russia', destinationLocationUid: 'moscow' }, deliveryMethodBindings: [{ stableServiceKey: serviceKey }],
      manifest: { minimumExtensionVersion: '1.0.0', selectedServiceKeys: [serviceKey], destination: { destinationCountryUid: 'russia', destinationLocationUid: 'moscow' } },
      revisionPayload: { scope: revisionScope,
        services: [{ stableServiceKey: serviceKey, providerId: 'provider', normalizedDescription: 'parcel', templateType: 'global', weightType: 'weight', batteryMode: 'no-battery', deliveryVariant: 'pickup' }],
        formulas: [formula], destinationEvidence: [{ stableServiceKey: serviceKey, destinationCountryUid: 'russia', destinationLocationUid: 'moscow' }],
        cityAvailabilityOverlays: [{ origin: { countryUid: 'china', cityUid: 'xiamen' }, destination: { countryUid: 'russia', locationUid: 'moscow' },
          services: [{ stableServiceKey: serviceKey, isDropOff: true, clusterDeliverySpeeds: [{ min: 10, max: 20, clusterName: 'Moscow' }] }] }] } } };
}

async function setup(scopes = ['listing:review', 'logistics:discover', 'logistics:read'], flags = true) {
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-a', 'sku-b'] });
  const packaged = await workflow.setSkuPackaging({ ownerUserId: 'owner', actorUserId: 'owner', draftId: draft.id,
    expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion, operationKey: 'package-fixture-1',
    items: [{ skuKey: 'sku-a', weightG: 500, lengthMm: 100, widthMm: 100, heightMm: 50 },
      { skuKey: 'sku-b', weightG: 101, lengthMm: 100, widthMm: 100, heightMm: 50 }], evidence: ['User confirmed packaging'] });
  const ownership = { assertOwnedTarget: vi.fn(async () => ({ shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-a', 'sku-b'] })) };
  const release = effective();
  const repository = {
    listAssignmentsForDevice: vi.fn(async () => [assignment, { ...assignment, assignmentId: 'foreign', shopId: 'other-shop' }]),
    getEffectiveReleaseForDevice: vi.fn(async () => release),
    authorizeEffectiveReleaseDelivery: vi.fn(async () => ({ state: 'allowed' as const, authorizationValidUntil: '2026-10-05T01:00:00.000Z' })),
  };
  const loadPricingHints = vi.fn(async () => ({ commission: null, fx: { rate: 0.09, source: 'open.er-api.com', fetchedAt: now.toISOString() } }));
  const service = createExtensionListingLogisticsPricingService({ workflow, ownership, repository, deploymentId: 'deployment', now: () => now, loadPricingHints });
  const app = Fastify();
  await app.register(extensionListingLogisticsPricingRoutes, { prefix: '/api/extension-device/source-workbench', service,
    featureFlags: { evaluate: async () => ({ enabled: flags, reason: flags ? 'pilot' : 'off', listingStage: 'dual_read' }) },
    authenticateDevice: async request => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'session', scopes, allowedShopIds: ['shop', 'other-shop'] }; } });
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id, draftRevision: packaged.revision, draftVersion: packaged.draftVersion };
  const items = [{ skuKey: 'sku-a', declaredPriceMinor: 10000, hasBattery: false }, { skuKey: 'sku-b', declaredPriceMinor: 10000, hasBattery: false }];
  return { app, workflow, ownership, repository, service, release, binding, items, loadPricingHints };
}
async function withSetup(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>, scopes?: string[], flags?: boolean) {
  const fixture = await setup(scopes, flags);
  try { await run(fixture); } finally { await fixture.app.close(); }
}
const path = (action: string) => `/api/extension-device/source-workbench/editor/logistics-${action}`;

describe('current draft logistics pricing', () => {
  it('discovers only the current draft shop and requires explicit scope selection', async () => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('scopes'), payload: { binding: f.binding } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ binding: f.binding, selectedSkuKeys: ['sku-a', 'sku-b'], assignments: [assignment], requiresSelection: true });
    expect(f.repository.listAssignmentsForDevice).toHaveBeenCalledWith({ sessionId: 'session', ownerUserId: 'owner', allowedShopIds: ['shop'] });
    expect(f.repository.getEffectiveReleaseForDevice).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toMatch(/tenantId|ownerUserId|bundle|apiKey/);
  }));

  it('lists only released, bound services for the exact user-selected route', async () => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ binding: f.binding, selection, releaseId: 'release', releaseSequence: 1,
      services: [{ stableServiceKey: serviceKey, displayName: 'Parcel', deliveryVariant: 'pickup' }], requiresSelection: true });
    expect(f.repository.authorizeEffectiveReleaseDelivery).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session', allowedShopIds: ['shop'], assignmentId: 'assignment', releaseId: 'release', effectiveChecksum: 'b'.repeat(64), scopeKey: 'bound-scope', now,
    }));
    expect(JSON.stringify(response.json())).not.toMatch(/calculationRule|revisionPayload|formulas|bundle|ruleId/);
  }));

  it('quotes each selected SKU using reviewed server packaging and the shared frozen formula without saving', async () => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('quote'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection,
      releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey, items: f.items } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ binding: f.binding, selection, stableServiceKey: serviceKey, source: 'ERP_PUBLISHED_FORMULA', currency: 'CNY',
      items: [{ skuKey: 'sku-a', declaredPriceMinor: 10000, shippingMinor: 1500, packingMinor: 0, totalLogisticsMinor: 1500, shippingCostCny: 15,
        matchedRuleDigest: expect.stringMatching(/^[a-f0-9]{64}$/u), matchedBand: { priceRangeCNY: ['0', '0'], priceRangeRUB: ['0', '0'] } },
        { skuKey: 'sku-b', declaredPriceMinor: 10000, shippingMinor: 1200, packingMinor: 0, totalLogisticsMinor: 1200, shippingCostCny: 12 }],
      hints: { commission: null, fx: { rate: 0.09, source: 'open.er-api.com' } }, requiresPricePreview: true, writesDraft: false });
    const unchanged = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.binding.listingWorkflowId });
    expect(unchanged.revision).toBe(f.binding.draftRevision);
    expect(unchanged.pricing.value).toBeNull();
    expect(f.loadPricingHints).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner', shopId: 'shop', category: null, now }));
  }));

  it.each(['logistics:discover', 'logistics:read'])('does not broaden existing device grants when %s is absent', async missing => withSetup(async f => {
    const action = missing === 'logistics:discover' ? 'scopes' : 'services';
    const response = await f.app.inject({ method: 'POST', url: path(action), payload: { binding: f.binding, ...(action === 'services' ? { selection } : {}) } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'logistics_scope_denied' });
    expect(response.json().msg).toMatch(/配对|权限/);
    expect(f.repository.listAssignmentsForDevice).not.toHaveBeenCalled();
    expect(f.repository.getEffectiveReleaseForDevice).not.toHaveBeenCalled();
  }, ['listing:review', ...['logistics:discover', 'logistics:read'].filter(scope => scope !== missing)]));

  it.each(['shopId', 'snapshotId', 'supplyGoodsId', 'draftRevision', 'draftVersion'])('rejects stale/foreign binding field %s before rules load', async field => withSetup(async f => {
    const bad = { ...f.binding, [field]: ['draftRevision', 'draftVersion'].includes(field) ? 999 : 'foreign' };
    const response = await f.app.inject({ method: 'POST', url: path('scopes'), payload: { binding: bad } });
    expect([403, 409]).toContain(response.statusCode);
    expect(f.repository.listAssignmentsForDevice).not.toHaveBeenCalled();
  }));

  it('enforces owner source access and workbench feature gates', async () => {
    await withSetup(async f => {
      f.ownership.assertOwnedTarget.mockRejectedValueOnce(Object.assign(new Error('Source unavailable'), { statusCode: 404, code: 'source_not_found' }));
      const response = await f.app.inject({ method: 'POST', url: path('scopes'), payload: { binding: f.binding } });
      expect(response.statusCode).toBe(404);
      expect(f.repository.listAssignmentsForDevice).not.toHaveBeenCalled();
    });
    await withSetup(async f => {
      const response = await f.app.inject({ method: 'POST', url: path('scopes'), payload: { binding: f.binding } });
      expect(response.statusCode).toBe(409);
      expect(f.repository.listAssignmentsForDevice).not.toHaveBeenCalled();
    }, undefined, false);
  });

  it.each(Object.keys(selection))('rejects altered route selector %s without selecting another assignment', async field => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection: { ...selection, [field]: 'foreign' } } });
    expect(response.statusCode).toBe(409);
    expect(f.repository.getEffectiveReleaseForDevice).not.toHaveBeenCalled();
  }));

  it.each(['tenantId', 'shopId', 'warehouseId', 'deploymentId', 'ozonCompanyId', 'originCityUid', 'destinationLocationUid'])('rejects frozen scope mismatch %s', async field => withSetup(async f => {
    (f.release.bundle.scope as Record<string, unknown>)[field] = 'foreign';
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(409);
    expect(f.repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  }));

  it('rejects expired rules during the original repository stale grace', async () => withSetup(async f => {
    f.release.validUntil = '2026-10-04T23:59:59.000Z';
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('logistics_release_expired');
    expect(f.repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  }));

  it('requires current extension version and refuses an upgrade before delivery', async () => withSetup(async f => {
    f.release.minExtensionVersion = '1.0.422';
    for (const headers of [{}, { 'x-ss-erp-extension-version': '1.0.421' }]) {
      const response = await f.app.inject({ method: 'POST', url: path('services'), headers, payload: { binding: f.binding, selection } });
      expect(response.statusCode).toBe(426);
    }
    expect(f.repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  }));

  it('honors final distribution ACL revocation and current draft changes during authorization', async () => withSetup(async f => {
    f.repository.authorizeEffectiveReleaseDelivery.mockResolvedValueOnce({ state: 'gone', assignmentId: 'assignment', reasonCode: 'shop_unlinked' } as never);
    const denied = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(denied.statusCode).toBe(410);
    f.repository.authorizeEffectiveReleaseDelivery.mockImplementationOnce(async () => {
      await f.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.binding.listingWorkflowId,
        expectedRevision: f.binding.draftRevision, expectedDraftVersion: f.binding.draftVersion,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: f.items.map(item => ({ skuKey: item.skuKey, price: '100', oldPrice: '120', offerId: item.skuKey, currencyCode: 'CNY', vat: '0' })) } });
      return { state: 'allowed', authorizationValidUntil: '2026-10-05T01:00:00.000Z' };
    });
    const stale = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(stale.statusCode).toBe(409);
  }));

  it.each(['deliveryMethodBindings', 'destinationEvidence', 'cityAvailabilityOverlays', 'selectedServiceKeys'])('does not expose a service with missing %s', async missing => withSetup(async f => {
    if (missing === 'selectedServiceKeys') f.release.bundle.manifest.selectedServiceKeys = [];
    else if (missing === 'deliveryMethodBindings') (f.release.bundle as Record<string, unknown>).deliveryMethodBindings = [];
    else (f.release.bundle.revisionPayload as Record<string, unknown>)[missing] = [];
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.services).toEqual([]);
  }));

  it.each([
    { stableServiceKey: 'unreleased' }, { releaseId: 'old-release' }, { effectiveChecksum: 'c'.repeat(64) },
    { items: [{ skuKey: 'sku-a', declaredPriceMinor: 10000, hasBattery: false }] },
    { items: [{ skuKey: 'sku-a', declaredPriceMinor: 10000, hasBattery: false }, { skuKey: 'sku-a', declaredPriceMinor: 10000, hasBattery: false }] },
    { items: [{ skuKey: 'foreign', declaredPriceMinor: 10000, hasBattery: false }, { skuKey: 'sku-b', declaredPriceMinor: 10000, hasBattery: false }] },
    { items: [{ skuKey: 'sku-a', declaredPriceMinor: -1, hasBattery: false }, { skuKey: 'sku-b', declaredPriceMinor: 10000, hasBattery: false }] },
    { items: [{ skuKey: 'sku-a', declaredPriceMinor: 0, hasBattery: false }, { skuKey: 'sku-b', declaredPriceMinor: 10000, hasBattery: false }] },
    { weightG: 1 }, { commissionPct: 0 }, { bundle: { arbitrary: true } },
  ])('rejects stale release, foreign SKU and caller authority fields: %j', async override => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('quote'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: {
      binding: f.binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey, items: f.items, ...override } });
    expect([400, 409, 422]).toContain(response.statusCode);
  }));

  it('keeps battery/weight/price/dimension mismatch unavailable instead of returning zero freight', async () => withSetup(async f => {
    const response = await f.app.inject({ method: 'POST', url: path('quote'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: {
      binding: f.binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey,
      items: f.items.map(item => ({ ...item, hasBattery: true })) } });
    expect(response.statusCode).toBe(422);
    expect(response.json().errorCode).toBe('logistics_quote_unavailable');
    expect(response.json().data).toBeUndefined();
  }));

  it('does not invent defaults or fill old exchange rates when pricing hints are absent or stale', async () => withSetup(async f => {
    f.loadPricingHints.mockResolvedValueOnce({ commission: null, fx: { rate: 0.09, source: 'fallback', fetchedAt: '2026-01-01T00:00:00.000Z' } });
    const response = await f.app.inject({ method: 'POST', url: path('scopes'), payload: { binding: f.binding } });
    expect(response.json().data.hints).toMatchObject({ commission: null, fx: null, requiresManual: ['commissionPct', 'fxRate'] });
  }));

  it('rechecks the newly declared selling price against the released price band', async () => withSetup(async f => {
    f.release.bundle.revisionPayload.formulas[0]!.calculationRule.conditions.priceRangeCNY = ['50', '100'];
    const request = (price: number) => f.app.inject({ method: 'POST', url: path('quote'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: {
      binding: f.binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey,
      items: f.items.map(item => ({ ...item, declaredPriceMinor: price })) } });
    const valid = await request(9000);
    expect(valid.statusCode).toBe(200);
    expect(valid.json().data.items[0]).toMatchObject({ declaredPriceMinor: 9000, matchedBand: { priceRangeCNY: ['50', '100'] } });
    const repriced = await request(10100);
    expect(repriced.statusCode).toBe(422);
    expect(repriced.json()).toMatchObject({ errorCode: 'logistics_quote_unavailable' });
    expect(repriced.json().data).toBeUndefined();
  }));

  it('requires persisted and reviewed packaging rather than local DOM measurements', async () => withSetup(async f => {
    const raw = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.binding.listingWorkflowId });
    const getDraft = vi.fn(async () => ({ ...raw, attributes: { ...raw.attributes, values: {} } }));
    const service = createExtensionListingLogisticsPricingService({ workflow: { getDraft }, ownership: f.ownership,
      repository: f.repository, deploymentId: 'deployment', now: () => now });
    await expect(service.quote({ ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'session', scopes: ['listing:review', 'logistics:discover', 'logistics:read'], allowedShopIds: ['shop'] }, {
      binding: f.binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey, items: f.items,
    }, '1.0.421')).rejects.toMatchObject({ code: 'logistics_packaging_required', statusCode: 422 });
    expect(f.repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  }));

  it('blocks revoked or expired authorization after a valid immutable formula read', async () => withSetup(async f => {
    f.repository.authorizeEffectiveReleaseDelivery.mockResolvedValueOnce({ state: 'allowed', authorizationValidUntil: now.toISOString() });
    const response = await f.app.inject({ method: 'POST', url: path('quote'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: {
      binding: f.binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), stableServiceKey: serviceKey, items: f.items } });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe('logistics_authorization_expired');
    expect(response.json().data).toBeUndefined();
  }));

  it.each(['erpWarehouseId', 'tenantId', 'shopId', 'deploymentId', 'originCityUid', 'destinationLocationUid'])('rejects revision scope mismatch %s', async field => withSetup(async f => {
    (f.release.bundle.revisionPayload.scope as Record<string, unknown>)[field] = 'foreign';
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(409);
    expect(f.repository.authorizeEffectiveReleaseDelivery).not.toHaveBeenCalled();
  }));

  it('does not leak unexpected rule repository errors or billing defaults', async () => withSetup(async f => {
    f.repository.getEffectiveReleaseForDevice.mockRejectedValueOnce(new Error('secret-sentinel-tenant-private-rule'));
    const response = await f.app.inject({ method: 'POST', url: path('services'), headers: { 'x-ss-erp-extension-version': '1.0.421' }, payload: { binding: f.binding, selection } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ errorCode: 'logistics_pricing_unavailable' });
    expect(response.body).not.toContain('secret-sentinel');
  }));
});
