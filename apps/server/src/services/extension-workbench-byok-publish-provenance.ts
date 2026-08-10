import type { PrismaClient } from '@prisma/client';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_ASSETS = 500;
const SUBMITTED_RECONCILIATION_STATES = new Set([
  'PENDING',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCEEDED',
  'PARTIAL_FAILURE',
  'FAILED',
  'MANUAL_REVIEW',
]);

type ProvenanceDatabase = {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
  extensionByokMediaProvenance: {
    findMany(input: unknown): Promise<unknown[]>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  sourceListingPublishIntent: {
    findFirst(input: unknown): Promise<unknown>;
  };
  extensionCommandReceipt: {
    findFirst(input: unknown): Promise<unknown>;
  };
};

type ProvenanceClient = ProvenanceDatabase & {
  $transaction<T>(
    callback: (transaction: ProvenanceDatabase) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
};

class RetryableProvenanceRace extends Error {
  constructor() {
    super('Workbench BYOK publish provenance changed concurrently');
    this.name = 'RetryableProvenanceRace';
  }
}

export interface ExtensionWorkbenchByokPublishProvenanceBasis {
  ownerUserId: string;
  shopId: string;
  workflowId: string;
  assetIds: string[];
}

export interface ExtensionWorkbenchByokPublishProvenanceLinkInput
  extends ExtensionWorkbenchByokPublishProvenanceBasis {
  publishIntentId: string;
  publishReceiptId: string;
  requestHash: string;
}

export class ExtensionWorkbenchByokPublishProvenanceError extends Error {
  readonly code = 'EXTENSION_WORKBENCH_BYOK_PUBLISH_PROVENANCE_CONFLICT' as const;
  readonly statusCode = 409 as const;

  constructor() {
    super('Workbench BYOK publish provenance has an unsafe publish history');
    this.name = 'ExtensionWorkbenchByokPublishProvenanceError';
  }
}

function conflict(): never {
  throw new ExtensionWorkbenchByokPublishProvenanceError();
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string'
    || !value
    || value.length > 500
    || value !== value.normalize('NFKC').trim()) return conflict();
  return value;
}

function basis(input: ExtensionWorkbenchByokPublishProvenanceBasis) {
  const ownerUserId = identifier(input?.ownerUserId);
  const shopId = identifier(input?.shopId);
  const workflowId = identifier(input?.workflowId);
  if (!Array.isArray(input?.assetIds)
    || input.assetIds.length < 1
    || input.assetIds.length > MAX_ASSETS) return conflict();
  const assetIds = input.assetIds.map(identifier);
  if (new Set(assetIds).size !== assetIds.length) return conflict();
  return { ownerUserId, shopId, workflowId, assetIds };
}

function linkedPair(row: Record<string, any>): 'unlinked' | 'linked' {
  const publishIntentId = row.publishIntentId;
  const publishReceiptId = row.publishReceiptId;
  if (publishIntentId === null && publishReceiptId === null) return 'unlinked';
  if (typeof publishIntentId !== 'string'
    || !publishIntentId
    || typeof publishReceiptId !== 'string'
    || !publishReceiptId) return conflict();
  return 'linked';
}

function exactIdentity(
  row: Record<string, any>,
  expected: { ownerUserId: string; shopId: string; workflowId: string },
): boolean {
  return row.ownerUserId === expected.ownerUserId
    && row.shopId === expected.shopId
    && row.workflowId === expected.workflowId;
}

function validTimestamp(value: unknown): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function exactAttemptIdentity(
  attempt: Record<string, any>,
  intent: Record<string, any>,
  expected: { ownerUserId: string; shopId: string; workflowId: string },
): boolean {
  return exactIdentity(attempt, expected)
    && attempt.publishIntentId === intent.id
    && attempt.draftVersion === intent.draftVersion;
}

function definitiveRejectedAttempt(attempt: Record<string, any>): boolean {
  return attempt.state === 'REJECTED'
    && attempt.reconciliationState === 'NOT_REQUIRED'
    && attempt.ozonTaskId === null
    && attempt.acceptanceSource === null
    && attempt.leasePurpose === null
    && attempt.leaseToken === null
    && attempt.leaseOwner === null
    && attempt.heartbeatAt === null
    && attempt.leaseExpiresAt === null
    && validTimestamp(attempt.submitStartedAt)
    && attempt.submittedAt === null
    && validTimestamp(attempt.rejectedAt);
}

function trustworthySubmittedAttempt(attempt: Record<string, any>): boolean {
  const reconciliationLeaseValid = attempt.reconciliationState === 'RUNNING'
    ? attempt.leasePurpose === 'RECONCILE'
      && typeof attempt.leaseToken === 'string'
      && Boolean(attempt.leaseToken)
      && typeof attempt.leaseOwner === 'string'
      && Boolean(attempt.leaseOwner)
      && validTimestamp(attempt.heartbeatAt)
      && validTimestamp(attempt.leaseExpiresAt)
      && attempt.leaseExpiresAt.getTime() > attempt.heartbeatAt.getTime()
    : attempt.leasePurpose === null
      && attempt.leaseToken === null
      && attempt.leaseOwner === null
      && attempt.heartbeatAt === null
      && attempt.leaseExpiresAt === null;
  return typeof attempt.id === 'string'
    && Boolean(attempt.id)
    && attempt.state === 'SUBMITTED'
    && SUBMITTED_RECONCILIATION_STATES.has(attempt.reconciliationState)
    && typeof attempt.ozonTaskId === 'string'
    && /^[1-9][0-9]{0,39}$/u.test(attempt.ozonTaskId)
    && typeof attempt.acceptanceSource === 'string'
    && /^[A-Z][A-Z0-9_]{0,79}$/u.test(attempt.acceptanceSource)
    && reconciliationLeaseValid
    && validTimestamp(attempt.submitStartedAt)
    && validTimestamp(attempt.submittedAt)
    && attempt.rejectedAt === null;
}

function timestampIdentity(value: unknown, expected: unknown): boolean {
  return validTimestamp(expected)
    && typeof value === 'string'
    && value === (expected as Date).toISOString();
}

function successfulReceiptMatchesAttempt(
  receipt: Record<string, any>,
  attempt: Record<string, any>,
): boolean {
  const result = record(receipt.result);
  return Boolean(result)
    && result!.id === attempt.id
    && result!.publishIntentId === attempt.publishIntentId
    && result!.ownerUserId === attempt.ownerUserId
    && result!.shopId === attempt.shopId
    && result!.workflowId === attempt.workflowId
    && result!.draftVersion === attempt.draftVersion
    && result!.state === 'SUBMITTED'
    && result!.reconciliationState === 'PENDING'
    && result!.ozonTaskId === attempt.ozonTaskId
    && result!.acceptanceSource === attempt.acceptanceSource
    && timestampIdentity(result!.submitStartedAt, attempt.submitStartedAt)
    && timestampIdentity(result!.submittedAt, attempt.submittedAt)
    && result!.rejectedAt === null;
}

function exactCommandIdentity(
  intent: Record<string, any>,
  grant: Record<string, any>,
  expected: { ownerUserId: string; shopId: string; workflowId: string },
): boolean {
  return exactIdentity(intent, expected)
    && exactIdentity(grant, expected)
    && Number.isSafeInteger(intent.draftVersion)
    && intent.draftVersion >= 1
    && grant.draftVersion === intent.draftVersion
    && grant.operation === 'OZON_PUBLISH'
    && typeof intent.idempotencyKey === 'string'
    && Boolean(intent.idempotencyKey)
    && grant.idempotencyKey === intent.idempotencyKey
    && typeof grant.requestHash === 'string'
    && SHA256_PATTERN.test(grant.requestHash);
}

function isDefinitiveRejectedHistory(
  provenance: Record<string, any>,
  expected: { ownerUserId: string; shopId: string; workflowId: string },
): boolean {
  const intent = record(provenance.publishIntent);
  const receipt = record(provenance.publishReceipt);
  const attempt = record(intent?.publishAttempt);
  const grant = record(receipt?.grant);
  if (!intent || !receipt || !attempt || !grant) return false;
  if (intent.id !== provenance.publishIntentId
    || receipt.id !== provenance.publishReceiptId
    || !exactCommandIdentity(intent, grant, expected)
    || !exactAttemptIdentity(attempt, intent, expected)) return false;
  return receipt.status === 'FAILED'
    && receipt.result === null
    && receipt.failureCode === 'OZON_SUBMIT_REJECTED'
    && definitiveRejectedAttempt(attempt);
}

const attemptSelect = {
  id: true,
  publishIntentId: true,
  ownerUserId: true,
  shopId: true,
  workflowId: true,
  draftVersion: true,
  state: true,
  reconciliationState: true,
  ozonTaskId: true,
  acceptanceSource: true,
  leasePurpose: true,
  leaseToken: true,
  leaseOwner: true,
  heartbeatAt: true,
  leaseExpiresAt: true,
  submitStartedAt: true,
  submittedAt: true,
  rejectedAt: true,
} as const;

const provenanceSelect = {
  id: true,
  executionMode: true,
  ownerUserId: true,
  shopId: true,
  workflowId: true,
  assetId: true,
  publishIntentId: true,
  publishReceiptId: true,
  publishIntent: {
    select: {
      id: true,
      ownerUserId: true,
      shopId: true,
      workflowId: true,
      draftVersion: true,
      idempotencyKey: true,
      publishAttempt: {
        select: attemptSelect,
      },
    },
  },
  publishReceipt: {
    select: {
      id: true,
      status: true,
      result: true,
      failureCode: true,
      grant: {
        select: {
          ownerUserId: true,
          shopId: true,
          workflowId: true,
          draftVersion: true,
          operation: true,
          idempotencyKey: true,
          requestHash: true,
        },
      },
    },
  },
} as const;

async function loadRows(
  database: ProvenanceDatabase,
  input: ReturnType<typeof basis>,
): Promise<Record<string, any>[]> {
  const values = await database.extensionByokMediaProvenance.findMany({
    where: {
      executionMode: 'BYOK',
      ownerUserId: input.ownerUserId,
      shopId: input.shopId,
      workflowId: input.workflowId,
      assetId: { in: input.assetIds },
    },
    select: provenanceSelect,
  });
  if (!Array.isArray(values) || values.length > input.assetIds.length) return conflict();
  const expectedAssets = new Set(input.assetIds);
  const seenAssets = new Set<string>();
  const seenRows = new Set<string>();
  return values.map((value) => {
    const row = record(value);
    if (!row
      || row.executionMode !== 'BYOK'
      || !exactIdentity(row, input)
      || typeof row.id !== 'string'
      || !row.id
      || seenRows.has(row.id)
      || typeof row.assetId !== 'string'
      || !expectedAssets.has(row.assetId)
      || seenAssets.has(row.assetId)) return conflict();
    seenRows.add(row.id);
    seenAssets.add(row.assetId);
    return row;
  });
}

function classifyTarget(
  intentValue: unknown,
  receiptValue: unknown,
  input: ReturnType<typeof linkInput>,
): 'LINKABLE' | 'NOOP' {
  const intent = record(intentValue);
  const receipt = record(receiptValue);
  const grant = record(receipt?.grant);
  const attempt = record(intent?.publishAttempt);
  if (!intent || !receipt || !grant
    || intent.id !== input.publishIntentId
    || receipt.id !== input.publishReceiptId
    || !exactCommandIdentity(intent, grant, input)
    || grant.requestHash !== input.requestHash) return conflict();
  if (!attempt) return 'NOOP';
  if (!exactAttemptIdentity(attempt, intent, input)) return conflict();
  if (receipt.status === 'FAILED'
    && receipt.result === null
    && receipt.failureCode === 'OZON_SUBMIT_REJECTED'
    && definitiveRejectedAttempt(attempt)) return 'LINKABLE';
  if (receipt.status === 'SUCCEEDED'
    && receipt.failureCode === null
    && trustworthySubmittedAttempt(attempt)) {
    if (!successfulReceiptMatchesAttempt(receipt, attempt)) return conflict();
    return 'LINKABLE';
  }
  return 'NOOP';
}

function linkInput(input: ExtensionWorkbenchByokPublishProvenanceLinkInput) {
  const parsed = {
    ...basis(input),
    publishIntentId: identifier(input?.publishIntentId),
    publishReceiptId: identifier(input?.publishReceiptId),
    requestHash: input?.requestHash,
  };
  if (typeof parsed.requestHash !== 'string'
    || !SHA256_PATTERN.test(parsed.requestHash)) return conflict();
  return parsed as Omit<typeof parsed, 'requestHash'> & { requestHash: string };
}

export function createExtensionWorkbenchByokPublishProvenanceService(
  client: PrismaClient | ProvenanceClient,
) {
  const database = client as unknown as ProvenanceClient;
  return {
    async assertReusable(rawInput: ExtensionWorkbenchByokPublishProvenanceBasis) {
      const input = basis(rawInput);
      const rows = await loadRows(database, input);
      if (rows.length !== input.assetIds.length) return conflict();
      let rejectedHistoryCount = 0;
      for (const row of rows) {
        if (linkedPair(row) === 'unlinked') continue;
        if (!isDefinitiveRejectedHistory(row, input)) return conflict();
        rejectedHistoryCount += 1;
      }
      return { provenanceCount: rows.length, rejectedHistoryCount };
    },

    async linkStatus(rawInput: ExtensionWorkbenchByokPublishProvenanceLinkInput) {
      const input = linkInput(rawInput);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await database.$transaction(async (transaction) => {
            await transaction.$queryRawUnsafe(
              'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
              `ozon-publish-attempt-workflow:${input.ownerUserId}:${input.workflowId}`,
            );
            const rows = await loadRows(transaction, input);
            if (rows.length === 0) {
              return {
                linkedCount: 0,
                replayedCount: 0,
                preservedRejectedCount: 0,
                skippedTargetCount: 0,
              };
            }
            const [targetIntent, targetReceipt] = await Promise.all([
              transaction.sourceListingPublishIntent.findFirst({
                where: {
                  id: input.publishIntentId,
                  ownerUserId: input.ownerUserId,
                  shopId: input.shopId,
                  workflowId: input.workflowId,
                },
                select: {
                  id: true,
                  ownerUserId: true,
                  shopId: true,
                  workflowId: true,
                  draftVersion: true,
                  idempotencyKey: true,
                  publishAttempt: { select: attemptSelect },
                },
              }),
              transaction.extensionCommandReceipt.findFirst({
                where: { id: input.publishReceiptId },
                select: {
                  id: true,
                  status: true,
                  result: true,
                  failureCode: true,
                  grant: {
                    select: {
                      ownerUserId: true,
                      shopId: true,
                      workflowId: true,
                      draftVersion: true,
                      operation: true,
                      idempotencyKey: true,
                      requestHash: true,
                    },
                  },
                },
              }),
            ]);
            if (classifyTarget(targetIntent, targetReceipt, input) === 'NOOP') {
              return {
                linkedCount: 0,
                replayedCount: 0,
                preservedRejectedCount: 0,
                skippedTargetCount: rows.length,
              };
            }

            const unlinkedIds: string[] = [];
            let replayedCount = 0;
            let preservedRejectedCount = 0;
            for (const row of rows) {
              if (linkedPair(row) === 'unlinked') {
                unlinkedIds.push(row.id);
                continue;
              }
              if (row.publishIntentId === input.publishIntentId
                && row.publishReceiptId === input.publishReceiptId) {
                replayedCount += 1;
                continue;
              }
              if (!isDefinitiveRejectedHistory(row, input)) return conflict();
              preservedRejectedCount += 1;
            }

            if (unlinkedIds.length) {
              const updated = await transaction.extensionByokMediaProvenance.updateMany({
                where: {
                  id: { in: unlinkedIds },
                  executionMode: 'BYOK',
                  ownerUserId: input.ownerUserId,
                  shopId: input.shopId,
                  workflowId: input.workflowId,
                  publishIntentId: null,
                  publishReceiptId: null,
                },
                data: {
                  publishIntentId: input.publishIntentId,
                  publishReceiptId: input.publishReceiptId,
                },
              });
              if (updated.count !== unlinkedIds.length) {
                throw new RetryableProvenanceRace();
              }
            }
            return {
              linkedCount: unlinkedIds.length,
              replayedCount,
              preservedRejectedCount,
              skippedTargetCount: 0,
            };
          }, { isolationLevel: 'Serializable' });
        } catch (error) {
          const retryable = error instanceof RetryableProvenanceRace
            || record(error)?.code === 'P2034';
          if (!retryable) throw error;
        }
      }
      return conflict();
    },
  };
}

export type ExtensionWorkbenchByokPublishProvenanceService = ReturnType<
  typeof createExtensionWorkbenchByokPublishProvenanceService
>;
