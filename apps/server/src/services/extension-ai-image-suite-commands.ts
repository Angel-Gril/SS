import { z } from 'zod';
import {
  deriveExtensionAiImageSuiteIdempotencyKey,
  hashExtensionAiImageSuiteContext,
  parseExtensionAiImageSuiteApplyCommand,
  parseExtensionAiImageSuiteExecuteCommand,
  parseExtensionAiImageSuiteReviewCommand,
  type ExtensionAiImageSuiteApplyCommand,
  type ExtensionAiImageSuiteExecuteCommand,
  type ExtensionAiImageSuiteReviewCommand,
} from './extension-ai-image-suite.js';

const exactIdentifier = z.string().min(1).max(200).refine(
  (value) => value === value.trim(),
  'identifier must not contain surrounding whitespace',
);
const revision = z.number().int().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

const commandEnvelopeSchema = z.object({
  ownerUserId: exactIdentifier,
  actorUserId: exactIdentifier,
  deviceSessionId: exactIdentifier,
  shopId: exactIdentifier,
  listingWorkflowId: exactIdentifier,
  draftVersion: revision,
  idempotencyKey: sha256.optional(),
  command: z.unknown(),
}).strict();

export interface ExtensionAiImageSuiteCommandAuthority {
  ownerUserId: string;
  deviceSessionId: string;
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}

export interface ExtensionAiImageSuiteAuthorityLoadInput {
  ownerUserId: string;
  deviceSessionId: string;
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
}

export interface ExtensionAiImageSuiteProjectionLoadInput
  extends ExtensionAiImageSuiteAuthorityLoadInput {
  action: ExtensionAiImageSuiteExecuteCommand['action']
    | ExtensionAiImageSuiteReviewCommand['action']
    | ExtensionAiImageSuiteApplyCommand['action'];
}

export interface ExtensionAiImageSuiteCommandLoaders {
  loadAuthority(
    input: ExtensionAiImageSuiteAuthorityLoadInput,
  ): Promise<ExtensionAiImageSuiteCommandAuthority | null>;
  loadProjection(input: ExtensionAiImageSuiteProjectionLoadInput): Promise<unknown | null>;
}

export interface ExtensionAiImageSuiteActionContext {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  snapshotId: string;
  supplyGoodsId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  planId: string;
  planVersionId: string;
  planRevision: number;
  skuKey: string | null;
  operationKey: string;
}

export interface ExtensionAiImageSuiteStartActionInput
  extends ExtensionAiImageSuiteActionContext {
  expectedPreviewHash: string;
  pricingVersion: string;
  estimatedCostCents: number;
  maximumCostCents: number;
}

export interface ExtensionAiImageSuiteContinueActionInput
  extends ExtensionAiImageSuiteActionContext {
  suiteId: string;
  expectedSuiteRevision: number;
}

export type ExtensionAiImageSuiteCancelActionInput =
  ExtensionAiImageSuiteContinueActionInput;

export interface ExtensionAiImageSuiteSlotActionInput
  extends ExtensionAiImageSuiteContinueActionInput {
  slotId: string;
  expectedSlotRevision: number;
}

export interface ExtensionAiImageSuiteRetryActionInput
  extends ExtensionAiImageSuiteSlotActionInput {
  additionalMaximumCostCents: number;
}

export interface ExtensionAiImageSuiteReviewActionInput
  extends ExtensionAiImageSuiteSlotActionInput {
  workflowId: string;
  outputAssetId: string;
  expectedWorkflowRevision: number;
  decision: 'APPROVE' | 'REJECT';
}

export interface ExtensionAiImageSuiteApplyActionInput
  extends Omit<ExtensionAiImageSuiteReviewActionInput, 'decision'> {
  targetType: 'collect';
  targetId: string;
  target: 'ERP_SOURCE_PRODUCT';
  mode: 'append';
  writesStoreDraft: false;
  expectedTargetUpdatedAt: string;
}

export interface ExtensionAiImageSuiteFacadeResult {
  suiteId: string;
  status: string;
  revision: number;
  replayed?: boolean;
  [key: string]: unknown;
}

export const EXTENSION_AI_IMAGE_SUITE_POST_COMMIT_ENQUEUE_TIMEOUT_MS = 5_000;

export function createExtensionAiImageSuitePostCommitRunner(options: {
  enqueue(suiteId: string): Promise<void>;
  onDeferred(suiteId: string, error: unknown): void;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs
    ?? EXTENSION_AI_IMAGE_SUITE_POST_COMMIT_ENQUEUE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new TypeError('AI image suite post-commit enqueue timeout is invalid');
  }
  return async <T>(suiteId: string, commit: () => Promise<T>): Promise<T> => {
    const result = await commit();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.enqueue(suiteId),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(
            'AI image suite post-commit frontier enqueue timed out',
          )), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } catch (error) {
      try {
        options.onDeferred(suiteId, error);
      } catch {
        // Reporting must never overwrite a database result that has already committed.
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return result;
  };
}

export type ExtensionAiImageSuiteCommandErrorCode =
  | 'AI_IMAGE_SUITE_COMMAND_INVALID'
  | 'AI_IMAGE_SUITE_COMMAND_FORBIDDEN'
  | 'AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE'
  | 'AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED'
  | 'AI_IMAGE_SUITE_COMMAND_PRICING_CHANGED'
  | 'AI_IMAGE_SUITE_COMMAND_IDEMPOTENCY_MISMATCH'
  | 'AI_IMAGE_SUITE_COMMAND_MODE_CONFLICT'
  | 'AI_IMAGE_SUITE_COMMAND_STATE_UNAVAILABLE';

export class ExtensionAiImageSuiteCommandError extends Error {
  constructor(
    public readonly code: ExtensionAiImageSuiteCommandErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionAiImageSuiteCommandError';
  }
}

function fail(
  code: ExtensionAiImageSuiteCommandErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ExtensionAiImageSuiteCommandError(code, statusCode, message);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function same(left: unknown, right: unknown): boolean {
  return left === right;
}

function parsedEnvelope(value: unknown) {
  const parsed = commandEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    fail('AI_IMAGE_SUITE_COMMAND_INVALID', 400, 'AI image suite command envelope is invalid');
  }
  if (parsed.data.actorUserId !== parsed.data.ownerUserId) {
    fail('AI_IMAGE_SUITE_COMMAND_FORBIDDEN', 403, 'AI image suite command owner is invalid');
  }
  return parsed.data;
}

function parseCommand<T>(parser: (value: unknown) => T, value: unknown): T {
  try {
    return parser(value);
  } catch {
    fail('AI_IMAGE_SUITE_COMMAND_INVALID', 400, 'AI image suite command is invalid');
  }
}

function operationKey(command: unknown, envelopeKey: string | undefined): string {
  const derived = deriveExtensionAiImageSuiteIdempotencyKey(command);
  if (envelopeKey != null && envelopeKey !== derived) {
    fail(
      'AI_IMAGE_SUITE_COMMAND_IDEMPOTENCY_MISMATCH',
      409,
      'AI image suite command idempotency key does not match its payload',
    );
  }
  return derived;
}

function authorityInput(
  envelope: ReturnType<typeof parsedEnvelope>,
  command: {
    snapshotId: string;
    supplyGoodsId: string;
    draftRevision: number;
  },
): ExtensionAiImageSuiteAuthorityLoadInput {
  return {
    ownerUserId: envelope.ownerUserId,
    deviceSessionId: envelope.deviceSessionId,
    snapshotId: command.snapshotId,
    supplyGoodsId: command.supplyGoodsId,
    shopId: envelope.shopId,
    listingWorkflowId: envelope.listingWorkflowId,
    draftRevision: command.draftRevision,
    draftVersion: envelope.draftVersion,
  };
}

function assertAuthority(
  expected: ExtensionAiImageSuiteAuthorityLoadInput,
  current: ExtensionAiImageSuiteCommandAuthority | null,
): ExtensionAiImageSuiteCommandAuthority {
  if (!current) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite authority is unavailable');
  }
  if (current.ownerUserId !== expected.ownerUserId) {
    fail('AI_IMAGE_SUITE_COMMAND_FORBIDDEN', 403, 'AI image suite authority owner changed');
  }
  if (current.deviceSessionId !== expected.deviceSessionId) {
    fail('AI_IMAGE_SUITE_COMMAND_FORBIDDEN', 403, 'AI image suite device authority changed');
  }
  if (current.shopId !== expected.shopId) {
    fail('AI_IMAGE_SUITE_COMMAND_FORBIDDEN', 403, 'AI image suite shop authority changed');
  }
  if (current.snapshotId !== expected.snapshotId
    || current.supplyGoodsId !== expected.supplyGoodsId
    || current.listingWorkflowId !== expected.listingWorkflowId
    || current.draftRevision !== expected.draftRevision
    || current.draftVersion !== expected.draftVersion) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite authority changed');
  }
  return current;
}

interface CommandAuthorityFields {
  snapshotId: string;
  supplyGoodsId: string;
  draftRevision: number;
  planId: string;
  planVersionId: string;
  planRevision: number;
  skuKey: string | null;
}

interface CheckedProjection {
  projection: Record<string, unknown>;
  plan: Record<string, unknown>;
  preview: Record<string, unknown>;
  suite: Record<string, unknown> | null;
}

function assertProjection(
  value: unknown,
  authoritative: ExtensionAiImageSuiteCommandAuthority,
  command: CommandAuthorityFields,
): CheckedProjection {
  const projection = record(value);
  const context = record(projection?.context);
  const projectedAuthority = record(projection?.commandAuthority);
  const plan = record(projection?.plan);
  const preview = record(plan?.preview);
  if (!projection
    || projection.contractVersion !== 'extension-ai-image-suite-projection/v1'
    || !context
    || !projectedAuthority
    || !plan
    || !preview) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite projection is unavailable');
  }
  if (context.snapshotId !== authoritative.snapshotId
    || context.supplyGoodsId !== authoritative.supplyGoodsId
    || context.shopId !== authoritative.shopId
    || context.listingWorkflowId !== authoritative.listingWorkflowId
    || context.draftRevision !== authoritative.draftRevision
    || context.draftVersion !== authoritative.draftVersion) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite projection context changed');
  }
  const expectedHash = hashExtensionAiImageSuiteContext({
    snapshotId: command.snapshotId,
    supplyGoodsId: command.supplyGoodsId,
    draftRevision: command.draftRevision,
    planId: command.planId,
    planVersionId: command.planVersionId,
    planRevision: command.planRevision,
    skuKey: command.skuKey,
  });
  if (projectedAuthority.snapshotId !== command.snapshotId
    || projectedAuthority.supplyGoodsId !== command.supplyGoodsId
    || projectedAuthority.draftRevision !== command.draftRevision
    || projectedAuthority.planId !== command.planId
    || projectedAuthority.planVersionId !== command.planVersionId
    || projectedAuthority.planRevision !== command.planRevision
    || projectedAuthority.skuKey !== command.skuKey
    || projectedAuthority.authorityHash !== expectedHash
    || plan.id !== command.planId
    || plan.versionId !== command.planVersionId
    || plan.revision !== command.planRevision
    || plan.skuKey !== command.skuKey
    || plan.status !== 'APPROVED') {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'Approved AI image suite plan changed');
  }
  return {
    projection,
    plan,
    preview,
    suite: projection.suite == null ? null : record(projection.suite),
  };
}

function allowedAction(container: Record<string, unknown>, action: string): Record<string, unknown> {
  const actions = Array.isArray(container.allowedActions) ? container.allowedActions : [];
  const commands = record(container.commands);
  const projectedCommand = commands ? record(commands[action]) : null;
  if (!actions.includes(action) || !projectedCommand) {
    fail(
      'AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED',
      409,
      `AI image suite action ${action} is no longer allowed`,
    );
  }
  return projectedCommand;
}

function assertStartProjection(
  checked: CheckedProjection,
  command: Extract<ExtensionAiImageSuiteExecuteCommand, { action: 'START' }>,
) {
  if (checked.suite) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite has already been started');
  }
  const projectedCommand = allowedAction(checked.plan, 'START');
  if (!same(checked.preview.hash, command.expectedPreviewHash)
    || !same(checked.preview.pricingVersion, command.acceptedPricingVersion)
    || !same(checked.preview.estimatedCostCents, command.acceptedEstimatedCostCents)
    || !same(checked.preview.maximumCostCents, command.acceptedMaximumCostCents)
    || !same(projectedCommand.expectedPreviewHash, command.expectedPreviewHash)
    || !same(projectedCommand.acceptedPricingVersion, command.acceptedPricingVersion)
    || !same(projectedCommand.acceptedEstimatedCostCents, command.acceptedEstimatedCostCents)
    || !same(projectedCommand.acceptedMaximumCostCents, command.acceptedMaximumCostCents)) {
    fail(
      'AI_IMAGE_SUITE_COMMAND_PRICING_CHANGED',
      409,
      'AI image suite preview or pricing changed; refresh before confirming',
    );
  }
}

function assertSuiteCurrent(
  checked: CheckedProjection,
  command: {
    suiteId: string;
    expectedSuiteRevision: number;
  },
) {
  const suite = checked.suite;
  if (!suite
    || suite.id !== command.suiteId
    || suite.revision !== command.expectedSuiteRevision
    || suite.previewHash !== checked.preview.hash
    || suite.pricingVersion !== checked.preview.pricingVersion
    || suite.itemCount !== checked.preview.itemCount
    || suite.estimatedCostCents !== checked.preview.estimatedCostCents
    || suite.maximumCostCents !== checked.preview.maximumCostCents) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite state changed');
  }
  return suite;
}

function assertSuiteAction(
  checked: CheckedProjection,
  command: {
    action: 'CONTINUE' | 'CANCEL';
    suiteId: string;
    expectedSuiteRevision: number;
  },
) {
  const suite = assertSuiteCurrent(checked, command);
  const projectedCommand = allowedAction(suite, command.action);
  if (projectedCommand.suiteId !== command.suiteId
    || projectedCommand.expectedSuiteRevision !== command.expectedSuiteRevision) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite command revision changed');
  }
  return { suite, projectedCommand };
}

function assertRetryProjection(
  checked: CheckedProjection,
  command: Extract<ExtensionAiImageSuiteExecuteCommand, { action: 'RETRY_SLOT' }>,
) {
  const suite = assertSuiteCurrent(checked, command);
  const slot = Array.isArray(suite.slots)
    ? suite.slots.map(record).find((candidate) => candidate?.id === command.slotId)
    : null;
  if (!slot
    || slot.revision !== command.expectedSlotRevision
    || slot.status !== 'FAILED') {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite slot changed');
  }
  const projectedCommand = allowedAction(slot, 'RETRY_SLOT');
  if (projectedCommand.suiteId !== command.suiteId
    || projectedCommand.slotId !== command.slotId
    || projectedCommand.expectedSuiteRevision !== command.expectedSuiteRevision
    || projectedCommand.expectedSlotRevision !== command.expectedSlotRevision) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite retry revision changed');
  }
  if (slot.maximumCostCents !== command.acceptedAdditionalMaximumCostCents
    || projectedCommand.acceptedAdditionalMaximumCostCents
      !== command.acceptedAdditionalMaximumCostCents) {
    fail(
      'AI_IMAGE_SUITE_COMMAND_PRICING_CHANGED',
      409,
      'AI image suite retry price changed; refresh before confirming',
    );
  }
}

function assertOutputAction(
  checked: CheckedProjection,
  command: ExtensionAiImageSuiteReviewCommand | ExtensionAiImageSuiteApplyCommand,
) {
  const suite = assertSuiteCurrent(checked, command);
  const slot = Array.isArray(suite.slots)
    ? suite.slots.map(record).find((candidate) => candidate?.id === command.slotId)
    : null;
  const output = record(slot?.output);
  if (!slot
    || slot.revision !== command.expectedSlotRevision
    || slot.workflowId !== command.workflowId
    || slot.workflowRevision !== command.expectedWorkflowRevision
    || !output
    || output.id !== command.outputAssetId) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite output changed');
  }
  const projectedCommand = allowedAction(slot, command.action);
  if (projectedCommand.suiteId !== command.suiteId
    || projectedCommand.slotId !== command.slotId
    || projectedCommand.workflowId !== command.workflowId
    || projectedCommand.outputAssetId !== command.outputAssetId
    || projectedCommand.expectedSuiteRevision !== command.expectedSuiteRevision
    || projectedCommand.expectedSlotRevision !== command.expectedSlotRevision
    || projectedCommand.expectedWorkflowRevision !== command.expectedWorkflowRevision) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'AI image suite output command changed');
  }
  if (command.action === 'APPLY_SLOT'
    && projectedCommand.expectedTargetUpdatedAt !== command.expectedTargetUpdatedAt) {
    fail('AI_IMAGE_SUITE_COMMAND_CONTEXT_STALE', 409, 'ERP source product changed');
  }
  return projectedCommand;
}

const suiteStatuses = new Set([
  'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
  'CANCEL_REQUESTED', 'CANCELLED',
]);

function safeFacadeResult(value: unknown, expectedSuiteId?: string) {
  const result = record(value);
  const suiteId = result?.suiteId;
  if (!result
    || typeof result.status !== 'string'
    || !suiteStatuses.has(result.status)
    || !Number.isSafeInteger(result.revision)
    || Number(result.revision) < 1
    || typeof suiteId !== 'string'
    || !suiteId
    || suiteId !== suiteId.trim()
    || suiteId.length > 200
    || (expectedSuiteId != null && suiteId !== expectedSuiteId)
    || (result.replayed != null && typeof result.replayed !== 'boolean')) {
    fail(
      'AI_IMAGE_SUITE_COMMAND_STATE_UNAVAILABLE',
      503,
      'AI image suite action returned an invalid state',
    );
  }
  return {
    suiteId,
    status: result.status,
    revision: Number(result.revision),
    replayed: result.replayed === true,
  };
}

function actionContext(
  envelope: ReturnType<typeof parsedEnvelope>,
  command: CommandAuthorityFields,
  key: string,
): ExtensionAiImageSuiteActionContext {
  return {
    ownerUserId: envelope.ownerUserId,
    actorUserId: envelope.actorUserId,
    deviceSessionId: envelope.deviceSessionId,
    snapshotId: command.snapshotId,
    supplyGoodsId: command.supplyGoodsId,
    shopId: envelope.shopId,
    listingWorkflowId: envelope.listingWorkflowId,
    draftRevision: command.draftRevision,
    draftVersion: envelope.draftVersion,
    planId: command.planId,
    planVersionId: command.planVersionId,
    planRevision: command.planRevision,
    skuKey: command.skuKey,
    operationKey: key,
  };
}

async function loadCheckedProjection(
  loaders: ExtensionAiImageSuiteCommandLoaders,
  envelope: ReturnType<typeof parsedEnvelope>,
  command: CommandAuthorityFields & { action: ExtensionAiImageSuiteProjectionLoadInput['action'] },
) {
  const requested = authorityInput(envelope, command);
  const authoritative = assertAuthority(requested, await loaders.loadAuthority(requested));
  const projection = await loaders.loadProjection({ ...requested, action: command.action });
  return assertProjection(projection, authoritative, command);
}

export function createExtensionAiImageSuiteExecuteCommandExecutor(
  options: ExtensionAiImageSuiteCommandLoaders & {
    start(input: ExtensionAiImageSuiteStartActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
    continue(input: ExtensionAiImageSuiteContinueActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
    cancel(input: ExtensionAiImageSuiteCancelActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
    retry(input: ExtensionAiImageSuiteRetryActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
  },
) {
  return async (value: unknown) => {
    const envelope = parsedEnvelope(value);
    const command = parseCommand(parseExtensionAiImageSuiteExecuteCommand, envelope.command);
    const key = operationKey(command, envelope.idempotencyKey);
    const checked = await loadCheckedProjection(options, envelope, command);
    let result;
    if (command.action === 'START') {
      assertStartProjection(checked, command);
      result = safeFacadeResult(await options.start({
        ...actionContext(envelope, command, key),
        expectedPreviewHash: command.expectedPreviewHash,
        pricingVersion: command.acceptedPricingVersion,
        estimatedCostCents: command.acceptedEstimatedCostCents,
        maximumCostCents: command.acceptedMaximumCostCents,
      }));
    } else if (command.action === 'CONTINUE') {
      assertSuiteAction(checked, command);
      result = safeFacadeResult(await options.continue({
        ...actionContext(envelope, command, key),
        suiteId: command.suiteId,
        expectedSuiteRevision: command.expectedSuiteRevision,
      }), command.suiteId);
    } else if (command.action === 'CANCEL') {
      assertSuiteAction(checked, command);
      result = safeFacadeResult(await options.cancel({
        ...actionContext(envelope, command, key),
        suiteId: command.suiteId,
        expectedSuiteRevision: command.expectedSuiteRevision,
      }), command.suiteId);
    } else if (command.action === 'RETRY_SLOT') {
      assertRetryProjection(checked, command);
      result = safeFacadeResult(await options.retry({
        ...actionContext(envelope, command, key),
        suiteId: command.suiteId,
        expectedSuiteRevision: command.expectedSuiteRevision,
        slotId: command.slotId,
        expectedSlotRevision: command.expectedSlotRevision,
        additionalMaximumCostCents: command.acceptedAdditionalMaximumCostCents,
      }), command.suiteId);
    }
    return { action: command.action, ...result };
  };
}

export function createExtensionAiImageSuiteReviewCommandExecutor(
  options: ExtensionAiImageSuiteCommandLoaders & {
    review(input: ExtensionAiImageSuiteReviewActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
  },
) {
  return async (value: unknown) => {
    const envelope = parsedEnvelope(value);
    const command = parseCommand(parseExtensionAiImageSuiteReviewCommand, envelope.command);
    const key = operationKey(command, envelope.idempotencyKey);
    const checked = await loadCheckedProjection(options, envelope, command);
    const projectedCommand = assertOutputAction(checked, command);
    if (!Array.isArray(projectedCommand.decisions)
      || !projectedCommand.decisions.includes(command.decision)) {
      fail('AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED', 409, 'Review decision is no longer allowed');
    }
    const result = safeFacadeResult(await options.review({
      ...actionContext(envelope, command, key),
      suiteId: command.suiteId,
      expectedSuiteRevision: command.expectedSuiteRevision,
      slotId: command.slotId,
      expectedSlotRevision: command.expectedSlotRevision,
      workflowId: command.workflowId,
      outputAssetId: command.outputAssetId,
      expectedWorkflowRevision: command.expectedWorkflowRevision,
      decision: command.decision,
    }), command.suiteId);
    return {
      action: command.action,
      suiteId: command.suiteId,
      slotId: command.slotId,
      workflowId: command.workflowId,
      status: result.status,
      revision: result.revision,
      replayed: result.replayed,
    };
  };
}

export function createExtensionAiImageSuiteApplyCommandExecutor(
  options: ExtensionAiImageSuiteCommandLoaders & {
    apply(input: ExtensionAiImageSuiteApplyActionInput): Promise<ExtensionAiImageSuiteFacadeResult>;
  },
) {
  return async (value: unknown) => {
    const envelope = parsedEnvelope(value);
    const command = parseCommand(parseExtensionAiImageSuiteApplyCommand, envelope.command);
    const key = operationKey(command, envelope.idempotencyKey);
    const checked = await loadCheckedProjection(options, envelope, command);
    const projectedCommand = assertOutputAction(checked, command);
    const applyPolicy = record(checked.projection.applyPolicy);
    if (!applyPolicy
      || applyPolicy.target !== 'ERP_SOURCE_PRODUCT'
      || applyPolicy.mode !== 'append'
      || applyPolicy.writesStoreDraft !== false
      || projectedCommand.target !== 'ERP_SOURCE_PRODUCT'
      || projectedCommand.mode !== 'append'
      || projectedCommand.writesStoreDraft !== false) {
      fail(
        'AI_IMAGE_SUITE_COMMAND_ACTION_NOT_ALLOWED',
        409,
        'AI image suite output may only be appended to its ERP source product',
      );
    }
    const result = safeFacadeResult(await options.apply({
      ...actionContext(envelope, command, key),
      suiteId: command.suiteId,
      expectedSuiteRevision: command.expectedSuiteRevision,
      slotId: command.slotId,
      expectedSlotRevision: command.expectedSlotRevision,
      workflowId: command.workflowId,
      outputAssetId: command.outputAssetId,
      expectedWorkflowRevision: command.expectedWorkflowRevision,
      targetType: 'collect',
      targetId: command.supplyGoodsId,
      target: 'ERP_SOURCE_PRODUCT',
      mode: 'append',
      writesStoreDraft: false,
      expectedTargetUpdatedAt: command.expectedTargetUpdatedAt,
    }), command.suiteId);
    return {
      action: command.action,
      suiteId: command.suiteId,
      slotId: command.slotId,
      workflowId: command.workflowId,
      status: result.status,
      revision: result.revision,
      replayed: result.replayed,
      target: 'ERP_SOURCE_PRODUCT' as const,
      mode: 'append' as const,
      writesStoreDraft: false as const,
    };
  };
}
