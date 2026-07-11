import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  AiImageJobError,
  applyAiImageJob,
  createAiImageJob,
  createDisabledAiImageProvider,
  createFakeAiImageProvider,
  runAiImageJob,
  type AiImageJobRecord,
  type AiImageJobRepository,
} from '../services/ai-image-jobs.js';

function job(overrides: Partial<AiImageJobRecord> = {}): AiImageJobRecord {
  return {
    id: 'job-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    status: 'QUEUED',
    provider: 'fake',
    model: 'fake-image-v1',
    prompt: 'white studio product photo',
    negativePrompt: null,
    requestedImageCount: 1,
    width: 1024,
    height: 1024,
    attemptCount: 0,
    maxAttempts: 3,
    idempotencyKey: null,
    estimatedCostCents: 4,
    actualCostCents: null,
    billedUnits: 0,
    providerJobId: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function repository(initial = job()) {
  let current = initial;
  const assets: Array<Record<string, unknown>> = [];
  const repo: AiImageJobRepository = {
    getById: vi.fn(async () => current),
    markRunning: vi.fn(async (_id, attemptCount) => {
      current = { ...current, status: 'RUNNING', attemptCount }; return true;
    }),
    markRetrying: vi.fn(async (_id, data) => {
      current = { ...current, status: 'RETRYING', attemptCount: data.attemptCount, errorCode: data.errorCode, errorMessage: data.errorMessage };
    }),
    markFailed: vi.fn(async (_id, data) => {
      current = { ...current, status: 'FAILED', attemptCount: data.attemptCount, errorCode: data.errorCode, errorMessage: data.errorMessage, billedUnits: 0 };
    }),
    markCancelled: vi.fn(async () => {
      current = { ...current, status: 'CANCELLED', billedUnits: 0 };
    }),
    complete: vi.fn(async (_id, data) => {
      current = {
        ...current,
        status: 'SUCCEEDED',
        actualCostCents: data.actualCostCents,
        billedUnits: data.billedUnits,
        providerJobId: data.providerJobId,
      };
      assets.push(...data.assets);
    }),
    createWithQuota: vi.fn(),
    requestCancellation: vi.fn(),
    recordApplication: vi.fn(),
  };
  return { repo, current: () => current, assets };
}

describe('AI image job foundation', () => {
  it('persists generated buffers before completing and bills only stored images', async () => {
    const state = repository();
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string) => ({
      url: `https://cdn.example/${filename}`,
      key: `ai/${filename}`,
      backend: 'oss' as const,
      size: 3,
    }));
    const provider = createFakeAiImageProvider({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      providerJobId: 'provider-123',
      actualCostCents: 3,
    });

    await runAiImageJob('job-1', 1, { repository: state.repo, provider, uploadBuffer });

    expect(uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), expect.stringMatching(/\.png$/), 'image/png', {
      category: 'ai-generated',
      ownerId: 'owner-1',
    });
    expect(state.repo.complete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      providerJobId: 'provider-123',
      actualCostCents: 3,
      billedUnits: 1,
      assets: [expect.objectContaining({ ownerUserId: 'owner-1', mimeType: 'image/png' })],
    }));
  });

  it('marks a provider failure retrying without billing before the final attempt', async () => {
    const state = repository();
    const provider = { name: 'fake', generate: vi.fn(async () => { throw new Error('temporary outage'); }) };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('temporary outage');

    expect(state.repo.markRetrying).toHaveBeenCalledWith('job-1', expect.objectContaining({ attemptCount: 1 }));
    expect(state.repo.markFailed).not.toHaveBeenCalled();
    expect(state.current().billedUnits).toBe(0);
  });

  it('marks the final provider failure failed without billing', async () => {
    const state = repository();
    const provider = { name: 'fake', generate: vi.fn(async () => { throw new Error('permanent outage'); }) };

    await expect(runAiImageJob('job-1', 3, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('permanent outage');

    expect(state.repo.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({ attemptCount: 3 }));
    expect(state.current().billedUnits).toBe(0);
  });

  it('does not call the provider for a cancellation-requested job', async () => {
    const state = repository(job({ status: 'CANCEL_REQUESTED' }));
    const provider = createFakeAiImageProvider({ images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }] });
    const generate = vi.spyOn(provider, 'generate');

    await runAiImageJob('job-1', 1, { repository: state.repo, provider, uploadBuffer: vi.fn() });

    expect(generate).not.toHaveBeenCalled();
    expect(state.repo.markCancelled).toHaveBeenCalledWith('job-1');
  });

  it('rejects disabled providers explicitly', async () => {
    await expect(createDisabledAiImageProvider().generate({
      prompt: 'x', negativePrompt: null, count: 1, width: 1024, height: 1024, model: '',
    })).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('returns the existing owner-scoped job for an idempotency replay', async () => {
    const existing = job({ idempotencyKey: 'request-1' });
    const createWithQuota = vi.fn(async () => ({ kind: 'existing' as const, job: existing }));

    const result = await createAiImageJob({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', idempotencyKey: 'request-1', prompt: 'photo',
      provider: 'fake', model: 'fake-image-v1', count: 1, width: 1024, height: 1024, estimatedCostCents: 4,
    }, { createWithQuota }, 5);

    expect(result).toEqual({ job: existing, replayed: true });
  });

  it('rejects job creation when the atomic quota reservation is exhausted', async () => {
    const createWithQuota = vi.fn(async () => ({ kind: 'quota-exceeded' as const, used: 5, limit: 5 }));

    await expect(createAiImageJob({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', idempotencyKey: null, prompt: 'photo',
      provider: 'fake', model: 'fake-image-v1', count: 1, width: 1024, height: 1024, estimatedCostCents: 4,
    }, { createWithQuota }, 5)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });

  it('requires ownership, success, and an explicit append or replace mode before applying', async () => {
    const succeeded = job({ status: 'SUCCEEDED', billedUnits: 1 });
    const getById = vi.fn(async () => succeeded);
    const recordApplication = vi.fn(async () => ({ ...succeeded, appliedMode: 'append' as const }));

    await expect(applyAiImageJob('job-1', 'other-owner', { mode: 'append', targetType: 'collect', targetId: 'item-1' }, { getById, recordApplication }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(applyAiImageJob('job-1', 'owner-1', { mode: '' as never, targetType: 'collect', targetId: 'item-1' }, { getById, recordApplication }))
      .rejects.toBeInstanceOf(AiImageJobError);

    await applyAiImageJob('job-1', 'owner-1', { mode: 'append', targetType: 'collect', targetId: 'item-1' }, { getById, recordApplication });
    expect(recordApplication).toHaveBeenCalledWith('job-1', expect.objectContaining({ mode: 'append' }));
  });

  it('persists jobs and generated assets with owner-scoped idempotency and cost fields', async () => {
    const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    expect(schema).toContain('model AiImageJob {');
    expect(schema).toContain('model MediaAsset {');
    expect(schema).toContain('@@unique([ownerUserId, idempotencyKey]');
    expect(schema).toContain('actualCostCents');
    expect(schema).toContain('billedUnits');
  });
  it('does not invoke a paid provider when another worker already claimed the job', async () => {
    const state = repository();
    state.repo.markRunning = vi.fn(async () => false) as any;
    const provider = { name: 'openai-images', generate: vi.fn() };

    await runAiImageJob('job-1', 1, { repository: state.repo, provider, uploadBuffer: vi.fn() });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(state.repo.complete).not.toHaveBeenCalled();
  });

});
