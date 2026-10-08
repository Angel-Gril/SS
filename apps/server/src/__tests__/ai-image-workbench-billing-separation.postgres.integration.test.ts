import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import type { CreateAiImageJobInput } from '../services/ai-image-jobs.js';
import { createAiImageJob, runAiImageJob } from '../services/ai-image-jobs.js';
import { createGptImage2CountGenerationProvider } from '../services/ai-image-providers.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { resolveAiImageProvider } from '../workers/ai-image-generation.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('../lib/redis.js', () => ({ redisDisabled: true, redis: {} }));

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
    vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
  });

  afterAll(async () => client?.$disconnect());

  it('persists an ordinary count TEXT_TO_IMAGE raw/final pair and settles CNY0.10 only once', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `count_text_owner_${suffix}`;
    await client.user.create({ data: { id: ownerUserId, phone: `count_text_${suffix}`, passwordHash: 'integration-test', role: 'USER' } });
    const runtime = { provider: 'custom', model: 'gpt-image-2-count', baseUrl: 'https://ai.big-model-api.top/v1',
      apiKey: 'synthetic-count-text-key', costPerImageCents: 10, currency: 'CNY' as const,
      credentialRevision: { recordId: 'fixture-count-text-key-record', revision: 3, updatedAt: '2026-10-08T00:00:00.000Z' } };
    const repository = new PrismaAiImageJobRepository(client);
    const input: CreateAiImageJobInput = { ownerUserId, actorUserId: ownerUserId, idempotencyKey: `count-text-${suffix}`,
      prompt: 'Synthetic count studio photograph', provider: runtime.provider, model: runtime.model, count: 1,
      width: 1024, height: 1024, estimatedCostCents: 10, requestFingerprint: createHash('sha256').update(`count-text-${suffix}`).digest('hex'),
      operationConfig: createAiImageProviderRuntimeContract(runtime, { count: 1, width: 1024, height: 1024 }) };
    const created = await createAiImageJob(input, repository, 5, 1_000_000);
    expect(created).toMatchObject({ replayed: false, job: { operation: 'TEXT_TO_IMAGE', status: 'QUEUED',
      costReservation: { status: 'RESERVED', currency: 'CNY', estimatedCostMinor: 10, maximumCostMinor: 10 } } });
    const rawOutput = await sharp({ create: { width: 1024, height: 1024, channels: 4,
      background: { r: 230, g: 180, b: 120, alpha: 1 } } }).png().toBuffer();
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://ai.big-model-api.top/v1/images/generations');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init!.body))).toMatchObject({ model: 'gpt-image-2-count', n: 1,
        size: '1024x1024', quality: 'high', response_format: 'url' });
      return new Response(JSON.stringify({ id: `fixture-count-text-request-${suffix}`, data: [{ b64_json: rawOutput.toString('base64') }] }),
        { headers: { 'content-type': 'application/json' } });
    });
    const provider = resolveAiImageProvider(runtime.provider, runtime,
      (providerJobId, acceptedAt) => repository.recordProviderJobId(created.job.id, providerJobId, acceptedAt),
      { createCountGenerationProvider: options => createGptImage2CountGenerationProvider({ ...options, fetch, timeoutMs: 10_000 }) });
    const uploads = new Map<string, Buffer>();
    const uploadBuffer = async (buffer: Buffer, filename: string) => { uploads.set(filename, buffer);
      return { url: `/uploads/${filename}`, backend: 'local', key: filename }; };
    await runAiImageJob(created.job.id, 1, { repository, provider, uploadBuffer });
    const succeeded = await client.aiImageJob.findUniqueOrThrow({ where: { id: created.job.id } });
    expect(succeeded).toMatchObject({ status: 'SUCCEEDED', actualCostCents: 10, billedUnits: 1,
      providerJobId: `fixture-count-text-request-${suffix}` });
    expect(JSON.stringify(succeeded.operationConfig)).not.toContain(runtime.apiKey);
    const assets = await client.mediaAsset.findMany({ where: { aiImageJobId: created.job.id } });
    const raw = assets.find(asset => asset.kind === 'AI_PROVIDER_OUTPUT')!;
    const final = assets.find(asset => asset.kind === 'AI_GENERATED')!;
    expect(assets).toHaveLength(2);
    expect(raw).toMatchObject({ width: 1024, height: 1024, sha256: digest(rawOutput), sizeBytes: rawOutput.length });
    expect(final).toMatchObject({ width: 1024, height: 1024 });
    expect(final.metadata).toMatchObject({ rawProviderOutputAssetId: raw.id,
      providerOutput: { width: 1024, height: 1024 }, requestProfile: 'GPT_IMAGE_2_COUNT_GENERATION_V1' });
    const finalBytes = [...uploads.entries()].find(([filename]) => filename.includes('-normalized-'))![1];
    expect(await sharp(finalBytes).metadata()).toMatchObject({ width: 1024, height: 1024 });
    expect(digest(finalBytes)).toBe(final.sha256);
    await runAiImageJob(created.job.id, 2, { repository, provider, uploadBuffer });
    expect(await createAiImageJob(input, repository, 5, 1_000_000)).toMatchObject({ replayed: true, job: { id: created.job.id } });
    expect(fetch).toHaveBeenCalledOnce();
    const reservation = await client.aiCostReservation.findUniqueOrThrow({ where: { jobId: created.job.id }, include: { settlements: true } });
    expect(reservation).toMatchObject({ status: 'SETTLED', currency: 'CNY', estimatedCostMinor: 10, maximumCostMinor: 10 });
    expect(reservation.settlements).toEqual([expect.objectContaining({ kind: 'CHARGE', actualCostMinor: 10, billedUnits: 1 })]);
    expect(await client.aiCostReservation.count({ where: { jobId: created.job.id } })).toBe(1);
  });

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
