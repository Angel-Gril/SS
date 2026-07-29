import { AiImageJobError } from './ai-image-job-error.js';

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function normalizeOpenAiImagesApiBase(baseUrl: string) {
  const raw = withoutTrailingSlash(baseUrl || 'https://api.openai.com/v1');
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
