'use client';

const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

function isSafeUrlAttribute(name: string, value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    return name === 'href' && url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function sanitizeHtml(input: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return '';
  }

  const doc = new DOMParser().parseFromString(input, 'text/html');
  doc.body.querySelectorAll('*').forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) {
      el.remove();
      return;
    }

    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }
      if (URL_ATTRS.has(name) && !isSafeUrlAttribute(name, value)) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
}
