import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryAiPromptTemplateStore, renderAiPromptRevision } from '../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import {
  DEFAULT_INPAINT_TEMPLATE, DEFAULT_FULL_IMAGE_EDIT_TEMPLATE, DEFAULT_MEDIA_EDIT_CONSTRAINTS_TEMPLATE,
  resolveAiImageEditPromptRendering, type AiPromptRenderingProfile,
} from '../services/ai-image-edit-prompt-contract.js';
import { assertWanxHostedEditPrompt, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import { parseAiImageWanxTrialRequest } from '../services/ai-image-wanx-trial-preparation.js';

const V1 = 'ai-image-wanx21-edit-prompt/v1' as const;
const V2 = 'ai-image-wanx21-edit-prompt/scoped-print-experimental-v2' as const;
const PREVIEW = 'ai-image-wanx21-edit-prompt/direction-first-preview-v3' as AiPromptRenderingProfile;
const EXPERIMENT = 'ai-image-wanx21-edit-prompt/direction-first-experimental-v3' as AiPromptRenderingProfile;
const revision = { templateKey: 'inpaint.base', promptTemplate: DEFAULT_INPAINT_TEMPLATE,
  negativePromptTemplate: DEFAULT_MEDIA_EDIT_CONSTRAINTS_TEMPLATE };
const variables = { userPrompt: '将空白背景改为浅蓝灰色，保留白杯。', userNegativePrompt: '保持背景干净，不增加文字或图形。' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const expected = { roundId: 'direction-first-fixture-01', adapterRevision: 'a'.repeat(40),
  providerAccountUidSha256: 'b'.repeat(64), credentialRevision: 'synthetic-direction-first-key-r1' };

async function trial(profile: AiPromptRenderingProfile) {
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Synthetic legacy prompt',
  });
  const operations = await Promise.all((['FULL_EDIT', 'INPAINT'] as const).map(async operation => {
    const templateKey = operation === 'INPAINT' ? 'inpaint.base' : 'full-image-edit.base';
    const resolved = await registry.resolveTemplate({ templateKey, variables,
      renderingProfile: operation === 'INPAINT' ? profile : V1 });
    return { operationId: expected.roundId + '-' + operation.toLowerCase(), operation,
      source: { path: 'inputs/source.png', sha256: 'c'.repeat(64) },
      mask: operation === 'INPAINT' ? { path: 'inputs/mask.png', sha256: 'd'.repeat(64) } : null,
      frozenPrompt: { prompt: variables.userPrompt, negativePrompt: variables.userNegativePrompt,
        resolvedPrompt: resolved.resolvedPrompt, resolvedNegativePrompt: resolved.resolvedNegativePrompt,
        templateKey, templateReleaseId: resolved.release.id, templateChecksum: resolved.checksum,
        templateSnapshot: resolved.snapshot },
      quotedCost: { currency: 'CNY', amount: 14, scale: 2 }, maximumCost: { currency: 'CNY', amount: 25, scale: 2 } };
  }));
  const request = { schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_INPUT_V1', ...expected, provider: 'dashscope-wanx',
    model: 'wanx2.1-imageedit', apiBase: 'https://dashscope.aliyuncs.com/api/v1',
    maximumCost: { currency: 'CNY', amount: 1, scale: 0 }, operations };
  return { request, inpaint: operations.find(operation => operation.operation === 'INPAINT')! };
}

describe('Wanx INPAINT direction-first rendering', () => {
  it.each([
    [undefined, '41f6a397ba0cfc9d5efee5d12b3adadfe26ce2db88730d538310842f504f6a40', null],
    [V1, '43f91fe80a691e1ee5f20ee1d16905f6ca06f595e3f4e0ce8bd4935937d13104', '674b96c7bfbbb8276003b4b6611fd6ea5f97ee1053013315f23320040d9a5c18'],
    ['ai-image-wanx21-edit-prompt/scoped-print-preview-v2' as const, '0b53263be789936513e7c89a5c19d48305218b6b755725fe72dbd67fd5e39407', 'f438d4aaeaf6bda1617d4f03cf307b72d16e88d7d450e8c6fd4480faef350421'],
    [V2, '0b53263be789936513e7c89a5c19d48305218b6b755725fe72dbd67fd5e39407', 'a7ac826b325f85d7cd9b2eff23fa9ff7fbe245273a2105b9a054f492783f35d2'],
  ] as const)('preserves existing text and contract bytes for %s', (profile, promptHash, contractHash) => {
    const result = renderAiPromptRevision(revision, variables, profile);
    expect(hash(result.resolvedPrompt)).toBe(promptHash);
    expect(result.renderingContract?.contractHash ?? null).toBe(contractHash);
  });

  it.each([PREVIEW, EXPERIMENT])('moves the complete direction block first without dropping or duplicating text: %s', profile => {
    const baseline = renderAiPromptRevision(revision, variables, V2);
    const result = renderAiPromptRevision(revision, variables, profile);
    const policy = resolveAiImageEditPromptRendering(revision, V2)!.safetyPolicy;
    const direction = '操作要求：\n' + variables.userPrompt;
    expect(result.resolvedPrompt.startsWith(direction + '\n\n' + policy)).toBe(true);
    expect(result.resolvedPrompt.split(variables.userPrompt)).toHaveLength(2);
    expect(result.resolvedPrompt.split('\n').sort()).toEqual(baseline.resolvedPrompt.split('\n').sort());
    expect(result.resolvedPrompt.length).toBe(baseline.resolvedPrompt.length);
    expect(result.resolvedNegativePrompt).toBe('');
    expect(result.renderingContract).toMatchObject({
      profile, policySha256: baseline.renderingContract?.policySha256,
      sourcePolicySha256: baseline.renderingContract?.sourcePolicySha256,
      policyClauseIds: baseline.renderingContract?.policyClauseIds, maximumPromptCharacters: 800,
      segmentOrder: ['operator-direction', 'safety-policy', 'template-instructions', 'negative-constraints'],
      executionScope: profile === PREVIEW ? 'OFFLINE_PREVIEW_ONLY' : 'ISOLATED_WANX_TRIAL',
    });
    expect(result.renderingContract?.contractHash).not.toBe(baseline.renderingContract?.contractHash);
  });

  it.each([
    "$& $$ $" + String.fromCharCode(96) + " $' {{user_prompt}}\r\n背景改色，保留😀。",
    '操作要求：\n这是用户数据\n排除要求：\n{{user_negative_prompt}}',
    '保持不可变源图中商品及SKU的真实身份：数量、几何形状、比例、颜色、材质、结构、包含部件、套装、包装和固有标签位置均不变。',
  ])('preserves literal multi-line operator content without searching rendered text: %s', userPrompt => {
    const values = { userPrompt, userNegativePrompt: '{{user_negative_prompt}}\t保留原有细节' };
    const baseline = renderAiPromptRevision(revision, values, V2);
    const result = renderAiPromptRevision(revision, values, EXPERIMENT);
    const policy = resolveAiImageEditPromptRendering(revision, V2)!.safetyPolicy;
    expect(result.resolvedPrompt.startsWith('操作要求：\n' + userPrompt + '\n\n' + policy)).toBe(true);
    expect(result.resolvedPrompt).toContain(values.userNegativePrompt);
    expect(result.resolvedPrompt.split('\n').sort()).toEqual(baseline.resolvedPrompt.split('\n').sort());
  });

  it.each([PREVIEW, EXPERIMENT])('enforces the complete Unicode limit for %s', profile => {
    const base = renderAiPromptRevision(revision, { userPrompt: '', userNegativePrompt: 'N' }, profile);
    const value = '😀'.repeat(800 - Array.from(base.resolvedPrompt).length);
    const exact = renderAiPromptRevision(revision, { userPrompt: value, userNegativePrompt: 'N' }, profile);
    expect(Array.from(exact.resolvedPrompt)).toHaveLength(800);
    expect(exact.resolvedPrompt.startsWith('操作要求：\n' + value)).toBe(true);
    expect(() => renderAiPromptRevision(revision, { userPrompt: value + '中', userNegativePrompt: 'N' }, profile))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
    for (const invalid of ['\ud800', '\udc00', 'text\u0000suffix']) {
      expect(() => renderAiPromptRevision(revision, { userPrompt: invalid, userNegativePrompt: '' }, profile))
        .toThrowError(expect.objectContaining({ code: 'INVALID_PROMPT_PROFILE_INPUT' }));
    }
  });

  it.each([PREVIEW, EXPERIMENT])('refuses custom templates rather than rearranging unknown instructions: %s', profile => {
    const custom = { ...revision, promptTemplate: '自定义结构：{{user_prompt}}' };
    expect(() => renderAiPromptRevision(custom, variables, profile))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PROMPT_TEMPLATE_FOR_PROFILE' }));
    expect(() => renderAiPromptRevision({ ...revision, negativePromptTemplate: '{{user_negative_prompt}}' }, variables, profile))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PROMPT_TEMPLATE_FOR_PROFILE' }));
  });

  it.each([PREVIEW, EXPERIMENT])('does not expose the INPAINT-only profile to FULL_EDIT: %s', profile => {
    expect(() => renderAiPromptRevision({ ...revision, templateKey: 'full-image-edit.base',
      promptTemplate: DEFAULT_FULL_IMAGE_EDIT_TEMPLATE }, variables, profile))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_PROMPT_RENDER_PROFILE' }));
  });

  it.each([PREVIEW, EXPERIMENT])('keeps hosted frozen to v1, including consistent new snapshots: %s', async profile => {
    const value = await trial(profile);
    expect(() => assertWanxHostedEditPrompt({ provider: value.request.provider, model: value.request.model,
      operation: 'INPAINT', width: 1024, height: 1024, ...value.inpaint.frozenPrompt }))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    expect(resolveAiImageEditProviderContract(value.request.provider, value.request.model)?.renderingProfile).toBe(V1);
    if (profile === PREVIEW) {
      expect(() => parseAiImageWanxTrialRequest(value.request, expected))
        .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    } else {
      expect(() => parseAiImageWanxTrialRequest(value.request, expected)).not.toThrow();
    }
  });

  it.each(['order', 'policy', 'hash', 'scope', 'extra authority', 'text'])('refuses tampered experimental %s', async field => {
    const value = await trial(EXPERIMENT);
    const contract = value.inpaint.frozenPrompt.templateSnapshot.renderingContract as Record<string, unknown>;
    if (field === 'order') contract.segmentOrder = ['safety-policy', 'operator-direction', 'template-instructions', 'negative-constraints'];
    if (field === 'policy') contract.policySha256 = '0'.repeat(64);
    if (field === 'hash') contract.contractHash = '0'.repeat(64);
    if (field === 'scope') contract.executionScope = 'ERP_HOSTED';
    if (field === 'extra authority') contract.canSubmit = true;
    if (field === 'text') value.inpaint.frozenPrompt.resolvedPrompt += 'changed';
    expect(() => parseAiImageWanxTrialRequest(value.request, expected))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
  });
});
