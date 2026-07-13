import { describe, expect, it, vi } from 'vitest';
import { createPrismaLogisticsRuleAdminRepository } from '../services/logistics-rule-admin-prisma.js';

const now = new Date('2026-07-12T14:00:00.000Z');
const serviceKeys = ['service-1', 'service-2'];

const serviceIdentities = [
  {
    stableServiceKey: 'service-1',
    providerId: '1778',
    normalizedDescription: 'atc pickup',
    templateType: 'door_to_door',
    weightType: 'actual',
    batteryMode: 'no-battery',
    deliveryVariant: 'pickup',
  },
  {
    stableServiceKey: 'service-2',
    providerId: '1778',
    normalizedDescription: 'atc courier',
    templateType: 'door_to_door',
    weightType: 'actual',
    batteryMode: 'no-battery',
    deliveryVariant: 'courier',
  },
];
const officialSample = {
  fingerprintKey: 'fingerprint-1',
  sourceRevision: 'official-r1',
  batchChecksum: 'b'.repeat(64),
  sampleChecksum: 'c'.repeat(64),
  fingerprint: {
    origin: { countryUid: 'china', cityUid: 'xiamen' },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    currency: 'CNY',
  },
  tariffs: [
    {
      stableServiceKey: 'official-service-1',
      providerId: '1778',
      normalizedDescription: 'atc pickup',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'pickup',
    },
    {
      stableServiceKey: 'official-service-2',
      providerId: '1778',
      normalizedDescription: 'atc courier',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'courier',
    },
  ],
};

function fakeManagementPrisma() {
  let versionMs = now.getTime();
  const nextVersion = () => new Date(++versionMs);
  const state: any = {
    revision: {
      id: 'revision-1',
      sourceOwnerType: 'TENANT',
      sourceTenantId: 'tenant-1',
      validationStatus: 'PASSED',
      validationReport: { source: 'server-derived', blockers: [] },
      validatedAt: now,
      validationValidUntil: new Date('2026-07-19T14:00:00.000Z'),
      payload: {
        officialPolicy: {
          activeSourceRevision: 'official-r1',
          activeBatchChecksum: 'b'.repeat(64),
          freshnessCutoff: '2026-07-12T00:00:00.000Z',
        },
        services: structuredClone(serviceIdentities),
        formulas: serviceKeys.map((stableServiceKey) => ({ stableServiceKey })),
        officialSamples: [structuredClone(officialSample)],
        validationMatrix: {
          requirements: [
            {
              requirementKey: 'requirement-1',
              stableServiceKey: 'service-1',
              expectedDeliveryVariant: 'pickup',
              fingerprintKey: 'fingerprint-1',
            },
            {
              requirementKey: 'requirement-2',
              stableServiceKey: 'service-2',
              expectedDeliveryVariant: 'courier',
              fingerprintKey: 'fingerprint-1',
            },
          ],
        },
      },
    },
    channel: {
      id: 'channel-1',
      channelType: 'TENANT',
      tenantId: 'tenant-1',
      shopId: 'shop-1',
      deploymentId: 'local-test',
      schemaMajor: 1,
      warehouseId: 'warehouse-1',
      ozonCompanyId: 'company-1',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      originCountryCode: 'CN',
      originLabel: 'Xiamen',
      companyBindingId: 'company-binding-1',
      originBindingId: 'origin-binding-1',
      scopeKey: 'scope-1',
      currentSequence: 2,
      currentReleaseId: 'release-2',
      retiredAt: null,
      currentRelease: {
        id: 'release-2',
        sequence: 2,
        revisionId: 'revision-1',
        releaseKind: 'PUBLISH',
        contentChecksum: 'a'.repeat(64),
        effectiveChecksum: 'b'.repeat(64),
        frozenPayload: { secret: 'do-not-list' },
        validatedAt: now,
        validationValidUntil: new Date('2026-07-19T14:00:00.000Z'),
        publishedById: 'admin-1',
        publishedAt: now,
      },
    },
    assignments: [
      {
        id: 'assignment-1',
        channelId: 'channel-1',
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        destinationCountryUid: 'russia',
        destinationCountryCode: 'RU',
        destinationLocationUid: 'moscow',
        destinationLabel: 'Moscow',
        pinnedReleaseId: null,
        retiredAt: null,
      },
    ],
    companyBindings: [
      {
        id: 'company-binding-1',
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        ozonCompanyId: 'company-1',
        status: 'VERIFIED',
        openApiEvidence: { companyId: 'company-1' },
        sellerProbeEvidence: { matched: true },
        verifiedById: 'admin-1',
        verifiedAt: now,
        invalidatedAt: null,
        retiredAt: null,
      },
    ],
    originBindings: [
      {
        id: 'origin-binding-1',
        tenantId: 'tenant-1',
        shopId: 'shop-1',
        warehouseId: 'warehouse-1',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        originCountryCode: 'CN',
        originLabel: 'Xiamen',
        status: 'VERIFIED',
        officialLocationEvidence: { cityUid: 'xiamen' },
        verifiedById: 'admin-1',
        verifiedAt: now,
        invalidatedAt: null,
        retiredAt: null,
      },
    ],
    deliveryMethods: [
      {
        id: 'method-1',
        warehouseId: 'warehouse-1',
        platformMethodId: 101,
        name: 'ATC',
        status: 'active',
        providerId: 1778,
        providerName: 'ATC',
        tplDropoffPointId: null,
        tplIntegrationType: '1',
        dropOffPointAddress: 'Xiamen',
        dropOffPointName: 'Point',
        rawData: { private: 'private-raw-method' },
        updatedAt: now,
      },
    ],
    methodBindings: [] as any[],
    officialResolutions: [] as any[],
    events: [] as any[],
    releases: [
      {
        id: 'release-2',
        sequence: 2,
        revisionId: 'revision-1',
        releaseKind: 'PUBLISH',
        contentChecksum: 'a'.repeat(64),
        effectiveChecksum: 'b'.repeat(64),
        validatedAt: now,
        validationValidUntil: new Date('2026-07-19T14:00:00.000Z'),
        publishedById: 'admin-1',
        publishedAt: now,
        frozenPayload: { secret: 'do-not-list' },
      },
    ],
  };
  const client: any = {
    logisticsRuleChannel: {
      findMany: vi.fn(async () => [state.channel]),
      findUnique: vi.fn(async () => state.channel),
    },
    logisticsRuleRevision: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.id === state.revision.id ? state.revision : null,
      ),
      update: vi.fn(async ({ data }: any) => Object.assign(state.revision, data)),
    },
    logisticsRuleRelease: { findMany: vi.fn(async () => state.releases) },
    logisticsRuleAssignment: {
      findMany: vi.fn(async () => state.assignments),
      findUnique: vi.fn(async () => state.assignments[0]),
    },
    shopOzonCompanyBinding: { findMany: vi.fn(async () => state.companyBindings) },
    warehouseOzonOriginBinding: { findMany: vi.fn(async () => state.originBindings) },
    shopDeliveryMethod: {
      findMany: vi.fn(async () => state.deliveryMethods),
      findFirst: vi.fn(
        async ({ where }: any) =>
          state.deliveryMethods.find(
            (row: any) => row.id === where.id && row.warehouseId === where.warehouseId,
          ) || null,
      ),
    },
    shopDeliveryMethodRuleBinding: {
      findMany: vi.fn(async () => state.methodBindings),
      findFirst: vi.fn(
        async ({ where }: any) =>
          state.methodBindings.find(
            (row: any) =>
              row.sourceRevisionId === where.sourceRevisionId &&
              row.deliveryMethodId === where.deliveryMethodId &&
              row.retiredAt === null,
          ) || null,
      ),
      findUnique: vi.fn(
        async ({ where }: any) =>
          state.methodBindings.find((row: any) => row.id === where.id) || null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `binding-${state.methodBindings.length + 1}`,
          retiredAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.methodBindings.push(row);
        return row;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        let count = 0;
        for (const input of data) {
          const duplicate = state.methodBindings.some(
            (row: any) =>
              row.sourceRevisionId === input.sourceRevisionId &&
              row.deliveryMethodId === input.deliveryMethodId &&
              row.retiredAt === null,
          );
          if (duplicate) continue;
          state.methodBindings.push({
            id: `binding-${state.methodBindings.length + 1}`,
            retiredAt: null,
            createdAt: now,
            updatedAt: now,
            ...input,
          });
          count += 1;
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.methodBindings.find((item: any) => item.id === where.id);
        Object.assign(row, data);
        if (!data.updatedAt) row.updatedAt = nextVersion();
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.methodBindings.find(
          (item: any) =>
            item.id === where.id && item.updatedAt?.getTime() === where.updatedAt?.getTime(),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        if (!data.updatedAt) row.updatedAt = nextVersion();
        return { count: 1 };
      }),
    },
    officialSellerFormulaResolution: {
      findMany: vi.fn(async () => state.officialResolutions),
      findUnique: vi.fn(
        async ({ where }: any) =>
          state.officialResolutions.find(
            (row: any) => row.id === where.id || row.resolutionKey === where.resolutionKey,
          ) || null,
      ),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let row = state.officialResolutions.find(
          (item: any) => item.resolutionKey === where.resolutionKey,
        );
        if (row) {
          Object.assign(row, update);
          if (!update.updatedAt) row.updatedAt = nextVersion();
        } else {
          row = {
            id: `resolution-${state.officialResolutions.length + 1}`,
            invalidatedAt: null,
            createdAt: now,
            updatedAt: now,
            ...create,
          };
          state.officialResolutions.push(row);
        }
        return row;
      }),
      createMany: vi.fn(async ({ data }: any) => {
        let count = 0;
        for (const input of data) {
          if (
            state.officialResolutions.some((row: any) => row.resolutionKey === input.resolutionKey)
          )
            continue;
          state.officialResolutions.push({
            id: `resolution-${state.officialResolutions.length + 1}`,
            invalidatedAt: null,
            createdAt: now,
            updatedAt: now,
            ...input,
          });
          count += 1;
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.officialResolutions.find((item: any) => item.id === where.id);
        Object.assign(row, data);
        if (!data.updatedAt) row.updatedAt = nextVersion();
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.officialResolutions.find(
          (item: any) =>
            item.id === where.id && item.updatedAt?.getTime() === where.updatedAt?.getTime(),
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        if (!data.updatedAt) row.updatedAt = nextVersion();
        return { count: 1 };
      }),
    },
    logisticsRuleEvent: {
      create: vi.fn(async ({ data }: any) => {
        state.events.push(data);
        return { id: `event-${state.events.length}`, ...data };
      }),
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(client)),
  };
  return { client, state };
}

function repository(client: any) {
  return createPrismaLogisticsRuleAdminRepository({
    prisma: client,
    deploymentId: 'local-test',
    apiOrigin: 'http://localhost:3001',
    now: () => now,
  });
}

const methodSuggestion = {
  actorUserId: 'admin-2',
  channelId: 'channel-1',
  revisionId: 'revision-1',
  deliveryMethodId: 'method-1',
  stableServiceKey: 'service-1',
  note: 'exact method',
};

describe('Prisma logistics rule pilot management repository', () => {
  it('lists channels before selection and resolves the current release revision after selection', async () => {
    const { client } = fakeManagementPrisma();
    const repo = repository(client);
    const discovery = (await repo.readWorkspace({})) as any;
    expect(discovery).toMatchObject({
      channels: [
        {
          id: 'channel-1',
          deploymentId: 'local-test',
          schemaMajor: 1,
          currentReleaseId: 'release-2',
          currentSequence: 2,
        },
      ],
      channel: null,
    });
    expect(client.logisticsRuleChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deploymentId: 'local-test', schemaMajor: 1, retiredAt: null },
      }),
    );

    const selected = (await repo.readWorkspace({ channelId: 'channel-1' })) as any;
    expect(selected).toMatchObject({
      channel: { id: 'channel-1' },
      revision: { id: 'revision-1' },
    });
  });

  it.each([
    ['another deployment', { deploymentId: 'international-production' }],
    ['another schema major', { schemaMajor: 2 }],
  ])('hides a selected channel from %s', async (_label, scopePatch) => {
    const { client, state } = fakeManagementPrisma();
    Object.assign(state.channel, scopePatch);

    await expect(
      repository(client).readWorkspace({ channelId: 'channel-1' }),
    ).rejects.toMatchObject({ code: 'CHANNEL_NOT_FOUND', statusCode: 404 });
  });

  it('returns the complete scoped workspace without large frozen or raw payloads', async () => {
    const { client } = fakeManagementPrisma();
    const result = (await repository(client).readWorkspace({
      channelId: 'channel-1',
      revisionId: 'revision-1',
    })) as any;

    expect(result).toMatchObject({
      channel: {
        id: 'channel-1',
        companyBindingId: 'company-binding-1',
        originBindingId: 'origin-binding-1',
      },
      currentRelease: { id: 'release-2', sequence: 2 },
      releaseHistory: [{ id: 'release-2', sequence: 2 }],
      assignments: [{ id: 'assignment-1' }],
      companyBindings: [{ id: 'company-binding-1', status: 'VERIFIED' }],
      originBindings: [{ id: 'origin-binding-1', status: 'VERIFIED' }],
      deliveryMethods: [{ id: 'method-1', platformMethodId: 101 }],
      methodBindings: [],
      officialResolutions: [],
    });
    expect(JSON.stringify(result)).not.toContain('do-not-list');
    expect(JSON.stringify(result)).not.toContain('private-raw-method');
    expect(result.revision).not.toHaveProperty('payload');
  });

  it('validates revision service and actual method scope before suggesting and reviewing a binding', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestMethodBinding(methodSuggestion)) as any;
    expect(suggested).toMatchObject({
      id: 'binding-1',
      deliveryMethodId: 'method-1',
      stableServiceKey: 'service-1',
      status: 'SUGGESTED',
    });
    expect(suggested.evidence).toMatchObject({
      source: 'server-derived',
      reviewNote: 'exact method',
      sourceRevisionId: 'revision-1',
      service: { stableServiceKey: 'service-1', providerId: '1778' },
      deliveryMethod: {
        id: 'method-1',
        platformMethodId: 101,
        providerId: 1778,
      },
    });

    const confirmed = (await repo.reviewMethodBinding({
      actorUserId: 'admin-3',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      bindingId: 'binding-1',
      decision: 'CONFIRMED',
      note: 'checked',
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
    })) as any;
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      confirmedById: 'admin-3',
      confirmedAt: now,
    });
    expect(state.revision).toMatchObject({
      validationStatus: 'DRAFT',
      validationReport: null,
      validatedAt: null,
      validationValidUntil: null,
    });
    expect(state.events).toContainEqual(
      expect.objectContaining({
        type: 'BINDING_CHANGED',
        actorUserId: 'admin-3',
        subjectType: 'METHOD_BINDING',
      }),
    );

    const rejected = (await repo.reviewMethodBinding({
      actorUserId: 'admin-4',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      bindingId: 'binding-1',
      decision: 'REJECTED',
      note: 'mismatch',
      expectedUpdatedAt: confirmed.updatedAt.toISOString(),
    })) as any;
    expect(rejected).toMatchObject({ status: 'REJECTED', confirmedById: 'admin-4' });
    const eventCount = state.events.length;
    const duplicate = (await repo.suggestMethodBinding({
      ...methodSuggestion,
      note: 'retry after review',
    })) as any;
    expect(duplicate).toMatchObject({
      id: 'binding-1',
      status: 'REJECTED',
      stableServiceKey: 'service-1',
    });
    expect(state.methodBindings).toHaveLength(1);
    expect(state.events).toHaveLength(eventCount);

    await expect(
      repo.suggestMethodBinding({
        ...methodSuggestion,
        stableServiceKey: 'service-2',
        note: 'new match',
      }),
    ).rejects.toMatchObject({ code: 'SUGGESTION_CONFLICT', statusCode: 409 });
    expect(state.events).toHaveLength(eventCount);

    const originalRevision = state.revision;
    state.revision = { ...structuredClone(state.revision), id: 'revision-2' };
    const nextRevision = (await repo.suggestMethodBinding({
      ...methodSuggestion,
      revisionId: 'revision-2',
      stableServiceKey: 'service-2',
      note: 'new revision match',
    })) as any;
    expect(nextRevision).toMatchObject({
      id: 'binding-2',
      status: 'SUGGESTED',
      stableServiceKey: 'service-2',
      sourceRevisionId: 'revision-2',
    });
    expect(state.methodBindings).toHaveLength(2);
    state.revision = originalRevision;

    await expect(
      repo.suggestMethodBinding({ ...methodSuggestion, note: '' }),
    ).rejects.toMatchObject({ code: 'REVIEW_NOTE_REQUIRED' });
    await expect(
      repo.suggestMethodBinding({ ...methodSuggestion, stableServiceKey: 'unknown-service' }),
    ).rejects.toMatchObject({ code: 'SERVICE_NOT_IN_REVISION' });
    await expect(
      repo.suggestMethodBinding({ ...methodSuggestion, deliveryMethodId: 'other-method' }),
    ).rejects.toMatchObject({ code: 'DELIVERY_METHOD_NOT_IN_SCOPE' });
  });

  it('allows only one concurrent method review for the same updatedAt version', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestMethodBinding(methodSuggestion)) as any;
    let releaseReads!: () => void;
    const readsReady = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let reads = 0;
    client.shopDeliveryMethodRuleBinding.findUnique.mockImplementation(async ({ where }: any) => {
      const row = state.methodBindings.find((item: any) => item.id === where.id) || null;
      const snapshot = row ? structuredClone(row) : null;
      reads += 1;
      if (reads === 2) releaseReads();
      await readsReady;
      return snapshot;
    });
    const base = {
      actorUserId: 'admin-3',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      bindingId: suggested.id,
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
      note: 'concurrent review',
    };

    const results = await Promise.allSettled([
      repo.reviewMethodBinding({ ...base, decision: 'CONFIRMED' }),
      repo.reviewMethodBinding({ ...base, actorUserId: 'admin-4', decision: 'REJECTED' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'REVIEW_CONFLICT', statusCode: 409 });
    expect(['CONFIRMED', 'REJECTED']).toContain(state.methodBindings[0].status);
    expect(state.events.filter((event: any) => event.facts.action !== 'SUGGESTED')).toHaveLength(1);
  });

  it('derives and validates the Official candidate set before confirmation or rejection', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'review exact sample',
    })) as any;
    expect(suggested.candidateServiceKeys).toEqual(['service-1']);
    expect(suggested.candidateSetChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(suggested.evidence).toMatchObject({
      source: 'server-derived',
      reviewNote: 'review exact sample',
      requirementKey: 'requirement-1',
      officialSourceRevision: 'official-r1',
      officialBatchChecksum: 'b'.repeat(64),
      officialSampleChecksum: 'c'.repeat(64),
      fingerprintKey: 'fingerprint-1',
      destination: {
        countryUid: 'russia',
        locationUid: 'moscow',
      },
    });

    const secondSuggestion = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-2',
      note: 'review second service on same sample',
    })) as any;
    expect(secondSuggestion).toMatchObject({
      id: 'resolution-2',
      officialFingerprint: 'fingerprint-1',
      candidateServiceKeys: ['service-2'],
      evidence: { requirementKey: 'requirement-2' },
    });

    const originalTariffs = structuredClone(state.revision.payload.officialSamples[0].tariffs);
    state.revision.payload.officialSamples[0].tariffs = originalTariffs.slice(1);
    await expect(
      repo.reviewOfficialResolution({
        actorUserId: 'admin-3',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        resolutionId: suggested.id,
        decision: 'CONFIRMED',
        selectedServiceKey: 'service-1',
        note: 'variant checked',
        expectedUpdatedAt: suggested.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_SET_CHANGED' });
    state.revision.payload.officialSamples[0].tariffs = originalTariffs;

    const confirmed = (await repo.reviewOfficialResolution({
      actorUserId: 'admin-3',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      resolutionId: suggested.id,
      decision: 'CONFIRMED',
      selectedServiceKey: 'service-1',
      note: 'variant checked',
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
    })) as any;
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      selectedServiceKey: 'service-1',
      reviewedById: 'admin-3',
      reviewedAt: now,
      evidence: {
        source: 'server-derived',
        reviewNote: 'variant checked',
        providerId: '1778',
        deliveryVariant: 'pickup',
        officialStableServiceKey: 'official-service-1',
      },
    });
    expect(state.events).toContainEqual(
      expect.objectContaining({
        type: 'BINDING_CHANGED',
        subjectType: 'OFFICIAL_RESOLUTION',
        subjectId: suggested.id,
      }),
    );
    const rejected = (await repo.reviewOfficialResolution({
      actorUserId: 'admin-4',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      resolutionId: suggested.id,
      decision: 'REJECTED',
      note: 'ambiguous variant',
      expectedUpdatedAt: confirmed.updatedAt.toISOString(),
    })) as any;
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      selectedServiceKey: null,
      reviewedById: 'admin-4',
      evidence: expect.objectContaining({ reviewNote: 'ambiguous variant' }),
    });
    const officialEventCount = state.events.length;
    const duplicate = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'retry reviewed suggestion',
    })) as any;
    expect(duplicate).toMatchObject({
      id: suggested.id,
      status: 'REJECTED',
      selectedServiceKey: null,
    });
    expect(state.events).toHaveLength(officialEventCount);

    const destination = state.revision.payload.officialSamples[0].fingerprint.destination;
    const originalLocationUid = destination.locationUid;
    destination.locationUid = 'st-petersburg';
    await expect(
      repo.suggestOfficialResolution({
        actorUserId: 'admin-2',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        requirementKey: 'requirement-1',
        note: 'changed evidence',
      }),
    ).rejects.toMatchObject({ code: 'SUGGESTION_CONFLICT', statusCode: 409 });
    destination.locationUid = originalLocationUid;
    expect(state.events).toHaveLength(officialEventCount);

    await expect(
      repo.suggestOfficialResolution({
        actorUserId: 'admin-2',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        requirementKey: 'unknown-requirement',
        note: 'review unknown sample',
      }),
    ).rejects.toMatchObject({ code: 'OFFICIAL_REQUIREMENT_NOT_IN_REVISION' });

    state.revision.payload.officialSamples[0].tariffs = [];
    await expect(
      repo.suggestOfficialResolution({
        actorUserId: 'admin-2',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        requirementKey: 'requirement-1',
        note: 'review empty candidates',
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_SET_EMPTY' });
  });

  it('allows only one concurrent Official review for the same updatedAt version', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'review exact sample',
    })) as any;
    let releaseReads!: () => void;
    const readsReady = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let reads = 0;
    client.officialSellerFormulaResolution.findUnique.mockImplementation(async ({ where }: any) => {
      const row = state.officialResolutions.find((item: any) => item.id === where.id) || null;
      const snapshot = row ? structuredClone(row) : null;
      reads += 1;
      if (reads === 2) releaseReads();
      await readsReady;
      return snapshot;
    });
    const base = {
      actorUserId: 'admin-3',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      resolutionId: suggested.id,
      expectedUpdatedAt: suggested.updatedAt.toISOString(),
      note: 'concurrent review',
    };

    const results = await Promise.allSettled([
      repo.reviewOfficialResolution({
        ...base,
        decision: 'CONFIRMED',
        selectedServiceKey: 'service-1',
      }),
      repo.reviewOfficialResolution({ ...base, actorUserId: 'admin-4', decision: 'REJECTED' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'REVIEW_CONFLICT', statusCode: 409 });
    expect(['CONFIRMED', 'REJECTED']).toContain(state.officialResolutions[0].status);
    expect(state.events.filter((event: any) => event.facts.action !== 'SUGGESTED')).toHaveLength(1);
  });

  it('selects the active Official batch and deduplicates coherent capture retries', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const active = structuredClone(state.revision.payload.officialSamples[0]);
    state.revision.payload.officialSamples = [
      {
        ...structuredClone(active),
        sourceRevision: 'official-old',
        batchChecksum: 'd'.repeat(64),
        sampleChecksum: 'e'.repeat(64),
        capturedAt: '2026-07-11T12:00:00.000Z',
      },
      active,
      {
        ...structuredClone(active),
        capturedAt: '2026-07-12T12:00:01.000Z',
      },
    ];

    const suggested = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'review active retry',
    })) as any;

    expect(suggested.evidence).toMatchObject({
      requirementKey: 'requirement-1',
      officialSourceRevision: 'official-r1',
      officialBatchChecksum: 'b'.repeat(64),
      officialSampleChecksum: 'c'.repeat(64),
    });
  });

  it('rejects an active retry whose checksum maps to conflicting Official content', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const active = structuredClone(state.revision.payload.officialSamples[0]);
    const conflict = structuredClone(active);
    conflict.tariffs[0].normalizedDescription = 'conflicting tariff';
    state.revision.payload.officialSamples = [active, conflict];

    await expect(
      repo.suggestOfficialResolution({
        actorUserId: 'admin-2',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        requirementKey: 'requirement-1',
        note: 'review conflicting retry',
      }),
    ).rejects.toMatchObject({ code: 'OFFICIAL_SAMPLE_CHECKSUM_CONFLICT' });
  });

  it('keeps overlapping candidates isolated by requirement identity', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    state.revision.payload.services[1] = {
      ...structuredClone(state.revision.payload.services[0]),
      stableServiceKey: 'service-2',
    };
    state.revision.payload.validationMatrix.requirements[1].expectedDeliveryVariant = 'pickup';
    state.revision.payload.officialSamples[0].tariffs = [
      structuredClone(state.revision.payload.officialSamples[0].tariffs[0]),
    ];

    const first = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-1',
      note: 'review first overlap',
    })) as any;
    const second = (await repo.suggestOfficialResolution({
      actorUserId: 'admin-2',
      channelId: 'channel-1',
      revisionId: 'revision-1',
      requirementKey: 'requirement-2',
      note: 'review second overlap',
    })) as any;

    expect(first).toMatchObject({
      candidateServiceKeys: ['service-1', 'service-2'],
      evidence: { requirementKey: 'requirement-1' },
    });
    expect(second).toMatchObject({
      id: 'resolution-2',
      candidateServiceKeys: ['service-1', 'service-2'],
      evidence: { requirementKey: 'requirement-2' },
    });
    expect(first.id).not.toBe(second.id);

    await expect(
      repo.reviewOfficialResolution({
        actorUserId: 'admin-3',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        resolutionId: first.id,
        decision: 'CONFIRMED',
        selectedServiceKey: 'service-2',
        note: 'confirm overlapping candidate',
        expectedUpdatedAt: first.updatedAt.toISOString(),
      }),
    ).resolves.toMatchObject({
      selectedServiceKey: 'service-2',
      evidence: { requirementKey: 'requirement-1' },
    });
  });
  it('keeps a pending method suggestion valid across metadata-only delivery method refreshes', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestMethodBinding(methodSuggestion)) as any;
    const eventCount = state.events.length;

    state.deliveryMethods[0].updatedAt = new Date(now.getTime() + 60_000);

    await expect(
      repo.suggestMethodBinding({
        ...methodSuggestion,
        note: 'retry after no-op warehouse sync',
      }),
    ).resolves.toMatchObject({
      id: suggested.id,
      status: 'SUGGESTED',
    });
    expect(state.events).toHaveLength(eventCount);
    await expect(
      repo.reviewMethodBinding({
        actorUserId: 'admin-3',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        bindingId: suggested.id,
        decision: 'CONFIRMED',
        note: 'semantic facts unchanged',
        expectedUpdatedAt: suggested.updatedAt.toISOString(),
      }),
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('rejects a pending method suggestion after semantic delivery method facts change', async () => {
    const { client, state } = fakeManagementPrisma();
    const repo = repository(client);
    const suggested = (await repo.suggestMethodBinding(methodSuggestion)) as any;

    state.deliveryMethods[0].providerId = 9999;
    state.deliveryMethods[0].updatedAt = new Date(now.getTime() + 60_000);

    await expect(
      repo.suggestMethodBinding({
        ...methodSuggestion,
        note: 'retry after provider change',
      }),
    ).rejects.toMatchObject({ code: 'SUGGESTION_CONFLICT', statusCode: 409 });
    await expect(
      repo.reviewMethodBinding({
        actorUserId: 'admin-3',
        channelId: 'channel-1',
        revisionId: 'revision-1',
        bindingId: suggested.id,
        decision: 'CONFIRMED',
        note: 'provider facts changed',
        expectedUpdatedAt: suggested.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'BINDING_EVIDENCE_CHANGED', statusCode: 409 });
  });
});
