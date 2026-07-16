import type {
  OzonPublisherRolloutControlSnapshot,
  OzonPublisherRolloutLiveSnapshot,
  OzonPublisherRolloutReadinessInput,
  OzonPublisherRolloutReadinessRepository,
} from './ozon-publisher-rollout-readiness-service.js';
import {
  OZON_PUBLISHER_ROLLOUT_MAX_EVIDENCE_ROWS,
  OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
  type OzonPublisherRolloutDifferenceSubjectEvidence,
  type OzonPublisherRolloutEvidenceRow,
  type OzonPublisherRolloutObservationEvidence,
} from './ozon-publisher-rollout-readiness.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_QUERY_LIMIT = OZON_PUBLISHER_ROLLOUT_MAX_EVIDENCE_ROWS + 1;
const HASH = /^[a-f0-9]{64}$/u;
const WRITER_ENTRYPOINTS = [
  'COLLECT_PUBLISH_OZON',
  'LISTING_BATCH',
  'LISTING_IMPORT_BY_SKU',
] as const;
const ORIGIN_CHANNELS = ['DIRECT', 'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER'] as const;
const PARITY_ENTRYPOINTS = [
  ...WRITER_ENTRYPOINTS,
  'BROWSER_ONE_CLICK',
  'EXTENSION_ADAPTER',
] as const;

export interface OzonPublisherRolloutReadinessPrismaTransaction {
  $queryRawUnsafe<T = unknown[]>(query: string, ...values: unknown[]): Promise<T>;
}

export interface OzonPublisherRolloutReadinessPrismaClient {
  $transaction<T>(
    action: (tx: OzonPublisherRolloutReadinessPrismaTransaction) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<T>;
}

export type LoadOzonPublisherRolloutControlSnapshot = (
  tx: OzonPublisherRolloutReadinessPrismaTransaction,
  input: OzonPublisherRolloutReadinessInput,
) => Promise<OzonPublisherRolloutControlSnapshot>;

export class OzonPublisherRolloutReadinessRepositoryError extends Error {
  readonly code:
    | 'INVALID_OZON_PUBLISHER_ROLLOUT_SNAPSHOT'
    | 'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_TOO_LARGE';

  constructor(
    code: OzonPublisherRolloutReadinessRepositoryError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'OzonPublisherRolloutReadinessRepositoryError';
    this.code = code;
  }
}

interface GateRow {
  asOf: unknown;
  id: unknown;
  state: unknown;
  stateVersion: unknown;
  writerEntrypoint: unknown;
  originChannel: unknown;
  rolloutRevision: unknown;
  evidencePolicyHash: unknown;
  authorizedControlConfigHash: unknown;
  guardContractVersion: unknown;
  denominatorEnforcedFrom: unknown;
}

interface EvidenceRow {
  eligibleAttemptKey: unknown;
  writerEntrypoint: unknown;
  originChannel: unknown;
  parityEntrypoint: unknown;
  rolloutRevision: unknown;
  scopeHash: unknown;
  attemptContractVersion: unknown;
  guardContractVersion: unknown;
  evidencePolicyHash: unknown;
  eligibleAt: unknown;
  attemptExpiresAt: unknown;
  outcomeResult: unknown;
  outcomeObservationRecordKey: unknown;
  outcomeObservationReportHash: unknown;
  outcomeSubjectStateVersion: unknown;
  outcomeFullDifferenceSignature: unknown;
  outcomeFailureCode: unknown;
  observationId: unknown;
  observationEligibleAttemptKey: unknown;
  observationRecordKey: unknown;
  observationRecordContractVersion: unknown;
  observationReportContractVersion: unknown;
  observationReportHash: unknown;
  observationEntrypoint: unknown;
  observationRolloutRevision: unknown;
  observationScopeHash: unknown;
  observationStatus: unknown;
  observationClassification: unknown;
  observationSwitchEligible: unknown;
  observationPublisherContractVersion: unknown;
  observationPayloadCompilerVersion: unknown;
  observationDifferenceTotal: unknown;
  observationDifferenceReturned: unknown;
  observationDifferenceTruncated: unknown;
  observationDifferenceRows: unknown;
  observationDifferenceSubjectKey: unknown;
  observationFullDifferenceSignature: unknown;
  observationObservedAt: unknown;
  observationExpiresAt: unknown;
  subjectKey: unknown;
  subjectRecordContractVersion: unknown;
  subjectReportContractVersion: unknown;
  subjectEntrypoint: unknown;
  subjectRolloutRevision: unknown;
  subjectStateVersion: unknown;
  subjectApprovalState: unknown;
  subjectClassification: unknown;
  subjectDifferenceTotal: unknown;
  subjectFullDifferenceSignature: unknown;
}

const GATE_QUERY = `
SELECT transaction_timestamp()::TIMESTAMPTZ(3) AS "asOf",
       g."id", g."state", g."state_version" AS "stateVersion",
       g."writer_entrypoint" AS "writerEntrypoint",
       g."origin_channel" AS "originChannel",
       g."rollout_revision" AS "rolloutRevision",
       g."evidence_policy_hash" AS "evidencePolicyHash",
       g."authorized_control_config_hash" AS "authorizedControlConfigHash",
       g."guard_contract_version" AS "guardContractVersion",
       g."denominator_enforced_from" AS "denominatorEnforcedFrom"
  FROM "ozon_publisher_rollout_gates" g
 WHERE g."writer_entrypoint" = CAST($1 AS "OzonPublisherWriterEntrypoint")
   AND g."origin_channel" = CAST($2 AS "OzonPublisherOriginChannel")
   AND g."rollout_revision" = $3
 LIMIT 2`;

const EVIDENCE_QUERY = `
SELECT a."eligible_attempt_key" AS "eligibleAttemptKey",
       a."writer_entrypoint" AS "writerEntrypoint",
       a."origin_channel" AS "originChannel",
       a."parity_entrypoint" AS "parityEntrypoint",
       a."rollout_revision" AS "rolloutRevision",
       a."scope_hash" AS "scopeHash",
       a."attempt_contract_version" AS "attemptContractVersion",
       a."guard_contract_version" AS "guardContractVersion",
       a."evidence_policy_hash" AS "evidencePolicyHash",
       a."eligible_at" AS "eligibleAt", a."expires_at" AS "attemptExpiresAt",
       o."result" AS "outcomeResult",
       o."observation_record_key" AS "outcomeObservationRecordKey",
       o."observation_report_hash" AS "outcomeObservationReportHash",
       o."subject_state_version_snapshot" AS "outcomeSubjectStateVersion",
       o."full_difference_signature_snapshot" AS "outcomeFullDifferenceSignature",
       o."failure_code" AS "outcomeFailureCode",
       p."id" AS "observationId",
       p."eligible_attempt_key" AS "observationEligibleAttemptKey",
       p."record_key" AS "observationRecordKey",
       p."record_contract_version" AS "observationRecordContractVersion",
       p."report_contract_version" AS "observationReportContractVersion",
       p."report_hash" AS "observationReportHash",
       p."entrypoint" AS "observationEntrypoint",
       p."rollout_revision" AS "observationRolloutRevision",
       p."scope_hash" AS "observationScopeHash",
       p."status" AS "observationStatus",
       p."classification" AS "observationClassification",
       p."switch_eligible" AS "observationSwitchEligible",
       p."publisher_contract_version" AS "observationPublisherContractVersion",
       p."payload_compiler_version" AS "observationPayloadCompilerVersion",
       p."difference_total" AS "observationDifferenceTotal",
       p."difference_returned" AS "observationDifferenceReturned",
       p."difference_truncated" AS "observationDifferenceTruncated",
       p."difference_rows_json" AS "observationDifferenceRows",
       p."difference_subject_key" AS "observationDifferenceSubjectKey",
       p."full_difference_signature" AS "observationFullDifferenceSignature",
       p."observed_at" AS "observationObservedAt",
       p."expires_at" AS "observationExpiresAt",
       s."subject_key" AS "subjectKey",
       s."record_contract_version" AS "subjectRecordContractVersion",
       s."report_contract_version" AS "subjectReportContractVersion",
       s."entrypoint" AS "subjectEntrypoint",
       s."rollout_revision" AS "subjectRolloutRevision",
       s."state_version" AS "subjectStateVersion",
       s."approval_state" AS "subjectApprovalState",
       s."classification" AS "subjectClassification",
       s."difference_total" AS "subjectDifferenceTotal",
       s."full_difference_signature" AS "subjectFullDifferenceSignature"
  FROM "ozon_publisher_rollout_recorder_attempts" a
  LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
  LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
  LEFT JOIN "ozon_publisher_parity_difference_subjects" s
    ON s."subject_key" = p."difference_subject_key"
 WHERE a."gate_id" = $1 AND a."eligible_at" >= $2
 ORDER BY a."eligible_attempt_key" ASC
 LIMIT $3`;

function invalid(message: string): never {
  throw new OzonPublisherRolloutReadinessRepositoryError(
    'INVALID_OZON_PUBLISHER_ROLLOUT_SNAPSHOT',
    message,
  );
}

function exactString(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > 200) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function exactHash(value: unknown, field: string): string {
  const text = exactString(value, field);
  if (!HASH.test(text)) return invalid(`${field} is invalid`);
  return text;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : exactString(value, field);
}

function nullableHash(value: unknown, field: string): string | null {
  return value === null ? null : exactHash(value, field);
}

function exactDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalid(`${field} is invalid`);
  }
  return new Date(value.getTime());
}

function exactInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalid(`${field} is invalid`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : exactInteger(value, field);
}

function exactBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(`${field} is invalid`);
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  const text = exactString(value, field);
  if (!allowed.includes(text as T)) return invalid(`${field} is invalid`);
  return text as T;
}

function differenceClassifications(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    return invalid('observation.differenceRows is invalid');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return invalid(`observation.differenceRows[${index}] is invalid`);
    }
    return exactString(
      (item as Record<string, unknown>).classification,
      `observation.differenceRows[${index}].classification`,
    );
  });
}

function assertEmptyObservationJoin(row: EvidenceRow): void {
  for (const [field, value] of Object.entries(row)) {
    if ((field.startsWith('observation') || field.startsWith('subject')) && value !== null) {
      invalid(`observation join contains ${field} without an observation`);
    }
  }
}

function mapSubject(row: EvidenceRow): OzonPublisherRolloutDifferenceSubjectEvidence | null {
  if (row.subjectKey === null) return null;
  return {
    subjectKey: exactHash(row.subjectKey, 'subject.subjectKey'),
    recordContractVersion: exactString(
      row.subjectRecordContractVersion,
      'subject.recordContractVersion',
    ),
    reportContractVersion: exactString(
      row.subjectReportContractVersion,
      'subject.reportContractVersion',
    ),
    entrypoint: enumValue(
      row.subjectEntrypoint,
      PARITY_ENTRYPOINTS,
      'subject.entrypoint',
    ),
    rolloutRevision: exactString(row.subjectRolloutRevision, 'subject.rolloutRevision'),
    stateVersion: exactInteger(row.subjectStateVersion, 'subject.stateVersion'),
    approvalState: enumValue(
      row.subjectApprovalState,
      ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'] as const,
      'subject.approvalState',
    ),
    classification: enumValue(
      row.subjectClassification,
      ['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT', 'MATCH', 'NOT_COMPARABLE'] as const,
      'subject.classification',
    ),
    differenceCount: exactInteger(row.subjectDifferenceTotal, 'subject.differenceCount'),
    fullDifferenceSignature: exactHash(
      row.subjectFullDifferenceSignature,
      'subject.fullDifferenceSignature',
    ),
  };
}

function mapObservation(row: EvidenceRow): OzonPublisherRolloutObservationEvidence | null {
  if (row.observationId === null) {
    assertEmptyObservationJoin(row);
    return null;
  }
  const differenceSubjectKey = nullableHash(
    row.observationDifferenceSubjectKey,
    'observation.differenceSubjectKey',
  );
  const differenceSubject = mapSubject(row);
  if (differenceSubjectKey !== null && differenceSubject === null) {
    return invalid('observation difference subject is missing');
  }
  return {
    id: exactString(row.observationId, 'observation.id'),
    eligibleAttemptKey: exactHash(
      row.observationEligibleAttemptKey,
      'observation.eligibleAttemptKey',
    ),
    recordKey: exactHash(row.observationRecordKey, 'observation.recordKey'),
    recordContractVersion: exactString(
      row.observationRecordContractVersion,
      'observation.recordContractVersion',
    ),
    reportContractVersion: exactString(
      row.observationReportContractVersion,
      'observation.reportContractVersion',
    ),
    reportHash: exactHash(row.observationReportHash, 'observation.reportHash'),
    entrypoint: enumValue(
      row.observationEntrypoint,
      PARITY_ENTRYPOINTS,
      'observation.entrypoint',
    ),
    rolloutRevision: exactString(
      row.observationRolloutRevision,
      'observation.rolloutRevision',
    ),
    scopeHash: exactHash(row.observationScopeHash, 'observation.scopeHash'),
    status: enumValue(
      row.observationStatus,
      ['MATCH', 'DIFFERENT', 'V2_BLOCKED', 'NOT_COMPARABLE'] as const,
      'observation.status',
    ),
    classification: enumValue(
      row.observationClassification,
      ['MATCH', 'INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT', 'NOT_COMPARABLE'] as const,
      'observation.classification',
    ),
    switchEligible: exactBoolean(
      row.observationSwitchEligible,
      'observation.switchEligible',
    ),
    publisherContractVersion: nullableString(
      row.observationPublisherContractVersion,
      'observation.publisherContractVersion',
    ),
    payloadCompilerVersion: nullableString(
      row.observationPayloadCompilerVersion,
      'observation.payloadCompilerVersion',
    ),
    differenceTotal: exactInteger(
      row.observationDifferenceTotal,
      'observation.differenceTotal',
    ),
    differenceReturned: exactInteger(
      row.observationDifferenceReturned,
      'observation.differenceReturned',
    ),
    differenceTruncated: exactBoolean(
      row.observationDifferenceTruncated,
      'observation.differenceTruncated',
    ),
    differenceClassifications: differenceClassifications(row.observationDifferenceRows),
    differenceSubjectKey,
    fullDifferenceSignature: nullableHash(
      row.observationFullDifferenceSignature,
      'observation.fullDifferenceSignature',
    ),
    differenceSubject,
    observedAt: exactDate(row.observationObservedAt, 'observation.observedAt').toISOString(),
    expiresAt: exactDate(row.observationExpiresAt, 'observation.expiresAt').toISOString(),
  };
}

function validateOutcomeSnapshots(
  row: EvidenceRow,
  outcome: OzonPublisherRolloutEvidenceRow['outcome'],
  observation: OzonPublisherRolloutObservationEvidence | null,
): void {
  if (outcome === null) {
    if (observation !== null
      || row.outcomeObservationRecordKey !== null
      || row.outcomeObservationReportHash !== null
      || row.outcomeSubjectStateVersion !== null
      || row.outcomeFullDifferenceSignature !== null
      || row.outcomeFailureCode !== null) {
      invalid('outcome join contains provenance without an outcome');
    }
    return;
  }
  if (outcome === 'FAILED') {
    if (observation !== null
      || row.outcomeObservationRecordKey !== null
      || row.outcomeObservationReportHash !== null
      || row.outcomeSubjectStateVersion !== null
      || row.outcomeFullDifferenceSignature !== null) {
      invalid('failed outcome contains observation provenance');
    }
    exactString(row.outcomeFailureCode, 'outcome.failureCode');
    return;
  }
  if (!observation || row.outcomeFailureCode !== null) {
    invalid('recorded outcome is missing observation provenance');
  }
  if (exactHash(row.outcomeObservationRecordKey, 'outcome.observationRecordKey')
      !== observation.recordKey
    || exactHash(row.outcomeObservationReportHash, 'outcome.observationReportHash')
      !== observation.reportHash) {
    invalid('recorded outcome observation provenance does not match');
  }
  const subject = observation.differenceSubject;
  if (subject === null) {
    if (row.outcomeSubjectStateVersion !== null
      || row.outcomeFullDifferenceSignature !== null) {
      invalid('recorded MATCH outcome contains difference provenance');
    }
    return;
  }
  if (nullableInteger(row.outcomeSubjectStateVersion, 'outcome.subjectStateVersion')
      !== subject.stateVersion
    || nullableHash(row.outcomeFullDifferenceSignature, 'outcome.fullDifferenceSignature')
      !== subject.fullDifferenceSignature) {
    invalid('recorded outcome difference provenance does not match');
  }
}

function mapEvidenceRow(row: EvidenceRow): OzonPublisherRolloutEvidenceRow {
  const outcome = row.outcomeResult === null
    ? null
    : enumValue(row.outcomeResult, ['RECORDED', 'FAILED'] as const, 'outcome.result');
  const observation = mapObservation(row);
  validateOutcomeSnapshots(row, outcome, observation);
  return {
    // The domain identity is the trusted recorder/observation link, not the
    // separate idempotency key stored in attempts.attempt_key.
    attemptKey: exactHash(row.eligibleAttemptKey, 'attempt.eligibleAttemptKey'),
    writerEntrypoint: enumValue(
      row.writerEntrypoint,
      WRITER_ENTRYPOINTS,
      'attempt.writerEntrypoint',
    ),
    originChannel: enumValue(row.originChannel, ORIGIN_CHANNELS, 'attempt.originChannel'),
    parityEntrypoint: enumValue(
      row.parityEntrypoint,
      PARITY_ENTRYPOINTS,
      'attempt.parityEntrypoint',
    ),
    rolloutRevision: exactString(row.rolloutRevision, 'attempt.rolloutRevision'),
    scopeHash: exactHash(row.scopeHash, 'attempt.scopeHash'),
    attemptContractVersion: exactString(
      row.attemptContractVersion,
      'attempt.attemptContractVersion',
    ),
    guardContractVersion: exactString(
      row.guardContractVersion,
      'attempt.guardContractVersion',
    ),
    evidencePolicyHash: exactHash(
      row.evidencePolicyHash,
      'attempt.evidencePolicyHash',
    ),
    eligibleAt: exactDate(row.eligibleAt, 'attempt.eligibleAt').toISOString(),
    expiresAt: exactDate(row.attemptExpiresAt, 'attempt.expiresAt').toISOString(),
    outcome,
    observation,
  };
}

function mapControlSnapshot(value: unknown): OzonPublisherRolloutControlSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('control snapshot is invalid');
  }
  const row = value as Record<string, unknown>;
  return {
    evidencePolicyHash: exactHash(row.evidencePolicyHash, 'control.evidencePolicyHash'),
    controlConfigHash: exactHash(row.controlConfigHash, 'control.controlConfigHash'),
  };
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = [candidate.code, candidate.meta?.code].map((value) => String(value || ''));
  return codes.some((code) => ['P2034', '40001', '40P01'].includes(code))
    || /could not serialize|deadlock detected/u.test(String(candidate.message || ''));
}

async function serializable<T>(
  client: OzonPublisherRolloutReadinessPrismaClient,
  action: (tx: OzonPublisherRolloutReadinessPrismaTransaction) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!retryable(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

export async function loadPrismaOzonPublisherRolloutLiveSnapshotInTransaction(
  options: {
    tx: OzonPublisherRolloutReadinessPrismaTransaction;
    loadControlSnapshot: LoadOzonPublisherRolloutControlSnapshot;
  },
  input: OzonPublisherRolloutReadinessInput,
): Promise<OzonPublisherRolloutLiveSnapshot | null> {
  const gateRows = await options.tx.$queryRawUnsafe<GateRow[]>(
    GATE_QUERY,
    input.writerEntrypoint,
    input.originChannel,
    input.rolloutRevision,
  );
  if (gateRows.length === 0) return null;
  if (gateRows.length !== 1) return invalid('exact gate identity is not unique');
  const gateRow = gateRows[0]!;
  const asOf = exactDate(gateRow.asOf, 'asOf');
  const gateId = exactString(gateRow.id, 'gate.id');
  const control = mapControlSnapshot(await options.loadControlSnapshot(options.tx, input));
  const windowStart = new Date(
    asOf.getTime() - OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.windowDays * DAY_MS,
  );
  const evidenceRows = await options.tx.$queryRawUnsafe<EvidenceRow[]>(
    EVIDENCE_QUERY,
    gateId,
    windowStart,
    EVIDENCE_QUERY_LIMIT,
  );
  if (evidenceRows.length > OZON_PUBLISHER_ROLLOUT_MAX_EVIDENCE_ROWS) {
    throw new OzonPublisherRolloutReadinessRepositoryError(
      'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_TOO_LARGE',
      'Ozon publisher rollout readiness snapshot exceeds 10000 evidence rows',
    );
  }
  const writerEntrypoint = enumValue(
    gateRow.writerEntrypoint,
    WRITER_ENTRYPOINTS,
    'gate.writerEntrypoint',
  );
  const originChannel = enumValue(
    gateRow.originChannel,
    ORIGIN_CHANNELS,
    'gate.originChannel',
  );
  const rolloutRevision = exactString(gateRow.rolloutRevision, 'gate.rolloutRevision');
  const evidencePolicyHash = exactHash(gateRow.evidencePolicyHash, 'gate.evidencePolicyHash');
  const guardContractVersion = exactString(
    gateRow.guardContractVersion,
    'gate.guardContractVersion',
  );
  return {
    gate: {
      state: enumValue(
        gateRow.state,
        ['NOT_READY', 'READY', 'REVOKED'] as const,
        'gate.state',
      ),
      stateVersion: exactInteger(gateRow.stateVersion, 'gate.stateVersion'),
      evidencePolicyHash,
      authorizedControlConfigHash: exactHash(
        gateRow.authorizedControlConfigHash,
        'gate.authorizedControlConfigHash',
      ),
      guardContractVersion,
      coverageEpoch: {
        writerEntrypoint,
        originChannel,
        rolloutRevision,
        evidencePolicyHash,
        guardContractVersion,
        enforcedFrom: exactDate(
          gateRow.denominatorEnforcedFrom,
          'gate.denominatorEnforcedFrom',
        ).toISOString(),
      },
    },
    control,
    asOf,
    evidenceRows: evidenceRows.map(mapEvidenceRow),
  };
}

export function createPrismaOzonPublisherRolloutReadinessRepository(options: {
  client: OzonPublisherRolloutReadinessPrismaClient;
  loadControlSnapshot: LoadOzonPublisherRolloutControlSnapshot;
}): OzonPublisherRolloutReadinessRepository {
  return {
    async loadLiveSnapshot(input) {
      return serializable(options.client, (tx) => (
        loadPrismaOzonPublisherRolloutLiveSnapshotInTransaction({
          tx,
          loadControlSnapshot: options.loadControlSnapshot,
        }, input)
      ));
    },
  };
}
