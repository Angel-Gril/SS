import type { OzonPublisherEntrypointReadiness } from './ozon-publisher-entrypoint-rollout.js';
import {
  evaluateOzonPublisherRolloutReadiness,
  type OzonPublisherRolloutCoverageEpoch,
  type OzonPublisherRolloutEvidenceRow,
  type OzonPublisherRolloutReadinessEvaluation,
} from './ozon-publisher-rollout-readiness.js';
import type {
  OzonPublisherOriginChannel,
  OzonPublisherWriterEntrypoint,
} from './ozon-publisher-entrypoint-rollout.js';

export interface OzonPublisherRolloutGateSnapshot {
  state: 'NOT_READY' | 'READY' | 'REVOKED';
  stateVersion: number;
  evidencePolicyHash: string;
  authorizedControlConfigHash: string;
  guardContractVersion: string;
  coverageEpoch: OzonPublisherRolloutCoverageEpoch | null;
}

export interface OzonPublisherRolloutLiveSnapshot {
  gate: OzonPublisherRolloutGateSnapshot;
  control: OzonPublisherRolloutControlSnapshot;
  asOf: Date;
  evidenceRows: readonly OzonPublisherRolloutEvidenceRow[];
}

export type OzonPublisherRolloutReadinessInput = {
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
};

export interface OzonPublisherRolloutReadinessRepository {
  loadLiveSnapshot(
    input: OzonPublisherRolloutReadinessInput,
  ): Promise<OzonPublisherRolloutLiveSnapshot | null>;
}

export interface OzonPublisherRolloutControlSnapshot {
  evidencePolicyHash: string;
  controlConfigHash: string;
}

type Evaluate = typeof evaluateOzonPublisherRolloutReadiness;

export function createOzonPublisherRolloutReadinessService(options: {
  repository: OzonPublisherRolloutReadinessRepository;
  evaluate?: Evaluate;
}) {
  const evaluate = options.evaluate || evaluateOzonPublisherRolloutReadiness;

  async function evaluateSnapshot(
    input: OzonPublisherRolloutReadinessInput,
    snapshot: OzonPublisherRolloutLiveSnapshot,
  ): Promise<OzonPublisherRolloutReadinessEvaluation> {
    const control = snapshot.control;
    const gate = snapshot.gate;
    const coverageEpoch = gate.coverageEpoch && gate.coverageEpoch.guardContractVersion
      === gate.guardContractVersion
      ? gate.coverageEpoch
      : null;
    return evaluate({
      ...input,
      evidencePolicyHash: control.evidencePolicyHash,
      authorizedEvidencePolicyHash: gate.evidencePolicyHash,
      controlConfigHash: control.controlConfigHash,
      authorizedControlConfigHash: gate.authorizedControlConfigHash,
      coverageEpoch,
      asOf: snapshot.asOf,
      evidenceRows: snapshot.evidenceRows,
    });
  }

  return {
    async evaluateExact(
      input: OzonPublisherRolloutReadinessInput,
    ): Promise<OzonPublisherRolloutReadinessEvaluation | null> {
      const snapshot = await options.repository.loadLiveSnapshot(input);
      return snapshot ? evaluateSnapshot(input, snapshot) : null;
    },

    async loadReadiness(
      input: OzonPublisherRolloutReadinessInput,
    ): Promise<OzonPublisherEntrypointReadiness | null> {
      const snapshot = await options.repository.loadLiveSnapshot(input);
      if (!snapshot) return null;
      const gate = snapshot.gate;
      if (gate.state !== 'READY') {
        return {
          ready: false,
          rolloutRevision: input.rolloutRevision,
          gateStateVersion: gate.stateVersion,
          evidenceHash: null,
        };
      }
      const result = await evaluateSnapshot(input, snapshot);
      return {
        ready: result.ready,
        rolloutRevision: input.rolloutRevision,
        gateStateVersion: gate.stateVersion,
        evidenceHash: result.evidenceHash,
      };
    },
  };
}
