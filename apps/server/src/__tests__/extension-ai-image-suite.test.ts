import { describe, expect, it } from 'vitest';
import {
  EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS,
  EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION,
  deriveExtensionAiImageSuiteIdempotencyKey,
  extensionAiImageSuiteApplyCommandSchema,
  extensionAiImageSuiteExecuteCommandSchema,
  extensionAiImageSuiteReviewCommandSchema,
  hashExtensionAiImageSuiteContext,
  parseExtensionAiImageSuiteApplyCommand,
  parseExtensionAiImageSuiteExecuteCommand,
  parseExtensionAiImageSuiteReviewCommand,
} from '../services/extension-ai-image-suite.js';

const authority = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'supply-goods-1',
  draftRevision: 7,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  planRevision: 3,
  skuKey: null,
};

const startCommand = {
  version: EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  action: 'START' as const,
  ...authority,
  expectedPreviewHash: 'a'.repeat(64),
  acceptedPricingVersion: 'openai-images-2026-07-24',
  acceptedEstimatedCostCents: 18,
  acceptedMaximumCostCents: 24,
};

const continueCommand = {
  version: EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  action: 'CONTINUE' as const,
  ...authority,
  suiteId: 'suite-1',
  expectedSuiteRevision: 5,
};

const cancelCommand = {
  ...continueCommand,
  action: 'CANCEL' as const,
};

const retryCommand = {
  version: EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  action: 'RETRY_SLOT' as const,
  ...authority,
  suiteId: 'suite-1',
  slotId: 'slot-2',
  expectedSuiteRevision: 8,
  expectedSlotRevision: 4,
  acceptedAdditionalMaximumCostCents: 8,
};

const reviewCommand = {
  version: EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION,
  action: 'REVIEW_SLOT' as const,
  ...authority,
  suiteId: 'suite-1',
  slotId: 'slot-2',
  workflowId: 'workflow-2',
  outputAssetId: 'asset-2',
  expectedSuiteRevision: 9,
  expectedSlotRevision: 5,
  expectedWorkflowRevision: 3,
  decision: 'APPROVE' as const,
};

const applyCommand = {
  version: EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION,
  action: 'APPLY_SLOT' as const,
  ...authority,
  suiteId: 'suite-1',
  slotId: 'slot-2',
  workflowId: 'workflow-2',
  outputAssetId: 'asset-2',
  expectedSuiteRevision: 10,
  expectedSlotRevision: 6,
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-24T00:00:00.000Z',
  mode: 'append' as const,
};

describe('extension AI image suite command contracts', () => {
  it('parses the four exact execute actions', () => {
    expect(parseExtensionAiImageSuiteExecuteCommand(startCommand)).toEqual(startCommand);
    expect(parseExtensionAiImageSuiteExecuteCommand(continueCommand)).toEqual(continueCommand);
    expect(parseExtensionAiImageSuiteExecuteCommand(cancelCommand)).toEqual(cancelCommand);
    expect(parseExtensionAiImageSuiteExecuteCommand(retryCommand)).toEqual(retryCommand);
  });

  it('exports strict schemas for boundary adapters that need safe parsing', () => {
    expect(extensionAiImageSuiteExecuteCommandSchema.safeParse(startCommand).success).toBe(true);
    expect(extensionAiImageSuiteReviewCommandSchema.safeParse(reviewCommand).success).toBe(true);
    expect(extensionAiImageSuiteApplyCommandSchema.safeParse(applyCommand).success).toBe(true);
    expect(extensionAiImageSuiteExecuteCommandSchema.safeParse({
      ...startCommand,
      unknown: true,
    }).success).toBe(false);
  });

  it('parses review and ERP source-product append commands', () => {
    expect(parseExtensionAiImageSuiteReviewCommand(reviewCommand)).toEqual(reviewCommand);
    expect(parseExtensionAiImageSuiteReviewCommand({ ...reviewCommand, decision: 'REJECT' }))
      .toMatchObject({ decision: 'REJECT' });
    expect(parseExtensionAiImageSuiteApplyCommand(applyCommand)).toEqual(applyCommand);
  });

  it.each(['provider', 'model', 'baseUrl', 'apiKey', 'sourceUrl']) (
    'rejects the sensitive or server-owned %s field',
    (field) => {
      expect(() => parseExtensionAiImageSuiteExecuteCommand({
        ...startCommand,
        [field]: 'must-stay-server-side',
      })).toThrow();
      expect(() => parseExtensionAiImageSuiteReviewCommand({
        ...reviewCommand,
        [field]: 'must-stay-server-side',
      })).toThrow();
      expect(() => parseExtensionAiImageSuiteApplyCommand({
        ...applyCommand,
        [field]: 'must-stay-server-side',
      })).toThrow();
    },
  );

  it('rejects fields that belong to another execute action', () => {
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...startCommand,
      suiteId: 'suite-1',
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...continueCommand,
      expectedPreviewHash: 'a'.repeat(64),
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...cancelCommand,
      slotId: 'slot-2',
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...retryCommand,
      acceptedPricingVersion: 'unexpected',
    })).toThrow();
  });

  it.each([
    ['estimated cost is fractional', { acceptedEstimatedCostCents: 1.5 }],
    ['estimated cost is negative', { acceptedEstimatedCostCents: -1 }],
    ['maximum cost is below the estimate', { acceptedMaximumCostCents: 17 }],
    ['maximum cost exceeds the storage boundary', {
      acceptedMaximumCostCents: EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS + 1,
    }],
  ] as const)('rejects START when %s', (_label, changes) => {
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...startCommand,
      ...changes,
    })).toThrow();
  });

  it.each([
    -1,
    1.5,
    EXTENSION_AI_IMAGE_SUITE_MAX_COST_CENTS + 1,
  ])('rejects invalid retry cost confirmation %s', (acceptedAdditionalMaximumCostCents) => {
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...retryCommand,
      acceptedAdditionalMaximumCostCents,
    })).toThrow();
  });

  it.each([
    ['padded identifier', { planId: ' plan-1' }],
    ['oversized identifier', { planVersionId: 'x'.repeat(201) }],
    ['zero revision', { draftRevision: 0 }],
    ['fractional revision', { planRevision: 1.5 }],
    ['unsafe revision', { planRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid preview hash', { expectedPreviewHash: 'not-a-sha256' }],
    ['oversized pricing version', { acceptedPricingVersion: 'x'.repeat(101) }],
  ] as const)('rejects %s', (_label, changes) => {
    expect(() => parseExtensionAiImageSuiteExecuteCommand({
      ...startCommand,
      ...changes,
    })).toThrow();
  });

  it('rejects unknown review/apply fields and non-append application', () => {
    expect(() => parseExtensionAiImageSuiteReviewCommand({
      ...reviewCommand,
      note: 'not part of the frozen command',
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteApplyCommand({
      ...applyCommand,
      listingDraftId: 'listing-draft-1',
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteApplyCommand({
      ...applyCommand,
      mode: 'replace',
    })).toThrow();
    expect(() => parseExtensionAiImageSuiteApplyCommand({
      ...applyCommand,
      expectedTargetUpdatedAt: '2026-07-24T08:00:00+08:00',
    })).toThrow();
  });

  it('canonicalizes authority field order and changes when authority changes', () => {
    const reversedAuthority = Object.fromEntries(Object.entries(authority).reverse());

    const first = hashExtensionAiImageSuiteContext(authority);
    const reordered = hashExtensionAiImageSuiteContext(reversedAuthority);
    const changed = hashExtensionAiImageSuiteContext({ ...authority, draftRevision: 8 });

    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('derives stable, command-specific sha256 idempotency keys', () => {
    const reordered = Object.fromEntries(Object.entries(startCommand).reverse());

    const first = deriveExtensionAiImageSuiteIdempotencyKey(startCommand);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(deriveExtensionAiImageSuiteIdempotencyKey(reordered)).toBe(first);
    expect(deriveExtensionAiImageSuiteIdempotencyKey({
      ...startCommand,
      acceptedMaximumCostCents: 25,
    })).not.toBe(first);
    expect(deriveExtensionAiImageSuiteIdempotencyKey(cancelCommand)).not.toBe(first);
  });

  it.each(['provider', 'model', 'baseUrl', 'apiKey', 'sourceUrl']) (
    'does not hash the forbidden context field %s',
    (field) => {
      expect(() => hashExtensionAiImageSuiteContext({
        ...authority,
        [field]: 'must-not-enter-authority',
      })).toThrow();
      expect(() => deriveExtensionAiImageSuiteIdempotencyKey({
        ...startCommand,
        [field]: 'must-not-enter-idempotency',
      })).toThrow();
    },
  );
});
