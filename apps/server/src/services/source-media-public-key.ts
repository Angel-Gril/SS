import { createHash } from 'node:crypto';

// Source owners retain the original captured key. Public callers use the same
// opaque alias for structured media keys that include an observed source URL.
export function publicSourceMediaKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500
    || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null;
  if (!/(?:https?|blob|data|file|ftp):/iu.test(value)) return value;
  return /^media:[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+\|\d+\|https:\/\/[^\s|]+$/u.test(value)
    ? `media-key-sha256:${createHash('sha256').update(value).digest('hex')}` : null;
}
