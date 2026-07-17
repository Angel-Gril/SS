import { describe, expect, it } from 'vitest';
import {
  markAiCostSubmissionUncertain,
  markAiCostUnknown,
  reconcileAiCost,
  releaseAiCost,
  reserveAiCost,
  settleAiCost,
} from '../services/ai-cost-ledger.js';

function database() {
  const reservations = new Map<string, any>();
  const settlements = new Map<string, any>();
  let sequence = 0;
  const makeDb = (): any => {
    const db: any = {
      $transaction: async (callback: any) => callback(db),
      aiCostReservation: {
        findUnique: async ({ where }: any) => {
          const key = where.ai_cost_reservation_owner_idempotency;
          if (key) return [...reservations.values()].find((row) => row.ownerUserId === key.ownerUserId && row.idempotencyKey === key.idempotencyKey) || null;
          const id = where.ai_cost_reservation_id_owner;
          return id ? reservations.get(`${id.ownerUserId}:${id.id}`) || null : null;
        },
        create: async ({ data }: any) => {
          const row = {
            id: `reservation-${++sequence}`,
            providerRequestId: null,
            providerAcceptedAt: null,
            reconciliationRequiredAt: null,
            settledAt: null,
            releasedAt: null,
            ...data,
            settlements: [],
          };
          reservations.set(`${row.ownerUserId}:${row.id}`, row);
          return row;
        },
        updateMany: async ({ where, data }: any) => {
          const row = reservations.get(`${where.ownerUserId}:${where.id}`);
          const expectedStatuses = Array.isArray(where.status?.in) ? where.status.in : null;
          if (!row
            || (expectedStatuses && !expectedStatuses.includes(row.status))
            || (where.status && !expectedStatuses && row.status !== where.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      aiCostSettlement: {
        findUnique: async ({ where }: any) => {
          const key = where.ai_cost_settlement_reservation_idempotency;
          return settlements.get(`${key.reservationId}:${key.idempotencyKey}`) || null;
        },
        create: async ({ data }: any) => {
          const row = { id: `settlement-${++sequence}`, ...data };
          settlements.set(`${row.reservationId}:${row.idempotencyKey}`, row);
          const reservation = reservations.get(`${row.ownerUserId}:${row.reservationId}`);
          reservation?.settlements.push(row);
          return row;
        },
      },
    };
    return db;
  };
  return makeDb();
}

const input = {
  ownerUserId: 'owner-1', actorUserId: 'actor-1', jobId: 'job-1',
  idempotencyKey: 'cost-1', requestFingerprint: 'a'.repeat(64),
  provider: 'fake', model: 'fake-image-to-image-v1', operation: 'IMAGE_TO_IMAGE' as const,
  estimatedCostMinor: 10, maximumCostMinor: 20,
};

describe('AI media cost ledger', () => {
  it('reserves exactly once and replays the same request', async () => {
    const db = database();
    const first = await reserveAiCost(db, input);
    const replay = await reserveAiCost(db, input);
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.reservation.id).toBe(first.reservation.id);
  });

  it('rejects idempotency reuse with a changed fingerprint', async () => {
    const db = database();
    await reserveAiCost(db, input);
    await expect(reserveAiCost(db, { ...input, requestFingerprint: 'b'.repeat(64) }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await expect(reserveAiCost(db, { ...input, estimatedCostMinor: 11 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
  });

  it('settles and releases idempotently, while unknown results require reconciliation', async () => {
    const db = database();
    const providerAcceptedAt = new Date('2026-07-17T07:00:00.000Z');
    const reserved = await reserveAiCost(db, input);
    const settled = await settleAiCost(db, {
      reservationId: reserved.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'settle-1', requestFingerprint: input.requestFingerprint, actualCostMinor: 12, billedUnits: 1,
    });
    expect(settled.reservation.status).toBe('SETTLED');
    expect((await settleAiCost(db, {
      reservationId: reserved.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'settle-1', requestFingerprint: input.requestFingerprint, actualCostMinor: 12, billedUnits: 1,
    })).replayed).toBe(true);
    await expect(settleAiCost(db, {
      reservationId: reserved.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'settle-1', requestFingerprint: input.requestFingerprint, actualCostMinor: 13,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });

    const unknown = await reserveAiCost(db, { ...input, jobId: 'job-2', idempotencyKey: 'cost-2' });
    await expect(markAiCostUnknown(db, {
      reservationId: unknown.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'unknown-wrong', requestFingerprint: 'b'.repeat(64),
      providerRequestId: 'provider-task-1',
      providerAcceptedAt,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await markAiCostUnknown(db, {
      reservationId: unknown.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'unknown-1', requestFingerprint: input.requestFingerprint,
      providerRequestId: 'provider-task-1',
      providerAcceptedAt,
    });
    await expect(markAiCostUnknown(db, {
      reservationId: unknown.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'unknown-1', requestFingerprint: input.requestFingerprint,
      providerRequestId: 'provider-task-1',
      providerAcceptedAt: new Date('2026-07-17T07:00:01.000Z'),
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    const reconciled = await reconcileAiCost(db, {
      reservationId: unknown.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'reconcile-1', requestFingerprint: input.requestFingerprint,
      kind: 'RECONCILED_RELEASE', actualCostMinor: 0,
    });
    expect(reconciled.reservation.status).toBe('RELEASED');

    const releasable = await reserveAiCost(db, { ...input, jobId: 'job-3', idempotencyKey: 'cost-3' });
    expect((await releaseAiCost(db, {
      reservationId: releasable.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'release-1', requestFingerprint: input.requestFingerprint,
    })).reservation.status).toBe('RELEASED');

    const overrun = await reserveAiCost(db, { ...input, jobId: 'job-4', idempotencyKey: 'cost-4' });
    await expect(settleAiCost(db, {
      reservationId: overrun.reservation.id, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
      idempotencyKey: 'settle-overrun', requestFingerprint: input.requestFingerprint, actualCostMinor: 21,
    })).rejects.toMatchObject({ code: 'COST_OVERRUN_REQUIRES_RECONCILIATION' });
  });

  it('rejects unknown-cost transitions without real provider acceptance time', async () => {
    const db = database();
    const unknown = await reserveAiCost(db, input);

    await expect(markAiCostUnknown(db, {
      reservationId: unknown.reservation.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      idempotencyKey: 'unknown-missing-time',
      requestFingerprint: input.requestFingerprint,
      providerRequestId: 'provider-task-1',
    } as any)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(unknown.reservation.status).toBe('RESERVED');
    expect(unknown.reservation.settlements).toEqual([]);
  });

  it('quarantines uncertain submissions idempotently and preserves the first reconciliation time', async () => {
    const db = database();
    const reserved = await reserveAiCost(db, {
      ...input,
      jobId: 'job-submission-uncertain',
      idempotencyKey: 'cost-submission-uncertain',
    });
    const quarantineInput = {
      reservationId: reserved.reservation.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      idempotencyKey: 'submission-uncertain-1',
      requestFingerprint: input.requestFingerprint,
      billedUnits: 0,
    };

    const quarantined = await markAiCostSubmissionUncertain(db, quarantineInput);
    expect(quarantined.replayed).toBe(false);
    expect(quarantined.reservation).toMatchObject({
      status: 'SUBMISSION_UNCERTAIN',
      providerRequestId: null,
      providerAcceptedAt: null,
    });
    expect(quarantined.settlement).toMatchObject({
      kind: 'SUBMISSION_UNCERTAIN',
      actualCostMinor: null,
      billedUnits: 0,
    });
    const reconciliationRequiredAt = quarantined.reservation.reconciliationRequiredAt;
    expect(reconciliationRequiredAt).toBeInstanceOf(Date);

    const replay = await markAiCostSubmissionUncertain(db, quarantineInput);
    expect(replay.replayed).toBe(true);
    expect(replay.settlement.id).toBe(quarantined.settlement.id);

    const providerAcceptedAt = new Date('2026-07-17T08:00:00.000Z');
    const identified = await markAiCostUnknown(db, {
      reservationId: reserved.reservation.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      idempotencyKey: 'submission-identified-1',
      requestFingerprint: input.requestFingerprint,
      providerRequestId: 'provider-after-quarantine',
      providerAcceptedAt,
    });
    expect(identified.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: 'provider-after-quarantine',
      providerAcceptedAt,
      reconciliationRequiredAt,
    });

    const reconciled = await reconcileAiCost(db, {
      reservationId: reserved.reservation.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      idempotencyKey: 'submission-reconciled-1',
      requestFingerprint: input.requestFingerprint,
      kind: 'RECONCILED_RELEASE',
      actualCostMinor: 0,
      billedUnits: 0,
    });
    expect(reconciled.reservation.status).toBe('RELEASED');
  });
});
