import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { SourceProductCaptureV2 } from 'shared';
import sharp from 'sharp';
import { getStorageBackend } from './image-storage.js';
import { loadAiImageEditInputBuffer } from './ai-image-edit-input-reader.js';
import { downloadPublicImage } from './source-public-image-download.js';
import { sanitizeOzonPublishImageBuffer } from './ozon-image-sanitizer.js';
import {
  AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO,
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  isAiMediaEditReadySourceAsset,
} from './ai-image-edit-source.js';
import { capturedSourceSkuAliases } from './source-listing-sku-identity.js';

export {
  AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO,
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_EDIT_SOURCE_MAX_EDGE,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  isAiMediaEditReadySourceAsset,
} from './ai-image-edit-source.js';

type AiMediaInternalizePurpose = 'GENERAL' | 'EDIT';

export const AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS = 50;
export const AI_MEDIA_SOURCE_PREVIEW_MAX_EDGE = 640;
export const AI_MEDIA_SOURCE_WORKING_PREVIEW_MAX_EDGE = 2048;
export const AI_MEDIA_SOURCE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export type AiMediaSourcePreviewPurpose = 'THUMBNAIL' | 'WORKING';

export interface AiMediaListingDraftContextScope {
  expectedRevision?: number;
  expectedDraftVersion?: number;
  skuKey?: string | null;
  slotKey?: string | null;
}

interface AiMediaContextDependencies {
  downloadPublicImage: typeof downloadPublicImage;
  sanitizeOzonPublishImageBuffer: typeof sanitizeOzonPublishImageBuffer;
  getStorageBackend: typeof getStorageBackend;
  loadStoredSourceAsset: (asset: any) => Promise<Buffer>;
}

export class AiMediaContextError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'AiMediaContextError';
  }
}

function productImages(capture: SourceProductCaptureV2) {
  return capture.media.filter((media) => (
    media.kind === 'image'
    && media.disposition === 'accepted'
    && media.role !== 'sku'
    && media.skuKeys.length === 0
    && Boolean(media.url)
  )).slice(0, 50);
}

function normalizedIdentifier(value: unknown, label: string, maxLength: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new AiMediaContextError('AI_MEDIA_CONTEXT_INVALID', 400, `${label} is invalid`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > maxLength || normalized !== value) {
    throw new AiMediaContextError('AI_MEDIA_CONTEXT_INVALID', 400, `${label} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || Array.from(value).length > maxLength) return null;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return null;
  }
  return value;
}

function listingCapture(value: unknown): SourceProductCaptureV2 | null {
  const capture = record(value);
  if (!capture
    || capture.captureVersion !== 'source-product-capture-v2'
    || !record(capture.facts)
    || !Array.isArray(capture.skus)
    || !Array.isArray(capture.media)) {
    return null;
  }
  const skuKeys = new Set<string>();
  for (const value of capture.skus) {
    const sku = record(value);
    const key = exactIdentifier(sku?.key, 500);
    if (!sku || !key || skuKeys.has(key)
      || (sku.sourceSkuId != null && !exactIdentifier(sku.sourceSkuId, 500))) {
      return null;
    }
    skuKeys.add(key);
  }
  const mediaKeys = new Set<string>();
  for (const value of capture.media) {
    const media = record(value);
    const key = exactIdentifier(media?.key, 500);
    if (!media || !key || mediaKeys.has(key)
      || !['image', 'video'].includes(String(media.kind || ''))
      || !['accepted', 'rejected'].includes(String(media.disposition || ''))
      || typeof media.role !== 'string'
      || (media.url != null && typeof media.url !== 'string')
      || !Array.isArray(media.skuKeys)
      || media.skuKeys.some((skuKey) => !exactIdentifier(skuKey, 500))) {
      return null;
    }
    mediaKeys.add(key);
  }
  const aliases = capturedSourceSkuAliases(capture);
  if (capture.media.some((value) => {
    const media = value as Record<string, unknown>;
    return (media.skuKeys as unknown[]).some((skuKey) => !aliases.get(String(skuKey)));
  })) {
    return null;
  }
  return capture as unknown as SourceProductCaptureV2;
}

interface ListingDraftAssignment {
  scope: 'PRODUCT' | 'SKU';
  slotKey: string;
  assetId: string;
  skuKey: string | null;
  source: 'SOURCE' | 'REVIEWED' | 'GENERATED' | 'TRANSLATED' | 'EDITED';
}

function listingDraftAssignments(value: unknown): ListingDraftAssignment[] | null {
  const media = record(value);
  if (!media || !Array.isArray(media.assignments)) return null;
  const assignments: ListingDraftAssignment[] = [];
  const slotKeys = new Set<string>();
  const assetIds = new Set<string>();
  for (const value of media.assignments) {
    const assignment = record(value);
    const slotKey = exactIdentifier(assignment?.slotKey, 1024);
    const assetId = exactIdentifier(assignment?.assetId, 500);
    const source = typeof assignment?.source === 'string'
      && ['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(assignment.source)
      ? assignment.source as ListingDraftAssignment['source']
      : null;
    if (!assignment || !slotKey || !assetId || !source
      || slotKeys.has(slotKey) || assetIds.has(assetId)) return null;
    slotKeys.add(slotKey);
    assetIds.add(assetId);
    if (assignment.scope === 'PRODUCT') {
      if (Object.prototype.hasOwnProperty.call(assignment, 'skuKey')) return null;
      assignments.push({ scope: 'PRODUCT', slotKey, assetId, skuKey: null, source });
      continue;
    }
    const skuKey = exactIdentifier(assignment.skuKey, 500);
    if (assignment.scope !== 'SKU' || !skuKey) return null;
    assignments.push({ scope: 'SKU', slotKey, assetId, skuKey, source });
  }
  return assignments;
}

function listingDraftImages(
  capture: SourceProductCaptureV2,
  selectedSkuKeys: string[],
  requestedSkuKey: string | null,
) {
  const aliases = capturedSourceSkuAliases(capture);
  const selected = new Set(requestedSkuKey ? [requestedSkuKey] : selectedSkuKeys);
  const media = capture.media.filter((media) => {
    if (media.kind !== 'image' || media.disposition !== 'accepted' || !media.url) return false;
    if (media.role !== 'sku' && media.skuKeys.length === 0) return true;
    const canonicalSkuKeys = media.skuKeys
      .map((key) => aliases.get(key) || null)
      .filter((key): key is string => Boolean(key));
    return canonicalSkuKeys.some((key) => selected.has(key));
  });
  if (media.length > AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS) {
    throw new AiMediaContextError(
      'AI_MEDIA_CONTEXT_LIMIT_EXCEEDED',
      413,
      `Listing draft media context exceeds ${AI_MEDIA_LISTING_CONTEXT_MAX_INPUTS} source images`,
    );
  }
  return media;
}

function editSourceMediaKey(sourceMediaKey: string) {
  return `ai-edit-source:v1:${createHash('sha256').update(sourceMediaKey).digest('hex')}`;
}

async function inspectAiMediaSourceBuffer(buffer: Buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > AI_MEDIA_EDIT_SOURCE_MAX_BYTES) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source image exceeds the edit byte limit');
  }
  try {
    const metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
    }).metadata();
    if (
      !metadata.format
      || Number(metadata.pages || 1) !== 1
      || !Number.isSafeInteger(metadata.width)
      || !Number.isSafeInteger(metadata.height)
      || Number(metadata.width) < 1
      || Number(metadata.height) < 1
      || Number(metadata.width) > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
      || Number(metadata.height) > AI_MEDIA_EDIT_SOURCE_MAX_EDGE
      || Number(metadata.width) * Number(metadata.height) > AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
      || Math.max(Number(metadata.width), Number(metadata.height))
        / Math.min(Number(metadata.width), Number(metadata.height)) > AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO
    ) {
      throw new Error('invalid source metadata');
    }
    return metadata;
  } catch {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source image exceeds edit dimensions or cannot be decoded safely');
  }
}

export async function normalizeAiMediaSourceBuffer(input: {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
}) {
  const metadata = await inspectAiMediaSourceBuffer(input.buffer);
  if (!['jpeg', 'png'].includes(String(metadata.format || ''))) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Normalized edit source must be JPEG or PNG');
  }
  const sourceOrientation = metadata.orientation || 1;
  if (sourceOrientation === 1) {
    return {
      buffer: input.buffer,
      width: metadata.width || null,
      height: metadata.height || null,
      sourceOrientation,
      orientationNormalizationApplied: false,
    };
  }
  const pipeline = sharp(input.buffer, {
    animated: false,
    limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  }).rotate();
  const buffer = input.mimeType === 'image/png'
    ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
    : await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer();
  if (buffer.length > AI_MEDIA_EDIT_SOURCE_MAX_BYTES) {
    throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Normalized edit source exceeds the byte limit');
  }
  const normalized = await inspectAiMediaSourceBuffer(buffer);
  return {
    buffer,
    width: normalized.width || null,
    height: normalized.height || null,
    sourceOrientation,
    orientationNormalizationApplied: true,
  };
}

export function createAiMediaContextService(
  client: PrismaClient,
  dependencyOverrides: Partial<AiMediaContextDependencies> = {},
) {
  const dependencies: AiMediaContextDependencies = {
    downloadPublicImage,
    sanitizeOzonPublishImageBuffer,
    getStorageBackend,
    loadStoredSourceAsset: (asset) => loadAiImageEditInputBuffer(asset),
    ...dependencyOverrides,
  };

  async function loadInputs(input: {
    ownerUserId: string;
    snapshotId: string;
    media: SourceProductCaptureV2['media'];
    skuAliases?: Map<string, string | null>;
    allowedSkuKeys?: Set<string>;
  }) {
    const mediaKeys = input.media.map((item) => item.key);
    const editKeyToSourceKey = new Map(mediaKeys.map((key) => [editSourceMediaKey(key), key]));
    const assets = await client.mediaAsset.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        sourceCaptureSnapshotId: input.snapshotId,
        sourceMediaKey: { in: [...mediaKeys, ...editKeyToSourceKey.keys()] },
        kind: 'SOURCE_ORIGINAL',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const assetByKey = new Map<string | null, (typeof assets)[number]>();
    const editAssetByKey = new Map<string | null, (typeof assets)[number]>();
    const compatibleAssetsByKey = new Map<string | null, Array<(typeof assets)[number]>>();
    const storageRank = (backend: string) => (
      backend === 'oss' ? 0 : backend === 'local' ? 1 : 2
    );
    const assetOrder = (left: (typeof assets)[number], right: (typeof assets)[number]) => (
      storageRank(left.storageBackend) - storageRank(right.storageBackend)
      || (String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0)
    );
    const sourceUrlByKey = new Map(input.media.map((item) => [item.key, item.url]));
    for (const asset of assets) {
      const sourceMediaKey = editKeyToSourceKey.get(String(asset.sourceMediaKey || ''))
        || asset.sourceMediaKey;
      const expectedSourceUrl = sourceUrlByKey.get(String(sourceMediaKey || ''));
      if (!expectedSourceUrl || asset.sourceUrl !== expectedSourceUrl) continue;
      compatibleAssetsByKey.set(sourceMediaKey, [
        ...(compatibleAssetsByKey.get(sourceMediaKey) || []),
        asset,
      ]);
      const existing = assetByKey.get(sourceMediaKey);
      if (!existing || assetOrder(asset, existing) < 0) {
        assetByKey.set(sourceMediaKey, asset);
      }
      if (isAiMediaEditReadySourceAsset(asset)) {
        const existingEdit = editAssetByKey.get(sourceMediaKey);
        if (!existingEdit || assetOrder(asset, existingEdit) < 0) {
          editAssetByKey.set(sourceMediaKey, asset);
        }
      }
    }
    return input.media.map((item) => {
      const editAsset = editAssetByKey.get(item.key);
      const asset = editAsset || assetByKey.get(item.key);
      const compatibleAssetIds = [...new Set([
        ...(asset?.id ? [asset.id] : []),
        ...(compatibleAssetsByKey.get(item.key) || [])
          .sort(assetOrder)
          .map((candidate) => candidate.id),
      ])];
      const canonicalSkuKeys = input.skuAliases
        ? item.skuKeys
          .map((key) => input.skuAliases!.get(key) || null)
          .filter((key): key is string => Boolean(key))
          .filter((key) => !input.allowedSkuKeys || input.allowedSkuKeys.has(key))
        : [];
      return {
        sourceMediaKey: item.key,
        role: item.role,
        sourceUrl: item.url!,
        assetId: asset?.id || null,
        assetUrl: asset?.url || null,
        mimeType: asset?.mimeType || null,
        width: asset?.width || null,
        height: asset?.height || null,
        editReady: Boolean(editAsset),
        compatibleAssetIds,
        ...(input.skuAliases ? {
          scope: canonicalSkuKeys.length ? 'SKU' as const : 'PRODUCT' as const,
          skuKeys: [...new Set(canonicalSkuKeys)].sort(),
        } : {}),
      };
    });
  }

  async function loadCollect(ownerUserId: string, collectId: string) {
    const goods = await client.supplyGoods.findFirst({
      where: { id: collectId, userId: ownerUserId },
      select: {
        id: true,
        title: true,
        sourceCaptureSubject: {
          select: {
            snapshots: {
              orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { id: true, version: true, captureHash: true, payload: true },
            },
          },
        },
      },
    });
    const snapshot = goods?.sourceCaptureSubject?.snapshots[0];
    const capture = snapshot?.payload as unknown as SourceProductCaptureV2 | undefined;
    if (!goods || !snapshot || !capture || capture.captureVersion !== 'source-product-capture-v2') {
      throw new AiMediaContextError('AI_MEDIA_CONTEXT_NOT_FOUND', 404, 'Owned capture context was not found');
    }
    const media = productImages(capture);
    return {
      target: { type: 'collect' as const, id: goods.id, label: goods.title },
      snapshot: { id: snapshot.id, version: snapshot.version, captureHash: snapshot.captureHash },
      inputs: await loadInputs({ ownerUserId, snapshotId: snapshot.id, media }),
    };
  }

  async function loadListingDraft(
    ownerUserId: string,
    draftId: string,
    rawScope: AiMediaListingDraftContextScope = {},
  ) {
    const skuKey = normalizedIdentifier(rawScope.skuKey, 'skuKey', 500);
    const slotKey = normalizedIdentifier(rawScope.slotKey, 'slotKey', 1024);
    const expectedRevision = rawScope.expectedRevision == null
      ? null
      : positiveInteger(rawScope.expectedRevision);
    const expectedDraftVersion = rawScope.expectedDraftVersion == null
      ? null
      : positiveInteger(rawScope.expectedDraftVersion);
    if ((rawScope.expectedRevision != null && expectedRevision == null)
      || (rawScope.expectedDraftVersion != null && expectedDraftVersion == null)) {
      throw new AiMediaContextError(
        'AI_MEDIA_CONTEXT_INVALID', 400, 'Listing draft revision is invalid',
      );
    }
    const workflow = await client.sourceListingWorkflow.findFirst({
      where: { id: draftId, ownerUserId },
      select: {
        id: true,
        ownerUserId: true,
        sourceSubjectId: true,
        currentRevision: true,
        currentDraftVersion: true,
        currentSourceCaptureSnapshotId: true,
        currentDraft: {
          select: {
            workflowId: true,
            ownerUserId: true,
            revision: true,
            draftVersion: true,
            sourceCaptureSnapshotId: true,
            payload: true,
          },
        },
        currentSourceCaptureSnapshot: {
          select: {
            id: true,
            version: true,
            captureHash: true,
            payload: true,
            subjectId: true,
            subject: { select: { ownerUserId: true } },
          },
        },
      },
    });
    if (!workflow) {
      throw new AiMediaContextError(
        'AI_MEDIA_CONTEXT_NOT_FOUND', 404, 'Owned listing draft context was not found',
      );
    }
    if (workflow.id !== draftId || workflow.ownerUserId !== ownerUserId) {
      throw new AiMediaContextError(
        'AI_MEDIA_CONTEXT_NOT_FOUND', 404, 'Owned listing draft context was not found',
      );
    }
    const draft = record(workflow.currentDraft?.payload);
    const snapshot = workflow.currentSourceCaptureSnapshot;
    const capture = listingCapture(snapshot?.payload);
    const assignments = listingDraftAssignments(record(draft?.media));
    if (!draft
      || !workflow.currentDraft
      || !snapshot
      || snapshot.subject?.ownerUserId !== ownerUserId
      || snapshot.subjectId !== workflow.sourceSubjectId
      || !capture
      || !assignments
      || positiveInteger(workflow.currentRevision) == null
      || positiveInteger(workflow.currentDraftVersion) == null
      || positiveInteger(workflow.currentDraft.revision) == null
      || positiveInteger(workflow.currentDraft.draftVersion) == null
      || positiveInteger(draft.revision) == null
      || positiveInteger(draft.draftVersion) == null
      || positiveInteger(snapshot.version) == null
      || workflow.currentDraft.workflowId !== workflow.id
      || workflow.currentDraft.ownerUserId !== ownerUserId
      || workflow.currentRevision !== workflow.currentDraft.revision
      || workflow.currentDraftVersion !== workflow.currentDraft.draftVersion
      || workflow.currentSourceCaptureSnapshotId !== snapshot.id
      || workflow.currentDraft.sourceCaptureSnapshotId !== snapshot.id
      || draft.id !== workflow.id
      || draft.ownerUserId !== ownerUserId
      || draft.revision !== workflow.currentRevision
      || draft.draftVersion !== workflow.currentDraftVersion
      || draft.sourceCaptureSnapshotId !== snapshot.id
      || draft.sourceCaptureHash !== snapshot.captureHash
      || typeof snapshot.captureHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(snapshot.captureHash)
      || !Array.isArray(draft.selectedSkuKeys)) {
      throw new AiMediaContextError(
        'STALE_MEDIA_CONTEXT', 409, 'Listing draft context no longer matches its current source snapshot',
      );
    }
    if ((expectedRevision != null && expectedRevision !== draft.revision)
      || (expectedDraftVersion != null && expectedDraftVersion !== draft.draftVersion)) {
      throw new AiMediaContextError(
        'STALE_MEDIA_CONTEXT', 409, 'Listing draft revision changed; refresh before continuing',
      );
    }
    const aliases = capturedSourceSkuAliases(capture);
    const selectedSkuKeys: string[] = [];
    const selectedSkuKeySet = new Set<string>();
    for (const value of draft.selectedSkuKeys) {
      const key = exactIdentifier(value, 500);
      if (!key || aliases.get(key) !== key || selectedSkuKeySet.has(key)) {
        throw new AiMediaContextError(
          'STALE_MEDIA_CONTEXT', 409, 'Listing draft SKU selection no longer matches the source snapshot',
        );
      }
      selectedSkuKeySet.add(key);
      selectedSkuKeys.push(key);
    }
    selectedSkuKeys.sort();
    if (!selectedSkuKeys.length || assignments.some((assignment) => (
      assignment.scope === 'SKU'
      && (!assignment.skuKey
        || aliases.get(assignment.skuKey) !== assignment.skuKey
        || !selectedSkuKeySet.has(assignment.skuKey))
    ))) {
      throw new AiMediaContextError(
        'STALE_MEDIA_CONTEXT', 409, 'Listing draft SKU selection no longer matches the source snapshot',
      );
    }
    if (skuKey && !selectedSkuKeys.includes(skuKey)) {
      throw new AiMediaContextError(
        'AI_MEDIA_CONTEXT_MISMATCH', 409, 'Requested SKU is not selected in the current listing draft',
      );
    }
    const slotAssignments = slotKey
      ? assignments.filter((item) => item.slotKey === slotKey)
      : [];
    const matchingAssignments = slotAssignments.filter((item) => (
      skuKey
        ? item.scope === 'SKU' && item.skuKey === skuKey
        : item.scope === 'PRODUCT'
    ));
    if (slotAssignments.length && matchingAssignments.length !== 1) {
      throw new AiMediaContextError(
        'AI_MEDIA_CONTEXT_MISMATCH', 409, 'Requested media slot belongs to another product or SKU scope',
      );
    }
    const assignment = matchingAssignments[0] || null;
    const media = listingDraftImages(capture, selectedSkuKeys, skuKey);
    const inputs = await loadInputs({
      ownerUserId,
      snapshotId: snapshot.id,
      media,
      skuAliases: aliases,
      allowedSkuKeys: new Set(skuKey ? [skuKey] : selectedSkuKeys),
    });
    const assignmentAssetIds = [...new Set(assignments.map((item) => item.assetId))];
    if (assignmentAssetIds.length) {
      const assignmentAssets = await client.mediaAsset.findMany({
        where: {
          ownerUserId,
          id: { in: assignmentAssetIds },
        },
        select: { id: true, sourceCaptureSnapshotId: true, kind: true, mimeType: true },
      });
      const assignmentById = new Map(assignmentAssets.map((asset) => [String(asset.id), asset]));
      if (assignmentAssetIds.some((id) => (
        assignmentById.get(id)?.sourceCaptureSnapshotId !== snapshot.id
        || !['SOURCE_ORIGINAL', 'AI_GENERATED'].includes(String(assignmentById.get(id)?.kind || ''))
        || !String(assignmentById.get(id)?.mimeType || '').startsWith('image/')
      ))) {
        throw new AiMediaContextError(
          'STALE_MEDIA_CONTEXT', 409, 'Listing draft media assignments no longer match the source snapshot',
        );
      }
    }
    const copy = record(draft.copy);
    const facts = record(capture.facts);
    return {
      target: {
        type: 'listing-draft' as const,
        id: workflow.id,
        label: typeof copy?.publishTitleRu === 'string'
          ? copy.publishTitleRu
          : typeof facts?.title === 'string' ? facts.title : workflow.id,
        revision: draft.revision,
        draftVersion: draft.draftVersion,
        skuKey,
        slotKey,
        assignedAssetId: assignment?.assetId || null,
      },
      snapshot: { id: snapshot.id, version: snapshot.version, captureHash: snapshot.captureHash },
      selectedSkuKeys,
      inputs,
    };
  }

  async function internalizeContext(
    ownerUserId: string,
    context: Awaited<ReturnType<typeof loadCollect>> | Awaited<ReturnType<typeof loadListingDraft>>,
    sourceMediaKey: string,
    purpose: AiMediaInternalizePurpose,
  ) {
      const selected = context.inputs.find((item) => item.sourceMediaKey === sourceMediaKey);
      if (!selected) throw new AiMediaContextError('SOURCE_MEDIA_NOT_FOUND', 404, 'Source image was not found');
      if (selected.assetId && (purpose !== 'EDIT' || selected.editReady)) {
        return {
          id: selected.assetId,
          url: selected.assetUrl!,
          mimeType: selected.mimeType!,
          width: selected.width,
          height: selected.height,
          editReady: selected.editReady,
        };
      }
      if (purpose === 'GENERAL') {
        const downloaded = await dependencies.downloadPublicImage(selected.sourceUrl);
        const sanitized = await dependencies.sanitizeOzonPublishImageBuffer(
          downloaded.buffer,
          `ai-source-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
          downloaded.contentType,
        );
        const dimensions = await sharp(sanitized.buffer, { animated: false }).metadata();
        const storage = await dependencies.getStorageBackend();
        const uploaded = await storage.uploadBuffer(
          sanitized.buffer,
          sanitized.filename,
          sanitized.mimeType,
          { category: 'raw', ownerId: ownerUserId },
        );
        const data = {
          ownerUserId,
          kind: 'SOURCE_ORIGINAL' as const,
          sourceCaptureSnapshotId: context.snapshot.id,
          sourceMediaKey,
          sourceUrl: selected.sourceUrl,
          url: uploaded.url,
          storageBackend: uploaded.backend,
          storageKey: (uploaded as { key?: string }).key || uploaded.filename || null,
          mimeType: sanitized.mimeType,
          sizeBytes: sanitized.buffer.length,
          width: dimensions.width || null,
          height: dimensions.height || null,
          sha256: createHash('sha256').update(sanitized.buffer).digest('hex'),
          metadata: {
            lineageVersion: 'ai-media-source/v1',
            sourceCaptureHash: context.snapshot.captureHash,
            sourceUrl: selected.sourceUrl,
            finalSourceUrl: downloaded.finalUrl,
            sourceSha256: createHash('sha256').update(downloaded.buffer).digest('hex'),
            sourceSizeBytes: downloaded.buffer.length,
            sourceMimeType: downloaded.contentType,
            sourceFormat: sanitized.sourceFormat,
            redirectCount: downloaded.redirectCount,
          },
        };
        try {
          const created = await client.mediaAsset.create({ data });
          return { ...created, editReady: isAiMediaEditReadySourceAsset(created) };
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          const winner = await client.mediaAsset.findFirst({ where: {
            ownerUserId,
            sourceCaptureSnapshotId: context.snapshot.id,
            sourceMediaKey,
            storageBackend: uploaded.backend,
          } });
          if (!winner) throw error;
          if (winner.sourceUrl !== selected.sourceUrl) {
            throw new AiMediaContextError(
              'SOURCE_ASSET_CONFLICT', 409, 'Persisted source image conflicts with the current capture authority',
            );
          }
          return { ...winner, editReady: isAiMediaEditReadySourceAsset(winner) };
        }
      }
      const storedSource = selected.assetId
        ? await client.mediaAsset.findFirst({ where: {
            id: selected.assetId,
            ownerUserId,
            sourceCaptureSnapshotId: context.snapshot.id,
            kind: 'SOURCE_ORIGINAL',
          } })
        : null;
      let sourceBuffer: Buffer;
      let sourceContentType: string;
      let finalSourceUrl: string;
      let redirectCount: number;
      let sourceReadMode: 'owned_storage' | 'public_download';
      if (
        storedSource
        && ['local', 'oss'].includes(String(storedSource.storageBackend || ''))
        && String(storedSource.storageKey || '').trim()
        && Number.isSafeInteger(storedSource.sizeBytes)
        && storedSource.sizeBytes > 0
        && storedSource.sizeBytes <= AI_MEDIA_EDIT_SOURCE_MAX_BYTES
      ) {
        sourceBuffer = await dependencies.loadStoredSourceAsset(storedSource);
        sourceContentType = storedSource.mimeType;
        finalSourceUrl = storedSource.url;
        redirectCount = 0;
        sourceReadMode = 'owned_storage';
      } else {
        const downloaded = await dependencies.downloadPublicImage(selected.sourceUrl);
        sourceBuffer = downloaded.buffer;
        sourceContentType = downloaded.contentType;
        finalSourceUrl = downloaded.finalUrl;
        redirectCount = downloaded.redirectCount;
        sourceReadMode = 'public_download';
      }
      await inspectAiMediaSourceBuffer(sourceBuffer);
      const sanitized = await dependencies.sanitizeOzonPublishImageBuffer(
        sourceBuffer,
        `ai-source-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
        sourceContentType,
      );
      const normalized = await normalizeAiMediaSourceBuffer({
        buffer: sanitized.buffer,
        mimeType: sanitized.mimeType,
      });
      const normalizedSha256 = createHash('sha256').update(normalized.buffer).digest('hex');
      const normalizedSourceMediaKey = editSourceMediaKey(sourceMediaKey);
      const uploadIdempotencyKey = createHash('sha256').update([
        AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
        ownerUserId,
        context.snapshot.id,
        sourceMediaKey,
        normalizedSha256,
      ].join('\0')).digest('hex');
      const extension = sanitized.mimeType === 'image/png' ? 'png' : 'jpg';
      const storage = await dependencies.getStorageBackend();
      const uploaded = await storage.uploadBuffer(
        normalized.buffer,
        `ai-edit-source-${normalizedSha256.slice(0, 24)}.${extension}`,
        sanitized.mimeType,
        { category: 'raw', ownerId: ownerUserId, idempotencyKey: uploadIdempotencyKey },
      );
      const storageKey = (uploaded as { key?: string }).key || uploaded.filename || null;
      if (!uploaded.url || !storageKey || (purpose === 'EDIT' && !['local', 'oss'].includes(uploaded.backend))) {
        throw new AiMediaContextError('STORAGE_NOT_READY', 503, 'Edit source requires durable local or OSS storage');
      }
      const data = {
        ownerUserId,
        kind: 'SOURCE_ORIGINAL' as const,
        sourceCaptureSnapshotId: context.snapshot.id,
        sourceMediaKey: normalizedSourceMediaKey,
        sourceUrl: selected.sourceUrl,
        url: uploaded.url,
        storageBackend: uploaded.backend,
        storageKey,
        mimeType: sanitized.mimeType,
        sizeBytes: normalized.buffer.length,
        width: normalized.width,
        height: normalized.height,
        sha256: normalizedSha256,
        metadata: {
          lineageVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
          originalSourceMediaKey: sourceMediaKey,
          pixelOrientationNormalized: true,
          sourceOrientation: normalized.sourceOrientation,
          orientationNormalizationApplied: normalized.orientationNormalizationApplied,
          sourceCaptureHash: context.snapshot.captureHash,
          sourceUrl: selected.sourceUrl,
          finalSourceUrl,
          sourceReadMode,
          sourceSha256: createHash('sha256').update(sourceBuffer).digest('hex'),
          sourceSizeBytes: sourceBuffer.length,
          sourceMimeType: sourceContentType,
          sourceFormat: sanitized.sourceFormat,
          redirectCount,
        },
      };
      try {
        const created = await client.mediaAsset.create({ data });
        return { ...created, editReady: isAiMediaEditReadySourceAsset(created) };
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        const winner = await client.mediaAsset.findFirst({ where: {
          ownerUserId,
          sourceCaptureSnapshotId: context.snapshot.id,
          sourceMediaKey: normalizedSourceMediaKey,
          storageBackend: uploaded.backend,
        } });
        if (!winner) throw error;
        if (winner.sourceUrl !== selected.sourceUrl) {
          throw new AiMediaContextError(
            'SOURCE_ASSET_CONFLICT', 409, 'Persisted edit source conflicts with the current capture authority',
          );
        }
        if (purpose === 'EDIT' && !isAiMediaEditReadySourceAsset(winner)) {
          throw new AiMediaContextError('INVALID_MEDIA_INPUT', 409, 'Persisted edit source conflicts with its normalization contract');
        }
        return { ...winner, editReady: isAiMediaEditReadySourceAsset(winner) };
      }
  }

  async function loadListingDraftPreview(
    ownerUserId: string,
    draftId: string,
    sourceMediaKey: string,
    scope: AiMediaListingDraftContextScope,
    purpose: AiMediaSourcePreviewPurpose,
  ) {
    if (!['THUMBNAIL', 'WORKING'].includes(purpose)) {
      throw new AiMediaContextError('AI_MEDIA_CONTEXT_INVALID', 400, 'Preview purpose is invalid');
    }
    const context = await loadListingDraft(ownerUserId, draftId, scope);
    const selected = context.inputs.find((item) => item.sourceMediaKey === sourceMediaKey);
    if (!selected) {
      throw new AiMediaContextError('SOURCE_MEDIA_NOT_FOUND', 404, 'Source image was not found');
    }
    const downloaded = await dependencies.downloadPublicImage(selected.sourceUrl);
    const sanitized = await dependencies.sanitizeOzonPublishImageBuffer(
      downloaded.buffer,
      `source-preview-${createHash('sha256').update(sourceMediaKey).digest('hex').slice(0, 16)}.jpg`,
      downloaded.contentType,
    );
    const maximumEdge = purpose === 'THUMBNAIL'
      ? AI_MEDIA_SOURCE_PREVIEW_MAX_EDGE
      : AI_MEDIA_SOURCE_WORKING_PREVIEW_MAX_EDGE;
    const pipeline = sharp(sanitized.buffer, {
      animated: false,
      limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
    })
      .rotate()
      .resize({
        width: maximumEdge,
        height: maximumEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });
    const mimeType = sanitized.mimeType;
    const bytes = mimeType === 'image/png'
      ? await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : await pipeline.jpeg({ quality: purpose === 'THUMBNAIL' ? 84 : 92, mozjpeg: true }).toBuffer();
    if (bytes.length < 1 || bytes.length > AI_MEDIA_SOURCE_PREVIEW_MAX_BYTES) {
      throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source preview exceeds the byte limit');
    }
    const metadata = await sharp(bytes, {
      animated: false,
      limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
    }).metadata();
    if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || Number(metadata.width) < 1 || Number(metadata.height) < 1
      || Number(metadata.width) > maximumEdge || Number(metadata.height) > maximumEdge) {
      throw new AiMediaContextError('INVALID_MEDIA_INPUT', 400, 'Source preview dimensions are invalid');
    }
    return {
      bytes,
      mimeType,
      width: Number(metadata.width),
      height: Number(metadata.height),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  return {
    loadCollect,
    loadListingDraft,
    loadListingDraftPreview,
    async load(
      ownerUserId: string,
      context:
        | { type: 'collect'; id: string }
        | ({ type: 'listing-draft'; id: string; revision: number; draftVersion: number }
          & Pick<AiMediaListingDraftContextScope, 'skuKey' | 'slotKey'>),
    ) {
      if (context.type === 'listing-draft') {
        return loadListingDraft(ownerUserId, context.id, {
          expectedRevision: context.revision,
          expectedDraftVersion: context.draftVersion,
          skuKey: context.skuKey,
          slotKey: context.slotKey,
        });
      }
      return loadCollect(ownerUserId, context.id);
    },
    async internalizeCollect(
      ownerUserId: string,
      collectId: string,
      sourceMediaKey: string,
      purpose: AiMediaInternalizePurpose = 'GENERAL',
    ) {
      return internalizeContext(
        ownerUserId,
        await loadCollect(ownerUserId, collectId),
        sourceMediaKey,
        purpose,
      );
    },
    async internalizeListingDraft(
      ownerUserId: string,
      draftId: string,
      sourceMediaKey: string,
      scope: AiMediaListingDraftContextScope,
      purpose: AiMediaInternalizePurpose = 'GENERAL',
    ) {
      return internalizeContext(
        ownerUserId,
        await loadListingDraft(ownerUserId, draftId, scope),
        sourceMediaKey,
        purpose,
      );
    },
  };
}

export type AiMediaContextService = ReturnType<typeof createAiMediaContextService>;
