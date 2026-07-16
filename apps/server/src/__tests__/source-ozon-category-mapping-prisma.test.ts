import { describe, expect, it, vi } from 'vitest';
import {
  createSourceOzonCategoryMappingService,
  PrismaSourceOzonCategoryMappingRepository,
} from '../services/source-ozon-category-mapping.js';

const NOW = new Date('2026-07-15T03:00:00.000Z');
const SOURCE = {
  snapshotId: 'snapshot-1',
  profileHash: 'a'.repeat(64),
  sourcePlatform: '1688',
  sourceCategoryId: '1031910',
  sourceCategoryPath: ['服装', '女装', 'T恤'],
};
const TARGET = {
  categoryId: 170001,
  typeId: 91001,
  categoryName: 'Одежда',
  typeName: 'Футболки',
  catalogRevision: 'catalog-revision-7',
};

function row(overrides: Record<string, unknown> = {}) {
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
    confirmCount: 1,
    rejectCount: 0,
    createdByUserId: 'actor-a',
    updatedByUserId: 'actor-a',
    reviewedByUserId: 'actor-a',
    reviewedAt: NOW,
    lastConfirmedAt: NOW,
    lastRejectedAt: null,
    promotedFromMappingId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('Prisma source Ozon category mapping repository', () => {
  it('writes one auditable confirmation and returns exact retries idempotently', async () => {
    let savedDecision: any = null;
    let mappingExists = false;
    const mappingRow = row();
    const tx = {
      sourceOzonCategoryMappingDecision: {
        findUnique: vi.fn(async () => savedDecision),
        create: vi.fn(async ({ data }: any) => {
          savedDecision = data;
          return data;
        }),
      },
      sourceOzonCategoryMapping: {
        upsert: vi.fn(async () => {
          mappingExists = true;
          return mappingRow;
        }),
        findUnique: vi.fn(async () => (mappingExists ? mappingRow : null)),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = createSourceOzonCategoryMappingService({
      repository: new PrismaSourceOzonCategoryMappingRepository(prisma as any),
      now: () => NOW,
    });
    const input = { ownerUserId: 'tenant-a', actorUserId: 'actor-a', expectedTransitionVersion: 0, source: SOURCE, target: TARGET };

    const first = await service.confirmTenantMapping(input);
    const second = await service.confirmTenantMapping(input);

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(tx.sourceOzonCategoryMapping.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sourceOzonCategoryMappingDecision.create).toHaveBeenCalledTimes(1);
    expect(tx.sourceOzonCategoryMapping.upsert).toHaveBeenCalledWith({
      where: {
        source_ozon_category_mapping_identity_key: {
          scopeKey: 'tenant:tenant-a',
          sourceSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
          targetCategoryId: 170001,
          targetTypeId: 91001,
        },
      },
      create: expect.objectContaining({
        scope: 'TENANT',
        scopeKey: 'tenant:tenant-a',
        ownerUserId: 'tenant-a',
        sourceSnapshotId: 'snapshot-1',
        sourceProfileHash: 'a'.repeat(64),
        status: 'ACTIVE',
        confirmCount: 1,
        rejectCount: 0,
        createdByUserId: 'actor-a',
        reviewedByUserId: 'actor-a',
        reviewedAt: NOW,
      }),
      update: expect.objectContaining({
        status: 'ACTIVE',
        confirmCount: { increment: 1 },
        updatedByUserId: 'actor-a',
        reviewedByUserId: 'actor-a',
        reviewedAt: NOW,
      }),
    });
    expect(tx.sourceOzonCategoryMappingDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mappingId: 'mapping-1',
        operationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        transitionVersion: 1,
        action: 'CONFIRM',
        scope: 'TENANT',
        scopeKey: 'tenant:tenant-a',
        ownerUserId: 'tenant-a',
        actorUserId: 'actor-a',
        sourceSnapshotId: 'snapshot-1',
        sourceProfileHash: 'a'.repeat(64),
        catalogRevision: 'catalog-revision-7',
        decisionKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        createdAt: NOW,
      }),
    });
  });

  it('treats CONFIRM -> REJECT -> CONFIRM as three transitions, not a retry of the first confirm', async () => {
    const decisions = new Map<string, any>();
    let current: any = null;
    const tx = {
      sourceOzonCategoryMappingDecision: {
        findUnique: vi.fn(async ({ where }: any) => decisions.get(
          where.source_ozon_category_mapping_transition_key.transitionVersion,
        ) || null),
        create: vi.fn(async ({ data }: any) => {
          decisions.set(data.transitionVersion, data);
          return data;
        }),
      },
      sourceOzonCategoryMapping: {
        upsert: vi.fn(async ({ create, update }: any) => {
          current = current
            ? row({
                ...current,
                status: update.status,
                confirmCount: current.confirmCount + (update.confirmCount?.increment || 0),
                rejectCount: current.rejectCount + (update.rejectCount?.increment || 0),
                lastConfirmedAt: update.lastConfirmedAt ?? current.lastConfirmedAt,
                lastRejectedAt: update.lastRejectedAt ?? current.lastRejectedAt,
                updatedAt: update.updatedAt,
              })
            : row(create);
          return current;
        }),
        findUnique: vi.fn(async () => current),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = createSourceOzonCategoryMappingService({
      repository: new PrismaSourceOzonCategoryMappingRepository(prisma as any),
      now: () => NOW,
    });
    const base = { ownerUserId: 'tenant-a', actorUserId: 'actor-a', source: SOURCE, target: TARGET };

    await service.confirmTenantMapping({ ...base, expectedTransitionVersion: 0 });
    await service.rejectTenantMapping({ ...base, expectedTransitionVersion: 1 });
    const delayedRetry = await service.confirmTenantMapping({ ...base, expectedTransitionVersion: 0 });
    const reactivated = await service.confirmTenantMapping({ ...base, expectedTransitionVersion: 2 });

    expect(delayedRetry.idempotent).toBe(true);
    expect(delayedRetry.mapping.status).toBe('REJECTED');
    expect(reactivated.idempotent).toBe(false);
    expect(reactivated.mapping).toMatchObject({ status: 'ACTIVE', confirmCount: 2, rejectCount: 1 });
    expect(tx.sourceOzonCategoryMappingDecision.create).toHaveBeenCalledTimes(3);
  });

  it('recovers a concurrent duplicate from the durable decision key', async () => {
    const mappingRow = row();
    let savedDecision: any = null;
    let mappingExists = false;
    const tx = {
      sourceOzonCategoryMappingDecision: {
        findUnique: vi.fn(async () => savedDecision),
        create: vi.fn(async ({ data }: any) => {
          savedDecision = data;
          throw Object.assign(new Error('unique conflict'), { code: 'P2002' });
        }),
      },
      sourceOzonCategoryMapping: {
        findUnique: vi.fn(async () => (mappingExists ? mappingRow : null)),
        upsert: vi.fn(async () => {
          mappingExists = true;
          return mappingRow;
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = createSourceOzonCategoryMappingService({
      repository: new PrismaSourceOzonCategoryMappingRepository(prisma as any),
      now: () => NOW,
    });
    const result = await service.confirmTenantMapping({
      ownerUserId: 'tenant-a', actorUserId: 'actor-a', expectedTransitionVersion: 0, source: SOURCE, target: TARGET,
    });

    expect(result.idempotent).toBe(true);
    expect(tx.sourceOzonCategoryMapping.upsert).toHaveBeenCalledTimes(1);
    expect(tx.sourceOzonCategoryMappingDecision.create).toHaveBeenCalledTimes(1);
  });

  it('queries only the owner tenant and reviewed global baseline', async () => {
    const findMany = vi.fn(async () => [
      row(),
      row({
        id: 'mapping-global', scope: 'GLOBAL', scopeKey: 'global', ownerUserId: null,
        reviewedByUserId: 'super-admin', promotedFromMappingId: 'mapping-1',
      }),
    ]);
    const repository = new PrismaSourceOzonCategoryMappingRepository({
      sourceOzonCategoryMapping: { findMany },
    } as any);

    const result = await repository.listVisibleMappings({
      ownerUserId: 'tenant-a',
      tenantScopeKey: 'tenant:tenant-a',
      sourceSignature: row().sourceSignature,
    });

    expect(result).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        sourceSignature: row().sourceSignature,
        status: 'ACTIVE',
        OR: [
          { scope: 'TENANT', scopeKey: 'tenant:tenant-a', ownerUserId: 'tenant-a' },
          {
            scope: 'GLOBAL',
            scopeKey: 'global',
            ownerUserId: null,
            reviewedByUserId: { not: null },
            reviewedAt: { not: null },
          },
        ],
      },
      orderBy: [
        { scope: 'asc' },
        { confirmCount: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
  });

  it('promotes only an active tenant mapping at the expected catalog revision', async () => {
    const source = row();
    const global = row({
      id: 'mapping-global',
      scope: 'GLOBAL',
      scopeKey: 'global',
      ownerUserId: null,
      createdByUserId: 'super-admin',
      updatedByUserId: 'super-admin',
      reviewedByUserId: 'super-admin',
      reviewedAt: NOW,
      promotedFromMappingId: 'mapping-1',
    });
    const tx = {
      sourceOzonCategoryMappingDecision: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: any) => data),
      },
      sourceOzonCategoryMapping: {
        findFirst: vi.fn(async () => source),
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => global),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = createSourceOzonCategoryMappingService({
      repository: new PrismaSourceOzonCategoryMappingRepository(prisma as any),
      now: () => NOW,
    });

    await service.promoteGlobalMapping({
      sourceMappingId: 'mapping-1',
      expectedGlobalTransitionVersion: 0,
      expectedCatalogRevision: 'catalog-revision-7',
      actorUserId: 'super-admin',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Reviewed against the current official Ozon catalog.',
    });

    expect(tx.sourceOzonCategoryMapping.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'mapping-1',
        scope: 'TENANT',
        status: 'ACTIVE',
        catalogRevision: 'catalog-revision-7',
      },
    });
    expect(tx.sourceOzonCategoryMapping.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        scope: 'GLOBAL',
        scopeKey: 'global',
        ownerUserId: null,
        promotedFromMappingId: 'mapping-1',
        createdByUserId: 'super-admin',
        reviewedByUserId: 'super-admin',
        reviewedAt: NOW,
      }),
    }));
    expect(tx.sourceOzonCategoryMappingDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mappingId: 'mapping-global',
        action: 'PROMOTE',
        scope: 'GLOBAL',
        scopeKey: 'global',
        ownerUserId: null,
        actorUserId: 'super-admin',
        reviewNote: 'Reviewed against the current official Ozon catalog.',
      }),
    });
  });
});
