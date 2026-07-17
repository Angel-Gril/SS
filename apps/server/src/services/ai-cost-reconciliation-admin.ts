import { createHash } from 'node:crypto';
import {
  appendAiCostSettlementInTransaction,
  type AiCostLedgerDatabase,
} from './ai-cost-ledger.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

const UNRESOLVED_STATUSES = ['SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED'] as const;
type UnresolvedStatus = (typeof UNRESOLVED_STATUSES)[number];

interface AdminAiCostReservationStore {
  findMany(args: unknown): Promise<any[]>;
  findUnique(args: unknown): Promise<any>;
  create(args: unknown): Promise<any>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

export type AiCostReconciliationAdminDatabase = Omit<AiCostLedgerDatabase, 'aiCostReservation'> & {
  aiCostReservation: AdminAiCostReservationStore;
  aiImageJob: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export class AiCostReconciliationAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'AiCostReconciliationAdminError';
  }
}

export interface ListAiCostReconciliationsInput {
  status?: UnresolvedStatus;
  limit?: number;
}

export interface ReconcileAiCostAdminInput {
  reservationId: string;
  actorUserId: string;
  requestId: string;
  expectedStatus: UnresolvedStatus;
  expectedEvidenceHash: string;
  outcome: 'SETTLED' | 'RELEASED';
  actualCostMinor?: number;
  billedUnits?: number;
  reason: string;
}

function normalizedLimit(value: unknown): number {
  const limit = Number(value ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AiCostReconciliationAdminError('INVALID_REQUEST', 'limit must be between 1 and 100', 400);
  }
  return limit;
}

function unresolvedStatus(value: unknown, label: string): UnresolvedStatus {
  const status = String(value || '').trim().toUpperCase();
  if (!UNRESOLVED_STATUSES.includes(status as UnresolvedStatus)) {
    throw new AiCostReconciliationAdminError('INVALID_REQUEST', `${label} is invalid`, 400);
  }
  return status as UnresolvedStatus;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AiCostReconciliationAdminError('INVALID_REQUEST', `${label} must be a non-negative integer`, 400);
  }
  return number;
}

function required(value: unknown, label: string): string {
  const text = String(value || '').trim();
  if (!text) throw new AiCostReconciliationAdminError('INVALID_REQUEST', `${label} is required`, 400);
  return text;
}

function sha256(value: unknown, label: string): string {
  const hash = required(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new AiCostReconciliationAdminError('INVALID_REQUEST', `${label} is invalid`, 400);
  }
  return hash;
}

function reservationInclude() {
  return {
    job: {
      select: {
        id: true,
        status: true,
        errorCode: true,
        providerJobId: true,
        providerDispatchedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    },
    settlements: {
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        kind: true,
        actorUserId: true,
        actualCostMinor: true,
        billedUnits: true,
        reason: true,
        createdAt: true,
      },
    },
  };
}

function iso(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function evidenceHash(reservation: any): string {
  return createHash('sha256').update(JSON.stringify({
    reservation: {
      status: reservation.status || null,
      updatedAt: iso(reservation.updatedAt),
      providerRequestId: reservation.providerRequestId || null,
      providerAcceptedAt: iso(reservation.providerAcceptedAt),
    },
    job: {
      status: reservation.job?.status || null,
      updatedAt: iso(reservation.job?.updatedAt),
      providerJobId: reservation.job?.providerJobId || null,
      providerDispatchedAt: iso(reservation.job?.providerDispatchedAt),
      errorCode: reservation.job?.errorCode || null,
    },
  })).digest('hex');
}

function withEvidenceHash<T extends Record<string, unknown>>(reservation: T): T & { evidenceHash: string } {
  return { ...reservation, evidenceHash: evidenceHash(reservation) };
}

export function createAiCostReconciliationAdminService(input: {
  database: AiCostReconciliationAdminDatabase;
}) {
  const database = input.database;

  return {
    async listReconciliations(query: ListAiCostReconciliationsInput = {}) {
      const limit = normalizedLimit(query.limit);
      const status = query.status ? unresolvedStatus(query.status, 'status') : null;
      const items = await database.aiCostReservation.findMany({
        where: { status: status || { in: [...UNRESOLVED_STATUSES] } },
        orderBy: [{ reconciliationRequiredAt: 'asc' }, { id: 'asc' }],
        take: limit,
        include: reservationInclude(),
      });
      return { items: items.map(withEvidenceHash), limit };
    },

    async reconcileReservation(raw: ReconcileAiCostAdminInput) {
      const reservationId = required(raw.reservationId, 'reservationId');
      const actorUserId = required(raw.actorUserId, 'actorUserId');
      const requestId = required(raw.requestId, 'requestId');
      const expectedStatus = unresolvedStatus(raw.expectedStatus, 'expectedStatus');
      const expectedEvidenceHash = sha256(raw.expectedEvidenceHash, 'expectedEvidenceHash');
      const reason = required(raw.reason, 'reason').replace(/\s+/gu, ' ');
      if (reason.length < 10 || reason.length > 500) {
        throw new AiCostReconciliationAdminError('INVALID_REQUEST', 'reason must be between 10 and 500 characters', 400);
      }

      const outcome = String(raw.outcome || '').toUpperCase();
      if (outcome !== 'SETTLED' && outcome !== 'RELEASED') {
        throw new AiCostReconciliationAdminError('INVALID_REQUEST', 'outcome is invalid', 400);
      }
      const billedUnits = nonNegativeInteger(raw.billedUnits ?? 0, 'billedUnits');
      const actualCostMinor = outcome === 'SETTLED'
        ? nonNegativeInteger(raw.actualCostMinor, 'actualCostMinor')
        : 0;
      if (outcome === 'RELEASED' && billedUnits !== 0) {
        throw new AiCostReconciliationAdminError('INVALID_REQUEST', 'released cost cannot include billed units', 400);
      }

      const idempotencyKey = `admin-reconcile:${requestId}`;
      const settlementKind = outcome === 'SETTLED' ? 'RECONCILED_CHARGE' : 'RECONCILED_RELEASE';
      try {
        return await runAiMediaSerializableTransaction(database, async (transaction) => {
          const reservation = await transaction.aiCostReservation.findUnique({
            where: { id: reservationId },
            include: reservationInclude(),
          });
          if (!reservation) {
            throw new AiCostReconciliationAdminError('NOT_FOUND', 'AI cost reservation was not found', 404);
          }

          const existing = await transaction.aiCostSettlement.findUnique({ where: {
            ai_cost_settlement_reservation_idempotency: { reservationId, idempotencyKey },
          } });
          if (existing) {
            const exactReplay = existing.actorUserId === actorUserId
              && existing.kind === settlementKind
              && Number(existing.actualCostMinor ?? 0) === actualCostMinor
              && Number(existing.billedUnits || 0) === billedUnits
              && String(existing.reason || '') === reason;
            if (!exactReplay) {
              throw new AiCostReconciliationAdminError(
                'IDEMPOTENCY_KEY_CONFLICT',
                'AI cost reconciliation request was reused for another decision',
                409,
              );
            }
            return withEvidenceHash(reservation);
          }
          if (reservation.status !== expectedStatus || evidenceHash(reservation) !== expectedEvidenceHash) {
            throw new AiCostReconciliationAdminError('RESERVATION_CHANGED', 'AI cost reservation changed', 409);
          }
          if (!(reservation.updatedAt instanceof Date)) {
            throw new AiCostReconciliationAdminError('RESERVATION_CHANGED', 'AI cost reservation changed', 409);
          }
          if (!(reservation.job?.updatedAt instanceof Date)) {
            throw new AiCostReconciliationAdminError('RESERVATION_CHANGED', 'AI image job changed', 409);
          }

          const projected = await transaction.aiImageJob.updateMany({
            where: {
              id: reservation.jobId,
              ownerUserId: reservation.ownerUserId,
              updatedAt: reservation.job.updatedAt,
            },
            data: { actualCostCents: actualCostMinor, billedUnits },
          });
          if (projected.count !== 1) {
            throw new AiCostReconciliationAdminError('RESERVATION_CHANGED', 'AI image job changed', 409);
          }

          await appendAiCostSettlementInTransaction(transaction, {
            reservationId,
            ownerUserId: reservation.ownerUserId,
            actorUserId,
            idempotencyKey,
            requestFingerprint: reservation.requestFingerprint,
            kind: settlementKind,
            actualCostMinor,
            billedUnits,
            reason,
            expectedReservationUpdatedAt: reservation.updatedAt,
          });
          const updated = await transaction.aiCostReservation.findUnique({
            where: { id: reservationId },
            include: reservationInclude(),
          });
          return withEvidenceHash(updated);
        });
      } catch (error) {
        if (error instanceof AiCostReconciliationAdminError) throw error;
        const code = String((error as { code?: unknown }).code || '');
        if (['CONFLICT', 'INVALID_STATE', 'IDEMPOTENCY_KEY_CONFLICT'].includes(code)) {
          throw new AiCostReconciliationAdminError('RESERVATION_CHANGED', 'AI cost reservation changed', 409);
        }
        throw error;
      }
    },
  };
}

export type AiCostReconciliationAdminService = ReturnType<typeof createAiCostReconciliationAdminService>;
