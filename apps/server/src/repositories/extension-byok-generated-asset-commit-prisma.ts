import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  createPrismaByokGeneratedAssetRepository,
} from './byok-generated-asset-repository.js';
import {
  PrismaExtensionByokMediaProvenanceRepository,
} from './extension-byok-media-provenance-repository.js';
import {
  byokGeneratedAssetMatchesCreateInput,
  byokGeneratedAssetMatchesSemanticIdentity,
  type ByokGeneratedAssetCreateInput,
  type ByokGeneratedAssetRecord,
} from '../services/byok-generated-asset-ingest.js';
import {
  consumeByokMediaIngestGrantInTransaction,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  createExtensionByokMediaProvenanceService,
  EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
} from '../services/extension-byok-media-provenance.js';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from '../services/extension-command-grants-prisma.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';
import {
  bindByokGeneratedAssetToListingDraft,
  ByokListingMediaBindingError,
} from '../services/byok-listing-media-binding.js';
import { commitExtensionByokUploadStagingInTransaction } from '../services/extension-byok-upload-staging.js';
import { isExtensionAiImageExecutionModeConflict } from '../services/extension-ai-image-execution-mode.js';

export const EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION =
  'extension-byok-media-ingest-receipt/v1' as const;

export type ExtensionByokGeneratedAssetCommitErrorCode =
  | 'BYOK_INGEST_GRANT_NOT_FOUND'
  | 'BYOK_INGEST_GRANT_MISMATCH'
  | 'BYOK_INGEST_GRANT_EXPIRED'
  | 'BYOK_INGEST_GRANT_REVOKED'
  | 'BYOK_INGEST_SESSION_INVALID'
  | 'BYOK_INGEST_SCOPE_DENIED'
  | 'BYOK_INGEST_SHOP_DENIED'
  | 'BYOK_INGEST_RECEIPT_PENDING'
  | 'BYOK_INGEST_RECEIPT_FAILED'
  | 'BYOK_INGEST_RECEIPT_CONFLICT'
  | 'BYOK_INGEST_DRAFT_STALE'
  | 'BYOK_INGEST_SLOT_CONFLICT'
  | 'BYOK_INGEST_ORDER_CONFLICT'
  | 'BYOK_INGEST_MODE_CONFLICT'
  | 'BYOK_INGEST_ASSET_CONFLICT'
  | 'BYOK_INGEST_STAGING_CONFLICT';

export class ExtensionByokGeneratedAssetCommitError extends Error {
  constructor(
    public readonly code: ExtensionByokGeneratedAssetCommitErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokGeneratedAssetCommitError';
  }
}

export interface ExtensionByokMediaIngestReceiptResult {
  contractVersion: typeof EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION;
  requestHash: string;
  assetId: string;
  provenanceId: string;
  normalizedSha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  workflowId: string;
  draftRevision: number;
  draftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assignmentSha256: string;
  policyRevision: number;
}

export interface CommitExtensionByokGeneratedAssetInput {
  binding: ExtensionCommandBinding;
  tokenDigest: string;
  receiptId: string;
  actorUserId: string;
  now: Date;
  command: ExtensionByokMediaIngestResolvedCommand;
  asset: ByokGeneratedAssetCreateInput;
  stagingId: string | null;
  stagingStorageNamespaceId?: string | null;
}

export interface CommitExtensionByokGeneratedAssetResult {
  replayed: boolean;
  receiptId: string;
  receipt: ExtensionByokMediaIngestReceiptResult;
  asset: ByokGeneratedAssetRecord;
}

type TransactionWithMedia = ExtensionCommandTransactionClient & {
  mediaAsset: PrismaClient['mediaAsset'];
  extensionByokMediaProvenance: any;
};

function commitError(
  code: ExtensionByokGeneratedAssetCommitErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ExtensionByokGeneratedAssetCommitError(code, statusCode, message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapGrantFailure(kind: string): never {
  const errors: Record<string, [ExtensionByokGeneratedAssetCommitErrorCode, number, string]> = {
    not_found: ['BYOK_INGEST_GRANT_NOT_FOUND', 404, 'BYOK ingest grant was not found'],
    mismatch: ['BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK ingest grant does not match this request'],
    expired: ['BYOK_INGEST_GRANT_EXPIRED', 410, 'BYOK ingest grant expired'],
    revoked: ['BYOK_INGEST_GRANT_REVOKED', 410, 'BYOK ingest grant was revoked'],
    session_invalid: ['BYOK_INGEST_SESSION_INVALID', 401, 'Extension device session is invalid'],
    scope_denied: ['BYOK_INGEST_SCOPE_DENIED', 403, 'Extension device ingest scope is denied'],
    shop_denied: ['BYOK_INGEST_SHOP_DENIED', 403, 'Extension device shop access is denied'],
  };
  const [code, status, message] = errors[kind]
    || ['BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK ingest grant is invalid'];
  return commitError(code, status, message);
}

function parseReceiptResult(
  value: unknown,
  input: CommitExtensionByokGeneratedAssetInput,
): ExtensionByokMediaIngestReceiptResult {
  const result = record(value);
  if (!result
    || result.contractVersion !== EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION
    || result.requestHash !== input.binding.requestHash
    || result.assetId !== input.asset.id
    || typeof result.provenanceId !== 'string'
    || !result.provenanceId
    || result.normalizedSha256 !== input.asset.sha256
    || result.mimeType !== input.asset.mimeType
    || result.width !== input.asset.width
    || result.height !== input.asset.height
    || input.binding.draftVersion == null
    || result.workflowId !== input.binding.workflowId
    || result.draftRevision !== input.command.draftRevision
    || result.draftVersion !== input.binding.draftVersion
    || result.boundDraftRevision !== input.command.draftRevision + 1
    || result.boundDraftVersion !== input.binding.draftVersion + 1
    || result.skuKey !== input.command.skuKey
    || result.slotKey !== input.command.slotKey
    || result.assignmentOrdinal !== input.command.assignmentOrdinal
    || typeof result.assignmentSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(result.assignmentSha256)
    || result.policyRevision !== input.command.readiness.policyRevision) {
    commitError('BYOK_INGEST_RECEIPT_CONFLICT', 409, 'BYOK ingest receipt identity conflicts');
  }
  return result as unknown as ExtensionByokMediaIngestReceiptResult;
}

function mapBindingFailure(error: ByokListingMediaBindingError): never {
  if (error.code === 'BYOK_LISTING_BINDING_ASSET_INVALID') {
    return commitError('BYOK_INGEST_ASSET_CONFLICT', error.statusCode, error.message);
  }
  if (error.code === 'BYOK_LISTING_BINDING_SLOT_CONFLICT') {
    return commitError('BYOK_INGEST_SLOT_CONFLICT', error.statusCode, error.message);
  }
  if (error.code === 'BYOK_LISTING_BINDING_ORDER_CONFLICT') {
    return commitError('BYOK_INGEST_ORDER_CONFLICT', error.statusCode, error.message);
  }
  return commitError('BYOK_INGEST_DRAFT_STALE', error.statusCode, error.message);
}

async function completeReceipt(
  tx: ExtensionCommandTransactionClient,
  receiptId: string,
  result: ExtensionByokMediaIngestReceiptResult,
  now: Date,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_command_receipts"
     SET "status" = 'SUCCEEDED',
         "result" = $2::jsonb,
         "failure_code" = NULL,
         "completed_at" = $3
     WHERE "id" = $1 AND "status" = 'PENDING'
     RETURNING "id"`,
    receiptId,
    JSON.stringify(result),
    now,
  );
  if (rows.length !== 1) {
    commitError('BYOK_INGEST_RECEIPT_CONFLICT', 409, 'BYOK ingest receipt could not be completed');
  }
}

export function createPrismaExtensionByokGeneratedAssetCommitter(
  client: ExtensionCommandDatabaseClient,
) {
  return async (
    input: CommitExtensionByokGeneratedAssetInput,
  ): Promise<CommitExtensionByokGeneratedAssetResult> => {
    try {
      return await runExtensionCommandSerializableTransaction(client, async (rawTx) => {
      const consumed = await consumeByokMediaIngestGrantInTransaction(rawTx, {
        tokenDigest: input.tokenDigest,
        binding: input.binding,
        receiptId: input.receiptId,
        now: input.now,
      });
      if (consumed.kind === 'replay') {
        if (consumed.receipt.status === 'PENDING') {
          commitError('BYOK_INGEST_RECEIPT_PENDING', 409, 'BYOK ingest is already in progress');
        }
        if (consumed.receipt.status !== 'SUCCEEDED') {
          commitError('BYOK_INGEST_RECEIPT_FAILED', 409, 'The prior BYOK ingest failed');
        }
        const tx = rawTx as TransactionWithMedia;
        const assetRepository = createPrismaByokGeneratedAssetRepository(tx as never);
        const asset = await assetRepository.findById({
          assetId: input.asset.id,
          ownerUserId: input.asset.ownerUserId,
        });
        if (!asset || !byokGeneratedAssetMatchesSemanticIdentity(asset, input.asset)) {
          commitError('BYOK_INGEST_ASSET_CONFLICT', 409, 'The replayed BYOK asset identity conflicts');
        }
        return {
          replayed: true,
          receiptId: consumed.receipt.id,
          receipt: parseReceiptResult(consumed.receipt.result, input),
          asset,
        };
      }
      if (consumed.kind !== 'execute') return mapGrantFailure(consumed.kind);

      const tx = rawTx as TransactionWithMedia;
      const assetRepository = createPrismaByokGeneratedAssetRepository(tx as never);
      const storedAsset = await assetRepository.createOrReplay(input.asset);
      if (storedAsset.kind === 'conflict'
        || !byokGeneratedAssetMatchesCreateInput(storedAsset.asset, input.asset)) {
        commitError('BYOK_INGEST_ASSET_CONFLICT', 409, 'The BYOK generated asset identity conflicts');
      }
      if (input.stagingId && (!input.stagingStorageNamespaceId
        || !/^[a-f0-9]{64}$/u.test(input.stagingStorageNamespaceId))) {
        commitError('BYOK_INGEST_STAGING_CONFLICT', 409, 'The BYOK upload storage namespace is invalid');
      }
      if (input.stagingId && !await commitExtensionByokUploadStagingInTransaction(rawTx, {
        stagingId: input.stagingId,
        ownerUserId: input.binding.ownerUserId,
        deviceSessionId: input.binding.sessionId,
        assetId: storedAsset.asset.id,
        requestHash: input.binding.requestHash,
        storageBackend: storedAsset.asset.storageBackend,
        storageNamespaceId: input.stagingStorageNamespaceId!,
        storageKey: storedAsset.asset.storageKey,
        now: input.now,
      })) {
        commitError('BYOK_INGEST_STAGING_CONFLICT', 409, 'The BYOK upload staging identity conflicts');
      }

      let draftBinding;
      try {
        draftBinding = await bindByokGeneratedAssetToListingDraft(rawTx, {
          binding: input.binding,
          command: input.command,
          actorUserId: input.actorUserId,
          asset: storedAsset.asset,
          now: input.now,
        });
      } catch (error) {
        if (error instanceof ByokListingMediaBindingError) return mapBindingFailure(error);
        throw error;
      }

      const provenanceService = createExtensionByokMediaProvenanceService(
        new PrismaExtensionByokMediaProvenanceRepository(tx as never),
      );
      const provenance = await provenanceService.record({
        contractVersion: EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
        executionMode: 'BYOK',
        ownerUserId: input.binding.ownerUserId,
        actorUserId: input.actorUserId,
        deviceSessionId: input.binding.sessionId,
        shopId: input.binding.shopId,
        workflowId: input.binding.workflowId,
        draftRevision: input.command.draftRevision,
        draftVersion: input.binding.draftVersion,
        boundDraftRevision: draftBinding.boundDraftRevision,
        boundDraftVersion: draftBinding.boundDraftVersion,
        skuKey: input.command.skuKey,
        slotKey: input.command.slotKey,
        assignmentOrdinal: draftBinding.assignmentOrdinal,
        assignmentSha256: draftBinding.assignmentSha256,
        policyRevision: input.command.readiness.policyRevision,
        endpointOriginSha256: sha256(input.command.providerOrigin),
        model: input.command.model,
        operation: input.command.providerOperation,
        providerRequestIdSha256: input.command.providerRequestIdSha256,
        promptSha256: input.command.promptSha256,
        negativePromptSha256: input.command.negativePromptSha256,
        sourceSha256: input.command.sourceSha256,
        referenceSha256s: input.command.referenceSha256s,
        maskSha256: input.command.maskSha256,
        resultSha256: input.asset.sha256,
        assetId: input.asset.id,
        resultMimeType: input.asset.mimeType,
        resultWidth: input.asset.width,
        resultHeight: input.asset.height,
        idempotencyKey: input.binding.idempotencyKey,
        requestHash: input.binding.requestHash,
        publishIntentId: null,
        publishReceiptId: null,
        erpAiChargeCents: 0,
      });
      const receipt: ExtensionByokMediaIngestReceiptResult = {
        contractVersion: EXTENSION_BYOK_MEDIA_INGEST_RECEIPT_VERSION,
        requestHash: input.binding.requestHash,
        assetId: storedAsset.asset.id,
        provenanceId: provenance.provenance.id,
        normalizedSha256: storedAsset.asset.sha256,
        mimeType: storedAsset.asset.mimeType,
        width: storedAsset.asset.width,
        height: storedAsset.asset.height,
        workflowId: input.binding.workflowId!,
        draftRevision: input.command.draftRevision,
        draftVersion: input.binding.draftVersion!,
        boundDraftRevision: draftBinding.boundDraftRevision,
        boundDraftVersion: draftBinding.boundDraftVersion,
        skuKey: input.command.skuKey,
        slotKey: input.command.slotKey,
        assignmentOrdinal: draftBinding.assignmentOrdinal,
        assignmentSha256: draftBinding.assignmentSha256,
        policyRevision: input.command.readiness.policyRevision,
      };
      await completeReceipt(rawTx, consumed.receipt.id, receipt, input.now);
      return {
        replayed: false,
        receiptId: consumed.receipt.id,
        receipt,
        asset: storedAsset.asset,
      };
      });
    } catch (error) {
      if (isExtensionAiImageExecutionModeConflict(error)) {
        commitError(
          'BYOK_INGEST_MODE_CONFLICT',
          409,
          'This listing draft already started ERP-hosted image execution',
        );
      }
      throw error;
    }
  };
}
