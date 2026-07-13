import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { adminLogisticsInputUnitContractRoutes } from '../routes/admin-logistics-input-unit-contracts.js';

function service() {
  return {
    readContext: vi.fn(async () => ({
      assignment: { id: 'assignment-1' },
      current: null,
      history: [],
      candidates: [],
      policy: { defaultValidityDays: 7 },
    })),
    verify: vi.fn(async () => ({ duplicate: false, contract: { id: 'unit-contract-1' } })),
    revoke: vi.fn(async () => ({ duplicate: false, contractId: 'unit-contract-1' })),
  };
}

async function appFor(role: 'anonymous' | 'admin' | 'super-admin') {
  const app = Fastify();
  const unitService = service();
  await app.register(adminLogisticsInputUnitContractRoutes, {
    service: unitService as never,
    authenticateAccount: async (request: FastifyRequest, reply: FastifyReply) => {
      if (role === 'anonymous') {
        return reply.status(401).send({ code: 0, msg: 'not authenticated' });
      }
      (request as any).user = {
        actorUserId: role === 'super-admin' ? 'super-admin-1' : 'admin-1',
        isSuperAdmin: role === 'super-admin',
      };
    },
    requireSuperAdminAccount: async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(request as any).user?.isSuperAdmin) {
        return reply.status(403).send({ code: 0, msg: 'super admin required' });
      }
    },
  });
  return { app, service: unitService };
}

describe('admin Official input-unit contract routes', () => {
  it('denies anonymous and ordinary administrators before reading evidence', async () => {
    const anonymous = await appFor('anonymous');
    expect((await anonymous.app.inject({
      method: 'GET',
      url: '/official-input-unit-contracts?assignmentId=assignment-1',
    })).statusCode).toBe(401);
    expect(anonymous.service.readContext).not.toHaveBeenCalled();

    const admin = await appFor('admin');
    expect((await admin.app.inject({
      method: 'GET',
      url: '/official-input-unit-contracts?assignmentId=assignment-1',
    })).statusCode).toBe(403);
    expect(admin.service.readContext).not.toHaveBeenCalled();
  });

  it('returns the fixed review context contract for a super administrator', async () => {
    const { app, service: unitService } = await appFor('super-admin');
    const response = await app.inject({
      method: 'GET',
      url: '/official-input-unit-contracts?assignmentId=assignment%2F1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { policy: { defaultValidityDays: 7 } },
    });
    expect(unitService.readContext).toHaveBeenCalledWith({ assignmentId: 'assignment/1' });
  });

  it('accepts only reviewed unit assertions and derives the actor from authentication', async () => {
    const { app, service: unitService } = await appFor('super-admin');
    const payload = {
      assignmentId: 'assignment-1',
      candidateId: 'official-candidate-1',
      expectedCandidateChecksum: 'a'.repeat(64),
      weightIncrementG: 0.1,
      dimensionIncrementMm: 0.25,
      currencyMinorIncrement: 1,
      unitAttestation: {
        currency: 'CNY',
        weightUnit: 'g',
        dimensionUnit: 'mm',
        priceInputUnit: 'CNY_MAJOR',
      },
      reviewNote: 'Official page units checked',
      expectedCurrentContractId: null,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/official-input-unit-contracts/verify',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(unitService.verify).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      ...payload,
    });

    const forged = await app.inject({
      method: 'POST',
      url: '/official-input-unit-contracts/verify',
      payload: { ...payload, sourceChecksum: 'b'.repeat(64) },
    });
    expect(forged.statusCode).toBe(400);
    expect(unitService.verify).toHaveBeenCalledTimes(1);

    const fractionalMinorCurrency = await app.inject({
      method: 'POST',
      url: '/official-input-unit-contracts/verify',
      payload: { ...payload, currencyMinorIncrement: 0.5 },
    });
    expect(fractionalMinorCurrency.statusCode).toBe(400);
    expect(unitService.verify).toHaveBeenCalledTimes(1);
  });

  it('revokes only the current reviewed contract with an authenticated reason', async () => {
    const { app, service: unitService } = await appFor('super-admin');
    const response = await app.inject({
      method: 'POST',
      url: '/official-input-unit-contracts/unit-contract-1/revoke',
      payload: {
        reason: 'Incorrect unit observation',
        expectedCurrentContractId: 'unit-contract-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(unitService.revoke).toHaveBeenCalledWith({
      actorUserId: 'super-admin-1',
      contractId: 'unit-contract-1',
      reason: 'Incorrect unit observation',
      expectedCurrentContractId: 'unit-contract-1',
    });
  });
});
