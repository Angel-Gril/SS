import { lookup } from 'node:dns/promises';
import { fetch as undiciFetch } from 'undici';
import { createPinnedPublicDispatcher, normalizePublicSourceUrl, resolvePublicSourceAddresses } from './source-public-image-download.js';

/** The URL is returned by authenticated Seller API; download anonymously with pinned public DNS. */
export async function downloadOzonLabel(rawUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const url = normalizePublicSourceUrl(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Ozon file URL requires HTTPS');
  const records = await resolvePublicSourceAddresses(url.hostname, host => lookup(host, { all: true, verbatim: true }));
  const dispatcher = createPinnedPublicDispatcher(records);
  const maxBytes = 50 * 1024 * 1024;
  try {
    const response = await undiciFetch(url.href, { dispatcher, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { accept: 'application/pdf' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Ozon label download returned HTTP ${response.status}`); }
    const type = String(response.headers.get('content-type') || '').split(';')[0]?.trim();
    if (!['application/pdf', 'application/octet-stream'].includes(type || '')) { await response.body?.cancel(); throw new Error('Ozon label is not a PDF'); }
    if (Number(response.headers.get('content-length') || 0) > maxBytes) { await response.body?.cancel(); throw new Error('Ozon label exceeds size limit'); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Ozon label body is missing');
    const chunks: Buffer[] = []; let length = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Ozon label exceeds size limit'); }
      chunks.push(Buffer.from(part.value));
    }
    const buffer = Buffer.concat(chunks, length);
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('Ozon label PDF signature is invalid');
    return { buffer, contentType: 'application/pdf' };
  } finally { await dispatcher.close().catch(() => undefined); }
}
