import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate as defaultAuthenticate, requireSuperAdmin as defaultRequireSuperAdmin } from '../lib/auth.js';

const keySchema = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/);
const identifierSchema = z.string().trim().min(1).max(300);
const expectedSequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const keyParamsSchema = z.object({ key: keySchema }).strict();
const revisionParamsSchema = z.object({ id: identifierSchema }).strict();
const createRevisionBodySchema = z.object({
  promptTemplate: z.string().min(1).max(100_000),
  negativePromptTemplate: z.string().min(1).max(100_000),
  note: z.string().trim().min(1).max(1_000).optional(),
}).strict();
const previewBodySchema = z.object({ variables: z.record(z.string(), z.unknown()) }).strict();
const testBodySchema = z.object({ sampleInput: z.record(z.string(), z.unknown()) }).strict();
const publishBodySchema = z.object({
  revisionId: identifierSchema,
  testRunId: identifierSchema,
  expectedSequence: expectedSequenceSchema,
}).strict();
const rollbackBodySchema = z.object({
  targetRevisionId: identifierSchema,
  expectedSequence: expectedSequenceSchema,
}).strict();

type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface AdminAiPromptTemplateService {
  listTemplates(): Promise<unknown>;
  createRevision(input: {
    actorUserId: string;
    key: string;
    promptTemplate: string;
    negativePromptTemplate: string;
    note?: string;
  }): Promise<unknown>;
  previewRevision(input: {
    actorUserId: string;
    revisionId: string;
    variables: Record<string, unknown>;
  }): Promise<unknown>;
  testRevision(input: {
    actorUserId: string;
    revisionId: string;
    sampleInput: Record<string, unknown>;
  }): Promise<unknown>;
  publishRevision(input: {
    actorUserId: string;
    key: string;
    revisionId: string;
    testRunId: string;
    expectedSequence: number;
  }): Promise<unknown>;
  rollbackTemplate(input: {
    actorUserId: string;
    key: string;
    targetRevisionId: string;
    expectedSequence: number;
  }): Promise<unknown>;
}

export interface AdminAiPromptTemplateRouteOptions {
  service: AdminAiPromptTemplateService;
  authenticate?: Hook;
  requireSuperAdmin?: Hook;
}

const SENSITIVE_FIELD_RE = /(?:api[-_]?key|secret|token|password|authorization|cookie)/i;

function sanitizeResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeResponse);
  if (!value || typeof value !== 'object') return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_RE.test(key)) continue;
    sanitized[key] = sanitizeResponse(entry);
  }
  return sanitized;
}

function actorUserId(request: FastifyRequest): string {
  const user = (request as any).user;
  const value = String(user?.actorUserId || user?.userId || '').trim();
  if (!value) throw Object.assign(new Error('Authenticated administrator identity is unavailable'), {
    code: 'ACTOR_CONTEXT_REQUIRED',
    statusCode: 400,
  });
  return value;
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid AI prompt template request',
    error: { code: 'INVALID_REQUEST' },
  });
}

function mappedStatus(error: unknown): 400 | 404 | 409 | null {
  const candidate = error as { code?: unknown; statusCode?: unknown };
  if (candidate?.statusCode === 400 || candidate?.statusCode === 404 || candidate?.statusCode === 409) {
    return candidate.statusCode;
  }
  const code = String(candidate?.code || '').toUpperCase();
  if (code.includes('NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT')
    || code === 'SEQUENCE_CONFLICT'
    || code === 'TEST_RUN_STALE'
    || code === 'TEST_RUN_NOT_PASS'
    || code === 'REVISION_IMMUTABLE'
    || code === 'REVISION_CHANGED'
    || code === 'ROLLBACK_TARGET_INVALID'
  ) return 409;
  if (
    code.startsWith('INVALID_')
    || code.endsWith('_REQUIRED')
    || code.startsWith('MISSING_')
    || code.startsWith('UNKNOWN_')
  ) return 400;
  return null;
}

function safeErrorMessage(statusCode: 400 | 404 | 409): string {
  if (statusCode === 404) return 'AI prompt template resource was not found';
  if (statusCode === 409) return 'AI prompt template changed; reload before retrying';
  return 'Invalid AI prompt template request';
}

async function operation(reply: FastifyReply, callback: () => Promise<unknown>, statusCode = 200) {
  try {
    const data = sanitizeResponse(await callback());
    return reply.status(statusCode).send({ code: 1, msg: 'ok', data });
  } catch (error) {
    const responseStatus = mappedStatus(error);
    if (!responseStatus) throw error;
    const code = String((error as { code?: unknown }).code || 'INVALID_REQUEST');
    return reply.status(responseStatus).send({
      code: 0,
      msg: safeErrorMessage(responseStatus),
      error: { code },
    });
  }
}

export async function adminAiPromptTemplateRoutes(
  app: FastifyInstance,
  options: AdminAiPromptTemplateRouteOptions,
) {
  app.addHook('preHandler', options.authenticate || defaultAuthenticate);
  app.addHook('preHandler', options.requireSuperAdmin || defaultRequireSuperAdmin);

  app.get('/', async (_request, reply) => operation(reply, () => options.service.listTemplates()));

  app.post('/:key/revisions', async (request, reply) => {
    const params = keyParamsSchema.safeParse(request.params);
    const body = createRevisionBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.createRevision({
      actorUserId: actorUserId(request), key: params.data.key, ...body.data,
    }), 201);
  });

  app.post('/revisions/:id/preview', async (request, reply) => {
    const params = revisionParamsSchema.safeParse(request.params);
    const body = previewBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.previewRevision({
      actorUserId: actorUserId(request), revisionId: params.data.id, variables: body.data.variables,
    }));
  });

  app.post('/revisions/:id/test', async (request, reply) => {
    const params = revisionParamsSchema.safeParse(request.params);
    const body = testBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.testRevision({
      actorUserId: actorUserId(request), revisionId: params.data.id, sampleInput: body.data.sampleInput,
    }));
  });

  app.post('/:key/publish', async (request, reply) => {
    const params = keyParamsSchema.safeParse(request.params);
    const body = publishBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.publishRevision({
      actorUserId: actorUserId(request), key: params.data.key, ...body.data,
    }));
  });

  app.post('/:key/rollback', async (request, reply) => {
    const params = keyParamsSchema.safeParse(request.params);
    const body = rollbackBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.rollbackTemplate({
      actorUserId: actorUserId(request), key: params.data.key, ...body.data,
    }));
  });
}
