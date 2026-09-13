import { describe, expect, it } from 'vitest';
import { InMemoryAiPromptTemplateStore, renderAiPromptRevision } from '../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../services/ai-prompt-template-registry.js';
import { assertWanxHostedEditPrompt, resolveAiImageEditProviderContract } from '../services/ai-image-edit-provider-contract.js';
import { parseAiImageWanxTrialRequest } from '../services/ai-image-wanx-trial-preparation.js';
import type { AiPromptRenderingProfile } from '../services/ai-image-edit-prompt-contract.js';

const V1 = 'ai-image-wanx21-edit-prompt/v1' as const;
const PREVIEW = 'ai-image-wanx21-edit-prompt/scoped-print-preview-v2' as const;
const EXPERIMENT = 'ai-image-wanx21-edit-prompt/scoped-print-experimental-v2' as AiPromptRenderingProfile;
const variables = { userPrompt: '仅将背景改为浅蓝灰色，保留白杯。', userNegativePrompt: '不要新增文字。' };
const expected = {
  roundId: 'synthetic-experiment-round-01', adapterRevision: 'a'.repeat(40),
  providerAccountUidSha256: 'b'.repeat(64), credentialRevision: 'synthetic-experiment-key-r1',
};

async function fixture(selected: 'FULL_EDIT' | 'INPAINT') {
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Synthetic legacy prompt',
  });
  const operations = await Promise.all((['FULL_EDIT', 'INPAINT'] as const).map(async (operation) => {
    const templateKey = operation === 'FULL_EDIT' ? 'full-image-edit.base' : 'inpaint.base';
    const resolved = await registry.resolveTemplate({
      templateKey, variables, renderingProfile: operation === selected ? EXPERIMENT : V1,
    });
    return {
      operationId: `${expected.roundId}-${operation.toLowerCase()}`, operation,
      source: { path: 'inputs/source.png', sha256: 'c'.repeat(64) },
      mask: operation === 'INPAINT' ? { path: 'inputs/mask.png', sha256: 'd'.repeat(64) } : null,
      frozenPrompt: {
        prompt: variables.userPrompt, negativePrompt: variables.userNegativePrompt,
        resolvedPrompt: resolved.resolvedPrompt, resolvedNegativePrompt: resolved.resolvedNegativePrompt,
        templateKey, templateReleaseId: resolved.release.id,
        templateChecksum: resolved.checksum, templateSnapshot: resolved.snapshot,
      },
      quotedCost: { currency: 'CNY', amount: 14, scale: 2 },
      maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
    };
  }));
  const request = {
    schemaVersion: 1, kind: 'WANX_EDIT_TRIAL_INPUT_V1', ...expected,
    provider: 'dashscope-wanx', model: 'wanx2.1-imageedit', apiBase: 'https://dashscope.aliyuncs.com/api/v1',
    maximumCost: { currency: 'CNY', amount: 1, scale: 0 }, operations,
  };
  return { registry, request, selected: operations.find((operation) => operation.operation === selected)! };
}

describe('isolated Wanx scoped-print experiment', () => {
  it.each(['FULL_EDIT', 'INPAINT'] as const)('accepts a fully frozen experiment only at the %s trial boundary', async (operation) => {
    const value = await fixture(operation);
    const preview = await value.registry.resolveTemplate({
      templateKey: value.selected.frozenPrompt.templateKey, variables, renderingProfile: PREVIEW,
    });
    const experiment = value.selected.frozenPrompt;
    expect(experiment.resolvedPrompt).toBe(preview.resolvedPrompt);
    expect(experiment.resolvedNegativePrompt).toBe(preview.resolvedNegativePrompt);
    expect(experiment.templateSnapshot.renderingContract).toMatchObject({
      profile: EXPERIMENT, executionScope: 'ISOLATED_WANX_TRIAL',
      policySha256: preview.snapshot.renderingContract?.policySha256,
    });
    expect(experiment.templateSnapshot.renderingContract?.contractHash)
      .not.toBe(preview.snapshot.renderingContract?.contractHash);
    expect(parseAiImageWanxTrialRequest(value.request, expected).request.operations)
      .toEqual(value.request.operations);
    expect(() => assertWanxHostedEditPrompt({
      provider: value.request.provider, model: value.request.model, operation,
      width: 1024, height: 1024, ...experiment,
    })).toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
    expect(resolveAiImageEditProviderContract(value.request.provider, value.request.model, value.request.apiBase)?.renderingProfile).toBe(V1);
  });

  it.each([
    ['scope', (contract: Record<string, unknown>) => { contract.executionScope = 'ERP_HOSTED'; }],
    ['preview label', (contract: Record<string, unknown>) => { contract.profile = PREVIEW; }],
    ['unknown label', (contract: Record<string, unknown>) => { contract.profile = 'unreviewed-experiment'; }],
    ['policy digest', (contract: Record<string, unknown>) => { contract.policySha256 = '0'.repeat(64); }],
    ['contract digest', (contract: Record<string, unknown>) => { contract.contractHash = '0'.repeat(64); }],
    ['extra authority', (contract: Record<string, unknown>) => { contract.canSubmit = true; }],
  ])('rejects a changed experimental %s', async (_label, change) => {
    const value = await fixture('INPAINT');
    change(value.selected.frozenPrompt.templateSnapshot.renderingContract!);
    expect(() => parseAiImageWanxTrialRequest(value.request, expected))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
  });

  it.each(['prompt', 'resolvedPrompt', 'templateReleaseId'] as const)('rejects a changed experiment %s', async (field) => {
    const value = await fixture('FULL_EDIT');
    value.selected.frozenPrompt[field] += 'changed';
    expect(() => parseAiImageWanxTrialRequest(value.request, expected))
      .toThrowError(expect.objectContaining({ code: 'FROZEN_PROMPT_MISMATCH' }));
  });

  it('retains complete Unicode and 800-codepoint bounds in the experiment', () => {
    const revision = { templateKey: 'inpaint.base', promptTemplate: '{{user_prompt}}', negativePromptTemplate: '{{user_negative_prompt}}' };
    const baseline = renderAiPromptRevision(revision, { userPrompt: '', userNegativePrompt: 'N' }, EXPERIMENT);
    const text = '😀'.repeat(800 - Array.from(baseline.resolvedPrompt).length);
    expect(Array.from(renderAiPromptRevision(revision, { userPrompt: text, userNegativePrompt: 'N' }, EXPERIMENT).resolvedPrompt)).toHaveLength(800);
    expect(() => renderAiPromptRevision(revision, { userPrompt: `${text}中`, userNegativePrompt: 'N' }, EXPERIMENT))
      .toThrowError(expect.objectContaining({ code: 'PROMPT_PROFILE_LIMIT_EXCEEDED' }));
    expect(() => renderAiPromptRevision(revision, { userPrompt: '\ud800', userNegativePrompt: '' }, EXPERIMENT))
      .toThrowError(expect.objectContaining({ code: 'INVALID_PROMPT_PROFILE_INPUT' }));
  });
});
