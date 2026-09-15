import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiMediaWorkflowRepository } from '../repositories/ai-media-workflow-repository.js';
import {
  AI_GLOBAL_COST_BUDGET_LOCK_KEY,
  lockGlobalAiCostBudgetInTransaction,
} from '../services/ai-cost-budget.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
function contenderDatabaseUrl(label: string) {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('application_name', `ai_media_translation_budget_${label}`);
  return url.toString();
}
const firstClient = enabled
  ? new PrismaClient({ datasources: { db: { url: contenderDatabaseUrl('first') } } })
  : null;
const secondClient = enabled
  ? new PrismaClient({ datasources: { db: { url: contenderDatabaseUrl('second') } } })
  : null;
const barrierClient = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function assertIsolatedSchema() {
  const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
}

async function createTranslationFixture(database: PrismaClient, label: string) {
  const suffix = `${label}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ownerUserId = `translation_budget_owner_${suffix}`;
  const goodsId = `translation_budget_goods_${suffix}`;
  const subjectId = `translation_budget_subject_${suffix}`;
  const snapshotId = `translation_budget_snapshot_${suffix}`;
  const sourceAssetId = `translation_budget_asset_${suffix}`;
  await database.user.create({ data: {
    id: ownerUserId,
    phone: `translation_budget_${suffix}`,
    passwordHash: 'integration-test',
  } });
  await database.supplyGoods.create({ data: {
    id: goodsId,
    userId: ownerUserId,
    title: 'Paid image translation budget fixture',
    sourcePlatform: '1688',
    sourceProductId: `translation_budget_product_${suffix}`,
  } });
  await database.sourceCaptureSubject.create({ data: {
    id: subjectId,
    ownerUserId,
    sourcePlatform: '1688',
    sourceProductId: `translation_budget_product_${suffix}`,
    legacySupplyGoodsId: goodsId,
  } });
  await database.sourceCaptureSnapshot.create({ data: {
    id: snapshotId,
    subjectId,
    version: 1,
    schemaVersion: 'source-product-capture-v2',
    captureHash: digest(`capture-${suffix}`),
    payloadBytes: 2,
    payload: {},
    stageCounts: {},
    provenance: {},
    provenanceComplete: true,
    parserVersion: 'integration',
    completeness: {},
    truncations: [],
    hasEstimatedValues: false,
    profile: {},
    profileHash: digest(`profile-${suffix}`),
    actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT',
    rolloutRevision: 'integration',
    rolloutStage: 'v2_only',
    capturedAt: new Date(),
  } });
  await database.mediaAsset.create({ data: {
    id: sourceAssetId,
    ownerUserId,
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey: 'main-1',
    sourceUrl: `https://source.example/${suffix}.png`,
    url: `/uploads/${suffix}.png`,
    storageBackend: 'local',
    storageKey: `${suffix}.png`,
    mimeType: 'image/png',
    sizeBytes: 68,
    width: 1200,
    height: 800,
    sha256: digest(`source-${suffix}`),
  } });
  return { ownerUserId, goodsId, sourceAssetId, suffix };
}

async function currentGlobalExposure(database: PrismaClient) {
  // These legacy translation fixtures quote USD; CNY tasks have a separate budget bucket.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [settled, pending] = await Promise.all([
    database.aiCostSettlement.aggregate({
      where: {
        kind: { in: ['CHARGE', 'RECONCILED_CHARGE'] },
        createdAt: { gte: dayStart },
        actualCostMinor: { not: null },
        reservation: { currency: 'USD' },
      },
      _sum: { actualCostMinor: true },
    }),
    database.aiCostReservation.aggregate({
      where: { currency: 'USD', status: { in: ['RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'] } },
      _sum: { maximumCostMinor: true },
    }),
  ]);
  return Number(settled._sum.actualCostMinor || 0) + Number(pending._sum.maximumCostMinor || 0);
}

async function backendPid(database: PrismaClient): Promise<number> {
  const rows = await database.$queryRawUnsafe<Array<{ pid: number }>>(
    'SELECT pg_backend_pid()::integer AS pid',
  );
  const pid = Number(rows[0]?.pid ?? -1);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Dedicated PostgreSQL budget contender connection is unavailable');
  }
  return pid;
}

async function waitingGlobalBudgetLockCount(
  database: PrismaClient,
  contenderPids: readonly [number, number],
): Promise<number> {
  const rows = await database.$queryRawUnsafe<Array<{ waiting: number }>>(`
    WITH target_lock AS (
      SELECT
        hashtextextended($1, 7390421)::bigint AS lock_key,
        (SELECT oid FROM pg_database WHERE datname = current_database()) AS database_oid
    )
    SELECT count(DISTINCT lock.pid)::integer AS waiting
    FROM pg_locks AS lock
    CROSS JOIN target_lock
    WHERE lock.locktype = 'advisory'
      AND lock.database = target_lock.database_oid
      AND lock.classid = (((target_lock.lock_key >> 32) & 4294967295)::oid)
      AND lock.objid = ((target_lock.lock_key & 4294967295)::oid)
      AND lock.objsubid = 1
      AND lock.granted = false
      AND lock.pid IN ($2, $3)
  `, AI_GLOBAL_COST_BUDGET_LOCK_KEY, contenderPids[0], contenderPids[1]);
  const waiting = Number(rows[0]?.waiting ?? -1);
  if (!Number.isSafeInteger(waiting) || waiting < 0) {
    throw new Error('Global AI budget advisory-lock waiter count is invalid');
  }
  return waiting;
}

async function waitForGlobalBudgetLockWaiters(
  database: PrismaClient,
  contenderPids: readonly [number, number],
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await waitingGlobalBudgetLockCount(database, contenderPids) === contenderPids.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected ${contenderPids.length} concurrent global AI budget lock waiters`);
}

function paidTranslationInput(
  fixture: Awaited<ReturnType<typeof createTranslationFixture>>,
  idempotencyKey: string,
  globalDailyBudgetCents: number,
) {
  return {
    ownerUserId: fixture.ownerUserId,
    actorUserId: fixture.ownerUserId,
    sourceAssetId: fixture.sourceAssetId,
    sourceLanguage: 'zh',
    targetLanguage: 'ru',
    domainHint: 'Translate product copy without changing the product',
    terminologies: [],
    imageSegment: false as const,
    provider: 'paid-translation-integration',
    model: 'paid-translation-model-v1',
    dailyLimit: 0,
    estimatedCostCents: 60,
    globalDailyBudgetCents,
    idempotencyKey,
    context: { type: 'collect' as const, id: fixture.goodsId },
    options: {
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      domainHint: 'Translate product copy without changing the product',
      terminologies: [],
      imageSegment: false as const,
      policyVersion: 'ai-image-translation-policy/1.0' as const,
    },
  };
}

describePostgres('paid image translation global budget PostgreSQL contract', () => {
  beforeAll(async () => {
    assertIsolatedSchema();
    await Promise.all([
      firstClient!.$connect(),
      secondClient!.$connect(),
      barrierClient!.$connect(),
    ]);
  });

  afterAll(async () => Promise.all([
    firstClient!.$disconnect(),
    secondClient!.$disconnect(),
    barrierClient!.$disconnect(),
  ]));

  it('commits one of two tenants under one remaining allowance and replays without reserving twice', async () => {
    const [firstFixture, secondFixture] = await Promise.all([
      createTranslationFixture(firstClient!, 'first'),
      createTranslationFixture(firstClient!, 'second'),
    ]);
    const baselineExposure = await currentGlobalExposure(firstClient!);
    const budget = baselineExposure + 100;
    const inputs = [
      paidTranslationInput(firstFixture, `translation-budget-first-${firstFixture.suffix}`, budget),
      paidTranslationInput(secondFixture, `translation-budget-second-${secondFixture.suffix}`, budget),
    ];
    const repositories = [
      new PrismaAiMediaWorkflowRepository(firstClient!),
      new PrismaAiMediaWorkflowRepository(secondClient!),
    ];
    const contenderPids = await Promise.all([
      backendPid(firstClient!),
      backendPid(secondClient!),
    ]) as [number, number];
    if (contenderPids[0] === contenderPids[1]) {
      throw new Error('Global AI budget contenders must use distinct PostgreSQL sessions');
    }

    let releaseBarrier: () => void = () => undefined;
    let markBarrierReady: () => void = () => undefined;
    const barrierReleased = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const barrierReady = new Promise<void>((resolve) => { markBarrierReady = resolve; });
    const barrierTransaction = barrierClient!.$transaction(async (tx) => {
      await lockGlobalAiCostBudgetInTransaction(tx);
      markBarrierReady();
      await barrierReleased;
    }, { maxWait: 5_000, timeout: 15_000 });
    await Promise.race([
      barrierReady,
      barrierTransaction.then(() => {
        throw new Error('Global AI budget barrier transaction ended before acquiring its lock');
      }),
    ]);

    const outcomesPromise = Promise.allSettled([
      repositories[0]!.createImageTranslation(inputs[0]!),
      repositories[1]!.createImageTranslation(inputs[1]!),
    ]);
    let barrierError: unknown;
    try {
      await waitForGlobalBudgetLockWaiters(barrierClient!, contenderPids);
    } catch (error) {
      barrierError = error;
    } finally {
      releaseBarrier();
      await barrierTransaction;
    }
    const outcomes = await outcomesPromise;
    if (barrierError) throw barrierError;

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(fulfilled).toHaveLength(1);
    expect(rejected.reason).toMatchObject({ code: 'BUDGET_EXCEEDED' });

    const ownerUserIds = [firstFixture.ownerUserId, secondFixture.ownerUserId];
    const [workflows, jobs, reservations] = await Promise.all([
      firstClient!.aiMediaWorkflow.findMany({
        where: { ownerUserId: { in: ownerUserIds }, operation: 'IMAGE_TRANSLATE' },
        select: { id: true, ownerUserId: true },
      }),
      firstClient!.aiImageJob.findMany({
        where: { ownerUserId: { in: ownerUserIds }, operation: 'IMAGE_TRANSLATE' },
        select: { id: true, ownerUserId: true },
      }),
      firstClient!.aiCostReservation.findMany({
        where: { ownerUserId: { in: ownerUserIds }, operation: 'IMAGE_TRANSLATE' },
        select: { id: true, ownerUserId: true },
      }),
    ]);
    expect({ workflows: workflows.length, jobs: jobs.length, reservations: reservations.length })
      .toEqual({ workflows: 1, jobs: 1, reservations: 1 });
    expect(new Set([workflows[0]!.ownerUserId, jobs[0]!.ownerUserId, reservations[0]!.ownerUserId]).size)
      .toBe(1);

    const winningOwnerUserId = workflows[0]!.ownerUserId;
    const winnerIndex = ownerUserIds.indexOf(winningOwnerUserId);
    const replay = await repositories[winnerIndex]!.createImageTranslation({
      ...inputs[winnerIndex]!,
      globalDailyBudgetCents: 0,
    });
    expect(replay).toMatchObject({ kind: 'existing', jobId: jobs[0]!.id });
    expect(await firstClient!.aiCostReservation.count({
      where: { ownerUserId: { in: ownerUserIds }, operation: 'IMAGE_TRANSLATE' },
    })).toBe(1);
  }, 30_000);

  it('rejects zero and exhausted global budgets without partial workflow state', async () => {
    const fixture = await createTranslationFixture(firstClient!, 'denied');
    const repository = new PrismaAiMediaWorkflowRepository(firstClient!);
    const exposure = await currentGlobalExposure(firstClient!);
    await expect(repository.createImageTranslation(paidTranslationInput(
      fixture,
      `translation-budget-zero-${fixture.suffix}`,
      0,
    ))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    await expect(repository.createImageTranslation(paidTranslationInput(
      fixture,
      `translation-budget-over-${fixture.suffix}`,
      exposure,
    ))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    const ownerWhere = { ownerUserId: fixture.ownerUserId };
    const [workflows, jobs, reservations] = await Promise.all([
      firstClient!.aiMediaWorkflow.count({ where: ownerWhere }),
      firstClient!.aiImageJob.count({ where: ownerWhere }),
      firstClient!.aiCostReservation.count({ where: ownerWhere }),
    ]);
    expect({ workflows, jobs, reservations }).toEqual({ workflows: 0, jobs: 0, reservations: 0 });
  });
});
