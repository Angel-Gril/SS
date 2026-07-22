import { AiMediaWorkflowError, type AiMediaWorkflowService } from './ai-media-workflows.js';
import { AI_MEDIA_TRANSLATION_TEMPLATE_KEY } from './ai-prompt-templates.js';

/**
 * Creation is deliberately a separate command contract from the B1 cancel/retry
 * contract.  The extension supplies only a source media key and an intent key;
 * all provider-facing values are resolved on the server.
 */
export const EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION =
  'ai-media-workflow-create/v1' as const;

export interface ExtensionMediaTranslationCreateCommand extends Record<string, unknown> {
  schemaVersion: typeof EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION;
  action: 'CREATE_TRANSLATION';
  sourceMediaKey: string;
  draftRevision: number;
  workflowOperationKey: string;
}

export interface ExtensionMediaTranslationLaunchContext {
  id: string;
  ownerUserId: string;
  shopId: string;
  supplyGoodsId: string;
  snapshotId: string;
  revision: number;
  draftVersion: number;
  sourceMediaKeys: string[];
}

export interface ExtensionMediaTranslationSettings {
  enabled: boolean;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
}

export interface ExtensionMediaTranslationReadiness {
  enabled: boolean;
  ready: boolean;
  reasonCode: string;
  reason: string;
  testOnly: true;
}

export interface ExtensionMediaTranslationExistingWorkflow {
  id: string;
  ownerUserId: string;
  operation: string;
  provider: string | null;
  status: string;
  revision: number;
  contextType: string | null;
  contextId: string | null;
  contextDraftRevision: number | null;
  contextDraftVersion: number | null;
  suiteId?: string | null;
  sourceMediaKey: string | null;
  jobId: string | null;
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

export function parseExtensionMediaTranslationCreateCommand(
  value: Record<string, unknown>,
): ExtensionMediaTranslationCreateCommand | null {
  if (value?.schemaVersion !== EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION) return null;
  const allowed = new Set([
    'schemaVersion', 'action', 'sourceMediaKey', 'draftRevision', 'workflowOperationKey',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation command contains unknown fields');
  }
  if (value.action !== 'CREATE_TRANSLATION') {
    throw new ExtensionMediaWorkflowLaunchError('MEDIA_CREATE_INVALID', 'Media creation action is invalid');
  }
  return {
    schemaVersion: EXTENSION_MEDIA_TRANSLATION_CREATE_VERSION,
    action: 'CREATE_TRANSLATION',
    sourceMediaKey: normalizedIdentifier(value.sourceMediaKey, 'sourceMediaKey', 500),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    workflowOperationKey: normalizedIdentifier(value.workflowOperationKey, 'workflowOperationKey', 128),
  };
}

export function resolveExtensionMediaTranslationReadiness(input: {
  settings: ExtensionMediaTranslationSettings,
  production: boolean;
  storageReadiness?: { ready: boolean; reason: string };
}): ExtensionMediaTranslationReadiness {
  const { settings, production, storageReadiness } = input;
  if (production) return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
    reason: 'Fake image translation is disabled in production',
    testOnly: true,
  };
  if (!settings.enabled || settings.provider === 'disabled') return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_CREATE_DISABLED',
    reason: 'Image translation is disabled',
    testOnly: true,
  };
  if (settings.provider !== 'fake') return {
    enabled: false,
    ready: false,
    reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED',
    reason: 'Extension image translation currently permits only the fake provider',
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

function assertFakeTranslationSettings(
  settings: ExtensionMediaTranslationSettings,
  production: boolean,
  storageReadiness?: { ready: boolean; reason: string },
) {
  const readiness = resolveExtensionMediaTranslationReadiness({
    settings,
    production,
    storageReadiness,
  });
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
  getStorageReadiness?(): Promise<{ ready: boolean; reason: string }>;
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
    const ensureReadiness = async () => {
      try {
        const settings = await options.getSettings();
        const storageReadiness = options.getStorageReadiness
          ? await options.getStorageReadiness()
          : undefined;
        assertFakeTranslationSettings(
          settings,
          options.production ?? process.env.NODE_ENV === 'production',
          storageReadiness,
        );
        return settings;
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) throw error;
        throw new ExtensionMediaWorkflowLaunchError(
          'MEDIA_CAPABILITY_UNAVAILABLE',
          'Image translation capability is temporarily unavailable',
        );
      }
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
    const existing = await loadExistingWorkflow();
    const replayExisting = async (candidate: ExtensionMediaTranslationExistingWorkflow) => {
      if (candidate.ownerUserId !== input.ownerUserId
        || candidate.operation !== 'IMAGE_TRANSLATE'
        || candidate.provider !== 'fake'
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
      if (candidate.status === 'QUEUED') {
        await ensureReadiness();
        if (!candidate.jobId) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'The queued media workflow has no recoverable job',
          );
        }
        try {
          await options.enqueue(candidate.jobId);
        } catch {
          const markedFailed = await markEnqueueFailed(candidate.jobId);
          if (markedFailed) {
            throw new ExtensionMediaWorkflowLaunchError(
              'MEDIA_QUEUE_UNAVAILABLE',
              'Media queue is temporarily unavailable',
            );
          }
        }
      }
      return {
        workflowId: candidate.id,
        action: 'CREATE_TRANSLATION' as const,
        operation: 'IMAGE_TRANSLATE' as const,
        status: candidate.status,
        revision: candidate.revision,
        replayed: true,
      };
    };
    if (existing) return replayExisting(existing);

    const settings = await ensureReadiness();

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

    let resolved: Awaited<ReturnType<typeof options.resolvePrompt>>;
    try {
      resolved = await options.resolvePrompt({
        templateKey: AI_MEDIA_TRANSLATION_TEMPLATE_KEY,
        variables: {
          sourceLanguage: 'zh',
          targetLanguage: 'ru',
          userInstructions: '',
          terminologyJson: JSON.stringify({ terms: [] }),
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
    let created;
    try {
      created = await options.workflowService.createImageTranslation({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      sourceAssetId: source.id,
      sourceLanguage: 'zh',
      targetLanguage: 'ru',
      domainHint: providerPolicy,
      terminologies: [],
      imageSegment: false,
      provider: settings.provider,
      model: settings.model,
      dailyLimit: settings.dailyLimit,
      estimatedCostCents: settings.estimatedCostCents,
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
    if (!created.replayed || created.workflow.status === 'QUEUED') {
      try {
        await options.enqueue(created.jobId);
      } catch {
        const markedFailed = await markEnqueueFailed(created.jobId);
        if (markedFailed) {
          throw new ExtensionMediaWorkflowLaunchError(
            'MEDIA_QUEUE_UNAVAILABLE',
            'Media queue is temporarily unavailable',
          );
        }
      }
    }
    return {
      workflowId: created.workflow.id,
      action: 'CREATE_TRANSLATION' as const,
      operation: 'IMAGE_TRANSLATE' as const,
      status: created.workflow.status,
      revision: created.workflow.revision,
      replayed: created.replayed,
    };
  };
}

export type ExtensionMediaTranslationLauncher = ReturnType<
  typeof createExtensionMediaTranslationLauncher
>;
