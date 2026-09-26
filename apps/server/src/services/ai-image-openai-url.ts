import { AiImageJobError } from './ai-image-job-error.js';

export const OFFICIAL_OPENAI_IMAGES_API_BASE = 'https://api.openai.com/v1';

function invalidProviderUrl(message: string): never {
  throw new AiImageJobError('INVALID_PROVIDER_URL', message);
}

function assertCanonicalDnsHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (
    !normalized
    || normalized.endsWith('.')
    || normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === 'metadata'
    || normalized === 'metadata.google.internal'
    || normalized.endsWith('.metadata.google.internal')
    || normalized === 'instance-data'
    || normalized.endsWith('.instance-data')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.local')
    || normalized.endsWith('.home.arpa')
    || normalized.includes(':')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)
    || !normalized.includes('.')
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(normalized)
  ) {
    invalidProviderUrl('OpenAI-compatible API base URL must use a canonical public DNS hostname');
  }
}

export function normalizeOpenAiImagesApiBase(baseUrl: string) {
  const raw = String(baseUrl || OFFICIAL_OPENAI_IMAGES_API_BASE).trim();
  const authorityAndPath = raw.slice('https://'.length);
  const pathOffset = authorityAndPath.indexOf('/');
  const authority = pathOffset < 0 ? authorityAndPath : authorityAndPath.slice(0, pathOffset);
  const inputPath = pathOffset < 0 ? '' : authorityAndPath.slice(pathOffset);
  if (
    !/^https:\/\/[^/]/iu.test(raw)
    || raw.includes('%')
    || raw.includes('\\')
    || raw.includes('?')
    || raw.includes('#')
    || authority.includes('@')
    || inputPath.includes('//')
    || inputPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    invalidProviderUrl('OpenAI-compatible API base URL must be canonical HTTPS');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalidProviderUrl('OpenAI-compatible API base URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    invalidProviderUrl(
      'OpenAI-compatible API base URL must not contain credentials, query, or fragment',
    );
  }
  assertCanonicalDnsHostname(parsed.hostname);
  const path = parsed.pathname.replace(/\/+$/, '');
  if (parsed.pathname.includes('%') || parsed.pathname.includes('\\') || parsed.pathname.includes('//')) {
    invalidProviderUrl('OpenAI-compatible API base URL path is ambiguous');
  }
  if (/\/images\/(?:generations|edits|tasks)(?:\/|$)/i.test(path)) {
    invalidProviderUrl(
      'OpenAI-compatible API base URL must not include an image endpoint path',
    );
  }
  if (/(?:^|\/)images?$/i.test(path)) {
    invalidProviderUrl(
      'OpenAI-compatible API base URL must stop before /image or /images; use the API root such as https://host/v1',
    );
  }
  const normalizedPath = /\/v1$/i.test(path) ? path : `${path}/v1`;
  if (normalizedPath.length > 240) {
    invalidProviderUrl('OpenAI-compatible API base URL path is too long');
  }
  return `${parsed.origin}${normalizedPath}`;
}

export function isOfficialOpenAiImagesApiBase(baseUrl: string): boolean {
  try {
    return normalizeOpenAiImagesApiBase(baseUrl) === OFFICIAL_OPENAI_IMAGES_API_BASE;
  } catch {
    return false;
  }
}
