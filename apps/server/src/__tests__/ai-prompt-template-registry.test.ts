import { describe, expect, it, vi } from 'vitest';
import {
  AI_PROMPT_SAFETY_POLICY,
  InMemoryAiPromptTemplateStore,
} from '../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';

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
      allowedVariables: ['user_prompt', 'user_negative_prompt'],
      safetyPolicy: AI_PROMPT_SAFETY_POLICY,
      items: [{
        key: KEY,
        currentSequence: 1,
        activeRevision: { id: resolved.release.revisionId },
      }],
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
      promptTemplate: `${'x'.repeat(16_001)}\n{{user_prompt}}`,
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
  });
});
