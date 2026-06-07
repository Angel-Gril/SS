export function previewText(text?: string | null, maxLength = 160) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
