import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  compareOzonPublisherEntrypointParity,
  OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
} from '../services/ozon-publisher-entrypoint-parity.js';
import {
  createOzonPublisherParityObservationService,
  OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION,
  OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION,
} from '../services/ozon-publisher-parity-observations.js';
import { createPrismaOzonPublisherParityObservationRepository } from '../services/ozon-publisher-parity-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1' && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function isolatedSchema(urlText: string): string {
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must use an isolated logistics_test_* schema');
  }
  return schema;
}

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

function matchingReport() {
  const payload = { items: [{ offer_id: 'matching-offer' }] };
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: { endpoint: '/v3/product/import', payload },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: structuredClone(payload),
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function defectReport() {
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: {
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'defect-offer', name: 'Original title' }] },
    },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'defect-offer', name: 'Changed title' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function randomHexKey(): string {
  return randomUUID().replaceAll('-', '').repeat(2);
}

function observationService(input: {
  client: PrismaClient;
  id: string;
  now: Date;
}) {
  return createOzonPublisherParityObservationService({
    repository: createPrismaOzonPublisherParityObservationRepository({
      client: input.client as never,
      createId: () => `${input.id}_decision`,
    }),
    now: () => input.now,
    createId: () => input.id,
  });
}

function cloneObservationWithOverrides(
  client: PrismaClient,
  sourceId: string,
  overrides: Record<string, unknown>,
) {
  return client.$executeRawUnsafe(
    `INSERT INTO "ozon_publisher_parity_observations"
     SELECT (jsonb_populate_record(
       NULL::"ozon_publisher_parity_observations",
       to_jsonb(source_row) || $1::jsonb
     )).*
     FROM "ozon_publisher_parity_observations" source_row
     WHERE source_row."id" = $2`,
    JSON.stringify({
      id: `clone_${randomUUID()}`,
      record_key: randomHexKey(),
      ...overrides,
    }),
    sourceId,
  );
}

describePostgres('Ozon publisher parity PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = isolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const current = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(current[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ migrationName: string }>>(
      `SELECT "migration_name" AS "migrationName" FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260716010000_add_ozon_publisher_parity_observations',
         '20260716011000_harden_ozon_publisher_parity_observations',
         '20260716012000_complete_ozon_publisher_parity_provenance'
       ) AND "finished_at" IS NOT NULL
       ORDER BY "migration_name"`,
    );
    expect(migrations.map(({ migrationName }) => migrationName)).toEqual([
      '20260716010000_add_ozon_publisher_parity_observations',
      '20260716011000_harden_ozon_publisher_parity_observations',
      '20260716012000_complete_ozon_publisher_parity_provenance',
    ]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('round-trips record contracts separately and rejects observation updates while allowing retention deletes', async () => {
    const prefix = `contracts_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const observedAt = new Date('2026-01-01T03:00:00.000Z');
    const service = observationService({
      client: first,
      id: `${prefix}_observation`,
      now: observedAt,
    });
    const recorded = await service.recordObservation({
      scopeHash: '1'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: report(),
      retentionDays: 30,
    });
    const subjectKey = recorded.observation.differenceSubjectKey!;
    const subject = await service.getDifferenceSubject({ subjectKey });
    const persisted = await first.$queryRawUnsafe<Array<{
      observationRecordContract: string;
      observationReportContract: string;
      subjectRecordContract: string;
      subjectReportContract: string;
    }>>(
      `SELECT
         observation."record_contract_version" AS "observationRecordContract",
         observation."report_contract_version" AS "observationReportContract",
         subject."record_contract_version" AS "subjectRecordContract",
         subject."report_contract_version" AS "subjectReportContract"
       FROM "ozon_publisher_parity_observations" observation
       JOIN "ozon_publisher_parity_difference_subjects" subject
         ON subject."subject_key" = observation."difference_subject_key"
       WHERE observation."id" = $1`,
      recorded.observation.id,
    );

    expect(recorded.observation.contractVersion)
      .toBe(OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION);
    expect(recorded.observation.report.contractVersion)
      .toBe(OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION);
    expect(subject?.contractVersion)
      .toBe(OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION);
    expect(persisted).toEqual([{
      observationRecordContract: OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION,
      observationReportContract: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
      subjectRecordContract: OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION,
      subjectReportContract: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
    }]);

    await expect(first.$executeRawUnsafe(
      `UPDATE "ozon_publisher_parity_observations"
       SET "expires_at" = "expires_at" + INTERVAL '1 day'
       WHERE "id" = $1`,
      recorded.observation.id,
    )).rejects.toBeTruthy();

    const pruned = await service.pruneExpiredObservations({
      expiredBefore: new Date('2026-03-01T00:00:00.000Z'),
      limit: 10,
    });
    expect(pruned).toMatchObject({ deletedCount: 1, hasMore: false });
    await expect(first.ozonPublisherParityObservation.count({
      where: { id: recorded.observation.id },
    })).resolves.toBe(0);
  }, 30_000);

  it('rejects null exact compiler versions for both MATCH and DIFFERENT observations', async () => {
    const prefix = `compiler_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const observedAt = new Date('2026-07-16T04:00:00.000Z');
    const matching = await observationService({
      client: first,
      id: `${prefix}_match`,
      now: observedAt,
    }).recordObservation({
      scopeHash: '2'.repeat(64),
      rolloutRevision: `${prefix}_match_rollout`,
      report: matchingReport(),
      retentionDays: 30,
    });
    const different = await observationService({
      client: first,
      id: `${prefix}_different`,
      now: observedAt,
    }).recordObservation({
      scopeHash: '3'.repeat(64),
      rolloutRevision: `${prefix}_different_rollout`,
      report: report(),
      retentionDays: 30,
    });

    for (const source of [matching.observation, different.observation]) {
      for (const compilerColumn of [
        'publisher_contract_version',
        'payload_compiler_version',
      ]) {
        await expect(cloneObservationWithOverrides(first, source.id, {
          [compilerColumn]: null,
          difference_subject_key: null,
          full_difference_signature: null,
        })).rejects.toBeTruthy();
      }
    }
  }, 30_000);

  it('keeps difference-subject aggregates database-owned and expands them on observation insert', async () => {
    const prefix = `aggregate_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const rolloutRevision = `${prefix}_rollout`;
    const firstObservedAt = new Date('2026-07-16T03:00:00.000Z');
    const initial = await observationService({
      client: first,
      id: `${prefix}_initial`,
      now: firstObservedAt,
    }).recordObservation({
      scopeHash: '4'.repeat(64),
      rolloutRevision,
      report: report(),
      retentionDays: 30,
    });
    const subjectKey = initial.observation.differenceSubjectKey!;

    await expect(cloneObservationWithOverrides(first, initial.observation.id, {
      legacy_item_count: initial.observation.report.legacy.itemCount + 1,
    })).rejects.toBeTruthy();
    await expect(cloneObservationWithOverrides(first, initial.observation.id, {
      v2_item_count: initial.observation.report.v2.itemCount! + 1,
    })).rejects.toBeTruthy();

    await expect(first.$executeRawUnsafe(
      `UPDATE "ozon_publisher_parity_difference_subjects"
       SET "observation_count" = 999,
           "first_observed_at" = "first_observed_at" - INTERVAL '1 day',
           "last_observed_at" = "last_observed_at" + INTERVAL '1 day'
       WHERE "subject_key" = $1`,
      subjectKey,
    )).rejects.toBeTruthy();

    await observationService({
      client: first,
      id: `${prefix}_earlier`,
      now: new Date('2026-07-16T02:00:00.000Z'),
    }).recordObservation({
      scopeHash: '5'.repeat(64),
      rolloutRevision,
      report: report(),
      retentionDays: 30,
    });
    await observationService({
      client: first,
      id: `${prefix}_later`,
      now: new Date('2026-07-16T04:00:00.000Z'),
    }).recordObservation({
      scopeHash: '6'.repeat(64),
      rolloutRevision,
      report: report(),
      retentionDays: 30,
    });

    const aggregate = await first.ozonPublisherParityDifferenceSubject.findUniqueOrThrow({
      where: { subjectKey },
    });
    expect(aggregate.observationCount).toBe(3);
    expect(aggregate.firstObservedAt.toISOString()).toBe('2026-07-16T02:00:00.000Z');
    expect(aggregate.lastObservedAt.toISOString()).toBe('2026-07-16T04:00:00.000Z');
  }, 30_000);

  it('serializes a concurrent observation insert before the approval decision snapshot', async () => {
    const prefix = `interleave_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const actorUserId = `${prefix}_admin`;
    const initialAt = new Date('2026-07-16T07:00:00.000Z');
    const laterAt = new Date('2026-07-16T08:00:00.000Z');
    await first.$executeRawUnsafe(
      `INSERT INTO "users"
        ("id", "phone", "password_hash", "role", "is_super_admin", "updated_at")
       VALUES ($1, $2, $3, 'ADMIN', TRUE, $4)`,
      actorUserId, `${prefix}_phone`, 'test-password-hash', initialAt,
    );
    const initial = await observationService({
      client: first,
      id: `${prefix}_initial`,
      now: initialAt,
    }).recordObservation({
      scopeHash: '9'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: report(),
      retentionDays: 30,
    });
    const subjectKey = initial.observation.differenceSubjectKey!;

    let releaseFirstRead!: () => void;
    const firstReadReleased = new Promise<void>((resolve) => { releaseFirstRead = resolve; });
    let signalFirstRead!: () => void;
    const firstRead = new Promise<void>((resolve) => { signalFirstRead = resolve; });
    let transactionAttempts = 0;
    let paused = false;
    const reviewClient = {
      ozonPublisherParityDifferenceSubject: {
        findUnique: (args: unknown) => first.ozonPublisherParityDifferenceSubject.findUnique(
          args as never,
        ),
      },
      $transaction: (callback: (tx: unknown) => Promise<unknown>, options: unknown) => {
        transactionAttempts += 1;
        return first.$transaction(async (tx) => callback({
          ozonPublisherParityDifferenceSubject: {
            findUnique: async (args: unknown) => {
              const row = await tx.ozonPublisherParityDifferenceSubject.findUnique(args as never);
              if (!paused) {
                paused = true;
                signalFirstRead();
                await firstReadReleased;
              }
              return row;
            },
            updateMany: (args: unknown) => (
              tx.ozonPublisherParityDifferenceSubject.updateMany(args as never)
            ),
          },
          ozonPublisherParityDecision: {
            findUnique: (args: unknown) => tx.ozonPublisherParityDecision.findUnique(args as never),
            create: (args: unknown) => tx.ozonPublisherParityDecision.create(args as never),
          },
        }), options as never);
      },
    };
    const reviewService = createOzonPublisherParityObservationService({
      repository: createPrismaOzonPublisherParityObservationRepository({
        client: reviewClient as never,
        createId: () => `${prefix}_decision`,
      }),
      now: () => laterAt,
    });
    const reviewPromise = reviewService.reviewDifference({
      action: 'APPROVE',
      subjectKey,
      expectedTransitionVersion: 0,
      actorUserId,
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Approved after serializing the concurrent observation.',
    });

    await firstRead;
    await observationService({
      client: second,
      id: `${prefix}_later`,
      now: laterAt,
    }).recordObservation({
      scopeHash: 'b'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: report(),
      retentionDays: 30,
    });
    releaseFirstRead();
    const reviewed = await reviewPromise;

    expect(reviewed).toMatchObject({ idempotent: false, review: { status: 'APPROVED' } });
    expect(transactionAttempts).toBeGreaterThanOrEqual(2);
    await expect(first.ozonPublisherParityDifferenceSubject.findUniqueOrThrow({
      where: { subjectKey },
    })).resolves.toMatchObject({ observationCount: 2, approvalState: 'APPROVED' });
    await expect(first.ozonPublisherParityDecision.findFirstOrThrow({
      where: { subjectKey },
    })).resolves.toMatchObject({
      observationCountSnapshot: 2,
      firstObservedAtSnapshot: initialAt,
      lastObservedAtSnapshot: laterAt,
    });
  }, 60_000);

  it('forbids approving a DEFECT difference subject at the database boundary', async () => {
    const prefix = `defect_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const actorUserId = `${prefix}_admin`;
    const reviewedAt = new Date('2026-07-16T05:00:00.000Z');
    await first.$executeRawUnsafe(
      `INSERT INTO "users"
        ("id", "phone", "password_hash", "role", "is_super_admin", "updated_at")
       VALUES ($1, $2, $3, 'ADMIN', TRUE, $4)`,
      actorUserId, `${prefix}_phone`, 'test-password-hash', reviewedAt,
    );
    const recorded = await observationService({
      client: first,
      id: `${prefix}_observation`,
      now: reviewedAt,
    }).recordObservation({
      scopeHash: '7'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: defectReport(),
      retentionDays: 30,
    });
    const subjectKey = recorded.observation.differenceSubjectKey!;
    await expect(first.$executeRawUnsafe(
      `UPDATE "ozon_publisher_parity_difference_subjects"
       SET "approval_state" = 'APPROVED',
           "state_version" = 1,
           "reviewed_by_user_id" = $1,
           "review_note" = 'Attempted direct defect approval',
           "reviewed_at" = $2,
           "approved_at" = $2,
           "updated_at" = $2
       WHERE "subject_key" = $3`,
      actorUserId, reviewedAt, subjectKey,
    )).rejects.toBeTruthy();
    await expect(first.ozonPublisherParityDifferenceSubject.findUniqueOrThrow({
      where: { subjectKey },
      select: { classification: true, approvalState: true, stateVersion: true },
    })).resolves.toEqual({
      classification: 'DEFECT',
      approvalState: 'PENDING',
      stateVersion: 0,
    });
  }, 30_000);

  it('rejects difference-row JSON with fields outside the fixed evidence contract', async () => {
    const prefix = `rows_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const recorded = await observationService({
      client: first,
      id: `${prefix}_observation`,
      now: new Date('2026-07-16T06:00:00.000Z'),
    }).recordObservation({
      scopeHash: '8'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: report(),
      retentionDays: 30,
    });
    const invalidRows = recorded.observation.report.differences.rows.map((row) => ({
      ...row,
      unexpectedRawValue: 'must never be persisted',
    }));

    await expect(cloneObservationWithOverrides(first, recorded.observation.id, {
      difference_rows_json: invalidRows,
      difference_subject_key: null,
      full_difference_signature: null,
    })).rejects.toBeTruthy();
  }, 30_000);

  it('serializes recording and review while retaining immutable approval evidence after pruning', async () => {
    const prefix = `parity_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const actorUserId = `${prefix}_admin`;
    const now = new Date('2026-07-16T03:00:00.000Z');
    await first.$executeRawUnsafe(
      `INSERT INTO "users"
        ("id", "phone", "password_hash", "role", "is_super_admin", "updated_at")
       VALUES ($1, $2, $3, 'ADMIN', TRUE, $4)`,
      actorUserId, `${prefix}_phone`, 'test-password-hash', now,
    );
    const firstService = createOzonPublisherParityObservationService({
      repository: createPrismaOzonPublisherParityObservationRepository({
        client: first as never,
        createId: () => `${prefix}_decision_first`,
      }),
      now: () => now,
      createId: () => `${prefix}_observation`,
    });
    const secondService = createOzonPublisherParityObservationService({
      repository: createPrismaOzonPublisherParityObservationRepository({
        client: second as never,
        createId: () => `${prefix}_decision_second`,
      }),
      now: () => now,
      createId: () => `${prefix}_observation`,
    });
    const observationInput = {
      scopeHash: 'a'.repeat(64),
      rolloutRevision: `${prefix}_rollout`,
      report: report(),
      retentionDays: 30,
    };

    const recorded = await Promise.all([
      firstService.recordObservation(observationInput),
      secondService.recordObservation(observationInput),
    ]);
    expect(recorded.map(({ created }) => created).sort()).toEqual([false, true]);
    const subjectKey = recorded[0]!.observation.differenceSubjectKey!;
    const subjectBefore = await first.ozonPublisherParityDifferenceSubject.findUniqueOrThrow({
      where: { subjectKey },
    });
    expect(subjectBefore).toMatchObject({ observationCount: 1, approvalState: 'PENDING' });

    const reviewInput = {
      action: 'APPROVE' as const,
      subjectKey,
      expectedTransitionVersion: 0,
      actorUserId,
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Approved intentional removal of the fabricated legacy default.',
    };
    const reviews = await Promise.all([
      firstService.reviewDifference(reviewInput),
      secondService.reviewDifference(reviewInput),
    ]);
    expect(reviews.map(({ idempotent }) => idempotent).sort()).toEqual([false, true]);
    await expect(firstService.reviewDifference({
      ...reviewInput,
      reviewNote: 'A changed note must not reuse the original operation key.',
    })).rejects.toMatchObject({ code: 'OZON_PUBLISHER_PARITY_IDEMPOTENCY_CONFLICT' });

    const expiredBefore = new Date('2026-08-16T03:00:00.000Z');
    const expectedDeleted = await first.ozonPublisherParityObservation.count({
      where: { expiresAt: { lt: expiredBefore } },
    });
    const pruned = await firstService.pruneExpiredObservations({
      expiredBefore,
      limit: 100,
    });
    expect(pruned).toEqual({ deletedCount: expectedDeleted, hasMore: false });
    await expect(first.ozonPublisherParityDifferenceSubject.findUnique({
      where: { subjectKey },
    })).resolves.toMatchObject({ approvalState: 'APPROVED', stateVersion: 1 });
    const decision = await first.ozonPublisherParityDecision.findFirstOrThrow({
      where: { subjectKey },
    });
    await expect(first.$executeRawUnsafe(
      'UPDATE "ozon_publisher_parity_decisions" SET "review_note" = $1 WHERE "id" = $2',
      'tampered', decision.id,
    )).rejects.toBeTruthy();
    await expect(first.$executeRawUnsafe(
      'DELETE FROM "ozon_publisher_parity_decisions" WHERE "id" = $1',
      decision.id,
    )).rejects.toBeTruthy();
  }, 60_000);
});
