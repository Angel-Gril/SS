import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { isSourceListingAiMediaTarget, type OzonListingDraft, type OzonListingDraftMediaAssignment, type SourceCaptureMedia } from 'shared';
import type { OzonListingDraftRepository } from './ozon-listing-draft.js';
import type { OwnedImageStorageBackend, ImageUploadResult } from './image-storage.js';
import { loadBoundedImageSource, type BoundedImageSource } from './image-source-loader.js';
import { downloadPublicImage } from './source-public-image-download.js';

export const WATERMARK_CONTRACT_VERSION = 'extension-workbench-watermark/v1';
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const identifier = (maximum = 200) => z.string().min(1).max(maximum).refine(value => value === value.trim()
  && value === value.normalize('NFKC') && !Array.from(value).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127));
const configSchema = z.object({
  type: z.literal('text'), text: z.string().trim().min(1).max(120),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile']),
  opacity: z.number().int().min(1).max(100), fontSize: z.number().int().min(6).max(200).optional(),
  fontColor: z.string().regex(/^#[0-9a-f]{6}$/iu).optional(),
}).strict();
const itemSchema = z.object({
  skuKey: identifier(500).nullable(), slotKey: identifier(),
  sourceMediaKey: identifier(500).optional(), sourceAssetId: identifier(500).optional(),
}).strict().refine(item => Boolean(item.sourceMediaKey) !== Boolean(item.sourceAssetId));
export const watermarkPreviewRequestSchema = z.object({
  contractVersion: z.literal(WATERMARK_CONTRACT_VERSION), snapshotId: identifier(), supplyGoodsId: identifier(),
  shopId: identifier(), listingWorkflowId: identifier(), draftRevision: z.number().int().min(1),
  draftVersion: z.number().int().min(1), items: z.array(itemSchema).min(1).max(5), config: configSchema,
}).strict().refine(input => new Set(input.items.map(item => item.slotKey)).size === input.items.length);
export const watermarkApplyRequestSchema = watermarkPreviewRequestSchema.innerType().extend({
  idempotencyKey: identifier().refine(value => value.length >= 16), previewHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().refine(input => new Set(input.items.map(item => item.slotKey)).size === input.items.length);
export type SourceListingWatermarkRequest = z.infer<typeof watermarkPreviewRequestSchema>;
export type SourceListingWatermarkApplyRequest = z.infer<typeof watermarkApplyRequestSchema>;
export interface SourceListingWatermarkActor {
  ownerUserId: string; actorUserId: string; sessionId: string; scopes: string[]; allowedShopIds: string[];
}
export interface SourceListingWatermarkAsset {
  id: string; ownerUserId: string; kind: string; sourceCaptureSnapshotId: string | null; sourceMediaKey?: string | null;
  url: string; storageBackend: string; storageKey: string | null; mimeType: string; sizeBytes: number;
  width?: number | null; height?: number | null; sha256?: string | null; sourceUrl?: string | null; metadata?: Record<string, unknown> | null;
}
export interface SourceListingWatermarkCommitInput {
  actor: SourceListingWatermarkActor; binding: SourceListingWatermarkApplyRequest; requestHash: string;
  next: OzonListingDraft; assets: SourceListingWatermarkAsset[];
}
export interface SourceListingWatermarkResult {
  draft: OzonListingDraft; assets: SourceListingWatermarkAsset[]; applied: number; replayed: boolean;
}
interface Dependencies {
  repository: Pick<OzonListingDraftRepository, 'getCurrent' | 'getVersion'>;
  assertActiveBinding(input: { ownerUserId: string; shopId: string; supplyGoodsId: string; snapshotId: string }): Promise<void>;
  loadCaptureAuthority(input: { ownerUserId: string; snapshotId: string }): Promise<{
    snapshotId: string; captureHash: string; media: SourceCaptureMedia[];
  } | null>;
  loadOwnedAssets(input: { ownerUserId: string; assetIds: string[] }): Promise<SourceListingWatermarkAsset[]>;
  getStorage(): Promise<Pick<OwnedImageStorageBackend, 'backendType' | 'namespaceId' | 'uploadBuffer' | 'deleteUploaded'>>;
  commit(input: SourceListingWatermarkCommitInput): Promise<Omit<SourceListingWatermarkResult, 'applied'>>;
  download?: (url: string) => Promise<BoundedImageSource>;
  allowLocalStorage?: boolean; now?: () => Date;
}
export class SourceListingWatermarkError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); this.name = 'SourceListingWatermarkError'; }
}
function fail(code: string, status: number, message: string): never { throw new SourceListingWatermarkError(code, status, message); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([, child]) => child !== undefined).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const bufferHash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function authorize(actor: SourceListingWatermarkActor, shopId: string) {
  if (!actor || !actor.ownerUserId || actor.actorUserId !== actor.ownerUserId || !actor.sessionId
    || !Array.isArray(actor.scopes) || !['listing:write', 'media:execute'].every(scope => actor.scopes.includes(scope))
    || !Array.isArray(actor.allowedShopIds) || !actor.allowedShopIds.includes(shopId)) {
    fail('watermark_forbidden', 403, '设备没有该店铺的图片处理权限');
  }
}
export function assertWatermarkDraftContext(draft: OzonListingDraft | null, input: SourceListingWatermarkRequest, ownerUserId: string) {
  if (!draft || draft.ownerUserId !== ownerUserId || draft.id !== input.listingWorkflowId) fail('watermark_context_not_found', 404, '店铺草稿不存在');
  if (draft.shopId !== input.shopId || draft.supplyGoodsId !== input.supplyGoodsId || draft.sourceCaptureSnapshotId !== input.snapshotId
    || draft.revision !== input.draftRevision || draft.draftVersion !== input.draftVersion
    || draft.stage === 'PUBLISHED' || draft.stage === 'PUBLISH_INTENT_RECORDED'
    || !['ACTIVE', 'PAUSED', 'MANUAL_REVIEW', 'RETRYABLE_FAILURE'].includes(draft.runState)) {
    fail('watermark_context_stale', 409, '店铺草稿已变化，请刷新后处理图片');
  }
  return draft;
}
export function watermarkReceipt(draft: OzonListingDraft, input: SourceListingWatermarkApplyRequest, requestHash: string) {
  const event = draft.auditEvents.find(entry => entry.type === 'IMAGE_PROCESSING_APPLIED'
    && entry.details?.idempotencyKey === input.idempotencyKey);
  if (!event) return null;
  if (event.details.requestHash !== requestHash) fail('watermark_idempotency_conflict', 409, '水印请求键已用于另一项操作');
  return event;
}
function escapeXml(text: string) {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;');
}
/** Deterministic raster processing: no Provider request, reservation, or billing owner. */
export async function renderTextWatermark(buffer: Buffer, config: SourceListingWatermarkRequest['config']) {
  const metadata = await sharp(buffer, { limitInputPixels: 16_777_216, failOn: 'error' }).metadata();
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format || '')
    || Number(metadata.pages || 1) !== 1 || metadata.width > 4096 || metadata.height > 4096) {
    fail('watermark_source_invalid', 422, '水印仅支持单帧 JPG/PNG/WebP，边长最多 4096 像素');
  }
  const source = await sharp(buffer, { limitInputPixels: 16_777_216 }).rotate().flatten({ background: '#ffffff' }).png().toBuffer();
  const normalized = await sharp(source).metadata(); const width = normalized.width!; const height = normalized.height!;
  const fontSize = config.fontSize || Math.max(12, Math.floor(Math.min(width, height) * 0.06));
  const margin = Math.max(4, Math.ceil(fontSize * 0.6)); const opacity = config.opacity / 100;
  const font = 'Arial, Liberation Sans, DejaVu Sans, Noto Sans, Segoe UI, sans-serif';
  const textAt = (x: number, y: number, anchor: string, rotation = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}"
    font-family="${font}" font-size="${fontSize}" font-weight="600" fill="${config.fontColor || '#ffffff'}" fill-opacity="${opacity}"
    stroke="#000000" stroke-opacity="${opacity * 0.5}" stroke-width="1" paint-order="stroke fill" ${rotation}>${escapeXml(config.text)}</text>`;
  let body = '';
  if (config.position === 'tile') {
    const stepX = Math.max(fontSize * 8, 1), stepY = Math.max(fontSize * 5, 1);
    for (let y = stepY; y < height + stepY; y += stepY) for (let x = -stepX; x < width + stepX; x += stepX) {
      body += textAt(x, y, 'middle', `transform="rotate(-30 ${x} ${y})"`);
    }
  } else {
    const left = config.position.endsWith('left'), top = config.position.startsWith('top');
    body = config.position === 'center' ? textAt(width / 2, (height + fontSize) / 2, 'middle')
      : textAt(left ? margin : width - margin, top ? margin + fontSize : height - margin, left ? 'start' : 'end');
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
  const output = await sharp(source).composite([{ input: svg }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  if (output.length > MAX_OUTPUT_BYTES) fail('watermark_source_invalid', 422, '水印输出超过 8 MiB');
  return { buffer: output, width, height, sha256: bufferHash(output), sourceSha256: bufferHash(buffer) };
}
function publicAsset(asset: SourceListingWatermarkAsset): SourceListingWatermarkAsset { return { ...asset }; }
export function createSourceListingWatermarkService(options: Dependencies) {
  const download = options.download || loadBoundedImageSource;
  const downloadCaptured = options.download || (async (url: string): Promise<BoundedImageSource> => {
    // Capture URLs never enter the legacy local-file loader. Public DNS/address checks run before network IO.
    const downloaded = await downloadPublicImage(url, { maxBytes: 20 * 1024 * 1024, maxRedirects: 5, timeoutMs: 20_000 });
    const metadata = await sharp(downloaded.buffer, { limitInputPixels: 16_777_216 }).metadata();
    return { ...downloaded, width: metadata.width || 0, height: metadata.height || 0, format: metadata.format || '' };
  });
  const flights = new Map<string, { hash: string; result: Promise<SourceListingWatermarkResult> }>();
  async function readDraft(actor: SourceListingWatermarkActor, input: SourceListingWatermarkRequest) {
    const draft = await options.repository.getCurrent(input.listingWorkflowId, actor.ownerUserId);
    if (!draft || draft.ownerUserId !== actor.ownerUserId) fail('watermark_context_not_found', 404, '店铺草稿不存在');
    return draft;
  }
  async function prepare(actor: SourceListingWatermarkActor, input: SourceListingWatermarkRequest) {
    const draft = assertWatermarkDraftContext(await readDraft(actor, input), input, actor.ownerUserId);
    await options.assertActiveBinding({ ownerUserId: actor.ownerUserId, shopId: input.shopId, supplyGoodsId: input.supplyGoodsId, snapshotId: input.snapshotId });
    const authority = await options.loadCaptureAuthority({ ownerUserId: actor.ownerUserId, snapshotId: input.snapshotId });
    if (!authority || authority.snapshotId !== input.snapshotId || authority.captureHash !== draft.sourceCaptureHash) {
      fail('watermark_context_stale', 409, '来源快照已变化，请重新采集');
    }
    const sourceAssetIds = input.items.flatMap(item => item.sourceAssetId ? [item.sourceAssetId] : []);
    const sourceAssets = sourceAssetIds.length ? await options.loadOwnedAssets({ ownerUserId: actor.ownerUserId, assetIds: sourceAssetIds }) : [];
    const sources = input.items.map(item => {
      const canonicalGallery = item.skuKey !== null && draft.selectedSkuKeys.includes(item.skuKey)
        && Array.from({ length: 7 }, (_, index) => `sku:${item.skuKey}:gallery:${index + 1}`).includes(item.slotKey);
      if (!canonicalGallery && !isSourceListingAiMediaTarget(draft, { skuKey: item.skuKey, slotKey: item.slotKey })) fail('watermark_source_invalid', 422, '图片不属于当前草稿 SKU 或图片槽位');
      if (item.sourceMediaKey) {
        const matches = authority.media.filter(media => media.key === item.sourceMediaKey);
        const media = matches.length === 1 ? matches[0] : null;
        if (!media || media.kind !== 'image' || media.disposition !== 'accepted' || !media.url
          || media.role === 'sku' && (!item.skuKey || !media.skuKeys.includes(item.skuKey))
          || media.skuKeys.length > 0 && (!item.skuKey || !media.skuKeys.includes(item.skuKey))) {
          fail('watermark_source_invalid', 422, '所选图片不属于当前来源 SKU');
        }
        return { item, url: media.url, expectedSha256: null, captured: true };
      }
      const existing = draft.media.assignments.find(assignment => assignment.assetId === item.sourceAssetId
        && assignment.slotKey === item.slotKey && (item.skuKey === null ? assignment.scope === 'PRODUCT'
          : assignment.scope === 'SKU' && assignment.skuKey === item.skuKey));
      const asset = sourceAssets.find(candidate => candidate.id === item.sourceAssetId);
      if (!existing || draft.freshness.media.state !== 'CURRENT' || !asset || asset.ownerUserId !== actor.ownerUserId
        || !['SOURCE_ORIGINAL', 'AI_GENERATED', 'IMAGE_PROCESSED'].includes(asset.kind)
        || asset.sourceCaptureSnapshotId !== null && asset.sourceCaptureSnapshotId !== input.snapshotId
        || !asset.storageKey || !['oss', 'ozon-cdn', ...(options.allowLocalStorage ? ['local'] : [])].includes(asset.storageBackend)
        || !asset.sha256 || !/^[a-f0-9]{64}$/u.test(asset.sha256)) fail('watermark_source_invalid', 422, '所选处理结果未绑定到当前草稿');
      return { item, url: asset.url, expectedSha256: asset.sha256, captured: false };
    });
    const results = [];
    for (const source of sources) {
      const downloaded = await (source.captured ? downloadCaptured : download)(source.url);
      if (downloaded.buffer.length > 20 * 1024 * 1024) fail('watermark_source_invalid', 422, '来源图片超过 20 MiB');
      if (source.expectedSha256 && bufferHash(downloaded.buffer) !== source.expectedSha256) fail('watermark_source_invalid', 422, '已保存图片的校验值发生变化');
      const rendered = await renderTextWatermark(downloaded.buffer, input.config);
      results.push({ ...rendered, item: source.item, sourceUrl: source.url });
    }
    const previewHash = digest({ contractVersion: WATERMARK_CONTRACT_VERSION, ownerUserId: actor.ownerUserId,
      sessionId: actor.sessionId, input, sourceCaptureHash: draft.sourceCaptureHash,
      images: results.map(result => ({ sourceSha256: result.sourceSha256, outputSha256: result.sha256 })) });
    return { draft, results, previewHash };
  }
  async function replay(actor: SourceListingWatermarkActor, input: SourceListingWatermarkApplyRequest, requestHash: string) {
    const current = await readDraft(actor, input); const receipt = watermarkReceipt(current, input, requestHash);
    if (!receipt) return null;
    const draft = await options.repository.getVersion({ draftId: input.listingWorkflowId, ownerUserId: actor.ownerUserId, draftVersion: receipt.draftVersion });
    if (!draft || !Array.isArray(receipt.details.assetIds)) fail('watermark_context_stale', 409, '水印回执的草稿版本不可用');
    const assets = await options.loadOwnedAssets({ ownerUserId: actor.ownerUserId, assetIds: receipt.details.assetIds as string[] });
    if (assets.length !== receipt.details.assetIds.length) fail('watermark_context_stale', 409, '水印结果回执不完整');
    return { draft, assets: assets.map(publicAsset), applied: assets.length, replayed: true };
  }
  return {
    async preview(actor: SourceListingWatermarkActor, raw: unknown) {
      const parsed = watermarkPreviewRequestSchema.safeParse(raw);
      if (!parsed.success) fail('watermark_invalid_request', 400, '水印配置或图片选择无效');
      const input = parsed.data; authorize(actor, input.shopId);
      const prepared = await prepare(actor, input);
      const previews = [];
      for (const result of prepared.results) {
        const thumbnail = await sharp(result.buffer).resize({ width: 240, height: 240, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
        if (thumbnail.length > 48 * 1024) fail('watermark_source_invalid', 422, '水印预览超过响应大小限制');
        previews.push({ ...result.item, width: result.width, height: result.height, dataUrl: `data:image/jpeg;base64,${thumbnail.toString('base64')}` });
      }
      const response = { contractVersion: WATERMARK_CONTRACT_VERSION, previewHash: prepared.previewHash, items: previews, erpGenerationChargeMinor: 0 };
      if (Buffer.byteLength(JSON.stringify(response)) > 384 * 1024) fail('watermark_source_invalid', 422, '水印预览超过响应大小限制');
      return response;
    },
    async apply(actor: SourceListingWatermarkActor, raw: unknown): Promise<SourceListingWatermarkResult> {
      const parsed = watermarkApplyRequestSchema.safeParse(raw);
      if (!parsed.success) fail('watermark_invalid_request', 400, '水印应用请求无效');
      const input = parsed.data; authorize(actor, input.shopId);
      const requestHash = digest({ input, ownerUserId: actor.ownerUserId, actorUserId: actor.actorUserId, sessionId: actor.sessionId });
      const prior = await replay(actor, input, requestHash); if (prior) return prior;
      const flightKey = `${actor.ownerUserId}:${input.listingWorkflowId}:${input.idempotencyKey}`;
      const running = flights.get(flightKey);
      if (running) { if (running.hash !== requestHash) fail('watermark_idempotency_conflict', 409, '水印请求键已用于另一项操作'); return running.result; }
      const result = (async () => {
        const { idempotencyKey: _key, previewHash: _hash, ...previewInput } = input;
        const prepared = await prepare(actor, previewInput);
        if (prepared.previewHash !== input.previewHash) fail('watermark_preview_changed', 409, '来源图片或水印预览已变化，请重新预览');
        const storage = await options.getStorage();
        if (storage.backendType !== 'oss' && !(options.allowLocalStorage && storage.backendType === 'local')) fail('watermark_storage_unavailable', 503, '水印图片存储尚未配置');
        const assets: SourceListingWatermarkAsset[] = []; const uploads: ImageUploadResult[] = [];
        let commitStarted = false;
        try {
        for (const [index, image] of prepared.results.entries()) {
          const id = randomUUID(); const filename = `watermark-${id}.jpg`;
          const uploaded = await storage.uploadBuffer(image.buffer, filename, 'image/jpeg', { category: 'watermarked', ownerId: actor.ownerUserId });
          uploads.push(uploaded);
          if (uploaded.backend !== storage.backendType || !uploaded.key && !uploaded.objectKey && !uploaded.filename) fail('watermark_storage_unavailable', 503, '水印存储回执无效');
          if (uploaded.backend === 'oss') {
            let url: URL;
            try { url = new URL(uploaded.url); } catch { fail('watermark_storage_unavailable', 503, '水印存储地址无效'); }
            if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('watermark_storage_unavailable', 503, '水印存储地址必须使用 HTTPS');
          }
          assets.push({ id, ownerUserId: actor.ownerUserId, kind: 'IMAGE_PROCESSED', sourceCaptureSnapshotId: input.snapshotId,
            sourceMediaKey: `watermark:${requestHash}:${index}`, sourceUrl: image.sourceUrl, url: uploaded.url,
            storageBackend: uploaded.backend, storageKey: uploaded.key || uploaded.objectKey || uploaded.filename,
            mimeType: 'image/jpeg', sizeBytes: image.buffer.length, width: image.width, height: image.height, sha256: image.sha256,
            metadata: { contractVersion: WATERMARK_CONTRACT_VERSION, operation: 'WATERMARK', sourceCaptureHash: prepared.draft.sourceCaptureHash,
              sourceMediaKey: image.item.sourceMediaKey || null, sourceAssetId: image.item.sourceAssetId || null, sourceSha256: image.sourceSha256,
              deviceSessionId: actor.sessionId, workflowId: input.listingWorkflowId, shopId: input.shopId,
              previewHash: input.previewHash, requestHash, skuKey: image.item.skuKey, slotKey: image.item.slotKey,
              config: input.config, erpGenerationChargeMinor: 0, storageNamespaceId: storage.namespaceId } });
        }
        const next = structuredClone(prepared.draft); next.revision += 1; next.draftVersion += 1;
        next.updatedAt = (options.now?.() || new Date()).toISOString();
        const replacements = new Map(prepared.results.map((image, index) => [image.item.slotKey,
          { assetId: assets[index]!.id, source: 'EDITED', slotKey: image.item.slotKey,
            ...(image.item.skuKey === null ? { scope: 'PRODUCT' } : { scope: 'SKU', skuKey: image.item.skuKey }) } as OzonListingDraftMediaAssignment]));
        next.media.assignments = next.media.assignments.map(item => { const replacement = replacements.get(item.slotKey); replacements.delete(item.slotKey); return replacement || item; });
        next.media.assignments.push(...replacements.values());
        next.validation.status = 'STALE'; next.freshness.validation = { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' };
        next.freshness.media = { state: 'CURRENT', reason: null };
        next.grantRevocation = { required: true, reason: 'MEDIA_ASSIGNMENT_CHANGED', previousShopId: null };
        next.auditEvents.push({ id: `watermark-${randomUUID()}`, type: 'IMAGE_PROCESSING_APPLIED', actorUserId: actor.actorUserId,
          draftVersion: next.draftVersion, occurredAt: next.updatedAt, details: { contractVersion: WATERMARK_CONTRACT_VERSION,
            operation: 'WATERMARK', idempotencyKey: input.idempotencyKey, requestHash, deviceSessionId: actor.sessionId,
            previewHash: input.previewHash, assetIds: assets.map(asset => asset.id), sourceCaptureSnapshotId: input.snapshotId,
            sourceCaptureHash: prepared.draft.sourceCaptureHash, items: input.items, config: input.config, erpGenerationChargeMinor: 0 } });
        commitStarted = true;
        const committed = await options.commit({ actor, binding: input, requestHash, next, assets });
        if (committed.replayed) for (const uploaded of uploads) await Promise.resolve(storage.deleteUploaded(uploaded)).catch(() => {});
        return { ...committed, assets: committed.assets.map(publicAsset), applied: committed.assets.length };
        } catch (error) {
          // Unique object names are safe to compensate before a transaction starts, or after a known rollback.
          // An ambiguous database/connection outcome retains objects for readback and the existing watermarked retention owner.
          if (!commitStarted || error instanceof SourceListingWatermarkError
            || ['VERSION_CONFLICT', 'P2034'].includes(String((error as { code?: string })?.code))) {
            for (const uploaded of uploads) await Promise.resolve(storage.deleteUploaded(uploaded)).catch(() => {});
          }
          throw error;
        }
      })();
      flights.set(flightKey, { hash: requestHash, result });
      try { return await result; } finally { if (flights.get(flightKey)?.result === result) flights.delete(flightKey); }
    },
  };
}
export type SourceListingWatermarkService = ReturnType<typeof createSourceListingWatermarkService>;
