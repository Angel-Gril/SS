export const EXTENSION_PUBLISH_RETURN_TO = '/collect?extensionAuth=publish';

const LISTING_LOGS_PATH = '/listing-logs';
const LISTING_JOB_ID_MAX_LENGTH = 200;
const RETURN_TO_MAX_LENGTH = 512;

export function normalizeListingLogJobId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized === value
    && normalized.length > 0
    && normalized.length <= LISTING_JOB_ID_MAX_LENGTH
    && /^[A-Za-z0-9_-]+$/u.test(normalized)
    ? normalized
    : null;
}

export function normalizeLoginReturnTo(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > RETURN_TO_MAX_LENGTH
    || value.normalize('NFKC').trim() !== value) return '';
  if (value === EXTENSION_PUBLISH_RETURN_TO) return value;
  if (!value.startsWith(`${LISTING_LOGS_PATH}?`) || value.includes('#')) return '';

  let target: URL;
  try {
    target = new URL(value, 'https://return-to.invalid');
  } catch {
    return '';
  }
  if (target.origin !== 'https://return-to.invalid'
    || target.pathname !== LISTING_LOGS_PATH
    || target.searchParams.size !== 1
    || target.searchParams.getAll('jobId').length !== 1) return '';

  const jobId = normalizeListingLogJobId(target.searchParams.get('jobId'));
  if (!jobId) return '';
  const canonical = `${LISTING_LOGS_PATH}?jobId=${encodeURIComponent(jobId)}`;
  return value === canonical ? canonical : '';
}
