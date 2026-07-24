import { createHash } from 'node:crypto';
import { z } from 'zod';

export const EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION =
  'extension-ai-image-suite-execute-command/v1' as const;
export const EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION =
  'extension-ai-image-suite-review-command/v1' as const;
export const EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION =
  'extension-ai-image-suite-apply-command/v1' as const;
export const EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS = 10_000_000;

const exactIdentifier = z.string().min(1).max(200).refine(
  (value) => value === value.trim(),
  'identifier must not contain surrounding whitespace',
);
const nullableSkuKey = z.string().min(1).max(500).refine(
  (value) => value === value.trim(),
  'skuKey must not contain surrounding whitespace',
).nullable();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedCost = z.number().int().min(0).max(EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS);
const canonicalTimestamp = z.string().datetime({ offset: true }).refine(
  (value) => new Date(value).toISOString() === value,
  'timestamp must be canonical UTC ISO-8601',
);

const authorityShape = {
  snapshotId: exactIdentifier,
  supplyGoodsId: exactIdentifier,
  draftRevision: revision,
  planId: exactIdentifier,
  planVersionId: exactIdentifier,
  planRevision: revision,
  skuKey: nullableSkuKey,
} as const;

const startSchema = z.object({
  version: z.literal(EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION),
  action: z.literal('START'),
  ...authorityShape,
  expectedPreviewHash: sha256,
  acceptedPricingVersion: z.string().min(1).max(100).refine(
    (value) => value === value.trim(),
    'acceptedPricingVersion must not contain surrounding whitespace',
  ),
  acceptedEstimatedCostCents: boundedCost,
  acceptedMaximumCostCents: boundedCost,
}).strict().superRefine((value, context) => {
  if (value.acceptedMaximumCostCents < value.acceptedEstimatedCostCents) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['acceptedMaximumCostCents'],
      message: 'acceptedMaximumCostCents must cover the estimate',
    });
  }
});

const continueOrCancelBase = {
  version: z.literal(EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION),
  ...authorityShape,
  suiteId: exactIdentifier,
  expectedSuiteRevision: revision,
} as const;

const continueSchema = z.object({
  ...continueOrCancelBase,
  action: z.literal('CONTINUE'),
}).strict();

const cancelSchema = z.object({
  ...continueOrCancelBase,
  action: z.literal('CANCEL'),
}).strict();

const retrySchema = z.object({
  version: z.literal(EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION),
  action: z.literal('RETRY_SLOT'),
  ...authorityShape,
  suiteId: exactIdentifier,
  slotId: exactIdentifier,
  expectedSuiteRevision: revision,
  expectedSlotRevision: revision,
  acceptedAdditionalMaximumCostCents: boundedCost,
}).strict();

const executeSchema = z.union([
  startSchema,
  continueSchema,
  cancelSchema,
  retrySchema,
]);

const outputAuthorityShape = {
  ...authorityShape,
  suiteId: exactIdentifier,
  slotId: exactIdentifier,
  workflowId: exactIdentifier,
  outputAssetId: exactIdentifier,
  expectedSuiteRevision: revision,
  expectedSlotRevision: revision,
  expectedWorkflowRevision: revision,
} as const;

const reviewSchema = z.object({
  version: z.literal(EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION),
  action: z.literal('REVIEW_SLOT'),
  ...outputAuthorityShape,
  decision: z.enum(['APPROVE', 'REJECT']),
}).strict();

const applySchema = z.object({
  version: z.literal(EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION),
  action: z.literal('APPLY_SLOT'),
  ...outputAuthorityShape,
  expectedTargetUpdatedAt: canonicalTimestamp,
  mode: z.literal('append'),
}).strict();

const authoritySchema = z.object(authorityShape).strict();

export const extensionAiImageSuiteExecuteCommandSchema = executeSchema;
export const extensionAiImageSuiteReviewCommandSchema = reviewSchema;
/**
 * Applies an approved output by appending it to the ERP source product identified by
 * `supplyGoodsId`. It never targets or mutates a marketplace listing draft.
 */
export const extensionAiImageSuiteApplyCommandSchema = applySchema;
export const extensionAiImageSuiteAuthoritySchema = authoritySchema;

export type ExtensionAiImageSuiteExecuteCommand = z.infer<typeof executeSchema>;
export type ExtensionAiImageSuiteReviewCommand = z.infer<typeof reviewSchema>;
export type ExtensionAiImageSuiteApplyCommand = z.infer<typeof applySchema>;
export type ExtensionAiImageSuiteAuthority = z.infer<typeof authoritySchema>;

export function parseExtensionAiImageSuiteExecuteCommand(
  value: unknown,
): ExtensionAiImageSuiteExecuteCommand {
  return executeSchema.parse(value);
}

export function parseExtensionAiImageSuiteReviewCommand(
  value: unknown,
): ExtensionAiImageSuiteReviewCommand {
  return reviewSchema.parse(value);
}

export function parseExtensionAiImageSuiteApplyCommand(
  value: unknown,
): ExtensionAiImageSuiteApplyCommand {
  return applySchema.parse(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(value)))
    .digest('hex');
}

export function hashExtensionAiImageSuiteContext(value: unknown): string {
  return digest(authoritySchema.parse(value));
}

function parseAnyCommand(value: unknown) {
  const version = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { version?: unknown }).version
    : null;
  if (version === EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION) {
    return parseExtensionAiImageSuiteExecuteCommand(value);
  }
  if (version === EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION) {
    return parseExtensionAiImageSuiteReviewCommand(value);
  }
  if (version === EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION) {
    return parseExtensionAiImageSuiteApplyCommand(value);
  }
  throw new TypeError('Extension AI image suite command version is invalid');
}

export function deriveExtensionAiImageSuiteIdempotencyKey(value: unknown): string {
  return digest(parseAnyCommand(value));
}
