import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  createSourceProductCaptureV2Submission,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExtensionCommandGrantService } from '../services/extension-command-grants.js';
import { createPrismaExtensionCommandGrantStore } from '../services/extension-command-grants-prisma.js';
import { createPrismaSourceCaptureRepository } from '../services/source-capture-prisma.js';
import {
  buildSourceCaptureCommandEnvelope,
  createSourceCaptureService,
} from '../services/source-capture.js';

const testDatabaseUrl = process.env.LOGISTICS_TEST_DATABASE_URL || '';
const runRequested = process.env.RUN_LOGISTICS_POSTGRES_TESTS === '1';
const explicitRunner = process.env.npm_lifecycle_event === 'test:logistics:postgres';
if (explicitRunner && (!runRequested || !testDatabaseUrl)) {
  throw new Error(
    'test:logistics:postgres requires RUN_LOGISTICS_POSTGRES_TESTS=1 and LOGISTICS_TEST_DATABASE_URL',
  );
}
const enabled = runRequested && Boolean(testDatabaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const COMMAND_SECRET = 'postgres-source-capture-command-secret-012345';

function assertIsolatedSchema(urlText: string): string {
  if (!urlText) throw new Error('LOGISTICS_TEST_DATABASE_URL is required');
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^logistics_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error('LOGISTICS_TEST_DATABASE_URL must target an isolated logistics_test_* schema');
  }
  return schema;
}

async function seedCaptureDevice(client: PrismaClient) {
  const prefix = `capture_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `${prefix}_owner`;
  const shopId = `${prefix}_shop`;
  const pairingId = `${prefix}_pairing`;
  const sessionId = `${prefix}_session`;
  const tokenId = `${prefix}_jti`;
  const now = new Date();
  await client.$executeRawUnsafe(
    'INSERT INTO "users" ("id", "phone", "password_hash", "updated_at") VALUES ($1, $2, $3, $4)',
    ownerUserId,
    `${prefix}_phone`,
    'test-password-hash',
    now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "shops"
      ("id", "user_id", "platform", "name", "api_key_encrypted", "updated_at")
     VALUES ($1, $2, 'OZON', $3, $4, $5)`,
    shopId,
    ownerUserId,
    `${prefix} shop`,
    'encrypted-test-key',
    now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_pairing_codes"
      ("id", "deployment_id", "actor_user_id", "owner_user_id", "code_digest",
       "shop_ids", "scopes", "status", "expires_at", "claimed_at", "created_at", "updated_at")
     VALUES ($1, 'source-capture-postgres-test', $2, $2, $3, ARRAY[$4]::text[],
             ARRAY['capture:write']::text[], 'CLAIMED', $5, $6, $6, $6)`,
    pairingId,
    ownerUserId,
    randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    shopId,
    new Date(now.getTime() + 86_400_000),
    now,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "extension_device_sessions"
      ("id", "pairing_code_id", "deployment_id", "device_id", "actor_user_id", "owner_user_id",
       "status", "scopes", "current_jti", "expires_at", "created_at", "updated_at")
     VALUES ($1, $2, 'source-capture-postgres-test', $3, $4, $4, 'ACTIVE',
             ARRAY['capture:write']::text[], $5, $6, $7, $7)`,
    sessionId,
    pairingId,
    `${prefix}_device`,
    ownerUserId,
    tokenId,
    new Date(now.getTime() + 86_400_000),
    now,
  );
  return { prefix, ownerUserId, shopId, sessionId, tokenId };
}

function fixtureSubmission(): SourceProductCaptureV2Submission {
  return JSON.parse(readFileSync(new URL(
    '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
    import.meta.url,
  ), 'utf8')) as SourceProductCaptureV2Submission;
}

async function expandedSkuSubmission(title: string): Promise<SourceProductCaptureV2Submission> {
  const capture = structuredClone(fixtureSubmission().capture);
  capture.facts.title = title;
  capture.fieldEvidence.title = { ...capture.fieldEvidence.title, value: title };
  const baseSku = capture.skus[0];
  if (!baseSku) throw new Error('source capture fixture must contain one SKU');
  capture.skus = Array.from({ length: 236 }, (_, ordinal) => {
    const key = `sku-${ordinal}`;
    const sourceSkuId = `sku-source-${ordinal}`;
    const specText = `Sanitized option ${ordinal}`;
    const sourcePath = `window.skuMap.${sourceSkuId}`;
    return {
      ...structuredClone(baseSku),
      key,
      ordinal,
      sourceSkuId,
      specText,
      rowEvidence: { ...baseSku.rowEvidence, sourcePath },
      fieldEvidence: {
        ...structuredClone(baseSku.fieldEvidence),
        sourceSkuId: {
          ...baseSku.fieldEvidence.sourceSkuId,
          value: sourceSkuId,
          sourcePath: `${sourcePath}.skuId`,
        },
        specText: {
          ...baseSku.fieldEvidence.specText,
          value: specText,
          sourcePath: `${sourcePath}.specText`,
        },
        priceCny: {
          ...baseSku.fieldEvidence.priceCny,
          sourcePath: `${sourcePath}.price`,
        },
        stock: {
          ...baseSku.fieldEvidence.stock,
          sourcePath: `${sourcePath}.stock`,
        },
      },
    };
  });
  const skuCount = capture.counts.find((count) => count.fieldPath === '/skus');
  if (!skuCount) throw new Error('source capture fixture must contain a SKU count');
  skuCount.totalCount = 236;
  skuCount.capturedCount = 236;
  skuCount.submittedCount = 236;
  return createSourceProductCaptureV2Submission(capture);
}

function captureService(client: PrismaClient) {
  return createSourceCaptureService({
    repository: createPrismaSourceCaptureRepository({
      client,
      commandGrantSecret: COMMAND_SECRET,
    }),
  });
}

function grantService(client: PrismaClient) {
  return createExtensionCommandGrantService({
    store: createPrismaExtensionCommandGrantStore({ client }),
    secret: COMMAND_SECRET,
  });
}

async function issueCaptureGrant(
  client: PrismaClient,
  seed: Awaited<ReturnType<typeof seedCaptureDevice>>,
  submission: SourceProductCaptureV2Submission,
  idempotencyKey: string,
) {
  const requestHash = buildSourceCaptureCommandEnvelope(submission).requestHash;
  const issued = await grantService(client).issue({
    sessionId: seed.sessionId,
    tokenId: seed.tokenId,
    ownerUserId: seed.ownerUserId,
    shopId: null,
    operation: 'SOURCE_CAPTURE',
    workflowId: null,
    draftVersion: null,
    idempotencyKey,
    requestHash,
  });
  return { ...issued, idempotencyKey, requestHash };
}

function ingestInput(
  seed: Awaited<ReturnType<typeof seedCaptureDevice>>,
  submission: SourceProductCaptureV2Submission,
  grant: Awaited<ReturnType<typeof issueCaptureGrant>>,
) {
  return {
    trusted: {
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      deviceSessionId: seed.sessionId,
      tokenId: seed.tokenId,
      rolloutRevision: 'postgres-pilot-1',
      rolloutStage: 'shadow_write' as const,
      ingestChannel: 'EXTENSION_DEVICE' as const,
    },
    submission,
    grant: {
      token: grant.token,
      idempotencyKey: grant.idempotencyKey,
      requestHash: grant.requestHash,
    },
  };
}

describePostgres('source capture PostgreSQL integration', () => {
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    const expectedSchema = assertIsolatedSchema(testDatabaseUrl);
    first = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    second = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const schemaRows = await first.$queryRawUnsafe<Array<{ schema: string }>>(
      'SELECT current_schema() AS schema',
    );
    expect(schemaRows[0]?.schema).toBe(expectedSchema);
    const migrations = await first.$queryRawUnsafe<Array<{ migration_name: string }>>(
      `SELECT "migration_name" FROM "_prisma_migrations"
       WHERE "migration_name" IN (
         '20260714190000_add_extension_command_grants',
         '20260714210000_add_source_capture_snapshots'
       ) AND "finished_at" IS NOT NULL`,
    );
    expect(migrations).toHaveLength(2);
  }, 30_000);

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect()]);
  });

  it('serializes distinct capture hashes into contiguous versions and advances the latest projection', async () => {
    const seed = await seedCaptureDevice(first);
    const firstSubmission = await expandedSkuSubmission('Concurrent capture alpha');
    const secondSubmission = await expandedSkuSubmission('Concurrent capture beta');
    const firstGrant = await issueCaptureGrant(
      first,
      seed,
      firstSubmission,
      `${seed.prefix}_distinct_alpha`,
    );
    const secondGrant = await issueCaptureGrant(
      first,
      seed,
      secondSubmission,
      `${seed.prefix}_distinct_beta`,
    );

    const accepted = await Promise.all([
      captureService(first).ingest(ingestInput(seed, firstSubmission, firstGrant)),
      captureService(second).ingest(ingestInput(seed, secondSubmission, secondGrant)),
    ]);
    expect(accepted.map(({ kind }) => kind)).toEqual(['created', 'created']);
    expect(accepted.map(({ snapshotVersion }) => snapshotVersion).sort((a, b) => a - b))
      .toEqual([1, 2]);

    const snapshots = await first.$queryRawUnsafe<Array<{
      id: string;
      version: number;
      captureHash: string;
      payload: { facts: { title: string }; skus: unknown[] };
      stageCounts: { fields: Record<string, { persistedCount: number; displayedCount: number }> };
    }>>(
      `SELECT c."id", c."version", c."capture_hash" AS "captureHash",
              c."payload", c."stage_counts" AS "stageCounts"
       FROM "source_capture_snapshots" c
       JOIN "source_capture_subjects" s ON s."id" = c."subject_id"
       WHERE s."owner_user_id" = $1
         AND s."source_platform" = $2
         AND s."source_product_id" = $3
       ORDER BY c."version"`,
      seed.ownerUserId,
      firstSubmission.capture.platform,
      firstSubmission.capture.sourceIdentity.productId,
    );
    expect(snapshots.map(({ version }) => version)).toEqual([1, 2]);
    expect(snapshots.map(({ captureHash }) => captureHash).sort()).toEqual([
      firstSubmission.captureHash,
      secondSubmission.captureHash,
    ].sort());
    for (const snapshot of snapshots) {
      expect(snapshot.payload.skus).toHaveLength(236);
      expect(snapshot.stageCounts.fields['/skus']).toMatchObject({
        persistedCount: 236,
        displayedCount: 100,
      });
    }

    const latest = snapshots[1];
    const projection = await first.$queryRawUnsafe<Array<{
      title: string;
      variants: unknown[];
      metadata: {
        sourceCaptureV2: {
          snapshotId: string;
          snapshotVersion: number;
          captureHash: string;
        };
      };
    }>>(
      `SELECT g."title", g."variants", g."metadata"
       FROM "source_capture_subjects" s
       JOIN "supply_goods" g ON g."id" = s."legacy_supply_goods_id"
       WHERE s."owner_user_id" = $1
         AND s."source_platform" = $2
         AND s."source_product_id" = $3`,
      seed.ownerUserId,
      firstSubmission.capture.platform,
      firstSubmission.capture.sourceIdentity.productId,
    );
    expect(projection).toHaveLength(1);
    expect(projection[0]?.variants).toHaveLength(100);
    expect(projection[0]?.title).toBe(latest?.payload.facts.title);
    expect(projection[0]?.metadata.sourceCaptureV2).toEqual({
      subjectId: accepted[0]?.subjectId,
      snapshotId: latest?.id,
      snapshotVersion: 2,
      captureHash: latest?.captureHash,
      schemaVersion: 'source-product-capture-v2',
      provenanceMode: 'native_v2',
      provenanceComplete: true,
      completenessStatus: 'partial',
    });
  }, 45_000);

  it('rolls back grant consumption and every capture write when receipt completion fails last', async () => {
    const seed = await seedCaptureDevice(first);
    const submission = fixtureSubmission();
    const grant = await issueCaptureGrant(
      first,
      seed,
      submission,
      `${seed.prefix}_late_failure`,
    );
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const functionName = `fail_capture_receipt_${suffix}`;
    const triggerName = `fail_capture_receipt_${suffix}`;
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await first.$executeRawUnsafe(
        `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
         BEGIN
           IF NEW."grant_id" = TG_ARGV[0]
             AND NEW."status" = 'SUCCEEDED' THEN
             RAISE EXCEPTION 'forced late source capture failure';
           END IF;
           RETURN NEW;
         END;
         $$ LANGUAGE plpgsql`,
      );
      functionCreated = true;
      await first.$executeRawUnsafe(
        `CREATE TRIGGER "${triggerName}"
         BEFORE UPDATE ON "extension_command_receipts"
         FOR EACH ROW EXECUTE FUNCTION "${functionName}"('${grant.grantId}')`,
      );
      triggerCreated = true;

      await expect(captureService(first).ingest(ingestInput(seed, submission, grant)))
        .rejects.toThrow(/forced late source capture failure/i);

      const rows = await first.$queryRawUnsafe<Array<{
        consumedAt: Date | null;
        receipts: bigint;
        subjects: bigint;
        snapshots: bigint;
        projections: bigint;
      }>>(
        `SELECT g."consumed_at" AS "consumedAt",
                (SELECT COUNT(*) FROM "extension_command_receipts" r
                 WHERE r."grant_id" = g."id") AS "receipts",
                (SELECT COUNT(*) FROM "source_capture_subjects" s
                 WHERE s."owner_user_id" = $2
                   AND s."source_platform" = $3
                   AND s."source_product_id" = $4) AS "subjects",
                (SELECT COUNT(*) FROM "source_capture_snapshots" c
                 WHERE c."actor_user_id" = $2) AS "snapshots",
                (SELECT COUNT(*) FROM "supply_goods" sg
                 WHERE sg."user_id" = $2
                   AND sg."source_platform" = $3
                   AND sg."source_product_id" = $4) AS "projections"
         FROM "extension_command_grants" g
         WHERE g."id" = $1`,
        grant.grantId,
        seed.ownerUserId,
        submission.capture.platform,
        submission.capture.sourceIdentity.productId,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.consumedAt).toBeNull();
      expect(Number(rows[0]?.receipts || 0)).toBe(0);
      expect(Number(rows[0]?.subjects || 0)).toBe(0);
      expect(Number(rows[0]?.snapshots || 0)).toBe(0);
      expect(Number(rows[0]?.projections || 0)).toBe(0);
    } finally {
      if (triggerCreated) {
        await first.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "extension_command_receipts"`,
        );
      }
      if (functionCreated) {
        await first.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
      }
    }

    const retried = await captureService(second).ingest(ingestInput(seed, submission, grant));
    expect(retried).toMatchObject({
      kind: 'created',
      snapshotVersion: 1,
      captureHash: submission.captureHash,
    });
    const durable = await first.$queryRawUnsafe<Array<{
      consumedAt: Date | null;
      receiptStatus: string | null;
      subjects: bigint;
      snapshots: bigint;
      projections: bigint;
    }>>(
      `SELECT g."consumed_at" AS "consumedAt", r."status"::text AS "receiptStatus",
              (SELECT COUNT(*) FROM "source_capture_subjects" s
               WHERE s."owner_user_id" = $2
                 AND s."source_platform" = $3
                 AND s."source_product_id" = $4) AS "subjects",
              (SELECT COUNT(*) FROM "source_capture_snapshots" c
               WHERE c."actor_user_id" = $2) AS "snapshots",
              (SELECT COUNT(*) FROM "supply_goods" sg
               WHERE sg."user_id" = $2
                 AND sg."source_platform" = $3
                 AND sg."source_product_id" = $4) AS "projections"
       FROM "extension_command_grants" g
       LEFT JOIN "extension_command_receipts" r ON r."grant_id" = g."id"
       WHERE g."id" = $1`,
      grant.grantId,
      seed.ownerUserId,
      submission.capture.platform,
      submission.capture.sourceIdentity.productId,
    );
    expect(durable).toHaveLength(1);
    expect(durable[0]?.consumedAt).toBeInstanceOf(Date);
    expect(durable[0]?.receiptStatus).toBe('SUCCEEDED');
    expect(Number(durable[0]?.subjects || 0)).toBe(1);
    expect(Number(durable[0]?.snapshots || 0)).toBe(1);
    expect(Number(durable[0]?.projections || 0)).toBe(1);
  }, 30_000);

  it('converges legacy projection creation across clients while isolating the same source by owner', async () => {
    const seed = await seedCaptureDevice(first);
    const sourceProductId = `legacy-${randomUUID()}`;
    const item = {
      sourcePlatform: '1688',
      sourceProductId,
      sourceUrl: `https://detail.1688.com/offer/${sourceProductId}.html`,
      title: 'Concurrent legacy capture',
      shopName: 'Legacy supplier',
      price: 18.8,
      skuItems: [{ sku: `${sourceProductId}-red`, price: 18.8, stock: 0 }],
      images: ['https://cbu01.alicdn.com/img/ibank/legacy-concurrent.jpg'],
    };
    const trusted = {
      ownerUserId: seed.ownerUserId,
      actorUserId: seed.ownerUserId,
      rolloutRevision: 'postgres-shadow-legacy',
      rolloutStage: 'shadow_write' as const,
      ingestChannel: 'LEGACY_ADAPTER' as const,
    };

    const converged = await Promise.all([
      captureService(first).ensureLegacyProjection({ trusted, item }),
      captureService(second).ensureLegacyProjection({ trusted, item }),
    ]);
    expect(converged.map(({ kind }) => kind).sort()).toEqual(['created', 'reused']);
    expect(new Set(converged.map(({ subjectId }) => subjectId)).size).toBe(1);
    expect(new Set(converged.map(({ supplyGoodsId }) => supplyGoodsId)).size).toBe(1);

    const otherOwner = await seedCaptureDevice(first);
    const otherProjection = await captureService(second).ensureLegacyProjection({
      trusted: {
        ...trusted,
        ownerUserId: otherOwner.ownerUserId,
        actorUserId: otherOwner.ownerUserId,
      },
      item,
    });
    expect(otherProjection.kind).toBe('created');
    expect(otherProjection.subjectId).not.toBe(converged[0]?.subjectId);
    expect(otherProjection.supplyGoodsId).not.toBe(converged[0]?.supplyGoodsId);

    const subjects = await first.$queryRawUnsafe<Array<{
      ownerUserId: string;
      subjectId: string;
      supplyGoodsId: string;
      projectionOwnerUserId: string;
    }>>(
      `SELECT s."owner_user_id" AS "ownerUserId", s."id" AS "subjectId",
              s."legacy_supply_goods_id" AS "supplyGoodsId",
              g."user_id" AS "projectionOwnerUserId"
       FROM "source_capture_subjects" s
       JOIN "supply_goods" g ON g."id" = s."legacy_supply_goods_id"
       WHERE s."source_platform" = '1688' AND s."source_product_id" = $1
       ORDER BY s."owner_user_id"`,
      sourceProductId,
    );
    expect(subjects).toHaveLength(2);
    expect(subjects.map(({ ownerUserId }) => ownerUserId).sort()).toEqual([
      seed.ownerUserId,
      otherOwner.ownerUserId,
    ].sort());
    for (const subject of subjects) {
      expect(subject.projectionOwnerUserId).toBe(subject.ownerUserId);
    }

    await expect(captureService(first).ingestLegacy({
      trusted,
      item,
      supplyGoodsId: otherProjection.supplyGoodsId,
    })).rejects.toMatchObject({
      code: 'SOURCE_CAPTURE_LEGACY_PROJECTION_NOT_FOUND',
      statusCode: 404,
    });
  }, 30_000);

  it('converges exact concurrent ingest and never rolls a V2 projection back to replayed V1', async () => {
    const seed = await seedCaptureDevice(first);
    const fixture = fixtureSubmission();
    const grantV1 = await issueCaptureGrant(
      first,
      seed,
      fixture,
      `${seed.prefix}_capture_v1`,
    );

    const concurrent = await Promise.all([
      captureService(first).ingest(ingestInput(seed, fixture, grantV1)),
      captureService(second).ingest(ingestInput(seed, fixture, grantV1)),
    ]);
    expect(concurrent.map(({ kind }) => kind).sort()).toEqual(['created', 'replay']);
    expect(new Set(concurrent.map(({ snapshotId }) => snapshotId)).size).toBe(1);

    const captureV2 = structuredClone(fixture.capture);
    captureV2.facts.title = 'Sanitized V2 title';
    captureV2.fieldEvidence.title = {
      ...captureV2.fieldEvidence.title,
      value: 'Sanitized V2 title',
    };
    const submissionV2 = await createSourceProductCaptureV2Submission(captureV2);
    const grantV2 = await issueCaptureGrant(
      first,
      seed,
      submissionV2,
      `${seed.prefix}_capture_v2`,
    );
    const acceptedV2 = await captureService(first).ingest(ingestInput(seed, submissionV2, grantV2));
    expect(acceptedV2).toMatchObject({ kind: 'created', snapshotVersion: 2 });

    const replayGrant = await issueCaptureGrant(
      first,
      seed,
      fixture,
      `${seed.prefix}_capture_v1_replay`,
    );
    const replayedV1 = await captureService(second).ingest(ingestInput(seed, fixture, replayGrant));
    expect(replayedV1).toMatchObject({ kind: 'replay', snapshotVersion: 1 });

    const projection = await first.$queryRawUnsafe<Array<{ metadata: any }>>(
      `SELECT g."metadata"
       FROM "source_capture_subjects" s
       JOIN "supply_goods" g ON g."id" = s."legacy_supply_goods_id"
       WHERE s."owner_user_id" = $1 AND s."source_product_id" = $2`,
      seed.ownerUserId,
      fixture.capture.sourceIdentity.productId,
    );
    expect(projection[0]?.metadata?.sourceCaptureV2).toMatchObject({
      snapshotId: acceptedV2.snapshotId,
      snapshotVersion: 2,
      captureHash: submissionV2.captureHash,
    });

    const counts = await first.$queryRawUnsafe<Array<{ subjects: bigint; snapshots: bigint; receipts: bigint }>>(
      `SELECT
         (SELECT COUNT(*) FROM "source_capture_subjects" WHERE "owner_user_id" = $1) AS subjects,
         (SELECT COUNT(*) FROM "source_capture_snapshots" c JOIN "source_capture_subjects" s ON s."id" = c."subject_id" WHERE s."owner_user_id" = $1) AS snapshots,
         (SELECT COUNT(*) FROM "extension_command_receipts" r JOIN "extension_command_grants" g ON g."id" = r."grant_id" WHERE g."owner_user_id" = $1 AND g."operation" = 'SOURCE_CAPTURE') AS receipts`,
      seed.ownerUserId,
    );
    expect(Number(counts[0]?.subjects)).toBe(1);
    expect(Number(counts[0]?.snapshots)).toBe(2);
    expect(Number(counts[0]?.receipts)).toBe(3);

    await expect(first.$executeRawUnsafe(
      'UPDATE "source_capture_snapshots" SET "profile_hash" = $1 WHERE "id" = $2',
      'f'.repeat(64),
      acceptedV2.snapshotId,
    )).rejects.toThrow(/source capture snapshots are immutable/i);
  }, 30_000);
});
