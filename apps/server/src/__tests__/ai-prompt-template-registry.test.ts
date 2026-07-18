import { describe, expect, it, vi } from 'vitest';
import {
  AI_LISTING_COPY_SAFETY_POLICY,
  AI_PROMPT_SAFETY_POLICY,
  InMemoryAiPromptTemplateStore,
} from '../services/ai-prompt-templates.js';
import {
  AiPromptTemplateRegistryService,
  LISTING_COPY_DESCRIPTION_TEMPLATE_KEY,
  LISTING_COPY_TITLE_TEMPLATE_KEY,
} from '../services/ai-prompt-template-registry.js';
import {
  AI_MEDIA_CURATION_TEMPLATE_KEY,
  AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
  AI_MEDIA_VISION_TEMPLATE_KEY,
  AiPromptConsumerContractError,
  verifyAiPromptConsumerContract,
} from '../services/ai-prompt-consumer-contracts.js';

const KEY = 'text-to-image.base';

function registry(legacyPrompt = 'Legacy Ozon product image guidance') {
  return new AiPromptTemplateRegistryService(
    new InMemoryAiPromptTemplateStore(),
    { getLegacyPrompt: vi.fn(async () => legacyPrompt) },
  );
}

describe('AI prompt template registry', () => {
  it('bootstraps the default template from the legacy setting and resolves a frozen snapshot', async () => {
    const target = registry();

    const resolved = await target.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'White studio background',
      userNegativePrompt: 'watermarks',
    });

    expect(resolved).toMatchObject({
      templateKey: KEY,
      release: { sequence: 1 },
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      snapshot: {
        templateKey: KEY,
        sequence: 1,
        promptTemplate: expect.stringContaining('Legacy Ozon product image guidance'),
        negativePromptTemplate: expect.stringContaining('{{user_negative_prompt}}'),
      },
    });
    expect(resolved.resolvedPrompt).toContain(AI_PROMPT_SAFETY_POLICY);
    expect(resolved.resolvedPrompt).toContain('White studio background');
    expect(resolved.resolvedNegativePrompt).toContain('watermarks');

    const listed = await target.listTemplates();
    expect(listed).toMatchObject({
      safetyPolicy: AI_PROMPT_SAFETY_POLICY,
    });
    expect(listed.allowedVariables).toEqual(expect.arrayContaining([
      'user_prompt',
      'user_negative_prompt',
      'source_facts_json',
      'confirmed_attributes_json',
      'ozon_category_name',
      'target_language',
      'user_instructions',
      'forbidden_claims',
    ]));
    expect(listed.items[0]).toMatchObject({
      key: KEY,
      currentSequence: 1,
      activeRevision: { id: resolved.release.revisionId },
    });
  });

  it('supports draft, preview, PASS test, publish, and append-only rollback', async () => {
    const target = registry();
    const initial = await target.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'Initial',
      userNegativePrompt: '',
    });
    const draft = await target.createRevision({
      actorUserId: 'admin-1',
      key: KEY,
      promptTemplate: 'New product image direction: {{user_prompt}}',
      negativePromptTemplate: 'Exclude: {{user_negative_prompt}}',
      note: 'Second version',
    });
    const preview = await target.previewRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      variables: { userPrompt: 'Sharp catalog lighting', userNegativePrompt: 'logos' },
    });
    expect(preview.resolvedPrompt).toContain('Sharp catalog lighting');

    const testRun = await target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: { userPrompt: 'Sharp catalog lighting', userNegativePrompt: 'logos' },
    });
    expect(testRun).toMatchObject({ ok: true, revisionId: draft.id });

    const published = await target.publishRevision({
      actorUserId: 'admin-1',
      key: KEY,
      revisionId: draft.id,
      testRunId: testRun.testRunId,
      expectedSequence: 1,
    });
    expect(published).toMatchObject({ sequence: 2, revisionId: draft.id });

    const rollback = await target.rollbackTemplate({
      actorUserId: 'admin-1',
      key: KEY,
      targetRevisionId: initial.release.revisionId,
      expectedSequence: 2,
    });
    expect(rollback).toMatchObject({
      sequence: 3,
      revisionId: initial.release.revisionId,
      action: 'ROLLBACK',
    });

    const listed = await target.listTemplates();
    expect(listed.items[0]?.releases).toHaveLength(3);
    expect(listed.items[0]?.activeRevision?.id).toBe(initial.release.revisionId);
  });

  it('imports unsupported legacy placeholders as literal text without blocking bootstrap', async () => {
    const target = registry('Legacy {{product_name}} and {{ user_prompt }} guidance');

    const resolved = await target.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'White background',
      userNegativePrompt: '',
    });
    const listed = await target.listTemplates();

    expect(resolved.resolvedPrompt).toContain('Legacy { {product_name} } and White background guidance');
    expect(listed.items[0]?.activeRevision?.note).toContain('literal text');
  });

  it('bootstraps fact-bound listing-copy templates as candidate-only outputs', async () => {
    const target = registry();
    const listed = await target.listTemplates();

    expect(listed.items.map((item) => item.key)).toEqual([
      KEY,
      LISTING_COPY_TITLE_TEMPLATE_KEY,
      LISTING_COPY_DESCRIPTION_TEMPLATE_KEY,
      AI_MEDIA_CURATION_TEMPLATE_KEY,
      AI_MEDIA_VISION_TEMPLATE_KEY,
      AI_MEDIA_SLOT_PLANNING_TEMPLATE_KEY,
    ]);
    const title = listed.items.find((item) => item.key === LISTING_COPY_TITLE_TEMPLATE_KEY)!;
    const description = listed.items.find((item) => item.key === LISTING_COPY_DESCRIPTION_TEMPLATE_KEY)!;
    expect(title).toMatchObject({
      currentSequence: 1,
      outputMode: 'listing_copy_candidate',
      variableSchema: {
        outputMode: 'listing_copy_candidate',
        prompt: expect.arrayContaining([
          expect.objectContaining({ inputKey: 'sourceFactsJson', requiredForTest: true }),
          expect.objectContaining({ inputKey: 'ozonCategoryName', requiredForTest: true }),
        ]),
      },
    });
    expect(description.variableSchema.prompt).toEqual(expect.arrayContaining([
      expect.objectContaining({ inputKey: 'confirmedAttributesJson', requiredForTest: true }),
    ]));
  });

  it('bootstraps structured planning templates only with frozen consumer contracts', async () => {
    const target = registry();
    const listed = await target.listTemplates();
    const curation = listed.items.find((item) => item.key === AI_MEDIA_CURATION_TEMPLATE_KEY)!;

    expect(curation).toMatchObject({
      outputMode: 'media_planning_json',
      consumer: verifyAiPromptConsumerContract(AI_MEDIA_CURATION_TEMPLATE_KEY),
      variableSchema: {
        outputMode: 'media_planning_json',
        prompt: expect.arrayContaining([
          expect.objectContaining({ inputKey: 'candidateManifestJson', requiredForTest: true }),
        ]),
      },
    });
    const resolved = await target.resolveTemplate({
      templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
      variables: {
        candidateManifestJson: '{"candidates":[{"candidateId":"image-1"}]}',
        platformConstraints: '',
      },
    });
    expect(resolved.snapshot.consumer).toEqual(curation.consumer);
    expect(resolved.outputMode).toBe('media_planning_json');
  });

  it('rechecks a structured consumer before test, publish, rollback, and resolve activation', async () => {
    let consumerAvailable = true;
    const verifyConsumer = (templateKey: string) => {
      if (!consumerAvailable) {
        throw new AiPromptConsumerContractError(
          'MISSING_CONSUMER_VALIDATOR',
          'consumer unavailable',
        );
      }
      return verifyAiPromptConsumerContract(templateKey);
    };
    const store = new InMemoryAiPromptTemplateStore();
    const target = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Legacy prompt'),
      verifyConsumerContract: verifyConsumer,
    });
    const listed = await target.listTemplates();
    const structured = listed.items.find((item) => item.key === AI_MEDIA_CURATION_TEMPLATE_KEY)!;
    const draft = await target.createRevision({
      actorUserId: 'admin-1',
      key: AI_MEDIA_CURATION_TEMPLATE_KEY,
      promptTemplate: structured.activeRevision!.promptTemplate,
      negativePromptTemplate: structured.activeRevision!.negativePromptTemplate,
    });
    const testRun = await target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: {
        candidateManifestJson: '{"candidates":[{"candidateId":"image-1"}]}',
        platformConstraints: '',
      },
    });
    expect(testRun.consumer).toEqual(verifyAiPromptConsumerContract(AI_MEDIA_CURATION_TEMPLATE_KEY));

    consumerAvailable = false;
    await expect(target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: {
        candidateManifestJson: '{"candidates":[{"candidateId":"image-1"}]}',
        platformConstraints: '',
      },
    })).rejects.toMatchObject({ code: 'MISSING_CONSUMER_VALIDATOR' });
    await expect(target.publishRevision({
      actorUserId: 'admin-1',
      key: AI_MEDIA_CURATION_TEMPLATE_KEY,
      revisionId: draft.id,
      testRunId: testRun.testRunId,
      expectedSequence: 1,
    })).rejects.toMatchObject({ code: 'MISSING_CONSUMER_VALIDATOR' });
    await expect(target.rollbackTemplate({
      actorUserId: 'admin-1',
      key: AI_MEDIA_CURATION_TEMPLATE_KEY,
      targetRevisionId: structured.activeRevision!.id,
      expectedSequence: 1,
    })).rejects.toMatchObject({ code: 'MISSING_CONSUMER_VALIDATOR' });
    await expect(target.resolveTemplate({
      templateKey: AI_MEDIA_CURATION_TEMPLATE_KEY,
      variables: {
        candidateManifestJson: '{"candidates":[{"candidateId":"image-1"}]}',
        platformConstraints: '',
      },
    })).rejects.toMatchObject({ code: 'MISSING_CONSUMER_VALIDATOR' });
    const incompatible = (await target.listTemplates()).items.find(
      (item) => item.key === AI_MEDIA_CURATION_TEMPLATE_KEY,
    );
    expect(incompatible?.currentSequence).toBe(1);
    expect(incompatible?.consumerCompatibility).toEqual({
      status: 'INCOMPATIBLE',
      code: 'MISSING_CONSUMER_VALIDATOR',
    });
  });

  it('rejects a verifier whose descriptor differs from the compiled consumer contract', async () => {
    const store = new InMemoryAiPromptTemplateStore();
    const target = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Legacy prompt'),
      verifyConsumerContract: (templateKey) => ({
        ...verifyAiPromptConsumerContract(templateKey),
        contractHash: 'f'.repeat(64),
      }),
    });

    await expect(target.listTemplates()).rejects.toMatchObject({
      code: 'INVALID_CONSUMER_VALIDATOR',
    });
    await expect(store.listReleases(AI_MEDIA_CURATION_TEMPLATE_KEY)).resolves.toHaveLength(0);
  });

  it('resolves listing-copy candidates only from supplied facts and required variables', async () => {
    const target = registry();
    const resolved = await target.resolveTemplate({
      templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: '{"product":"stainless steel bottle","capacityMl":500}',
        ozonCategoryName: 'Water bottles',
        targetLanguage: 'Russian',
        userInstructions: 'Keep the title under 120 characters.',
        forbiddenClaims: 'medical grade, certified',
      },
    });

    expect(resolved.outputMode).toBe('listing_copy_candidate');
    expect(resolved.resolvedPrompt).toContain(AI_LISTING_COPY_SAFETY_POLICY);
    expect(resolved.resolvedPrompt).toContain('"capacityMl":500');
    expect(resolved.resolvedPrompt).toContain('Water bottles');
    expect(resolved.resolvedNegativePrompt).toContain('medical grade, certified');
    expect(resolved.snapshot).toMatchObject({ templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY });
    expect(resolved.snapshot).toMatchObject({
      outputMode: 'listing_copy_candidate',
      variableSchemaVersion: 1,
      variableKeys: {
        prompt: expect.arrayContaining(['sourceFactsJson', 'ozonCategoryName']),
        negativePrompt: ['forbiddenClaims'],
      },
    });

    await expect(target.resolveTemplate({
      templateKey: LISTING_COPY_DESCRIPTION_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: '{"product":"bottle"}',
        ozonCategoryName: 'Water bottles',
        targetLanguage: 'Russian',
      },
    })).rejects.toMatchObject({ code: 'INVALID_TEST_INPUT' });
  });

  it('canonicalizes bounded JSON facts and rejects malformed, sensitive, or excessive inputs', async () => {
    const target = registry();
    const valid = await target.resolveTemplate({
      templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: '{"z":1,"a":{"material":"steel"}}',
        ozonCategoryName: 'Water bottles',
        targetLanguage: 'Russian',
        userInstructions: '',
        forbiddenClaims: '',
      },
    });
    expect(valid.resolvedPrompt).toContain('{"a":{"material":"steel"},"z":1}');

    await expect(target.resolveTemplate({
      templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: JSON.stringify({
          cookieCutterShape: 'star',
          signatureScent: 'cedar',
          secretaryDeskStyle: 'traditional',
          tokenCount: 24,
        }),
        ozonCategoryName: 'Household goods',
        targetLanguage: 'Russian',
        userInstructions: '',
        forbiddenClaims: '',
      },
    })).resolves.toMatchObject({ outputMode: 'listing_copy_candidate' });

    await expect(target.resolveTemplate({
      templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: JSON.stringify({
          variants: Array.from({ length: 40 }, (_, index) => ({
            sku: `sku-${index}`,
            color: `color-${index % 5}`,
            size: `size-${index % 8}`,
            description: 'representative product fact '.repeat(6),
          })),
        }),
        ozonCategoryName: 'Apparel',
        targetLanguage: 'Russian',
        userInstructions: '',
        forbiddenClaims: '',
      },
    })).resolves.toMatchObject({ outputMode: 'listing_copy_candidate' });

    for (const sourceFactsJson of [
      'not-json',
      '[{"product":"bottle"}]',
      '{"apiToken":"secret"}',
      JSON.stringify({ nested: { accessKeySecret: 'secret' } }),
      JSON.stringify({ nested: { proxyAuthorization: 'secret' } }),
      JSON.stringify({ nested: { 'set-cookie': 'secret' } }),
      JSON.stringify({ nested: { 'x-api-key': 'secret' } }),
      JSON.stringify({ value: 'x'.repeat(24_100) }),
      JSON.stringify({ a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } }),
    ]) {
      await expect(target.resolveTemplate({
        templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
        variables: {
          sourceFactsJson,
          ozonCategoryName: 'Water bottles',
          targetLanguage: 'Russian',
          userInstructions: '',
          forbiddenClaims: '',
        },
      })).rejects.toMatchObject({ code: 'INVALID_TEST_INPUT' });
    }
  });

  it('converges concurrent multi-instance bootstrap to one active release per built-in template', async () => {
    class PrismaConflictStore extends InMemoryAiPromptTemplateStore {
      private readonly revisionIds = new Set<string>();
      private readonly testRunIds = new Set<string>();
      revisionConflicts = 0;
      testRunConflicts = 0;

      override async createRevision(revision: Parameters<InMemoryAiPromptTemplateStore['createRevision']>[0]) {
        await Promise.resolve();
        if (this.revisionIds.has(revision.id)) {
          this.revisionConflicts += 1;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        this.revisionIds.add(revision.id);
        return super.createRevision(revision);
      }

      override async createTestRun(testRun: Parameters<InMemoryAiPromptTemplateStore['createTestRun']>[0]) {
        await Promise.resolve();
        if (this.testRunIds.has(testRun.id)) {
          this.testRunConflicts += 1;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        this.testRunIds.add(testRun.id);
        return super.createTestRun(testRun);
      }
    }
    const store = new PrismaConflictStore();
    const first = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Shared legacy prompt'),
    });
    const second = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Shared legacy prompt'),
    });

    await Promise.all([first.listTemplates(), second.listTemplates()]);
    const listed = await first.listTemplates();
    expect(listed.items).toHaveLength(6);
    for (const template of listed.items) {
      expect(template.currentSequence).toBe(1);
      expect(template.revisions).toHaveLength(1);
      expect(template.releases).toHaveLength(1);
      expect(template.activeRevision?.status).toBe('PUBLISHED');
    }
    expect(store.revisionConflicts).toBeGreaterThan(0);
    expect(store.testRunConflicts).toBeGreaterThan(0);
  });

  it('reloads deterministic bootstrap rows after Prisma-style unique conflicts', async () => {
    class WriteThenConflictStore extends InMemoryAiPromptTemplateStore {
      private revisionConflictPending = true;
      private testRunConflictPending = true;
      revisionReloads = 0;
      testRunReloads = 0;
      private conflictedRevisionId = '';
      private conflictedTestRunId = '';

      override async createRevision(revision: Parameters<InMemoryAiPromptTemplateStore['createRevision']>[0]) {
        const created = await super.createRevision(revision);
        if (this.revisionConflictPending) {
          this.revisionConflictPending = false;
          this.conflictedRevisionId = revision.id;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        return created;
      }

      override async getRevision(revisionId: string) {
        if (revisionId === this.conflictedRevisionId) this.revisionReloads += 1;
        return super.getRevision(revisionId);
      }

      override async createTestRun(testRun: Parameters<InMemoryAiPromptTemplateStore['createTestRun']>[0]) {
        const created = await super.createTestRun(testRun);
        if (this.testRunConflictPending) {
          this.testRunConflictPending = false;
          this.conflictedTestRunId = testRun.id;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        return created;
      }

      override async getTestRun(testRunId: string) {
        if (testRunId === this.conflictedTestRunId) this.testRunReloads += 1;
        return super.getTestRun(testRunId);
      }
    }
    const store = new WriteThenConflictStore();
    const target = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'unused'),
    });

    await expect(target.resolveTemplate({
      templateKey: LISTING_COPY_TITLE_TEMPLATE_KEY,
      variables: {
        sourceFactsJson: '{"product":"bottle"}',
        ozonCategoryName: 'Water bottles',
        targetLanguage: 'Russian',
        userInstructions: '',
        forbiddenClaims: '',
      },
    })).resolves.toMatchObject({
      outputMode: 'listing_copy_candidate',
      release: { sequence: 1 },
    });
    expect(store.revisionReloads).toBeGreaterThanOrEqual(1);
    expect(store.testRunReloads).toBeGreaterThanOrEqual(1);
    await expect(store.listRevisions(LISTING_COPY_TITLE_TEMPLATE_KEY)).resolves.toHaveLength(1);
    await expect(store.listReleases(LISTING_COPY_TITLE_TEMPLATE_KEY)).resolves.toHaveLength(1);
  });

  it('does not read legacy image config when an active image template already exists', async () => {
    const store = new InMemoryAiPromptTemplateStore();
    const seeded = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Existing image prompt'),
    });
    await seeded.listTemplates();

    const getLegacyPrompt = vi.fn(async () => {
      throw new Error('legacy config unavailable');
    });
    const restarted = new AiPromptTemplateRegistryService(store, { getLegacyPrompt });

    await expect(restarted.listTemplates()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ key: KEY, currentSequence: 1 }),
      ]),
    });
    expect(getLegacyPrompt).not.toHaveBeenCalled();
  });

  it('isolates an active image template from listing bootstrap failures', async () => {
    class FailingListingStore extends InMemoryAiPromptTemplateStore {
      failListingBootstrap = false;

      override async ensureTemplate(template: Parameters<InMemoryAiPromptTemplateStore['ensureTemplate']>[0]) {
        if (this.failListingBootstrap && template.key.startsWith('listing-copy.')) {
          throw new Error('listing storage unavailable');
        }
        return super.ensureTemplate(template);
      }
    }
    const store = new FailingListingStore();
    const seeded = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => 'Existing image prompt'),
    });
    await seeded.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'Initial',
      userNegativePrompt: '',
    });
    store.failListingBootstrap = true;
    const restarted = new AiPromptTemplateRegistryService(store, {
      getLegacyPrompt: vi.fn(async () => {
        throw new Error('legacy config unavailable');
      }),
    });

    await expect(restarted.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'Still available',
      userNegativePrompt: '',
    })).resolves.toMatchObject({ templateKey: KEY });
    await expect(restarted.listTemplates()).rejects.toThrow('listing storage unavailable');
  });

  it('rejects invalid test samples and oversized compiled prompts before recording PASS', async () => {
    const target = registry();
    await target.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'Initial',
      userNegativePrompt: '',
    });
    const draft = await target.createRevision({
      actorUserId: 'admin-1',
      key: KEY,
      promptTemplate: `${'x'.repeat(64_001)}\n{{user_prompt}}`,
      negativePromptTemplate: 'Exclude: {{user_negative_prompt}}',
    });

    await expect(target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: {},
    })).rejects.toMatchObject({ code: 'INVALID_TEST_INPUT' });
    await expect(target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: { userPrompt: 'Sample', unexpected: 'value' },
    })).rejects.toMatchObject({ code: 'INVALID_TEST_INPUT' });
    await expect(target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: { userPrompt: 'Sample', userNegativePrompt: '' },
    })).rejects.toMatchObject({ code: 'INVALID_COMPILED_PROMPT' });
    await expect(target.previewRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      variables: { userPrompt: 'Sample', userNegativePrompt: '' },
    })).rejects.toMatchObject({ code: 'INVALID_COMPILED_PROMPT' });
  });

  it('enforces the compiled prompt budget again when resolving a published template', async () => {
    const target = registry();
    await target.resolvePrompt({ templateKey: KEY, userPrompt: 'Initial', userNegativePrompt: '' });
    const draft = await target.createRevision({
      actorUserId: 'admin-1',
      key: KEY,
      promptTemplate: '{{user_prompt}}\n{{user_prompt}}\n{{user_prompt}}\n{{user_prompt}}\n{{user_prompt}}',
      negativePromptTemplate: '{{user_negative_prompt}}',
    });
    const testRun = await target.testRevision({
      actorUserId: 'admin-1',
      revisionId: draft.id,
      sampleInput: { userPrompt: 'short', userNegativePrompt: '' },
    });
    await target.publishRevision({
      actorUserId: 'admin-1',
      key: KEY,
      revisionId: draft.id,
      testRunId: testRun.testRunId,
      expectedSequence: 1,
    });

    await expect(target.resolvePrompt({
      templateKey: KEY,
      userPrompt: 'x'.repeat(16_000),
      userNegativePrompt: '',
    })).rejects.toMatchObject({ code: 'INVALID_COMPILED_PROMPT' });
  });
});
