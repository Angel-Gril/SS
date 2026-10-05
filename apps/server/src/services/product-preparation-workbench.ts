import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { verifySourceProductCaptureV2Submission, type OzonListingDraft, type OzonNormalizedAttributeSchema, type OzonListingDraftAttributeValue } from 'shared';
import { normalizeAiUsageDate, reserveAiDailyLimit, recordAiUsageEvent } from './ai-usage.js';
import type { ExtensionListingEditorIdentity, ExtensionListingEditorBinding } from './extension-listing-editor.js';
import type { ProductVisionWorkbenchOptions } from './product-vision-workbench.js';
import { readProductVisionImage } from './product-vision-workbench.js';
import type { ProductPreparationOperationStore } from './product-preparation-operation-store.js';
import type { SourceListingWorkflowService } from './source-listing-workflow.js';
import { capturedSourceSkuAliases } from './source-listing-sku-identity.js';
import { sourceListingEditorSkuKeysForDraft, sourceListingOfferRowsForDraft } from './source-listing-sku-copies.js';
import { publicSourceMediaKey } from './source-media-public-key.js';
import { buildOzonAttributeSuggestionProvenance } from './ozon-attribute-suggestion-provenance.js';
import { composeSkuAttributeValue } from './source-listing-workflow-attributes.js';
import { PRODUCT_PREPARATION_PROMPT_CONTRACT, PRODUCT_PREPARATION_PROMPT, preparationIdSchema as id,
  preparationReportSchema, normalizeProductPreparationReport, preparationAttributeEligible,
  type ProductPreparationDictionaries } from './product-preparation-report.js';

export const productPreparationBindingSchema = z.object({ snapshotId: id, supplyGoodsId: id, shopId: id, listingWorkflowId: id,
  draftRevision: z.number().int().positive(), draftVersion: z.number().int().positive() }).strict();
const categoryRevisionSchema = z.object({ catalogRevision: id, schemaRevision: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const providerContextSchema = z.object({ providerOrigin: z.string().url().max(200), model: z.string().min(1).max(200), policyRevision: z.number().int().nonnegative() }).strict();
export const productPreparationContextInputSchema = z.object({ binding: productPreparationBindingSchema, skuKey: id,
  sourceMediaKeys: z.array(id).min(1).max(5).refine(keys => new Set(keys).size === keys.length), categoryRevision: categoryRevisionSchema }).strict();
export const productPreparationImageInputSchema = productPreparationContextInputSchema.extend({
  sourceMediaKeys: z.array(id).length(1), providerContext: providerContextSchema,
}).strict();
export const productPreparationAnalyzeInputSchema = productPreparationContextInputSchema.extend({
  operationKey: z.string().min(8).max(128).refine(value => value === value.trim() && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)),
  executionMode: z.enum(['ERP_HOSTED', 'BYOK']).default('ERP_HOSTED'), providerContext: providerContextSchema.optional(),
}).strict().refine(value => value.executionMode === 'BYOK' ? !!value.providerContext : !value.providerContext);
export const productPreparationApplyInputSchema = z.object({ binding: productPreparationBindingSchema,
  analysisInput: productPreparationAnalyzeInputSchema, action: z.literal('ATTRIBUTES'),
  operationKey: z.string().min(8).max(128), selectedAttributeIds: z.array(z.number().int().positive()).min(1).max(40)
    .refine(values => new Set(values).size === values.length) }).strict();
export const productPreparationByokCandidatesInputSchema = z.object({ analysisInput: productPreparationAnalyzeInputSchema, report: preparationReportSchema }).strict();
export type ProductPreparationAnalyzeInput = z.input<typeof productPreparationAnalyzeInputSchema>;
type ParsedInput = z.infer<typeof productPreparationAnalyzeInputSchema>;
export type ProductPreparationIdentity = ExtensionListingEditorIdentity & { deviceSessionId?: string };
export interface ProductPreparationWorkbenchOptions extends Omit<ProductVisionWorkbenchOptions, 'workflow' | 'operationStore'> {
  workflow: Pick<SourceListingWorkflowService, 'getDraft' | 'setSuggestedAttributeChanges'>;
  operationStore: ProductPreparationOperationStore;
  loadAttributeContext(input: { ownerUserId: string; draft: OzonListingDraft }): Promise<{
    schema: OzonNormalizedAttributeSchema; schemaRevision: string; dictionaries: ProductPreparationDictionaries;
  }>;
  validateByokReadiness?(input: { identity: ProductPreparationIdentity; binding: ExtensionListingEditorBinding;
    providerContext: z.infer<typeof providerContextSchema> }): Promise<{ available: boolean }>;
}
export class ProductPreparationWorkbenchError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string,
    public readonly outcome: 'NOT_SENT' | 'UNKNOWN_OUTCOME' = 'NOT_SENT') { super(message); this.name = 'ProductPreparationWorkbenchError'; }
}
const fail = (code: string, status: number, message: string): never => { throw new ProductPreparationWorkbenchError(code, status, message); };
const unknown = (pending = false) => new ProductPreparationWorkbenchError(pending ? 'product_preparation_receipt_pending' : 'product_preparation_unknown_outcome', 409,
  '本次分析结果尚未核对，请保留原步骤并只读恢复，不能重复生成。', 'UNKNOWN_OUTCOME');
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const providerHash = (config: NonNullable<Awaited<ReturnType<ProductVisionWorkbenchOptions['evaluateCapability']>>['config']>) =>
  digest([config.provider, config.baseUrl, config.model, config.apiKey, config.timeoutMs]);
const categorySchema = z.object({ categoryId: z.number().int().positive(), typeId: z.number().int().positive(),
  catalogRevision: id, schemaRevision: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const resultSchema = z.object({ binding: productPreparationBindingSchema, skuKey: id, sourceMediaKeys: z.array(id).min(1).max(5),
  operationKey: id, category: categorySchema, report: preparationReportSchema, replayed: z.boolean() }).strict();
export type ProductPreparationAnalysisData = z.infer<typeof resultSchema>;
const cleanSource = (value: unknown, limit: number) => Array.from(String(value || '').normalize('NFKC')).map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
  .replace(/(?:https?|file|data|blob):\S+/giu, '').replace(/\b(?:api[_ -]?key|authorization|bearer)\b\s*[:=]?\s*\S+/giu, '').slice(0, limit);

export function createProductPreparationWorkbenchService(options: ProductPreparationWorkbenchOptions) {
  const pending = new Map<string, Promise<unknown>>();
  async function owned(identity: ProductPreparationIdentity, raw: ExtensionListingEditorBinding) {
    const binding = productPreparationBindingSchema.parse(raw);
    if (identity.actorUserId !== identity.ownerUserId || !identity.allowedShopIds.includes(binding.shopId)) fail('product_preparation_shop_denied', 403, '设备没有访问该店铺的权限。');
    const draft = await options.workflow.getDraft({ ownerUserId: identity.ownerUserId, draftId: binding.listingWorkflowId });
    if (draft.shopId !== binding.shopId || draft.sourceCaptureSnapshotId !== binding.snapshotId || draft.supplyGoodsId !== binding.supplyGoodsId) {
      fail('product_preparation_context_stale', 409, '来源快照或店铺草稿已变化。');
    }
    await options.ownership.assertOwnedTarget({ ownerUserId: identity.ownerUserId, shopId: draft.shopId, supplyGoodsId: draft.supplyGoodsId,
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, currentSourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, selectedSkuKeys: draft.selectedSkuKeys });
    return draft;
  }
  function current(draft: OzonListingDraft, binding: ExtensionListingEditorBinding) {
    if (draft.revision !== binding.draftRevision || draft.draftVersion !== binding.draftVersion) fail('product_preparation_context_stale', 409, '草稿版本已变化，请重新读取。');
    if (draft.stage === 'PUBLISHED' || ['CANCELLED', 'PERMANENT_FAILURE'].includes(draft.runState)) fail('product_preparation_workflow_terminal', 409, '该草稿已经结束。');
  }
  async function selected(identity: ProductPreparationIdentity, input: z.infer<typeof productPreparationContextInputSchema>, draft: OzonListingDraft) {
    const snapshot = await options.loadOwnedSnapshot({ ownerUserId: identity.ownerUserId, snapshotId: input.binding.snapshotId });
    if (!snapshot || snapshot.id !== draft.sourceCaptureSnapshotId || snapshot.captureHash !== draft.sourceCaptureHash
      || !(await verifySourceProductCaptureV2Submission({ capture: snapshot.payload, captureHash: snapshot.captureHash, payloadBytes: snapshot.payloadBytes })).valid) {
      fail('product_preparation_snapshot_invalid', 409, '来源快照完整性校验失败，请重新采集。');
    }
    const sourceSkuKey = sourceListingOfferRowsForDraft(draft).find(row => row.rowKey === input.skuKey)?.sourceSkuKey || input.skuKey;
    const aliases = capturedSourceSkuAliases(snapshot!.payload), canonical = aliases.get(sourceSkuKey);
    if (!canonical || !sourceListingEditorSkuKeysForDraft(draft).includes(input.skuKey)
      && !draft.selectedSkuKeys.some(key => aliases.get(key) === canonical)) fail('product_preparation_sku_denied', 403, 'SKU 不属于当前草稿。');
    const sku = snapshot!.payload.skus.find(row => row.key === canonical)!;
    const media = input.sourceMediaKeys.map(key => {
      const matches = snapshot!.payload.media.filter(item => publicSourceMediaKey(item.key) === key);
      const image = matches.length === 1 ? matches[0] : undefined;
      if (!image || image.kind !== 'image' || image.disposition !== 'accepted' || !image.url
        || image.role === 'sku' && !image.skuKeys.length
        || image.skuKeys.length && !image.skuKeys.some(key => aliases.get(key) === canonical)) fail('product_preparation_media_invalid', 422, '请选择当前 SKU 或共有的有效来源图片。');
      return image!;
    });
    return { snapshot: snapshot!, sku, media };
  }
  async function attributeContext(identity: ProductPreparationIdentity, input: z.infer<typeof productPreparationContextInputSchema>, draft: OzonListingDraft) {
    if (!draft.category || draft.category.catalogRevision !== input.categoryRevision.catalogRevision) fail('product_preparation_category_stale', 409, '请先确认当前官方类目。');
    const context = await options.loadAttributeContext({ ownerUserId: identity.ownerUserId, draft });
    if (context.schemaRevision !== input.categoryRevision.schemaRevision || context.schema.shopId !== draft.shopId
      || context.schema.descriptionCategoryId !== draft.category!.categoryId || context.schema.typeId !== draft.category!.typeId
      || context.schema.catalogRevision !== draft.category!.catalogRevision) fail('product_preparation_category_stale', 409, '官方类目或属性版本已变化。');
    const eligible = context.schema.fields.filter(preparationAttributeEligible).slice(0, 40);
    const dictionaries = Object.fromEntries(eligible.map(field => [String(field.attributeId), (context.dictionaries[String(field.attributeId)] || []).slice(0, 100)
      .filter(item => Number.isSafeInteger(item.id) && item.id > 0 && typeof item.value === 'string' && item.value.length <= 300)]));
    return { schema: { ...context.schema, fields: eligible }, schemaRevision: context.schemaRevision, dictionaries };
  }
  function operation(identity: ProductPreparationIdentity, input: ParsedInput, captureHash: string) {
    return { ownerUserId: identity.ownerUserId, draftId: input.binding.listingWorkflowId, operationKey: input.operationKey,
      clientRequestHash: digest([PRODUCT_PREPARATION_PROMPT_CONTRACT, input.binding, captureHash, input.skuKey, input.sourceMediaKeys, input.categoryRevision, input.executionMode, input.providerContext || null]) };
  }
  async function readReceipt(identity: ProductPreparationIdentity, input: ParsedInput, captureHash: string): Promise<ProductPreparationAnalysisData> {
    const op = operation(identity, input, captureHash);
    try {
      const receipt = await options.operationStore.findReceipt(op);
      if (!receipt || receipt.clientRequestHash !== op.clientRequestHash || receipt.promptContract !== PRODUCT_PREPARATION_PROMPT_CONTRACT
        || (input.executionMode === 'BYOK') !== (receipt.provider === 'BYOK')) throw unknown(true);
      const result = resultSchema.parse(receipt.result);
      if (JSON.stringify(result.binding) !== JSON.stringify(input.binding) || result.skuKey !== input.skuKey || result.operationKey !== input.operationKey
        || JSON.stringify(result.sourceMediaKeys) !== JSON.stringify(input.sourceMediaKeys)
        || result.category.catalogRevision !== input.categoryRevision.catalogRevision || result.category.schemaRevision !== input.categoryRevision.schemaRevision
        || JSON.stringify(result.report.curation.map(item => item.sourceMediaKey)) !== JSON.stringify(input.sourceMediaKeys)
        || result.report.skuObservations[0]!.skuKey !== input.skuKey
        || result.report.suggestedAttributes.some(candidate => candidate.evidence.sourceMediaKeys.some(key => !input.sourceMediaKeys.includes(key)))) throw unknown();
      return { ...result, replayed: true };
    } catch (error) { throw error instanceof ProductPreparationWorkbenchError ? error : unknown(); }
  }
  async function context(identity: ProductPreparationIdentity, raw: z.infer<typeof productPreparationContextInputSchema>) {
    const input = productPreparationContextInputSchema.parse(raw), draft = await owned(identity, input.binding); current(draft, input.binding);
    const source = await selected(identity, input, draft), attributes = await attributeContext(identity, input, draft);
    const promptContext = { product: { title: cleanSource(source.snapshot.payload.facts.title, 500), description: cleanSource(source.snapshot.payload.facts.description, 2000) },
      sku: { skuKey: input.skuKey, options: [{ name: '规格', value: cleanSource(source.sku.specText, 500) }] },
      category: { categoryId: draft.category!.categoryId, typeId: draft.category!.typeId, catalogRevision: draft.category!.catalogRevision,
        schemaRevision: attributes.schemaRevision, categoryName: cleanSource(draft.category!.categoryName, 300), typeName: cleanSource(draft.category!.typeName, 300) },
      fields: attributes.schema.fields.map(field => ({ attributeId: field.attributeId, name: cleanSource(field.name, 200), description: cleanSource(field.description, 300),
        valueType: field.valueType, cardinality: field.cardinality, valuePolicy: field.valuePolicy, ownership: field.ownership,
        editorMode: field.editorMode, aiSuggestionAllowed: true })),
      dictionaries: structuredClone(attributes.dictionaries), sourceMediaKeys: input.sourceMediaKeys };
    // Reuse the existing 16 KiB safe multimodal transport contract, reserving space for instructions.
    const budget = 12 * 1024;
    while (Buffer.byteLength(JSON.stringify(promptContext), 'utf8') > budget) {
      const largest = Object.values(promptContext.dictionaries).sort((left, right) => right.length - left.length)[0];
      if (largest?.length) { largest.pop(); continue; }
      if (promptContext.fields.length) {
        const removed = promptContext.fields.pop()!; delete promptContext.dictionaries[String(removed.attributeId)]; continue;
      }
      fail('product_preparation_context_budget', 422, '商品输入超过分析预算，请缩小选择。');
    }
    return { input, draft, source, attributes, promptContext };
  }
  async function analyze(identity: ProductPreparationIdentity, raw: ProductPreparationAnalyzeInput): Promise<ProductPreparationAnalysisData> {
    const input = productPreparationAnalyzeInputSchema.parse(raw), draft = await owned(identity, input.binding);
    const source = await selected(identity, input, draft), op = operation(identity, input, source.snapshot.captureHash);
    if (input.executionMode !== 'ERP_HOSTED') fail('product_preparation_mode_invalid', 400, '自带 API 分析必须由扩展 Worker 执行。');
    const claim = await options.operationStore.claim(op);
    if (claim.kind === 'conflict') fail('product_preparation_operation_conflict', 409, '原操作编号已用于不同的分析输入。');
    if (claim.kind !== 'claimed') return readReceipt(identity, input, source.snapshot.captureHash);
    const date = normalizeAiUsageDate(options.now?.() || new Date()); let reserved = false, sent = false;
    try {
      current(draft, input.binding);
      const prepared = await context(identity, { binding: input.binding, skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys, categoryRevision: input.categoryRevision });
      const capability = await options.evaluateCapability(identity.ownerUserId);
      if (!capability.available || !capability.config || capability.config.provider !== 'custom' || !capability.config.model) fail('product_preparation_disabled', 503, '当前账号尚未启用托管商品分析。');
      if (!options.usageStore.reserveDailyLimit || !options.usageStore.releaseDailyReservation) fail('product_preparation_quota_unavailable', 503, '分析额度服务暂不可用。');
      const quota = await reserveAiDailyLimit({ store: options.usageStore, namespace: 'product-vision', actorUserId: identity.actorUserId, date, limit: capability.dailyLimit });
      if (!quota.allowed) fail('product_preparation_quota_exceeded', 429, '今日视觉分析额度已用完。'); reserved = true;
      const images: Array<{ mimeType: 'image/jpeg'; buffer: Buffer }> = [];
      for (const image of prepared.source.media) {
        const bytes = await (options.readImage || readProductVisionImage)(image.url!);
        if (bytes.mimeType !== 'image/jpeg' || !Buffer.isBuffer(bytes.buffer) || !bytes.buffer.length || bytes.buffer.length > 1024 * 1024) fail('product_preparation_image_invalid', 422, '来源图片超过分析限制。');
        images.push(bytes);
      }
      const beforeSend = await owned(identity, input.binding); current(beforeSend, input.binding);
      const newAttributes = await attributeContext(identity, input, beforeSend);
      const newCapability = await options.evaluateCapability(identity.ownerUserId);
      if (!newCapability.available || !newCapability.config || providerHash(newCapability.config) !== providerHash(capability.config!)
        || digest(newAttributes) !== digest(prepared.attributes)) fail('product_preparation_capability_changed', 409, '分析服务或属性字典已变化，本次请求未提交。');
      sent = true;
      let generated: Awaited<ReturnType<ProductVisionWorkbenchOptions['analyzeTransport']>>;
      try { generated = await options.analyzeTransport({ config: capability.config!, prompt: `${PRODUCT_PREPARATION_PROMPT}\nUNTRUSTED_CAPTURE_CONTEXT_JSON:\n${JSON.stringify(prepared.promptContext)}`, images }); }
      catch (error) { if ((error as { outcome?: unknown })?.outcome === 'NOT_SENT') sent = false; throw error; }
      if (typeof generated.text !== 'string' || Buffer.byteLength(generated.text, 'utf8') > 32 * 1024
        || capability.config!.apiKey && generated.text.includes(capability.config!.apiKey)) throw unknown();
      const report = normalizeProductPreparationReport(JSON.parse(generated.text), { skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys, ...prepared.attributes });
      const result = resultSchema.parse({ binding: input.binding, skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys, operationKey: input.operationKey,
        category: { categoryId: draft.category!.categoryId, typeId: draft.category!.typeId, ...input.categoryRevision }, report, replayed: false });
      await recordAiUsageEvent(options.usageStore, { namespace: 'product-vision', actorUserId: identity.actorUserId, date, provider: capability.config!.provider,
        model: capability.config!.model, kind: 'request', reserved: true, usage: generated.usage });
      await options.operationStore.saveReceipt(op, { clientRequestHash: op.clientRequestHash, promptContract: PRODUCT_PREPARATION_PROMPT_CONTRACT, result,
        provider: capability.config!.provider, model: capability.config!.model, providerConfigHash: providerHash(capability.config!), usage: generated.usage });
      await options.operationStore.complete(claim.executionId); return result;
    } catch (error) {
      if (sent) { await options.operationStore.markUnknown(claim.executionId).catch(() => {}); throw unknown(); }
      if (reserved) await options.usageStore.releaseDailyReservation!({ namespace: 'product-vision', actorUserId: identity.actorUserId, date });
      await options.operationStore.release(claim.executionId);
      if (error instanceof ProductPreparationWorkbenchError) throw error;
      throw new ProductPreparationWorkbenchError('product_preparation_unavailable', 503, '商品分析尚未提交，请检查来源或服务配置。');
    }
  }
  return {
    async capability(identity: ProductPreparationIdentity, binding: ExtensionListingEditorBinding) {
      const draft = await owned(identity, binding); current(draft, binding); const capability = await options.evaluateCapability(identity.ownerUserId);
      return { available: capability.available, reasonCode: capability.reasonCode,
        providerFeeNotice: '商品分析会调用托管视觉模型，可能产生 Provider 费用；图片筛选、属性和俄文文案均为待确认候选，不自动审核或发布。' };
    },
    async context(identity: ProductPreparationIdentity, input: z.infer<typeof productPreparationContextInputSchema>) {
      const value = await context(identity, input); return { binding: value.input.binding, skuKey: value.input.skuKey, sourceMediaKeys: value.input.sourceMediaKeys, promptContext: value.promptContext };
    },
    async image(identity: ProductPreparationIdentity, raw: z.input<typeof productPreparationImageInputSchema>) {
      const input = productPreparationImageInputSchema.parse(raw);
      if (!identity.deviceSessionId || !options.validateByokReadiness) fail('product_preparation_byok_disabled', 403, '自带 API 商品分析尚未获得授权。');
      const draft = await owned(identity, input.binding); current(draft, input.binding);
      const source = await selected(identity, input, draft); await attributeContext(identity, input, draft);
      if (!(await options.validateByokReadiness!({ identity, binding: input.binding, providerContext: input.providerContext })).available) fail('product_preparation_byok_disabled', 403, '自带 API 商品分析授权已变化。');
      const bytes = await (options.readImage || readProductVisionImage)(source.media[0]!.url!);
      if (bytes.mimeType !== 'image/jpeg' || !Buffer.isBuffer(bytes.buffer) || !bytes.buffer.length || bytes.buffer.length > 1024 * 1024) fail('product_preparation_image_invalid', 422, '来源图片超过分析限制。');
      const metadata = await sharp(bytes.buffer, { limitInputPixels: 1_048_576, failOn: 'error' }).metadata();
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height || metadata.width > 1024 || metadata.height > 1024 || (metadata.pages || 1) !== 1 || metadata.exif || metadata.icc) {
        fail('product_preparation_image_invalid', 422, '来源图片不符合规范化分析格式。');
      }
      const latest = await owned(identity, input.binding); current(latest, input.binding); await attributeContext(identity, input, latest);
      if (!(await options.validateByokReadiness!({ identity, binding: input.binding, providerContext: input.providerContext })).available) fail('product_preparation_byok_disabled', 403, '自带 API 商品分析授权已变化。');
      return { mimeType: 'image/jpeg' as const, buffer: bytes.buffer, sha256: createHash('sha256').update(bytes.buffer).digest('hex'), width: metadata.width, height: metadata.height };
    },
    async analyze(identity: ProductPreparationIdentity, input: ProductPreparationAnalyzeInput) {
      const key = JSON.stringify([identity.ownerUserId, input.binding.listingWorkflowId, input.operationKey]);
      const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(() => analyze(identity, input)); pending.set(key, next);
      try { return await next; } finally { if (pending.get(key) === next) pending.delete(key); }
    },
    async read(identity: ProductPreparationIdentity, raw: ProductPreparationAnalyzeInput) {
      const input = productPreparationAnalyzeInputSchema.parse(raw), draft = await owned(identity, input.binding);
      const source = await selected(identity, input, draft); return readReceipt(identity, input, source.snapshot.captureHash);
    },
    async byokCandidates(identity: ProductPreparationIdentity, raw: { analysisInput: ProductPreparationAnalyzeInput; report: unknown }) {
      const { analysisInput: input, report: rawReport } = productPreparationByokCandidatesInputSchema.parse(raw);
      if (input.executionMode !== 'BYOK' || !input.providerContext || !identity.deviceSessionId || !options.validateByokReadiness) fail('product_preparation_byok_disabled', 403, '自带 API 商品分析尚未获得授权。');
      const draft = await owned(identity, input.binding), source = await selected(identity, input, draft), op = operation(identity, input, source.snapshot.captureHash);
      const prior = await options.operationStore.findReceipt(op);
      if (prior) { const result = await readReceipt(identity, input, source.snapshot.captureHash);
        for (const candidate of rawReport.suggestedAttributes) if (candidate.dictionaryValueId === undefined) {
          const original = result.report.suggestedAttributes.find(item => item.attributeId === candidate.attributeId);
          if (original?.dictionaryValueId !== undefined) candidate.dictionaryValueId = original.dictionaryValueId;
        }
        if (digest(result.report) !== digest(preparationReportSchema.parse(rawReport))) fail('product_preparation_operation_conflict', 409, '原操作已经保存不同的分析候选。'); return result; }
      current(draft, input.binding);
      if (!(await options.validateByokReadiness!({ identity, binding: input.binding, providerContext: input.providerContext! })).available) fail('product_preparation_byok_disabled', 403, '自带 API 商品分析授权已变化。');
      const attributes = await attributeContext(identity, input, draft);
      const report = normalizeProductPreparationReport(rawReport, { skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys, ...attributes });
      current(await owned(identity, input.binding), input.binding);
      const claim = await options.operationStore.claim(op);
      if (claim.kind === 'conflict') fail('product_preparation_operation_conflict', 409, '原操作编号已用于不同的分析输入。');
      if (claim.kind !== 'claimed') return readReceipt(identity, input, source.snapshot.captureHash);
      try {
        const result = resultSchema.parse({ binding: input.binding, skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys,
          operationKey: input.operationKey, category: { categoryId: draft.category!.categoryId, typeId: draft.category!.typeId, ...input.categoryRevision }, report, replayed: false });
        await options.operationStore.saveReceipt(op, { clientRequestHash: op.clientRequestHash, promptContract: PRODUCT_PREPARATION_PROMPT_CONTRACT,
          result, provider: 'BYOK', model: input.providerContext!.model, providerConfigHash: digest(input.providerContext), usage: null });
        await options.operationStore.complete(claim.executionId); return result;
      } catch { await options.operationStore.markUnknown(claim.executionId).catch(() => {}); throw unknown(); }
    },
    async apply(identity: ProductPreparationIdentity, raw: z.input<typeof productPreparationApplyInputSchema>) {
      const input = productPreparationApplyInputSchema.parse(raw), draft = await owned(identity, input.binding);
      for (const key of ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'] as const) if (input.binding[key] !== input.analysisInput.binding[key]) fail('product_preparation_context_stale', 409, '分析候选不属于当前草稿。');
      const originalSource = await selected(identity, input.analysisInput, draft);
      const receipt = await readReceipt(identity, input.analysisInput, originalSource.snapshot.captureHash);
      const candidates = input.selectedAttributeIds.map(attributeId => {
        const candidate = receipt.report.suggestedAttributes.find(item => item.attributeId === attributeId);
        if (!candidate) fail('product_preparation_candidate_invalid', 422, '分析中不存在该属性候选。');
        const candidateHash = digest([PRODUCT_PREPARATION_PROMPT_CONTRACT, input.analysisInput, candidate]);
        return { attributeId, candidateId: `preparation:${candidateHash}`, candidateHash, schemaRevision: input.analysisInput.categoryRevision.schemaRevision };
      });
      const result = await options.workflow.setSuggestedAttributeChanges({ draftId: draft.id, ownerUserId: identity.ownerUserId, actorUserId: identity.actorUserId,
        expectedRevision: input.binding.draftRevision, expectedDraftVersion: input.binding.draftVersion, operationKey: input.operationKey,
        schemaRevision: input.analysisInput.categoryRevision.schemaRevision, candidates }, async currentDraft => {
          await selected(identity, input.analysisInput, currentDraft);
          const attributes = await attributeContext(identity, input.analysisInput, currentDraft);
          const report = normalizeProductPreparationReport(receipt.report, { skuKey: input.analysisInput.skuKey, sourceMediaKeys: input.analysisInput.sourceMediaKeys, ...attributes });
          const values = structuredClone(currentDraft.attributes.values);
          for (const reference of candidates) {
            const candidate = report.suggestedAttributes.find(item => item.attributeId === reference.attributeId)!;
            const officialField = attributes.schema.fields.find(item => item.attributeId === candidate.attributeId)!;
            const skuScoped = officialField.ownership === 'SKU';
            const selectedKeys = sourceListingEditorSkuKeysForDraft(currentDraft);
            if (!skuScoped && selectedKeys.length > 1) fail('product_preparation_attribute_scope', 409, '单 SKU 视觉观察不能应用到多个规格共用的商品属性，请使用逐 SKU 属性或手工确认。');
            const priorRoot = values[String(candidate.attributeId)];
            const prior = skuScoped ? priorRoot?.skuValues?.[input.analysisInput.skuKey] : priorRoot;
            if (prior && (['SOURCE', 'SYSTEM'].includes(prior.source) || prior.source === 'MANUAL' && prior.reviewed)
              && prior.value !== undefined && prior.value !== null && prior.value !== '') {
              if (digest(prior.value) !== digest(candidate.value)) fail('product_preparation_source_priority', 409, '已有来源或人工确认属性优先，请保留原事实；如需更改请使用明确的手工编辑。');
              continue;
            }
            const evidenceDetails = candidate.evidence.sourceMediaKeys.map(key => ({ id: `preparation:${digest([reference.candidateHash, key])}`, attributeId: candidate.attributeId,
              source: 'VISUAL' as const, path: `/media/${key}`, value: candidate.evidence.observation, confidence: 0.5, isEstimated: false }));
            const dictionary = attributes.dictionaries[String(candidate.attributeId)] || [];
            const dictionaryMatches = (Array.isArray(candidate.value) ? candidate.value : [candidate.value]).flatMap(value => {
              const item = dictionary.find(entry => entry.value === value); return item ? [{ inputValue: value, dictionaryValueId: item.id, canonicalValue: item.value }] : [];
            });
            const leaf: OzonListingDraftAttributeValue = { value: candidate.value, source: 'AI', reviewed: true, manualReview: 'CONFIRMED',
              confidence: 0.5, evidence: evidenceDetails.map(item => item.id), dictionaryMatches,
              dictionaryMatch: { status: dictionaryMatches.length ? 'MATCHED' : 'NOT_APPLICABLE', dictionaryValueId: dictionaryMatches.length === 1 ? dictionaryMatches[0]!.dictionaryValueId : null },
              suggestionProvenance: buildOzonAttributeSuggestionProvenance({ ...reference,
                sourceCaptureSnapshotId: originalSource.snapshot.id, sourceCaptureHash: originalSource.snapshot.captureHash,
                draftVersion: input.analysisInput.binding.draftVersion, draftRevision: input.analysisInput.binding.draftRevision, evidenceDetails }) };
            values[String(candidate.attributeId)] = skuScoped
              ? composeSkuAttributeValue(priorRoot || leaf, { ...(priorRoot?.skuValues || {}), [input.analysisInput.skuKey]: leaf }, selectedKeys)
              : leaf;
          }
          return values;
        });
      return { binding: { ...input.binding, draftRevision: result.revision, draftVersion: result.draftVersion }, selectedAttributeIds: input.selectedAttributeIds,
        replayed: result.auditEvents.some(event => event.details?.editorOperationKey === input.operationKey) && result.revision === draft.revision };
    },
  };
}
export type ProductPreparationWorkbenchService = ReturnType<typeof createProductPreparationWorkbenchService>;
