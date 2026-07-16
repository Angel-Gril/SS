import {
  cloneOzonPublishObject,
  normalizeOzonPublishTaskId,
  OzonPublishAttemptError,
  type OzonPublishAttemptRepository,
  type OzonPublishJson,
  type OzonPublishReconciliationAttemptRecord,
  type OzonPublishReconciliationLeaseClaim,
  type OzonReconciliationOutcome,
} from './ozon-publish-attempts.js';
import {
  summarizeOzonImportItems,
  type OzonImportStatusError,
  type OzonImportStatusItem,
} from './ozon-import-status.js';

const MAX_IMPORT_ITEMS = 500;
const MAX_ERRORS_PER_ITEM = 50;
const MAX_TOTAL_ERRORS = 500;
const MAX_RECONCILIATION_JSON_BYTES = 2_000_000;
const MAX_LATE_ACKNOWLEDGEMENT_BYTES = 256 * 1024;

export interface OzonPublishReconciliationClient {
  getImportInfo(taskId: number | string): Promise<unknown>;
  getProductInfoByOfferId?(offerIds: string[]): Promise<unknown>;
}

export type ResolveOwnedOzonPublishClient = (
  ownerUserId: string,
  shopId: string,
) => Promise<OzonPublishReconciliationClient> | OzonPublishReconciliationClient;

export type OzonUnknownAcknowledgementProbeResult =
  | {
    confirmedAccepted: true;
    trustworthy: true;
    taskId: number | string | bigint;
    evidence: unknown;
  }
  | {
    confirmedAccepted: boolean;
    trustworthy?: boolean;
    taskId?: number | string | bigint;
    evidence?: unknown;
    reason?: string;
  };

export type ProbeUnknownOzonPublishAttempt = (
  attempt: OzonPublishReconciliationAttemptRecord,
  client: OzonPublishReconciliationClient,
) => Promise<OzonUnknownAcknowledgementProbeResult> | OzonUnknownAcknowledgementProbeResult;

export interface OzonPublishReconciliationLogger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface OzonPublishReconciliationSettings {
  workerId: string;
  leaseMs: number;
  claimLimit: number;
  staleSubmissionLimit: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  maxAttempts: number;
}

export const DEFAULT_OZON_PUBLISH_RECONCILIATION_SETTINGS: OzonPublishReconciliationSettings = {
  workerId: 'ozon-publish-reconciliation',
  leaseMs: 5 * 60_000,
  claimLimit: 5,
  staleSubmissionLimit: 100,
  retryBaseDelayMs: 5_000,
  retryMaxDelayMs: 5 * 60_000,
  maxAttempts: 20,
};

export interface OzonPublishReconciliationTickResult {
  staleMarked: number;
  claimed: number;
  completed: number;
  retried: number;
  manualReview: number;
  lateAcknowledged: number;
  leaseLost: number;
  failed: number;
  skipped: number;
}

export interface RunOzonPublishReconciliationTickInput {
  repository: OzonPublishAttemptRepository;
  resolveOwnedClient: ResolveOwnedOzonPublishClient;
  probeUnknownAttempt?: ProbeUnknownOzonPublishAttempt;
  settings?: Partial<OzonPublishReconciliationSettings>;
  now?: () => Date;
  logger?: OzonPublishReconciliationLogger;
}

interface BoundedImportError extends Record<string, OzonPublishJson> {
  code: string;
  state: string;
  level: string;
  description: string;
  field: string;
  truncatedFields: string[];
}

interface BoundedImportItemResult extends Record<string, OzonPublishJson> {
  ordinal: number;
  offerId: string;
  skuKey: string;
  found: boolean;
  providerOfferId: string | null;
  productId: number | null;
  status: string | null;
  errors: BoundedImportError[];
  errorCount: number;
  errorsTruncated: boolean;
}

interface BoundedImportItemError extends BoundedImportError {
  ordinal: number;
  offerId: string;
  skuKey: string;
  productId: number | null;
  status: string | null;
}

interface MappedImportInfo {
  itemResults: BoundedImportItemResult[];
  itemErrors: BoundedImportItemError[];
  total: number;
  pending: number;
  failed: number;
  allDone: boolean;
}

interface LateAcknowledgementAction {
  kind: 'ATTACH_LATE_ACKNOWLEDGEMENT';
  taskId: string;
  response: Record<string, OzonPublishJson>;
}

const defaultLogger: OzonPublishReconciliationLogger = {
  info: (message, details) => details === undefined ? console.log(message) : console.log(message, details),
  warn: (message, details) => details === undefined ? console.warn(message) : console.warn(message, details),
  error: (message, details) => details === undefined ? console.error(message) : console.error(message, details),
};

function integerSetting(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

export function normalizeOzonPublishReconciliationSettings(
  input: Partial<OzonPublishReconciliationSettings> = {},
): OzonPublishReconciliationSettings {
  const merged = { ...DEFAULT_OZON_PUBLISH_RECONCILIATION_SETTINGS, ...input };
  const workerId = String(merged.workerId || '').normalize('NFKC').trim();
  if (workerId.length < 1 || workerId.length > 200) {
    throw new Error('workerId must contain 1 to 200 characters');
  }
  const settings = {
    workerId,
    leaseMs: integerSetting(merged.leaseMs, 'leaseMs', 1_000, 15 * 60_000),
    claimLimit: integerSetting(merged.claimLimit, 'claimLimit', 1, 100),
    staleSubmissionLimit: integerSetting(
      merged.staleSubmissionLimit,
      'staleSubmissionLimit',
      1,
      100,
    ),
    retryBaseDelayMs: integerSetting(
      merged.retryBaseDelayMs,
      'retryBaseDelayMs',
      1,
      24 * 60 * 60_000,
    ),
    retryMaxDelayMs: integerSetting(
      merged.retryMaxDelayMs,
      'retryMaxDelayMs',
      1,
      7 * 24 * 60 * 60_000,
    ),
    maxAttempts: integerSetting(merged.maxAttempts, 'maxAttempts', 1, 1_000),
  };
  if (settings.retryMaxDelayMs < settings.retryBaseDelayMs) {
    throw new Error('retryMaxDelayMs cannot be less than retryBaseDelayMs');
  }
  return settings;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedProviderText(
  value: unknown,
  label: string,
  maximum: number,
  required = false,
): string {
  if (value == null) {
    if (required) throw new Error(`${label} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if ((required && !text) || text.length > maximum) {
    throw new Error(`${label} is outside its bounded length`);
  }
  return text;
}

function boundedImportError(value: unknown, itemIndex: number, errorIndex: number): BoundedImportError {
  const error = asRecord(value, `Ozon import item ${itemIndex} error ${errorIndex}`);
  const code = truncatedProviderText(error.code, 'Ozon error code', 100);
  const state = truncatedProviderText(error.state, 'Ozon error state', 50);
  const level = truncatedProviderText(error.level, 'Ozon error level', 50);
  const description = truncatedProviderText(
    error.description ?? error.message,
    'Ozon error description',
    1_000,
  );
  const field = truncatedProviderText(error.field, 'Ozon error field', 200);
  const truncatedFields: string[] = [];
  if (code.truncated) truncatedFields.push('code');
  if (state.truncated) truncatedFields.push('state');
  if (level.truncated) truncatedFields.push('level');
  if (description.truncated) truncatedFields.push('description');
  if (field.truncated) truncatedFields.push('field');
  return {
    code: code.value,
    state: state.value,
    level: level.value,
    description: description.value,
    field: field.value,
    truncatedFields,
  };
}

function truncatedProviderText(
  value: unknown,
  label: string,
  maximumBytes: number,
): { value: string; truncated: boolean } {
  if (value == null) return { value: '', truncated: false };
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const text = value.trim();
  if (Buffer.byteLength(text, 'utf8') <= maximumBytes) {
    return { value: text, truncated: false };
  }
  const output: string[] = [];
  let bytes = 0;
  for (const character of text) {
    const nextBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + nextBytes > maximumBytes) break;
    output.push(character);
    bytes += nextBytes;
  }
  return { value: output.join(''), truncated: true };
}

function hasBlockingRawError(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const error = value as Record<string, unknown>;
  return String(error.level || '').toLowerCase() === 'error'
    || String(error.state || '').toLowerCase() === 'declined';
}

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Ozon import reconciliation result is not JSON');
  return Buffer.byteLength(serialized, 'utf8');
}

function assertBoundedReconciliationJson(value: unknown, label: string): void {
  if (jsonBytes(value) > MAX_RECONCILIATION_JSON_BYTES) {
    throw new Error(`${label} exceeds ${MAX_RECONCILIATION_JSON_BYTES} UTF-8 bytes`);
  }
}

function mapImportInfo(
  response: unknown,
  attempt: OzonPublishReconciliationAttemptRecord,
): MappedImportInfo {
  const info = asRecord(response, 'Ozon import info');
  if (!Array.isArray(info.items)) throw new Error('Ozon import info items must be an array');
  if (info.items.length > MAX_IMPORT_ITEMS) {
    throw new Error(`Ozon import info exceeds ${MAX_IMPORT_ITEMS} items`);
  }

  const byOfferId = new Map<string, {
    providerOfferId: string;
    productId: number | null;
    status: string;
    errors: BoundedImportError[];
    errorCount: number;
    errorEntriesTruncated: boolean;
    errorsTruncated: boolean;
    hasBlockingError: boolean;
  }>();
  let storedErrorCount = 0;
  for (const [itemIndex, value] of info.items.entries()) {
    const item = asRecord(value, `Ozon import item ${itemIndex}`);
    const providerOfferId = boundedProviderText(
      item.offer_id,
      `Ozon import item ${itemIndex} offer_id`,
      200,
      true,
    );
    if (byOfferId.has(providerOfferId)) {
      throw new Error(`Ozon import info contains duplicate offer_id ${providerOfferId}`);
    }
    const rawErrors = item.errors == null ? [] : item.errors;
    if (!Array.isArray(rawErrors)) throw new Error(`Ozon import item ${itemIndex} errors must be an array`);
    const retainedErrorCount = Math.min(
      rawErrors.length,
      MAX_ERRORS_PER_ITEM,
      Math.max(0, MAX_TOTAL_ERRORS - storedErrorCount),
    );
    const retainedErrors = rawErrors.slice(0, retainedErrorCount)
      .map((error, errorIndex) => boundedImportError(error, itemIndex, errorIndex));
    storedErrorCount += retainedErrors.length;
    const errorEntriesTruncated = retainedErrors.length < rawErrors.length;
    const productIdNumber = Number(item.product_id);
    byOfferId.set(providerOfferId, {
      providerOfferId,
      productId: Number.isSafeInteger(productIdNumber) && productIdNumber > 0
        ? productIdNumber
        : null,
      status: boundedProviderText(item.status, `Ozon import item ${itemIndex} status`, 100),
      errors: retainedErrors,
      errorCount: rawErrors.length,
      errorEntriesTruncated,
      errorsTruncated: errorEntriesTruncated
        || retainedErrors.some((error) => error.truncatedFields.length > 0),
      hasBlockingError: rawErrors.some(hasBlockingRawError),
    });
  }

  const expectedOffers = new Set(attempt.offerTrace.map((trace) => trace.offerId));
  const unexpectedOffers = [...byOfferId.keys()].filter((offerId) => !expectedOffers.has(offerId));
  if (unexpectedOffers.length) {
    throw new Error(`Ozon import info contains offers outside the immutable trace: ${unexpectedOffers.join(', ')}`);
  }

  const summaryItems: OzonImportStatusItem[] = [];
  const itemResults: BoundedImportItemResult[] = [];
  const itemErrors: BoundedImportItemError[] = [];
  for (const trace of attempt.offerTrace) {
    const provider = byOfferId.get(trace.offerId);
    if (!provider) {
      itemResults.push({
        ordinal: trace.ordinal,
        offerId: trace.offerId,
        skuKey: trace.skuKey,
        found: false,
        providerOfferId: null,
        productId: null,
        status: null,
        errors: [],
        errorCount: 0,
        errorsTruncated: false,
      });
      summaryItems.push({ offer_id: trace.offerId, status: 'pending', errors: [] });
      continue;
    }

    const status = provider.status || null;
    itemResults.push({
      ordinal: trace.ordinal,
      offerId: trace.offerId,
      skuKey: trace.skuKey,
      found: true,
      providerOfferId: provider.providerOfferId,
      productId: provider.productId,
      status,
      errors: provider.errors,
      errorCount: provider.errorCount,
      errorsTruncated: provider.errorsTruncated,
    });
    const summaryErrors: OzonImportStatusError[] = provider.errors.map((error) => ({
      code: error.code,
      state: error.state,
      level: error.level,
      description: error.description,
      message: error.description,
    }));
    if (provider.hasBlockingError && !summaryErrors.some(hasBlockingRawError)) {
      summaryErrors.push({
        code: 'OZON_ERRORS_TRUNCATED',
        state: 'declined',
        level: 'error',
        description: 'A blocking Ozon error exists outside the retained diagnostic sample',
      });
    }
    summaryItems.push({
      offer_id: trace.offerId,
      product_id: provider.productId || undefined,
      status: provider.status.toLowerCase() || 'pending',
      errors: summaryErrors,
    });
    for (const error of provider.errors) {
      itemErrors.push({
        ordinal: trace.ordinal,
        offerId: trace.offerId,
        skuKey: trace.skuKey,
        productId: provider.productId,
        status,
        ...error,
      });
    }
    if (provider.errorsTruncated) {
      const truncationDetails = [
        provider.errorEntriesTruncated
          ? `Retained ${provider.errors.length} of ${provider.errorCount} Ozon errors`
          : null,
        provider.errors.some((error) => error.truncatedFields.length > 0)
          ? 'Truncated oversized fields in the retained Ozon error sample'
          : null,
      ].filter(Boolean).join('; ');
      itemErrors.push({
        ordinal: trace.ordinal,
        offerId: trace.offerId,
        skuKey: trace.skuKey,
        productId: provider.productId,
        status,
        code: 'OZON_ERRORS_TRUNCATED',
        state: provider.hasBlockingError ? 'declined' : 'truncated',
        level: provider.hasBlockingError ? 'error' : 'warning',
        description: truncationDetails,
        field: '',
        truncatedFields: [],
      });
    }
  }

  assertBoundedReconciliationJson(itemResults, 'Ozon import item results');
  assertBoundedReconciliationJson(itemErrors, 'Ozon import item errors');
  const summary = summarizeOzonImportItems(summaryItems);
  return { itemResults, itemErrors, ...summary };
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || 'unknown reconciliation error');
  return raw.normalize('NFKC').trim().slice(0, 1_800) || 'unknown reconciliation error';
}

function attemptNumber(attempt: OzonPublishReconciliationAttemptRecord): number {
  return Math.max(1, Math.trunc(attempt.reconcileAttemptCount || 0));
}

export function getOzonPublishReconciliationDelayMs(
  attempt: OzonPublishReconciliationAttemptRecord,
  settings: OzonPublishReconciliationSettings,
): number {
  const exponent = Math.min(30, attemptNumber(attempt) - 1);
  return Math.min(settings.retryMaxDelayMs, settings.retryBaseDelayMs * (2 ** exponent));
}

function retryOrManualReview(
  attempt: OzonPublishReconciliationAttemptRecord,
  settings: OzonPublishReconciliationSettings,
  now: () => Date,
  errorCode: string,
  message: string,
  mapped?: Pick<MappedImportInfo, 'itemResults' | 'itemErrors'>,
): OzonReconciliationOutcome {
  const errorMessageValue = message.slice(0, 2_000);
  if (attemptNumber(attempt) >= settings.maxAttempts) {
    return {
      kind: 'MANUAL_REVIEW',
      errorCode,
      errorMessage: errorMessageValue,
      itemResults: mapped?.itemResults,
      itemErrors: mapped?.itemErrors,
    };
  }
  return {
    kind: 'RETRY_WAIT',
    nextReconcileAt: new Date(now().getTime() + getOzonPublishReconciliationDelayMs(attempt, settings)),
    errorCode,
    errorMessage: errorMessageValue,
    itemResults: mapped?.itemResults,
    itemErrors: mapped?.itemErrors,
  };
}

function taskIdForRead(taskId: string): number | string {
  const numeric = Number(taskId);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : taskId;
}

async function reconcileSubmitted(
  claim: OzonPublishReconciliationLeaseClaim,
  input: RunOzonPublishReconciliationTickInput,
  settings: OzonPublishReconciliationSettings,
  now: () => Date,
): Promise<OzonReconciliationOutcome> {
  const { attempt } = claim;
  if (!attempt.ozonTaskId) {
    return retryOrManualReview(
      attempt,
      settings,
      now,
      'OZON_SUBMITTED_TASK_MISSING',
      'Submitted Ozon publish attempt has no recorded task ID',
    );
  }

  try {
    const taskId = normalizeOzonPublishTaskId(attempt.ozonTaskId);
    const client = await input.resolveOwnedClient(attempt.ownerUserId, attempt.shopId);
    const response = await client.getImportInfo(taskIdForRead(taskId));
    const mapped = mapImportInfo(response, attempt);
    if (!mapped.allDone || mapped.pending > 0) {
      return retryOrManualReview(
        attempt,
        settings,
        now,
        'OZON_IMPORT_PENDING',
        `Ozon import task ${taskId} is pending (${mapped.pending} of ${mapped.total} items)`,
        mapped,
      );
    }
    if (mapped.failed > 0) {
      return {
        kind: mapped.failed >= attempt.itemCount ? 'FAILED' : 'PARTIAL_FAILURE',
        itemResults: mapped.itemResults,
        itemErrors: mapped.itemErrors,
        errorCode: 'OZON_IMPORT_ITEM_FAILED',
        errorMessage: `${mapped.failed} of ${mapped.total} Ozon import items failed`,
      };
    }
    return {
      kind: 'SUCCEEDED',
      itemResults: mapped.itemResults,
      itemErrors: mapped.itemErrors,
    };
  } catch (error) {
    return retryOrManualReview(
      attempt,
      settings,
      now,
      'OZON_IMPORT_INFO_UNAVAILABLE',
      `Ozon import status could not be reconciled: ${errorMessage(error)}`,
    );
  }
}

async function reconcileUnknown(
  claim: OzonPublishReconciliationLeaseClaim,
  input: RunOzonPublishReconciliationTickInput,
  settings: OzonPublishReconciliationSettings,
  now: () => Date,
): Promise<OzonReconciliationOutcome | LateAcknowledgementAction> {
  const { attempt } = claim;
  if (!input.probeUnknownAttempt) {
    return retryOrManualReview(
      attempt,
      settings,
      now,
      'OZON_UNKNOWN_ACK_UNPROVEN',
      'No trustworthy late-acknowledgement probe is configured for this unknown submission',
    );
  }

  try {
    const client = await input.resolveOwnedClient(attempt.ownerUserId, attempt.shopId);
    const result = await input.probeUnknownAttempt(attempt, client);
    if (result.confirmedAccepted === true
      && result.trustworthy === true
      && result.taskId != null) {
      const taskId = normalizeOzonPublishTaskId(result.taskId);
      const evidence = cloneOzonPublishObject(
        result.evidence,
        'late acknowledgement evidence',
        MAX_LATE_ACKNOWLEDGEMENT_BYTES,
      );
      if (!Object.keys(evidence).length) throw new Error('late acknowledgement evidence is empty');
      return { kind: 'ATTACH_LATE_ACKNOWLEDGEMENT', taskId, response: evidence };
    }
    const reason = 'reason' in result && result.reason
      ? boundedProviderText(result.reason, 'late acknowledgement ambiguity reason', 1_000)
      : 'The evidence probe did not explicitly confirm a trustworthy Ozon acknowledgement';
    return retryOrManualReview(
      attempt,
      settings,
      now,
      'OZON_UNKNOWN_ACK_UNPROVEN',
      reason,
    );
  } catch (error) {
    return retryOrManualReview(
      attempt,
      settings,
      now,
      'OZON_UNKNOWN_PROBE_FAILED',
      `Unknown submission evidence could not be verified: ${errorMessage(error)}`,
    );
  }
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof OzonPublishAttemptError && error.code === 'LEASE_LOST'
    || Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'LEASE_LOST');
}

function countOutcome(
  result: OzonPublishReconciliationTickResult,
  outcome: OzonReconciliationOutcome,
): void {
  result.completed += 1;
  if (outcome.kind === 'RETRY_WAIT') result.retried += 1;
  if (outcome.kind === 'MANUAL_REVIEW') result.manualReview += 1;
}

export async function runOzonPublishReconciliationTick(
  input: RunOzonPublishReconciliationTickInput,
): Promise<OzonPublishReconciliationTickResult> {
  const settings = normalizeOzonPublishReconciliationSettings(input.settings);
  const now = input.now || (() => new Date());
  const logger = input.logger || defaultLogger;
  const stale = await input.repository.markStaleSubmissionsUnknown({
    workerId: settings.workerId,
    limit: settings.staleSubmissionLimit,
  });
  const claims = await input.repository.claimReconciliation({
    workerId: settings.workerId,
    leaseMs: settings.leaseMs,
    limit: settings.claimLimit,
  });
  const result: OzonPublishReconciliationTickResult = {
    staleMarked: stale.length,
    claimed: claims.length,
    completed: 0,
    retried: 0,
    manualReview: 0,
    lateAcknowledged: 0,
    leaseLost: 0,
    failed: 0,
    skipped: 0,
  };

  await Promise.all(claims.map(async (claim) => {
    try {
      if (claim.attempt.state !== 'SUBMITTED' && claim.attempt.state !== 'UNKNOWN') {
        result.skipped += 1;
        logger.warn(
          `[ozon-publish-reconciliation] skipped unexpected claimed state for ${claim.attempt.id}`,
          { state: claim.attempt.state },
        );
        return;
      }
      const outcome = claim.attempt.state === 'SUBMITTED'
        ? await reconcileSubmitted(claim, input, settings, now)
        : await reconcileUnknown(claim, input, settings, now);
      if (outcome.kind === 'ATTACH_LATE_ACKNOWLEDGEMENT') {
        try {
          await input.repository.attachLateAcknowledgement({
            attemptId: claim.attempt.id,
            workerId: settings.workerId,
            leaseToken: claim.leaseToken,
            leaseEpoch: claim.leaseEpoch,
            taskId: outcome.taskId,
            response: outcome.response,
          });
          result.lateAcknowledged += 1;
        } catch (error) {
          if (isLeaseLost(error)) throw error;
          const fallback = retryOrManualReview(
            claim.attempt,
            settings,
            now,
            'OZON_LATE_ACK_PERSIST_FAILED',
            `Trustworthy Ozon acknowledgement could not be persisted: ${errorMessage(error)}`,
          );
          await input.repository.completeReconciliation({
            attemptId: claim.attempt.id,
            workerId: settings.workerId,
            leaseToken: claim.leaseToken,
            leaseEpoch: claim.leaseEpoch,
            outcome: fallback,
          });
          countOutcome(result, fallback);
        }
        return;
      }
      await input.repository.completeReconciliation({
        attemptId: claim.attempt.id,
        workerId: settings.workerId,
        leaseToken: claim.leaseToken,
        leaseEpoch: claim.leaseEpoch,
        outcome,
      });
      countOutcome(result, outcome);
    } catch (error) {
      if (isLeaseLost(error)) {
        result.leaseLost += 1;
        logger.warn(
          `[ozon-publish-reconciliation] lease lost for ${claim.attempt.id}`,
          error,
        );
      } else {
        result.failed += 1;
        logger.error(
          `[ozon-publish-reconciliation] claim ${claim.attempt.id} failed`,
          error,
        );
      }
    }
  }));

  if (result.staleMarked || result.claimed) {
    logger.info('[ozon-publish-reconciliation] tick completed', result);
  }
  return result;
}
