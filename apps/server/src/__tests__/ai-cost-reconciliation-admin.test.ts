import { describe, expect, it } from 'vitest';
import { createAiCostReconciliationAdminService } from '../services/ai-cost-reconciliation-admin.js';

function database() {
  const updatedAt = new Date('2026-07-18T01:00:00.000Z');
  const jobUpdatedAt = new Date('2026-07-18T00:59:59.000Z');
  const reservation: any = {
    id: 'reservation-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', workflowId: 'workflow-1',
    jobId: 'job-1', idempotencyKey: 'reserve-1', requestFingerprint: 'a'.repeat(64),
    provider: 'openai', model: 'gpt-image-1', operation: 'IMAGE_TO_IMAGE', currency: 'USD',
    roundingMode: 'HALF_UP', estimatedCostMinor: 10, maximumCostMinor: 20,
    status: 'SUBMISSION_UNCERTAIN', providerRequestId: null, providerAcceptedAt: null,
    reconciliationRequiredAt: new Date('2026-07-18T00:59:30.000Z'),
    settledAt: null, releasedAt: null, createdAt: new Date('2026-07-18T00:59:00.000Z'), updatedAt,
    job: {
      id: 'job-1', status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN', errorMessage: 'timeout',
      providerJobId: null, providerDispatchedAt: new Date('2026-07-18T00:59:10.000Z'),
      createdAt: new Date('2026-07-18T00:59:00.000Z'), updatedAt: jobUpdatedAt,
    },
    settlements: [],
  };
  const settlements = new Map<string, any>();
  let sequence = 0;
  const db: any = {
    reservation,
    $transaction: async (callback: any) => callback(db),
    aiCostReservation: {
      findMany: async () => [reservation],
      findUnique: async ({ where }: any) => {
        if (where.id && where.id !== reservation.id) return null;
        const owned = where.ai_cost_reservation_id_owner;
        if (owned && (owned.id !== reservation.id || owned.ownerUserId !== reservation.ownerUserId)) return null;
        return reservation;
      },
      create: async () => reservation,
      updateMany: async ({ where, data }: any) => {
        const statuses = where.status?.in || [where.status];
        if (where.id !== reservation.id || where.ownerUserId !== reservation.ownerUserId
          || !statuses.includes(reservation.status)
          || (where.updatedAt && where.updatedAt.getTime() !== reservation.updatedAt.getTime())) return { count: 0 };
        Object.assign(reservation, data, { updatedAt: new Date(reservation.updatedAt.getTime() + 1000) });
        return { count: 1 };
      },
    },
    aiCostSettlement: {
      findUnique: async ({ where }: any) => {
        const key = where.ai_cost_settlement_reservation_idempotency;
        return settlements.get(`${key.reservationId}:${key.idempotencyKey}`) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `settlement-${++sequence}`, createdAt: new Date(), ...data };
        settlements.set(`${row.reservationId}:${row.idempotencyKey}`, row);
        reservation.settlements.unshift(row);
        return row;
      },
    },
    aiImageJob: {
      updateMany: async ({ where, data }: any) => {
        if (where.id !== reservation.job.id || where.ownerUserId !== reservation.ownerUserId
          || where.updatedAt.getTime() !== reservation.job.updatedAt.getTime()) return { count: 0 };
        Object.assign(reservation.job, data, { updatedAt: new Date(reservation.job.updatedAt.getTime() + 1000) });
        return { count: 1 };
      },
    },
  };
  return db;
}

describe('AI cost reconciliation admin service', () => {
  it('lists only unresolved evidence with a stable evidence hash', async () => {
    const db = database();
    const service = createAiCostReconciliationAdminService({ database: db });
    const first = await service.listReconciliations({ limit: 25 });
    const second = await service.listReconciliations({ limit: 25 });

    expect(first.items[0].evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.items[0].evidenceHash).toBe(first.items[0].evidenceHash);
  });

  it('releases an uncertain reservation and replays only the exact operator decision', async () => {
    const db = database();
    const service = createAiCostReconciliationAdminService({ database: db });
    const listed = await service.listReconciliations();
    const input = {
      reservationId: 'reservation-1', actorUserId: 'super-admin-1',
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'SUBMISSION_UNCERTAIN' as const,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      outcome: 'RELEASED' as const, billedUnits: 0,
      reason: 'Provider dashboard confirms no billable request exists',
    };

    const released = await service.reconcileReservation(input);
    expect(released.status).toBe('RELEASED');
    expect(released.settlements[0]).toMatchObject({
      kind: 'RECONCILED_RELEASE', actorUserId: 'super-admin-1', actualCostMinor: 0,
    });
    expect(db.reservation.job).toMatchObject({ actualCostCents: 0, billedUnits: 0 });
    await expect(service.reconcileReservation(input)).resolves.toMatchObject({ status: 'RELEASED' });
    await expect(service.reconcileReservation({ ...input, reason: 'Different operator evidence changes the decision' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', statusCode: 409 });
  });

  it('rejects stale evidence after a late provider identity changes the job', async () => {
    const db = database();
    const service = createAiCostReconciliationAdminService({ database: db });
    const listed = await service.listReconciliations();
    db.reservation.job.providerJobId = 'provider-task-late';
    db.reservation.job.updatedAt = new Date('2026-07-18T01:01:00.000Z');

    await expect(service.reconcileReservation({
      reservationId: 'reservation-1', actorUserId: 'super-admin-1',
      requestId: 'c451810d-fca9-484b-ae73-11142757011c',
      expectedStatus: 'SUBMISSION_UNCERTAIN', expectedEvidenceHash: listed.items[0].evidenceHash,
      outcome: 'SETTLED', actualCostMinor: 14, billedUnits: 1,
      reason: 'Provider invoice confirms the late task was billed once',
    })).rejects.toMatchObject({ code: 'RESERVATION_CHANGED', statusCode: 409 });
    expect(db.reservation.settlements).toHaveLength(0);
  });
});
