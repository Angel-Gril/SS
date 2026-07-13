import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import {
  LogisticsScopeBootstrapError,
  type LogisticsScopeBootstrapService,
  type LogisticsScopeDeviceContext,
} from '../services/logistics-scope-bootstrap.js';

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const identifier = z.string().trim().min(1).max(300);
const reason = z.string().trim().min(5).max(500);
const emptyBody = z.object({}).strict();
const bootstrapSchema = z.object({
  tenantId: identifier,
  shopId: identifier,
  warehouseId: identifier,
  deliveryMethodId: identifier,
}).strict();
const issueSchema = z.object({ bootstrapId: identifier }).strict();
const probeParamsSchema = z.object({ probeId: identifier }).strict();
const bootstrapParamsSchema = z.object({ bootstrapId: identifier }).strict();
const reviewSchema = z.object({ reason }).strict();
const workspaceQuerySchema = z.object({
  tenantId: identifier.optional(),
  shopId: identifier.optional(),
  warehouseId: identifier.optional(),
  bootstrapId: identifier.optional(),
}).strict();
const claimSchema = z.object({
  claimToken: z.string().trim().min(32).max(500),
}).strict();
const evidenceSchema = z.object({
  companyId: identifier,
  warehouse: z.object({ platformWarehouseId: identifier }).strict(),
  deliveryMethod: z.object({ platformMethodId: z.number().int().positive() }).strict(),
}).strict();
const submitSchema = claimSchema.extend({ evidence: evidenceSchema }).strict();
const officialLocationSchema = z.object({
  countryUid: z.string().uuid(),
  countryLabel: identifier,
  cityUid: z.string().uuid(),
  cityLabel: identifier,
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
}).strict();
const destinationSchema = z.object({
  countryUid: z.string().uuid(),
  countryLabel: identifier,
  locationUid: z.string().uuid(),
  locationLabel: identifier,
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
}).strict();
const activateOriginSchema = z.object({
  companyBindingId: identifier,
  reason,
  officialLocation: officialLocationSchema,
  destination: destinationSchema,
}).strict();

export interface AdminLogisticsScopeBootstrapRouteOptions {
  service: Pick<LogisticsScopeBootstrapService,
    'listWorkspace'
    | 'getCompanyProbe'
    | 'bootstrapScope'
    | 'issueCompanyProbe'
    | 'reviewCompanyProbe'
    | 'confirmOriginAndActivate'>;
  authenticateAccount?: Hook;
  requireSuperAdminAccount?: Hook;
}

export interface LogisticsScopeBootstrapDeviceRouteOptions {
  service: Pick<LogisticsScopeBootstrapService,
    'listPendingCompanyProbes' | 'claimCompanyProbe' | 'submitCompanyProbe'>;
  authenticateDevice: Hook;
}

function actorUserId(request: FastifyRequest): string {
  const value = String((request as any).user?.actorUserId
    || (request as any).user?.userId
    || '').trim();
  if (!value) throw new Error('Authenticated administrator identity is unavailable');
  return value;
}

function deviceContext(request: FastifyRequest): LogisticsScopeDeviceContext {
  const parsed = z.object({
    sessionId: identifier,
    ownerUserId: identifier,
    allowedShopIds: z.array(identifier).default([]),
  }).strip().safeParse((request as any).device);
  if (!parsed.success) {
    throw new LogisticsScopeBootstrapError(
      'BINDING_PROBE_UNAVAILABLE',
      404,
      'Binding probe is unavailable',
    );
  }
  return parsed.data;
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid logistics scope request',
    error: { code: 'INVALID_LOGISTICS_SCOPE_REQUEST' },
  });
}

function errorResponse(reply: FastifyReply, error: unknown) {
  if (error instanceof LogisticsScopeBootstrapError) {
    return reply.status(error.statusCode).send({
      code: 0,
      msg: error.message,
      error: { code: error.code },
    });
  }
  const upstream = error as { code?: unknown; statusCode?: unknown; message?: unknown };
  if (typeof upstream?.code === 'string'
    && typeof upstream?.statusCode === 'number'
    && upstream.statusCode >= 400
    && upstream.statusCode <= 599) {
    return reply.status(upstream.statusCode).send({
      code: 0,
      msg: String(upstream.message || 'Logistics scope operation failed'),
      error: { code: upstream.code },
    });
  }
  return reply.status(500).send({
    code: 0,
    msg: 'Logistics scope operation failed',
    error: { code: 'LOGISTICS_SCOPE_INTERNAL_ERROR' },
  });
}

async function operation(
  reply: FastifyReply,
  action: () => Promise<unknown>,
  statusCode = 200,
) {
  try {
    const data = await action();
    return reply.status(statusCode).send({ code: 1, msg: 'ok', data });
  } catch (error) {
    return errorResponse(reply, error);
  }
}

export async function adminLogisticsScopeBootstrapRoutes(
  app: FastifyInstance,
  options: AdminLogisticsScopeBootstrapRouteOptions,
) {
  app.addHook('preHandler', options.authenticateAccount || authenticate);
  app.addHook('preHandler', options.requireSuperAdminAccount || requireSuperAdmin);

  app.get('/scope-bootstrap/workspace', async (request, reply) => {
    const query = workspaceQuerySchema.safeParse(request.query || {});
    if (!query.success) return invalidRequest(reply);
    return operation(reply, () => options.service.listWorkspace(query.data));
  });
  app.get('/binding-probes/:probeId', async (request, reply) => {
    const params = probeParamsSchema.safeParse(request.params);
    if (!params.success) return invalidRequest(reply);
    return operation(reply, () => options.service.getCompanyProbe({
      probeId: params.data.probeId,
    }));
  });

  app.post('/scope-bootstrap', async (request, reply) => {
    const body = bootstrapSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.bootstrapScope({
      actorUserId: actorUserId(request),
      ...body.data,
    }), 201);
  });

  app.post('/binding-probes', async (request, reply) => {
    const body = issueSchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.issueCompanyProbe({
      actorUserId: actorUserId(request),
      bootstrapId: body.data.bootstrapId,
    }), 201);
  });

  for (const decision of ['confirm', 'reject'] as const) {
    app.post('/binding-probes/:probeId/' + decision, async (request, reply) => {
      const params = probeParamsSchema.safeParse(request.params);
      const body = reviewSchema.safeParse(request.body);
      if (!params.success || !body.success) return invalidRequest(reply);
      return operation(reply, () => options.service.reviewCompanyProbe({
        probeId: params.data.probeId,
        actorUserId: actorUserId(request),
        decision: decision === 'confirm' ? 'CONFIRMED' : 'REJECTED',
        reason: body.data.reason,
      }));
    });
  }

  app.post('/scope-bootstrap/:bootstrapId/activate-origin', async (request, reply) => {
    const params = bootstrapParamsSchema.safeParse(request.params);
    const body = activateOriginSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.confirmOriginAndActivate({
      actorUserId: actorUserId(request),
      bootstrapId: params.data.bootstrapId,
      ...body.data,
    }), 201);
  });
}

export async function logisticsScopeBootstrapDeviceRoutes(
  app: FastifyInstance,
  options: LogisticsScopeBootstrapDeviceRouteOptions,
) {
  app.get('/binding-probes/pending', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => operation(reply, async () => ({
    probes: await options.service.listPendingCompanyProbes({
      device: deviceContext(request),
    }),
  })));

  app.post('/binding-probes/:probeId/claim', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = probeParamsSchema.safeParse(request.params);
    const body = claimSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.claimCompanyProbe({
      probeId: params.data.probeId,
      claimToken: body.data.claimToken,
      device: deviceContext(request),
    }));
  });

  app.post('/binding-probes/:probeId/submit', {
    preHandler: [options.authenticateDevice],
  }, async (request, reply) => {
    const params = probeParamsSchema.safeParse(request.params);
    const body = submitSchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    try {
      const data = await options.service.submitCompanyProbe({
        probeId: params.data.probeId,
        claimToken: body.data.claimToken,
        evidence: body.data.evidence,
        device: deviceContext(request),
      });
      return reply.status(data.duplicate ? 200 : 201).send({ code: 1, msg: 'ok', data });
    } catch (error) {
      return errorResponse(reply, error);
    }
  });

  app.post('/binding-probes/:probeId/cancel', {
    preHandler: [options.authenticateDevice],
  }, async (_request, reply) => {
    const body = emptyBody.safeParse({});
    if (!body.success) return invalidRequest(reply);
    return reply.status(405).send({
      code: 0,
      msg: 'Device cancellation is not supported',
      error: { code: 'BINDING_PROBE_CANCEL_NOT_ALLOWED' },
    });
  });
}
