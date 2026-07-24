import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrismaAiImageSuiteExecutionRepository,
  PrismaAiImageSuiteGenerationCoordinator,
} from '../repositories/ai-image-suite-execution-repository.js';
import { createAiImageSuiteExecutionService } from '../services/ai-image-suite-execution.js';

const enabled = process.env.RUN_AI_MEDIA_POPULATED_UPGRADE_TESTS === '1';
const legacySuccessEnabled = process.env.RUN_AI_MEDIA_LEGACY_SUCCESS_SEED_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const suiteId = process.env.AI_MEDIA_UPGRADE_SUITE_ID || '';
const ownerUserId = process.env.AI_MEDIA_UPGRADE_OWNER_USER_ID || '';
const actorUserId = process.env.AI_MEDIA_UPGRADE_ACTOR_USER_ID || '';
const legacySuiteId = process.env.AI_MEDIA_LEGACY_SUITE_ID || '';
const legacyOwnerUserId = process.env.AI_MEDIA_LEGACY_OWNER_USER_ID || '';
const legacyActorUserId = process.env.AI_MEDIA_LEGACY_ACTOR_USER_ID || '';

function exactFixtureId(value: string, label: string): string {
  if (!value || value !== value.trim() || value.length > 200) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertIsolatedDatabaseUrl(): void {
  if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
  const schema = new URL(databaseUrl).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

function withoutSuiteOutputSnapshot(client: PrismaClient): PrismaClient {
  const wrapTransaction = (transaction: any) => new Proxy(transaction, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'mediaAsset' || !value) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return new Proxy(value, {
        get(model, method, modelReceiver) {
          const operation = Reflect.get(model, method, modelReceiver);
          if (method !== 'create' || typeof operation !== 'function') {
            return typeof operation === 'function' ? operation.bind(model) : operation;
          }
          return (args: any) => {
            const data = args?.data;
            if (data?.kind !== 'AI_GENERATED'
              || data?.metadata?.version !== 'ai-image-suite-output/v1') {
              return operation.call(model, args);
            }
            const { sourceCaptureSnapshotId: _legacyMissingSnapshot, ...legacyData } = data;
            return operation.call(model, { ...args, data: legacyData });
          };
        },
      });
    },
  });
  return new Proxy(client as any, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return (action: any, options: any) => target.$transaction(
          (transaction: any) => action(wrapTransaction(transaction)),
          options,
        );
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

describe.skipIf(!legacySuccessEnabled)('AI image suite legacy fake completion seed', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    assertIsolatedDatabaseUrl();
    exactFixtureId(legacySuiteId, 'AI_MEDIA_LEGACY_SUITE_ID');
    exactFixtureId(legacyOwnerUserId, 'AI_MEDIA_LEGACY_OWNER_USER_ID');
    exactFixtureId(legacyActorUserId, 'AI_MEDIA_LEGACY_ACTOR_USER_ID');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('persists the legal pre-upgrade fake output shape without a capture snapshot', async () => {
    const before = await client.aiMediaSuite.findFirstOrThrow({
      where: { id: legacySuiteId, ownerUserId: legacyOwnerUserId },
    });
    expect(before).toMatchObject({ provider: 'fake', status: 'PLANNED', revision: 4 });

    const repository = new PrismaAiImageSuiteExecutionRepository(client, {
      runtimeReady: async () => true,
    });
    const service = createAiImageSuiteExecutionService(repository);
    await service.dispatch({
      suiteId: legacySuiteId,
      ownerUserId: legacyOwnerUserId,
      actorUserId: legacyActorUserId,
      expectedRevision: 4,
      operationKey: `legacy-upgrade-dispatch-${legacySuiteId}`.slice(0, 128),
    });
    const coordinator = new PrismaAiImageSuiteGenerationCoordinator(
      withoutSuiteOutputSnapshot(client),
      {
        runtimeReady: async () => true,
        createFakeImage: async () => ({
          buffer: Buffer.from('legacy-suite-upgrade-output'),
          mimeType: 'image/png',
          filename: 'legacy-suite-upgrade-output.png',
        }),
        uploadBuffer: async (_buffer, filename, mimeType, options) => {
          if (!options?.ownerId) throw new Error('Legacy suite upload owner is required');
          return {
            url: `https://storage.example/${options.ownerId}/${filename}`,
            backend: 'local',
            filename,
            key: `${options.ownerId}/${filename}`,
            mimeType,
          };
        },
      },
    );

    for (let iteration = 0; iteration < before.itemCount * 2; iteration += 1) {
      const tasks = await repository.listQueueableTasks(legacySuiteId);
      if (tasks.length === 0) break;
      for (const task of tasks) {
        const claim = await coordinator.revalidateAndClaim(task);
        expect(claim.kind).toBe('ready');
        if (claim.kind !== 'ready') throw new Error('Legacy suite task was not claimable');
        await expect(coordinator.execute(task, claim)).resolves.toMatchObject({ kind: 'completed' });
      }
    }

    const upgradedCandidate = await client.aiMediaSuite.findFirstOrThrow({
      where: { id: legacySuiteId, ownerUserId: legacyOwnerUserId },
      include: {
        slots: {
          include: { childWorkflow: { include: { jobs: { include: { assets: true } } } } },
        },
      },
    });
    expect(upgradedCandidate).toMatchObject({ provider: 'fake', status: 'SUCCEEDED' });
    const outputs = upgradedCandidate.slots.flatMap((slot) => (
      slot.childWorkflow?.jobs.flatMap((job) => job.assets) || []
    ));
    expect(outputs).toHaveLength(upgradedCandidate.itemCount);
    expect(outputs.every((output) => (
      output.kind === 'AI_GENERATED'
      && output.sourceCaptureSnapshotId === null
      && (output.metadata as Record<string, unknown>)?.version === 'ai-image-suite-output/v1'
    ))).toBe(true);
    await client.$queryRawUnsafe(
      'SELECT assert_ai_media_suite_execution_graph($1::text, $2::text)::text AS "result"',
      legacySuiteId,
      legacyOwnerUserId,
    );
  }, 60_000);
});

describe.skipIf(!enabled)('AI image suite populated migration upgrade', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    assertIsolatedDatabaseUrl();
    exactFixtureId(suiteId, 'AI_MEDIA_UPGRADE_SUITE_ID');
    exactFixtureId(ownerUserId, 'AI_MEDIA_UPGRADE_OWNER_USER_ID');
    exactFixtureId(actorUserId, 'AI_MEDIA_UPGRADE_ACTOR_USER_ID');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('preserves a legal revision-4 graph and dispatches it through the real repository', async () => {
    const columns = await client.$queryRawUnsafe<Array<{ column_name: string }>>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ai_media_suite_slots'
        AND column_name IN ('execution_claim_token', 'execution_lease_expires_at')
      ORDER BY column_name
    `);
    expect(columns.map((row) => row.column_name)).toEqual([
      'execution_claim_token',
      'execution_lease_expires_at',
    ]);
    const indexes = await client.$queryRawUnsafe<Array<{ indexname: string }>>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'ai_media_suite_slots'
        AND indexname = 'ai_media_suite_slot_execution_lease_idx'
    `);
    expect(indexes).toHaveLength(1);
    const planActivityIndexes = await client.$queryRawUnsafe<Array<{ indexdef: string }>>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'ai_media_suites'
        AND indexname = 'ai_media_suite_plan_active_key'
    `);
    expect(planActivityIndexes).toHaveLength(1);
    expect(planActivityIndexes[0]?.indexdef).toMatch(/UNIQUE INDEX[\s\S]*\(plan_id\)/u);
    const outputJobConstraints = await client.$queryRawUnsafe<Array<{
      conname: string;
      convalidated: boolean;
      definition: string;
    }>>(`
      SELECT
        constraint_row.conname,
        constraint_row.convalidated,
        pg_get_constraintdef(constraint_row.oid) AS definition
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'media_assets'::regclass
        AND constraint_row.conname IN (
          'media_assets_ai_image_job_id_owner_user_id_fkey',
          'media_assets_ai_image_job_id_fkey'
        )
      ORDER BY constraint_row.conname
    `);
    expect(outputJobConstraints).toEqual([expect.objectContaining({
      conname: 'media_assets_ai_image_job_id_owner_user_id_fkey',
      convalidated: true,
      definition: expect.stringMatching(
        /FOREIGN KEY \(ai_image_job_id, owner_user_id\) REFERENCES ai_image_jobs\(id, owner_user_id\)/u,
      ),
    })]);

    await client.$queryRawUnsafe(
      'SELECT assert_ai_media_suite_materialized_graph($1::text, $2::text)::text AS "result"',
      suiteId,
      ownerUserId,
    );
    await client.$queryRawUnsafe(
      'SELECT assert_ai_media_suite_materialized_authority($1::text, $2::text)::text AS "result"',
      suiteId,
      ownerUserId,
    );
    const before = await client.aiMediaSuite.findFirstOrThrow({
      where: { id: suiteId, ownerUserId },
      include: { slots: { orderBy: { ordinal: 'asc' } } },
    });
    expect(before).toMatchObject({ status: 'PLANNED', revision: 4 });
    expect(before.slots).toHaveLength(before.itemCount);
    expect(before.slots.every((slot) => (
      slot.status === 'PLANNED'
      && slot.attempt === 1
      && slot.revision === 2
      && slot.executionClaimToken === null
      && slot.executionLeaseExpiresAt === null
      && Boolean(slot.childWorkflowId)
    ))).toBe(true);

    const repository = new PrismaAiImageSuiteExecutionRepository(client, {
      runtimeReady: async (suite) => (
        suite.provider === 'fake'
        && suite.model === 'fake-image-suite-v1'
        && suite.estimatedCostCents === 0
        && suite.maximumCostCents === 0
      ),
    });
    const service = createAiImageSuiteExecutionService(repository);
    const dispatched = await service.dispatch({
      suiteId,
      ownerUserId,
      actorUserId,
      expectedRevision: 4,
      operationKey: `populated-upgrade-dispatch-${suiteId}`.slice(0, 128),
    });

    expect(dispatched).toMatchObject({
      replayed: false,
      revision: 5,
      status: 'QUEUED',
      itemCount: before.itemCount,
      concurrencyLimit: before.concurrencyLimit,
    });
    expect(dispatched.counts.queued).toBe(before.concurrencyLimit);
    expect(dispatched.counts.planned).toBe(before.itemCount - before.concurrencyLimit);
    const tasks = await repository.listQueueableTasks(suiteId);
    expect(tasks).toHaveLength(before.concurrencyLimit);
    expect(new Set(tasks.map((task) => task.suiteId))).toEqual(new Set([suiteId]));
    expect(await client.aiMediaSuiteEvent.count({
      where: { suiteId, ownerUserId, revision: 4, eventType: 'CHILDREN_MATERIALIZED' },
    })).toBe(1);
    expect(await client.aiMediaSuiteEvent.count({
      where: { suiteId, ownerUserId, revision: 5, eventType: 'SUITE_DISPATCHED' },
    })).toBe(1);
  }, 30_000);
});
