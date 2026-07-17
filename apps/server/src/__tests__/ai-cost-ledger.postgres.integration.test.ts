import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  markAiCostUnknown,
  reconcileAiCost,
  reserveAiCost,
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
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
    await markAiCostUnknown(client! as any, {
      reservationId: reservation.id, ownerUserId, actorUserId: ownerUserId,
      idempotencyKey: `unknown-${suffix}`, requestFingerprint: fingerprint,
      providerRequestId: `provider-${suffix}`,
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
});
