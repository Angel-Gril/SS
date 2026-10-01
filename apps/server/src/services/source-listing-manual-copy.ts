export const SOURCE_LISTING_MANUAL_COPY_PROMPT_VERSION = 'manual-copy-editor/v1';
export const SOURCE_LISTING_MANUAL_COPY_TITLE_MAX_LENGTH = 500;
export const SOURCE_LISTING_MANUAL_COPY_DESCRIPTION_MAX_LENGTH = 10_000;

export class SourceListingManualCopyError extends Error {
  readonly code = 'OZON_LISTING_DRAFT_INPUT_INVALID';
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'SourceListingManualCopyError'; }
}
export function normalizeSourceListingManualCopy(input: { titleRu?: string | null; descriptionRu?: string | null }) {
  const fields = [
    ...(Object.prototype.hasOwnProperty.call(input, 'titleRu') ? ['title' as const] : []),
    ...(Object.prototype.hasOwnProperty.call(input, 'descriptionRu') ? ['description' as const] : []),
  ];
  if (!fields.length) throw new SourceListingManualCopyError('A manual title or description is required');
  let titleRu: string | undefined;
  let descriptionRu: string | null | undefined;
  if (fields.includes('title')) {
    if (typeof input.titleRu !== 'string') throw new SourceListingManualCopyError('A manual publish title must be Russian text');
    titleRu = input.titleRu.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!titleRu || titleRu.length > SOURCE_LISTING_MANUAL_COPY_TITLE_MAX_LENGTH
      || !/[А-Яа-яЁё]/u.test(titleRu) || /\p{Script=Han}/u.test(titleRu)) {
      throw new SourceListingManualCopyError('A manual title requires Russian text, no Chinese characters, and at most 500 characters');
    }
  }
  if (fields.includes('description')) {
    if (input.descriptionRu === null) descriptionRu = null;
    else {
      if (typeof input.descriptionRu !== 'string') throw new SourceListingManualCopyError('A manual description must be text or null');
      descriptionRu = input.descriptionRu.normalize('NFKC').trim();
      if (!descriptionRu || descriptionRu.length > SOURCE_LISTING_MANUAL_COPY_DESCRIPTION_MAX_LENGTH
        || /\p{Script=Han}/u.test(descriptionRu)) throw new SourceListingManualCopyError('A manual description cannot contain Chinese characters and must contain at most 10000 characters');
    }
  }
  return { fields, ...(titleRu === undefined ? {} : { titleRu }),
    ...(descriptionRu === undefined ? {} : { descriptionRu }) };
}
