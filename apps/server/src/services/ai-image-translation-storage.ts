import { isIP } from 'node:net';
import type { RuntimeConfig } from '../adapters/runtime-config.js';

export interface AiImageTranslationStorageReadiness {
  ready: boolean;
  reason: string;
  backend?: RuntimeConfig['imageStorage'];
  /** Whether the frozen source/output URL can be fetched over the public Internet. */
  publicHttps?: boolean;
  publicBaseUrl?: string;
}
function isPrivateIp(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(normalized);
  if (version === 6) {
    // URL canonicalization converts dotted IPv4-mapped literals to hex, so
    // reject the entire mapped range. Only global-unicast 2000::/3 literals
    // are eligible; loopback, ULA, link-local and multicast remain private.
    if (normalized.startsWith('::ffff:')) return true;
    const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
    return !Number.isFinite(first) || (first & 0xe000) !== 0x2000;
  }
  if (version !== 4) return false;
  const [a = 0, b = 0] = normalized.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || a >= 224;
}

/**
 * Validate the URL shape used by the external image Provider to fetch an
 * internalized source image. DNS/HTTP reachability is checked by the Provider
 * adapter at dispatch time; this gate rejects local/private and non-HTTPS
 * transports before a paid task can be created.
 */
export function isPublicHttpsStorageUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (parsed.protocol !== 'https:' || !hostname || hostname.endsWith('.')
    || parsed.username || parsed.password) return false;
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;
  if (isIP(hostname) !== 0 && isPrivateIp(hostname)) return false;
  return true;
}

function publicUrlForStorage(config: Pick<RuntimeConfig, 'imageStorage' | 'oss' | 'localBaseUrl'>): string {
  if (config.imageStorage === 'oss') return config.oss?.cdnDomain || config.localBaseUrl || '';
  return config.localBaseUrl || '';
}

/**
 * Resolve the storage transport contract for image translation.
 *
 * `local` is intentionally usable only by the fake/sandbox Provider. A paid
 * Provider must use an owned OSS/CDN URL that is explicitly HTTPS and not a
 * private/local address. Ozon CDN is rejected because this workflow has no
 * frozen shop context from which to obtain the seller cookie.
 */
export function resolveAiImageTranslationStorageReadiness(
  config: Pick<RuntimeConfig, 'imageStorage' | 'oss' | 'localBaseUrl'>,
): AiImageTranslationStorageReadiness {
  const backend = config.imageStorage;
  if (backend === 'ozon-cdn') {
    return {
      ready: false,
      backend,
      publicHttps: false,
      reason: 'Image translation requires OSS or local storage because no shop context is frozen',
    };
  }
  if (backend === 'oss' && !config.oss) {
    return {
      ready: false,
      backend,
      publicHttps: false,
      reason: 'Image translation object storage is not fully configured',
    };
  }
  if (backend !== 'oss' && backend !== 'local') {
    return {
      ready: false,
      backend,
      publicHttps: false,
      reason: 'Image translation storage backend is not supported',
    };
  }

  const publicBaseUrl = publicUrlForStorage(config);
  const publicHttps = isPublicHttpsStorageUrl(publicBaseUrl);
  if (backend === 'oss' && !publicHttps) {
    return {
      ready: false,
      backend,
      publicHttps,
      publicBaseUrl: publicBaseUrl || undefined,
      reason: 'OSS image translation storage needs a reachable public HTTPS CDN or API URL',
    };
  }

  return {
    ready: true,
    backend,
    publicHttps,
    publicBaseUrl: publicBaseUrl || undefined,
    reason: backend === 'local'
      ? 'Local image translation storage is available for fake/sandbox execution'
      : 'Owned OSS image translation storage is ready',
  };
}
