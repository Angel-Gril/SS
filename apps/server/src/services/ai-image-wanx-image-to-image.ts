import { AiImageJobError } from './ai-image-job-error.js';
import { AI_IMAGE_WANX21_EDIT_PROFILE, AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE } from './ai-image-wanx-edit-profile.js';
import type { AiImageJobRecord } from './ai-image-jobs.js';

export const WANX_IMAGE_TO_IMAGE_PROMPT_PROFILE = AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE;

/** Keep all user instructions; the reviewed adapter has no separate negative-prompt field. */
export function compileWanxImageToImagePrompt(input: { prompt: string; negativePrompt?: string | null }) {
  const prompt = input.prompt.trim();
  const negative = input.negativePrompt?.trim() || '';
  const resolvedPrompt = negative ? `${prompt}\n避免：${negative}` : prompt;
  if (!prompt || Array.from(resolvedPrompt).length > AI_IMAGE_WANX21_EDIT_PROFILE.maximumPromptCharacters) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Wanx reference generation requires 1..800 prompt characters including negative instructions');
  }
  return { resolvedPrompt, resolvedNegativePrompt: '' };
}

export function assertWanxImageToImageInput(input: {
  count: number; width: number; height: number; referenceCount: number;
  prompt: string; negativePrompt?: string | null;
}) {
  if (input.count !== 1 || input.referenceCount !== 1
    || input.width !== AI_IMAGE_WANX21_EDIT_PROFILE.width || input.height !== AI_IMAGE_WANX21_EDIT_PROFILE.height) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Wanx reference generation requires exactly one reference and one 1024x1024 output');
  }
  return compileWanxImageToImagePrompt(input);
}

export function assertFrozenWanxImageToImageJob(job: AiImageJobRecord) {
  const compiled = assertWanxImageToImageInput({
    count: job.requestedImageCount, width: job.width, height: job.height,
    referenceCount: job.inputAssets?.length || 0, prompt: job.prompt, negativePrompt: job.negativePrompt,
  });
  if (job.operation !== 'IMAGE_TO_IMAGE' || job.inputAssets?.[0]?.role !== 'REFERENCE'
    || job.resolvedPrompt !== compiled.resolvedPrompt || job.resolvedNegativePrompt !== compiled.resolvedNegativePrompt) {
    throw new AiImageJobError('FROZEN_INPUT_MISMATCH', 'Wanx reference instructions or input roles differ from the frozen request');
  }
}
