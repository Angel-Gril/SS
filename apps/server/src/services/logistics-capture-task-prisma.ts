import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  LogisticsCaptureTaskError,
  type LogisticsCaptureAuthority,
  type LogisticsCaptureCandidateInput,
  type LogisticsCaptureAdminTask,
  type LogisticsCaptureCancelResult,
  type LogisticsCaptureClaimResult,
  type LogisticsCaptureDeviceContext,
  type LogisticsCaptureReviewCandidate,
  type LogisticsCaptureReviewResult,
  type LogisticsCaptureScope,
  type LogisticsCaptureReviewCandidateDetail,
  type LogisticsCaptureTask,
  type LogisticsCaptureTaskRepository,
  type LogisticsCapturePersistenceResult,
} from './logistics-capture-task.js';
import type {
  CaptureCandidateSetAssignmentContext,
  CaptureCandidateSetRepository,
  ReviewedCaptureCandidateSet,
} from './logistics-capture-draft.js';

interface SqlTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

interface SqlClient extends SqlTransaction {
  $transaction<T>(
    operation: (transaction: SqlTransaction) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

interface CaptureTaskRow {
  id: string;
  version: string;
  kind: 'SELLER' | 'OFFICIAL';
  requestedByUserId: string;
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string | null;
  destinationLocationUid: string | null;
  officialFingerprint: unknown;
  expectedEndpoints: string[];
  fingerprintChecksum: string;
  nonceDigest?: string;
  status: 'ISSUED' | 'CLAIMED' | 'REVIEWABLE' | 'CANCELLED';
  claimedBySessionId: string | null;
  candidateId?: string | null;
  claimedAt: Date | string | null;
  uploadedAt: Date | string | null;
  reviewableAt: Date | string | null;
  cancelledAt?: Date | string | null;
  issuedAt: Date | string;
  expiresAt: Date | string;
}

interface CandidateRow {
  id: string;
  state: 'CAPTURED' | 'QUARANTINED';
  fingerprintChecksum: string;
  responseChecksum: string;
  previousResponseChecksum: string | null;
}

interface AdminCaptureTaskRow extends CaptureTaskRow {
  candidateState: 'CAPTURED' | 'QUARANTINED' | null;
  candidateReviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' | null;
  candidateResponseChecksum: string | null;
  candidateReviewedAt: Date | string | null;
}

interface ReviewRow {
  candidateId: string;
  taskId: string;
  taskKind: 'SELLER' | 'OFFICIAL';
  taskVersion: 'logistics-capture-task/v1' | 'logistics-capture-task/v2'
    | 'logistics-capture-task/v3';
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string | null;
  destinationLocationUid: string | null;
  state: 'CAPTURED' | 'QUARANTINED';
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  responseChecksum: string;
  previousResponseChecksum: string | null;
  receivedAt: Date | string;
  reviewedById?: string | null;
  reviewedAt?: Date | string | null;
  reviewReason?: string | null;
}
interface ReviewDetailRow extends ReviewRow {
  sourceResponseChecksum: string | null;
  capturedAt: Date | string | null;
  quarantineReasons: string[];
  normalizedPayload: unknown;
  diagnostics: unknown;
}


interface AuthorityRow {
  companyStatus: 'CANDIDATE' | 'VERIFIED' | 'INVALIDATED';
  companyTenantId: string;
  companyShopId: string;
  companyId: string;
  openApiVerifiedAt: Date | string | null;
  sellerProbeVerifiedAt: Date | string | null;
  openApiIntersectionVerifiedAt: Date | string | null;
  companyInvalidatedAt: Date | string | null;
  companyRetiredAt: Date | string | null;
  originStatus: 'CANDIDATE' | 'VERIFIED' | 'INVALIDATED';
  originTenantId: string;
  originShopId: string;
  originWarehouseId: string;
  originCountryUid: string;
  originCityUid: string;

  openApiAddressVerifiedAt: Date | string | null;
  officialLocationVerifiedAt: Date | string | null;
  originInvalidatedAt: Date | string | null;
  originRetiredAt: Date | string | null;
  verifiedDestinations: unknown;
}
interface CandidateSetAssignmentRow {
  assignmentId: string;
  channelId: string;
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string;
  destinationLocationUid: string;
  warehouseLatitude: number;
  warehouseLongitude: number;
  originBindingId: string;
  originVerifiedAt: Date | string;
}

interface OfficialInputUnitContractRow {
  id: string;
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string;
  destinationLocationUid: string;
  currency: 'CNY';
  weightUnit: 'g';
  dimensionUnit: 'mm';
  weightIncrementG: unknown;
  dimensionIncrementMm: unknown;
  currencyMinorIncrement: number;
  sourceRevision: string;
  sourceChecksum: string;
  reviewerId: string;
  verifiedAt: Date | string;
  validUntil: Date | string;
}

interface CandidateSetRow {
  id: string;
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string;
  destinationLocationUid: string;
  assignmentId: string;
  channelId: string;
  sellerCandidateId: string;
  officialCandidateIds: string[];
  selectedServiceKeys: string[];
  defaultServiceKeys: string[];
  matrixInput: unknown;
  validationMatrix: unknown;
  pointEvidence: unknown;
  contentChecksum: string;
  minExtensionVersion: string;
  createdById: string;
  createdAt: Date | string;
}

interface CandidateSetOfficialRow {
  candidateId: string;
  fingerprintKey: string;
  responseChecksum: string;
}

const TASK_COLUMNS = `
  t."id" AS "id", t."version" AS "version", t."kind"::text AS "kind",
  t."requested_by_user_id" AS "requestedByUserId", t."tenant_id" AS "tenantId",
  t."shop_id" AS "shopId", t."company_id" AS "companyId",
  t."warehouse_id" AS "warehouseId", t."origin_country_uid" AS "originCountryUid",
  t."origin_city_uid" AS "originCityUid",
  t."destination_country_uid" AS "destinationCountryUid",
  t."destination_location_uid" AS "destinationLocationUid",
  t."official_fingerprint" AS "officialFingerprint",
  t."expected_endpoints" AS "expectedEndpoints",
  t."fingerprint_checksum" AS "fingerprintChecksum",
  t."nonce_digest" AS "nonceDigest", t."status"::text AS "status",
  t."claimed_by_session_id" AS "claimedBySessionId", t."candidate_id" AS "candidateId",
  t."claimed_at" AS "claimedAt", t."uploaded_at" AS "uploadedAt",
  t."reviewable_at" AS "reviewableAt", t."cancelled_at" AS "cancelledAt",
  t."issued_at" AS "issuedAt",
  t."expires_at" AS "expiresAt"`;

const REVIEW_COLUMNS = `
  c."id" AS "candidateId", c."source_task_id" AS "taskId",
  c."task_kind"::text AS "taskKind", c."task_version" AS "taskVersion",
  c."tenant_id" AS "tenantId",
  c."shop_id" AS "shopId", c."company_id" AS "companyId",
  c."warehouse_id" AS "warehouseId",
  c."origin_country_uid" AS "originCountryUid",

  c."origin_city_uid" AS "originCityUid",
  c."destination_country_uid" AS "destinationCountryUid",
  c."destination_location_uid" AS "destinationLocationUid",
  c."state"::text AS "state", c."review_status"::text AS "reviewStatus",
  c."response_checksum" AS "responseChecksum",
  c."source_response_checksum" AS "sourceResponseChecksum",
  c."previous_response_checksum" AS "previousResponseChecksum",
  c."captured_at" AS "capturedAt", c."received_at" AS "receivedAt",
  c."quarantine_reasons" AS "quarantineReasons",
  c."normalized_payload" AS "normalizedPayload",
  c."diagnostics" AS "diagnostics",
  c."reviewed_by_id" AS "reviewedById",
  c."reviewed_at" AS "reviewedAt",
  c."review_reason" AS "reviewReason"`;
const CANDIDATE_SET_COLUMNS = `
  cs."id" AS "id", cs."tenant_id" AS "tenantId", cs."shop_id" AS "shopId",
  cs."company_id" AS "companyId", cs."warehouse_id" AS "warehouseId",
  cs."origin_country_uid" AS "originCountryUid", cs."origin_city_uid" AS "originCityUid",
  cs."destination_country_uid" AS "destinationCountryUid",
  cs."destination_location_uid" AS "destinationLocationUid",
  cs."assignment_id" AS "assignmentId", cs."channel_id" AS "channelId",
  cs."seller_candidate_id" AS "sellerCandidateId",
  cs."official_candidate_ids" AS "officialCandidateIds",
  cs."selected_service_keys" AS "selectedServiceKeys",
  cs."default_service_keys" AS "defaultServiceKeys",
  cs."matrix_input" AS "matrixInput", cs."validation_matrix" AS "validationMatrix",
  cs."point_evidence" AS "pointEvidence", cs."content_checksum" AS "contentChecksum",
  cs."min_extension_version" AS "minExtensionVersion",
  cs."created_by_id" AS "createdById", cs."created_at" AS "createdAt"`;

async function loadCandidateSet(
  client: SqlTransaction,
  input: { id?: string; contentChecksum?: string },
): Promise<ReviewedCaptureCandidateSet | null> {
  const byId = typeof input.id === 'string';
  const value = byId ? input.id : input.contentChecksum;
  if (!value) return null;
  const rows = await client.$queryRawUnsafe<CandidateSetRow[]>(
    `SELECT ${CANDIDATE_SET_COLUMNS}
     FROM "logistics_capture_candidate_sets" cs
     WHERE ${byId ? 'cs."id"' : 'cs."content_checksum"'} = $1`,
    value,
  );
  const row = rows[0];
  if (!row) return null;
  const officials = await client.$queryRawUnsafe<CandidateSetOfficialRow[]>(
    `SELECT "official_candidate_id" AS "candidateId",
            "fingerprint_key" AS "fingerprintKey",
            "response_checksum" AS "responseChecksum"
     FROM "logistics_capture_candidate_set_officials"
     WHERE "candidate_set_id" = $1
     ORDER BY "fingerprint_key", "official_candidate_id"`,
    row.id,
  );
  const expectedIds = [...row.officialCandidateIds].sort();
  const actualIds = officials.map((item) => item.candidateId).sort();
  if (expectedIds.length !== actualIds.length
    || expectedIds.some((value, index) => value !== actualIds[index])) {
    repositoryError('CAPTURE_CANDIDATE_SET_CORRUPT', 409,
      'Capture candidate set membership is inconsistent');
  }
  const createdAt = asDate(row.createdAt);
  if (!createdAt) repositoryError('CAPTURE_CANDIDATE_SET_CORRUPT', 409,
    'Capture candidate set timestamp is invalid');
  return {
    id: row.id,
    sellerCandidateId: row.sellerCandidateId,
    officialCandidates: officials.map((item) => ({ ...item })),
    assignmentId: row.assignmentId,
    channelId: row.channelId,
    scope: {
      tenantId: row.tenantId, shopId: row.shopId, companyId: row.companyId,
      warehouseId: row.warehouseId, originCountryUid: row.originCountryUid,
      originCityUid: row.originCityUid,
    },
    destination: {
      countryUid: row.destinationCountryUid, locationUid: row.destinationLocationUid,
    },
    selectedServiceKeys: [...row.selectedServiceKeys],
    defaultServiceKeys: [...row.defaultServiceKeys],
    matrixInput: structuredClone(row.matrixInput) as ReviewedCaptureCandidateSet['matrixInput'],
    validationMatrix: structuredClone(row.validationMatrix) as ReviewedCaptureCandidateSet['validationMatrix'],
    pointEvidence: structuredClone(row.pointEvidence) as ReviewedCaptureCandidateSet['pointEvidence'],
    contentChecksum: row.contentChecksum,
    minExtensionVersion: row.minExtensionVersion,
    createdById: row.createdById,
    createdAt: createdAt!.toISOString(),
  };
}

class RetryableCaptureRace extends Error {}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableCaptureRace) return true;
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  return value.code === 'P2034'
    || value.code === '40001'
    || value.meta?.code === '40001'
    || (typeof value.message === 'string' && value.message.includes('could not serialize'));
}

async function serializable<T>(
  client: SqlClient,
  operation: (transaction: SqlTransaction) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function measurementNumber(value: unknown, field: string): number {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(String(value));
  } catch {
    repositoryError(
      'CAPTURE_INPUT_UNIT_CONTRACT_CORRUPT',
      500,
      `Official input-unit ${field} is not numeric`,
    );
  }
  const result = decimal.toNumber();
  if (
    !Number.isFinite(result)
    || result <= 0
    || result >= 100_000_000_000
    || decimal.decimalPlaces() > 9
    || !decimal.equals(new Prisma.Decimal(String(result)))
  ) {
    repositoryError(
      'CAPTURE_INPUT_UNIT_CONTRACT_CORRUPT',
      500,
      `Official input-unit ${field} cannot be mapped safely`,
    );
  }
  return result;
}

function nonceDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
const CLAIM_TOKEN_VERSION = 'ct1';

function claimTokenPayload(row: CaptureTaskRow, sessionId: string): string {
  return JSON.stringify([
    CLAIM_TOKEN_VERSION,
    row.id,
    row.nonceDigest || '',
    asDate(row.expiresAt)?.toISOString() || '',
    sessionId,
  ]);
}

function issueClaimToken(secret: string, row: CaptureTaskRow, sessionId: string): string {
  const signature = createHmac('sha256', secret)
    .update(claimTokenPayload(row, sessionId))
    .digest('base64url');
  return CLAIM_TOKEN_VERSION + '.' + signature;
}

function secureTextEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function proofMatches(
  secret: string,
  row: CaptureTaskRow,
  device: LogisticsCaptureDeviceContext,
  proof: { nonce?: string; claimToken?: string },
): boolean {
  const hasNonce = typeof proof.nonce === 'string' && proof.nonce.length > 0;
  const hasClaimToken = typeof proof.claimToken === 'string' && proof.claimToken.length > 0;
  if (hasNonce === hasClaimToken) return false;
  if (hasNonce) return secureTextEqual(nonceDigest(proof.nonce!), row.nonceDigest || '');
  return secureTextEqual(proof.claimToken!, issueClaimToken(secret, row, device.sessionId));
}


function taskFromRow(row: CaptureTaskRow, nonce: string): LogisticsCaptureTask {
  return {
    id: row.id,
    version: row.version as LogisticsCaptureTask['version'],
    kind: row.kind,
    requestedByUserId: row.requestedByUserId,
    scope: {
      tenantId: row.tenantId,
      shopId: row.shopId,
      companyId: row.companyId,
      warehouseId: row.warehouseId,
      originCountryUid: row.originCountryUid,
      originCityUid: row.originCityUid,
    },
    destination: row.destinationCountryUid && row.destinationLocationUid
      ? { countryUid: row.destinationCountryUid, locationUid: row.destinationLocationUid }
      : null,
    officialFingerprint: row.officialFingerprint
      ? structuredClone(row.officialFingerprint) as LogisticsCaptureTask['officialFingerprint']
      : null,
    expectedEndpoints: [...row.expectedEndpoints],
    fingerprintChecksum: row.fingerprintChecksum,
    nonce,
    status: row.status,
    claimedBySessionId: row.claimedBySessionId,
    claimedAt: asDate(row.claimedAt),
    uploadedAt: asDate(row.uploadedAt),
    reviewableAt: asDate(row.reviewableAt),
    issuedAt: asDate(row.issuedAt)!,
    expiresAt: asDate(row.expiresAt)!,
  };
}

function adminTaskFromRow(row: AdminCaptureTaskRow): LogisticsCaptureAdminTask {
  const { nonce: _nonce, claimedBySessionId, ...task } = taskFromRow(row, '');
  const candidate = row.candidateId
    && row.candidateState
    && row.candidateReviewStatus
    && row.candidateResponseChecksum
    ? {
      candidateId: row.candidateId,
      state: row.candidateState,
      reviewStatus: row.candidateReviewStatus,
      responseChecksum: row.candidateResponseChecksum,
      reviewedAt: asDate(row.candidateReviewedAt),
    }
    : null;
  const completed = row.status === 'CANCELLED'
    || (row.status === 'REVIEWABLE' && candidate?.reviewStatus !== 'PENDING_REVIEW');
  const phase = row.status === 'CANCELLED'
    ? 'cancelled'
    : completed
      ? 'completed'
      : row.status === 'REVIEWABLE'
        ? 'review'
        : row.status === 'CLAIMED'
          ? 'collecting'
          : 'waiting';
  return {
    ...task,
    claimed: Boolean(claimedBySessionId),
    candidate,
    progress: {
      phase,
      completed,
      percent: row.status === 'ISSUED' ? 0 : row.status === 'CLAIMED' ? 50 : 100,
    },
  };
}

function reviewDetailFromRow(
  row: ReviewDetailRow,
): LogisticsCaptureReviewCandidateDetail {
  const normalizedPayload = row.normalizedPayload
    && typeof row.normalizedPayload === 'object'
    && !Array.isArray(row.normalizedPayload)
    ? structuredClone(row.normalizedPayload) as Record<string, unknown>
    : null;
  const diagnostics = row.diagnostics
    && typeof row.diagnostics === 'object'
    && !Array.isArray(row.diagnostics)
    ? structuredClone(row.diagnostics) as LogisticsCaptureCandidateInput['diagnostics']
    : { schema: null, historicalCountsOnly: true as const };
  return {
    candidateId: row.candidateId,
    taskId: row.taskId,
    taskKind: row.taskKind,
    taskVersion: row.taskVersion,
    tenantId: row.tenantId,
    shopId: row.shopId,
    companyId: row.companyId,
    warehouseId: row.warehouseId,
    originCountryUid: row.originCountryUid,
    originCityUid: row.originCityUid,
    destination: row.destinationCountryUid && row.destinationLocationUid
      ? { countryUid: row.destinationCountryUid, locationUid: row.destinationLocationUid }
      : null,
    state: row.state,
    reviewStatus: row.reviewStatus,
    responseChecksum: row.responseChecksum,
    previousResponseChecksum: row.previousResponseChecksum,
    receivedAt: asDate(row.receivedAt)!.toISOString(),
    sourceResponseChecksum: row.sourceResponseChecksum,
    capturedAt: asDate(row.capturedAt)?.toISOString() || null,
    quarantineReasons: [...row.quarantineReasons],
    normalizedPayload,
    diagnostics,
    reviewedById: row.reviewedById || null,
    reviewedAt: asDate(row.reviewedAt || null)?.toISOString() || null,
    reviewReason: row.reviewReason || null,
  };
}

function destinationRows(value: unknown): LogisticsCaptureAuthority['verifiedDestinations'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const verifiedAt = asDate(row.verifiedAt as Date | string | null);
    if (typeof row.countryUid !== 'string'
      || typeof row.locationUid !== 'string'
      || typeof row.catalogVersion !== 'string'
      || !verifiedAt) return [];
    return [{
      countryUid: row.countryUid,
      locationUid: row.locationUid,
      catalogVersion: row.catalogVersion,
      verifiedAt,
      invalidatedAt: asDate(row.invalidatedAt as Date | string | null),
    }];
  });
}

function authorityFromRow(row: AuthorityRow): LogisticsCaptureAuthority {
  return {
    companyBinding: {
      status: row.companyStatus,
      tenantId: row.companyTenantId,
      shopId: row.companyShopId,
      companyId: row.companyId,
      openApiVerifiedAt: asDate(row.openApiVerifiedAt),
      sellerProbeVerifiedAt: asDate(row.sellerProbeVerifiedAt),
      openApiIntersectionVerifiedAt: asDate(row.openApiIntersectionVerifiedAt),
      invalidatedAt: asDate(row.companyInvalidatedAt),
      retiredAt: asDate(row.companyRetiredAt),
    },
    originBinding: {
      status: row.originStatus,
      tenantId: row.originTenantId,
      shopId: row.originShopId,
      warehouseId: row.originWarehouseId,
      originCountryUid: row.originCountryUid,
      originCityUid: row.originCityUid,
      openApiAddressVerifiedAt: asDate(row.openApiAddressVerifiedAt),
      officialLocationVerifiedAt: asDate(row.officialLocationVerifiedAt),
      invalidatedAt: asDate(row.originInvalidatedAt),
      retiredAt: asDate(row.originRetiredAt),
    },
    verifiedDestinations: destinationRows(row.verifiedDestinations),
  };
}

function repositoryError(code: string, statusCode: number, message: string): never {
  throw new LogisticsCaptureTaskError(code, statusCode, message);
}

export type PrismaLogisticsCaptureTaskRepository = LogisticsCaptureTaskRepository
  & CaptureCandidateSetRepository;

export function createPrismaLogisticsCaptureTaskRepository(options: {
  client?: PrismaClient | SqlClient;
  claimTokenSecret?: string;
} = {}): PrismaLogisticsCaptureTaskRepository {
  const client = (options.client || prisma) as unknown as SqlClient;
  const configuredClaimTokenSecret = options.claimTokenSecret
    || process.env.EXTENSION_DEVICE_JWT_SECRET
    || '';
  const requireClaimTokenSecret = () => {
    if (configuredClaimTokenSecret.length < 32) {
      repositoryError('CAPTURE_CLAIM_TOKEN_UNAVAILABLE', 503, 'Capture claim tokens are unavailable');
    }

    return configuredClaimTokenSecret;
  };

  return {
    async loadAssignmentContext(assignmentId: string) {
      const rows = await client.$queryRawUnsafe<CandidateSetAssignmentRow[]>(
        `SELECT a."id" AS "assignmentId", c."id" AS "channelId",
                a."tenant_id" AS "tenantId", a."shop_id" AS "shopId",
                c."ozon_company_id" AS "companyId", a."warehouse_id" AS "warehouseId",
                c."origin_country_uid" AS "originCountryUid",
                c."origin_city_uid" AS "originCityUid",
                a."destination_country_uid" AS "destinationCountryUid",
                a."destination_location_uid" AS "destinationLocationUid",
                w."latitude" AS "warehouseLatitude", w."longitude" AS "warehouseLongitude",
                ob."id" AS "originBindingId", ob."verified_at" AS "originVerifiedAt"
         FROM "logistics_rule_assignments" a
         JOIN "logistics_rule_channels" c
           ON c."id" = a."channel_id"
          AND c."tenant_id" = a."tenant_id" AND c."shop_id" = a."shop_id"
          AND c."warehouse_id" = a."warehouse_id"
         JOIN "shop_ozon_company_bindings" cb
           ON cb."id" = c."company_binding_id"
          AND cb."tenant_id" = c."tenant_id" AND cb."shop_id" = c."shop_id"
          AND cb."ozon_company_id" = c."ozon_company_id"
         JOIN "warehouse_ozon_origin_bindings" ob
           ON ob."id" = c."origin_binding_id"
          AND ob."tenant_id" = c."tenant_id" AND ob."shop_id" = c."shop_id"
          AND ob."warehouse_id" = c."warehouse_id"
          AND ob."origin_country_uid" = c."origin_country_uid"
          AND ob."origin_city_uid" = c."origin_city_uid"
         JOIN "warehouses" w ON w."id" = a."warehouse_id" AND w."shop_id" = a."shop_id"
         WHERE a."id" = $1 AND a."retired_at" IS NULL AND c."retired_at" IS NULL
           AND c."channel_type" = 'TENANT'
           AND cb."status" = 'VERIFIED' AND cb."verified_at" IS NOT NULL
           AND cb."open_api_verified_at" IS NOT NULL
           AND cb."seller_probe_verified_at" IS NOT NULL
           AND cb."open_api_intersection_verified_at" IS NOT NULL
           AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
           AND ob."status" = 'VERIFIED' AND ob."verified_at" IS NOT NULL
           AND ob."open_api_address_verified_at" IS NOT NULL
           AND ob."official_location_verified_at" IS NOT NULL
           AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
           AND w."latitude" IS NOT NULL AND w."longitude" IS NOT NULL`,
        assignmentId,
      );
      const row = rows[0];
      if (!row) return null;
      const originVerifiedAt = asDate(row.originVerifiedAt);
      if (!originVerifiedAt
        || !Number.isFinite(row.warehouseLatitude)
        || !Number.isFinite(row.warehouseLongitude)) return null;
      const context: CaptureCandidateSetAssignmentContext = {
        assignmentId: row.assignmentId,
        channelId: row.channelId,
        scope: {
          tenantId: row.tenantId,
          shopId: row.shopId,
          companyId: row.companyId,
          warehouseId: row.warehouseId,
          originCountryUid: row.originCountryUid,
          originCityUid: row.originCityUid,
        },
        destination: {
          countryUid: row.destinationCountryUid,
          locationUid: row.destinationLocationUid,
        },
        warehousePoint: {
          latitude: row.warehouseLatitude,
          longitude: row.warehouseLongitude,
        },
        originBindingId: row.originBindingId,
        originVerifiedAt,
      };
      return context;
    },

    async loadVerifiedOfficialInputUnitContract(input) {
      const rows = await client.$queryRawUnsafe<OfficialInputUnitContractRow[]>(
        `/* official-input-unit:capture-loader */
         SELECT u."id", u."tenant_id" AS "tenantId", u."shop_id" AS "shopId",
                u."company_id" AS "companyId", u."warehouse_id" AS "warehouseId",
                u."origin_country_uid" AS "originCountryUid",
                u."origin_city_uid" AS "originCityUid",
                u."destination_country_uid" AS "destinationCountryUid",
                u."destination_location_uid" AS "destinationLocationUid",
                u."currency", u."weight_unit" AS "weightUnit",
                u."dimension_unit" AS "dimensionUnit",
                u."weight_increment_g" AS "weightIncrementG",
                u."dimension_increment_mm" AS "dimensionIncrementMm",
                u."currency_minor_increment" AS "currencyMinorIncrement",
                u."source_revision" AS "sourceRevision",
                u."source_checksum" AS "sourceChecksum",
                u."reviewer_id" AS "reviewerId",
                u."verified_at" AS "verifiedAt", u."valid_until" AS "validUntil"
         FROM "logistics_official_input_unit_contracts" u
         JOIN "logistics_rule_assignments" a
           ON a."id" = u."assignment_id"
          AND a."tenant_id" = u."tenant_id" AND a."shop_id" = u."shop_id"
          AND a."warehouse_id" = u."warehouse_id" AND a."channel_id" = u."channel_id"
         JOIN "logistics_rule_channels" ch
           ON ch."id" = u."channel_id"
          AND ch."tenant_id" = u."tenant_id" AND ch."shop_id" = u."shop_id"
          AND ch."warehouse_id" = u."warehouse_id"
          AND ch."ozon_company_id" = u."company_id"
          AND ch."origin_country_uid" = u."origin_country_uid"
          AND ch."origin_city_uid" = u."origin_city_uid"
         JOIN "shop_ozon_company_bindings" cb
           ON cb."id" = ch."company_binding_id"
          AND cb."tenant_id" = ch."tenant_id" AND cb."shop_id" = ch."shop_id"
          AND cb."ozon_company_id" = ch."ozon_company_id"
         JOIN "warehouse_ozon_origin_bindings" ob
           ON ob."id" = ch."origin_binding_id"
          AND ob."tenant_id" = ch."tenant_id" AND ob."shop_id" = ch."shop_id"
          AND ob."warehouse_id" = ch."warehouse_id"
          AND ob."origin_country_uid" = ch."origin_country_uid"
          AND ob."origin_city_uid" = ch."origin_city_uid"
         JOIN "logistics_capture_candidates" c
           ON c."id" = u."source_candidate_id"
          AND c."tenant_id" = u."tenant_id" AND c."shop_id" = u."shop_id"
          AND c."company_id" = u."company_id" AND c."warehouse_id" = u."warehouse_id"
          AND c."origin_country_uid" = u."origin_country_uid"
          AND c."origin_city_uid" = u."origin_city_uid"
          AND c."destination_country_uid" = u."destination_country_uid"
          AND c."destination_location_uid" = u."destination_location_uid"
          AND c."response_checksum" = u."source_candidate_checksum"
         WHERE u."assignment_id" = $1
           AND u."tenant_id" = $2 AND u."shop_id" = $3 AND u."company_id" = $4
           AND u."warehouse_id" = $5 AND u."origin_country_uid" = $6
           AND u."origin_city_uid" = $7 AND u."destination_country_uid" = $8
           AND u."destination_location_uid" = $9
           AND u."revoked_at" IS NULL
           AND u."verified_at" <= $10 AND u."valid_until" > $10
           AND ($11::text IS NULL OR u."source_revision" = $11)
           AND ($12::text IS NULL OR u."source_checksum" = $12)
           AND a."retired_at" IS NULL AND ch."retired_at" IS NULL
           AND ch."channel_type" = 'TENANT'
           AND cb."status" = 'VERIFIED' AND cb."verified_at" IS NOT NULL
           AND cb."open_api_verified_at" IS NOT NULL
           AND cb."seller_probe_verified_at" IS NOT NULL
           AND cb."open_api_intersection_verified_at" IS NOT NULL
           AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
           AND ob."status" = 'VERIFIED' AND ob."verified_at" IS NOT NULL
           AND ob."open_api_address_verified_at" IS NOT NULL
           AND ob."official_location_verified_at" IS NOT NULL
           AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
           AND c."task_kind" = 'OFFICIAL' AND c."state" = 'CAPTURED'
           AND c."review_status" = 'VERIFIED'
           AND NOT EXISTS (
             SELECT 1 FROM "logistics_official_input_unit_contracts" successor
             WHERE successor."supersedes_id" = u."id"
           )
         ORDER BY u."verified_at" DESC, u."id" DESC
         LIMIT 2`,
        input.assignmentId, input.scope.tenantId, input.scope.shopId, input.scope.companyId,
        input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
        input.destination.countryUid, input.destination.locationUid, input.at,
        input.sourceRevision || null, input.sourceChecksum || null,
      );
      if (rows.length > 1) {
        repositoryError(
          'CAPTURE_INPUT_UNIT_CONTRACT_CORRUPT',
          500,
          'Official input-unit contract chain is ambiguous',
        );
      }
      const row = rows[0];
      if (!row) return null;
      const verifiedAt = asDate(row.verifiedAt);
      const validUntil = asDate(row.validUntil);
      if (!verifiedAt || !validUntil) {
        repositoryError(
          'CAPTURE_INPUT_UNIT_CONTRACT_CORRUPT',
          500,
          'Official input-unit contract timestamps are invalid',
        );
      }
      return {
        id: row.id,
        status: 'VERIFIED',
        scope: {
          tenantId: row.tenantId,
          shopId: row.shopId,
          companyId: row.companyId,
          warehouseId: row.warehouseId,
          originCountryUid: row.originCountryUid,
          originCityUid: row.originCityUid,
        },
        destination: {
          countryUid: row.destinationCountryUid,
          locationUid: row.destinationLocationUid,
        },
        currency: row.currency,
        weightUnit: row.weightUnit,
        dimensionUnit: row.dimensionUnit,
        weightIncrementG: measurementNumber(row.weightIncrementG, 'weight increment'),
        dimensionIncrementMm: measurementNumber(row.dimensionIncrementMm, 'dimension increment'),
        currencyMinorIncrement: row.currencyMinorIncrement,
        sourceRevision: row.sourceRevision,
        sourceChecksum: row.sourceChecksum,
        reviewerId: row.reviewerId,
        verifiedAt,
        validUntil,
      };
    },

    async listVerifiedOfficialCandidates(input) {
      const rows = await client.$queryRawUnsafe<ReviewDetailRow[]>(
        `SELECT ${REVIEW_COLUMNS}
         FROM "logistics_capture_candidates" c
         WHERE c."task_kind" = 'OFFICIAL' AND c."state" = 'CAPTURED'
           AND c."review_status" = 'VERIFIED'
           AND c."tenant_id" = $1 AND c."shop_id" = $2 AND c."company_id" = $3
           AND c."warehouse_id" = $4 AND c."origin_country_uid" = $5
           AND c."origin_city_uid" = $6 AND c."destination_country_uid" = $7
           AND c."destination_location_uid" = $8
         ORDER BY c."received_at" DESC, c."id" ASC
         LIMIT $9`,
        input.scope.tenantId, input.scope.shopId, input.scope.companyId,
        input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
        input.destination.countryUid, input.destination.locationUid,
        Math.min(Math.max(input.limit, 1), 1000),
      );
      return rows.map(reviewDetailFromRow);
    },

    async createCandidateSet(input) {
      return serializable(client, async (tx) => {
        const officialIds = input.officialCandidates.map((item) => item.candidateId);
        const inserted = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `INSERT INTO "logistics_capture_candidate_sets" (
             "id", "tenant_id", "shop_id", "company_id", "warehouse_id",
             "origin_country_uid", "origin_city_uid", "destination_country_uid",
             "destination_location_uid", "assignment_id", "channel_id",
             "seller_candidate_id", "official_candidate_ids", "selected_service_keys",
             "default_service_keys", "matrix_input", "validation_matrix", "point_evidence",
             "content_checksum", "min_extension_version", "created_by_id", "created_at"
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[],
             $14::text[], $15::text[], $16::jsonb, $17::jsonb, $18::jsonb,
             $19, $20, $21, $22
           ) ON CONFLICT DO NOTHING RETURNING "id"`,
          input.id, input.scope.tenantId, input.scope.shopId, input.scope.companyId,
          input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
          input.destination.countryUid, input.destination.locationUid, input.assignmentId,
          input.channelId, input.sellerCandidateId, officialIds, input.selectedServiceKeys,
          input.defaultServiceKeys, JSON.stringify(input.matrixInput),
          JSON.stringify(input.validationMatrix), JSON.stringify(input.pointEvidence),
          input.contentChecksum, input.minExtensionVersion, input.createdById,
          new Date(input.createdAt),
        );
        if (inserted[0]) {
          await tx.$queryRawUnsafe(
            `INSERT INTO "logistics_capture_candidate_set_officials" (
               "candidate_set_id", "official_candidate_id", "tenant_id", "shop_id",
               "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
               "fingerprint_key", "response_checksum"
             )
             SELECT $1, member."candidateId", $2, $3, $4, $5, $6, $7,
                    member."fingerprintKey", member."responseChecksum"
             FROM unnest($8::text[], $9::text[], $10::text[])
               AS member("candidateId", "fingerprintKey", "responseChecksum")`,
            input.id, input.scope.tenantId, input.scope.shopId, input.scope.companyId,
            input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
            officialIds,
            input.officialCandidates.map((item) => item.fingerprintKey),
            input.officialCandidates.map((item) => item.responseChecksum),
          );
          return { candidateSet: structuredClone(input), duplicate: false };
        }
        const existing = await loadCandidateSet(tx, { contentChecksum: input.contentChecksum });
        if (!existing) {
          repositoryError('CAPTURE_CANDIDATE_SET_CONFLICT', 409,
            'Another candidate set already uses this reviewed source');
        }
        return { candidateSet: existing, duplicate: true };
      });
    },

    getCandidateSet(candidateSetId: string) {
      return loadCandidateSet(client, { id: candidateSetId });
    },

    async resolveCaptureAuthority(scope: LogisticsCaptureScope) {
      const rows = await client.$queryRawUnsafe<AuthorityRow[]>(
        `SELECT cb."status"::text AS "companyStatus", cb."tenant_id" AS "companyTenantId",
                cb."shop_id" AS "companyShopId", cb."ozon_company_id" AS "companyId",
                cb."open_api_verified_at" AS "openApiVerifiedAt",
                cb."seller_probe_verified_at" AS "sellerProbeVerifiedAt",
                cb."open_api_intersection_verified_at" AS "openApiIntersectionVerifiedAt",
                cb."invalidated_at" AS "companyInvalidatedAt", cb."retired_at" AS "companyRetiredAt",
                ob."status"::text AS "originStatus", ob."tenant_id" AS "originTenantId",
                ob."shop_id" AS "originShopId", ob."warehouse_id" AS "originWarehouseId",
                ob."origin_country_uid" AS "originCountryUid", ob."origin_city_uid" AS "originCityUid",
                ob."open_api_address_verified_at" AS "openApiAddressVerifiedAt",
                ob."official_location_verified_at" AS "officialLocationVerifiedAt",
                ob."invalidated_at" AS "originInvalidatedAt", ob."retired_at" AS "originRetiredAt",
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                    'countryUid', a."destination_country_uid",
                    'locationUid', a."destination_location_uid",
                    'catalogVersion', COALESCE(a."updated_at"::text, a."created_at"::text),
                    'verifiedAt', a."created_at", 'invalidatedAt', a."retired_at"
                  ) ORDER BY a."destination_country_uid", a."destination_location_uid")
                  FROM "logistics_rule_assignments" a
                  JOIN "logistics_rule_channels" c ON c."id" = a."channel_id"
                  WHERE a."tenant_id" = $1 AND a."shop_id" = $2 AND a."warehouse_id" = $4
                    AND c."ozon_company_id" = $3
                    AND c."origin_country_uid" = $5 AND c."origin_city_uid" = $6
                    AND a."retired_at" IS NULL
                ), '[]'::jsonb) AS "verifiedDestinations"
         FROM "shop_ozon_company_bindings" cb
         JOIN "warehouse_ozon_origin_bindings" ob
           ON ob."tenant_id" = cb."tenant_id" AND ob."shop_id" = cb."shop_id"
         JOIN "shops" sh ON sh."id" = cb."shop_id" AND sh."user_id" = cb."tenant_id"
         JOIN "warehouses" w ON w."id" = ob."warehouse_id" AND w."shop_id" = ob."shop_id"
         WHERE cb."tenant_id" = $1 AND cb."shop_id" = $2 AND cb."ozon_company_id" = $3
           AND ob."warehouse_id" = $4 AND ob."origin_country_uid" = $5
           AND ob."origin_city_uid" = $6
         ORDER BY cb."created_at" DESC, ob."created_at" DESC LIMIT 1`,
        scope.tenantId, scope.shopId, scope.companyId, scope.warehouseId,
        scope.originCountryUid, scope.originCityUid,
      );
      return rows[0] ? authorityFromRow(rows[0]) : null;
    },

    async listCaptureTasks(input) {
      const rows = await client.$queryRawUnsafe<AdminCaptureTaskRow[]>(
        `SELECT ${TASK_COLUMNS},
                c."state"::text AS "candidateState",
                c."review_status"::text AS "candidateReviewStatus",
                c."response_checksum" AS "candidateResponseChecksum",
                c."reviewed_at" AS "candidateReviewedAt"
         FROM "logistics_capture_tasks" t
         LEFT JOIN "logistics_capture_candidates" c ON c."id" = t."candidate_id"
         WHERE ($1::text IS NULL OR t."tenant_id" = $1)
           AND ($2::text IS NULL OR t."shop_id" = $2)
           AND ($3::text IS NULL OR t."status"::text = $3)
         ORDER BY t."issued_at" DESC, t."id" DESC
         LIMIT $4`,
        input.tenantId || null, input.shopId || null, input.status || null, input.limit,
      );
      return rows.map(adminTaskFromRow);
    },

    async getCaptureTaskForAdmin(taskId) {
      const rows = await client.$queryRawUnsafe<AdminCaptureTaskRow[]>(
        `SELECT ${TASK_COLUMNS},
                c."state"::text AS "candidateState",
                c."review_status"::text AS "candidateReviewStatus",
                c."response_checksum" AS "candidateResponseChecksum",
                c."reviewed_at" AS "candidateReviewedAt"
         FROM "logistics_capture_tasks" t
         LEFT JOIN "logistics_capture_candidates" c ON c."id" = t."candidate_id"
         WHERE t."id" = $1
         LIMIT 1`,
        taskId,
      );
      return rows[0] ? adminTaskFromRow(rows[0]) : null;
    },

    async listPendingCaptureTasks(input) {
      const secret = requireClaimTokenSecret();
      if (input.device.ownerUserId.length === 0 || input.device.allowedShopIds.length === 0) {
        return [];
      }
      const rows = await client.$queryRawUnsafe<CaptureTaskRow[]>(
        `SELECT ${TASK_COLUMNS}
         FROM "logistics_capture_tasks" t
         JOIN "extension_device_sessions" s
           ON s."id" = $1 AND s."owner_user_id" = t."tenant_id"
          AND s."status" = 'ACTIVE' AND s."expires_at" > $3
         JOIN "extension_device_shop_grants" sg
           ON sg."session_id" = s."id" AND sg."shop_id" = t."shop_id"
          AND sg."status" = 'ACTIVE'
         WHERE t."tenant_id" = $2
           AND t."shop_id" = ANY($4::text[])
           AND t."status" IN ('ISSUED', 'CLAIMED')
           AND t."expires_at" > $3
           AND (t."claimed_by_session_id" IS NULL OR t."claimed_by_session_id" = s."id")
         ORDER BY t."issued_at" ASC, t."id" ASC
         LIMIT $5`,
        input.device.sessionId,
        input.device.ownerUserId,
        input.now,
        input.device.allowedShopIds,
        input.limit,
      );
      return rows.map((row) => {
        const withNonce = taskFromRow(row, '');
        const { nonce: _nonce, ...publicTask } = withNonce;
        return {
          ...publicTask,
          claimToken: issueClaimToken(secret, row, input.device.sessionId),
        };
      });
    },

    async createCaptureTask(task) {
      const rows = await client.$queryRawUnsafe<CaptureTaskRow[]>(
        `INSERT INTO "logistics_capture_tasks" (
           "id", "version", "kind", "requested_by_user_id", "tenant_id", "shop_id",
           "company_id", "warehouse_id", "origin_country_uid", "origin_city_uid",
           "company_binding_id", "origin_binding_id", "destination_country_uid",
           "destination_location_uid", "official_fingerprint", "expected_endpoints",
           "fingerprint_checksum", "nonce_digest", "status", "issued_at", "expires_at",
           "created_at", "updated_at"
         )
         SELECT $1, $2, $3::"LogisticsCaptureTaskKind", $4, $5, $6, $7, $8, $9, $10,
                cb."id", ob."id", $11, $12, $13::jsonb, $14::text[], $15, $16,
                'ISSUED', $17, $18, $17, $17
         FROM "shop_ozon_company_bindings" cb
         JOIN "warehouse_ozon_origin_bindings" ob
           ON ob."tenant_id" = cb."tenant_id" AND ob."shop_id" = cb."shop_id"
         JOIN "shops" sh ON sh."id" = cb."shop_id" AND sh."user_id" = cb."tenant_id"
         JOIN "warehouses" w ON w."id" = ob."warehouse_id" AND w."shop_id" = ob."shop_id"
         WHERE cb."tenant_id" = $5 AND cb."shop_id" = $6 AND cb."ozon_company_id" = $7
           AND cb."status" = 'VERIFIED' AND cb."open_api_verified_at" IS NOT NULL
           AND cb."seller_probe_verified_at" IS NOT NULL
           AND cb."open_api_intersection_verified_at" IS NOT NULL
           AND cb."invalidated_at" IS NULL AND cb."retired_at" IS NULL
           AND ob."warehouse_id" = $8 AND ob."origin_country_uid" = $9
           AND ob."origin_city_uid" = $10 AND ob."status" = 'VERIFIED'
           AND ob."open_api_address_verified_at" IS NOT NULL
           AND ob."official_location_verified_at" IS NOT NULL
           AND ob."invalidated_at" IS NULL AND ob."retired_at" IS NULL
           AND ($3::"LogisticsCaptureTaskKind" = 'SELLER' OR EXISTS (
             SELECT 1 FROM "logistics_rule_assignments" a
             JOIN "logistics_rule_channels" c ON c."id" = a."channel_id"
             WHERE a."tenant_id" = $5 AND a."shop_id" = $6 AND a."warehouse_id" = $8
               AND c."ozon_company_id" = $7 AND c."origin_country_uid" = $9
               AND c."origin_city_uid" = $10
               AND a."destination_country_uid" = $11
               AND a."destination_location_uid" = $12 AND a."retired_at" IS NULL
           ))
         ORDER BY cb."created_at" DESC, ob."created_at" DESC LIMIT 1
         RETURNING ${TASK_COLUMNS.replaceAll('t."', '"')}`,
        task.id, task.version, task.kind, task.requestedByUserId,
        task.scope.tenantId, task.scope.shopId, task.scope.companyId, task.scope.warehouseId,
        task.scope.originCountryUid, task.scope.originCityUid,
        task.destination?.countryUid || null, task.destination?.locationUid || null,
        task.officialFingerprint ? JSON.stringify(task.officialFingerprint) : null,
        task.expectedEndpoints, task.fingerprintChecksum, nonceDigest(task.nonce),
        task.issuedAt, task.expiresAt,
      );
      if (!rows[0]) {
        repositoryError('CAPTURE_BINDING_NOT_VERIFIED', 409,
          'Company and origin bindings must be independently verified');
      }
      return taskFromRow(rows[0], task.nonce);
    },

    async findCaptureTask(taskId, proof) {
      if (!proof) {
        const rows = await client.$queryRawUnsafe<CaptureTaskRow[]>(
          `SELECT ${TASK_COLUMNS} FROM "logistics_capture_tasks" t WHERE t."id" = $1 LIMIT 1`,
          taskId,
        );
        return rows[0] ? taskFromRow(rows[0], '') : null;
      }
      const digest = proof.nonce ? nonceDigest(proof.nonce) : null;
      const values: unknown[] = [
        taskId, digest, proof.scope.tenantId, proof.scope.shopId, proof.scope.companyId,
        proof.scope.warehouseId, proof.scope.originCountryUid, proof.scope.originCityUid,
      ];
      let deviceJoin = '';
      let deviceWhere = '';
      if (proof.device) {
        values.push(proof.device.sessionId, proof.device.ownerUserId,
          proof.device.allowedShopIds, proof.now);
        deviceJoin = `
          JOIN "extension_device_sessions" s
            ON s."id" = t."claimed_by_session_id" AND s."id" = $9
          JOIN "extension_device_shop_grants" sg
            ON sg."session_id" = s."id" AND sg."shop_id" = t."shop_id"
           AND sg."status" = 'ACTIVE'`;
        deviceWhere = `
          AND s."owner_user_id" = $10 AND s."owner_user_id" = t."tenant_id"
          AND s."status" = 'ACTIVE' AND s."expires_at" > $12
          AND t."shop_id" = ANY($11::text[])
          AND t."status" IN ('CLAIMED', 'REVIEWABLE')`;
      } else {
        deviceWhere = `AND t."status" IN ('ISSUED', 'CLAIMED', 'REVIEWABLE')`;
      }
      const rows = await client.$queryRawUnsafe<CaptureTaskRow[]>(
        `SELECT ${TASK_COLUMNS}
         FROM "logistics_capture_tasks" t
         ${deviceJoin}
         WHERE t."id" = $1 AND ($2::text IS NULL OR t."nonce_digest" = $2)
           AND t."tenant_id" = $3 AND t."shop_id" = $4 AND t."company_id" = $5
           AND t."warehouse_id" = $6 AND t."origin_country_uid" = $7
           AND t."origin_city_uid" = $8
           ${deviceWhere}
         LIMIT 1`,
        ...values,
      );
      const row = rows[0];
      if (!row) return null;
      if (proof.claimToken
        && (!proof.device
          || !proofMatches(configuredClaimTokenSecret, row, proof.device, proof))) return null;
      return taskFromRow(row, proof.nonce || '');
    },

    async claimCaptureTask(input): Promise<LogisticsCaptureClaimResult> {
      if (input.scope.tenantId !== input.device.ownerUserId
        || !input.device.allowedShopIds.includes(input.scope.shopId)) {
        return { state: 'not_found' };
      }
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `SELECT ${TASK_COLUMNS}
           FROM "logistics_capture_tasks" t
           JOIN "extension_device_sessions" s ON s."id" = $9
           JOIN "extension_device_shop_grants" sg
             ON sg."session_id" = s."id" AND sg."shop_id" = t."shop_id"
            AND sg."status" = 'ACTIVE'
           WHERE t."id" = $1 AND t."version" = $2 AND ($3::text IS NULL OR t."nonce_digest" = $3)
             AND t."tenant_id" = $4 AND t."shop_id" = $5 AND t."company_id" = $6
             AND t."warehouse_id" = $7 AND t."origin_country_uid" = $8
             AND t."origin_city_uid" = $10
             AND s."owner_user_id" = $4 AND s."owner_user_id" = $11
             AND s."status" = 'ACTIVE' AND s."expires_at" > $12
             AND t."shop_id" = ANY($13::text[])
             AND t."status" IN ('ISSUED', 'CLAIMED')
             AND (t."claimed_by_session_id" IS NULL OR t."claimed_by_session_id" = s."id")
           FOR UPDATE OF t`,
          input.taskId, input.taskVersion, input.nonce ? nonceDigest(input.nonce) : null,
          input.scope.tenantId, input.scope.shopId, input.scope.companyId,
          input.scope.warehouseId, input.scope.originCountryUid,
          input.device.sessionId, input.scope.originCityUid, input.device.ownerUserId,
          input.now, input.device.allowedShopIds,
        );
        const row = rows[0];
        if (!row) return { state: 'not_found' };
        if (!proofMatches(configuredClaimTokenSecret, row, input.device, input)) {
          return { state: 'not_found' };
        }
        if (asDate(row.expiresAt)!.getTime() <= input.now.getTime()) {
          return { state: 'expired' };
        }
        if (row.status === 'CLAIMED') {
          return { state: 'claimed', duplicate: true, task: taskFromRow(row, input.nonce || '') };
        }
        const updated = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `UPDATE "logistics_capture_tasks" t
           SET "status" = 'CLAIMED', "claimed_by_session_id" = $1,
               "claimed_at" = $2, "updated_at" = $2
           WHERE t."id" = $3 AND t."status" = 'ISSUED'
             AND t."claimed_by_session_id" IS NULL
           RETURNING ${TASK_COLUMNS.replaceAll('t."', '"')}`,
          input.device.sessionId, input.now, input.taskId,
        );
        if (!updated[0]) throw new RetryableCaptureRace('capture task claim raced');
        return { state: 'claimed', duplicate: false, task: taskFromRow(updated[0], input.nonce || '') };
      });
    },

    async cancelCaptureTask(input): Promise<LogisticsCaptureCancelResult> {
      if (input.scope.tenantId !== input.device.ownerUserId
        || !input.device.allowedShopIds.includes(input.scope.shopId)) {
        return { state: 'not_found' };
      }
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `SELECT ${TASK_COLUMNS}
           FROM "logistics_capture_tasks" t
           JOIN "extension_device_sessions" s
             ON s."id" = t."claimed_by_session_id" AND s."id" = $9
           JOIN "extension_device_shop_grants" sg
             ON sg."session_id" = s."id" AND sg."shop_id" = t."shop_id"
            AND sg."status" = 'ACTIVE'
           WHERE t."id" = $1 AND t."version" = $2
             AND ($3::text IS NULL OR t."nonce_digest" = $3)
             AND t."tenant_id" = $4 AND t."shop_id" = $5 AND t."company_id" = $6
             AND t."warehouse_id" = $7 AND t."origin_country_uid" = $8
             AND t."origin_city_uid" = $10
             AND s."owner_user_id" = $4 AND s."owner_user_id" = $11
             AND s."status" = 'ACTIVE' AND s."expires_at" > $12
             AND t."shop_id" = ANY($13::text[])
             AND t."status" IN ('CLAIMED', 'CANCELLED')
           FOR UPDATE OF t`,
          input.taskId,
          input.taskVersion,
          input.nonce ? nonceDigest(input.nonce) : null,
          input.scope.tenantId,
          input.scope.shopId,
          input.scope.companyId,
          input.scope.warehouseId,
          input.scope.originCountryUid,
          input.device.sessionId,
          input.scope.originCityUid,
          input.device.ownerUserId,
          input.now,
          input.device.allowedShopIds,
        );
        const row = rows[0];
        if (!row || !proofMatches(configuredClaimTokenSecret, row, input.device, input)) {
          return { state: 'not_found' };
        }
        if (asDate(row.expiresAt)!.getTime() <= input.now.getTime()) {
          return { state: 'expired' };
        }
        if (row.status === 'CANCELLED') {
          return {
            state: 'cancelled',
            duplicate: true,
            task: taskFromRow(row, input.nonce || ''),
          };
        }
        const updated = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `UPDATE "logistics_capture_tasks" t
           SET "status" = 'CANCELLED', "cancelled_at" = $1, "updated_at" = $1
           WHERE t."id" = $2 AND t."status" = 'CLAIMED'
             AND t."claimed_by_session_id" = $3
           RETURNING ${TASK_COLUMNS.replaceAll('t."', '"')}`,
          input.now,
          input.taskId,
          input.device.sessionId,
        );
        if (!updated[0]) throw new RetryableCaptureRace('capture task cancellation raced');
        return {
          state: 'cancelled',
          duplicate: false,
          task: taskFromRow(updated[0], input.nonce || ''),
        };
      });
    },

    async cancelCaptureTaskAsAdmin(input): Promise<LogisticsCaptureCancelResult> {
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `SELECT ${TASK_COLUMNS}
           FROM "logistics_capture_tasks" t
           WHERE t."id" = $1 AND t."status" IN ('ISSUED', 'CLAIMED', 'CANCELLED')
           FOR UPDATE OF t`,
          input.taskId,
        );
        const row = rows[0];
        if (!row) return { state: 'not_found' };
        if (asDate(row.expiresAt)!.getTime() <= input.now.getTime()) {
          return { state: 'expired' };
        }
        if (row.status === 'CANCELLED') {
          return { state: 'cancelled', duplicate: true, task: taskFromRow(row, '') };
        }
        const updated = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `UPDATE "logistics_capture_tasks" t
           SET "status" = 'CANCELLED', "cancelled_at" = $1, "updated_at" = $1
           WHERE t."id" = $2 AND t."status" IN ('ISSUED', 'CLAIMED')
           RETURNING ${TASK_COLUMNS.replaceAll('t."', '"')}`,
          input.now,
          input.taskId,
        );
        if (!updated[0]) throw new RetryableCaptureRace('admin capture task cancellation raced');
        return {
          state: 'cancelled',
          duplicate: false,
          task: taskFromRow(updated[0], ''),
        };
      });
    },

    async persistCaptureCandidate(
      input: LogisticsCaptureCandidateInput,
    ): Promise<LogisticsCapturePersistenceResult> {
      if (!input.deviceSessionId || !input.deviceOwnerUserId
        || input.scope.tenantId !== input.deviceOwnerUserId
        || !input.allowedShopIds.includes(input.scope.shopId)) {
        repositoryError('CAPTURE_TASK_MISMATCH', 404, 'Capture task is unavailable');
      }
      return serializable(client, async (tx) => {
        const taskRows = await tx.$queryRawUnsafe<CaptureTaskRow[]>(
          `SELECT ${TASK_COLUMNS}
           FROM "logistics_capture_tasks" t
           JOIN "extension_device_sessions" s
             ON s."id" = t."claimed_by_session_id" AND s."id" = $2
           JOIN "extension_device_shop_grants" sg
             ON sg."session_id" = s."id" AND sg."shop_id" = t."shop_id"
            AND sg."status" = 'ACTIVE'
           WHERE t."id" = $1 AND t."tenant_id" = $3 AND t."shop_id" = $4
             AND t."company_id" = $5 AND t."warehouse_id" = $6
             AND t."origin_country_uid" = $7 AND t."origin_city_uid" = $8
             AND s."owner_user_id" = $3 AND s."owner_user_id" = $9
             AND s."status" = 'ACTIVE' AND s."expires_at" > $10
             AND t."shop_id" = ANY($11::text[])
             AND t."status" IN ('CLAIMED', 'REVIEWABLE')
           FOR UPDATE OF t`,
          input.taskId, input.deviceSessionId, input.scope.tenantId, input.scope.shopId,
          input.scope.companyId, input.scope.warehouseId, input.scope.originCountryUid,
          input.scope.originCityUid, input.deviceOwnerUserId, input.receivedAt,
          input.allowedShopIds,
        );
        const task = taskRows[0];
        if (!task) repositoryError('CAPTURE_TASK_MISMATCH', 404, 'Capture task is unavailable');
        if (asDate(task.expiresAt)!.getTime() <= input.receivedAt.getTime()) {
          repositoryError('CAPTURE_TASK_EXPIRED', 410, 'Capture task has expired');
        }

        if (task.status === 'REVIEWABLE' && task.candidateId) {
          const existing = await tx.$queryRawUnsafe<CandidateRow[]>(
            `SELECT "id", "state"::text AS "state",
                    "fingerprint_checksum" AS "fingerprintChecksum",
                    "response_checksum" AS "responseChecksum",
                    "previous_response_checksum" AS "previousResponseChecksum"
             FROM "logistics_capture_candidates" WHERE "id" = $1`, task.candidateId,
          );
          if (existing[0]
            && existing[0].fingerprintChecksum === input.fingerprintChecksum
            && existing[0].responseChecksum === input.responseChecksum) {
            return { kind: 'duplicate', candidateId: existing[0].id, state: existing[0].state };
          }
          repositoryError('CAPTURE_TASK_ALREADY_UPLOADED', 409,
            'Capture task already contains another upload');
        }

        const duplicates = await tx.$queryRawUnsafe<CandidateRow[]>(
          `SELECT "id", "state"::text AS "state",
                  "fingerprint_checksum" AS "fingerprintChecksum",
                  "response_checksum" AS "responseChecksum",
                  "previous_response_checksum" AS "previousResponseChecksum"
           FROM "logistics_capture_candidates"
           WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "company_id" = $3
             AND "warehouse_id" = $4 AND "origin_country_uid" = $5
             AND "origin_city_uid" = $6 AND "fingerprint_checksum" = $7
             AND "response_checksum" = $8 LIMIT 1`,
          input.scope.tenantId, input.scope.shopId, input.scope.companyId,
          input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
          input.fingerprintChecksum, input.responseChecksum,
        );
        let candidate = duplicates[0];
        let previousResponseChecksum: string | null = null;
        if (!candidate) {
          const previous = await tx.$queryRawUnsafe<Array<{ responseChecksum: string }>>(
            `SELECT "response_checksum" AS "responseChecksum"
             FROM "logistics_capture_candidates"
             WHERE "tenant_id" = $1 AND "shop_id" = $2 AND "company_id" = $3
               AND "warehouse_id" = $4 AND "origin_country_uid" = $5
               AND "origin_city_uid" = $6 AND "fingerprint_checksum" = $7
             ORDER BY "received_at" DESC, "id" DESC LIMIT 1`,
            input.scope.tenantId, input.scope.shopId, input.scope.companyId,
            input.scope.warehouseId, input.scope.originCountryUid, input.scope.originCityUid,
            input.fingerprintChecksum,
          );
          previousResponseChecksum = previous[0]?.responseChecksum || null;
          const inserted = await tx.$queryRawUnsafe<CandidateRow[]>(
            `INSERT INTO "logistics_capture_candidates" (
               "id", "source_task_id", "task_kind", "tenant_id", "shop_id", "company_id",
               "warehouse_id", "origin_country_uid", "origin_city_uid",
               "destination_country_uid", "destination_location_uid", "fingerprint_checksum",
               "response_checksum", "source_response_checksum", "previous_response_checksum",
               "captured_at", "received_at", "state", "review_status", "source_trust",
               "quarantine_reasons", "normalized_payload", "diagnostics", "task_version", "created_at"
             ) VALUES (
               $1, $2, $3::"LogisticsCaptureTaskKind", $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, $14, $15, $16, $17,
               $18::"LogisticsCaptureCandidateState", 'PENDING_REVIEW', $19,
               $20::text[], $21::jsonb, $22::jsonb, $23, $17
             )
             ON CONFLICT (
               "tenant_id", "shop_id", "company_id", "warehouse_id",
               "origin_country_uid", "origin_city_uid", "fingerprint_checksum",
               "response_checksum"
             ) DO NOTHING
             RETURNING "id", "state"::text AS "state",
                       "fingerprint_checksum" AS "fingerprintChecksum",
                       "response_checksum" AS "responseChecksum",
                       "previous_response_checksum" AS "previousResponseChecksum"`,
            randomUUID(), input.taskId, input.taskKind, input.scope.tenantId, input.scope.shopId,
            input.scope.companyId, input.scope.warehouseId, input.scope.originCountryUid,
            input.scope.originCityUid, input.destination?.countryUid || null,
            input.destination?.locationUid || null, input.fingerprintChecksum,
            input.responseChecksum, input.sourceResponseChecksum, previousResponseChecksum,
            input.capturedAt, input.receivedAt, input.state, input.sourceTrust,
            input.quarantineReasons,
            input.normalizedPayload ? JSON.stringify(input.normalizedPayload) : null,
            JSON.stringify(input.diagnostics), input.taskVersion,
          );
          candidate = inserted[0];
          if (!candidate) throw new RetryableCaptureRace('capture candidate insert raced');
        }

        const updated = await tx.$executeRawUnsafe(
          `UPDATE "logistics_capture_tasks"
           SET "status" = 'REVIEWABLE', "candidate_id" = $1,
               "uploaded_at" = $2, "reviewable_at" = $2, "updated_at" = $2
           WHERE "id" = $3 AND "status" = 'CLAIMED'
             AND "claimed_by_session_id" = $4 AND "candidate_id" IS NULL`,
          candidate.id, input.receivedAt, input.taskId, input.deviceSessionId,
        );
        if (updated !== 1) throw new RetryableCaptureRace('capture upload raced');
        return duplicates[0]
          ? { kind: 'duplicate', candidateId: candidate.id, state: candidate.state }
          : {
            kind: 'created', candidateId: candidate.id, state: candidate.state,
            previousResponseChecksum,
          };
      });
    },

    async getCaptureCandidate(
      candidateId: string,
    ): Promise<LogisticsCaptureReviewCandidateDetail | null> {
      const rows = await client.$queryRawUnsafe<ReviewDetailRow[]>(
        `SELECT ${REVIEW_COLUMNS}
         FROM "logistics_capture_candidates" c
         WHERE c."id" = $1
         LIMIT 1`,
        candidateId,
      );
      return rows[0] ? reviewDetailFromRow(rows[0]) : null;
    },

    async reviewCaptureCandidate(input): Promise<LogisticsCaptureReviewResult> {
      return serializable(client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ReviewDetailRow[]>(
          `SELECT ${REVIEW_COLUMNS}
           FROM "logistics_capture_candidates" c
           WHERE c."id" = $1
           FOR UPDATE OF c`,
          input.candidateId,
        );
        const current = rows[0];
        if (!current) return { state: 'not_found' };
        if (current.reviewStatus === input.decision) {
          if (current.reviewedById !== input.actorUserId
            || current.reviewReason !== input.reason) {
            return { state: 'conflict' };
          }
          return {
            state: 'reviewed',
            duplicate: true,
            candidate: reviewDetailFromRow(current),
          };
        }
        if (current.reviewStatus !== 'PENDING_REVIEW'
          || (input.decision === 'VERIFIED' && current.state !== 'CAPTURED')) {
          return { state: 'conflict' };
        }
        const updated = await tx.$queryRawUnsafe<ReviewDetailRow[]>(
          `UPDATE "logistics_capture_candidates" c
           SET "review_status" = $1::"LogisticsCaptureReviewStatus",
               "reviewed_by_id" = $2,
               "reviewed_at" = $3,
               "review_reason" = $4
           WHERE c."id" = $5 AND c."review_status" = 'PENDING_REVIEW'
           RETURNING ${REVIEW_COLUMNS}`,
          input.decision,
          input.actorUserId,
          input.reviewedAt,
          input.reason,
          input.candidateId,
        );
        if (!updated[0]) throw new RetryableCaptureRace('capture candidate review raced');
        return {
          state: 'reviewed',
          duplicate: false,
          candidate: reviewDetailFromRow(updated[0]),
        };
      });
    },

    async listReviewableCandidates(input): Promise<LogisticsCaptureReviewCandidate[]> {
      const rows = await client.$queryRawUnsafe<ReviewRow[]>(
        `SELECT c."id" AS "candidateId", c."source_task_id" AS "taskId",
                c."task_kind"::text AS "taskKind", c."task_version" AS "taskVersion", c."tenant_id" AS "tenantId",
                c."shop_id" AS "shopId", c."company_id" AS "companyId",
                c."warehouse_id" AS "warehouseId",
                c."origin_country_uid" AS "originCountryUid",
                c."origin_city_uid" AS "originCityUid",
                c."destination_country_uid" AS "destinationCountryUid",
                c."destination_location_uid" AS "destinationLocationUid",
                c."state"::text AS "state", c."review_status"::text AS "reviewStatus",
                c."response_checksum" AS "responseChecksum",
                c."previous_response_checksum" AS "previousResponseChecksum",
                c."received_at" AS "receivedAt"
         FROM "logistics_capture_candidates" c
         WHERE c."review_status" = 'PENDING_REVIEW'
           AND ($1::text IS NULL OR c."tenant_id" = $1)
           AND ($2::text IS NULL OR c."shop_id" = $2)
         ORDER BY c."received_at" ASC, c."id" ASC LIMIT $3`,
        input.tenantId || null, input.shopId || null, input.limit,
      );
      return rows.map((row) => ({
        candidateId: row.candidateId,
        taskId: row.taskId,
        taskKind: row.taskKind,
        taskVersion: row.taskVersion,
        tenantId: row.tenantId,
        shopId: row.shopId,
        companyId: row.companyId,
        warehouseId: row.warehouseId,
        originCountryUid: row.originCountryUid,
        originCityUid: row.originCityUid,
        destination: row.destinationCountryUid && row.destinationLocationUid
          ? { countryUid: row.destinationCountryUid, locationUid: row.destinationLocationUid }
          : null,
        state: row.state,
        reviewStatus: row.reviewStatus,
        responseChecksum: row.responseChecksum,
        previousResponseChecksum: row.previousResponseChecksum,
        receivedAt: asDate(row.receivedAt)!.toISOString(),
      }));
    },
    async getReviewableCandidate(
      candidateId: string,
    ): Promise<LogisticsCaptureReviewCandidateDetail | null> {
      const rows = await client.$queryRawUnsafe<ReviewDetailRow[]>(
        `SELECT c."id" AS "candidateId", c."source_task_id" AS "taskId",
                c."task_kind"::text AS "taskKind", c."task_version" AS "taskVersion", c."tenant_id" AS "tenantId",
                c."shop_id" AS "shopId", c."company_id" AS "companyId",
                c."warehouse_id" AS "warehouseId",
                c."origin_country_uid" AS "originCountryUid",
                c."origin_city_uid" AS "originCityUid",
                c."destination_country_uid" AS "destinationCountryUid",
                c."destination_location_uid" AS "destinationLocationUid",
                c."state"::text AS "state", c."review_status"::text AS "reviewStatus",
                c."response_checksum" AS "responseChecksum",
                c."source_response_checksum" AS "sourceResponseChecksum",
                c."previous_response_checksum" AS "previousResponseChecksum",
                c."captured_at" AS "capturedAt", c."received_at" AS "receivedAt",
                c."quarantine_reasons" AS "quarantineReasons",
                c."normalized_payload" AS "normalizedPayload",
                c."diagnostics" AS "diagnostics",
                c."reviewed_by_id" AS "reviewedById",
                c."reviewed_at" AS "reviewedAt",
                c."review_reason" AS "reviewReason"
         FROM "logistics_capture_candidates" c
         WHERE c."id" = $1
         LIMIT 1`,
        candidateId,
      );
      const row = rows[0];
      if (!row) return null;
      const normalizedPayload = row.normalizedPayload
        && typeof row.normalizedPayload === 'object'
        && !Array.isArray(row.normalizedPayload)
        ? structuredClone(row.normalizedPayload) as Record<string, unknown>
        : null;
      const diagnostics = row.diagnostics
        && typeof row.diagnostics === 'object'
        && !Array.isArray(row.diagnostics)
        ? structuredClone(row.diagnostics) as LogisticsCaptureCandidateInput['diagnostics']
        : { schema: null, historicalCountsOnly: true as const };
      return {
        candidateId: row.candidateId,
        taskId: row.taskId,
        taskKind: row.taskKind,
        taskVersion: row.taskVersion,
        tenantId: row.tenantId,
        shopId: row.shopId,
        companyId: row.companyId,
        warehouseId: row.warehouseId,
        originCountryUid: row.originCountryUid,
        originCityUid: row.originCityUid,
        destination: row.destinationCountryUid && row.destinationLocationUid
          ? { countryUid: row.destinationCountryUid, locationUid: row.destinationLocationUid }
          : null,
        state: row.state,
        reviewStatus: row.reviewStatus,
        responseChecksum: row.responseChecksum,
        previousResponseChecksum: row.previousResponseChecksum,
        receivedAt: asDate(row.receivedAt)!.toISOString(),
        sourceResponseChecksum: row.sourceResponseChecksum,
        capturedAt: asDate(row.capturedAt)?.toISOString() || null,
        quarantineReasons: [...row.quarantineReasons],
        normalizedPayload,
        diagnostics,
        reviewedById: row.reviewedById || null,
        reviewedAt: asDate(row.reviewedAt || null)?.toISOString() || null,
        reviewReason: row.reviewReason || null,
      };
    },
  };
}
