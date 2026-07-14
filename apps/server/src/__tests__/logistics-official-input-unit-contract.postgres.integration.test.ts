import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaOfficialInputUnitContractRepository } from '../services/logistics-official-input-unit-contract-prisma.js';
import { createPrismaLogisticsCaptureTaskRepository } from '../services/logistics-capture-task-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1' && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function isolatedSchema(urlText: string) {
  const schema = urlText ? new URL(urlText).searchParams.get('schema') || '' : '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const unique = (label: string) =>
  'unit_contract_' + label + '_' + randomUUID().replaceAll('-', '').slice(0, 12);

interface Candidate {
  id: string;
  responseChecksum: string;
}

interface Seed {
  base: string;
  ownerUserId: string;
  alternateUserId: string;
  channelId: string;
  assignmentId: string;
  capturedAt: Date;
  candidates: Candidate[];
}

async function seedScope(client: PrismaClient, label: string): Promise<Seed> {
  const base = unique(label);
  const ownerUserId = base + '_owner';
  const alternateUserId = base + '_alternate';
  const shopId = base + '_shop';
  const warehouseId = base + '_warehouse';
  const companyId = base + '_company';
  const companyBindingId = base + '_company_binding';
  const originBindingId = base + '_origin_binding';
  const channelId = base + '_channel';
  const assignmentId = base + '_assignment';
  const capturedAt = new Date();

  await client.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "phone", "password_hash", "is_super_admin", "updated_at")
     VALUES ($1, $2, 'test-password-hash', true, CURRENT_TIMESTAMP),
            ($3, $4, 'test-password-hash', true, CURRENT_TIMESTAMP)`,
    ownerUserId, base + '_owner_phone', alternateUserId, base + '_alternate_phone',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops"
       ("id", "user_id", "platform", "name", "api_key_encrypted", "status", "updated_at")
     VALUES ($1, $2, 'OZON', $3, 'encrypted-test-key', 'ACTIVE', CURRENT_TIMESTAMP)`,
    shopId, ownerUserId, base + ' shop',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "warehouses"
       ("id", "shop_id", "platform_warehouse_id", "name", "status", "country_code",
        "city", "latitude", "longitude", "updated_at")
     VALUES ($1, $2, $3, $4, 'active', 'CN', 'Xiamen', 24.480107, 118.085348,
       CURRENT_TIMESTAMP)`,
    warehouseId, shopId, base + '_platform_warehouse', base + ' warehouse',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_ozon_company_bindings"
       ("id", "tenant_id", "shop_id", "ozon_company_id", "status",
        "open_api_verified_at", "seller_probe_verified_at", "open_api_intersection_verified_at",
        "verified_by_id", "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    companyBindingId, ownerUserId, shopId, companyId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "warehouse_ozon_origin_bindings"
       ("id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid",
        "origin_city_uid", "origin_country_code", "origin_label", "status",
        "open_api_address_verified_at", "official_location_verified_at",
        "verified_by_id", "verified_at", "updated_at")
     VALUES ($1, $2, $3, $4, 'china', 'xiamen', 'CN', 'China / Xiamen', 'VERIFIED',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    originBindingId, ownerUserId, shopId, warehouseId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_channels"
       ("id", "channel_type", "deployment_id", "schema_major", "tenant_id", "shop_id",
        "warehouse_id", "ozon_company_id", "origin_country_uid", "origin_city_uid",
        "origin_country_code", "origin_label", "company_binding_id", "origin_binding_id",
        "scope_key", "updated_at")
     VALUES ($1, 'TENANT', 'unit-contract-postgres-test', 1, $2, $3, $4, $5,
       'china', 'xiamen', 'CN', 'China / Xiamen', $6, $7, $8, CURRENT_TIMESTAMP)`,
    channelId, ownerUserId, shopId, warehouseId, companyId,
    companyBindingId, originBindingId, base + '/scope/v1',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_assignments"
       ("id", "tenant_id", "shop_id", "warehouse_id", "channel_id",
        "destination_country_uid", "destination_location_uid",
        "destination_country_code", "destination_label", "updated_at")
     VALUES ($1, $2, $3, $4, $5, 'russia', 'moscow', 'RU', 'Russia / Moscow',
       CURRENT_TIMESTAMP)`,
    assignmentId, ownerUserId, shopId, warehouseId, channelId,
  );

  const candidates: Candidate[] = [];
  for (const candidateLabel of ['initial', 'replacement-a', 'replacement-b']) {
    const taskId = base + '_' + candidateLabel + '_task';
    const candidateId = base + '_' + candidateLabel + '_candidate';
    const fingerprintChecksum = digest(taskId + ':fingerprint');
    const responseChecksum = digest(candidateId + ':response');
    const fingerprint = {
      currency: 'CNY',
      dimensionsMm: { height: 90, width: 160, length: 180 },
      weightG: 498,
      priceCnyMajor: '3000',
    };
    const normalizedPayload = {
      schema: 'ozon-official-logistics-capture/v1',
      fingerprint,
      quotes: Array.from({ length: 63 }, (_value, index) => ({
        tariffId: candidateLabel + '-' + (index + 1),
      })),
    };
    await client.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_tasks"
         ("id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
          "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
          "company_binding_id", "origin_binding_id", "destination_country_uid",
          "destination_location_uid", "official_fingerprint", "expected_endpoints",
          "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at",
          "updated_at")
       VALUES ($1, 'logistics-capture-task/v1', 'OFFICIAL', $2, $2, $3, $4, $5,
         'china', 'xiamen', $6, $7, 'russia', 'moscow', $8::jsonb,
         ARRAY['global-calculator/calculate']::text[], $9, $10, 'ISSUED', $11,
         $11 + INTERVAL '10 minutes', CURRENT_TIMESTAMP)`,
      taskId, ownerUserId, shopId, companyId, warehouseId, companyBindingId,
      originBindingId, JSON.stringify(fingerprint), fingerprintChecksum,
      digest(taskId + ':nonce'), capturedAt,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_candidates"
         ("id", "source_task_id", "task_version", "task_kind", "tenant_id", "shop_id", "company_id",
          "warehouse_id", "origin_country_uid", "origin_city_uid",
          "destination_country_uid", "destination_location_uid", "fingerprint_checksum",
          "response_checksum", "captured_at", "received_at", "state", "review_status",
          "reviewed_by_id", "reviewed_at", "review_reason", "source_trust",
          "normalized_payload", "diagnostics")
       VALUES ($1, $2, 'logistics-capture-task/v1', 'OFFICIAL', $3, $4, $5, $6, 'china', 'xiamen',
         'russia', 'moscow', $7, $8, $9, $9, 'CAPTURED', 'PENDING_REVIEW', NULL, NULL, NULL, 'postgres-unit-contract-test',
         $10::jsonb, '{}'::jsonb)`,
      candidateId, taskId, ownerUserId, shopId, companyId, warehouseId,
      fingerprintChecksum, responseChecksum, capturedAt, JSON.stringify(normalizedPayload),
    );
    await createPrismaLogisticsCaptureTaskRepository({ client }).reviewCaptureCandidate!({
      candidateId,
      actorUserId: ownerUserId,
      decision: 'VERIFIED',
      reason: 'Official input-unit evidence verified',
      reviewedAt: capturedAt,
    });
    candidates.push({ id: candidateId, responseChecksum });
  }

  return {
    base,
    ownerUserId,
    alternateUserId,
    channelId,
    assignmentId,
    capturedAt,
    candidates,
  };
}

function verifyInput(
  seed: Seed,
  candidate: Candidate,
  expectedCurrentContractId: string | null,
  increments: {
    weightIncrementG: number;
    dimensionIncrementMm: number;
    currencyMinorIncrement: number;
  } = {
    weightIncrementG: 1,
    dimensionIncrementMm: 1,
    currencyMinorIncrement: 1,
  },
) {
  const verifiedAt = new Date(seed.capturedAt.getTime() + 1_000);
  return {
    actorUserId: seed.ownerUserId,
    assignmentId: seed.assignmentId,
    candidateId: candidate.id,
    expectedCandidateChecksum: candidate.responseChecksum,
    ...increments,
    unitAttestation: {
      currency: 'CNY' as const,
      weightUnit: 'g' as const,
      dimensionUnit: 'mm' as const,
      priceInputUnit: 'CNY_MAJOR' as const,
    },
    reviewNote: 'Verified against the Ozon Global Calculator input controls',
    expectedCurrentContractId,
    verifiedAt,
    validUntil: new Date(verifiedAt.getTime() + 6 * 24 * 60 * 60 * 1_000),
    sourceMaxAgeMs: 24 * 60 * 60 * 1_000,
  };
}

function repositoryFor(client: PrismaClient, contractId: string, eventId: string) {
  let eventSequence = 0;
  return createPrismaOfficialInputUnitContractRepository({
    client,
    id: () => contractId,
    eventId: () => eventId + '_' + (++eventSequence),
  });
}

describePostgres('Official input-unit contract PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = isolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemas = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(schemas[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "migration_name" AS name FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260713080000_add_official_input_unit_contracts',
         '20260713083000_allow_fractional_official_input_unit_steps'
       )
         AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(2);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });


  it('round-trips fractional measurement increments while retaining integer minor currency', async () => {
    const seed = await seedScope(first, 'fractional');
    const contractId = seed.base + '_contract';
    const repository = repositoryFor(first, contractId, seed.base + '_event');

    await expect(repository.verifyContract(verifyInput(
      seed,
      seed.candidates[0]!,
      null,
      {
        weightIncrementG: 0.1,
        dimensionIncrementMm: 0.25,
        currencyMinorIncrement: 1,
      },
    ))).resolves.toMatchObject({
      contract: {
        weightIncrementG: 0.1,
        dimensionIncrementMm: 0.25,
        currencyMinorIncrement: 1,
      },
    });

    const context = await repository.readContext({
      assignmentId: seed.assignmentId,
      at: new Date(seed.capturedAt.getTime() + 2_000),
      sourceMaxAgeMs: 24 * 60 * 60 * 1_000,
    });
    expect(context.current).toMatchObject({
      weightIncrementG: 0.1,
      dimensionIncrementMm: 0.25,
      currencyMinorIncrement: 1,
    });

    const stored = await first.$queryRawUnsafe<Array<{
      weightIncrementG: { toString(): string };
      dimensionIncrementMm: { toString(): string };
      currencyMinorIncrement: number;
    }>>(
      `SELECT "weight_increment_g" AS "weightIncrementG",
              "dimension_increment_mm" AS "dimensionIncrementMm",
              "currency_minor_increment" AS "currencyMinorIncrement"
       FROM "logistics_official_input_unit_contracts" WHERE "id" = $1`,
      contractId,
    );
    expect(stored[0]?.weightIncrementG.toString()).toBe('0.1');
    expect(stored[0]?.dimensionIncrementMm.toString()).toBe('0.25');
    expect(stored[0]?.currencyMinorIncrement).toBe(1);
  }, 30_000);
  it('rejects direct content updates and deletes after audited verification', async () => {
    const seed = await seedScope(first, 'immutable');
    const contractId = seed.base + '_contract';
    const repository = repositoryFor(first, contractId, seed.base + '_verified_event');

    await expect(
      repository.verifyContract(verifyInput(seed, seed.candidates[0]!, null)),
    ).resolves.toMatchObject({
      duplicate: false,
      contract: { id: contractId, supersedesId: null },
    });
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_official_input_unit_contracts"
       SET "review_note" = 'tampered review note' WHERE "id" = $1`,
      contractId,
    )).rejects.toThrow(/content is immutable/i);
    await expect(first.$executeRawUnsafe(
      'DELETE FROM "logistics_official_input_unit_contracts" WHERE "id" = $1',
      contractId,
    )).rejects.toThrow(/content is immutable/i);

    const rows = await first.$queryRawUnsafe<Array<{ reviewNote: string }>>(
      `SELECT "review_note" AS "reviewNote"
       FROM "logistics_official_input_unit_contracts" WHERE "id" = $1`,
      contractId,
    );
    expect(rows).toEqual([{
      reviewNote: 'Verified against the Ozon Global Calculator input controls',
    }]);
  }, 30_000);

  it('allows exactly one concurrent CAS replacement and preserves one linear chain', async () => {
    const seed = await seedScope(first, 'cas');
    const initialId = seed.base + '_contract_initial';
    await repositoryFor(first, initialId, seed.base + '_event_initial')
      .verifyContract(verifyInput(seed, seed.candidates[0]!, null));

    const replacementAId = seed.base + '_contract_a';
    const replacementBId = seed.base + '_contract_b';
    const replacementA = repositoryFor(first, replacementAId, seed.base + '_event_a');
    const replacementB = repositoryFor(second, replacementBId, seed.base + '_event_b');
    const results = await Promise.allSettled([
      replacementA.verifyContract(verifyInput(seed, seed.candidates[1]!, initialId)),
      replacementB.verifyContract(verifyInput(seed, seed.candidates[2]!, initialId)),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const winnerId = results[0]?.status === 'fulfilled' ? replacementAId : replacementBId;

    const chain = await first.$queryRawUnsafe<Array<{
      id: string;
      supersedesId: string | null;
    }>>(
      `SELECT "id", "supersedes_id" AS "supersedesId"
       FROM "logistics_official_input_unit_contracts"
       WHERE "assignment_id" = $1 ORDER BY "created_at", "id"`,
      seed.assignmentId,
    );
    expect(chain).toHaveLength(2);
    expect(chain).toEqual(expect.arrayContaining([
      { id: initialId, supersedesId: null },
      { id: winnerId, supersedesId: initialId },
    ]));

    const events = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "logistics_rule_events"
       WHERE "subject_type" = 'OFFICIAL_INPUT_UNIT_CONTRACT'
         AND "subject_id" = ANY($1::text[])`,
      [initialId, replacementAId, replacementBId],
    );
    expect(Number(events[0]?.count || 0)).toBe(2);

    const loserCandidate = winnerId === replacementAId
      ? seed.candidates[2]!
      : seed.candidates[1]!;
    await expect(repositoryFor(
      first, seed.base + '_contract_stale', seed.base + '_event_stale',
    ).verifyContract(
      verifyInput(seed, loserCandidate, initialId),
    )).rejects.toMatchObject({
      code: 'INPUT_UNIT_CONTRACT_STALE',
      statusCode: 409,
    });
  }, 30_000);

  it('requires an audit event and keeps a final revocation tombstone', async () => {
    const seed = await seedScope(first, 'revoke');
    const contractId = seed.base + '_contract';
    const repository = repositoryFor(first, contractId, seed.base + '_event');
    await repository.verifyContract(verifyInput(seed, seed.candidates[0]!, null));

    const revokedAt = new Date(seed.capturedAt.getTime() + 2_000);
    const reason = 'Input units were reviewed against incorrect source evidence';
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_official_input_unit_contracts"
       SET "revoked_by_id" = $1, "revoked_at" = $2, "revocation_reason" = $3
       WHERE "id" = $4`,
      seed.alternateUserId, revokedAt, reason, contractId,
    )).rejects.toThrow(/revocation event is required/i);

    await expect(repository.revokeContract({
      actorUserId: seed.ownerUserId,
      contractId,
      reason,
      expectedCurrentContractId: contractId,
      revokedAt,
    })).resolves.toMatchObject({ duplicate: false, contractId, revokedAt });
    await expect(repository.revokeContract({
      actorUserId: seed.ownerUserId,
      contractId,
      reason,
      expectedCurrentContractId: contractId,
      revokedAt,
    })).resolves.toEqual({ duplicate: true, contractId });
    await expect(repository.revokeContract({
      actorUserId: seed.alternateUserId,
      contractId,
      reason: 'Different revocation reason',
      expectedCurrentContractId: contractId,
      revokedAt,
    })).rejects.toMatchObject({ code: 'INPUT_UNIT_CONTRACT_ALREADY_REVOKED' });

    const context = await repository.readContext({
      assignmentId: seed.assignmentId,
      at: new Date(revokedAt.getTime() + 1_000),
      sourceMaxAgeMs: 24 * 60 * 60 * 1_000,
    });
    expect(context.current).toBeNull();
    expect(context.history).toEqual([
      expect.objectContaining({
        id: contractId,
        state: 'REVOKED',
        revokedById: seed.ownerUserId,
        revocationReason: reason,
      }),
    ]);

    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_official_input_unit_contracts"
       SET "revoked_by_id" = NULL, "revoked_at" = NULL, "revocation_reason" = NULL
       WHERE "id" = $1`,
      contractId,
    )).rejects.toThrow(/revocation is final/i);
    await expect(first.$executeRawUnsafe(
      'DELETE FROM "logistics_official_input_unit_contracts" WHERE "id" = $1',
      contractId,
    )).rejects.toThrow(/content is immutable/i);

    const events = await first.$queryRawUnsafe<Array<{ type: string }>>(
      `SELECT "type"::text AS type FROM "logistics_rule_events"
       WHERE "subject_type" = 'OFFICIAL_INPUT_UNIT_CONTRACT' AND "subject_id" = $1
       ORDER BY "created_at", "id"`,
      contractId,
    );
    expect(events).toEqual([{ type: 'BINDING_CHANGED' }, { type: 'INVALIDATED' }]);
  }, 30_000);
});
