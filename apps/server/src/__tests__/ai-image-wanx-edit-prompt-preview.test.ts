import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryAiPromptTemplateStore, renderAiPromptRevision } from '../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { assertWanxHostedEditPrompt, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import { parseAiImageWanxTrialRequest } from '../services/ai-image-wanx-trial-preparation.js';
import type { AiPromptRenderingProfile } from '../services/ai-image-edit-prompt-contract.js';

const V1 = 'ai-image-wanx21-edit-prompt/v1' as const;
const PREVIEW = 'ai-image-wanx21-edit-prompt/scoped-print-preview-v2' as AiPromptRenderingProfile;
const LEGACY_PRINT = '只可移除或替换外部促销叠加层；商品、品牌、标签和包装上的固有印字属于身份，必须保留，除非另有明确授权的图片翻译流程针对该文字。';
const SCOPED_PRINT = '涉及文字或标志的移除或替换时，只可处理外部促销叠加层。商品、品牌、标签和包装上的固有印字属于身份，必须保留，除非另有明确授权的图片翻译流程针对该文字。';
const variables = { userPrompt: '将背景修改为浅蓝灰色，保持杯子不变。', userNegativePrompt: '不要新增文字或配件。' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const custom = { templateKey: 'inpaint.base', promptTemplate: '自定义图像要求：{{user_prompt}}', negativePromptTemplate: '自定义排除：{{user_negative_prompt}}' };

function registry() {
  return new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), { getLegacyPrompt: async () => 'Synthetic legacy prompt' });
}

function frozen(resolved: Awaited<ReturnType<AiPromptTemplateRegistryService['resolveTemplate']>>) {
  return {
    prompt: variables.userPrompt, negativePrompt: variables.userNegativePrompt,
    resolvedPrompt: resolved.resolvedPrompt, resolvedNegativePrompt: resolved.resolvedNegativePrompt,
    templateKey: resolved.templateKey, templateReleaseId: resolved.release.id,
    templateChecksum: resolved.checksum, templateSnapshot: resolved.snapshot,
  };
}

describe('offline Wanx scoped-print prompt preview', () => {
  it.each(['full-image-edit.base', 'inpaint.base'])('changes only the print-rule scope for %s and preserves v1 and its source release', async (templateKey) => {
    const target = registry();
    const legacy = await target.resolveTemplate({ templateKey, variables });
    const baseline = await target.resolveTemplate({ templateKey, variables, renderingProfile: V1 });
    const preview = await target.resolveTemplate({ templateKey, variables, renderingProfile: PREVIEW });

    expect(preview.resolvedPrompt).toBe(baseline.resolvedPrompt.replace(LEGACY_PRINT, SCOPED_PRINT));
    expect(preview.resolvedNegativePrompt).toBe(baseline.resolvedNegativePrompt);
    expect(preview.release).toEqual(baseline.release);
    expect(preview.checksum).toBe(baseline.checksum);
    expect(preview.snapshot.promptTemplate).toBe(baseline.snapshot.promptTemplate);
    expect(preview.snapshot.negativePromptTemplate).toBe(baseline.snapshot.negativePromptTemplate);
    expect(preview.snapshot.renderingContract).toMatchObject({
      profile: PREVIEW, executionScope: 'OFFLINE_PREVIEW_ONLY',
      policyClauseIds: baseline.snapshot.renderingContract?.policyClauseIds,
      sourcePolicySha256: baseline.snapshot.renderingContract?.sourcePolicySha256,
      maximumPromptCharacters: 800, characterCounting: 'unicode-code-points', negativePromptMode: 'inline',
    });
    expect(preview.snapshot.renderingContract?.policySha256).not.toBe(baseline.snapshot.renderingContract?.policySha256);
    expect(preview.snapshot.renderingContract?.contractHash).not.toBe(baseline.snapshot.renderingContract?.contractHash);
    expect(baseline.snapshot.renderingContract).not.toHaveProperty('executionScope');
    expect(await target.resolveTemplate({ templateKey, variables, renderingProfile: V1 })).toEqual(baseline);
    expect(await target.resolveTemplate({ templateKey, variables })).toEqual(legacy);
  });

  it('keeps custom templates and literal operator text intact while changing only the owned policy clause', () => {
    const input = { userPrompt: "$& $$ $` $' {{user_prompt}}\r\n仅编辑背景", userNegativePrompt: '{{user_negative_prompt}}\t保留商品印字' };
    const baseline = renderAiPromptRevision(custom, input, V1);
    const preview = renderAiPromptRevision(custom, input, PREVIEW);
    expect(preview.resolvedPrompt).toBe(baseline.resolvedPrompt.replace(LEGACY_PRINT, SCOPED_PRINT));
    expect(preview.resolvedPrompt).toContain(`自定义图像要求：${input.userPrompt}`);
    expect(preview.resolvedPrompt).toContain(`自定义排除：${input.userNegativePrompt}`);
    expect(preview.renderingContract).toMatchObject({
      strategy: 'verbatim-custom', sourcePromptTemplateSha256: digest(custom.promptTemplate),
      sourceNegativePromptTemplateSha256: digest(custom.negativePromptTemplate),
    });
  });

  it('keeps complete 800-codepoint, Unicode and literal constraints on the preview', () => {
    const baseline = renderAiPromptRevision(custom, { userPrompt: '', userNegativePrompt: 'N' }, PREVIEW);
    const text = '😀'.repeat(800 - Array.from(baseline.resolvedPrompt).length);
    const exact = renderAiPromptRevision(custom, { userPrompt: text, userNegativePrompt: 'N' }, PREVIEW);
    expect(Array.from(exact.resolvedPrompt)).toHaveLength(800);
    expect(exact.resolvedPrompt).toContain(text);
    expect(() => renderAiPromptRevision(custom, { userPrompt: `${text}中`, userNegativePrompt: 'N' }, PREVIEW))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
    expect(() => renderAiPromptRevision(custom, { userPrompt: text, userNegativePrompt: 'NN' }, PREVIEW))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
    for (const invalid of ['\ud800', '\udc00', 'text\u0000suffix']) {
      expect(() => renderAiPromptRevision(custom, { userPrompt: invalid, userNegativePrompt: '' }, PREVIEW))
        .toThrowError(expect.objectContaining({ code: 'INVALID_PROMPT_PROFILE_INPUT' }));
    }
  });

  it.each(['FULL_EDIT', 'INPAINT'] as const)('rejects internally consistent preview snapshots at hosted and trial %s boundaries', async (operation) => {
    const target = registry();
    const expected = { roundId: 'preview-rejection-round-01', adapterRevision: 'a'.repeat(40), providerAccountUidSha256: 'b'.repeat(64), credentialRevision: 'synthetic-preview-key-revision' };
    const baselineOperations = await Promise.all((['FULL_EDIT', 'INPAINT'] as const).map(async (kind) => {
      const templateKey = kind === 'FULL_EDIT' ? 'full-image-edit.base' : 'inpaint.base';
      const resolved = await target.resolveTemplate({ templateKey, variables, renderingProfile: V1 });
      return {
        operationId: `${expected.roundId}-${kind.toLowerCase()}`, operation: kind,
        source: { path: 'inputs/source.png', sha256: 'c'.repeat(64) },
        mask: kind === 'INPAINT' ? { path: 'inputs/mask.png', sha256: 'd'.repeat(64) } : null,
        frozenPrompt: frozen(resolved), quotedCost: { currency: 'CNY', amount: 14, scale: 2 },
        maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
      };
    }));
    const request = { schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_INPUT_V1', ...expected, provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', apiBase: 'https://dashscope.aliyuncs.com/api/v1', maximumCost: { currency: 'CNY', amount: 1, scale: 0 }, operations: baselineOperations };
    expect(() => parseAiImageWanxTrialRequest(request, expected)).not.toThrow();
    const selected = request.operations.find((item) => item.operation === operation)!;
    const hostedBase = { provider: request.provider, model: request.model, operation, width: 1024, height: 1024 };
    expect(() => assertWanxHostedEditPrompt({ ...hostedBase, ...selected.frozenPrompt })).not.toThrow();
    const preview = await target.resolveTemplate({ templateKey: selected.frozenPrompt.templateKey, variables, renderingProfile: PREVIEW });
    selected.frozenPrompt = frozen(preview);
    expect(() => assertWanxHostedEditPrompt({ ...hostedBase, ...selected.frozenPrompt }))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    expect(() => parseAiImageWanxTrialRequest(request, expected))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    expect(resolveAiImageEditProviderContract(request.provider, request.model, request.apiBase)?.renderingProfile).toBe(V1);
  });

  it.each(['text-to-image.base', 'image-suite-generation.base', 'image-translation.base'])('rejects the preview profile for %s', async (templateKey) => {
    await expect(registry().resolveTemplate({ templateKey, variables, renderingProfile: PREVIEW }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_PROMPT_RENDER_PROFILE' });
  });
});
