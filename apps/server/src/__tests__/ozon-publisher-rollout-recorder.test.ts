import { describe, expect, it, vi } from 'vitest';

import { createPrismaOzonPublisherRolloutRecorder } from '../services/ozon-publisher-rollout-recorder.js';

const NOW = new Date('2026-07-16T00:00:00.000Z');
const gate = {
  id: 'gate-1', evidencePolicyHash: 'a'.repeat(64), guardContractVersion: 'ozon-publisher-rollout-guard/v1',
};
const directWriterCases = [
  ['LISTING_BATCH', 'LISTING_BATCH'],
  ['LISTING_IMPORT_BY_SKU', 'LISTING_IMPORT_BY_SKU'],
] as const;

function setup() {
  const attempt = {
    id: 'attempt-1', eligibleAttemptKey: 'b'.repeat(64),
  };
  const tx = {
    ozonPublisherRolloutGate: {
      findUnique: vi.fn(async () => gate),
    },
    ozonPublisherRolloutRecorderAttempt: {
      findUnique: vi.fn(async (): Promise<any> => null),
      create: vi.fn(async () => attempt),
    },
    ozonPublisherRolloutRecorderOutcome: {
      upsert: vi.fn(async () => undefined),
    },
    ozonPublisherParityDifferenceSubject: {
      findUnique: vi.fn(async (): Promise<any> => null),
    },
    $queryRawUnsafe: vi.fn(async () => [{ now: NOW }]),
  };
  const client = {
    $transaction: vi.fn(async (action: (value: typeof tx) => unknown) => action(tx)),
  };
  let idSequence = 0;
  return {
    tx,
    recorder: createPrismaOzonPublisherRolloutRecorder({
      client,
      createId: () => `generated-id-${++idSequence}`,
    }),
  };
}

describe('Ozon publisher rollout recorder', () => {
  it('creates a live attempt with immutable payload and scope hashes', async () => {
    const { recorder, tx } = setup();
    const result = await recorder.begin({
      ownerUserId: 'owner-1', shopId: 'shop-1', rolloutRevision: 'rev-1',
      entrypoint: 'COLLECT_PUBLISH_OZON', endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'offer-1' }] },
    });

    expect(result?.eligibleAttemptKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(tx.ozonPublisherRolloutRecorderAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eligibleAttemptKey: result?.eligibleAttemptKey, itemCount: 1,
        eligibleAt: NOW, createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 45 * 86_400_000),
        writerEntrypoint: 'COLLECT_PUBLISH_OZON', originChannel: 'DIRECT',
      }),
    });
  });

  it.each(directWriterCases)('binds %s observations to the exact direct writer gate', async (entrypoint, writer) => {
    const { recorder, tx } = setup();
    await recorder.begin({
      ownerUserId: 'owner-1', shopId: 'shop-1', rolloutRevision: 'rev-1',
      entrypoint, endpoint: entrypoint === 'LISTING_BATCH'
        ? '/v3/product/import'
        : '/v1/product/import-by-sku',
      payload: { items: [{ offer_id: 'offer-1' }] },
    });

    expect(tx.ozonPublisherRolloutGate.findUnique).toHaveBeenCalledWith({
      where: {
        writerEntrypoint_originChannel_rolloutRevision: {
          writerEntrypoint: writer,
          originChannel: 'DIRECT',
          rolloutRevision: 'rev-1',
        },
      },
      select: { id: true, evidencePolicyHash: true, guardContractVersion: true },
    });
    expect(tx.ozonPublisherRolloutRecorderAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        writerEntrypoint: writer,
        originChannel: 'DIRECT',
        parityEntrypoint: entrypoint,
      }),
    });
  });

  it('does not collapse repeated identical payloads into one observation attempt', async () => {
    const { recorder, tx } = setup();
    const input = {
      ownerUserId: 'owner-1', shopId: 'shop-1', rolloutRevision: 'rev-1',
      entrypoint: 'COLLECT_PUBLISH_OZON' as const, endpoint: '/v3/product/import' as const,
      payload: { items: [{ offer_id: 'offer-1' }] },
    };
    const first = await recorder.begin(input);
    const second = await recorder.begin(input);
    expect(first?.eligibleAttemptKey).not.toBe(second?.eligibleAttemptKey);
    const calls = tx.ozonPublisherRolloutRecorderAttempt.create.mock.calls as any[][];
    expect(calls[0]![0]!.data.operationKey).not.toBe(calls[1]![0]!.data.operationKey);
  });

  it('links a recorded observation to the attempt outcome', async () => {
    const { recorder, tx } = setup();
    tx.ozonPublisherRolloutRecorderAttempt.findUnique.mockResolvedValueOnce({ id: 'attempt-1' });
    await recorder.complete({
      eligibleAttemptKey: 'b'.repeat(64),
      observation: {
        id: 'observation-1', recordKey: 'c'.repeat(64), reportHash: 'd'.repeat(64),
        contractVersion: 'ozon-publisher-parity-observation/v1', scopeHash: 'e'.repeat(64),
        rolloutRevision: 'rev-1', entrypoint: 'COLLECT_PUBLISH_OZON',
        report: {} as never, differenceSubjectKey: null, approvalEligible: false,
        observedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 1000).toISOString(),
      },
    });
    expect(tx.ozonPublisherRolloutRecorderOutcome.upsert).toHaveBeenCalledWith({
      where: { attemptId: 'attempt-1' },
      update: {},
      create: expect.objectContaining({
        attemptId: 'attempt-1', observationId: 'observation-1',
        observationRecordKey: 'c'.repeat(64), observationReportHash: 'd'.repeat(64),
        completedAt: NOW, createdAt: NOW,
      }),
    });
  });

  it('records a FAILED outcome when observation persistence fails', async () => {
    const { recorder, tx } = setup();
    tx.ozonPublisherRolloutRecorderAttempt.findUnique.mockResolvedValueOnce({ id: 'attempt-1' });
    await recorder.fail({ eligibleAttemptKey: 'b'.repeat(64), failureCode: 'OBSERVATION_RECORD_FAILED' });
    expect(tx.ozonPublisherRolloutRecorderOutcome.upsert).toHaveBeenCalledWith({
      where: { attemptId: 'attempt-1' },
      update: {},
      create: expect.objectContaining({
        attemptId: 'attempt-1', result: 'FAILED', failureCode: 'OBSERVATION_RECORD_FAILED',
        completedAt: NOW, createdAt: NOW,
      }),
    });
  });
});
