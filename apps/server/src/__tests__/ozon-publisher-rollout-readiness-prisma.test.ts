import { describe, expect, it, vi } from 'vitest';

import {
  OzonPublisherRolloutReadinessRepositoryError,
  createPrismaOzonPublisherRolloutReadinessRepository,
  type OzonPublisherRolloutReadinessPrismaTransaction,
} from '../services/ozon-publisher-rollout-readiness-prisma.js';

const AS_OF = new Date('2026-07-16T12:00:00.000Z');
const INPUT = {
  writerEntrypoint: 'COLLECT_PUBLISH_OZON' as const,
  originChannel: 'DIRECT' as const,
  rolloutRevision: 'rollout-1',
};
const POLICY_HASH = 'a'.repeat(64);
const CONFIG_HASH = 'b'.repeat(64);
const ELIGIBLE_KEY = 'c'.repeat(64);
const SCOPE_HASH = 'd'.repeat(64);

function gateRow(overrides: Record<string, unknown> = {}) {
  return {
    asOf: AS_OF,
    id: 'gate-1',
    state: 'READY',
    stateVersion: 1,
    writerEntrypoint: 'COLLECT_PUBLISH_OZON',
    originChannel: 'DIRECT',
    rolloutRevision: 'rollout-1',
    evidencePolicyHash: POLICY_HASH,
    authorizedControlConfigHash: CONFIG_HASH,
    guardContractVersion: 'ozon-publisher-rollout-guard/v1',
    denominatorEnforcedFrom: new Date('2026-07-02T12:00:00.000Z'),
    ...overrides,
  };
}

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    eligibleAttemptKey: ELIGIBLE_KEY,
    writerEntrypoint: 'COLLECT_PUBLISH_OZON',
    originChannel: 'DIRECT',
    parityEntrypoint: 'COLLECT_PUBLISH_OZON',
    rolloutRevision: 'rollout-1',
    scopeHash: SCOPE_HASH,
    attemptContractVersion: 'ozon-publisher-parity-eligible-attempt/v1',
    guardContractVersion: 'ozon-publisher-rollout-guard/v1',
    evidencePolicyHash: POLICY_HASH,
    eligibleAt: new Date('2026-07-16T11:00:00.000Z'),
    attemptExpiresAt: new Date('2026-09-14T11:00:00.000Z'),
    outcomeResult: null,
    outcomeObservationRecordKey: null,
    outcomeObservationReportHash: null,
    outcomeSubjectStateVersion: null,
    outcomeFullDifferenceSignature: null,
    outcomeFailureCode: null,
    observationId: null,
    observationEligibleAttemptKey: null,
    observationRecordKey: null,
    observationRecordContractVersion: null,
    observationReportContractVersion: null,
    observationReportHash: null,
    observationEntrypoint: null,
    observationRolloutRevision: null,
    observationScopeHash: null,
    observationStatus: null,
    observationClassification: null,
    observationSwitchEligible: null,
    observationPublisherContractVersion: null,
    observationPayloadCompilerVersion: null,
    observationDifferenceTotal: null,
    observationDifferenceReturned: null,
    observationDifferenceTruncated: null,
    observationDifferenceRows: null,
    observationDifferenceSubjectKey: null,
    observationFullDifferenceSignature: null,
    observationObservedAt: null,
    observationExpiresAt: null,
    subjectKey: null,
    subjectRecordContractVersion: null,
    subjectReportContractVersion: null,
    subjectEntrypoint: null,
    subjectRolloutRevision: null,
    subjectStateVersion: null,
    subjectApprovalState: null,
    subjectClassification: null,
    subjectDifferenceTotal: null,
    subjectFullDifferenceSignature: null,
    ...overrides,
  };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  const recordKey = 'e'.repeat(64);
  const reportHash = 'f'.repeat(64);
  return evidenceRow({
    outcomeResult: 'RECORDED',
    outcomeObservationRecordKey: recordKey,
    outcomeObservationReportHash: reportHash,
    observationId: 'observation-1',
    observationEligibleAttemptKey: ELIGIBLE_KEY,
    observationRecordKey: recordKey,
    observationRecordContractVersion: 'ozon-publisher-parity-observation/v1',
    observationReportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
    observationReportHash: reportHash,
    observationEntrypoint: 'COLLECT_PUBLISH_OZON',
    observationRolloutRevision: 'rollout-1',
    observationScopeHash: SCOPE_HASH,
    observationStatus: 'MATCH',
    observationClassification: 'MATCH',
    observationSwitchEligible: true,
    observationPublisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
    observationPayloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
    observationDifferenceTotal: 0,
    observationDifferenceReturned: 0,
    observationDifferenceTruncated: false,
    observationDifferenceRows: [],
    observationObservedAt: new Date('2026-07-16T11:01:00.000Z'),
    observationExpiresAt: new Date('2026-09-14T11:01:00.000Z'),
    ...overrides,
  });
}

class ScriptedTransaction implements OzonPublisherRolloutReadinessPrismaTransaction {
  readonly calls: Array<{ query: string; values: unknown[] }> = [];

  constructor(private readonly rows: { gate: unknown[]; evidence: unknown[] }) {}

  async $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> {
    this.calls.push({ query, values });
    if (query.includes('FROM "ozon_publisher_rollout_gates"')) return this.rows.gate as T;
    if (query.includes('FROM "ozon_publisher_rollout_recorder_attempts"')) {
      return this.rows.evidence as T;
    }
    throw new Error(`Unexpected query: ${query}`);
  }
}

function harness(input: { gate?: unknown[]; evidence?: unknown[] } = {}) {
  const tx = new ScriptedTransaction({
    gate: input.gate || [gateRow()],
    evidence: input.evidence || [],
  });
  const transactionOptions: unknown[] = [];
  const client = {
    async $transaction<T>(
      action: (value: OzonPublisherRolloutReadinessPrismaTransaction) => Promise<T>,
      options: unknown,
    ) {
      transactionOptions.push(options);
      return action(tx);
    },
  };
  const loadControlSnapshot = vi.fn(async () => ({
    evidencePolicyHash: POLICY_HASH,
    controlConfigHash: CONFIG_HASH,
  }));
  return {
    tx,
    transactionOptions,
    loadControlSnapshot,
    repository: createPrismaOzonPublisherRolloutReadinessRepository({
      client,
      loadControlSnapshot,
    }),
  };
}

describe('Prisma Ozon publisher rollout readiness repository', () => {
  it('loads clock, control, gate, and evidence from one SERIALIZABLE snapshot', async () => {
    const built = harness({ evidence: [evidenceRow()] });

    const result = await built.repository.loadLiveSnapshot(INPUT);

    expect(built.transactionOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    expect(built.loadControlSnapshot).toHaveBeenCalledWith(built.tx, INPUT);
    expect(result).toMatchObject({
      asOf: AS_OF,
      control: { evidencePolicyHash: POLICY_HASH, controlConfigHash: CONFIG_HASH },
      gate: {
        state: 'READY',
        stateVersion: 1,
        coverageEpoch: { enforcedFrom: '2026-07-02T12:00:00.000Z' },
      },
      evidenceRows: [{ attemptKey: ELIGIBLE_KEY, outcome: null }],
    });
    expect(result?.asOf).not.toBe(AS_OF);
    expect(built.tx.calls[0]?.query).toContain('transaction_timestamp()::TIMESTAMPTZ(3)');
    expect(built.tx.calls[1]?.values).toEqual([
      'gate-1',
      new Date('2026-07-02T12:00:00.000Z'),
      10_001,
    ]);
    expect(built.tx.calls[1]?.query).not.toContain('a."eligible_at" <=');
  });

  it('returns null without loading control or evidence when the exact gate is absent', async () => {
    const built = harness({ gate: [] });

    await expect(built.repository.loadLiveSnapshot(INPUT)).resolves.toBeNull();

    expect(built.loadControlSnapshot).not.toHaveBeenCalled();
    expect(built.tx.calls).toHaveLength(1);
  });

  it('maps complete MATCH observation provenance', async () => {
    const built = harness({ evidence: [matchRow()] });

    const result = await built.repository.loadLiveSnapshot(INPUT);

    expect(result?.evidenceRows[0]).toMatchObject({
      attemptKey: ELIGIBLE_KEY,
      outcome: 'RECORDED',
      observation: {
        eligibleAttemptKey: ELIGIBLE_KEY,
        status: 'MATCH',
        classification: 'MATCH',
        differenceClassifications: [],
        differenceSubject: null,
      },
    });
  });

  it('maps current approved intentional-difference evidence and its outcome snapshot', async () => {
    const subjectKey = '1'.repeat(64);
    const signature = '2'.repeat(64);
    const built = harness({ evidence: [matchRow({
      observationStatus: 'DIFFERENT',
      observationClassification: 'INTENTIONAL_STRICTER',
      observationSwitchEligible: false,
      observationDifferenceTotal: 1,
      observationDifferenceReturned: 1,
      observationDifferenceRows: [{ path: '$.items[0].weight', classification: 'INTENTIONAL_STRICTER' }],
      observationDifferenceSubjectKey: subjectKey,
      observationFullDifferenceSignature: signature,
      subjectKey,
      subjectRecordContractVersion: 'ozon-publisher-parity-difference-subject/v1',
      subjectReportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
      subjectEntrypoint: 'COLLECT_PUBLISH_OZON',
      subjectRolloutRevision: 'rollout-1',
      subjectStateVersion: 1,
      subjectApprovalState: 'APPROVED',
      subjectClassification: 'INTENTIONAL_STRICTER',
      subjectDifferenceTotal: 1,
      subjectFullDifferenceSignature: signature,
      outcomeSubjectStateVersion: 1,
      outcomeFullDifferenceSignature: signature,
    })] });

    const result = await built.repository.loadLiveSnapshot(INPUT);

    expect(result?.evidenceRows[0]?.observation).toMatchObject({
      status: 'DIFFERENT',
      differenceClassifications: ['INTENTIONAL_STRICTER'],
      differenceSubject: {
        subjectKey,
        approvalState: 'APPROVED',
        stateVersion: 1,
        fullDifferenceSignature: signature,
      },
    });
  });

  it('maps failed outcomes without manufacturing an observation', async () => {
    const built = harness({ evidence: [evidenceRow({
      outcomeResult: 'FAILED',
      outcomeFailureCode: 'RECORDER_UNAVAILABLE',
    })] });

    await expect(built.repository.loadLiveSnapshot(INPUT)).resolves.toMatchObject({
      evidenceRows: [{ outcome: 'FAILED', observation: null }],
    });
  });

  it('retains future attempts so the evaluator can fail closed', async () => {
    const future = new Date('2026-07-16T12:00:01.000Z');
    const built = harness({ evidence: [evidenceRow({ eligibleAt: future })] });

    const result = await built.repository.loadLiveSnapshot(INPUT);

    expect(result?.evidenceRows[0]?.eligibleAt).toBe(future.toISOString());
  });

  it('rejects snapshots over the domain input bound instead of truncating', async () => {
    const built = harness({ evidence: Array.from({ length: 10_001 }, () => evidenceRow()) });

    await expect(built.repository.loadLiveSnapshot(INPUT)).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_TOO_LARGE',
    });
  });

  it.each([
    ['malformed difference JSON', matchRow({ observationDifferenceRows: {} })],
    ['mismatched outcome report hash', matchRow({ outcomeObservationReportHash: '9'.repeat(64) })],
    ['missing current difference subject', matchRow({
      observationDifferenceSubjectKey: '8'.repeat(64),
    })],
  ])('fails closed on %s', async (_label, row) => {
    const built = harness({ evidence: [row] });

    await expect(built.repository.loadLiveSnapshot(INPUT)).rejects.toBeInstanceOf(
      OzonPublisherRolloutReadinessRepositoryError,
    );
  });

  it('retries serialization failures with a fresh transaction', async () => {
    const tx = new ScriptedTransaction({ gate: [gateRow()], evidence: [] });
    let attempts = 0;
    const client = {
      async $transaction<T>(
        action: (value: OzonPublisherRolloutReadinessPrismaTransaction) => Promise<T>,
        options: unknown,
      ) {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('could not serialize access'), { code: 'P2034' });
        }
        return action(tx);
      },
    };
    const repository = createPrismaOzonPublisherRolloutReadinessRepository({
      client,
      loadControlSnapshot: async () => ({
        evidencePolicyHash: POLICY_HASH,
        controlConfigHash: CONFIG_HASH,
      }),
    });

    await expect(repository.loadLiveSnapshot(INPUT)).resolves.toMatchObject({ evidenceRows: [] });
    expect(attempts).toBe(3);
  });

  it('does not retry an ordinary repository failure', async () => {
    let attempts = 0;
    const client = {
      async $transaction<T>() {
        attempts += 1;
        throw new Error('database unavailable');
        return undefined as T;
      },
    };
    const repository = createPrismaOzonPublisherRolloutReadinessRepository({
      client,
      loadControlSnapshot: async () => ({
        evidencePolicyHash: POLICY_HASH,
        controlConfigHash: CONFIG_HASH,
      }),
    });

    await expect(repository.loadLiveSnapshot(INPUT)).rejects.toThrow('database unavailable');
    expect(attempts).toBe(1);
  });
});
