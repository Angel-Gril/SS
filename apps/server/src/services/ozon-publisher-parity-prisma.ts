import { createHash, randomUUID } from 'node:crypto';

import {
  OzonPublisherParityObservationError,
  deriveOzonPublisherParityDifferenceSubject,
  type ApplyOzonPublisherParityDifferenceReviewInput,
  type ListOzonPublisherParityDifferenceSubjectsInput,
  type ListOzonPublisherParityObservationsInput,
  type OzonPublisherParityApprovalState,
  type OzonPublisherParityDifferenceReviewRecord,
  type OzonPublisherParityDifferenceSubject,
  type OzonPublisherParityDifferenceSubjectRecord,
  type OzonPublisherParityObservationRecord,
  type OzonPublisherParityObservationRepository,
  type PruneExpiredOzonPublisherParityObservationsInput,
} from './ozon-publisher-parity-observations.js';

const SUPPORTED_PUBLISHER_CONTRACT_VERSION =
  'ozon-listing-production-compile-adapter/v1';
const SUPPORTED_PAYLOAD_COMPILER_VERSION =
  'ozon-listing-payload-compiler/v1';

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function date(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new OzonPublisherParityObservationError(
      'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
      `${field} is invalid`,
      400,
    );
  }
  return parsed;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedLimit(value: unknown, maximum = 100): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new OzonPublisherParityObservationError(
      'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
      'list limit is invalid',
      400,
    );
  }
  return Number(value);
}

function approvalEligible(subject: {
  classification: string;
  differenceRows: unknown;
  publisherContractVersion: unknown;
  payloadCompilerVersion: unknown;
}): boolean {
  if (!['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM'].includes(subject.classification)) {
    return false;
  }
  if (subject.publisherContractVersion !== SUPPORTED_PUBLISHER_CONTRACT_VERSION
    || subject.payloadCompilerVersion !== SUPPORTED_PAYLOAD_COMPILER_VERSION) {
    return false;
  }
  return Array.isArray(subject.differenceRows) && subject.differenceRows.every((row) => (
    row && typeof row === 'object' && !Array.isArray(row)
    && ['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM']
      .includes(String((row as { classification?: unknown }).classification || ''))
  ));
}

function subjectRecord(row: any): OzonPublisherParityDifferenceSubjectRecord {
  const differenceRows = Array.isArray(row.differenceRows) ? row.differenceRows : [];
  return {
    contractVersion: row.recordContractVersion,
    key: String(row.subjectKey),
    entrypoint: row.entrypoint,
    rolloutRevision: String(row.rolloutRevision),
    legacyEndpointKind: row.legacyEndpoint,
    v2EndpointKind: row.v2Endpoint,
    legacyItemCount: Number(row.legacyItemCount),
    v2ItemCount: Number(row.v2ItemCount),
    classification: row.classification,
    compilerVersions: {
      publisherContractVersion: row.publisherContractVersion,
      payloadCompilerVersion: row.payloadCompilerVersion,
    },
    differenceCount: Number(row.differenceTotal),
    rowsHash: String(row.fullDifferenceSignature),
    rows: differenceRows,
    complete: true,
    approvalEligible: approvalEligible(row),
    approvalState: row.approvalState,
    stateVersion: Number(row.stateVersion),
    observationCount: Number(row.observationCount),
    firstObservedAt: iso(row.firstObservedAt) || '',
    lastObservedAt: iso(row.lastObservedAt) || '',
    reviewedByUserId: row.reviewedByUserId == null ? null : String(row.reviewedByUserId),
    reviewNote: row.reviewNote == null ? null : String(row.reviewNote),
    reviewedAt: iso(row.reviewedAt),
    approvedAt: iso(row.approvedAt),
    rejectedAt: iso(row.rejectedAt),
    revokedAt: iso(row.revokedAt),
  } as OzonPublisherParityDifferenceSubjectRecord;
}

function reportFromRow(row: any) {
  const compilerVersions = {
    publisherContractVersion: row.publisherContractVersion || null,
    payloadCompilerVersion: row.payloadCompilerVersion || null,
  };
  const v2 = row.v2Kind === 'COMPILED'
    ? {
        kind: 'COMPILED' as const,
        endpointKind: row.v2Endpoint,
        payloadHash: row.v2PayloadHash,
        itemCount: Number(row.v2ItemCount),
        compilerVersions,
      }
    : row.v2Kind === 'BLOCKED'
      ? {
          kind: 'BLOCKED' as const,
          blockerCode: row.blockerCode,
          endpointKind: null,
          payloadHash: null,
          itemCount: null,
          compilerVersions,
        }
      : {
          kind: 'UNAVAILABLE' as const,
          reasonCode: row.reasonCode,
          endpointKind: null,
          payloadHash: null,
          itemCount: null,
          compilerVersions,
        };
  return {
    contractVersion: row.reportContractVersion,
    entrypoint: row.entrypoint,
    status: row.status,
    classification: row.classification,
    switchEligible: Boolean(row.switchEligible),
    legacy: {
      endpointKind: row.legacyEndpoint,
      payloadHash: row.legacyPayloadHash,
      itemCount: Number(row.legacyItemCount),
    },
    v2,
    differences: {
      total: Number(row.differenceTotal),
      returned: Number(row.differenceReturned),
      truncated: Boolean(row.differenceTruncated),
      rows: Array.isArray(row.differenceRows) ? row.differenceRows : [],
    },
  };
}

function observationRecord(row: any): OzonPublisherParityObservationRecord {
  const report = reportFromRow(row) as OzonPublisherParityObservationRecord['report'];
  const subject = deriveOzonPublisherParityDifferenceSubject(report, String(row.rolloutRevision));
  return {
    id: String(row.id),
    recordKey: String(row.recordKey),
    contractVersion: row.recordContractVersion,
    scopeHash: String(row.scopeHash),
    rolloutRevision: String(row.rolloutRevision),
    entrypoint: row.entrypoint,
    reportHash: String(row.reportHash),
    report,
    differenceSubjectKey: row.differenceSubjectKey == null
      ? null
      : String(row.differenceSubjectKey),
    approvalEligible: subject?.approvalEligible || false,
    eligibleAttemptKey: row.eligibleAttemptKey == null ? null : String(row.eligibleAttemptKey),
    observedAt: iso(row.observedAt) || '',
    expiresAt: iso(row.expiresAt) || '',
  };
}

function observationData(
  input: OzonPublisherParityObservationRecord,
  subject: OzonPublisherParityDifferenceSubject | null,
) {
  const report = input.report;
  const compiled = report.v2.kind === 'COMPILED';
  return {
    id: input.id,
    recordKey: input.recordKey,
    scopeHash: input.scopeHash,
    entrypoint: input.entrypoint,
    rolloutRevision: input.rolloutRevision,
    recordContractVersion: input.contractVersion,
    reportContractVersion: report.contractVersion,
    reportHash: input.reportHash,
    status: report.status,
    classification: report.classification,
    switchEligible: report.switchEligible,
    legacyEndpoint: report.legacy.endpointKind,
    legacyPayloadHash: report.legacy.payloadHash,
    legacyItemCount: report.legacy.itemCount,
    v2Kind: report.v2.kind,
    v2Endpoint: compiled ? report.v2.endpointKind : null,
    v2PayloadHash: compiled ? report.v2.payloadHash : null,
    v2ItemCount: compiled ? report.v2.itemCount : null,
    publisherContractVersion: report.v2.compilerVersions.publisherContractVersion,
    payloadCompilerVersion: report.v2.compilerVersions.payloadCompilerVersion,
    blockerCode: report.v2.kind === 'BLOCKED' ? report.v2.blockerCode : null,
    reasonCode: report.v2.kind === 'UNAVAILABLE' ? report.v2.reasonCode : null,
    differenceTotal: report.differences.total,
    differenceReturned: report.differences.returned,
    differenceTruncated: report.differences.truncated,
    differenceRows: report.differences.rows,
    fullDifferenceSignature: subject?.rowsHash || null,
    differenceSubjectKey: subject?.key || null,
    eligibleAttemptKey: input.eligibleAttemptKey || null,
    observedAt: date(input.observedAt, 'observedAt'),
    expiresAt: date(input.expiresAt, 'expiresAt'),
  };
}

function subjectData(
  subject: OzonPublisherParityDifferenceSubject,
  reportContractVersion: OzonPublisherParityObservationRecord['report']['contractVersion'],
  observedAt: Date,
) {
  return {
    subjectKey: subject.key,
    entrypoint: subject.entrypoint,
    rolloutRevision: subject.rolloutRevision,
    recordContractVersion: subject.contractVersion,
    reportContractVersion,
    legacyEndpoint: subject.legacyEndpointKind,
    v2Kind: 'COMPILED',
    v2Endpoint: subject.v2EndpointKind,
    legacyItemCount: subject.legacyItemCount,
    v2ItemCount: subject.v2ItemCount,
    publisherContractVersion: subject.compilerVersions.publisherContractVersion,
    payloadCompilerVersion: subject.compilerVersions.payloadCompilerVersion,
    classification: subject.classification,
    fullDifferenceSignature: subject.rowsHash,
    differenceTotal: subject.differenceCount,
    differenceRows: subject.rows,
    approvalState: 'PENDING',
    stateVersion: 0,
    observationCount: 0,
    firstObservedAt: observedAt,
    lastObservedAt: observedAt,
    reviewedByUserId: null,
    reviewNote: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    revokedAt: null,
    updatedAt: observedAt,
  };
}

function versionConflict(): OzonPublisherParityObservationError {
  return new OzonPublisherParityObservationError(
    'OZON_PUBLISHER_PARITY_VERSION_CONFLICT',
    'Ozon publisher parity difference subject changed',
    409,
  );
}

function idempotencyConflict(): OzonPublisherParityObservationError {
  return new OzonPublisherParityObservationError(
    'OZON_PUBLISHER_PARITY_IDEMPOTENCY_CONFLICT',
    'Ozon publisher parity review key was reused with a different request',
    409,
  );
}

function transitionState(action: string, current: string): OzonPublisherParityApprovalState {
  if (action === 'APPROVE' && current === 'PENDING') return 'APPROVED';
  if (action === 'REJECT' && current === 'PENDING') return 'REJECTED';
  if (action === 'REVOKE' && current === 'APPROVED') return 'REVOKED';
  throw new OzonPublisherParityObservationError(
    'OZON_PUBLISHER_PARITY_INVALID_TRANSITION',
    'Ozon publisher parity review transition is invalid',
    409,
  );
}

function reviewRecord(row: any): OzonPublisherParityDifferenceReviewRecord {
  return {
    subjectKey: String(row.subjectKey),
    status: row.resultState,
    transitionVersion: Number(row.transitionVersion),
    actorUserId: String(row.actorUserId),
    reviewNote: String(row.reviewNote),
    reviewedAt: iso(row.createdAt) || '',
    operationKey: String(row.operationKey),
    requestHash: String(row.requestHash),
  };
}

export function createPrismaOzonPublisherParityObservationRepository(options: {
  client: any;
  createId?: () => string;
}): OzonPublisherParityObservationRepository {
  const createId = options.createId || randomUUID;

  const transaction = async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
    let lastConflict: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await options.client.$transaction(callback, { isolationLevel: 'Serializable' });
      } catch (error: any) {
        if (!['P2002', 'P2034'].includes(String(error?.code || ''))) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict;
  };

  return {
    async createObservation(input) {
      return transaction(async (tx) => {
        const existing = await tx.ozonPublisherParityObservation.findUnique({
          where: { recordKey: input.recordKey },
        });
        if (existing) {
          if (String(existing.reportHash) !== input.reportHash) throw idempotencyConflict();
          return { observation: observationRecord(existing), created: false };
        }
        const subject = deriveOzonPublisherParityDifferenceSubject(
          input.report,
          input.rolloutRevision,
        );
        if ((subject?.key || null) !== input.differenceSubjectKey) {
          throw new OzonPublisherParityObservationError(
            'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
            'difference subject key is inconsistent',
            400,
          );
        }
        const observedAt = date(input.observedAt, 'observedAt');
        if (subject) {
          const current = await tx.ozonPublisherParityDifferenceSubject.findUnique({
            where: { subjectKey: subject.key },
          });
          if (current) {
            const mapped = subjectRecord(current);
            if (mapped.rowsHash !== subject.rowsHash
              || mapped.rolloutRevision !== subject.rolloutRevision
              || mapped.entrypoint !== subject.entrypoint
              || mapped.legacyItemCount !== subject.legacyItemCount
              || mapped.v2ItemCount !== subject.v2ItemCount) {
              throw idempotencyConflict();
            }
          } else {
            await tx.ozonPublisherParityDifferenceSubject.create({
              data: subjectData(subject, input.report.contractVersion, observedAt),
            });
          }
        }
        const created = await tx.ozonPublisherParityObservation.create({
          data: observationData(input, subject),
        });
        return { observation: observationRecord(created), created: true };
      });
    },

    async listObservations(input: ListOzonPublisherParityObservationsInput) {
      const limit = boundedLimit(input.limit);
      const cursor = input.cursor
        ? { observedAt: date(input.cursor.observedAt, 'cursor.observedAt'), id: input.cursor.id }
        : null;
      const rows = await options.client.ozonPublisherParityObservation.findMany({
        where: {
          ...(input.entrypoint ? { entrypoint: input.entrypoint } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.differenceSubjectKey
            ? { differenceSubjectKey: input.differenceSubjectKey }
            : {}),
          ...(cursor ? {
            OR: [
              { observedAt: { lt: cursor.observedAt } },
              { observedAt: cursor.observedAt, id: { lt: cursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        observations: page.map(observationRecord),
        nextCursor: rows.length > limit && last
          ? { observedAt: iso(last.observedAt)!, id: String(last.id) }
          : null,
      };
    },

    async findDifferenceSubject({ subjectKey }) {
      const row = await options.client.ozonPublisherParityDifferenceSubject.findUnique({
        where: { subjectKey },
      });
      return row ? subjectRecord(row) : null;
    },

    async listDifferenceSubjects(input: ListOzonPublisherParityDifferenceSubjectsInput) {
      const limit = boundedLimit(input.limit);
      const cursor = input.cursor
        ? { lastObservedAt: date(input.cursor.lastObservedAt, 'cursor.lastObservedAt'), key: input.cursor.key }
        : null;
      const rows = await options.client.ozonPublisherParityDifferenceSubject.findMany({
        where: {
          ...(input.entrypoint ? { entrypoint: input.entrypoint } : {}),
          ...(input.rolloutRevision ? { rolloutRevision: input.rolloutRevision } : {}),
          ...(input.approvalEligible === true
            ? {
                classification: { in: ['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM'] },
                publisherContractVersion: SUPPORTED_PUBLISHER_CONTRACT_VERSION,
                payloadCompilerVersion: SUPPORTED_PAYLOAD_COMPILER_VERSION,
              }
            : input.approvalEligible === false ? { classification: 'DEFECT' } : {}),
          ...(cursor ? {
            OR: [
              { lastObservedAt: { lt: cursor.lastObservedAt } },
              { lastObservedAt: cursor.lastObservedAt, subjectKey: { lt: cursor.key } },
            ],
          } : {}),
        },
        orderBy: [{ lastObservedAt: 'desc' }, { subjectKey: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        subjects: page.map(subjectRecord),
        nextCursor: rows.length > limit && last
          ? { lastObservedAt: iso(last.lastObservedAt)!, key: String(last.subjectKey) }
          : null,
      };
    },

    async applyDifferenceReview(input: ApplyOzonPublisherParityDifferenceReviewInput) {
      return transaction(async (tx) => {
        const current = await tx.ozonPublisherParityDifferenceSubject.findUnique({
          where: { subjectKey: input.subjectKey },
        });
        if (!current) {
          throw new OzonPublisherParityObservationError(
            'OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_NOT_FOUND',
            'Ozon publisher parity difference subject was not found',
            404,
          );
        }
        const currentVersion = Number(current.stateVersion);
        if (currentVersion !== input.expectedTransitionVersion) {
          if (currentVersion !== input.expectedTransitionVersion + 1) throw versionConflict();
          const prior = await tx.ozonPublisherParityDecision.findUnique({
            where: {
              subjectKey_transitionVersion: {
                subjectKey: input.subjectKey,
                transitionVersion: input.expectedTransitionVersion + 1,
              },
            },
          });
          if (!prior || String(prior.operationKey) !== input.operationKey) throw versionConflict();
          if (String(prior.requestHash) !== input.requestHash) throw idempotencyConflict();
          return { review: reviewRecord(prior), idempotent: true };
        }
        const mapped = subjectRecord(current);
        if (input.action === 'APPROVE' && !mapped.approvalEligible) {
          throw new OzonPublisherParityObservationError(
            'OZON_PUBLISHER_PARITY_DIFFERENCE_NOT_APPROVABLE',
            'Only complete intentional or compatibility differences can be approved',
            409,
          );
        }
        const resultState = transitionState(input.action, current.approvalState);
        const transitionVersion = currentVersion + 1;
        const reviewedAt = input.reviewedAt;
        const updated = await tx.ozonPublisherParityDifferenceSubject.updateMany({
          where: {
            subjectKey: input.subjectKey,
            stateVersion: currentVersion,
            approvalState: current.approvalState,
          },
          data: {
            approvalState: resultState,
            stateVersion: transitionVersion,
            reviewedByUserId: input.actorUserId,
            reviewNote: input.reviewNote,
            reviewedAt,
            ...(resultState === 'APPROVED' ? { approvedAt: reviewedAt } : {}),
            ...(resultState === 'REJECTED' ? { rejectedAt: reviewedAt } : {}),
            ...(resultState === 'REVOKED' ? { revokedAt: reviewedAt } : {}),
            updatedAt: reviewedAt,
          },
        });
        if (updated.count !== 1) throw versionConflict();
        const decision = await tx.ozonPublisherParityDecision.create({
          data: {
            id: createId(),
            subjectKey: input.subjectKey,
            transitionVersion,
            decisionKey: hash({
              schema: 'ozon-publisher-parity-decision-key/v1',
              operationKey: input.operationKey,
              transitionVersion,
            }),
            operationKey: input.operationKey,
            requestHash: input.requestHash,
            action: input.action,
            resultState,
            actorUserId: input.actorUserId,
            reviewNote: input.reviewNote,
            observationCountSnapshot: Number(current.observationCount),
            firstObservedAtSnapshot: current.firstObservedAt,
            lastObservedAtSnapshot: current.lastObservedAt,
            fullDifferenceSignatureSnapshot: current.fullDifferenceSignature,
            createdAt: reviewedAt,
          },
        });
        return { review: reviewRecord(decision), idempotent: false };
      });
    },

    async pruneObservations(input: PruneExpiredOzonPublisherParityObservationsInput) {
      const limit = boundedLimit(input.limit, 1_000);
      if (!(input.expiredBefore instanceof Date) || !Number.isFinite(input.expiredBefore.getTime())) {
        throw new OzonPublisherParityObservationError(
          'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
          'expiredBefore is invalid',
          400,
        );
      }
      return transaction(async (tx) => {
        const rows = await tx.ozonPublisherParityObservation.findMany({
          where: { expiresAt: { lt: input.expiredBefore } },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
          take: limit + 1,
        });
        const ids = rows.slice(0, limit).map(({ id }: { id: string }) => id);
        if (ids.length) {
          await tx.ozonPublisherParityObservation.deleteMany({ where: { id: { in: ids } } });
        }
        return { deletedCount: ids.length, hasMore: rows.length > limit };
      });
    },
  };
}
