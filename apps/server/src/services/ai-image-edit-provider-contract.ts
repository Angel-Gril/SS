import { isDeepStrictEqual } from 'node:util';
import { AiImageJobError } from './ai-image-job-error.js';
import { canonicalAiImageProviderBaseUrl } from './ai-image-provider-runtime-contract.js';
import { isOpenAiCompatibleImageEditSizeSupported } from './ai-image-providers.js';
import { checksumAiPromptRevision, renderAiPromptRevision } from './ai-prompt-templates.js';
import { AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE, type AiPromptRenderingProfile } from './ai-image-edit-prompt-contract.js';
import { AI_IMAGE_WANX21_EDIT_MODEL, AI_IMAGE_WANX21_EDIT_PROFILE, normalizeAiImageWanx21EditApiBase } from './ai-image-wanx-edit-profile.js';

export function isWanxHostedEdit(provider: string | undefined, model: string | undefined): boolean {
  return provider === 'dashscope-wanx' && model === AI_IMAGE_WANX21_EDIT_MODEL;
}

export interface AiImageEditProviderContract {
  kind: 'wanx21' | 'openai-compatible';
  baseUrl: string;
  inputTransport: 'base64' | 'multipart';
  resultMode: 'async' | 'sync';
  renderingProfile?: AiPromptRenderingProfile;
}

export function resolveAiImageEditProviderContract(provider: string, model: string, baseUrl = ''): AiImageEditProviderContract | null {
  try {
    if (isWanxHostedEdit(provider, model)) {
      const canonicalBase = canonicalAiImageProviderBaseUrl(provider, baseUrl);
      // Keep runtime/approval identity identical to the URL actually used by the adapter.
      if (canonicalBase !== normalizeAiImageWanx21EditApiBase(canonicalBase)) return null;
      return { kind: 'wanx21', baseUrl: canonicalBase, inputTransport: 'base64', resultMode: 'async', renderingProfile: AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE };
    }
    if ((provider === 'openai-images' || provider === 'custom') && model.trim()) {
      return { kind: 'openai-compatible', baseUrl: canonicalAiImageProviderBaseUrl(provider, baseUrl), inputTransport: 'multipart', resultMode: 'sync' };
    }
  } catch {
    return null;
  }
  return null;
}

export function isAiImageEditProviderCanvasSupported(provider: string, model: string, width: number, height: number): boolean {
  if (provider === 'fake') return true;
  if (isWanxHostedEdit(provider, model)) {
    return width === AI_IMAGE_WANX21_EDIT_PROFILE.width && height === AI_IMAGE_WANX21_EDIT_PROFILE.height;
  }
  return (provider === 'openai-images' || provider === 'custom') && isOpenAiCompatibleImageEditSizeSupported(width, height);
}

export function assertWanxHostedEditPrompt(input: {
  provider?: string;
  model?: string;
  operation?: string;
  width: number;
  height: number;
  prompt: string;
  negativePrompt?: string | null;
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
}): void {
  if (!isWanxHostedEdit(input.provider, input.model)) return;
  if (!isAiImageEditProviderCanvasSupported(input.provider!, input.model!, input.width, input.height)) {
    throw new AiImageJobError('UNSUPPORTED_PROVIDER_EDIT_DIMENSIONS', 'Wanx hosted editing requires an unchanged 1024x1024 source and output canvas');
  }
  try {
    const templateKey = input.operation === 'FULL_EDIT' ? 'full-image-edit.base'
      : input.operation === 'INPAINT' ? 'inpaint.base' : null;
    const snapshot = input.templateSnapshot;
    if (!templateKey || input.templateKey !== templateKey || !snapshot || Array.isArray(snapshot)
      || typeof input.templateReleaseId !== 'string' || !input.templateReleaseId.trim()
      || snapshot.templateKey !== templateKey || snapshot.releaseId !== input.templateReleaseId
      || snapshot.checksum !== input.templateChecksum
      || typeof snapshot.revisionId !== 'string' || !snapshot.revisionId.trim()
      || !Number.isSafeInteger(snapshot.sequence) || Number(snapshot.sequence) < 1
      || snapshot.variableSchemaVersion !== 1 || snapshot.outputMode !== 'media_candidate'
      || typeof snapshot.promptTemplate !== 'string' || typeof snapshot.negativePromptTemplate !== 'string'
      || typeof input.prompt !== 'string' || !input.prompt.trim()
      || (input.negativePrompt != null && typeof input.negativePrompt !== 'string')) {
      throw new Error('Invalid frozen prompt binding');
    }
    const revision = { templateKey, promptTemplate: snapshot.promptTemplate, negativePromptTemplate: snapshot.negativePromptTemplate };
    const rendered = renderAiPromptRevision(revision, {
      userPrompt: input.prompt.trim(), userNegativePrompt: (input.negativePrompt ?? '').trim(),
    }, AI_IMAGE_WANX21_EDIT_PROMPT_PROFILE);
    if (checksumAiPromptRevision(revision) !== input.templateChecksum
      || rendered.resolvedPrompt !== input.resolvedPrompt || rendered.resolvedNegativePrompt !== input.resolvedNegativePrompt
      || !isDeepStrictEqual(rendered.renderingContract, snapshot.renderingContract)) {
      throw new Error('Changed frozen prompt binding');
    }
  } catch {
    throw new AiImageJobError('FROZEN_PROMPT_MISMATCH', 'Wanx edit requires the exact frozen prompt rendering contract and text');
  }
}
