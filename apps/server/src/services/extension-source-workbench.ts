import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isPublicHttpsStorageUrl } from './ai-image-translation-storage.js';
import { canUseAiImageJobOperation } from './ai-image-provider-admission.js';
import type { SourceListingWorkflowContextResolver } from './source-listing-workflow-context.js';
import type { SourceListingWorkflowService } from './source-listing-workflow.js';
import { verifySourceProductCaptureV2Submission, type SourceProductCaptureV2 } from 'shared';
import { createSourceCaptureMediaDisplayService, type SourceCaptureMediaDisplayClient, type SourceCaptureMediaDisplayUrl } from './source-capture-media-display.js';

export const EXTENSION_SOURCE_WORKBENCH_CONTRACT_VERSION =
  'extension-source-workbench-status/v1' as const;
export const EXTENSION_SOURCE_WORKBENCH_LISTING_LIMIT = 10;
export const EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT = 50;
export const EXTENSION_SOURCE_MEDIA_HISTORY_CONTRACT_VERSION =
  'extension-source-media-history/v1' as const;
export const EXTENSION_SOURCE_MEDIA_HISTORY_LIMIT = 20;
export const EXTENSION_SOURCE_MEDIA_HISTORY_OUTPUT_LIMIT = 4;
export const EXTENSION_SOURCE_MEDIA_HISTORY_URL_LIMIT = 4_096;

type SourceImageTransferStatus = 'PENDING' | 'RUNNING' | 'RETRY' | 'COMPLETE' | 'FAILED' | 'UNKNOWN';

interface ExtensionSourceWorkbenchClient {
  mediaAsset?: SourceCaptureMediaDisplayClient['mediaAsset'];
  supplyGoods?: {
    findFirst(args: any): Promise<{ metadata?: unknown } | null>;
  };
  sourceCaptureSnapshot: {
    findFirst(args: any): Promise<any>;
  };
  sourceListingWorkflow: {
    findMany(args: any): Promise<any[]>;
  };
  aiMediaWorkflow: {
    findMany(args: any): Promise<any[]>;
  };
}

export class ExtensionSourceWorkbenchError extends Error {
  constructor(
    public readonly code: 'SOURCE_WORKBENCH_NOT_FOUND' | 'SOURCE_WORKBENCH_INVALID' | 'SOURCE_WORKBENCH_STALE',
    public readonly statusCode: 404 | 400 | 409 | 422,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionSourceWorkbenchError';
  }
}

export interface ExtensionSourceMediaHistoryInput {
  ownerUserId: string;
  allowedShopIds: string[];
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  revision: number;
  draftVersion: number;
  limit?: number;
  beforeCursor?: string | null;
}

interface ExtensionSourceMediaHistoryCursor {
  updatedAt: Date;
  id: string;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ExtensionSourceWorkbenchError(
      'SOURCE_WORKBENCH_INVALID',
      400,
      `${field} is invalid`,
    );
  }
  return Number(value);
}

function mediaHistoryScopeHash(input: Pick<ExtensionSourceMediaHistoryInput, 'ownerUserId' | 'snapshotId' | 'supplyGoodsId' | 'shopId' | 'listingWorkflowId' | 'revision' | 'draftVersion'>) {
  return createHash('sha256').update(JSON.stringify({
    ownerUserId: input.ownerUserId,
    snapshotId: input.snapshotId,
    supplyGoodsId: input.supplyGoodsId,
    shopId: input.shopId,
    listingWorkflowId: input.listingWorkflowId,
    revision: input.revision,
    draftVersion: input.draftVersion,
  })).digest('hex');
}

export function encodeExtensionSourceMediaHistoryCursor(
  input: Pick<ExtensionSourceMediaHistoryInput, 'ownerUserId' | 'snapshotId' | 'supplyGoodsId' | 'shopId' | 'listingWorkflowId' | 'revision' | 'draftVersion'>,
  cursor: ExtensionSourceMediaHistoryCursor,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    u: cursor.updatedAt.toISOString(),
    i: cursor.id,
    s: mediaHistoryScopeHash(input),
  }), 'utf8').toString('base64url');
}

export function decodeExtensionSourceMediaHistoryCursor(
  input: Pick<ExtensionSourceMediaHistoryInput, 'ownerUserId' | 'snapshotId' | 'supplyGoodsId' | 'shopId' | 'listingWorkflowId' | 'revision' | 'draftVersion'>,
  value: string,
): ExtensionSourceMediaHistoryCursor {
  try {
    if (!value || value.length > 1_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (!bytes.length || bytes.toString('base64url') !== value) throw new Error();
    const serialized = bytes.toString('utf8');
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    if (!payload || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'i,s,u,v'
      || payload.v !== 1
      || typeof payload.u !== 'string'
      || typeof payload.i !== 'string'
      || !payload.i
      || payload.i.length > 200
      || payload.s !== mediaHistoryScopeHash(input)) throw new Error();
    const updatedAt = new Date(payload.u);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== payload.u) throw new Error();
    if (serialized !== JSON.stringify({ v: 1, u: payload.u, i: payload.i, s: payload.s })) throw new Error();
    return { updatedAt, id: payload.i };
  } catch {
    throw new ExtensionSourceWorkbenchError(
      'SOURCE_WORKBENCH_INVALID',
      400,
      'Media history cursor is invalid',
    );
  }
}

function identifier(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!normalized || normalized.length > 200) {
    throw new ExtensionSourceWorkbenchError(
      'SOURCE_WORKBENCH_INVALID',
      400,
      `${field} is invalid`,
    );
  }
  return normalized;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function allowedPreviewOrigin(value: unknown): string | null {
  const normalized = boundedText(value, EXTENSION_SOURCE_MEDIA_HISTORY_URL_LIMIT);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.search || url.hash || url.username || url.password || url.hostname.endsWith('.')) {
      return null;
    }
    if (isPublicHttpsStorageUrl(url.origin)) return url.origin;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (process.env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)) return url.origin;
  } catch {
    return null;
  }
  return null;
}

function previewUrl(value: unknown, allowedOrigins: Set<string>): string | null {
  const normalized = boundedText(value, EXTENSION_SOURCE_MEDIA_HISTORY_URL_LIMIT);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.search || url.hash || url.username || url.password
      || url.hostname.endsWith('.') || !allowedOrigins.has(url.origin)) return null;
    if (isPublicHttpsStorageUrl(url.href)) return url.href;
    // Local HTTP is permitted only for the explicitly local development hosts.
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (process.env.NODE_ENV !== 'production'
      && url.protocol === 'http:'
      && !url.username
      && !url.password
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return url.href;
    }
  } catch {
    // Relative/data/javascript URLs are intentionally not exposed to the extension.
  }
  return null;
}

function safeOutputAsset(
  asset: any,
  ownerUserId: string,
  jobId: string,
  snapshotId: string,
  allowedOrigins: Set<string>,
) {
  if (!asset
    || String(asset.ownerUserId || '') !== ownerUserId
    || String(asset.aiImageJobId || '') !== jobId
    || String(asset.sourceCaptureSnapshotId || '') !== snapshotId
    || String(asset.kind || '') !== 'AI_GENERATED'
    || !['local', 'oss'].includes(String(asset.storageBackend || ''))) return null;
  const url = previewUrl(asset.url, allowedOrigins);
  const id = boundedText(asset.id, 200);
  const mimeType = boundedText(asset.mimeType, 100);
  if (!id || !url || !mimeType
    || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.toLowerCase())) return null;
  const width = Number(asset.width);
  const height = Number(asset.height);
  return {
    id,
    url,
    mimeType,
    width: Number.isSafeInteger(width) && width > 0 ? width : null,
    height: Number.isSafeInteger(height) && height > 0 ? height : null,
  };
}

function mediaHistoryApplication(row: any) {
  const application = Array.isArray(row?.listingDraftApplicationMutations)
    ? row.listingDraftApplicationMutations[0]
    : null;
  if (!application?.id) return null;
  const rollback = application.rolledBackBy || null;
  const id = boundedText(application.id, 200);
  const targetId = boundedText(application.targetId, 200);
  if (!id || !targetId) return null;
  return {
    id,
    mode: String(application.mode || '').toUpperCase() === 'REPLACE' ? 'replace' : 'append',
    state: rollback ? 'ROLLED_BACK' : 'APPLIED',
    targetId,
    contextSkuKey: application.contextSkuKey == null ? null : String(application.contextSkuKey),
    contextSlotKey: application.contextSlotKey == null ? null : String(application.contextSlotKey),
    appliedAt: isoDate(application.createdAt),
    rolledBackAt: rollback?.createdAt ? isoDate(rollback.createdAt) : null,
  };
}

function mediaHistoryItem(
  row: any,
  ownerUserId: string,
  snapshotId: string,
  allowedOrigins: Set<string>,
) {
  const job = Array.isArray(row.jobs) ? row.jobs[0] : null;
  const jobId = String(job?.id || '');
  const outputs = jobId
    ? array(job?.assets)
      .map((asset) => safeOutputAsset(asset, ownerUserId, jobId, snapshotId, allowedOrigins))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .slice(0, EXTENSION_SOURCE_MEDIA_HISTORY_OUTPUT_LIMIT)
    : [];
  const selected = jobId && row.selectedOutputAsset
    ? safeOutputAsset(
      row.selectedOutputAsset,
      ownerUserId,
      jobId,
      snapshotId,
      allowedOrigins,
    )
    : null;
  if (selected && !outputs.some((output) => output.id === selected.id)) {
    if (outputs.length >= EXTENSION_SOURCE_MEDIA_HISTORY_OUTPUT_LIMIT) outputs.pop();
    outputs.push(selected);
  }
  const selectedOutputAssetId = selected
    && selected.id === String(row.selectedOutputAssetId || '')
    ? selected.id
    : null;
  return {
    id: String(row.id),
    operation: String(row.operation),
    status: String(row.status),
    reviewStatus: String(row.reviewStatus),
    revision: Number(row.revision),
    contextSkuKey: row.contextSkuKey == null ? null : String(row.contextSkuKey),
    contextSlotKey: row.contextSlotKey == null ? null : String(row.contextSlotKey),
    selectedOutputAssetId,
    outputs,
    application: mediaHistoryApplication(row),
    createdAt: isoDate(row.createdAt),
    updatedAt: isoDate(row.updatedAt),
  };
}

function isoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) {
    throw new ExtensionSourceWorkbenchError(
      'SOURCE_WORKBENCH_INVALID',
      400,
      'Persisted workbench timestamp is invalid',
    );
  }
  return date.toISOString();
}

function issues(value: unknown) {
  return array(value).slice(0, 20).flatMap((raw) => {
    const item = record(raw);
    const code = boundedText(item.code, 100);
    const message = boundedText(item.message, 1_000);
    if (!code || !message) return [];
    return [{
      code,
      message,
      fieldPath: boundedText(item.fieldPath, 1_000),
    }];
  });
}

function listingSummary(row: any) {
  const payload = record(row.currentDraft?.payload);
  const media = record(payload.media);
  const validation = record(payload.validation);
  const blockers = issues(payload.blockers);
  const warnings = issues(payload.warnings);
  return {
    id: String(row.id),
    shopId: String(row.shopId),
    stage: String(row.stage),
    status: String(row.status),
    runState: boundedText(payload.runState, 80) || 'UNKNOWN',
    revision: Number(row.currentRevision),
    draftVersion: Number(row.currentDraftVersion),
    selectedSkuCount: array(row.selectedSkuKeys).length,
    mediaAssignmentCount: array(media.assignments).length,
    validationStatus: boundedText(validation.status, 80) || 'UNKNOWN',
    blockerCount: array(payload.blockers).length,
    warningCount: array(payload.warnings).length,
    blockers,
    warnings,
    updatedAt: isoDate(row.updatedAt),
  };
}

function createdListingSummary(draft: any) {
  return {
    id: String(draft.id),
    shopId: String(draft.shopId),
    stage: String(draft.stage),
    status: String(draft.status || 'ACTIVE'),
    runState: String(draft.runState || 'UNKNOWN'),
    revision: Number(draft.revision),
    draftVersion: Number(draft.draftVersion),
    selectedSkuCount: array(draft.selectedSkuKeys).length,
    mediaAssignmentCount: array(draft.media?.assignments).length,
    validationStatus: boundedText(draft.validation?.status, 80) || 'UNKNOWN',
    blockerCount: array(draft.blockers).length,
    warningCount: array(draft.warnings).length,
    blockers: issues(draft.blockers),
    warnings: issues(draft.warnings),
    updatedAt: isoDate(draft.updatedAt),
  };
}

interface ExtensionMediaCommandContext {
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}

function mediaCommandContract(
  row: any,
  listingById: Map<string, ReturnType<typeof listingSummary>>,
  canExecuteMedia: boolean,
  production: boolean,
): {
  commandContext: ExtensionMediaCommandContext | null;
  allowedActions: Array<'CANCEL' | 'RETRY'>;
} {
  const listing = row.contextType === 'listing-draft'
    ? listingById.get(String(row.contextId || ''))
    : null;
  const currentJob = Array.isArray(row.jobs) ? row.jobs[0] : null;
  const providerAllowed = canUseAiImageJobOperation({
    provider: String(currentJob?.provider || ''),
    model: String(currentJob?.model || ''),
    operation: String(row.operation || ''),
    operationConfig: currentJob?.operationConfig,
  }, production);
  if (!canExecuteMedia
    || !listing
    || row.contextDraftRevision !== listing.revision
    || row.contextDraftVersion !== listing.draftVersion
    || !providerAllowed) {
    return { commandContext: null, allowedActions: [] };
  }
  const allowedActions: Array<'CANCEL' | 'RETRY'> = [];
  if (['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(String(row.status))) {
    allowedActions.push('CANCEL');
  }
  const reconciliationStatus = String(
    currentJob?.providerReconciliationStatus || 'NOT_REQUIRED',
  );
  const costStatus = currentJob?.costReservation?.status == null
    ? null
    : String(currentJob.costReservation.status);
  const retrySafe = !currentJob?.providerJobId
    && currentJob?.errorCode !== 'PROVIDER_SUBMISSION_UNCERTAIN'
    && ['NOT_REQUIRED', 'NO_OUTPUT', 'NOT_SUBMITTED'].includes(reconciliationStatus)
    && (costStatus == null || ['SETTLED', 'RELEASED'].includes(costStatus));
  if (row.status === 'FAILED' && retrySafe) allowedActions.push('RETRY');
  if (!allowedActions.length) return { commandContext: null, allowedActions };
  return {
    commandContext: {
      shopId: listing.shopId,
      listingWorkflowId: listing.id,
      draftRevision: listing.revision,
      draftVersion: listing.draftVersion,
    },
    allowedActions,
  };
}

function mediaSummary(
  row: any,
  listingById: Map<string, ReturnType<typeof listingSummary>>,
  canExecuteMedia: boolean,
  production: boolean,
) {
  return {
    id: String(row.id),
    operation: String(row.operation),
    status: String(row.status),
    reviewStatus: String(row.reviewStatus),
    revision: Number(row.revision),
    contextType: row.contextType == null ? null : String(row.contextType),
    contextId: row.contextId == null ? null : String(row.contextId),
    contextSkuKey: row.contextSkuKey == null ? null : String(row.contextSkuKey),
    contextSlotKey: row.contextSlotKey == null ? null : String(row.contextSlotKey),
    hasSelectedOutput: Boolean(row.selectedOutputAssetId),
    actionable: mediaActionable(row),
    ...mediaCommandContract(row, listingById, canExecuteMedia, production),
    updatedAt: isoDate(row.updatedAt),
  };
}

const ACTIVE_MEDIA_STATUSES = new Set([
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'FAILED',
]);

function mediaActionable(row: any) {
  if (ACTIVE_MEDIA_STATUSES.has(String(row.status))) return true;
  if (row.status !== 'SUCCEEDED') return false;
  if (row.reviewStatus === 'PENDING') return true;
  return row.reviewStatus === 'APPROVED' && Boolean(row.selectedOutputAssetId)
    && row.selectedOutputAsset?.aiImageJob?.appliedAt == null;
}

const SOURCE_IMAGE_TRANSFER_STATES = new Set(['PENDING', 'RUNNING', 'RETRY', 'COMPLETE', 'FAILED']);

function sourceImageTransferStatus(value: unknown, input: {
  snapshotId: string;
  captureHash: string;
}): 'PENDING' | 'RUNNING' | 'RETRY' | 'COMPLETE' | 'FAILED' | 'UNKNOWN' {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const capture = metadata?.sourceCaptureV2;
  const transfer = metadata?.sourceImageTransferV2;
  if (!capture || typeof capture !== 'object' || Array.isArray(capture)
    || !transfer || typeof transfer !== 'object' || Array.isArray(transfer)) return 'UNKNOWN';
  const captureRow = capture as Record<string, unknown>;
  const transferRow = transfer as Record<string, unknown>;
  if (captureRow.snapshotId !== input.snapshotId || captureRow.captureHash !== input.captureHash
    || transferRow.version !== 'source-capture-image-transfer/v1'
    || transferRow.snapshotId !== input.snapshotId || transferRow.captureHash !== input.captureHash
    || !SOURCE_IMAGE_TRANSFER_STATES.has(String(transferRow.status))) return 'UNKNOWN';
  return transferRow.status as 'PENDING' | 'RUNNING' | 'RETRY' | 'COMPLETE' | 'FAILED';
}

export function createExtensionSourceWorkbenchService(options: {
  client?: ExtensionSourceWorkbenchClient;
  ownership?: Pick<SourceListingWorkflowContextResolver, 'assertOwnedTarget'>;
  workflow?: Pick<SourceListingWorkflowService, 'createDraft'>;
  loadAllowedPreviewOrigins?(): Promise<string[]>;
  production?: boolean;
} = {}) {
  const client = options.client || prisma as unknown as ExtensionSourceWorkbenchClient;

  return {
    async createDraft(input: {
      ownerUserId: string;
      actorUserId: string;
      shopId: string;
      snapshotId: string;
      supplyGoodsId: string;
      selectedSkuKeys: string[];
    }) {
      if (!options.ownership || !options.workflow) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_INVALID', 400, 'Draft creation owner is unavailable',
        );
      }
      try {
        const owned = await options.ownership.assertOwnedTarget({
          ownerUserId: identifier(input.ownerUserId, 'ownerUserId'),
          shopId: identifier(input.shopId, 'shopId'),
          supplyGoodsId: identifier(input.supplyGoodsId, 'supplyGoodsId'),
          sourceCaptureSnapshotId: identifier(input.snapshotId, 'snapshotId'),
          selectedSkuKeys: input.selectedSkuKeys,
        });
        const draft = await options.workflow.createDraft({
          ownerUserId: input.ownerUserId,
          actorUserId: identifier(input.actorUserId, 'actorUserId'),
          shopId: owned.shopId,
          supplyGoodsId: owned.supplyGoodsId,
          sourceCaptureSnapshotId: owned.sourceCaptureSnapshotId,
          sourceCaptureHash: owned.sourceCaptureHash,
          selectedSkuKeys: owned.selectedSkuKeys,
        });
        return createdListingSummary(draft);
      } catch (error: any) {
        if (error instanceof ExtensionSourceWorkbenchError) throw error;
        const statusCode = Number(error?.statusCode);
        throw new ExtensionSourceWorkbenchError(
          statusCode === 404 ? 'SOURCE_WORKBENCH_NOT_FOUND'
            : statusCode === 409 ? 'SOURCE_WORKBENCH_STALE' : 'SOURCE_WORKBENCH_INVALID',
          statusCode === 404 ? 404 : statusCode === 409 ? 409 : statusCode === 422 ? 422 : 400,
          String(error?.message || 'Draft creation failed'),
        );
      }
    },

    async loadStatus(input: {
      ownerUserId: string;
      allowedShopIds: string[];
      canExecuteMedia?: boolean;
      snapshotId: string;
      supplyGoodsId: string;
    }) {
      const ownerUserId = identifier(input.ownerUserId, 'ownerUserId');
      const snapshotId = identifier(input.snapshotId, 'snapshotId');
      const supplyGoodsId = identifier(input.supplyGoodsId, 'supplyGoodsId');
      const allowedShopIds = [...new Set((input.allowedShopIds || []).map((value) => (
        identifier(value, 'allowedShopId')
      )))].slice(0, 50);

      const snapshot = await client.sourceCaptureSnapshot.findFirst({
        where: {
          id: snapshotId,
          subject: { ownerUserId, legacySupplyGoodsId: supplyGoodsId },
        },
        select: {
          id: true,
          version: true,
          capturedAt: true,
          captureHash: true,
          payloadBytes: true,
          payload: true,
          subject: {
            select: {
              snapshots: {
                orderBy: [{ version: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      });
      if (!snapshot) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_NOT_FOUND',
          404,
          'Owned source workbench was not found',
        );
      }
      const transferRow = client.supplyGoods?.findFirst
        ? await client.supplyGoods.findFirst({
          where: { id: supplyGoodsId, userId: ownerUserId },
          select: { metadata: true },
        })
        : null;
      const transferStatus = sourceImageTransferStatus(transferRow?.metadata, {
        snapshotId, captureHash: String(snapshot.captureHash),
      });
      let sourceMedia: {
        snapshotId: string;
        captureHash: string;
        transferStatus: SourceImageTransferStatus;
        items: SourceCaptureMediaDisplayUrl[];
      } | undefined;
      if (client.mediaAsset && (await verifySourceProductCaptureV2Submission({ capture: snapshot.payload,
        captureHash: snapshot.captureHash, payloadBytes: snapshot.payloadBytes })).valid) {
        sourceMedia = { snapshotId, captureHash: String(snapshot.captureHash), transferStatus,
          items: await createSourceCaptureMediaDisplayService({ client: { mediaAsset: client.mediaAsset } })
            .loadDisplayUrls({ ownerUserId, snapshotId, media: (snapshot.payload as SourceProductCaptureV2).media }) };
      }

      const listingRows = allowedShopIds.length
        ? await client.sourceListingWorkflow.findMany({
          where: {
            ownerUserId,
            supplyGoodsId,
            currentSourceCaptureSnapshotId: snapshotId,
            shopId: { in: allowedShopIds },
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: EXTENSION_SOURCE_WORKBENCH_LISTING_LIMIT + 1,
          select: {
            id: true,
            shopId: true,
            stage: true,
            status: true,
            currentRevision: true,
            currentDraftVersion: true,
            selectedSkuKeys: true,
            updatedAt: true,
            currentDraft: { select: { payload: true } },
          },
        })
        : [];
      const listingItems = listingRows
        .slice(0, EXTENSION_SOURCE_WORKBENCH_LISTING_LIMIT)
        .map(listingSummary);
      const listingById = new Map(listingItems.map((item) => [item.id, item]));
      const mediaContexts = [
        {
          contextType: 'collect',
          contextId: supplyGoodsId,
          inputs: {
            some: { asset: { is: { sourceCaptureSnapshotId: snapshotId } } },
          },
        },
        ...listingItems.map((item) => ({
          contextType: 'listing-draft',
          contextId: item.id,
          contextDraftRevision: item.revision,
          contextDraftVersion: item.draftVersion,
        })),
      ];
      const mediaWhere = {
        ownerUserId,
        OR: [
          { suiteSlot: { is: null }, OR: mediaContexts },
          // Hosted suite child workflows use the immutable collect context;
          // expose them to the same source draft history after recovery so the
          // extension can review the original task result. Ownership, shop,
          // snapshot and draft binding remain enforced by the suite projection.
          {
            suiteSlot: { is: { suite: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILURE'] } } } },
            contextType: 'collect',
            contextId: supplyGoodsId,
          },
        ],
      } satisfies Prisma.AiMediaWorkflowWhereInput;
      const mediaRows = await client.aiMediaWorkflow.findMany({
        where: mediaWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT + 1,
        select: {
          id: true,
          operation: true,
          status: true,
          reviewStatus: true,
          revision: true,
          contextType: true,
          contextId: true,
          contextDraftRevision: true,
          contextDraftVersion: true,
          contextSkuKey: true,
          contextSlotKey: true,
          selectedOutputAssetId: true,
          selectedOutputAsset: {
            select: { aiImageJob: { select: { appliedAt: true } } },
          },
          jobs: {
            orderBy: [{ workflowAttempt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              provider: true,
              model: true,
              operationConfig: true,
              providerJobId: true,
              providerReconciliationStatus: true,
              errorCode: true,
              costReservation: { select: { status: true } },
            },
          },
          updatedAt: true,
        },
      });
      const mediaItems = mediaRows
        .slice(0, EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT)
        .map((row) => mediaSummary(
          row,
          listingById,
          input.canExecuteMedia === true,
          options.production ?? process.env.NODE_ENV === 'production',
        ));

      return {
        contractVersion: EXTENSION_SOURCE_WORKBENCH_CONTRACT_VERSION,
        snapshot: {
          id: String(snapshot.id),
          version: Number(snapshot.version),
          capturedAt: isoDate(snapshot.capturedAt),
          current: snapshot.subject?.snapshots?.[0]?.id === snapshot.id,
          ...(sourceMedia ? { captureHash: sourceMedia.captureHash } : {}),
        },
        ...(sourceMedia ? { sourceMedia } : {}),
        listing: {
          items: listingItems,
          truncated: listingRows.length > EXTENSION_SOURCE_WORKBENCH_LISTING_LIMIT,
        },
        media: {
          items: mediaItems,
          truncated: mediaRows.length > EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT,
          actionableCount: mediaRows
            .slice(0, EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT)
            .filter(mediaActionable).length,
        },
      };
    },
    async loadMediaHistory(input: ExtensionSourceMediaHistoryInput) {
      const ownerUserId = identifier(input.ownerUserId, 'ownerUserId');
      const allowedOrigins = new Set((await options.loadAllowedPreviewOrigins?.() || [])
        .map(allowedPreviewOrigin)
        .filter((origin): origin is string => Boolean(origin)));
      const snapshotId = identifier(input.snapshotId, 'snapshotId');
      const supplyGoodsId = identifier(input.supplyGoodsId, 'supplyGoodsId');
      const shopId = identifier(input.shopId, 'shopId');
      const listingWorkflowId = identifier(input.listingWorkflowId, 'listingWorkflowId');
      const revision = positiveInteger(input.revision, 'revision');
      const draftVersion = positiveInteger(input.draftVersion, 'draftVersion');
      const allowedShopIds = [...new Set((input.allowedShopIds || []).map((value) => (
        identifier(value, 'allowedShopId')
      )))].slice(0, 50);
      if (!allowedShopIds.includes(shopId)) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_NOT_FOUND',
          404,
          'Owned source workbench was not found',
        );
      }
      const limit = Math.min(
        EXTENSION_SOURCE_MEDIA_HISTORY_LIMIT,
        Math.max(1, Number.isSafeInteger(input.limit) ? Number(input.limit) : 10),
      );
      const scope = {
        ownerUserId,
        snapshotId,
        supplyGoodsId,
        shopId,
        listingWorkflowId,
        revision,
        draftVersion,
      } as const;
      const cursor = input.beforeCursor
        ? decodeExtensionSourceMediaHistoryCursor(scope, input.beforeCursor)
        : null;

      const snapshot = await client.sourceCaptureSnapshot.findFirst({
        where: {
          id: snapshotId,
          subject: { ownerUserId, legacySupplyGoodsId: supplyGoodsId },
        },
        select: {
          id: true,
          version: true,
          capturedAt: true,
          subject: {
            select: {
              snapshots: {
                orderBy: [{ version: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      });
      if (!snapshot) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_NOT_FOUND',
          404,
          'Owned source workbench was not found',
        );
      }
      if (snapshot.subject?.snapshots?.[0]?.id !== snapshotId) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_STALE',
          409,
          'Source snapshot is no longer current',
        );
      }

      const listings = await client.sourceListingWorkflow.findMany({
        where: {
          id: listingWorkflowId,
          ownerUserId,
          supplyGoodsId,
          shopId,
          currentSourceCaptureSnapshotId: snapshotId,
          currentRevision: revision,
          currentDraftVersion: draftVersion,
        },
        take: 2,
        select: { id: true, shopId: true },
      });
      if (listings.length !== 1 || listings[0]?.id !== listingWorkflowId) {
        throw new ExtensionSourceWorkbenchError(
          'SOURCE_WORKBENCH_STALE',
          409,
          'Listing draft is no longer current',
        );
      }

      const rows = await client.aiMediaWorkflow.findMany({
        where: {
          ownerUserId,
          OR: [{
            suiteSlot: { is: null }, contextType: 'listing-draft', contextId: listingWorkflowId,
            contextDraftRevision: revision, contextDraftVersion: draftVersion,
          }, {
            suiteSlot: { is: { suite: { status: { in: ['SUCCEEDED', 'PARTIAL_FAILURE'] } } } },
            contextType: 'collect', contextId: supplyGoodsId,
          }],
          ...(cursor ? {
            AND: [{ OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
            ] }],
          } : {}),
        } satisfies Prisma.AiMediaWorkflowWhereInput,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          operation: true,
          status: true,
          reviewStatus: true,
          revision: true,
          contextSkuKey: true,
          contextSlotKey: true,
          selectedOutputAssetId: true,
          selectedOutputAsset: {
            select: {
              id: true,
              ownerUserId: true,
              aiImageJobId: true,
              sourceCaptureSnapshotId: true,
              kind: true,
              url: true,
              storageBackend: true,
              mimeType: true,
              width: true,
              height: true,
            },
          },
          createdAt: true,
          updatedAt: true,
          jobs: {
            orderBy: [{ workflowAttempt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              assets: {
                where: { kind: 'AI_GENERATED' },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: EXTENSION_SOURCE_MEDIA_HISTORY_OUTPUT_LIMIT,
                select: {
                  id: true,
                  ownerUserId: true,
                  aiImageJobId: true,
                  sourceCaptureSnapshotId: true,
                  kind: true,
                  url: true,
                  storageBackend: true,
                  mimeType: true,
                  width: true,
                  height: true,
                },
              },
            },
          },
          listingDraftApplicationMutations: {
            where: { kind: 'APPLY' },
            orderBy: [{ targetSequence: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              mode: true,
              targetId: true,
              contextSkuKey: true,
              contextSlotKey: true,
              createdAt: true,
              rolledBackBy: { select: { id: true, createdAt: true } },
            },
          },
        },
      });
      const pageRows = rows.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        contractVersion: EXTENSION_SOURCE_MEDIA_HISTORY_CONTRACT_VERSION,
        context: {
          snapshotId,
          supplyGoodsId,
          shopId,
          listingWorkflowId,
          revision,
          draftVersion,
        },
        snapshot: {
          id: String(snapshot.id),
          version: Number(snapshot.version),
          capturedAt: isoDate(snapshot.capturedAt),
        },
        items: pageRows.map((row) => mediaHistoryItem(
          row,
          ownerUserId,
          snapshotId,
          allowedOrigins,
        )),
        nextCursor: rows.length > limit && last
          ? encodeExtensionSourceMediaHistoryCursor(scope, {
            updatedAt: last.updatedAt,
            id: String(last.id),
          })
          : null,
      };
    },
  };
}

export type ExtensionSourceWorkbenchService =
  ReturnType<typeof createExtensionSourceWorkbenchService>;
