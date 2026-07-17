import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminAiCostReconciliationRoutes } from '../routes/admin-ai-cost-reconciliations.js';

const HASH = 'a'.repeat(64);

function service() {
  const secret = { requestFingerprint: 'b'.repeat(64), prompt: 'secret prompt', apiKey: 'secret-key' };
  const reservation = {
    id: 'reservation-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', jobId: 'job-1',
    provider: 'openai', model: 'gpt-image-1', operation: 'IMAGE_TO_IMAGE', currency: 'USD',
    estimatedCostMinor: 10, maximumCostMinor: 20, status: 'SUBMISSION_UNCERTAIN', evidenceHash: HASH,
    providerRequestId: null, providerAcceptedAt: null,
    reconciliationRequiredAt: new Date('2026-07-18T01:00:00.000Z'),
    createdAt: new Date('2026-07-18T00:59:00.000Z'), updatedAt: new Date('2026-07-18T01:00:00.000Z'),
    job: {
      id: 'job-1', status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
      errorMessage: 'raw provider secret response', providerJobId: null, providerDispatchedAt: new Date('2026-07-18T00:59:30.000Z'),
      createdAt: new Date('2026-07-18T00:59:00.000Z'), updatedAt: new Date('2026-07-18T01:00:00.000Z'),
      ...secret,
    },
    settlements: [{
      id: 'settlement-1', kind: 'SUBMISSION_UNCERTAIN', actorUserId: 'worker-1',
      actualCostMinor: null, billedUnits: 0, reason: 'network timeout',
      createdAt: new Date('2026-07-18T01:00:00.000Z'), ...secret,
    }],
    ...secret,
  };
  return {
    listReconciliations: vi.fn(async () => ({ items: [reservation], limit: 50, ...secret })),
    reconcileReservation: vi.fn(async () => ({ ...reservation, status: 'RELEASED', releasedAt: new Date(), ...secret })),
  };
}

async function appFor(input: {
  superAdmin?: boolean;
  tokenUse?: string;
  isSubAccount?: boolean;
} = {}) {
  const app = Fastify();
  const reconciliationService = service();
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: 'admin-1', actorUserId: 'admin-1', role: 'ADMIN',
      isSuperAdmin: input.superAdmin ?? true,
      tokenUse: input.tokenUse ?? 'account_session',
      isSubAccount: input.isSubAccount ?? false,
    };
  });
  const requireSuperAdmin = vi.fn(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).user?.isSuperAdmin) return reply.status(403).send({ code: 0, msg: 'forbidden' });
  });
  await app.register(adminAiCostReconciliationRoutes, {
    service: reconciliationService,
    authenticate,
    requireSuperAdmin,
  });
  return { app, service: reconciliationService };
}

describe('admin AI cost reconciliation routes', () => {
  it.each([
    { superAdmin: false },
    { tokenUse: 'legacy_extension' },
    { isSubAccount: true },
  ])('rejects non-operator admin context %#', async (context) => {
    const { app, service: reconciliationService } = await appFor(context);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(403);
    expect(reconciliationService.listReconciliations).not.toHaveBeenCalled();
  });

  it('lists bounded reconciliation evidence without internal request data', async () => {
    const { app, service: reconciliationService } = await appFor();
    const response = await app.inject({ method: 'GET', url: '/?status=SUBMISSION_UNCERTAIN&limit=25' });

    expect(response.statusCode).toBe(200);
    expect(reconciliationService.listReconciliations).toHaveBeenCalledWith({
      status: 'SUBMISSION_UNCERTAIN', limit: 25,
    });
    expect(response.json().data.items[0]).toMatchObject({
      id: 'reservation-1', status: 'SUBMISSION_UNCERTAIN', evidenceHash: HASH,
      job: { id: 'job-1', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN' },
      settlements: [{ kind: 'SUBMISSION_UNCERTAIN', reason: 'network timeout' }],
    });
    expect(response.body).not.toContain('secret prompt');
    expect(response.body).not.toContain('secret-key');
    expect(response.body).not.toContain('raw provider secret response');
    expect(response.body).not.toContain('requestFingerprint');
    expect(response.body).not.toContain('b'.repeat(64));
  });

  it('passes only server-owned reconciliation inputs to the service', async () => {
    const { app, service: reconciliationService } = await appFor();
    const response = await app.inject({
      method: 'POST', url: '/reservation-1/reconcile', payload: {
        requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
        expectedStatus: 'SUBMISSION_UNCERTAIN', expectedEvidenceHash: HASH,
        outcome: 'RELEASED', billedUnits: 0,
        reason: 'Provider dashboard confirms no billable request exists',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reconciliationService.reconcileReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-1', actorUserId: 'admin-1',
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'SUBMISSION_UNCERTAIN', expectedEvidenceHash: HASH,
      outcome: 'RELEASED', billedUnits: 0,
      reason: 'Provider dashboard confirms no billable request exists',
    });
  });

  it('rejects charge decisions without explicit cost and units and rejects extra fields', async () => {
    const { app } = await appFor();
    const base = {
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'RECONCILIATION_REQUIRED', expectedEvidenceHash: HASH,
      outcome: 'SETTLED', reason: 'Provider invoice confirms one billable request',
    };
    expect((await app.inject({ method: 'POST', url: '/reservation-1/reconcile', payload: base })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/reservation-1/reconcile',
      payload: { ...base, actualCostMinor: 12, billedUnits: 1, ownerUserId: 'attacker-owner' },
    })).statusCode).toBe(400);
  });
});
