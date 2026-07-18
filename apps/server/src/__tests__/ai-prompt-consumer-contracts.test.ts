import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRuleBasedImagePromptPlan } from '../services/ai-image-prompt-plan.js';
import {
  AI_MEDIA_CURATION_TEMPLATE_KEY,
  AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
  AI_MEDIA_VISION_TEMPLATE_KEY,
  assertAiPromptConsumerContract,
  getAiPromptConsumerContract,
  normalizeAiPromptConsumerOutput,
  verifyAiPromptConsumerContract,
} from '../services/ai-prompt-consumer-contracts.js';

const candidate = {
  id: 'image-1',
  url: 'https://img.example.com/image-1.jpg',
  width: 1000,
  height: 1000,
  mimeType: 'image/jpeg',
  role: 'product_main' as const,
  skuKeys: ['sku-1'],
  contentHash: 'content-1',
};

const planInput = {
  skus: [{ skuKey: 'sku-1', attributes: [] }],
  images: [{
    candidateId: 'image-1',
    skuKeys: ['sku-1'],
    contentRole: 'identity' as const,
    evidenceIds: ['capture:image-1'],
  }],
  verifiedFacts: [],
};

describe('AI prompt structured consumer contracts', () => {
  it('registers versioned schemas and stable hashes for every Unit 8 consumer', () => {
    for (const key of [
      AI_MEDIA_CURATION_TEMPLATE_KEY,
      AI_MEDIA_VISION_TEMPLATE_KEY,
      AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
    ]) {
      const contract = assertAiPromptConsumerContract(key);
      expect(contract).toMatchObject({
        templateKey: key,
        contractVersion: 1,
        schemaVersion: expect.any(String),
        normalizerVersion: expect.any(String),
        implementationVersion: expect.any(String),
      });
      expect(contract.implementationHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(contract.behaviorHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(contract.contractHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(contract.contractHash).not.toBe(createHash('sha256').update(JSON.stringify({
        templateKey: contract.templateKey,
        contractVersion: contract.contractVersion,
        schemaVersion: contract.schemaVersion,
        normalizerVersion: contract.normalizerVersion,
        implementationHash: contract.implementationHash,
      })).digest('hex'));
      expect(verifyAiPromptConsumerContract(key)).toEqual(contract);
    }
    expect(getAiPromptConsumerContract('text-to-image.base')).toBeNull();
  });

  it('normalizes valid curation, vision, and slot outputs through their exact consumers', () => {
    const curation = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
      context: { candidates: [candidate] },
      modelOutput: {
        version: '1.0',
        decisions: [{
          candidateId: 'image-1',
          disposition: 'keep',
          translation: 'skip',
          contentRole: 'identity',
        }],
      },
    });
    expect(curation.accepted).toBe(true);
    expect(curation.normalized).toMatchObject({ mode: 'model', selectedCandidateIds: ['image-1'] });

    const vision = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_VISION_TEMPLATE_KEY,
      context: { candidateIds: ['image-1'], verifiedFacts: [] },
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'image-1',
          productIdentity: 'same_product',
          identityConfidence: 0.99,
          contentRoles: ['identity'],
          observations: {
            colors: ['black'],
            shapes: ['round'],
            visibleComponents: ['lid'],
            visibleText: [],
          },
          claims: {},
        }],
      },
    });
    expect(vision.accepted).toBe(true);
    expect(vision.normalized).toMatchObject({
      mode: 'model',
      images: [expect.objectContaining({ candidateId: 'image-1', productIdentity: 'same_product' })],
    });

    const heroSlot = createRuleBasedImagePromptPlan(planInput).slots[0]!;
    const slotPlan = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
      context: planInput,
      modelOutput: {
        version: '2.0',
        slots: [{ slotKey: heroSlot.slotKey, referenceCandidateIds: ['image-1'] }],
      },
    });
    expect(slotPlan.accepted).toBe(true);
    expect(slotPlan.normalized).toMatchObject({ mode: 'model' });
  });

  it('fails closed to existing deterministic normalizers for malformed output', () => {
    const curation = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
      context: { candidates: [candidate] },
      modelOutput: '{broken-json',
    });
    expect(curation).toMatchObject({ accepted: false, normalized: { mode: 'fallback' } });

    const vision = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_VISION_TEMPLATE_KEY,
      context: { candidateIds: ['image-1'], verifiedFacts: [] },
      modelOutput: { version: '1.0', images: [{ candidateId: 'fabricated' }] },
    });
    expect(vision).toMatchObject({ accepted: false, normalized: { mode: 'fallback' } });

    const slotPlan = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
      context: planInput,
      modelOutput: null,
    });
    expect(slotPlan).toMatchObject({ accepted: false, normalized: { mode: 'fallback' } });

    const emptySlotPlan = normalizeAiPromptConsumerOutput({
      templateKey: AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
      context: planInput,
      modelOutput: { version: '2.0', slots: [] },
    });
    expect(emptySlotPlan).toMatchObject({ accepted: false, normalized: { mode: 'model' } });
  });
});
