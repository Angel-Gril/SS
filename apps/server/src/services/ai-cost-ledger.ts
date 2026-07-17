import type { AiMediaOperation } from './ai-image-provider-capabilities.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

export type AiCostReservationStatus =
  | 'RESERVED'
  | 'RECONCILIATION_REQUIRED'
  | 'SETTLED'
  | 'RELEASED';
export type AiCostSettlementKind =
  | 'CHARGE'
  | 'RELEASE'
  | 'RECONCILIATION_REQUIRED'
  | 'RECONCILED_CHARGE'
  | 'RECONCILED_RELEASE';

export interface AiCostReservationInput {
  ownerUserId: string;
  actorUserId: string;
  workflowId?: string | null;
  jobId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  provider: string;
  model: string;
  operation: AiMediaOperation;
  currency?: string;
  roundingMode?: string;
  estimatedCostMinor: number;
  maximumCostMinor: number;
}

export interface AiCostLedgerDatabase {
  $transaction<T>(callback: (tx: AiCostLedgerDatabase) => Promise<T>, options?: unknown): Promise<T>;
  aiCostReservation: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  aiCostSettlement: {
    findUnique(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
  };
}

export class AiCostLedgerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiCostLedgerError';
  }
}

function required(value: unknown, label: string): string {
  const text = String(value || '').trim();
  if (!text) throw new AiCostLedgerError('INVALID_REQUEST', `${label} is required`);
  return text;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AiCostLedgerError('INVALID_REQUEST', `${label} must be a non-negative integer`);
  }
  return number;
}

function sha256(value: unknown, label: string): string {
  const fingerprint = required(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new AiCostLedgerError('INVALID_REQUEST', `${label} must be a SHA-256 hash`);
  }
  return fingerprint;
}

function normalizedInput(input: AiCostReservationInput): AiCostReservationInput {
  const estimatedCostMinor = nonNegativeInteger(input.estimatedCostMinor, 'estimatedCostMinor');
  const maximumCostMinor = nonNegativeInteger(input.maximumCostMinor, 'maximumCostMinor');
  if (maximumCostMinor < estimatedCostMinor) {
    throw new AiCostLedgerError('INVALID_REQUEST', 'maximumCostMinor must be >= estimatedCostMinor');
  }
  const currency = String(input.currency || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new AiCostLedgerError('INVALID_REQUEST', 'currency must be a 3-letter code');
  const requestFingerprint = sha256(input.requestFingerprint, 'requestFingerprint');
  const roundingMode = String(input.roundingMode || 'HALF_UP').trim().toUpperCase();
  if (!['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'].includes(roundingMode)) {
    throw new AiCostLedgerError('INVALID_REQUEST', 'roundingMode is unsupported');
  }
  return {
    ...input,
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    jobId: required(input.jobId, 'jobId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint,
    provider: required(input.provider, 'provider'),
    model: required(input.model, 'model'),
    currency,
    roundingMode,
    estimatedCostMinor,
    maximumCostMinor,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as any).code === 'P2002');
}

function reservationWhere(input: { ownerUserId: string; idempotencyKey: string }) {
  return { ai_cost_reservation_owner_idempotency: {
    ownerUserId: input.ownerUserId,
    idempotencyKey: input.idempotencyKey,
  } };
}

async function loadReservation(db: AiCostLedgerDatabase, id: string, ownerUserId: string) {
  const row = await db.aiCostReservation.findUnique({
    where: { ai_cost_reservation_id_owner: { id, ownerUserId } },
    include: { settlements: true },
  });
  if (!row) throw new AiCostLedgerError('NOT_FOUND', 'AI cost reservation not found');
  return row;
}

function assertSameReservation(row: any, input: AiCostReservationInput) {
  if (row.ownerUserId !== input.ownerUserId
    || row.actorUserId !== input.actorUserId
    || (row.workflowId || null) !== (input.workflowId || null)
    || row.jobId !== input.jobId
    || row.requestFingerprint !== input.requestFingerprint
    || row.provider !== input.provider
    || row.model !== input.model
    || row.operation !== input.operation
    || row.currency !== input.currency
    || row.roundingMode !== input.roundingMode
    || row.estimatedCostMinor !== input.estimatedCostMinor
    || row.maximumCostMinor !== input.maximumCostMinor) {
    throw new AiCostLedgerError('IDEMPOTENCY_KEY_CONFLICT', 'Cost idempotency key was reused for another request');
  }
}

function assertSameSettlement(existing: any, input: {
  kind: AiCostSettlementKind;
  requestFingerprint: string;
  actualCostMinor: number | null;
  billedUnits: number;
}) {
  if (existing.kind !== input.kind
    || existing.requestFingerprint !== input.requestFingerprint
    || (existing.actualCostMinor ?? null) !== input.actualCostMinor
    || Number(existing.billedUnits || 0) !== input.billedUnits) {
    throw new AiCostLedgerError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Cost settlement idempotency key was reused for another outcome',
    );
  }
}

export async function reserveAiCost(database: AiCostLedgerDatabase, rawInput: AiCostReservationInput) {
  const input = normalizedInput(rawInput);
  const create = async (db: AiCostLedgerDatabase) => {
    const existing = await db.aiCostReservation.findUnique({
      where: reservationWhere(input),
      include: { settlements: true },
    });
    if (existing) {
      assertSameReservation(existing, input);
      return { reservation: existing, replayed: true };
    }
    const reservation = await db.aiCostReservation.create({ data: {
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      workflowId: input.workflowId || null,
      jobId: input.jobId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      currency: input.currency,
      roundingMode: input.roundingMode,
      estimatedCostMinor: input.estimatedCostMinor,
      maximumCostMinor: input.maximumCostMinor,
      status: 'RESERVED',
    } });
    return { reservation, replayed: false };
  };
  try {
    return await runAiMediaSerializableTransaction(database, create);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await database.aiCostReservation.findUnique({
      where: reservationWhere(input), include: { settlements: true },
    });
    if (!raced) throw error;
    assertSameReservation(raced, input);
    return { reservation: raced, replayed: true };
  }
}

async function appendTerminalSettlement(
  database: AiCostLedgerDatabase,
  input: {
    reservationId: string;
    ownerUserId: string;
    actorUserId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    kind: AiCostSettlementKind;
    actualCostMinor?: number | null;
    billedUnits?: number;
    reason?: string | null;
  },
) {
  if (!['CHARGE', 'RELEASE', 'RECONCILED_CHARGE', 'RECONCILED_RELEASE'].includes(input.kind)) {
    throw new AiCostLedgerError('INVALID_REQUEST', 'Use markAiCostUnknown for reconciliation-required events');
  }
  const actualCostMinor = input.actualCostMinor == null ? null : nonNegativeInteger(input.actualCostMinor, 'actualCostMinor');
  const billedUnits = nonNegativeInteger(input.billedUnits ?? 0, 'billedUnits');
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
  };
  const action = async (tx: AiCostLedgerDatabase) => {
    const reservation = await loadReservation(tx, normalized.reservationId, normalized.ownerUserId);
    const existing = await tx.aiCostSettlement.findUnique({
      where: { ai_cost_settlement_reservation_idempotency: {
        reservationId: normalized.reservationId,
        idempotencyKey: normalized.idempotencyKey,
      } },
    });
    if (existing) {
      assertSameSettlement(existing, { kind: normalized.kind, requestFingerprint: normalized.requestFingerprint, actualCostMinor, billedUnits });
      return { reservation, settlement: existing, replayed: true };
    }
    if (reservation.requestFingerprint !== normalized.requestFingerprint) {
      throw new AiCostLedgerError('IDEMPOTENCY_KEY_CONFLICT', 'Cost settlement fingerprint does not match reservation');
    }
    const allowed = normalized.kind === 'RECONCILED_CHARGE' || normalized.kind === 'RECONCILED_RELEASE'
      ? reservation.status === 'RECONCILIATION_REQUIRED'
      : reservation.status === 'RESERVED';
    if (!allowed) throw new AiCostLedgerError('INVALID_STATE', `Reservation is ${reservation.status}`);
    if ((normalized.kind === 'CHARGE' || normalized.kind === 'RECONCILED_CHARGE') && actualCostMinor == null) {
      throw new AiCostLedgerError('INVALID_REQUEST', 'Charge settlement requires actualCostMinor');
    }
    if (normalized.kind === 'CHARGE' && actualCostMinor! > reservation.maximumCostMinor) {
      throw new AiCostLedgerError('COST_OVERRUN_REQUIRES_RECONCILIATION', 'Actual cost exceeds the reserved maximum');
    }
    if (normalized.kind === 'RELEASE' || normalized.kind === 'RECONCILED_RELEASE') {
      if (actualCostMinor !== null && actualCostMinor !== 0) throw new AiCostLedgerError('INVALID_REQUEST', 'Release settlement cannot charge a cost');
      if (billedUnits !== 0) throw new AiCostLedgerError('INVALID_REQUEST', 'Release settlement cannot include billed units');
    }
    const settlement = await tx.aiCostSettlement.create({ data: {
      reservationId: reservation.id,
      ownerUserId: normalized.ownerUserId,
      actorUserId: normalized.actorUserId,
      kind: normalized.kind,
      idempotencyKey: normalized.idempotencyKey,
      requestFingerprint: normalized.requestFingerprint,
      actualCostMinor,
      billedUnits,
      reason: normalized.reason || null,
    } });
    const terminal = normalized.kind === 'CHARGE' || normalized.kind === 'RECONCILED_CHARGE' ? 'SETTLED' : 'RELEASED';
    const updated = await tx.aiCostReservation.updateMany({
      where: { id: reservation.id, ownerUserId: normalized.ownerUserId, status: reservation.status },
      data: {
        status: terminal,
        ...(terminal === 'SETTLED' ? { settledAt: new Date() } : { releasedAt: new Date() }),
      },
    });
    if (updated.count !== 1) throw new AiCostLedgerError('CONFLICT', 'Cost reservation changed during settlement');
    return { reservation: { ...reservation, status: terminal }, settlement, replayed: false };
  };
  try {
    return await runAiMediaSerializableTransaction(database, action);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const reservation = await loadReservation(database, normalized.reservationId, normalized.ownerUserId);
    const existing = await database.aiCostSettlement.findUnique({ where: {
      ai_cost_settlement_reservation_idempotency: {
        reservationId: normalized.reservationId,
        idempotencyKey: normalized.idempotencyKey,
      },
    } });
    if (!existing) throw error;
    assertSameSettlement(existing, { kind: normalized.kind, requestFingerprint: normalized.requestFingerprint, actualCostMinor, billedUnits });
    return { reservation, settlement: existing, replayed: true };
  }
}

export function settleAiCost(database: AiCostLedgerDatabase, input: Omit<Parameters<typeof appendTerminalSettlement>[1], 'kind'>) {
  return appendTerminalSettlement(database, { ...input, kind: 'CHARGE' });
}

export function releaseAiCost(database: AiCostLedgerDatabase, input: Omit<Parameters<typeof appendTerminalSettlement>[1], 'kind'>) {
  return appendTerminalSettlement(database, { ...input, kind: 'RELEASE', actualCostMinor: 0 });
}

export async function markAiCostUnknown(
  database: AiCostLedgerDatabase,
  input: Omit<Parameters<typeof appendTerminalSettlement>[1], 'kind' | 'actualCostMinor'> & {
    providerRequestId: string;
    providerAcceptedAt?: Date;
  },
) {
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
    providerRequestId: required(input.providerRequestId, 'providerRequestId'),
    providerAcceptedAt: input.providerAcceptedAt || new Date(),
  };
  const action = async (tx: AiCostLedgerDatabase) => {
    const reservation = await loadReservation(tx, normalized.reservationId, normalized.ownerUserId);
    const existing = await tx.aiCostSettlement.findUnique({ where: { ai_cost_settlement_reservation_idempotency: {
      reservationId: normalized.reservationId, idempotencyKey: normalized.idempotencyKey,
    } } });
    if (existing) {
      if (reservation.providerRequestId !== normalized.providerRequestId) {
        throw new AiCostLedgerError('IDEMPOTENCY_KEY_CONFLICT', 'Provider request identity changed during replay');
      }
      assertSameSettlement(existing, {
        kind: 'RECONCILIATION_REQUIRED',
        requestFingerprint: normalized.requestFingerprint,
        actualCostMinor: null,
        billedUnits: 0,
      });
      return { reservation, settlement: existing, replayed: true };
    }
    if (reservation.requestFingerprint !== normalized.requestFingerprint) {
      throw new AiCostLedgerError('IDEMPOTENCY_KEY_CONFLICT', 'Cost settlement fingerprint does not match reservation');
    }
    if (reservation.status !== 'RESERVED') throw new AiCostLedgerError('INVALID_STATE', `Reservation is ${reservation.status}`);
    const settlement = await tx.aiCostSettlement.create({ data: {
      reservationId: reservation.id, ownerUserId: normalized.ownerUserId, actorUserId: normalized.actorUserId,
      kind: 'RECONCILIATION_REQUIRED', idempotencyKey: normalized.idempotencyKey,
      requestFingerprint: normalized.requestFingerprint, actualCostMinor: null, billedUnits: 0,
      reason: normalized.reason || 'provider result is unknown',
    } });
    const updated = await tx.aiCostReservation.updateMany({
      where: { id: reservation.id, ownerUserId: normalized.ownerUserId, status: 'RESERVED' },
      data: {
        status: 'RECONCILIATION_REQUIRED',
        providerRequestId: normalized.providerRequestId,
        providerAcceptedAt: normalized.providerAcceptedAt,
        reconciliationRequiredAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new AiCostLedgerError('CONFLICT', 'Cost reservation changed during reconciliation');
    return {
      reservation: {
        ...reservation,
        status: 'RECONCILIATION_REQUIRED',
        providerRequestId: normalized.providerRequestId,
        providerAcceptedAt: normalized.providerAcceptedAt,
      },
      settlement,
      replayed: false,
    };
  };
  try {
    return await runAiMediaSerializableTransaction(database, action);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const reservation = await loadReservation(database, normalized.reservationId, normalized.ownerUserId);
    const existing = await database.aiCostSettlement.findUnique({ where: {
      ai_cost_settlement_reservation_idempotency: {
        reservationId: normalized.reservationId,
        idempotencyKey: normalized.idempotencyKey,
      },
    } });
    if (!existing) throw error;
    if (reservation.providerRequestId !== normalized.providerRequestId) {
      throw new AiCostLedgerError('IDEMPOTENCY_KEY_CONFLICT', 'Provider request identity changed during replay');
    }
    assertSameSettlement(existing, {
      kind: 'RECONCILIATION_REQUIRED', requestFingerprint: normalized.requestFingerprint,
      actualCostMinor: null, billedUnits: 0,
    });
    return { reservation, settlement: existing, replayed: true };
  }
}

export const reconcileAiCost = appendTerminalSettlement;
