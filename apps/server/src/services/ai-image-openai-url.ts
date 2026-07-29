import { AiImageJobError } from './ai-image-job-error.js';

export const OFFICIAL_OPENAI_IMAGES_API_BASE = 'https://api.openai.com/v1';

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function normalizeOpenAiImagesApiBase(baseUrl: string) {
  const raw = withoutTrailingSlash(baseUrl || OFFICIAL_OPENAI_IMAGES_API_BASE);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AiImageJobError('INVALID_PROVIDER_URL', 'OpenAI-compatible API base URL is invalid');
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new AiImageJobError(
      'INVALID_PROVIDER_URL',
      'OpenAI-compatible API base URL must not contain credentials, query, or fragment',
    );
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (/\/images\/(?:generations|edits|tasks)(?:\/|$)/i.test(path)) {
    throw new AiImageJobError(
      'INVALID_PROVIDER_URL',
      'OpenAI-compatible API base URL must not include an image endpoint path',
    );
  }
  parsed.pathname = /\/v1$/i.test(path) ? path : `${path}/v1`;
  return withoutTrailingSlash(parsed.toString());
}

export function isOfficialOpenAiImagesApiBase(baseUrl: string): boolean {
  try {
    return normalizeOpenAiImagesApiBase(baseUrl) === OFFICIAL_OPENAI_IMAGES_API_BASE;
  } catch {
    return false;
  }
}
