import { describe, expect, it } from 'vitest';
import { createAiProviderReconciliationAdminService } from '../services/ai-provider-reconciliation-admin.js';

const NOW = new Date('2026-07-21T08:00:00.000Z');

function database(input: {
  providerJobId?: string | null;
  workflowId?: string | null;
  workflowCurrentAttempt?: number;
  providerAcceptedAt?: Date | null;
  costProviderJobId?: string | null;
} = {}) {
  const workflowId = Object.prototype.hasOwnProperty.call(input, 'workflowId')
    ? input.workflowId ?? null
    : 'workflow-1';
  const job: any = {
    id: 'job-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', workflowId,
    workflowAttempt: 1, operation: 'IMAGE_TRANSLATE', provider: 'dashscope-qwen-mt-image',
    model: 'qwen-mt-image', status: 'FAILED', errorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
    providerJobId: input.providerJobId ?? null,
    providerDispatchedAt: new Date('2026-07-21T07:55:00.000Z'),
    providerReconciliationStatus: 'MANUAL_REVIEW', providerReconciliationRevision: 1,
    providerReconciliationAttemptCount: 0, providerReconciliationNextAt: null,
    providerReconciliationDeadlineAt: null, providerReconciliationLastProviderStatus: null,
    providerReconciliationLastErrorCode: 'PROVIDER_SUBMISSION_UNCERTAIN',
    providerReconciliationLastErrorMessage: 'submission timed out', providerReconciledAt: null,
    updatedAt: new Date('2026-07-21T07:56:00.000Z'),
    workflow: workflowId ? {
      id: workflowId, ownerUserId: 'owner-1', currentAttempt: input.workflowCurrentAttempt ?? 1,
      contextType: 'collect', contextId: 'goods-1', contextSkuKey: null, contextSlotKey: null,
    } : null,
  };
  const reservation: any = {
    id: 'cost-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', workflowId,
    jobId: 'job-1', requestFingerprint: 'a'.repeat(64), status: 'SUBMISSION_UNCERTAIN',
    providerRequestId: input.costProviderJobId ?? null,
    providerAcceptedAt: input.providerAcceptedAt ?? null,
    updatedAt: new Date('2026-07-21T07:56:00.000Z'),
    settlements: [],
  };
  job.costReservation = reservation;
  const providerEvents = new Map<string, any>();
  const workflowEvents = new Map<string, any>();
  const settlements = new Map<string, any>();
  const db: any = {
    job,
    reservation,
    providerEvents,
    workflowEvents,
    $transaction: async (callback: any) => callback(db),
    aiImageJob: {
      findMany: async () => [job],
      findUnique: async ({ where }: any) => where.id === job.id ? job : null,
      updateMany: async ({ where, data }: any) => {
        if (where.id !== job.id || where.ownerUserId !== job.ownerUserId) return { count: 0 };
        if (where.providerReconciliationStatus && where.providerReconciliationStatus !== job.providerReconciliationStatus) return { count: 0 };
        if (where.providerReconciliationRevision != null
          && where.providerReconciliationRevision !== job.providerReconciliationRevision) return { count: 0 };
        if (Object.prototype.hasOwnProperty.call(where, 'providerJobId')
          && where.providerJobId !== job.providerJobId) return { count: 0 };
        Object.assign(job, data, { updatedAt: new Date(job.updatedAt.getTime() + 1_000) });
        return { count: 1 };
      },
    },
    aiProviderReconciliationEvent: {
      findUnique: async ({ where }: any) => providerEvents.get(where.eventKey) || null,
      create: async ({ data }: any) => {
        const event = { id: `provider-event-${providerEvents.size + 1}`, createdAt: NOW, ...data };
        providerEvents.set(event.eventKey, event);
        return event;
      },
    },
    aiMediaWorkflowEvent: {
      create: async ({ data }: any) => {
        const event = { id: `workflow-event-${workflowEvents.size + 1}`, createdAt: NOW, ...data };
        workflowEvents.set(event.eventKey, event);
        return event;
      },
    },
    aiCostReservation: {
      findUnique: async ({ where }: any) => {
        if (where.id && where.id !== reservation.id) return null;
        const owned = where.ai_cost_reservation_id_owner;
        if (owned && (owned.id !== reservation.id || owned.ownerUserId !== reservation.ownerUserId)) return null;
        return reservation;
      },
      updateMany: async ({ where, data }: any) => {
        const statuses = where.status?.in || [where.status];
        if (where.id !== reservation.id || where.ownerUserId !== reservation.ownerUserId
          || !statuses.includes(reservation.status)) return { count: 0 };
        Object.assign(reservation, data, { updatedAt: new Date(reservation.updatedAt.getTime() + 1_000) });
        return { count: 1 };
      },
    },
    aiCostSettlement: {
      findUnique: async ({ where }: any) => {
        const key = where.ai_cost_settlement_reservation_idempotency;
        return settlements.get(`${key.reservationId}:${key.idempotencyKey}`) || null;
      },
      create: async ({ data }: any) => {
        const settlement = { id: `settlement-${settlements.size + 1}`, createdAt: NOW, ...data };
        settlements.set(`${settlement.reservationId}:${settlement.idempotencyKey}`, settlement);
        reservation.settlements.unshift(settlement);
        return settlement;
      },
    },
  };
  return db;
}

describe('AI Provider reconciliation admin service', () => {
  it('keeps manual-review work independently pageable behind a stable scoped cursor', async () => {
    const db = database();
    const jobs = [
      { ...db.job, id: 'active-1', providerReconciliationStatus: 'PENDING' },
      { ...db.job, id: 'manual-1' },
      { ...db.job, id: 'active-2', providerReconciliationStatus: 'RUNNING' },
      { ...db.job, id: 'manual-2' },
      { ...db.job, id: 'manual-3' },
    ];
    db.aiImageJob.findMany = async ({ where, take }: any) => jobs
      .filter((job) => {
        const status = where.providerReconciliationStatus;
        const statusMatches = typeof status === 'string'
          ? job.providerReconciliationStatus === status
          : status.in.includes(job.providerReconciliationStatus);
        return statusMatches && (!where.id?.gt || job.id > where.id.gt);
      })
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, take);
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });

    const first = await service.listReconciliations({ status: 'MANUAL_REVIEW', limit: 2 });
    const second = await service.listReconciliations({
      status: 'MANUAL_REVIEW', limit: 2, cursor: first.nextCursor || undefined,
    });

    expect(first).toMatchObject({
      status: 'MANUAL_REVIEW', limit: 2,
      items: [{ id: 'manual-1' }, { id: 'manual-2' }],
      nextCursor: expect.any(String),
    });
    expect(second).toMatchObject({
      status: 'MANUAL_REVIEW', limit: 2,
      items: [{ id: 'manual-3' }],
      nextCursor: null,
    });
    await expect(service.listReconciliations({
      status: 'PENDING', limit: 2, cursor: first.nextCursor || undefined,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });
  });

  it('lists stable bounded evidence without Prompt, request fingerprint or lease data', async () => {
    const db = database();
    db.job.prompt = 'private prompt';
    db.job.requestFingerprint = 'b'.repeat(64);
    db.job.providerReconciliationLeaseTokenHash = 'c'.repeat(64);
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });

    const first = await service.listReconciliations({ limit: 25 });
    const second = await service.listReconciliations({ limit: 25 });

    expect(first.items[0]).toMatchObject({
      id: 'job-1', status: 'MANUAL_REVIEW', revision: 1,
      providerAcceptedAt: null,
      allowedActions: ['RESUME', 'NOT_SUBMITTED'],
      evidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(second.items[0].evidenceHash).toBe(first.items[0].evidenceHash);
    expect(JSON.stringify(first)).not.toContain('private prompt');
    expect(JSON.stringify(first)).not.toContain('b'.repeat(64));
    expect(JSON.stringify(first)).not.toContain('c'.repeat(64));
  });

  it('resolves and audits a standalone manual decision without a workflow event', async () => {
    const db = database({ workflowId: null });
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });
    const listed = await service.listReconciliations();

    expect(listed.items[0]).toMatchObject({
      workflowId: null,
      allowedActions: ['RESUME', 'NOT_SUBMITTED'],
    });
    const resolved = await service.resolveReconciliation({
      jobId: 'job-1', actorUserId: 'super-admin-1',
      requestId: '9d08d37f-eac6-40da-9588-e37032e02075',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      action: 'NOT_SUBMITTED',
      reason: 'Provider dashboard confirms no standalone task was created',
    });

    expect(resolved).toMatchObject({ status: 'NOT_SUBMITTED', revision: 2 });
    expect(db.providerEvents.size).toBe(1);
    expect(db.workflowEvents.size).toBe(0);
    await expect(service.resolveReconciliation({
      jobId: 'job-1', actorUserId: 'super-admin-1',
      requestId: '9d08d37f-eac6-40da-9588-e37032e02075',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      action: 'NOT_SUBMITTED',
      reason: 'Provider dashboard confirms no standalone task was created',
    })).resolves.toMatchObject({ status: 'NOT_SUBMITTED' });
  });

  it('derives allowed actions and acceptance evidence from server authority', async () => {
    const acceptedAt = new Date('2026-07-21T07:55:30.000Z');
    const current = database({ providerJobId: 'provider-task-1', providerAcceptedAt: acceptedAt });
    const stale = database({ providerJobId: 'provider-task-1', workflowCurrentAttempt: 2 });
    const currentService = createAiProviderReconciliationAdminService({ database: current });
    const staleService = createAiProviderReconciliationAdminService({ database: stale });

    await expect(currentService.listReconciliations()).resolves.toMatchObject({ items: [{
      providerAcceptedAt: acceptedAt.toISOString(),
      allowedActions: ['RESUME', 'NO_OUTPUT'],
    }] });
    await expect(staleService.listReconciliations()).resolves.toMatchObject({ items: [{
      allowedActions: ['NO_OUTPUT'],
    }] });
  });

  it('cannot deny or replace a task identity already frozen in the cost ledger', async () => {
    const acceptedAt = new Date('2026-07-21T07:55:30.000Z');
    const db = database({
      providerJobId: null,
      costProviderJobId: 'provider-task-from-cost',
      providerAcceptedAt: acceptedAt,
    });
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });
    const listed = await service.listReconciliations();
    expect(listed.items[0]).toMatchObject({
      providerJobId: null,
      costProviderJobId: 'provider-task-from-cost',
      providerAcceptedAt: acceptedAt.toISOString(),
      allowedActions: ['RESUME'],
    });
    const base = {
      jobId: 'job-1', actorUserId: 'super-admin-1',
      expectedStatus: 'MANUAL_REVIEW' as const, expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      reason: 'Provider dashboard confirms the accepted task identity',
    };

    await expect(service.resolveReconciliation({
      ...base,
      requestId: '7c044b36-d0b0-4ef4-b708-957d2ea1f1a3',
      action: 'NOT_SUBMITTED',
    })).rejects.toMatchObject({ code: 'RECONCILIATION_CHANGED', statusCode: 409 });
    await expect(service.resolveReconciliation({
      ...base,
      requestId: 'd29419cf-1055-49c6-9345-9b42f0a280d5',
      action: 'RESUME',
      providerJobId: 'another-provider-task',
      providerAcceptedAt: acceptedAt,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', statusCode: 400 });
  });

  it('proves an ambiguous request was not submitted and releases cost exactly once', async () => {
    const db = database();
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });
    const listed = await service.listReconciliations();
    const decision = {
      jobId: 'job-1', actorUserId: 'super-admin-1',
      requestId: 'b7a363c2-6898-476f-873c-ec6c60bb59d8',
      expectedStatus: 'MANUAL_REVIEW' as const, expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      action: 'NOT_SUBMITTED' as const,
      reason: 'Provider dashboard confirms no task was created',
    };

    const resolved = await service.resolveReconciliation(decision);

    expect(resolved).toMatchObject({ status: 'NOT_SUBMITTED', revision: 2 });
    expect(db.reservation).toMatchObject({ status: 'RELEASED' });
    expect(db.reservation.settlements).toEqual([expect.objectContaining({
      kind: 'RECONCILED_RELEASE', actorUserId: 'super-admin-1', actualCostMinor: 0,
    })]);
    await expect(service.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'NOT_SUBMITTED' });
    await expect(service.resolveReconciliation({ ...decision, reason: 'A different decision payload is unsafe' }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT', statusCode: 409 });
  });

  it('binds an operator-proven task ID and queues lookup without submitting it', async () => {
    const db = database();
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });
    const listed = await service.listReconciliations();

    const resumed = await service.resolveReconciliation({
      jobId: 'job-1', actorUserId: 'super-admin-1',
      requestId: 'c451810d-fca9-484b-ae73-11142757011c',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      action: 'RESUME', providerJobId: 'provider-task-late',
      providerAcceptedAt: new Date('2026-07-21T07:55:30.000Z'),
      reason: 'Provider dashboard exposes the accepted task identity',
    });

    expect(resumed).toMatchObject({
      status: 'PENDING', revision: 2, providerJobId: 'provider-task-late',
      nextAt: NOW.toISOString(),
    });
    expect(db.reservation).toMatchObject({
      status: 'RECONCILIATION_REQUIRED', providerRequestId: 'provider-task-late',
    });
  });

  it('rejects stale evidence after another transition changes the row', async () => {
    const db = database({ providerJobId: 'provider-task-1' });
    const service = createAiProviderReconciliationAdminService({ database: db, now: () => NOW });
    const listed = await service.listReconciliations();
    db.job.providerReconciliationRevision = 2;
    db.job.updatedAt = new Date('2026-07-21T08:01:00.000Z');

    await expect(service.resolveReconciliation({
      jobId: 'job-1', actorUserId: 'super-admin-1',
      requestId: '54c149a1-03b0-4ea1-855c-4be96f327490',
      expectedStatus: 'MANUAL_REVIEW', expectedRevision: 1,
      expectedEvidenceHash: listed.items[0].evidenceHash,
      action: 'NO_OUTPUT', reason: 'Provider dashboard confirms the task has no recoverable output',
    })).rejects.toMatchObject({ code: 'RECONCILIATION_CHANGED', statusCode: 409 });
  });
});
