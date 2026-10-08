import { AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE } from './ai-image-xiaoyi-provider.js';
import { AI_IMAGE_GPT2_COUNT_ORDINARY_EDIT_REQUEST_PROFILE, AI_IMAGE_GPT2_COUNT_ORDINARY_MULTIPART_DIALECT } from './ai-image-gpt2-count-contract.js';

export const AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE =
  'PACKY_GPT_IMAGE_2_SQUARE_EDIT_V1';
export const AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT =
  'PACKY_GPT_IMAGE_2_V1';
export const AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT =
  'OPENAI_COMPATIBLE_DEFAULT_V1';
export const AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT =
  'XIAOYI_GPT_IMAGE_2_MINIMAL_V2';
export const AI_IMAGE_DONOR_GPT2_MULTIPART_DIALECT = 'DONOR_GPT_IMAGE_2_PORTRAIT_V1';

export type AiImageEditMultipartDialect =
  | typeof AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT
  | typeof AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT
  | typeof AI_IMAGE_DONOR_GPT2_MULTIPART_DIALECT
  | typeof AI_IMAGE_GPT2_COUNT_ORDINARY_MULTIPART_DIALECT
  | typeof AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT;

export const AI_IMAGE_PACKY_EDIT_PROFILE = Object.freeze({
  apiBase: 'https://www.packyapi.ai/v1',
  endpoint: 'https://www.packyapi.ai/v1/images/edits',
  expectedHost: 'www.packyapi.ai',
  model: 'gpt-image-2',
  width: 1024,
  height: 1024,
  expectedMimeType: 'image/png',
  multipartFields: Object.freeze({
    quality: 'high',
    output_format: 'png',
    response_format: 'url',
  }),
});

const AI_IMAGE_PACKY_EDIT_OPERATIONS = new Set([
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);

export function isAiImagePackyEditProviderIdentity(input: {
  apiBase: string;
  endpoint: string;
  expectedHost: string;
  model: string;
  operation: string;
}) {
  return input.apiBase === AI_IMAGE_PACKY_EDIT_PROFILE.apiBase
    && input.endpoint === AI_IMAGE_PACKY_EDIT_PROFILE.endpoint
    && input.expectedHost === AI_IMAGE_PACKY_EDIT_PROFILE.expectedHost
    && input.model === AI_IMAGE_PACKY_EDIT_PROFILE.model
    && AI_IMAGE_PACKY_EDIT_OPERATIONS.has(input.operation);
}

export function aiImageEditMultipartFields(dialect: AiImageEditMultipartDialect) {
  return aiImageEditMultipartShape(dialect).fields;
}

export function aiImageEditMultipartShape(dialect: AiImageEditMultipartDialect) {
  switch (dialect) {
    case AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT:
      return Object.freeze({ includeN: true, includeSize: true, fields: null });
    case AI_IMAGE_DONOR_GPT2_MULTIPART_DIALECT:
    case AI_IMAGE_GPT2_COUNT_ORDINARY_MULTIPART_DIALECT:
      return Object.freeze({ includeN: true, includeSize: true,
        fields: Object.freeze({ quality: 'high', response_format: 'url' }) });
    case AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT:
      return Object.freeze({
        includeN: true,
        includeSize: true,
        fields: AI_IMAGE_PACKY_EDIT_PROFILE.multipartFields,
      });
    case AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT:
      return Object.freeze({ includeN: false, includeSize: false, fields: null });
    default:
      throw new Error('Unsupported AI image edit multipart dialect');
  }
}

export function aiImageEditMultipartDialectForRequestProfile(
  requestProfile: string,
): AiImageEditMultipartDialect {
  if (requestProfile === AI_IMAGE_PACKY_EDIT_REQUEST_PROFILE) {
    return AI_IMAGE_PACKY_EDIT_MULTIPART_DIALECT;
  }
  if (requestProfile === 'DONOR_GPT_IMAGE_2_PORTRAIT_EDIT_V1') return AI_IMAGE_DONOR_GPT2_MULTIPART_DIALECT;
  if (requestProfile === AI_IMAGE_GPT2_COUNT_ORDINARY_EDIT_REQUEST_PROFILE) return AI_IMAGE_GPT2_COUNT_ORDINARY_MULTIPART_DIALECT;
  if (requestProfile === AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE) {
    return AI_IMAGE_XIAOYI_MINIMAL_EDIT_MULTIPART_DIALECT;
  }
  return AI_IMAGE_DEFAULT_EDIT_MULTIPART_DIALECT;
}
