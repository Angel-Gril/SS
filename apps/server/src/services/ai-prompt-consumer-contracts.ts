import { createHash } from 'node:crypto';
import {
  AI_IMAGE_CURATION_IMPLEMENTATION_VERSION,
  createDeterministicImageCuration,
  normalizeImageCurationModelOutput,
  validateImageCurationModelOutput,
  type ImageCurationCandidate,
  type ImageCurationPlan,
} from './ai-image-curation.js';
import {
  AI_IMAGE_PROMPT_PLAN_IMPLEMENTATION_VERSION,
  AI_IMAGE_PROMPT_PLAN_VERSION,
  createRuleBasedImagePromptPlan,
  normalizeAiImagePromptPlanOutput,
  validateAiImagePromptPlanModelOutput,
  type ImagePromptPlan,
  type ImagePromptPlanInput,
} from './ai-image-prompt-plan.js';
import {
  AI_IMAGE_VISION_IMPLEMENTATION_VERSION,
  AI_IMAGE_VISION_OUTPUT_VERSION,
  normalizeAiImageVisionOutput,
  validateAiImageVisionModelOutput,
  type AiImageVerifiedFact,
  type NormalizedAiImageVisionOutput,
} from './ai-image-vision.js';

export const AI_MEDIA_CURATION_TEMPLATE_KEY = 'image-curation.base';
export const AI_MEDIA_VISION_TEMPLATE_KEY = 'image-vision.base';
export const AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY = 'image-slot-planning.base';

export type AiPromptStructuredConsumerTemplateKey =
  | typeof AI_MEDIA_CURATION_TEMPLATE_KEY
  | typeof AI_MEDIA_VISION_TEMPLATE_KEY
  | typeof AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY;

export interface AiPromptConsumerContractDescriptor {
  templateKey: AiPromptStructuredConsumerTemplateKey;
  contractVersion: 1;
  schemaVersion: string;
  normalizerVersion: string;
  implementationVersion: string;
  implementationHash: string;
  behaviorHash: string;
  contractHash: string;
}

export type AiPromptConsumerOutputInput =
  | {
    templateKey: typeof AI_MEDIA_CURATION_TEMPLATE_KEY;
    context: { candidates: ImageCurationCandidate[] };
    modelOutput: unknown;
  }
  | {
    templateKey: typeof AI_MEDIA_VISION_TEMPLATE_KEY;
    context: { candidateIds: string[]; verifiedFacts: AiImageVerifiedFact[] };
    modelOutput: unknown;
  }
  | {
    templateKey: typeof AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY;
    context: ImagePromptPlanInput;
    modelOutput: unknown;
  };

export interface AiPromptConsumerOutputResult {
  contract: AiPromptConsumerContractDescriptor;
  accepted: boolean;
  normalized: ImageCurationPlan | NormalizedAiImageVisionOutput | ImagePromptPlan;
}

export class AiPromptConsumerContractError extends Error {
  constructor(
    public readonly code: 'MISSING_CONSUMER_VALIDATOR' | 'INVALID_CONSUMER_VALIDATOR',
    message: string,
  ) {
    super(message);
    this.name = 'AiPromptConsumerContractError';
  }
}

interface ConsumerDefinition {
  contract: Omit<AiPromptConsumerContractDescriptor, 'implementationHash' | 'behaviorHash' | 'contractHash'>;
  implementationSources: readonly string[];
  validate(value: unknown): boolean;
  normalize(context: unknown, value: unknown): AiPromptConsumerOutputResult['normalized'];
  accepted(
    value: AiPromptConsumerOutputResult['normalized'],
    context: unknown,
    modelOutput: unknown,
  ): boolean;
  vectors(): ConsumerContractVector[];
}

interface ConsumerContractVector {
  name: string;
  context: unknown;
  modelOutput: unknown;
  expectedStructurallyValid: boolean;
  expectedAccepted: boolean;
}

const SAMPLE_CANDIDATE: ImageCurationCandidate = {
  id: 'self-test-image',
  url: 'https://img.example.com/self-test-image.jpg',
  width: 1000,
  height: 1000,
  mimeType: 'image/jpeg',
  role: 'product_main',
  skuKeys: ['self-test-sku'],
  contentHash: 'self-test-content',
};

const SAMPLE_CANDIDATE_ALT: ImageCurationCandidate = {
  ...SAMPLE_CANDIDATE,
  id: 'self-test-image-alt',
  url: 'https://img.example.com/self-test-image-alt.jpg',
  contentHash: 'self-test-content-alt',
};

const SAMPLE_INCOMPATIBLE_CANDIDATE: ImageCurationCandidate = {
  ...SAMPLE_CANDIDATE,
  id: 'self-test-image-other-sku',
  url: 'https://img.example.com/self-test-image-other-sku.jpg',
  skuKeys: ['other-sku'],
  contentHash: 'self-test-content-other-sku',
};

const SAMPLE_PLAN_INPUT: ImagePromptPlanInput = {
  skus: [
    { skuKey: 'self-test-sku', attributes: [] },
    { skuKey: 'other-sku', attributes: [] },
  ],
  images: [{
    candidateId: SAMPLE_CANDIDATE.id,
    skuKeys: ['self-test-sku'],
    contentRole: 'identity',
    evidenceIds: ['self-test-evidence'],
  }, {
    candidateId: SAMPLE_CANDIDATE_ALT.id,
    skuKeys: ['self-test-sku'],
    contentRole: 'identity',
    evidenceIds: ['self-test-evidence-alt'],
  }, {
    candidateId: SAMPLE_INCOMPATIBLE_CANDIDATE.id,
    skuKeys: ['other-sku'],
    contentRole: 'identity',
    evidenceIds: ['self-test-evidence-other-sku'],
  }],
  verifiedFacts: [],
};

const DEFINITIONS: Readonly<Record<AiPromptStructuredConsumerTemplateKey, ConsumerDefinition>> = {
  [AI_MEDIA_CURATION_TEMPLATE_KEY]: {
    contract: {
      templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
      contractVersion: 1,
      schemaVersion: 'ai-image-curation-output/1.0',
      normalizerVersion: 'ai-image-curation-normalizer/v1',
      implementationVersion: AI_IMAGE_CURATION_IMPLEMENTATION_VERSION,
    },
    implementationSources: [
      validateImageCurationModelOutput.toString(),
      normalizeImageCurationModelOutput.toString(),
      createDeterministicImageCuration.toString(),
    ],
    validate: validateImageCurationModelOutput,
    normalize(context, value) {
      return normalizeImageCurationModelOutput(
        (context as { candidates: ImageCurationCandidate[] }).candidates,
        value,
      );
    },
    accepted(value, context, modelOutput) {
      const normalized = value as ImageCurationPlan;
      const parsed = typeof modelOutput === 'string'
        ? (() => { try { return JSON.parse(modelOutput) as unknown; } catch { return null; } })()
        : modelOutput;
      if (normalized.mode !== 'model'
        || !parsed
        || typeof parsed !== 'object'
        || !Array.isArray((parsed as { decisions?: unknown }).decisions)) return false;
      const candidateIds = new Set((context as { candidates: ImageCurationCandidate[] })
        .candidates.map((candidate) => candidate.id));
      const selectedIds = new Set(normalized.selectedCandidateIds);
      const normalizedDecisions = new Map(normalized.decisions.map((decision) => [
        decision.candidateId,
        decision,
      ]));
      return (parsed as { decisions: Array<{ candidateId?: unknown; disposition?: unknown }> }).decisions
        .some((decision) => typeof decision.candidateId === 'string'
          && candidateIds.has(decision.candidateId)
          && (decision.disposition === 'keep'
            ? selectedIds.has(decision.candidateId)
            : decision.disposition === 'reject'
              ? normalizedDecisions.get(decision.candidateId)?.reasonCodes.includes('MODEL_REJECTED')
              : decision.disposition === 'manual'
                ? normalizedDecisions.get(decision.candidateId)?.reasonCodes.includes('MODEL_MANUAL')
                : false));
    },
    vectors: () => {
      const keep = {
        candidateId: SAMPLE_CANDIDATE.id,
        disposition: 'keep',
        translation: 'skip',
        contentRole: 'identity',
      };
      return [
        {
          name: 'valid-keep',
          context: { candidates: [SAMPLE_CANDIDATE] },
          modelOutput: { version: '1.0', decisions: [keep] },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
        {
          name: 'schema-invalid',
          context: { candidates: [SAMPLE_CANDIDATE] },
          modelOutput: { version: '1.0', decisions: [{ candidateId: SAMPLE_CANDIDATE.id }] },
          expectedStructurallyValid: false,
          expectedAccepted: false,
        },
        {
          name: 'unknown-candidate-only',
          context: { candidates: [SAMPLE_CANDIDATE] },
          modelOutput: { version: '1.0', decisions: [{ ...keep, candidateId: 'unknown-image' }] },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
        {
          name: 'duplicate-known-candidate',
          context: { candidates: [SAMPLE_CANDIDATE] },
          modelOutput: { version: '1.0', decisions: [keep, keep] },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
        {
          name: 'hard-rule-rejection-cannot-be-kept',
          context: { candidates: [{ ...SAMPLE_CANDIDATE, width: 100, height: 100 }] },
          modelOutput: { version: '1.0', decisions: [keep] },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
      ];
    },
  },
  [AI_MEDIA_VISION_TEMPLATE_KEY]: {
    contract: {
      templateKey: AI_MEDIA_VISION_TEMPLATE_KEY,
      contractVersion: 1,
      schemaVersion: `ai-image-vision-output/${AI_IMAGE_VISION_OUTPUT_VERSION}`,
      normalizerVersion: 'ai-image-vision-normalizer/v1',
      implementationVersion: AI_IMAGE_VISION_IMPLEMENTATION_VERSION,
    },
    implementationSources: [
      validateAiImageVisionModelOutput.toString(),
      normalizeAiImageVisionOutput.toString(),
    ],
    validate: validateAiImageVisionModelOutput,
    normalize(context, value) {
      const input = context as { candidateIds: string[]; verifiedFacts: AiImageVerifiedFact[] };
      return normalizeAiImageVisionOutput({ ...input, modelOutput: value });
    },
    accepted: (value) => (value as NormalizedAiImageVisionOutput).mode === 'model',
    vectors: () => {
      const image = {
        candidateId: SAMPLE_CANDIDATE.id,
        productIdentity: 'same_product',
        identityConfidence: 1,
        contentRoles: ['identity'],
        observations: {
          colors: [], shapes: [], visibleComponents: [], visibleText: [],
        },
        claims: { material: 'unverified' },
      };
      const context = { candidateIds: [SAMPLE_CANDIDATE.id], verifiedFacts: [] };
      return [
        {
          name: 'valid-result-with-quarantined-claim',
          context,
          modelOutput: { version: AI_IMAGE_VISION_OUTPUT_VERSION, images: [image] },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
        {
          name: 'schema-invalid',
          context,
          modelOutput: { version: AI_IMAGE_VISION_OUTPUT_VERSION, images: 'invalid' },
          expectedStructurallyValid: false,
          expectedAccepted: false,
        },
        {
          name: 'unknown-candidate-only',
          context,
          modelOutput: {
            version: AI_IMAGE_VISION_OUTPUT_VERSION,
            images: [{ ...image, candidateId: 'unknown-image' }],
          },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
        {
          name: 'duplicate-known-candidate',
          context,
          modelOutput: { version: AI_IMAGE_VISION_OUTPUT_VERSION, images: [image, image] },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
        {
          name: 'missing-results',
          context,
          modelOutput: { version: AI_IMAGE_VISION_OUTPUT_VERSION, images: [] },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
      ];
    },
  },
  [AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY]: {
    contract: {
      templateKey: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
      contractVersion: 1,
      schemaVersion: `ai-image-prompt-plan-output/${AI_IMAGE_PROMPT_PLAN_VERSION}`,
      normalizerVersion: 'ai-image-prompt-plan-normalizer/v1',
      implementationVersion: AI_IMAGE_PROMPT_PLAN_IMPLEMENTATION_VERSION,
    },
    implementationSources: [
      validateAiImagePromptPlanModelOutput.toString(),
      normalizeAiImagePromptPlanOutput.toString(),
      createRuleBasedImagePromptPlan.toString(),
    ],
    validate: validateAiImagePromptPlanModelOutput,
    normalize(context, value) {
      return normalizeAiImagePromptPlanOutput(context as ImagePromptPlanInput, value);
    },
    accepted(value, _context, modelOutput) {
      const normalized = value as ImagePromptPlan;
      let parsed = modelOutput;
      if (typeof modelOutput === 'string') {
        try {
          parsed = JSON.parse(modelOutput) as unknown;
        } catch {
          return false;
        }
      }
      if (normalized.mode !== 'model'
        || !parsed
        || typeof parsed !== 'object'
        || !Array.isArray((parsed as { slots?: unknown }).slots)) {
        return false;
      }
      const normalizedSlots = new Map(normalized.slots.map((slot) => [
        slot.slotKey,
        new Set(slot.references.map((reference) => reference.candidateId)),
      ]));
      return (parsed as { slots: Array<{ slotKey?: unknown; referenceCandidateIds?: unknown }> }).slots
        .some((slot) => typeof slot.slotKey === 'string'
          && Array.isArray(slot.referenceCandidateIds)
          && slot.referenceCandidateIds.some((candidateId) => (
            typeof candidateId === 'string'
            && normalizedSlots.get(slot.slotKey as string)?.has(candidateId)
          )));
    },
    vectors: () => {
      const slot = createRuleBasedImagePromptPlan(SAMPLE_PLAN_INPUT).slots.find((item) => (
        item.ownership.level === 'sku' && item.ownership.key === 'self-test-sku'
      ))!;
      const selectedAlt = {
        slotKey: slot.slotKey,
        referenceCandidateIds: [SAMPLE_CANDIDATE_ALT.id],
      };
      return [
        {
          name: 'valid-non-default-compatible-reference',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: { version: AI_IMAGE_PROMPT_PLAN_VERSION, slots: [selectedAlt] },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
        {
          name: 'schema-invalid',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: { version: AI_IMAGE_PROMPT_PLAN_VERSION, slots: 'invalid' },
          expectedStructurallyValid: false,
          expectedAccepted: false,
        },
        {
          name: 'missing-slots',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: { version: AI_IMAGE_PROMPT_PLAN_VERSION, slots: [] },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
        {
          name: 'unknown-slot-and-reference',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: {
            version: AI_IMAGE_PROMPT_PLAN_VERSION,
            slots: [{ slotKey: 'unknown-slot', referenceCandidateIds: ['unknown-image'] }],
          },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
        {
          name: 'incompatible-reference',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: {
            version: AI_IMAGE_PROMPT_PLAN_VERSION,
            slots: [{
              slotKey: slot.slotKey,
              referenceCandidateIds: [SAMPLE_INCOMPATIBLE_CANDIDATE.id],
            }],
          },
          expectedStructurallyValid: true,
          expectedAccepted: false,
        },
        {
          name: 'duplicate-slot-first-wins',
          context: SAMPLE_PLAN_INPUT,
          modelOutput: {
            version: AI_IMAGE_PROMPT_PLAN_VERSION,
            slots: [selectedAlt, {
              slotKey: slot.slotKey,
              referenceCandidateIds: [SAMPLE_CANDIDATE.id],
            }],
          },
          expectedStructurallyValid: true,
          expectedAccepted: true,
        },
      ];
    },
  },
};

function buildDescriptor(target: ConsumerDefinition): AiPromptConsumerContractDescriptor {
  const vectors = target.vectors().map((vector) => {
    const normalized = target.normalize(vector.context, vector.modelOutput);
    return {
      name: vector.name,
      context: vector.context,
      modelOutput: vector.modelOutput,
      expectedStructurallyValid: vector.expectedStructurallyValid,
      expectedAccepted: vector.expectedAccepted,
      structurallyValid: target.validate(vector.modelOutput),
      accepted: target.accepted(normalized, vector.context, vector.modelOutput),
      normalized,
    };
  });
  const behaviorHash = createHash('sha256').update(JSON.stringify({
    contractVectorVersion: 2,
    vectors,
  })).digest('hex');
  const implementationHash = createHash('sha256').update(JSON.stringify({
    implementationVersion: target.contract.implementationVersion,
    implementationSources: target.implementationSources,
    validator: target.validate.toString(),
    normalizer: target.normalize.toString(),
    acceptance: target.accepted.toString(),
  })).digest('hex');
  const contract = { ...target.contract, implementationHash, behaviorHash };
  const contractHash = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return Object.freeze({ ...contract, contractHash });
}

const DESCRIPTORS: Readonly<Record<AiPromptStructuredConsumerTemplateKey, AiPromptConsumerContractDescriptor>> =
  Object.freeze(Object.fromEntries(Object.entries(DEFINITIONS).map(([key, target]) => [
    key,
    buildDescriptor(target),
  ])) as unknown as Record<AiPromptStructuredConsumerTemplateKey, AiPromptConsumerContractDescriptor>);

function definition(templateKey: string): ConsumerDefinition | null {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, templateKey)
    ? DEFINITIONS[templateKey as AiPromptStructuredConsumerTemplateKey]
    : null;
}

export function getAiPromptConsumerContract(
  templateKey: string,
): AiPromptConsumerContractDescriptor | null {
  return definition(templateKey)
    ? DESCRIPTORS[templateKey as AiPromptStructuredConsumerTemplateKey]
    : null;
}

export function assertAiPromptConsumerContract(
  templateKey: string,
): AiPromptConsumerContractDescriptor {
  const contract = getAiPromptConsumerContract(templateKey);
  if (!contract) {
    throw new AiPromptConsumerContractError(
      'MISSING_CONSUMER_VALIDATOR',
      `AI prompt template has no structured consumer validator: ${templateKey}`,
    );
  }
  return contract;
}

export function normalizeAiPromptConsumerOutput(
  input: AiPromptConsumerOutputInput,
): AiPromptConsumerOutputResult {
  const target = definition(input.templateKey);
  if (!target) {
    throw new AiPromptConsumerContractError(
      'MISSING_CONSUMER_VALIDATOR',
      `AI prompt template has no structured consumer validator: ${input.templateKey}`,
    );
  }
  const structurallyValid = target.validate(input.modelOutput);
  const normalized = target.normalize(input.context, input.modelOutput);
  return {
    contract: DESCRIPTORS[input.templateKey],
    accepted: structurallyValid && target.accepted(normalized, input.context, input.modelOutput),
    normalized,
  };
}

export function verifyAiPromptConsumerContract(
  templateKey: string,
): AiPromptConsumerContractDescriptor {
  const target = definition(templateKey);
  if (!target) return assertAiPromptConsumerContract(templateKey);
  const stored = DESCRIPTORS[templateKey as AiPromptStructuredConsumerTemplateKey];
  const current = buildDescriptor(target);
  const vectorsValid = target.vectors().every((vector) => {
    const structurallyValid = target.validate(vector.modelOutput);
    const normalized = target.normalize(vector.context, vector.modelOutput);
    const accepted = structurallyValid
      && target.accepted(normalized, vector.context, vector.modelOutput);
    return structurallyValid === vector.expectedStructurallyValid
      && accepted === vector.expectedAccepted;
  });
  if (stored.contractHash !== current.contractHash
    || stored.implementationHash !== current.implementationHash
    || stored.behaviorHash !== current.behaviorHash
    || !vectorsValid) {
    throw new AiPromptConsumerContractError(
      'INVALID_CONSUMER_VALIDATOR',
      `AI prompt structured consumer self-test failed: ${templateKey}`,
    );
  }
  return stored;
}
