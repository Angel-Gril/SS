import { createHash } from 'node:crypto';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Binding hashes describe the complete authorized catalog. A plan may freeze a
// smaller reference set, sealed by the planning owner to that original catalog.
export function frozenHostedPlanReferenceSelectionMatches(
  inputSnapshot: unknown,
  authorityCandidateMediaHash: string,
  expectedSelectedMediaHash?: string,
): boolean {
  const snapshot = record(inputSnapshot), candidates = snapshot?.candidates;
  if (!snapshot || !Array.isArray(candidates) || candidates.length < 1 || candidates.length > 25
    || !/^[a-f0-9]{64}$/u.test(authorityCandidateMediaHash)) return false;
  const ids = candidates.map(value => record(value)?.id);
  if (!ids.every((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 500
    && id === id.trim() && Array.from(id).every(character => character.charCodeAt(0) >= 32
      && character.charCodeAt(0) !== 127)) || new Set(ids).size !== ids.length) return false;
  const selectedHash = createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');
  if (expectedSelectedMediaHash !== undefined && selectedHash !== expectedSelectedMediaHash) return false;
  if (!Object.hasOwn(snapshot, 'referenceSelection')) return selectedHash === authorityCandidateMediaHash;
  const selection = record(snapshot.referenceSelection);
  return Boolean(selection && Object.keys(selection).length === 1
    && selection.authorityCandidateMediaHash === authorityCandidateMediaHash);
}
