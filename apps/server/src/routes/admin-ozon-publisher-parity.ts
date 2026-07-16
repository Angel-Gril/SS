import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  authenticate as defaultAuthenticate,
  requireSuperAdmin as defaultRequireSuperAdmin,
} from '../lib/auth.js';
import { extractRequestMeta, logAudit } from '../lib/audit-log.js';
import type { createOzonPublisherParityObservationService } from '../services/ozon-publisher-parity-observations.js';

type Service = ReturnType<typeof createOzonPublisherParityObservationService>;
type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const entrypointSchema = z.enum([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER',
]);
const statusSchema = z.enum(['MATCH', 'DIFFERENT', 'V2_BLOCKED', 'NOT_COMPARABLE']);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

const observationQuerySchema = z.object({
  entrypoint: entrypointSchema.optional(),
  status: statusSchema.optional(),
  differenceSubjectKey: hashSchema.optional(),
  cursor: z.string().min(1).max(1000).optional(),
  limit: limitSchema,
}).strict();
const subjectQuerySchema = z.object({
  entrypoint: entrypointSchema.optional(),
  rolloutRevision: z.string().trim().min(1).max(200).optional(),
  approvalEligible: booleanQuery.optional(),
  cursor: z.string().min(1).max(1000).optional(),
  limit: limitSchema,
}).strict();
const subjectParamsSchema = z.object({ subjectKey: hashSchema }).strict();
const reviewBodySchema = z.object({
  expectedTransitionVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  reviewNote: z.string().trim().min(3).max(1000),
}).strict();

export interface AdminOzonPublisherParityRouteOptions {
  service: Service;
  authenticate?: Hook;
  requireSuperAdmin?: Hook;
  audit?: typeof logAudit;
}

function encodeCursor(value: object | null): string | null {
  return value ? Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') : null;
}

function decodeCursor(value: string | undefined, kind: 'observation' | 'subject') {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid_cursor');
  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error('invalid_cursor');
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('invalid_cursor');
  }
  const row = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const timeKey = kind === 'observation' ? 'observedAt' : 'lastObservedAt';
  const idKey = kind === 'observation' ? 'id' : 'key';
  const timestamp = String(row[timeKey] || '');
  const identifier = String(row[idKey] || '');
  const date = new Date(timestamp);
  if (Object.keys(row).length !== 2
    || !Number.isFinite(date.getTime())
    || date.toISOString() !== timestamp
    || !identifier
    || identifier.length > 200) throw new Error('invalid_cursor');
  return kind === 'observation'
    ? { observedAt: timestamp, id: identifier }
    : { lastObservedAt: timestamp, key: identifier };
}

function actor(request: FastifyRequest) {
  const user = (request as any).user || {};
  return {
    actorUserId: String(user.actorUserId || user.userId || '').trim(),
    actorRole: String(user.role || ''),
    isSuperAdmin: user.isSuperAdmin === true,
  };
}

function publicObservation(observation: Awaited<ReturnType<Service['listObservations']>>['observations'][number]) {
  const report = observation.report;
  return {
    id: observation.id,
    entrypoint: observation.entrypoint,
    rolloutRevision: observation.rolloutRevision,
    status: report.status,
    classification: report.classification,
    switchEligible: report.switchEligible,
    legacy: {
      endpointKind: report.legacy.endpointKind,
      itemCount: report.legacy.itemCount,
    },
    v2: {
      kind: report.v2.kind,
      endpointKind: report.v2.endpointKind,
      itemCount: report.v2.itemCount,
      compilerVersions: report.v2.compilerVersions,
      ...(report.v2.kind === 'BLOCKED' ? { blockerCode: report.v2.blockerCode } : {}),
      ...(report.v2.kind === 'UNAVAILABLE' ? { reasonCode: report.v2.reasonCode } : {}),
    },
    differences: report.differences,
    differenceSubjectKey: observation.differenceSubjectKey,
    approvalEligible: observation.approvalEligible,
    observedAt: observation.observedAt,
    expiresAt: observation.expiresAt,
  };
}

function publicSubject(subject: Awaited<ReturnType<Service['listDifferenceSubjects']>>['subjects'][number]) {
  return {
    subjectKey: subject.key,
    entrypoint: subject.entrypoint,
    rolloutRevision: subject.rolloutRevision,
    legacyEndpointKind: subject.legacyEndpointKind,
    legacyItemCount: subject.legacyItemCount,
    v2EndpointKind: subject.v2EndpointKind,
    v2ItemCount: subject.v2ItemCount,
    classification: subject.classification,
    compilerVersions: subject.compilerVersions,
    differenceCount: subject.differenceCount,
    differences: subject.rows,
    approvalEligible: subject.approvalEligible,
    approvalState: subject.approvalState,
    stateVersion: subject.stateVersion,
    observationCount: subject.observationCount,
    firstObservedAt: subject.firstObservedAt,
    lastObservedAt: subject.lastObservedAt,
    reviewedByUserId: subject.reviewedByUserId,
    reviewNote: subject.reviewNote,
    reviewedAt: subject.reviewedAt,
    approvedAt: subject.approvedAt,
    rejectedAt: subject.rejectedAt,
    revokedAt: subject.revokedAt,
  };
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    errorCode: 'invalid_ozon_publisher_parity_request',
    msg: 'Ozon 发布影子观测请求无效',
  });
}

async function requireLiveAccountSession(request: FastifyRequest, reply: FastifyReply) {
  if ((request as any).user?.tokenUse === 'account_session') return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'ozon_publisher_parity_account_session_required',
    msg: 'Ozon 发布差异审批需要当前账号会话',
  });
}

function errorReply(reply: FastifyReply, error: unknown) {
  const candidate = error as { code?: unknown; statusCode?: unknown };
  const status = [400, 403, 404, 409].includes(Number(candidate?.statusCode))
    ? Number(candidate.statusCode) as 400 | 403 | 404 | 409
    : null;
  if (!status) throw error;
  return reply.status(status).send({
    code: 0,
    errorCode: String(candidate.code || 'ozon_publisher_parity_request_failed').toLowerCase(),
    msg: status === 404
      ? 'Ozon 发布差异主题不存在'
      : status === 409
        ? 'Ozon 发布差异审批状态已变化，请刷新后重试'
        : status === 403
          ? '仅超级管理员可执行此操作'
          : 'Ozon 发布影子观测请求无效',
  });
}

export async function adminOzonPublisherParityRoutes(
  app: FastifyInstance,
  options: AdminOzonPublisherParityRouteOptions,
) {
  app.addHook('preHandler', options.authenticate || defaultAuthenticate);
  app.addHook('preHandler', options.requireSuperAdmin || defaultRequireSuperAdmin);

  app.get('/observations', async (request, reply) => {
    const query = observationQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    let cursor;
    try {
      cursor = decodeCursor(query.data.cursor, 'observation') as {
        observedAt: string; id: string;
      } | null;
    } catch {
      return invalidRequest(reply);
    }
    try {
      const result = await options.service.listObservations({
        entrypoint: query.data.entrypoint,
        status: query.data.status,
        differenceSubjectKey: query.data.differenceSubjectKey,
        cursor,
        limit: query.data.limit,
      });
      return reply.send({
        code: 1,
        data: {
          items: result.observations.map(publicObservation),
          nextCursor: encodeCursor(result.nextCursor),
        },
      });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get('/difference-subjects', async (request, reply) => {
    const query = subjectQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    let cursor;
    try {
      cursor = decodeCursor(query.data.cursor, 'subject') as {
        lastObservedAt: string; key: string;
      } | null;
    } catch {
      return invalidRequest(reply);
    }
    try {
      const result = await options.service.listDifferenceSubjects({
        entrypoint: query.data.entrypoint,
        rolloutRevision: query.data.rolloutRevision,
        approvalEligible: query.data.approvalEligible,
        cursor,
        limit: query.data.limit,
      });
      return reply.send({
        code: 1,
        data: {
          items: result.subjects.map(publicSubject),
          nextCursor: encodeCursor(result.nextCursor),
        },
      });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get('/difference-subjects/:subjectKey', async (request, reply) => {
    const params = subjectParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply);
    try {
      const subject = await options.service.getDifferenceSubject(params.data);
      if (!subject) return reply.status(404).send({
        code: 0,
        errorCode: 'ozon_publisher_parity_difference_subject_not_found',
        msg: 'Ozon 发布差异主题不存在',
      });
      return reply.send({ code: 1, data: publicSubject(subject) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  const review = (action: 'APPROVE' | 'REJECT' | 'REVOKE') => async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const params = subjectParamsSchema.safeParse(request.params);
    const body = reviewBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const auth = actor(request);
    try {
      const result = await options.service.reviewDifference({
        action,
        subjectKey: params.data.subjectKey,
        expectedTransitionVersion: body.data.expectedTransitionVersion,
        actorUserId: auth.actorUserId,
        actorRole: auth.actorRole,
        isSuperAdmin: auth.isSuperAdmin,
        reviewNote: body.data.reviewNote,
      });
      await (options.audit || logAudit)({
        actorId: auth.actorUserId,
        actorRole: 'ADMIN',
        action: `OZON_PUBLISHER_PARITY_${action}${result.idempotent ? '_REPLAY' : ''}`,
        target: params.data.subjectKey,
        after: {
          subjectKey: params.data.subjectKey,
          transitionVersion: result.review.transitionVersion,
          status: result.review.status,
          idempotent: result.idempotent,
        },
        ...extractRequestMeta(request),
        force: true,
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return errorReply(reply, error);
    }
  };

  app.post(
    '/difference-subjects/:subjectKey/approve',
    { preHandler: [requireLiveAccountSession] },
    review('APPROVE'),
  );
  app.post(
    '/difference-subjects/:subjectKey/reject',
    { preHandler: [requireLiveAccountSession] },
    review('REJECT'),
  );
  app.post(
    '/difference-subjects/:subjectKey/revoke',
    { preHandler: [requireLiveAccountSession] },
    review('REVOKE'),
  );
}
