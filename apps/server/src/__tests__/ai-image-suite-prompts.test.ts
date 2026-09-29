import { describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_SUITE_PROMPT_SET_VERSION,
  AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
  AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
  AiImageSuitePromptError,
  createAiImageSuitePromptService,
  type AiImageSuitePromptAuthority,
  type AiImageSuitePromptRepository,
  type AiImageSuitePromptTemplateBatch,
  type AiImageSuitePromptTemplateResolver,
} from '../services/ai-image-suite-prompts.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import {
  AiPromptTemplateError,
  InMemoryAiPromptTemplateStore,
} from '../services/ai-prompt-templates.js';

const sha = (character: string) => character.repeat(64);

function slot(input: {
  id: string;
  ordinal: number;
  slotKey: string;
  goal: string;
  ownershipLevel: 'sku' | 'compatibility_group';
  ownershipKey: string;
  candidateIds: string[];
  factEvidenceIds: string[];
}) {
  const referencesSnapshot = input.candidateIds.map((candidateId) => ({
    candidateId,
    evidenceIds: [`evidence:${candidateId}`],
    source: {
      url: `https://source.example/${candidateId}.png`,
      width: candidateId === 'candidate-2' ? 1000 : 1200,
      height: candidateId === 'candidate-2' ? 1500 : 1600,
      mimeType: 'image/png',
      role: 'product_main',
      skuKeys: input.ownershipLevel === 'sku' ? [input.ownershipKey] : ['sku-1', 'sku-2'],
      contentHash: sha(candidateId === 'candidate-1' ? '1' : '2'),
    },
  }));
  const slotSnapshot = {
    slotKey: input.slotKey,
    goal: input.goal,
    aspectRatio: '3:4',
    ownership: { level: input.ownershipLevel, key: input.ownershipKey },
    references: referencesSnapshot.map(({ candidateId, evidenceIds }) => ({ candidateId, evidenceIds })),
    factEvidenceIds: input.factEvidenceIds,
    safetyConstraints: ['preserve_product_identity', 'use_verified_facts_only'],
    acceptanceChecks: ['aspect_ratio_3_4', `goal_${input.goal}_is_visually_satisfied`],
  };
  return {
    id: input.id,
    ordinal: input.ordinal,
    slotKey: input.slotKey,
    goal: input.goal,
    ownershipLevel: input.ownershipLevel,
    ownershipKey: input.ownershipKey,
    compatibilityGroupKey: input.ownershipLevel === 'compatibility_group' ? input.ownershipKey : null,
    slotSnapshot,
    slotHash: hashAiMediaPlanningJson(slotSnapshot),
    referencesSnapshot,
    referencesHash: hashAiMediaPlanningJson(referencesSnapshot),
  };
}

function authority(overrides: Partial<AiImageSuitePromptAuthority> = {}): AiImageSuitePromptAuthority {
  const bindings = [
    {
      ordinal: 0,
      candidateId: 'candidate-1',
      assetId: 'asset-1',
      assetSha256: sha('a'),
      rawSourceSha256: sha('1'),
      mimeType: 'image/png',
      width: 1200,
      height: 1600,
      bindingHash: sha('b'),
    },
    {
      ordinal: 1,
      candidateId: 'candidate-2',
      assetId: 'asset-2',
      assetSha256: sha('c'),
      rawSourceSha256: sha('2'),
      mimeType: 'image/png',
      width: 1000,
      height: 1500,
      bindingHash: sha('d'),
    },
  ];
  return {
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    revision: 2,
    status: 'PLANNED',
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    planHash: sha('e'),
    provider: 'fake',
    model: 'fake-image-suite-v1',
    providerConfigHash: sha('f'),
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: sha('3'),
    sourceProfileHash: sha('4'),
    sourceSchemaVersion: 'source-product-capture-v2',
    referenceSetHash: sha('5'),
    slots: [
      slot({
        id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero',
        ownershipLevel: 'sku', ownershipKey: 'sku-1',
        candidateIds: ['candidate-2', 'candidate-1'], factEvidenceIds: ['fact-color', 'fact-material'],
      }),
      slot({
        id: 'slot-scene', ordinal: 1, slotKey: 'group:group-1:gallery:1', goal: 'scene',
        ownershipLevel: 'compatibility_group', ownershipKey: 'group-1',
        candidateIds: ['candidate-1'], factEvidenceIds: ['fact-material'],
      }),
    ],
    referenceAssets: bindings,
    planPayload: {
      compatibilityGroups: [{
        groupKey: 'group-1', identitySignature: 'same-shape', skuKeys: ['sku-1', 'sku-2'],
      }],
      verifiedFacts: [
        { path: '/skus/sku-1/color', value: 'red', evidenceIds: ['fact-color'], skuKeys: ['sku-1'] },
        { path: '/material', value: 'steel', evidenceIds: ['fact-material'] },
        { path: '/skus/sku-2/private', value: 'other', evidenceIds: ['fact-other'], skuKeys: ['sku-2'] },
      ],
    },
    ...overrides,
  };
}

function templateResolver(): AiImageSuitePromptTemplateResolver {
  return {
    resolveTemplateBatch: vi.fn(async (input: {
      templateKey: string;
      items: Array<{ key: string; variables: Record<string, unknown> }>;
    }): Promise<AiImageSuitePromptTemplateBatch> => ({
      templateKey: input.templateKey,
      release: { id: 'release-7', revisionId: 'revision-7', sequence: 7 },
      checksum: sha('6'),
      snapshot: {
        templateKey: input.templateKey,
        releaseId: 'release-7',
        revisionId: 'revision-7',
        sequence: 7,
        checksum: sha('6'),
        promptTemplate: 'Generate {{slot_spec_json}} {{reference_manifest_json}} {{verified_facts_json}}',
        negativePromptTemplate: 'Avoid {{safety_constraints_json}}',
        outputMode: 'media_candidate',
        variableSchemaVersion: 1,
        consumer: null,
        variableKeys: {
          prompt: ['slotSpecJson', 'referenceManifestJson', 'verifiedFactsJson'],
          negativePrompt: ['safetyConstraintsJson'],
        },
      },
      items: input.items.map((item) => ({
        key: item.key,
        normalizedVariables: Object.fromEntries(Object.entries(item.variables).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        ])),
        resolvedPrompt: `resolved:${item.key}`,
        resolvedNegativePrompt: `negative:${item.key}`,
        outputMode: 'media_candidate',
      })),
    })),
  };
}

function repository(overrides: Partial<AiImageSuitePromptRepository> = {}): AiImageSuitePromptRepository {
  return {
    findCommitReplay: vi.fn(async () => null),
    loadAuthority: vi.fn(async () => ({ kind: 'ready' as const, authority: authority() })),
    commitPromptSet: vi.fn(async (input) => ({
      kind: 'committed' as const,
      promptSetHash: input.promptSetHash,
      promptCount: input.prompts.length,
      templateKey: input.templateKey,
      templateReleaseId: input.templateReleaseId,
      templateSequence: input.templateSequence,
      templateChecksum: input.templateChecksum,
    })),
    ...overrides,
  };
}

const request = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 2,
  operationKey: 'freeze-prompts-operation-1',
};

describe('AI image suite prompt freeze', () => {
  it('uses an independent real Wanx template with all scoped facts under 800 characters', async () => {
    const wanxAuthority = authority({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', slots: [slot({
      id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero', ownershipLevel: 'sku', ownershipKey: 'sku-1',
      candidateIds: ['candidate-1'], factEvidenceIds: ['fact-color', 'fact-material'],
    })] });
    const repo = repository({ loadAuthority: vi.fn(async () => ({ kind: 'ready' as const, authority: wanxAuthority })) });
    const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'unused' });
    const result = await createAiImageSuitePromptService({ repository: repo, templateResolver: registry }).freeze(request);
    expect(result.templateKey).toBe('ai_media_suite_generation_wanx');
    const committed = vi.mocked(repo.commitPromptSet).mock.calls[0]![0];
    const prompt = committed.prompts[0]!;
    expect(committed.compilerVersion).toBe('ai-image-suite-prompt-compiler-wanx/v1');
    expect(prompt.resolvedNegativePrompt).toBe('');
    expect(Array.from(prompt.resolvedPrompt).length).toBeLessThanOrEqual(800);
    expect(prompt.resolvedPrompt).toContain('red');
    expect(prompt.resolvedPrompt).toContain('steel');
    expect(prompt.resolvedPrompt).toContain('不得');
    expect(prompt.resolvedPrompt).not.toContain('/skus/sku-2/private');
    expect(committed.templateSnapshot.templateKey).toBe('ai_media_suite_generation_wanx');
  });

  it('does not duplicate the provider-neutral safety policy for a production-sized Wanx fact set', async () => {
    const facts = [
      { path: '/facts/title', value: '潮牌加绒加厚连帽外套女士卫衣oversize2025新款春秋冬季美式复古', evidenceIds: ['title'] },
      { path: '/facts/shopName', value: '揭阳市麦尔斯服装有限公司', evidenceIds: ['shop'] },
      { path: '/facts/currency', value: 'CNY', evidenceIds: ['currency'] },
      { path: '/facts/shippingCny', value: 0, evidenceIds: ['shipping'] },
      { path: '/facts/shippingFree', value: true, evidenceIds: ['free'] },
      { path: '/facts/packageWeightG', value: 1, evidenceIds: ['weight'] },
      { path: '/skus/sku-1/attributes/0', value: { name: '尺码', value: 'XXL' }, evidenceIds: ['size'], skuKeys: ['sku-1'] },
      { path: '/skus/sku-1/attributes/1', value: { name: '颜色', value: '开衫卫衣黑色 加绒' }, evidenceIds: ['color'], skuKeys: ['sku-1'] },
    ];
    const planned = slot({ id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero',
      ownershipLevel: 'sku', ownershipKey: 'sku-1', candidateIds: ['candidate-1'], factEvidenceIds: facts.flatMap(fact => fact.evidenceIds) });
    planned.slotSnapshot.safetyConstraints = ['preserve_product_identity', 'use_verified_facts_only', 'do_not_invent_text_or_certifications', 'do_not_change_bundle_or_packaging'];
    planned.slotSnapshot.acceptanceChecks = ['aspect_ratio_3_4', 'product_matches_references', 'no_unverified_claims', 'goal_sku_hero_is_visually_satisfied'];
    planned.slotHash = hashAiMediaPlanningJson(planned.slotSnapshot);
    const repo = repository({ loadAuthority: async () => ({ kind: 'ready', authority: authority({ provider: 'dashscope-wanx',
      model: 'wanx2.1-imageedit', slots: [planned], planPayload: { compatibilityGroups: [], verifiedFacts: facts } }) }) });
    const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'unused' });
    await createAiImageSuitePromptService({ repository: repo, templateResolver: registry }).freeze(request);
    const prompt = vi.mocked(repo.commitPromptSet).mock.calls[0]![0].prompts[0]!;
    expect(Array.from(prompt.resolvedPrompt).length).toBeLessThanOrEqual(800);
    expect(prompt.resolvedPrompt).toContain('潮牌加绒加厚连帽外套');
    expect(prompt.resolvedPrompt).toContain('/facts/packageWeightG');
    expect(prompt.resolvedPrompt).not.toContain("Preserve the product's exact identity");
  });

  it('preserves Wanx administrator instructions and refuses oversized prompts before persistence', async () => {
    const single = slot({ id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero',
      ownershipLevel: 'sku', ownershipKey: 'sku-1', candidateIds: ['candidate-1'], factEvidenceIds: ['fact-color', 'fact-material'] });
    const repo = repository({ loadAuthority: vi.fn(async () => ({ kind: 'ready' as const, authority: authority({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', slots: [single] }) })) });
    const resolver = templateResolver();
    const original = resolver.resolveTemplateBatch.bind(resolver);
    resolver.resolveTemplateBatch = vi.fn(async input => {
      const batch = await original(input);
      batch.items[0]!.resolvedPrompt = '管理员指定柔光棚拍';
      return batch;
    });
    await createAiImageSuitePromptService({ repository: repo, templateResolver: resolver }).freeze(request);
    expect(vi.mocked(repo.commitPromptSet).mock.calls[0]![0].prompts[0]!.resolvedPrompt).toContain('管理员指定柔光棚拍');
    vi.mocked(repo.commitPromptSet).mockClear();
    resolver.resolveTemplateBatch = vi.fn(async input => {
      const batch = await original(input);
      batch.items[0]!.resolvedPrompt = '长'.repeat(801);
      return batch;
    });
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver }).freeze(request)).rejects.toMatchObject({ code: 'AI_MEDIA_SUITE_PROMPT_LIMIT_EXCEEDED', statusCode: 413 });
    expect(repo.commitPromptSet).not.toHaveBeenCalled();
  });

  it('fits a normal capture fact set and every standard safety/acceptance rule without truncating facts', async () => {
    const facts = [
      { path: '/facts/title', value: 'Sanitized explicit-zero stock fixture', evidenceIds: ['title'] },
      { path: '/facts/shopName', value: 'Sanitized supplier', evidenceIds: ['shop'] },
      { path: '/facts/currency', value: 'CNY', evidenceIds: ['currency'] },
      { path: '/facts/shippingCny', value: 0, evidenceIds: ['shipping'] },
      { path: '/facts/shippingFree', value: true, evidenceIds: ['free'] },
      { path: '/facts/minimumOrderQuantity', value: 1, evidenceIds: ['quantity'] },
    ];
    const planned = slot({ id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero',
      ownershipLevel: 'sku', ownershipKey: 'sku-1', candidateIds: ['candidate-1'], factEvidenceIds: facts.flatMap(fact => fact.evidenceIds) });
    planned.slotSnapshot.safetyConstraints = ['preserve_product_identity', 'use_verified_facts_only', 'do_not_invent_text_or_certifications', 'do_not_change_bundle_or_packaging'];
    planned.slotSnapshot.acceptanceChecks = ['aspect_ratio_3_4', 'product_matches_references', 'no_unverified_claims', 'goal_sku_hero_is_visually_satisfied'];
    planned.slotHash = hashAiMediaPlanningJson(planned.slotSnapshot);
    const repo = repository({ loadAuthority: async () => ({ kind: 'ready', authority: authority({ provider: 'dashscope-wanx',
      model: 'wanx2.1-imageedit', slots: [planned], planPayload: { compatibilityGroups: [], verifiedFacts: facts } }) }) });
    const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'unused' });
    await createAiImageSuitePromptService({ repository: repo, templateResolver: registry }).freeze(request);
    const prompt = vi.mocked(repo.commitPromptSet).mock.calls[0]![0].prompts[0]!;
    expect(Array.from(prompt.resolvedPrompt).length).toBeLessThanOrEqual(800);
    for (const fact of facts) {
      expect(prompt.resolvedPrompt).toContain(fact.path);
      expect(prompt.resolvedPrompt).toContain(JSON.stringify(fact.value));
    }
  });

  it('pins one release, scopes facts, preserves slot reference order, and commits no transport secrets', async () => {
    const repo = repository();
    const resolver = templateResolver();
    const service = createAiImageSuitePromptService({ repository: repo, templateResolver: resolver });

    const result = await service.freeze(request);

    expect(result).toMatchObject({
      suiteId: 'suite-1', promptCount: 2, replayed: false,
      templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
      templateReleaseId: 'release-7', templateSequence: 7, templateChecksum: sha('6'),
    });
    expect(resolver.resolveTemplateBatch).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(resolver.resolveTemplateBatch).mock.calls[0]![0];
    expect(batch.templateKey).toBe(AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY);
    expect(batch.items.map((item) => item.key)).toEqual(['sku:sku-1:hero', 'group:group-1:gallery:1']);

    const heroVariables = batch.items[0]!.variables;
    expect(JSON.parse(String(heroVariables.slotSpecJson))).toMatchObject({
      version: 'ozon-image-slot-policy/v1',
      goal: 'sku_hero',
      visibleTextPolicy: 'NO_VISIBLE_TEXT',
      compositionGuidance: expect.arrayContaining([
        expect.stringContaining('single SKU'),
        expect.stringContaining('70-85%'),
      ]),
    });
    expect(JSON.parse(String(heroVariables.verifiedFactsJson)).facts).toEqual([
      expect.objectContaining({ path: '/material', value: 'steel' }),
      expect.objectContaining({ path: '/skus/sku-1/color', value: 'red' }),
    ]);
    expect(JSON.parse(String(heroVariables.referenceManifestJson)).references.map(
      (entry: { width: number }) => entry.width,
    )).toEqual([1000, 1200]);
    expect(JSON.stringify(heroVariables)).not.toContain('https://');
    expect(JSON.stringify(heroVariables)).not.toContain('storageKey');
    expect(JSON.stringify(heroVariables)).not.toContain('candidate-1');
    expect(JSON.stringify(heroVariables)).not.toContain('asset-1');
    expect(JSON.stringify(heroVariables)).not.toContain(sha('a'));

    const sceneSlot = JSON.parse(String(batch.items[1]!.variables.slotSpecJson));
    expect(sceneSlot.compositionGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('realistic use context'),
      expect.stringContaining('primary subject'),
    ]));
    const sceneFacts = JSON.parse(String(batch.items[1]!.variables.verifiedFactsJson)).facts;
    expect(sceneFacts).toEqual([expect.objectContaining({ path: '/material', value: 'steel' })]);

    const committed = vi.mocked(repo.commitPromptSet).mock.calls[0]![0];
    expect(committed.promptSetVersion).toBe(AI_IMAGE_SUITE_PROMPT_SET_VERSION);
    expect(committed.prompts.every((prompt) => prompt.version === AI_IMAGE_SUITE_SLOT_PROMPT_VERSION)).toBe(true);
    expect(committed.prompts.map((prompt) => prompt.templateReleaseId)).toEqual(['release-7', 'release-7']);
    expect(committed.prompts.every((prompt) => (
      prompt.resolvedPrompt.includes('Preserve the exact product')
      && prompt.resolvedPrompt.includes('Russian Cyrillic')
      && prompt.resolvedPrompt.includes('thumbnail')
      && !prompt.resolvedNegativePrompt.includes('Preserve the exact product')
      && prompt.resolvedNegativePrompt.includes('altered product identity')
      && prompt.resolvedNegativePrompt.includes('source-language promotional overlays')
    ))).toBe(true);
    expect(JSON.stringify(committed)).not.toContain('https://source.example');
  });

  it('uses neutral no-claim compositions when a sensitive gallery goal has no relevant fact', async () => {
    const sensitiveGoals = ['function', 'fitment', 'spec', 'package'] as const;
    const sensitiveSlots = sensitiveGoals.map((goal, ordinal) => slot({
      id: `slot-${goal}`,
      ordinal,
      slotKey: `sku:sku-1:${goal}`,
      goal,
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      candidateIds: ['candidate-1'],
      factEvidenceIds: ['fact-title'],
    }));
    const repo = repository({
      loadAuthority: vi.fn(async () => ({
        kind: 'ready' as const,
        authority: authority({
          slots: sensitiveSlots,
          planPayload: {
            compatibilityGroups: [],
            verifiedFacts: [{
              path: '/facts/title',
              value: 'White ceramic mug',
              evidenceIds: ['fact-title'],
            }],
          },
        }),
      })),
    });
    const resolver = templateResolver();

    await createAiImageSuitePromptService({ repository: repo, templateResolver: resolver }).freeze(request);

    const batch = vi.mocked(resolver.resolveTemplateBatch).mock.calls[0]![0];
    expect(batch.items).toHaveLength(sensitiveGoals.length);
    for (const [index, goal] of sensitiveGoals.entries()) {
      const slotSpec = JSON.parse(String(batch.items[index]!.variables.slotSpecJson));
      expect(slotSpec).toMatchObject({ goal, goalEvidenceStatus: 'NEUTRAL_FALLBACK' });
      expect(slotSpec.compositionGuidance.join(' ')).toMatch(/no verified .* fact/i);
      expect(slotSpec.compositionGuidance.join(' ')).toMatch(/no .* claim|do not .* claim/i);
    }
  });

  it('keeps the fact-bound function composition when a relevant verified attribute exists', async () => {
    const functionSlot = slot({
      id: 'slot-function',
      ordinal: 0,
      slotKey: 'sku:sku-1:function',
      goal: 'function',
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      candidateIds: ['candidate-1'],
      factEvidenceIds: ['fact-function-name', 'fact-function-value'],
    });
    const repo = repository({
      loadAuthority: vi.fn(async () => ({
        kind: 'ready' as const,
        authority: authority({
          slots: [functionSlot],
          planPayload: {
            compatibilityGroups: [],
            verifiedFacts: [{
              path: '/skus/sku-1/attributes/0',
              value: { name: '功能', value: '一键开盖' },
              evidenceIds: ['fact-function-name', 'fact-function-value'],
              skuKeys: ['sku-1'],
            }],
          },
        }),
      })),
    });
    const resolver = templateResolver();

    await createAiImageSuitePromptService({ repository: repo, templateResolver: resolver }).freeze(request);

    const batch = vi.mocked(resolver.resolveTemplateBatch).mock.calls[0]![0];
    const slotSpec = JSON.parse(String(batch.items[0]!.variables.slotSpecJson));
    expect(slotSpec).toMatchObject({ goal: 'function', goalEvidenceStatus: 'VERIFIED_FACTS' });
    expect(slotSpec.compositionGuidance).toEqual(expect.arrayContaining([
      expect.stringContaining('verified function'),
    ]));
  });

  it.each([
    null,
    '',
    { name: '功能', value: null },
    { name: '功能', value: '' },
    false,
  ])('does not treat an empty sensitive fact value as verified evidence (%j)', async (value) => {
    const functionSlot = slot({
      id: 'slot-function-empty',
      ordinal: 0,
      slotKey: 'sku:sku-1:function-empty',
      goal: 'function',
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      candidateIds: ['candidate-1'],
      factEvidenceIds: ['fact-function-empty'],
    });
    const repo = repository({
      loadAuthority: vi.fn(async () => ({
        kind: 'ready' as const,
        authority: authority({
          slots: [functionSlot],
          planPayload: {
            compatibilityGroups: [],
            verifiedFacts: [{
              path: '/skus/sku-1/attributes/0/功能',
              value,
              evidenceIds: ['fact-function-empty'],
              skuKeys: ['sku-1'],
            }],
          },
        }),
      })),
    });
    const resolver = templateResolver();

    await createAiImageSuitePromptService({ repository: repo, templateResolver: resolver }).freeze(request);

    const batch = vi.mocked(resolver.resolveTemplateBatch).mock.calls[0]![0];
    const slotSpec = JSON.parse(String(batch.items[0]!.variables.slotSpecJson));
    expect(slotSpec).toMatchObject({ goalEvidenceStatus: 'NEUTRAL_FALLBACK' });
  });

  it('returns exact response-loss replay before loading mutable source or resolving templates', async () => {
    const repo = repository({
      findCommitReplay: vi.fn(async () => ({
        kind: 'existing' as const,
        promptSetHash: sha('9'),
        promptCount: 2,
        templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
        templateReleaseId: 'release-old',
        templateSequence: 3,
        templateChecksum: sha('8'),
      })),
      loadAuthority: vi.fn(async () => ({ kind: 'stale' as const })),
    });
    const resolver = templateResolver();

    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver })
      .freeze(request)).resolves.toMatchObject({
      suiteId: 'suite-1', promptSetHash: sha('9'), replayed: true,
      templateReleaseId: 'release-old',
    });
    expect(repo.loadAuthority).not.toHaveBeenCalled();
    expect(resolver.resolveTemplateBatch).not.toHaveBeenCalled();
    expect(repo.commitPromptSet).not.toHaveBeenCalled();
  });

  it.each([
    ['already-frozen', 'AI_MEDIA_SUITE_PROMPTS_ALREADY_FROZEN'],
    ['conflict', 'AI_MEDIA_SUITE_PROMPT_COMMIT_CONFLICT'],
  ] as const)('maps %s replay state without compiling', async (kind, code) => {
    const repo = repository({ findCommitReplay: vi.fn(async () => ({ kind })) });
    const resolver = templateResolver();
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver })
      .freeze(request)).rejects.toMatchObject({ code, statusCode: 409 });
    expect(resolver.resolveTemplateBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', 'AI_MEDIA_SUITE_PROMPT_NOT_FOUND', 404],
    ['stale', 'AI_MEDIA_SUITE_PROMPT_STALE', 409],
    ['references-not-ready', 'AI_MEDIA_SUITE_REFERENCES_NOT_READY', 409],
  ] as const)('maps %s authority state without compiling', async (kind, code, statusCode) => {
    const repo = repository({ loadAuthority: vi.fn(async () => ({ kind })) });
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: templateResolver() })
      .freeze(request)).rejects.toMatchObject({ code, statusCode });
  });

  it('fails closed for unknown goals and missing reference bindings before template resolution', async () => {
    for (const invalid of [
      authority({ slots: [slot({
        id: 'slot-unknown', ordinal: 0, slotKey: 'slot:unknown', goal: 'attacker_goal',
        ownershipLevel: 'sku', ownershipKey: 'sku-1', candidateIds: ['candidate-1'],
        factEvidenceIds: ['fact-color'],
      })] }),
      authority({ referenceAssets: authority().referenceAssets.slice(0, 1) }),
    ]) {
      const repo = repository({ loadAuthority: vi.fn(async () => ({ kind: 'ready' as const, authority: invalid })) });
      const resolver = templateResolver();
      await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver })
        .freeze(request)).rejects.toMatchObject({
        code: 'AI_MEDIA_SUITE_PROMPT_AUTHORITY_INVALID', statusCode: 409,
      });
      expect(resolver.resolveTemplateBatch).not.toHaveBeenCalled();
      expect(repo.commitPromptSet).not.toHaveBeenCalled();
    }
  });

  it('rejects cross-scope or incomplete fact evidence instead of leaking another SKU fact', async () => {
    const invalidSlot = slot({
      id: 'slot-hero', ordinal: 0, slotKey: 'sku:sku-1:hero', goal: 'sku_hero',
      ownershipLevel: 'sku', ownershipKey: 'sku-1', candidateIds: ['candidate-1'],
      factEvidenceIds: ['fact-color', 'fact-other'],
    });
    const repo = repository({
      loadAuthority: vi.fn(async () => ({
        kind: 'ready' as const,
        authority: authority({ slots: [invalidSlot] }),
      })),
    });
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: templateResolver() })
      .freeze(request)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_AUTHORITY_INVALID', statusCode: 409,
    });
    expect(repo.commitPromptSet).not.toHaveBeenCalled();
  });

  it('converts template compile failures to a typed no-write readiness error', async () => {
    const repo = repository();
    const resolver = templateResolver();
    vi.mocked(resolver.resolveTemplateBatch).mockRejectedValueOnce(new Error('active release missing'));
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver })
      .freeze(request)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_TEMPLATE_NOT_READY', statusCode: 503,
    });
    expect(repo.commitPromptSet).not.toHaveBeenCalled();
  });

  it('integrates with the real versioned Registry and freezes its canonical variable snapshot', async () => {
    const repo = repository();
    const registry = new AiPromptTemplateRegistryService(
      new InMemoryAiPromptTemplateStore(),
      { getLegacyPrompt: async () => 'unused suite test legacy Prompt' },
    );
    const result = await createAiImageSuitePromptService({
      repository: repo,
      templateResolver: registry,
    }).freeze(request);

    expect(result).toMatchObject({
      templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
      templateSequence: 1,
      replayed: false,
    });
    const committed = vi.mocked(repo.commitPromptSet).mock.calls[0]![0];
    expect(committed.templateSnapshot).toMatchObject({
      templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
      outputMode: 'media_candidate',
      variableKeys: {
        prompt: ['slotSpecJson', 'referenceManifestJson', 'verifiedFactsJson'],
        negativePrompt: ['safetyConstraintsJson'],
      },
    });
    expect(Object.keys(committed.prompts[0]!.variablesSnapshot).sort()).toEqual([
      'referenceManifestJson', 'safetyConstraintsJson', 'slotSpecJson', 'verifiedFactsJson',
    ]);
  });

  it.each(['snapshot', 'variables'] as const)('rejects a resolver-tampered %s before persistence', async (kind) => {
    const repo = repository();
    const source = templateResolver();
    const resolver: AiImageSuitePromptTemplateResolver = {
      resolveTemplateBatch: vi.fn(async (input) => {
        const batch = await source.resolveTemplateBatch(input);
        if (kind === 'snapshot') {
          return { ...batch, snapshot: { ...batch.snapshot, checksum: sha('0') } };
        }
        return {
          ...batch,
          items: batch.items.map((item, index) => index === 0 ? {
            ...item,
            normalizedVariables: {
              ...item.normalizedVariables,
              verifiedFactsJson: '{"facts":[]}',
            },
          } : item),
        };
      }),
    };
    await expect(createAiImageSuitePromptService({ repository: repo, templateResolver: resolver })
      .freeze(request)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_TEMPLATE_NOT_READY', statusCode: 503,
    });
    expect(repo.commitPromptSet).not.toHaveBeenCalled();
  });

  it('classifies deterministic Registry and aggregate-size limits without a retryable 503', async () => {
    const registryLimitRepo = repository();
    const registryLimitResolver = templateResolver();
    vi.mocked(registryLimitResolver.resolveTemplateBatch).mockRejectedValueOnce(
      new AiPromptTemplateError('INVALID_TEST_INPUT', 'verifiedFactsJson exceeds 24576 bytes'),
    );
    await expect(createAiImageSuitePromptService({
      repository: registryLimitRepo, templateResolver: registryLimitResolver,
    }).freeze(request)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_LIMIT_EXCEEDED', statusCode: 413,
    });
    expect(registryLimitRepo.commitPromptSet).not.toHaveBeenCalled();

    const largeAuthority = authority({
      slots: Array.from({ length: 100 }, (_, ordinal) => slot({
        id: `slot-${ordinal}`,
        ordinal,
        slotKey: `group:group-1:gallery:${ordinal + 1}`,
        goal: 'scene',
        ownershipLevel: 'compatibility_group',
        ownershipKey: 'group-1',
        candidateIds: ['candidate-1'],
        factEvidenceIds: ['fact-material'],
      })),
    });
    const aggregateRepo = repository({
      loadAuthority: vi.fn(async () => ({ kind: 'ready' as const, authority: largeAuthority })),
    });
    const aggregateResolver = templateResolver();
    vi.mocked(aggregateResolver.resolveTemplateBatch).mockImplementationOnce(async (input) => {
      const batch = await templateResolver().resolveTemplateBatch(input);
      return {
        ...batch,
        items: batch.items.map((item) => ({
          ...item,
          resolvedPrompt: `resolved:${item.key}:${'x'.repeat(42_000)}`,
        })),
      };
    });
    await expect(createAiImageSuitePromptService({
      repository: aggregateRepo, templateResolver: aggregateResolver,
    }).freeze(request)).rejects.toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_LIMIT_EXCEEDED', statusCode: 413,
    });
    expect(aggregateRepo.commitPromptSet).not.toHaveBeenCalled();
  });

  it('validates the frozen revision and operation identity at the service edge', async () => {
    const service = createAiImageSuitePromptService({
      repository: repository(), templateResolver: templateResolver(),
    });
    for (const invalid of [
      { ...request, expectedRevision: 1 },
      { ...request, operationKey: 'short' },
      { ...request, actorUserId: '' },
    ]) {
      await expect(service.freeze(invalid)).rejects.toBeInstanceOf(AiImageSuitePromptError);
      await expect(service.freeze(invalid)).rejects.toMatchObject({
        code: 'AI_MEDIA_SUITE_PROMPT_INVALID_INPUT', statusCode: 400,
      });
    }
  });
});
