export const AI_IMAGE_XIAOYI_API_BASE = 'https://image.xiaoyiapi.xyz/v1';
export const AI_IMAGE_XIAOYI_EXPECTED_HOST = 'image.xiaoyiapi.xyz';
export const AI_IMAGE_XIAOYI_BILLING_ORIGIN = 'https://xiaoyiapi.xyz';
export const AI_IMAGE_XIAOYI_BILLING_HOST = 'xiaoyiapi.xyz';
export const AI_IMAGE_XIAOYI_MODEL = 'gpt-image-2';
export const AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE =
  'XIAOYI_GPT_IMAGE_2_SQUARE_EDIT_V1';
export const AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE =
  'XIAOYI_GPT_IMAGE_2_MINIMAL_EDIT_V2';

export const AI_IMAGE_XIAOYI_EDIT_PROFILE = Object.freeze({
  apiBase: AI_IMAGE_XIAOYI_API_BASE,
  endpoint: `${AI_IMAGE_XIAOYI_API_BASE}/images/edits`,
  expectedHost: AI_IMAGE_XIAOYI_EXPECTED_HOST,
  model: AI_IMAGE_XIAOYI_MODEL,
  width: 1024,
  height: 1024,
  expectedMimeType: null,
});

const AI_IMAGE_XIAOYI_EDIT_OPERATIONS = new Set([
  'IMAGE_TO_IMAGE',
]);

export function isAiImageXiaoyiEditOperation(operation: string) {
  return AI_IMAGE_XIAOYI_EDIT_OPERATIONS.has(operation);
}

export function isAiImageXiaoyiEditRequestProfile(requestProfile: string) {
  return requestProfile === AI_IMAGE_XIAOYI_EDIT_REQUEST_PROFILE
    || requestProfile === AI_IMAGE_XIAOYI_MINIMAL_EDIT_REQUEST_PROFILE;
}

export function isAiImageXiaoyiEditProviderIdentity(input: {
  apiBase: string;
  endpoint: string;
  expectedHost: string;
  model: string;
}) {
  return input.apiBase === AI_IMAGE_XIAOYI_EDIT_PROFILE.apiBase
    && input.endpoint === AI_IMAGE_XIAOYI_EDIT_PROFILE.endpoint
    && input.expectedHost === AI_IMAGE_XIAOYI_EDIT_PROFILE.expectedHost
    && input.model === AI_IMAGE_XIAOYI_EDIT_PROFILE.model;
}
