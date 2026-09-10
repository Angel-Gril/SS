import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AI_MEDIA_EDIT_SAFETY_POLICY,
  InMemoryAiPromptTemplateStore,
  renderAiPromptRevision,
} from '../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { createAiImageEditWorkflowFingerprint } from '../services/ai-media-workflows.js';
import { createAiImageProviderRuntimeContract } from '../services/ai-image-provider-runtime-contract.js';
import { createDashScopeWanx21ImageEditProvider } from '../services/ai-image-wanx-edit-provider.js';

const PROFILE = 'ai-image-wanx21-edit-prompt/v1' as const;
const MODEL = 'wanx2.1-imageedit';
const variables = { userPrompt: '仅将背景改成纯白，保持杯子不变。', userNegativePrompt: '不要新增文字或配件。' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const minimalRevision = {
  templateKey: 'full-image-edit.base',
  promptTemplate: '{{user_prompt}}',
  negativePromptTemplate: '{{user_negative_prompt}}',
};

function registry() {
  const store = new InMemoryAiPromptTemplateStore();
  return {
    store,
    target: new AiPromptTemplateRegistryService(store, { getLegacyPrompt: async () => 'Legacy prompt' }),
  };
}

async function publishCustom(target: AiPromptTemplateRegistryService, promptTemplate: string, negativePromptTemplate: string) {
  const draft = await target.createRevision({
    actorUserId: 'prompt-test-admin', key: minimalRevision.templateKey,
    promptTemplate, negativePromptTemplate,
  });
  const run = await target.testRevision({ actorUserId: 'prompt-test-admin', revisionId: draft.id, sampleInput: variables });
  const release = await target.publishRevision({
    actorUserId: 'prompt-test-admin', key: minimalRevision.templateKey, revisionId: draft.id,
    testRunId: run.testRunId, expectedSequence: 1,
  });
  return { draft, release };
}

describe('explicit Wanx edit prompt compilation', () => {
  it.each([
    ['full-image-edit.base', 'c56a90afbe93a7e35bff5939907fad929465fb4072af981b0aae25568579fd6c', '24eafb39119cf898fd722e37f4517bd678700533ecc08c771e78e21dc7d482a6'],
    ['inpaint.base', '938d920f04487603c1b8be72df6df311a703645fb31b5dd915a3acbe7ad2819a', '674b96c7bfbbb8276003b4b6611fd6ea5f97ee1053013315f23320040d9a5c18'],
  ])('preserves the legacy %s release while explicitly compiling the complete Wanx prompt', async (templateKey, promptHash, contractHash) => {
    const { target } = registry();
    const base = await target.resolveTemplate({ templateKey, variables });
    expect(digest(AI_MEDIA_EDIT_SAFETY_POLICY)).toBe('9de2568359e5dc0b2f08ac5e8b8ac457dbb989ad78e4d9485234a895228e98ea');
    expect(digest(base.snapshot.promptTemplate)).toBe(promptHash);
    expect(digest(base.snapshot.negativePromptTemplate)).toBe('f94efab20a6cacdf0b03e7908d25d1ba7df6a62d4859eb4c98dc9ab491a3de9a');
    expect(base.snapshot).not.toHaveProperty('renderingContract');

    const compiled = await target.resolveTemplate({ templateKey, variables, renderingProfile: PROFILE });

    expect(Array.from(compiled.resolvedPrompt).length).toBeLessThanOrEqual(800);
    expect(compiled.resolvedPrompt).toContain(variables.userPrompt);
    expect(compiled.resolvedPrompt).toContain(variables.userNegativePrompt);
    expect(compiled.resolvedPrompt).toContain('固有标签位置');
    expect(compiled.resolvedNegativePrompt).toBe('');
    expect(compiled.snapshot).toMatchObject({
      ...base.snapshot,
      renderingContract: {
        profile: PROFILE, model: MODEL, templateKey, strategy: 'reviewed-default',
        maximumPromptCharacters: 800, characterCounting: 'unicode-code-points', negativePromptMode: 'inline',
        policyClauseIds: ['product_identity', 'untrusted_inputs', 'intrinsic_print', 'no_new_claims', 'review_only', 'mask_preservation'],
        policySha256: '314ff5613418155ebe6154c60fca3484bd61739a1805c6700da36bdb92474a26',
        contractHash,
      },
    });
    expect(compiled.release).toEqual(base.release);
    expect(compiled.checksum).toBe(base.checksum);
    expect(await target.resolveTemplate({ templateKey, variables })).toEqual(base);
    expect(JSON.stringify(compiled.snapshot.renderingContract)).not.toContain(variables.userPrompt);
    expect(JSON.stringify(compiled.snapshot.renderingContract)).not.toContain(variables.userNegativePrompt);
    if (templateKey === 'inpaint.base') {
      expect(compiled.resolvedPrompt).toContain('白色选区');
      expect(compiled.resolvedPrompt).toContain('选区外的一切');
      expect(compiled.resolvedPrompt).toContain('逐像素保留');
    } else {
      expect(compiled.resolvedPrompt).toContain('整个场景');
    }
  });

  it('keeps both published custom template bodies verbatim instead of replacing them with defaults', async () => {
    const { target } = registry();
    const promptTemplate = '自定义要求：{{user_prompt}}\n保留所有固有印字，结束标记A。';
    const negativePromptTemplate = '自定义排除：{{user_negative_prompt}}\n禁止删除固有商标，结束标记B。';
    const { draft, release } = await publishCustom(target, promptTemplate, negativePromptTemplate);
    const normal = await target.resolveTemplate({ templateKey: minimalRevision.templateKey, variables });
    const compiled = await target.resolveTemplate({
      templateKey: minimalRevision.templateKey, variables, renderingProfile: PROFILE,
    });

    expect(compiled.resolvedPrompt).toContain(`自定义要求：${variables.userPrompt}\n保留所有固有印字，结束标记A。`);
    expect(compiled.resolvedPrompt).toContain(`自定义排除：${variables.userNegativePrompt}\n禁止删除固有商标，结束标记B。`);
    expect(compiled.snapshot).toMatchObject({
      promptTemplate, negativePromptTemplate,
      renderingContract: { strategy: 'verbatim-custom', sourcePromptTemplateSha256: digest(promptTemplate) },
    });
    expect(compiled.release.id).toBe(release.id);
    expect(compiled.checksum).toBe(draft.checksum);
    expect(await target.resolveTemplate({ templateKey: minimalRevision.templateKey, variables })).toEqual(normal);
  });

  it('rejects an oversized custom template without truncating or changing its release', async () => {
    const { target, store } = registry();
    const promptTemplate = `CUSTOM_TEXT_MUST_NOT_DISAPPEAR ${'长'.repeat(801)} {{user_prompt}}`;
    const { release } = await publishCustom(target, promptTemplate, '{{user_negative_prompt}}');
    const before = await store.getRevision(release.revisionId);

    const error = await target.resolveTemplate({
      templateKey: minimalRevision.templateKey, variables, renderingProfile: PROFILE,
    }).catch((value) => value);

    expect(error).toMatchObject({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' });
    expect(error.message).not.toContain('CUSTOM_TEXT_MUST_NOT_DISAPPEAR');
    expect(await store.getRevision(release.revisionId)).toEqual(before);
    expect((await store.getActiveRelease(minimalRevision.templateKey))?.id).toBe(release.id);
  });

  it('does not substitute the default positive template when only the negative template was customized', async () => {
    const { target } = registry();
    const base = await target.resolveTemplate({ templateKey: minimalRevision.templateKey, variables });
    await publishCustom(target, base.snapshot.promptTemplate, '{{user_negative_prompt}}');
    const compiled = await target.resolveTemplate({
      templateKey: minimalRevision.templateKey, renderingProfile: PROFILE,
      variables: { userPrompt: 'X', userNegativePrompt: 'Y' },
    });
    expect(compiled.snapshot.renderingContract?.strategy).toBe('verbatim-custom');
    expect(compiled.resolvedPrompt).toContain(base.snapshot.promptTemplate.replace('{{user_prompt}}', 'X'));
    expect(compiled.resolvedPrompt).toContain('\n排除要求：\nY');
  });

  it('counts the complete positive and negative prompt in Unicode codepoints at exactly 800 and 801', () => {
    const baseline = renderAiPromptRevision(minimalRevision, { userPrompt: '', userNegativePrompt: 'N' }, PROFILE);
    const available = 800 - Array.from(baseline.resolvedPrompt).length;
    expect(available).toBeGreaterThan(0);
    const text = '😀'.repeat(available);
    const exact = renderAiPromptRevision(minimalRevision, { userPrompt: text, userNegativePrompt: 'N' }, PROFILE);
    expect(Array.from(exact.resolvedPrompt)).toHaveLength(800);
    expect(exact.resolvedPrompt).toContain(text);
    expect(exact.resolvedPrompt.length).toBeGreaterThan(800);
    expect(() => renderAiPromptRevision(minimalRevision, { userPrompt: `${text}中`, userNegativePrompt: 'N' }, PROFILE))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
    expect(() => renderAiPromptRevision(minimalRevision, { userPrompt: text, userNegativePrompt: 'NN' }, PROFILE))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
  });

  it.each(['\ud800', '\udc00', 'abc\u0000def'])('rejects non-roundtrippable or unsafe control input %j', (text) => {
    expect(() => renderAiPromptRevision(minimalRevision, { userPrompt: text, userNegativePrompt: '' }, PROFILE))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PROMPT_PROFILE_INPUT' }));
  });

  it('preserves multiline and dollar/token literals in both operator fields', () => {
    const text = "$& $$ $` $' {{user_prompt}}\r\n第二行\t内容";
    const compiled = renderAiPromptRevision(minimalRevision, { userPrompt: text, userNegativePrompt: text }, PROFILE);
    expect(compiled.resolvedPrompt.split(text)).toHaveLength(3);
    expect(compiled.resolvedNegativePrompt).toBe('');
  });

  it.each(['text-to-image.base', 'image-suite-generation.base', 'image-translation.base'])('rejects the profile on %s before bootstrapping', async (templateKey) => {
    const { target, store } = registry();
    const ensureTemplate = vi.spyOn(store, 'ensureTemplate');
    await expect(target.resolveTemplate({ templateKey, variables, renderingProfile: PROFILE }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_PROMPT_RENDER_PROFILE' });
    expect(ensureTemplate).not.toHaveBeenCalled();
  });

  it.each(['unknown-profile', '', null, {}])('rejects an invalid explicit profile without falling back: %j', (profile) => {
    expect(() => renderAiPromptRevision(minimalRevision, variables, profile as typeof PROFILE))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PROMPT_RENDER_PROFILE' }));
  });

  it('freezes one rendering contract across a batch and includes it in workflow fingerprint identity', async () => {
    const { target } = registry();
    const batch = await target.resolveTemplateBatch({
      templateKey: minimalRevision.templateKey, renderingProfile: PROFILE,
      items: [{ key: 'first', variables }, { key: 'second', variables: { ...variables, userPrompt: '改为浅灰背景。' } }],
    });
    expect(batch.snapshot).toHaveProperty('renderingContract.contractHash');
    expect(batch.items[0]?.resolvedPrompt).not.toBe(batch.items[1]?.resolvedPrompt);
    const runtime = { provider: 'dashscope-wanx', model: MODEL, baseUrl: 'https://dashscope.aliyuncs.com/api/v1', costPerImageCents: 7,
      credentialRevision: { recordId: 'synthetic-prompt-config', revision: 1, updatedAt: '2026-09-09T10:00:00.000Z' } };
    const input = {
      ownerUserId: 'prompt-owner', operation: 'FULL_EDIT' as const, sourceAssetId: 'source-fixture',
      width: 1024, height: 1024, prompt: variables.userPrompt, negativePrompt: variables.userNegativePrompt,
      resolvedPrompt: batch.items[0]!.resolvedPrompt, resolvedNegativePrompt: batch.items[0]!.resolvedNegativePrompt,
      templateKey: batch.templateKey, templateReleaseId: batch.release.id, templateChecksum: batch.checksum,
      templateSnapshot: batch.snapshot, dailyLimit: 20, context: { type: 'collect' as const, id: 'goods-fixture' },
      provider: runtime.provider, model: runtime.model, estimatedCostCents: 7,
      providerRuntimeContract: createAiImageProviderRuntimeContract(runtime, { count: 1, width: 1024, height: 1024 }),
    };
    const fingerprint = createAiImageEditWorkflowFingerprint(input);
    expect(createAiImageEditWorkflowFingerprint({ ...input, templateSnapshot: { ...batch.snapshot, renderingContract: null } }))
      .not.toBe(fingerprint);
    expect(createAiImageEditWorkflowFingerprint({ ...input, resolvedPrompt: `${input.resolvedPrompt}。` }))
      .not.toBe(fingerprint);
    expect(createAiImageEditWorkflowFingerprint(input)).toBe(fingerprint);
  });

  it('sends the exact frozen compiled text to the real Wanx adapter with only fixture HTTP', async () => {
    const { target } = registry();
    const compiled = await target.resolveTemplate({ templateKey: minimalRevision.templateKey, variables, renderingProfile: PROFILE });
    const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#334455' } }).png().toBuffer();
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ output: { task_id: 'synthetic-wanx-prompt', task_status: 'PENDING' } }))
      .mockResolvedValueOnce(json({
        output: { task_id: 'synthetic-wanx-prompt', task_status: 'SUCCEEDED', results: [{ url: 'https://dashscope-result.oss-cn-beijing.aliyuncs.com/prompt.png' }], task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } },
        usage: { image_count: 1 },
      }))
      .mockResolvedValueOnce(new Response(source, { headers: { 'content-type': 'image/png' } }));
    const provider = createDashScopeWanx21ImageEditProvider({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1', model: MODEL,
      apiKey: 'synthetic-prompt-test-sentinel', fetch: fetcher, pollIntervalMs: 0,
    });
    await expect(provider.edit({
      operation: 'FULL_EDIT', model: MODEL, width: 1024, height: 1024,
      prompt: compiled.resolvedPrompt, negativePrompt: compiled.resolvedNegativePrompt,
      images: [{ buffer: source, mimeType: 'image/png' }],
    })).resolves.toMatchObject({ providerJobId: 'synthetic-wanx-prompt' });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.input.prompt).toBe(compiled.resolvedPrompt);
    expect(body.input).not.toHaveProperty('negative_prompt');
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'GET']);
  });
});
