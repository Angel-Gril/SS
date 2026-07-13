import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import {
  CAPTURE_TASK_VERSION,
  LogisticsCaptureTaskError,
  type LogisticsCaptureDeviceContext,
  type LogisticsCaptureAdminTask,
  type LogisticsCaptureTask,
  type LogisticsCapturePendingTask,
  type createLogisticsCaptureTaskService,
} from '../services/logistics-capture-task.js';
import type { createReviewedCaptureDraftService } from '../services/logistics-capture-draft.js';

const identifier = z.string().trim().min(1).max(300);
const scopeSchema = z.object({
  tenantId: identifier,
  shopId: identifier,
  companyId: identifier,
  warehouseId: identifier,
  originCountryUid: identifier,
  originCityUid: identifier,
}).strict();
const destinationSchema = z.object({
  countryUid: identifier,
  locationUid: identifier,
}).strict();
const officialFingerprintSchema = z.object({
  originCountryUid: identifier,
  originCityUid: identifier,
  destinationCountryUid: identifier,
  destinationLocationUid: identifier,
  currency: z.string().regex(/^[A-Z]{3}$/),
  declaredPriceMinor: z.string().regex(/^\d+$/),
  weightGrams: z.string().regex(/^[1-9]\d*$/),
  dimensionsMm: z.object({
    length: z.string().regex(/^[1-9]\d*$/),
    width: z.string().regex(/^[1-9]\d*$/),
    height: z.string().regex(/^[1-9]\d*$/),
  }).strict(),
  batteryMode: z.enum(['UNSPECIFIED', 'NONE', 'CONTAINS_BATTERY']),
}).strict();

const sellerIssueSchema = z.object({
  scope: scopeSchema,
  expectedEndpoints: z.array(identifier).min(1).max(500),
}).strict();
const officialIssueSchema = z.object({
  scope: scopeSchema,
  destination: destinationSchema,
  fingerprint: officialFingerprintSchema,
}).strict();
const proofBase = {
  taskVersion: z.string().trim().min(1).max(100),
  scope: scopeSchema,
};
const nonceProofSchema = z.object({
  ...proofBase,
  nonce: z.string().trim().min(20).max(500),
}).strict();
const claimTokenProofSchema = z.object({
  ...proofBase,
  claimToken: z.string().trim().min(32).max(2000),
}).strict();
const proofSchema = z.union([nonceProofSchema, claimTokenProofSchema]);
const uploadSchema = z.union([
  nonceProofSchema.extend({ payload: z.unknown() }).strict(),
  claimTokenProofSchema.extend({ payload: z.unknown() }).strict(),
]);
const taskParamsSchema = z.object({ taskId: identifier }).strict();
const candidateParamsSchema = z.object({ candidateId: identifier }).strict();
const verifyReviewBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
const rejectReviewBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
const emptyBodySchema = z.object({}).strict();
const matrixBaseProductSchema = z.object({
  declaredPriceMinor: z.string().regex(/^\d+$/),
  weightGrams: z.string().regex(/^[1-9]\d*$/),
  dimensionsMm: z.object({
    length: z.string().regex(/^[1-9]\d*$/),
    width: z.string().regex(/^[1-9]\d*$/),
    height: z.string().regex(/^[1-9]\d*$/),
  }).strict(),
  batteryMode: z.enum(['UNSPECIFIED', 'NONE', 'CONTAINS_BATTERY']),
}).strict();
const captureMatrixPreviewSchema = z.object({
  sellerCandidateId: identifier,
  assignmentId: identifier,
  selectedServiceKeys: z.array(identifier).min(1).max(2500),
  baseProduct: matrixBaseProductSchema,
}).strict();
const captureCandidateSetSchema = captureMatrixPreviewSchema.extend({
  defaultServiceKeys: z.array(identifier).min(1).max(2500),
}).strict();
const captureDraftSchema = z.object({
  candidateSetId: identifier,
}).strict();
const reviewQuerySchema = z.object({
  tenantId: identifier.optional(),
  shopId: identifier.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
const taskListQuerySchema = z.object({
  tenantId: identifier.optional(),
  shopId: identifier.optional(),
  status: z.enum(['ISSUED', 'CLAIMED', 'REVIEWABLE', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

type CaptureService = ReturnType<typeof createLogisticsCaptureTaskService>;
type Hook = (
  request: FastifyRequest, reply: FastifyReply,
) => void | Promise<unknown>;

export interface AdminLogisticsCaptureTaskRouteOptions {
  draftService: Pick<ReturnType<typeof createReviewedCaptureDraftService>,
    'previewMatrix' | 'createCandidateSet' | 'createDraft'>;
  service: Pick<CaptureService,
    'issueSellerTask' | 'issueOfficialTask'
    | 'listCaptureTasks' | 'getCaptureTask'
    | 'listReviewableCandidates' | 'getReviewableCandidate'
    | 'reviewCaptureCandidate' | 'cancelCaptureTaskAsAdmin'>;
  authenticateAccount?: Hook;
  requireSuperAdminAccount?: Hook;
}

export interface LogisticsCaptureTaskRouteOptions {
  service: Pick<CaptureService, 'listPendingCaptureTasks' | 'claimCaptureTask'
    | 'submitCapture' | 'cancelCaptureTask'>;
  authenticateCapture: Hook;
}

function actorUserId(request: FastifyRequest): string {
  const user = (request as any).user;
  const value = String(user?.actorUserId || user?.userId || '').trim();
  if (!value) throw new Error('Authenticated administrator identity is unavailable');
  return value;
}

function deviceContext(request: FastifyRequest): LogisticsCaptureDeviceContext {
  const parsed = z.object({
    sessionId: identifier,
    ownerUserId: identifier,
    allowedShopIds: z.array(identifier).default([]),
  }).strip().safeParse((request as any).device);
  if (!parsed.success) throw new Error('Authenticated extension-device context is unavailable');
  return parsed.data;
}

function publicTask(
  task: LogisticsCaptureTask | LogisticsCapturePendingTask,
  includeNonce: boolean,
) {
  return {
    id: task.id,
    version: task.version,
    kind: task.kind,
    requestedByUserId: task.requestedByUserId,
    scope: task.scope,
    destination: task.destination,
    officialFingerprint: task.officialFingerprint,
    expectedEndpoints: task.expectedEndpoints,
    fingerprintChecksum: task.fingerprintChecksum,
    ...(includeNonce && 'nonce' in task ? { nonce: task.nonce } : {}),
    ...('claimToken' in task ? { claimToken: task.claimToken } : {}),
    ...('progress' in task ? { progress: task.progress } : {}),
    status: task.status,
    claimedBySessionId: task.claimedBySessionId,
    claimedAt: task.claimedAt?.toISOString() || null,
    uploadedAt: task.uploadedAt?.toISOString() || null,
    reviewableAt: task.reviewableAt?.toISOString() || null,
    issuedAt: task.issuedAt.toISOString(),
    expiresAt: task.expiresAt.toISOString(),
  };
}

function publicAdminTask(task: LogisticsCaptureAdminTask) {
  return {
    id: task.id,
    version: task.version,
    kind: task.kind,
    requestedByUserId: task.requestedByUserId,
    scope: task.scope,
    destination: task.destination,
    officialFingerprint: task.officialFingerprint,
    expectedEndpoints: task.expectedEndpoints,
    fingerprintChecksum: task.fingerprintChecksum,
    status: task.status,
    claimed: task.claimed,
    candidate: task.candidate,
    progress: task.progress,
    claimedAt: task.claimedAt?.toISOString() || null,
    uploadedAt: task.uploadedAt?.toISOString() || null,
    reviewableAt: task.reviewableAt?.toISOString() || null,
    issuedAt: task.issuedAt.toISOString(),
    expiresAt: task.expiresAt.toISOString(),
  };
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid capture task request',
    error: { code: 'INVALID_REQUEST' },
  });
}

function captureError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof LogisticsCaptureTaskError)) throw error;
  const payloadError = error.code === 'CREDENTIAL_FIELDS_FORBIDDEN'
    || error.code === 'CAPTURE_PAYLOAD_INVALID';
  return reply.status(error.statusCode).send({
    code: 0,
    msg: payloadError ? 'Capture payload rejected' : error.message,
    error: { code: error.code },
  });
}

async function operation(
  reply: FastifyReply,
  callback: () => Promise<unknown>,
  statusCode = 200,
) {
  try {
    return reply.status(statusCode).send({ code: 1, msg: 'ok', data: await callback() });
  } catch (error) {
    return captureError(reply, error);
  }
}

export async function adminLogisticsCaptureTaskRoutes(
  app: FastifyInstance,
  options: AdminLogisticsCaptureTaskRouteOptions,
) {
  app.addHook('preHandler', options.authenticateAccount || authenticate);
  app.addHook('preHandler', options.requireSuperAdminAccount || requireSuperAdmin);

  app.post('/capture-tasks/seller', async (request, reply) => {
    const body = sellerIssueSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, async () => publicTask(
      await options.service.issueSellerTask({
        requestedByUserId: actorUserId(request),
        scope: body.data.scope,
        expectedEndpoints: body.data.expectedEndpoints,
      }),
      false,
    ), 201);
  });

  app.post('/capture-tasks/official', async (request, reply) => {
    const body = officialIssueSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, async () => publicTask(
      await options.service.issueOfficialTask({
        requestedByUserId: actorUserId(request),
        scope: body.data.scope,
        destination: body.data.destination,
        fingerprint: body.data.fingerprint,
      }),
      false,
    ), 201);
  });

  app.get('/capture-tasks', async (request, reply) => {
    const query = taskListQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    return operation(reply, async () => ({
      tasks: (await options.service.listCaptureTasks(query.data)).map(publicAdminTask),
    }));
  });

  app.get('/capture-tasks/:taskId', async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply);
    return operation(reply, async () => publicAdminTask(
      await options.service.getCaptureTask({ taskId: params.data.taskId }),
    ));
  });

  app.get('/capture-tasks/reviewable', async (request, reply) => {
    const query = reviewQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    return operation(reply, async () => ({
      candidates: await options.service.listReviewableCandidates(query.data),
    }));
  });

  app.get('/capture-tasks/reviewable/:candidateId', async (request, reply) => {
    const params = candidateParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply);
    return operation(reply, () => options.service.getReviewableCandidate({
      candidateId: params.data.candidateId,
    }));
  });
  app.post('/capture-tasks/reviewable/:candidateId/verify', async (request, reply) => {
    const params = candidateParamsSchema.safeParse(request.params);
    const body = verifyReviewBodySchema.safeParse(request.body || {});
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.reviewCaptureCandidate({
      candidateId: params.data.candidateId,
      actorUserId: actorUserId(request),
      decision: 'VERIFIED',
      reason: body.data.reason,
    }));
  });

  app.post('/capture-tasks/reviewable/:candidateId/reject', async (request, reply) => {
    const params = candidateParamsSchema.safeParse(request.params);
    const body = rejectReviewBodySchema.safeParse(request.body || {});
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.reviewCaptureCandidate({
      candidateId: params.data.candidateId,
      actorUserId: actorUserId(request),
      decision: 'REJECTED',
      reason: body.data.reason,
    }));
  });

  app.post('/capture-tasks/matrix-preview', async (request, reply) => {
    const body = captureMatrixPreviewSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.draftService.previewMatrix({
      actorUserId: actorUserId(request),
      ...body.data,
    }));
  });

  app.post('/capture-tasks/candidate-sets', async (request, reply) => {
    const body = captureCandidateSetSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.draftService.createCandidateSet({
      actorUserId: actorUserId(request),
      ...body.data,
    }), 201);
  });

  app.post('/capture-tasks/drafts', async (request, reply) => {
    const body = captureDraftSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.draftService.createDraft({
      actorUserId: actorUserId(request),
      ...body.data,
    }), 201);
  });

  app.post('/capture-tasks/:taskId/cancel', async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    const body = emptyBodySchema.safeParse(request.body || {});
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, async () => publicTask(
      await options.service.cancelCaptureTaskAsAdmin({
        taskId: params.data.taskId,
        actorUserId: actorUserId(request),
      }),
      false,
    ));
  });
}

export async function logisticsCaptureTaskRoutes(
  app: FastifyInstance,
  options: LogisticsCaptureTaskRouteOptions,
) {
  app.get('/capture-tasks/pending', {
    preHandler: [options.authenticateCapture],
  }, async (request, reply) => {
    const device = deviceContext(request);
    return operation(reply, async () => ({
      tasks: (await options.service.listPendingCaptureTasks({ device }))
        .map((task) => publicTask(task, false)),
    }));
  });

  app.post('/capture-tasks/:taskId/claim', {
    preHandler: [options.authenticateCapture],
  }, async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    const body = proofSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const device = deviceContext(request);
    if (body.data.scope.tenantId !== device.ownerUserId
      || !device.allowedShopIds.includes(body.data.scope.shopId)) {
      return captureError(reply, new LogisticsCaptureTaskError(
        'CAPTURE_TASK_MISMATCH', 404, 'Capture task is unavailable',
      ));
    }
    return operation(reply, async () => publicTask(
      await options.service.claimCaptureTask({
        taskId: params.data.taskId,
        taskVersion: body.data.taskVersion,
        ...('nonce' in body.data ? { nonce: body.data.nonce } : { claimToken: body.data.claimToken }),
        scope: body.data.scope,
        device,
      }),
      false,
    ));
  });

  app.post('/capture-tasks/:taskId/upload', {
    preHandler: [options.authenticateCapture],
    bodyLimit: 4 * 1024 * 1024,
  }, async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    const body = uploadSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const device = deviceContext(request);
    if (body.data.scope.tenantId !== device.ownerUserId
      || !device.allowedShopIds.includes(body.data.scope.shopId)) {
      return captureError(reply, new LogisticsCaptureTaskError(
        'CAPTURE_TASK_MISMATCH', 404, 'Capture task is unavailable',
      ));
    }
    try {
      const result = await options.service.submitCapture({
        taskId: params.data.taskId,
        taskVersion: body.data.taskVersion,
        ...('nonce' in body.data ? { nonce: body.data.nonce } : { claimToken: body.data.claimToken }),
        scope: body.data.scope,
        payload: body.data.payload,
        deviceSessionId: device.sessionId,
        deviceOwnerUserId: device.ownerUserId,
        allowedShopIds: device.allowedShopIds,
      });
      return reply.status(result.duplicate ? 200 : 201).send({
        code: 1,
        msg: 'ok',
        data: result,
      });
    } catch (error) {
      return captureError(reply, error);
    }
  });
  app.post('/capture-tasks/:taskId/cancel', {
    preHandler: [options.authenticateCapture],
  }, async (request, reply) => {
    const params = taskParamsSchema.safeParse(request.params);
    const body = proofSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    const device = deviceContext(request);
    if (body.data.scope.tenantId !== device.ownerUserId
      || !device.allowedShopIds.includes(body.data.scope.shopId)) {
      return captureError(reply, new LogisticsCaptureTaskError(
        'CAPTURE_TASK_MISMATCH', 404, 'Capture task is unavailable',
      ));
    }
    return operation(reply, async () => publicTask(
      await options.service.cancelCaptureTask({
        taskId: params.data.taskId,
        taskVersion: body.data.taskVersion,
        ...('nonce' in body.data
          ? { nonce: body.data.nonce }
          : { claimToken: body.data.claimToken }),
        scope: body.data.scope,
        device,
      }),
      false,
    ));
  });
}

export { CAPTURE_TASK_VERSION };
