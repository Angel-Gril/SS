import { describe, expect, it } from 'vitest';

import {
  OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
  evaluateOzonPublisherRolloutReadiness,
  type OzonPublisherRolloutCoverageEpoch,
  type OzonPublisherRolloutEvidenceRow,
} from '../services/ozon-publisher-rollout-readiness.js';

const AS_OF = new Date('2026-07-16T12:00:00.000Z');
const POLICY_HASH = 'a'.repeat(64);
const CONFIG_HASH = 'b'.repeat(64);

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function evidenceRows(input: {
  count?: number;
  distinctScopes?: number;
  activeDays?: number;
  latestAgeMs?: number;
  retentionMs?: number;
} = {}): OzonPublisherRolloutEvidenceRow[] {
  const count = input.count ?? 100;
  const distinctScopes = input.distinctScopes ?? 25;
  const activeDays = input.activeDays ?? 7;
  const latestAgeMs = input.latestAgeMs ?? 60 * 60 * 1000;
  const retentionMs = input.retentionMs ?? 31 * 24 * 60 * 60 * 1000;
  return Array.from({ length: count }, (_, index) => {
    const day = index % activeDays;
    const eligibleAt = AS_OF.getTime()
      - latestAgeMs
      - day * 24 * 60 * 60 * 1000
      - Math.floor(index / activeDays) * 1000;
    const attemptKey = index.toString(16).padStart(64, '0');
    const scopeHash = (index % distinctScopes + 1000).toString(16).padStart(64, '0');
    return {
      attemptKey,
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      parityEntrypoint: 'COLLECT_PUBLISH_OZON',
      rolloutRevision: 'rollout-1',
      scopeHash,
      attemptContractVersion: 'ozon-publisher-parity-eligible-attempt/v1',
      guardContractVersion: 'ozon-publisher-rollout-guard/v1',
      evidencePolicyHash: POLICY_HASH,
      eligibleAt: iso(eligibleAt),
      expiresAt: iso(AS_OF.getTime() + retentionMs),
      outcome: 'RECORDED',
      observation: {
        id: `observation-${index}`,
        eligibleAttemptKey: attemptKey,
        recordKey: (index + 2000).toString(16).padStart(64, '0'),
        recordContractVersion: 'ozon-publisher-parity-observation/v1',
        reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
        reportHash: (index + 3000).toString(16).padStart(64, '0'),
        entrypoint: 'COLLECT_PUBLISH_OZON',
        rolloutRevision: 'rollout-1',
        scopeHash,
        status: 'MATCH',
        classification: 'MATCH',
        switchEligible: true,
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
        differenceTotal: 0,
        differenceReturned: 0,
        differenceTruncated: false,
        differenceClassifications: [],
        differenceSubjectKey: null,
        fullDifferenceSignature: null,
        differenceSubject: null,
        observedAt: iso(eligibleAt + 1000),
        expiresAt: iso(AS_OF.getTime() + retentionMs),
      },
    };
  });
}

function evaluate(rows: OzonPublisherRolloutEvidenceRow[], overrides: {
  coverageEpoch?: OzonPublisherRolloutCoverageEpoch | null;
  evidencePolicyHash?: string;
  authorizedEvidencePolicyHash?: string;
  controlConfigHash?: string;
  authorizedControlConfigHash?: string;
  asOf?: Date;
} = {}) {
  const asOf = overrides.asOf ?? AS_OF;
  const evidencePolicyHash = overrides.evidencePolicyHash ?? POLICY_HASH;
  const controlConfigHash = overrides.controlConfigHash ?? CONFIG_HASH;
  return evaluateOzonPublisherRolloutReadiness({
    writerEntrypoint: 'COLLECT_PUBLISH_OZON',
    originChannel: 'DIRECT',
    rolloutRevision: 'rollout-1',
    evidencePolicyHash,
    authorizedEvidencePolicyHash: overrides.authorizedEvidencePolicyHash ?? evidencePolicyHash,
    controlConfigHash,
    authorizedControlConfigHash: overrides.authorizedControlConfigHash ?? controlConfigHash,
    coverageEpoch: overrides.coverageEpoch === undefined ? {
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      rolloutRevision: 'rollout-1',
      evidencePolicyHash,
      guardContractVersion: 'ozon-publisher-rollout-guard/v1',
      enforcedFrom: iso(asOf.getTime() - 14 * 24 * 60 * 60 * 1000),
    } : overrides.coverageEpoch,
    asOf,
    evidenceRows: rows,
  });
}

describe('Ozon publisher rollout readiness', () => {
  it('requires the fixed conservative criteria contract', () => {
    expect(OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA).toEqual({
      contractVersion: 'ozon-publisher-rollout-readiness/v1',
      windowDays: 14,
      minimumEligibleAttempts: 100,
      minimumLinkedObservations: 100,
      minimumDistinctScopes: 25,
      minimumActiveUtcDays: 7,
      maximumLatestAgeHours: 24,
      rollbackEvidenceDays: 30,
    });
  });

  it('returns READY only for complete exact evidence and stable hashes', () => {
    const rows = evidenceRows();
    const first = evaluate(rows);
    const second = evaluate([...rows].reverse());

    expect(first).toMatchObject({
      ready: true,
      blockers: [],
      metrics: {
        eligibleAttemptCount: 100,
        linkedObservationCount: 100,
        missingObservationCount: 0,
        failedAttemptCount: 0,
        invalidEvidenceCount: 0,
        distinctScopeCount: 25,
        activeUtcDayCount: 7,
      },
    });
    expect(first.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.evaluationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.evidenceHash).toBe(first.evidenceHash);
    expect(second.evaluationHash).toBe(first.evaluationHash);
  });

  it.each([
    ['attempt and observation floor', evidenceRows({ count: 99 }), ['ELIGIBLE_ATTEMPT_FLOOR', 'LINKED_OBSERVATION_FLOOR']],
    ['distinct scope floor', evidenceRows({ distinctScopes: 24 }), ['DISTINCT_SCOPE_FLOOR']],
    ['active UTC day floor', evidenceRows({ activeDays: 6 }), ['ACTIVE_UTC_DAY_FLOOR']],
  ] as const)('blocks the %s boundary', (_label, rows, blockerCodes) => {
    const result = evaluate(rows as OzonPublisherRolloutEvidenceRow[]);

    expect(result.ready).toBe(false);
    for (const blocker of blockerCodes) expect(result.blockers).toContain(blocker);
  });

  it('accepts exactly 24-hour freshness and blocks one millisecond later', () => {
    const exact = evaluate(evidenceRows({ latestAgeMs: 24 * 60 * 60 * 1000 }));
    const stale = evaluate(evidenceRows({ latestAgeMs: 24 * 60 * 60 * 1000 + 1 }));

    expect(exact.blockers).not.toContain('LATEST_OBSERVATION_STALE');
    expect(stale.blockers).toContain('LATEST_OBSERVATION_STALE');
  });

  it('accepts exactly 30-day future retention and blocks one millisecond less', () => {
    const exact = evaluate(evidenceRows({ retentionMs: 30 * 24 * 60 * 60 * 1000 }));
    const short = evaluate(evidenceRows({ retentionMs: 30 * 24 * 60 * 60 * 1000 - 1 }));

    expect(exact.blockers).not.toContain('ROLLBACK_EVIDENCE_RETENTION_SHORT');
    expect(short.blockers).toContain('ROLLBACK_EVIDENCE_RETENTION_SHORT');
  });

  it('requires a denominator enforcement epoch covering the full window', () => {
    const missing = evaluate(evidenceRows(), { coverageEpoch: null });
    const late = evaluate(evidenceRows(), {
      coverageEpoch: {
        writerEntrypoint: 'COLLECT_PUBLISH_OZON',
        originChannel: 'DIRECT',
        rolloutRevision: 'rollout-1',
        evidencePolicyHash: POLICY_HASH,
        guardContractVersion: 'ozon-publisher-rollout-guard/v1',
        enforcedFrom: iso(AS_OF.getTime() - 14 * 24 * 60 * 60 * 1000 + 1),
      },
    });

    expect(missing.blockers).toContain('ATTEMPT_DENOMINATOR_UNAVAILABLE');
    expect(late.blockers).toContain('ATTEMPT_DENOMINATOR_WINDOW_INCOMPLETE');
  });

  it('binds the denominator epoch to the exact gate, policy, and guard contract', () => {
    const rows = evidenceRows();
    const mismatched = evaluate(rows, {
      coverageEpoch: {
        writerEntrypoint: 'COLLECT_PUBLISH_OZON',
        originChannel: 'DIRECT',
        rolloutRevision: 'other-rollout',
        evidencePolicyHash: '9'.repeat(64),
        guardContractVersion: 'old-guard/v0',
        enforcedFrom: iso(AS_OF.getTime() - 14 * 24 * 60 * 60 * 1000),
      },
    });

    expect(mismatched.ready).toBe(false);
    expect(mismatched.blockers).toContain('ATTEMPT_DENOMINATOR_IDENTITY_MISMATCH');
  });

  it('blocks control configuration drift until an explicit CAS transition authorizes it', () => {
    const result = evaluate(evidenceRows(), {
      controlConfigHash: '7'.repeat(64),
      authorizedControlConfigHash: CONFIG_HASH,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('CONTROL_CONFIG_DRIFT');
  });

  it('blocks a policy change until a new gate transition authorizes it', () => {
    const result = evaluate(evidenceRows(), {
      evidencePolicyHash: '4'.repeat(64),
      authorizedEvidencePolicyHash: POLICY_HASH,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('EVIDENCE_POLICY_DRIFT');
  });

  it('blocks future evidence instead of silently dropping it from the denominator', () => {
    const rows = evidenceRows();
    rows.push({
      ...rows[0]!,
      attemptKey: '8'.repeat(64),
      eligibleAt: iso(AS_OF.getTime() + 1),
      outcome: 'FAILED',
      observation: null,
    });
    const result = evaluate(rows);

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('FUTURE_EVIDENCE_PRESENT');
  });

  it('includes the exact future evidence identity in the audit hash', () => {
    const firstRows = evidenceRows();
    firstRows.push({
      ...firstRows[0]!,
      attemptKey: '6'.repeat(64),
      eligibleAt: iso(AS_OF.getTime() + 1),
      outcome: 'FAILED',
      observation: null,
    });
    const secondRows = firstRows.map((row) => ({ ...row }));
    secondRows[secondRows.length - 1] = {
      ...secondRows[secondRows.length - 1]!,
      attemptKey: '7'.repeat(64),
    };

    expect(evaluate(firstRows).evidenceHash).not.toBe(evaluate(secondRows).evidenceHash);
  });

  it('requires the observation to link back to the exact eligible attempt', () => {
    const rows = evidenceRows();
    rows[0] = {
      ...rows[0]!,
      observation: {
        ...rows[0]!.observation!,
        eligibleAttemptKey: '5'.repeat(64),
      },
    };

    const result = evaluate(rows);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('CONTRACT_DRIFT');
  });

  it('requires a live recalculation before every write even while time bounds remain valid', () => {
    const rows = evidenceRows();
    rows[0] = {
      ...rows[0]!,
      eligibleAt: iso(AS_OF.getTime() - 14 * 24 * 60 * 60 * 1000 + 1000),
      observation: {
        ...rows[0]!.observation!,
        observedAt: iso(AS_OF.getTime() - 14 * 24 * 60 * 60 * 1000 + 2000),
      },
    };
    const result = evaluate(rows);

    expect(result.ready).toBe(true);
    expect(result.validUntil).toBe(AS_OF.toISOString());
  });

  it('rejects an unbounded evidence set before sorting or hashing it', () => {
    const row = evidenceRows({ count: 1 })[0]!;
    const oversized = Array.from({ length: 10_001 }, () => row);

    expect(() => evaluate(oversized)).toThrow(/bounded evaluation input/u);
  });

  it('blocks a failed recorder attempt and an attempt without an observation', () => {
    const rows = evidenceRows({ count: 101 });
    rows[0] = { ...rows[0]!, outcome: 'FAILED', observation: null };
    rows[1] = { ...rows[1]!, outcome: null, observation: null };
    const result = evaluate(rows);

    expect(result).toMatchObject({
      ready: false,
      metrics: {
        eligibleAttemptCount: 101,
        linkedObservationCount: 99,
        missingObservationCount: 2,
        failedAttemptCount: 1,
      },
    });
    expect(result.blockers).toEqual(expect.arrayContaining([
      'RECORDER_COVERAGE_INCOMPLETE',
      'RECORDER_FAILURE_PRESENT',
      'LINKED_OBSERVATION_FLOOR',
    ]));
  });

  it('allows a complete currently approved intentional difference', () => {
    const rows = evidenceRows();
    rows[0] = {
      ...rows[0]!,
      observation: {
        ...rows[0]!.observation!,
        status: 'DIFFERENT',
        classification: 'INTENTIONAL_STRICTER',
        switchEligible: false,
        differenceTotal: 1,
        differenceReturned: 1,
        differenceClassifications: ['INTENTIONAL_STRICTER'],
        differenceSubjectKey: 'c'.repeat(64),
        fullDifferenceSignature: 'd'.repeat(64),
        differenceSubject: {
          subjectKey: 'c'.repeat(64),
          recordContractVersion: 'ozon-publisher-parity-difference-subject/v1',
          reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
          entrypoint: 'COLLECT_PUBLISH_OZON',
          rolloutRevision: 'rollout-1',
          stateVersion: 2,
          approvalState: 'APPROVED',
          classification: 'INTENTIONAL_STRICTER',
          differenceCount: 1,
          fullDifferenceSignature: 'd'.repeat(64),
        },
      },
    };

    expect(evaluate(rows)).toMatchObject({ ready: true, blockers: [] });
  });

  it('rejects an approved subject from a different revision and tracks live revocation', () => {
    const rows = evidenceRows();
    rows[0] = {
      ...rows[0]!,
      observation: {
        ...rows[0]!.observation!,
        status: 'DIFFERENT',
        classification: 'INTENTIONAL_STRICTER',
        switchEligible: false,
        differenceTotal: 1,
        differenceReturned: 1,
        differenceClassifications: ['INTENTIONAL_STRICTER'],
        differenceSubjectKey: '1'.repeat(64),
        fullDifferenceSignature: '2'.repeat(64),
        differenceSubject: {
          subjectKey: '1'.repeat(64),
          recordContractVersion: 'ozon-publisher-parity-difference-subject/v1',
          reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
          entrypoint: 'COLLECT_PUBLISH_OZON',
          rolloutRevision: 'wrong-rollout',
          stateVersion: 1,
          approvalState: 'APPROVED',
          classification: 'INTENTIONAL_STRICTER',
          differenceCount: 1,
          fullDifferenceSignature: '2'.repeat(64),
        },
      },
    };
    const wrongRevision = evaluate(rows);
    expect(wrongRevision.ready).toBe(false);
    expect(wrongRevision.blockers).toContain('UNSUPPORTED_EVIDENCE_PRESENT');

    rows[0]!.observation!.differenceSubject!.rolloutRevision = 'rollout-1';
    const approved = evaluate(rows);
    rows[0]!.observation!.differenceSubject = {
      ...rows[0]!.observation!.differenceSubject!,
      stateVersion: 2,
      approvalState: 'REVOKED',
    };
    const revoked = evaluate(rows);

    expect(approved.ready).toBe(true);
    expect(revoked.ready).toBe(false);
    expect(revoked.blockers).toContain('UNAPPROVED_DIFFERENCE_PRESENT');
    expect(revoked.evidenceHash).not.toBe(approved.evidenceHash);
  });

  it.each(['PENDING', 'REJECTED', 'REVOKED'] as const)(
    'blocks a difference whose current approval is %s',
    (approvalState) => {
      const rows = evidenceRows();
      rows[0] = {
        ...rows[0]!,
        observation: {
          ...rows[0]!.observation!,
          status: 'DIFFERENT',
          classification: 'COMPATIBILITY_TRANSFORM',
          switchEligible: false,
          differenceTotal: 1,
          differenceReturned: 1,
          differenceClassifications: ['COMPATIBILITY_TRANSFORM'],
          differenceSubjectKey: 'e'.repeat(64),
          fullDifferenceSignature: 'f'.repeat(64),
          differenceSubject: {
            subjectKey: 'e'.repeat(64),
            recordContractVersion: 'ozon-publisher-parity-difference-subject/v1',
            reportContractVersion: 'ozon-publisher-entrypoint-parity/v1',
            entrypoint: 'COLLECT_PUBLISH_OZON',
            rolloutRevision: 'rollout-1',
            stateVersion: 3,
            approvalState,
            classification: 'COMPATIBILITY_TRANSFORM',
            differenceCount: 1,
            fullDifferenceSignature: 'f'.repeat(64),
          },
        },
      };

      const result = evaluate(rows);
      expect(result.ready).toBe(false);
      expect(result.blockers).toContain('UNAPPROVED_DIFFERENCE_PRESENT');
    },
  );

  it.each(['V2_BLOCKED', 'NOT_COMPARABLE'] as const)(
    'blocks unsupported observation status %s',
    (status) => {
      const rows = evidenceRows();
      rows[0] = {
        ...rows[0]!,
        observation: {
          ...rows[0]!.observation!,
          status,
          classification: status === 'V2_BLOCKED' ? 'INTENTIONAL_STRICTER' : 'NOT_COMPARABLE',
          switchEligible: false,
        },
      };

      expect(evaluate(rows).blockers).toContain('UNSUPPORTED_EVIDENCE_PRESENT');
    },
  );

  it('blocks evidence-policy and contract drift inside the live window', () => {
    const rows = evidenceRows();
    rows[0] = { ...rows[0]!, evidencePolicyHash: '9'.repeat(64) };
    rows[1] = { ...rows[1]!, guardContractVersion: 'old-guard/v0' };
    rows[2] = {
      ...rows[2]!,
      observation: {
        ...rows[2]!.observation!,
        payloadCompilerVersion: 'old-compiler/v0',
      },
    };
    const result = evaluate(rows);

    expect(result.blockers).toEqual(expect.arrayContaining([
      'EVIDENCE_POLICY_DRIFT',
      'CONTRACT_DRIFT',
    ]));
  });
});
