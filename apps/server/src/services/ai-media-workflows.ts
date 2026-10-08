import { createHash } from 'node:crypto';
import {
  AI_IMAGE_EDIT_MODEL,
  AI_IMAGE_EDIT_PROVIDER,
  AiMediaCapabilityError,
  assertAiMediaCapability,
  resolveAiImageProviderCapability,
  hasExactAiMediaSandboxEvidence,
  type AiMediaOperation,
} from './ai-image-provider-capabilities.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from './ai-image-compositor.js';
import {
  AI_MEDIA_FULL_EDIT_TEMPLATE_KEY,
  AI_MEDIA_INPAINT_TEMPLATE_KEY,
} from './ai-prompt-templates.js';
import {
  parseAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeContract,
} from './ai-image-provider-runtime-contract.js';
import { AI_GLOBAL_COST_BUDGET_MAX_MINOR } from './ai-cost-budget.js';
import { assertWanxHostedEditPrompt, isAiImageEditProviderCanvasSupported, isGptImage2CountHostedProvider, isWanxHostedEdit } from './ai-image-edit-provider-contract.js';
import { assertWanxImageToImageInput, WANX_IMAGE_TO_IMAGE_PROMPT_PROFILE } from './ai-image-wanx-image-to-image.js';
import { canRunAiImageProviderOperation } from './ai-image-provider-admission.js';
import {isDonorGpt2SuiteProvider} from './ai-image-donor-gpt2-profile.js';
import {
  parseAiImageTranslationRuntime,
  type AiImageTranslationRuntimeContract,
} from './ai-image-translation-runtime-contract.js';

export const AI_MEDIA_WORKFLOW_PROVIDER = 'fake';
export const AI_MEDIA_WORKFLOW_MODEL = 'fake-image-to-image-v1';
export const AI_MEDIA_TRANSLATION_POLICY_VERSION = 'ai-image-translation-policy/1.0';

export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type AiMediaWorkflowContext =
  | {
    type: 'collect';
    id: string;
    skuKey?: string | null;
    slotKey?: string | null;
    revision?: never;
    draftVersion?: never;
  }
  | {
    type: 'listing-draft';
    id: string;
    skuKey?: string | null;
    slotKey?: string | null;
    revision: number;
    draftVersion: number;
  };

export interface AiMediaWorkflowRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  operation: AiMediaOperation;
  status: AiMediaWorkflowStatus;
  reviewStatus: AiMediaReviewStatus;
  revision: number;
  currentAttempt: number;
  contextType: string | null;
  contextId: string | null;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  contextDraftRevision: number | null;
  contextDraftVersion: number | null;
  /** Present only for internal routing; suite children are parent-owned. */
  suiteId?: string | null;
  idempotencyKey: string | null;
  requestFingerprint: string;
  selectedOutputAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  inputs?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  applicationMutations?: Array<Record<string, unknown>>;
  listingDraftApplicationMutations?: Array<Record<string, unknown>>;
}

export interface AiMediaWorkflowListCursor {
  createdAt: Date;
  id: string;
}

export interface AiMediaWorkflowPriorityCursor {
  updatedAt: Date;
  id: string;
  recentCutoff: Date;
}

export interface AiMediaWorkflowPriorityPage {
  items: AiMediaWorkflowRecord[];
  nextCursor: AiMediaWorkflowPriorityCursor | null;
}

export interface AiMediaWorkflowPage {
  items: AiMediaWorkflowRecord[];
  priorityItems?: AiMediaWorkflowRecord[];
  priorityItemsTruncated?: boolean;
  priorityNextCursor?: AiMediaWorkflowPriorityCursor | null;
  nextCursor: AiMediaWorkflowListCursor | null;
}

export interface AiMediaWorkflowPublicPage {
  items: AiMediaWorkflowRecord[];
  priorityItems: AiMediaWorkflowRecord[];
  priorityItemsTruncated: boolean;
  priorityNextCursor: string | null;
  nextCursor: string | null;
}

export interface AiMediaWorkflowPriorityPublicPage {
  items: AiMediaWorkflowRecord[];
  nextCursor: string | null;
}

interface AiMediaWorkflowListScope {
  ownerUserId: string;
  contextType?: string;
  contextId?: string;
}

export interface CreateAiMediaWorkflowInput {
  ownerUserId: string;
  actorUserId: string;
  sourceAssetId?: string;
  references?: Array<{ assetId: string }>;
  prompt: string;
  negativePrompt: string | null;
  resolvedPrompt?: string;
  resolvedNegativePrompt?: string;
  count: number;
  width: number;
  height: number;
  dailyLimit: number;
  provider?: string;
  model?: string;
  estimatedCostCents?: number;
  globalDailyBudgetCents?: number;
  providerRuntimeContract?: AiImageProviderRuntimeContract | null;
  idempotencyKey: string;
  context: AiMediaWorkflowContext;
}

export interface CreateAiImageTranslationWorkflowInput {
  ownerUserId: string;
  actorUserId: string;
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  terminologies: Array<{ src: string; tgt: string }>;
  imageSegment?: false;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
  globalDailyBudgetCents?: number;
  translationRuntimeContract?: AiImageTranslationRuntimeContract | null;
  prompt?: string | null;
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  idempotencyKey: string;
  context: AiMediaWorkflowContext;
}

export interface CreateAiImageEditWorkflowInput {
  ownerUserId: string;
  actorUserId: string;
  operation: 'FULL_EDIT' | 'INPAINT';
  sourceAssetId: string;
  width: number;
  height: number;
  maskAssetId?: string;
  maskSemantics?: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
  prompt: string;
  negativePrompt: string | null;
  resolvedPrompt: string;
  resolvedNegativePrompt: string;
  templateKey: string;
  templateReleaseId: string;
  templateChecksum: string;
  templateSnapshot: Record<string, unknown>;
  dailyLimit: number;
  provider?: string;
  model?: string;
  estimatedCostCents?: number;
  globalDailyBudgetCents?: number;
  providerRuntimeContract?: AiImageProviderRuntimeContract | null;
  idempotencyKey: string;
  context: AiMediaWorkflowContext;
}

type AiMediaProviderExecutionInput = Pick<
  CreateAiMediaWorkflowInput,
  'provider' | 'model' | 'estimatedCostCents' | 'globalDailyBudgetCents' | 'providerRuntimeContract'
>;

export interface AiMediaProviderExecutionConfig {
  provider: string;
  model: string;
  estimatedCostCents: number;
  globalDailyBudgetCents: number;
  providerRuntimeContract: AiImageProviderRuntimeContract | null;
  paid: boolean;
}

function providerRuntimeError(message: string): never {
  throw new AiMediaWorkflowError('PROVIDER_NOT_READY', message);
}

function normalizeProviderRuntimeContract(
  value: unknown,
  expected: {
    provider: string;
    model: string;
    estimatedCostCents: number;
    count: number;
    width?: number;
    height?: number;
  },
): AiImageProviderRuntimeContract {
  let runtime: AiImageProviderRuntimeContract;
  try {
    runtime = parseAiImageProviderRuntimeContract(value);
  } catch {
    return providerRuntimeError('A valid frozen Provider runtime contract is required before paid dispatch');
  }
  if (
    runtime.provider !== expected.provider
    || runtime.model !== expected.model
    || runtime.imageCount !== expected.count
    || (expected.width !== undefined && runtime.width !== expected.width)
    || (expected.height !== undefined && runtime.height !== expected.height)
    || runtime.maximumCostCents !== expected.estimatedCostCents
  ) {
    providerRuntimeError('Frozen Provider runtime contract does not match the requested operation');
  }
  return runtime;
}

export function normalizeAiMediaProviderExecutionConfig(
  input: AiMediaProviderExecutionInput,
  defaults: { provider: string; model: string },
  request: { count: number; width?: number; height?: number },
): AiMediaProviderExecutionConfig {
  const provider = String(input.provider ?? defaults.provider).trim();
  const model = String(input.model ?? defaults.model).trim();
  const estimatedCostCents = Number(input.estimatedCostCents ?? 0);
  const globalDailyBudgetCents = Number(input.globalDailyBudgetCents ?? 0);
  if (!provider || !model) providerRuntimeError('AI image Provider configuration is incomplete');
  if (!Number.isSafeInteger(estimatedCostCents) || estimatedCostCents < 0) {
    providerRuntimeError('AI image Provider cost estimate is invalid');
  }
  if (estimatedCostCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    providerRuntimeError('AI image Provider cost estimate exceeds the supported safety bound');
  }
  if (!Number.isSafeInteger(globalDailyBudgetCents)
    || globalDailyBudgetCents < 0
    || globalDailyBudgetCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
    providerRuntimeError('Global daily AI budget is invalid');
  }
  const paid = provider !== 'fake';
  if (!paid) {
    if (estimatedCostCents !== 0 || input.providerRuntimeContract != null) {
      providerRuntimeError('The fake AI image Provider must remain zero-cost without a runtime contract');
    }
    return {
      provider,
      model,
      estimatedCostCents: 0,
      globalDailyBudgetCents,
      providerRuntimeContract: null,
      paid: false,
    };
  }
  if (estimatedCostCents < 1) {
    providerRuntimeError('A verified positive task cost is required before paid dispatch');
  }
  return {
    provider,
    model,
    estimatedCostCents,
    globalDailyBudgetCents,
    providerRuntimeContract: normalizeProviderRuntimeContract(input.providerRuntimeContract, {
      provider,
      model,
      estimatedCostCents,
      count: request.count,
      width: request.width,
      height: request.height,
    }),
    paid: true,
  };
}

export function normalizeAiImageTranslationOptions(input: Pick<
  CreateAiImageTranslationWorkflowInput,
  'sourceLanguage' | 'targetLanguage' | 'domainHint' | 'terminologies' | 'imageSegment'
>) {
  const sourceLanguage = String(input.sourceLanguage || '').trim().toLowerCase();
  const targetLanguage = String(input.targetLanguage || '').trim().toLowerCase();
  if (
    !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(sourceLanguage)
    || !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(targetLanguage)
    || sourceLanguage === targetLanguage
  ) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation languages are invalid');
  }
  const userDomainHint = String(input.domainHint || '').trim();
  const terms = Array.isArray(input.terminologies)
    ? input.terminologies.map((term) => ({ src: String(term?.src || '').trim(), tgt: String(term?.tgt || '').trim() }))
    : [];
  if (
    terms.length > 50
    || terms.some((term) => !term.src || !term.tgt || term.src.length > 120 || term.tgt.length > 120)
    || new Set(terms.map((term) => term.src.toLocaleLowerCase())).size !== terms.length
  ) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation terminology is invalid');
  }
  if (input.imageSegment != null && input.imageSegment !== false) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation segmentation must remain disabled');
  }
  const policy = [
    'Translate only visible product marketing copy.',
    'Preserve product identity, layout, numbers, model codes, and standalone brand names.',
    userDomainHint,
  ].filter(Boolean).join('\n');
  if (Buffer.byteLength(policy, 'utf8') > 16_000) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Compiled image translation provider policy is too long');
  }
  return {
    sourceLanguage,
    targetLanguage,
    domainHint: policy,
    terminologies: terms,
    imageSegment: false as const,
    policyVersion: AI_MEDIA_TRANSLATION_POLICY_VERSION,
  };
}

export function normalizeAiMediaWorkflowReferences(
  input: Pick<CreateAiMediaWorkflowInput, 'sourceAssetId' | 'references'>,
) {
  if (input.sourceAssetId && input.references) {
    throw new AiMediaWorkflowError(
      'INVALID_REQUEST',
      'Use either sourceAssetId or references, not both',
    );
  }
  const references = input.references
    ? input.references.map((reference) => ({ assetId: String(reference?.assetId || '').trim() }))
    : input.sourceAssetId
      ? [{ assetId: input.sourceAssetId.trim() }]
      : [];
  if (!references.length || references.some((reference) => !reference.assetId)) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'At least one source reference is required');
  }
  if (new Set(references.map((reference) => reference.assetId)).size !== references.length) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Source references must be unique');
  }
  return references;
}

export interface AiMediaWorkflowRepository {
  createImageToImage(input: CreateAiMediaWorkflowInput): Promise<{
    kind: 'created' | 'existing' | 'conflict';
    workflow: AiMediaWorkflowRecord;
    jobId: string;
  }>;
  createImageTranslation?(input: CreateAiImageTranslationWorkflowInput & {
    options: ReturnType<typeof normalizeAiImageTranslationOptions>;
  }): Promise<{
    kind: 'created' | 'existing' | 'conflict';
    workflow: AiMediaWorkflowRecord;
    jobId: string;
  }>;
  createImageEdit?(input: CreateAiImageEditWorkflowInput): Promise<{
    kind: 'created' | 'existing' | 'conflict';
    workflow: AiMediaWorkflowRecord;
    jobId: string;
  }>;
  listOwned(input: {
    ownerUserId: string;
    contextType?: string;
    contextId?: string;
    limit: number;
    cursor?: AiMediaWorkflowListCursor | null;
    includePriority?: boolean;
  }): Promise<AiMediaWorkflowPage>;
  listPriorityOwned(input: {
    ownerUserId: string;
    contextType: string;
    contextId: string;
    limit: number;
    cursor?: AiMediaWorkflowPriorityCursor | null;
  }): Promise<AiMediaWorkflowPriorityPage>;
  getOwned(id: string, ownerUserId: string): Promise<AiMediaWorkflowRecord | null>;
  cancelOwned(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number): Promise<AiMediaWorkflowRecord | null>;
  retryOwned(input: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
    dailyLimit?: number;
    globalDailyBudgetCents?: number;
  }): Promise<{ workflow: AiMediaWorkflowRecord; jobId: string; replayed: boolean } | null>;
  reviewOwned(input: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    outputAssetId: string;
    decision: 'APPROVE' | 'REJECT';
    note: string | null;
    operationKey?: string;
  }): Promise<AiMediaWorkflowRecord | null>;
}

export class AiMediaWorkflowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiMediaWorkflowError';
  }
}

export function aiMediaPayloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function aiMediaWorkflowListScopeHash(scope: AiMediaWorkflowListScope, lane: 'history' | 'priority') {
  return aiMediaPayloadHash({
    lane,
    ownerUserId: scope.ownerUserId,
    contextType: scope.contextType || null,
    contextId: scope.contextId || null,
  });
}

export function encodeAiMediaWorkflowListCursor(
  scope: AiMediaWorkflowListScope,
  cursor: AiMediaWorkflowListCursor,
) {
  return Buffer.from(JSON.stringify({
    v: 1,
    l: 'history',
    c: cursor.createdAt.toISOString(),
    i: cursor.id,
    s: aiMediaWorkflowListScopeHash(scope, 'history'),
  }), 'utf8').toString('base64url');
}

export function decodeAiMediaWorkflowListCursor(
  scope: AiMediaWorkflowListScope,
  value: string,
): AiMediaWorkflowListCursor {
  try {
    if (!value || value.length > 1_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (!bytes.length || bytes.toString('base64url') !== value) throw new Error();
    const serialized = bytes.toString('utf8');
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    if (
      !payload
      || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'c,i,l,s,v'
      || payload.v !== 1
      || payload.l !== 'history'
      || typeof payload.c !== 'string'
      || typeof payload.i !== 'string'
      || !payload.i
      || payload.i.length > 200
      || typeof payload.s !== 'string'
      || payload.s !== aiMediaWorkflowListScopeHash(scope, 'history')
    ) throw new Error();
    const createdAt = new Date(payload.c);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== payload.c) throw new Error();
    if (serialized !== JSON.stringify({
      v: 1,
      l: 'history',
      c: payload.c,
      i: payload.i,
      s: payload.s,
    })) throw new Error();
    return { createdAt, id: payload.i };
  } catch {
    throw new AiMediaWorkflowError('INVALID_CURSOR', 'AI media workflow cursor is invalid for this history');
  }
}

export function encodeAiMediaWorkflowPriorityCursor(
  scope: AiMediaWorkflowListScope,
  cursor: AiMediaWorkflowPriorityCursor,
) {
  return Buffer.from(JSON.stringify({
    v: 1,
    l: 'priority',
    u: cursor.updatedAt.toISOString(),
    i: cursor.id,
    r: cursor.recentCutoff.toISOString(),
    s: aiMediaWorkflowListScopeHash(scope, 'priority'),
  }), 'utf8').toString('base64url');
}

export function decodeAiMediaWorkflowPriorityCursor(
  scope: AiMediaWorkflowListScope,
  value: string,
): AiMediaWorkflowPriorityCursor {
  try {
    if (!value || value.length > 1_000 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (!bytes.length || bytes.toString('base64url') !== value) throw new Error();
    const serialized = bytes.toString('utf8');
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    if (
      !payload
      || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'i,l,r,s,u,v'
      || payload.v !== 1
      || payload.l !== 'priority'
      || typeof payload.u !== 'string'
      || typeof payload.i !== 'string'
      || !payload.i
      || payload.i.length > 200
      || typeof payload.r !== 'string'
      || typeof payload.s !== 'string'
      || payload.s !== aiMediaWorkflowListScopeHash(scope, 'priority')
    ) throw new Error();
    const updatedAt = new Date(payload.u);
    const recentCutoff = new Date(payload.r);
    if (
      Number.isNaN(updatedAt.getTime())
      || updatedAt.toISOString() !== payload.u
      || Number.isNaN(recentCutoff.getTime())
      || recentCutoff.toISOString() !== payload.r
    ) throw new Error();
    if (serialized !== JSON.stringify({
      v: 1,
      l: 'priority',
      u: payload.u,
      i: payload.i,
      r: payload.r,
      s: payload.s,
    })) throw new Error();
    return { updatedAt, id: payload.i, recentCutoff };
  } catch {
    throw new AiMediaWorkflowError('INVALID_CURSOR', 'AI media workflow cursor is invalid for this priority lane');
  }
}

export function createAiMediaWorkflowFingerprint(input: Omit<CreateAiMediaWorkflowInput, 'actorUserId' | 'idempotencyKey'>) {
  const references = normalizeAiMediaWorkflowReferences(input);
  const execution = normalizeAiMediaProviderExecutionConfig(input, {
    provider: AI_MEDIA_WORKFLOW_PROVIDER,
    model: AI_MEDIA_WORKFLOW_MODEL,
  }, { count: input.count, width: input.width, height: input.height });
  return aiMediaPayloadHash({
    operation: 'IMAGE_TO_IMAGE',
    ownerUserId: input.ownerUserId,
    ...(input.references
      ? { references }
      : { sourceAssetId: references[0]!.assetId }),
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    count: input.count,
    width: input.width,
    height: input.height,
    provider: execution.provider,
    model: execution.model,
    estimatedCostCents: execution.estimatedCostCents,
    providerRuntimeContract: execution.providerRuntimeContract,
    ...(isWanxHostedEdit(execution.provider, execution.model) ? {
      renderingProfile: WANX_IMAGE_TO_IMAGE_PROMPT_PROFILE,
      ...assertWanxImageToImageInput({ ...input, referenceCount: references.length }),
    } : {}),
    context: input.context,
  });
}

export function createAiImageTranslationWorkflowFingerprint(input: Omit<
  CreateAiImageTranslationWorkflowInput,
  'actorUserId' | 'idempotencyKey' | 'dailyLimit'
> & { options: ReturnType<typeof normalizeAiImageTranslationOptions> }) {
  return aiMediaPayloadHash({
    operation: 'IMAGE_TRANSLATE',
    ownerUserId: input.ownerUserId,
    sourceAssetId: input.sourceAssetId,
    sourceLanguage: input.options.sourceLanguage,
    targetLanguage: input.options.targetLanguage,
    domainHint: input.options.domainHint,
    terminologies: input.options.terminologies,
    imageSegment: false,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt || '',
    resolvedPrompt: input.resolvedPrompt || '',
    resolvedNegativePrompt: input.resolvedNegativePrompt || '',
    templateKey: input.templateKey || null,
    templateReleaseId: input.templateReleaseId || null,
    templateChecksum: input.templateChecksum || null,
    templateSnapshot: input.templateSnapshot || null,
    ...(input.translationRuntimeContract ? { translationRuntimeContract: input.translationRuntimeContract } : {}),
    context: input.context,
  });
}

export function createAiImageEditWorkflowFingerprint(
  input: Omit<CreateAiImageEditWorkflowInput, 'actorUserId' | 'idempotencyKey'>,
) {
  const execution = normalizeAiMediaProviderExecutionConfig(input, {
    provider: AI_IMAGE_EDIT_PROVIDER,
    model: AI_IMAGE_EDIT_MODEL,
  }, { count: 1, width: input.width, height: input.height });
  return aiMediaPayloadHash({
    operation: input.operation,
    ownerUserId: input.ownerUserId,
    sourceAssetId: input.sourceAssetId,
    width: input.width,
    height: input.height,
    maskAssetId: input.maskAssetId || null,
    maskSemantics: input.maskSemantics || null,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    resolvedPrompt: input.resolvedPrompt,
    resolvedNegativePrompt: input.resolvedNegativePrompt,
    templateKey: input.templateKey,
    templateReleaseId: input.templateReleaseId,
    templateChecksum: input.templateChecksum,
    templateSnapshot: input.templateSnapshot,
    provider: execution.provider,
    model: execution.model,
    estimatedCostCents: execution.estimatedCostCents,
    providerRuntimeContract: execution.providerRuntimeContract,
    context: input.context,
  });
}

export function createAiMediaWorkflowService(repository: AiMediaWorkflowRepository, options: {
  resolveCapability?: typeof resolveAiImageProviderCapability;
} = {}) {
  return {
    async createImageToImage(input: CreateAiMediaWorkflowInput) {
      if (!input.prompt.trim()) throw new AiMediaWorkflowError('INVALID_REQUEST', 'Prompt is required');
      if (input.count !== 1) throw new AiMediaWorkflowError('INVALID_REQUEST', 'The first image-to-image slice supports one output');
      if (!Number.isSafeInteger(input.dailyLimit) || input.dailyLimit < 0) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'AI image generation daily limit is invalid');
      }
      const references = normalizeAiMediaWorkflowReferences(input);
      if (isWanxHostedEdit(input.provider, input.model)) {
        input = { ...input, ...assertWanxImageToImageInput({ ...input, referenceCount: references.length }) };
      }
      const execution = normalizeAiMediaProviderExecutionConfig(input, {
        provider: AI_MEDIA_WORKFLOW_PROVIDER,
        model: AI_MEDIA_WORKFLOW_MODEL,
      }, { count: input.count, width: input.width, height: input.height });
      if (isDonorGpt2SuiteProvider(execution.provider,execution.model) && !isGptImage2CountHostedProvider(execution.provider, execution.model)) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY','The donor GPT2 profile requires its server-owned suite request contract');
      }
      if (isGptImage2CountHostedProvider(execution.provider, execution.model)
        && !isAiImageEditProviderCanvasSupported(execution.provider, execution.model, input.width, input.height)) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Count reference generation requires a supported output canvas');
      }
      try {
        const capability = assertAiMediaCapability({
          provider: execution.provider,
          model: execution.model,
          operation: 'IMAGE_TO_IMAGE',
          inputCount: references.length,
        }, options.resolveCapability);
        if (execution.paid && !canRunAiImageProviderOperation({
          capability, provider: execution.provider, model: execution.model,
          baseUrlSha256: execution.providerRuntimeContract?.baseUrlSha256,
          operation: 'IMAGE_TO_IMAGE', inputTransport: capability.inputTransport, resultMode: capability.resultMode,
        })) {
          throw new AiMediaWorkflowError(
            'PROVIDER_NOT_READY',
            'AI image Provider endpoint or request protocol is not supported',
          );
        }
      } catch (error) {
        if (error instanceof AiMediaCapabilityError) {
          throw new AiMediaWorkflowError(execution.paid ? 'PROVIDER_NOT_READY' : error.code, error.message);
        }
        throw error;
      }
      let result;
      try {
        result = await repository.createImageToImage(input);
      } catch (error: any) {
        if (error?.code === 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('AI_IMAGE_GENERATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'BUDGET_EXCEEDED') {
          throw new AiMediaWorkflowError('BUDGET_EXCEEDED', error.message);
        }
        throw error;
      }
      if (result.kind === 'conflict') {
        throw new AiMediaWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was used for another media workflow');
      }
      return { workflow: result.workflow, jobId: result.jobId, replayed: result.kind === 'existing' };
    },

    async createImageTranslation(input: CreateAiImageTranslationWorkflowInput) {
      if (!input.sourceAssetId?.trim()) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'A source asset is required for image translation');
      }
      if (!input.provider?.trim() || !input.model?.trim()) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Image translation provider configuration is incomplete');
      }
      if (!Number.isSafeInteger(input.dailyLimit) || input.dailyLimit < 0) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation daily limit is invalid');
      }
      if (!Number.isSafeInteger(input.estimatedCostCents) || input.estimatedCostCents < 0) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation cost estimate is invalid');
      }
      const globalDailyBudgetCents = Number(input.globalDailyBudgetCents ?? 0);
      if (!Number.isSafeInteger(globalDailyBudgetCents)
        || globalDailyBudgetCents < 0
        || globalDailyBudgetCents > AI_GLOBAL_COST_BUDGET_MAX_MINOR) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Global daily AI budget is invalid');
      }
      if (input.provider !== 'fake' && input.estimatedCostCents <= 0) {
        throw new AiMediaWorkflowError(
          'PROVIDER_NOT_READY',
          'A verified positive image translation cost is required before paid dispatch',
        );
      }
      const translationOptions = normalizeAiImageTranslationOptions(input);
      try {
        const capability = assertAiMediaCapability({
          provider: input.provider,
          model: input.model,
          operation: 'IMAGE_TRANSLATE',
          inputCount: 1,
        }, options.resolveCapability);
        if (input.provider !== 'fake') {
          let runtime: AiImageTranslationRuntimeContract;
          try { runtime = parseAiImageTranslationRuntime(input.translationRuntimeContract); }
          catch { throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Paid image translation requires a frozen endpoint, credential and price'); }
          if (runtime.provider !== input.provider || runtime.model !== input.model
            || runtime.maximumCostCents !== input.estimatedCostCents
            || !hasExactAiMediaSandboxEvidence({ capability, provider: input.provider, model: input.model,
              baseUrl: 'https://dashscope.aliyuncs.com/api/v1', operation: 'IMAGE_TRANSLATE',
              inputTransport: 'public_url', resultMode: 'async' })) {
          throw new AiMediaWorkflowError(
            'PROVIDER_NOT_READY',
            'Image translation provider has not passed its sandbox capability gate',
          );
          }
        } else if (input.estimatedCostCents !== 0 || input.translationRuntimeContract != null) {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Fake image translation must have zero cost and no paid runtime');
        }
      } catch (error) {
        if (error instanceof AiMediaCapabilityError) {
          throw new AiMediaWorkflowError(error.code, error.message);
        }
        throw error;
      }
      if (!repository.createImageTranslation) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Image translation workflow is not installed');
      }
      let result;
      try {
        result = await repository.createImageTranslation({ ...input, options: translationOptions });
      } catch (error: any) {
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        if (error?.code === 'STALE_MEDIA_WORKFLOW') {
          throw new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', error.message);
        }
        if (error?.code === 'BUDGET_EXCEEDED') {
          throw new AiMediaWorkflowError('BUDGET_EXCEEDED', error.message);
        }
        throw error;
      }
      if (result.kind === 'conflict') {
        throw new AiMediaWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was used for another media workflow');
      }
      return { workflow: result.workflow, jobId: result.jobId, replayed: result.kind === 'existing' };
    },

    async createImageEdit(input: CreateAiImageEditWorkflowInput) {
      assertWanxHostedEditPrompt(input);
      const sourceAssetId = String(input.sourceAssetId || '').trim();
      const maskAssetId = String(input.maskAssetId || '').trim();
      const expectedTemplateKey = input.operation === 'FULL_EDIT'
        ? AI_MEDIA_FULL_EDIT_TEMPLATE_KEY
        : AI_MEDIA_INPAINT_TEMPLATE_KEY;
      if (
        !sourceAssetId
        || !Number.isSafeInteger(input.width)
        || input.width < 1
        || !Number.isSafeInteger(input.height)
        || input.height < 1
        || !input.prompt.trim()
        || !input.resolvedPrompt.trim()
        || input.templateKey !== expectedTemplateKey
        || !input.templateReleaseId.trim()
        || !/^[a-f0-9]{64}$/u.test(input.templateChecksum)
        || !input.templateSnapshot
        || Array.isArray(input.templateSnapshot)
        || typeof input.templateSnapshot !== 'object'
        || !Number.isSafeInteger(input.dailyLimit)
        || input.dailyLimit < 0
      ) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'AI image edit request or frozen Prompt is invalid');
      }
      if (
        (input.operation === 'FULL_EDIT' && (maskAssetId || input.maskSemantics != null))
        || (input.operation === 'INPAINT'
          && (!maskAssetId || input.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS))
      ) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'AI image edit mask contract is invalid');
      }
      const execution = normalizeAiMediaProviderExecutionConfig(input, {
        provider: AI_IMAGE_EDIT_PROVIDER,
        model: AI_IMAGE_EDIT_MODEL,
      }, { count: 1, width: input.width, height: input.height });
      if (isGptImage2CountHostedProvider(execution.provider, execution.model)
        && !isAiImageEditProviderCanvasSupported(execution.provider, execution.model, input.width, input.height)) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Count editing requires a supported unchanged source canvas');
      }
      try {
        const capability = assertAiMediaCapability({
          provider: execution.provider,
          model: execution.model,
          operation: input.operation,
          inputCount: 1,
          maskCount: input.operation === 'INPAINT' ? 1 : 0,
        }, options.resolveCapability);
        if (execution.paid && !canRunAiImageProviderOperation({
          capability, provider: execution.provider, model: execution.model,
          baseUrlSha256: execution.providerRuntimeContract?.baseUrlSha256,
          operation: input.operation, inputTransport: capability.inputTransport, resultMode: capability.resultMode,
        })) {
          throw new AiMediaWorkflowError(
            'PROVIDER_NOT_READY',
            'AI image Provider endpoint or request protocol is not supported',
          );
        }
      } catch (error) {
        if (error instanceof AiMediaCapabilityError) {
          throw new AiMediaWorkflowError(execution.paid ? 'PROVIDER_NOT_READY' : error.code, error.message);
        }
        throw error;
      }
      if (!repository.createImageEdit) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'AI image edit workflow is not installed');
      }
      let result;
      try {
        result = await repository.createImageEdit({
          ...input,
          sourceAssetId,
          ...(input.operation === 'INPAINT' ? { maskAssetId } : { maskAssetId: undefined }),
        });
      } catch (error: any) {
        if (error?.code === 'AI_IMAGE_EDIT_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('AI_IMAGE_EDIT_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'BUDGET_EXCEEDED') {
          throw new AiMediaWorkflowError('BUDGET_EXCEEDED', error.message);
        }
        throw error;
      }
      if (result.kind === 'conflict') {
        throw new AiMediaWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was used for another media workflow');
      }
      return { workflow: result.workflow, jobId: result.jobId, replayed: result.kind === 'existing' };
    },

    async list(input: {
      ownerUserId: string;
      contextType?: string;
      contextId?: string;
      limit?: number;
      cursor?: string;
      includePriority?: boolean;
    }): Promise<AiMediaWorkflowPublicPage> {
      const scope = {
        ownerUserId: input.ownerUserId,
        contextType: input.contextType,
        contextId: input.contextId,
      };
      const page = await repository.listOwned({
        ...scope,
        limit: Math.min(100, Math.max(1, input.limit || 20)),
        cursor: input.cursor ? decodeAiMediaWorkflowListCursor(scope, input.cursor) : null,
        includePriority: input.includePriority === true && !input.cursor,
      });
      return {
        items: page.items,
        priorityItems: page.priorityItems || [],
        priorityItemsTruncated: page.priorityItemsTruncated === true,
        priorityNextCursor: page.priorityNextCursor
          ? encodeAiMediaWorkflowPriorityCursor(scope, page.priorityNextCursor)
          : null,
        nextCursor: page.nextCursor
          ? encodeAiMediaWorkflowListCursor(scope, page.nextCursor)
          : null,
      };
    },

    async listPriority(input: {
      ownerUserId: string;
      contextType: string;
      contextId: string;
      limit?: number;
      cursor?: string;
    }): Promise<AiMediaWorkflowPriorityPublicPage> {
      const scope = {
        ownerUserId: input.ownerUserId,
        contextType: input.contextType,
        contextId: input.contextId,
      };
      const page = await repository.listPriorityOwned({
        ...scope,
        limit: Math.min(100, Math.max(1, input.limit || 100)),
        cursor: input.cursor ? decodeAiMediaWorkflowPriorityCursor(scope, input.cursor) : null,
      });
      return {
        items: page.items,
        nextCursor: page.nextCursor
          ? encodeAiMediaWorkflowPriorityCursor(scope, page.nextCursor)
          : null,
      };
    },

    async get(id: string, ownerUserId: string) {
      const workflow = await repository.getOwned(id, ownerUserId);
      if (!workflow) throw new AiMediaWorkflowError('NOT_FOUND', 'AI media workflow not found');
      return workflow;
    },

    async cancel(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number) {
      const workflow = await repository.cancelOwned(id, ownerUserId, actorUserId, expectedRevision);
      if (!workflow) throw new AiMediaWorkflowError('WORKFLOW_CONFLICT', 'Workflow changed or cannot be cancelled');
      return workflow;
    },

    async retry(input: Parameters<AiMediaWorkflowRepository['retryOwned']>[0]) {
      let result;
      try {
        result = await repository.retryOwned(input);
      } catch (error: any) {
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        if (error?.code === 'AI_IMAGE_EDIT_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('AI_IMAGE_EDIT_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'AI_IMAGE_EDIT_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        if (error?.code === 'AI_IMAGE_GENERATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('AI_IMAGE_GENERATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'AI_IMAGE_GENERATION_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        if (error?.code === 'BUDGET_EXCEEDED') {
          throw new AiMediaWorkflowError('BUDGET_EXCEEDED', error.message);
        }
        if (error?.code === 'STALE_MEDIA_WORKFLOW') {
          throw new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', error.message);
        }
        throw error;
      }
      if (!result) {
        throw new AiMediaWorkflowError(
          'RECOVERY_REQUIRED',
          'Workflow changed, is not retryable, or has a submitted provider task that must be reconciled',
        );
      }
      return result;
    },

    async review(input: Parameters<AiMediaWorkflowRepository['reviewOwned']>[0]) {
      let workflow;
      try {
        workflow = await repository.reviewOwned(input);
      } catch (error: any) {
        if (error?.code === 'STALE_MEDIA_WORKFLOW') {
          throw new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', error.message);
        }
        throw error;
      }
      if (!workflow) throw new AiMediaWorkflowError('WORKFLOW_CONFLICT', 'Workflow changed or output cannot be reviewed');
      return workflow;
    },
  };
}

export type AiMediaWorkflowService = ReturnType<typeof createAiMediaWorkflowService>;
