import { AiImageJobError } from './ai-image-job-error.js';

export const AI_IMAGE_WANX21_EDIT_MODEL = 'wanx2.1-imageedit';
export const AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
export const AI_IMAGE_WANX21_EDIT_SUBMIT_PATH =
  '/services/aigc/image2image/image-synthesis';
export const AI_IMAGE_WANX21_EDIT_TASK_PATH = '/tasks';
export const AI_IMAGE_WANX21_EDIT_TRANSPORT =
  'DASHSCOPE_WANX21_ASYNC_JSON_DATA_URL_V1';

export const AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE =
  'DASHSCOPE_WANX21_IMAGE_TO_IMAGE_ASYNC_V1';
export const AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE =
  'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1';
export const AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE =
  'DASHSCOPE_WANX21_INPAINT_ASYNC_V1';

export type AiImageWanx21EditOperation = 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';
export type AiImageWanx21EditFunction = 'description_edit' | 'description_edit_with_mask';
export type AiImageWanx21EditRequestProfile =
  | typeof AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE
  | typeof AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE
  | typeof AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE;

export const AI_IMAGE_WANX21_EDIT_PROFILE = Object.freeze({
  model: AI_IMAGE_WANX21_EDIT_MODEL,
  width: 1024,
  height: 1024,
  n: 1 as const,
  maximumInputBytes: 10 * 1024 * 1024,
  maximumPromptCharacters: 800,
  maximumPollRequests: 120,
  maximumPollDurationMs: 180_000,
  expectedMimeType: null,
});

export function assertAiImageWanx21EditMedia(input: {
  source: { bytes: Buffer; width: number; height: number };
  mask?: { bytes: Buffer; width: number; height: number } | null;
}) {
  for (const [label, media] of [
    ['source', input.source] as const,
    ...(input.mask ? [['mask', input.mask] as const] : []),
  ]) {
    if (
      media.bytes.byteLength > AI_IMAGE_WANX21_EDIT_PROFILE.maximumInputBytes
      || media.width < 512
      || media.height < 512
      || media.width > 4096
      || media.height > 4096
    ) {
      throw new AiImageJobError(
        'INVALID_MEDIA_INPUT',
        `Wanx image-edit ${label} must be 512..4096 pixels and no larger than 10 MiB`,
      );
    }
  }
  if (input.mask && (
    input.mask.width !== input.source.width
    || input.mask.height !== input.source.height
  )) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'Wanx image-edit source and mask dimensions must match',
    );
  }
}

const PROFILE_OPERATIONS = Object.freeze({
  [AI_IMAGE_WANX21_IMAGE_TO_IMAGE_REQUEST_PROFILE]: 'IMAGE_TO_IMAGE',
  [AI_IMAGE_WANX21_FULL_EDIT_REQUEST_PROFILE]: 'FULL_EDIT',
  [AI_IMAGE_WANX21_INPAINT_REQUEST_PROFILE]: 'INPAINT',
} satisfies Record<AiImageWanx21EditRequestProfile, AiImageWanx21EditOperation>);

const WORKSPACE_HOST_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-beijing\.maas\.aliyuncs\.com$/u;
const DASHSCOPE_WANX_RESULT_HOST_PATTERN =
  /^dashscope(?:-[a-z0-9-]+)?\.oss-[a-z0-9-]+\.aliyuncs\.com$/u;

function invalidWanxBase(message: string): never {
  throw new AiImageJobError('INVALID_PROVIDER_URL', message);
}

export function normalizeAiImageWanx21EditApiBase(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    return invalidWanxBase('Wanx image-edit API base is invalid');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || (
      hostname !== 'dashscope.aliyuncs.com'
      && !WORKSPACE_HOST_PATTERN.test(hostname)
    )
  ) {
    return invalidWanxBase(
      'Wanx image-edit API base must use the reviewed Beijing HTTPS endpoint',
    );
  }
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  if (pathname && pathname !== '/api/v1') {
    return invalidWanxBase('Wanx image-edit API base path must be /api/v1');
  }
  return `https://${hostname}/api/v1`;
}

export function aiImageWanx21EditSubmitEndpoint(apiBase: string) {
  return `${normalizeAiImageWanx21EditApiBase(apiBase)}${AI_IMAGE_WANX21_EDIT_SUBMIT_PATH}`;
}

export function aiImageWanx21EditTaskEndpointBase(apiBase: string) {
  return `${normalizeAiImageWanx21EditApiBase(apiBase)}${AI_IMAGE_WANX21_EDIT_TASK_PATH}`;
}

export function normalizeAiImageWanx21EditResultUrl(rawUrl: string) {
  const source = String(rawUrl || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return invalidWanxBase('Wanx image-edit result URL is invalid');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol === 'http:'
    && !parsed.username
    && !parsed.password
    && !parsed.port
    && DASHSCOPE_WANX_RESULT_HOST_PATTERN.test(hostname)
  ) {
    parsed.protocol = 'https:';
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || source.includes('#')
    || parsed.hash
    || !DASHSCOPE_WANX_RESULT_HOST_PATTERN.test(hostname)
  ) {
    return invalidWanxBase('Wanx image-edit result URL must use the official DashScope OSS host');
  }
  return parsed.toString();
}

export function aiImageWanx21EditFunction(
  operation: AiImageWanx21EditOperation,
): AiImageWanx21EditFunction {
  return operation === 'INPAINT' ? 'description_edit_with_mask' : 'description_edit';
}

export function isAiImageWanx21EditRequestProfile(
  value: string,
): value is AiImageWanx21EditRequestProfile {
  return Object.hasOwn(PROFILE_OPERATIONS, value);
}

export function aiImageWanx21EditOperationForRequestProfile(
  value: string,
): AiImageWanx21EditOperation | null {
  return isAiImageWanx21EditRequestProfile(value) ? PROFILE_OPERATIONS[value] : null;
}

export function isAiImageWanx21EditProviderIdentity(input: {
  apiBase: string;
  endpoint: string;
  expectedHost: string;
  model: string;
  operation: string;
  requestProfile: string;
}) {
  let apiBase: string;
  try {
    apiBase = normalizeAiImageWanx21EditApiBase(input.apiBase);
  } catch {
    return false;
  }
  const expectedOperation = aiImageWanx21EditOperationForRequestProfile(input.requestProfile);
  return expectedOperation !== null
    && input.operation === expectedOperation
    && input.model === AI_IMAGE_WANX21_EDIT_MODEL
    && input.expectedHost.toLowerCase() === new URL(apiBase).hostname
    && input.endpoint === aiImageWanx21EditSubmitEndpoint(apiBase);
}

export function isAiImageWanx21EditEndpointIdentity(input: {
  apiBase: string;
  endpoint: string;
  expectedHost: string;
  model: string;
}) {
  let apiBase: string;
  try {
    apiBase = normalizeAiImageWanx21EditApiBase(input.apiBase);
  } catch {
    return false;
  }
  return input.model === AI_IMAGE_WANX21_EDIT_MODEL
    && input.expectedHost.toLowerCase() === new URL(apiBase).hostname
    && input.endpoint === aiImageWanx21EditSubmitEndpoint(apiBase);
}

export function isAiImageWanx21EditApiIdentity(input: {
  apiBase: string;
  expectedHost: string;
  model: string;
}) {
  let apiBase: string;
  try {
    apiBase = normalizeAiImageWanx21EditApiBase(input.apiBase);
  } catch {
    return false;
  }
  return input.model === AI_IMAGE_WANX21_EDIT_MODEL
    && apiBase === AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE
    && input.expectedHost.toLowerCase() === new URL(apiBase).hostname;
}
