import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EXTENSION_COMMAND_OPERATIONS,
  EXTENSION_COMMAND_SCOPE_BY_OPERATION,
  ExtensionCommandGrantError,
  hashExtensionCommandRequest,
  type ExtensionCommandOperation,
} from '../services/extension-command-grants.js';
import {
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import {
  ExtensionMediaWorkflowLaunchError,
  parseExtensionMediaWorkflowCreateCommand,
  parseExtensionMediaTranslationCreateCommand,
} from '../services/extension-media-workflow-launch.js';
import {
  parseExtensionMediaApplyCommand,
  parseExtensionMediaReviewCommand,
} from '../services/extension-media-review-commands.js';
import { createAiMediaListingDraftApplyFingerprint } from '../services/ai-media-listing-draft-application-mutations.js';
import { resolveAiImageProviderCapability } from '../services/ai-image-provider-capabilities.js';
import {
  EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION,
  parseExtensionAiImageSuiteApplyCommand,
  parseExtensionAiImageSuiteExecuteCommand,
  parseExtensionAiImageSuiteReviewCommand,
} from '../services/extension-ai-image-suite.js';
import {
  createByokMediaIngestCommandResolver,
  EXTENSION_BYOK_MEDIA_INGEST_OPERATION,
  type ByokMediaIngestCommandResolverOptions,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  OZON_PUBLISH_ATTEMPT_STATES,
  type OzonPublishAttemptRecord,
  type OzonPublishAttemptState,
} from '../services/ozon-publish-attempts.js';

interface MediaWorkflowRolloutDecision {
  enabled: boolean;
  revision: string | number;
  reason: string;
}

interface CommandDeviceContext {
  sessionId: string;
  tokenId: string;
  ownerUserId: string;
  actorUserId: string;
  scopes: string[];
  allowedShopIds: string[];
}

export interface ExtensionCommandResolutionInput {
  sessionId: string;
  ownerUserId: string;
  operation: ExtensionCommandOperation;
  shopId: string | null;
  workflowId: string | null;
  draftVersion: number | null;
  purpose?: 'issue' | 'execute';
  idempotencyKey?: string;
  command: Record<string, unknown>;
}

export type ExtensionCommandResolution =
  | {
    kind: 'allowed';
    shopId: string | null;
    workflowId: string | null;
    draftVersion: number | null;
    command: Record<string, unknown>;
  }
  | { kind: 'unavailable' | 'stale' | 'forbidden' | 'rollout_unavailable' };

export interface SourceWorkflowCommandResolverOptions {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  getMediaWorkflowDecision?: (ownerUserId: string) => Promise<MediaWorkflowRolloutDecision>;
  getAiImageSuiteEnabled?: (ownerUserId: string) => Promise<boolean>;
  getByokReadiness?: ByokMediaIngestCommandResolverOptions['getReadiness'];
  authorizeByokPublish?(input: {
    ownerUserId: string;
    shopId: string;
    workflowId: string;
    assignments: Array<{ assetId: string }>;
    requestingDeviceSessionId: string;
  }): Promise<unknown>;
  production?: boolean;
  loadShop(input: {
    shopId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft?(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    ownerUserId: string;
    shopId: string;
    draftVersion: number;
    revision: number;
    stage: string;
    selectedSkuKeys: string[];
    publishTaskIds: string[];
    supplyGoodsId?: string;
    sourceCaptureSnapshotId?: string;
    media?: { assignments: Array<{ assetId: string }> };
  } | null>;
  loadMediaWorkflow?(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<{
    id: string;
    ownerUserId: string;
    contextType: string | null;
    contextId: string | null;
    contextDraftRevision: number | null;
    contextDraftVersion: number | null;
    revision: number;
    status: string;
    operation?: string;
    reviewStatus?: string;
    selectedOutputAssetId?: string | null;
    suiteId: string | null;
    provider: string | null;
    model?: string | null;
    currentJobStatus?: string | null;
    outputAssetIds?: string[];
    reviewEvents?: Array<{
      eventKey: string;
      eventType: string;
      assetId: string | null;
      payload: unknown;
    }>;
    applications?: Array<{
      assetId: string;
      operationKey: string;
      requestFingerprint: string;
      workflowRevisionBefore: number;
      workflowRevisionAfter: number;
      targetRevisionBefore: number;
      targetDraftVersionBefore: number;
      targetRevisionAfter: number;
      targetDraftVersionAfter: number;
      rolledBackById: string | null;
    }>;
  } | null>;
  loadMediaLaunchContext?(input: {
    ownerUserId: string;
    workflowId: string;
    draftRevision: number;
    draftVersion: number;
    sourceMediaKey: string;
  }): Promise<{ sourceMediaKeys: string[] } | null>;
}

const sourceCaptureCommandSchema = z.object({
  schemaVersion: z.literal('source-product-capture-v2'),
  platform: z.literal('1688'),
  sourceProductId: z.string().trim().min(1).max(200),
  captureHash: z.string().regex(/^[a-f0-9]{64}$/),
  payloadBytes: z.number().int().positive().max(8 * 1024 * 1024),
}).strict();

const ozonPublishCommandSchema = z.object({
  schemaVersion: z.literal('ozon-publish-command/v1'),
  draftRevision: z.number().int().nonnegative(),
  publishIntentId: z.string().trim().min(1).max(200),
  selectedSkuKeys: z.array(z.string().trim().min(1).max(500)).min(1).max(500),
}).strict();

const mediaWorkflowCommandSchema = z.object({
  schemaVersion: z.literal('ai-media-workflow-command/v1'),
  action: z.enum(['CANCEL', 'RETRY']),
  mediaWorkflowId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  draftRevision: z.number().int().positive(),
}).strict();

function rolloutUnavailableReason(reason: string) {
  return ['invalid_policy', 'policy_invalid', 'context_invalid', 'config_unavailable'].includes(reason);
}

function mediaWorkflowDecision(
  options: SourceWorkflowCommandResolverOptions,
  ownerUserId: string,
): Promise<MediaWorkflowRolloutDecision> {
  return options.getMediaWorkflowDecision
    ? options.getMediaWorkflowDecision(ownerUserId)
    : options.featureFlags.evaluate('AI_MEDIA_WORKFLOW_V2', { ownerUserId });
}

function mediaProviderAllowed(
  media: { provider: string | null; model?: string | null; operation?: string },
  production: boolean,
): boolean {
  const provider = String(media.provider || '').trim();
  const model = String(media.model || '').trim();
  const operation = String(media.operation || '');
  if (!provider) return false;
  if (provider === 'fake') return !production;
  if (!model || !['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) return false;
  const capability = resolveAiImageProviderCapability(provider, model);
  return capability?.evidenceLevel === 'sandbox-verified'
    && capability.operations.includes(operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT');
}

export function createSourceWorkflowCommandResolver(
  options: SourceWorkflowCommandResolverOptions,
) {
  const byokMediaIngestResolver = options.getByokReadiness && options.loadDraft
    ? createByokMediaIngestCommandResolver({
      loadShop: options.loadShop,
      loadDraft: async (input) => {
        const draft = await options.loadDraft!(input);
        if (!draft?.sourceCaptureSnapshotId) return null;
        return {
          id: draft.id,
          ownerUserId: draft.ownerUserId,
          shopId: draft.shopId,
          draftVersion: draft.draftVersion,
          revision: draft.revision,
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
          selectedSkuKeys: draft.selectedSkuKeys,
        };
      },
      getReadiness: options.getByokReadiness,
    })
    : null;

  return async (input: ExtensionCommandResolutionInput): Promise<ExtensionCommandResolution> => {
    if (input.operation === 'SOURCE_CAPTURE') {
      if (input.shopId || input.workflowId || input.draftVersion != null) {
        return { kind: 'forbidden' };
      }
      const parsed = sourceCaptureCommandSchema.safeParse(input.command);
      if (!parsed.success) return { kind: 'forbidden' };
      let rollout;
      try {
        rollout = await options.featureFlags.evaluate('SOURCE_CAPTURE_V2', {
          ownerUserId: input.ownerUserId,
          deviceSessionId: input.sessionId,
          platform: parsed.data.platform,
        });
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!rollout.enabled) {
        return rollout.legacyAllowed
          ? { kind: 'unavailable' }
          : { kind: 'rollout_unavailable' };
      }
      return {
        kind: 'allowed',
        shopId: null,
        workflowId: null,
        draftVersion: null,
        command: parsed.data,
      };
    }
    if (input.operation === 'BYOK_MEDIA_INGEST') {
      if (!byokMediaIngestResolver) return { kind: 'unavailable' };
      return byokMediaIngestResolver({
        ...input,
        operation: 'BYOK_MEDIA_INGEST',
      });
    }
    const suiteCommandVersion = typeof input.command?.version === 'string'
      ? input.command.version
      : null;
    const expectedSuiteVersion = input.operation === 'MEDIA_EXECUTE'
      ? EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION
      : input.operation === 'MEDIA_REVIEW'
        ? EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION
        : input.operation === 'MEDIA_APPLY'
          ? EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION
          : null;
    if (suiteCommandVersion && suiteCommandVersion === expectedSuiteVersion) {
      if (!input.shopId || !input.workflowId || input.draftVersion == null || !options.loadDraft) {
        return { kind: 'forbidden' };
      }
      let command;
      try {
        command = input.operation === 'MEDIA_EXECUTE'
          ? parseExtensionAiImageSuiteExecuteCommand(input.command)
          : input.operation === 'MEDIA_REVIEW'
            ? parseExtensionAiImageSuiteReviewCommand(input.command)
            : parseExtensionAiImageSuiteApplyCommand(input.command);
      } catch {
        return { kind: 'forbidden' };
      }
      let extensionRollout;
      let mediaRollouts;
      let suiteEnabled = false;
      try {
        [extensionRollout, mediaRollouts, suiteEnabled] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
            ownerUserId: input.ownerUserId,
            shopId: input.shopId,
            deviceSessionId: input.sessionId,
          }),
          Promise.all([
            mediaWorkflowDecision(options, input.ownerUserId),
            options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', {
              ownerUserId: input.ownerUserId,
            }),
          ]),
          options.getAiImageSuiteEnabled?.(input.ownerUserId) || Promise.resolve(false),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      const cancel = input.operation === 'MEDIA_EXECUTE' && command.action === 'CANCEL';
      if (!extensionRollout.enabled
        || mediaRollouts.some((decision) => !decision.enabled)
        || (!cancel && !suiteEnabled)) {
        const unavailable = [extensionRollout, ...mediaRollouts]
          .find((decision) => rolloutUnavailableReason(decision.reason));
        return unavailable ? { kind: 'rollout_unavailable' } : { kind: 'unavailable' };
      }
      let shop;
      let draft;
      try {
        [shop, draft] = await Promise.all([
          options.loadShop({ shopId: input.shopId, ownerUserId: input.ownerUserId }),
          options.loadDraft({ workflowId: input.workflowId, ownerUserId: input.ownerUserId }),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!shop
        || shop.id !== input.shopId
        || shop.userId !== input.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE'
        || !draft
        || draft.id !== input.workflowId
        || draft.ownerUserId !== input.ownerUserId
        || draft.shopId !== input.shopId
        || draft.revision !== command.draftRevision
        || draft.draftVersion !== input.draftVersion
        || draft.supplyGoodsId !== command.supplyGoodsId
        || draft.sourceCaptureSnapshotId !== command.snapshotId) {
        return { kind: 'stale' };
      }
      return {
        kind: 'allowed',
        shopId: shop.id,
        workflowId: draft.id,
        draftVersion: draft.draftVersion,
        command: { ...command },
      };
    }
    if (input.operation === 'MEDIA_REVIEW' || input.operation === 'MEDIA_APPLY') {
      if (!input.shopId || !input.workflowId || input.draftVersion == null
        || !input.idempotencyKey
        || input.idempotencyKey !== input.idempotencyKey.normalize('NFKC').trim()
        || input.idempotencyKey.length < 16
        || input.idempotencyKey.length > 200
        || !options.loadDraft || !options.loadMediaWorkflow) return { kind: 'forbidden' };
      let reviewCommand;
      let applyCommand;
      try {
        reviewCommand = input.operation === 'MEDIA_REVIEW'
          ? parseExtensionMediaReviewCommand(input.command)
          : null;
        applyCommand = input.operation === 'MEDIA_APPLY'
          ? parseExtensionMediaApplyCommand(input.command)
          : null;
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) return { kind: 'forbidden' };
        return { kind: 'forbidden' };
      }
      const command = reviewCommand || applyCommand;
      if (!command) return { kind: 'forbidden' };
      let extensionRollout;
      let mediaRollouts;
      try {
        [extensionRollout, mediaRollouts] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
            ownerUserId: input.ownerUserId,
            shopId: input.shopId || undefined,
            deviceSessionId: input.sessionId,
          }),
          Promise.all([
            mediaWorkflowDecision(options, input.ownerUserId),
            options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: input.ownerUserId }),
          ]),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!extensionRollout.enabled || mediaRollouts.some((decision) => !decision.enabled)) {
        const unavailable = [extensionRollout, ...mediaRollouts]
          .find((decision) => rolloutUnavailableReason(decision.reason));
        return unavailable ? { kind: 'rollout_unavailable' } : { kind: 'unavailable' };
      }
      let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
      let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
      let media: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadMediaWorkflow']>>>;
      try {
        [shop, draft, media] = await Promise.all([
          options.loadShop({ shopId: input.shopId!, ownerUserId: input.ownerUserId }),
          options.loadDraft({ workflowId: input.workflowId!, ownerUserId: input.ownerUserId }),
          options.loadMediaWorkflow({
            workflowId: command.mediaWorkflowId,
            ownerUserId: input.ownerUserId,
          }),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      const commandDraftRevision = reviewCommand
        ? reviewCommand.draftRevision
        : applyCommand!.expectedTargetRevision;
      const commandDraftVersion = reviewCommand
        ? input.draftVersion
        : applyCommand!.expectedTargetDraftVersion;
      if (!shop
        || shop.id !== input.shopId
        || shop.userId !== input.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE'
        || !draft
        || draft.id !== input.workflowId
        || draft.ownerUserId !== input.ownerUserId
        || draft.shopId !== input.shopId
        || input.draftVersion !== commandDraftVersion
        || !media
        || media.id !== command.mediaWorkflowId
        || media.ownerUserId !== input.ownerUserId
        || media.contextType !== 'listing-draft'
        || media.contextId !== draft.id
        || media.contextDraftRevision !== commandDraftRevision
        || media.contextDraftVersion !== commandDraftVersion
        || media.suiteId != null
        || !mediaProviderAllowed(
          media,
          options.production ?? process.env.NODE_ENV === 'production',
        )
        || media.currentJobStatus !== 'SUCCEEDED'
        || !Array.isArray(media.outputAssetIds)
        || !media.outputAssetIds.includes(command.outputAssetId)) {
        return { kind: 'forbidden' };
      }
      if (reviewCommand) {
        const expectedReviewStatus = reviewCommand.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const expectedEventType = reviewCommand.decision === 'APPROVE'
          ? 'REVIEW_APPROVED'
          : 'REVIEW_REJECTED';
        const expectedEventKey = `${media.id}:review:${reviewCommand.expectedRevision}`;
        const matchingAudit = Array.isArray(media.reviewEvents)
          && media.reviewEvents.some((event) => {
            const payload = event?.payload && typeof event.payload === 'object'
              && !Array.isArray(event.payload)
              ? event.payload as Record<string, unknown>
              : null;
            return event.eventKey === expectedEventKey
              && event.eventType === expectedEventType
              && event.assetId === reviewCommand.outputAssetId
              && payload
              && Object.keys(payload).sort().join(',') === 'note,operationKey'
              && Object.prototype.hasOwnProperty.call(payload, 'note')
              && payload.note === reviewCommand.note
              && payload.operationKey === input.idempotencyKey;
          });
        const pending = media.reviewStatus === 'PENDING'
          && media.revision === reviewCommand.expectedRevision;
        const replay = media.reviewStatus === expectedReviewStatus
          && media.selectedOutputAssetId === reviewCommand.outputAssetId
          && media.revision > reviewCommand.expectedRevision
          && matchingAudit;
        const pendingReview = pending
          && draft.revision === reviewCommand.draftRevision
          && draft.draftVersion === input.draftVersion;
        const replayedReview = replay
          && draft.revision >= reviewCommand.draftRevision
          && draft.draftVersion >= input.draftVersion;
        if (media.status !== 'SUCCEEDED'
          || (!pendingReview && !replayedReview)) {
          return { kind: 'stale' };
        }
      } else {
        const applications = Array.isArray(media.applications) ? media.applications : [];
        const outputAlreadyApplied = applications.some((application) => (
          application.assetId === applyCommand!.outputAssetId
        ));
        const expectedFingerprint = createAiMediaListingDraftApplyFingerprint({
          workflowId: media.id,
          mode: 'append',
          expectedWorkflowRevision: applyCommand!.expectedWorkflowRevision,
          expectedTargetRevision: applyCommand!.expectedTargetRevision,
          expectedTargetDraftVersion: applyCommand!.expectedTargetDraftVersion,
          replaceConfirmed: false,
        });
        const matchingApplication = input.idempotencyKey
          ? applications.find((application) => (
            application.assetId === applyCommand!.outputAssetId
            && application.operationKey === input.idempotencyKey
            && application.requestFingerprint === expectedFingerprint
            && application.workflowRevisionBefore === applyCommand!.expectedWorkflowRevision
            && application.targetRevisionBefore === applyCommand!.expectedTargetRevision
            && application.targetDraftVersionBefore === applyCommand!.expectedTargetDraftVersion
            && application.workflowRevisionAfter > application.workflowRevisionBefore
            && application.targetRevisionAfter > application.targetRevisionBefore
            && application.targetDraftVersionAfter > application.targetDraftVersionBefore
            && application.rolledBackById === null
          ))
          : null;
        const pendingApply = draft.revision === applyCommand!.expectedTargetRevision
          && draft.draftVersion === applyCommand!.expectedTargetDraftVersion
          && media.revision === applyCommand!.expectedWorkflowRevision
          && !outputAlreadyApplied;
        const replayedApply = Boolean(matchingApplication
          && draft.revision >= matchingApplication.targetRevisionAfter
          && draft.draftVersion >= matchingApplication.targetDraftVersionAfter
          && media.revision >= matchingApplication.workflowRevisionAfter);
        if (media.status !== 'SUCCEEDED'
          || media.reviewStatus !== 'APPROVED'
          || media.selectedOutputAssetId !== applyCommand!.outputAssetId
          || (!pendingApply && !replayedApply)) {
          return { kind: 'stale' };
        }
      }
      return {
        kind: 'allowed',
        shopId: shop.id,
        workflowId: draft.id,
        // Replays remain bound to the immutable command context even after
        // a successful apply advances the current listing draft version.
        draftVersion: commandDraftVersion,
        // The parsed command is a strict JSON object; spreading it keeps the
        // resolver contract independent from the parser's branded interface.
        command: { ...command },
      };
    }
    if (input.operation === 'MEDIA_EXECUTE') {
      if (!input.shopId || !input.workflowId || input.draftVersion == null
        || !options.loadDraft) {
        return { kind: 'forbidden' };
      }
      let createCommand;
      try {
        createCommand = parseExtensionMediaWorkflowCreateCommand(input.command)
          || parseExtensionMediaTranslationCreateCommand(input.command);
      } catch (error) {
        if (error instanceof ExtensionMediaWorkflowLaunchError) return { kind: 'forbidden' };
        throw error;
      }
      if (createCommand) {
        const candidateSourceMediaKeys = (createCommand as { sourceMediaKeys?: unknown }).sourceMediaKeys;
        const sourceMediaKeys = Array.isArray(candidateSourceMediaKeys)
          ? candidateSourceMediaKeys as string[]
          : [(createCommand as { sourceMediaKey: string }).sourceMediaKey];
        if (!options.loadMediaLaunchContext) return { kind: 'forbidden' };
        let extensionRollout;
        let mediaRollouts;
        try {
          [extensionRollout, mediaRollouts] = await Promise.all([
            options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
              ownerUserId: input.ownerUserId,
              shopId: input.shopId,
              deviceSessionId: input.sessionId,
            }),
            Promise.all([
              mediaWorkflowDecision(options, input.ownerUserId),
              options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: input.ownerUserId }),
            ]),
          ]);
        } catch {
          return { kind: 'rollout_unavailable' };
        }
        if (!extensionRollout.enabled || mediaRollouts.some((decision) => !decision.enabled)) {
          const unavailable = [extensionRollout, ...mediaRollouts]
            .find((decision) => rolloutUnavailableReason(decision.reason));
          return unavailable ? { kind: 'rollout_unavailable' } : { kind: 'unavailable' };
        }
        let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
        let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
        let context: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadMediaLaunchContext']>>>;
        try {
          [shop, draft, context] = await Promise.all([
            options.loadShop({ shopId: input.shopId, ownerUserId: input.ownerUserId }),
            options.loadDraft({ workflowId: input.workflowId, ownerUserId: input.ownerUserId }),
            options.loadMediaLaunchContext({
              ownerUserId: input.ownerUserId,
              workflowId: input.workflowId,
              draftRevision: createCommand.draftRevision,
              draftVersion: input.draftVersion,
              sourceMediaKey: sourceMediaKeys[0]!,
            }),
          ]);
        } catch {
          return { kind: 'rollout_unavailable' };
        }
        if (!shop
          || shop.id !== input.shopId
          || shop.userId !== input.ownerUserId
          || shop.platform !== 'OZON'
          || shop.status !== 'ACTIVE'
          || !draft
          || draft.id !== input.workflowId
          || draft.ownerUserId !== input.ownerUserId
          || draft.shopId !== input.shopId) {
          return { kind: 'forbidden' };
        }
        if (draft.draftVersion !== input.draftVersion
          || draft.revision !== createCommand.draftRevision
          || !context
          || sourceMediaKeys.some((sourceMediaKey) => !context.sourceMediaKeys.includes(sourceMediaKey))) {
          return { kind: 'stale' };
        }
        return {
          kind: 'allowed',
          shopId: shop.id,
          workflowId: draft.id,
          draftVersion: draft.draftVersion,
          command: createCommand,
        };
      }
      if (!options.loadMediaWorkflow) return { kind: 'forbidden' };
      const parsedCommand = mediaWorkflowCommandSchema.safeParse(input.command);
      if (!parsedCommand.success) return { kind: 'forbidden' };

      let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
      let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
      let media: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadMediaWorkflow']>>>;
      try {
        [shop, draft, media] = await Promise.all([
          options.loadShop({ shopId: input.shopId, ownerUserId: input.ownerUserId }),
          options.loadDraft({ workflowId: input.workflowId, ownerUserId: input.ownerUserId }),
          options.loadMediaWorkflow({
            workflowId: parsedCommand.data.mediaWorkflowId,
            ownerUserId: input.ownerUserId,
          }),
        ]);
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!shop
        || shop.id !== input.shopId
        || shop.userId !== input.ownerUserId
        || shop.platform !== 'OZON'
        || shop.status !== 'ACTIVE'
        || !draft
        || draft.id !== input.workflowId
        || draft.ownerUserId !== input.ownerUserId
        || draft.shopId !== input.shopId) {
        return { kind: 'forbidden' };
      }
      if (draft.draftVersion !== input.draftVersion
        || draft.revision !== parsedCommand.data.draftRevision) {
        return { kind: 'stale' };
      }
      if (!media
        || media.id !== parsedCommand.data.mediaWorkflowId
        || media.ownerUserId !== input.ownerUserId
        || media.contextType !== 'listing-draft'
        || media.contextId !== input.workflowId
        || media.contextDraftRevision !== parsedCommand.data.draftRevision
        || media.contextDraftVersion !== input.draftVersion
        || media.suiteId != null
        || (parsedCommand.data.action === 'RETRY'
          && !mediaProviderAllowed(
            media,
            options.production ?? process.env.NODE_ENV === 'production',
          ))) {
        return { kind: 'forbidden' };
      }
      const statusAllowed = parsedCommand.data.action === 'CANCEL'
        ? ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(media.status)
        : media.status === 'FAILED';
      if (media.revision !== parsedCommand.data.expectedRevision || !statusAllowed) {
        return { kind: 'stale' };
      }

      let rollout;
      try {
        rollout = await options.featureFlags.evaluate('SOURCE_LISTING_EXTENSION_WORKBENCH', {
          ownerUserId: input.ownerUserId,
          shopId: input.shopId,
          deviceSessionId: input.sessionId,
        });
      } catch {
        return { kind: 'rollout_unavailable' };
      }
      if (!rollout.enabled) {
        return rolloutUnavailableReason(rollout.reason)
          ? { kind: 'rollout_unavailable' }
          : { kind: 'unavailable' };
      }
      if (parsedCommand.data.action === 'RETRY') {
        let mediaWorkflowRollout;
        let webMediaRollout;
        try {
          [mediaWorkflowRollout, webMediaRollout] = await Promise.all([
            mediaWorkflowDecision(options, input.ownerUserId),
            options.featureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', {
              ownerUserId: input.ownerUserId,
            }),
          ]);
        } catch {
          return { kind: 'rollout_unavailable' };
        }
        const unavailable = [mediaWorkflowRollout, webMediaRollout].find((item) => !item.enabled);
        if (unavailable) {
          return rolloutUnavailableReason(unavailable.reason)
            ? { kind: 'rollout_unavailable' }
            : { kind: 'unavailable' };
        }
      }
      return {
        kind: 'allowed',
        shopId: shop.id,
        workflowId: draft.id,
        draftVersion: draft.draftVersion,
        command: parsedCommand.data,
      };
    }
    if (input.operation !== 'OZON_PUBLISH') return { kind: 'unavailable' };
    if (!input.shopId || !input.workflowId || input.draftVersion == null) {
      return { kind: 'forbidden' };
    }
    const parsedCommand = ozonPublishCommandSchema.safeParse(input.command);
    if (!parsedCommand.success || !options.loadDraft) return { kind: 'forbidden' };

    let shop: Awaited<ReturnType<SourceWorkflowCommandResolverOptions['loadShop']>>;
    try {
      shop = await options.loadShop({
        shopId: input.shopId,
        ownerUserId: input.ownerUserId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    if (!shop
      || shop.id !== input.shopId
      || shop.userId !== input.ownerUserId
      || shop.platform !== 'OZON'
      || shop.status !== 'ACTIVE') {
      return { kind: 'forbidden' };
    }

    let draft: Awaited<ReturnType<NonNullable<SourceWorkflowCommandResolverOptions['loadDraft']>>>;
    try {
      draft = await options.loadDraft({
        workflowId: input.workflowId,
        ownerUserId: input.ownerUserId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    const selectedSkuKeys = [...new Set(parsedCommand.data.selectedSkuKeys)];
    if (!draft
      || draft.id !== input.workflowId
      || draft.ownerUserId !== input.ownerUserId
      || draft.shopId !== input.shopId
      || draft.draftVersion !== input.draftVersion
      || draft.revision !== parsedCommand.data.draftRevision
      || draft.stage !== 'PUBLISH_INTENT_RECORDED'
      || !draft.publishTaskIds.includes(parsedCommand.data.publishIntentId)
      || selectedSkuKeys.length !== parsedCommand.data.selectedSkuKeys.length
      || selectedSkuKeys.length !== draft.selectedSkuKeys.length
      || selectedSkuKeys.some((key, index) => key !== draft.selectedSkuKeys[index])) {
      return { kind: 'stale' };
    }

    let rollout;
    try {
      rollout = await options.featureFlags.evaluate('SOURCE_OZON_PUBLISHER_V2', {
        ownerUserId: shop.userId,
        shopId: shop.id,
        platform: shop.platform,
        deviceSessionId: input.sessionId,
      });
    } catch {
      return { kind: 'rollout_unavailable' };
    }
    if (!rollout.enabled) {
      return rollout.legacyAllowed ? { kind: 'unavailable' } : { kind: 'rollout_unavailable' };
    }

    if (options.authorizeByokPublish) {
      const assignments = draft.media?.assignments;
      if (!Array.isArray(assignments)) return { kind: 'rollout_unavailable' };
      try {
        await options.authorizeByokPublish({
          ownerUserId: input.ownerUserId,
          shopId: draft.shopId,
          workflowId: draft.id,
          assignments,
          requestingDeviceSessionId: input.sessionId,
        });
      } catch (error) {
        const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
        return statusCode >= 500 ? { kind: 'rollout_unavailable' } : { kind: 'unavailable' };
      }
    }

    return {
      kind: 'allowed',
      shopId: shop.id,
      workflowId: draft.id,
      draftVersion: draft.draftVersion,
      command: parsedCommand.data,
    };
  };
}

interface ExtensionCommandGrantRouteService {
  issue(input: {
    sessionId: string;
    tokenId: string;
    ownerUserId: string;
    shopId: string | null;
    operation: ExtensionCommandOperation;
    workflowId: string | null;
    draftVersion: number | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ grantId: string; token: string; expiresAt: Date }>;
  authorize(input: {
    sessionId: string;
    tokenId: string;
    ownerUserId: string;
    shopId: string | null;
    operation: ExtensionCommandOperation;
    workflowId: string | null;
    draftVersion: number | null;
    idempotencyKey: string;
    requestHash: string;
    token: string;
  }): Promise<{ kind: 'execute' | 'replay'; receipt: { id: string; status: string; result: unknown; failureCode: string | null } }>;
  claimPendingRecovery(input: { receiptId: string }): Promise<{
    kind: 'acquired' | 'not_ready';
    receipt: { id: string; status: string; result: unknown; failureCode: string | null };
  }>;
  complete(input: { receiptId: string; result: unknown }): Promise<unknown>;
  fail(input: { receiptId: string; failureCode: string; result?: unknown }): Promise<unknown>;
}

export interface ExtensionCommandGrantRoutesOptions {
  service: ExtensionCommandGrantRouteService;
  authenticateDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  resolveCommand(input: ExtensionCommandResolutionInput): Promise<ExtensionCommandResolution>;
  executeOzonPublish?(input: {
    deviceSessionId: string;
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    workflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<Pick<OzonPublishAttemptRecord, 'state' | 'lastErrorCode'>>;
  executeMediaWorkflowCommand?(input: {
    deviceSessionId: string;
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  executeMediaReviewCommand?(input: {
    deviceSessionId: string;
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  executeMediaApplyCommand?(input: {
    deviceSessionId: string;
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    listingWorkflowId: string;
    draftVersion: number;
    idempotencyKey: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

const requestSchema = z.object({
  operation: z.enum(EXTENSION_COMMAND_OPERATIONS),
  shopId: z.string().trim().min(1).max(200).optional(),
  workflowId: z.string().trim().min(1).max(200).optional(),
  draftVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();
const executeSchema = z.object({
  shopId: z.string().trim().min(1).max(200),
  workflowId: z.string().trim().min(1).max(200),
  draftVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();
const mediaExecuteSchema = z.object({
  operation: z.enum(['MEDIA_EXECUTE', 'MEDIA_REVIEW', 'MEDIA_APPLY']).optional(),
  shopId: z.string().trim().min(1).max(200),
  workflowId: z.string().trim().min(1).max(200),
  draftVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(16).max(200),
  command: z.record(z.string(), z.unknown()),
}).strict();

const mediaCommandUnavailableCodes = new Set([
  'MEDIA_CAPABILITY_UNAVAILABLE',
  'MEDIA_CREATE_STATE_UNAVAILABLE',
  'MEDIA_CONTEXT_UNAVAILABLE',
  'MEDIA_PROMPT_UNAVAILABLE',
  'MEDIA_QUEUE_UNAVAILABLE',
  'MEDIA_APPLY_STATE_UNAVAILABLE',
  'MEDIA_SOURCE_UNAVAILABLE',
  'MEDIA_STORAGE_NOT_READY',
  'STORAGE_NOT_READY',
]);

const mediaCommandRecoveryRequiredCodes = new Set([
  // The business mutation may already be committed when its result projection is
  // temporarily unavailable. Preserve PENDING so exact ledger recovery can run.
  'AI_IMAGE_SUITE_COMMAND_STATE_UNAVAILABLE',
  'MEDIA_APPLY_STATE_UNAVAILABLE',
]);

const mediaCommandQuotaExceededCodes = new Set([
  'IMAGE_TRANSLATION_QUOTA_EXCEEDED',
  'AI_IMAGE_EDIT_QUOTA_EXCEEDED',
  'AI_IMAGE_GENERATION_QUOTA_EXCEEDED',
  'BUDGET_EXCEEDED',
]);

function error(reply: FastifyReply, statusCode: number, errorCode: string, message: string) {
  return reply.status(statusCode).send({ code: 0, errorCode, msg: message });
}

function deviceContext(request: FastifyRequest): CommandDeviceContext | null {
  const candidate = (request as any).device as Partial<CommandDeviceContext> | undefined;
  if (!candidate
    || typeof candidate.sessionId !== 'string'
    || typeof candidate.tokenId !== 'string'
    || typeof candidate.ownerUserId !== 'string'
    || candidate.actorUserId !== candidate.ownerUserId
    || !Array.isArray(candidate.scopes)
    || !Array.isArray(candidate.allowedShopIds)) {
    return null;
  }
  return candidate as CommandDeviceContext;
}

export async function extensionCommandGrantRoutes(
  app: FastifyInstance,
  options: ExtensionCommandGrantRoutesOptions,
) {
  app.post('/command-grants', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');

    const requiredScope = EXTENSION_COMMAND_SCOPE_BY_OPERATION[parsed.data.operation];
    if (!device.scopes.includes(requiredScope)) {
      return error(reply, 403, 'command_scope_denied', '设备权限不足');
    }
    const requestedShopId = parsed.data.shopId || null;
    if (requestedShopId && !device.allowedShopIds.includes(requestedShopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    const resolution = await options.resolveCommand({
      sessionId: device.sessionId,
      ownerUserId: device.ownerUserId,
      operation: parsed.data.operation,
      shopId: requestedShopId,
      workflowId: parsed.data.workflowId || null,
      draftVersion: parsed.data.draftVersion ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      command: parsed.data.command,
    });
    if (resolution.kind !== 'allowed') {
      const decisions = {
        unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
        stale: [409, 'command_context_stale', '命令上下文已过期'],
        forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
        rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品发布策略暂不可用'],
      } as const;
      const [statusCode, code, message] = decisions[resolution.kind];
      return error(reply, statusCode, code, message);
    }
    if (resolution.shopId && !device.allowedShopIds.includes(resolution.shopId)) {
      return error(reply, 403, 'command_shop_denied', '设备无权访问该店铺');
    }

    const envelope = {
      operation: parsed.data.operation,
      shopId: resolution.shopId,
      workflowId: resolution.workflowId,
      draftVersion: resolution.draftVersion,
      command: resolution.command,
    };
    try {
      const requestHash = hashExtensionCommandRequest(envelope);
      const issued = await options.service.issue({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: resolution.shopId,
        operation: parsed.data.operation,
        workflowId: resolution.workflowId,
        draftVersion: resolution.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash,
      });
      reply.header('Cache-Control', 'no-store');
      return reply.status(201).send({
        code: 1,
        msg: '命令授权已签发',
        data: {
          grantId: issued.grantId,
          grantToken: issued.token,
          expiresAt: issued.expiresAt,
          ...(parsed.data.operation === EXTENSION_BYOK_MEDIA_INGEST_OPERATION
            ? { requestHash }
            : {}),
        },
      });
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });

  app.post('/ozon-publish/execute', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = executeSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');
    if (!device.scopes.includes(EXTENSION_COMMAND_SCOPE_BY_OPERATION.OZON_PUBLISH)
      || !device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_scope_denied', '设备无权执行 Ozon 发布');
    }
    const token = String(request.headers['x-ss-erp-command-grant'] || '').trim();
    if (!token) return error(reply, 401, 'command_grant_required', '缺少命令授权');
    const envelope = {
      operation: 'OZON_PUBLISH' as const,
      shopId: parsed.data.shopId,
      workflowId: parsed.data.workflowId,
      draftVersion: parsed.data.draftVersion,
      command: parsed.data.command,
    };
    try {
      const resolution = await options.resolveCommand({
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
        operation: 'OZON_PUBLISH',
        shopId: parsed.data.shopId,
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        command: parsed.data.command,
      });
      if (resolution.kind !== 'allowed'
        || resolution.shopId !== parsed.data.shopId
        || resolution.workflowId !== parsed.data.workflowId
        || resolution.draftVersion !== parsed.data.draftVersion) {
        const decisions = {
          unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
          stale: [409, 'command_context_stale', '命令上下文已过期'],
          forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
          rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品发布策略暂不可用'],
        } as const;
        if (resolution.kind === 'allowed') {
          return error(reply, 409, 'command_context_stale', '命令上下文已过期');
        }
        const [statusCode, code, message] = decisions[resolution.kind];
        return error(reply, statusCode, code, message);
      }
      const authorized = await options.service.authorize({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: parsed.data.shopId,
        operation: 'OZON_PUBLISH',
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash: hashExtensionCommandRequest(envelope),
        token,
      });
      let receipt = authorized.receipt;
      let recovering = false;
      if (authorized.kind === 'replay' && authorized.receipt.status === 'PENDING') {
        const recovery = await options.service.claimPendingRecovery({
          receiptId: authorized.receipt.id,
        });
        if (recovery.kind !== 'acquired') {
          return reply.status(202).send({
            code: 1,
            data: { receipt: recovery.receipt, replay: true },
          });
        }
        receipt = recovery.receipt;
        recovering = true;
      } else if (authorized.kind === 'replay') {
        return reply.send({ code: 1, data: { receipt: authorized.receipt, replay: true } });
      }
      try {
        const result = await options.executeOzonPublish?.({
          deviceSessionId: device.sessionId,
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          shopId: parsed.data.shopId,
          workflowId: parsed.data.workflowId,
          draftVersion: parsed.data.draftVersion,
          idempotencyKey: parsed.data.idempotencyKey,
          command: parsed.data.command,
        });
        if (result === undefined) {
          await options.service.fail({ receiptId: receipt.id, failureCode: 'PUBLISH_EXECUTOR_UNAVAILABLE' });
          return error(reply, 503, 'publish_executor_unavailable', 'Ozon 发布执行器暂不可用');
        }
        const attemptState = String((result as { state?: unknown }).state || '');
        if (!OZON_PUBLISH_ATTEMPT_STATES.includes(attemptState as OzonPublishAttemptState)) {
          throw Object.assign(new Error('Ozon publish executor returned an invalid state'), {
            code: 'PUBLISH_RESULT_INVALID',
          });
        }
        if (attemptState === 'REJECTED') {
          const candidateCode = String(result.lastErrorCode || '');
          const failureCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidateCode)
            ? candidateCode
            : 'OZON_SUBMIT_REJECTED';
          const failedReceipt = await options.service.fail({
            receiptId: receipt.id,
            failureCode,
            result: null,
          });
          return reply.status(409).send({
            code: 0,
            errorCode: 'publish_failed',
            msg: 'Ozon 发布执行失败',
            data: { receipt: failedReceipt },
          });
        }
        if (attemptState !== 'SUBMITTED') {
          return reply.status(202).send({
            code: 1,
            data: { receipt, replay: recovering },
          });
        }
        const completed = await options.service.complete({ receiptId: receipt.id, result });
        return reply.status(recovering ? 200 : 202).send({
          code: 1,
          data: { receipt: completed, replay: recovering },
        });
      } catch (caught) {
        const candidateCode = caught && typeof caught === 'object'
          ? String((caught as { code?: unknown }).code || '')
          : '';
        const failureCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidateCode)
          ? candidateCode
          : 'PUBLISH_FAILED';
        const failedReceipt = await options.service.fail({
          receiptId: receipt.id,
          failureCode,
          result: null,
        });
        return reply.status(409).send({
          code: 0,
          errorCode: 'publish_failed',
          msg: 'Ozon 发布执行失败',
          data: { receipt: failedReceipt },
        });
      }
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });

  app.post('/media-workflows/execute', { preHandler: [options.authenticateDevice] }, async (request, reply) => {
    const parsed = mediaExecuteSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, 'invalid_request', '参数错误');
    const device = deviceContext(request);
    if (!device) return error(reply, 401, 'invalid_device_token', '无效的设备令牌');
    const operation = parsed.data.operation || 'MEDIA_EXECUTE';
    const requiredScope = EXTENSION_COMMAND_SCOPE_BY_OPERATION[operation];
    if (!device.scopes.includes(requiredScope)
      || !device.allowedShopIds.includes(parsed.data.shopId)) {
      return error(reply, 403, 'command_scope_denied', '设备无权执行媒体任务命令');
    }
    const token = String(request.headers['x-ss-erp-command-grant'] || '').trim();
    if (!token) return error(reply, 401, 'command_grant_required', '缺少命令授权');
    try {
      const resolution = await options.resolveCommand({
        sessionId: device.sessionId,
        ownerUserId: device.ownerUserId,
        operation,
        shopId: parsed.data.shopId,
        workflowId: parsed.data.workflowId,
        draftVersion: parsed.data.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        command: parsed.data.command,
      });
      if (resolution.kind !== 'allowed'
        || resolution.shopId !== parsed.data.shopId
        || resolution.workflowId !== parsed.data.workflowId
        || resolution.draftVersion !== parsed.data.draftVersion) {
        const decisions = {
          unavailable: [409, 'command_operation_unavailable', '该命令尚未开放'],
          stale: [409, 'command_context_stale', '命令上下文已过期'],
          forbidden: [403, 'command_context_forbidden', '无权访问命令上下文'],
          rollout_unavailable: [503, 'source_workflow_rollout_unavailable', '来源商品工作台策略暂不可用'],
        } as const;
        if (resolution.kind === 'allowed') {
          return error(reply, 409, 'command_context_stale', '命令上下文已过期');
        }
        const [statusCode, code, message] = decisions[resolution.kind];
        return error(reply, statusCode, code, message);
      }
      const envelope = {
        operation,
        shopId: resolution.shopId,
        workflowId: resolution.workflowId,
        draftVersion: resolution.draftVersion,
        command: resolution.command,
      };
      const authorized = await options.service.authorize({
        sessionId: device.sessionId,
        tokenId: device.tokenId,
        ownerUserId: device.ownerUserId,
        shopId: resolution.shopId,
        operation,
        workflowId: resolution.workflowId,
        draftVersion: resolution.draftVersion,
        idempotencyKey: parsed.data.idempotencyKey,
        requestHash: hashExtensionCommandRequest(envelope),
        token,
      });
      const pendingReplay = authorized.kind === 'replay'
        && authorized.receipt.status === 'PENDING';
      let recoverPending = false;
      if (pendingReplay) {
        const recovery = await options.service.claimPendingRecovery({
          receiptId: authorized.receipt.id,
        });
        if (recovery.kind !== 'acquired') {
          return reply.status(recovery.receipt.status === 'PENDING' ? 202 : 200).send({
            code: 1,
            data: { receipt: recovery.receipt, replay: true },
          });
        }
        recoverPending = true;
      }
      if (authorized.kind === 'replay' && !recoverPending) {
        return reply.send({ code: 1, data: { receipt: authorized.receipt, replay: true } });
      }
      let result: Record<string, unknown> | undefined;
      try {
        const executorInput = {
          deviceSessionId: device.sessionId,
          ownerUserId: device.ownerUserId,
          actorUserId: device.actorUserId,
          shopId: parsed.data.shopId,
          listingWorkflowId: parsed.data.workflowId,
          draftVersion: parsed.data.draftVersion,
          command: resolution.command,
        };
        result = operation === 'MEDIA_REVIEW'
          ? await options.executeMediaReviewCommand?.({
            ...executorInput,
            idempotencyKey: parsed.data.idempotencyKey,
          })
          : operation === 'MEDIA_APPLY'
            ? await options.executeMediaApplyCommand?.({
              ...executorInput,
              idempotencyKey: parsed.data.idempotencyKey,
            })
            : await options.executeMediaWorkflowCommand?.({
              ...executorInput,
              idempotencyKey: parsed.data.idempotencyKey,
            });
        if (result === undefined) {
          await options.service.fail({
            receiptId: authorized.receipt.id,
            failureCode: 'MEDIA_COMMAND_EXECUTOR_UNAVAILABLE',
          });
          return error(reply, 503, 'media_command_executor_unavailable', '媒体任务执行器暂不可用');
        }
      } catch (caught) {
        const candidateCode = caught && typeof caught === 'object'
          ? String((caught as { code?: unknown }).code || '')
          : '';
        const failureCode = /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidateCode)
          ? candidateCode
          : 'MEDIA_COMMAND_FAILED';
        if (mediaCommandRecoveryRequiredCodes.has(failureCode)) {
          return reply.status(503).send({
            code: 0,
            errorCode: 'media_command_unavailable',
            msg: '媒体任务服务暂不可用',
            data: { receipt: authorized.receipt },
          });
        }
        const receipt = await options.service.fail({
          receiptId: authorized.receipt.id,
          failureCode,
          result: null,
        });
        const quotaExceeded = mediaCommandQuotaExceededCodes.has(failureCode);
        const unavailable = mediaCommandUnavailableCodes.has(failureCode);
        return reply.status(quotaExceeded ? 429 : unavailable ? 503 : 409).send({
          code: 0,
          errorCode: quotaExceeded
            ? 'media_quota_exceeded'
            : unavailable ? 'media_command_unavailable' : 'media_command_failed',
          msg: quotaExceeded
            ? '媒体任务额度已用尽'
            : unavailable ? '媒体任务服务暂不可用' : '媒体任务命令执行失败',
          data: { receipt },
        });
      }
      // The business mutation has succeeded. A transient receipt write failure
      // must leave the receipt PENDING so the recovery lease can replay it.
      const receipt = await options.service.complete({
        receiptId: authorized.receipt.id,
        result,
      });
      return reply.status(recoverPending ? 200 : 202).send({
        code: 1,
        data: { receipt, replay: recoverPending },
      });
    } catch (caught) {
      if (!(caught instanceof ExtensionCommandGrantError)) throw caught;
      return error(reply, caught.statusCode, caught.code, caught.message);
    }
  });
}
