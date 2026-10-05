import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canonicalStringify, type OzonListingDraft, type OzonListingDraftVideoBinding, type OzonNormalizedAttributeSchema } from 'shared';
import type { OzonListingDraftRepository } from './ozon-listing-draft.js';
import { buildSelectedVideoAttributes, videoFail } from './source-listing-video-media.js';
export { SourceListingVideoError, normalizeOfficialOzonVideoUrl } from './source-listing-video-media.js';

const id = (maximum = 200) => z.string().min(1).max(maximum).refine(value => value === value.normalize('NFKC').trim()
  && !Array.from(value).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127));
export const videoBindingSchema = z.object({ snapshotId: id(), supplyGoodsId: id(), shopId: id(), listingWorkflowId: id(),
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict();
export const videoReadRequestSchema = z.object({ binding: videoBindingSchema }).strict();
export const videoSaveRequestSchema = videoReadRequestSchema.extend({ skuKey: id(500).nullable(),
  mainUrl: z.string().min(1).max(4096).nullable(), richContentUrl: z.string().min(1).max(4096).nullable(), operationKey: id().refine(value => value.length >= 8) }).strict();
export type SourceListingVideoBinding = z.infer<typeof videoBindingSchema>;
export type SourceListingVideoSaveInput = z.infer<typeof videoSaveRequestSchema>;
export interface SourceListingVideoActor { ownerUserId: string; actorUserId: string; sessionId: string; scopes: string[]; allowedShopIds: string[] }
export interface SourceListingVideoCommitInput {
  actor: SourceListingVideoActor; binding: SourceListingVideoBinding; input: SourceListingVideoSaveInput;
  requestHash: string; next: OzonListingDraft;
}
export interface SourceListingVideoDependencies {
  repository: Pick<OzonListingDraftRepository, 'getCurrent' | 'getVersion'>;
  assertActiveBinding(actor: SourceListingVideoActor, binding: SourceListingVideoBinding, save: boolean): Promise<void>;
  loadSchema(input: { ownerUserId: string; draft: OzonListingDraft }): Promise<OzonNormalizedAttributeSchema>;
  commit(input: SourceListingVideoCommitInput): Promise<{ draft: OzonListingDraft; replayed: boolean }>;
  now?: () => Date;
}
function authorize(actor: SourceListingVideoActor, shopId: string, save: boolean) {
  if (!actor?.ownerUserId || actor.actorUserId !== actor.ownerUserId || !actor.sessionId || !Array.isArray(actor.scopes)
    || !(save ? ['listing:review', 'listing:write', 'media:execute'] : ['listing:review']).every(scope => actor.scopes.includes(scope))
    || !Array.isArray(actor.allowedShopIds) || !actor.allowedShopIds.includes(shopId)) videoFail('video_forbidden', 403, '设备没有该店铺的视频编辑权限');
}
export function projectVideoBinding(draft: OzonListingDraft): SourceListingVideoBinding {
  return { snapshotId: draft.sourceCaptureSnapshotId, supplyGoodsId: draft.supplyGoodsId, shopId: draft.shopId,
    listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion };
}
export function assertVideoDraftContext(draft: OzonListingDraft | null, actor: SourceListingVideoActor, binding: SourceListingVideoBinding, save: boolean) {
  if (!draft || draft.ownerUserId !== actor.ownerUserId || draft.id !== binding.listingWorkflowId) videoFail('video_context_not_found', 404, '店铺草稿不存在');
  if (canonicalStringify(projectVideoBinding(draft)) !== canonicalStringify(binding)
    || save && (['PUBLISHED', 'PUBLISH_INTENT_RECORDED'].includes(draft.stage)
      || !['ACTIVE', 'PAUSED', 'MANUAL_REVIEW', 'RETRYABLE_FAILURE'].includes(draft.runState))) videoFail('video_context_stale', 409, '草稿或来源快照已变化，请刷新后保存视频');
  return draft;
}
export function videoReceipt(draft: OzonListingDraft, operationKey: string, requestHash: string) {
  const receipt = draft.auditEvents.find(event => event.type === 'VIDEO_BINDING_CHANGED' && event.details.operationKey === operationKey);
  if (receipt && receipt.details.requestHash !== requestHash) videoFail('video_idempotency_conflict', 409, '视频操作键已用于另一项保存');
  return receipt;
}
function result(draft: OzonListingDraft, replayed: boolean) {
  return { state: 'ready' as const, replayed, binding: projectVideoBinding(draft), videoBindings: structuredClone(draft.media.videoBindings || []) };
}
export function createSourceListingVideoService(options: SourceListingVideoDependencies) {
  const flights = new Map<string, { hash: string; result: Promise<ReturnType<typeof result>> }>();
  return {
    async read(actor: SourceListingVideoActor, raw: unknown) {
      const parsed = videoReadRequestSchema.safeParse(raw); if (!parsed.success) videoFail('video_invalid_request', 400, '视频读取参数无效');
      authorize(actor, parsed.data.binding.shopId, false);
      await options.assertActiveBinding(actor, parsed.data.binding, false);
      const draft = assertVideoDraftContext(await options.repository.getCurrent(parsed.data.binding.listingWorkflowId, actor.ownerUserId), actor, parsed.data.binding, false);
      return { binding: projectVideoBinding(draft), videoBindings: structuredClone(draft.media.videoBindings || []) };
    },
    async save(actor: SourceListingVideoActor, raw: unknown) {
      const parsed = videoSaveRequestSchema.safeParse(raw); if (!parsed.success) videoFail('video_invalid_request', 400, '视频保存参数无效');
      const input = parsed.data; authorize(actor, input.binding.shopId, true);
      const hash = createHash('sha256').update(canonicalStringify({ input, ownerUserId: actor.ownerUserId, actorUserId: actor.actorUserId, deviceSessionId: actor.sessionId })).digest('hex');
      const flightKey = `${actor.ownerUserId}:${input.binding.listingWorkflowId}:${input.operationKey}`;
      const running = flights.get(flightKey); if (running) { if (running.hash !== hash) videoFail('video_idempotency_conflict', 409, '视频操作键已用于另一项保存'); return running.result; }
      const work = (async () => {
        await options.assertActiveBinding(actor, input.binding, true);
        const current = await options.repository.getCurrent(input.binding.listingWorkflowId, actor.ownerUserId);
        if (!current || current.ownerUserId !== actor.ownerUserId) videoFail('video_context_not_found', 404, '店铺草稿不存在');
        const receipt = videoReceipt(current, input.operationKey, hash);
        if (receipt) {
          const previous = await options.repository.getVersion({ draftId: current.id, ownerUserId: actor.ownerUserId, draftVersion: receipt.draftVersion });
          if (!previous) videoFail('video_context_stale', 409, '视频保存回执不可用');
          return result(previous, true);
        }
        const draft = assertVideoDraftContext(current, actor, input.binding, true);
        if (input.skuKey !== null && !sourceListingEditorSkuKeysForDraft(draft).includes(input.skuKey)) videoFail('video_sku_invalid', 422, '视频必须绑定到当前草稿 SKU');
        const selected = ([['MAIN', input.mainUrl], ['RICH_CONTENT', input.richContentUrl]] as const).flatMap(([role, url]) => url ? [{ role, url }] : []);
        if (selected.length) buildSelectedVideoAttributes(draft, await options.loadSchema({ ownerUserId: actor.ownerUserId, draft }), selected);
        const now = (options.now?.() || new Date()).toISOString();
        const videos: OzonListingDraftVideoBinding[] = selected.map(item => ({ ...item, skuKey: input.skuKey, sourceMediaKey: null,
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, sourceCaptureHash: draft.sourceCaptureHash, approvedByUserId: actor.actorUserId, approvedAt: now }));
        const next = structuredClone(draft); next.revision += 1; next.draftVersion += 1; next.updatedAt = now;
        next.media.videoBindings = [...(draft.media.videoBindings || []).filter(item => item.skuKey !== input.skuKey), ...videos];
        next.validation.status = 'STALE'; next.freshness.validation = { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' };
        // Video selection does not revalidate image assignments invalidated by a source/category change.
        next.grantRevocation = { required: true, reason: 'MEDIA_ASSIGNMENT_CHANGED', previousShopId: null };
        next.auditEvents.push({ id: `video-${randomUUID()}`, type: 'VIDEO_BINDING_CHANGED', actorUserId: actor.actorUserId,
          draftVersion: next.draftVersion, occurredAt: now, details: { operationKey: input.operationKey, requestHash: hash,
            deviceSessionId: actor.sessionId, sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, sourceCaptureHash: draft.sourceCaptureHash,
            skuKey: input.skuKey, videoBindings: videos, erpGenerationChargeMinor: 0 } });
        const committed = await options.commit({ actor, binding: input.binding, input, requestHash: hash, next });
        return result(committed.draft, committed.replayed);
      })();
      flights.set(flightKey, { hash, result: work });
      try { return await work; } finally { if (flights.get(flightKey)?.result === work) flights.delete(flightKey); }
    },
  };
}
export type SourceListingVideoService = ReturnType<typeof createSourceListingVideoService>;
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';
