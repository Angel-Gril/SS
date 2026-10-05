import type { SourceListingAttributeSuggestionReference } from './source-listing-workflow-attributes.js';

export class SourceListingAttributeSuggestionChangeError extends Error {
  readonly code = 'OZON_LISTING_DRAFT_INPUT_INVALID';
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'SourceListingAttributeSuggestionChangeError'; }
}
function fail(): never { throw new SourceListingAttributeSuggestionChangeError('Attribute suggestions require current unique frozen references'); }
/** The command accepts references only; values and provenance remain owned by the attribute service. */
export function normalizeSourceListingAttributeSuggestionChanges(value: unknown, schemaRevision: string): SourceListingAttributeSuggestionReference[] {
  if (typeof schemaRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(schemaRevision)
    || !Array.isArray(value) || value.length < 1 || value.length > 500) fail();
  const seen = new Set<number>();
  return value.map((raw): SourceListingAttributeSuggestionReference => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
    const candidate = raw as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => !['attributeId', 'candidateId', 'candidateHash', 'schemaRevision'].includes(key))
      || typeof candidate.attributeId !== 'number' || !Number.isSafeInteger(candidate.attributeId) || candidate.attributeId < 1
      || seen.has(candidate.attributeId) || typeof candidate.candidateId !== 'string' || !candidate.candidateId
      || candidate.candidateId !== candidate.candidateId.normalize('NFKC').trim() || candidate.candidateId.length > 200
      || typeof candidate.candidateHash !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.candidateHash)
      || candidate.schemaRevision !== schemaRevision) fail();
    seen.add(candidate.attributeId);
    return { attributeId: candidate.attributeId, candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash, schemaRevision };
  }).sort((left, right) => left.attributeId - right.attributeId);
}
