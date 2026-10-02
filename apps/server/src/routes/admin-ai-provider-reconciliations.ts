import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  authenticate as defaultAuthenticate,
  requireSuperAdmin as defaultRequireSuperAdmin,
} from '../lib/auth.js';

const identifierSchema = z.string().trim().min(1).max(300);
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['ALL', 'PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'])
    .default('MANUAL_REVIEW'),
  cursor: z.string().trim().min(1).max(1_000).regex(/^[A-Za-z0-9_-]+$/u).optional(),
}).strict();
const paramsSchema = z.object({ id: identifierSchema }).strict();
const resolveBodySchema = z.object({
  requestId: z.string().uuid(),
  expectedStatus: z.literal('MANUAL_REVIEW'),
  expectedRevision: z.number().int().nonnegative(),
  expectedEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  action: z.enum(['NOT_SUBMITTED', 'NO_OUTPUT', 'RESUME', 'ABANDON']),
  providerJobId: z.string().trim().min(1).max(500).optional(),
  providerAcceptedAt: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(10).max(500).regex(/^[^\r\n]+$/u),
}).strict().superRefine((value, context) => {
  if (value.action === 'RESUME' && (!value.providerJobId || !value.providerAcceptedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerJobId'],
      message: 'resume requires the exact Provider task identity and acceptance time',
    });
  }
  if (value.action !== 'RESUME' && (value.providerJobId || value.providerAcceptedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['providerJobId'],
      message: 'Provider task evidence is only accepted for resume',
    });
  }
});

type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface AdminAiProviderReconciliationService {
  listReconciliations(input: {
    limit: number;
    status: 'ALL' | 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'MANUAL_REVIEW';
    cursor?: string;
  }): Promise<unknown>;
  resolveReconciliation(input: {
    jobId: string;
    actorUserId: string;
    requestId: string;
    expectedStatus: 'MANUAL_REVIEW';
    expectedRevision: number;
    expectedEvidenceHash: string;
    action: 'NOT_SUBMITTED' | 'NO_OUTPUT' | 'RESUME' | 'ABANDON';
    providerJobId?: string;
    providerAcceptedAt?: string;
    reason: string;
  }): Promise<unknown>;
}

export interface AdminAiProviderReconciliationRouteOptions {
  service: AdminAiProviderReconciliationService;
  authenticate?: Hook;
  requireSuperAdmin?: Hook;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function allowedFields(value: unknown, fields: readonly string[]) {
  const source = record(value);
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const entry = source[field];
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null) {
      output[field] = entry;
    } else if (entry instanceof Date) output[field] = entry.toISOString();
  }
  return output;
}

function mapItemDto(value: unknown) {
  const source = record(value);
  return {
    ...allowedFields(source, [
      'id', 'ownerUserId', 'workflowId', 'operation', 'provider', 'model', 'jobStatus',
      'providerJobId', 'costProviderJobId', 'providerDispatchedAt', 'providerAcceptedAt',
      'status', 'revision', 'attemptCount',
      'nextAt', 'deadlineAt', 'lastProviderStatus', 'lastErrorCode', 'lastErrorMessage',
      'reconciledAt', 'updatedAt', 'costStatus', 'evidenceHash',
    ]),
    context: source.context ? allowedFields(source.context, ['type', 'id', 'skuKey', 'slotKey']) : null,
    allowedActions: Array.isArray(source.allowedActions)
      ? source.allowedActions.filter((action) => (
        action === 'NOT_SUBMITTED' || action === 'NO_OUTPUT' || action === 'RESUME' || action === 'ABANDON'
      ))
      : [],
  };
}

function mapListDto(value: unknown) {
  const source = record(value);
  const status = typeof source.status === 'string'
    && ['ALL', 'PENDING', 'RUNNING', 'RETRY_WAIT', 'MANUAL_REVIEW'].includes(source.status)
    ? source.status
    : 'MANUAL_REVIEW';
  const nextCursor = typeof source.nextCursor === 'string'
    && source.nextCursor.length <= 1_000
    && /^[A-Za-z0-9_-]+$/u.test(source.nextCursor)
    ? source.nextCursor
    : null;
  return {
    items: Array.isArray(source.items) ? source.items.map(mapItemDto) : [],
    limit: typeof source.limit === 'number' ? source.limit : 0,
    status,
    nextCursor,
  };
}

function actorUserId(request: FastifyRequest) {
  const user = (request as any).user;
  const value = String(user?.actorUserId || user?.userId || '').trim();
  if (!value) {
    throw Object.assign(new Error('Authenticated administrator identity is unavailable'), {
      code: 'ACTOR_CONTEXT_REQUIRED',
      statusCode: 400,
    });
  }
  return value;
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid AI Provider reconciliation request',
    error: { code: 'INVALID_REQUEST' },
  });
}

async function operation(
  reply: FastifyReply,
  callback: () => Promise<unknown>,
  mapper: (value: unknown) => unknown,
) {
  try {
    return reply.send({ code: 1, msg: 'ok', data: mapper(await callback()) });
  } catch (error) {
    const status = Number((error as { statusCode?: unknown }).statusCode || 0);
    if (![400, 404, 409].includes(status)) throw error;
    return reply.status(status).send({
      code: 0,
      msg: status === 404
        ? 'AI Provider reconciliation record was not found'
        : status === 409
          ? 'AI Provider reconciliation record changed; reload before retrying'
          : 'Invalid AI Provider reconciliation request',
      error: { code: String((error as { code?: unknown }).code || 'INVALID_REQUEST') },
    });
  }
}

export async function adminAiProviderReconciliationRoutes(
  app: FastifyInstance,
  options: AdminAiProviderReconciliationRouteOptions,
) {
  app.addHook('preHandler', options.authenticate || defaultAuthenticate);
  app.addHook('preHandler', options.requireSuperAdmin || defaultRequireSuperAdmin);
  app.addHook('preHandler', async (request, reply) => {
    const user = (request as any).user;
    if (user?.tokenUse !== 'account_session' || user?.isSubAccount) {
      return reply.status(403).send({ code: 0, msg: '需要超级管理员网页登录会话' });
    }
  });

  app.get('/', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    return operation(reply, () => options.service.listReconciliations(query.data), mapListDto);
  });

  app.post('/:id/resolve', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = resolveBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.resolveReconciliation({
      jobId: params.data.id,
      actorUserId: actorUserId(request),
      ...body.data,
    }), mapItemDto);
  });
}
