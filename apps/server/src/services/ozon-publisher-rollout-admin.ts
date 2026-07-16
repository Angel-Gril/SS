import { createHash } from 'node:crypto';

export const OZON_PUBLISHER_ROLLOUT_ADMIN_CONTRACT_VERSION =
  'ozon-publisher-rollout-admin/v1' as const;

export type OzonPublisherRolloutWriterEntrypoint =
  | 'COLLECT_PUBLISH_OZON'
  | 'LISTING_BATCH'
  | 'LISTING_IMPORT_BY_SKU';

export type OzonPublisherRolloutOriginChannel = 'DIRECT' | 'BROWSER_ONE_CLICK';
export type OzonPublisherRolloutBoundary =
  | OzonPublisherRolloutWriterEntrypoint
  | 'BROWSER_ONE_CLICK'
  | 'EXTENSION_ADAPTER';
export type OzonPublisherRolloutStage = 'off' | 'shadow' | 'v2';
export type OzonPublisherRolloutGateState = 'NOT_READY' | 'READY' | 'REVOKED';
export type OzonPublisherRolloutEvaluationResult = 'NOT_READY' | 'READY';
export type OzonPublisherRolloutTransitionAction = 'APPROVE' | 'REVOKE';

export const OZON_PUBLISHER_ROLLOUT_STAGE_CONFIG_KEYS = Object.freeze({
  COLLECT_PUBLISH_OZON: 'source_ozon_publisher_collect_publish_stage',
  LISTING_BATCH: 'source_ozon_publisher_listing_batch_stage',
  LISTING_IMPORT_BY_SKU: 'source_ozon_publisher_listing_import_by_sku_stage',
  BROWSER_ONE_CLICK: 'source_ozon_publisher_browser_one_click_stage',
  EXTENSION_ADAPTER: 'source_ozon_publisher_extension_adapter_stage',
} as const satisfies Record<OzonPublisherRolloutBoundary, string>);

export type OzonPublisherRolloutAdminErrorCode =
  | 'OZON_PUBLISHER_ROLLOUT_ADMIN_INVALID_REQUEST'
  | 'OZON_PUBLISHER_ROLLOUT_ACCOUNT_SESSION_REQUIRED'
  | 'OZON_PUBLISHER_ROLLOUT_SUPER_ADMIN_REQUIRED'
  | 'OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND'
  | 'OZON_PUBLISHER_ROLLOUT_EVALUATION_NOT_FOUND'
  | 'OZON_PUBLISHER_ROLLOUT_GATE_STATE_VERSION_CONFLICT'
  | 'OZON_PUBLISHER_ROLLOUT_GATE_INVALID_TRANSITION'
  | 'OZON_PUBLISHER_ROLLOUT_IDEMPOTENCY_CONFLICT'
  | 'OZON_PUBLISHER_ROLLOUT_EVALUATION_NOT_READY'
  | 'OZON_PUBLISHER_ROLLOUT_EVALUATION_STALE'
  | 'OZON_PUBLISHER_ROLLOUT_EVIDENCE_DRIFT'
  | 'OZON_PUBLISHER_ROLLOUT_STAGE_REVISION_CONFLICT'
  | 'OZON_PUBLISHER_ROLLOUT_STAGE_INVALID_TRANSITION'
  | 'OZON_PUBLISHER_ROLLOUT_STAGE_GATE_MISMATCH'
  | 'OZON_PUBLISHER_ROLLOUT_STAGE_V2_NOT_READY'
  | 'OZON_PUBLISHER_ROLLOUT_STAGE_BOUNDARY_UNSUPPORTED'
  | 'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE';

export class OzonPublisherRolloutAdminError extends Error {
  constructor(
    public readonly code: OzonPublisherRolloutAdminErrorCode,
    public readonly statusCode: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'OzonPublisherRolloutAdminError';
  }
}

export interface OzonPublisherRolloutAdminActor {
  actorUserId: string;
  actorRole: string;
  isSuperAdmin: boolean;
  tokenUse: string;
}

export interface OzonPublisherRolloutAdminCursor {
  sortAt: string;
  id: string;
}

export interface OzonPublisherRolloutAdminPage<T> {
  items: readonly T[];
  nextCursor: OzonPublisherRolloutAdminCursor | null;
}

export interface OzonPublisherRolloutAdminGate {
  id: string;
  writerEntrypoint: OzonPublisherRolloutWriterEntrypoint;
  originChannel: OzonPublisherRolloutOriginChannel;
  rolloutRevision: string;
  recordContractVersion: string;
  evidencePolicyHash: string;
  authorizedControlConfigHash: string;
  guardContractVersion: string;
  denominatorEnforcedFrom: string;
  state: OzonPublisherRolloutGateState;
  stateVersion: number;
  readyEvaluationId: string | null;
  evidenceHash: string | null;
  evaluationHash: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  approvalReason: string | null;
  revokedByUserId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface OzonPublisherRolloutAdminReadinessMetrics {
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

export interface OzonPublisherRolloutAdminReadinessCriteria {
  contractVersion: 'ozon-publisher-rollout-readiness/v1';
  windowDays: number;
  minimumEligibleAttempts: number;
  minimumLinkedObservations: number;
  minimumDistinctScopes: number;
  minimumActiveUtcDays: number;
  maximumLatestAgeHours: number;
  rollbackEvidenceDays: number;
}

export interface OzonPublisherRolloutAdminEvaluation {
  id: string;
  evaluationKey: string;
  gateId: string;
  writerEntrypoint: OzonPublisherRolloutWriterEntrypoint;
  originChannel: OzonPublisherRolloutOriginChannel;
  rolloutRevision: string;
  recordContractVersion: string;
  evaluatorVersion: string;
  evidencePolicyHash: string;
  authorizedEvidencePolicyHash: string;
  controlConfigHash: string;
  authorizedControlConfigHash: string;
  guardContractVersion: string;
  result: OzonPublisherRolloutEvaluationResult;
  evidenceHash: string;
  evaluationHash: string;
  windowStart: string;
  windowEnd: string;
  evaluatedAt: string;
  evidenceRetainedUntil: string;
  validUntil: string | null;
  actorUserId: string;
  criteria: OzonPublisherRolloutAdminReadinessCriteria;
  metrics: OzonPublisherRolloutAdminReadinessMetrics;
  blockers: readonly OzonPublisherRolloutReadinessBlocker[];
}

export interface OzonPublisherRolloutAdminTransition {
  id: string;
  gateId: string;
  transitionVersion: number;
  expectedStateVersion: number;
  action: OzonPublisherRolloutTransitionAction;
  fromState: OzonPublisherRolloutGateState;
  resultState: OzonPublisherRolloutGateState;
  evaluationId: string;
  evidenceHashSnapshot: string;
  evaluationHashSnapshot: string;
  actorUserId: string;
  reason: string;
  decidedAt: string;
}

export interface OzonPublisherRolloutAdminStageControl {
  boundary: OzonPublisherRolloutBoundary;
  configKey: string;
  stage: OzonPublisherRolloutStage;
  revision: number;
  updatedAt: string;
}

export interface OzonPublisherRolloutAdminStageTransition {
  id: string;
  boundary: OzonPublisherRolloutBoundary;
  configKey: string;
  transitionVersion: number;
  expectedRevision: number;
  fromStage: OzonPublisherRolloutStage;
  resultStage: OzonPublisherRolloutStage;
  gateId: string | null;
  rolloutRevisionSnapshot: string | null;
  gateStateVersionSnapshot: number | null;
  evidenceHashSnapshot: string | null;
  evaluationHashSnapshot: string | null;
  actorUserId: string;
  reason: string;
  decidedAt: string;
}

export interface OzonPublisherRolloutAdminMutation<T> {
  record: T;
  idempotent: boolean;
}

export interface ListOzonPublisherRolloutGatesRequest {
  writerEntrypoint?: OzonPublisherRolloutWriterEntrypoint;
  originChannel?: OzonPublisherRolloutOriginChannel;
  rolloutRevision?: string;
  state?: OzonPublisherRolloutGateState;
  cursor?: OzonPublisherRolloutAdminCursor | null;
  limit?: number;
}

export interface GetOzonPublisherRolloutGateRequest {
  gateId: string;
}

export interface ListOzonPublisherRolloutHistoryRequest {
  gateId: string;
  cursor?: OzonPublisherRolloutAdminCursor | null;
  limit?: number;
}

export interface ProvisionOzonPublisherRolloutGateRequest {
  actor: OzonPublisherRolloutAdminActor;
  writerEntrypoint: OzonPublisherRolloutWriterEntrypoint;
  originChannel: OzonPublisherRolloutOriginChannel;
  rolloutRevision: string;
}

export interface ProvisionOzonPublisherRolloutGateRepositoryInput {
  actor: OzonPublisherRolloutAdminActor;
  writerEntrypoint: OzonPublisherRolloutWriterEntrypoint;
  originChannel: OzonPublisherRolloutOriginChannel;
  rolloutRevision: string;
}

export interface EvaluateOzonPublisherRolloutGateRequest {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  idempotencyKey: string;
}

export interface ApproveOzonPublisherRolloutGateRequest {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  expectedStateVersion: number;
  expectedPreviewEvidenceHash: string;
  idempotencyKey: string;
  reason: string;
}

export interface RevokeOzonPublisherRolloutGateRequest {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  expectedStateVersion: number;
  expectedEvidenceHash: string;
  expectedEvaluationHash: string;
  idempotencyKey: string;
  reason: string;
}

export interface OzonPublisherRolloutStageGateBinding {
  gateId: string;
  rolloutRevision: string;
  expectedGateStateVersion: number;
  expectedEvidenceHash: string;
  expectedEvaluationHash: string;
}

export interface TransitionOzonPublisherRolloutStageRequest {
  actor: OzonPublisherRolloutAdminActor;
  boundary: OzonPublisherRolloutBoundary;
  expectedRevision: number;
  expectedStage: OzonPublisherRolloutStage;
  targetStage: OzonPublisherRolloutStage;
  gateBinding?: OzonPublisherRolloutStageGateBinding;
  idempotencyKey: string;
  reason: string;
}

export interface EvaluateOzonPublisherRolloutGateRepositoryInput {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  idempotencyKey: string;
  operationKey: string;
  requestHash: string;
}

export interface ApproveOzonPublisherRolloutGateRepositoryInput {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  expectedStateVersion: 0;
  expectedPreviewEvidenceHash: string;
  idempotencyKey: string;
  operationKey: string;
  requestHash: string;
  reason: string;
}

export interface RevokeOzonPublisherRolloutGateRepositoryInput {
  actor: OzonPublisherRolloutAdminActor;
  gateId: string;
  expectedStateVersion: 1;
  expectedEvidenceHash: string;
  expectedEvaluationHash: string;
  idempotencyKey: string;
  operationKey: string;
  requestHash: string;
  reason: string;
}

export interface TransitionOzonPublisherRolloutStageRepositoryInput {
  actor: OzonPublisherRolloutAdminActor;
  boundary: OzonPublisherRolloutBoundary;
  configKey: string;
  expectedRevision: number;
  expectedStage: OzonPublisherRolloutStage;
  targetStage: OzonPublisherRolloutStage;
  gateBinding: OzonPublisherRolloutStageGateBinding | null;
  idempotencyKey: string;
  operationKey: string;
  requestHash: string;
  reason: string;
}

export interface OzonPublisherRolloutAdminRepository {
  listGates(input: {
    writerEntrypoint?: OzonPublisherRolloutWriterEntrypoint;
    originChannel?: OzonPublisherRolloutOriginChannel;
    rolloutRevision?: string;
    state?: OzonPublisherRolloutGateState;
    cursor: OzonPublisherRolloutAdminCursor | null;
    limit: number;
  }): Promise<OzonPublisherRolloutAdminPage<OzonPublisherRolloutAdminGate>>;
  findGate(input: { gateId: string }): Promise<OzonPublisherRolloutAdminGate | null>;
  provisionGate(
    input: ProvisionOzonPublisherRolloutGateRepositoryInput,
  ): Promise<OzonPublisherRolloutAdminMutation<OzonPublisherRolloutAdminGate>>;
  listEvaluations(input: {
    gateId: string;
    cursor: OzonPublisherRolloutAdminCursor | null;
    limit: number;
  }): Promise<OzonPublisherRolloutAdminPage<OzonPublisherRolloutAdminEvaluation>>;
  listTransitions(input: {
    gateId: string;
    cursor: OzonPublisherRolloutAdminCursor | null;
    limit: number;
  }): Promise<OzonPublisherRolloutAdminPage<OzonPublisherRolloutAdminTransition>>;
  listStages(): Promise<readonly OzonPublisherRolloutAdminStageControl[]>;
  evaluateGate(
    input: EvaluateOzonPublisherRolloutGateRepositoryInput,
  ): Promise<OzonPublisherRolloutAdminMutation<OzonPublisherRolloutAdminEvaluation>>;
  /**
   * Re-evaluate live evidence, insert the fresh evaluation, CAS the gate, and append
   * the immutable transition in one SERIALIZABLE transaction. A preview is never authority.
   */
  approveGate(
    input: ApproveOzonPublisherRolloutGateRepositoryInput,
  ): Promise<OzonPublisherRolloutAdminMutation<OzonPublisherRolloutAdminTransition>>;
  revokeGate(
    input: RevokeOzonPublisherRolloutGateRepositoryInput,
  ): Promise<OzonPublisherRolloutAdminMutation<OzonPublisherRolloutAdminTransition>>;
  transitionStage(
    input: TransitionOzonPublisherRolloutStageRepositoryInput,
  ): Promise<OzonPublisherRolloutAdminMutation<OzonPublisherRolloutAdminStageTransition>>;
}

const WRITER_ENTRYPOINTS = new Set<OzonPublisherRolloutWriterEntrypoint>([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
]);
const ORIGIN_CHANNELS = new Set<OzonPublisherRolloutOriginChannel>([
  'DIRECT', 'BROWSER_ONE_CLICK',
]);
const BOUNDARIES = new Set<OzonPublisherRolloutBoundary>([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER',
]);
const GATE_STATES = new Set<OzonPublisherRolloutGateState>([
  'NOT_READY', 'READY', 'REVOKED',
]);
const STAGES = new Set<OzonPublisherRolloutStage>(['off', 'shadow', 'v2']);
const HASH = /^[a-f0-9]{64}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function adminError(
  code: OzonPublisherRolloutAdminErrorCode,
  statusCode: 400 | 403 | 404 | 409 | 503,
  message: string,
): never {
  throw new OzonPublisherRolloutAdminError(code, statusCode, message);
}

function invalid(message: string): never {
  return adminError('OZON_PUBLISHER_ROLLOUT_ADMIN_INVALID_REQUEST', 400, message);
}

function strictRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(`${field} is invalid`);
  }
  const prototype = Object.getPrototypeOf(value);
  if ((prototype !== Object.prototype && prototype !== null)
    || Object.getOwnPropertySymbols(value).length > 0) {
    return invalid(`${field} is invalid`);
  }
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return invalid(`${field} contains unknown fields`);
  }
  return value as Record<string, unknown>;
}

function exactString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized !== value || normalized.length < minimum || normalized.length > maximum) {
    return invalid(`${field} is invalid`);
  }
  return normalized;
}

function identifier(value: unknown, field: string): string {
  return exactString(value, field, 1, 200);
}

function hashValue(value: unknown, field: string): string {
  const normalized = exactString(value, field, 64, 64);
  if (!HASH.test(normalized)) return invalid(`${field} is invalid`);
  return normalized;
}

function idempotencyKey(value: unknown): string {
  const normalized = exactString(value, 'idempotencyKey', 16, 200);
  if (!IDEMPOTENCY_KEY.test(normalized)) return invalid('idempotencyKey is invalid');
  return normalized;
}

function reason(value: unknown): string {
  return exactString(value, 'reason', 3, 1000);
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid(`${field} is invalid`);
  return Number(value);
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, field: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) return invalid(`${field} is invalid`);
  return value as T;
}

function cursor(value: unknown): OzonPublisherRolloutAdminCursor | null {
  if (value === undefined || value === null) return null;
  const row = strictRecord(value, ['sortAt', 'id'], 'cursor');
  const sortAt = exactString(row.sortAt, 'cursor.sortAt', 20, 30);
  const parsed = new Date(sortAt);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== sortAt) {
    return invalid('cursor.sortAt is invalid');
  }
  return { sortAt, id: identifier(row.id, 'cursor.id') };
}

function limit(value: unknown): number {
  if (value === undefined) return 20;
  const parsed = safeInteger(value, 'limit');
  if (parsed < 1 || parsed > 100) return invalid('limit is invalid');
  return parsed;
}

function writeActor(value: unknown): OzonPublisherRolloutAdminActor {
  const row = strictRecord(
    value,
    ['actorUserId', 'actorRole', 'isSuperAdmin', 'tokenUse'],
    'actor',
  );
  const actor = {
    actorUserId: identifier(row.actorUserId, 'actor.actorUserId'),
    actorRole: exactString(row.actorRole, 'actor.actorRole', 1, 50),
    isSuperAdmin: row.isSuperAdmin === true,
    tokenUse: exactString(row.tokenUse, 'actor.tokenUse', 1, 50),
  };
  if (actor.actorRole !== 'ADMIN' || !actor.isSuperAdmin) {
    return adminError(
      'OZON_PUBLISHER_ROLLOUT_SUPER_ADMIN_REQUIRED',
      403,
      'A live super administrator is required',
    );
  }
  if (actor.tokenUse !== 'account_session') {
    return adminError(
      'OZON_PUBLISHER_ROLLOUT_ACCOUNT_SESSION_REQUIRED',
      403,
      'A typed account session is required',
    );
  }
  return actor;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(row[key])}`
  )).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function writeKeys(input: {
  action: 'EVALUATE' | OzonPublisherRolloutTransitionAction | 'STAGE_TRANSITION';
  resource: string;
  actorUserId: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
}) {
  return {
    operationKey: sha256({
      contractVersion: 'ozon-publisher-rollout-admin-operation-key/v1',
      action: input.action,
      resource: input.resource,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
    }),
    requestHash: sha256({
      contractVersion: 'ozon-publisher-rollout-admin-request/v1',
      action: input.action,
      resource: input.resource,
      actorUserId: input.actorUserId,
      ...input.request,
    }),
  };
}

function publicCursor(value: OzonPublisherRolloutAdminCursor | null) {
  return value ? { sortAt: value.sortAt, id: value.id } : null;
}

function publicGate(value: OzonPublisherRolloutAdminGate): OzonPublisherRolloutAdminGate {
  return {
    id: value.id,
    writerEntrypoint: value.writerEntrypoint,
    originChannel: value.originChannel,
    rolloutRevision: value.rolloutRevision,
    recordContractVersion: value.recordContractVersion,
    evidencePolicyHash: value.evidencePolicyHash,
    authorizedControlConfigHash: value.authorizedControlConfigHash,
    guardContractVersion: value.guardContractVersion,
    denominatorEnforcedFrom: value.denominatorEnforcedFrom,
    state: value.state,
    stateVersion: value.stateVersion,
    readyEvaluationId: value.readyEvaluationId,
    evidenceHash: value.evidenceHash,
    evaluationHash: value.evaluationHash,
    approvedByUserId: value.approvedByUserId,
    approvedAt: value.approvedAt,
    approvalReason: value.approvalReason,
    revokedByUserId: value.revokedByUserId,
    revokedAt: value.revokedAt,
    revocationReason: value.revocationReason,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function publicEvaluation(
  value: OzonPublisherRolloutAdminEvaluation,
): OzonPublisherRolloutAdminEvaluation {
  return {
    id: value.id,
    evaluationKey: value.evaluationKey,
    gateId: value.gateId,
    writerEntrypoint: value.writerEntrypoint,
    originChannel: value.originChannel,
    rolloutRevision: value.rolloutRevision,
    recordContractVersion: value.recordContractVersion,
    evaluatorVersion: value.evaluatorVersion,
    evidencePolicyHash: value.evidencePolicyHash,
    authorizedEvidencePolicyHash: value.authorizedEvidencePolicyHash,
    controlConfigHash: value.controlConfigHash,
    authorizedControlConfigHash: value.authorizedControlConfigHash,
    guardContractVersion: value.guardContractVersion,
    result: value.result,
    evidenceHash: value.evidenceHash,
    evaluationHash: value.evaluationHash,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    evaluatedAt: value.evaluatedAt,
    evidenceRetainedUntil: value.evidenceRetainedUntil,
    validUntil: value.validUntil,
    actorUserId: value.actorUserId,
    criteria: { ...value.criteria },
    metrics: { ...value.metrics },
    blockers: [...value.blockers],
  };
}

function publicTransition(
  value: OzonPublisherRolloutAdminTransition,
): OzonPublisherRolloutAdminTransition {
  return {
    id: value.id,
    gateId: value.gateId,
    transitionVersion: value.transitionVersion,
    expectedStateVersion: value.expectedStateVersion,
    action: value.action,
    fromState: value.fromState,
    resultState: value.resultState,
    evaluationId: value.evaluationId,
    evidenceHashSnapshot: value.evidenceHashSnapshot,
    evaluationHashSnapshot: value.evaluationHashSnapshot,
    actorUserId: value.actorUserId,
    reason: value.reason,
    decidedAt: value.decidedAt,
  };
}

function publicStage(
  value: OzonPublisherRolloutAdminStageControl,
): OzonPublisherRolloutAdminStageControl {
  return {
    boundary: value.boundary,
    configKey: value.configKey,
    stage: value.stage,
    revision: value.revision,
    updatedAt: value.updatedAt,
  };
}

function publicStageTransition(
  value: OzonPublisherRolloutAdminStageTransition,
): OzonPublisherRolloutAdminStageTransition {
  return {
    id: value.id,
    boundary: value.boundary,
    configKey: value.configKey,
    transitionVersion: value.transitionVersion,
    expectedRevision: value.expectedRevision,
    fromStage: value.fromStage,
    resultStage: value.resultStage,
    gateId: value.gateId,
    rolloutRevisionSnapshot: value.rolloutRevisionSnapshot,
    gateStateVersionSnapshot: value.gateStateVersionSnapshot,
    evidenceHashSnapshot: value.evidenceHashSnapshot,
    evaluationHashSnapshot: value.evaluationHashSnapshot,
    actorUserId: value.actorUserId,
    reason: value.reason,
    decidedAt: value.decidedAt,
  };
}

function publicMutation<T, U>(
  value: OzonPublisherRolloutAdminMutation<T>,
  project: (record: T) => U,
): OzonPublisherRolloutAdminMutation<U> {
  return { record: project(value.record), idempotent: value.idempotent === true };
}

export function createOzonPublisherRolloutAdminService(options: {
  repository: OzonPublisherRolloutAdminRepository;
}) {
  const repository = options.repository;

  return {
    async listGates(input: ListOzonPublisherRolloutGatesRequest) {
      const row = strictRecord(
        input,
        ['writerEntrypoint', 'originChannel', 'rolloutRevision', 'state', 'cursor', 'limit'],
        'request',
      );
      const normalized = {
        ...(row.writerEntrypoint === undefined ? {} : {
          writerEntrypoint: enumValue(row.writerEntrypoint, WRITER_ENTRYPOINTS, 'writerEntrypoint'),
        }),
        ...(row.originChannel === undefined ? {} : {
          originChannel: enumValue(row.originChannel, ORIGIN_CHANNELS, 'originChannel'),
        }),
        ...(row.rolloutRevision === undefined ? {} : {
          rolloutRevision: identifier(row.rolloutRevision, 'rolloutRevision'),
        }),
        ...(row.state === undefined ? {} : {
          state: enumValue(row.state, GATE_STATES, 'state'),
        }),
        cursor: cursor(row.cursor),
        limit: limit(row.limit),
      };
      const result = await repository.listGates(normalized);
      return {
        items: result.items.map(publicGate),
        nextCursor: publicCursor(result.nextCursor),
      };
    },

    async getGate(input: GetOzonPublisherRolloutGateRequest) {
      const row = strictRecord(input, ['gateId'], 'request');
      const gateId = identifier(row.gateId, 'gateId');
      const gate = await repository.findGate({ gateId });
      if (!gate) {
        return adminError(
          'OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND',
          404,
          'Ozon publisher rollout gate was not found',
        );
      }
      return publicGate(gate);
    },

    async provisionGate(input: ProvisionOzonPublisherRolloutGateRequest) {
      const row = strictRecord(
        input,
        ['actor', 'writerEntrypoint', 'originChannel', 'rolloutRevision'],
        'request',
      );
      const actor = writeActor(row.actor);
      const writerEntrypoint = enumValue(
        row.writerEntrypoint,
        WRITER_ENTRYPOINTS,
        'writerEntrypoint',
      );
      const originChannel = enumValue(row.originChannel, ORIGIN_CHANNELS, 'originChannel');
      const rolloutRevision = identifier(row.rolloutRevision, 'rolloutRevision');
      const result = await repository.provisionGate({
        actor, writerEntrypoint, originChannel, rolloutRevision,
      });
      return publicMutation(result, publicGate);
    },

    async listEvaluations(input: ListOzonPublisherRolloutHistoryRequest) {
      const row = strictRecord(input, ['gateId', 'cursor', 'limit'], 'request');
      const result = await repository.listEvaluations({
        gateId: identifier(row.gateId, 'gateId'),
        cursor: cursor(row.cursor),
        limit: limit(row.limit),
      });
      return {
        items: result.items.map(publicEvaluation),
        nextCursor: publicCursor(result.nextCursor),
      };
    },

    async listTransitions(input: ListOzonPublisherRolloutHistoryRequest) {
      const row = strictRecord(input, ['gateId', 'cursor', 'limit'], 'request');
      const result = await repository.listTransitions({
        gateId: identifier(row.gateId, 'gateId'),
        cursor: cursor(row.cursor),
        limit: limit(row.limit),
      });
      return {
        items: result.items.map(publicTransition),
        nextCursor: publicCursor(result.nextCursor),
      };
    },

    async listStages() {
      return (await repository.listStages()).map(publicStage);
    },

    async evaluateGate(input: EvaluateOzonPublisherRolloutGateRequest) {
      const row = strictRecord(input, ['actor', 'gateId', 'idempotencyKey'], 'request');
      const actor = writeActor(row.actor);
      const gateId = identifier(row.gateId, 'gateId');
      const key = idempotencyKey(row.idempotencyKey);
      const keys = writeKeys({
        action: 'EVALUATE',
        resource: `gate:${gateId}`,
        actorUserId: actor.actorUserId,
        idempotencyKey: key,
        request: { gateId },
      });
      const result = await repository.evaluateGate({
        actor, gateId, idempotencyKey: key, ...keys,
      });
      return publicMutation(result, publicEvaluation);
    },

    async approveGate(input: ApproveOzonPublisherRolloutGateRequest) {
      const row = strictRecord(input, [
        'actor', 'gateId', 'expectedStateVersion', 'expectedPreviewEvidenceHash',
        'idempotencyKey', 'reason',
      ], 'request');
      const actor = writeActor(row.actor);
      const gateId = identifier(row.gateId, 'gateId');
      const expectedStateVersion = safeInteger(row.expectedStateVersion, 'expectedStateVersion');
      if (expectedStateVersion !== 0) return invalid('expectedStateVersion must be zero for approval');
      const expectedPreviewEvidenceHash = hashValue(
        row.expectedPreviewEvidenceHash,
        'expectedPreviewEvidenceHash',
      );
      const key = idempotencyKey(row.idempotencyKey);
      const normalizedReason = reason(row.reason);
      const request = {
        gateId,
        expectedStateVersion,
        expectedPreviewEvidenceHash,
        reason: normalizedReason,
      };
      const keys = writeKeys({
        action: 'APPROVE',
        resource: `gate:${gateId}`,
        actorUserId: actor.actorUserId,
        idempotencyKey: key,
        request,
      });
      const result = await repository.approveGate({
        actor,
        ...request,
        expectedStateVersion: 0,
        idempotencyKey: key,
        ...keys,
      });
      return publicMutation(result, publicTransition);
    },

    async revokeGate(input: RevokeOzonPublisherRolloutGateRequest) {
      const row = strictRecord(input, [
        'actor', 'gateId', 'expectedStateVersion', 'expectedEvidenceHash',
        'expectedEvaluationHash', 'idempotencyKey', 'reason',
      ], 'request');
      const actor = writeActor(row.actor);
      const gateId = identifier(row.gateId, 'gateId');
      const expectedStateVersion = safeInteger(row.expectedStateVersion, 'expectedStateVersion');
      if (expectedStateVersion !== 1) return invalid('expectedStateVersion must be one for revocation');
      const expectedEvidenceHash = hashValue(row.expectedEvidenceHash, 'expectedEvidenceHash');
      const expectedEvaluationHash = hashValue(row.expectedEvaluationHash, 'expectedEvaluationHash');
      const key = idempotencyKey(row.idempotencyKey);
      const normalizedReason = reason(row.reason);
      const request = {
        gateId,
        expectedStateVersion,
        expectedEvidenceHash,
        expectedEvaluationHash,
        reason: normalizedReason,
      };
      const keys = writeKeys({
        action: 'REVOKE',
        resource: `gate:${gateId}`,
        actorUserId: actor.actorUserId,
        idempotencyKey: key,
        request,
      });
      const result = await repository.revokeGate({
        actor,
        ...request,
        expectedStateVersion: 1,
        idempotencyKey: key,
        ...keys,
      });
      return publicMutation(result, publicTransition);
    },

    async transitionStage(input: TransitionOzonPublisherRolloutStageRequest) {
      const row = strictRecord(input, [
        'actor', 'boundary', 'expectedRevision', 'expectedStage', 'targetStage',
        'gateBinding', 'idempotencyKey', 'reason',
      ], 'request');
      const actor = writeActor(row.actor);
      const boundary = enumValue(row.boundary, BOUNDARIES, 'boundary');
      const expectedRevision = safeInteger(row.expectedRevision, 'expectedRevision');
      const expectedStage = enumValue(row.expectedStage, STAGES, 'expectedStage');
      const targetStage = enumValue(row.targetStage, STAGES, 'targetStage');
      if (expectedStage === targetStage || (expectedStage === 'off' && targetStage === 'v2')) {
        return adminError(
          'OZON_PUBLISHER_ROLLOUT_STAGE_INVALID_TRANSITION',
          409,
          'The requested rollout stage transition is invalid',
        );
      }

      let gateBinding: OzonPublisherRolloutStageGateBinding | null = null;
      if (targetStage === 'v2') {
        if (boundary === 'EXTENSION_ADAPTER') {
          return adminError(
            'OZON_PUBLISHER_ROLLOUT_STAGE_BOUNDARY_UNSUPPORTED',
            409,
            'The extension rollout boundary has no physical writer',
          );
        }
        const binding = strictRecord(row.gateBinding, [
          'gateId', 'rolloutRevision', 'expectedGateStateVersion',
          'expectedEvidenceHash', 'expectedEvaluationHash',
        ], 'gateBinding');
        const expectedGateStateVersion = safeInteger(
          binding.expectedGateStateVersion,
          'gateBinding.expectedGateStateVersion',
        );
        if (expectedGateStateVersion !== 1) {
          return invalid('gateBinding.expectedGateStateVersion must be one');
        }
        gateBinding = {
          gateId: identifier(binding.gateId, 'gateBinding.gateId'),
          rolloutRevision: identifier(binding.rolloutRevision, 'gateBinding.rolloutRevision'),
          expectedGateStateVersion,
          expectedEvidenceHash: hashValue(
            binding.expectedEvidenceHash,
            'gateBinding.expectedEvidenceHash',
          ),
          expectedEvaluationHash: hashValue(
            binding.expectedEvaluationHash,
            'gateBinding.expectedEvaluationHash',
          ),
        };
      } else if (row.gateBinding !== undefined) {
        return invalid('gateBinding is only allowed for a v2 transition');
      }

      const key = idempotencyKey(row.idempotencyKey);
      const normalizedReason = reason(row.reason);
      const request = {
        boundary,
        configKey: OZON_PUBLISHER_ROLLOUT_STAGE_CONFIG_KEYS[boundary],
        expectedRevision,
        expectedStage,
        targetStage,
        gateBinding,
        reason: normalizedReason,
      };
      const keys = writeKeys({
        action: 'STAGE_TRANSITION',
        resource: `stage:${boundary}`,
        actorUserId: actor.actorUserId,
        idempotencyKey: key,
        request,
      });
      const result = await repository.transitionStage({
        actor,
        ...request,
        idempotencyKey: key,
        ...keys,
      });
      return publicMutation(result, publicStageTransition);
    },
  };
}
