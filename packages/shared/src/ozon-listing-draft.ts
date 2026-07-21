export const SOURCE_LISTING_SKU_KEY_MAX_LENGTH = 500;
export const SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS = 500;
export const SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY = '__ss_erp_product_only__' as const;
export const SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const OZON_LISTING_PRICING_CONTRACT_VERSION = 'ozon-listing-pricing/v1' as const;
export const OZON_LISTING_IMPORT_MAX_ITEMS = 100;
export const OZON_LISTING_DECIMAL_MAX_LENGTH = 64;
export const OZON_LISTING_CURRENCY_CODE_LENGTH = 3;
export const OZON_LISTING_VAT_MAX_LENGTH = 16;
export const OZON_LISTING_OFFER_ID_MAX_LENGTH = 100;

export interface OzonListingSkuPricingV1 {
  skuKey: string;
  price: string;
  oldPrice: string;
  currencyCode: string;
  vat: string;
  offerId?: string;
}

export interface OzonListingPricingV1 extends Record<string, unknown> {
  contractVersion: typeof OZON_LISTING_PRICING_CONTRACT_VERSION;
  items: OzonListingSkuPricingV1[];
}

export type SourceListingWorkflowStage =
  | 'CATEGORY_REVIEW'
  | 'ATTRIBUTE_REVIEW'
  | 'CONTENT_REVIEW'
  | 'MEDIA_REVIEW'
  | 'PRICING_REVIEW'
  | 'VALIDATION'
  | 'READY_TO_PUBLISH'
  | 'PUBLISH_INTENT_RECORDED'
  | 'PUBLISHED';

export type SourceListingWorkflowRunState =
  | 'ACTIVE'
  | 'PAUSED'
  | 'CANCELLED'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'MANUAL_REVIEW';

export type OzonListingDraftFreshnessReason =
  | 'CATEGORY_CHANGED'
  | 'SOURCE_SNAPSHOT_CHANGED'
  | 'SHOP_CHANGED'
  | 'SKU_SELECTION_CHANGED'
  | 'PROMPT_VERSION_CHANGED'
  | 'ATTRIBUTE_VALUES_CHANGED'
  | 'CONTENT_APPLIED'
  | 'MEDIA_ASSIGNMENT_CHANGED'
  | 'PRICING_CHANGED'
  | 'MANUAL_FACT_CONFIRMED'
  | 'CATALOG_REVISION_CHANGED';

export interface OzonListingDraftFreshness {
  state: 'CURRENT' | 'STALE';
  reason: OzonListingDraftFreshnessReason | null;
}

export interface OzonListingDraftCategory {
  categoryId: number;
  typeId: number;
  catalogRevision: string;
  categoryName?: string;
  typeName?: string;
}

export type OzonAttributeValueType =
  | 'STRING'
  | 'INTEGER'
  | 'DECIMAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'JSON'
  | 'UNKNOWN';

export type OzonAttributeCardinality = 'SINGLE' | 'MULTI';
export type OzonAttributeValuePolicy =
  | 'STRICT_DICTIONARY'
  | 'OPEN_DICTIONARY'
  | 'FREE_TEXT';
export type OzonAttributeOwnership = 'SYSTEM' | 'SKU' | 'MEDIA' | 'COMPLIANCE' | 'EDITOR';
export type OzonAttributeEditorMode =
  | 'READ_ONLY'
  | 'SKU_MATRIX'
  | 'MEDIA_WORKBENCH'
  | 'MANUAL_REQUIRED'
  | 'EDITABLE';
export type OzonAttributeReadinessImpact =
  | 'OZON_IMPORT'
  | 'INVENTORY_ACTIVATION'
  | 'COSTING_AUTO_PRICING'
  | 'WARNING';
export type OzonAttributeDictionaryMatchStatus =
  | 'NOT_APPLICABLE'
  | 'UNRESOLVED'
  | 'MATCHED'
  | 'UNSUPPORTED';
export type OzonAttributeManualReviewState =
  | 'NOT_REQUIRED'
  | 'REQUIRED'
  | 'CONFIRMED'
  | 'REJECTED';

export type OzonAttributeSuggestionEvidenceSource =
  | 'SOURCE_STANDARD'
  | 'SOURCE_PROFILE'
  | 'VISUAL';

export interface OzonListingDraftAttributeSuggestionEvidence {
  id: string;
  attributeId: number;
  source: OzonAttributeSuggestionEvidenceSource;
  path: string;
  value: unknown;
  confidence: number;
  isEstimated: boolean;
}

export interface OzonListingDraftAttributeSuggestionProvenance {
  contractVersion: 'ozon-attribute-suggestion-provenance/v1';
  candidateId: string;
  candidateHash: string;
  schemaRevision: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  draftVersion: number;
  draftRevision: number;
  evidenceDetails: OzonListingDraftAttributeSuggestionEvidence[];
}

export interface OzonNormalizedAttributeField {
  attributeId: number;
  name: string;
  description: string;
  sourceType: string;
  valueType: OzonAttributeValueType;
  cardinality: OzonAttributeCardinality;
  required: boolean;
  dictionaryId: number | null;
  valuePolicy: OzonAttributeValuePolicy;
  ownership: OzonAttributeOwnership;
  editorMode: OzonAttributeEditorMode;
  aiSuggestionAllowed: boolean;
  complianceSensitive?: boolean;
  requiresRussianText?: boolean;
  readinessImpact?: OzonAttributeReadinessImpact;
}

export interface OzonNormalizedAttributeSchema {
  schemaVersion: 'ozon-attribute-schema/v1';
  shopId: string;
  descriptionCategoryId: number;
  typeId: number;
  language: string;
  catalogRevision: string;
  definitionsHash: string;
  definitionSource?: 'cache' | 'ozon_api' | 'stale-cache';
  definitionWarning?: string;
  fields: OzonNormalizedAttributeField[];
}

export interface OzonListingDraftAttributeValue {
  value: unknown;
  source: 'SOURCE' | 'SYSTEM' | 'AI' | 'MANUAL';
  reviewed: boolean;
  evidence?: string[];
  confidence?: number | null;
  dictionaryMatch?: {
    status: OzonAttributeDictionaryMatchStatus;
    dictionaryValueId: number | null;
    canonicalValue?: string | null;
  };
  dictionaryMatches?: Array<{
    inputValue: unknown;
    dictionaryValueId: number;
    canonicalValue: string;
  }>;
  unresolvedValues?: unknown[];
  skuValues?: Record<string, OzonListingDraftAttributeValue>;
  manualReview?: OzonAttributeManualReviewState;
  suggestionProvenance?: OzonListingDraftAttributeSuggestionProvenance;
}

interface OzonListingDraftMediaAssignmentBase {
  slotKey: string;
  assetId: string;
  source: 'SOURCE' | 'REVIEWED' | 'GENERATED' | 'TRANSLATED' | 'EDITED';
}

export type OzonListingDraftMediaAssignment =
  | (OzonListingDraftMediaAssignmentBase & {
    scope: 'PRODUCT';
    skuKey?: never;
  })
  | (OzonListingDraftMediaAssignmentBase & {
    scope: 'SKU';
    skuKey: string;
  });

export interface OzonListingWorkflowIssue {
  code: string;
  message: string;
  fieldPath?: string;
}

export interface OzonListingAiCopyCandidate {
  id: string;
  kind?: 'MANUAL' | 'AI_GENERATED';
  fields?: Array<'title' | 'description'>;
  titleRu: string | null;
  descriptionRu: string | null;
  sourcePromptVersion: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  generation?: OzonListingAiCopyGenerationProvenance;
  createdByUserId: string;
  createdAt: string;
}

export interface OzonListingAiCopyFieldProvenance {
  templateKey: 'listing-copy.title' | 'listing-copy.description';
  releaseId: string;
  revisionId: string;
  sequence: number;
  checksum: string;
  compileContractVersion: string;
  temperature: number;
  maxTokens: number;
  allowReasoningRetry?: boolean;
  variableSchemaVersion: number;
  variablesHash: string;
  sourceProfileHash: string;
  provider: string;
  model: string;
  source: 'cache' | 'provider';
  promptHash: string;
  providerRequestHash: string;
  providerConfigHash: string;
  outputHash: string;
  generatedAt: string;
  structuredOutput?: Record<string, unknown>;
  frozenRequest?: {
    systemPrompt: string;
    userPrompt: string;
    variables: Record<string, string>;
  };
}

export interface OzonListingAiCopyGenerationProvenance {
  schemaVersion: 'listing-copy-generation/v1';
  operationKey: string;
  clientRequestHash: string;
  draftContextHash: string;
  fields: Array<'title' | 'description'>;
  title?: OzonListingAiCopyFieldProvenance;
  description?: OzonListingAiCopyFieldProvenance;
}

export type OzonListingAiCopyFieldProvenanceView = Omit<
  OzonListingAiCopyFieldProvenance,
  'frozenRequest'
>;

export type OzonListingAiCopyGenerationProvenanceView = Omit<
  OzonListingAiCopyGenerationProvenance,
  'title' | 'description'
> & {
  title?: OzonListingAiCopyFieldProvenanceView;
  description?: OzonListingAiCopyFieldProvenanceView;
};

export type OzonListingAiCopyCandidateView = Omit<OzonListingAiCopyCandidate, 'generation'> & {
  generation?: OzonListingAiCopyGenerationProvenanceView;
};

export interface OzonListingAiCopyApplyAudit {
  id: string;
  candidateId: string;
  actorUserId: string;
  operationKey: string;
  draftVersion: number;
  previousTitleRu: string | null;
  previousDescriptionRu: string | null;
  appliedAt: string;
}

export type OzonListingDraftAuditEventType =
  | 'DRAFT_CREATED'
  | 'CATEGORY_CHANGED'
  | 'SOURCE_SNAPSHOT_CHANGED'
  | 'SHOP_CHANGED'
  | 'SKU_SELECTION_CHANGED'
  | 'AI_COPY_CANDIDATE_CREATED'
  | 'AI_COPY_CANDIDATE_APPLIED'
  | 'AI_MEDIA_ASSIGNMENT_APPLIED'
  | 'AI_MEDIA_ASSIGNMENT_ROLLED_BACK'
  | 'ATTRIBUTE_VALUES_CHANGED'
  | 'MANUAL_FACT_CONFIRMED'
  | 'PRICING_CHANGED'
  | 'VALIDATION_RECORDED'
  | 'WORKFLOW_PROGRESS_UPDATED'
  | 'WORKFLOW_RUN_STATE_CHANGED'
  | 'PUBLISH_INTENT_RECORDED';

export interface OzonListingDraftAuditEvent {
  id: string;
  type: OzonListingDraftAuditEventType;
  actorUserId: string;
  draftVersion: number;
  occurredAt: string;
  details: Record<string, unknown>;
}

export interface OzonListingPublishIntent {
  id: string;
  draftId: string;
  ownerUserId: string;
  shopId: string;
  draftVersion: number;
  revision: number;
  idempotencyKey: string;
  payloadHash: string;
  actorUserId: string;
  createdAt: string;
}

export interface OzonListingDraft {
  id: string;
  ownerUserId: string;
  shopId: string;
  supplyGoodsId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  selectedSkuKeys: string[];
  draftVersion: number;
  revision: number;
  stage: SourceListingWorkflowStage;
  runState: SourceListingWorkflowRunState;
  runStateReason: string | null;
  category: OzonListingDraftCategory | null;
  attributes: { values: Record<string, OzonListingDraftAttributeValue> };
  copy: {
    publishTitleRu: string | null;
    publishDescriptionRu: string | null;
    candidates: OzonListingAiCopyCandidate[];
    applyAudit: OzonListingAiCopyApplyAudit[];
  };
  media: { assignments: OzonListingDraftMediaAssignment[] };
  pricing: { value: Record<string, unknown> | null };
  validation: { status: 'NOT_RUN' | 'STALE' | 'VALID' | 'INVALID'; report: Record<string, unknown> | null };
  completedStepHashes: Record<string, string>;
  blockers: OzonListingWorkflowIssue[];
  warnings: OzonListingWorkflowIssue[];
  publishTaskIds: string[];
  freshness: {
    category: OzonListingDraftFreshness;
    attributes: OzonListingDraftFreshness;
    content: OzonListingDraftFreshness;
    media: OzonListingDraftFreshness;
    pricing: OzonListingDraftFreshness;
    validation: OzonListingDraftFreshness;
  };
  grantRevocation: {
    required: boolean;
    reason:
      | 'SHOP_CHANGED'
      | 'SOURCE_SNAPSHOT_CHANGED'
      | 'SKU_SELECTION_CHANGED'
      | 'CATEGORY_CHANGED'
      | 'ATTRIBUTE_VALUES_CHANGED'
      | 'CONTENT_APPLIED'
      | 'MEDIA_ASSIGNMENT_CHANGED'
      | 'PRICING_CHANGED'
      | 'MANUAL_FACT_CONFIRMED'
      | null;
    previousShopId: string | null;
  };
  auditEvents: OzonListingDraftAuditEvent[];
  createdAt: string;
  updatedAt: string;
}

export type OzonListingDraftView = Omit<OzonListingDraft, 'copy'> & {
  copy: Omit<OzonListingDraft['copy'], 'candidates'> & {
    candidates: OzonListingAiCopyCandidateView[];
  };
};
