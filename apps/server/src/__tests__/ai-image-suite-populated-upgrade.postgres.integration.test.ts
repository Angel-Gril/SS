import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageSuiteExecutionRepository } from '../repositories/ai-image-suite-execution-repository.js';
import { createAiImageSuiteExecutionService } from '../services/ai-image-suite-execution.js';

const enabled = process.env.RUN_AI_MEDIA_POPULATED_UPGRADE_TESTS === '1';
const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const suiteId = process.env.AI_MEDIA_UPGRADE_SUITE_ID || '';
const ownerUserId = process.env.AI_MEDIA_UPGRADE_OWNER_USER_ID || '';
const actorUserId = process.env.AI_MEDIA_UPGRADE_ACTOR_USER_ID || '';

function exactFixtureId(value: string, label: string): string {
  if (!value || value !== value.trim() || value.length > 200) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

describe.skipIf(!enabled)('AI image suite populated migration upgrade', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    const schema = new URL(databaseUrl).searchParams.get('schema') || '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
      throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
    }
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
