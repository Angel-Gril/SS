import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { compareOzonPublisherEntrypointParity } from '../services/ozon-publisher-entrypoint-parity.js';
import { createPrismaOzonPublisherRolloutAdminRepository } from '../services/ozon-publisher-rollout-admin-prisma.js';
import { createOzonPublisherParityObservationService } from '../services/ozon-publisher-parity-observations.js';
import { createPrismaOzonPublisherParityObservationRepository } from '../services/ozon-publisher-parity-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
if (runRequested && !testDatabaseUrl) {
  throw new Error('rollout gate PostgreSQL integration requires LOGISTICS_TEST_DATABASE_URL');
}
const describePostgres = runRequested && testDatabaseUrl ? describe : describe.skip;
const POLICY_HASH = 'a'.repeat(64);
const CONFIG_HASH = 'b'.repeat(64);

function isolatedSchema(urlText: string): string {
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must use an isolated logistics_test_* schema');
  }
  return schema;
}

function key(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function hash(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function differentReport() {
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: { endpoint: '/v3/product/import', payload: { items: [{ offer_id: 'offer', weight: 500 }] } },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'offer' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function matchReport() {
  const payload = { items: [{ offer_id: 'offer', weight: 500 }] };
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: { endpoint: '/v3/product/import', payload },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload,
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

const READINESS_THRESHOLDS = {
  contractVersion: 'ozon-publisher-rollout-readiness/v1',
  windowDays: 14,
  minimumEligibleAttempts: 100,
  minimumLinkedObservations: 100,
  minimumDistinctScopes: 25,
  minimumActiveUtcDays: 7,
  maximumLatestAgeHours: 24,
  rollbackEvidenceDays: 30,
};

async function createGate(client: PrismaClient, id: string, revision: string) {
  await client.$executeRawUnsafe(
    `INSERT INTO "ozon_publisher_rollout_gates" (
       "id", "writer_entrypoint", "origin_channel", "rollout_revision",
       "record_contract_version", "evidence_policy_hash",
       "authorized_control_config_hash", "guard_contract_version",
       "denominator_enforced_from", "created_at", "updated_at"
     ) VALUES (
       $1, 'COLLECT_PUBLISH_OZON', 'DIRECT', $2,
       'ozon-publisher-rollout-gate/v2', $3, $4,
       'ozon-publisher-rollout-guard/v1', transaction_timestamp()::timestamptz(3),
       transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3)
     )`,
    id, revision, POLICY_HASH, CONFIG_HASH,
  );
}

async function createAttempt(
  client: Pick<PrismaClient, '$executeRawUnsafe'>,
  input: { gateId: string; revision: string; scopeHash: string; attemptKey: string },
) {
  await client.$executeRawUnsafe(
    `INSERT INTO "ozon_publisher_rollout_recorder_attempts" (
       "id", "attempt_key", "eligible_attempt_key", "operation_key",
       "request_hash", "payload_hash", "item_count", "attempt_contract_version",
       "guard_contract_version", "evidence_policy_hash", "gate_id",
       "writer_entrypoint", "origin_channel", "parity_entrypoint", "rollout_revision",
       "scope_hash", "eligible_at", "expires_at", "created_at"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 1,
       'ozon-publisher-parity-eligible-attempt/v1', 'ozon-publisher-rollout-guard/v1',
       $7, $8, 'COLLECT_PUBLISH_OZON', 'DIRECT', 'COLLECT_PUBLISH_OZON', $9, $10,
       transaction_timestamp()::timestamptz(3),
       transaction_timestamp()::timestamptz(3) + interval '60 days',
       transaction_timestamp()::timestamptz(3)
     )`,
    `${input.attemptKey}_id`, input.attemptKey, hash(`${input.attemptKey}:eligible`),
    `${input.attemptKey}_operation`,
    hash(`${input.attemptKey}:request`), hash(`${input.attemptKey}:payload`), POLICY_HASH,
    input.gateId, input.revision, input.scopeHash,
  );
}

async function seedEvaluation(
  client: PrismaClient,
  input: { id: string; gateId: string; revision: string; actorId: string; valid: boolean },
) {
  await client.$executeRawUnsafe('ALTER TABLE "ozon_publisher_rollout_evaluations" DISABLE TRIGGER USER');
  try {
    await client.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_evaluations" (
         "id", "evaluation_key", "gate_id", "writer_entrypoint", "origin_channel",
         "rollout_revision", "record_contract_version", "evaluator_version",
         "evidence_policy_hash", "authorized_evidence_policy_hash",
         "control_config_hash", "authorized_control_config_hash",
         "guard_contract_version", "result", "evidence_hash", "evaluation_hash",
         "window_start", "window_end", "evaluated_at", "evidence_retained_until",
         "valid_until", "latest_eligible_at", "thresholds_json", "metrics_json",
         "blockers_json", "operation_key", "request_hash", "actor_user_id", "created_at"
       ) VALUES (
         $1, $2, $3, 'COLLECT_PUBLISH_OZON', 'DIRECT', $4,
         'ozon-publisher-rollout-evaluation/v3', 'ozon-publisher-rollout-readiness/v1',
         $5, $5, $6, $6, 'ozon-publisher-rollout-guard/v1', 'READY', $7, $8,
         transaction_timestamp() - interval '14 days', transaction_timestamp(),
         transaction_timestamp(), transaction_timestamp() + interval '30 days',
         CASE WHEN $9 THEN transaction_timestamp() + interval '1 hour'
              ELSE transaction_timestamp() - interval '1 second' END,
         transaction_timestamp(),
         $10::jsonb, $11::jsonb, '[]'::jsonb, $12, $13, $14, transaction_timestamp()
       )`,
      input.id, `${input.id}_evaluation_key`, input.gateId, input.revision,
      POLICY_HASH, CONFIG_HASH, hash('f'), hash('9'), input.valid,
      JSON.stringify({
        contractVersion: 'ozon-publisher-rollout-readiness/v1',
        windowDays: 14,
        minimumEligibleAttempts: 100,
        minimumLinkedObservations: 100,
        minimumDistinctScopes: 25,
        minimumActiveUtcDays: 7,
        maximumLatestAgeHours: 24,
        rollbackEvidenceDays: 30,
      }),
      JSON.stringify({
        eligibleAttemptCount: 0,
        linkedObservationCount: 0,
        missingObservationCount: 0,
        failedAttemptCount: 0,
        invalidEvidenceCount: 0,
        distinctScopeCount: 0,
        activeUtcDayCount: 0,
        latestEligibleAt: null,
        minimumEvidenceExpiresAt: null,
      }),
      `${input.id}_operation`, hash(`${input.id}:request`), input.actorId,
    );
  } finally {
    await client.$executeRawUnsafe('ALTER TABLE "ozon_publisher_rollout_evaluations" ENABLE TRIGGER USER');
  }
}

async function seedReadyEvidence(
  client: PrismaClient,
  input: { prefix: string; gateId: string; revision: string; actorId: string },
) {
  await client.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "phone", "password_hash", "role", "is_super_admin", "updated_at")
     VALUES ($1, $2, 'test-password-hash', 'ADMIN', TRUE, transaction_timestamp())`,
    input.actorId, `${input.prefix}_phone`,
  );
  const observationService = createOzonPublisherParityObservationService({
    repository: createPrismaOzonPublisherParityObservationRepository({
      client: client as never,
      createId: () => `${input.prefix}_source_observation`,
    }),
    createId: () => `${input.prefix}_source_observation`,
    now: () => new Date(),
  });
  const source = await observationService.recordObservation({
    scopeHash: hash(`${input.prefix}:source-scope`),
    rolloutRevision: input.revision,
    report: matchReport(),
    retentionDays: 60,
  });

  await client.$executeRawUnsafe('ALTER TABLE "ozon_publisher_rollout_gates" DISABLE TRIGGER USER');
  try {
    await client.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_gates" (
         "id", "writer_entrypoint", "origin_channel", "rollout_revision",
         "record_contract_version", "evidence_policy_hash",
         "authorized_control_config_hash", "guard_contract_version",
         "denominator_enforced_from", "created_at", "updated_at"
       ) VALUES (
         $1, 'COLLECT_PUBLISH_OZON', 'DIRECT', $2,
         'ozon-publisher-rollout-gate/v2', $3, $4,
         'ozon-publisher-rollout-guard/v1',
         transaction_timestamp() - interval '15 days',
         transaction_timestamp() - interval '15 days',
         transaction_timestamp() - interval '15 days'
       )`,
      input.gateId, input.revision, POLICY_HASH, CONFIG_HASH,
    );
  } finally {
    await client.$executeRawUnsafe('ALTER TABLE "ozon_publisher_rollout_gates" ENABLE TRIGGER USER');
  }

  await client.$executeRawUnsafe(
    'ALTER TABLE "ozon_publisher_rollout_recorder_attempts" DISABLE TRIGGER USER',
  );
  try {
    await client.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_recorder_attempts" (
         "id", "attempt_key", "eligible_attempt_key", "operation_key",
         "request_hash", "payload_hash", "item_count", "attempt_contract_version",
         "guard_contract_version", "evidence_policy_hash", "gate_id",
         "writer_entrypoint", "origin_channel", "parity_entrypoint", "rollout_revision",
         "scope_hash", "eligible_at", "expires_at", "created_at"
       ) SELECT
         $1 || '_attempt_id_' || i::text,
         $1 || '_attempt_key_' || i::text,
         encode(sha256(convert_to($1 || ':eligible:' || i::text, 'UTF8')), 'hex'),
         $1 || '_operation_' || i::text,
         encode(sha256(convert_to($1 || ':request:' || i::text, 'UTF8')), 'hex'),
         encode(sha256(convert_to($1 || ':payload:' || i::text, 'UTF8')), 'hex'),
         1, 'ozon-publisher-parity-eligible-attempt/v1',
         'ozon-publisher-rollout-guard/v1', $2, $3,
         'COLLECT_PUBLISH_OZON', 'DIRECT', 'COLLECT_PUBLISH_OZON', $4,
         encode(sha256(convert_to($1 || ':scope:' || (i % 25)::text, 'UTF8')), 'hex'),
         transaction_timestamp() - make_interval(days => (i % 7)::int, hours => 1),
         transaction_timestamp() + interval '60 days',
         transaction_timestamp() - make_interval(days => (i % 7)::int, hours => 1)
       FROM generate_series(0, 99) rows(i)`,
      input.prefix, POLICY_HASH, input.gateId, input.revision,
    );
  } finally {
    await client.$executeRawUnsafe(
      'ALTER TABLE "ozon_publisher_rollout_recorder_attempts" ENABLE TRIGGER USER',
    );
  }

  await client.$executeRawUnsafe(
    'ALTER TABLE "ozon_publisher_parity_observations" DISABLE TRIGGER USER',
  );
  try {
    await client.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_parity_observations"
       SELECT (jsonb_populate_record(NULL::"ozon_publisher_parity_observations",
         to_jsonb(source_row) || jsonb_build_object(
           'id', 'obs_' || a."eligible_attempt_key",
           'record_key', encode(sha256(convert_to($1 || ':record:' || a."id", 'UTF8')), 'hex'),
           'eligible_attempt_key', a."eligible_attempt_key",
           'scope_hash', a."scope_hash",
           'rollout_revision', a."rollout_revision",
           'observed_at', a."eligible_at" + interval '1 minute',
           'expires_at', transaction_timestamp() + interval '60 days',
           'created_at', a."eligible_at" + interval '1 minute'
         ))).*
       FROM "ozon_publisher_parity_observations" source_row
       CROSS JOIN "ozon_publisher_rollout_recorder_attempts" a
       WHERE source_row."id" = $2 AND a."gate_id" = $3`,
      input.prefix, source.observation.id, input.gateId,
    );
  } finally {
    await client.$executeRawUnsafe(
      'ALTER TABLE "ozon_publisher_parity_observations" ENABLE TRIGGER USER',
    );
  }

  await client.$executeRawUnsafe(
    `INSERT INTO "ozon_publisher_rollout_recorder_outcomes" (
       "id", "attempt_id", "result", "observation_id", "observation_record_key",
       "observation_report_hash", "subject_state_version_snapshot",
       "full_difference_signature_snapshot", "completed_at", "created_at"
     ) SELECT
       'out_' || a."eligible_attempt_key", a."id", 'RECORDED', p."id", p."record_key",
       p."report_hash", NULL, NULL,
       transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3)
     FROM "ozon_publisher_rollout_recorder_attempts" a
     JOIN "ozon_publisher_parity_observations" p
       ON p."eligible_attempt_key" = a."eligible_attempt_key"
     WHERE a."gate_id" = $1`,
    input.gateId,
  );
}

async function applyCollectStageTransition(
  client: PrismaClient,
  input: {
    prefix: string;
    actorId: string;
    expectedRevision: number;
    fromStage: 'off' | 'shadow' | 'v2';
    resultStage: 'off' | 'shadow' | 'v2';
    gate?: {
      id: string;
      revision: string;
      stateVersion: number;
      evidenceHash: string;
      evaluationHash: string;
    };
  },
) {
  await client.$transaction(async (tx) => {
    const updated = await tx.$executeRawUnsafe(
      `UPDATE "system_configs" SET
         "value" = $1, "revision" = $2,
         "updated_at" = transaction_timestamp()::timestamp(3)
       WHERE "key" = 'source_ozon_publisher_collect_publish_stage'
         AND "value" = $3 AND "revision" = $4`,
      input.resultStage, input.expectedRevision + 1, input.fromStage, input.expectedRevision,
    );
    expect(updated).toBe(1);
    await tx.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_stage_transitions" (
         "id", "boundary", "config_key", "transition_version", "expected_revision",
         "transition_key", "operation_key", "request_hash", "from_stage", "result_stage",
         "gate_id", "rollout_revision_snapshot", "gate_state_version_snapshot",
         "evidence_hash_snapshot", "evaluation_hash_snapshot", "actor_user_id", "reason",
         "decided_at", "created_at"
       ) VALUES (
         $1, 'COLLECT_PUBLISH_OZON', 'source_ozon_publisher_collect_publish_stage', $2, $3,
         $4, $5, $6,
         CAST($7 AS "OzonPublisherRolloutStage"), CAST($8 AS "OzonPublisherRolloutStage"),
         $9, $10, $11, $12, $13, $14, $15,
         transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3)
       )`,
      `${input.prefix}_stage_transition`, input.expectedRevision + 1, input.expectedRevision,
      `${input.prefix}_stage_transition_key`, `${input.prefix}_stage_operation`,
      hash(`${input.prefix}:stage-request`), input.fromStage, input.resultStage,
      input.gate?.id ?? null, input.gate?.revision ?? null,
      input.gate?.stateVersion ?? null, input.gate?.evidenceHash ?? null,
      input.gate?.evaluationHash ?? null, input.actorId,
      `Stage transition ${input.fromStage} to ${input.resultStage}`,
    );
  }, { isolationLevel: 'Serializable' });
}

async function resetCollectStageFixture(client: PrismaClient, prefix: string) {
  await client.$executeRawUnsafe(
    'ALTER TABLE "ozon_publisher_rollout_stage_transitions" DISABLE TRIGGER USER',
  );
  try {
    await client.$executeRawUnsafe(
      'DELETE FROM "ozon_publisher_rollout_stage_transitions" WHERE "id" LIKE $1',
      `${prefix}_%`,
    );
  } finally {
    await client.$executeRawUnsafe(
      'ALTER TABLE "ozon_publisher_rollout_stage_transitions" ENABLE TRIGGER USER',
    );
  }
  await client.$executeRawUnsafe('ALTER TABLE "system_configs" DISABLE TRIGGER USER');
  try {
    await client.$executeRawUnsafe(
      `UPDATE "system_configs" SET "value" = 'off', "revision" = 0,
         "updated_at" = transaction_timestamp()::timestamp(3)
       WHERE "key" = 'source_ozon_publisher_collect_publish_stage'`,
    );
  } finally {
    await client.$executeRawUnsafe('ALTER TABLE "system_configs" ENABLE TRIGGER USER');
  }
}

describePostgres('Ozon publisher rollout gate PostgreSQL hardening', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = isolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const current = await first.$queryRawUnsafe<Array<{ schema: string }>>('SELECT current_schema() AS schema');
    expect(current[0]?.schema).toBe(expectedSchema);
    const applied = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260716021000_harden_ozon_publisher_rollout_gates',
         '20260716022000_complete_ozon_publisher_rollout_attempt_link',
         '20260716023000_fix_ozon_publisher_rollout_fence_order',
         '20260716024000_make_ozon_publisher_rollout_fence_retryable'
       )
         AND "finished_at" IS NOT NULL`,
    );
    expect(Number(applied[0]?.count || 0)).toBe(4);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('rejects an eligible attempt whose timestamps are backfilled', async () => {
    const prefix = key('backdate');
    await createGate(first, `${prefix}_gate`, `${prefix}_revision`);
    await expect(first.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_recorder_attempts" (
         "id", "attempt_key", "eligible_attempt_key", "operation_key", "request_hash",
         "payload_hash", "item_count", "attempt_contract_version", "guard_contract_version",
         "evidence_policy_hash", "gate_id", "writer_entrypoint", "origin_channel",
         "parity_entrypoint", "rollout_revision", "scope_hash", "eligible_at", "expires_at", "created_at"
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'ozon-publisher-parity-eligible-attempt/v1',
         'ozon-publisher-rollout-guard/v1', $7, $8, 'COLLECT_PUBLISH_OZON', 'DIRECT',
         'COLLECT_PUBLISH_OZON', $9, $10, transaction_timestamp() - interval '1 second',
         transaction_timestamp() + interval '60 days', transaction_timestamp())`,
      `${prefix}_attempt`, `${prefix}_attempt_key`, hash('1'), `${prefix}_operation`,
      hash('2'), hash('3'), POLICY_HASH, `${prefix}_gate`, `${prefix}_revision`, hash('4'),
    )).rejects.toBeTruthy();
  });

  it('accepts a complete approved intentional difference as linked recorder evidence', async () => {
    const prefix = key('difference');
    const revision = `${prefix}_revision`;
    const gateId = `${prefix}_gate`;
    const actorId = `${prefix}_actor`;
    const scopeHash = hash('5');
    await first.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "phone", "password_hash", "role", "is_super_admin", "updated_at")
       VALUES ($1, $2, 'test-password-hash', 'ADMIN', TRUE, transaction_timestamp())`,
      actorId, `${prefix}_phone`,
    );
    const reviewClock = await first.$queryRawUnsafe<Array<{ now: Date }>>(
      `SELECT transaction_timestamp()::timestamptz(3) - interval '1 second' AS now`,
    );
    const service = createOzonPublisherParityObservationService({
      repository: createPrismaOzonPublisherParityObservationRepository({
        client: first as never,
        createId: () => `${prefix}_decision`,
      }),
      createId: () => `${prefix}_source_observation`,
      now: () => reviewClock[0]!.now,
    });
    const source = await service.recordObservation({
      scopeHash,
      rolloutRevision: revision,
      report: differentReport(),
      retentionDays: 60,
    });
    await service.reviewDifference({
      action: 'APPROVE',
      subjectKey: source.observation.differenceSubjectKey!,
      expectedTransitionVersion: 0,
      actorUserId: actorId,
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'Approved for rollout hardening integration evidence.',
    });
    await createGate(first, gateId, revision);
    await createAttempt(first, { gateId, revision, scopeHash, attemptKey: `${prefix}_attempt` });
    const attempt = await first.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "ozon_publisher_rollout_recorder_attempts" WHERE "gate_id" = $1', gateId,
    );
    const actualAttempt = await first.$queryRawUnsafe<Array<{ eligibleAttemptKey: string }>>(
      'SELECT "eligible_attempt_key" AS "eligibleAttemptKey" FROM "ozon_publisher_rollout_recorder_attempts" WHERE "id" = $1',
      attempt[0]!.id,
    );
    const linkedKey = actualAttempt[0]!.eligibleAttemptKey;
    const clonedId = `${prefix}_linked_observation`;
    await first.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_parity_observations"
       SELECT (jsonb_populate_record(NULL::"ozon_publisher_parity_observations",
         to_jsonb(source_row) || jsonb_build_object(
           'id', $1, 'record_key', $2, 'eligible_attempt_key', $3,
           'observed_at', transaction_timestamp(),
           'expires_at', transaction_timestamp() + interval '60 days'
         ))).*
       FROM "ozon_publisher_parity_observations" source_row WHERE source_row."id" = $4`,
      clonedId, hash(`${prefix}:linked-record`), linkedKey, source.observation.id,
    );
    const subject = await first.$queryRawUnsafe<Array<{ stateVersion: number; signature: string }>>(
      `SELECT "state_version" AS "stateVersion", "full_difference_signature" AS signature
       FROM "ozon_publisher_parity_difference_subjects" WHERE "subject_key" = $1`,
      source.observation.differenceSubjectKey,
    );
    await first.$executeRawUnsafe(
      `INSERT INTO "ozon_publisher_rollout_recorder_outcomes" (
         "id", "attempt_id", "result", "observation_id", "observation_record_key",
         "observation_report_hash", "subject_state_version_snapshot",
         "full_difference_signature_snapshot", "completed_at", "created_at"
       ) SELECT $1, $2, 'RECORDED', p."id", p."record_key", p."report_hash", $3, $4,
                transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3)
           FROM "ozon_publisher_parity_observations" p WHERE p."id" = $5`,
      `${prefix}_outcome`, attempt[0]!.id, subject[0]!.stateVersion,
      subject[0]!.signature, clonedId,
    );
    const valid = await first.$queryRawUnsafe<Array<{ valid: boolean }>>(
      `SELECT "ozon_publisher_rollout_observation_is_valid"(
         a, o, p, s, transaction_timestamp() + interval '30 days', transaction_timestamp()
       ) AS valid
       FROM "ozon_publisher_rollout_recorder_attempts" a
       JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
       JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
       JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
       WHERE a."id" = $1`,
      attempt[0]!.id,
    );
    expect(valid).toEqual([{ valid: true }]);
  }, 30_000);

  it('atomically evaluates 100 linked attempts, approves the gate, and appends the CAS event', async () => {
    const prefix = key('ready');
    const gateId = `${prefix}_gate`;
    const revision = `${prefix}_revision`;
    const actorId = `${prefix}_actor`;
    const evaluationId = `${prefix}_evaluation`;
    const evidenceHash = hash(`${prefix}:evidence`);
    const evaluationHash = hash(`${prefix}:evaluation`);
    await seedReadyEvidence(first, { prefix, gateId, revision, actorId });

    await first.$transaction(async (tx) => {
      const aggregate = await tx.$queryRawUnsafe<Array<{
        eligibleCount: bigint;
        scopeCount: bigint;
        activeDays: bigint;
        latestAt: Date;
        minimumExpiry: Date;
      }>>(
        `SELECT count(*)::bigint AS "eligibleCount",
                count(DISTINCT a."scope_hash")::bigint AS "scopeCount",
                count(DISTINCT (a."eligible_at" AT TIME ZONE 'UTC')::date)::bigint AS "activeDays",
                max(a."eligible_at") AS "latestAt",
                min(LEAST(a."expires_at", p."expires_at")) AS "minimumExpiry"
           FROM "ozon_publisher_rollout_recorder_attempts" a
           JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
           JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
          WHERE a."gate_id" = $1`,
        gateId,
      );
      const row = aggregate[0]!;
      const metrics = {
        eligibleAttemptCount: Number(row.eligibleCount),
        linkedObservationCount: Number(row.eligibleCount),
        missingObservationCount: 0,
        failedAttemptCount: 0,
        invalidEvidenceCount: 0,
        distinctScopeCount: Number(row.scopeCount),
        activeUtcDayCount: Number(row.activeDays),
        latestEligibleAt: row.latestAt.toISOString(),
        minimumEvidenceExpiresAt: row.minimumExpiry.toISOString(),
      };
      await tx.$executeRawUnsafe(
        `INSERT INTO "ozon_publisher_rollout_evaluations" (
           "id", "evaluation_key", "gate_id", "writer_entrypoint", "origin_channel",
           "rollout_revision", "record_contract_version", "evaluator_version",
           "evidence_policy_hash", "authorized_evidence_policy_hash",
           "control_config_hash", "authorized_control_config_hash", "guard_contract_version",
           "result", "evidence_hash", "evaluation_hash", "window_start", "window_end",
           "evaluated_at", "evidence_retained_until", "valid_until", "latest_eligible_at",
           "thresholds_json", "metrics_json", "blockers_json",
           "operation_key", "request_hash", "actor_user_id", "created_at"
         ) VALUES (
           $1, $2, $3, 'COLLECT_PUBLISH_OZON', 'DIRECT', $4,
           'ozon-publisher-rollout-evaluation/v3', 'ozon-publisher-rollout-readiness/v1',
           $5, $5, $6, $6, 'ozon-publisher-rollout-guard/v1',
           'READY', $7, $8,
           transaction_timestamp()::timestamptz(3) - interval '14 days',
           transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3),
           transaction_timestamp()::timestamptz(3) + interval '30 days',
           transaction_timestamp()::timestamptz(3), $9,
           $10::jsonb, $11::jsonb, '[]'::jsonb, $12, $13, $14,
           transaction_timestamp()::timestamptz(3)
         )`,
        evaluationId, `${prefix}_evaluation_key`, gateId, revision,
        POLICY_HASH, CONFIG_HASH, evidenceHash, evaluationHash, row.latestAt,
        JSON.stringify(READINESS_THRESHOLDS), JSON.stringify(metrics),
        `${prefix}_evaluation_operation`, hash(`${prefix}:evaluation-request`), actorId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "ozon_publisher_rollout_gates" SET
           "state" = 'READY', "state_version" = 1, "ready_evaluation_id" = $1,
           "evidence_hash" = $2, "evaluation_hash" = $3, "approved_by_user_id" = $4,
           "approved_at" = transaction_timestamp()::timestamptz(3),
           "approval_reason" = 'Atomic readiness approval integration test',
           "updated_at" = transaction_timestamp()::timestamptz(3)
         WHERE "id" = $5`,
        evaluationId, evidenceHash, evaluationHash, actorId, gateId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "ozon_publisher_rollout_transitions" (
           "id", "gate_id", "transition_version", "expected_state_version",
           "transition_key", "operation_key", "request_hash", "action", "from_state",
           "result_state", "evaluation_id", "evidence_hash_snapshot",
           "evaluation_hash_snapshot", "actor_user_id", "reason", "decided_at", "created_at"
         ) VALUES (
           $1, $2, 1, 0, $3, $4, $5, 'APPROVE', 'NOT_READY', 'READY',
           $6, $7, $8, $9, 'Atomic readiness approval integration test',
           transaction_timestamp()::timestamptz(3), transaction_timestamp()::timestamptz(3)
         )`,
        `${prefix}_transition`, gateId, `${prefix}_transition_key`,
        `${prefix}_transition_operation`, hash(`${prefix}:request`), evaluationId,
        evidenceHash, evaluationHash, actorId,
      );
    }, { isolationLevel: 'Serializable' });

    const gate = await first.$queryRawUnsafe<Array<{
      state: string;
      stateVersion: number;
      readyEvaluationId: string;
      transitionCount: bigint;
    }>>(
      `SELECT g."state", g."state_version" AS "stateVersion",
              g."ready_evaluation_id" AS "readyEvaluationId",
              count(t."id")::bigint AS "transitionCount"
         FROM "ozon_publisher_rollout_gates" g
         LEFT JOIN "ozon_publisher_rollout_transitions" t ON t."gate_id" = g."id"
        WHERE g."id" = $1
        GROUP BY g."id"`,
      gateId,
    );
    expect(gate).toEqual([{
      state: 'READY',
      stateVersion: 1,
      readyEvaluationId: evaluationId,
      transitionCount: 1n,
    }]);

    try {
      await applyCollectStageTransition(first, {
      prefix: `${prefix}_shadow`,
      actorId,
      expectedRevision: 0,
      fromStage: 'off',
      resultStage: 'shadow',
      });
      await applyCollectStageTransition(first, {
      prefix: `${prefix}_v2`,
      actorId,
      expectedRevision: 1,
      fromStage: 'shadow',
      resultStage: 'v2',
      gate: {
        id: gateId,
        revision,
        stateVersion: 1,
        evidenceHash,
        evaluationHash,
      },
      });
      await applyCollectStageTransition(first, {
      prefix: `${prefix}_off`,
      actorId,
      expectedRevision: 2,
      fromStage: 'v2',
      resultStage: 'off',
      });
      const stage = await first.$queryRawUnsafe<Array<{
      value: string;
      revision: number;
      transitionCount: bigint;
    }>>(
      `SELECT c."value", c."revision", count(t."id")::bigint AS "transitionCount"
         FROM "system_configs" c
         LEFT JOIN "ozon_publisher_rollout_stage_transitions" t ON t."config_key" = c."key"
        WHERE c."key" = 'source_ozon_publisher_collect_publish_stage'
        GROUP BY c."id"`,
    );
      expect(stage).toEqual([{ value: 'off', revision: 3, transitionCount: 3n }]);
    } finally {
      await resetCollectStageFixture(first, prefix);
    }
  }, 60_000);

  it('executes preview, atomic approval, stage CAS, replay, and revocation through the Prisma repository', async () => {
    const prefix = key('repository');
    const gateId = `${prefix}_gate`;
    const revision = `${prefix}_revision`;
    const actorId = `${prefix}_actor`;
    await seedReadyEvidence(first, { prefix, gateId, revision, actorId });
    let sequence = 0;
    const repository = createPrismaOzonPublisherRolloutAdminRepository({
      client: first as never,
      loadControlSnapshot: async () => ({
        evidencePolicyHash: POLICY_HASH,
        controlConfigHash: CONFIG_HASH,
      }),
      createId: () => `${prefix}_id_${++sequence}`,
    });
    const actor = {
      actorUserId: actorId,
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      tokenUse: 'account_session',
    };
    const preview = await repository.evaluateGate({
      actor,
      gateId,
      idempotencyKey: `${prefix}_preview_key`,
      operationKey: hash(`${prefix}:preview-operation`),
      requestHash: hash(`${prefix}:preview-request`),
    });
    expect(preview).toMatchObject({
      idempotent: false,
      record: { result: 'READY', validUntil: expect.any(String), actorUserId: actorId },
    });

    const approveInput = {
      actor,
      gateId,
      expectedStateVersion: 0 as const,
      expectedPreviewEvidenceHash: preview.record.evidenceHash,
      idempotencyKey: `${prefix}_approve_key`,
      operationKey: hash(`${prefix}:approve-operation`),
      requestHash: hash(`${prefix}:approve-request`),
      reason: 'Approve the exact live repository evidence.',
    };
    const approved = await repository.approveGate(approveInput);
    expect(approved).toMatchObject({
      idempotent: false,
      record: { action: 'APPROVE', resultState: 'READY', transitionVersion: 1 },
    });
    await expect(repository.approveGate(approveInput)).resolves.toMatchObject({
      idempotent: true,
      record: { id: approved.record.id },
    });
    const readyGate = await repository.findGate({ gateId });
    expect(readyGate).toMatchObject({ state: 'READY', stateVersion: 1 });

    try {
      await repository.transitionStage({
        actor,
        boundary: 'COLLECT_PUBLISH_OZON',
        configKey: 'source_ozon_publisher_collect_publish_stage',
        expectedRevision: 0,
        expectedStage: 'off',
        targetStage: 'shadow',
        gateBinding: null,
        idempotencyKey: `${prefix}_shadow_key`,
        operationKey: hash(`${prefix}:shadow-operation`),
        requestHash: hash(`${prefix}:shadow-request`),
        reason: 'Start repository shadow observation.',
      });
      await repository.transitionStage({
        actor,
        boundary: 'COLLECT_PUBLISH_OZON',
        configKey: 'source_ozon_publisher_collect_publish_stage',
        expectedRevision: 1,
        expectedStage: 'shadow',
        targetStage: 'v2',
        gateBinding: {
          gateId,
          rolloutRevision: revision,
          expectedGateStateVersion: 1,
          expectedEvidenceHash: readyGate!.evidenceHash!,
          expectedEvaluationHash: readyGate!.evaluationHash!,
        },
        idempotencyKey: `${prefix}_v2_key`,
        operationKey: hash(`${prefix}:v2-operation`),
        requestHash: hash(`${prefix}:v2-request`),
        reason: 'Promote the exact READY gate.',
      });
      const demoted = await repository.transitionStage({
        actor,
        boundary: 'COLLECT_PUBLISH_OZON',
        configKey: 'source_ozon_publisher_collect_publish_stage',
        expectedRevision: 2,
        expectedStage: 'v2',
        targetStage: 'off',
        gateBinding: null,
        idempotencyKey: `${prefix}_off_key`,
        operationKey: hash(`${prefix}:off-operation`),
        requestHash: hash(`${prefix}:off-request`),
        reason: 'Return the repository integration stage to off.',
      });
      expect(demoted.record).toMatchObject({ resultStage: 'off', transitionVersion: 3 });
    } finally {
      await resetCollectStageFixture(first, prefix);
    }

    const revoked = await repository.revokeGate({
      actor,
      gateId,
      expectedStateVersion: 1,
      expectedEvidenceHash: readyGate!.evidenceHash!,
      expectedEvaluationHash: readyGate!.evaluationHash!,
      idempotencyKey: `${prefix}_revoke_key`,
      operationKey: hash(`${prefix}:revoke-operation`),
      requestHash: hash(`${prefix}:revoke-request`),
      reason: 'Revoke after repository integration verification.',
    });
    expect(revoked.record).toMatchObject({ action: 'REVOKE', resultState: 'REVOKED' });
    await expect(repository.findGate({ gateId })).resolves.toMatchObject({
      state: 'REVOKED',
      stateVersion: 2,
    });
  }, 60_000);

  it('rejects generic rollout-stage updates and deletes without an immutable CAS event', async () => {
    await expect(first.$executeRawUnsafe(
      `UPDATE "system_configs" SET "value" = 'shadow', "revision" = 1,
         "updated_at" = transaction_timestamp()::timestamp(3)
       WHERE "key" = 'source_ozon_publisher_listing_batch_stage'`,
    )).rejects.toBeTruthy();
    await expect(first.$executeRawUnsafe(
      `DELETE FROM "system_configs"
       WHERE "key" = 'source_ozon_publisher_extension_adapter_stage'`,
    )).rejects.toBeTruthy();
    const stages = await first.$queryRawUnsafe<Array<{ key: string; value: string; revision: number }>>(
      `SELECT "key", "value", "revision" FROM "system_configs"
       WHERE "key" IN (
         'source_ozon_publisher_listing_batch_stage',
         'source_ozon_publisher_extension_adapter_stage'
       ) ORDER BY "key"`,
    );
    expect(stages).toEqual([
      { key: 'source_ozon_publisher_extension_adapter_stage', value: 'off', revision: 0 },
      { key: 'source_ozon_publisher_listing_batch_stage', value: 'off', revision: 0 },
    ]);
  });

  it('rejects approval with an expired evaluation', async () => {
    const prefix = key('expired');
    const gateId = `${prefix}_gate`;
    const revision = `${prefix}_revision`;
    const actorId = `${prefix}_actor`;
    await first.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "phone", "password_hash", "role", "updated_at")
       VALUES ($1, $2, 'test-password-hash', 'ADMIN', transaction_timestamp())`, actorId, `${prefix}_phone`,
    );
    await createGate(first, gateId, revision);
    await seedEvaluation(first, {
      id: `${prefix}_evaluation`, gateId, revision, actorId, valid: false,
    });
    await expect(first.$executeRawUnsafe(
      `UPDATE "ozon_publisher_rollout_gates" SET
         "state" = 'READY', "state_version" = 1, "ready_evaluation_id" = $1,
         "evidence_hash" = $2, "evaluation_hash" = $3, "approved_by_user_id" = $4,
         "approved_at" = transaction_timestamp()::timestamptz(3), "approval_reason" = 'expired test',
         "updated_at" = transaction_timestamp()::timestamptz(3) WHERE "id" = $5`,
      `${prefix}_evaluation`, hash('f'), hash('9'), actorId, gateId,
    )).rejects.toBeTruthy();
  });

  it('serializes a concurrent gap before approval and rejects the stale evaluation', async () => {
    const prefix = key('concurrent');
    const gateId = `${prefix}_gate`;
    const revision = `${prefix}_revision`;
    const actorId = `${prefix}_actor`;
    await first.$executeRawUnsafe(
      `INSERT INTO "users" ("id", "phone", "password_hash", "role", "updated_at")
       VALUES ($1, $2, 'test-password-hash', 'ADMIN', transaction_timestamp())`, actorId, `${prefix}_phone`,
    );
    await createGate(first, gateId, revision);
    await seedEvaluation(first, {
      id: `${prefix}_evaluation`, gateId, revision, actorId, valid: true,
    });

    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let signal!: () => void;
    const locked = new Promise<void>((resolve) => { signal = resolve; });
    const gap = first.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 6381623))', gateId);
      signal();
      await held;
      await createAttempt(tx as never, {
        gateId, revision, scopeHash: hash('8'), attemptKey: `${prefix}_attempt`,
      });
    });
    await locked;
    const approval = second.$executeRawUnsafe(
      `UPDATE "ozon_publisher_rollout_gates" SET
         "state" = 'READY', "state_version" = 1, "ready_evaluation_id" = $1,
         "evidence_hash" = $2, "evaluation_hash" = $3, "approved_by_user_id" = $4,
         "approved_at" = transaction_timestamp()::timestamptz(3), "approval_reason" = 'concurrent test',
         "updated_at" = transaction_timestamp()::timestamptz(3) WHERE "id" = $5`,
      `${prefix}_evaluation`, hash('f'), hash('9'), actorId, gateId,
    ).then(
      () => ({ ok: true as const, error: null }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const firstAttempt = await Promise.race([
      approval,
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('gate update did not fail fast on the held fence')),
        2_000,
      )),
    ]);
    expect(firstAttempt.ok).toBe(false);
    expect(String((firstAttempt.error as { meta?: { code?: string } })?.meta?.code || firstAttempt.error))
      .toContain('40001');
    release();
    await gap;
    await expect(second.$executeRawUnsafe(
      `UPDATE "ozon_publisher_rollout_gates" SET
         "state" = 'READY', "state_version" = 1, "ready_evaluation_id" = $1,
         "evidence_hash" = $2, "evaluation_hash" = $3, "approved_by_user_id" = $4,
         "approved_at" = transaction_timestamp()::timestamptz(3), "approval_reason" = 'retry test',
         "updated_at" = transaction_timestamp()::timestamptz(3) WHERE "id" = $5`,
      `${prefix}_evaluation`, hash('f'), hash('9'), actorId, gateId,
    )).rejects.toBeTruthy();
    const gate = await first.$queryRawUnsafe<Array<{ state: string; stateVersion: number }>>(
      'SELECT "state", "state_version" AS "stateVersion" FROM "ozon_publisher_rollout_gates" WHERE "id" = $1', gateId,
    );
    expect(gate).toEqual([{ state: 'NOT_READY', stateVersion: 0 }]);
  }, 30_000);
});
