import type { AiMediaWorkflowService } from './ai-media-workflows.js';
import {
  assertAiImageProviderRuntimeContract,
  type AiImageProviderRuntimeIdentity,
  type AiImageProviderCurrency,
  type AiImageProviderCredentialRevision,
} from './ai-image-provider-runtime-contract.js';
import { canRunAiImageProviderOperation } from './ai-image-provider-admission.js';
import { resolveAiImageProviderCapability } from './ai-image-provider-capabilities.js';
import { resolveAiImageEditProviderContract } from './ai-image-edit-provider-contract.js';
import {
  parseExtensionMediaWorkflowCreateCommand,
  parseExtensionMediaTranslationCreateCommand,
  type ExtensionMediaWorkflowLauncher,
  type ExtensionMediaTranslationLauncher,
} from './extension-media-workflow-launch.js';

export const EXTENSION_MEDIA_WORKFLOW_COMMAND_VERSION =
  'ai-media-workflow-command/v1' as const;

export type ExtensionMediaWorkflowAction = 'CANCEL' | 'RETRY';

interface ExtensionMediaWorkflowCommand {
  schemaVersion: typeof EXTENSION_MEDIA_WORKFLOW_COMMAND_VERSION;
  action: ExtensionMediaWorkflowAction;
  mediaWorkflowId: string;
  expectedRevision: number;
  draftRevision: number;
}

interface CurrentListingDraft {
  id: string;
  ownerUserId: string;
  shopId: string;
  revision: number;
  draftVersion: number;
}

export interface ExtensionMediaProviderReadiness {
  enabled?: boolean;
  ready: boolean;
  testOnly?: boolean;
  evidenceLevel?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  costPerImageCents?: number;
  globalDailyBudgetCents?: number;
  currency?: AiImageProviderCurrency;
  credentialRevision?: AiImageProviderCredentialRevision;
}

type ExtensionMediaProviderAuthorizationCode =
  | 'MEDIA_PROVIDER_NOT_ALLOWED'
  | 'MEDIA_CAPABILITY_UNAVAILABLE'
  | 'MEDIA_PROVIDER_CONFIG_CHANGED';

export class ExtensionMediaProviderAuthorizationError extends Error {
  constructor(
    public readonly code: ExtensionMediaProviderAuthorizationCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionMediaProviderAuthorizationError';
  }
}

export class ExtensionMediaWorkflowCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionMediaWorkflowCommandError';
  }
}

function command(value: Record<string, unknown>): ExtensionMediaWorkflowCommand {
  const parsed = value as Partial<ExtensionMediaWorkflowCommand>;
  const expectedKeys = [
    'action', 'draftRevision', 'expectedRevision', 'mediaWorkflowId', 'schemaVersion',
  ].join(',');
  if (Object.keys(value).sort().join(',') !== expectedKeys
    || parsed.schemaVersion !== EXTENSION_MEDIA_WORKFLOW_COMMAND_VERSION
    || !['CANCEL', 'RETRY'].includes(String(parsed.action || ''))
    || !String(parsed.mediaWorkflowId || '').trim()
    || !Number.isSafeInteger(parsed.expectedRevision)
    || Number(parsed.expectedRevision) <= 0
    || !Number.isSafeInteger(parsed.draftRevision)
    || Number(parsed.draftRevision) <= 0) {
    throw new ExtensionMediaWorkflowCommandError(
      'MEDIA_COMMAND_INVALID',
      'Media workflow command is invalid',
    );
  }
  return {
    schemaVersion: EXTENSION_MEDIA_WORKFLOW_COMMAND_VERSION,
    action: parsed.action as ExtensionMediaWorkflowAction,
    mediaWorkflowId: String(parsed.mediaWorkflowId).trim(),
    expectedRevision: Number(parsed.expectedRevision),
    draftRevision: Number(parsed.draftRevision),
  };
}

function fail(code: string, message: string): never {
  throw new ExtensionMediaWorkflowCommandError(code, message);
}

function providerText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function providerAuthorizationFail(
  code: ExtensionMediaProviderAuthorizationCode,
  message: string,
): never {
  throw new ExtensionMediaProviderAuthorizationError(code, message);
}

function frozenProviderRuntime(operationConfig: unknown): unknown {
  if (!operationConfig || typeof operationConfig !== 'object' || Array.isArray(operationConfig)) {
    return null;
  }
  const config = operationConfig as Record<string, unknown>;
  return config.contractVersion ? config : config.providerRuntime;
}

export function assertExtensionMediaJobProviderAuthorized(input: {
  operation: string;
  job: any;
  readiness?: ExtensionMediaProviderReadiness;
  production: boolean;
  requireReadiness: boolean;
  requireGlobalDailyBudget: boolean;
}): { paid: boolean; globalDailyBudgetCents?: number } {
  const provider = providerText(input.job?.provider);
  if (!provider) {
    providerAuthorizationFail(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      'The frozen AI image Provider configuration is missing',
    );
  }
  if (provider === 'fake') {
    if (input.production) {
      providerAuthorizationFail(
        'MEDIA_PROVIDER_NOT_ALLOWED',
        'The fake AI image Provider is disabled in production',
      );
    }
    if (input.requireReadiness
      && (!input.readiness?.ready || input.readiness.enabled === false)) {
      providerAuthorizationFail(
        'MEDIA_CAPABILITY_UNAVAILABLE',
        'Media capability is disabled or not ready',
      );
    }
    const activeProvider = providerText(input.readiness?.provider);
    const activeModel = providerText(input.readiness?.model);
    if ((activeProvider && activeProvider !== provider)
      || (activeModel && activeModel !== providerText(input.job?.model))) {
      providerAuthorizationFail(
        'MEDIA_CAPABILITY_UNAVAILABLE',
        'The frozen test Provider configuration changed',
      );
    }
    return { paid: false };
  }

  const readiness = input.readiness;
  if (!readiness
    || readiness.enabled !== true
    || readiness.ready !== true
    || readiness.testOnly !== false) {
    providerAuthorizationFail(
      'MEDIA_CAPABILITY_UNAVAILABLE',
      'Paid AI image capability is disabled, unready, or unverified',
    );
  }
  if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input.operation)
    || providerText(input.job?.operation) !== input.operation) {
    providerAuthorizationFail(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      'The frozen AI image Provider operation changed',
    );
  }
  const identity: AiImageProviderRuntimeIdentity = {
    provider: providerText(readiness.provider),
    model: providerText(readiness.model),
    baseUrl: providerText(readiness.baseUrl),
    costPerImageCents: Number(readiness.costPerImageCents),
    ...(readiness.currency === undefined ? {} : { currency: readiness.currency }),
    ...(readiness.credentialRevision ? { credentialRevision: readiness.credentialRevision } : {}),
  };
  if (!identity.provider
    || !identity.model
    || !identity.baseUrl
    || !Number.isSafeInteger(identity.costPerImageCents)
    || identity.costPerImageCents < 1) {
    providerAuthorizationFail(
      'MEDIA_CAPABILITY_UNAVAILABLE',
      'Paid AI image Provider readiness is incomplete',
    );
  }
  const globalDailyBudgetCents = Number(readiness.globalDailyBudgetCents);
  if (input.requireGlobalDailyBudget
    && (!Number.isSafeInteger(globalDailyBudgetCents) || globalDailyBudgetCents < 1)) {
    providerAuthorizationFail(
      'MEDIA_CAPABILITY_UNAVAILABLE',
      'Global daily AI budget is unavailable',
    );
  }
  if (provider !== identity.provider || providerText(input.job?.model) !== identity.model) {
    providerAuthorizationFail(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      'The frozen AI image Provider identity changed',
    );
  }
  try {
    assertAiImageProviderRuntimeContract(
      frozenProviderRuntime(input.job?.operationConfig),
      identity,
      {
        count: Number(input.job?.requestedImageCount),
        width: Number(input.job?.width),
        height: Number(input.job?.height),
        estimatedCostCents: Number(input.job?.estimatedCostCents),
      },
    );
  } catch (error) {
    providerAuthorizationFail(
      'MEDIA_PROVIDER_CONFIG_CHANGED',
      error instanceof Error
        ? error.message
        : 'The frozen AI image Provider runtime contract changed',
    );
  }
  const contract = resolveAiImageEditProviderContract(identity.provider, identity.model, identity.baseUrl);
  if (!contract || !canRunAiImageProviderOperation({
    capability: resolveAiImageProviderCapability(identity.provider, identity.model),
    provider: identity.provider, model: identity.model, baseUrl: identity.baseUrl,
    operation: input.operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
    inputTransport: contract.inputTransport, resultMode: contract.resultMode,
  })) {
    providerAuthorizationFail('MEDIA_CAPABILITY_UNAVAILABLE', 'The normal AI image Provider protocol is not available');
  }
  return {
    paid: true,
    ...(input.requireGlobalDailyBudget ? { globalDailyBudgetCents } : {}),
  };
}

export function createExtensionMediaWorkflowCommandExecutor(options: {
  workflowService: Pick<AiMediaWorkflowService, 'get' | 'cancel' | 'retry'>;
  launchWorkflow?: ExtensionMediaWorkflowLauncher;
  launchTranslation?: ExtensionMediaTranslationLauncher;
  loadListingDraft(input: {
    listingWorkflowId: string;
    ownerUserId: string;
  }): Promise<CurrentListingDraft | null>;
  getTranslationDailyLimit(): Promise<number>;
  getEditDailyLimit(): Promise<number>;
  getRetryReadiness(operation: string): Promise<ExtensionMediaProviderReadiness>;
  enqueueGeneration(jobId: string): Promise<void>;
  enqueueTranslation(jobId: string): Promise<void>;
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
    const workflowCreate = parseExtensionMediaWorkflowCreateCommand(input.command);
    if (workflowCreate) {
      if (!options.launchWorkflow) {
        fail('MEDIA_CREATE_UNAVAILABLE', 'Standalone media launch is unavailable');
      }
      return options.launchWorkflow(input);
    }
    const translationCreate = parseExtensionMediaTranslationCreateCommand(input.command);
    if (translationCreate) {
      if (!options.launchTranslation) {
        fail('MEDIA_CREATE_UNAVAILABLE', 'Media translation launch is unavailable');
      }
      return options.launchTranslation(input);
    }
    const requested = command(input.command);
    const [draft, workflow] = await Promise.all([
      options.loadListingDraft({
        listingWorkflowId: input.listingWorkflowId,
        ownerUserId: input.ownerUserId,
      }),
      options.workflowService.get(requested.mediaWorkflowId, input.ownerUserId),
    ]);
    if (!draft
      || draft.id !== input.listingWorkflowId
      || draft.ownerUserId !== input.ownerUserId
      || draft.shopId !== input.shopId
      || draft.revision !== requested.draftRevision
      || draft.draftVersion !== input.draftVersion
      || workflow.contextType !== 'listing-draft'
      || workflow.contextId !== draft.id
      || workflow.contextDraftRevision !== draft.revision
      || workflow.contextDraftVersion !== draft.draftVersion
      || workflow.suiteId != null
      || workflow.revision !== requested.expectedRevision) {
      fail('MEDIA_COMMAND_CONTEXT_STALE', 'Media workflow command context changed');
    }
    const currentJob = Array.isArray(workflow.jobs) ? workflow.jobs.at(-1) : null;

    if (requested.action === 'CANCEL') {
      if (!['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(workflow.status)) {
        fail('MEDIA_COMMAND_CONTEXT_STALE', 'Media workflow cannot be cancelled');
      }
      const updated = await options.workflowService.cancel(
        workflow.id,
        input.ownerUserId,
        input.actorUserId,
        requested.expectedRevision,
      );
      return {
        workflowId: updated.id,
        action: requested.action,
        status: updated.status,
        revision: updated.revision,
      };
    }

    const production = options.production ?? process.env.NODE_ENV === 'production';
    if (String(currentJob?.provider || '').trim() === 'fake' && production) {
      fail('MEDIA_PROVIDER_NOT_ALLOWED', 'Fake extension media workflows cannot be retried in production');
    }

    let retryReadiness: ExtensionMediaProviderReadiness;
    try {
      retryReadiness = await options.getRetryReadiness(workflow.operation);
    } catch {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media retry capability is temporarily unavailable');
    }
    let providerAuthorization: { paid: boolean; globalDailyBudgetCents?: number };
    try {
      providerAuthorization = assertExtensionMediaJobProviderAuthorized({
        operation: workflow.operation,
        job: currentJob,
        readiness: retryReadiness,
        production,
        requireReadiness: true,
        requireGlobalDailyBudget: true,
      });
    } catch (error) {
      if (error instanceof ExtensionMediaProviderAuthorizationError) {
        fail(error.code, error.message);
      }
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media retry capability is temporarily unavailable');
    }

    if (workflow.status !== 'FAILED') {
      fail('MEDIA_COMMAND_CONTEXT_STALE', 'Media workflow cannot be retried');
    }
    let dailyLimit: number | undefined;
    let enqueue = options.enqueueGeneration;
    if (workflow.operation === 'IMAGE_TRANSLATE') {
      dailyLimit = await options.getTranslationDailyLimit();
      enqueue = options.enqueueTranslation;
    } else if (workflow.operation === 'IMAGE_TO_IMAGE'
      || workflow.operation === 'FULL_EDIT'
      || workflow.operation === 'INPAINT') {
      dailyLimit = await options.getEditDailyLimit();
      enqueue = options.enqueueEdit;
      if (workflow.operation === 'IMAGE_TO_IMAGE') enqueue = options.enqueueGeneration;
    } else {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media retry operation is unsupported');
    }
    if (dailyLimit != null && (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0)) {
      fail('MEDIA_QUOTA_UNAVAILABLE', 'Media retry quota is unavailable');
    }
    let retried;
    try {
      retried = await options.workflowService.retry({
        id: workflow.id,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedRevision: requested.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        dailyLimit,
        ...(providerAuthorization.paid
          ? { globalDailyBudgetCents: providerAuthorization.globalDailyBudgetCents }
          : {}),
      });
    } catch (error) {
      if (error && typeof error === 'object'
        && String((error as { code?: unknown }).code || '') === 'BUDGET_EXCEEDED') {
        fail(
          'BUDGET_EXCEEDED',
          error instanceof Error ? error.message : 'Global daily AI budget exceeded',
        );
      }
      throw error;
    }
    let resultWorkflow = retried.workflow;
    if (!retried.replayed) {
      try {
        await enqueue(retried.jobId);
      } catch {
        let markedFailed: boolean;
        try {
          markedFailed = await options.markEnqueueFailed(retried.jobId);
        } catch {
          fail('MEDIA_CREATE_STATE_UNAVAILABLE', 'Media retry state is temporarily unavailable');
        }
        if (markedFailed) {
          fail('MEDIA_QUEUE_UNAVAILABLE', 'Media queue is temporarily unavailable');
        }
        let authoritative;
        try {
          authoritative = await options.workflowService.get(
            retried.workflow.id,
            input.ownerUserId,
          );
        } catch {
          fail('MEDIA_CREATE_STATE_UNAVAILABLE', 'Media retry state is temporarily unavailable');
        }
        if (!authoritative
          || authoritative.id !== retried.workflow.id
          || authoritative.operation !== retried.workflow.operation
          || authoritative.revision < retried.workflow.revision) {
          fail('MEDIA_CREATE_STATE_UNAVAILABLE', 'Media retry state is temporarily unavailable');
        }
        if (authoritative.status === 'QUEUED') {
          fail('MEDIA_QUEUE_UNAVAILABLE', 'Media queue is temporarily unavailable');
        }
        if (authoritative.status !== 'RUNNING' && authoritative.status !== 'SUCCEEDED') {
          fail('MEDIA_CREATE_STATE_UNAVAILABLE', 'Media retry state is temporarily unavailable');
        }
        resultWorkflow = authoritative;
      }
    }
    return {
      workflowId: resultWorkflow.id,
      action: requested.action,
      status: resultWorkflow.status,
      revision: resultWorkflow.revision,
    };
  };
}
