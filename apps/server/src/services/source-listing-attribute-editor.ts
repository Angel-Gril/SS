import { OZON_LISTING_ATTRIBUTE_MAX_VALUES, type OzonListingDraft, type OzonListingDraftAttributeValue, type OzonListingDraftCategory, type OzonNormalizedAttributeSchema } from 'shared';
import type { SourceListingWorkflowService } from './source-listing-workflow.js';
import { SourceListingWorkflowError } from './source-listing-workflow.js';
import {
  SourceListingWorkflowAttributeError,
  type SourceListingWorkflowAttributeService,
  type SourceListingAttributeWorkspace,
} from './source-listing-workflow-attributes.js';
import { normalizeSourceListingManualAttributeChanges } from './source-listing-manual-attribute-changes.js';
import { normalizeSourceListingAttributeSuggestionChanges } from './source-listing-attribute-suggestion-changes.js';
import type { OzonAttributeSuggestionEvidence } from './ozon-attribute-suggestions.js';
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';

export interface SourceListingAttributeEditorContext {
  draftId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  expectedDraftVersion: number;
}
function assertSchemaRevision(expected: string, current: string): void {
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected) || expected !== current) {
    throw new SourceListingWorkflowAttributeError('OZON_ATTRIBUTE_SCHEMA_MISMATCH', 409, 'Official attribute schema changed; reload before saving');
  }
}
function projectSchemaFields(schema: OzonNormalizedAttributeSchema) {
  return schema.fields.map((field) => ({ attributeId: field.attributeId, name: field.name,
      required: field.required, valueType: field.valueType, cardinality: field.cardinality, ownership: field.ownership,
      editorMode: field.editorMode, valuePolicy: field.valuePolicy, dictionaryId: field.dictionaryId,
      maxValues: field.cardinality === 'SINGLE' ? 1 : OZON_LISTING_ATTRIBUTE_MAX_VALUES }));
}
function projectWorkspace(workspace: SourceListingAttributeWorkspace, draft: OzonListingDraft) {
  return { schemaRevision: workspace.schemaRevision,
    fields: projectSchemaFields(workspace.schema),
    values: workspace.schema.fields.flatMap((field) => {
      const root = workspace.values[String(field.attributeId)];
      return (field.ownership === 'SKU' ? sourceListingEditorSkuKeysForDraft(draft) : [null]).map((skuKey) => {
        const value = skuKey === null ? root : root?.skuValues?.[skuKey];
        const matches = value?.dictionaryMatches?.map((item) => item.dictionaryValueId);
        const ids = matches?.length ? matches
          : value?.dictionaryMatch?.dictionaryValueId ? [value.dictionaryMatch.dictionaryValueId] : [];
        return { attributeId: field.attributeId, skuKey, value: value?.value === undefined ? null : structuredClone(value.value),
          dictionaryValueIds: ids, reviewed: value?.reviewed === true };
      });
    }),
  };
}
function projectSuggestions(workspace: SourceListingAttributeWorkspace, draft: OzonListingDraft) {
  const suggestions = Object.values(workspace.suggestions).sort((left, right) => left.attributeId - right.attributeId).flatMap((candidate) => {
    const field = workspace.schema.fields.find((item) => item.attributeId === candidate.attributeId);
    if (!field || !['EDITOR', 'SKU'].includes(field.ownership)) return [];
    const rows = (field.ownership === 'SKU' ? sourceListingEditorSkuKeysForDraft(draft) : [null]).flatMap((skuKey) => {
      const leaf = skuKey === null ? candidate : candidate.skuValues?.[skuKey];
      if (!leaf) return [];
      const matches = leaf.dictionaryMatches || [];
      const rawValues = Array.isArray(leaf.value) ? leaf.value : [leaf.value];
      const canonical = matches.length === rawValues.length ? matches.map((match) => match.canonicalValue) : null;
      const evidence = (leaf as OzonListingDraftAttributeValue & { evidenceDetails?: OzonAttributeSuggestionEvidence[] }).evidenceDetails || [];
      return [{ skuKey, value: canonical ? field.cardinality === 'SINGLE' ? canonical[0] : canonical : structuredClone(leaf.value),
        sourceValue: structuredClone(leaf.value), source: leaf.source, reviewed: false as const,
        dictionaryValueIds: matches.map((match) => match.dictionaryValueId),
        evidence: evidence.map((item) => ({ id: item.id, source: item.source, path: item.path,
          value: structuredClone(item.value), isEstimated: item.isEstimated, confidence: item.confidence })),
        unresolvedValues: structuredClone(leaf.unresolvedValues || []),
      }];
    });
    return rows.length ? [{ attributeId: candidate.attributeId, attributeName: candidate.attributeName,
      candidateId: candidate.candidateId, candidateHash: candidate.candidateHash, schemaRevision: candidate.schemaRevision,
      reviewed: false as const, rows }] : [];
  });
  const result = { state: 'ready' as const, workspace: projectWorkspace(workspace, draft), suggestions,
    blockedSuggestions: workspace.blockedSuggestions.map((item) => ({ attributeId: item.attributeId, attributeName: item.attributeName,
      skuKey: item.skuKey ?? null, reasonCode: item.reasonCode, message: item.message, unsupportedValues: structuredClone(item.unsupportedValues) })) };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 512 * 1024) {
    throw new SourceListingWorkflowAttributeError('OZON_ATTRIBUTE_SUGGESTION_UNAVAILABLE', 503, 'Attribute candidate response exceeds the extension limit');
  }
  return result;
}
export function createSourceListingAttributeEditorService(options: {
  workflow: Pick<SourceListingWorkflowService, 'getDraft' | 'setManualAttributeChanges' | 'setSuggestedAttributeChanges'>;
  attributes: Pick<SourceListingWorkflowAttributeService, 'getWorkspace' | 'searchDictionary' | 'prepareManualValues' | 'prepareSuggestedValues' | 'validateAuthoritative' | 'previewSchema'>;
}) {
  async function bound(input: SourceListingAttributeEditorContext) {
    const draft = await options.workflow.getDraft({ draftId: input.draftId, ownerUserId: input.ownerUserId });
    if (draft.revision !== input.expectedRevision || draft.draftVersion !== input.expectedDraftVersion) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Listing attribute editor context changed', 409);
    }
    return draft;
  }
  async function workspace(input: SourceListingAttributeEditorContext) {
    const draft = await bound(input);
    return { draft, workspace: await options.attributes.getWorkspace({ ownerUserId: input.ownerUserId, draft }) };
  }
  return {
    async previewCategory(input: SourceListingAttributeEditorContext & { category: OzonListingDraftCategory }) {
      const draft = await bound(input);
      const preview = await options.attributes.previewSchema({ ownerUserId: input.ownerUserId, draft, category: input.category });
      return { categoryId: input.category.categoryId, typeId: input.category.typeId,
        catalogRevision: input.category.catalogRevision, schemaRevision: preview.schemaRevision,
        fields: projectSchemaFields(preview.schema) };
    },
    async readWorkspace(input: SourceListingAttributeEditorContext) {
      const current = await workspace(input);
      return projectWorkspace(current.workspace, current.draft);
    },
    async readSuggestions(input: SourceListingAttributeEditorContext) {
      const current = await workspace(input);
      await bound(input);
      return projectSuggestions(current.workspace, current.draft);
    },
    async searchDictionary(input: SourceListingAttributeEditorContext & { schemaRevision: string; attributeId: number; query?: string; limit?: number }) {
      if (!Number.isSafeInteger(input.attributeId) || input.attributeId < 1
        || input.query !== undefined && (typeof input.query !== 'string' || input.query.trim().length > 200)
        || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Invalid official dictionary search', 400);
      }
      const current = await workspace(input);
      assertSchemaRevision(input.schemaRevision, current.workspace.schemaRevision);
      const result = await options.attributes.searchDictionary({ ownerUserId: input.ownerUserId, draft: current.draft,
        attributeId: input.attributeId, ...(input.query === undefined ? {} : { query: input.query.trim() }),
        ...(input.limit === undefined ? {} : { limit: input.limit }) });
      return { schemaRevision: current.workspace.schemaRevision, attributeId: result.attributeId,
        values: result.values.map((item) => ({ id: item.id, value: item.value })),
        complete: result.complete, dictionaryComplete: result.dictionaryComplete, resultExhaustive: result.resultExhaustive,
        hasMore: result.hasMore, resultTruncated: result.resultTruncated };
    },
    async saveAttributes(input: SourceListingAttributeEditorContext & { operationKey: string; schemaRevision: string; changes: unknown }) {
      const changes = normalizeSourceListingManualAttributeChanges(input.changes);
      const request = { draftId: input.draftId, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId,
        expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion,
        operationKey: input.operationKey, schemaRevision: input.schemaRevision, changes };
      return options.workflow.setManualAttributeChanges(request, async (draft, preparedChanges) => {
        const current = await options.attributes.getWorkspace({ ownerUserId: request.ownerUserId, draft });
        assertSchemaRevision(request.schemaRevision, current.schemaRevision);
        return options.attributes.prepareManualValues({ ownerUserId: request.ownerUserId, actorUserId: request.actorUserId, draft,
          changes: preparedChanges, expectedSchemaRevision: request.schemaRevision });
      });
    },
    async applySuggestions(input: SourceListingAttributeEditorContext & { operationKey: string; schemaRevision: string; candidates: unknown }) {
      const candidates = normalizeSourceListingAttributeSuggestionChanges(input.candidates, input.schemaRevision);
      return options.workflow.setSuggestedAttributeChanges({ draftId: input.draftId, ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId, expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion,
        operationKey: input.operationKey, schemaRevision: input.schemaRevision, candidates }, async (draft, preparedCandidates) => {
          return options.attributes.prepareSuggestedValues({ ownerUserId: input.ownerUserId, actorUserId: input.actorUserId, draft, candidates: preparedCandidates });
        });
    },
    async validateAttributes(input: SourceListingAttributeEditorContext & { schemaRevision: string }) {
      const current = await workspace(input);
      assertSchemaRevision(input.schemaRevision, current.workspace.schemaRevision);
      const validated = await options.attributes.validateAuthoritative({ ownerUserId: input.ownerUserId, draft: current.draft });
      assertSchemaRevision(input.schemaRevision, validated.result.report.schemaRevision);
      return { schemaRevision: validated.result.report.schemaRevision, result: validated.result };
    },
  };
}
export type SourceListingAttributeEditorService = ReturnType<typeof createSourceListingAttributeEditorService>;
