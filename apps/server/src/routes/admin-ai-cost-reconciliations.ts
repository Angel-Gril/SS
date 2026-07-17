import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate as defaultAuthenticate, requireSuperAdmin as defaultRequireSuperAdmin } from '../lib/auth.js';

const identifierSchema = z.string().trim().min(1).max(300);
const unresolvedStatusSchema = z.enum(['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED']);
const listQuerySchema = z.object({
  status: unresolvedStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
const paramsSchema = z.object({ id: identifierSchema }).strict();
const reconcileBodySchema = z.object({
  requestId: z.string().uuid(),
  expectedStatus: unresolvedStatusSchema,
  expectedEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['SETTLED', 'RELEASED']),
  actualCostMinor: z.number().int().nonnegative().max(2_147_483_647).optional(),
  billedUnits: z.number().int().nonnegative().max(2_147_483_647).optional(),
  reason: z.string().trim().min(10).max(500).regex(/^[^\r\n]+$/),
}).strict().superRefine((value, context) => {
  if (value.outcome === 'SETTLED' && (value.actualCostMinor == null || value.billedUnits == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['actualCostMinor'], message: 'cost and billed units are required' });
  }
  if (value.outcome === 'RELEASED' && ((value.actualCostMinor ?? 0) !== 0 || (value.billedUnits ?? 0) !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'release cannot charge cost' });
  }
});

type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface AdminAiCostReconciliationService {
  listReconciliations(input: {
    status?: 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED';
    limit: number;
  }): Promise<unknown>;
  reconcileReservation(input: {
    reservationId: string;
    actorUserId: string;
    requestId: string;
    expectedStatus: 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED';
    expectedEvidenceHash: string;
    outcome: 'SETTLED' | 'RELEASED';
    actualCostMinor?: number;
    billedUnits?: number;
    reason: string;
  }): Promise<unknown>;
}

export interface AdminAiCostReconciliationRouteOptions {
  service: AdminAiCostReconciliationService;
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
    if (typeof entry === 'string' || typeof entry === 'number' || entry === null) output[field] = entry;
    else if (entry instanceof Date) output[field] = entry.toISOString();
  }
  return output;
}

function mapSettlementDto(value: unknown) {
  return allowedFields(value, [
    'id', 'kind', 'actorUserId', 'actualCostMinor', 'billedUnits', 'reason', 'createdAt',
  ]);
}

function mapJobDto(value: unknown) {
  return allowedFields(value, [
    'id', 'status', 'errorCode', 'providerJobId', 'providerDispatchedAt', 'createdAt', 'updatedAt',
  ]);
}

function mapReservationDto(value: unknown) {
  const source = record(value);
  return {
    ...allowedFields(source, [
      'id', 'ownerUserId', 'workflowId', 'jobId', 'provider', 'model', 'operation', 'currency',
      'estimatedCostMinor', 'maximumCostMinor', 'status', 'evidenceHash', 'providerRequestId', 'providerAcceptedAt',
      'reconciliationRequiredAt', 'createdAt', 'updatedAt', 'settledAt', 'releasedAt',
    ]),
    job: source.job ? mapJobDto(source.job) : null,
    settlements: Array.isArray(source.settlements) ? source.settlements.map(mapSettlementDto) : [],
  };
}

function mapListDto(value: unknown) {
  const source = record(value);
  return {
    limit: typeof source.limit === 'number' ? source.limit : 0,
    items: Array.isArray(source.items) ? source.items.map(mapReservationDto) : [],
  };
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
    msg: 'Invalid AI cost reconciliation request',
    error: { code: 'INVALID_REQUEST' },
  });
}

async function operation(reply: FastifyReply, callback: () => Promise<unknown>, mapper: (value: unknown) => unknown) {
  try {
    return reply.send({ code: 1, msg: 'ok', data: mapper(await callback()) });
  } catch (error) {
    const status = Number((error as { statusCode?: unknown }).statusCode || 0);
    if (![400, 404, 409].includes(status)) throw error;
    return reply.status(status).send({
      code: 0,
      msg: status === 404
        ? 'AI cost reconciliation record was not found'
        : status === 409
          ? 'AI cost reconciliation record changed; reload before retrying'
          : 'Invalid AI cost reconciliation request',
      error: { code: String((error as { code?: unknown }).code || 'INVALID_REQUEST') },
    });
  }
}

export async function adminAiCostReconciliationRoutes(
  app: FastifyInstance,
  options: AdminAiCostReconciliationRouteOptions,
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

  app.post('/:id/reconcile', async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = reconcileBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.reconcileReservation({
      reservationId: params.data.id,
      actorUserId: actorUserId(request),
      ...body.data,
    }), mapReservationDto);
  });
}
