import type { AiMediaOperation } from './ai-image-provider-capabilities.js';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';

export type AiCostReservationStatus =
  | 'RESERVED'
  | 'SUBMISSION_UNCERTAIN'
  | 'RECONCILIATION_REQUIRED'
  | 'SETTLED'
  | 'RELEASED';
export type AiCostSettlementKind =
  | 'CHARGE'
  | 'RELEASE'
  | 'SUBMISSION_UNCERTAIN'
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

function validDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AiCostLedgerError('INVALID_REQUEST', `${label} must be a valid Date`);
  }
  return value;
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

function assertSameProviderAcceptance(reservation: any, providerRequestId: string, providerAcceptedAt: Date) {
  const persistedAt = reservation.providerAcceptedAt;
  if (reservation.providerRequestId !== providerRequestId
    || !(persistedAt instanceof Date)
    || persistedAt.getTime() !== providerAcceptedAt.getTime()) {
    throw new AiCostLedgerError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Provider acceptance evidence changed during replay',
    );
  }
}

export async function reserveAiCostInTransaction(
  database: AiCostLedgerDatabase,
  rawInput: AiCostReservationInput,
) {
  const input = normalizedInput(rawInput);
  const existing = await database.aiCostReservation.findUnique({
    where: reservationWhere(input),
    include: { settlements: true },
  });
  if (existing) {
    assertSameReservation(existing, input);
    return { reservation: existing, replayed: true };
  }
  const reservation = await database.aiCostReservation.create({ data: {
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
}

export async function reserveAiCost(database: AiCostLedgerDatabase, rawInput: AiCostReservationInput) {
  const input = normalizedInput(rawInput);
  try {
    return await runAiMediaSerializableTransaction(
      database,
      (transaction) => reserveAiCostInTransaction(transaction, input),
    );
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

export interface AiCostSettlementInput {
  reservationId: string;
  ownerUserId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  kind: AiCostSettlementKind;
  actualCostMinor?: number | null;
  billedUnits?: number;
  reason?: string | null;
  expectedReservationUpdatedAt?: Date;
}

export async function appendAiCostSettlementInTransaction(
  database: AiCostLedgerDatabase,
  input: AiCostSettlementInput,
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
    expectedReservationUpdatedAt: input.expectedReservationUpdatedAt
      ? validDate(input.expectedReservationUpdatedAt, 'expectedReservationUpdatedAt')
      : undefined,
  };
  const tx = database;
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
      ? ['RECONCILIATION_REQUIRED', 'SUBMISSION_UNCERTAIN'].includes(reservation.status)
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
      where: {
        id: reservation.id,
        ownerUserId: normalized.ownerUserId,
        status: reservation.status,
        ...(normalized.expectedReservationUpdatedAt
          ? { updatedAt: normalized.expectedReservationUpdatedAt }
          : {}),
      },
      data: {
        status: terminal,
        ...(terminal === 'SETTLED' ? { settledAt: new Date() } : { releasedAt: new Date() }),
      },
    });
    if (updated.count !== 1) throw new AiCostLedgerError('CONFLICT', 'Cost reservation changed during settlement');
  return {
    reservation: await loadReservation(tx, reservation.id, normalized.ownerUserId),
    settlement,
    replayed: false,
  };
}

async function appendTerminalSettlement(
  database: AiCostLedgerDatabase,
  input: AiCostSettlementInput,
) {
  const actualCostMinor = input.actualCostMinor == null
    ? null
    : nonNegativeInteger(input.actualCostMinor, 'actualCostMinor');
  const billedUnits = nonNegativeInteger(input.billedUnits ?? 0, 'billedUnits');
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
  };
  try {
    return await runAiMediaSerializableTransaction(
      database,
      (transaction) => appendAiCostSettlementInTransaction(transaction, normalized),
    );
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

export function settleAiCostInTransaction(
  database: AiCostLedgerDatabase,
  input: Omit<AiCostSettlementInput, 'kind'>,
) {
  return appendAiCostSettlementInTransaction(database, { ...input, kind: 'CHARGE' });
}

export function releaseAiCost(database: AiCostLedgerDatabase, input: Omit<Parameters<typeof appendTerminalSettlement>[1], 'kind'>) {
  return appendTerminalSettlement(database, { ...input, kind: 'RELEASE', actualCostMinor: 0 });
}

export function releaseAiCostInTransaction(
  database: AiCostLedgerDatabase,
  input: Omit<AiCostSettlementInput, 'kind'>,
) {
  return appendAiCostSettlementInTransaction(database, { ...input, kind: 'RELEASE', actualCostMinor: 0 });
}

export type AiCostSubmissionUncertainInput = Omit<AiCostSettlementInput, 'kind' | 'actualCostMinor'>;

export async function markAiCostSubmissionUncertainInTransaction(
  database: AiCostLedgerDatabase,
  input: AiCostSubmissionUncertainInput,
) {
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
  };
  const reservation = await loadReservation(database, normalized.reservationId, normalized.ownerUserId);
  const existing = await database.aiCostSettlement.findUnique({ where: {
    ai_cost_settlement_reservation_idempotency: {
      reservationId: normalized.reservationId,
      idempotencyKey: normalized.idempotencyKey,
    },
  } });
  if (existing) {
    assertSameSettlement(existing, {
      kind: 'SUBMISSION_UNCERTAIN',
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
  const settlement = await database.aiCostSettlement.create({ data: {
    reservationId: reservation.id,
    ownerUserId: normalized.ownerUserId,
    actorUserId: normalized.actorUserId,
    kind: 'SUBMISSION_UNCERTAIN',
    idempotencyKey: normalized.idempotencyKey,
    requestFingerprint: normalized.requestFingerprint,
    actualCostMinor: null,
    billedUnits: 0,
    reason: normalized.reason || 'provider submission outcome is uncertain',
  } });
  const updated = await database.aiCostReservation.updateMany({
    where: { id: reservation.id, ownerUserId: normalized.ownerUserId, status: 'RESERVED' },
    data: { status: 'SUBMISSION_UNCERTAIN', reconciliationRequiredAt: new Date() },
  });
  if (updated.count !== 1) throw new AiCostLedgerError('CONFLICT', 'Cost reservation changed during submission quarantine');
  return {
    reservation: await loadReservation(database, reservation.id, normalized.ownerUserId),
    settlement,
    replayed: false,
  };
}

export async function markAiCostSubmissionUncertain(
  database: AiCostLedgerDatabase,
  input: AiCostSubmissionUncertainInput,
) {
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
  };
  try {
    return await runAiMediaSerializableTransaction(
      database,
      (transaction) => markAiCostSubmissionUncertainInTransaction(transaction, normalized),
    );
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
    assertSameSettlement(existing, {
      kind: 'SUBMISSION_UNCERTAIN',
      requestFingerprint: normalized.requestFingerprint,
      actualCostMinor: null,
      billedUnits: 0,
    });
    return { reservation, settlement: existing, replayed: true };
  }
}

export type AiCostUnknownInput = Omit<AiCostSettlementInput, 'kind' | 'actualCostMinor'> & {
  providerRequestId: string;
  providerAcceptedAt: Date;
};

export async function markAiCostUnknownInTransaction(
  database: AiCostLedgerDatabase,
  input: AiCostUnknownInput,
) {
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
    providerRequestId: required(input.providerRequestId, 'providerRequestId'),
    providerAcceptedAt: validDate(input.providerAcceptedAt, 'providerAcceptedAt'),
  };
  const tx = database;
    const reservation = await loadReservation(tx, normalized.reservationId, normalized.ownerUserId);
    const existing = await tx.aiCostSettlement.findUnique({ where: { ai_cost_settlement_reservation_idempotency: {
      reservationId: normalized.reservationId, idempotencyKey: normalized.idempotencyKey,
    } } });
    if (existing) {
      assertSameProviderAcceptance(reservation, normalized.providerRequestId, normalized.providerAcceptedAt);
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
    if (!['RESERVED', 'SUBMISSION_UNCERTAIN'].includes(reservation.status)) {
      throw new AiCostLedgerError('INVALID_STATE', `Reservation is ${reservation.status}`);
    }
    const settlement = await tx.aiCostSettlement.create({ data: {
      reservationId: reservation.id, ownerUserId: normalized.ownerUserId, actorUserId: normalized.actorUserId,
      kind: 'RECONCILIATION_REQUIRED', idempotencyKey: normalized.idempotencyKey,
      requestFingerprint: normalized.requestFingerprint, actualCostMinor: null, billedUnits: 0,
      reason: normalized.reason || 'provider result is unknown',
    } });
    const updated = await tx.aiCostReservation.updateMany({
      where: {
        id: reservation.id,
        ownerUserId: normalized.ownerUserId,
        status: { in: ['RESERVED', 'SUBMISSION_UNCERTAIN'] },
      },
      data: {
        status: 'RECONCILIATION_REQUIRED',
        providerRequestId: normalized.providerRequestId,
        providerAcceptedAt: normalized.providerAcceptedAt,
        ...(reservation.status === 'RESERVED' ? { reconciliationRequiredAt: new Date() } : {}),
      },
    });
    if (updated.count !== 1) throw new AiCostLedgerError('CONFLICT', 'Cost reservation changed during reconciliation');
  return {
      reservation: await loadReservation(tx, reservation.id, normalized.ownerUserId),
      settlement,
      replayed: false,
    };
}

export async function markAiCostUnknown(
  database: AiCostLedgerDatabase,
  input: AiCostUnknownInput,
) {
  const normalized = {
    ...input,
    reservationId: required(input.reservationId, 'reservationId'),
    ownerUserId: required(input.ownerUserId, 'ownerUserId'),
    actorUserId: required(input.actorUserId, 'actorUserId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    requestFingerprint: sha256(input.requestFingerprint, 'requestFingerprint'),
    providerRequestId: required(input.providerRequestId, 'providerRequestId'),
    providerAcceptedAt: validDate(input.providerAcceptedAt, 'providerAcceptedAt'),
  };
  try {
    return await runAiMediaSerializableTransaction(
      database,
      (transaction) => markAiCostUnknownInTransaction(transaction, normalized),
    );
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
    assertSameProviderAcceptance(reservation, normalized.providerRequestId, normalized.providerAcceptedAt);
    assertSameSettlement(existing, {
      kind: 'RECONCILIATION_REQUIRED', requestFingerprint: normalized.requestFingerprint,
      actualCostMinor: null, billedUnits: 0,
    });
    return { reservation, settlement: existing, replayed: true };
  }
}

export const reconcileAiCost = appendTerminalSettlement;
