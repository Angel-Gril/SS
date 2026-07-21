import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const EXTENSION_SOURCE_WORKBENCH_CONTRACT_VERSION =
  'extension-source-workbench-status/v1' as const;
export const EXTENSION_SOURCE_WORKBENCH_LISTING_LIMIT = 10;
export const EXTENSION_SOURCE_WORKBENCH_MEDIA_LIMIT = 50;

interface ExtensionSourceWorkbenchClient {
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
    public readonly code: 'SOURCE_WORKBENCH_NOT_FOUND' | 'SOURCE_WORKBENCH_INVALID',
    public readonly statusCode: 404 | 400,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionSourceWorkbenchError';
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
): {
  commandContext: ExtensionMediaCommandContext | null;
  allowedActions: Array<'CANCEL' | 'RETRY'>;
} {
  const listing = row.contextType === 'listing-draft'
    ? listingById.get(String(row.contextId || ''))
    : null;
  const currentJob = Array.isArray(row.jobs) ? row.jobs[0] : null;
  if (!canExecuteMedia
    || !listing
    || row.contextDraftRevision !== listing.revision
    || row.contextDraftVersion !== listing.draftVersion
    || String(currentJob?.provider || '') !== 'fake') {
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
    ...mediaCommandContract(row, listingById, canExecuteMedia),
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

export function createExtensionSourceWorkbenchService(options: {
  client?: ExtensionSourceWorkbenchClient;
} = {}) {
  const client = options.client || prisma as unknown as ExtensionSourceWorkbenchClient;

  return {
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
        suiteSlot: { is: null },
        OR: mediaContexts,
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
        .map((row) => mediaSummary(row, listingById, input.canExecuteMedia === true));

      return {
        contractVersion: EXTENSION_SOURCE_WORKBENCH_CONTRACT_VERSION,
        snapshot: {
          id: String(snapshot.id),
          version: Number(snapshot.version),
          capturedAt: isoDate(snapshot.capturedAt),
          current: snapshot.subject?.snapshots?.[0]?.id === snapshot.id,
        },
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
  };
}

export type ExtensionSourceWorkbenchService =
  ReturnType<typeof createExtensionSourceWorkbenchService>;
