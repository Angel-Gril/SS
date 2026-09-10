import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { InMemoryAiPromptTemplateStore } from '../../services/ai-prompt-templates.js';
import { AiPromptTemplateRegistryService } from '../../services/ai-prompt-template-registry.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE } from '../../services/ai-image-edit-prompt-contract.js';

export const trialDigest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
export const trialJson = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const trialAccountDigest = trialDigest('synthetic-wanx-trial-account');
export const trialCredentialRevision = 'synthetic-wanx-key-r1';

export async function makeWanxTrialInput(evidenceRoot: string, adapterRevision: string, roundId = 'fixture-round-001') {
  const inputs = join(evidenceRoot, 'inputs');
  await mkdir(inputs, { recursive: true, mode: 0o700 });
  const sourceBytes = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: '#eceff1' },
  }).png().toBuffer();
  const maskPixels = Buffer.alloc(1024 * 1024 * 4, 255);
  for (let y = 0; y < 160; y += 1) {
    for (let x = 0; x < 160; x += 1) maskPixels[(y * 1024 + x) * 4 + 3] = 0;
  }
  const maskBytes = await sharp(maskPixels, { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
  await writeFile(join(inputs, 'source.png'), sourceBytes, { mode: 0o600 });
  await writeFile(join(inputs, 'mask.png'), maskBytes, { mode: 0o600 });

  // A real registry creates these synthetic releases. The preparation must still
  // distinguish local consistency from proof of an actual ERP release or workflow.
  const registry = new AiPromptTemplateRegistryService(new InMemoryAiPromptTemplateStore(), {
    getLegacyPrompt: async () => 'Synthetic legacy prompt',
  });
  const operations = await Promise.all((['FULL_EDIT', 'INPAINT'] as const).map(async (operation) => {
    const templateKey = operation === 'FULL_EDIT' ? 'full-image-edit.base' : 'inpaint.base';
    const prompt = operation === 'FULL_EDIT'
      ? '仅将背景改为浅灰色。\n保留数据字面值 $& 和 {{user_prompt}}。'
      : '仅将选区背景改为浅蓝色，保留选区外的一切。';
    const negativePrompt = '不要添加文字、配件或新声明。';
    const frozen = await registry.resolveTemplate({
      templateKey, renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE,
      variables: { userPrompt: prompt, userNegativePrompt: negativePrompt },
    });
    return {
      operationId: `${roundId}-${operation.toLowerCase()}`,
      operation,
      source: { path: 'inputs/source.png', sha256: trialDigest(sourceBytes) },
      mask: operation === 'INPAINT' ? { path: 'inputs/mask.png', sha256: trialDigest(maskBytes) } : null,
      frozenPrompt: {
        prompt, negativePrompt,
        resolvedPrompt: frozen.resolvedPrompt, resolvedNegativePrompt: frozen.resolvedNegativePrompt,
        templateKey, templateReleaseId: frozen.release.id,
        templateChecksum: frozen.checksum, templateSnapshot: frozen.snapshot,
      },
      quotedCost: { currency: 'CNY', amount: 14, scale: 2 },
      maximumCost: { currency: 'CNY', amount: 25, scale: 2 },
    };
  }));
  return {
    schemaVersion: 1,
    kind: 'WANX_EDIT_TRIAL_INPUT_V1',
    roundId,
    adapterRevision,
    provider: 'dashscope-wanx',
    model: 'wanx2.1-imageedit',
    apiBase: 'https://dashscope.aliyuncs.com/api/v1',
    providerAccountUidSha256: trialAccountDigest,
    credentialRevision: trialCredentialRevision,
    maximumCost: { currency: 'CNY', amount: 1, scale: 0 },
    operations,
  };
}
