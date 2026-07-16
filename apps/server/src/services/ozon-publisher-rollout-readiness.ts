import { createHash } from 'node:crypto';

import type {
  OzonPublisherOriginChannel,
  OzonPublisherWriterEntrypoint,
} from './ozon-publisher-entrypoint-rollout.js';
import type { OzonPublisherEntrypoint } from './ozon-publisher-entrypoint-parity.js';

export const OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA = Object.freeze({
  contractVersion: 'ozon-publisher-rollout-readiness/v1' as const,
  windowDays: 14,
  minimumEligibleAttempts: 100,
  minimumLinkedObservations: 100,
  minimumDistinctScopes: 25,
  minimumActiveUtcDays: 7,
  maximumLatestAgeHours: 24,
  rollbackEvidenceDays: 30,
});

export const OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS = Object.freeze({
  attempt: 'ozon-publisher-parity-eligible-attempt/v1',
  guard: 'ozon-publisher-rollout-guard/v1',
  observation: 'ozon-publisher-parity-observation/v1',
  report: 'ozon-publisher-entrypoint-parity/v1',
  differenceSubject: 'ozon-publisher-parity-difference-subject/v1',
  publisher: 'ozon-listing-production-compile-adapter/v1',
  payloadCompiler: 'ozon-listing-payload-compiler/v1',
});

const ATTEMPT_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.attempt;
const GUARD_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.guard;
const OBSERVATION_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.observation;
const REPORT_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.report;
const SUBJECT_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.differenceSubject;
const PUBLISHER_CONTRACT_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.publisher;
const PAYLOAD_COMPILER_VERSION = OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.payloadCompiler;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const HASH = /^[a-f0-9]{64}$/u;
export const OZON_PUBLISHER_ROLLOUT_MAX_EVIDENCE_ROWS = 10_000;
const MAX_DIFFERENCE_ROWS = 100;

type DifferenceClassification = 'INTENTIONAL_STRICTER' | 'COMPATIBILITY_TRANSFORM';

export interface OzonPublisherRolloutDifferenceSubjectEvidence {
  subjectKey: string;
  recordContractVersion: string;
  reportContractVersion: string;
  entrypoint: OzonPublisherEntrypoint;
  rolloutRevision: string;
  stateVersion: number;
  approvalState: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  classification: DifferenceClassification | 'DEFECT' | 'MATCH' | 'NOT_COMPARABLE';
  differenceCount: number;
  fullDifferenceSignature: string;
}

export interface OzonPublisherRolloutObservationEvidence {
  id: string;
  eligibleAttemptKey: string;
  recordKey: string;
  recordContractVersion: string;
  reportContractVersion: string;
  reportHash: string;
  entrypoint: OzonPublisherEntrypoint;
  rolloutRevision: string;
  scopeHash: string;
  status: 'MATCH' | 'DIFFERENT' | 'V2_BLOCKED' | 'NOT_COMPARABLE';
  classification:
    | 'MATCH'
    | DifferenceClassification
    | 'DEFECT'
    | 'NOT_COMPARABLE';
  switchEligible: boolean;
  publisherContractVersion: string | null;
  payloadCompilerVersion: string | null;
  differenceTotal: number;
  differenceReturned: number;
  differenceTruncated: boolean;
  differenceClassifications: readonly string[];
  differenceSubjectKey: string | null;
  fullDifferenceSignature: string | null;
  differenceSubject: OzonPublisherRolloutDifferenceSubjectEvidence | null;
  observedAt: string;
  expiresAt: string;
}

export interface OzonPublisherRolloutEvidenceRow {
  attemptKey: string;
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  parityEntrypoint: OzonPublisherEntrypoint;
  rolloutRevision: string;
  scopeHash: string;
  attemptContractVersion: string;
  guardContractVersion: string;
  evidencePolicyHash: string;
  eligibleAt: string;
  expiresAt: string;
  outcome: 'RECORDED' | 'FAILED' | null;
  observation: OzonPublisherRolloutObservationEvidence | null;
}

export type OzonPublisherRolloutReadinessBlocker =
  | 'ATTEMPT_DENOMINATOR_UNAVAILABLE'
  | 'ATTEMPT_DENOMINATOR_IDENTITY_MISMATCH'
  | 'ATTEMPT_DENOMINATOR_WINDOW_INCOMPLETE'
  | 'ELIGIBLE_ATTEMPT_FLOOR'
  | 'LINKED_OBSERVATION_FLOOR'
  | 'RECORDER_COVERAGE_INCOMPLETE'
  | 'RECORDER_FAILURE_PRESENT'
  | 'DISTINCT_SCOPE_FLOOR'
  | 'ACTIVE_UTC_DAY_FLOOR'
  | 'LATEST_OBSERVATION_MISSING'
  | 'LATEST_OBSERVATION_STALE'
  | 'ROLLBACK_EVIDENCE_RETENTION_SHORT'
  | 'EVIDENCE_POLICY_DRIFT'
  | 'CONTROL_CONFIG_DRIFT'
  | 'CONTRACT_DRIFT'
  | 'FUTURE_EVIDENCE_PRESENT'
  | 'UNSUPPORTED_EVIDENCE_PRESENT'
  | 'UNAPPROVED_DIFFERENCE_PRESENT';

export interface OzonPublisherRolloutCoverageEpoch {
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
  evidencePolicyHash: string;
  guardContractVersion: string;
  enforcedFrom: string;
}

export interface OzonPublisherRolloutReadinessMetrics {
  eligibleAttemptCount: number;
  linkedObservationCount: number;
  missingObservationCount: number;
  failedAttemptCount: number;
  invalidEvidenceCount: number;
  distinctScopeCount: number;
  activeUtcDayCount: number;
  latestEligibleAt: string | null;
  minimumEvidenceExpiresAt: string | null;
}

export interface OzonPublisherRolloutReadinessEvaluation {
  contractVersion: typeof OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.contractVersion;
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
  asOf: string;
  windowStartedAt: string;
  coverageEpoch: OzonPublisherRolloutCoverageEpoch | null;
  evidencePolicyHash: string;
  authorizedEvidencePolicyHash: string;
  controlConfigHash: string;
  authorizedControlConfigHash: string;
  ready: boolean;
  blockers: OzonPublisherRolloutReadinessBlocker[];
  metrics: OzonPublisherRolloutReadinessMetrics;
  evidenceHash: string;
  evaluationHash: string;
  validUntil: string | null;
}

export class OzonPublisherRolloutReadinessError extends Error {
  readonly code = 'INVALID_OZON_PUBLISHER_ROLLOUT_READINESS_INPUT';

  constructor(message: string) {
    super(message);
    this.name = 'OzonPublisherRolloutReadinessError';
  }
}

function invalid(message: string): never {
  throw new OzonPublisherRolloutReadinessError(message);
}

function exactIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > 200) {
    return invalid(`${field} is invalid`);
  }
  return normalized;
}

function exactHash(value: unknown, field: string): string {
  const text = exactIdentifier(value, field);
  if (!HASH.test(text)) return invalid(`${field} is invalid`);
  return text;
}

function exactDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return invalid(`${field} is invalid`);
  }
  return date;
}

function exactClock(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalid('asOf is invalid');
  }
  return new Date(value.getTime());
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(row[key])}`
  )).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function parityEntrypoint(
  writerEntrypoint: OzonPublisherWriterEntrypoint,
  originChannel: OzonPublisherOriginChannel,
): OzonPublisherEntrypoint {
  if (originChannel === 'DIRECT') return writerEntrypoint;
  if (originChannel === 'BROWSER_ONE_CLICK'
    && writerEntrypoint === 'COLLECT_PUBLISH_OZON') return originChannel;
  return invalid('writerEntrypoint and originChannel are incompatible');
}

function utcDay(milliseconds: number): string {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function observationQuality(input: {
  observation: OzonPublisherRolloutObservationEvidence;
  row: OzonPublisherRolloutEvidenceRow;
  expectedEntrypoint: OzonPublisherEntrypoint;
  asOfMs: number;
}): {
  contractDrift: boolean;
  unsupported: boolean;
  unapproved: boolean;
  expiresAtMs: number;
  observedAtMs: number;
  approvalDescriptor: unknown;
} {
  const { observation, row } = input;
  const observedAt = exactDate(observation.observedAt, 'observation.observedAt');
  const expiresAt = exactDate(observation.expiresAt, 'observation.expiresAt');
  exactIdentifier(observation.id, 'observation.id');
  exactHash(observation.eligibleAttemptKey, 'observation.eligibleAttemptKey');
  exactHash(observation.recordKey, 'observation.recordKey');
  exactHash(observation.reportHash, 'observation.reportHash');
  exactHash(observation.scopeHash, 'observation.scopeHash');
  if (!isSafeCount(observation.differenceTotal)
    || !isSafeCount(observation.differenceReturned)
    || observation.differenceTotal > MAX_DIFFERENCE_ROWS
    || observation.differenceReturned > MAX_DIFFERENCE_ROWS
    || !Array.isArray(observation.differenceClassifications)
    || observation.differenceClassifications.length > MAX_DIFFERENCE_ROWS) {
    return invalid('observation difference counts are invalid');
  }
  if (observation.differenceSubjectKey !== null) {
    exactHash(observation.differenceSubjectKey, 'observation.differenceSubjectKey');
  }
  if (observation.fullDifferenceSignature !== null) {
    exactHash(observation.fullDifferenceSignature, 'observation.fullDifferenceSignature');
  }
  for (const classification of observation.differenceClassifications) {
    exactIdentifier(classification, 'observation.differenceClassifications');
  }
  for (const [field, value] of [
    ['observation.recordContractVersion', observation.recordContractVersion],
    ['observation.reportContractVersion', observation.reportContractVersion],
    ['observation.publisherContractVersion', observation.publisherContractVersion],
    ['observation.payloadCompilerVersion', observation.payloadCompilerVersion],
    ['observation.status', observation.status],
    ['observation.classification', observation.classification],
  ] as const) {
    if (value !== null) exactIdentifier(value, field);
  }

  const contractDrift = observation.recordContractVersion !== OBSERVATION_CONTRACT_VERSION
    || observation.reportContractVersion !== REPORT_CONTRACT_VERSION
    || observation.publisherContractVersion !== PUBLISHER_CONTRACT_VERSION
    || observation.payloadCompilerVersion !== PAYLOAD_COMPILER_VERSION
    || observation.entrypoint !== input.expectedEntrypoint
    || observation.rolloutRevision !== row.rolloutRevision
    || observation.scopeHash !== row.scopeHash
    || observation.eligibleAttemptKey !== row.attemptKey
    || observedAt.getTime() < exactDate(row.eligibleAt, 'eligibleAt').getTime()
    || observedAt.getTime() > input.asOfMs;

  if (observation.status === 'MATCH') {
    const unsupported = observation.classification !== 'MATCH'
      || observation.switchEligible !== true
      || observation.differenceTotal !== 0
      || observation.differenceReturned !== 0
      || observation.differenceTruncated
      || observation.differenceClassifications.length !== 0
      || observation.differenceSubjectKey !== null
      || observation.fullDifferenceSignature !== null
      || observation.differenceSubject !== null;
    return {
      contractDrift,
      unsupported,
      unapproved: false,
      expiresAtMs: expiresAt.getTime(),
      observedAtMs: observedAt.getTime(),
      approvalDescriptor: null,
    };
  }

  if (observation.status !== 'DIFFERENT') {
    return {
      contractDrift,
      unsupported: true,
      unapproved: false,
      expiresAtMs: expiresAt.getTime(),
      observedAtMs: observedAt.getTime(),
      approvalDescriptor: null,
    };
  }

  const allowed = new Set<DifferenceClassification>([
    'INTENTIONAL_STRICTER',
    'COMPATIBILITY_TRANSFORM',
  ]);
  const subject = observation.differenceSubject;
  if (subject) {
    exactHash(subject.subjectKey, 'differenceSubject.subjectKey');
    exactHash(subject.fullDifferenceSignature, 'differenceSubject.fullDifferenceSignature');
    if (!isSafeCount(subject.stateVersion) || !isSafeCount(subject.differenceCount)) {
      return invalid('differenceSubject counts are invalid');
    }
    for (const [field, value] of [
      ['differenceSubject.recordContractVersion', subject.recordContractVersion],
      ['differenceSubject.reportContractVersion', subject.reportContractVersion],
      ['differenceSubject.rolloutRevision', subject.rolloutRevision],
      ['differenceSubject.approvalState', subject.approvalState],
      ['differenceSubject.classification', subject.classification],
    ] as const) exactIdentifier(value, field);
  }
  const complete = observation.switchEligible === false
    && observation.differenceTotal > 0
    && observation.differenceReturned === observation.differenceTotal
    && !observation.differenceTruncated
    && observation.differenceClassifications.length === observation.differenceTotal
    && allowed.has(observation.classification as DifferenceClassification)
    && observation.differenceClassifications.every((value) => allowed.has(
      value as DifferenceClassification,
    ))
    && subject !== null
    && observation.differenceSubjectKey === subject.subjectKey
    && subject.recordContractVersion === SUBJECT_CONTRACT_VERSION
    && subject.reportContractVersion === REPORT_CONTRACT_VERSION
    && subject.entrypoint === input.expectedEntrypoint
    && subject.rolloutRevision === row.rolloutRevision
    && subject.differenceCount === observation.differenceTotal
    && observation.fullDifferenceSignature === subject.fullDifferenceSignature
    && allowed.has(subject.classification as DifferenceClassification)
    && subject.classification === observation.classification;
  const unapproved = complete && subject?.approvalState !== 'APPROVED';
  return {
    contractDrift,
    unsupported: !complete,
    unapproved,
    expiresAtMs: expiresAt.getTime(),
    observedAtMs: observedAt.getTime(),
    approvalDescriptor: subject ? {
      subjectKey: subject.subjectKey,
      recordContractVersion: subject.recordContractVersion,
      reportContractVersion: subject.reportContractVersion,
      entrypoint: subject.entrypoint,
      rolloutRevision: subject.rolloutRevision,
      stateVersion: subject.stateVersion,
      approvalState: subject.approvalState,
      classification: subject.classification,
      differenceCount: subject.differenceCount,
      fullDifferenceSignature: subject.fullDifferenceSignature,
    } : null,
  };
}

function add(blockers: Set<OzonPublisherRolloutReadinessBlocker>, value: OzonPublisherRolloutReadinessBlocker) {
  blockers.add(value);
}

export function evaluateOzonPublisherRolloutReadiness(input: {
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
  evidencePolicyHash: string;
  authorizedEvidencePolicyHash: string;
  controlConfigHash: string;
  authorizedControlConfigHash: string;
  coverageEpoch: OzonPublisherRolloutCoverageEpoch | null;
  asOf: Date;
  evidenceRows: readonly OzonPublisherRolloutEvidenceRow[];
}): OzonPublisherRolloutReadinessEvaluation {
  const asOf = exactClock(input.asOf);
  const asOfMs = asOf.getTime();
  const windowStartedAtMs = asOfMs
    - OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.windowDays * DAY_MS;
  const expectedEntrypoint = parityEntrypoint(input.writerEntrypoint, input.originChannel);
  const rolloutRevision = exactIdentifier(input.rolloutRevision, 'rolloutRevision');
  const evidencePolicyHash = exactHash(input.evidencePolicyHash, 'evidencePolicyHash');
  const authorizedEvidencePolicyHash = exactHash(
    input.authorizedEvidencePolicyHash,
    'authorizedEvidencePolicyHash',
  );
  const controlConfigHash = exactHash(input.controlConfigHash, 'controlConfigHash');
  const authorizedControlConfigHash = exactHash(
    input.authorizedControlConfigHash,
    'authorizedControlConfigHash',
  );
  const blockers = new Set<OzonPublisherRolloutReadinessBlocker>();
  if (evidencePolicyHash !== authorizedEvidencePolicyHash) {
    add(blockers, 'EVIDENCE_POLICY_DRIFT');
  }
  if (controlConfigHash !== authorizedControlConfigHash) {
    add(blockers, 'CONTROL_CONFIG_DRIFT');
  }
  let coverageEpoch: OzonPublisherRolloutCoverageEpoch | null = null;
  let denominatorEnforcedFrom: Date | null = null;
  if (input.coverageEpoch === null) {
    add(blockers, 'ATTEMPT_DENOMINATOR_UNAVAILABLE');
  } else {
    coverageEpoch = {
      writerEntrypoint: input.coverageEpoch.writerEntrypoint,
      originChannel: input.coverageEpoch.originChannel,
      rolloutRevision: exactIdentifier(
        input.coverageEpoch.rolloutRevision,
        'coverageEpoch.rolloutRevision',
      ),
      evidencePolicyHash: exactHash(
        input.coverageEpoch.evidencePolicyHash,
        'coverageEpoch.evidencePolicyHash',
      ),
      guardContractVersion: exactIdentifier(
        input.coverageEpoch.guardContractVersion,
        'coverageEpoch.guardContractVersion',
      ),
      enforcedFrom: exactDate(
        input.coverageEpoch.enforcedFrom,
        'coverageEpoch.enforcedFrom',
      ).toISOString(),
    };
    if (coverageEpoch.writerEntrypoint !== input.writerEntrypoint
      || coverageEpoch.originChannel !== input.originChannel
      || coverageEpoch.rolloutRevision !== rolloutRevision
      || coverageEpoch.evidencePolicyHash !== evidencePolicyHash
      || coverageEpoch.guardContractVersion !== GUARD_CONTRACT_VERSION) {
      add(blockers, 'ATTEMPT_DENOMINATOR_IDENTITY_MISMATCH');
    }
    denominatorEnforcedFrom = exactDate(
      coverageEpoch.enforcedFrom,
      'coverageEpoch.enforcedFrom',
    );
    if (denominatorEnforcedFrom.getTime() > windowStartedAtMs) {
      add(blockers, 'ATTEMPT_DENOMINATOR_WINDOW_INCOMPLETE');
    }
  }

  const seenAttempts = new Set<string>();
  const seenObservations = new Set<string>();
  const descriptors: unknown[] = [];
  const futureDescriptors: Array<{ attemptKey: string; descriptor: unknown }> = [];
  const scopeHashes = new Set<string>();
  const activeDays = new Set<string>();
  let linkedObservationCount = 0;
  let failedAttemptCount = 0;
  let invalidEvidenceCount = 0;
  let latestEligibleAtMs: number | null = null;
  let minimumExpiresAtMs: number | null = null;

  if (!Array.isArray(input.evidenceRows)
    || input.evidenceRows.length > OZON_PUBLISHER_ROLLOUT_MAX_EVIDENCE_ROWS) {
    return invalid('evidenceRows exceeds the bounded evaluation input');
  }
  const rows = input.evidenceRows.map((row) => {
    const attemptKey = exactHash(row.attemptKey, 'attemptKey');
    if (seenAttempts.has(attemptKey)) return invalid('attemptKey is duplicated');
    seenAttempts.add(attemptKey);
    exactHash(row.scopeHash, 'scopeHash');
    exactHash(row.evidencePolicyHash, 'row.evidencePolicyHash');
    exactIdentifier(row.attemptContractVersion, 'attemptContractVersion');
    exactIdentifier(row.guardContractVersion, 'guardContractVersion');
    exactIdentifier(row.rolloutRevision, 'row.rolloutRevision');
    const eligibleAt = exactDate(row.eligibleAt, 'eligibleAt');
    const expiresAt = exactDate(row.expiresAt, 'expiresAt');
    if (row.writerEntrypoint !== input.writerEntrypoint
      || row.originChannel !== input.originChannel
      || row.parityEntrypoint !== expectedEntrypoint
      || row.rolloutRevision !== rolloutRevision) {
      return invalid('evidence row identity does not match the exact gate');
    }
    if (eligibleAt.getTime() > asOfMs) {
      add(blockers, 'FUTURE_EVIDENCE_PRESENT');
      const futureObservation = row.observation ? {
        id: exactIdentifier(row.observation.id, 'futureObservation.id'),
        eligibleAttemptKey: exactHash(
          row.observation.eligibleAttemptKey,
          'futureObservation.eligibleAttemptKey',
        ),
        recordKey: exactHash(row.observation.recordKey, 'futureObservation.recordKey'),
        reportHash: exactHash(row.observation.reportHash, 'futureObservation.reportHash'),
      } : null;
      futureDescriptors.push({
        attemptKey,
        descriptor: {
          attemptKey,
          scopeHash: row.scopeHash,
          attemptContractVersion: row.attemptContractVersion,
          guardContractVersion: row.guardContractVersion,
          evidencePolicyHash: row.evidencePolicyHash,
          eligibleAt: row.eligibleAt,
          expiresAt: row.expiresAt,
          outcome: row.outcome,
          observation: futureObservation,
        },
      });
    }
    return { row, attemptKey, eligibleAt, expiresAt };
  }).filter(({ eligibleAt }) => (
    eligibleAt.getTime() >= windowStartedAtMs && eligibleAt.getTime() <= asOfMs
  )).sort((left, right) => left.attemptKey.localeCompare(right.attemptKey, 'en'));

  for (const { row, attemptKey, eligibleAt, expiresAt } of rows) {
    let contractDrift = row.attemptContractVersion !== ATTEMPT_CONTRACT_VERSION
      || row.guardContractVersion !== GUARD_CONTRACT_VERSION;
    const policyDrift = row.evidencePolicyHash !== evidencePolicyHash;
    if (contractDrift) add(blockers, 'CONTRACT_DRIFT');
    if (policyDrift) add(blockers, 'EVIDENCE_POLICY_DRIFT');
    if (row.outcome === 'FAILED') failedAttemptCount += 1;
    const observation = row.outcome === 'RECORDED' ? row.observation : null;
    let observationDescriptor: unknown = null;
    let unsupported = false;
    let unapproved = false;
    let observationExpiresAtMs: number | null = null;
    if (observation) {
      if (seenObservations.has(observation.id)) return invalid('observation.id is duplicated');
      seenObservations.add(observation.id);
      const quality = observationQuality({
        observation,
        row,
        expectedEntrypoint,
        asOfMs,
      });
      contractDrift = contractDrift || quality.contractDrift;
      unsupported = quality.unsupported;
      unapproved = quality.unapproved;
      observationExpiresAtMs = quality.expiresAtMs;
      if (quality.contractDrift) add(blockers, 'CONTRACT_DRIFT');
      if (unsupported) add(blockers, 'UNSUPPORTED_EVIDENCE_PRESENT');
      if (unapproved) add(blockers, 'UNAPPROVED_DIFFERENCE_PRESENT');
      linkedObservationCount += 1;
      scopeHashes.add(row.scopeHash);
      activeDays.add(utcDay(eligibleAt.getTime()));
      latestEligibleAtMs = latestEligibleAtMs === null
        ? eligibleAt.getTime()
        : Math.max(latestEligibleAtMs, eligibleAt.getTime());
      observationDescriptor = {
        id: observation.id,
        eligibleAttemptKey: observation.eligibleAttemptKey,
        recordKey: observation.recordKey,
        recordContractVersion: observation.recordContractVersion,
        reportContractVersion: observation.reportContractVersion,
        reportHash: observation.reportHash,
        entrypoint: observation.entrypoint,
        rolloutRevision: observation.rolloutRevision,
        scopeHash: observation.scopeHash,
        status: observation.status,
        classification: observation.classification,
        switchEligible: observation.switchEligible,
        publisherContractVersion: observation.publisherContractVersion,
        payloadCompilerVersion: observation.payloadCompilerVersion,
        differenceTotal: observation.differenceTotal,
        differenceReturned: observation.differenceReturned,
        differenceTruncated: observation.differenceTruncated,
        differenceClassifications: observation.differenceClassifications,
        differenceSubjectKey: observation.differenceSubjectKey,
        fullDifferenceSignature: observation.fullDifferenceSignature,
        observedAt: observation.observedAt,
        expiresAt: observation.expiresAt,
        approval: quality.approvalDescriptor,
      };
    }
    if (row.outcome === 'RECORDED' && !row.observation) {
      unsupported = true;
      add(blockers, 'UNSUPPORTED_EVIDENCE_PRESENT');
    }
    if (row.outcome !== 'RECORDED' && row.observation !== null) {
      contractDrift = true;
      add(blockers, 'CONTRACT_DRIFT');
    }
    if (contractDrift || policyDrift || unsupported || unapproved) invalidEvidenceCount += 1;
    const rowMinimumExpiry = observationExpiresAtMs === null
      ? expiresAt.getTime()
      : Math.min(expiresAt.getTime(), observationExpiresAtMs);
    minimumExpiresAtMs = minimumExpiresAtMs === null
      ? rowMinimumExpiry
      : Math.min(minimumExpiresAtMs, rowMinimumExpiry);
    descriptors.push({
      attemptKey,
      writerEntrypoint: row.writerEntrypoint,
      originChannel: row.originChannel,
      parityEntrypoint: row.parityEntrypoint,
      rolloutRevision: row.rolloutRevision,
      scopeHash: row.scopeHash,
      attemptContractVersion: row.attemptContractVersion,
      evidencePolicyHash: row.evidencePolicyHash,
      guardContractVersion: row.guardContractVersion,
      eligibleAt: row.eligibleAt,
      expiresAt: row.expiresAt,
      outcome: row.outcome,
      observation: observationDescriptor,
    });
  }

  const eligibleAttemptCount = rows.length;
  const missingObservationCount = eligibleAttemptCount - linkedObservationCount;
  const distinctScopeCount = scopeHashes.size;
  const activeUtcDayCount = activeDays.size;
  if (eligibleAttemptCount < OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.minimumEligibleAttempts) {
    add(blockers, 'ELIGIBLE_ATTEMPT_FLOOR');
  }
  if (linkedObservationCount
    < OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.minimumLinkedObservations) {
    add(blockers, 'LINKED_OBSERVATION_FLOOR');
  }
  if (missingObservationCount !== 0) add(blockers, 'RECORDER_COVERAGE_INCOMPLETE');
  if (failedAttemptCount !== 0) add(blockers, 'RECORDER_FAILURE_PRESENT');
  if (distinctScopeCount < OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.minimumDistinctScopes) {
    add(blockers, 'DISTINCT_SCOPE_FLOOR');
  }
  if (activeUtcDayCount < OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.minimumActiveUtcDays) {
    add(blockers, 'ACTIVE_UTC_DAY_FLOOR');
  }
  if (latestEligibleAtMs === null) {
    add(blockers, 'LATEST_OBSERVATION_MISSING');
  } else if (asOfMs - latestEligibleAtMs
    > OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.maximumLatestAgeHours * HOUR_MS) {
    add(blockers, 'LATEST_OBSERVATION_STALE');
  }
  const retentionBoundaryMs = asOfMs
    + OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.rollbackEvidenceDays * DAY_MS;
  if (minimumExpiresAtMs === null || minimumExpiresAtMs < retentionBoundaryMs) {
    add(blockers, 'ROLLBACK_EVIDENCE_RETENTION_SHORT');
  }

  const metrics: OzonPublisherRolloutReadinessMetrics = {
    eligibleAttemptCount,
    linkedObservationCount,
    missingObservationCount,
    failedAttemptCount,
    invalidEvidenceCount,
    distinctScopeCount,
    activeUtcDayCount,
    latestEligibleAt: latestEligibleAtMs === null ? null : new Date(latestEligibleAtMs).toISOString(),
    minimumEvidenceExpiresAt: minimumExpiresAtMs === null
      ? null
      : new Date(minimumExpiresAtMs).toISOString(),
  };
  const sortedBlockers = [...blockers].sort();
  const ready = sortedBlockers.length === 0;
  const freshUntilMs = latestEligibleAtMs === null
    ? null
    : latestEligibleAtMs
      + OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.maximumLatestAgeHours * HOUR_MS;
  const retainedUntilMs = minimumExpiresAtMs === null
    ? null
    : minimumExpiresAtMs
      - OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.rollbackEvidenceDays * DAY_MS;
  const timeBoundedUntilMs = ready && freshUntilMs !== null && retainedUntilMs !== null
    ? Math.min(freshUntilMs, retainedUntilMs)
    : null;
  const validUntilMs = timeBoundedUntilMs === null ? null : asOfMs;
  const evidenceHash = hash({
    contractVersion: OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.contractVersion,
    writerEntrypoint: input.writerEntrypoint,
    originChannel: input.originChannel,
    rolloutRevision,
    criteria: OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
    evidencePolicyHash,
    authorizedEvidencePolicyHash,
    controlConfigHash,
    authorizedControlConfigHash,
    coverageEpoch,
    descriptors,
    futureEvidence: futureDescriptors
      .sort((left, right) => left.attemptKey.localeCompare(right.attemptKey, 'en'))
      .map(({ descriptor }) => descriptor),
    metrics,
    blockers: sortedBlockers,
    ready,
  });
  const evaluationHash = hash({
    evidenceHash,
    asOf: asOf.toISOString(),
    windowStartedAt: new Date(windowStartedAtMs).toISOString(),
    validUntil: validUntilMs === null ? null : new Date(validUntilMs).toISOString(),
  });
  return {
    contractVersion: OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.contractVersion,
    writerEntrypoint: input.writerEntrypoint,
    originChannel: input.originChannel,
    rolloutRevision,
    asOf: asOf.toISOString(),
    windowStartedAt: new Date(windowStartedAtMs).toISOString(),
    coverageEpoch,
    evidencePolicyHash,
    authorizedEvidencePolicyHash,
    controlConfigHash,
    authorizedControlConfigHash,
    ready,
    blockers: sortedBlockers,
    metrics,
    evidenceHash,
    evaluationHash,
    validUntil: validUntilMs === null ? null : new Date(validUntilMs).toISOString(),
  };
}
