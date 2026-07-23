import type { AiMediaWorkflowService } from './ai-media-workflows.js';
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
  if (parsed.schemaVersion !== EXTENSION_MEDIA_WORKFLOW_COMMAND_VERSION
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
  getRetryReadiness(operation: string): Promise<{
    ready: boolean;
    provider?: string;
    model?: string;
  }>;
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
    if (String(currentJob?.provider || '') !== 'fake') {
      fail('MEDIA_PROVIDER_NOT_ALLOWED', 'Extension media commands permit only the fake provider');
    }

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

    if (options.production ?? process.env.NODE_ENV === 'production') {
      fail('MEDIA_PROVIDER_NOT_ALLOWED', 'Fake extension media workflows cannot be retried in production');
    }

    let retryReadiness: { ready: boolean; provider?: string; model?: string };
    try {
      retryReadiness = await options.getRetryReadiness(workflow.operation);
    } catch {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media retry capability is temporarily unavailable');
    }
    if (!retryReadiness.ready) {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media retry capability is disabled or not ready');
    }
    if (workflow.operation === 'IMAGE_TRANSLATE'
      && ((retryReadiness.provider && currentJob?.provider !== retryReadiness.provider)
        || (retryReadiness.model && currentJob?.model !== retryReadiness.model))) {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'The frozen translation provider configuration changed');
    }

    if (workflow.status !== 'FAILED') {
      fail('MEDIA_COMMAND_CONTEXT_STALE', 'Media workflow cannot be retried');
    }
    let dailyLimit: number | undefined;
    let enqueue = options.enqueueGeneration;
    if (workflow.operation === 'IMAGE_TRANSLATE') {
      dailyLimit = await options.getTranslationDailyLimit();
      enqueue = options.enqueueTranslation;
    } else if (workflow.operation === 'FULL_EDIT' || workflow.operation === 'INPAINT') {
      dailyLimit = await options.getEditDailyLimit();
      enqueue = options.enqueueEdit;
    }
    if (dailyLimit != null && (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0)) {
      fail('MEDIA_QUOTA_UNAVAILABLE', 'Media retry quota is unavailable');
    }
    const retried = await options.workflowService.retry({
      id: workflow.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      expectedRevision: requested.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      ...(dailyLimit == null ? {} : { dailyLimit }),
    });
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
