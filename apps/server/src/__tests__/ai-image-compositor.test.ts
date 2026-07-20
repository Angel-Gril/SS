import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  AI_IMAGE_EDIT_MASK_SEMANTICS,
  AI_IMAGE_COMPOSITOR_YIELD_INTERVAL,
  AiImageCompositorError,
  composeAiImageInpaint,
  validateAiImageEditCandidate,
  validateAiImageEditMask,
} from '../services/ai-image-compositor.js';

async function rgbaPng(width: number, height: number, pixels: number[]) {
  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
}

async function maskPng(width: number, height: number, values: number[]) {
  const rgba = values.flatMap((value) => [value, value, value, 255]);
  return rgbaPng(width, height, rgba);
}

async function decodedRgba(buffer: Buffer) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...decoded.data];
}

describe('AI image inpaint compositor', () => {
  it('copies every unmasked pixel from the immutable source and every masked pixel from the raw candidate', async () => {
    const source = await rgbaPng(2, 2, [
      10, 20, 30, 255, 40, 50, 60, 255,
      70, 80, 90, 255, 100, 110, 120, 255,
    ]);
    const candidate = await rgbaPng(2, 2, [
      210, 220, 230, 255, 200, 190, 180, 255,
      170, 160, 150, 255, 140, 130, 120, 255,
    ]);
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);

    const result = await composeAiImageInpaint({
      sourceBuffer: source,
      rawCandidateBuffer: candidate,
      maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    });

    expect(result).toMatchObject({
      mimeType: 'image/png',
      width: 2,
      height: 2,
      diagnostics: {
        editPixelCount: 2,
        preservedPixelCount: 2,
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      },
    });
    expect(await decodedRgba(result.buffer)).toEqual([
      10, 20, 30, 255, 200, 190, 180, 255,
      70, 80, 90, 255, 140, 130, 120, 255,
    ]);
  });

  it('accepts an opaque grayscale same-size PNG mask and blends feathered pixels deterministically', async () => {
    const valid = await maskPng(2, 2, [0, 255, 0, 255]);
    await expect(validateAiImageEditMask({
      maskBuffer: valid,
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).resolves.toMatchObject({ editPixelCount: 2, preservedPixelCount: 2 });

    const wrongSize = await maskPng(1, 2, [0, 255]);
    await expect(validateAiImageEditMask({
      maskBuffer: wrongSize,
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).rejects.toMatchObject({ code: 'MASK_DIMENSIONS_MISMATCH' });

    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await rgbaPng(2, 2, new Array(16).fill(210));
    const softMask = await maskPng(2, 2, [0, 128, 0, 255]);
    await expect(validateAiImageEditMask({
      maskBuffer: softMask,
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).resolves.toMatchObject({
      editPixelCount: 2,
      preservedPixelCount: 2,
      featheredPixelCount: 1,
    });
    const feathered = await composeAiImageInpaint({
      sourceBuffer: source,
      rawCandidateBuffer: candidate,
      maskBuffer: softMask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    });
    expect(await decodedRgba(feathered.buffer)).toEqual([
      10, 10, 10, 10, 110, 110, 110, 110,
      10, 10, 10, 10, 210, 210, 210, 210,
    ]);

    for (const values of [[0, 0, 0, 0], [255, 255, 255, 255]]) {
      const degenerate = await maskPng(2, 2, values);
      await expect(validateAiImageEditMask({
        maskBuffer: degenerate,
        expectedWidth: 2,
        expectedHeight: 2,
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      })).rejects.toMatchObject({ code: 'MASK_EMPTY_OR_FULL' });
    }
  });

  it('rejects transparent masks, inverted semantics, malformed images and mismatched provider output', async () => {
    const transparentMask = await rgbaPng(2, 2, [
      0, 0, 0, 255, 255, 255, 255, 0,
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    await expect(validateAiImageEditMask({
      maskBuffer: transparentMask,
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).rejects.toMatchObject({ code: 'MASK_NOT_OPAQUE' });

    const validMask = await maskPng(2, 2, [0, 255, 0, 255]);
    await expect(validateAiImageEditMask({
      maskBuffer: validMask,
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: 'BLACK_EDIT_WHITE_PRESERVE_V1' as never,
    })).rejects.toMatchObject({ code: 'MASK_SEMANTICS_INVALID' });

    await expect(validateAiImageEditMask({
      maskBuffer: Buffer.from('not-an-image'),
      expectedWidth: 2,
      expectedHeight: 2,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).rejects.toBeInstanceOf(AiImageCompositorError);

    const source = await rgbaPng(2, 2, new Array(16).fill(20));
    const candidate = await rgbaPng(1, 2, new Array(8).fill(220));
    await expect(composeAiImageInpaint({
      sourceBuffer: source,
      rawCandidateBuffer: candidate,
      maskBuffer: validMask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    })).rejects.toMatchObject({ code: 'CANDIDATE_DIMENSIONS_MISMATCH' });
  });

  it('rejects unsupported decode formats and oversized encoded composites', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
    await expect(validateAiImageEditCandidate({
      buffer: svg,
      expectedWidth: 2,
      expectedHeight: 2,
    })).rejects.toMatchObject({ code: 'IMAGE_FORMAT_INVALID' });

    const source = await rgbaPng(2, 2, new Array(16).fill(10));
    const candidate = await rgbaPng(2, 2, new Array(16).fill(210));
    const mask = await maskPng(2, 2, [0, 255, 0, 255]);
    await expect(composeAiImageInpaint({
      sourceBuffer: source,
      rawCandidateBuffer: candidate,
      maskBuffer: mask,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      maxOutputBytes: 1,
    })).rejects.toMatchObject({ code: 'COMPOSITE_OUTPUT_LIMIT_EXCEEDED' });
  });

  it('yields during large mask and composite loops so worker heartbeats can run', async () => {
    const width = 256;
    const height = Math.ceil((AI_IMAGE_COMPOSITOR_YIELD_INTERVAL * 2) / width);
    const pixelCount = width * height;
    const source = await rgbaPng(width, height, new Array(pixelCount * 4).fill(10));
    const candidate = await rgbaPng(width, height, new Array(pixelCount * 4).fill(210));
    const values = new Array(pixelCount).fill(255);
    values[0] = 0;
    const mask = await maskPng(width, height, values);
    const setImmediateSpy = vi.spyOn(globalThis, 'setImmediate');
    let yieldCount = 0;
    try {
      await composeAiImageInpaint({
        sourceBuffer: source,
        rawCandidateBuffer: candidate,
        maskBuffer: mask,
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      });
      yieldCount = setImmediateSpy.mock.calls.length;
    } finally {
      setImmediateSpy.mockRestore();
    }

    expect(yieldCount).toBeGreaterThanOrEqual(4);
  });
});
