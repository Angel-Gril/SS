import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageRoutes, createAiImageRequestFingerprint } from '../routes/ai-images.js';
import {
  createAiImageJob,
  runAiImageJob,
  type AiImageJobRecord,
  type AiImageJobRepository,
} from '../services/ai-image-jobs.js';

const DEFAULT_TEMPLATE_KEY = 'text-to-image.base';
const TEMPLATE_CHECKSUM = 'a'.repeat(64);
const REQUEST_FINGERPRINT = 'b'.repeat(64);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

type PromptResolvedJob = AiImageJobRecord & {
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  requestFingerprint?: string | null;
};

function job(overrides: Partial<PromptResolvedJob> = {}): PromptResolvedJob {
  return {
    id: 'job-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    status: 'QUEUED',
    provider: 'fake',
    model: 'fake-image-v1',
    prompt: 'user photo prompt',
    negativePrompt: 'user negative prompt',
    resolvedPrompt: 'fixed safety policy\nresolved photo prompt',
    resolvedNegativePrompt: 'resolved negative prompt',
    templateKey: DEFAULT_TEMPLATE_KEY,
    templateReleaseId: 'release-1',
    templateChecksum: TEMPLATE_CHECKSUM,
    templateSnapshot: {
      templateKey: DEFAULT_TEMPLATE_KEY,
      releaseId: 'release-1',
      revisionId: 'revision-1',
      sequence: 1,
      checksum: TEMPLATE_CHECKSUM,
    },
    requestFingerprint: REQUEST_FINGERPRINT,
    requestedImageCount: 1,
    width: 1024,
    height: 1024,
    attemptCount: 0,
    maxAttempts: 3,
    idempotencyKey: 'idem-0001',
    estimatedCostCents: 4,
    actualCostCents: null,
    billedUnits: 0,
    providerJobId: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function repositoryFor(currentJob: PromptResolvedJob) {
  const repository: AiImageJobRepository = {
    getById: vi.fn(async () => currentJob),
    createWithQuota: vi.fn(async () => ({
      kind: 'created' as const,
      job: { ...currentJob, status: 'QUEUED' as const },
    })),
    requestCancellation: vi.fn(),
    recordApplication: vi.fn(),
    markRunning: vi.fn(async () => true),
    markRetrying: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
    complete: vi.fn(),
  };
  return repository;
}

describe('AI image prompt resolution boundary', () => {
  it('fingerprints only the canonical client request semantics', () => {
    const original = createAiImageRequestFingerprint({
      prompt: 'user photo prompt',
      negativePrompt: 'user negative prompt',
      count: 1,
      width: 1024,
      height: 1024,
      templateKey: DEFAULT_TEMPLATE_KEY,
    });
    const replay = createAiImageRequestFingerprint({
      prompt: 'user photo prompt',
      negativePrompt: 'user negative prompt',
      count: 1,
      width: 1024,
      height: 1024,
      templateKey: DEFAULT_TEMPLATE_KEY,
    });
    const changed = createAiImageRequestFingerprint({
      prompt: 'different prompt',
      negativePrompt: 'user negative prompt',
      count: 1,
      width: 1024,
      height: 1024,
      templateKey: DEFAULT_TEMPLATE_KEY,
    });

    expect(replay).toBe(original);
    expect(changed).not.toBe(original);
  });

  it('resolves the default template before creation and hides frozen internals from GET', async () => {
    const frozenJob = job({ status: 'SUCCEEDED' });
    const repository = repositoryFor(frozenJob);
    const enqueue = vi.fn(async () => undefined);
    const resolvePrompt = vi.fn(async ({
      templateKey,
      userPrompt,
      userNegativePrompt,
    }: {
      templateKey: string;
      userPrompt: string;
      userNegativePrompt: string;
    }) => ({
      templateKey,
      release: { id: 'release-1', revisionId: 'revision-1', sequence: 1 },
      checksum: TEMPLATE_CHECKSUM,
      snapshot: structuredClone(frozenJob.templateSnapshot),
      resolvedPrompt: `fixed safety policy\n${userPrompt}`,
      resolvedNegativePrompt: `resolved negative\n${userNegativePrompt}`,
    }));
    const app = Fastify();
    await app.register(aiImageRoutes, {
      repository,
      enqueue,
      resolvePrompt,
      authenticate: async (request: FastifyRequest) => {
        (request as any).user = { userId: 'owner-1', actorUserId: 'actor-1' };
      },
      getSettings: async () => ({
        enabled: true,
        provider: 'fake',
        model: 'fake-image-v1',
        dailyLimit: 5,
        estimatedCostCents: 4,
      }),
      getMediaWorkflowDecision: async () => ({
        enabled: true,
        reason: 'tenant_allowed',
        revision: 1,
      }),
    } as any);

    const created = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        prompt: 'user photo prompt',
        negativePrompt: 'user negative prompt',
        count: 1,
        width: 1024,
        height: 1024,
        idempotencyKey: 'idem-0001',
      },
    });

    expect(created.statusCode).toBe(202);
    expect(resolvePrompt).toHaveBeenCalledWith({
      templateKey: DEFAULT_TEMPLATE_KEY,
      userPrompt: 'user photo prompt',
      userNegativePrompt: 'user negative prompt',
    });
    expect(repository.createWithQuota).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'user photo prompt',
      negativePrompt: 'user negative prompt',
      resolvedPrompt: 'fixed safety policy\nuser photo prompt',
      resolvedNegativePrompt: 'resolved negative\nuser negative prompt',
      templateKey: DEFAULT_TEMPLATE_KEY,
      templateReleaseId: 'release-1',
      templateChecksum: TEMPLATE_CHECKSUM,
      templateSnapshot: expect.objectContaining({ revisionId: 'revision-1', sequence: 1 }),
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }), 5);
    expect(enqueue).toHaveBeenCalledWith('job-1');

    const read = await app.inject({ method: 'GET', url: '/jobs/job-1' });
    expect(read.statusCode).toBe(200);
    expect(read.json().data).toMatchObject({
      id: 'job-1',
      templateKey: DEFAULT_TEMPLATE_KEY,
      templateReleaseId: 'release-1',
      templateChecksum: TEMPLATE_CHECKSUM,
    });
    expect(read.json().data).not.toHaveProperty('resolvedPrompt');
    expect(read.json().data).not.toHaveProperty('resolvedNegativePrompt');
    expect(read.json().data).not.toHaveProperty('templateSnapshot');
    expect(read.json().data).not.toHaveProperty('requestFingerprint');
  });

  it('uses frozen resolved prompts in the worker and preserves legacy fallback', async () => {
    const frozenProvider = {
      name: 'fake',
      generate: vi.fn(async () => ({ images: [{ buffer: PNG, mimeType: 'image/png' }] })),
    };
    await runAiImageJob('job-1', 1, {
      repository: repositoryFor(job()),
      provider: frozenProvider,
      uploadBuffer: vi.fn(async () => ({
        url: 'https://assets.example.test/frozen.png',
        backend: 'test',
        key: 'frozen.png',
      })),
    });
    expect(frozenProvider.generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'fixed safety policy\nresolved photo prompt',
      negativePrompt: 'resolved negative prompt',
    }));

    const legacyProvider = {
      name: 'fake',
      generate: vi.fn(async () => ({ images: [{ buffer: PNG, mimeType: 'image/png' }] })),
    };
    await runAiImageJob('legacy-job', 1, {
      repository: repositoryFor(job({
        id: 'legacy-job',
        prompt: 'legacy prompt',
        negativePrompt: 'legacy negative',
        resolvedPrompt: null,
        resolvedNegativePrompt: null,
        templateKey: null,
        templateReleaseId: null,
        templateChecksum: null,
        templateSnapshot: null,
        requestFingerprint: null,
      })),
      provider: legacyProvider,
      uploadBuffer: vi.fn(async () => ({
        url: 'https://assets.example.test/legacy.png',
        backend: 'test',
        key: 'legacy.png',
      })),
    });
    expect(legacyProvider.generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'legacy prompt',
      negativePrompt: 'legacy negative',
    }));
  });

  it('rejects an idempotency replay when the frozen request fingerprint differs', async () => {
    const existing = job({ idempotencyKey: 'idem-0001', requestFingerprint: REQUEST_FINGERPRINT });
    const createWithQuota = vi.fn(async () => ({ kind: 'existing' as const, job: existing }));

    await expect(createAiImageJob({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      idempotencyKey: 'idem-0001',
      prompt: 'different user prompt',
      negativePrompt: null,
      resolvedPrompt: 'fixed safety policy\ndifferent user prompt',
      resolvedNegativePrompt: '',
      templateKey: DEFAULT_TEMPLATE_KEY,
      templateReleaseId: 'release-1',
      templateChecksum: TEMPLATE_CHECKSUM,
      templateSnapshot: existing.templateSnapshot,
      requestFingerprint: 'c'.repeat(64),
      provider: 'fake',
      model: 'fake-image-v1',
      count: 1,
      width: 1024,
      height: 1024,
      estimatedCostCents: 4,
    } as any, { createWithQuota }, 5)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
  });

  it('declares the frozen prompt and request fingerprint fields on AiImageJob', async () => {
    const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
    const model = schema.slice(schema.indexOf('model AiImageJob {'), schema.indexOf('model MediaAsset {'));

    expect(model).toMatch(/resolvedPrompt\s+String\??\s+@map\("resolved_prompt"\)/);
    expect(model).toMatch(/resolvedNegativePrompt\s+String\??\s+@map\("resolved_negative_prompt"\)/);
    expect(model).toMatch(/templateKey\s+String\??\s+@map\("template_key"\)/);
    expect(model).toMatch(/templateReleaseId\s+String\??\s+@map\("template_release_id"\)/);
    expect(model).toMatch(/templateChecksum\s+String\??\s+@map\("template_checksum"\)/);
    expect(model).toMatch(/templateSnapshot\s+Json\??\s+@map\("template_snapshot_json"\)/);
    expect(model).toMatch(/requestFingerprint\s+String\??\s+@map\("request_fingerprint"\)/);
    expect(model).toMatch(/@@index\(\[templateKey,\s*templateReleaseId\]\)/);
  });
});
