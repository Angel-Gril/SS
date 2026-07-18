import { describe, expect, it, vi } from 'vitest';
import {
  createFakeAiImageTranslationProvider,
  runAiImageTranslationJob,
} from '../services/ai-image-translation.js';
import type { AiImageJobRecord, AiImageJobRepository } from '../services/ai-image-jobs.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

function translationJob(overrides: Partial<AiImageJobRecord> = {}): AiImageJobRecord {
  return {
    id: 'translation-job-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    status: 'QUEUED', operation: 'IMAGE_TRANSLATE', provider: 'fake',
    model: 'fake-image-translation-v1', prompt: 'Translate banner', negativePrompt: null,
    requestedImageCount: 1, width: 1024, height: 1024, attemptCount: 0, maxAttempts: 1,
    idempotencyKey: 'translation-idem-1', estimatedCostCents: 0, actualCostCents: null,
    billedUnits: 0, providerJobId: null, errorCode: null, errorMessage: null,
    inputAssets: [{
      assetId: 'source-asset-1', role: 'REFERENCE', ordinal: 0,
      url: 'https://cdn.example/source.png', mimeType: 'image/png', sha256: 'a'.repeat(64),
    }],
    operationConfig: {
      sourceLanguage: 'zh', targetLanguage: 'ru',
      domainHint: 'Preserve product identity and translate visible marketing copy.',
      terminologies: [{ src: 'piano black', tgt: 'glossy black' }],
      imageSegment: false,
      policyVersion: 'ai-image-translation-policy/1.0',
    },
    ...overrides,
  } as AiImageJobRecord;
}

function memoryRepository(initial = translationJob()) {
  let current = structuredClone(initial);
  const completed: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  const repository: AiImageJobRepository = {
    getById: vi.fn(async () => structuredClone(current)),
    markRunning: vi.fn(async (_id, attemptCount) => {
      if (!['PENDING', 'QUEUED', 'RETRYING'].includes(current.status)) return false;
      current = { ...current, status: 'RUNNING', attemptCount };
      return true;
    }),
    markRetrying: vi.fn(async () => undefined),
    markFailed: vi.fn(async (_id, data) => {
      failures.push(data as unknown as Record<string, unknown>);
      current = {
        ...current,
        status: 'FAILED',
        attemptCount: data.attemptCount,
        providerJobId: data.providerJobId || current.providerJobId,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      };
    }),
    markCancelled: vi.fn(async () => { current = { ...current, status: 'CANCELLED' }; }),
    markSubmissionUncertain: vi.fn(async (_id, data) => {
      failures.push(data as unknown as Record<string, unknown>);
      current = { ...current, status: 'FAILED', errorCode: data.errorCode, errorMessage: data.errorMessage };
    }),
    recordProviderDispatchStarted: vi.fn(async () => {
      current = { ...current, providerDispatchedAt: new Date() };
      return true;
    }),
    recordProviderJobId: vi.fn(async (_id, providerJobId) => {
      current = { ...current, providerJobId };
    }),
    complete: vi.fn(async (_id, data) => {
      completed.push(data as unknown as Record<string, unknown>);
      current = {
        ...current,
        status: 'SUCCEEDED',
        providerJobId: data.providerJobId,
        actualCostCents: data.actualCostCents,
        billedUnits: data.billedUnits,
      };
    }),
    createWithQuota: vi.fn(),
    requestCancellation: vi.fn(),
    recordApplication: vi.fn(),
  };
  return { repository, current: () => current, completed, failures };
}

describe('AI image translation lifecycle', () => {
  it('persists the provider task before polling and resumes without resubmitting', async () => {
    const state = memoryRepository();
    const provider = createFakeAiImageTranslationProvider({
      image: { buffer: png, mimeType: 'image/png' },
      providerJobId: 'translation-task-1',
      pendingPolls: 1,
    });
    const submit = vi.spyOn(provider, 'submit');
    const poll = vi.spyOn(provider, 'poll');
    const uploadBuffer = vi.fn(async () => ({
      url: 'https://owned.example/translated.png', backend: 'oss', key: 'translated.png',
    }));

    await expect(runAiImageTranslationJob('translation-job-1', 1, {
      repository: state.repository, provider, uploadBuffer,
    })).resolves.toBe('pending');
    expect(state.current()).toMatchObject({ status: 'RUNNING', providerJobId: 'translation-task-1' });
    expect(state.repository.recordProviderJobId).toHaveBeenCalledBefore(poll);

    await expect(runAiImageTranslationJob('translation-job-1', 2, {
      repository: state.repository, provider, uploadBuffer,
    })).resolves.toBe('completed');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(uploadBuffer).toHaveBeenCalledTimes(1);
    expect(uploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringMatching(/\.png$/u),
      'image/png',
      expect.objectContaining({
        category: 'ai-generated', ownerId: 'owner-1',
        idempotencyKey: expect.stringMatching(/^translation-job-1:[a-f0-9]{64}$/u),
      }),
    );
    expect(state.current()).toMatchObject({ status: 'SUCCEEDED', billedUnits: 1 });
    expect(state.completed[0]).toMatchObject({
      providerJobId: 'translation-task-1',
      assets: [expect.objectContaining({ url: 'https://owned.example/translated.png' })],
    });
  });

  it('rejects a missing owned source URL before provider submission', async () => {
    const state = memoryRepository(translationJob({
      inputAssets: [{ assetId: 'source-asset-1', role: 'REFERENCE', ordinal: 0 }],
    }));
    const provider = createFakeAiImageTranslationProvider({
      image: { buffer: png, mimeType: 'image/png' },
    });
    const submit = vi.spyOn(provider, 'submit');

    await expect(runAiImageTranslationJob('translation-job-1', 1, {
      repository: state.repository,
      provider,
      uploadBuffer: vi.fn(),
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(submit).not.toHaveBeenCalled();
    expect(state.current()).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_MEDIA_INPUT' });
  });

  it('rejects a mask instead of silently ignoring it', async () => {
    const state = memoryRepository(translationJob({
      inputAssets: [
        {
          assetId: 'source-asset-1', role: 'REFERENCE', ordinal: 0,
          url: 'https://cdn.example/source.png', mimeType: 'image/png', sha256: 'a'.repeat(64),
        },
        {
          assetId: 'mask-asset-1', role: 'MASK', ordinal: 0,
          url: 'https://cdn.example/mask.png', mimeType: 'image/png', sha256: 'b'.repeat(64),
        },
      ],
    }));
    const provider = createFakeAiImageTranslationProvider({ image: { buffer: png, mimeType: 'image/png' } });
    const submit = vi.spyOn(provider, 'submit');
    await expect(runAiImageTranslationJob('translation-job-1', 1, {
      repository: state.repository, provider, uploadBuffer: vi.fn(),
    })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('cancels without producing an output and leaves the source untouched', async () => {
    const state = memoryRepository(translationJob({ status: 'CANCEL_REQUESTED' }));
    const provider = createFakeAiImageTranslationProvider({
      image: { buffer: png, mimeType: 'image/png' },
    });
    const submit = vi.spyOn(provider, 'submit');
    const uploadBuffer = vi.fn();
    await expect(runAiImageTranslationJob('translation-job-1', 1, {
      repository: state.repository, provider, uploadBuffer,
    })).resolves.toBe('ignored');
    expect(state.current().status).toBe('CANCELLED');
    expect(submit).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(state.completed).toHaveLength(0);
  });

  it('marks an accepted remote task as uncertain when cancellation cannot cancel the provider task', async () => {
    const state = memoryRepository(translationJob({
      status: 'CANCEL_REQUESTED', providerJobId: 'provider-task-cancelled-locally',
    }));
    const provider = createFakeAiImageTranslationProvider({ image: { buffer: png, mimeType: 'image/png' } });
    await expect(runAiImageTranslationJob('translation-job-1', 1, {
      repository: state.repository, provider, uploadBuffer: vi.fn(),
    })).resolves.toBe('ignored');
    expect(state.repository.markCancelled).toHaveBeenCalledWith('translation-job-1', {
      providerSubmissionUncertain: true,
    });
  });
});
