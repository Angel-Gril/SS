import { describe, expect, it, vi } from 'vitest';
import {
  createSourceOzonCategoryMappingService,
  deriveSourceOzonCategoryIdentity,
  SourceOzonCategoryMappingError,
  type SourceOzonCategoryMappingRecord,
  type SourceOzonCategoryMappingRepository,
} from '../services/source-ozon-category-mapping.js';

const SOURCE = {
  snapshotId: 'snapshot-1',
  profileHash: 'a'.repeat(64),
  sourcePlatform: '1688',
  sourceCategoryId: '1031910',
  sourceCategoryPath: [' 服装 ', '女装', 'T恤'],
};

const TARGET = {
  categoryId: 170001,
  typeId: 91001,
  categoryName: 'Одежда',
  typeName: 'Футболки',
  catalogRevision: 'catalog-revision-7',
};

function mapping(overrides: Partial<SourceOzonCategoryMappingRecord> = {}): SourceOzonCategoryMappingRecord {
  return {
    id: 'mapping-1',
    scope: 'TENANT',
    scopeKey: 'tenant:tenant-a',
    ownerUserId: 'tenant-a',
    sourcePlatform: '1688',
    sourceCategoryId: '1031910',
    sourceCategoryPath: ['服装', '女装', 't恤'],
    sourceSignature: '49983d66198fa277cfdf7b422ddb02603e2c8dc77854c0ad878bb32cf2e2137d',
    sourceSnapshotId: 'snapshot-1',
    sourceProfileHash: 'a'.repeat(64),
    targetCategoryId: 170001,
    targetTypeId: 91001,
    targetCategoryName: 'Одежда',
    targetTypeName: 'Футболки',
    catalogRevision: 'catalog-revision-7',
    status: 'ACTIVE',
    transitionVersion: 1,
    confirmCount: 1,
    rejectCount: 0,
    createdByUserId: 'actor-a',
    updatedByUserId: 'actor-a',
    reviewedByUserId: 'actor-a',
    reviewedAt: '2026-07-15T01:00:00.000Z',
    lastConfirmedAt: '2026-07-15T01:00:00.000Z',
    lastRejectedAt: null,
    promotedFromMappingId: null,
    createdAt: '2026-07-15T01:00:00.000Z',
    updatedAt: '2026-07-15T01:00:00.000Z',
    ...overrides,
  };
}

function repository(overrides: Partial<SourceOzonCategoryMappingRepository> = {}): SourceOzonCategoryMappingRepository {
  return {
    applyTenantDecision: vi.fn(async () => ({ mapping: mapping(), idempotent: false })),
    listVisibleMappings: vi.fn(async () => []),
    promoteGlobalMapping: vi.fn(async () => ({
      mapping: mapping({
        id: 'mapping-global',
        scope: 'GLOBAL',
        scopeKey: 'global',
        ownerUserId: null,
        reviewedByUserId: 'super-admin',
        promotedFromMappingId: 'mapping-1',
      }),
      idempotent: false,
    })),
    ...overrides,
  };
}

describe('source Ozon category mapping service', () => {
  it('derives a stable server-owned category signature from canonical snapshot/profile input', () => {
    const first = deriveSourceOzonCategoryIdentity({ ...SOURCE, clientSignature: 'forged-a' } as any);
    const second = deriveSourceOzonCategoryIdentity({ ...SOURCE, clientSignature: 'forged-b' } as any);

    expect(first).toEqual({
      snapshotId: 'snapshot-1',
      profileHash: 'a'.repeat(64),
      sourcePlatform: '1688',
      sourceCategoryId: '1031910',
      sourceCategoryPath: ['服装', '女装', 't恤'],
      sourceSignature: '49983d66198fa277cfdf7b422ddb02603e2c8dc77854c0ad878bb32cf2e2137d',
    });
    expect(second.sourceSignature).toBe(first.sourceSignature);
  });

  it('constructs a tenant-only confirmation and a deterministic idempotency key', async () => {
    const applyTenantDecision = vi.fn(async (input) => ({
      mapping: mapping({
        sourceSignature: input.source.sourceSignature,
        reviewedByUserId: input.actorUserId,
      }),
      idempotent: false,
    }));
    const service = createSourceOzonCategoryMappingService({
      repository: repository({ applyTenantDecision }),
      now: () => new Date('2026-07-15T01:00:00.000Z'),
    });

    await service.confirmTenantMapping({
      ownerUserId: 'tenant-a',
      actorUserId: 'actor-a',
      expectedTransitionVersion: 0,
      source: SOURCE,
      target: TARGET,
    });
    await service.confirmTenantMapping({
      ownerUserId: 'tenant-a',
      actorUserId: 'actor-a',
      expectedTransitionVersion: 0,
      source: SOURCE,
      target: TARGET,
    });

    expect(applyTenantDecision).toHaveBeenCalledTimes(2);
    const first = applyTenantDecision.mock.calls[0]![0];
    const second = applyTenantDecision.mock.calls[1]![0];
    expect(first).toMatchObject({
      action: 'CONFIRM',
      scope: 'TENANT',
      scopeKey: 'tenant:tenant-a',
      ownerUserId: 'tenant-a',
      actorUserId: 'actor-a',
      target: TARGET,
      decidedAt: new Date('2026-07-15T01:00:00.000Z'),
    });
    expect(first.operationKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.operationKey).toBe(first.operationKey);
    expect(second.requestHash).toBe(first.requestHash);
    expect(first).not.toHaveProperty('clientSignature');
  });

  it('defensively returns only the tenant own active rows and reviewed active global rows', async () => {
    const own = mapping();
    const otherTenant = mapping({ id: 'mapping-other', scopeKey: 'tenant:tenant-b', ownerUserId: 'tenant-b' });
    const reviewedGlobal = mapping({
      id: 'mapping-global',
      scope: 'GLOBAL',
      scopeKey: 'global',
      ownerUserId: null,
      reviewedByUserId: 'super-admin',
      reviewedAt: '2026-07-15T01:00:00.000Z',
      promotedFromMappingId: 'mapping-1',
    });
    const unreviewedGlobal = mapping({
      id: 'mapping-unreviewed-global',
      scope: 'GLOBAL',
      scopeKey: 'global',
      ownerUserId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      promotedFromMappingId: null,
    });
    const retiredOwn = mapping({ id: 'mapping-retired', status: 'RETIRED' });
    const listVisibleMappings = vi.fn(async () => [own, otherTenant, reviewedGlobal, unreviewedGlobal, retiredOwn]);
    const service = createSourceOzonCategoryMappingService({
      repository: repository({ listVisibleMappings }),
    });

    const rows = await service.listVisibleMappings({ ownerUserId: 'tenant-a', source: SOURCE });

    expect(rows.map((row) => row.id)).toEqual(['mapping-1', 'mapping-global']);
    expect(listVisibleMappings).toHaveBeenCalledWith({
      ownerUserId: 'tenant-a',
      tenantScopeKey: 'tenant:tenant-a',
      sourceSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('keeps global promotion behind a distinct super-admin operation', async () => {
    const promoteGlobalMapping = vi.fn(async () => ({
      mapping: mapping({
        id: 'mapping-global', scope: 'GLOBAL', scopeKey: 'global', ownerUserId: null,
        reviewedByUserId: 'super-admin', promotedFromMappingId: 'mapping-1',
      }),
      idempotent: false,
    }));
    const service = createSourceOzonCategoryMappingService({
      repository: repository({ promoteGlobalMapping }),
      now: () => new Date('2026-07-15T02:00:00.000Z'),
    });
    const input = {
      sourceMappingId: 'mapping-1',
      expectedGlobalTransitionVersion: 0,
      expectedCatalogRevision: 'catalog-revision-7',
      actorUserId: 'super-admin',
      actorRole: 'ADMIN',
      isSuperAdmin: false,
      reviewNote: 'Reviewed against the current official Ozon catalog.',
    } as const;

    await expect(service.promoteGlobalMapping(input)).rejects.toMatchObject({
      code: 'GLOBAL_PROMOTION_FORBIDDEN',
      statusCode: 403,
    } satisfies Partial<SourceOzonCategoryMappingError>);
    expect(promoteGlobalMapping).not.toHaveBeenCalled();

    await service.promoteGlobalMapping({ ...input, isSuperAdmin: true });
    expect(promoteGlobalMapping).toHaveBeenCalledWith(expect.objectContaining({
      sourceMappingId: 'mapping-1',
      expectedTransitionVersion: 0,
      actorUserId: 'super-admin',
      reviewedAt: new Date('2026-07-15T02:00:00.000Z'),
      operationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
});
