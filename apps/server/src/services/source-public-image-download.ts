import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_SOURCE_URL_LENGTH = 4096;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SourceAddressRecord {
  address: string;
  family: number;
}

export type SourceAddressResolver = (hostname: string) => Promise<SourceAddressRecord[]>;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | SourceAddressRecord[],
  family?: number,
) => void;

export type ValidatedPublicLookup = (
  hostname: string,
  options: { all?: boolean } | number,
  callback: LookupCallback,
) => void;

export interface PublicImageFetchInit {
  redirect: 'manual';
  signal: AbortSignal;
  headers: Record<string, string>;
  dispatcher?: Agent;
}

export type PublicImageFetch = (url: string, init: PublicImageFetchInit) => Promise<Response>;

export interface DownloadedPublicImage {
  sourceUrl: string;
  finalUrl: string;
  contentType: string;
  buffer: Buffer;
  redirectCount: number;
}

export interface DownloadPublicImageOptions {
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  lookup?: SourceAddressResolver;
  fetch?: PublicImageFetch;
  omitReferer?: boolean;
}

export function isPublicSourceAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(String(address || '').replace(/^\[|\]$/g, ''));
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function publicLookupError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`Source image host ${hostname} did not resolve exclusively to public addresses`), {
    code: 'SOURCE_IMAGE_NON_PUBLIC_ADDRESS',
  });
}

export async function resolvePublicSourceAddresses(
  hostname: string,
  resolver: SourceAddressResolver,
): Promise<SourceAddressRecord[]> {
  const records = await resolver(hostname);
  if (!records.length || records.some((record) => (
    !isPublicSourceAddress(record.address) || ![4, 6].includes(Number(record.family))
  ))) {
    throw publicLookupError(hostname);
  }
  const unique = new Map<string, SourceAddressRecord>();
  for (const record of records) {
    unique.set(`${record.family}:${record.address}`, {
      address: record.address,
      family: Number(record.family),
    });
  }
  return [...unique.values()];
}

function callbackWithRecords(
  records: SourceAddressRecord[],
  options: { all?: boolean } | number,
  callback: LookupCallback,
): void {
  if (typeof options === 'object' && options.all) {
    callback(null, records);
    return;
  }
  const preferredFamily = typeof options === 'number' ? options : 0;
  const selected = records.find((record) => !preferredFamily || record.family === preferredFamily)
    || records[0];
  if (!selected) {
    callback(Object.assign(new Error('No public address is available'), { code: 'ENOTFOUND' }));
    return;
  }
  callback(null, selected.address, selected.family);
}

export function createValidatedPublicLookup(
  resolver: SourceAddressResolver = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
): ValidatedPublicLookup {
  return (hostname, options, callback) => {
    void resolvePublicSourceAddresses(hostname, resolver)
      .then((records) => callbackWithRecords(records, options, callback))
      .catch((error) => callback(error as NodeJS.ErrnoException));
  };
}

export function createPinnedPublicDispatcher(records: SourceAddressRecord[]): Agent {
  return new Agent({ connect: { lookup: pinnedLookup(records) as never } });
}

function pinnedLookup(records: SourceAddressRecord[]): ValidatedPublicLookup {
  return (_hostname, options, callback) => callbackWithRecords(records, options, callback);
}

export function normalizePublicSourceUrl(raw: string): URL {
  const text = String(raw || '').normalize('NFKC').trim();
  if (!text || text.length > MAX_SOURCE_URL_LENGTH) {
    throw new Error('Source image URL is empty or too long');
  }
  let url: URL;
  try {
    url = new URL(text.startsWith('//') ? `https:${text}` : text);
  } catch {
    throw new Error('Source image URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Source image URL must be an unauthenticated HTTP(S) URL');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Source image URL uses a disallowed port');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')) {
    throw publicLookupError(hostname);
  }
  if (isIP(hostname) && !isPublicSourceAddress(hostname)) throw publicLookupError(hostname);
  url.hash = '';
  return url;
}

function normalizeContentType(value: string | null): string {
  return String(value || '').split(';')[0]!.trim().toLowerCase();
}

function sourceReferer(url: URL): string {
  if (/(?:^|\.)alicdn\.com$/i.test(url.hostname) || /(?:^|\.)1688\.com$/i.test(url.hostname)) {
    return 'https://detail.1688.com/';
  }
  if (/(?:^|\.)pinduoduo\.com$/i.test(url.hostname) || /(?:^|\.)yangkeduo\.com$/i.test(url.hostname)) {
    return 'https://mobile.yangkeduo.com/';
  }
  return url.origin;
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Source image exceeds ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Source image exceeds ${maxBytes} bytes`);
    return buffer;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Source image exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function downloadPublicImage(
  rawUrl: string,
  options: DownloadPublicImageOptions = {},
): Promise<DownloadedPublicImage> {
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES));
  const maxRedirects = Math.max(0, Math.min(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS, 10));
  const timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000));
  const resolver = options.lookup || (async (hostname: string) => (
    dnsLookup(hostname, { all: true, verbatim: true })
  ));
    const source = normalizePublicSourceUrl(rawUrl);
  let current = source;
  let redirectCount = 0;

  while (true) {
    const hostname = current.hostname.replace(/^\[|\]$/g, '');
    const records = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
    : await resolvePublicSourceAddresses(hostname, resolver);
    if (records.some((record) => !isPublicSourceAddress(record.address))) {
      throw publicLookupError(hostname);
    }

    const dispatcher = options.fetch
      ? undefined
      : new Agent({ connect: { lookup: pinnedLookup(records) as never } });
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = options.fetch
        ? await options.fetch(current.href, {
          redirect: 'manual',
          signal,
          headers: {
            accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
            'user-agent': 'Mozilla/5.0 (compatible; SS-ERP-Source-Media/1.0)',
            ...(options.omitReferer ? {} : { referer: sourceReferer(current) }),
          },
        })
        : await undiciFetch(current.href, {
          redirect: 'manual',
          signal,
          dispatcher: dispatcher!,
          headers: {
            accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
            'user-agent': 'Mozilla/5.0 (compatible; SS-ERP-Source-Media/1.0)',
            ...(options.omitReferer ? {} : { referer: sourceReferer(current) }),
          },
        }) as unknown as Response;

      if (REDIRECT_STATUSES.has(response.status)) {
        await cancelBody(response);
        const location = response.headers.get('location');
        if (!location) throw new Error('Source image redirect has no location');
        if (redirectCount >= maxRedirects) throw new Error('Source image redirect limit exceeded');
        current = normalizePublicSourceUrl(new URL(location, current).href);
        redirectCount += 1;
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        await cancelBody(response);
        throw new Error(`Unsupported source image redirect status ${response.status}`);
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new Error(`Source image fetch failed with HTTP ${response.status}`);
      }
      const contentType = normalizeContentType(response.headers.get('content-type'));
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        await cancelBody(response);
        throw new Error(`Source image content type is not allowed: ${contentType || '<missing>'}`);
      }
      const buffer = await readBoundedBody(response, maxBytes);
      return {
        sourceUrl: source.href,
        finalUrl: current.href,
        contentType,
        buffer,
        redirectCount,
      };
    } finally {
      if (dispatcher) await dispatcher.close().catch(() => undefined);
    }
  }
}
