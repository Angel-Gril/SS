import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
  assertAiImageEditProviderRuntime,
  loadAiImageEditInputBuffer,
  processAiImageEditQueueJob,
  readBoundedAiImageEditFile,
  readBoundedAiImageEditStream,
  resolveAiImageEditProvider,
} from '../workers/ai-image-edit.js';
import { AI_IMAGE_EDIT_MAX_INPUT_BYTES } from '../services/ai-image-edit.js';

const asset = {
  assetId: 'source-1', role: 'REFERENCE' as const, ordinal: 0,
  storageBackend: 'local', storageKey: 'source.png', kind: 'SOURCE_ORIGINAL' as const,
  sha256: 'a'.repeat(64), sizeBytes: Buffer.byteLength('owned-bytes'), width: 2, height: 2,
};

describe('AI image edit worker boundary', () => {
  it('reads local inputs only from the trusted upload root and rejects traversal or unsupported backends', async () => {
    const readLocalFile = vi.fn(async () => Buffer.from('owned-bytes'));
    await expect(loadAiImageEditInputBuffer(asset, { readLocalFile })).resolves.toEqual(Buffer.from('owned-bytes'));
    expect(readLocalFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]public[\\/]uploads[\\/]source\.png$/u),
      Buffer.byteLength('owned-bytes'),
    );

    await expect(loadAiImageEditInputBuffer({ ...asset, storageKey: '../secret' }, { readLocalFile }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    await expect(loadAiImageEditInputBuffer({ ...asset, storageBackend: 'ozon-cdn' }, { readLocalFile }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    await expect(loadAiImageEditInputBuffer(asset, {
      readLocalFile: vi.fn(async () => Buffer.from('changed')),
    })).rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });
  });

  it('bounds local reads before allocation and rejects a changed frozen size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ss-erp-edit-input-'));
    const exactPath = join(directory, 'exact.bin');
    const oversizedPath = join(directory, 'oversized.bin');
    try {
      await writeFile(exactPath, Buffer.from('exact'));
      await expect(readBoundedAiImageEditFile(exactPath, 5)).resolves.toEqual(Buffer.from('exact'));
      await expect(readBoundedAiImageEditFile(exactPath, 4))
        .rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });

      const handle = await open(oversizedPath, 'w');
      await handle.truncate(AI_IMAGE_EDIT_MAX_INPUT_BYTES + 1);
      await handle.close();
      await expect(readBoundedAiImageEditFile(oversizedPath, 5))
        .rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads OSS bodies through a bounded stream and cancels once frozen size is exceeded', async () => {
    let finalized = false;
    async function* changedObject() {
      try {
        yield Buffer.from('exact');
        yield Buffer.from('replacement bytes that must not be retained');
      } finally {
        finalized = true;
      }
    }

    await expect(readBoundedAiImageEditStream(changedObject(), 5))
      .rejects.toMatchObject({ code: 'FROZEN_INPUT_MISMATCH' });
    expect(finalized).toBe(true);
    await expect(readBoundedAiImageEditStream((async function* () {
      yield Buffer.from('exact');
    })(), 5)).resolves.toEqual(Buffer.from('exact'));
  });

  it('uses an exact fake edit adapter that returns the requested dimensions', async () => {
    const provider = resolveAiImageEditProvider('fake', 'fake-image-edit-v1');
    const generated = await provider.generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 3, height: 2, model: 'fake-image-edit-v1',
    });
    expect(provider.name).toBe('fake');
    expect(generated.images).toHaveLength(1);
    const sharp = (await import('sharp')).default;
    await expect(sharp(generated.images[0]!.buffer).metadata()).resolves.toMatchObject({ width: 3, height: 2 });
    await expect(resolveAiImageEditProvider('openai-images', 'gpt-image-1').generate({
      operation: 'FULL_EDIT', prompt: 'edit', negativePrompt: null,
      count: 1, width: 3, height: 2, model: 'gpt-image-1',
    })).rejects.toMatchObject({ code: 'PROVIDER_DISABLED' });
  });

  it('blocks the fake edit Provider in production even when called directly', () => {
    expect(() => assertAiImageEditProviderRuntime('fake', 'production'))
      .toThrowError(expect.objectContaining({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED }));
    expect(() => resolveAiImageEditProvider('fake', 'fake-image-edit-v1', 'production'))
      .toThrowError(expect.objectContaining({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED }));
  });

  it('persists and rejects queued fake edit jobs in production before resolving or running a Provider', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-production-fake', status: 'QUEUED', attemptCount: 0,
        provider: 'fake', model: 'fake-image-edit-v1',
      })),
      markEnqueueFailed: vi.fn(async () => true),
      markFailed: vi.fn(),
    } as any;
    const resolveProvider = vi.fn();
    const run = vi.fn();

    await expect(processAiImageEditQueueJob('job-production-fake', 1, {
      repository,
      nodeEnv: 'production',
      resolveProvider,
      run,
      acquireLease: vi.fn(async () => true),
      releaseLease: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ code: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED });

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-production-fake', expect.objectContaining({
      errorCode: AI_IMAGE_EDIT_FAKE_PROVIDER_PRODUCTION_BLOCKED,
    }));
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('dispatches through the dedicated edit runner without sharing the generation worker', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-1', status: 'QUEUED', operation: 'FULL_EDIT',
        provider: 'fake', model: 'fake-image-edit-v1',
      })),
      markEnqueueFailed: vi.fn(),
    } as any;
    const run = vi.fn(async () => 'completed' as const);
    await processAiImageEditQueueJob('job-1', 1, {
      repository,
      resolveProvider: vi.fn(() => resolveAiImageEditProvider('fake', 'fake-image-edit-v1')),
      uploadBuffer: vi.fn(),
      loadInputBuffer: vi.fn(),
      run,
    });
    expect(run).toHaveBeenCalledWith('job-1', 1, expect.objectContaining({ repository }));
  });

  it('does not enter a second runner while another worker owns the execution lease', async () => {
    const repository = {
      getById: vi.fn(), markFailed: vi.fn(),
    } as any;
    const run = vi.fn();
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 1, {
      repository,
      run,
      acquireLease: vi.fn(async () => false),
      releaseLease,
    })).resolves.toBe('ignored');

    expect(repository.getById).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('fails a queued job explicitly when execution lease infrastructure is unavailable', async () => {
    const infrastructureError = new Error('redis lease unavailable');
    const repository = {
      getById: vi.fn(),
      markEnqueueFailed: vi.fn(async () => true),
      markFailed: vi.fn(),
    } as any;
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 1, {
      repository,
      acquireLease: vi.fn(async () => { throw infrastructureError; }),
      releaseLease,
    })).rejects.toBe(infrastructureError);

    expect(repository.markEnqueueFailed).toHaveBeenCalledWith('job-1', {
      attemptCount: 1,
      errorCode: 'EDIT_EXECUTION_LEASE_UNAVAILABLE',
      errorMessage: 'AI image edit execution coordination is temporarily unavailable',
    });
    expect(repository.getById).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(releaseLease).not.toHaveBeenCalled();
  });

  it('fails an interrupted RUNNING attempt only after exclusively reclaiming its lease', async () => {
    const repository = {
      getById: vi.fn(async () => ({
        id: 'job-1', status: 'RUNNING', operation: 'FULL_EDIT',
        provider: 'fake', model: 'fake-image-edit-v1', attemptCount: 1,
      })),
      markFailed: vi.fn(),
    } as any;
    const releaseLease = vi.fn();

    await expect(processAiImageEditQueueJob('job-1', 2, {
      repository,
      acquireLease: vi.fn(async () => true),
      renewLease: vi.fn(async () => true),
      releaseLease,
    })).rejects.toMatchObject({ code: 'EDIT_RECOVERY_REQUIRED' });

    expect(repository.markFailed).toHaveBeenCalledWith('job-1', expect.objectContaining({
      attemptCount: 2, errorCode: 'EDIT_RECOVERY_REQUIRED',
    }));
    expect(releaseLease).toHaveBeenCalledOnce();
  });
});
