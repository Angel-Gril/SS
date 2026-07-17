import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  markAiCostSubmissionUncertain,
  markAiCostUnknown,
  reconcileAiCost,
  releaseAiCost,
  reserveAiCost,
  settleAiCost,
} from '../services/ai-cost-ledger.js';

const databaseUrl = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1' && Boolean(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;
const client = enabled ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

describePostgres('AI cost ledger PostgreSQL state machine', () => {
  beforeAll(async () => {
    const schema = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') || '' : '';
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(schema)) throw new Error('AI cost test requires an isolated schema');
    await client!.$connect();
  });
  afterAll(async () => client!.$disconnect());

  it('recovers concurrent reservation replay and preserves immutable reconciliation evidence', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `cost_owner_${suffix}`;
    const jobId = `cost_job_${suffix}`;
    const fingerprint = 'a'.repeat(64);
    await client!.user.create({ data: {
      id: ownerUserId, phone: `cost_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.aiImageJob.create({ data: {
      id: jobId, ownerUserId, actorUserId: ownerUserId, status: 'QUEUED',
      operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-to-image-v1',
      prompt: 'cost integration', width: 1024, height: 1024, requestFingerprint: fingerprint,
    } });
    const input = {
      ownerUserId, actorUserId: ownerUserId, jobId, idempotencyKey: `reserve-${suffix}`,
      requestFingerprint: fingerprint, provider: 'fake', model: 'fake-image-to-image-v1',
      operation: 'IMAGE_TO_IMAGE' as const, estimatedCostMinor: 10, maximumCostMinor: 20,
    };
    const providerAcceptedAt = new Date('2026-07-17T07:30:00.000Z');

    const results = await Promise.all([
      reserveAiCost(client! as any, input),
      reserveAiCost(client! as any, input),
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    const reservation = results[0]!.reservation;
    await expect(client!.aiCostReservation.update({
      where: { id: reservation.id }, data: { providerAcceptedAt: new Date() },
    })).rejects.toThrow(/must be paired|only be bound/i);
    await expect(reserveAiCost(client! as any, { ...input, estimatedCostMinor: 11 }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await expect(markAiCostUnknown(client! as any, {
      reservationId: reservation.id, ownerUserId, actorUserId: ownerUserId,
      idempotencyKey: `unknown-wrong-${suffix}`, requestFingerprint: 'b'.repeat(64),
      providerRequestId: `provider-${suffix}`,
      providerAcceptedAt,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await markAiCostUnknown(client! as any, {
      reservationId: reservation.id, ownerUserId, actorUserId: ownerUserId,
      idempotencyKey: `unknown-${suffix}`, requestFingerprint: fingerprint,
      providerRequestId: `provider-${suffix}`,
      providerAcceptedAt,
    });
    await reconcileAiCost(client! as any, {
      reservationId: reservation.id, ownerUserId, actorUserId: ownerUserId,
      idempotencyKey: `reconcile-${suffix}`, requestFingerprint: fingerprint,
      kind: 'RECONCILED_RELEASE', actualCostMinor: 0,
    });

    const settlement = await client!.aiCostSettlement.findFirstOrThrow({
      where: { reservationId: reservation.id, kind: 'RECONCILED_RELEASE' },
    });
    await expect(client!.aiCostSettlement.update({
      where: { id: settlement.id }, data: { reason: 'tampered' },
    })).rejects.toThrow(/append-only/i);
    await expect(client!.aiCostReservation.update({
      where: { id: reservation.id }, data: { provider: 'changed-provider' },
    })).rejects.toThrow(/identity is immutable/i);
    await expect(client!.aiCostReservation.update({
      where: { id: reservation.id }, data: { providerRequestId: 'changed-provider-task' },
    })).rejects.toThrow(/provider request identity is immutable/i);
    await expect(client!.aiCostReservation.update({
      where: { id: reservation.id }, data: { providerAcceptedAt: new Date(Date.now() + 1000) },
    })).rejects.toThrow(/provider acceptance time is immutable/i);
    await expect(client!.aiImageJob.update({
      where: { id: jobId }, data: { model: 'changed-model' },
    })).rejects.toThrow(/costed AI job identity is immutable/i);
  });

  it('enforces submission quarantine shape and immutable lifecycle timestamps in PostgreSQL', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `cost_lifecycle_owner_${suffix}`;
    const fingerprint = 'c'.repeat(64);
    await client!.user.create({ data: {
      id: ownerUserId, phone: `cost_lifecycle_${suffix}`, passwordHash: 'integration-test',
    } });
    const createJob = async (id: string) => client!.aiImageJob.create({ data: {
      id,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'QUEUED',
      operation: 'IMAGE_TO_IMAGE',
      provider: 'fake',
      model: 'fake-image-to-image-v1',
      prompt: 'cost lifecycle integration',
      width: 1024,
      height: 1024,
      requestFingerprint: fingerprint,
    } });
    const reservationInput = (jobId: string) => ({
      ownerUserId,
      actorUserId: ownerUserId,
      jobId,
      idempotencyKey: `reserve-${jobId}`,
      requestFingerprint: fingerprint,
      provider: 'fake',
      model: 'fake-image-to-image-v1',
      operation: 'IMAGE_TO_IMAGE' as const,
      estimatedCostMinor: 10,
      maximumCostMinor: 20,
    });

    const uncertainJobId = `cost_uncertain_job_${suffix}`;
    await createJob(uncertainJobId);
    const uncertain = await reserveAiCost(client! as any, reservationInput(uncertainJobId));
    await markAiCostSubmissionUncertain(client! as any, {
      reservationId: uncertain.reservation.id,
      ownerUserId,
      actorUserId: ownerUserId,
      idempotencyKey: `submission-uncertain-${suffix}`,
      requestFingerprint: fingerprint,
    });
    const quarantined = await client!.aiCostReservation.findUniqueOrThrow({
      where: { id: uncertain.reservation.id }, include: { settlements: true },
    });
    expect(quarantined).toMatchObject({
      status: 'SUBMISSION_UNCERTAIN',
      providerRequestId: null,
      providerAcceptedAt: null,
      settledAt: null,
      releasedAt: null,
    });
    expect(quarantined.reconciliationRequiredAt).toBeInstanceOf(Date);
    expect(quarantined.settlements).toEqual([expect.objectContaining({
      kind: 'SUBMISSION_UNCERTAIN', actualCostMinor: null, billedUnits: 0,
    })]);
    const firstReconciliationAt = quarantined.reconciliationRequiredAt!;
    await expect(client!.aiCostReservation.update({
      where: { id: quarantined.id },
      data: { reconciliationRequiredAt: new Date(firstReconciliationAt.getTime() + 1000) },
    })).rejects.toThrow(/reconciliation time is immutable/i);

    const providerAcceptedAt = new Date('2026-07-17T08:30:00.000Z');
    await markAiCostUnknown(client! as any, {
      reservationId: quarantined.id,
      ownerUserId,
      actorUserId: ownerUserId,
      idempotencyKey: `provider-identified-${suffix}`,
      requestFingerprint: fingerprint,
      providerRequestId: `provider-after-quarantine-${suffix}`,
      providerAcceptedAt,
    });
    const identified = await client!.aiCostReservation.findUniqueOrThrow({ where: { id: quarantined.id } });
    expect(identified).toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      providerRequestId: `provider-after-quarantine-${suffix}`,
      providerAcceptedAt,
      reconciliationRequiredAt: firstReconciliationAt,
    });
    await reconcileAiCost(client! as any, {
      reservationId: quarantined.id,
      ownerUserId,
      actorUserId: ownerUserId,
      idempotencyKey: `release-quarantine-${suffix}`,
      requestFingerprint: fingerprint,
      kind: 'RECONCILED_RELEASE',
      actualCostMinor: 0,
    });
    const released = await client!.aiCostReservation.findUniqueOrThrow({ where: { id: quarantined.id } });
    expect(released.releasedAt).toBeInstanceOf(Date);
    await expect(client!.aiCostReservation.update({
      where: { id: released.id },
      data: { releasedAt: new Date(released.releasedAt!.getTime() + 1000) },
    })).rejects.toThrow(/release time is immutable/i);

    const invalidSettlementJobId = `cost_invalid_settlement_${suffix}`;
    await createJob(invalidSettlementJobId);
    const invalidSettlementReservation = await reserveAiCost(
      client! as any,
      reservationInput(invalidSettlementJobId),
    );
    await expect(client!.aiCostSettlement.create({ data: {
      reservationId: invalidSettlementReservation.reservation.id,
      ownerUserId,
      actorUserId: ownerUserId,
      kind: 'SUBMISSION_UNCERTAIN',
      idempotencyKey: `invalid-uncertain-cost-${suffix}`,
      requestFingerprint: fingerprint,
      actualCostMinor: 0,
      billedUnits: 0,
    } })).rejects.toThrow(/must not declare actual cost|check constraint/i);
    await expect(client!.aiCostReservation.update({
      where: { id: invalidSettlementReservation.reservation.id },
      data: { reconciliationRequiredAt: new Date() },
    })).rejects.toThrow(/reconciliation time may only be set|lifecycle_check/i);

    const invalidStartJobId = `cost_invalid_start_${suffix}`;
    await createJob(invalidStartJobId);
    await expect(client!.aiCostReservation.create({ data: {
      ownerUserId,
      actorUserId: ownerUserId,
      jobId: invalidStartJobId,
      idempotencyKey: `invalid-start-${suffix}`,
      requestFingerprint: fingerprint,
      provider: 'fake',
      model: 'fake-image-to-image-v1',
      operation: 'IMAGE_TO_IMAGE',
      estimatedCostMinor: 10,
      maximumCostMinor: 20,
      status: 'SETTLED',
      settledAt: new Date(),
    } })).rejects.toThrow(/must start reserved/i);
  });

  it('commits exactly one terminal outcome when charge and release race', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ownerUserId = `cost_terminal_owner_${suffix}`;
    const jobId = `cost_terminal_job_${suffix}`;
    const fingerprint = 'd'.repeat(64);
    await client!.user.create({ data: {
      id: ownerUserId, phone: `cost_terminal_${suffix}`, passwordHash: 'integration-test',
    } });
    await client!.aiImageJob.create({ data: {
      id: jobId, ownerUserId, actorUserId: ownerUserId, status: 'RUNNING',
      operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-to-image-v1',
      prompt: 'terminal race integration', width: 1024, height: 1024,
      requestFingerprint: fingerprint,
    } });
    const reserved = await reserveAiCost(client! as any, {
      ownerUserId, actorUserId: ownerUserId, jobId,
      idempotencyKey: `reserve-terminal-${suffix}`, requestFingerprint: fingerprint,
      provider: 'fake', model: 'fake-image-to-image-v1', operation: 'IMAGE_TO_IMAGE',
      estimatedCostMinor: 10, maximumCostMinor: 20,
    });
    const common = {
      reservationId: reserved.reservation.id,
      ownerUserId,
      actorUserId: ownerUserId,
      requestFingerprint: fingerprint,
    };

    const outcomes = await Promise.allSettled([
      settleAiCost(client! as any, {
        ...common,
        idempotencyKey: `charge-terminal-${suffix}`,
        actualCostMinor: 12,
        billedUnits: 1,
      }),
      releaseAiCost(client! as any, {
        ...common,
        idempotencyKey: `release-terminal-${suffix}`,
        billedUnits: 0,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const persisted = await client!.aiCostReservation.findUniqueOrThrow({
      where: { id: reserved.reservation.id },
      include: { settlements: true },
    });
    const terminalSettlements = persisted.settlements.filter((settlement) => (
      settlement.kind === 'CHARGE' || settlement.kind === 'RELEASE'
    ));
    expect(terminalSettlements).toHaveLength(1);
    expect([
      ['SETTLED', 'CHARGE'],
      ['RELEASED', 'RELEASE'],
    ]).toContainEqual([persisted.status, terminalSettlements[0]!.kind]);
  });
});
