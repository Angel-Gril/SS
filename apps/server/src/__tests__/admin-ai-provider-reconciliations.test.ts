import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminAiProviderReconciliationRoutes } from '../routes/admin-ai-provider-reconciliations.js';

const HASH = 'a'.repeat(64);

function service() {
  const item = {
    id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', operation: 'IMAGE_TRANSLATE',
    provider: 'dashscope-qwen-mt-image', model: 'qwen-mt-image', jobStatus: 'FAILED',
    providerJobId: null, costProviderJobId: null, providerAcceptedAt: null,
    status: 'MANUAL_REVIEW', revision: 1, attemptCount: 0,
    nextAt: null, deadlineAt: null, lastProviderStatus: null,
    lastErrorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', lastErrorMessage: 'submission timed out',
    reconciledAt: null, updatedAt: '2026-07-21T08:00:00.000Z', costStatus: 'SUBMISSION_UNCERTAIN',
    context: { type: 'collect', id: 'goods-1', skuKey: null, slotKey: null },
    allowedActions: ['RESUME', 'NOT_SUBMITTED'],
    evidenceHash: HASH,
    prompt: 'secret prompt', requestFingerprint: 'b'.repeat(64),
    providerReconciliationLeaseTokenHash: 'c'.repeat(64),
  };
  return {
    listReconciliations: vi.fn(async () => ({
      items: [item], limit: 50, status: 'MANUAL_REVIEW', nextCursor: 'next-page',
      internalPageState: 'must-not-leak',
    })),
    resolveReconciliation: vi.fn(async () => ({ ...item, status: 'NOT_SUBMITTED', revision: 2 })),
  };
}

async function appFor(input: { superAdmin?: boolean; tokenUse?: string; isSubAccount?: boolean } = {}) {
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
  await app.register(adminAiProviderReconciliationRoutes, {
    service: reconciliationService,
    authenticate,
    requireSuperAdmin,
  });
  return { app, service: reconciliationService };
}

describe('admin AI Provider reconciliation routes', () => {
  it.each([
    { superAdmin: false },
    { tokenUse: 'legacy_extension' },
    { isSubAccount: true },
  ])('rejects non-operator admin context %#', async (context) => {
    const { app, service: reconciliationService } = await appFor(context);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(403);
    expect(reconciliationService.listReconciliations).not.toHaveBeenCalled();
  });

  it('lists bounded Provider result evidence without internal authority', async () => {
    const { app, service: reconciliationService } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/?limit=25&status=MANUAL_REVIEW&cursor=eyJ2IjoxfQ',
    });

    expect(response.statusCode).toBe(200);
    expect(reconciliationService.listReconciliations).toHaveBeenCalledWith({
      limit: 25, status: 'MANUAL_REVIEW', cursor: 'eyJ2IjoxfQ',
    });
    expect(response.json().data).toMatchObject({
      status: 'MANUAL_REVIEW', limit: 50, nextCursor: 'next-page',
    });
    expect(response.json().data.items[0]).toMatchObject({
      id: 'job-1', status: 'MANUAL_REVIEW', revision: 1,
      lastErrorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', providerAcceptedAt: null,
      costProviderJobId: null, allowedActions: ['RESUME', 'NOT_SUBMITTED'], evidenceHash: HASH,
    });
    expect(response.body).not.toContain('secret prompt');
    expect(response.body).not.toContain('requestFingerprint');
    expect(response.body).not.toContain('b'.repeat(64));
    expect(response.body).not.toContain('c'.repeat(64));
    expect(response.body).not.toContain('internalPageState');
  });

  it('rejects unsupported queue statuses before calling the service', async () => {
    const { app, service: reconciliationService } = await appFor();
    const response = await app.inject({ method: 'GET', url: '/?status=RECOVERED' });

    expect(response.statusCode).toBe(400);
    expect(reconciliationService.listReconciliations).not.toHaveBeenCalled();
  });

  it('passes an audited manual decision with the authenticated actor', async () => {
    const { app, service: reconciliationService } = await appFor();
    const response = await app.inject({
      method: 'POST', url: '/job-1/resolve', payload: {
        requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
        expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1, expectedEvidenceHash: HASH,
        action: 'NOT_SUBMITTED',
        reason: 'Provider dashboard confirms no task was created',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(reconciliationService.resolveReconciliation).toHaveBeenCalledWith({
      jobId: 'job-1', actorUserId: 'admin-1',
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1, expectedEvidenceHash: HASH,
      action: 'NOT_SUBMITTED',
      reason: 'Provider dashboard confirms no task was created',
    });
  });

  it('rejects forged success, unexpected fields and incomplete resume evidence', async () => {
    const { app } = await appFor();
    const base = {
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1, expectedEvidenceHash: HASH,
      reason: 'Provider dashboard evidence has been reviewed',
    };
    expect((await app.inject({
      method: 'POST', url: '/job-1/resolve', payload: { ...base, action: 'SUCCEEDED' },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/job-1/resolve', payload: {
        ...base, action: 'NO_OUTPUT', ownerUserId: 'attacker-owner',
      },
    })).statusCode).toBe(400);
    expect((await app.inject({
      method: 'POST', url: '/job-1/resolve', payload: { ...base, action: 'RESUME' },
    })).statusCode).toBe(400);
  });
});
