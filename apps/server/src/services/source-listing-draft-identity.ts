export interface SourceListingDraftIdentityRef {
  supplyGoodsId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
  skuKey: string;
}

export interface SourceListingPreparedDraftIdentity {
  supplyGoodsId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
  selectedSkuKeys: string[];
}

export type SourceListingDraftIdentityErrorCode =
  | 'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED'
  | 'SOURCE_LISTING_DRAFT_IDENTITY_COUNT_MISMATCH'
  | 'SOURCE_LISTING_DRAFT_IDENTITY_UNKNOWN_GOODS'
  | 'SOURCE_LISTING_DRAFT_IDENTITY_MISMATCH'
  | 'SOURCE_LISTING_DRAFT_IDENTITY_SKU_MISMATCH';

export class SourceListingDraftIdentityError extends Error {
  constructor(
    readonly code: SourceListingDraftIdentityErrorCode,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = 'SourceListingDraftIdentityError';
  }
}

function exactId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200) {
    throw new SourceListingDraftIdentityError(
      'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED',
      `${field} is required`,
    );
  }
  return value;
}

function exactRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new SourceListingDraftIdentityError(
      'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED',
      `${field} is invalid`,
    );
  }
  return Number(value);
}

export function normalizeSourceListingDraftIdentityRefs(
  value: unknown,
): SourceListingDraftIdentityRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SourceListingDraftIdentityError(
      'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED',
      'draft identity references are required',
    );
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new SourceListingDraftIdentityError(
        'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED',
        `draft identity reference ${index} is invalid`,
      );
    }
    const row = item as Record<string, unknown>;
    return {
      supplyGoodsId: exactId(row.supplyGoodsId, `draftRefs[${index}].supplyGoodsId`),
      draftId: exactId(row.draftId, `draftRefs[${index}].draftId`),
      draftVersion: exactRevision(row.draftVersion, `draftRefs[${index}].draftVersion`),
      revision: exactRevision(row.revision, `draftRefs[${index}].revision`),
      skuKey: exactId(row.skuKey, `draftRefs[${index}].skuKey`),
    };
  });
}

export function assertSourceListingDraftIdentity(input: {
  refs: SourceListingDraftIdentityRef[];
  prepared: SourceListingPreparedDraftIdentity[];
}): void {
  if (input.refs.length !== input.prepared.length) {
    throw new SourceListingDraftIdentityError(
      'SOURCE_LISTING_DRAFT_IDENTITY_COUNT_MISMATCH',
      'draft identity references do not cover the prepared drafts',
    );
  }
  const preparedByGoods = new Map(input.prepared.map((draft) => [draft.supplyGoodsId, draft]));
  const seen = new Set<string>();
  for (const ref of input.refs) {
    if (seen.has(ref.supplyGoodsId)) {
      throw new SourceListingDraftIdentityError(
        'SOURCE_LISTING_DRAFT_IDENTITY_COUNT_MISMATCH',
        'duplicate supply goods identity reference',
      );
    }
    seen.add(ref.supplyGoodsId);
    const draft = preparedByGoods.get(ref.supplyGoodsId);
    if (!draft) {
      throw new SourceListingDraftIdentityError(
        'SOURCE_LISTING_DRAFT_IDENTITY_UNKNOWN_GOODS',
        'draft identity references unknown supply goods',
      );
    }
    if (draft.draftId !== ref.draftId
      || draft.draftVersion !== ref.draftVersion
      || draft.revision !== ref.revision) {
      throw new SourceListingDraftIdentityError(
        'SOURCE_LISTING_DRAFT_IDENTITY_MISMATCH',
        'draft identity is stale or does not match the server snapshot',
      );
    }
    if (!draft.selectedSkuKeys.includes(ref.skuKey)) {
      throw new SourceListingDraftIdentityError(
        'SOURCE_LISTING_DRAFT_IDENTITY_SKU_MISMATCH',
        'SKU is not part of the reviewed draft selection',
      );
    }
  }
}
