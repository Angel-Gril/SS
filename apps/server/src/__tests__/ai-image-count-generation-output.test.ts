import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { runAiImageJob, type AiImageJobRecord, type AiImageJobRepository } from '../services/ai-image-jobs.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#204096' } }).png().toBuffer();

function initialJob(operation: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' = 'TEXT_TO_IMAGE', width = 900, height = 1200): AiImageJobRecord {
  const identity = { provider: 'custom', model: 'gpt-image-2-count', baseUrl: 'https://ai.big-model-api.top/v1', currency: 'CNY' as const,
    costPerImageCents: 10, credentialRevision: { recordId: 'fixture-key', revision: 1, updatedAt: '2026-10-08T00:00:00.000Z' } };
  return { id: 'count-output-job', ownerUserId: 'fixture-owner', actorUserId: 'fixture-owner', status: 'QUEUED', operation,
    provider: identity.provider, model: identity.model, prompt: 'A product in a studio', negativePrompt: null,
    operationConfig: createAiImageProviderRuntimeContract(identity, { count: 1, width, height }), requestedImageCount: 1,
    width, height, attemptCount: 0, maxAttempts: 3, idempotencyKey: 'fixture-request', estimatedCostCents: 10, actualCostCents: null,
    billedUnits: 0, providerJobId: null, errorCode: null, errorMessage: null,
    costReservation: { id: 'fixture-reservation', currency: 'CNY', status: 'RESERVED', estimatedCostMinor: 10, maximumCostMinor: 10,
      provider: identity.provider, model: identity.model, requestFingerprint: 'a'.repeat(64) } };
}
function state(initial = initialJob()) {
  let current = initial;
  const repository = {
    getById: vi.fn(async () => current),
    markRunning: vi.fn(async () => { current = { ...current, status: 'RUNNING' }; return true; }),
    markRetrying: vi.fn(), markFailed: vi.fn(), markCancelled: vi.fn(), markSubmissionUncertain: vi.fn(),
    recordProviderDispatchStarted: vi.fn(async () => true), recordProviderJobId: vi.fn(),
    recordProviderOutput: vi.fn(async (_id, asset) => ({ ...asset, id: 'fixture-raw-output' })),
    complete: vi.fn(), createWithQuota: vi.fn(), requestCancellation: vi.fn(), recordApplication: vi.fn(),
  } satisfies AiImageJobRepository;
  const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string) => ({ url: `https://storage.fixture.example/${filename}`, backend: 'oss', key: filename }));
  return { repository, uploadBuffer, change: (changes: Partial<AiImageJobRecord>) => { current = { ...current, ...changes }; } };
}

describe('ordinary count generation raw and normalized output lifecycle', () => {
  it.each(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'] as const)('persists truthful raw bytes before normalized %s output and settles only one image', async operation => {
    const job = initialJob(operation), source = await image(900, 1200), raw = await image(896, 1200);
    if (operation === 'IMAGE_TO_IMAGE') job.inputAssets = [{ assetId: 'fixture-source', role: 'REFERENCE', ordinal: 0,
      kind: 'SOURCE_ORIGINAL', storageBackend: 'oss', storageKey: 'fixture-source.png', mimeType: 'image/png',
      sizeBytes: source.length, sha256: sha(source), width: 900, height: 1200 }];
    const current = state(job), loadInputBuffer = vi.fn(async () => source);
    const generate = vi.fn(async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }], providerJobId: 'fixture-accepted', actualCostCents: 999 }));
    await runAiImageJob(job.id, 1, { ...current, provider: { name: 'custom', generate }, loadInputBuffer });
    expect(current.uploadBuffer).toHaveBeenCalledTimes(2);
    expect(current.uploadBuffer.mock.calls[0]![0]).toEqual(raw);
    expect(current.repository.recordProviderOutput).toHaveBeenCalledWith(job.id, expect.objectContaining({ kind: 'AI_PROVIDER_OUTPUT',
      width: 896, height: 1200, sha256: sha(raw), sizeBytes: raw.length, mimeType: 'image/png' }));
    const finalBuffer = current.uploadBuffer.mock.calls[1]![0];
    expect(await sharp(finalBuffer).metadata()).toMatchObject({ width: 900, height: 1200, format: 'png' });
    expect(finalBuffer.equals(raw)).toBe(false);
    expect(current.repository.complete).toHaveBeenCalledWith(job.id, expect.objectContaining({ billedUnits: 1, actualCostCents: 10,
      assets: [expect.objectContaining({ kind: 'AI_GENERATED', width: 900, height: 1200, sha256: sha(finalBuffer),
        metadata: expect.objectContaining({ rawProviderOutputAssetId: 'fixture-raw-output',
          normalizerVersion: 'gpt2-count-ordinary-output-normalizer/v1', providerOutput: { width: 896, height: 1200 } }) })] }));
    expect(current.repository.recordProviderOutput.mock.invocationCallOrder[0])
      .toBeLessThan(current.repository.complete.mock.invocationCallOrder[0]!);
    if (operation === 'IMAGE_TO_IMAGE') expect(generate).toHaveBeenCalledWith(expect.objectContaining({ inputImages: [{ buffer: source, mimeType: 'image/png' }] }));
  });

  it('preserves exact 1024 Provider canvas for default count text generation', async () => {
    const current = state(initialJob('TEXT_TO_IMAGE', 1024, 1024)), raw = await image(1024, 1024);
    await runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate: async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }] }) } });
    expect(current.repository.recordProviderOutput).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ width: 1024, height: 1024, sha256: sha(raw) }));
    expect(current.repository.complete).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ assets: [expect.objectContaining({ width: 1024, height: 1024 })] }));
  });

  it('rejects unavailable raw persistence before dispatch starts', async () => {
    const current = state(), generate = vi.fn();
    const repository = { ...current.repository, recordProviderOutput: undefined };
    await expect(runAiImageJob('count-output-job', 1, { ...current, repository, provider: { name: 'custom', generate } }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
    expect(generate).not.toHaveBeenCalled(); expect(repository.recordProviderDispatchStarted).not.toHaveBeenCalled();
    expect(current.repository.markRetrying).not.toHaveBeenCalled(); expect(current.uploadBuffer).not.toHaveBeenCalled();
  });

  it('rejects two requested outputs before dispatch', async () => {
    const job = initialJob(); job.requestedImageCount = 2; job.estimatedCostCents = 20;
    (job.operationConfig as any).imageCount = 2; (job.operationConfig as any).maximumCostCents = 20;
    const current = state(job), generate = vi.fn();
    await expect(runAiImageJob(job.id, 1, { ...current, provider: { name: 'custom', generate } })).rejects.toMatchObject({ code: 'INVALID_MEDIA_INPUT' });
    expect(generate).not.toHaveBeenCalled(); expect(current.uploadBuffer).not.toHaveBeenCalled();
  });

  it('retains accepted identity without storing or charging a two-image result', async () => {
    const current = state(), raw = await image(896, 1200);
    const generate = vi.fn(async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }, { buffer: raw, mimeType: 'image/png' }], providerJobId: 'fixture-accepted' }));
    await expect(runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate } })).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
    expect(current.repository.recordProviderJobId).toHaveBeenCalledOnce();
    expect(current.repository.markFailed).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ providerJobId: 'fixture-accepted' }));
    expect(current.repository.markRetrying).not.toHaveBeenCalled(); expect(current.repository.complete).not.toHaveBeenCalled();
    expect(current.uploadBuffer).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
  });

  it('preserves original provider identity when raw persistence fails and never retries its POST', async () => {
    const current = state(), raw = await image(896, 1200);
    current.repository.recordProviderOutput.mockRejectedValueOnce(new Error('raw database unavailable'));
    const generate = vi.fn(async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }], providerJobId: 'fixture-accepted' }));
    await expect(runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate } })).rejects.toThrow('raw database unavailable');
    expect(current.uploadBuffer).toHaveBeenCalledOnce(); expect(current.repository.complete).not.toHaveBeenCalled();
    expect(current.repository.markFailed).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ providerJobId: 'fixture-accepted' }));
    expect(current.repository.markRetrying).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
  });

  it('retains a safe but uncharacterized provider frame as raw evidence before normalization rejects it', async () => {
    const current = state(), raw = await image(900, 1199);
    const generate = vi.fn(async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }], providerJobId: 'fixture-accepted' }));
    await expect(runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate } }))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESULT' });
    expect(current.repository.recordProviderOutput).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ width: 900, height: 1199, sha256: sha(raw) }));
    expect(current.uploadBuffer).toHaveBeenCalledOnce(); expect(current.repository.complete).not.toHaveBeenCalled();
    expect(current.repository.markRetrying).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce();
  });

  it('quarantines a raw persistence failure without provider identity', async () => {
    const current = state(), raw = await image(896, 1200);
    current.repository.recordProviderOutput.mockRejectedValueOnce(new Error('raw database unavailable'));
    const generate = vi.fn(async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }] }));
    await expect(runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate } })).rejects.toThrow('raw database unavailable');
    expect(current.repository.markSubmissionUncertain).toHaveBeenCalledWith('count-output-job', expect.objectContaining({ providerSubmissionUncertain: true }));
    expect(current.repository.complete).not.toHaveBeenCalled(); expect(current.repository.markRetrying).not.toHaveBeenCalled();
  });

  it('honors cancellation after raw persistence without creating a final output', async () => {
    const current = state(), raw = await image(896, 1200);
    current.repository.recordProviderOutput.mockImplementationOnce(async (_id, asset) => { current.change({ status: 'CANCEL_REQUESTED' }); return { ...asset, id: 'fixture-raw-output' }; });
    await runAiImageJob('count-output-job', 1, { ...current, provider: { name: 'custom', generate: async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }], providerJobId: 'fixture-accepted' }) } });
    expect(current.repository.markCancelled).toHaveBeenCalledWith('count-output-job');
    expect(current.uploadBuffer).toHaveBeenCalledOnce(); expect(current.repository.complete).not.toHaveBeenCalled();
  });

  it('keeps unrelated legacy and fake generation unchanged without raw persistence requirements', async () => {
    const job = initialJob(); job.provider = 'fake'; job.model = 'fake-image-v1'; job.operationConfig = null; job.costReservation = null; job.estimatedCostCents = 0;
    const current = state(job), raw = Buffer.from('legacy fixture image');
    await runAiImageJob(job.id, 1, { ...current, repository: { ...current.repository, recordProviderOutput: undefined },
      provider: { name: 'fake', generate: async () => ({ images: [{ buffer: raw, mimeType: 'image/png' }] }) } });
    expect(current.uploadBuffer).toHaveBeenCalledOnce(); expect(current.uploadBuffer.mock.calls[0]![0]).toEqual(raw);
    expect(current.repository.complete).toHaveBeenCalledWith(job.id, expect.objectContaining({ actualCostCents: 0, billedUnits: 1 }));
  });
});
