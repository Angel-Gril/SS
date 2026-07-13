import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import {
  LogisticsRuleAdminServiceError,
  type LogisticsRuleAdminService,
} from '../services/logistics-rule-admin.js';
import { LogisticsRuleReleaseError } from '../services/logistics-rule-release.js';
import { OzonLocationDirectoryError } from '../services/ozon-global-calculator-locations.js';

const identifierSchema = z.string().trim().min(1).max(200);
const revisionParamsSchema = z.object({ revisionId: identifierSchema }).strict();
const channelParamsSchema = z.object({ channelId: identifierSchema }).strict();
const diffQuerySchema = z.object({ channelId: identifierSchema }).strict();
const auditReasonSchema = z.string().trim().min(5).max(500);
const preflightActionSchema = z.object({
  channelId: identifierSchema,
  expectedSequence: z.number().int().nonnegative(),
}).strict();
const releaseActionSchema = preflightActionSchema.extend({
  reason: auditReasonSchema,
}).strict();
const rollbackSchema = z.object({
  targetReleaseId: identifierSchema,
  expectedSequence: z.number().int().nonnegative(),
  reason: auditReasonSchema,
}).strict();
const retireReasonSchema = z.string().trim().min(3).max(500);
const retireChannelSchema = z.object({
  expectedSequence: z.number().int().nonnegative(),
  reason: retireReasonSchema,
}).strict();
const receiptQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

const CLIENT_DERIVED_FACTS = new Set([
  'validationreport',
  'validationmatrix',
  'ready',
  'complete',
  'requiredcount',
  'coveredcount',
  'contentchecksum',
  'effectivechecksum',
  'releasesequence',
  'manifest',
  'sourcechecksum',
  'samplechecksum',
  'batchchecksum',
  'candidatesetchecksum',
  'fingerprintkey',
  'recordcount',
  'discovered',
  'attempted',
  'succeeded',
  'failed',
  'empty',
]);

const CREDENTIAL_FIELDS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apitoken',
  'api_token',
  'accesskeysecret',
  'access_key_secret',
  'password',
  'secret',
]);

function findForbiddenField(
  value: unknown,
  forbidden: ReadonlySet<string>,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], forbidden, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (forbidden.has(key.toLowerCase())) return childPath;
    const found = findForbiddenField(child, forbidden, childPath);
    if (found) return found;
  }
  return null;
}

const reviewNoteSchema = z.string().trim().min(3).max(500);
const reviewVersionSchema = z.string().datetime({ offset: true });
const workspaceQuerySchema = z.object({
  channelId: identifierSchema.optional(),
  revisionId: identifierSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.revisionId && !value.channelId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'CHANNEL_REQUIRED_FOR_REVISION' });
  }
});
const bindingParamsSchema = z.object({ bindingId: identifierSchema }).strict();
const resolutionParamsSchema = z.object({ resolutionId: identifierSchema }).strict();
const countryParamsSchema = z.object({ countryUid: z.string().uuid() }).strict();
const methodBindingSuggestionSchema = z.object({
  channelId: identifierSchema,
  revisionId: identifierSchema,
  deliveryMethodId: identifierSchema,
  stableServiceKey: identifierSchema,
  note: reviewNoteSchema,
}).strict();
const methodBindingReviewSchema = z.object({
  channelId: identifierSchema,
  revisionId: identifierSchema,
  note: reviewNoteSchema,
  expectedUpdatedAt: reviewVersionSchema,
}).strict();
const officialResolutionSuggestionSchema = z.object({
  channelId: identifierSchema,
  revisionId: identifierSchema,
  requirementKey: identifierSchema,
  note: reviewNoteSchema,
}).strict();
const officialResolutionConfirmSchema = z.object({
  channelId: identifierSchema,
  revisionId: identifierSchema,
  selectedServiceKey: identifierSchema,
  note: reviewNoteSchema,
  expectedUpdatedAt: reviewVersionSchema,
}).strict();
const officialResolutionRejectSchema = z.object({
  channelId: identifierSchema,
  revisionId: identifierSchema,
  note: reviewNoteSchema,
  expectedUpdatedAt: reviewVersionSchema,
}).strict();

const draftImportSchema = z.object({
  channelId: identifierSchema,
  assignmentId: identifierSchema,
  payload: z.record(z.unknown()).superRefine((payload, context) => {
    const derivedFact = findForbiddenField(payload, CLIENT_DERIVED_FACTS);
    if (derivedFact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CLIENT_VALIDATION_FACTS_FORBIDDEN',
        path: derivedFact,
      });
    }
    const credentialField = findForbiddenField(payload, CREDENTIAL_FIELDS);
    if (credentialField) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CREDENTIAL_FIELDS_FORBIDDEN',
        path: credentialField,
      });
    }
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 4 * 1024 * 1024) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DRAFT_PAYLOAD_TOO_LARGE',
      });
    }
  }),
}).strict();

type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface AdminLogisticsRuleRouteOptions {
  service: LogisticsRuleAdminService;
  authenticateAccount?: Hook;
  requireSuperAdminAccount?: Hook;
}

function actorUserId(request: FastifyRequest): string {
  const user = (request as any).user;
  const value = String(user?.actorUserId || user?.userId || '').trim();
  if (!value) {
    throw new LogisticsRuleAdminServiceError(
      'ACTOR_CONTEXT_REQUIRED',
      'Authenticated administrator identity is unavailable',
      500,
    );
  }
  return value;
}

function invalidRequest(reply: FastifyReply, issues: z.ZodIssue[]) {
  const issue = issues[0];
  const errorCode = issue?.message === 'CLIENT_VALIDATION_FACTS_FORBIDDEN'
    ? 'CLIENT_VALIDATION_FACTS_FORBIDDEN'
    : issue?.message === 'CREDENTIAL_FIELDS_FORBIDDEN'
      ? 'CREDENTIAL_FIELDS_FORBIDDEN'
      : issue?.message === 'DRAFT_PAYLOAD_TOO_LARGE'
        ? 'DRAFT_PAYLOAD_TOO_LARGE'
        : 'INVALID_REQUEST';
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid logistics rule request',
    error: { code: errorCode },
  });
}

async function sendOperation(
  reply: FastifyReply,
  operation: () => Promise<unknown>,
  statusCode = 200,
) {
  try {
    const data = await operation();
    return reply.status(statusCode).send({ code: 1, msg: 'ok', data });
  } catch (error) {
    if (error instanceof LogisticsRuleAdminServiceError
      || error instanceof LogisticsRuleReleaseError
      || error instanceof OzonLocationDirectoryError) {
      return reply.status(error.statusCode).send({
        code: 0,
        msg: error.message,
        error: { code: error.code },
      });
    }
    throw error;
  }
}

export async function adminLogisticsRuleRoutes(
  app: FastifyInstance,
  options: AdminLogisticsRuleRouteOptions,
) {
  app.addHook('preHandler', options.authenticateAccount || authenticate);
  app.addHook('preHandler', options.requireSuperAdminAccount || requireSuperAdmin);

  app.get('/workspace', async (request, reply) => {
    const parsed = workspaceQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.readWorkspace(parsed.data));
  });

  app.post('/method-bindings/suggestions', async (request, reply) => {
    const parsed = methodBindingSuggestionSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.suggestMethodBinding({
      actorUserId: actorUserId(request),
      ...parsed.data,
    }), 201);
  });

  const reviewMethodBinding = async (
    request: FastifyRequest,
    reply: FastifyReply,
    decision: 'CONFIRMED' | 'REJECTED',
  ) => {
    const params = bindingParamsSchema.safeParse(request.params);
    const body = methodBindingReviewSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.reviewMethodBinding({
      actorUserId: actorUserId(request),
      bindingId: params.data.bindingId,
      decision,
      ...body.data,
    }));
  };
  app.post('/method-bindings/:bindingId/confirm', (request, reply) => (
    reviewMethodBinding(request, reply, 'CONFIRMED')
  ));
  app.post('/method-bindings/:bindingId/reject', (request, reply) => (
    reviewMethodBinding(request, reply, 'REJECTED')
  ));

  app.post('/official-resolutions/suggestions', async (request, reply) => {
    const parsed = officialResolutionSuggestionSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.suggestOfficialResolution({
      actorUserId: actorUserId(request),
      ...parsed.data,
    }), 201);
  });

  app.post('/official-resolutions/:resolutionId/confirm', async (request, reply) => {
    const params = resolutionParamsSchema.safeParse(request.params);
    const body = officialResolutionConfirmSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.reviewOfficialResolution({
      actorUserId: actorUserId(request),
      resolutionId: params.data.resolutionId,
      decision: 'CONFIRMED',
      ...body.data,
    }));
  });

  app.post('/official-resolutions/:resolutionId/reject', async (request, reply) => {
    const params = resolutionParamsSchema.safeParse(request.params);
    const body = officialResolutionRejectSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.reviewOfficialResolution({
      actorUserId: actorUserId(request),
      resolutionId: params.data.resolutionId,
      decision: 'REJECTED',
      ...body.data,
    }));
  });

  app.get('/official-locations/countries', async (_request, reply) => (
    sendOperation(reply, () => options.service.listOfficialCountries())
  ));
  app.get('/official-locations/countries/:countryUid/cities', async (request, reply) => {
    const parsed = countryParamsSchema.safeParse(request.params);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.listOfficialCities(parsed.data.countryUid));
  });
  app.get('/official-locations/destinations', async (_request, reply) => (
    sendOperation(reply, () => options.service.listOfficialDestinations())
  ));

  app.post('/drafts/import', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const parsed = draftImportSchema.safeParse(request.body);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.importDraft({
      actorUserId: actorUserId(request),
      channelId: parsed.data.channelId,
      assignmentId: parsed.data.assignmentId,
      payload: parsed.data.payload,
    }), 201);
  });

  app.get('/drafts/:revisionId', async (request, reply) => {
    const parsed = revisionParamsSchema.safeParse(request.params);
    if (!parsed.success) return invalidRequest(reply, parsed.error.issues);
    return sendOperation(reply, () => options.service.readDraft({
      revisionId: parsed.data.revisionId,
    }));
  });

  app.get('/drafts/:revisionId/diff', async (request, reply) => {
    const params = revisionParamsSchema.safeParse(request.params);
    const query = diffQuerySchema.safeParse(request.query);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!query.success) return invalidRequest(reply, query.error.issues);
    return sendOperation(reply, () => options.service.diffDraft({
      revisionId: params.data.revisionId,
      channelId: query.data.channelId,
    }));
  });

  app.post('/drafts/:revisionId/preflight', async (request, reply) => {
    const params = revisionParamsSchema.safeParse(request.params);
    const body = preflightActionSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.preflightDraft({
      actorUserId: actorUserId(request),
      revisionId: params.data.revisionId,
      channelId: body.data.channelId,
      expectedSequence: body.data.expectedSequence,
    }));
  });

  app.post('/drafts/:revisionId/publish', async (request, reply) => {
    const params = revisionParamsSchema.safeParse(request.params);
    const body = releaseActionSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.publishDraft({
      actorUserId: actorUserId(request),
      revisionId: params.data.revisionId,
      channelId: body.data.channelId,
      expectedSequence: body.data.expectedSequence,
      reason: body.data.reason,
    }), 201);
  });

  app.post('/channels/:channelId/rollback', async (request, reply) => {
    const params = channelParamsSchema.safeParse(request.params);
    const body = rollbackSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.rollbackRelease({
      actorUserId: actorUserId(request),
      channelId: params.data.channelId,
      targetReleaseId: body.data.targetReleaseId,
      expectedSequence: body.data.expectedSequence,
      reason: body.data.reason,
    }), 201);
  });

  app.post('/channels/:channelId/retire', async (request, reply) => {
    const params = channelParamsSchema.safeParse(request.params);
    const body = retireChannelSchema.safeParse(request.body);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!body.success) return invalidRequest(reply, body.error.issues);
    return sendOperation(reply, () => options.service.retireChannel({
      actorUserId: actorUserId(request),
      channelId: params.data.channelId,
      expectedSequence: body.data.expectedSequence,
      reason: body.data.reason,
    }));
  });

  app.get('/channels/:channelId/receipts', async (request, reply) => {
    const params = channelParamsSchema.safeParse(request.params);
    const query = receiptQuerySchema.safeParse(request.query);
    if (!params.success) return invalidRequest(reply, params.error.issues);
    if (!query.success) return invalidRequest(reply, query.error.issues);
    return sendOperation(reply, () => options.service.readChannelReceipts({
      channelId: params.data.channelId,
      limit: query.data.limit,
    }));
  });
}
