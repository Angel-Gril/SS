import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalStringify } from 'shared';
import {
  OfficialInputUnitContractError,
  type OfficialInputUnitContractRepository,
  type VerifyOfficialInputUnitContractInput,
} from './logistics-official-input-unit-contract.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

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

interface AssignmentRow {
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
  destinationLabel: string;
}

interface CandidateRow {
  candidateId: string;
  responseChecksum: string;
  capturedAt: Date | string | null;
  reviewedAt: Date | string | null;
  fingerprint: unknown;
  quoteCount: number;
}

interface ContractRow extends AssignmentRow {
  id: string;
  currency: string;
  weightUnit: string;
  dimensionUnit: string;
  priceInputUnit: string;
  weightIncrementG: unknown;
  dimensionIncrementMm: unknown;
  currencyMinorIncrement: number;
  sourceCandidateId: string;
  sourceCandidateChecksum: string;
  sourceRevision: string;
  sourceChecksum: string;
  reviewerId: string;
  reviewNote: string;
  verifiedAt: Date | string;
  validUntil: Date | string;
  supersedesId: string | null;
  supersededById: string | null;
  revokedAt: Date | string | null;
  revokedById: string | null;
  revocationReason: string | null;
}

interface CreateRepositoryOptions {
  client: SqlClient;
  id?: () => string;
  eventId?: () => string;
}

function repositoryError(code: string, message: string, statusCode = 409): never {
  throw new OfficialInputUnitContractError(code, message, statusCode);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}


function measurementNumber(value: unknown, field: string): number {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(String(value));
  } catch {
    return repositoryError(
      'INPUT_UNIT_CONTRACT_CORRUPT',
      `Official input-unit ${field} is not numeric`,
      500,
    );
  }
  const result = decimal.toNumber();
  if (
    !Number.isFinite(result) ||
    result <= 0 ||
    result >= 100_000_000_000 ||
    decimal.decimalPlaces() > 9 ||
    !decimal.equals(new Prisma.Decimal(String(result)))
  ) {
    return repositoryError(
      'INPUT_UNIT_CONTRACT_CORRUPT',
      `Official input-unit ${field} cannot be mapped safely`,
      500,
    );
  }
  return result;
}
function scope(row: AssignmentRow) {
  return {
    tenantId: row.tenantId,
    shopId: row.shopId,
    companyId: row.companyId,
    warehouseId: row.warehouseId,
    originCountryUid: row.originCountryUid,
    originCityUid: row.originCityUid,
  };
}

function destination(row: AssignmentRow) {
  return {
    countryUid: row.destinationCountryUid,
    locationUid: row.destinationLocationUid,
  };
}

function publicAssignment(row: AssignmentRow) {
  return {
    id: row.assignmentId,
    channelId: row.channelId,
    scope: scope(row),
    destination: {
      ...destination(row),
      label: row.destinationLabel,
    },
  };
}

function contractState(row: ContractRow, at: Date) {
  if (row.revokedAt) return 'REVOKED' as const;
  if (row.supersededById) return 'SUPERSEDED' as const;
  const verifiedAt = asDate(row.verifiedAt);
  const validUntil = asDate(row.validUntil);
  if (!verifiedAt || !validUntil || verifiedAt.getTime() > at.getTime()
    || validUntil.getTime() <= at.getTime()) {
    return 'EXPIRED' as const;
  }
  return validUntil.getTime() - at.getTime() <= DAY_MS
    ? 'EXPIRING' as const
    : 'ACTIVE' as const;
}

function publicContract(row: ContractRow, at: Date) {
  const verifiedAt = asDate(row.verifiedAt);
  const validUntil = asDate(row.validUntil);
  if (!verifiedAt || !validUntil) {
    return repositoryError(
      'INPUT_UNIT_CONTRACT_CORRUPT',
      'Official input-unit contract timestamps are invalid',
      500,
    );
  }
  return {
    id: row.id,
    status: 'VERIFIED' as const,
    state: contractState(row, at),
    assignmentId: row.assignmentId,
    channelId: row.channelId,
    scope: scope(row),
    destination: destination(row),
    currency: row.currency,
    weightUnit: row.weightUnit,
    dimensionUnit: row.dimensionUnit,
    priceInputUnit: row.priceInputUnit,
    weightIncrementG: measurementNumber(row.weightIncrementG, 'weight increment'),
    dimensionIncrementMm: measurementNumber(row.dimensionIncrementMm, 'dimension increment'),
    currencyMinorIncrement: row.currencyMinorIncrement,
    sourceCandidateId: row.sourceCandidateId,
    sourceCandidateChecksum: row.sourceCandidateChecksum,
    sourceRevision: row.sourceRevision,
    sourceChecksum: row.sourceChecksum,
    reviewerId: row.reviewerId,
    reviewNote: row.reviewNote,
    verifiedAt,
    validUntil,
    supersedesId: row.supersedesId,
    revokedAt: asDate(row.revokedAt),
    revokedById: row.revokedById,
    revocationReason: row.revocationReason,
  };
}

async function loadAssignment(
  client: SqlTransaction,
  assignmentId: string,
  lock: boolean,
): Promise<AssignmentRow | null> {
  const rows = await client.$queryRawUnsafe<AssignmentRow[]>(
    `/* official-input-unit:assignment */
     SELECT a."id" AS "assignmentId", a."channel_id" AS "channelId",
            a."tenant_id" AS "tenantId", a."shop_id" AS "shopId",
            ch."ozon_company_id" AS "companyId", a."warehouse_id" AS "warehouseId",
            ch."origin_country_uid" AS "originCountryUid",
            ch."origin_city_uid" AS "originCityUid",
            a."destination_country_uid" AS "destinationCountryUid",
            a."destination_location_uid" AS "destinationLocationUid",
            a."destination_label" AS "destinationLabel"
     FROM "logistics_rule_assignments" a
     JOIN "logistics_rule_channels" ch
       ON ch."id" = a."channel_id" AND ch."tenant_id" = a."tenant_id"
      AND ch."shop_id" = a."shop_id" AND ch."warehouse_id" = a."warehouse_id"
     JOIN "shop_ozon_company_bindings" cb
       ON cb."id" = ch."company_binding_id" AND cb."tenant_id" = ch."tenant_id"
      AND cb."shop_id" = ch."shop_id" AND cb."ozon_company_id" = ch."ozon_company_id"
     JOIN "warehouse_ozon_origin_bindings" ob
       ON ob."id" = ch."origin_binding_id" AND ob."tenant_id" = ch."tenant_id"
      AND ob."shop_id" = ch."shop_id" AND ob."warehouse_id" = ch."warehouse_id"
      AND ob."origin_country_uid" = ch."origin_country_uid"
      AND ob."origin_city_uid" = ch."origin_city_uid"
     WHERE a."id" = $1 AND a."retired_at" IS NULL AND ch."retired_at" IS NULL
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
     ${lock ? 'FOR UPDATE OF a' : ''}`,
    assignmentId,
  );
  if (rows.length > 1) {
    return repositoryError(
      'INPUT_UNIT_ASSIGNMENT_CORRUPT',
      'Official input-unit assignment is ambiguous',
      500,
    );
  }
  return rows[0] || null;
}

function sourceEvidence(
  assignment: AssignmentRow,
  candidate: CandidateRow,
  input: VerifyOfficialInputUnitContractInput,
) {
  return {
    schema: 'ozon-official-input-unit-evidence/v1',
    method: 'manual_global_calculator_ui',
    pageOrigin: 'https://globalcalculator.ozon.ru',
    assignmentId: assignment.assignmentId,
    scope: scope(assignment),
    destination: destination(assignment),
    sourceCandidate: {
      id: candidate.candidateId,
      responseChecksum: candidate.responseChecksum,
      capturedAt: asDate(candidate.capturedAt)?.toISOString(),
    },
    unitAttestation: input.unitAttestation,
    increments: {
      weightG: input.weightIncrementG,
      dimensionMm: input.dimensionIncrementMm,
      currencyMinor: input.currencyMinorIncrement,
    },
  };
}

function evidenceChecksum(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function constructedContract(input: {
  id: string;
  assignment: AssignmentRow;
  sourceCandidate: CandidateRow;
  sourceRevision: string;
  sourceChecksum: string;
  request: VerifyOfficialInputUnitContractInput & {
    verifiedAt: Date;
    validUntil: Date;
  };
  supersedesId: string | null;
}) {
  return {
    id: input.id,
    status: 'VERIFIED' as const,
    state: input.request.validUntil.getTime() - input.request.verifiedAt.getTime() <= DAY_MS
      ? 'EXPIRING' as const
      : 'ACTIVE' as const,
    assignmentId: input.assignment.assignmentId,
    channelId: input.assignment.channelId,
    scope: scope(input.assignment),
    destination: destination(input.assignment),
    currency: 'CNY' as const,
    weightUnit: 'g' as const,
    dimensionUnit: 'mm' as const,
    priceInputUnit: 'CNY_MAJOR' as const,
    weightIncrementG: input.request.weightIncrementG,
    dimensionIncrementMm: input.request.dimensionIncrementMm,
    currencyMinorIncrement: input.request.currencyMinorIncrement,
    sourceCandidateId: input.sourceCandidate.candidateId,
    sourceCandidateChecksum: input.sourceCandidate.responseChecksum,
    sourceRevision: input.sourceRevision,
    sourceChecksum: input.sourceChecksum,
    reviewerId: input.request.actorUserId,
    reviewNote: input.request.reviewNote,
    verifiedAt: input.request.verifiedAt,
    validUntil: input.request.validUntil,
    supersedesId: input.supersedesId,
    revokedAt: null,
    revokedById: null,
    revocationReason: null,
  };
}

export function createPrismaOfficialInputUnitContractRepository(
  options: CreateRepositoryOptions,
): OfficialInputUnitContractRepository {
  const id = options.id || randomUUID;
  const eventId = options.eventId || randomUUID;

  return {
    async readContext(input) {
      const assignment = await loadAssignment(options.client, input.assignmentId, false);
      if (!assignment) {
        return repositoryError(
          'INPUT_UNIT_ASSIGNMENT_NOT_FOUND',
          'Official input-unit assignment was not found',
          404,
        );
      }
      const [historyRows, candidateRows] = await Promise.all([
        options.client.$queryRawUnsafe<ContractRow[]>(
          `/* official-input-unit:history */
           SELECT u."id", u."assignment_id" AS "assignmentId",
                  u."channel_id" AS "channelId", u."tenant_id" AS "tenantId",
                  u."shop_id" AS "shopId", u."company_id" AS "companyId",
                  u."warehouse_id" AS "warehouseId",
                  u."origin_country_uid" AS "originCountryUid",
                  u."origin_city_uid" AS "originCityUid",
                  u."destination_country_uid" AS "destinationCountryUid",
                  u."destination_location_uid" AS "destinationLocationUid",
                  u."currency", u."weight_unit" AS "weightUnit",
                  u."dimension_unit" AS "dimensionUnit",
                  u."price_input_unit" AS "priceInputUnit",
                  u."weight_increment_g" AS "weightIncrementG",
                  u."dimension_increment_mm" AS "dimensionIncrementMm",
                  u."currency_minor_increment" AS "currencyMinorIncrement",
                  u."source_candidate_id" AS "sourceCandidateId",
                  u."source_candidate_checksum" AS "sourceCandidateChecksum",
                  u."source_revision" AS "sourceRevision",
                  u."source_checksum" AS "sourceChecksum",
                  u."reviewer_id" AS "reviewerId", u."review_note" AS "reviewNote",
                  u."verified_at" AS "verifiedAt", u."valid_until" AS "validUntil",
                  u."supersedes_id" AS "supersedesId",
                  u."revoked_at" AS "revokedAt", u."revoked_by_id" AS "revokedById",
                  u."revocation_reason" AS "revocationReason",
                  successor."id" AS "supersededById"
           FROM "logistics_official_input_unit_contracts" u
           LEFT JOIN "logistics_official_input_unit_contracts" successor
             ON successor."supersedes_id" = u."id"
           WHERE u."assignment_id" = $1
           ORDER BY u."verified_at" DESC, u."id" DESC
           LIMIT 100`,
          input.assignmentId,
        ),
        options.client.$queryRawUnsafe<CandidateRow[]>(
          `/* official-input-unit:candidates */
           SELECT c."id" AS "candidateId", c."response_checksum" AS "responseChecksum",
                  c."captured_at" AS "capturedAt", c."reviewed_at" AS "reviewedAt",
                  c."normalized_payload"->'fingerprint' AS "fingerprint",
                  jsonb_array_length(c."normalized_payload"->'quotes') AS "quoteCount"
           FROM "logistics_capture_candidates" c
           WHERE c."task_kind" = 'OFFICIAL' AND c."state" = 'CAPTURED'
             AND c."review_status" = 'VERIFIED'
             AND c."tenant_id" = $1 AND c."shop_id" = $2 AND c."company_id" = $3
             AND c."warehouse_id" = $4 AND c."origin_country_uid" = $5
             AND c."origin_city_uid" = $6 AND c."destination_country_uid" = $7
             AND c."destination_location_uid" = $8
             AND c."captured_at" >= $9 AND c."captured_at" <= $10
             AND c."normalized_payload"->>'schema' = 'ozon-official-logistics-capture/v1'
           ORDER BY c."captured_at" DESC, c."id" ASC
           LIMIT 100`,
          assignment.tenantId, assignment.shopId, assignment.companyId,
          assignment.warehouseId, assignment.originCountryUid, assignment.originCityUid,
          assignment.destinationCountryUid, assignment.destinationLocationUid,
          new Date(input.at.getTime() - input.sourceMaxAgeMs),
          new Date(input.at.getTime() + CLOCK_SKEW_MS),
        ),
      ]);
      const history = historyRows.map((row) => publicContract(row, input.at));
      const current = history.find(
        (contract) => contract.state === 'ACTIVE' || contract.state === 'EXPIRING',
      ) || null;
      return {
        assignment: publicAssignment(assignment),
        current,
        history,
        candidates: candidateRows.map((candidate) => ({
          id: candidate.candidateId,
          responseChecksum: candidate.responseChecksum,
          capturedAt: asDate(candidate.capturedAt),
          reviewedAt: asDate(candidate.reviewedAt),
          fingerprint: candidate.fingerprint,
          quoteCount: Number(candidate.quoteCount) || 0,
        })),
      };
    },

    async verifyContract(input) {
      return options.client.$transaction(async (tx) => {
        const assignment = await loadAssignment(tx, input.assignmentId, true);
        if (!assignment) {
          return repositoryError(
            'INPUT_UNIT_ASSIGNMENT_NOT_FOUND',
            'Official input-unit assignment was not found',
            404,
          );
        }
        const candidates = await tx.$queryRawUnsafe<CandidateRow[]>(
          `/* official-input-unit:candidate */
           SELECT c."id" AS "candidateId", c."response_checksum" AS "responseChecksum",
                  c."captured_at" AS "capturedAt", c."reviewed_at" AS "reviewedAt",
                  c."normalized_payload"->'fingerprint' AS "fingerprint",
                  jsonb_array_length(c."normalized_payload"->'quotes') AS "quoteCount"
           FROM "logistics_capture_candidates" c
           WHERE c."id" = $1 AND c."task_kind" = 'OFFICIAL'
             AND c."state" = 'CAPTURED' AND c."review_status" = 'VERIFIED'
             AND c."tenant_id" = $2 AND c."shop_id" = $3 AND c."company_id" = $4
             AND c."warehouse_id" = $5 AND c."origin_country_uid" = $6
             AND c."origin_city_uid" = $7 AND c."destination_country_uid" = $8
             AND c."destination_location_uid" = $9
             AND c."normalized_payload"->>'schema' = 'ozon-official-logistics-capture/v1'
           FOR SHARE OF c`,
          input.candidateId, assignment.tenantId, assignment.shopId, assignment.companyId,
          assignment.warehouseId, assignment.originCountryUid, assignment.originCityUid,
          assignment.destinationCountryUid, assignment.destinationLocationUid,
        );
        const candidate = candidates[0];
        const capturedAt = asDate(candidate?.capturedAt);
        if (!candidate || candidate.responseChecksum !== input.expectedCandidateChecksum) {
          return repositoryError(
            'INPUT_UNIT_EVIDENCE_NOT_FOUND',
            'Reviewed Official unit evidence was not found',
          );
        }
        if (!capturedAt
          || capturedAt.getTime() < input.verifiedAt.getTime() - input.sourceMaxAgeMs
          || capturedAt.getTime() > input.verifiedAt.getTime() + CLOCK_SKEW_MS) {
          return repositoryError(
            'INPUT_UNIT_EVIDENCE_STALE',
            'Reviewed Official unit evidence is stale',
          );
        }
        const evidence = sourceEvidence(assignment, candidate, input);
        const sourceChecksum = evidenceChecksum(evidence);
        const sourceRevision = `official-input-units/v1:${sourceChecksum}`;
        const currentRows = await tx.$queryRawUnsafe<Array<{
          id: string;
          revokedAt: Date | string | null;
        }>>(
          `/* official-input-unit:current */
             SELECT u."id", u."revoked_at" AS "revokedAt"
             FROM "logistics_official_input_unit_contracts" u
             WHERE u."assignment_id" = $1
               AND NOT EXISTS (
                 SELECT 1 FROM "logistics_official_input_unit_contracts" successor
                 WHERE successor."supersedes_id" = u."id"
               )
             ORDER BY u."verified_at" DESC, u."id" DESC
             LIMIT 2
             FOR UPDATE OF u`,
          input.assignmentId,
        );
        const duplicateRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `/* official-input-unit:duplicate */
             SELECT u."id"
             FROM "logistics_official_input_unit_contracts" u
             WHERE u."assignment_id" = $1 AND u."source_candidate_id" = $2
               AND u."source_checksum" = $3
             LIMIT 1`,
          input.assignmentId, input.candidateId, sourceChecksum,
        );
        if (currentRows.length > 1) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_CORRUPT',
            'Official input-unit contract chain is ambiguous',
            500,
          );
        }
        const current = currentRows[0] || null;
        const currentId = current?.id || null;
        const duplicateId = duplicateRows[0]?.id || null;
        if (duplicateId && duplicateId === currentId) {
          if (current?.revokedAt) {
            return repositoryError(
              'INPUT_UNIT_CONTRACT_ALREADY_REVOKED',
              'Official input-unit contract was already revoked',
            );
          }
          return {
            duplicate: true,
            contract: constructedContract({
              id: duplicateId,
              assignment,
              sourceCandidate: candidate,
              sourceRevision,
              sourceChecksum,
              request: input,
              supersedesId: null,
            }),
          };
        }
        if (currentId !== input.expectedCurrentContractId) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_STALE',
            'Official input-unit contract changed before review completed',
          );
        }
        const contractId = id();
        const inserted = await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_official_input_unit_contracts" (
             "id", "contract_version", "assignment_id", "channel_id", "tenant_id",
             "shop_id", "company_id", "warehouse_id", "origin_country_uid",
             "origin_city_uid", "destination_country_uid", "destination_location_uid",
             "currency", "weight_unit", "dimension_unit", "price_input_unit",
             "weight_increment_g", "dimension_increment_mm", "currency_minor_increment",
             "source_candidate_id", "source_candidate_checksum", "source_revision",
             "source_checksum", "source_evidence", "reviewer_id", "review_note",
             "verified_at", "valid_until", "supersedes_id", "created_at"
           ) VALUES (
             $1, 'ozon-official-input-unit-contract/v1', $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, 'CNY', 'g', 'mm', 'CNY_MAJOR', $12, $13, $14, $15, $16,
             $17, $18, $19::jsonb, $20, $21, $22, $23, $24, $22
           )`,
          contractId, assignment.assignmentId, assignment.channelId, assignment.tenantId,
          assignment.shopId, assignment.companyId, assignment.warehouseId,
          assignment.originCountryUid, assignment.originCityUid,
          assignment.destinationCountryUid, assignment.destinationLocationUid,
          input.weightIncrementG, input.dimensionIncrementMm, input.currencyMinorIncrement,
          candidate.candidateId, candidate.responseChecksum, sourceRevision, sourceChecksum,
          JSON.stringify(evidence), input.actorUserId, input.reviewNote, input.verifiedAt,
          input.validUntil, currentId,
        );
        if (inserted !== 1) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_WRITE_FAILED',
            'Official input-unit contract could not be stored',
            500,
          );
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_rule_events" (
             "id", "tenant_id", "channel_id", "release_id", "subject_type",
             "subject_id", "actor_user_id", "type", "scope_snapshot", "facts", "created_at"
           ) VALUES (
             $1, $2, $3, NULL, 'OFFICIAL_INPUT_UNIT_CONTRACT', $4, $5,
             'BINDING_CHANGED', $6::jsonb, $7::jsonb, $8
           )`,
          eventId(), assignment.tenantId, assignment.channelId, contractId,
          input.actorUserId,
          JSON.stringify({ scope: scope(assignment), destination: destination(assignment) }),
          JSON.stringify({
            sourceRevision, sourceChecksum, sourceCandidateId: candidate.candidateId,
            validUntil: input.validUntil.toISOString(),
          }),
          input.verifiedAt,
        );
        return {
          duplicate: false,
          contract: constructedContract({
            id: contractId,
            assignment,
            sourceCandidate: candidate,
            sourceRevision,
            sourceChecksum,
            request: input,
            supersedesId: currentId,
          }),
        };
      }, { isolationLevel: 'Serializable' });
    },

    async revokeContract(input) {
      return options.client.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{
          id: string;
          channelId: string;
          tenantId: string;
          revokedAt: Date | string | null;
          revokedById: string | null;
          revocationReason: string | null;
        }>>(
          `/* official-input-unit:revoke-current */
           SELECT u."id", u."channel_id" AS "channelId", u."tenant_id" AS "tenantId",
                  u."revoked_at" AS "revokedAt", u."revoked_by_id" AS "revokedById",
                  u."revocation_reason" AS "revocationReason"
           FROM "logistics_official_input_unit_contracts" u
           WHERE u."id" = $1
             AND NOT EXISTS (
               SELECT 1 FROM "logistics_official_input_unit_contracts" successor
               WHERE successor."supersedes_id" = u."id"
             )
           FOR UPDATE OF u`,
          input.contractId,
        );
        const current = rows[0];
        if (!current) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_NOT_FOUND',
            'Current Official input-unit contract was not found',
            404,
          );
        }
        if (current.id !== input.expectedCurrentContractId) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_STALE',
            'Official input-unit contract changed before revocation completed',
          );
        }
        if (current.revokedAt) {
          if (current.revokedById === input.actorUserId
            && current.revocationReason === input.reason) {
            return { duplicate: true, contractId: current.id };
          }
          return repositoryError(
            'INPUT_UNIT_CONTRACT_ALREADY_REVOKED',
            'Official input-unit contract was already revoked',
          );
        }
        const updated = await tx.$executeRawUnsafe(
          `UPDATE "logistics_official_input_unit_contracts"
           SET "revoked_by_id" = $1, "revoked_at" = $2, "revocation_reason" = $3
           WHERE "id" = $4 AND "revoked_at" IS NULL`,
          input.actorUserId, input.revokedAt, input.reason, current.id,
        );
        if (updated !== 1) {
          return repositoryError(
            'INPUT_UNIT_CONTRACT_STALE',
            'Official input-unit contract changed before revocation completed',
          );
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "logistics_rule_events" (
             "id", "tenant_id", "channel_id", "release_id", "subject_type",
             "subject_id", "actor_user_id", "type", "scope_snapshot", "facts", "created_at"
           ) VALUES (
             $1, $2, $3, NULL, 'OFFICIAL_INPUT_UNIT_CONTRACT', $4, $5,
             'INVALIDATED', '{}'::jsonb, $6::jsonb, $7
           )`,
          eventId(), current.tenantId, current.channelId, current.id, input.actorUserId,
          JSON.stringify({ reason: input.reason }), input.revokedAt,
        );
        return { duplicate: false, contractId: current.id, revokedAt: input.revokedAt };
      }, { isolationLevel: 'Serializable' });
    },
  };
}
