import type { OzonListingDraft, OzonListingDraftAttributeValue, OzonListingDraftCategory } from 'shared';
import type { SourceListingWorkflowService } from './source-listing-workflow.js';
import type { SourceListingWorkflowContextResolver } from './source-listing-workflow-context.js';
import type { OzonCategoryCatalogEntry } from './ozon-category-catalog.js';
import { createSourceListingWorkflowCategoryValidator } from './source-listing-workflow-category.js';
import { SourceListingWorkflowReadinessError, validateSourceListingPricing } from './source-listing-workflow-readiness.js';
import { normalizeSourceListingSkuPackagingItems, projectSourceListingSkuPackaging, SourceListingSkuPackagingError } from './source-listing-sku-packaging.js';
import type { SourceListingAttributeEditorService } from './source-listing-attribute-editor.js';
import { projectSourceListingCopyEditor, type SourceListingCopyEditorService } from './source-listing-copy-editor.js';

export interface ExtensionListingEditorBinding {
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}
export interface ExtensionListingEditorIdentity {
  ownerUserId: string;
  actorUserId: string;
  allowedShopIds: string[];
}
type CategoryEntry = Pick<OzonCategoryCatalogEntry,
  'descriptionCategoryId' | 'typeId' | 'categoryNameRu' | 'typeNameRu' | 'categoryNameZh' | 'typeNameZh' | 'selectable' | 'disabled'>;

export class ExtensionListingEditorError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ExtensionListingEditorError';
  }
}
function projection(draft: OzonListingDraft) {
  const fieldIssues: Array<{ field: 'PRICING' | 'PACKAGING'; message: string }> = [];
  let pricing: ReturnType<typeof validateSourceListingPricing> | null = null;
  let packaging: ReturnType<typeof projectSourceListingSkuPackaging> = null;
  try {
    pricing = draft.pricing.value ? validateSourceListingPricing(draft.pricing.value, draft.selectedSkuKeys) : null;
  } catch (error) {
    if (!(error instanceof SourceListingWorkflowReadinessError)) throw error;
    fieldIssues.push({ field: 'PRICING', message: '售价与当前 SKU 不一致，请重新保存价格与货号。' });
  }
  try { packaging = projectSourceListingSkuPackaging(draft); } catch (error) {
    if (!(error instanceof SourceListingSkuPackagingError)) throw error;
    fieldIssues.push({ field: 'PACKAGING', message: '包装与当前 SKU 不一致或未核实，请重新保存包装参数。' });
  }
  return {
    contractVersion: 'extension-listing-editor/v1' as const,
    binding: {
      snapshotId: draft.sourceCaptureSnapshotId, supplyGoodsId: draft.supplyGoodsId,
      shopId: draft.shopId, listingWorkflowId: draft.id,
      draftRevision: draft.revision, draftVersion: draft.draftVersion,
    },
    selectedSkuKeys: draft.selectedSkuKeys,
    category: draft.category,
    pricing,
    packaging: packaging ?? [],
    fieldIssues,
    copy: projectSourceListingCopyEditor(draft),
    mediaAssignments: draft.media.assignments.map((item) => ({ scope: item.scope,
      skuKey: item.scope === 'SKU' ? item.skuKey : null, slotKey: item.slotKey, assetId: item.assetId })),
    stage: draft.stage,
    validation: { status: draft.validation.status },
    blockers: draft.blockers.map((item) => ({ code: item.code, message: item.message,
      ...(item.fieldPath === undefined ? {} : { fieldPath: item.fieldPath }) })),
    freshness: Object.fromEntries(Object.entries(draft.freshness).map(([key, item]) => [key, item.state])),
  };
}
export function createExtensionListingEditorService(options: {
  workflow: Pick<SourceListingWorkflowService, 'getDraft' | 'setCategory' | 'setPricing' | 'setSkuPackaging'>;
  ownership: Pick<SourceListingWorkflowContextResolver, 'assertOwnedTarget'>;
  loadCatalog(input: { ownerUserId: string; shopId: string }): Promise<{ revision: string; entries: CategoryEntry[] }>;
  retainCompatibleReviewedValues?(input: { ownerUserId: string; draft: OzonListingDraft; category: OzonListingDraftCategory }): Promise<Record<string, OzonListingDraftAttributeValue>>;
  attributesEditor?: SourceListingAttributeEditorService;
  copyEditor?: SourceListingCopyEditorService;
}) {
  async function bound(identity: ExtensionListingEditorIdentity, binding: ExtensionListingEditorBinding, operationKey?: string) {
    if (identity.actorUserId !== identity.ownerUserId || !identity.allowedShopIds.includes(binding.shopId)) {
      throw new ExtensionListingEditorError('editor_shop_denied', 403, '设备无权编辑该店铺');
    }
    const draft = await options.workflow.getDraft({ ownerUserId: identity.ownerUserId, draftId: binding.listingWorkflowId });
    if (draft.shopId !== binding.shopId || draft.sourceCaptureSnapshotId !== binding.snapshotId || draft.supplyGoodsId !== binding.supplyGoodsId) {
      throw new ExtensionListingEditorError('editor_context_stale', 409, '商品快照或店铺草稿已变化');
    }
    const replayed = Boolean(operationKey && (draft.auditEvents.some((entry) => entry.details?.editorOperationKey === operationKey)
      || draft.copy.applyAudit.some((entry) => entry.operationKey === operationKey)));
    if (!replayed && (draft.revision !== binding.draftRevision || draft.draftVersion !== binding.draftVersion)) {
      throw new ExtensionListingEditorError('editor_context_stale', 409, '草稿版本已变化，请重新读取');
    }
    await options.ownership.assertOwnedTarget({ ownerUserId: identity.ownerUserId, shopId: draft.shopId,
      supplyGoodsId: draft.supplyGoodsId, sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
      currentSourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, selectedSkuKeys: draft.selectedSkuKeys });
    return { draft, replayed };
  }
  const categoryValidator = createSourceListingWorkflowCategoryValidator({
    loadCatalog: async (input) => {
      const catalog = await options.loadCatalog(input);
      return { revision: catalog.revision, entries: catalog.entries as OzonCategoryCatalogEntry[] };
    },
  });
  return {
    async read(identity: ExtensionListingEditorIdentity, binding: ExtensionListingEditorBinding) {
      return projection((await bound(identity, binding)).draft);
    },
    async catalog(identity: ExtensionListingEditorIdentity, binding: ExtensionListingEditorBinding, query: string) {
      await bound(identity, binding);
      const catalog = await options.loadCatalog({ ownerUserId: identity.ownerUserId, shopId: binding.shopId });
      const keywords = query.normalize('NFKC').trim().toLowerCase();
      const matching = catalog.entries.filter((entry) => entry.disabled !== true && entry.selectable !== false
        && [entry.categoryNameRu, entry.categoryNameZh, entry.typeNameRu, entry.typeNameZh].join(' ').toLowerCase().includes(keywords));
      return { catalogRevision: catalog.revision, entries: matching.slice(0, 50).map((entry) => ({
        categoryId: entry.descriptionCategoryId, typeId: entry.typeId,
        label: [entry.categoryNameZh || entry.categoryNameRu, entry.typeNameZh || entry.typeNameRu].join(' / '),
      })), truncated: matching.length > 50 };
    },
    async attributes(identity: ExtensionListingEditorIdentity, binding: ExtensionListingEditorBinding) {
      await bound(identity, binding);
      if (!options.attributesEditor) throw new ExtensionListingEditorError('editor_attributes_unavailable', 503, '官方属性编辑尚未配置');
      return options.attributesEditor.readWorkspace({ draftId: binding.listingWorkflowId, ownerUserId: identity.ownerUserId,
        actorUserId: identity.actorUserId, expectedRevision: binding.draftRevision, expectedDraftVersion: binding.draftVersion });
    },
    async dictionary(identity: ExtensionListingEditorIdentity, binding: ExtensionListingEditorBinding,
      input: { schemaRevision: string; attributeId: number; query: string; limit: number }) {
      await bound(identity, binding);
      if (!options.attributesEditor) throw new ExtensionListingEditorError('editor_attributes_unavailable', 503, '官方属性编辑尚未配置');
      return options.attributesEditor.searchDictionary({ ...input, draftId: binding.listingWorkflowId, ownerUserId: identity.ownerUserId,
        actorUserId: identity.actorUserId, expectedRevision: binding.draftRevision, expectedDraftVersion: binding.draftVersion });
    },
    async save(identity: ExtensionListingEditorIdentity, input: {
      binding: ExtensionListingEditorBinding; operationKey: string;
      action: 'PRICING' | 'CATEGORY' | 'PACKAGING' | 'ATTRIBUTES' | 'COPY_CANDIDATE' | 'COPY_APPROVE' | 'VALIDATE'; value: unknown;
    }) {
      const { draft, replayed } = await bound(identity, input.binding, input.operationKey);
      const context = { ownerUserId: identity.ownerUserId, actorUserId: identity.actorUserId,
        draftId: draft.id, expectedRevision: input.binding.draftRevision,
        expectedDraftVersion: input.binding.draftVersion, operationKey: input.operationKey };
      let result: OzonListingDraft;
      let candidateId: string | undefined;
      if (input.action === 'PRICING') {
        const value = validateSourceListingPricing(input.value, draft.selectedSkuKeys);
        result = await options.workflow.setPricing({ ...context, value });
      } else if (input.action === 'PACKAGING') {
        const value = input.value as { items: unknown; evidence: string[] };
        result = await options.workflow.setSkuPackaging({ ...context, expectedDraftVersion: input.binding.draftVersion,
          items: normalizeSourceListingSkuPackagingItems(value.items), evidence: value.evidence });
      } else if (input.action === 'ATTRIBUTES') {
        if (!options.attributesEditor) throw new ExtensionListingEditorError('editor_attributes_unavailable', 503, '官方属性编辑尚未配置');
        const value = input.value as { schemaRevision: string; changes: unknown };
        result = await options.attributesEditor.saveAttributes({ ...value, draftId: draft.id, ownerUserId: identity.ownerUserId,
          actorUserId: identity.actorUserId, expectedRevision: input.binding.draftRevision, expectedDraftVersion: input.binding.draftVersion,
          operationKey: input.operationKey });
      } else if (input.action === 'COPY_CANDIDATE' || input.action === 'COPY_APPROVE' || input.action === 'VALIDATE') {
        if (!options.copyEditor) throw new ExtensionListingEditorError('editor_copy_unavailable', 503, '文案与上架校验尚未配置');
        const copyContext = { draftId: draft.id, ownerUserId: identity.ownerUserId, actorUserId: identity.actorUserId,
          expectedRevision: input.binding.draftRevision, expectedDraftVersion: input.binding.draftVersion };
        if (input.action === 'COPY_CANDIDATE') {
          const created = await options.copyEditor.create({ ...copyContext, operationKey: input.operationKey,
            ...input.value as { titleRu?: string; descriptionRu?: string | null } });
          result = created.draft; candidateId = created.candidateId;
        } else if (input.action === 'COPY_APPROVE') {
          result = await options.copyEditor.approve({ ...copyContext, operationKey: input.operationKey,
            candidateId: (input.value as { candidateId: string }).candidateId });
        } else {
          result = await options.copyEditor.validate({ ...copyContext, operationKey: input.operationKey,
            schemaRevision: (input.value as { schemaRevision: string }).schemaRevision });
        }
      } else {
        const category = await categoryValidator.validate({ ownerUserId: identity.ownerUserId, shopId: draft.shopId, category: input.value as OzonListingDraftCategory });
        const retainedAttributeValues = options.retainCompatibleReviewedValues
          ? await options.retainCompatibleReviewedValues({ ownerUserId: identity.ownerUserId, draft, category }) : {};
        result = await options.workflow.setCategory({ ...context, category, retainedAttributeValues });
      }
      return { data: projection(result), replayed, ...(candidateId === undefined ? {} : { candidateId }) };
    },
  };
}
export type ExtensionListingEditorService = ReturnType<typeof createExtensionListingEditorService>;
