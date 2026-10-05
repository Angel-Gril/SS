import { createHash } from 'node:crypto';
import type { OzonListingDraft, OzonListingDraftVideoBinding, OzonNormalizedAttributeSchema } from 'shared';
import { buildOzonVideoMediaAttributesFromSourceVideos, isOzonRichContentAttributeId,
  OZON_RICH_CONTENT_ATTR_IDS, type OzonVideoMediaAttribute } from './ozon-rich-content.js';

export class SourceListingVideoError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); this.name = 'SourceListingVideoError'; }
}
export function videoFail(code: string, status: number, message: string): never { throw new SourceListingVideoError(code, status, message); }

/** A persisted manual selection must be an exact official asset, never a download/upload instruction. */
export function normalizeOfficialOzonVideoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 4096 || value !== value.normalize('NFKC').trim()
    || /[\s%\\]/u.test(value) || Array.from(value).some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(value);
    if (url.href !== value || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return null;
    if (/^(?:cdnvideo\.v\.ozone\.ru|v-\d+\.ozone\.ru)$/u.test(url.hostname)
      && /^\/vod\/video-\d+\/[A-Z0-9]+\/[A-Za-z0-9_-]+\.mp4$/u.test(url.pathname)) return value;
    if (/^cdn\d*\.ozone\.ru$/u.test(url.hostname)
      && /^\/s3\/sc-temporary\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.mp4$/u.test(url.pathname)
      && !url.pathname.split('/').some(segment => segment === '.' || segment === '..')) return value;
  } catch { /* Invalid input does not perform network IO. */ }
  return null;
}

export function videoSchemaRevision(schema: OzonNormalizedAttributeSchema) {
  return createHash('sha256').update(JSON.stringify({ schemaVersion: schema.schemaVersion, shopId: schema.shopId,
    descriptionCategoryId: schema.descriptionCategoryId, typeId: schema.typeId, language: schema.language,
    catalogRevision: schema.catalogRevision, definitionsHash: schema.definitionsHash })).digest('hex');
}
export function assertVideoSchema(draft: OzonListingDraft, schema: OzonNormalizedAttributeSchema | undefined) {
  if (!schema || !draft.category || schema.schemaVersion !== 'ozon-attribute-schema/v1' || schema.shopId !== draft.shopId
    || schema.descriptionCategoryId !== draft.category.categoryId || schema.typeId !== draft.category.typeId
    || schema.language !== 'DEFAULT' || schema.catalogRevision !== draft.category.catalogRevision
    || !/^[a-f0-9]{64}$/u.test(schema.definitionsHash) || schema.definitionSource === 'stale-cache'
    || schema.definitionWarning || !Array.isArray(schema.fields)) {
    videoFail('video_schema_stale', 409, '视频需要当前店铺类目的官方属性，请刷新类目后重试');
  }
  return schema;
}
function supports(schema: OzonNormalizedAttributeSchema, id: number) {
  const matches = schema.fields.filter(field => field.attributeId === id);
  return matches.length === 1 && matches[0]!.ownership === 'MEDIA' && matches[0]!.editorMode === 'MEDIA_WORKBENCH'
    && matches[0]!.valuePolicy === 'FREE_TEXT' && matches[0]!.dictionaryId === null;
}
export function buildSelectedVideoAttributes(draft: OzonListingDraft, schemaInput: OzonNormalizedAttributeSchema | undefined,
  selected: Array<Pick<OzonListingDraftVideoBinding, 'role' | 'url'>>) {
  if (!selected.length) return [];
  const schema = assertVideoSchema(draft, schemaInput);
  const attributes: OzonVideoMediaAttribute[] = [];
  for (const binding of selected) {
    if (!normalizeOfficialOzonVideoUrl(binding.url)) videoFail('video_upload_required', 422,
      '来源视频尚未上传到 Ozon。请先在 Ozon Seller 媒体页上传，再填写官方视频地址；当前不会自动上传来源视频');
    if (binding.role === 'MAIN') {
      const generated = buildOzonVideoMediaAttributesFromSourceVideos([{ url: binding.url }]);
      if (!generated.length || generated.some(attribute => !supports(schema, attribute.id))) {
        videoFail('video_schema_unsupported', 422, '当前 Ozon 类目不支持所选主图视频属性');
      }
      attributes.push(...generated);
    } else if (binding.role === 'RICH_CONTENT') {
      const field = OZON_RICH_CONTENT_ATTR_IDS.find(id => supports(schema, id));
      if (!field) videoFail('video_schema_unsupported', 422, '当前 Ozon 类目不支持富内容视频');
      attributes.push({ id: field, complex_id: 0, values: [{ value: JSON.stringify({ version: 0.3, content: [{
        widgetName: 'raVideo', type: 'embedded', width: 300, height: 168.5, sources: [{ type: 'video/mp4', src: binding.url }],
      }] }) }] });
    } else videoFail('video_binding_invalid', 422, '视频槽位无效');
  }
  return attributes;
}

export function appendBoundDraftVideoAttributes(draft: OzonListingDraft, skuKey: string, schema: OzonNormalizedAttributeSchema | undefined,
  existing: Array<{ id: number; complex_id?: number; values: Array<{ value: string; dictionary_value_id?: number }> }>, validationSchemaRevision: string) {
  const bindings = draft.media.videoBindings;
  if (bindings === undefined || Array.isArray(bindings) && !bindings.length) return existing;
  if (!Array.isArray(bindings) || bindings.length > (sourceListingEditorSkuKeysForDraft(draft).length + 1) * 2) videoFail('video_binding_invalid', 422, '草稿视频绑定无效');
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object') videoFail('video_binding_invalid', 422, '草稿视频绑定无效');
    const key = JSON.stringify([binding.skuKey, binding.role]);
    if (Object.keys(binding).sort().join(',') !== 'approvedAt,approvedByUserId,role,skuKey,sourceCaptureHash,sourceCaptureSnapshotId,sourceMediaKey,url'
      || binding.skuKey !== null && !sourceListingEditorSkuKeysForDraft(draft).includes(binding.skuKey) || seen.has(key)
      || binding.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId || binding.sourceCaptureHash !== draft.sourceCaptureHash
      || binding.approvedByUserId !== draft.ownerUserId || !Number.isFinite(Date.parse(binding.approvedAt))
      || binding.sourceMediaKey !== null || !['MAIN', 'RICH_CONTENT'].includes(binding.role)
      || !normalizeOfficialOzonVideoUrl(binding.url)) videoFail('video_binding_invalid', 422, '视频不属于当前已确认的草稿上下文');
    seen.add(key);
  }
  const currentSchema = assertVideoSchema(draft, schema);
  if (videoSchemaRevision(currentSchema) !== validationSchemaRevision) videoFail('video_schema_stale', 409, '视频属性与当前审核合同不一致，请重新验证');
  const selected = (['MAIN', 'RICH_CONTENT'] as const).flatMap(role => {
    const value = bindings.find(binding => binding.skuKey === skuKey && binding.role === role)
      || bindings.find(binding => binding.skuKey === null && binding.role === role);
    return value ? [value] : [];
  });
  const generated = buildSelectedVideoAttributes(draft, currentSchema, selected);
  if (generated.some(attribute => existing.some(value => value.id === attribute.id
    || isOzonRichContentAttributeId(attribute.id) && isOzonRichContentAttributeId(value.id)))) {
    videoFail('video_attribute_conflict', 422, '视频与现有媒体或富内容属性冲突，请移除重复属性后重试');
  }
  return [...existing, ...generated].sort((left, right) => left.id - right.id);
}
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';
