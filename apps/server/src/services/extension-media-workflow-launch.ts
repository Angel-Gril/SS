import { AiMediaWorkflowError, type AiMediaWorkflowService } from './ai-media-workflows.js';
import {
  AI_MEDIA_FULL_EDIT_TEMPLATE_KEY,
  AI_MEDIA_INPAINT_TEMPLATE_KEY,
  AI_MEDIA_TRANSLATION_TEMPLATE_KEY,
} from './ai-prompt-templates.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from './ai-image-compositor.js';
import { buildAiImageGenerationQuote } from './ai-image-generation-quote.js';
import {
  AiImageProviderRuntimeContractError,
  bindAiImageProviderExecutionConfig,
  parseAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeContract,
  type AiImageProviderRuntimeIdentity,
  type AiImageProviderCurrency,
  type AiImageProviderCredentialRevision,
} from './ai-image-provider-runtime-contract.js';
import { resolveAiImageTranslationGlossary } from './ai-image-translation-glossary.js';
import { canRunAiImageProviderOperation } from './ai-image-provider-admission.js';
import { resolveAiImageProviderCapability } from './ai-image-provider-capabilities.js';
import { isAiImageEditProviderCanvasSupported, resolveAiImageEditProviderContract } from './ai-image-edit-provider-contract.js';
import type { AiImageEditStorageReadiness } from './ai-image-edit-storage.js';
import type { AiPromptRenderingProfile } from './ai-image-edit-prompt-contract.js';
import type { SourceListingAiMediaTarget } from 'shared/ozon-listing-draft';
import {
  aiImageTranslationRuntimePrice, assertAiImageTranslationRuntime, buildAiImageTranslationRuntime,
  parseAiImageTranslationRuntime, resolvePaidAiImageTranslationReadiness,
  type AiImageTranslationPrice, type AiImageTranslationPriceConfirmation,
  type AiImageTranslationRuntimeContract,
} from './ai-image-translation-runtime-contract.js';
import type { AiImageTranslationStorageReadiness } from './ai-image-translation-storage.js';

/**
 * Creation is deliberately a separate command contract from the B1 cancel/retry
 * contract.  The extension supplies only a source media key and an intent key;
 * all provider-facing values are resolved on the server.
 */
export const EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION =
  'ai-media-workflow-create/v1' as const;
export const EXTENSION_MEDIA_WORKFLOW_CREATE_VERSION =
  'ai-media-workflow-create/v2' as const;

export interface ExtensionMediaTranslationCreateCommand extends Record<string, unknown> {
  schemaVersion: typeof EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION;
  action: 'CREATE_TRANSLATION';
  sourceMediaKey: string;
  draftRevision: number;
  workflowOperationKey: string;
  priceConfirmation?: AiImageTranslationPriceConfirmation;
}

interface ExtensionMediaWorkflowCreateBase extends Record<string, unknown> {
  schemaVersion: typeof EXTENSION_MEDIA_WORKFLOW_CREATE_VERSION;
  action: 'CREATE_WORKFLOW';
  sourceMediaKeys: string[];
  prompt: string;
  negativePrompt: string;
  draftRevision: number;
  workflowOperationKey: string;
  target?: SourceListingAiMediaTarget;
}

export type ExtensionMediaWorkflowCreateCommand =
  | (ExtensionMediaWorkflowCreateBase & {
    operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT';
    maskAssetId?: never;
    maskSemantics?: never;
  })
  | (ExtensionMediaWorkflowCreateBase & {
    operation: 'INPAINT';
    maskAssetId: string;
    maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
  });

export interface ExtensionMediaTranslationLaunchContext {
  id: string;
  ownerUserId: string;
  shopId: string;
  supplyGoodsId: string;
  snapshotId: string;
  revision: number;
  draftVersion: number;
  sourceMediaKeys: string[];
  sourceInputs?: Array<{
    sourceMediaKey: string;
    role: string;
    scope: 'PRODUCT' | 'SKU';
    skuKeys: string[];
  }>;
  category?: { categoryId: number; typeId: number };
  target?: SourceListingAiMediaTarget;
}

export interface ExtensionMediaTranslationSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
  globalDailyBudgetCents?: number;
  categoryGlossaryJson: string;
  baseUrl?: string;
  hasApiKey?: boolean;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

export interface ExtensionMediaTranslationReadiness {
  enabled: boolean;
  ready: boolean;
  reasonCode: string;
  reason: string;
  testOnly: boolean;
  price?: AiImageTranslationPrice;
}

export interface ExtensionMediaTranslationExistingWorkflow {
  id: string;
  ownerUserId: string;
  operation: string;
  provider: string | null;
  model: string | null;
  status: string;
  revision: number;
  contextType: string | null;
  contextId: string | null;
  contextDraftRevision: number | null;
  contextDraftVersion: number | null;
  suiteId?: string | null;
  sourceMediaKey: string | null;
  jobId: string | null;
  estimatedCostCents?: number | null;
  translationRuntimeContract?: AiImageTranslationRuntimeContract | null;
}

export interface ExtensionMediaStandaloneExistingWorkflow
  extends ExtensionMediaTranslationExistingWorkflow {
  sourceMediaKeys?: string[];
  maskAssetId?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  estimatedCostCents?: number | null;
  providerRuntimeContract?: AiImageProviderRuntimeContract | null;
  contextSkuKey?: string | null;
  contextSlotKey?: string | null;
}

export class ExtensionMediaWorkflowLaunchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionMediaWorkflowLaunchError';
  }
}

function assertReplayableWorkflowStatus(status: string, workflowLabel: string): void {
  if (status === 'FAILED') {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_CREATE_ALREADY_FAILED',
      `The existing ${workflowLabel} failed; retry that workflow instead of creating it again`,
    );
  }
  if (status === 'CANCEL_REQUESTED' || status === 'CANCELLED') {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_CREATE_ALREADY_CANCELLED',
      `The existing ${workflowLabel} was cancelled and cannot be reported as newly created`,
    );
  }
}

function assertAuthoritativeEnqueueRecoveryStatus(status: string, workflowLabel: string): void {
  assertReplayableWorkflowStatus(status, workflowLabel);
  if (status === 'QUEUED') {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_QUEUE_UNAVAILABLE',
      `The ${workflowLabel} remains queued after queue submission failed`,
    );
  }
  if (status !== 'RUNNING' && status !== 'SUCCEEDED') {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_CREATE_STATE_UNAVAILABLE',
      `The authoritative ${workflowLabel} state is unavailable`,
    );
  }
}

/**
 * These errors mean that the caller's listing snapshot is no longer usable.
 * Infrastructure failures deliberately stay outside this list so callers can
 * retry as an unavailable service instead of being told to refresh a draft.
 */
export function isExtensionMediaContextStaleError(error: unknown): boolean {
  const code = error && typeof error === 'object'
    ? String((error as { code?: unknown }).code || '')
    : '';
  return [
    'AI_MEDIA_CONTEXT_NOT_FOUND',
    'STALE_MEDIA_CONTEXT',
    'SOURCE_MEDIA_NOT_FOUND',
    'SOURCE_ASSET_CONFLICT',
    'OZON_LISTING_DRAFT_NOT_FOUND',
    'OZON_LISTING_DRAFT_VERSION_CONFLICT',
  ].includes(code);
}

export function resolveExtensionMediaWorkflowSourceMediaKey(asset: {
  sourceMediaKey?: unknown;
  metadata?: unknown;
} | null | undefined): string | null {
  const metadata = asset?.metadata
    && typeof asset.metadata === 'object'
    && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, unknown>
    : null;
  const candidates = [metadata?.originalSourceMediaKey, asset?.sourceMediaKey];
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    const normalized = value.normalize('NFKC').trim();
    if (normalized && normalized === value && normalized.length <= 500) return normalized;
  }
  return null;
}

function normalizedIdentifier(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', `${field} is invalid`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', `${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', `${field} is invalid`);
  }
  return Number(value);
}

function normalizedPrompt(value: unknown, field: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', `${field} is invalid`);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized !== value || normalized.length > maxLength || (!allowEmpty && !normalized)) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', `${field} is invalid`);
  }
  return normalized;
}

export function parseExtensionMediaWorkflowCreateCommand(
  value: Record<string, unknown>,
): ExtensionMediaWorkflowCreateCommand | null {
  if (value?.schemaVersion !== EXTENSION_MEDIA_WORKFLOW_CREATE_VERSION) return null;
  const operation = String(value.operation || '');
  if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)
    || value.action !== 'CREATE_WORKFLOW') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation action is invalid');
  }
  const commonKeys = [
    'schemaVersion', 'action', 'operation', 'sourceMediaKeys', 'prompt', 'negativePrompt',
    'draftRevision', 'workflowOperationKey', 'target',
  ];
  const allowed = new Set(operation === 'INPAINT'
    ? [...commonKeys, 'maskAssetId', 'maskSemantics']
    : commonKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation command contains unknown fields');
  }
  if (!Array.isArray(value.sourceMediaKeys)) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'sourceMediaKeys is invalid');
  }
  const maximum = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
  if (value.sourceMediaKeys.length < 1 || value.sourceMediaKeys.length > maximum) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'sourceMediaKeys is invalid');
  }
  const sourceMediaKeys = value.sourceMediaKeys.map((item) => (
    normalizedIdentifier(item, 'sourceMediaKey', 500)
  ));
  if (new Set(sourceMediaKeys).size !== sourceMediaKeys.length) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'sourceMediaKeys must be unique');
  }
  const base = {
    schemaVersion: EXTENSION_MEDIA_WORKFLOW_CREATE_VERSION,
    action: 'CREATE_WORKFLOW' as const,
    sourceMediaKeys,
    prompt: normalizedPrompt(value.prompt, 'prompt', 8_000),
    negativePrompt: normalizedPrompt(value.negativePrompt, 'negativePrompt', 4_000, true),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    workflowOperationKey: normalizedIdentifier(value.workflowOperationKey, 'workflowOperationKey', 128),
    ...(value.target === undefined ? {} : { target: parseExtensionMediaWorkflowTarget(value.target) }),
  };
  if (operation !== 'INPAINT') {
    return { ...base, operation: operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' };
  }
  if (value.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'maskSemantics is invalid');
  }
  return {
    ...base,
    operation: 'INPAINT',
    maskAssetId: normalizedIdentifier(value.maskAssetId, 'maskAssetId', 200),
    maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
  };
}

export function parseExtensionMediaWorkflowTarget(value: unknown): SourceListingAiMediaTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'skuKey,slotKey') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media target is invalid');
  }
  const target = value as Record<string, unknown>;
  return {
    skuKey: target.skuKey === null ? null : normalizedIdentifier(target.skuKey, 'target SKU', 500),
    slotKey: normalizedIdentifier(target.slotKey, 'target slot', 200),
  };
}

export function extensionMediaWorkflowTargetMatches(
  requested: SourceListingAiMediaTarget | undefined,
  current: SourceListingAiMediaTarget | undefined,
): boolean {
  return requested === undefined ? current === undefined : Boolean(current
    && requested.skuKey === current.skuKey && requested.slotKey === current.slotKey);
}

export function parseExtensionMediaTranslationCreateCommand(
  value: Record<string, unknown>,
): ExtensionMediaTranslationCreateCommand | null {
  if (value?.schemaVersion !== EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION) return null;
  const allowed = new Set([
    'schemaVersion', 'action', 'sourceMediaKey', 'draftRevision', 'workflowOperationKey', 'priceConfirmation',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation command contains unknown fields');
  }
  if (value.action !== 'CREATE_TRANSLATION') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation action is invalid');
  }
  let priceConfirmation: AiImageTranslationPriceConfirmation | undefined;
  if (value.priceConfirmation !== undefined) {
    const confirmation = value.priceConfirmation && typeof value.priceConfirmation === 'object'
      && !Array.isArray(value.priceConfirmation) ? value.priceConfirmation as Record<string, unknown> : {};
    if (Object.keys(confirmation).sort().join(',') !== 'currency,maximumCostCents,quoteFingerprint'
      || !['CNY', 'USD'].includes(String(confirmation.currency))
      || !Number.isSafeInteger(confirmation.maximumCostCents) || Number(confirmation.maximumCostCents) < 1
      || !/^[a-f0-9]{64}$/u.test(String(confirmation.quoteFingerprint))) {
      throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Image translation price confirmation is invalid');
    }
    priceConfirmation = { currency: confirmation.currency as AiImageProviderCurrency,
      maximumCostCents: Number(confirmation.maximumCostCents), quoteFingerprint: String(confirmation.quoteFingerprint) };
  }
  return {
    schemaVersion: EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION,
    action: 'CREATE_TRANSLATION',
    sourceMediaKey: normalizedIdentifier(value.sourceMediaKey, 'sourceMediaKey', 500),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    workflowOperationKey: normalizedIdentifier(value.workflowOperationKey, 'workflowOperationKey', 128),
    ...(priceConfirmation ? { priceConfirmation } : {}),
  };
}

export function resolveExtensionMediaTranslationReadiness(input: {
  settings: ExtensionMediaTranslationSettings,
  production: boolean;
  storageReadiness?: AiImageTranslationStorageReadiness;
}, resolveCapability = resolveAiImageProviderCapability): ExtensionMediaTranslationReadiness {
  const { settings, production, storageReadiness } = input;
  if (settings.provider !== 'fake') return resolvePaidAiImageTranslationReadiness(settings, storageReadiness, resolveCapability);
  if (production) return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
    reason: 'Fake image translation is disabled in production',
    testOnly: true,
  };
  if (!settings.enabled) return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_CREATE_DISABLED',
    reason: 'Image translation is disabled',
    testOnly: true,
  };
  if (typeof settings.model !== 'string' || !settings.model.trim()) return {
    enabled: true,
    ready: false,
    reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
    reason: 'Image translation model configuration is incomplete',
    testOnly: true,
  };
  if (!Number.isSafeInteger(settings.dailyLimit) || settings.dailyLimit < 0
    || !Number.isSafeInteger(settings.estimatedCostCents) || settings.estimatedCostCents !== 0) return {
    enabled: true,
    ready: false,
    reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
    reason: 'Fake image translation must have a zero cost configuration',
    testOnly: true,
  };
  if (storageReadiness && !storageReadiness.ready) return {
    enabled: true,
    ready: false,
    reasonCode: 'MEDIA_STORAGE_NOT_READY',
    reason: storageReadiness.reason,
    testOnly: true,
  };
  return {
    enabled: true,
    ready: true,
    reasonCode: 'READY',
    reason: 'AI image translation test workflow is ready',
    testOnly: true,
  };
}

function assertTranslationSettings(
  settings: ExtensionMediaTranslationSettings,
  production: boolean,
  storageReadiness?: AiImageTranslationStorageReadiness,
  resolveCapability = resolveAiImageProviderCapability,
) {
  const readiness = resolveExtensionMediaTranslationReadiness({
    settings,
    production,
    storageReadiness,
  }, resolveCapability);
  if (readiness.ready) return;
  throw new ExtensionMediaWorkflowLaunchError(readiness.reasonCode, readiness.reason);
}

export function createExtensionMediaTranslationLauncher(options: {
  workflowService: Pick<AiMediaWorkflowService, 'createImageTranslation'>;
  loadContext(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
  }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  loadExisting?(input: {
    ownerUserId: string;
    idempotencyKey: string;
  }): Promise<ExtensionMediaTranslationExistingWorkflow | null>;
  internalizeSource(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    sourceMediaKey: string;
    draftRevision: number;
    draftVersion: number;
  }): Promise<{ id: string }>;
  getSettings(): Promise<ExtensionMediaTranslationSettings>;
  getStorageReadiness?(): Promise<AiImageTranslationStorageReadiness>;
  resolveCapability?: typeof resolveAiImageProviderCapability;
  resolvePrompt(input: {
    templateKey: string;
    variables: Record<string, string>;
  }): Promise<{
    templateKey: string;
    release: { id: string };
    checksum: string;
    snapshot: Record<string, unknown>;
    resolvedPrompt: string;
    resolvedNegativePrompt: string;
  }>;
  enqueue(jobId: string): Promise<void>;
  markEnqueueFailed(jobId: string): Promise<boolean>;
  production?: boolean;
}) {
  return async (input: {
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }) => {
    const command = parseExtensionMediaTranslationCreateCommand(input.command);
    if (!command) {
      throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation command is invalid');
    }
    const loadExisting = options.loadExisting;
    const loadExistingWorkflow = async () => {
      if (!loadExisting) return null;
      try {
        return await loadExisting({
          ownerUserId: input.ownerUserId,
          idempotencyKey: command.workflowOperationKey,
        });
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_STATE_UNAVAILABLE',
          'Existing media workflow state is temporarily unavailable',
        );
      }
    };
    const loadReadiness = async () => {
      try {
        const settings = await options.getSettings();
        const storageReadiness = options.getStorageReadiness
          ? await options.getStorageReadiness()
          : undefined;
        return { settings, storageReadiness };
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CAPABILITY_UNAVAILABLE',
          'Image translation capability is temporarily unavailable',
        );
      }
    };
    const assertReadiness = (readiness: Awaited<ReturnType<typeof loadReadiness>>) => {
      assertTranslationSettings(
        readiness.settings,
        options.production ?? process.env.NODE_ENV === 'production',
        readiness.storageReadiness,
        options.resolveCapability,
      );
    };
    const ensureReadiness = async () => {
      const readiness = await loadReadiness();
      assertReadiness(readiness);
      return readiness.settings;
    };
    const markEnqueueFailed = async (jobId: string) => {
      try {
        return await options.markEnqueueFailed(jobId);
      } catch {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_STATE_UNAVAILABLE',
          'Media workflow state is temporarily unavailable',
        );
      }
    };
    const enqueueOrMarkFailed = async (jobId: string): Promise<boolean> => {
      try {
        await options.enqueue(jobId);
        return true;
      } catch {
        const markedFailed = await markEnqueueFailed(jobId);
        if (markedFailed) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'Media queue is temporarily unavailable',
          );
        }
        return false;
      }
    };
    const assertMatchingWorkflow = (candidate: ExtensionMediaTranslationExistingWorkflow) => {
      if (candidate.ownerUserId !== input.ownerUserId
        || candidate.operation !== 'IMAGE_TRANSLATE'
        || candidate.contextType !== 'listing-draft'
        || candidate.contextId !== input.listingWorkflowId
        || candidate.contextDraftRevision !== command.draftRevision
        || candidate.contextDraftVersion !== input.draftVersion
        || candidate.suiteId != null
        || candidate.sourceMediaKey !== command.sourceMediaKey) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
          'Image translation intent is bound to another source or draft context',
        );
      }
      if (candidate.provider !== 'fake') {
        let frozen: AiImageTranslationRuntimeContract;
        try {
          frozen = parseAiImageTranslationRuntime(candidate.translationRuntimeContract);
          if (frozen.provider !== candidate.provider || frozen.model !== candidate.model
            || frozen.maximumCostCents !== candidate.estimatedCostCents) throw new Error();
        } catch {
          throw new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_CONFIG_CHANGED', 'The frozen image translation runtime is missing or invalid');
        }
        assertPriceConfirmation(aiImageTranslationRuntimePrice(frozen));
      }
    };
    const assertPriceConfirmation = (price: AiImageTranslationPrice) => {
      const confirmation = command.priceConfirmation;
      if (!confirmation || confirmation.currency !== price.currency
        || confirmation.maximumCostCents !== price.maximumCostCents
        || confirmation.quoteFingerprint !== price.quoteFingerprint) {
        throw new ExtensionMediaWorkflowLaunchError('MEDIA_PRICE_CONFIRMATION_REQUIRED', 'Confirm the current single-image translation price before creating paid work');
      }
    };
    const resultFor = (candidate: ExtensionMediaTranslationExistingWorkflow) => ({
      workflowId: candidate.id,
      action: 'CREATE_TRANSLATION' as const,
      operation: 'IMAGE_TRANSLATE' as const,
      status: candidate.status,
      revision: candidate.revision,
      replayed: true,
      ...(candidate.translationRuntimeContract ? { price: aiImageTranslationRuntimePrice(parseAiImageTranslationRuntime(candidate.translationRuntimeContract)) } : {}),
    });
    const recoverEnqueueRace = async () => {
      const authoritative = await loadExistingWorkflow();
      if (!authoritative) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_STATE_UNAVAILABLE',
          'Authoritative media workflow state is temporarily unavailable',
        );
      }
      assertMatchingWorkflow(authoritative);
      assertAuthoritativeEnqueueRecoveryStatus(authoritative.status, 'image translation');
      return resultFor(authoritative);
    };
    const existing = await loadExistingWorkflow();
    const replayExisting = async (candidate: ExtensionMediaTranslationExistingWorkflow) => {
      assertMatchingWorkflow(candidate);
      assertReplayableWorkflowStatus(candidate.status, 'image translation');
      if (candidate.status === 'QUEUED') {
        const settings = await ensureReadiness();
        if (candidate.provider !== settings.provider || candidate.model !== settings.model) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_PROVIDER_CONFIG_CHANGED',
            'The frozen image translation provider configuration changed',
          );
        }
        if (candidate.provider !== 'fake') {
          try { assertAiImageTranslationRuntime(candidate.translationRuntimeContract, settings, Number(candidate.estimatedCostCents)); }
          catch { throw new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_CONFIG_CHANGED', 'The frozen image translation endpoint, credential or price changed'); }
        }
        if (!candidate.jobId) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'The queued media workflow has no recoverable job',
          );
        }
        const submitted = await enqueueOrMarkFailed(candidate.jobId);
        if (!submitted) return recoverEnqueueRace();
      }
      return resultFor(candidate);
    };
    if (existing) return replayExisting(existing);

    const readiness = await loadReadiness();
    const settings = readiness.settings;
    const requiresPaidGlossary = settings.enabled
      && settings.provider !== 'disabled'
      && settings.provider !== 'fake';
    if (!requiresPaidGlossary) assertReadiness(readiness);

    let context: ExtensionMediaTranslationLaunchContext | null;
    try {
      context = await options.loadContext({
        ownerUserId: input.ownerUserId,
        listingWorkflowId: input.listingWorkflowId,
        draftRevision: command.draftRevision,
        draftVersion: input.draftVersion,
      });
    } catch (error) {
      if (isExtensionMediaContextStaleError(error)) {
        context = null;
      } else {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CONTEXT_UNAVAILABLE',
          'Media listing context is temporarily unavailable',
        );
      }
    }
    if (!context
      || context.ownerUserId !== input.ownerUserId
      || context.id !== input.listingWorkflowId
      || context.shopId !== input.shopId
      || context.revision !== command.draftRevision
      || context.draftVersion !== input.draftVersion
      || !context.sourceMediaKeys.includes(command.sourceMediaKey)) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_CONTEXT_STALE',
        'The listing draft or source image changed; refresh before creating a task',
      );
    }

    let terminologies: Array<{ src: string; tgt: string }> = [];
    try {
      terminologies = resolveAiImageTranslationGlossary({
        config: settings.categoryGlossaryJson,
        sourceLanguage: 'zh',
        targetLanguage: 'ru',
        categoryId: context.category?.categoryId,
        typeId: context.category?.typeId,
      }).terms;
    } catch {
      if (requiresPaidGlossary) {
        throw new ExtensionMediaWorkflowLaunchError(
          'IMAGE_TRANSLATION_GLOSSARY_NOT_READY',
          'The trusted listing category translation glossary is unavailable',
        );
      }
    }
    if (requiresPaidGlossary && (!context.category || terminologies.length === 0)) {
      throw new ExtensionMediaWorkflowLaunchError(
        'IMAGE_TRANSLATION_GLOSSARY_NOT_READY',
        'The trusted listing category translation glossary is not ready',
      );
    }
    if (requiresPaidGlossary) assertReadiness(readiness);
    const paidQuote = requiresPaidGlossary ? buildAiImageTranslationRuntime(settings) : null;
    if (paidQuote) assertPriceConfirmation(paidQuote.price);

    let resolved: Awaited<ReturnType<typeof options.resolvePrompt>>;
    try {
      resolved = await options.resolvePrompt({
        templateKey: AI_MEDIA_TRANSLATION_TEMPLATE_KEY,
        variables: {
          sourceLanguage: 'zh',
          targetLanguage: 'ru',
          userInstructions: '',
          terminologyJson: JSON.stringify({ terms: terminologies }),
          platformConstraints: '',
        },
      });
    } catch (error) {
      if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_PROMPT_UNAVAILABLE',
        'Image translation prompt configuration is temporarily unavailable',
      );
    }
    if (!resolved
      || typeof resolved.resolvedPrompt !== 'string'
      || typeof resolved.resolvedNegativePrompt !== 'string'
      || typeof resolved.templateKey !== 'string'
      || !resolved.templateKey.trim()
      || !resolved.release?.id
      || !/^[a-f0-9]{64}$/u.test(String(resolved.checksum || ''))
      || !resolved.snapshot
      || typeof resolved.snapshot !== 'object'
      || Array.isArray(resolved.snapshot)) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_PROMPT_UNAVAILABLE',
        'Image translation prompt configuration is invalid',
      );
    }
    const providerPolicy = [
      resolved.resolvedPrompt.trim(),
      resolved.resolvedNegativePrompt.trim()
        ? `Frozen terminology and platform constraints:\n${resolved.resolvedNegativePrompt.trim()}`
        : '',
    ].filter(Boolean).join('\n\n');

    // Internalization is intentionally after all gates and context checks. It
    // may download a public source image and write an owned asset, but never
    // invokes a Provider.
    let source: { id: string };
    try {
      source = await options.internalizeSource({
        ownerUserId: input.ownerUserId,
        listingWorkflowId: input.listingWorkflowId,
        sourceMediaKey: command.sourceMediaKey,
        draftRevision: command.draftRevision,
        draftVersion: input.draftVersion,
      });
    } catch (error) {
      if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
      if (isExtensionMediaContextStaleError(error)) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_CONTEXT_STALE',
          'The listing draft or source image changed; refresh before creating a task',
        );
      }
      const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
      throw new ExtensionMediaWorkflowLaunchError(
        code === 'STORAGE_NOT_READY' || code === 'STORAGE_UNAVAILABLE'
          ? 'MEDIA_STORAGE_NOT_READY'
          : 'MEDIA_SOURCE_UNAVAILABLE',
        'Source image storage is temporarily unavailable',
      );
    }
    if (!source?.id) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_CONTEXT_STALE',
        'The listing draft or source image changed; refresh before creating a task',
      );
    }

    let created;
    try {
      created = await options.workflowService.createImageTranslation({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      sourceAssetId: source.id,
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      domainHint: providerPolicy,
      terminologies,
      imageSegment: false,
      provider: settings.provider,
      model: settings.model,
      dailyLimit: settings.dailyLimit,
      estimatedCostCents: settings.estimatedCostCents,
      globalDailyBudgetCents: settings.globalDailyBudgetCents,
      ...(paidQuote ? { translationRuntimeContract: paidQuote.runtime } : {}),
      prompt: '',
      resolvedPrompt: resolved.resolvedPrompt,
      resolvedNegativePrompt: resolved.resolvedNegativePrompt,
      templateKey: resolved.templateKey,
      templateReleaseId: resolved.release.id,
      templateChecksum: resolved.checksum,
      templateSnapshot: resolved.snapshot,
      idempotencyKey: command.workflowOperationKey,
      context: {
        type: 'listing-draft',
        id: context.id,
        revision: context.revision,
        draftVersion: context.draftVersion,
      },
      });
    } catch (error) {
      if (loadExisting && error && typeof error === 'object'
        && String((error as { code?: unknown }).code || '') === 'IDEMPOTENCY_KEY_CONFLICT') {
        const raced = await loadExistingWorkflow();
        if (raced) return replayExisting(raced);
      }
      const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
      if (error instanceof ExtensionMediaWorkflowLaunchError
        || error instanceof AiMediaWorkflowError) throw error;
      if (['AI_MEDIA_CONTEXT_MISMATCH', 'SOURCE_ASSET_NOT_FOUND', 'STALE_MEDIA_WORKFLOW'].includes(code)) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_CONTEXT_STALE',
          'The listing draft or source image changed; refresh before creating a task',
        );
      }
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_STATE_UNAVAILABLE',
        'Media workflow state is temporarily unavailable',
      );
    }
    if (created.workflow.suiteId != null) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
        'Image translation intent is bound to a media suite workflow',
      );
    }
    if (created.replayed) {
      assertReplayableWorkflowStatus(created.workflow.status, 'image translation');
    }
    if (!created.replayed || created.workflow.status === 'QUEUED') {
      const submitted = await enqueueOrMarkFailed(created.jobId);
      if (!submitted) return recoverEnqueueRace();
    }
    return {
      workflowId: created.workflow.id,
      action: 'CREATE_TRANSLATION' as const,
      operation: 'IMAGE_TRANSLATE' as const,
      status: created.workflow.status,
      revision: created.workflow.revision,
      replayed: created.replayed,
      ...(paidQuote ? { price: paidQuote.price } : {}),
    };
  };
}

export type ExtensionMediaTranslationLauncher = ReturnType<
  typeof createExtensionMediaTranslationLauncher
>;

interface ExtensionMediaStandaloneReadiness {
  enabled: boolean;
  ready: boolean;
  reasonCode: string;
  reason: string;
  testOnly?: boolean;
  operation?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  costPerImageCents?: number;
  globalDailyBudgetCents?: number;
  evidenceLevel?: string;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

interface ExtensionMediaStandaloneProviderConfig extends AiImageProviderRuntimeIdentity {
  paid: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  costPerImageCents: number;
  globalDailyBudgetCents: number;
}

/** Both extension entry points project the same normal operation and frozen-runtime owners. */
export function resolveExtensionMediaStandaloneReadiness(
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
  settings: AiImageProviderRuntimeIdentity & {
    generationEnabled: boolean;
    imageToImageEnabled: boolean;
    fullEditEnabled: boolean;
    inpaintEnabled: boolean;
    globalDailyBudgetCents: number;
  },
  options: {
    production: boolean;
    storageReadiness: AiImageEditStorageReadiness;
    resolveImageToImageReadiness: typeof import('../routes/ai-images.js').resolveAiImageToImageReadiness;
    resolveAiImageEditReadiness: typeof import('../routes/ai-images.js').resolveAiImageEditReadiness;
  },
  frozenRuntime?: unknown,
): ExtensionMediaStandaloneReadiness {
  const frozen = frozenRuntime === undefined ? null : parseAiImageProviderRuntimeContract(frozenRuntime);
  const configured = frozen ? bindAiImageProviderExecutionConfig(frozen, settings, {
    count: frozen.imageCount, width: frozen.width, height: frozen.height, estimatedCostCents: frozen.maximumCostCents,
  }) : settings;
  const model = configured.provider === 'fake' ? standaloneFakeModel(operation) : configured.model;
  const common = { provider: configured.provider, model, baseUrl: configured.baseUrl, estimatedCostCents: configured.costPerImageCents };
  const core = operation === 'IMAGE_TO_IMAGE'
    ? options.resolveImageToImageReadiness({ ...common,
      enabled: settings.generationEnabled && settings.imageToImageEnabled,
      workflowEnabled: true, production: options.production, storageReadiness: options.storageReadiness,
    })
    : options.resolveAiImageEditReadiness(operation, { ...common,
      generationEnabled: settings.generationEnabled, fullEditEnabled: settings.fullEditEnabled, inpaintEnabled: settings.inpaintEnabled,
    }, { workflowEnabled: true, production: options.production, storageReadiness: options.storageReadiness });
  return { ...core, testOnly: core.testOnly === true, provider: configured.provider, model,
    baseUrl: configured.baseUrl, costPerImageCents: configured.costPerImageCents,
    globalDailyBudgetCents: settings.globalDailyBudgetCents,
    ...(configured.currency === undefined ? {} : { currency: configured.currency }),
    ...(configured.credentialRevision ? { credentialRevision: configured.credentialRevision } : {}),
    evidenceLevel: resolveAiImageProviderCapability(configured.provider, model)?.evidenceLevel,
  };
}

function standaloneReadinessError(readiness: ExtensionMediaStandaloneReadiness): ExtensionMediaWorkflowLaunchError {
  if (readiness.reasonCode === 'STORAGE_NOT_READY') {
    return new ExtensionMediaWorkflowLaunchError('MEDIA_STORAGE_NOT_READY', readiness.reason);
  }
  if (!readiness.enabled || readiness.reasonCode === 'AI_MEDIA_OPERATION_DISABLED') {
    return new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_DISABLED', readiness.reason);
  }
  if (readiness.reasonCode === 'PROVIDER_NOT_READY') {
    return new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_NOT_ALLOWED', readiness.reason);
  }
  return new ExtensionMediaWorkflowLaunchError('MEDIA_CAPABILITY_UNAVAILABLE', readiness.reason);
}

function standaloneFakeModel(operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT'): string {
  return operation === 'IMAGE_TO_IMAGE' ? 'fake-image-to-image-v1' : 'fake-image-edit-v1';
}

function providerConfigError(message: string): never {
  throw new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_NOT_ALLOWED', message);
}

function normalizedProviderText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveStandaloneProviderConfig(input: {
  readiness: ExtensionMediaStandaloneReadiness;
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
  production: boolean;
}): ExtensionMediaStandaloneProviderConfig {
  const { readiness, operation, production } = input;
  if (!readiness.ready || !readiness.enabled) throw standaloneReadinessError(readiness);
  const testOnly = readiness.testOnly === true;
  const provider = normalizedProviderText(readiness.provider) || (testOnly ? 'fake' : '');
  if (provider === 'fake') {
    const model = standaloneFakeModel(operation);
    if (!testOnly || production) {
      providerConfigError('The fake AI image Provider is test-only and disabled in production');
    }
    if (readiness.model !== undefined && normalizedProviderText(readiness.model) !== model) {
      providerConfigError('The fake AI image Provider model configuration is invalid');
    }
    return {
      paid: false,
      provider,
      model,
      baseUrl: '',
      costPerImageCents: 0,
      globalDailyBudgetCents: 0,
    };
  }
  const model = normalizedProviderText(readiness.model);
  const baseUrl = normalizedProviderText(readiness.baseUrl);
  const costPerImageCents = Number(readiness.costPerImageCents);
  const globalDailyBudgetCents = Number(readiness.globalDailyBudgetCents);
  const contract = resolveAiImageEditProviderContract(provider, model, baseUrl);
  const capability = resolveAiImageProviderCapability(provider, model);
  if (testOnly
    || !provider
    || !model
    || !contract
    || !canRunAiImageProviderOperation({ capability, provider, model, baseUrl, operation,
      inputTransport: contract.inputTransport, resultMode: contract.resultMode })
    || !Number.isSafeInteger(costPerImageCents)
    || costPerImageCents < 1
    || !Number.isSafeInteger(globalDailyBudgetCents)
    || globalDailyBudgetCents < 1) {
    providerConfigError('Paid AI image Provider readiness or normal request protocol is invalid');
  }
  return {
    paid: true,
    provider,
    model,
    baseUrl: contract.baseUrl,
    costPerImageCents,
    globalDailyBudgetCents,
    ...(readiness.currency === undefined ? {} : { currency: readiness.currency }),
    ...(readiness.credentialRevision ? { credentialRevision: readiness.credentialRevision } : {}),
  };
}

function buildStandalonePaidExecution(
  providerConfig: ExtensionMediaStandaloneProviderConfig,
  request: { count: number; width: number; height: number },
) {
  if (!providerConfig.paid) return {};
  try {
    const quote = buildAiImageGenerationQuote(providerConfig, request);
    if (!quote.operationConfig) providerConfigError('Paid AI image Provider quote is incomplete');
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      estimatedCostCents: quote.estimatedCostCents,
      globalDailyBudgetCents: providerConfig.globalDailyBudgetCents,
      providerRuntimeContract: quote.operationConfig,
    };
  } catch (error) {
    if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
    providerConfigError(error instanceof Error ? error.message : 'Paid AI image Provider quote is invalid');
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ExtensionMediaStandaloneFrozenProvider {
  paid: boolean;
  provider: string;
  model: string;
  estimatedCostCents: number;
  providerRuntimeContract: AiImageProviderRuntimeContract | null;
}

function standaloneIdempotencyConflict(): never {
  throw new ExtensionMediaWorkflowLaunchError(
    'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
    'Media creation intent is bound to another operation or draft context',
  );
}

function frozenStandaloneProvider(
  candidate: ExtensionMediaStandaloneExistingWorkflow,
  operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
): ExtensionMediaStandaloneFrozenProvider {
  const provider = normalizedProviderText(candidate.provider);
  const model = normalizedProviderText(candidate.model);
  if (provider === 'fake') {
    if (model !== standaloneFakeModel(operation)
      || (candidate.estimatedCostCents != null && candidate.estimatedCostCents !== 0)
      || candidate.providerRuntimeContract != null) {
      standaloneIdempotencyConflict();
    }
    return {
      paid: false,
      provider,
      model,
      estimatedCostCents: 0,
      providerRuntimeContract: null,
    };
  }
  let runtime: AiImageProviderRuntimeContract;
  try { runtime = parseAiImageProviderRuntimeContract(candidate.providerRuntimeContract); }
  catch { standaloneIdempotencyConflict(); }
  const estimatedCostCents = Number(candidate.estimatedCostCents);
  if (!provider
    || !model
    || runtime.provider !== provider
    || runtime.model !== model
    || !/^[a-f0-9]{64}$/u.test(runtime.baseUrlSha256)
    || !Number.isSafeInteger(runtime.unitCostCents)
    || runtime.unitCostCents < 1
    || runtime.imageCount !== 1
    || !Number.isSafeInteger(runtime.width)
    || runtime.width < 1
    || !Number.isSafeInteger(runtime.height)
    || runtime.height < 1
    || !Number.isSafeInteger(runtime.maximumCostCents)
    || runtime.maximumCostCents !== runtime.unitCostCents
    || estimatedCostCents !== runtime.maximumCostCents
    || (operation === 'IMAGE_TO_IMAGE' && (runtime.width !== 1024 || runtime.height !== 1024))) {
    standaloneIdempotencyConflict();
  }
  return {
    paid: true,
    provider,
    model,
    estimatedCostCents,
    providerRuntimeContract: runtime,
  };
}

function assertStandaloneProviderStillAuthorized(
  frozen: ExtensionMediaStandaloneFrozenProvider,
  active: ExtensionMediaStandaloneProviderConfig,
): void {
  if (frozen.provider !== active.provider || frozen.model !== active.model || frozen.paid !== active.paid) {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      'The frozen AI image Provider configuration changed',
    );
  }
  if (!frozen.paid) return;
  const runtime = frozen.providerRuntimeContract!;
  try {
    bindAiImageProviderExecutionConfig(runtime, active, {
      count: runtime.imageCount,
      width: runtime.width,
      height: runtime.height,
      estimatedCostCents: frozen.estimatedCostCents,
    });
  } catch {
    throw new ExtensionMediaWorkflowLaunchError(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      'The frozen AI image Provider configuration changed',
    );
  }
}

export function createExtensionMediaWorkflowLauncher(options: {
  workflowService: Pick<AiMediaWorkflowService, 'createImageToImage' | 'createImageEdit'>;
  loadContext(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
    target?: SourceListingAiMediaTarget;
  }): Promise<ExtensionMediaTranslationLaunchContext | null>;
  loadExisting?(input: {
    ownerUserId: string;
    idempotencyKey: string;
  }): Promise<ExtensionMediaStandaloneExistingWorkflow | null>;
  internalizeSource(input: {
    ownerUserId: string;
    listingWorkflowId: string;
    sourceMediaKey: string;
    draftRevision: number;
    draftVersion: number;
    role: 'GENERAL' | 'EDIT';
    target?: SourceListingAiMediaTarget;
  }): Promise<{ id: string; width: number; height: number }>;
  getReadiness(
    operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
    frozenRuntime?: AiImageProviderRuntimeContract,
  ): Promise<ExtensionMediaStandaloneReadiness>;
  getEditDailyLimit(): Promise<number>;
  resolvePrompt(input: {
    templateKey: string;
    renderingProfile?: AiPromptRenderingProfile;
    variables: Record<string, string>;
  }): Promise<{
    templateKey: string;
    release: { id: string };
    checksum: string;
    snapshot: Record<string, unknown>;
    resolvedPrompt: string;
    resolvedNegativePrompt: string;
  }>;
  enqueueGeneration(jobId: string): Promise<void>;
  enqueueEdit(jobId: string): Promise<void>;
  markEnqueueFailed(jobId: string): Promise<boolean>;
  production?: boolean;
}) {
  return async (input: {
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }) => {
    const command = parseExtensionMediaWorkflowCreateCommand(input.command);
    if (!command) {
      throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation command is invalid');
    }
    const ensureReadiness = async (frozenRuntime?: AiImageProviderRuntimeContract) => {
      let readiness: ExtensionMediaStandaloneReadiness;
      try {
        readiness = frozenRuntime
          ? await options.getReadiness(command.operation, frozenRuntime)
          : await options.getReadiness(command.operation);
      } catch (error) {
        if (error instanceof AiImageProviderRuntimeContractError) {
          throw new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_CONFIG_CHANGED', error.message);
        }
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CAPABILITY_UNAVAILABLE',
          'Media capability is temporarily unavailable',
        );
      }
      try {
        return resolveStandaloneProviderConfig({
          readiness,
          operation: command.operation,
          production: options.production ?? process.env.NODE_ENV === 'production',
        });
      } catch (error) {
        if (frozenRuntime && error instanceof ExtensionMediaWorkflowLaunchError && error.code === 'MEDIA_PROVIDER_NOT_ALLOWED') {
          throw new ExtensionMediaWorkflowLaunchError('MEDIA_PROVIDER_CONFIG_CHANGED', error.message);
        }
        throw error;
      }
    };
    const enqueueFor = command.operation === 'IMAGE_TO_IMAGE'
      ? options.enqueueGeneration
      : options.enqueueEdit;
    const enqueueOrMarkFailed = async (jobId: string): Promise<boolean> => {
      try {
        await enqueueFor(jobId);
        return true;
      } catch {
        let markedFailed: boolean;
        try {
          markedFailed = await options.markEnqueueFailed(jobId);
        } catch {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_CREATE_STATE_UNAVAILABLE',
            'Media workflow state is temporarily unavailable',
          );
        }
        if (markedFailed) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'Media queue is temporarily unavailable',
          );
        }
        return false;
      }
    };
    const loadExisting = async () => {
      if (!options.loadExisting) return null;
      try {
        return await options.loadExisting({
          ownerUserId: input.ownerUserId,
          idempotencyKey: command.workflowOperationKey,
        });
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_STATE_UNAVAILABLE',
          'Existing media workflow state is temporarily unavailable',
        );
      }
    };
    const assertMatchingWorkflow = (candidate: ExtensionMediaStandaloneExistingWorkflow) => {
      const sourceMediaKeys = candidate.sourceMediaKeys
        || (candidate.sourceMediaKey ? [candidate.sourceMediaKey] : []);
      if (candidate.ownerUserId !== input.ownerUserId
        || candidate.operation !== command.operation
        || candidate.contextType !== 'listing-draft'
        || candidate.contextId !== input.listingWorkflowId
        || candidate.contextDraftRevision !== command.draftRevision
        || candidate.contextDraftVersion !== input.draftVersion
        || (candidate.contextSkuKey ?? null) !== (command.target?.skuKey ?? null)
        || (candidate.contextSlotKey ?? null) !== (command.target?.slotKey ?? null)
        || candidate.suiteId != null
        || !sameStringArray(sourceMediaKeys, command.sourceMediaKeys)
        || candidate.prompt !== command.prompt
        || String(candidate.negativePrompt || '') !== command.negativePrompt
        || (command.operation === 'INPAINT' && candidate.maskAssetId !== command.maskAssetId)
        || (command.operation !== 'INPAINT' && candidate.maskAssetId != null)) {
        standaloneIdempotencyConflict();
      }
      return frozenStandaloneProvider(candidate, command.operation);
    };
    const resultFor = (candidate: ExtensionMediaStandaloneExistingWorkflow) => ({
      workflowId: candidate.id,
      action: 'CREATE_WORKFLOW' as const,
      operation: command.operation,
      status: candidate.status,
      revision: candidate.revision,
      replayed: true,
    });
    const recoverEnqueueRace = async () => {
      const authoritative = await loadExisting();
      if (!authoritative) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_STATE_UNAVAILABLE',
          'Authoritative media workflow state is temporarily unavailable',
        );
      }
      assertMatchingWorkflow(authoritative);
      assertAuthoritativeEnqueueRecoveryStatus(authoritative.status, 'media workflow');
      return resultFor(authoritative);
    };
    const replayExisting = async (candidate: ExtensionMediaStandaloneExistingWorkflow) => {
      const frozenProvider = assertMatchingWorkflow(candidate);
      assertReplayableWorkflowStatus(candidate.status, 'media workflow');
      if (candidate.status === 'QUEUED') {
        const activeProvider = await ensureReadiness(frozenProvider.providerRuntimeContract || undefined);
        assertStandaloneProviderStillAuthorized(frozenProvider, activeProvider);
        if (!candidate.jobId) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'The queued media workflow has no recoverable job',
          );
        }
        const submitted = await enqueueOrMarkFailed(candidate.jobId);
        if (!submitted) return recoverEnqueueRace();
      }
      return resultFor(candidate);
    };

    const existing = await loadExisting();
    if (existing) return replayExisting(existing);
    const providerConfig = await ensureReadiness();

    let context: ExtensionMediaTranslationLaunchContext | null;
    try {
      context = await options.loadContext({
        ownerUserId: input.ownerUserId,
        listingWorkflowId: input.listingWorkflowId,
        draftRevision: command.draftRevision,
        draftVersion: input.draftVersion,
        ...(command.target ? { target: command.target } : {}),
      });
    } catch (error) {
      if (isExtensionMediaContextStaleError(error)) context = null;
      else {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CONTEXT_UNAVAILABLE',
          'Media listing context is temporarily unavailable',
        );
      }
    }
    if (!context
      || context.ownerUserId !== input.ownerUserId
      || context.id !== input.listingWorkflowId
      || context.shopId !== input.shopId
      || context.revision !== command.draftRevision
      || context.draftVersion !== input.draftVersion
      || !extensionMediaWorkflowTargetMatches(command.target, context.target)
      || command.sourceMediaKeys.some((key) => !context!.sourceMediaKeys.includes(key))) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_CONTEXT_STALE',
        'The listing draft or source image changed; refresh before creating a task',
      );
    }

    let sources: Array<{ id: string; width: number; height: number }>;
    try {
      sources = await Promise.all(command.sourceMediaKeys.map((sourceMediaKey) => (
        options.internalizeSource({
          ownerUserId: input.ownerUserId,
          listingWorkflowId: input.listingWorkflowId,
          sourceMediaKey,
          draftRevision: command.draftRevision,
          draftVersion: input.draftVersion,
          role: command.operation === 'IMAGE_TO_IMAGE' ? 'GENERAL' : 'EDIT',
          ...(command.target ? { target: command.target } : {}),
        })
      )));
    } catch (error) {
      if (isExtensionMediaContextStaleError(error)) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_CONTEXT_STALE',
          'The listing draft or source image changed; refresh before creating a task',
        );
      }
      const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
      throw new ExtensionMediaWorkflowLaunchError(
        code === 'STORAGE_NOT_READY' || code === 'STORAGE_UNAVAILABLE'
          ? 'MEDIA_STORAGE_NOT_READY'
          : 'MEDIA_SOURCE_UNAVAILABLE',
        'Source image storage is temporarily unavailable',
      );
    }
    if (sources.some((source) => !source?.id
      || !Number.isSafeInteger(source.width)
      || source.width < 1
      || !Number.isSafeInteger(source.height)
      || source.height < 1)) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_CONTEXT_STALE',
        'The listing draft or source image changed; refresh before creating a task',
      );
    }

    const workflowContext = {
      type: 'listing-draft' as const,
      id: context.id,
      revision: context.revision,
      draftVersion: context.draftVersion,
      ...(context.target || {}),
    };
    let created;
    try {
      if (command.operation === 'IMAGE_TO_IMAGE') {
        const dailyLimit = await options.getEditDailyLimit();
        if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUOTA_UNAVAILABLE',
            'Image generation quota configuration is invalid',
          );
        }
        const providerExecution = buildStandalonePaidExecution(providerConfig, {
          count: 1,
          width: 1024,
          height: 1024,
        });
        created = await options.workflowService.createImageToImage({
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          references: sources.map((source) => ({ assetId: source.id })),
          prompt: command.prompt,
          negativePrompt: command.negativePrompt || null,
          count: 1,
          width: 1024,
          height: 1024,
          dailyLimit,
          ...providerExecution,
          idempotencyKey: command.workflowOperationKey,
          context: workflowContext,
        });
      } else {
        const editContract = resolveAiImageEditProviderContract(providerConfig.provider, providerConfig.model, providerConfig.baseUrl);
        const templateKey = command.operation === 'FULL_EDIT'
          ? AI_MEDIA_FULL_EDIT_TEMPLATE_KEY
          : AI_MEDIA_INPAINT_TEMPLATE_KEY;
        let resolved: Awaited<ReturnType<typeof options.resolvePrompt>>;
        try {
          resolved = await options.resolvePrompt({
            templateKey,
            ...(editContract?.renderingProfile ? { renderingProfile: editContract.renderingProfile } : {}),
            variables: {
              userPrompt: command.prompt,
              userNegativePrompt: command.negativePrompt,
            },
          });
        } catch {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_PROMPT_UNAVAILABLE',
            'Image edit prompt configuration is temporarily unavailable',
          );
        }
        if (!resolved?.release?.id
          || !resolved.templateKey
          || !/^[a-f0-9]{64}$/u.test(String(resolved.checksum || ''))
          || !resolved.snapshot
          || typeof resolved.snapshot !== 'object'
          || Array.isArray(resolved.snapshot)
          || typeof resolved.resolvedPrompt !== 'string'
          || typeof resolved.resolvedNegativePrompt !== 'string') {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_PROMPT_UNAVAILABLE',
            'Image edit prompt configuration is invalid',
          );
        }
        let dailyLimit: number;
        try {
          dailyLimit = await options.getEditDailyLimit();
        } catch {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_CAPABILITY_UNAVAILABLE',
            'Image edit quota configuration is temporarily unavailable',
          );
        }
        if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_CAPABILITY_UNAVAILABLE',
            'Image edit quota configuration is invalid',
          );
        }
        const source = sources[0]!;
        if (providerConfig.paid && !isAiImageEditProviderCanvasSupported(providerConfig.provider, providerConfig.model, source.width, source.height)) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_PROVIDER_NOT_ALLOWED',
            editContract?.kind === 'wanx21'
              ? `Wanx image edits require a 1024x1024 source and mask canvas; received ${source.width}x${source.height}. Resize or pad the source and mask before submitting`
              : `Paid image edits require a supported Provider canvas (1024x1024, 1024x1536, or 1536x1024); received ${source.width}x${source.height}. Resize or pad the source and mask before submitting`,
          );
        }
        const providerExecution = buildStandalonePaidExecution(providerConfig, {
          count: 1,
          width: source.width,
          height: source.height,
        });
        created = await options.workflowService.createImageEdit({
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          operation: command.operation,
          sourceAssetId: source.id,
          width: source.width,
          height: source.height,
          ...(command.operation === 'INPAINT' ? {
            maskAssetId: command.maskAssetId,
            maskSemantics: command.maskSemantics,
          } : {}),
          prompt: command.prompt,
          negativePrompt: command.negativePrompt || null,
          resolvedPrompt: resolved.resolvedPrompt,
          resolvedNegativePrompt: resolved.resolvedNegativePrompt,
          templateKey: resolved.templateKey,
          templateReleaseId: resolved.release.id,
          templateChecksum: resolved.checksum,
          templateSnapshot: resolved.snapshot,
          dailyLimit,
          ...providerExecution,
          idempotencyKey: command.workflowOperationKey,
          context: workflowContext,
        });
      }
    } catch (error) {
      if (options.loadExisting
        && error && typeof error === 'object'
        && String((error as { code?: unknown }).code || '') === 'IDEMPOTENCY_KEY_CONFLICT') {
        const raced = await loadExisting();
        if (raced) return replayExisting(raced);
      }
      if (error instanceof ExtensionMediaWorkflowLaunchError
        || error instanceof AiMediaWorkflowError) throw error;
      const code = error && typeof error === 'object'
        ? String((error as { code?: unknown }).code || '')
        : '';
      if (['AI_MEDIA_CONTEXT_MISMATCH', 'SOURCE_ASSET_NOT_FOUND', 'MASK_ASSET_NOT_FOUND', 'STALE_MEDIA_WORKFLOW'].includes(code)) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_CONTEXT_STALE',
          'The listing draft or media input changed; refresh before creating a task',
        );
      }
      if (['SOURCE_ASSET_DUPLICATE', 'SOURCE_ASSET_INVALID', 'MASK_ASSET_INVALID'].includes(code)) {
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CREATE_INPUT_INVALID',
          'The selected source images or edit mask are not valid for this media task',
        );
      }
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_STATE_UNAVAILABLE',
        'Media workflow state is temporarily unavailable',
      );
    }
    if (created.workflow.suiteId != null) {
      throw new ExtensionMediaWorkflowLaunchError(
        'MEDIA_CREATE_IDEMPOTENCY_CONFLICT',
        'Media creation intent is bound to a media suite workflow',
      );
    }
    if (created.replayed) {
      assertReplayableWorkflowStatus(created.workflow.status, 'media workflow');
    }
    if (!created.replayed || created.workflow.status === 'QUEUED') {
      const submitted = await enqueueOrMarkFailed(created.jobId);
      if (!submitted) return recoverEnqueueRace();
    }
    return {
      workflowId: created.workflow.id,
      action: 'CREATE_WORKFLOW' as const,
      operation: command.operation,
      status: created.workflow.status,
      revision: created.workflow.revision,
      replayed: created.replayed,
    };
  };
}

export type ExtensionMediaWorkflowLauncher = ReturnType<
  typeof createExtensionMediaWorkflowLauncher
>;
