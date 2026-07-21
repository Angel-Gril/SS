import type { AiMediaWorkflowService } from './ai-media-workflows.js';

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
  loadListingDraft(input: {
    listingWorkflowId: string;
    ownerUserId: string;
  }): Promise<CurrentListingDraft | null>;
  getTranslationDailyLimit(): Promise<number>;
  getEditDailyLimit(): Promise<number>;
  enqueueGeneration(jobId: string): Promise<void>;
  enqueueTranslation(jobId: string): Promise<void>;
  enqueueEdit(jobId: string): Promise<void>;
  markEnqueueFailed(jobId: string): Promise<boolean>;
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
    if (!retried.replayed) {
      try {
        await enqueue(retried.jobId);
      } catch {
        const markedFailed = await options.markEnqueueFailed(retried.jobId);
        if (markedFailed) {
          fail('MEDIA_QUEUE_UNAVAILABLE', 'Media queue is temporarily unavailable');
        }
      }
    }
    return {
      workflowId: retried.workflow.id,
      action: requested.action,
      status: retried.workflow.status,
      revision: retried.workflow.revision,
    };
  };
}
