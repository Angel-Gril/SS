import { describe, expect, it, vi } from 'vitest';

import {
  createOzonPublisherRolloutReadinessService,
  type OzonPublisherRolloutLiveSnapshot,
} from '../services/ozon-publisher-rollout-readiness-service.js';
import type { OzonPublisherRolloutReadinessEvaluation } from '../services/ozon-publisher-rollout-readiness.js';

const INPUT = {
  writerEntrypoint: 'COLLECT_PUBLISH_OZON' as const,
  originChannel: 'DIRECT' as const,
  rolloutRevision: 'rollout-1',
};
const POLICY_HASH = 'a'.repeat(64);
const CONFIG_HASH = 'b'.repeat(64);
const EVIDENCE_HASH = 'c'.repeat(64);

function snapshot(overrides: Partial<OzonPublisherRolloutLiveSnapshot> = {}): OzonPublisherRolloutLiveSnapshot {
  return {
    gate: {
      state: 'READY',
      stateVersion: 4,
      evidencePolicyHash: POLICY_HASH,
      authorizedControlConfigHash: CONFIG_HASH,
      guardContractVersion: 'ozon-publisher-rollout-guard/v1',
      coverageEpoch: {
        writerEntrypoint: 'COLLECT_PUBLISH_OZON',
        originChannel: 'DIRECT',
        rolloutRevision: 'rollout-1',
        evidencePolicyHash: POLICY_HASH,
        guardContractVersion: 'ozon-publisher-rollout-guard/v1',
        enforcedFrom: '2026-07-02T12:00:00.000Z',
      },
    },
    control: {
      evidencePolicyHash: POLICY_HASH,
      controlConfigHash: CONFIG_HASH,
    },
    asOf: new Date('2026-07-16T12:00:00.000Z'),
    evidenceRows: [],
    ...overrides,
  };
}

function evaluation(ready: boolean, evidenceHash = EVIDENCE_HASH): OzonPublisherRolloutReadinessEvaluation {
  return {
    contractVersion: 'ozon-publisher-rollout-readiness/v1',
    ...INPUT,
    asOf: '2026-07-16T12:00:00.000Z',
    windowStartedAt: '2026-07-02T12:00:00.000Z',
    coverageEpoch: snapshot().gate!.coverageEpoch,
    evidencePolicyHash: POLICY_HASH,
    authorizedEvidencePolicyHash: POLICY_HASH,
    controlConfigHash: CONFIG_HASH,
    authorizedControlConfigHash: CONFIG_HASH,
    ready,
    blockers: ready ? [] : ['RECORDER_COVERAGE_INCOMPLETE'],
    metrics: {
      eligibleAttemptCount: 100,
      linkedObservationCount: ready ? 100 : 99,
      missingObservationCount: ready ? 0 : 1,
      failedAttemptCount: 0,
      invalidEvidenceCount: 0,
      distinctScopeCount: 25,
      activeUtcDayCount: 7,
      latestEligibleAt: '2026-07-16T11:00:00.000Z',
      minimumEvidenceExpiresAt: '2026-08-16T12:00:00.000Z',
    },
    evidenceHash,
    evaluationHash: 'd'.repeat(64),
    validUntil: ready ? '2026-07-16T12:00:00.000Z' : null,
  };
}

function build(input: {
  live?: OzonPublisherRolloutLiveSnapshot | null;
  liveError?: Error;
  currentPolicyHash?: string;
  currentConfigHash?: string;
  evaluations?: OzonPublisherRolloutReadinessEvaluation[];
} = {}) {
  const loadLiveSnapshot = vi.fn(async () => {
    if (input.liveError) throw input.liveError;
    return input.live === undefined ? snapshot({
      control: {
        evidencePolicyHash: input.currentPolicyHash || POLICY_HASH,
        controlConfigHash: input.currentConfigHash || CONFIG_HASH,
      },
    }) : input.live;
  });
  const results = [...(input.evaluations || [evaluation(true)])];
  const evaluate = vi.fn(() => results.shift() || evaluation(false));
  return {
    loadLiveSnapshot,
    evaluate,
    service: createOzonPublisherRolloutReadinessService({
      repository: { loadLiveSnapshot },
      evaluate,
    }),
  };
}

describe('Ozon publisher rollout live readiness service', () => {
  it('returns null only when the exact gate does not exist', async () => {
    const built = build({ live: null });

    await expect(built.service.loadReadiness(INPUT)).resolves.toBeNull();
    expect(built.evaluate).not.toHaveBeenCalled();
  });

  it.each(['NOT_READY', 'REVOKED'] as const)(
    'returns an explicit non-ready decision for a %s gate',
    async (state) => {
      const built = build({ live: snapshot({ gate: { ...snapshot().gate!, state } }) });

      await expect(built.service.loadReadiness(INPUT)).resolves.toEqual({
        ready: false,
        rolloutRevision: 'rollout-1',
        gateStateVersion: 4,
        evidenceHash: null,
      });
      expect(built.evaluate).not.toHaveBeenCalled();
    },
  );

  it('maps a live exact READY evaluation to the control-plane contract', async () => {
    const built = build();

    await expect(built.service.loadReadiness(INPUT)).resolves.toEqual({
      ready: true,
      rolloutRevision: 'rollout-1',
      gateStateVersion: 4,
      evidenceHash: EVIDENCE_HASH,
    });
    expect(built.loadLiveSnapshot).toHaveBeenCalledWith(INPUT);
    expect(built.evaluate).toHaveBeenCalledOnce();
  });

  it('returns non-ready with the current audit hash when live evidence fails', async () => {
    const built = build({ evaluations: [evaluation(false)] });

    await expect(built.service.loadReadiness(INPUT)).resolves.toEqual({
      ready: false,
      rolloutRevision: 'rollout-1',
      gateStateVersion: 4,
      evidenceHash: EVIDENCE_HASH,
    });
  });

  it('passes current policy and config hashes into every live evaluation', async () => {
    const built = build({
      currentPolicyHash: '1'.repeat(64),
      currentConfigHash: '2'.repeat(64),
    });

    await built.service.loadReadiness(INPUT);

    expect(built.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      evidencePolicyHash: '1'.repeat(64),
      authorizedEvidencePolicyHash: POLICY_HASH,
      controlConfigHash: '2'.repeat(64),
      authorizedControlConfigHash: CONFIG_HASH,
    }));
  });

  it('does not cache READY across a later bad attempt or approval revocation', async () => {
    const built = build({ evaluations: [
      evaluation(true, '3'.repeat(64)),
      evaluation(false, '4'.repeat(64)),
    ] });

    await expect(built.service.loadReadiness(INPUT)).resolves.toMatchObject({ ready: true });
    await expect(built.service.loadReadiness(INPUT)).resolves.toMatchObject({
      ready: false,
      evidenceHash: '4'.repeat(64),
    });
    expect(built.loadLiveSnapshot).toHaveBeenCalledTimes(2);
    expect(built.evaluate).toHaveBeenCalledTimes(2);
  });

  it('propagates repository failure instead of returning stale readiness', async () => {
    const built = build({ liveError: new Error('database unavailable') });

    await expect(built.service.loadReadiness(INPUT)).rejects.toThrow('database unavailable');
  });
});
