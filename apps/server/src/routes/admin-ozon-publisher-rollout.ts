import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  authenticate as defaultAuthenticate,
  requireSuperAdmin as defaultRequireSuperAdmin,
} from '../lib/auth.js';
import { extractRequestMeta, logAudit } from '../lib/audit-log.js';
import type { createOzonPublisherRolloutAdminService } from '../services/ozon-publisher-rollout-admin.js';

type Service = ReturnType<typeof createOzonPublisherRolloutAdminService>;
type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().trim().min(1).max(200);
const idempotencySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u);
const reasonSchema = z.string().trim().min(3).max(1000);
const writerSchema = z.enum([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
]);
const originSchema = z.enum(['DIRECT', 'BROWSER_ONE_CLICK']);
const boundarySchema = z.enum([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER',
]);
const stageSchema = z.enum(['off', 'shadow', 'v2']);
const gateStateSchema = z.enum(['NOT_READY', 'READY', 'REVOKED']);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const gateQuerySchema = z.object({
  writerEntrypoint: writerSchema.optional(),
  originChannel: originSchema.optional(),
  rolloutRevision: identifierSchema.optional(),
  state: gateStateSchema.optional(),
  cursor: z.string().min(1).max(1000).optional(),
  limit: limitSchema,
}).strict();
const historyQuerySchema = z.object({
  cursor: z.string().min(1).max(1000).optional(),
  limit: limitSchema,
}).strict();
const gateParamsSchema = z.object({ gateId: identifierSchema }).strict();
const stageParamsSchema = z.object({ boundary: boundarySchema }).strict();
const evaluateBodySchema = z.object({ idempotencyKey: idempotencySchema }).strict();
const provisionBodySchema = z.object({
  writerEntrypoint: writerSchema,
  originChannel: originSchema,
  rolloutRevision: identifierSchema,
}).strict();
const approveBodySchema = z.object({
  expectedStateVersion: z.literal(0),
  expectedPreviewEvidenceHash: hashSchema,
  idempotencyKey: idempotencySchema,
  reason: reasonSchema,
}).strict();
const revokeBodySchema = z.object({
  expectedStateVersion: z.literal(1),
  expectedEvidenceHash: hashSchema,
  expectedEvaluationHash: hashSchema,
  idempotencyKey: idempotencySchema,
  reason: reasonSchema,
}).strict();
const gateBindingSchema = z.object({
  gateId: identifierSchema,
  rolloutRevision: identifierSchema,
  expectedGateStateVersion: z.literal(1),
  expectedEvidenceHash: hashSchema,
  expectedEvaluationHash: hashSchema,
}).strict();
const stageBodySchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedStage: stageSchema,
  targetStage: stageSchema,
  gateBinding: gateBindingSchema.optional(),
  idempotencyKey: idempotencySchema,
  reason: reasonSchema,
}).strict();

export interface AdminOzonPublisherRolloutRouteOptions {
  service: Service;
  authenticate?: Hook;
  requireSuperAdmin?: Hook;
  audit?: typeof logAudit;
}

function encodeCursor(value: { sortAt: string; id: string } | null): string | null {
  return value ? Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') : null;
}

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid_cursor');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('invalid_cursor');
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_cursor');
  }
  const row = parsed as Record<string, unknown>;
  const sortAt = String(row.sortAt || '');
  const id = String(row.id || '');
  const date = new Date(sortAt);
  if (Object.keys(row).length !== 2 || date.toISOString() !== sortAt || !id || id.length > 200) {
    throw new Error('invalid_cursor');
  }
  return { sortAt, id };
}

function actor(request: FastifyRequest) {
  const user = (request as any).user || {};
  return {
    actorUserId: String(user.actorUserId || user.userId || '').trim(),
    actorRole: String(user.role || ''),
    isSuperAdmin: user.isSuperAdmin === true,
    tokenUse: String(user.tokenUse || ''),
  };
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    errorCode: 'ozon_publisher_rollout_admin_invalid_request',
    msg: 'Ozon 发布切流门禁请求无效',
  });
}

async function requireLiveAccountSession(request: FastifyRequest, reply: FastifyReply) {
  if ((request as any).user?.tokenUse === 'account_session') return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'ozon_publisher_rollout_account_session_required',
    msg: 'Ozon 发布切流门禁仅允许当前账号会话访问',
  });
}

function errorReply(reply: FastifyReply, caught: unknown) {
  const candidate = caught as { code?: unknown; statusCode?: unknown };
  const statusCode = Number(candidate.statusCode)
    || (candidate instanceof Error && candidate.message === 'invalid_cursor' ? 400 : 0);
  if (![400, 403, 404, 409, 503].includes(statusCode)) throw caught;
  return reply.status(statusCode).send({
    code: 0,
    errorCode: String(candidate.code || 'OZON_PUBLISHER_ROLLOUT_REQUEST_FAILED').toLowerCase(),
    msg: statusCode === 404
      ? 'Ozon 发布切流门禁记录不存在'
      : statusCode === 409
        ? 'Ozon 发布切流门禁状态已变化，请刷新后重试'
        : statusCode === 503
          ? 'Ozon 发布切流门禁快照暂不可用'
          : statusCode === 403
            ? '仅当前超级管理员账号会话可执行此操作'
            : 'Ozon 发布切流门禁请求无效',
  });
}

export async function adminOzonPublisherRolloutRoutes(
  app: FastifyInstance,
  options: AdminOzonPublisherRolloutRouteOptions,
) {
  app.addHook('preHandler', options.authenticate || defaultAuthenticate);
  app.addHook('preHandler', options.requireSuperAdmin || defaultRequireSuperAdmin);
  app.addHook('preHandler', requireLiveAccountSession);

  app.get('/gates', async (request, reply) => {
    const query = gateQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    try {
      const cursor = decodeCursor(query.data.cursor);
      const result = await options.service.listGates({
        ...query.data,
        cursor,
      });
      return reply.send({
        code: 1,
        data: { items: result.items, nextCursor: encodeCursor(result.nextCursor) },
      });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  });

  app.get('/gates/:gateId', async (request, reply) => {
    const params = gateParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply);
    try {
      return reply.send({ code: 1, data: await options.service.getGate(params.data) });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  });

  app.post('/gates', async (request, reply) => {
    const body = provisionBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    const auth = actor(request);
    try {
      const result = await options.service.provisionGate({ actor: auth, ...body.data });
      await (options.audit || logAudit)({
        actorId: auth.actorUserId,
        actorRole: 'ADMIN',
        action: `OZON_PUBLISHER_ROLLOUT_GATE_PROVISION${result.idempotent ? '_REPLAY' : ''}`,
        target: result.record.id,
        after: {
          idempotent: result.idempotent,
          writerEntrypoint: result.record.writerEntrypoint,
          originChannel: result.record.originChannel,
          rolloutRevision: result.record.rolloutRevision,
        },
        ...extractRequestMeta(request),
        force: true,
      });
      return reply.status(result.idempotent ? 200 : 201).send({ code: 1, data: result });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  });

  const history = (kind: 'evaluations' | 'transitions') => async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const params = gateParamsSchema.safeParse(request.params);
    const query = historyQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return invalidRequest(reply);
    try {
      const cursor = decodeCursor(query.data.cursor);
      const result = await options.service[
        kind === 'evaluations' ? 'listEvaluations' : 'listTransitions'
      ]({
        gateId: params.data.gateId,
        cursor,
        limit: query.data.limit,
      });
      return reply.send({
        code: 1,
        data: { items: result.items, nextCursor: encodeCursor(result.nextCursor) },
      });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  };
  app.get('/gates/:gateId/evaluations', history('evaluations'));
  app.get('/gates/:gateId/transitions', history('transitions'));

  app.get('/stages', async (_request, reply) => {
    try {
      return reply.send({ code: 1, data: await options.service.listStages() });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  });

  const mutateGate = (action: 'evaluate' | 'approve' | 'revoke') => async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const params = gateParamsSchema.safeParse(request.params);
    const schema = action === 'evaluate' ? evaluateBodySchema
      : action === 'approve' ? approveBodySchema : revokeBodySchema;
    const body = schema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const auth = actor(request);
    try {
      const method = action === 'evaluate' ? 'evaluateGate'
        : action === 'approve' ? 'approveGate' : 'revokeGate';
      const result = await (options.service[method] as any)({
        actor: auth,
        gateId: params.data.gateId,
        ...body.data,
      });
      await (options.audit || logAudit)({
        actorId: auth.actorUserId,
        actorRole: 'ADMIN',
        action: `OZON_PUBLISHER_ROLLOUT_${action.toUpperCase()}${result.idempotent ? '_REPLAY' : ''}`,
        target: params.data.gateId,
        after: { idempotent: result.idempotent, recordId: result.record.id },
        ...extractRequestMeta(request),
        force: true,
      });
      return reply.send({ code: 1, data: result });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  };
  app.post('/gates/:gateId/evaluate', mutateGate('evaluate'));
  app.post('/gates/:gateId/approve', mutateGate('approve'));
  app.post('/gates/:gateId/revoke', mutateGate('revoke'));

  app.post('/stages/:boundary/transition', async (request, reply) => {
    const params = stageParamsSchema.safeParse(request.params);
    const body = stageBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const auth = actor(request);
    try {
      const result = await options.service.transitionStage({
        actor: auth,
        boundary: params.data.boundary,
        ...body.data,
      });
      await (options.audit || logAudit)({
        actorId: auth.actorUserId,
        actorRole: 'ADMIN',
        action: `OZON_PUBLISHER_ROLLOUT_STAGE_TRANSITION${result.idempotent ? '_REPLAY' : ''}`,
        target: params.data.boundary,
        after: {
          idempotent: result.idempotent,
          transitionVersion: result.record.transitionVersion,
          resultStage: result.record.resultStage,
        },
        ...extractRequestMeta(request),
        force: true,
      });
      return reply.send({ code: 1, data: result });
    } catch (caught) {
      return errorReply(reply, caught);
    }
  });
}
