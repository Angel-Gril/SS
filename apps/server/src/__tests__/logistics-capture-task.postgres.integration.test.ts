import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SELLER_CAPTURE_ENDPOINTS,
  createLogisticsCaptureTaskService,
} from '../services/logistics-capture-task.js';
import { createPrismaLogisticsCaptureTaskRepository } from '../services/logistics-capture-task-prisma.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1' && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  const schema = urlText ? new URL(urlText).searchParams.get('schema') || '' : '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

const prefix = () => 'capture_' + randomUUID().replaceAll('-', '').slice(0, 12);

async function seedScope(client: PrismaClient) {
  const base = prefix();
  const ownerUserId = base + '_owner';
  const shopId = base + '_shop';
  const warehouseId = base + '_warehouse';
  const companyId = base + '_company';
  const companyBindingId = base + '_company_binding';
  const originBindingId = base + '_origin_binding';

  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    ownerUserId, base + '_phone', 'test-password-hash',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops" ("id", "user_id", "platform", "name", "api_key_encrypted", "updated_at")
     VALUES ($1, $2, 'OZON', $3, $4, CURRENT_TIMESTAMP)`,
    shopId, ownerUserId, base + ' shop', 'encrypted-test-key',
  );
  await client.$executeRawUnsafe(
    'INSERT INTO "warehouses" ("id", "shop_id", "name", "updated_at") VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
    warehouseId, shopId, base + ' warehouse',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shop_ozon_company_bindings" (
       "id", "tenant_id", "shop_id", "ozon_company_id", "status",
       "open_api_verified_at", "seller_probe_verified_at", "open_api_intersection_verified_at",
       "verified_by_id", "verified_at", "updated_at"
     ) VALUES (
       $1, $2, $3, $4, 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    companyBindingId, ownerUserId, shopId, companyId,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "warehouse_ozon_origin_bindings" (
       "id", "tenant_id", "shop_id", "warehouse_id", "origin_country_uid",
       "origin_city_uid", "origin_label", "status", "open_api_address_verified_at",
       "official_location_verified_at", "verified_by_id", "verified_at", "updated_at"
     ) VALUES (
       $1, $2, $3, $4, 'china', 'xiamen', 'China / Xiamen', 'VERIFIED',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    originBindingId, ownerUserId, shopId, warehouseId,
  );

  async function device(label: string) {
    const pairingId = base + '_pairing_' + label;
    const sessionId = base + '_session_' + label;
    await client.$executeRawUnsafe(
      `INSERT INTO "extension_device_pairing_codes" (
         "id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest",
         "shop_ids", "scopes", "status", "expires_at", "claimed_at", "updated_at"
       ) VALUES (
         $1, 'capture-postgres-test', $2, $2, $3, ARRAY[$4]::text[],
         ARRAY['logistics:capture']::text[], 'CLAIMED',
         CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
      pairingId, ownerUserId,
      createHash('sha256').update(base + label).digest('hex'), shopId,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "extension_device_sessions" (
         "id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id",
         "owner_user_id", "status", "scopes", "current_jti", "expires_at", "updated_at"
       ) VALUES (
         $1, $2, 'capture-postgres-test', $3, $4, $4, 'ACTIVE',
         ARRAY['logistics:capture']::text[], $5,
         CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
       )`,
      sessionId, pairingId, base + '_device_' + label, ownerUserId, base + '_jti_' + label,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "extension_device_shop_grants" (
         "id", "session_id", "shop_id", "status", "granted_at"
       ) VALUES ($1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP)`,
      base + '_grant_' + label, sessionId, shopId,
    );
    return sessionId;
  }

  return {
    ownerUserId,
    shopId,
    warehouseId,
    companyId,
    companyBindingId,
    originBindingId,
    sessionIds: [await device('a'), await device('b')],
    scope: {
      tenantId: ownerUserId,
      shopId,
      companyId,
      warehouseId,
      originCountryUid: 'china',
      originCityUid: 'xiamen',
    },
  };
}

function sellerPayload(rateMinor = '1200') {
  const endpoint = 'seller/template/by-location';
  return {
    schema: 'ozon-seller-logistics-capture/v1',
    capturedAt: new Date().toISOString(),
    responseChecksum: 'f'.repeat(64),
    endpointBatch: {
      expected: [endpoint],
      attempted: [endpoint],
      succeeded: [endpoint],
      failed: [],
      empty: [],
    },
    services: [{
      serviceKey: 'seller:provider-ru:pickup',
      providerId: 'provider-ru',
      routeCandidates: [{
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        evidenceType: 'OZON_STRUCTURED_DESTINATION',
      }],
      formula: { chargeMode: 'ACTUAL_WEIGHT', rateMinor },
    }],
  };
}

async function issueClaimedSellerTask(
  service: ReturnType<typeof createLogisticsCaptureTaskService>,
  seed: Awaited<ReturnType<typeof seedScope>>,
  sessionId: string,
) {
  const task = await service.issueSellerTask({
    requestedByUserId: seed.ownerUserId,
    scope: seed.scope,
    expectedEndpoints: [...SELLER_CAPTURE_ENDPOINTS],
  });
  await service.claimCaptureTask({
    taskId: task.id,
    taskVersion: task.version,
    nonce: task.nonce,
    scope: seed.scope,
    device: {
      sessionId,
      ownerUserId: seed.ownerUserId,
      allowedShopIds: [seed.shopId],
    },
  });
  return task;
}

function sellerUpload(
  task: Awaited<ReturnType<typeof issueClaimedSellerTask>>,
  seed: Awaited<ReturnType<typeof seedScope>>,
  sessionId: string,
  payload: ReturnType<typeof sellerPayload>,
) {
  return {
    taskId: task.id,
    taskVersion: task.version,
    nonce: task.nonce,
    scope: seed.scope,
    payload,
    deviceSessionId: sessionId,
    deviceOwnerUserId: seed.ownerUserId,
    allowedShopIds: [seed.shopId],
  };
}
async function seedCandidateSetGraph(client: PrismaClient) {
  const seed = await seedScope(client);
  const base = prefix();
  const channelId = base + '_channel';
  const assignmentId = base + '_assignment';
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_channels" (
       "id", "channel_type", "tenant_id", "shop_id", "warehouse_id", "ozon_company_id",
       "origin_country_uid", "origin_city_uid", "origin_country_code", "origin_label",
       "company_binding_id", "origin_binding_id", "scope_key", "updated_at"
     ) VALUES (
       $1, 'TENANT', $2, $3, $4, $5, 'china', 'xiamen', 'CN', 'China / Xiamen',
       $6, $7, $8, CURRENT_TIMESTAMP
     )`,
    channelId, seed.ownerUserId, seed.shopId, seed.warehouseId, seed.companyId,
    seed.companyBindingId, seed.originBindingId, base + '_scope',
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "logistics_rule_assignments" (
       "id", "tenant_id", "shop_id", "warehouse_id", "channel_id",
       "destination_country_uid", "destination_location_uid",
       "destination_country_code", "destination_label", "updated_at"
     ) VALUES (
       $1, $2, $3, $4, $5, 'russia', 'moscow', 'RU', 'Russia / Moscow',
       CURRENT_TIMESTAMP
     )`,
    assignmentId, seed.ownerUserId, seed.shopId, seed.warehouseId, channelId,
  );

  async function candidate(kind: 'SELLER' | 'OFFICIAL') {
    const taskId = base + '_' + kind.toLowerCase() + '_task';
    const candidateId = base + '_' + kind.toLowerCase() + '_candidate';
    const fingerprintChecksum = createHash('sha256').update(taskId).digest('hex');
    const responseChecksum = createHash('sha256').update(candidateId).digest('hex');
    await client.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_tasks" (
         "id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
         "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
         "company_binding_id", "origin_binding_id", "destination_country_uid",
         "destination_location_uid", "official_fingerprint", "expected_endpoints",
         "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at",
         "updated_at"
       ) VALUES (
         $1, 'logistics-capture-task/v1', $8::"LogisticsCaptureTaskKind", $2, $2, $3,
         $4, $5, 'china', 'xiamen', $6, $7,
         CASE WHEN $8 = 'OFFICIAL' THEN 'russia' ELSE NULL END,
         CASE WHEN $8 = 'OFFICIAL' THEN 'moscow' ELSE NULL END,
         CASE WHEN $8 = 'OFFICIAL' THEN '{}'::jsonb ELSE NULL END,
         CASE WHEN $8 = 'OFFICIAL'
           THEN ARRAY['global-calculator/calculate']::text[]
           ELSE ARRAY['seller/template/by-location', 'seller/category/list',
                      'seller/delivery-speed', 'seller/provider-inventory']::text[] END,
         $9, $10, 'ISSUED', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
       )`,
      taskId, seed.ownerUserId, seed.shopId, seed.companyId, seed.warehouseId,
      seed.companyBindingId, seed.originBindingId, kind, fingerprintChecksum,
      createHash('sha256').update(taskId + '_nonce').digest('hex'),
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_candidates" (
         "id", "source_task_id", "task_version", "task_kind", "tenant_id", "shop_id", "company_id",
         "warehouse_id", "origin_country_uid", "origin_city_uid",
         "destination_country_uid", "destination_location_uid", "fingerprint_checksum",
         "response_checksum", "received_at", "state", "source_trust",
         "normalized_payload", "diagnostics", "review_status", "reviewed_by_id",
         "reviewed_at", "review_reason"
       ) VALUES (
         $1, $2, 'logistics-capture-task/v1', $3::"LogisticsCaptureTaskKind", $4, $5, $6, $7, 'china', 'xiamen',
         CASE WHEN $3 = 'OFFICIAL' THEN 'russia' ELSE NULL END,
         CASE WHEN $3 = 'OFFICIAL' THEN 'moscow' ELSE NULL END,
         $8, $9, CURRENT_TIMESTAMP, 'CAPTURED', 'postgres-candidate-set-test',
         '{}'::jsonb, '{}'::jsonb, 'VERIFIED', $4, CURRENT_TIMESTAMP,
         'verified candidate evidence'
       )`,
      candidateId, taskId, kind, seed.ownerUserId, seed.shopId, seed.companyId,
      seed.warehouseId, fingerprintChecksum, responseChecksum,
    );
    return { candidateId, responseChecksum };
  }

  return {
    ...seed,
    channelId,
    assignmentId,
    seller: await candidate('SELLER'),
    official: await candidate('OFFICIAL'),
  };
}

async function insertCompleteCandidateSet(
  client: PrismaClient,
  graph: Awaited<ReturnType<typeof seedCandidateSetGraph>>,
  label: string,
) {
  const candidateSetId = prefix() + '_set_' + label;
  const contentChecksum = createHash('sha256').update(candidateSetId).digest('hex');
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_candidate_sets" (
         "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
         "origin_country_uid", "origin_city_uid", "destination_country_uid",
         "destination_location_uid", "assignment_id", "channel_id",
         "seller_candidate_id", "official_candidate_ids", "selected_service_keys",
         "default_service_keys", "matrix_input", "validation_matrix", "point_evidence",
         "content_checksum", "min_extension_version", "created_by_id"
       ) VALUES (
         $1, $2, $3, $4, $5, 'china', 'xiamen', 'russia', 'moscow', $6, $7, $8,
         ARRAY[$9]::text[], ARRAY['service-a']::text[], ARRAY['service-a']::text[],
         '{}'::jsonb, '{}'::jsonb, '{"status":"matched"}'::jsonb, $10, '1.0.127', $2
       )`,
      candidateSetId, graph.ownerUserId, graph.shopId, graph.companyId,
      graph.warehouseId, graph.assignmentId, graph.channelId,
      graph.seller.candidateId, graph.official.candidateId, contentChecksum,
    );
    await tx.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_candidate_set_officials" (
         "candidate_set_id", "official_candidate_id", "tenant_id", "shop_id",
         "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
         "fingerprint_key", "response_checksum"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'china', 'xiamen', $7, $8)`,
      candidateSetId, graph.official.candidateId, graph.ownerUserId, graph.shopId,
      graph.companyId, graph.warehouseId, 'fingerprint-' + label,
      graph.official.responseChecksum,
    );
  });
}

describePostgres('logistics capture task PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const schema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const rows = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(rows[0]?.schema).toBe(schema);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('allows one claimant and atomically deduplicates concurrent uploads', async () => {
    const seed = await seedScope(first);
    const firstService = createLogisticsCaptureTaskService({
      repository: createPrismaLogisticsCaptureTaskRepository({ client: first }),
    });
    const secondService = createLogisticsCaptureTaskService({
      repository: createPrismaLogisticsCaptureTaskRepository({ client: second }),
    });
    const task = await firstService.issueSellerTask({
      requestedByUserId: seed.ownerUserId,
      scope: seed.scope,
      expectedEndpoints: [...SELLER_CAPTURE_ENDPOINTS],
    });
    const claimInput = (sessionId: string) => ({
      taskId: task.id,
      taskVersion: task.version,
      nonce: task.nonce,
      scope: seed.scope,
      device: {
        sessionId,
        ownerUserId: seed.ownerUserId,
        allowedShopIds: [seed.shopId],
      },
    });
    const claims = await Promise.allSettled([
      firstService.claimCaptureTask(claimInput(seed.sessionIds[0]!)),
      secondService.claimCaptureTask(claimInput(seed.sessionIds[1]!)),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = claims.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('capture claim has no winner');
    const sessionId = winner.value.claimedBySessionId!;

    const upload = {
      taskId: task.id,
      taskVersion: task.version,
      nonce: task.nonce,
      scope: seed.scope,
      payload: sellerPayload(),
      deviceSessionId: sessionId,
      deviceOwnerUserId: seed.ownerUserId,
      allowedShopIds: [seed.shopId],
    };
    const uploads = await Promise.all([
      firstService.submitCapture(upload),
      secondService.submitCapture(upload),
    ]);
    expect(uploads.map((result) => result.kind).sort()).toEqual(['created', 'duplicate']);

    const candidates = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT COUNT(*) AS count FROM "logistics_capture_candidates" WHERE "tenant_id" = $1',
      seed.ownerUserId,
    );
    expect(Number(candidates[0]?.count || 0)).toBe(1);
    const tasks = await first.$queryRawUnsafe<Array<{ status: string; candidateId: string | null }>>(
      `SELECT "status"::text AS status, "candidate_id" AS "candidateId"
       FROM "logistics_capture_tasks" WHERE "id" = $1`,
      task.id,
    );
    expect(tasks[0]).toMatchObject({ status: 'REVIEWABLE' });
    expect(tasks[0]?.candidateId).toBeTruthy();
  }, 30_000);
  it('reuses one candidate across sequential identical uploads from separate tasks', async () => {
    const seed = await seedScope(first);
    const service = createLogisticsCaptureTaskService({
      repository: createPrismaLogisticsCaptureTaskRepository({ client: first }),
    });
    const sessionId = seed.sessionIds[0]!;
    const firstTask = await issueClaimedSellerTask(service, seed, sessionId);
    const secondTask = await issueClaimedSellerTask(service, seed, sessionId);
    const payload = sellerPayload();

    const created = await service.submitCapture(sellerUpload(
      firstTask, seed, sessionId, payload,
    ));
    const duplicate = await service.submitCapture(sellerUpload(
      secondTask, seed, sessionId, payload,
    ));

    expect(created).toMatchObject({ kind: 'created', duplicate: false });
    expect(duplicate).toMatchObject({
      kind: 'duplicate',
      duplicate: true,
      candidateId: created.candidateId,
    });
    const tasks = await first.$queryRawUnsafe<Array<{ candidateId: string | null }>>(
      `SELECT "candidate_id" AS "candidateId"
         FROM "logistics_capture_tasks"
        WHERE "id" = ANY($1::text[])
        ORDER BY "id"`,
      [firstTask.id, secondTask.id],
    );
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.candidateId))).toEqual(
      new Set([created.candidateId]),
    );
  }, 30_000);

  it('atomically reuses one candidate across concurrent identical uploads from separate tasks', async () => {
    const seed = await seedScope(first);
    const firstService = createLogisticsCaptureTaskService({
      repository: createPrismaLogisticsCaptureTaskRepository({ client: first }),
    });
    const secondService = createLogisticsCaptureTaskService({
      repository: createPrismaLogisticsCaptureTaskRepository({ client: second }),
    });
    const firstTask = await issueClaimedSellerTask(
      firstService, seed, seed.sessionIds[0]!,
    );
    const secondTask = await issueClaimedSellerTask(
      secondService, seed, seed.sessionIds[1]!,
    );
    const payload = sellerPayload();

    const results = await Promise.all([
      firstService.submitCapture(sellerUpload(
        firstTask, seed, seed.sessionIds[0]!, payload,
      )),
      secondService.submitCapture(sellerUpload(
        secondTask, seed, seed.sessionIds[1]!, payload,
      )),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['created', 'duplicate']);
    const candidateIds = new Set(results.map((result) => result.candidateId));
    expect(candidateIds).toHaveLength(1);
    const tasks = await first.$queryRawUnsafe<Array<{ candidateId: string | null }>>(
      `SELECT "candidate_id" AS "candidateId"
         FROM "logistics_capture_tasks"
        WHERE "id" = ANY($1::text[])
        ORDER BY "id"`,
      [firstTask.id, secondTask.id],
    );
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.candidateId))).toEqual(candidateIds);
    const candidates = await first.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count
         FROM "logistics_capture_candidates"
        WHERE "tenant_id" = $1 AND "shop_id" = $2
          AND "fingerprint_checksum" = $3`,
      seed.ownerUserId, seed.shopId, firstTask.fingerprintChecksum,
    );
    expect(Number(candidates[0]?.count || 0)).toBe(1);
  }, 30_000);

  it('rejects a direct cross-tenant task tuple at the database boundary', async () => {
    const own = await seedScope(first);
    const foreign = await seedScope(first);
    await expect(first.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_tasks" (
         "id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
         "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
         "company_binding_id", "origin_binding_id", "expected_endpoints",
         "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at", "updated_at"
       ) SELECT $1, 'logistics-capture-task/v1', 'SELLER', $2, $2, $3, $4, $5,
                'china', 'xiamen', cb."id", ob."id", ARRAY['seller/template/by-location'],
                $6, $7, 'ISSUED', CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
         FROM "shop_ozon_company_bindings" cb, "warehouse_ozon_origin_bindings" ob
        WHERE cb."tenant_id" = $2 AND ob."tenant_id" = $2 LIMIT 1`,
      prefix() + '_invalid_task', own.ownerUserId, foreign.shopId, own.companyId,
      foreign.warehouseId, 'a'.repeat(64), 'b'.repeat(64),
    )).rejects.toBeTruthy();
  });
  it('allows exactly one terminal review decision for each candidate', async () => {
    const seed = await seedScope(first);
    const otherReviewer = await seedScope(first);

    const insertPendingCandidate = async (label: string) => {
      const taskId = prefix() + '_task_' + label;
      const candidateId = prefix() + '_candidate_' + label;
      const fingerprintChecksum = createHash('sha256').update(taskId).digest('hex');
      const responseChecksum = createHash('sha256').update(candidateId).digest('hex');
      const nonceDigest = createHash('sha256').update(taskId + '_nonce').digest('hex');
      await first.$executeRawUnsafe(
        `INSERT INTO "logistics_capture_tasks" (
           "id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
           "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
           "company_binding_id", "origin_binding_id", "expected_endpoints",
           "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at", "updated_at"
         ) SELECT $1, 'logistics-capture-task/v1', 'SELLER', $2, $2, $3, $4, $5,
                  'china', 'xiamen', cb."id", ob."id",
                  ARRAY['seller/template/by-location', 'seller/category/list',
                        'seller/delivery-speed', 'seller/provider-inventory'],
                  $6, $7, 'ISSUED', CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
           FROM "shop_ozon_company_bindings" cb
           JOIN "warehouse_ozon_origin_bindings" ob
             ON ob."tenant_id" = cb."tenant_id" AND ob."shop_id" = cb."shop_id"
          WHERE cb."tenant_id" = $2 AND cb."shop_id" = $3
            AND cb."ozon_company_id" = $4 AND ob."warehouse_id" = $5
          LIMIT 1`,
        taskId, seed.ownerUserId, seed.shopId, seed.companyId, seed.warehouseId,
        fingerprintChecksum, nonceDigest,
      );
      await first.$executeRawUnsafe(
        `INSERT INTO "logistics_capture_candidates" (
           "id", "source_task_id", "task_version", "task_kind", "tenant_id", "shop_id", "company_id",
           "warehouse_id", "origin_country_uid", "origin_city_uid", "fingerprint_checksum",
           "response_checksum", "received_at", "state", "source_trust", "diagnostics"
         ) VALUES (
           $1, $2, 'logistics-capture-task/v1', 'SELLER', $3, $4, $5, $6, 'china', 'xiamen', $7, $8,
           CURRENT_TIMESTAMP, 'CAPTURED', 'postgres-review-test', '{}'::jsonb
         )`,
        candidateId, taskId, seed.ownerUserId, seed.shopId, seed.companyId,
        seed.warehouseId, fingerprintChecksum, responseChecksum,
      );
      return candidateId;
    };

    const verifiedCandidateId = await insertPendingCandidate('verified');
    await first.$executeRawUnsafe(
      `UPDATE "logistics_capture_candidates"
          SET "review_status" = 'VERIFIED', "reviewed_by_id" = $2,
              "reviewed_at" = CURRENT_TIMESTAMP, "review_reason" = 'verified evidence'
        WHERE "id" = $1`,
      verifiedCandidateId, seed.ownerUserId,
    );
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_capture_candidates"
          SET "review_status" = 'REJECTED', "review_reason" = 'changed decision'
        WHERE "id" = $1`,
      verifiedCandidateId,
    )).rejects.toThrow(/review.*final/i);
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_capture_candidates"
          SET "reviewed_by_id" = $2, "review_reason" = 'changed reviewer'
        WHERE "id" = $1`,
      verifiedCandidateId, otherReviewer.ownerUserId,
    )).rejects.toThrow(/review.*final/i);

    const rejectedCandidateId = await insertPendingCandidate('rejected');
    await first.$executeRawUnsafe(
      `UPDATE "logistics_capture_candidates"
          SET "review_status" = 'REJECTED', "reviewed_by_id" = $2,
              "reviewed_at" = CURRENT_TIMESTAMP, "review_reason" = 'rejected evidence'
        WHERE "id" = $1`,
      rejectedCandidateId, seed.ownerUserId,
    );
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_capture_candidates"
          SET "review_status" = 'VERIFIED', "review_reason" = 'changed decision'
        WHERE "id" = $1`,
      rejectedCandidateId,
    )).rejects.toThrow(/review.*final/i);

    const rows = await first.$queryRawUnsafe<Array<{
      id: string;
      reviewStatus: string;
      reviewReason: string;
    }>>(
      `SELECT "id", "review_status"::text AS "reviewStatus", "review_reason" AS "reviewReason"
         FROM "logistics_capture_candidates" WHERE "id" IN ($1, $2) ORDER BY "id"`,
      verifiedCandidateId, rejectedCandidateId,
    );
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: verifiedCandidateId,
        reviewStatus: 'VERIFIED',
        reviewReason: 'verified evidence',
      }),
      expect.objectContaining({
        id: rejectedCandidateId,
        reviewStatus: 'REJECTED',
        reviewReason: 'rejected evidence',
      }),
    ]));
  });
  it('rejects candidates whose provenance differs from the source task', async () => {
    const seed = await seedScope(first);
    const taskId = prefix() + '_provenance_task';
    const fingerprintChecksum = createHash('sha256').update(taskId).digest('hex');
    await first.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_tasks" (
         "id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
         "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
         "company_binding_id", "origin_binding_id", "expected_endpoints",
         "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at", "updated_at"
       ) SELECT $1, 'logistics-capture-task/v1', 'SELLER', $2, $2, $3, $4, $5,
                'china', 'xiamen', cb."id", ob."id",
                ARRAY['seller/template/by-location', 'seller/category/list',
                      'seller/delivery-speed', 'seller/provider-inventory'],
                $6, $7, 'ISSUED', CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP + INTERVAL '10 minutes', CURRENT_TIMESTAMP
         FROM "shop_ozon_company_bindings" cb
         JOIN "warehouse_ozon_origin_bindings" ob
           ON ob."tenant_id" = cb."tenant_id" AND ob."shop_id" = cb."shop_id"
        WHERE cb."tenant_id" = $2 AND cb."shop_id" = $3
          AND cb."ozon_company_id" = $4 AND ob."warehouse_id" = $5
        LIMIT 1`,
      taskId, seed.ownerUserId, seed.shopId, seed.companyId, seed.warehouseId,
      fingerprintChecksum, createHash('sha256').update(taskId + '_nonce').digest('hex'),
    );

    const insertCandidate = (
      candidateId: string,
      taskKind: 'SELLER' | 'OFFICIAL',
      fingerprint: string,
      taskVersion = 'logistics-capture-task/v1',
    ) => first.$executeRawUnsafe(
      `INSERT INTO "logistics_capture_candidates" (
         "id", "source_task_id", "task_kind", "tenant_id", "shop_id", "company_id",
         "warehouse_id", "origin_country_uid", "origin_city_uid",
         "destination_country_uid", "destination_location_uid", "fingerprint_checksum",
         "response_checksum", "received_at", "state", "source_trust", "diagnostics", "task_version"
       ) VALUES (
         $1, $2, $3::"LogisticsCaptureTaskKind", $4, $5, $6, $7, 'china', 'xiamen',
         CASE WHEN $3 = 'OFFICIAL' THEN 'russia' ELSE NULL END,
         CASE WHEN $3 = 'OFFICIAL' THEN 'moscow' ELSE NULL END,
         $8, $9, CURRENT_TIMESTAMP, 'CAPTURED', 'postgres-provenance-test', '{}'::jsonb, $10
       )`,
      candidateId, taskId, taskKind, seed.ownerUserId, seed.shopId, seed.companyId,
      seed.warehouseId, fingerprint,
      createHash('sha256').update(candidateId + '_response').digest('hex'),
      taskVersion,
    );

    await expect(insertCandidate(
      prefix() + '_wrong_kind',
      'OFFICIAL',
      fingerprintChecksum,
    )).rejects.toThrow(/source task provenance/i);
    await expect(insertCandidate(
      prefix() + '_wrong_fingerprint',
      'SELLER',
      createHash('sha256').update('wrong-fingerprint').digest('hex'),
    )).rejects.toThrow(/source task provenance/i);
    await expect(insertCandidate(
      prefix() + '_wrong_version',
      'SELLER',
      fingerprintChecksum,
      'logistics-capture-task/v2',
    )).rejects.toThrow(/source task provenance/i);

    const validCandidateId = prefix() + '_valid_candidate';
    await insertCandidate(validCandidateId, 'SELLER', fingerprintChecksum);
    await expect(first.$executeRawUnsafe(
      `UPDATE "logistics_capture_tasks"
          SET "fingerprint_checksum" = $2, "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = $1`,
      taskId, createHash('sha256').update('changed-fingerprint').digest('hex'),
    )).rejects.toThrow(/source task provenance/i);

    const rows = await first.$queryRawUnsafe<Array<{
      taskFingerprint: string;
      candidateFingerprint: string;
    }>>(
      `SELECT t."fingerprint_checksum" AS "taskFingerprint",
              c."fingerprint_checksum" AS "candidateFingerprint"
         FROM "logistics_capture_tasks" t
         JOIN "logistics_capture_candidates" c ON c."source_task_id" = t."id"
        WHERE t."id" = $1 AND c."id" = $2`,
      taskId, validCandidateId,
    );
    expect(rows).toEqual([{
      taskFingerprint: fingerprintChecksum,
      candidateFingerprint: fingerprintChecksum,
    }]);
  });

  it('rejects CandidateSets when any company or origin provenance timestamp is missing', async () => {
    const graph = await seedCandidateSetGraph(first);
    // Exercise the CandidateSet trigger independently from the binding-table checks so
    // legacy or externally corrupted VERIFIED rows cannot bypass this final boundary.
    await first.$executeRawUnsafe(
      `ALTER TABLE "shop_ozon_company_bindings"
         DROP CONSTRAINT IF EXISTS "shop_company_verified_evidence_check"`,
    );
    await first.$executeRawUnsafe(
      `ALTER TABLE "warehouse_ozon_origin_bindings"
         DROP CONSTRAINT IF EXISTS "warehouse_origin_verified_evidence_check"`,
    );
    const cases = [
      ['shop_ozon_company_bindings', 'open_api_verified_at', graph.companyBindingId],
      ['shop_ozon_company_bindings', 'seller_probe_verified_at', graph.companyBindingId],
      ['shop_ozon_company_bindings', 'open_api_intersection_verified_at', graph.companyBindingId],
      ['warehouse_ozon_origin_bindings', 'open_api_address_verified_at', graph.originBindingId],
      ['warehouse_ozon_origin_bindings', 'official_location_verified_at', graph.originBindingId],
    ] as const;

    for (const [table, column, bindingId] of cases) {
      await first.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = NULL, "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = $1`,
        bindingId,
      );
      await expect(insertCompleteCandidateSet(first, graph, column)).rejects.toThrow(
        /provenance/i,
      );
      await first.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        bindingId,
      );
    }
  });
});
