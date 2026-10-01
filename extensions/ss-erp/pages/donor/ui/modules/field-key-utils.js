export function normalizeFieldLookupKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\[\]\(\)\uff08\uff09{}]/g, '')
    .replace(/[\s*_"'`|\\/.,;:!?\-\u3001\uff0c\u3002\uff1b\uff1a]+/g, '');
}
