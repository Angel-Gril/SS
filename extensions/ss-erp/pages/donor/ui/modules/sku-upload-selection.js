export const SKU_UPLOAD_ENABLED_FIELD_KEY = '__skuUploadEnabled';

export function isDraftUploadEnabled(draft) {
  return draft?.uploadEnabled !== false;
}
export function setDraftUploadEnabled(draft, value) {
  if (draft && typeof draft === 'object') {
    draft.uploadEnabled = value !== false;
  }

  return draft;
}

export function filterUploadEnabledDrafts(drafts) {
  const source = Array.isArray(drafts) ? drafts : [];
  return source.filter((draft) => isDraftUploadEnabled(draft));
}

export function hasUploadEnabledDraft(drafts) {
  return filterUploadEnabledDrafts(drafts).length > 0;
}
