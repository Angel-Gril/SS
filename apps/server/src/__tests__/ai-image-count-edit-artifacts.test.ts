import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { storeAiImageEditRaw, storeAiImageEditFinal, type AiImageEditInputs } from '../services/ai-image-edit-artifacts.js';
import { validateAiImageEditCandidate, AI_IMAGE_EDIT_MASK_SEMANTICS } from '../services/ai-image-compositor.js';
import type { AiImageJobRecord } from '../services/ai-image-jobs.js';

describe('count ordinary edit artifacts', () => {
  it.each(['FULL_EDIT', 'INPAINT'] as const)('records the true Provider canvas and a separate %s candidate with the requested canvas', async operation => {
    const width = 900, height = 1200;
    const source = await sharp({ create: { width, height, channels: 4, background: '#204080' } }).png().toBuffer();
    const raw = await sharp({ create: { width: 896, height, channels: 4, background: '#d9aa20' } }).png().toBuffer();
    const maskPixels = Buffer.alloc(width * height * 4, 255);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const value = x < 100 && y < 100 ? 255 : 0;
      const offset = (y * width + x) * 4;
      maskPixels[offset] = maskPixels[offset + 1] = maskPixels[offset + 2] = value;
    }
    const mask = await sharp(maskPixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const job = { id: 'count-artifact-job', ownerUserId: 'count-artifact-owner', provider: 'custom',
      model: 'gpt-image-2-count', operation, width, height } as AiImageJobRecord;
    const uploaded = new Map<string, Buffer>();
    const upload = async (buffer: Buffer, filename: string) => {
      uploaded.set(filename, buffer); return { url: `/fixture/${filename}`, backend: 'local', key: filename };
    };
    const diagnostics = await validateAiImageEditCandidate({ buffer: raw, expectedWidth: 896, expectedHeight: height });
    const original = await storeAiImageEditRaw(job, raw, upload, diagnostics);
    expect(original).toMatchObject({ width: 896, height: 1200, kind: 'AI_PROVIDER_OUTPUT' });
    expect(uploaded.get(original.storageKey!)).toEqual(raw);
    const inputs = { sourceBuffer: source, sourceMimeType: 'image/png', maskBuffer: operation === 'INPAINT' ? mask : null } as AiImageEditInputs;
    const final = await storeAiImageEditFinal(job, inputs, raw, 'count-original-output', upload);
    expect(final).toMatchObject({ width: 900, height: 1200, kind: 'AI_GENERATED',
      metadata: { providerOutputAssetId: 'count-original-output', normalizerVersion: 'gpt2-count-ordinary-output-normalizer/v1',
        providerOutput: { width: 896, height: 1200 } } });
    const bytes = uploaded.get(final.storageKey!)!;
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 900, height: 1200 });
    if (operation === 'INPAINT') {
      expect(final.metadata).toMatchObject({ maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS });
      const actual = await sharp(bytes).ensureAlpha().raw().toBuffer();
      const originalPixels = await sharp(source).ensureAlpha().raw().toBuffer();
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (x < 100 && y < 100) continue;
        const offset = (y * width + x) * 4;
        if (!actual.subarray(offset, offset + 4).equals(originalPixels.subarray(offset, offset + 4))) throw new Error('Unmasked pixels changed');
      }
    }
  });
});
