import { createHash, randomUUID } from 'node:crypto';
import {
  SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
} from 'shared';
import type {
  OzonListingDraft,
  OzonListingDraftAuditEvent,
  OzonListingPublishIntent,
} from 'shared';
import {
  OzonListingDraftRepositoryError,
  type OzonListingDraftRepository,
} from './ozon-listing-draft.js';

interface SqlClient {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
  $transaction<T>(
    action: (tx: SqlClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

type CasInput = Parameters<OzonListingDraftRepository['compareAndSwap']>[0];
type PublishIntentInput = Parameters<OzonListingDraftRepository['recordPublishIntent']>[0];

interface PersistedDraftRow {
  id: string;
  ownerUserId: string;
  shopId: string;
  supplyGoodsId: string | null;
  sourceSubjectId: string;
  currentSourceCaptureSnapshotId: string;
  selectedSkuHash: string;
  currentRevision: number;
  currentDraftVersion: number;
  payload: unknown;
}

const CURRENT_DRAFT_COLUMNS = `
  w."id", w."owner_user_id" AS "ownerUserId", w."shop_id" AS "shopId",
  w."supply_goods_id" AS "supplyGoodsId", w."source_subject_id" AS "sourceSubjectId",
  w."current_source_capture_snapshot_id" AS "currentSourceCaptureSnapshotId",
  w."selected_sku_hash" AS "selectedSkuHash",
  w."current_revision" AS "currentRevision",
  w."current_draft_version" AS "currentDraftVersion", d."payload"`;

function repositoryError(
  code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'ALREADY_EXISTS' | 'IDEMPOTENCY_CONFLICT',
  message: string,
): OzonListingDraftRepositoryError {
  return new OzonListingDraftRepositoryError(code, message);
}

function required(value: unknown, field: string, maxLength = 200, minLength = 1): string {
  if (typeof value !== 'string') throw repositoryError('VERSION_CONFLICT', `${field} is required`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw repositoryError('VERSION_CONFLICT', `${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw repositoryError('VERSION_CONFLICT', `${field} is invalid`);
  }
  return Number(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

export function normalizeSourceListingSkuKeys(value: unknown): {
  keys: string[];
  hash: string;
} {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS) {
    throw repositoryError('VERSION_CONFLICT', 'selectedSkuKeys is invalid');
  }
  const keys = [...new Set(value.map((item) => required(
    item,
    'selected SKU key',
    SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
  )))].sort();
  return {
    keys,
    hash: digest({ schema: 'source-listing-selected-skus/v1', keys }),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw repositoryError('VERSION_CONFLICT', `${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function draftFromPayload(value: unknown): OzonListingDraft {
  return structuredClone(record(value, 'persisted listing draft')) as unknown as OzonListingDraft;
}

function draftRow(row: any): PersistedDraftRow {
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    shopId: String(row.shopId),
    supplyGoodsId: row.supplyGoodsId == null ? null : String(row.supplyGoodsId),
    sourceSubjectId: String(row.sourceSubjectId),
    currentSourceCaptureSnapshotId: String(row.currentSourceCaptureSnapshotId),
    selectedSkuHash: String(row.selectedSkuHash),
    currentRevision: Number(row.currentRevision),
    currentDraftVersion: Number(row.currentDraftVersion),
    payload: row.payload,
  };
}

function preparedDraft(value: OzonListingDraft): {
  draft: OzonListingDraft;
  selectedSkuHash: string;
  payloadHash: string;
} {
  const draft = structuredClone(value);
  draft.id = required(draft.id, 'draft.id');
  draft.ownerUserId = required(draft.ownerUserId, 'draft.ownerUserId');
  draft.shopId = required(draft.shopId, 'draft.shopId');
  draft.supplyGoodsId = required(draft.supplyGoodsId, 'draft.supplyGoodsId');
  draft.sourceCaptureSnapshotId = required(
    draft.sourceCaptureSnapshotId,
    'draft.sourceCaptureSnapshotId',
  );
  draft.sourceCaptureHash = required(draft.sourceCaptureHash, 'draft.sourceCaptureHash', 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(draft.sourceCaptureHash)) {
    throw repositoryError('VERSION_CONFLICT', 'draft.sourceCaptureHash is invalid');
  }
  draft.revision = positiveInteger(draft.revision, 'draft.revision');
  draft.draftVersion = positiveInteger(draft.draftVersion, 'draft.draftVersion');
  const selected = normalizeSourceListingSkuKeys(draft.selectedSkuKeys);
  draft.selectedSkuKeys = selected.keys;
  if (!Array.isArray(draft.auditEvents)) {
    throw repositoryError('VERSION_CONFLICT', 'draft.auditEvents is invalid');
  }
  return { draft, selectedSkuHash: selected.hash, payloadHash: digest(draft) };
}

function workflowStatus(draft: OzonListingDraft): string {
  return draft.stage === 'PUBLISHED' ? 'COMPLETED' : draft.runState;
}

function draftStatus(draft: OzonListingDraft): string {
  if (draft.stage === 'PUBLISHED') return 'PUBLISHED';
  if (draft.stage === 'READY_TO_PUBLISH' || draft.stage === 'PUBLISH_INTENT_RECORDED') return 'READY';
  return draft.runState;
}

function date(value: unknown, fallback: Date): Date {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = [candidate.code, candidate.meta?.code].map((value) => String(value || ''));
  return codes.some((code) => ['40001', '40P01', 'P2034'].includes(code))
    || String(candidate.message || '').includes('could not serialize');
}

function uniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: unknown; message?: unknown };
  const meta = candidate.meta as { code?: unknown; target?: unknown; message?: unknown } | undefined;
  const codes = [candidate.code, meta?.code].map((value) => String(value || ''));
  if (!codes.some((code) => code === '23505' || code === 'P2002' || code === 'P2010')) return false;
  if (!constraint) return codes.some((code) => code === '23505' || code === 'P2002')
    || String(meta?.code || '') === '23505';
  const details = [candidate.message, meta?.message, meta?.target]
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    .join(' ');
  return details.includes(constraint);
}

async function serializable<T>(client: SqlClient, action: (tx: SqlClient) => Promise<T>): Promise<T> {
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

async function loadCurrentRow(
  client: SqlClient,
  draftId: string,
  ownerUserId: string,
  forUpdate = false,
): Promise<PersistedDraftRow | null> {
  const rows = await client.$queryRawUnsafe<any[]>(
    `SELECT ${CURRENT_DRAFT_COLUMNS}
     FROM "source_listing_workflows" w
     JOIN "source_listing_draft_versions" d
       ON d."workflow_id" = w."id" AND d."revision" = w."current_revision"
     WHERE w."id" = $1 AND w."owner_user_id" = $2
     ${forUpdate ? 'FOR UPDATE OF w' : ''}`,
    draftId,
    ownerUserId,
  );
  return rows[0] ? draftRow(rows[0]) : null;
}

async function loadByIdentity(
  client: SqlClient,
  input: {
    ownerUserId: string;
    shopId: string;
    supplyGoodsId: string;
    sourceCaptureSnapshotId: string;
    selectedSkuHash: string;
  },
): Promise<OzonListingDraft | null> {
  const rows = await client.$queryRawUnsafe<any[]>(
    `SELECT d."payload"
     FROM "source_listing_workflows" w
     JOIN "source_listing_draft_versions" d
       ON d."workflow_id" = w."id" AND d."revision" = w."current_revision"
     WHERE w."owner_user_id" = $1 AND w."shop_id" = $2
       AND w."supply_goods_id" = $3
       AND w."current_source_capture_snapshot_id" = $4
       AND w."selected_sku_hash" = $5
        AND w."status" IN ('ACTIVE', 'PAUSED', 'RETRYABLE_FAILURE', 'MANUAL_REVIEW')
     ORDER BY w."updated_at" DESC, w."id" DESC
     LIMIT 1`,
    input.ownerUserId,
    input.shopId,
    input.supplyGoodsId,
    input.sourceCaptureSnapshotId,
    input.selectedSkuHash,
  );
  return rows[0] ? draftFromPayload(rows[0].payload) : null;
}

function auditDelta(current: OzonListingDraft, next: OzonListingDraft): OzonListingDraftAuditEvent[] {
  const currentById = new Map(current.auditEvents.map((event) => [event.id, event]));
  for (const event of next.auditEvents) {
    const previous = currentById.get(event.id);
    if (previous && canonicalJson(previous) !== canonicalJson(event)) {
      throw repositoryError('VERSION_CONFLICT', 'Listing draft audit history is immutable');
    }
  }
  if (current.auditEvents.some((event) => !next.auditEvents.some(({ id }) => id === event.id))) {
    throw repositoryError('VERSION_CONFLICT', 'Listing draft audit history cannot be removed');
  }
  return next.auditEvents.filter((event) => !currentById.has(event.id));
}

async function insertEvents(
  tx: SqlClient,
  workflowId: string,
  ownerUserId: string,
  revision: number,
  draftVersion: number,
  events: OzonListingDraftAuditEvent[],
  fallbackDate: Date,
): Promise<void> {
  for (const event of events) {
    const eventKey = required(event.id, 'audit event id');
    const actorUserId = required(event.actorUserId, 'audit actorUserId');
    if (positiveInteger(event.draftVersion, 'audit draftVersion') !== draftVersion) {
      throw repositoryError('VERSION_CONFLICT', 'Audit event draft version does not match revision');
    }
    const payload = {
      occurredAt: date(event.occurredAt, fallbackDate).toISOString(),
      details: record(event.details, 'audit details'),
    };
    await tx.$queryRawUnsafe(
      `INSERT INTO "source_listing_workflow_events"
        ("id", "workflow_id", "owner_user_id", "draft_version", "revision", "actor_user_id",
         "event_key", "event_type", "payload", "payload_hash", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)`,
      randomUUID(), workflowId, ownerUserId, draftVersion, revision, actorUserId,
      eventKey, required(event.type, 'audit event type', 100), json(payload), digest(payload),
      date(event.occurredAt, fallbackDate),
    );
  }
}

function invalidationReasons(current: OzonListingDraft, next: OzonListingDraft): string[] {
  const reasons = new Set<string>();
  if (current.shopId !== next.shopId) reasons.add('SHOP_CHANGED');
  if (current.sourceCaptureSnapshotId !== next.sourceCaptureSnapshotId) {
    reasons.add('SOURCE_SNAPSHOT_CHANGED');
  }
  if (normalizeSourceListingSkuKeys(current.selectedSkuKeys).hash
    !== normalizeSourceListingSkuKeys(next.selectedSkuKeys).hash) {
    reasons.add('SKU_SELECTION_CHANGED');
  }
  if (canonicalJson(current.category) !== canonicalJson(next.category)) reasons.add('CATEGORY_CHANGED');
  if (next.grantRevocation.required && next.grantRevocation.reason) {
    reasons.add(next.grantRevocation.reason);
  }
  return [...reasons].sort();
}

function validateTransition(
  current: OzonListingDraft,
  input: CasInput,
  next: OzonListingDraft,
): string[] {
  if (next.id !== current.id || next.id !== input.draftId
    || next.ownerUserId !== current.ownerUserId || next.ownerUserId !== input.ownerUserId
    || next.supplyGoodsId !== current.supplyGoodsId
    || next.revision !== current.revision + 1
    || ![current.draftVersion, current.draftVersion + 1].includes(next.draftVersion)) {
    throw repositoryError('VERSION_CONFLICT', 'Invalid listing draft transition');
  }
  const reasons = invalidationReasons(current, next);
  const identityChanged = reasons.some((reason) => [
    'SHOP_CHANGED', 'SOURCE_SNAPSHOT_CHANGED', 'SKU_SELECTION_CHANGED', 'CATEGORY_CHANGED',
  ].includes(reason));
  if (identityChanged && next.draftVersion !== current.draftVersion + 1) {
    throw repositoryError('VERSION_CONFLICT', 'Listing identity invalidation requires a new draft version');
  }
  return reasons;
}

async function applyCas(
  tx: SqlClient,
  input: CasInput,
  now: Date,
  currentRow?: PersistedDraftRow,
): Promise<OzonListingDraft> {
  const row = currentRow || await loadCurrentRow(tx, input.draftId, input.ownerUserId, true);
  if (!row) throw repositoryError('NOT_FOUND', 'Listing draft was not found');
  if (row.currentRevision !== input.expectedRevision) {
    throw repositoryError('VERSION_CONFLICT', 'Listing draft revision changed');
  }
  const current = draftFromPayload(row.payload);
  const prepared = preparedDraft(input.next);
  const next = prepared.draft;
  const reasons = validateTransition(current, input, next);
  const events = auditDelta(current, next);
  if (events.some((event) => event.actorUserId !== input.actorUserId)) {
    throw repositoryError('VERSION_CONFLICT', 'Audit event actor does not match mutation actor');
  }

  await tx.$queryRawUnsafe(
    `INSERT INTO "source_listing_draft_versions"
      ("id", "workflow_id", "owner_user_id", "revision", "draft_version", "shop_id",
       "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
       "selected_sku_keys", "selected_sku_hash", "stage", "status", "payload", "payload_hash",
       "parent_revision", "invalidation_reasons", "actor_user_id", "created_at")
     SELECT $1, w."id", w."owner_user_id", $2, $3, $4, $5,
            w."legacy_supply_goods_id", w."supply_goods_id", $6::jsonb, $7, $8,
            $9::"SourceListingDraftStatus", $10::jsonb, $11, $12, $13::jsonb, $14, $15
     FROM "source_listing_workflows" w
     WHERE w."id" = $16 AND w."owner_user_id" = $17 AND w."current_revision" = $12`,
    randomUUID(), next.revision, next.draftVersion, next.shopId, next.sourceCaptureSnapshotId,
    json(next.selectedSkuKeys), prepared.selectedSkuHash, next.stage, draftStatus(next), json(next),
    prepared.payloadHash, current.revision, json(reasons), input.actorUserId, now,
    input.draftId, input.ownerUserId,
  );
  const changed = await tx.$queryRawUnsafe<any[]>(
    `UPDATE "source_listing_workflows"
     SET "shop_id" = $1, "current_source_capture_snapshot_id" = $2,
         "selected_sku_keys" = $3::jsonb, "selected_sku_hash" = $4,
         "current_revision" = $5, "current_draft_version" = $6,
         "stage" = $7, "status" = $8::"SourceListingWorkflowStatus", "updated_at" = $9
     WHERE "id" = $10 AND "owner_user_id" = $11 AND "current_revision" = $12
     RETURNING "id"`,
    next.shopId, next.sourceCaptureSnapshotId, json(next.selectedSkuKeys), prepared.selectedSkuHash,
    next.revision, next.draftVersion, next.stage, workflowStatus(next), now,
    input.draftId, input.ownerUserId, input.expectedRevision,
  );
  if (!changed[0]) throw repositoryError('VERSION_CONFLICT', 'Listing draft revision changed');

  const transitionSignal = next.draftVersion > current.draftVersion || next.grantRevocation.required;
  if (transitionSignal) {
    await tx.$queryRawUnsafe(
      `UPDATE "extension_command_grants"
       SET "revoked_at" = $1,
           "revoked_reason" = 'WORKFLOW_VERSION_CHANGED'::"ExtensionDeviceRevocationReason"
       WHERE "owner_user_id" = $2 AND "workflow_id" = $3
         AND "draft_version" <= $4
         AND "consumed_at" IS NULL AND "revoked_at" IS NULL
       RETURNING "id"`,
      now, input.ownerUserId, input.draftId, current.draftVersion,
    );
  }
  await insertEvents(
    tx, input.draftId, input.ownerUserId, next.revision, next.draftVersion, events, now,
  );
  return next;
}

function publishIntent(row: any): OzonListingPublishIntent {
  return {
    id: String(row.id),
    draftId: String(row.workflowId),
    ownerUserId: String(row.ownerUserId),
    shopId: String(row.shopId),
    draftVersion: Number(row.draftVersion),
    revision: Number(row.revision),
    idempotencyKey: String(row.idempotencyKey),
    payloadHash: String(row.payloadHash),
    actorUserId: String(row.actorUserId),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export function createPrismaSourceListingWorkflowRepository(options: {
  client: SqlClient;
  now?: () => Date;
  createId?: () => string;
}): OzonListingDraftRepository {
  const now = options.now || (() => new Date());
  const createId = options.createId || randomUUID;

  return {
    async create(value) {
      const prepared = preparedDraft(value);
      const draft = prepared.draft;
      if (draft.revision !== 1 || draft.draftVersion !== 1) {
        throw repositoryError('VERSION_CONFLICT', 'New listing draft must start at revision and version 1');
      }
      if (!draft.auditEvents.length || draft.auditEvents[0]?.type !== 'DRAFT_CREATED') {
        throw repositoryError('VERSION_CONFLICT', 'New listing draft requires a creation audit event');
      }
      const createdAt = date(draft.createdAt, now());
      return serializable(options.client, async (tx) => {
        const lockIdentity = digest({
          ownerUserId: draft.ownerUserId,
          shopId: draft.shopId,
          supplyGoodsId: draft.supplyGoodsId,
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
          selectedSkuHash: prepared.selectedSkuHash,
        });
        await tx.$queryRawUnsafe(
          'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          lockIdentity,
        );
        const existing = await loadByIdentity(tx, {
          ownerUserId: draft.ownerUserId,
          shopId: draft.shopId,
          supplyGoodsId: draft.supplyGoodsId,
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
          selectedSkuHash: prepared.selectedSkuHash,
        });
        if (existing) return existing;

        const inserted = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO "source_listing_workflows"
            ("id", "owner_user_id", "shop_id", "source_subject_id",
             "current_source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
             "selected_sku_keys", "selected_sku_hash", "current_revision", "current_draft_version",
             "stage", "status", "created_at", "updated_at")
           SELECT $1, $2, $3, snapshot."subject_id", $4, subject."legacy_supply_goods_id", $5,
                  $6::jsonb, $7, 1, 1, $8, $9::"SourceListingWorkflowStatus", $10, $10
           FROM "source_capture_snapshots" snapshot
           JOIN "source_capture_subjects" subject ON subject."id" = snapshot."subject_id"
           JOIN "supply_goods" goods ON goods."id" = $5 AND goods."user_id" = $2
           JOIN "shops" shop ON shop."id" = $3 AND shop."user_id" = $2 AND shop."platform" = 'OZON'
           WHERE snapshot."id" = $4 AND snapshot."capture_hash" = $11
             AND subject."owner_user_id" = $2
           RETURNING "id"`,
          draft.id, draft.ownerUserId, draft.shopId, draft.sourceCaptureSnapshotId,
          draft.supplyGoodsId, json(draft.selectedSkuKeys), prepared.selectedSkuHash,
          draft.stage, workflowStatus(draft), createdAt, draft.sourceCaptureHash,
        );
        if (!inserted[0]) {
          throw repositoryError('NOT_FOUND', 'Owned shop, source snapshot, or supply goods was not found');
        }
        await tx.$queryRawUnsafe(
          `INSERT INTO "source_listing_draft_versions"
            ("id", "workflow_id", "owner_user_id", "revision", "draft_version", "shop_id",
             "source_capture_snapshot_id", "legacy_supply_goods_id", "supply_goods_id",
             "selected_sku_keys", "selected_sku_hash", "stage", "status", "payload", "payload_hash",
             "parent_revision", "invalidation_reasons", "actor_user_id", "created_at")
           SELECT $1, w."id", w."owner_user_id", 1, 1, w."shop_id",
                  w."current_source_capture_snapshot_id", w."legacy_supply_goods_id", w."supply_goods_id",
                  w."selected_sku_keys", w."selected_sku_hash", w."stage",
                  $2::"SourceListingDraftStatus", $3::jsonb, $4, NULL, '[]'::jsonb, $5, $6
           FROM "source_listing_workflows" w WHERE w."id" = $7`,
          createId(), draftStatus(draft), json(draft), prepared.payloadHash,
          draft.auditEvents[0]!.actorUserId, createdAt, draft.id,
        );
        await insertEvents(
          tx, draft.id, draft.ownerUserId, 1, 1, draft.auditEvents, createdAt,
        );
        return draft;
      });
    },

    async findCurrentByIdentity(input) {
      const selected = normalizeSourceListingSkuKeys(input.selectedSkuKeys);
      return loadByIdentity(options.client, {
        ownerUserId: required(input.ownerUserId, 'ownerUserId'),
        shopId: required(input.shopId, 'shopId'),
        supplyGoodsId: required(input.supplyGoodsId, 'supplyGoodsId'),
        sourceCaptureSnapshotId: required(input.sourceCaptureSnapshotId, 'sourceCaptureSnapshotId'),
        selectedSkuHash: selected.hash,
      });
    },

    async getCurrent(draftId, ownerUserId) {
      const row = await loadCurrentRow(
        options.client,
        required(draftId, 'draftId'),
        required(ownerUserId, 'ownerUserId'),
      );
      return row ? draftFromPayload(row.payload) : null;
    },

    async getVersion(input) {
      const rows = await options.client.$queryRawUnsafe<any[]>(
        `SELECT d."payload"
         FROM "source_listing_draft_versions" d
         JOIN "source_listing_workflows" w ON w."id" = d."workflow_id"
         WHERE d."workflow_id" = $1 AND w."owner_user_id" = $2 AND d."draft_version" = $3
         ORDER BY d."revision" DESC
         LIMIT 1`,
        required(input.draftId, 'draftId'),
        required(input.ownerUserId, 'ownerUserId'),
        positiveInteger(input.draftVersion, 'draftVersion'),
      );
      return rows[0] ? draftFromPayload(rows[0].payload) : null;
    },

    async compareAndSwap(input) {
      try {
        return await serializable(options.client, (tx) => applyCas(tx, input, now()));
      } catch (error) {
        if (uniqueViolation(error)) {
          throw repositoryError(
            'VERSION_CONFLICT',
            'Another recoverable listing workflow already uses the requested identity',
          );
        }
        throw error;
      }
    },

    async getPublishIntent(input) {
      const rows = await options.client.$queryRawUnsafe<any[]>(
        `SELECT "id", "workflow_id" AS "workflowId", "owner_user_id" AS "ownerUserId",
                "shop_id" AS "shopId", "draft_version" AS "draftVersion", "revision",
                "idempotency_key" AS "idempotencyKey", "payload_hash" AS "payloadHash",
                "actor_user_id" AS "actorUserId", "created_at" AS "createdAt"
         FROM "source_listing_publish_intents"
         WHERE "owner_user_id" = $1 AND "idempotency_key" = $2
         LIMIT 1`,
        required(input.ownerUserId, 'ownerUserId'),
        required(
          input.idempotencyKey,
          'idempotencyKey',
          SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
          SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
        ),
      );
      return rows[0] ? publishIntent(rows[0]) : null;
    },

    async recordPublishIntent(input: PublishIntentInput) {
      const ownerUserId = required(input.ownerUserId, 'ownerUserId');
      const idempotencyKey = required(
        input.idempotencyKey,
        'idempotencyKey',
        SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
        SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
      );
      const payloadHash = required(input.payloadHash, 'payloadHash', 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(payloadHash)) {
        throw repositoryError('IDEMPOTENCY_CONFLICT', 'Publish intent payload hash is invalid');
      }
      return serializable(options.client, async (tx) => {
        const lockKey = digest({
          schema: 'source-listing-publish-intent-lock/v1',
          ownerUserId,
          idempotencyKey,
        });
        await tx.$queryRawUnsafe(
          'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          lockKey,
        );
        const existingRows = await tx.$queryRawUnsafe<any[]>(
          `SELECT "id", "workflow_id" AS "workflowId", "owner_user_id" AS "ownerUserId",
                  "shop_id" AS "shopId", "draft_version" AS "draftVersion", "revision",
                  "idempotency_key" AS "idempotencyKey", "payload_hash" AS "payloadHash",
                  "actor_user_id" AS "actorUserId", "created_at" AS "createdAt"
           FROM "source_listing_publish_intents"
           WHERE "owner_user_id" = $1 AND "idempotency_key" = $2
           FOR UPDATE`,
          ownerUserId,
          idempotencyKey,
        );
        if (existingRows[0]) {
          const existing = publishIntent(existingRows[0]);
          if (existing.draftId !== input.draftId || existing.payloadHash !== payloadHash) {
            throw repositoryError('IDEMPOTENCY_CONFLICT', 'Publish intent key was reused');
          }
          const current = await loadCurrentRow(tx, input.draftId, ownerUserId);
          if (!current) throw repositoryError('NOT_FOUND', 'Listing draft was not found');
          return { draft: draftFromPayload(current.payload), intent: existing, idempotent: true };
        }

        const current = await loadCurrentRow(tx, input.draftId, ownerUserId, true);
        const next = await applyCas(tx, input, now(), current || undefined);
        const intent = input.intent;
        if (intent.id !== required(intent.id, 'intent.id')
          || intent.draftId !== input.draftId
          || intent.ownerUserId !== ownerUserId
          || intent.shopId !== next.shopId
          || intent.draftVersion !== next.draftVersion
          || intent.revision !== next.revision
          || intent.idempotencyKey !== idempotencyKey
          || intent.payloadHash !== payloadHash
          || intent.actorUserId !== input.actorUserId) {
          throw repositoryError('IDEMPOTENCY_CONFLICT', 'Publish intent does not match draft transition');
        }
        const createdAt = date(intent.createdAt, now());
        const inserted = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO "source_listing_publish_intents"
            ("id", "workflow_id", "owner_user_id", "shop_id", "draft_version", "revision",
             "idempotency_key", "payload_hash", "actor_user_id", "created_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING "id", "workflow_id" AS "workflowId", "owner_user_id" AS "ownerUserId",
                     "shop_id" AS "shopId", "draft_version" AS "draftVersion", "revision",
                     "idempotency_key" AS "idempotencyKey", "payload_hash" AS "payloadHash",
                     "actor_user_id" AS "actorUserId", "created_at" AS "createdAt"`,
          intent.id, input.draftId, ownerUserId, next.shopId, next.draftVersion, next.revision,
          idempotencyKey, payloadHash, input.actorUserId, createdAt,
        );
        return { draft: next, intent: publishIntent(inserted[0]), idempotent: false };
      });
    },
  };
}
