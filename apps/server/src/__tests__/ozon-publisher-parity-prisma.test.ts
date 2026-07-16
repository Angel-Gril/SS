import { describe, expect, it, vi } from 'vitest';

import { compareOzonPublisherEntrypointParity } from '../services/ozon-publisher-entrypoint-parity.js';
import { createOzonPublisherParityObservationService } from '../services/ozon-publisher-parity-observations.js';
import { createPrismaOzonPublisherParityObservationRepository } from '../services/ozon-publisher-parity-prisma.js';

const NOW = new Date('2026-07-16T03:00:00.000Z');

function report() {
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: {
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer', weight: 500 }] },
    },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function memoryClient() {
  const observations = new Map<string, any>();
  const subjects = new Map<string, any>();
  const decisions = new Map<string, any>();
  const observationCreate = vi.fn(async ({ data }: any) => {
    observations.set(data.recordKey, { ...data });
    if (data.differenceSubjectKey) {
      const current = subjects.get(data.differenceSubjectKey);
      if (!current) throw new Error('difference subject must exist before its observation');
      const observedAt = new Date(data.observedAt);
      subjects.set(data.differenceSubjectKey, {
        ...current,
        observationCount: current.observationCount + 1,
        firstObservedAt: new Date(Math.min(
          new Date(current.firstObservedAt).getTime(),
          observedAt.getTime(),
        )),
        lastObservedAt: new Date(Math.max(
          new Date(current.lastObservedAt).getTime(),
          observedAt.getTime(),
        )),
        updatedAt: new Date(Math.max(
          new Date(current.updatedAt).getTime(),
          observedAt.getTime(),
        )),
      });
    }
    return { ...data };
  });
  const subjectCreate = vi.fn(async ({ data }: any) => {
    subjects.set(data.subjectKey, { ...data });
    return { ...data };
  });
  const subjectUpdate = vi.fn(async () => {
    throw new Error('subject observation aggregates are database-owned');
  });
  const subjectUpdateMany = vi.fn(async ({ where, data }: any) => {
    const current = subjects.get(where.subjectKey);
    if (!current
      || current.stateVersion !== where.stateVersion
      || current.approvalState !== where.approvalState) return { count: 0 };
    subjects.set(where.subjectKey, { ...current, ...data });
    return { count: 1 };
  });
  const decisionCreate = vi.fn(async ({ data }: any) => {
    decisions.set(`${data.subjectKey}:${data.transitionVersion}`, { ...data });
    return { ...data };
  });
  const model = {
    ozonPublisherParityObservation: {
      findUnique: vi.fn(async ({ where }: any) => observations.get(where.recordKey) || null),
      create: observationCreate,
      findMany: vi.fn(async () => [...observations.values()]),
      deleteMany: vi.fn(async ({ where }: any) => {
        const ids = new Set(where.id.in);
        let count = 0;
        for (const [key, value] of observations) {
          if (ids.has(value.id)) {
            observations.delete(key);
            count += 1;
          }
        }
        return { count };
      }),
    },
    ozonPublisherParityDifferenceSubject: {
      findUnique: vi.fn(async ({ where }: any) => subjects.get(where.subjectKey) || null),
      create: subjectCreate,
      update: subjectUpdate,
      updateMany: subjectUpdateMany,
      findMany: vi.fn(async () => [...subjects.values()]),
    },
    ozonPublisherParityDecision: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.subjectKey_transitionVersion;
        return decisions.get(`${key.subjectKey}:${key.transitionVersion}`) || null;
      }),
      create: decisionCreate,
    },
  };
  return {
    ...model,
    $transaction: vi.fn(async (callback: (tx: typeof model) => Promise<unknown>) => callback(model)),
    observations,
    subjects,
    decisions,
    observationCreate,
    subjectCreate,
    subjectUpdate,
    subjectUpdateMany,
    decisionCreate,
  };
}

describe('Prisma Ozon publisher parity observation repository', () => {
  it('atomically records one sanitized observation and leaves subject aggregation to the database', async () => {
    const client = memoryClient();
    const repository = createPrismaOzonPublisherParityObservationRepository({
      client,
      createId: () => 'decision-1',
    });
    const service = createOzonPublisherParityObservationService({
      repository,
      now: () => NOW,
      createId: () => 'observation-1',
    });
    const input = {
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-1',
      report: report(),
    };

    const first = await service.recordObservation(input);
    const retry = await service.recordObservation(input);
    const earlierService = createOzonPublisherParityObservationService({
      repository,
      now: () => new Date('2026-07-16T02:00:00.000Z'),
      createId: () => 'observation-2',
    });
    await earlierService.recordObservation(input);

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(client.observationCreate).toHaveBeenCalledTimes(2);
    expect(client.subjectCreate).toHaveBeenCalledOnce();
    expect(client.subjectUpdate).not.toHaveBeenCalled();
    expect(client.subjectCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recordContractVersion: 'ozon-publisher-parity-difference-subject/v1',
        reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
        legacyItemCount: 1,
        v2ItemCount: 1,
        observationCount: 0,
        firstObservedAt: NOW,
        lastObservedAt: NOW,
      }),
    });
    expect([...client.subjects.values()][0]).toMatchObject({
      rolloutRevision: 'rollout-1',
      approvalState: 'PENDING',
      stateVersion: 0,
      observationCount: 2,
      firstObservedAt: new Date('2026-07-16T02:00:00.000Z'),
      lastObservedAt: NOW,
      differenceRows: [{ path: '/items/0/weight' }],
      legacyItemCount: 1,
      v2ItemCount: 1,
    });
    expect(first.observation).toMatchObject({
      contractVersion: 'ozon-publisher-parity-observation/v1',
      report: {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        legacy: { itemCount: 1 },
        v2: { itemCount: 1 },
      },
    });
    expect([...client.observations.values()][0]).toMatchObject({
      recordContractVersion: 'ozon-publisher-parity-observation/v1',
      reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
    });
    await expect(service.getDifferenceSubject({
      subjectKey: first.observation.differenceSubjectKey!,
    })).resolves.toMatchObject({
      contractVersion: 'ozon-publisher-parity-difference-subject/v1',
      observationCount: 2,
      legacyItemCount: 1,
      v2ItemCount: 1,
    });
    const serialized = JSON.stringify([...client.observations.values()]);
    expect(serialized).not.toContain('private-offer');
    expect(serialized).not.toContain('Bearer');
  });

  it.each(['legacyItemCount', 'v2ItemCount'] as const)(
    'rejects an existing subject whose %s no longer matches the derived identity',
    async (field) => {
      const client = memoryClient();
      const repository = createPrismaOzonPublisherParityObservationRepository({ client });
      const firstService = createOzonPublisherParityObservationService({
        repository,
        now: () => NOW,
        createId: () => 'observation-1',
      });
      const input = {
        scopeHash: 'a'.repeat(64),
        rolloutRevision: 'rollout-1',
        report: report(),
      };
      const recorded = await firstService.recordObservation(input);
      const subjectKey = recorded.observation.differenceSubjectKey!;
      const subject = client.subjects.get(subjectKey);
      client.subjects.set(subjectKey, { ...subject, [field]: subject[field] + 1 });
      const retryService = createOzonPublisherParityObservationService({
        repository,
        now: () => new Date('2026-07-16T04:00:00.000Z'),
        createId: () => 'observation-2',
      });

      await expect(retryService.recordObservation(input)).rejects.toMatchObject({
        code: 'OZON_PUBLISHER_PARITY_IDEMPOTENCY_CONFLICT',
      });
      expect(client.observationCreate).toHaveBeenCalledOnce();
      expect(client.subjectUpdate).not.toHaveBeenCalled();
    },
  );

  it('requires exact non-null compiler versions before a subject can be approved', async () => {
    const client = memoryClient();
    const repository = createPrismaOzonPublisherParityObservationRepository({ client });
    const service = createOzonPublisherParityObservationService({
      repository,
      now: () => NOW,
      createId: () => 'observation-1',
    });
    const recorded = await service.recordObservation({
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-1',
      report: report(),
    });
    const subject = client.subjects.get(recorded.observation.differenceSubjectKey!);
    client.subjects.set(subject.subjectKey, {
      ...subject,
      publisherContractVersion: null,
    });

    await expect(service.reviewDifference({
      action: 'APPROVE',
      subjectKey: subject.subjectKey,
      expectedTransitionVersion: 0,
      actorUserId: 'super-admin-1',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Compiler evidence is incomplete.',
    })).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_PARITY_DIFFERENCE_NOT_APPROVABLE',
    });
    client.subjects.set(subject.subjectKey, {
      ...subject,
      payloadCompilerVersion: 'ozon-listing-payload-compiler/v2',
    });
    await expect(service.reviewDifference({
      action: 'APPROVE',
      subjectKey: subject.subjectKey,
      expectedTransitionVersion: 0,
      actorUserId: 'super-admin-1',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Compiler evidence has drifted.',
    })).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_PARITY_DIFFERENCE_NOT_APPROVABLE',
    });
    expect(client.subjectUpdateMany).not.toHaveBeenCalled();
  });

  it('applies review CAS, returns exact retries idempotently, and rejects changed requests', async () => {
    const client = memoryClient();
    const createDecisionId = vi.fn()
      .mockReturnValueOnce('decision-1')
      .mockReturnValueOnce('decision-2');
    const repository = createPrismaOzonPublisherParityObservationRepository({
      client,
      createId: createDecisionId,
    });
    const service = createOzonPublisherParityObservationService({
      repository,
      now: () => NOW,
      createId: () => 'observation-1',
    });
    const recorded = await service.recordObservation({
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-1',
      report: report(),
    });
    const input = {
      action: 'APPROVE' as const,
      subjectKey: recorded.observation.differenceSubjectKey!,
      expectedTransitionVersion: 0,
      actorUserId: 'super-admin-1',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Approved intentional removal of the fabricated default.',
    };

    const first = await service.reviewDifference(input);
    const retry = await service.reviewDifference(input);

    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(client.subjectUpdateMany).toHaveBeenCalledOnce();
    expect(client.decisionCreate).toHaveBeenCalledOnce();
    expect([...client.subjects.values()][0]).toMatchObject({
      approvalState: 'APPROVED',
      stateVersion: 1,
      reviewedByUserId: 'super-admin-1',
    });
    await expect(service.reviewDifference({
      ...input,
      reviewNote: 'Changed note must conflict with the prior operation key.',
    })).rejects.toMatchObject({ code: 'OZON_PUBLISHER_PARITY_IDEMPOTENCY_CONFLICT' });
    await expect(service.reviewDifference({
      ...input,
      actorUserId: 'other-super-admin',
    })).rejects.toMatchObject({ code: 'OZON_PUBLISHER_PARITY_VERSION_CONFLICT' });

    await expect(service.reviewDifference({
      ...input,
      action: 'REVOKE',
      expectedTransitionVersion: 1,
      reviewNote: 'The rollout decision no longer applies.',
    })).resolves.toMatchObject({
      idempotent: false,
      review: { status: 'REVOKED', transitionVersion: 2 },
    });
    await expect(service.reviewDifference(input)).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_PARITY_VERSION_CONFLICT',
    });
    expect(client.subjectUpdateMany).toHaveBeenCalledTimes(2);
    expect(client.decisionCreate).toHaveBeenCalledTimes(2);
  });

  it('prunes only expired observation rows and retains subjects and decisions', async () => {
    const client = memoryClient();
    const repository = createPrismaOzonPublisherParityObservationRepository({ client });
    const service = createOzonPublisherParityObservationService({
      repository,
      now: () => NOW,
      createId: () => 'observation-1',
    });
    await service.recordObservation({
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-1',
      report: report(),
      retentionDays: 30,
    });

    const result = await service.pruneExpiredObservations({
      expiredBefore: new Date('2026-08-16T03:00:00.000Z'),
      limit: 100,
    });

    expect(result).toEqual({ deletedCount: 1, hasMore: false });
    expect(client.observations.size).toBe(0);
    expect(client.subjects.size).toBe(1);
  });
});
