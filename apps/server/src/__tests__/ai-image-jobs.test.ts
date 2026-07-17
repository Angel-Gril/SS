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
    markSubmissionUncertain: vi.fn(async (_id, data) => {
      current = {
        ...current,
        status: 'FAILED',
        attemptCount: data.attemptCount,
        errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
        errorMessage: 'Provider submission outcome requires manual reconciliation',
        billedUnits: 0,
      };
    }),
    recordProviderDispatchStarted: vi.fn(async () => true),
    recordProviderJobId: vi.fn(async (_id, providerJobId) => {
      current = { ...current, providerJobId };
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

  it('records a final-result provider identity before honoring post-generation cancellation', async () => {
    const state = repository();
    const getById = state.repo.getById as ReturnType<typeof vi.fn>;
    getById
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job({ status: 'CANCEL_REQUESTED', providerJobId: 'provider-final' }));
    const provider = createFakeAiImageProvider({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      providerJobId: 'provider-final',
    });
    const uploadBuffer = vi.fn();

    await runAiImageJob('job-1', 1, { repository: state.repo, provider, uploadBuffer });

    expect(state.repo.recordProviderJobId).toHaveBeenCalledWith('job-1', 'provider-final', expect.any(Date));
    expect(state.repo.markCancelled).toHaveBeenCalledWith('job-1');
    expect((state.repo.recordProviderJobId as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan((state.repo.markCancelled as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(state.repo.complete).not.toHaveBeenCalled();
  });

  it('quarantines a paid synchronous result without an ID when cancellation wins', async () => {
    const initial = job({ provider: 'openai-images', model: 'gpt-image-1' });
    const state = repository(initial);
    const getById = state.repo.getById as ReturnType<typeof vi.fn>;
    getById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, status: 'CANCEL_REQUESTED' });
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
        actualCostCents: 3,
      })),
    };
    const uploadBuffer = vi.fn();

    await runAiImageJob('job-1', 1, { repository: state.repo, provider, uploadBuffer });

    expect(state.repo.markCancelled).toHaveBeenCalledWith('job-1', {
      providerSubmissionUncertain: true,
    });
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(state.repo.complete).not.toHaveBeenCalled();
  });

  it('fails accepted provider errors terminally without resubmitting on retry', async () => {
    const state = repository();
    const providerAcceptedAt = new Date('2026-07-17T04:00:00.000Z');
    const provider = {
      name: 'fake',
      generate: vi.fn(async () => {
        throw Object.assign(new Error('accepted task persistence failed'), {
          providerJobId: 'provider-accepted',
          providerAcceptedAt,
        });
      }),
    };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('accepted task persistence failed');

    expect(state.repo.markRetrying).not.toHaveBeenCalled();
    expect(state.repo.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 1,
      providerJobId: 'provider-accepted',
      providerAcceptedAt,
    }));
  });

  it('fails storage errors terminally after a provider identity has been recorded', async () => {
    const state = repository();
    const provider = createFakeAiImageProvider({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      providerJobId: 'provider-before-upload',
    });

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(async () => { throw new Error('storage unavailable'); }),
    })).rejects.toThrow('storage unavailable');

    expect(state.repo.recordProviderJobId).toHaveBeenCalledWith('job-1', 'provider-before-upload', expect.any(Date));
    expect(state.repo.markRetrying).not.toHaveBeenCalled();
    expect(state.repo.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      providerJobId: 'provider-before-upload',
      providerAcceptedAt: expect.any(Date),
    }));
  });

  it('quarantines a paid result without provider identity when storage fails', async () => {
    const state = repository(job({ provider: 'openai-images', model: 'gpt-image-1' }));
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
        actualCostCents: 4,
      })),
    };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(async () => { throw new Error('storage unavailable after generation'); }),
    })).rejects.toThrow('storage unavailable after generation');

    expect(state.repo.markSubmissionUncertain).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 1,
      errorCode: 'PROVIDER_ERROR',
      providerSubmissionUncertain: true,
    }));
    expect(state.repo.markRetrying).not.toHaveBeenCalled();
    expect(state.repo.markFailed).not.toHaveBeenCalled();
    expect(state.repo.complete).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({
      status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', billedUnits: 0,
    });
  });

  it('quarantines a paid result without provider identity when completion fails', async () => {
    const state = repository(job({ provider: 'openai-images', model: 'gpt-image-1' }));
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
        actualCostCents: 4,
      })),
    };
    state.repo.complete = vi.fn(async () => { throw new Error('completion transaction unavailable'); });

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(async () => ({
        url: '/generated.png', backend: 'local', key: 'generated.png',
      })),
    })).rejects.toThrow('completion transaction unavailable');

    expect(state.repo.markSubmissionUncertain).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 1,
      errorCode: 'PROVIDER_ERROR',
      providerSubmissionUncertain: true,
    }));
    expect(state.repo.markRetrying).not.toHaveBeenCalled();
    expect(state.repo.markFailed).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({
      status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', billedUnits: 0,
    });
  });

  it('quarantines unclassified paid provider failures after the dispatch fence', async () => {
    const state = repository(job({ provider: 'openai-images', model: 'gpt-image-1' }));
    delete (state.repo as Partial<AiImageJobRepository>).recordProviderDispatchStarted;
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => { throw new Error('provider rejected before result'); }),
    };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toThrow('provider rejected before result');

    expect(state.repo.markSubmissionUncertain).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 1, errorCode: 'PROVIDER_ERROR', providerSubmissionUncertain: true,
    }));
    expect(state.repo.markRetrying).not.toHaveBeenCalled();
  });

  it('passes no-ID paid result evidence into the completion transaction', async () => {
    const state = repository(job({ provider: 'openai-images', model: 'gpt-image-1' }));
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => ({
        images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
        actualCostCents: 4,
      })),
    };

    await runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(async () => ({
        url: '/generated.png', backend: 'local', key: 'generated.png',
      })),
    });

    expect(state.repo.complete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      providerJobId: null,
      providerResultReceivedWithoutIdentity: true,
    }));
  });

  it('does not retry a provider request that was definitely rejected', async () => {
    const state = repository(job({ provider: 'openai-images', model: 'gpt-image-1' }));
    const provider = {
      name: 'openai-images',
      generate: vi.fn(async () => {
        throw Object.assign(new AiImageJobError('PROVIDER_REQUEST_FAILED', 'Provider rejected the request'), {
          providerSubmissionRejected: true,
        });
      }),
    };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
      maxAttempts: 3,
    })).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_FAILED' });

    expect(state.repo.markRetrying).not.toHaveBeenCalled();
    expect(state.repo.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 1,
      providerSubmissionRejected: true,
    }));
  });

  it('passes frozen IMAGE_TO_IMAGE references to the provider in request order', async () => {
    const inputAssets = [
      {
        assetId: 'asset-source-2', role: 'REFERENCE' as const, ordinal: 0,
        url: 'https://cdn.example/source-2.png', mimeType: 'image/png', sha256: 'b'.repeat(64),
      },
      {
        assetId: 'asset-source-1', role: 'REFERENCE' as const, ordinal: 1,
        url: 'https://cdn.example/source-1.png', mimeType: 'image/png', sha256: 'a'.repeat(64),
      },
    ];
    const state = repository(job({ operation: 'IMAGE_TO_IMAGE', inputAssets }));
    const provider = createFakeAiImageProvider({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
    });
    const generate = vi.spyOn(provider, 'generate');
    await runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(async () => ({ url: '/generated.png', backend: 'local', key: 'generated.png' })),
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'IMAGE_TO_IMAGE', inputAssets,
    }));
  });

  it('rejects an unsupported paid-provider operation before provider submission', async () => {
    const state = repository(job({
      provider: 'openai-images', model: 'gpt-image-1', operation: 'IMAGE_TO_IMAGE',
      inputAssets: [{ assetId: 'asset-1', role: 'REFERENCE', url: 'https://cdn.example/source.png' }],
    }));
    const provider = { name: 'openai-images', generate: vi.fn() };

    await expect(runAiImageJob('job-1', 1, {
      repository: state.repo,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED', errorCode: 'UNSUPPORTED_OPERATION' });
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

  it('rejects an unregistered provider before quota reservation', async () => {
    const createWithQuota = vi.fn();

    await expect(createAiImageJob({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', idempotencyKey: null, prompt: 'photo',
      provider: 'unknown', model: 'x', count: 1, width: 1024, height: 1024, estimatedCostCents: 4,
    }, { createWithQuota }, 5)).rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER_MODEL' });

    expect(createWithQuota).not.toHaveBeenCalled();
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
