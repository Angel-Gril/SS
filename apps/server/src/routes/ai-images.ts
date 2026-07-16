import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { getConfig } from '../config/system-config-schema.js';
import { PrismaAiImageJobRepository } from '../repositories/ai-image-job-repository.js';
import { AiImageJobError, applyAiImageJob, createAiImageJob, type AiImageJobRepository } from '../services/ai-image-jobs.js';
import { AiImageApplicationError, applyAiImageAssets } from '../services/ai-image-application.js';
import { resolveActiveAiPrompt } from '../services/ai-prompt-template-registry.js';
import { AiPromptTemplateError } from '../services/ai-prompt-templates.js';

const createSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  negativePrompt: z.string().trim().max(4000).nullable().optional(),
  count: z.number().int().min(1).max(4).default(1),
  width: z.number().int().min(256).max(4096).default(1024),
  height: z.number().int().min(256).max(4096).default(1024),
  idempotencyKey: z.string().trim().min(8).max(128).nullable().optional(),
});
const applySchema = z.object({
  mode: z.enum(['append', 'replace']),
  targetType: z.enum(['collect', 'product']),
  targetId: z.string().trim().min(1).max(128),
});

interface AiImageRouteSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
}

interface AiImageRouteOptions {
  repository?: AiImageJobRepository;
  enqueue?: (jobId: string) => Promise<void>;
  authenticate?: (request: FastifyRequest, reply: any) => Promise<unknown>;
  getSettings?: () => Promise<AiImageRouteSettings>;
  resolvePrompt?: (input: {
    templateKey: string;
    userPrompt: string;
    userNegativePrompt: string;
  }) => Promise<{
    templateKey: string;
    release: { id: string; revisionId: string; sequence: number };
    checksum: string;
    snapshot: Record<string, unknown>;
    resolvedPrompt: string;
    resolvedNegativePrompt: string;
  }>;
}

const DEFAULT_TEMPLATE_KEY = 'text-to-image.base';

function actor(request: FastifyRequest) {
  const auth = (request as any).user || {};
  return {
    ownerUserId: auth.effectiveUserId || auth.userId,
    actorUserId: auth.actorUserId || auth.userId,
  };
}

function sendError(reply: any, error: unknown) {
  if (error instanceof AiImageApplicationError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'ALREADY_APPLIED' ? 409 : 400;
    return reply.status(status).send({ code: error.code, msg: error.message });
  }
  if (error instanceof AiImageJobError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'IDEMPOTENCY_KEY_CONFLICT'
        ? 409
        : error.code === 'QUOTA_EXCEEDED'
          ? 429
          : error.code === 'PROVIDER_DISABLED'
            ? 503
            : 400;
    return reply.status(status).send({ code: error.code, msg: error.message });
  }
  if (error instanceof AiPromptTemplateError) {
    return reply.status(503).send({
      code: 'PROMPT_TEMPLATE_UNAVAILABLE',
      msg: 'AI image prompt template is temporarily unavailable',
    });
  }
  throw error;
}

function publicJob(job: Record<string, unknown>) {
  const {
    resolvedPrompt: _resolvedPrompt,
    resolvedNegativePrompt: _resolvedNegativePrompt,
    templateSnapshot: _templateSnapshot,
    requestFingerprint: _requestFingerprint,
    ...visible
  } = job;
  return visible;
}

export function createAiImageRequestFingerprint(input: {
  prompt: string;
  negativePrompt: string;
  count: number;
  width: number;
  height: number;
  templateKey: string;
}) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export async function aiImageRoutes(app: FastifyInstance, options: AiImageRouteOptions = {}) {
  const repository = options.repository || new PrismaAiImageJobRepository(prisma);
  const authHook = options.authenticate || authenticate;
  const getSettings = options.getSettings || (async () => ({
    enabled: await getConfig('ai_image_generation_enabled'),
    provider: await getConfig('ai_image_provider'),
    model: await getConfig('ai_image_model'),
    dailyLimit: await getConfig('ai_user_daily_image_generation_limit'),
    estimatedCostCents: 0,
  }));
  const enqueue = options.enqueue || (async (jobId: string) => {
    const worker = await import('../workers/ai-image-generation.js');
    await worker.enqueueAiImageJob(jobId);
  });
  const resolvePrompt = options.resolvePrompt || resolveActiveAiPrompt;

  app.addHook('preHandler', authHook as any);

  app.post('/jobs', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    const settings = await getSettings();
    if (!settings.enabled || settings.provider === 'disabled') return reply.status(503).send({ code: 'PROVIDER_DISABLED', msg: 'AI image generation is disabled' });
    if (!['fake', 'dashscope-wanx', 'openai-images'].includes(settings.provider)) {
      return reply.status(503).send({ code: 'PROVIDER_NOT_READY', msg: 'AI image provider adapter is not enabled yet' });
    }
    const ids = actor(request);
    try {
      const resolved = await resolvePrompt({
        templateKey: DEFAULT_TEMPLATE_KEY,
        userPrompt: parsed.data.prompt,
        userNegativePrompt: parsed.data.negativePrompt || '',
      });
      const fingerprint = createAiImageRequestFingerprint({
        prompt: parsed.data.prompt,
        negativePrompt: parsed.data.negativePrompt || '',
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
        templateKey: resolved.templateKey,
      });
      const result = await createAiImageJob({
        ...ids,
        idempotencyKey: parsed.data.idempotencyKey || null,
        prompt: parsed.data.prompt,
        negativePrompt: parsed.data.negativePrompt || null,
        resolvedPrompt: resolved.resolvedPrompt,
        resolvedNegativePrompt: resolved.resolvedNegativePrompt,
        templateKey: resolved.templateKey,
        templateReleaseId: resolved.release.id,
        templateChecksum: resolved.checksum,
        templateSnapshot: resolved.snapshot,
        requestFingerprint: fingerprint,
        provider: settings.provider,
        model: settings.model,
        count: parsed.data.count,
        width: parsed.data.width,
        height: parsed.data.height,
        estimatedCostCents: settings.estimatedCostCents,
      }, repository, settings.dailyLimit);
      if (!result.replayed) {
        try {
          await enqueue(result.job.id);
        } catch (error: any) {
          await repository.markFailed(result.job.id, { attemptCount: 0, errorCode: 'QUEUE_UNAVAILABLE', errorMessage: error?.message || 'Queue unavailable' });
          return reply.status(503).send({ code: 'QUEUE_UNAVAILABLE', msg: 'AI image queue is temporarily unavailable' });
        }
      }
      return reply.status(result.replayed ? 200 : 202).send({
        code: 1,
        data: publicJob(result.job as unknown as Record<string, unknown>),
        replayed: result.replayed,
      });
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await repository.getById(id);
    if (!job || job.ownerUserId !== actor(request).ownerUserId) return reply.status(404).send({ code: 'NOT_FOUND', msg: 'AI image job not found' });
    return { code: 1, data: publicJob(job as unknown as Record<string, unknown>) };
  });

  app.post('/jobs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await repository.requestCancellation(id, actor(request).ownerUserId);
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND', msg: 'AI image job not found or cannot be cancelled' });
    return { code: 1, data: publicJob(job as unknown as Record<string, unknown>) };
  });

  app.post('/jobs/:id/apply', async (request, reply) => {
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_REQUEST', msg: parsed.error.issues[0]?.message });
    const { id } = request.params as { id: string };
    try {
      let application;
      if (options.repository) {
        await applyAiImageJob(id, actor(request).ownerUserId, parsed.data, repository);
        application = { jobId: id, ...parsed.data };
      } else {
        application = await applyAiImageAssets(prisma as any, { jobId: id, ownerUserId: actor(request).ownerUserId, ...parsed.data });
      }
      return { code: 1, data: application };
    } catch (error) { return sendError(reply, error); }
  });
}
