import { createHash } from 'node:crypto';

import type {
  OzonListingAiCopyCandidate,
  OzonListingAiCopyFieldProvenance,
  OzonListingDraft,
  SourceProductCaptureV2,
} from 'shared';
import { verifySourceProductCaptureV2Submission } from 'shared';

import {
  LISTING_COPY_DESCRIPTION_TEMPLATE_KEY,
  LISTING_COPY_TITLE_TEMPLATE_KEY,
  type AiPromptTemplateRegistryService,
} from './ai-prompt-template-registry.js';
import {
  compileProductContentRequest,
  hashProductContentPrompt,
  type ProductContentDraftResult,
  type ProductContentField,
  type ProductContentRegistryPromptAuthority,
} from './product-content-ai.js';
import {
  hasTrustedSourceEvidence,
  isTrustedSourceEvidence,
  trustedNonNegativeSourceNumber,
  trustedObservedSkuStock,
  trustedPositiveSourceNumber,
} from './source-evidence-trust.js';
import { buildSourceProductProfileFromCapture } from './source-product-profile.js';
import {
  SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_BYTES,
  SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS,
  SOURCE_LISTING_AI_COPY_CANDIDATES_MAX_BYTES,
  SourceListingWorkflowError,
  sourceListingAiCopyContextHash,
  type SourceListingWorkflowService,
} from './source-listing-workflow.js';
import { isUnknownAiOutcome } from './ai-usage.js';
import type { SourceListingAiCopyExecutionStore } from './source-listing-ai-copy-execution.js';

const MAX_USER_INSTRUCTIONS_LENGTH = 2_000;
const MAX_FACT_ATTRIBUTES = 20;
const MAX_FACT_SKUS = 8;
const MAX_FACT_TEXT_LENGTH = 1_200;
const MAX_PROMPT_JSON_BYTES = 20_000;

type ResolvedTemplate = Awaited<ReturnType<AiPromptTemplateRegistryService['resolveTemplate']>>;

export interface SourceListingAiCopyPrompt {
  templateKey: 'listing-copy.title' | 'listing-copy.description';
  resolved: ResolvedTemplate;
  variables: Record<string, string>;
  registryAuthority: ProductContentRegistryPromptAuthority;
}

export interface SourceListingAiCopySnapshot {
  id: string;
  captureHash: string;
  payloadBytes: number;
  payload: SourceProductCaptureV2;
  profileHash: string;
}

export interface SourceListingAiCopyGenerateContentInput {
  actorUserId: string;
  fields: ProductContentField[];
  prompts: Partial<Record<ProductContentField, SourceListingAiCopyPrompt>>;
}

export interface SourceListingAiCopyServiceOptions {
  workflow: Pick<SourceListingWorkflowService, 'getDraft' | 'addAiCopyCandidate'>;
  loadOwnedSnapshot(input: {
    ownerUserId: string;
    snapshotId: string;
  }): Promise<SourceListingAiCopySnapshot | null>;
  resolveTemplate(input: {
    templateKey: string;
    variables: Record<string, unknown>;
  }): Promise<ResolvedTemplate>;
  generateContent(input: SourceListingAiCopyGenerateContentInput): Promise<ProductContentDraftResult>;
  executionStore?: SourceListingAiCopyExecutionStore;
}

export interface GenerateSourceListingAiCopyInput {
  draftId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
  fields: readonly ProductContentField[];
  userInstructions?: string;
}

export interface SourceListingAiCopyGenerationResult {
  draft: OzonListingDraft;
  candidate: OzonListingAiCopyCandidate;
  replayed?: boolean;
  limit?: { used: number; remaining: number; limit: number };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function boundedPromptJson(value: unknown, label: string): string {
  const serialized = canonicalJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PROMPT_JSON_BYTES) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} exceeds the prompt fact budget`, 400,
    );
  }
  return serialized;
}

function boundedText(value: unknown, maxLength: number): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function exactText(value: unknown, label: string, maxLength: number, required = true): string {
  const normalized = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} is invalid`, 400,
    );
  }
  return normalized;
}

function normalizeFields(fields: readonly ProductContentField[]): ProductContentField[] {
  const normalized = [...new Set(fields)];
  if (!normalized.length || normalized.some((field) => field !== 'title' && field !== 'description')) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID',
      'AI copy generation fields must contain title or description',
      400,
    );
  }
  return (['title', 'description'] as const).filter((field) => normalized.includes(field));
}

function confirmedAttributes(draft: OzonListingDraft): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let truncated = false;
  for (const [key, value] of Object.entries(draft.attributes.values)
    .filter(([, candidate]) => candidate.reviewed)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))) {
    const candidate = {
      value: value.value,
      source: value.source,
      evidence: value.evidence?.slice(0, 20),
      dictionaryValueId: value.dictionaryMatch?.dictionaryValueId ?? null,
    };
    if (Object.keys(result).length >= MAX_FACT_ATTRIBUTES
      || Buffer.byteLength(canonicalJson({ ...result, [key]: candidate }), 'utf8') > MAX_PROMPT_JSON_BYTES) {
      truncated = true;
      continue;
    }
    result[key] = candidate;
  }
  if (truncated) result._meta = { truncated: true };
  return result;
}

function sourceFacts(
  draft: OzonListingDraft,
  capture: SourceProductCaptureV2,
) {
  const selected = new Set(draft.selectedSkuKeys);
  const trustedSelectedSkus = capture.skus.filter((sku) => (
    selected.has(sku.key) && isTrustedSourceEvidence(sku.rowEvidence)
  ));
  const trustedAttributes = capture.attributes.filter((attribute) => (
    hasTrustedSourceEvidence(
      attribute.rowEvidence,
      attribute.fieldEvidence.name,
      attribute.fieldEvidence.value,
    )
  ));
  const packaging = {
    weightG: trustedPositiveSourceNumber(capture.facts.packageWeightG, capture.fieldEvidence.packageWeightG),
    lengthMm: trustedPositiveSourceNumber(capture.facts.packageLengthMm, capture.fieldEvidence.packageLengthMm),
    widthMm: trustedPositiveSourceNumber(capture.facts.packageWidthMm, capture.fieldEvidence.packageWidthMm),
    heightMm: trustedPositiveSourceNumber(capture.facts.packageHeightMm, capture.fieldEvidence.packageHeightMm),
  };
  return {
    captureVersion: capture.captureVersion,
    platform: capture.platform,
    sourceProductId: isTrustedSourceEvidence(capture.sourceIdentity.fieldEvidence.productId)
      ? capture.sourceIdentity.productId
      : null,
    sourceTitle: isTrustedSourceEvidence(capture.fieldEvidence.title)
      ? boundedText(capture.facts.title, 1_000)
      : null,
    sourceDescription: isTrustedSourceEvidence(capture.fieldEvidence.description)
      ? boundedText(capture.facts.description, MAX_FACT_TEXT_LENGTH)
      : null,
    sourceCategory: {
      id: isTrustedSourceEvidence(capture.sourceCategory.fieldEvidence.id)
        ? capture.sourceCategory.id
        : null,
      name: isTrustedSourceEvidence(capture.sourceCategory.fieldEvidence.name)
        ? capture.sourceCategory.name
        : null,
      path: capture.sourceCategory.path.filter((node) => (
        hasTrustedSourceEvidence(node.fieldEvidence.id, node.fieldEvidence.name)
      )).map((node) => node.name).slice(0, 20),
    },
    targetCategory: draft.category,
    selectedSkuKeys: draft.selectedSkuKeys,
    selectedSkuFactsTruncated: trustedSelectedSkus.length > MAX_FACT_SKUS,
    selectedSkus: trustedSelectedSkus.slice(0, MAX_FACT_SKUS).map((sku) => ({
      key: sku.key,
      sourceSkuId: isTrustedSourceEvidence(sku.fieldEvidence.sourceSkuId) ? sku.sourceSkuId : null,
      specText: isTrustedSourceEvidence(sku.fieldEvidence.specText)
        ? boundedText(sku.specText, 1_000)
        : null,
      priceCny: trustedPositiveSourceNumber(sku.priceCny, sku.fieldEvidence.priceCny),
      stock: trustedObservedSkuStock(sku),
      attributes: sku.attributes.filter((attribute) => (
        hasTrustedSourceEvidence(attribute.fieldEvidence.name, attribute.fieldEvidence.value)
      )).slice(0, 6).map((attribute) => ({
        name: boundedText(attribute.name, 80),
        value: boundedText(attribute.value, 120),
      })),
      evidence: {
        row: { sourceType: sku.rowEvidence.sourceType, confidence: sku.rowEvidence.confidence },
        price: { sourceType: sku.fieldEvidence.priceCny.sourceType, confidence: sku.fieldEvidence.priceCny.confidence },
        stock: { sourceType: sku.fieldEvidence.stock.sourceType, confidence: sku.fieldEvidence.stock.confidence },
      },
    })),
    sourceAttributesTruncated: trustedAttributes.length > MAX_FACT_ATTRIBUTES,
    attributes: trustedAttributes.slice(0, MAX_FACT_ATTRIBUTES).map((attribute) => ({
      name: boundedText(attribute.name, 80),
      value: boundedText(attribute.value, 120),
      isSaleAttribute: attribute.isSaleAttribute,
      evidence: { sourceType: attribute.rowEvidence.sourceType, confidence: attribute.rowEvidence.confidence },
    })),
    packaging,
    shippingCny: trustedNonNegativeSourceNumber(capture.facts.shippingCny, capture.fieldEvidence.shippingCny),
    completeness: capture.completeness.status,
    hasEstimatedValues: capture.completeness.hasEstimatedValues,
  };
}

function variablesForField(input: {
  field: ProductContentField;
  sourceFactsJson: string;
  confirmedAttributesJson: string;
  categoryName: string;
  userInstructions: string;
}): Record<string, string> {
  const common = {
    sourceFactsJson: input.sourceFactsJson,
    ozonCategoryName: input.categoryName,
    targetLanguage: 'Russian',
    userInstructions: input.userInstructions,
    forbiddenClaims: 'brands, certifications, origin, compatibility, quantities, discounts, shipping, guarantees, medical or safety claims not present in the supplied facts',
  };
  return input.field === 'description'
    ? { ...common, confirmedAttributesJson: input.confirmedAttributesJson }
    : common;
}

function provenanceForField(input: {
  prompt: SourceListingAiCopyPrompt;
  draft: NonNullable<Extract<ProductContentDraftResult, { ok: true }>['drafts'][ProductContentField]>;
  sourceProfileHash: string;
}): OzonListingAiCopyFieldProvenance {
  const { prompt, draft } = input;
  const field: ProductContentField = prompt.templateKey === LISTING_COPY_TITLE_TEMPLATE_KEY
    ? 'title'
    : 'description';
  const expectedPromptHash = hashProductContentPrompt(
    field,
    prompt.resolved.resolvedPrompt,
    prompt.resolved.resolvedNegativePrompt,
    prompt.registryAuthority,
  );
  const compiled = compileProductContentRequest(
    field,
    prompt.resolved.resolvedPrompt,
    prompt.resolved.resolvedNegativePrompt,
    prompt.registryAuthority,
  );
  if (draft.promptHash !== expectedPromptHash
    || draft.promptHash !== compiled.promptHash
    || draft.providerRequestHash !== compiled.providerRequestHash
    || draft.compileContractVersion !== compiled.compileContractVersion) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_AI_GENERATION_FAILED',
      'AI listing copy generator did not use the frozen prompt',
      502,
    );
  }
  return {
    templateKey: prompt.templateKey,
    releaseId: prompt.resolved.release.id,
    revisionId: prompt.resolved.release.revisionId,
    sequence: prompt.resolved.release.sequence,
    checksum: prompt.resolved.checksum,
    compileContractVersion: compiled.compileContractVersion,
    temperature: compiled.temperature,
    maxTokens: compiled.maxTokens,
    allowReasoningRetry: compiled.allowReasoningRetry,
    variableSchemaVersion: prompt.resolved.snapshot.variableSchemaVersion,
    variablesHash: hash(prompt.variables),
    sourceProfileHash: input.sourceProfileHash,
    provider: draft.provider,
    model: draft.model,
    source: draft.source,
    promptHash: draft.promptHash,
    providerRequestHash: draft.providerRequestHash,
    providerConfigHash: draft.providerConfigHash,
    outputHash: hash({ text: draft.text, structured: draft.structured ?? null }),
    generatedAt: draft.generatedAt,
    ...(draft.structured ? { structuredOutput: structuredClone(draft.structured) as Record<string, unknown> } : {}),
    frozenRequest: {
      systemPrompt: compiled.systemPrompt,
      userPrompt: compiled.userPrompt,
      variables: structuredClone(prompt.variables),
    },
  };
}

export function createSourceListingAiCopyService(options: SourceListingAiCopyServiceOptions) {
  const draftLocks = new Map<string, Promise<void>>();

  async function withDraftLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = draftLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    draftLocks.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (draftLocks.get(key) === tail) draftLocks.delete(key);
    }
  }

  async function generate(input: GenerateSourceListingAiCopyInput): Promise<SourceListingAiCopyGenerationResult> {
      const fields = normalizeFields(input.fields);
      const operationKey = exactText(input.operationKey, 'AI copy generation operationKey', 200);
      const userInstructions = exactText(
        input.userInstructions, 'AI copy generation userInstructions', MAX_USER_INSTRUCTIONS_LENGTH, false,
      );
      const current = await options.workflow.getDraft({ draftId: input.draftId, ownerUserId: input.ownerUserId });
      if (!current.category) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'Confirm the Ozon category before generating listing copy', 409,
        );
      }
      if (current.freshness.category.state !== 'CURRENT'
        || current.freshness.attributes.state !== 'CURRENT') {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID',
          'Confirm current category and attribute facts before generating listing copy',
          409,
        );
      }
      const attributes = confirmedAttributes(current);
      const draftContextHash = sourceListingAiCopyContextHash(current);
      const clientRequestHash = hash({
        draftId: current.id,
        draftContextHash,
        fields,
        userInstructions,
      });
      const replay = current.copy.candidates.find((candidate) => candidate.generation?.operationKey === operationKey);
      if (replay) {
        if (replay.generation?.clientRequestHash !== clientRequestHash) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_AI_GENERATION_OPERATION_CONFLICT',
            'AI copy generation operation key was reused with different inputs',
            409,
          );
        }
        return { draft: current, candidate: replay, replayed: true };
      }
      if (current.revision !== input.expectedRevision) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Listing draft revision changed', 409,
        );
      }
      if (current.stage === 'PUBLISHED'
        || current.runState === 'CANCELLED'
        || current.runState === 'PERMANENT_FAILURE') {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_WORKFLOW_TERMINAL', 'Terminal listing workflow cannot generate copy', 409,
        );
      }
      const candidateHistoryBytes = Buffer.byteLength(JSON.stringify(current.copy.candidates), 'utf8');
      if (current.copy.candidates.length >= SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS
        || candidateHistoryBytes > SOURCE_LISTING_AI_COPY_CANDIDATES_MAX_BYTES
          - SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_BYTES) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'AI copy candidate history has reached its capacity', 400,
        );
      }
      const snapshot = await options.loadOwnedSnapshot({
        ownerUserId: input.ownerUserId,
        snapshotId: current.sourceCaptureSnapshotId,
      });
      if (!snapshot
        || snapshot.id !== current.sourceCaptureSnapshotId
        || snapshot.captureHash !== current.sourceCaptureHash) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_NOT_FOUND', 'Owned source capture snapshot was not found', 404,
        );
      }
      const verified = await verifySourceProductCaptureV2Submission({
        capture: snapshot.payload,
        captureHash: snapshot.captureHash,
        payloadBytes: snapshot.payloadBytes,
      });
      if (!verified.valid) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'Source capture snapshot failed integrity validation', 409,
        );
      }
      const profile = buildSourceProductProfileFromCapture(snapshot.payload, {
        itemId: snapshot.captureHash,
        captureHash: snapshot.captureHash,
      });
      if (snapshot.profileHash && snapshot.profileHash !== profile.hash) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'Source capture profile hash does not match its payload', 409,
        );
      }
      const facts = sourceFacts(current, snapshot.payload);

      const sourceFactsJson = boundedPromptJson(facts, 'source facts');
      const confirmedAttributesJson = boundedPromptJson(attributes, 'confirmed attributes');
      const categoryName = boundedText(current.category.typeName || current.category.categoryName, 300)
        || String(current.category.typeId);
      const prompts: Partial<Record<ProductContentField, SourceListingAiCopyPrompt>> = {};
      for (const field of fields) {
        const templateKey = field === 'title'
          ? LISTING_COPY_TITLE_TEMPLATE_KEY
          : LISTING_COPY_DESCRIPTION_TEMPLATE_KEY;
        const variables = variablesForField({
          field, sourceFactsJson, confirmedAttributesJson, categoryName, userInstructions,
        });
        const resolved = await options.resolveTemplate({ templateKey, variables });
        prompts[field] = {
          templateKey,
          variables,
          resolved,
          registryAuthority: {
            templateKey,
            promptTemplate: resolved.snapshot.promptTemplate,
            negativePromptTemplate: resolved.snapshot.negativePromptTemplate,
            variables,
          },
        };
      }

      const claim = options.executionStore
        ? await options.executionStore.claim({
          ownerUserId: input.ownerUserId,
          draftId: current.id,
          operationKey,
          clientRequestHash,
        })
        : null;
      if (claim?.kind === 'conflict') {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_AI_GENERATION_OPERATION_CONFLICT',
          'AI copy generation operation key was reused with different inputs',
          409,
        );
      }
      if (claim?.kind === 'replay') {
        const latest = await options.workflow.getDraft({ draftId: input.draftId, ownerUserId: input.ownerUserId });
        const candidate = latest.copy.candidates.find((value) => value.generation?.operationKey === operationKey);
        if (candidate) return { draft: latest, candidate, replayed: true };
        throw new SourceListingWorkflowError(
          'OZON_LISTING_AI_GENERATION_IN_PROGRESS', 'AI copy generation result is still being reconciled', 409,
        );
      }
      if (claim?.kind === 'in_progress' || claim?.kind === 'unknown') {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_AI_GENERATION_IN_PROGRESS', 'AI copy generation is already running or needs reconciliation', 409,
        );
      }

      try {
        const generated = await options.generateContent({
          actorUserId: input.actorUserId,
          fields,
          prompts,
        });
        if (!generated.ok) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_AI_GENERATION_FAILED', generated.error || 'AI listing copy generation failed', 502,
          );
        }
        const titleDraft = fields.includes('title') ? generated.drafts.title : undefined;
        const descriptionDraft = fields.includes('description') ? generated.drafts.description : undefined;
        if ((fields.includes('title') && !titleDraft) || (fields.includes('description') && !descriptionDraft)) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_AI_GENERATION_FAILED', 'AI listing copy generation returned an incomplete result', 502,
          );
        }
        const sequences = fields.map((field) => prompts[field]!.resolved.release.sequence).join('-');
        const result = await options.workflow.addAiCopyCandidate({
        draftId: current.id,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedRevision: input.expectedRevision,
        kind: 'AI_GENERATED',
        titleRu: titleDraft?.text ?? null,
        descriptionRu: descriptionDraft?.text ?? null,
        sourcePromptVersion: `listing-copy:${sequences}`,
        generation: {
          schemaVersion: 'listing-copy-generation/v1',
          operationKey,
          clientRequestHash,
          draftContextHash,
          fields,
          ...(titleDraft ? {
            title: provenanceForField({
              prompt: prompts.title!, draft: titleDraft, sourceProfileHash: profile.hash,
            }),
          } : {}),
          ...(descriptionDraft ? {
            description: provenanceForField({
              prompt: prompts.description!, draft: descriptionDraft, sourceProfileHash: profile.hash,
            }),
          } : {}),
        },
        }).then((result) => ({ ...result, limit: generated.limit, replayed: false }));
        if (claim?.kind === 'claimed') await options.executionStore!.complete(claim.executionId);
        return result;
      } catch (error) {
        if (claim?.kind === 'claimed') {
          if (isUnknownAiOutcome(error)) await options.executionStore!.markUnknown(claim.executionId);
          else await options.executionStore!.release(claim.executionId);
        }
        throw error;
      }
  }

  return {
    generate(input: GenerateSourceListingAiCopyInput) {
      return withDraftLock(`${input.ownerUserId}\u0000${input.draftId}`, () => generate(input));
    },
  };
}

export type SourceListingAiCopyService = ReturnType<typeof createSourceListingAiCopyService>;
