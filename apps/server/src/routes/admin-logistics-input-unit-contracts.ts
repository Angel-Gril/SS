import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import {
  OfficialInputUnitContractError,
  type createOfficialInputUnitContractService,
} from '../services/logistics-official-input-unit-contract.js';

const identifierSchema = z.string().trim().min(1).max(300);
const checksumSchema = z.string().trim().regex(/^[a-fA-F0-9]{64}$/);
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const measurementIncrementSchema = z.number().finite().positive()
  .lt(100_000_000_000)
  .refine((value) => {
    const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
    const fractionLength = coefficient?.split('.')[1]?.length || 0;
    return Math.max(0, fractionLength - Number(exponentText)) <= 9;
  }, {
    message: 'Measurement increment supports at most nine decimal places',
  });


const contextQuerySchema = z.object({
  assignmentId: identifierSchema,
}).strict();

const unitAttestationSchema = z.object({
  currency: z.literal('CNY'),
  weightUnit: z.literal('g'),
  dimensionUnit: z.literal('mm'),
  priceInputUnit: z.literal('CNY_MAJOR'),
}).strict();

const verifyBodySchema = z.object({
  assignmentId: identifierSchema,
  candidateId: identifierSchema,
  expectedCandidateChecksum: checksumSchema,
  weightIncrementG: measurementIncrementSchema,
  dimensionIncrementMm: measurementIncrementSchema,
  currencyMinorIncrement: positiveSafeIntegerSchema,
  unitAttestation: unitAttestationSchema,
  reviewNote: z.string().trim().min(3).max(1000),
  expectedCurrentContractId: identifierSchema.nullable(),
}).strict();

const contractParamsSchema = z.object({
  id: identifierSchema,
}).strict();

const revokeBodySchema = z.object({
  reason: z.string().trim().min(5).max(500),
  expectedCurrentContractId: identifierSchema,
}).strict();

type Hook = (request: FastifyRequest, reply: FastifyReply) => unknown;
type OfficialInputUnitContractService = ReturnType<
  typeof createOfficialInputUnitContractService
>;

export interface AdminLogisticsInputUnitContractRouteOptions {
  service: Pick<OfficialInputUnitContractService, 'readContext' | 'verify' | 'revoke'>;
  authenticateAccount?: Hook;
  requireSuperAdminAccount?: Hook;
}

function actorUserId(request: FastifyRequest): string {
  const user = (request as any).user;
  const value = String(user?.actorUserId || user?.userId || '').trim();
  if (!value) {
    throw new OfficialInputUnitContractError(
      'ACTOR_CONTEXT_REQUIRED',
      'Authenticated administrator identity is unavailable',
      500,
    );
  }
  return value;
}

function invalidRequest(reply: FastifyReply) {
  return reply.status(400).send({
    code: 0,
    msg: 'Invalid Official input-unit contract request',
    error: { code: 'INVALID_REQUEST' },
  });
}

async function operation(
  reply: FastifyReply,
  callback: () => Promise<unknown>,
  statusCode = 200,
) {
  try {
    const data = await callback();
    return reply.status(statusCode).send({ code: 1, msg: 'ok', data });
  } catch (error) {
    if (!(error instanceof OfficialInputUnitContractError)) throw error;
    return reply.status(error.statusCode).send({
      code: 0,
      msg: error.message,
      error: { code: error.code },
    });
  }
}

export async function adminLogisticsInputUnitContractRoutes(
  app: FastifyInstance,
  options: AdminLogisticsInputUnitContractRouteOptions,
) {
  app.addHook('preHandler', options.authenticateAccount || authenticate);
  app.addHook('preHandler', options.requireSuperAdminAccount || requireSuperAdmin);

  app.get('/official-input-unit-contracts', async (request, reply) => {
    const query = contextQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply);
    return operation(reply, () => options.service.readContext(query.data));
  });

  app.post('/official-input-unit-contracts/verify', async (request, reply) => {
    const body = verifyBodySchema.safeParse(request.body);
    if (!body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.verify({
      actorUserId: actorUserId(request),
      ...body.data,
    }), 201);
  });

  app.post('/official-input-unit-contracts/:id/revoke', async (request, reply) => {
    const params = contractParamsSchema.safeParse(request.params);
    const body = revokeBodySchema.safeParse(request.body);
    if (!params.success || !body.success) return invalidRequest(reply);
    return operation(reply, () => options.service.revoke({
      actorUserId: actorUserId(request),
      contractId: params.data.id,
      ...body.data,
    }));
  });
}
