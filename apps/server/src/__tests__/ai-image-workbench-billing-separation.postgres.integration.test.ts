import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import type { CreateAiImageJobInput } from '../services/ai-image-jobs.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

function assertIsolatedSchema(urlText: string): string {
  const schema = new URL(urlText).searchParams.get('schema') || '';
  if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) {
    throw new Error('AI_MEDIA_TEST_DATABASE_URL must target an isolated ai_media_test_* schema');
  }
  return schema;
}

describePostgres('dual-mode AI billing separation PostgreSQL boundary', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('AI_MEDIA_TEST_DATABASE_URL is required');
    assertIsolatedSchema(databaseUrl);
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => client?.$disconnect());

  it('ignores a forged BYOK label and requires one reservation and settlement for hosted work', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `billing_owner_${suffix}`;
    const requestFingerprint = 'a'.repeat(64);
    const idempotencyKey = `billing-hosted-${suffix}`;
    await client.user.create({ data: {
      id: ownerUserId,
      phone: `billing_${suffix}`,
      passwordHash: 'integration-test',
    } });

    const repository = new PrismaAiImageJobRepository(client);
    const input = {
      ownerUserId,
      actorUserId: ownerUserId,
      idempotencyKey,
      prompt: 'Hosted billing separation fixture',
      requestFingerprint,
      provider: 'openai-images',
      model: 'gpt-image-1',
      count: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 7,
      executionMode: 'BYOK',
    } as CreateAiImageJobInput & { executionMode: 'BYOK' };

    const created = await repository.createWithQuota(input, 5, 10_000_000);
    expect(created).toMatchObject({
      kind: 'created',
      job: { costReservation: { status: 'RESERVED', estimatedCostMinor: 7 } },
    });
    if (created.kind !== 'created') throw new Error('expected a hosted job');
    const jobId = created.job.id;

    const modeRows = await client.$queryRawUnsafe<Array<{ executionMode: string }>>(
      'SELECT "execution_mode" AS "executionMode" FROM "ai_image_jobs" WHERE "id" = $1',
      jobId,
    );
    expect(modeRows).toEqual([{ executionMode: 'ERP_HOSTED' }]);
    await expect(client.$executeRawUnsafe(
      'UPDATE "ai_image_jobs" SET "execution_mode" = $2 WHERE "id" = $1',
      jobId,
      'BYOK',
    )).rejects.toThrow(/ai_image_jobs_execution_mode_check|check constraint/iu);

    await expect(client.aiImageJob.create({ data: {
      id: `billing_insert_succeeded_${suffix}`,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'SUCCEEDED',
      progress: 100,
      provider: 'openai-images',
      model: 'gpt-image-1',
      prompt: 'Direct successful insert must fail',
      requestFingerprint: 'd'.repeat(64),
      requestedImageCount: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 7,
      actualCostCents: 7,
      billedUnits: 1,
      completedAt: new Date(),
    } })).rejects.toThrow(/requires its exact cost settlement/iu);

    const nonRunningInput = {
      ...input,
      idempotencyKey: `billing-non-running-${suffix}`,
      requestFingerprint: 'e'.repeat(64),
      prompt: 'Non-running completion must not settle',
    };
    const nonRunning = await repository.createWithQuota(nonRunningInput, 5, 10_000_000);
    if (nonRunning.kind !== 'created') throw new Error('expected a non-running hosted job');
    await repository.complete(nonRunning.job.id, {
      providerJobId: null,
      actualCostCents: 7,
      billedUnits: 1,
      assets: [],
    });
    const nonRunningReservation = await client.aiCostReservation.findUniqueOrThrow({
      where: { jobId: nonRunning.job.id },
      include: { settlements: true, job: true },
    });
    expect(nonRunningReservation).toMatchObject({
      status: 'RESERVED',
      job: { status: 'QUEUED', actualCostCents: null, billedUnits: 0 },
      settlements: [],
    });

    const unreservedJob = await client.aiImageJob.create({ data: {
      id: `billing_unreserved_${suffix}`,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'RUNNING',
      provider: 'openai-images',
      model: 'gpt-image-1',
      prompt: 'Unreserved dispatch must fail',
      requestFingerprint: 'b'.repeat(64),
      requestedImageCount: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 7,
    } });
    await expect(client.aiImageJob.update({
      where: { id: unreservedJob.id },
      data: { providerDispatchedAt: new Date() },
    })).rejects.toThrow(/requires an exact RESERVED cost reservation/iu);

    await expect(repository.markRunning(jobId, 1)).resolves.toBe(true);
    await expect(repository.recordProviderDispatchStarted!(jobId, new Date())).resolves.toBe(true);
    await expect(client.aiImageJob.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        progress: 100,
        actualCostCents: 7,
        billedUnits: 1,
        completedAt: new Date(),
      },
    })).rejects.toThrow(/requires its exact cost settlement/iu);

    await repository.complete(jobId, {
      providerJobId: null,
      providerResultReceivedWithoutIdentity: true,
      actualCostCents: 7,
      billedUnits: 1,
      assets: [{
        ownerUserId,
        jobId,
        url: `/uploads/${jobId}.png`,
        storageBackend: 'local',
        storageKey: `${jobId}.png`,
        mimeType: 'image/png',
        sizeBytes: 100,
        sha256: 'c'.repeat(64),
        width: 1024,
        height: 1024,
      }],
    });

    const replay = await repository.createWithQuota(input, 5, 10_000_000);
    expect(replay).toMatchObject({
      kind: 'existing',
      job: { id: jobId, costReservation: { status: 'SETTLED' } },
    });
    const reservation = await client.aiCostReservation.findUniqueOrThrow({
      where: { jobId },
      include: { settlements: true, job: true },
    });
    expect(reservation).toMatchObject({
      status: 'SETTLED',
      job: { status: 'SUCCEEDED', actualCostCents: 7, billedUnits: 1 },
    });
    expect(reservation.settlements).toEqual([expect.objectContaining({
      kind: 'CHARGE', actualCostMinor: 7, billedUnits: 1,
    })]);
    await expect(client.aiImageJob.update({
      where: { id: jobId },
      data: { actualCostCents: 8 },
    })).rejects.toThrow(/requires its exact cost settlement/iu);
    await expect(client.aiImageJob.update({
      where: { id: jobId },
      data: { billedUnits: 2 },
    })).rejects.toThrow(/requires its exact cost settlement/iu);
    expect(await client.aiCostReservation.count({ where: { jobId } })).toBe(1);
  });
});
