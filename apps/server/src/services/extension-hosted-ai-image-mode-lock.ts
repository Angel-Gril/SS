import {
  isExtensionHostedAiImagePrePublishDraftStage,
  type ExtensionHostedAiImagePlanAuthority,
  type ExtensionHostedAiImagePlanBinding,
  type ExtensionHostedAiImagePlanIdentity,
  type ExtensionHostedAiImagePlanPolicyDecision,
} from './extension-hosted-ai-image-plan.js';

export const EXTENSION_HOSTED_AI_IMAGE_MODE_LOCK_VERSION =
  'extension-hosted-ai-image-mode-lock/v1' as const;

export type ExtensionHostedAiImageModeLockState = 'NO_SUITE' | 'HAS_SUITE';

export type ExtensionHostedAiImageModeLockErrorCode =
  | 'HOSTED_AI_IMAGE_MODE_LOCK_INVALID_REQUEST'
  | 'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN'
  | 'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_NOT_FOUND'
  | 'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_STALE'
  | 'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE';

export class ExtensionHostedAiImageModeLockError extends Error {
  constructor(
    public readonly code: ExtensionHostedAiImageModeLockErrorCode,
    public readonly statusCode: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionHostedAiImageModeLockError';
  }
}

export interface ExtensionHostedAiImageModeLockServiceOptions {
  loadAuthority(input: {
    ownerUserId: string;
    listingWorkflowId: string;
  }): Promise<ExtensionHostedAiImagePlanAuthority | null>;
  hasHostedSuite(input: {
    ownerUserId: string;
    binding: ExtensionHostedAiImagePlanBinding;
  }): Promise<unknown>;
  evaluatePolicy(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
  }): Promise<ExtensionHostedAiImagePlanPolicyDecision>;
}

interface ModeLockRequest {
  identity: ExtensionHostedAiImagePlanIdentity;
  binding: ExtensionHostedAiImagePlanBinding;
}

function fail(
  code: ExtensionHostedAiImageModeLockErrorCode,
  statusCode: 400 | 403 | 404 | 409 | 503,
  message: string,
): never {
  throw new ExtensionHostedAiImageModeLockError(code, statusCode, message);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 200
    || value !== value.trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return fail('HOSTED_AI_IMAGE_MODE_LOCK_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('HOSTED_AI_IMAGE_MODE_LOCK_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return Number(value);
}

function normalizeIdentity(value: ExtensionHostedAiImagePlanIdentity) {
  const identity = {
    ownerUserId: identifier(value?.ownerUserId, 'ownerUserId'),
    actorUserId: identifier(value?.actorUserId, 'actorUserId'),
    deviceSessionId: identifier(value?.deviceSessionId, 'deviceSessionId'),
  };
  if (identity.ownerUserId !== identity.actorUserId) {
    return fail(
      'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN',
      403,
      'Hosted mode status requires an owner device session',
    );
  }
  return identity;
}

function normalizeBinding(value: ExtensionHostedAiImagePlanBinding) {
  return {
    snapshotId: identifier(value?.snapshotId, 'snapshotId'),
    supplyGoodsId: identifier(value?.supplyGoodsId, 'supplyGoodsId'),
    shopId: identifier(value?.shopId, 'shopId'),
    listingWorkflowId: identifier(value?.listingWorkflowId, 'listingWorkflowId'),
    draftRevision: positiveInteger(value?.draftRevision, 'draftRevision'),
    draftVersion: positiveInteger(value?.draftVersion, 'draftVersion'),
  };
}

function sameBinding(
  left: ExtensionHostedAiImagePlanBinding,
  right: ExtensionHostedAiImagePlanBinding,
) {
  return left.snapshotId === right.snapshotId
    && left.supplyGoodsId === right.supplyGoodsId
    && left.shopId === right.shopId
    && left.listingWorkflowId === right.listingWorkflowId
    && left.draftRevision === right.draftRevision
    && left.draftVersion === right.draftVersion;
}

function exactPolicy(
  value: ExtensionHostedAiImagePlanPolicyDecision,
  identity: ReturnType<typeof normalizeIdentity>,
  binding: ReturnType<typeof normalizeBinding>,
) {
  if (!value
    || typeof value.enabled !== 'boolean'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || value.ownerUserId !== identity.ownerUserId
    || value.shopId !== binding.shopId
    || value.deviceSessionId !== identity.deviceSessionId) {
    return fail(
      'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
      503,
      'Hosted execution policy status is unavailable',
    );
  }
  return value;
}

function exactAuthority(
  value: ExtensionHostedAiImagePlanAuthority | null,
  identity: ReturnType<typeof normalizeIdentity>,
  binding: ReturnType<typeof normalizeBinding>,
) {
  if (!value) {
    return fail(
      'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_NOT_FOUND',
      404,
      'Hosted mode context was not found',
    );
  }
  if (value.ownerUserId !== identity.ownerUserId || value.shopId !== binding.shopId) {
    return fail(
      'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN',
      403,
      'Hosted mode context is forbidden',
    );
  }
  if (!sameBinding(value, binding)
    || value.sourceCaptureCurrent !== true
    || value.workflowStatus !== 'ACTIVE'
    || !isExtensionHostedAiImagePrePublishDraftStage(value.draftStage)) {
    return fail(
      'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_STALE',
      409,
      'Hosted mode context is stale',
    );
  }
  return value;
}

export function createExtensionHostedAiImageModeLockService(
  options: ExtensionHostedAiImageModeLockServiceOptions,
) {
  return {
    async get(request: ModeLockRequest) {
      const identity = normalizeIdentity(request.identity);
      const binding = normalizeBinding(request.binding);
      let authorityResult: PromiseSettledResult<ExtensionHostedAiImagePlanAuthority | null>;
      let policyResult: PromiseSettledResult<ExtensionHostedAiImagePlanPolicyDecision>;
      [authorityResult, policyResult] = await Promise.allSettled([
        options.loadAuthority({
          ownerUserId: identity.ownerUserId,
          listingWorkflowId: binding.listingWorkflowId,
        }),
        options.evaluatePolicy({
          ownerUserId: identity.ownerUserId,
          shopId: binding.shopId,
          deviceSessionId: identity.deviceSessionId,
        }),
      ]);
      if (authorityResult.status === 'rejected' || policyResult.status === 'rejected') {
        return fail(
          'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
          503,
          'Hosted mode authority is unavailable',
        );
      }
      exactAuthority(authorityResult.value, identity, binding);
      const policy = exactPolicy(policyResult.value, identity, binding);

      let hasSuite: unknown;
      try {
        hasSuite = await options.hasHostedSuite({
          ownerUserId: identity.ownerUserId,
          binding,
        });
      } catch {
        return fail(
          'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
          503,
          'Hosted suite status is unavailable',
        );
      }
      if (typeof hasSuite !== 'boolean') {
        return fail(
          'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
          503,
          'Hosted suite status is invalid',
        );
      }

      return {
        contractVersion: EXTENSION_HOSTED_AI_IMAGE_MODE_LOCK_VERSION,
        context: { ...binding },
        state: (hasSuite ? 'HAS_SUITE' : 'NO_SUITE') as ExtensionHostedAiImageModeLockState,
        hostedExecutionEnabled: policy.enabled,
      };
    },
  };
}

export type ExtensionHostedAiImageModeLockService = ReturnType<
  typeof createExtensionHostedAiImageModeLockService
>;
