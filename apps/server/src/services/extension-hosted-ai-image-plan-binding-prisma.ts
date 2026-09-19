import { createHash, randomUUID } from 'node:crypto';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';
import {
  type ExtensionHostedAiImagePlanBindingRecord,
  type ExtensionHostedAiImagePlanBindingStore,
} from './extension-hosted-ai-image-plan.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_IDENTIFIER_LENGTH = 200;

export type ExtensionHostedAiImagePlanBindingPrismaTransaction =
  ExtensionCommandTransactionClient;
export type ExtensionHostedAiImagePlanBindingPrismaClient = ExtensionCommandDatabaseClient;

export type ExtensionHostedAiImagePlanBindingStoreErrorCode =
  | 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_INPUT'
  | 'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW';

export class ExtensionHostedAiImagePlanBindingStoreError extends Error {
  constructor(
    public readonly code: ExtensionHostedAiImagePlanBindingStoreErrorCode,
    message: string,
    public readonly statusCode: 400 | 500 = code.endsWith('INPUT') ? 400 : 500,
  ) {
    super(message);
    this.name = 'ExtensionHostedAiImagePlanBindingStoreError';
  }
}

const BINDING_COLUMNS = `
  "id",
  "plan_id" AS "planId",
  "owner_user_id" AS "ownerUserId",
  "device_session_id" AS "deviceSessionId",
  "shop_id" AS "shopId",
  "listing_workflow_id" AS "listingWorkflowId",
  "source_capture_snapshot_id" AS "snapshotId",
  "supply_goods_id" AS "supplyGoodsId",
  "draft_revision" AS "draftRevision",
  "draft_version" AS "draftVersion",
  "selected_sku_hash" AS "selectedSkuHash",
  "candidate_media_hash" AS "candidateMediaHash",
  "authority_hash" AS "authorityHash",
  "binding_hash" AS "bindingHash"`;

interface RawBindingRow {
  id: unknown;
  planId: unknown;
  ownerUserId: unknown;
  deviceSessionId: unknown;
  shopId: unknown;
  listingWorkflowId: unknown;
  snapshotId: unknown;
  supplyGoodsId: unknown;
  draftRevision: unknown;
  draftVersion: unknown;
  selectedSkuHash: unknown;
  candidateMediaHash: unknown;
  authorityHash: unknown;
  bindingHash: unknown;
}

function invalidInput(message: string): never {
  throw new ExtensionHostedAiImagePlanBindingStoreError(
    'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_INPUT',
    message,
  );
}

function invalidRow(message: string): never {
  throw new ExtensionHostedAiImagePlanBindingStoreError(
    'HOSTED_AI_IMAGE_PLAN_BINDING_INVALID_ROW',
    message,
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function exactIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || value !== value.trim()
    || value !== value.normalize('NFKC')
    // Keep opaque identity fields from becoming URL or credential transport.
    || hasControlCharacter(value)
    || value.includes('?')
    || value.includes('#')
    || /(?:https?|ftp|data):/iu.test(value)) {
    invalidInput(`${field} is invalid`);
  }
  return value;
}

function exactHash(value: unknown, field: string): string {
  const text = exactIdentifier(value, field);
  if (!HASH_PATTERN.test(text)) invalidInput(`${field} is invalid`);
  return text;
}

function exactPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalidInput(`${field} is invalid`);
  }
  return Number(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, canonical(object[key])]),
  );
}

function hash(value: unknown): string {
  // The plan service uses the same canonical JSON contract. Keeping this
  // local avoids coupling the SQL adapter to its private implementation.
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function bindingHashValue(record: Omit<ExtensionHostedAiImagePlanBindingRecord, 'bindingHash'>) {
  return {
    planId: record.planId,
    ownerUserId: record.ownerUserId,
    deviceSessionId: record.deviceSessionId,
    snapshotId: record.snapshotId,
    supplyGoodsId: record.supplyGoodsId,
    shopId: record.shopId,
    listingWorkflowId: record.listingWorkflowId,
    draftRevision: record.draftRevision,
    draftVersion: record.draftVersion,
    selectedSkuHash: record.selectedSkuHash,
    candidateMediaHash: record.candidateMediaHash,
    authorityHash: record.authorityHash,
  };
}

function authorityHashValue(record: Omit<
  ExtensionHostedAiImagePlanBindingRecord,
  'planId' | 'deviceSessionId' | 'authorityHash' | 'bindingHash'
>) {
  return {
    ownerUserId: record.ownerUserId,
    snapshotId: record.snapshotId,
    supplyGoodsId: record.supplyGoodsId,
    shopId: record.shopId,
    listingWorkflowId: record.listingWorkflowId,
    draftRevision: record.draftRevision,
    draftVersion: record.draftVersion,
    selectedSkuHash: record.selectedSkuHash,
    candidateMediaHash: record.candidateMediaHash,
  };
}

function expectedBindingHash(record: Omit<ExtensionHostedAiImagePlanBindingRecord, 'bindingHash'>) {
  return hash(bindingHashValue(record));
}

function normalizedRecord(
  value: ExtensionHostedAiImagePlanBindingRecord,
  source: 'input' | 'row',
): ExtensionHostedAiImagePlanBindingRecord {
  const invalid = source === 'input' ? invalidInput : invalidRow;
  const identifier = (candidate: unknown, field: string) => {
    try {
      return exactIdentifier(candidate, field);
    } catch {
      return invalid(`${field} is invalid`);
    }
  };
  const hashValue = (candidate: unknown, field: string) => {
    try {
      return exactHash(candidate, field);
    } catch {
      return invalid(`${field} is invalid`);
    }
  };
  const integer = (candidate: unknown, field: string) => {
    try {
      return exactPositiveInteger(candidate, field);
    } catch {
      return invalid(`${field} is invalid`);
    }
  };
  const record: ExtensionHostedAiImagePlanBindingRecord = {
    planId: identifier(value.planId, 'planId'),
    ownerUserId: identifier(value.ownerUserId, 'ownerUserId'),
    deviceSessionId: identifier(value.deviceSessionId, 'deviceSessionId'),
    snapshotId: identifier(value.snapshotId, 'snapshotId'),
    supplyGoodsId: identifier(value.supplyGoodsId, 'supplyGoodsId'),
    shopId: identifier(value.shopId, 'shopId'),
    listingWorkflowId: identifier(value.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: integer(value.draftRevision, 'draftRevision'),
    draftVersion: integer(value.draftVersion, 'draftVersion'),
    selectedSkuHash: hashValue(value.selectedSkuHash, 'selectedSkuHash'),
    candidateMediaHash: hashValue(value.candidateMediaHash, 'candidateMediaHash'),
    authorityHash: hashValue(value.authorityHash, 'authorityHash'),
    bindingHash: hashValue(value.bindingHash, 'bindingHash'),
  };
  if (record.authorityHash !== hash(authorityHashValue(record))) {
    invalid('authorityHash does not match the frozen draft authority');
  }
  if (record.bindingHash !== expectedBindingHash(record)) {
    invalid('bindingHash does not match the binding identity');
  }
  return record;
}

function mapRow(value: unknown): ExtensionHostedAiImagePlanBindingRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidRow('Hosted plan binding row is invalid');
  }
  const row = value as RawBindingRow;
  try {
    // The SQL surrogate ID is deliberately not part of the public port, but
    // it still must be a valid opaque database identity before the row is used.
    exactIdentifier(row.id, 'id');
  } catch {
    return invalidRow('Hosted plan binding row id is invalid');
  }
  return normalizedRecord(row as unknown as ExtensionHostedAiImagePlanBindingRecord, 'row');
}

function sameRecord(
  left: ExtensionHostedAiImagePlanBindingRecord,
  right: ExtensionHostedAiImagePlanBindingRecord,
): boolean {
  return left.planId === right.planId
    && left.ownerUserId === right.ownerUserId
    && left.deviceSessionId === right.deviceSessionId
    && left.snapshotId === right.snapshotId
    && left.supplyGoodsId === right.supplyGoodsId
    && left.shopId === right.shopId
    && left.listingWorkflowId === right.listingWorkflowId
    && left.draftRevision === right.draftRevision
    && left.draftVersion === right.draftVersion
    && left.selectedSkuHash === right.selectedSkuHash
    && left.candidateMediaHash === right.candidateMediaHash
    && left.authorityHash === right.authorityHash
    && left.bindingHash === right.bindingHash;
}

function sameLookup(
  record: ExtensionHostedAiImagePlanBindingRecord,
  input: Omit<
    ExtensionHostedAiImagePlanBindingRecord,
    'planId' | 'authorityHash' | 'bindingHash'
  >,
): boolean {
  return record.ownerUserId === input.ownerUserId
    && record.deviceSessionId === input.deviceSessionId
    && record.snapshotId === input.snapshotId
    && record.supplyGoodsId === input.supplyGoodsId
    && record.shopId === input.shopId
    && record.listingWorkflowId === input.listingWorkflowId
    && record.draftRevision === input.draftRevision
    && record.draftVersion === input.draftVersion
    && record.selectedSkuHash === input.selectedSkuHash
    && record.candidateMediaHash === input.candidateMediaHash;
}

function exactBindingInput(
  value: ExtensionHostedAiImagePlanBindingRecord,
): ExtensionHostedAiImagePlanBindingRecord {
  return normalizedRecord(value, 'input');
}

function exactLookupInput(
  value: Omit<
    ExtensionHostedAiImagePlanBindingRecord,
    'planId' | 'authorityHash' | 'bindingHash'
  >,
): Omit<
  ExtensionHostedAiImagePlanBindingRecord,
  'planId' | 'authorityHash' | 'bindingHash'
> {
  return {
    ownerUserId: exactIdentifier(value.ownerUserId, 'ownerUserId'),
    deviceSessionId: exactIdentifier(value.deviceSessionId, 'deviceSessionId'),
    snapshotId: exactIdentifier(value.snapshotId, 'snapshotId'),
    supplyGoodsId: exactIdentifier(value.supplyGoodsId, 'supplyGoodsId'),
    shopId: exactIdentifier(value.shopId, 'shopId'),
    listingWorkflowId: exactIdentifier(value.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: exactPositiveInteger(value.draftRevision, 'draftRevision'),
    draftVersion: exactPositiveInteger(value.draftVersion, 'draftVersion'),
    selectedSkuHash: exactHash(value.selectedSkuHash, 'selectedSkuHash'),
    candidateMediaHash: exactHash(value.candidateMediaHash, 'candidateMediaHash'),
  };
}

function rowOrNull(rows: unknown[], field: string): ExtensionHostedAiImagePlanBindingRecord | null {
  if (rows.length > 1) return invalidRow(`${field} returned multiple binding rows`);
  return rows.length === 0 ? null : mapRow(rows[0]);
}

async function getInTransaction(
  tx: ExtensionHostedAiImagePlanBindingPrismaTransaction,
  input: { ownerUserId: string; planId: string },
): Promise<ExtensionHostedAiImagePlanBindingRecord | null> {
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT ${BINDING_COLUMNS}
     FROM "extension_hosted_ai_image_plan_bindings"
     WHERE "owner_user_id" = $1
       AND "plan_id" = $2
     ORDER BY "updated_at" DESC, "id" DESC
     LIMIT 2
     FOR UPDATE`,
    input.ownerUserId,
    input.planId,
  );
  const record = rowOrNull(rows, 'owner and plan lookup');
  if (record
    && (record.ownerUserId !== input.ownerUserId || record.planId !== input.planId)) {
    return invalidRow('Owner and plan lookup returned another binding identity');
  }
  return record;
}

async function adoptApprovedSessionSuccessorLineageInTransaction(
  tx: ExtensionHostedAiImagePlanBindingPrismaTransaction,
  record: ExtensionHostedAiImagePlanBindingRecord,
): Promise<ExtensionHostedAiImagePlanBindingRecord | null> {
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    `WITH RECURSIVE replacement_lineage AS (
       SELECT successor."id" AS "successorId",
              predecessor."id" AS "predecessorId",
              ARRAY[successor."id", predecessor."id"]::TEXT[] AS "path"
       FROM "extension_device_sessions" successor
       JOIN "extension_device_sessions" predecessor
         ON successor."replaces_session_id" = predecessor."id"
       WHERE successor."id" = $3
         AND successor."owner_user_id" = $2
         AND successor."actor_user_id" = $2
         AND successor."status" = 'ACTIVE'
         AND predecessor."owner_user_id" = $2
         AND predecessor."actor_user_id" = $2
         AND predecessor."status" = 'REVOKED'
         AND predecessor."revoked_reason" = 'PAIRING_APPROVED'
         AND successor."device_id" = predecessor."device_id"
         AND successor."deployment_id" = predecessor."deployment_id"
         AND successor."scopes" @> predecessor."scopes"
         AND successor."scopes" <@ predecessor."scopes"
         AND cardinality(successor."scopes") = cardinality(predecessor."scopes")
       UNION ALL
       SELECT descendant."id" AS "successorId",
              ancestor."id" AS "predecessorId",
              lineage."path" || ancestor."id"
       FROM replacement_lineage lineage
       JOIN "extension_device_sessions" descendant
         ON descendant."id" = lineage."predecessorId"
       JOIN "extension_device_sessions" ancestor
         ON descendant."replaces_session_id" = ancestor."id"
       WHERE descendant."owner_user_id" = $2
         AND descendant."actor_user_id" = $2
         AND descendant."status" = 'REVOKED'
         AND descendant."revoked_reason" = 'PAIRING_APPROVED'
         AND ancestor."owner_user_id" = $2
         AND ancestor."actor_user_id" = $2
         AND ancestor."status" = 'REVOKED'
         AND ancestor."revoked_reason" = 'PAIRING_APPROVED'
         AND descendant."device_id" = ancestor."device_id"
         AND descendant."deployment_id" = ancestor."deployment_id"
         AND descendant."scopes" @> ancestor."scopes"
         AND descendant."scopes" <@ ancestor."scopes"
         AND cardinality(descendant."scopes") = cardinality(ancestor."scopes")
         AND cardinality(lineage."path") < 50
         AND NOT ancestor."id" = ANY(lineage."path")
     ), adopted AS (
       UPDATE "extension_hosted_ai_image_plan_bindings" binding
       SET "plan_id" = $1,
           "device_session_id" = $3,
           "binding_hash" = $4,
           "updated_at" = NOW()
       FROM replacement_lineage lineage
       WHERE binding."owner_user_id" = $2
         AND binding."authority_hash" = $5
         AND binding."device_session_id" = lineage."predecessorId"
         AND binding."shop_id" = $6
         AND binding."listing_workflow_id" = $7
         AND binding."source_capture_snapshot_id" = $8
         AND binding."supply_goods_id" = $9
         AND binding."draft_revision" = $10
         AND binding."draft_version" = $11
         AND binding."selected_sku_hash" = $12
         AND binding."candidate_media_hash" = $13
         AND NOT EXISTS (
           SELECT 1 FROM "ai_media_suites" suite
           WHERE suite."owner_user_id" = binding."owner_user_id"
             AND suite."plan_id" = binding."plan_id"
         )
         AND NOT EXISTS (
           SELECT 1 FROM "extension_hosted_ai_image_listing_assignments" assignment
           WHERE assignment."owner_user_id" = binding."owner_user_id"
             AND assignment."plan_id" = binding."plan_id"
         )
       RETURNING binding.*
     )
     SELECT ${BINDING_COLUMNS}
     FROM adopted`,
    record.planId,
    record.ownerUserId,
    record.deviceSessionId,
    record.bindingHash,
    record.authorityHash,
    record.shopId,
    record.listingWorkflowId,
    record.snapshotId,
    record.supplyGoodsId,
    record.draftRevision,
    record.draftVersion,
    record.selectedSkuHash,
    record.candidateMediaHash,
  );
  const adopted = rowOrNull(rows, 'approved session successor lineage adoption');
  if (adopted && !sameRecord(adopted, record)) {
    return invalidRow('Adopted binding identity does not match the request');
  }
  return adopted;
}

export function createPrismaExtensionHostedAiImagePlanBindingStore(
  client: ExtensionHostedAiImagePlanBindingPrismaClient,
  options: { createId?: () => string } = {},
): ExtensionHostedAiImagePlanBindingStore {
  const createId = options.createId || randomUUID;
  return {
    async bind(rawRecord) {
      const record = exactBindingInput(rawRecord);
      const id = exactIdentifier(createId(), 'id');
      return runExtensionCommandSerializableTransaction(client, async (tx) => {
        const inserted = await tx.$queryRawUnsafe<unknown[]>(
          `INSERT INTO "extension_hosted_ai_image_plan_bindings"
            ("id", "plan_id", "owner_user_id", "device_session_id", "shop_id",
             "listing_workflow_id", "source_capture_snapshot_id", "supply_goods_id",
             "draft_revision", "draft_version", "selected_sku_hash", "candidate_media_hash",
             "authority_hash", "binding_hash")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT DO NOTHING
           RETURNING ${BINDING_COLUMNS}`,
          id,
          record.planId,
          record.ownerUserId,
          record.deviceSessionId,
          record.shopId,
          record.listingWorkflowId,
          record.snapshotId,
          record.supplyGoodsId,
          record.draftRevision,
          record.draftVersion,
          record.selectedSkuHash,
          record.candidateMediaHash,
          record.authorityHash,
          record.bindingHash,
        );
        if (inserted.length > 1) return invalidRow('Binding insert returned multiple rows');
        if (inserted.length === 1) {
          const stored = mapRow(inserted[0]);
          if (!sameRecord(stored, record)) {
            return invalidRow('Inserted binding identity does not match the request');
          }
          return { kind: 'bound' as const, record: stored };
        }

        const existing = await getInTransaction(tx, {
          ownerUserId: record.ownerUserId,
          planId: record.planId,
        });
        if (existing && sameRecord(existing, record)) {
          return { kind: 'replayed' as const, record: existing };
        }
        const adopted = await adoptApprovedSessionSuccessorLineageInTransaction(tx, record);
        if (adopted) return { kind: 'bound' as const, record: adopted };
        return { kind: 'conflict' as const };
      });
    },

    async get(rawInput) {
      const ownerUserId = exactIdentifier(rawInput.ownerUserId, 'ownerUserId');
      const planId = exactIdentifier(rawInput.planId, 'planId');
      const rows = await client.$queryRawUnsafe<unknown[]>(
        `SELECT ${BINDING_COLUMNS}
         FROM "extension_hosted_ai_image_plan_bindings"
         WHERE "owner_user_id" = $1
           AND "plan_id" = $2
         ORDER BY "updated_at" DESC, "id" DESC
         LIMIT 2`,
        ownerUserId,
        planId,
      );
      const record = rowOrNull(rows, 'owner and plan lookup');
      if (record && (record.ownerUserId !== ownerUserId || record.planId !== planId)) {
        return invalidRow('Owner and plan lookup returned another binding identity');
      }
      return record;
    },

    async find(rawInput) {
      const input = exactLookupInput(rawInput);
      const rows = await client.$queryRawUnsafe<unknown[]>(
        `SELECT ${BINDING_COLUMNS}
         FROM "extension_hosted_ai_image_plan_bindings"
         WHERE "owner_user_id" = $1
           AND "device_session_id" = $2
           AND "shop_id" = $3
           AND "listing_workflow_id" = $4
           AND "source_capture_snapshot_id" = $5
           AND "supply_goods_id" = $6
           AND "draft_revision" = $7
           AND "draft_version" = $8
           AND "selected_sku_hash" = $9
           AND "candidate_media_hash" = $10
         ORDER BY "updated_at" DESC, "id" DESC
         LIMIT 1`,
        input.ownerUserId,
        input.deviceSessionId,
        input.shopId,
        input.listingWorkflowId,
        input.snapshotId,
        input.supplyGoodsId,
        input.draftRevision,
        input.draftVersion,
        input.selectedSkuHash,
        input.candidateMediaHash,
      );
      const record = rowOrNull(rows, 'exact context lookup');
      if (record && !sameLookup(record, input)) {
        return invalidRow('Exact context lookup returned another binding identity');
      }
      return record;
    },
  };
}
