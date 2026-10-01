const LONG_TEXT_VALUE_KINDS = new Set([
  'textarea',
  'multiline_text',
  'description',
  'rich_content',
  'text_area',
  'rich_text',
  'richtext',
]);

export const MAX_MULTI_SELECT_OPTIONS = 100;
export function getMultiSelectLimit(field) {
  return Number.isSafeInteger(field?.maxValues) && field.maxValues > 0 && field.maxValues <= MAX_MULTI_SELECT_OPTIONS
    ? field.maxValues : MAX_MULTI_SELECT_OPTIONS;
}

export function parseCollectionFieldValue(value, maximum = MAX_MULTI_SELECT_OPTIONS) {
  function bounded(items) {
    const result = items.map((item) => String(item ?? '').trim()).filter(Boolean);
    if (result.length > maximum) throw new RangeError('多选值超过官方字段的数量上限');
    return result;
  }
  if (Array.isArray(value)) {
    return bounded(value);
  }

  const text = String(value || '').trim();
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return bounded(parsed);
      }
    } catch (error) {
      if (error instanceof RangeError) throw error;
      // Fall back to delimiter splitting below.
    }
  }

  return bounded(text.split(/[,，;；]/g));
}

export function isLongTextField(field) {
  if (!field) return false;
  if (hasSelectOptions(field) || field.isCollection || field.allowMultipleValues) return false;

  const valueKind = String(field.valueKind || '').toLowerCase();
  return valueKind !== 'select' && LONG_TEXT_VALUE_KINDS.has(valueKind);
}

export function shouldUseExpandableTextPreviewCell(field, value) {
  if (!field || isLongTextField(field)) return false;
  if (String(field.valueKind || '').toLowerCase() !== 'text') return false;
  if (field.allowMultipleValues || field.isCollection) return false;
  if (hasSelectOptions(field)) return false;

  const raw = String(value || '');
  const normalized = normalizePreviewText(value);
  return raw.includes('\n') || normalized.length > 20;
}

export function getFieldColumnWidth(field) {
  if (isLongTextField(field)) return 240;
  if (field?.options?.length) return 150;
  if (field?.valueKind === 'number') return 140;
  return 150;
}

export function getLongTextPreview(value) {
  const text = normalizePreviewText(value);
  if (!text) return '—';
  return text.length <= 46 ? text : `${text.slice(0, 46)}…`;
}

export function getExpandableTextTooltip(value) {
  return normalizePreviewText(value) || '—';
}

function normalizePreviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasSelectOptions(field) {
  return Array.isArray(field?.options) && field.options.length > 0;
}
