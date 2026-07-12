import { describe, expect, it, vi } from 'vitest';
import {
  type LogisticsReleaseManifest,
  LogisticsRuleReleaseError,
  publishLogisticsRuleRevision,
  rollbackLogisticsRuleRelease,
} from '../services/logistics-rule-release.js';

function fixture() {
  const companyBinding = {
    id: 'company-binding-1', tenantId: 'tenant-1', shopId: 'shop-1', ozonCompanyId: 'company-1', status: 'VERIFIED',
    openApiVerifiedAt: new Date('2026-07-12T00:00:00Z'), sellerProbeVerifiedAt: new Date('2026-07-12T00:01:00Z'),
    openApiIntersectionVerifiedAt: new Date('2026-07-12T00:02:00Z'), verifiedById: 'admin-1', verifiedAt: new Date('2026-07-12T00:03:00Z'), invalidatedAt: null, retiredAt: null,
  };
  const originBinding = {
    id: 'origin-binding-1', tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1', status: 'VERIFIED',
    originCountryUid: 'china-uid', originCityUid: 'xiamen-uid', originCountryCode: 'CN', openApiAddressVerifiedAt: new Date('2026-07-12T00:00:00Z'),
    officialLocationVerifiedAt: new Date('2026-07-12T00:01:00Z'), verifiedById: 'admin-1', verifiedAt: new Date('2026-07-12T00:03:00Z'), invalidatedAt: null, retiredAt: null,
  };
  const channel = {
    id: 'channel-1', channelType: 'TENANT', tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1',
    ozonCompanyId: 'company-1', originCountryUid: 'china-uid', originCityUid: 'xiamen-uid', originCountryCode: 'CN', scopeKey: 'tenant-1/shop-1/warehouse-1/china-uid/xiamen-uid',
    companyBindingId: companyBinding.id, originBindingId: originBinding.id, companyBinding, originBinding,
    currentSequence: 0, currentReleaseId: null as string | null, retiredAt: null,
  };
  const revisions = new Map([
    ['revision-1', {
      id: 'revision-1', revisionKey: 'tenant-1:checksum-1', sourceOwnerType: 'TENANT', sourceTenantId: 'tenant-1',
      confidentiality: 'TENANT_PRIVATE', contentChecksum: 'checksum-1', payload: { formulas: [{ serviceKey: 'pickup' }] },
      schemaVersion: '1', validationStatus: 'PASSED', validatedAt: new Date('2026-07-12T00:00:00Z'),
      validationValidUntil: new Date('2026-07-20T00:00:00Z'),
    }],
    ['revision-2', {
      id: 'revision-2', revisionKey: 'tenant-1:checksum-2', sourceOwnerType: 'TENANT', sourceTenantId: 'tenant-1',
      confidentiality: 'TENANT_PRIVATE', contentChecksum: 'checksum-2', payload: { formulas: [{ serviceKey: 'courier' }] },
      schemaVersion: '1', validationStatus: 'PASSED', validatedAt: new Date('2026-07-12T01:00:00Z'),
      validationValidUntil: new Date('2026-07-20T01:00:00Z'),
    }],
  ]);
  const bindings = [
    { id: 'method-binding-1', tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1', deliveryMethodId: 'method-1', stableServiceKey: 'pickup', sourceRevisionId: 'revision-1', status: 'CONFIRMED', confirmedById: 'admin-1', confirmedAt: new Date(), retiredAt: null },
    { id: 'method-binding-2', tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1', deliveryMethodId: 'method-2', stableServiceKey: 'courier', sourceRevisionId: 'revision-2', status: 'CONFIRMED', confirmedById: 'admin-1', confirmedAt: new Date(), retiredAt: null },
  ];
  const assignment = { id: 'assignment-1', tenantId: 'tenant-1', shopId: 'shop-1', warehouseId: 'warehouse-1', channelId: channel.id, destinationCountryUid: 'russia-uid', destinationCountryCode: 'RU', destinationLocationUid: 'moscow-uid', destinationLabel: 'Moscow', retiredAt: null };
  return { channel, revisions, bindings, assignment, resolutions: [] as any[], releases: [] as any[], events: [] as any[] };
}

function database(state = fixture(), options: { failEvent?: boolean } = {}) {
  let id = 0;
  const tx = {
    logisticsRuleChannel: {
      findUnique: vi.fn(async () => state.channel),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.channel.id || where.currentSequence !== state.channel.currentSequence) return { count: 0 };
        Object.assign(state.channel, data);
        return { count: 1 };
      }),
    },
    logisticsRuleRevision: { findUnique: vi.fn(async ({ where }: any) => state.revisions.get(where.id) || null) },
    logisticsRuleRelease: {
      findUnique: vi.fn(async ({ where }: any) => state.releases.find((release) => release.id === where.id) || null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `release-${++id}`, createdAt: new Date(), ...data };
        state.releases.push(row);
        return row;
      }),
    },
    logisticsRuleAssignment: { findFirst: vi.fn(async () => state.assignment) },
    shopDeliveryMethodRuleBinding: {
      findMany: vi.fn(async ({ where }: any) => state.bindings.filter((binding) => where.id.in.includes(binding.id))),
    },
    officialSellerFormulaResolution: {
      findMany: vi.fn(async ({ where }: any) => state.resolutions.filter((resolution) => where.id.in.includes(resolution.id))),
    },
    logisticsRuleEvent: {
      create: vi.fn(async ({ data }: any) => {
        if (options.failEvent) throw new Error('event persistence failed');
        const row = { id: `event-${state.events.length + 1}`, ...data };
        state.events.push(row);
        return row;
      }),
    },
  };
  return {
    state,
    tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
}

const manifest = (revisionId: string, bindingId: string, serviceKey: string): LogisticsReleaseManifest => ({
  schemaVersion: '1',
  minimumExtensionVersion: '0.1.0',
  destination: { destinationCountryUid: 'russia-uid', destinationLocationUid: 'moscow-uid', destinationLabel: 'Moscow', destinationCountryCode: 'RU' },
  selectedServiceKeys: [serviceKey],
  defaultServiceKeys: [serviceKey],
  deliveryMethodBindingIds: [bindingId],
  officialResolutions: [],
  routeClassifications: { [serviceKey]: 'RU' },
  validationReport: { status: 'PASSED' },
  revisionId,
});

describe('logistics rule publication', () => {
  it('publishes immutable sequence 1 then 2 and advances one current pointer', async () => {
    const db = database();
    const first = await publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1',
      manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z'),
    });
    const second = await publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1', revisionId: 'revision-2', expectedSequence: 1, actorUserId: 'admin-1',
      manifest: manifest('revision-2', 'method-binding-2', 'courier'), now: new Date('2026-07-12T04:00:00Z'),
    });

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(db.state.channel).toMatchObject({ currentSequence: 2, currentReleaseId: second.id });
    expect(db.state.releases).toHaveLength(2);
    expect(db.state.events.map((event) => event.type)).toEqual(['PUBLISHED', 'PUBLISHED']);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('rejects a manifest that omits its immutable revision reference', async () => {
    const db = database();
    const incompleteManifest = manifest('revision-1', 'method-binding-1', 'pickup') as any;
    delete incompleteManifest.revisionId;

    await expect(publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedSequence: 0,
      actorUserId: 'admin-1',
      manifest: incompleteManifest,
      now: new Date('2026-07-12T03:00:00Z'),
    })).rejects.toMatchObject({ code: 'REVISION_MISMATCH' });
    expect(db.state.releases).toHaveLength(0);
    expect(db.state.channel).toMatchObject({ currentSequence: 0, currentReleaseId: null });
  });

  it('rolls sequence 2 back as sequence 3 without refreshing the older validation timestamps', async () => {
    const db = database();
    const first = await publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1', manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z') });
    await publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-2', expectedSequence: 1, actorUserId: 'admin-1', manifest: manifest('revision-2', 'method-binding-2', 'courier'), now: new Date('2026-07-12T04:00:00Z') });

    const rolledBack = await rollbackLogisticsRuleRelease(db as any, { channelId: 'channel-1', targetReleaseId: first.id, expectedSequence: 2, actorUserId: 'admin-1', now: new Date('2026-07-12T05:00:00Z') });

    expect(rolledBack).toMatchObject({ sequence: 3, revisionId: 'revision-1', rollbackTargetReleaseId: first.id });
    expect(rolledBack.validatedAt).toEqual(first.validatedAt);
    expect(rolledBack.validationValidUntil).toEqual(first.validationValidUntil);
    expect(db.state.channel).toMatchObject({ currentSequence: 3, currentReleaseId: rolledBack.id });
    expect(db.state.events.at(-1)?.type).toBe('ROLLED_BACK');
  });

  it('maps exhausted PostgreSQL serialization conflicts to HTTP 409', async () => {
    const db = {
      $transaction: vi.fn().mockRejectedValue({ code: 'P2034' }),
    };

    await expect(publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedSequence: 0,
      actorUserId: 'admin-1',
      manifest: manifest('revision-1', 'method-binding-1', 'pickup'),
      now: new Date('2026-07-12T03:00:00Z'),
    })).rejects.toMatchObject({ code: 'RELEASE_CONFLICT', statusCode: 409 });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects stale expectedSequence without creating split active state', async () => {
    const db = database();
    await publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1', manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z') });

    await expect(publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-2', expectedSequence: 0, actorUserId: 'admin-2', manifest: manifest('revision-2', 'method-binding-2', 'courier'), now: new Date('2026-07-12T04:00:00Z') })).rejects.toMatchObject({ code: 'RELEASE_CONFLICT', statusCode: 409 });
    expect(db.state.releases).toHaveLength(1);
    expect(db.state.channel.currentSequence).toBe(1);
  });

  it('does not move the pointer when the mandatory event cannot be stored', async () => {
    const db = database(undefined, { failEvent: true });
    await expect(publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1', manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z') })).rejects.toThrow('event persistence failed');
    expect(db.state.channel).toMatchObject({ currentSequence: 0, currentReleaseId: null });
  });

  it('rejects an Official resolution reviewed against a different Seller revision', async () => {
    const db = database();
    db.state.resolutions.push({
      id: 'resolution-stale',
      tenantId: 'tenant-1',
      shopId: 'shop-1',
      warehouseId: 'warehouse-1',
      officialFingerprint: 'official-fingerprint',
      sellerSourceRevisionId: 'revision-2',
      candidateSetChecksum: 'candidate-checksum',
      candidateServiceKeys: ['pickup'],
      selectedServiceKey: 'pickup',
      status: 'CONFIRMED',
      reviewedById: 'admin-1',
      reviewedAt: new Date('2026-07-12T02:00:00Z'),
      evidence: { reason: 'reviewed against revision-2' },
      invalidatedAt: null,
    });
    const staleManifest = manifest('revision-1', 'method-binding-1', 'pickup');
    staleManifest.officialResolutions = [{
      id: 'resolution-stale',
      tenantId: 'tenant-1',
      shopId: 'shop-1',
      warehouseId: 'warehouse-1',
      officialFingerprint: 'official-fingerprint',
      sellerSourceRevisionId: 'revision-2',
      candidateSetChecksum: 'candidate-checksum',
    }];

    await expect(publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1',
      revisionId: 'revision-1',
      expectedSequence: 0,
      actorUserId: 'admin-1',
      manifest: staleManifest,
      now: new Date('2026-07-12T03:00:00Z'),
    })).rejects.toMatchObject({ code: 'STALE_OFFICIAL_RESOLUTION' });
    expect(db.state.channel.currentSequence).toBe(0);
  });
  it('keeps legacy country-code-only scopes in draft instead of publishing them', async () => {
    const db = database();
    delete (db.state.channel as any).originCountryUid;
    delete (db.state.channel as any).originCityUid;

    await expect(publishLogisticsRuleRevision(db as any, {
      channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1',
      manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z'),
    })).rejects.toMatchObject({ code: 'UNSCOPED_CHANNEL' });
    expect(db.state.channel.currentSequence).toBe(0);
  });

  it('blocks tenant-private content from a public or different-tenant channel', async () => {
    const db = database();
    Object.assign(db.state.channel, { channelType: 'PUBLIC', tenantId: null, shopId: null, warehouseId: null });
    await expect(publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1', manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z') })).rejects.toMatchObject({ code: 'CONFIDENTIALITY_VIOLATION' });
  });

  it('rejects rollback when the frozen scope, content, or revision snapshot was tampered with', async () => {
    const mutations: Array<(target: any) => void> = [
      (target) => { target.contentChecksum = 'tampered-checksum'; },
      (target) => { target.frozenPayload.scope.shopId = 'other-shop'; },
      (target) => { target.frozenPayload.revisionPayload = { tampered: true }; },
      (target) => { target.frozenPayload.manifest.revisionId = 'revision-2'; },
    ];

    for (const mutate of mutations) {
      const db = database();
      const first = await publishLogisticsRuleRevision(db as any, {
        channelId: 'channel-1',
        revisionId: 'revision-1',
        expectedSequence: 0,
        actorUserId: 'admin-1',
        manifest: manifest('revision-1', 'method-binding-1', 'pickup'),
        now: new Date('2026-07-12T03:00:00Z'),
      });
      await publishLogisticsRuleRevision(db as any, {
        channelId: 'channel-1',
        revisionId: 'revision-2',
        expectedSequence: 1,
        actorUserId: 'admin-1',
        manifest: manifest('revision-2', 'method-binding-2', 'courier'),
        now: new Date('2026-07-12T04:00:00Z'),
      });
      mutate(first);

      await expect(rollbackLogisticsRuleRelease(db as any, {
        channelId: 'channel-1',
        targetReleaseId: first.id,
        expectedSequence: 2,
        actorUserId: 'admin-1',
        now: new Date('2026-07-12T05:00:00Z'),
      })).rejects.toMatchObject({ code: 'ROLLBACK_TARGET_INTEGRITY' });
      expect(db.state.channel.currentSequence).toBe(2);
    }
  });

  it('rejects rollback when the historical validation expired', async () => {
    const db = database();
    const first = await publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-1', expectedSequence: 0, actorUserId: 'admin-1', manifest: manifest('revision-1', 'method-binding-1', 'pickup'), now: new Date('2026-07-12T03:00:00Z') });
    await publishLogisticsRuleRevision(db as any, { channelId: 'channel-1', revisionId: 'revision-2', expectedSequence: 1, actorUserId: 'admin-1', manifest: manifest('revision-2', 'method-binding-2', 'courier'), now: new Date('2026-07-12T04:00:00Z') });

    await expect(rollbackLogisticsRuleRelease(db as any, { channelId: 'channel-1', targetReleaseId: first.id, expectedSequence: 2, actorUserId: 'admin-1', now: new Date('2026-07-21T00:00:00Z') })).rejects.toMatchObject({ code: 'VALIDATION_EXPIRED' });
    expect(db.state.channel.currentSequence).toBe(2);
  });
});

void LogisticsRuleReleaseError;
