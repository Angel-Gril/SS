import type { ApplyAiMediaListingDraftApplicationInput } from './ai-media-listing-draft-application-mutations.js';
import type { AiMediaWorkflowService } from './ai-media-workflows.js';
import {
  assertExtensionMediaJobProviderAuthorized,
  ExtensionMediaProviderAuthorizationError,
  type ExtensionMediaProviderReadiness,
} from './extension-media-workflow-commands.js';

export const EXTENSION_MEDIA_REVIEW_COMMAND_VERSION =
  'ai-media-workflow-review/v1' as const;
export const EXTENSION_MEDIA_APPLY_COMMAND_VERSION =
  'ai-media-workflow-apply/v1' as const;

interface CurrentListingDraft {
  id: string;
  ownerUserId: string;
  shopId: string;
  revision: number;
  draftVersion: number;
}

interface ExtensionMediaReviewCommand {
  schemaVersion: typeof EXTENSION_MEDIA_REVIEW_COMMAND_VERSION;
  action: 'REVIEW';
  mediaWorkflowId: string;
  expectedRevision: number;
  draftRevision: number;
  outputAssetId: string;
  decision: 'APPROVE' | 'REJECT';
  note: string | null;
}

interface ExtensionMediaApplyCommand {
  schemaVersion: typeof EXTENSION_MEDIA_APPLY_COMMAND_VERSION;
  action: 'APPLY';
  mediaWorkflowId: string;
  expectedWorkflowRevision: number;
  expectedTargetRevision: number;
  expectedTargetDraftVersion: number;
  outputAssetId: string;
  mode: 'append';
}

export class ExtensionMediaReviewCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionMediaReviewCommandError';
  }
}

function fail(code: string, message: string): never {
  throw new ExtensionMediaReviewCommandError(code, message);
}

function identifier(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string') fail('MEDIA_REVIEW_COMMAND_INVALID', `${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > maximum) {
    fail('MEDIA_REVIEW_COMMAND_INVALID', `${field} is invalid`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail('MEDIA_REVIEW_COMMAND_INVALID', `${field} is invalid`);
  }
  return Number(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const expected = [...keys].sort().join(',');
  if (Object.keys(value).sort().join(',') !== expected) {
    fail('MEDIA_REVIEW_COMMAND_INVALID', 'Media review command contains unknown fields');
  }
}

export function parseExtensionMediaReviewCommand(
  value: Record<string, unknown>,
): ExtensionMediaReviewCommand | null {
  if (value?.schemaVersion !== EXTENSION_MEDIA_REVIEW_COMMAND_VERSION) return null;
  exactKeys(value, [
    'schemaVersion', 'action', 'mediaWorkflowId', 'expectedRevision', 'draftRevision',
    'outputAssetId', 'decision', 'note',
  ]);
  if (value.action !== 'REVIEW' || !['APPROVE', 'REJECT'].includes(String(value.decision || ''))) {
    fail('MEDIA_REVIEW_COMMAND_INVALID', 'Media review decision is invalid');
  }
  const note = value.note == null ? null : identifier(value.note, 'note', 1_000);
  return {
    schemaVersion: EXTENSION_MEDIA_REVIEW_COMMAND_VERSION,
    action: 'REVIEW',
    mediaWorkflowId: identifier(value.mediaWorkflowId, 'mediaWorkflowId'),
    expectedRevision: positiveInteger(value.expectedRevision, 'expectedRevision'),
    draftRevision: positiveInteger(value.draftRevision, 'draftRevision'),
    outputAssetId: identifier(value.outputAssetId, 'outputAssetId'),
    decision: value.decision as 'APPROVE' | 'REJECT',
    note,
  };
}

export function parseExtensionMediaApplyCommand(
  value: Record<string, unknown>,
): ExtensionMediaApplyCommand | null {
  if (value?.schemaVersion !== EXTENSION_MEDIA_APPLY_COMMAND_VERSION) return null;
  exactKeys(value, [
    'schemaVersion', 'action', 'mediaWorkflowId', 'expectedWorkflowRevision',
    'expectedTargetRevision', 'expectedTargetDraftVersion', 'outputAssetId', 'mode',
  ]);
  if (value.action !== 'APPLY' || value.mode !== 'append') {
    fail('MEDIA_APPLY_COMMAND_INVALID', 'Extension media application permits append only');
  }
  return {
    schemaVersion: EXTENSION_MEDIA_APPLY_COMMAND_VERSION,
    action: 'APPLY',
    mediaWorkflowId: identifier(value.mediaWorkflowId, 'mediaWorkflowId'),
    expectedWorkflowRevision: positiveInteger(
      value.expectedWorkflowRevision,
      'expectedWorkflowRevision',
    ),
    expectedTargetRevision: positiveInteger(
      value.expectedTargetRevision,
      'expectedTargetRevision',
    ),
    expectedTargetDraftVersion: positiveInteger(
      value.expectedTargetDraftVersion,
      'expectedTargetDraftVersion',
    ),
    outputAssetId: identifier(value.outputAssetId, 'outputAssetId'),
    mode: 'append',
  };
}

function currentJob(workflow: any) {
  return Array.isArray(workflow?.jobs) ? workflow.jobs.at(-1) : null;
}

function assertFrozenContext(input: {
  ownerUserId: string;
  shopId: string;
  listingWorkflowId: string;
  draftVersion: number;
  draftRevision: number;
  draft: CurrentListingDraft | null;
  workflow: any;
}) {
  const { draft, workflow } = input;
  if (!draft
    || draft.id !== input.listingWorkflowId
    || draft.ownerUserId !== input.ownerUserId
    || draft.shopId !== input.shopId
    || workflow.contextType !== 'listing-draft'
    || workflow.contextId !== draft.id
    || workflow.contextDraftRevision !== input.draftRevision
    || workflow.contextDraftVersion !== input.draftVersion
    || workflow.suiteId != null) {
    fail('MEDIA_REVIEW_CONTEXT_STALE', 'Media review context changed');
  }
  const job = currentJob(workflow);
  return job;
}

type ExtensionMediaProviderReadinessLoader = (
  operation: string,
) => Promise<ExtensionMediaProviderReadiness>;

async function assertProviderAuthorized(input: {
  operation: string;
  job: any;
  production: boolean;
  getProviderReadiness?: ExtensionMediaProviderReadinessLoader;
}) {
  let readiness: ExtensionMediaProviderReadiness | undefined;
  if (String(input.job?.provider || '').trim() !== 'fake') {
    if (!input.getProviderReadiness) {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Paid AI image capability authorization is unavailable');
    }
    try {
      readiness = await input.getProviderReadiness(input.operation);
    } catch {
      fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Paid AI image capability authorization is unavailable');
    }
  }
  try {
    assertExtensionMediaJobProviderAuthorized({
      operation: input.operation,
      job: input.job,
      readiness,
      production: input.production,
      requireReadiness: false,
      requireGlobalDailyBudget: false,
    });
  } catch (error) {
    if (error instanceof ExtensionMediaProviderAuthorizationError) {
      fail(error.code, error.message);
    }
    fail('MEDIA_CAPABILITY_UNAVAILABLE', 'Media Provider authorization is unavailable');
  }
}

function reviewableOutput(job: any, ownerUserId: string, outputAssetId: string) {
  return Array.isArray(job?.assets) && job.assets.some((asset: any) => (
    asset?.id === outputAssetId
    && asset.ownerUserId === ownerUserId
    && asset.aiImageJobId === job.id
    && asset.kind === 'AI_GENERATED'
    && ['local', 'oss'].includes(String(asset.storageBackend || ''))
  ));
}

function reviewReplayWasRecorded(
  workflow: any,
  requested: ExtensionMediaReviewCommand,
  operationKey: string,
) {
  const eventType = requested.decision === 'APPROVE' ? 'REVIEW_APPROVED' : 'REVIEW_REJECTED';
  const eventKey = `${workflow.id}:review:${requested.expectedRevision}`;
  return Array.isArray(workflow?.events) && workflow.events.some((event: any) => (
    event?.eventKey === eventKey
    && event.eventType === eventType
    && event.assetId === requested.outputAssetId
    && event.payload
    && typeof event.payload === 'object'
    && !Array.isArray(event.payload)
    && Object.keys(event.payload).sort().join(',') === 'note,operationKey'
    && Object.prototype.hasOwnProperty.call(event.payload, 'note')
    && event.payload.note === requested.note
    && event.payload.operationKey === operationKey
  ));
}

export function createExtensionMediaReviewCommandExecutor(options: {
  workflowService: Pick<AiMediaWorkflowService, 'get' | 'review'>;
  loadListingDraft(input: {
    listingWorkflowId: string;
    ownerUserId: string;
  }): Promise<CurrentListingDraft | null>;
  getProviderReadiness?: ExtensionMediaProviderReadinessLoader;
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
    const requested = parseExtensionMediaReviewCommand(input.command);
    if (!requested) fail('MEDIA_REVIEW_COMMAND_INVALID', 'Media review command is invalid');
    const operationKey = identifier(input.idempotencyKey, 'idempotencyKey');
    if (operationKey.length < 16) {
      fail('MEDIA_REVIEW_COMMAND_INVALID', 'idempotencyKey is invalid');
    }
    const [draft, workflow] = await Promise.all([
      options.loadListingDraft({
        listingWorkflowId: input.listingWorkflowId,
        ownerUserId: input.ownerUserId,
      }),
      options.workflowService.get(requested.mediaWorkflowId, input.ownerUserId),
    ]);
    const job = assertFrozenContext({
      ...input,
      draftRevision: requested.draftRevision,
      draft,
      workflow,
    });
    const production = options.production ?? process.env.NODE_ENV === 'production';
    await assertProviderAuthorized({
      operation: workflow.operation,
      job,
      production,
      getProviderReadiness: options.getProviderReadiness,
    });
    if (workflow.status !== 'SUCCEEDED'
      || job?.status !== 'SUCCEEDED'
      || !reviewableOutput(job, input.ownerUserId, requested.outputAssetId)) {
      fail('MEDIA_REVIEW_CONTEXT_STALE', 'Media output is no longer reviewable');
    }
    const expectedReviewStatus = requested.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (workflow.revision !== requested.expectedRevision) {
      if (workflow.reviewStatus === expectedReviewStatus
        && workflow.selectedOutputAssetId === requested.outputAssetId
        && reviewReplayWasRecorded(workflow, requested, operationKey)
        && draft
        && draft.revision >= requested.draftRevision
        && draft.draftVersion >= input.draftVersion) {
        return {
          workflowId: workflow.id,
          action: 'REVIEW' as const,
          status: workflow.status,
          reviewStatus: workflow.reviewStatus,
          selectedOutputAssetId: workflow.selectedOutputAssetId,
          revision: workflow.revision,
          replayed: true,
        };
      }
      fail('MEDIA_REVIEW_CONTEXT_STALE', 'Media workflow review state changed');
    }
    if (!draft
      || draft.revision !== requested.draftRevision
      || draft.draftVersion !== input.draftVersion) {
      fail('MEDIA_REVIEW_CONTEXT_STALE', 'Media review context changed');
    }
    if (workflow.reviewStatus !== 'PENDING') {
      fail('MEDIA_REVIEW_CONTEXT_STALE', 'Media workflow is not pending review');
    }
    const updated = await options.workflowService.review({
      id: workflow.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      expectedRevision: requested.expectedRevision,
      outputAssetId: requested.outputAssetId,
      decision: requested.decision,
      note: requested.note,
      operationKey,
    });
    return {
      workflowId: updated.id,
      action: 'REVIEW' as const,
      status: updated.status,
      reviewStatus: updated.reviewStatus,
      selectedOutputAssetId: updated.selectedOutputAssetId,
      revision: updated.revision,
      replayed: false,
    };
  };
}

export function createExtensionMediaApplyCommandExecutor(options: {
  workflowService: Pick<AiMediaWorkflowService, 'get'>;
  applyListingDraftApplication(
    input: ApplyAiMediaListingDraftApplicationInput,
  ): Promise<any>;
  getProviderReadiness?: ExtensionMediaProviderReadinessLoader;
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
    const requested = parseExtensionMediaApplyCommand(input.command);
    if (!requested) fail('MEDIA_APPLY_COMMAND_INVALID', 'Media apply command is invalid');
    const workflow = await options.workflowService.get(
      requested.mediaWorkflowId,
      input.ownerUserId,
    );
    const job = currentJob(workflow);
    if (requested.expectedTargetDraftVersion !== input.draftVersion
      || workflow.contextType !== 'listing-draft'
      || workflow.contextId !== input.listingWorkflowId
      || workflow.contextDraftRevision !== requested.expectedTargetRevision
      || workflow.contextDraftVersion !== requested.expectedTargetDraftVersion
      || workflow.suiteId != null
      || workflow.status !== 'SUCCEEDED'
      || job?.status !== 'SUCCEEDED'
      || workflow.reviewStatus !== 'APPROVED'
      || workflow.selectedOutputAssetId !== requested.outputAssetId
      || !reviewableOutput(job, input.ownerUserId, requested.outputAssetId)) {
      fail('MEDIA_APPLY_CONTEXT_STALE', 'Media output is no longer applicable');
    }
    const production = options.production ?? process.env.NODE_ENV === 'production';
    await assertProviderAuthorized({
      operation: workflow.operation,
      job,
      production,
      getProviderReadiness: options.getProviderReadiness,
    });
    const result = await options.applyListingDraftApplication({
      workflowId: workflow.id,
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      mode: 'append',
      operationKey: input.idempotencyKey,
      expectedWorkflowRevision: requested.expectedWorkflowRevision,
      expectedTargetRevision: requested.expectedTargetRevision,
      expectedTargetDraftVersion: requested.expectedTargetDraftVersion,
      production,
    });
    const application = result.application || null;
    const applicationId = String(application?.id || '');
    const revision = Number(application?.workflowRevisionAfter || 0);
    const targetRevision = Number(application?.targetRevisionAfter || 0);
    const targetDraftVersion = Number(application?.targetDraftVersionAfter || 0);
    if (!applicationId
      || application.operationKey !== input.idempotencyKey
      || application.workflowId !== workflow.id
      || application.outputAssetId !== requested.outputAssetId
      || application.mode !== 'append'
      || application.rolledBackById != null
      || application.workflowRevisionBefore !== requested.expectedWorkflowRevision
      || application.targetRevisionBefore !== requested.expectedTargetRevision
      || application.targetDraftVersionBefore !== requested.expectedTargetDraftVersion
      || !Number.isSafeInteger(revision) || revision < 1
      || !Number.isSafeInteger(targetRevision) || targetRevision < 1
      || !Number.isSafeInteger(targetDraftVersion) || targetDraftVersion < 1
      || revision <= requested.expectedWorkflowRevision
      || targetRevision <= requested.expectedTargetRevision
      || targetDraftVersion <= requested.expectedTargetDraftVersion) {
      fail('MEDIA_APPLY_STATE_UNAVAILABLE', 'Media application result is unavailable');
    }
    return {
      workflowId: workflow.id,
      action: 'APPLY' as const,
      status: workflow.status,
      reviewStatus: workflow.reviewStatus,
      selectedOutputAssetId: requested.outputAssetId,
      revision,
      applicationId,
      targetRevision,
      targetDraftVersion,
      replayed: result.replayed === true,
    };
  };
}

export type ExtensionMediaReviewCommandExecutor = ReturnType<
  typeof createExtensionMediaReviewCommandExecutor
>;
export type ExtensionMediaApplyCommandExecutor = ReturnType<
  typeof createExtensionMediaApplyCommandExecutor
>;
